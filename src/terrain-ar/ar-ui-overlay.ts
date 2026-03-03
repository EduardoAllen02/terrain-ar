/**
 * ArUiOverlay — v8
 *
 * ════════════════════════════════════════════════════════════
 * DEFINITIVE ORIENTATION FIX  (unchanged from v7)
 * ════════════════════════════════════════════════════════════
 */

let _viewportFixInstalled = false
export function installViewportFix(): void {
  if (_viewportFixInstalled) return
  _viewportFixInstalled = true
  const resetViewport = () => {
    let meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
    if (!meta) {
      meta = document.createElement('meta')
      meta.name = 'viewport'
      document.head.appendChild(meta)
    }
    meta.content = 'width=10000, initial-scale=1, minimum-scale=1, maximum-scale=1'
    requestAnimationFrame(() => {
      meta!.content = 'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1'
    })
  }
  const onOrientChange = () => setTimeout(resetViewport, 200)
  window.addEventListener('orientationchange', onOrientChange, {passive: true})
  window.addEventListener('resize',            onOrientChange, {passive: true})
  try { screen.orientation?.addEventListener('change', onOrientChange) } catch (_) {}
}

// ─── CSS ─────────────────────────────────────────────────────────────────────

const injectStyles = (() => {
  let done = false
  return () => {
    if (done) return
    done = true
    const s = document.createElement('style')
    s.textContent = `
      /* ── Design tokens ──────────────────────────────────────────────── */
      :root {
        --ar-accent:      #4ab8d8;
        --ar-accent-glow: rgba(74,184,216,0.55);
        --ar-accent-soft: rgba(74,184,216,0.18);
        --ar-surface:     rgba(255,255,255,0.90);
        --ar-surface-act: rgba(228,248,255,0.98);
        --ar-overlay:     rgba(0,0,0,0.46);
        --ar-text-label:  rgba(74,184,216,0.65);
        --ar-shadow:      0 2px 14px rgba(0,0,0,0.16);
        --ar-gap:         8px;
        --ar-edge:        16px;
        --ar-bottom:      20px;
        --ar-pill:        100px;
        --ar-h:           40px;    /* slimmer bars */
        --ar-thumb:       26px;    /* thumb diameter */
        --ar-font: 'Helvetica Neue', Helvetica, Arial, sans-serif;
      }

      /* ── Loader ─────────────────────────────────────────────────────── */
      #terrain-ar-loader {
        position:fixed; inset:0;
        display:flex; flex-direction:column;
        align-items:center; justify-content:center;
        gap:18px; pointer-events:none; z-index:9999;
        transition:opacity .45s ease;
      }
      #terrain-ar-loader.hidden { opacity:0; }
      .ar-loader-orbit { position:relative; width:48px; height:48px; }
      .ar-loader-ring  {
        position:absolute; inset:0; border-radius:50%;
        border:1.5px solid var(--ar-accent-soft);
      }
      .ar-loader-ball {
        position:absolute; width:10px; height:10px; border-radius:50%;
        background:var(--ar-accent);
        box-shadow:0 0 10px var(--ar-accent-glow),0 0 22px rgba(74,184,216,.22);
        top:-5px; left:50%; transform-origin:50% 29px;
        animation:ar-ball-orbit 1.1s cubic-bezier(.45,.05,.55,.95) infinite;
      }
      @keyframes ar-ball-orbit {
        from { transform:translateX(-50%) rotate(0deg) }
        to   { transform:translateX(-50%) rotate(360deg) }
      }
      .ar-loader-label {
        font-family:var(--ar-font); font-size:11px; font-weight:300;
        letter-spacing:.24em; text-transform:uppercase;
        color:rgba(255,255,255,.55);
        animation:ar-label-pulse 1.8s ease-in-out infinite;
      }
      @keyframes ar-label-pulse { 0%,100%{opacity:.55} 50%{opacity:1} }

      /* ── Fullscreen button ──────────────────────────────────────────── */
      #ar-fullscreen-btn {
        position:fixed; top:18px; right:18px; z-index:9998;
        width:38px; height:38px;
        display:flex; align-items:center; justify-content:center;
        background:var(--ar-surface); border:none; border-radius:50%;
        cursor:pointer; box-shadow:var(--ar-shadow);
        -webkit-tap-highlight-color:transparent;
        transition:background .2s, opacity .25s;
        opacity:0; pointer-events:none; color:var(--ar-accent);
      }
      #ar-fullscreen-btn.ar-fs-visible { opacity:1; pointer-events:all; }
      #ar-fullscreen-btn:active { background:var(--ar-surface-act); }

      /* ══════════════════════════════════════════════════════════════════
         BOTTOM BAR — centred, two rows, no external labels
      ══════════════════════════════════════════════════════════════════ */
      #ar-bottom-bar {
        position: fixed;
        bottom: var(--ar-bottom);
        left:   50%;
        transform: translateX(-50%);
        width: calc(100% - var(--ar-edge) * 2);
        max-width: 540px;
        z-index: 9998;
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: var(--ar-gap);
        opacity: 0;
        transition: opacity .28s ease;
        pointer-events: none;
      }
      #ar-bottom-bar.ar-bar-visible { opacity:1; pointer-events:all; }

      #ar-bar-row-top {
        display: flex;
        align-items: stretch;
        gap: var(--ar-gap);
      }
      #ar-bar-row-height {
        display: flex;
        align-items: stretch;
      }

      /* ── Track shell (shared) ───────────────────────────────────────── */
      .ar-track {
        height: var(--ar-h);
        background: var(--ar-surface);
        border-radius: var(--ar-pill);
        box-shadow: var(--ar-shadow);
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
        overflow: hidden;          /* keep everything inside rounded pill */
        cursor: ew-resize;
        touch-action: none;
        user-select: none;
        -webkit-tap-highlight-color: transparent;
      }
      /* subtle center line */
      .ar-track::before {
        content: '';
        position: absolute;
        left: 44px; right: 44px; height: 1.5px;
        background: linear-gradient(90deg,
          transparent 0%, var(--ar-accent-soft) 25%,
          rgba(74,184,216,.20) 50%, var(--ar-accent-soft) 75%, transparent 100%);
        border-radius: 1px; pointer-events: none;
      }

      #ar-rot-track    { flex: 3; min-width: 0; }
      #ar-height-track { flex: 1; min-width: 0; }

      /* ── Chevrons (clipped by overflow:hidden) ──────────────────────── */
      .ar-track-chevron {
        position: absolute; top: 50%; transform: translateY(-50%);
        display: flex; align-items: center;
        color: rgba(74,184,216,.35); pointer-events: none;
      }
      .ar-track-chevron-left  { left: 10px; }
      .ar-track-chevron-right { right: 10px; }

      /* ── Label — inside the pill, right edge, always visible, no overlap */
      .ar-track-label {
        position: absolute;
        right: 26px;
        font-family: var(--ar-font);
        font-size: 9px; font-weight: 700;
        letter-spacing: .20em; text-transform: uppercase;
        color: var(--ar-text-label);
        white-space: nowrap; pointer-events: none;
        /* subtle fade so thumb sliding over it looks intentional */
        opacity: 0.85;
      }

      /* ── Thumb ──────────────────────────────────────────────────────── */
      .ar-track-thumb {
        position: relative; z-index: 2;
        width: var(--ar-thumb); height: var(--ar-thumb);
        border-radius: 50%;
        background: var(--ar-accent);
        box-shadow: 0 2px 8px var(--ar-accent-glow);
        flex-shrink: 0; will-change: transform; pointer-events: none;
        transition: box-shadow .15s;
      }
      .ar-track:active .ar-track-thumb {
        box-shadow: 0 2px 16px var(--ar-accent-glow), 0 0 0 5px var(--ar-accent-soft);
      }

      /* ── Reset button ───────────────────────────────────────────────── */
      #ar-reset-btn {
        flex: 1; min-width: 0;
        height: var(--ar-h);
        display: flex; align-items: center; justify-content: center; gap: 5px;
        background: var(--ar-surface); border: none;
        border-radius: var(--ar-pill);
        box-shadow: var(--ar-shadow);
        font-family: var(--ar-font); font-size: 10px; font-weight: 700;
        letter-spacing: .12em; text-transform: uppercase;
        color: var(--ar-accent); cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        transition: background .2s;
        white-space: nowrap;
      }
      #ar-reset-btn:active { background: var(--ar-surface-act); }
      #ar-reset-btn svg    { flex-shrink: 0; color: var(--ar-accent); }

      /* ══════════════════════════════════════════════════════════════════
         GESTURE HINTS — above both bar rows, never overlaps them
      ══════════════════════════════════════════════════════════════════ */
      #ar-gesture-hint {
        position: fixed;
        bottom: calc(var(--ar-bottom) + var(--ar-h) * 2 + var(--ar-gap) + 16px);
        left: var(--ar-edge);
        z-index: 9998;
        display: flex; flex-direction: column;
        align-items: flex-start; gap: 8px;
        pointer-events: none;
        opacity: 0; transition: opacity .4s ease;
      }
      #ar-gesture-hint.ar-hint-visible { opacity: 1; }
      #ar-gesture-hint.ar-hint-hidden  { opacity: 0; }
      .ar-hint-row {
        display: flex; align-items: center; gap: 10px;
        background: var(--ar-overlay); backdrop-filter: blur(10px);
        border-radius: var(--ar-pill); padding: 8px 14px;
      }
      .ar-hint-icon {
        width: 22px; height: 22px; flex-shrink: 0; color: rgba(255,255,255,.88);
      }
      .ar-hint-text {
        font-family: var(--ar-font); font-size: 11px; font-weight: 400;
        letter-spacing: .08em; color: rgba(255,255,255,.85); white-space: nowrap;
      }
      .ar-hint-icon-pinch { animation: ar-pinch 1.8s ease-in-out infinite; }
      @keyframes ar-pinch { 0%,100%{transform:scale(1);opacity:.6} 50%{transform:scale(.80);opacity:1} }
      .ar-hint-icon-drag  { animation: ar-drag  1.6s ease-in-out infinite; }
      @keyframes ar-drag  { 0%,100%{transform:translateX(0);opacity:.5} 50%{transform:translateX(6px);opacity:1} }

      /* ══════════════════════════════════════════════════════════════════
         LANDSCAPE — phone & tablet
         Bar already centred via translateX(-50%).
         Hints stay left-anchored, calculation adapts via custom props.
      ══════════════════════════════════════════════════════════════════ */
      @media (orientation: landscape) {
        :root {
          --ar-h:      34px;
          --ar-thumb:  22px;
          --ar-bottom: 10px;
          --ar-edge:   20px;
          --ar-gap:     6px;
        }
        #ar-bottom-bar     { max-width: 600px; }
        #ar-fullscreen-btn { top:10px; right:14px; width:32px; height:32px; }
        .ar-hint-row       { padding:6px 12px; }
        .ar-hint-text      { font-size:10px; }
        .ar-hint-icon      { width:18px; height:18px; }
        #ar-reset-btn      { font-size:9px; gap:4px; }
        #ar-reset-btn svg  { width:11px; height:11px; }
        .ar-track-label    { font-size:8px; }
      }
      /* Wide landscape — tablet */
      @media (orientation: landscape) and (min-width: 768px) {
        :root { --ar-h: 38px; --ar-thumb: 24px; --ar-edge: 28px; }
        #ar-bottom-bar { max-width: 680px; }
      }
    `
    document.head.appendChild(s)
  }
})()

// ─── Fullscreen helpers ───────────────────────────────────────────────────────

function enterFullscreen(): void {
  const el = document.documentElement as any
  ;(el.requestFullscreen ?? el.webkitRequestFullscreen ?? el.mozRequestFullScreen)?.call(el)
}
function exitFullscreen(): void {
  const doc = document as any
  ;(doc.exitFullscreen ?? doc.webkitExitFullscreen ?? doc.mozCancelFullScreen)?.call(doc)
}
export function isFullscreen(): boolean {
  const doc = document as any
  return !!(doc.fullscreenElement ?? doc.webkitFullscreenElement ?? doc.mozFullScreenElement)
}

const ICON_EXPAND = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
  <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/>
  <line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
</svg>`
const ICON_COMPRESS = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
  <polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/>
  <line x1="10" y1="14" x2="3" y2="21"/><line x1="21" y1="3" x2="14" y2="10"/>
</svg>`

// ─── Track builder ────────────────────────────────────────────────────────────

function buildTrack(
  id: string, thumbId: string, label: string,
  leftSvgPath: string, rightSvgPath: string,
): HTMLElement {
  const track = document.createElement('div')
  track.id = id
  track.className = 'ar-track'
  track.innerHTML = `
    <div class="ar-track-chevron ar-track-chevron-left">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2.6"
           stroke-linecap="round" stroke-linejoin="round">
        ${leftSvgPath}
      </svg>
    </div>
    <div class="ar-track-chevron ar-track-chevron-right">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2.6"
           stroke-linecap="round" stroke-linejoin="round">
        ${rightSvgPath}
      </svg>
    </div>
    <div id="${thumbId}" class="ar-track-thumb"></div>
    <span class="ar-track-label">${label}</span>`
  return track
}

// ─── Spring-track interaction (reusable) ──────────────────────────────────────

function attachTrack(
  track:      HTMLElement,
  thumbEl:    HTMLElement,
  onDelta:    (scaledDx: number) => void,
  rafHolder:  {id: number},
  sensitivity = 0.011,
): () => void {
  let thumbPos = 0, dragging = false, lastX = 0

  const maxTravel  = () => Math.max(18, (track.clientWidth / 2) - 22)
  const setThumb   = (px: number) => {
    thumbPos = Math.max(-maxTravel(), Math.min(maxTravel(), px))
    thumbEl.style.transform = `translateX(${thumbPos}px)`
  }
  const stopSpring = () => cancelAnimationFrame(rafHolder.id)
  const springBack = () => {
    stopSpring()
    const step = () => {
      thumbPos *= 0.72
      thumbEl.style.transform = `translateX(${thumbPos}px)`
      if (Math.abs(thumbPos) > 0.5) rafHolder.id = requestAnimationFrame(step)
      else { thumbPos = 0; thumbEl.style.transform = 'translateX(0)' }
    }
    rafHolder.id = requestAnimationFrame(step)
  }

  const onTouchStart = (e: TouchEvent) => {
    if (e.touches.length !== 1) return
    e.stopPropagation(); dragging = true; lastX = e.touches[0].clientX; stopSpring()
  }
  const onTouchMove = (e: TouchEvent) => {
    if (!dragging || e.touches.length !== 1) return
    e.preventDefault(); e.stopPropagation()
    const dx = e.touches[0].clientX - lastX; lastX = e.touches[0].clientX
    setThumb(thumbPos + dx)
    if (Math.abs(dx) > 0.2) onDelta(dx * sensitivity)
  }
  const onTouchEnd  = () => { dragging = false; springBack() }
  const onMouseDown = (e: MouseEvent) => { dragging = true; lastX = e.clientX; stopSpring(); e.preventDefault() }
  const onMouseMove = (e: MouseEvent) => {
    if (!dragging) return
    const dx = e.clientX - lastX; lastX = e.clientX
    setThumb(thumbPos + dx)
    if (Math.abs(dx) > 0.2) onDelta(dx * sensitivity)
  }
  const onMouseUp = () => { dragging = false; springBack() }

  track.addEventListener('touchstart',  onTouchStart as EventListener, {passive: false})
  track.addEventListener('touchmove',   onTouchMove  as EventListener, {passive: false})
  track.addEventListener('touchend',    onTouchEnd,                     {passive: true})
  track.addEventListener('touchcancel', onTouchEnd,                     {passive: true})
  track.addEventListener('mousedown',   onMouseDown  as EventListener)
  window.addEventListener('mousemove',  onMouseMove  as EventListener)
  window.addEventListener('mouseup',    onMouseUp)

  return () => {
    track.removeEventListener('touchstart',  onTouchStart as EventListener)
    track.removeEventListener('touchmove',   onTouchMove  as EventListener)
    track.removeEventListener('touchend',    onTouchEnd)
    track.removeEventListener('touchcancel', onTouchEnd)
    track.removeEventListener('mousedown',   onMouseDown  as EventListener)
    window.removeEventListener('mousemove',  onMouseMove  as EventListener)
    window.removeEventListener('mouseup',    onMouseUp)
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export class ArUiOverlay {
  private loader:       HTMLElement | null = null
  private fsBtn:        HTMLElement | null = null
  private gestureHint:  HTMLElement | null = null
  private bottomBar:    HTMLElement | null = null
  private rowTop:       HTMLElement | null = null
  private rowHeight:    HTMLElement | null = null
  private rotTrack:     HTMLElement | null = null
  private rotThumb:     HTMLElement | null = null
  private resetBtn:     HTMLElement | null = null
  private heightTrack:  HTMLElement | null = null
  private heightThumb:  HTMLElement | null = null

  private _t1 = 0; private _t2 = 0; private _hintTimer = 0
  private _fsListener:    (() => void) | null = null
  private _rotRAF         = {id: 0}
  private _heightRAF      = {id: 0}
  private _rotCleanup:    (() => void) | null = null
  private _heightCleanup: (() => void) | null = null

  // ── Bottom bar ────────────────────────────────────────────────────────────

  private _ensureBottomBar(): {bar: HTMLElement; rowTop: HTMLElement; rowHeight: HTMLElement} {
    if (this.bottomBar && this.rowTop && this.rowHeight)
      return {bar: this.bottomBar, rowTop: this.rowTop, rowHeight: this.rowHeight}
    injectStyles()
    const bar = document.createElement('div')
    bar.id = 'ar-bottom-bar'
    bar.innerHTML = `<div id="ar-bar-row-top"></div><div id="ar-bar-row-height"></div>`
    document.body.appendChild(bar)
    this.bottomBar = bar
    this.rowTop    = bar.querySelector<HTMLElement>('#ar-bar-row-top')!
    this.rowHeight = bar.querySelector<HTMLElement>('#ar-bar-row-height')!
    return {bar, rowTop: this.rowTop, rowHeight: this.rowHeight}
  }

  private _showBottomBar(): void {
    requestAnimationFrame(() => this._ensureBottomBar().bar.classList.add('ar-bar-visible'))
  }

  private _hideBottomBar(): void {
    if (!this.bottomBar) return
    const el = this.bottomBar
    this.bottomBar = this.rowTop = this.rowHeight = null
    this.rotTrack = this.rotThumb = this.resetBtn = null
    this.heightTrack = this.heightThumb = null
    el.classList.remove('ar-bar-visible')
    setTimeout(() => el.remove(), 320)
  }

  private _checkHideBar(): void {
    if (!this.rotTrack && !this.resetBtn && !this.heightTrack) this._hideBottomBar()
  }

  // ── Loader ────────────────────────────────────────────────────────────────

  showLoader(): void {
    injectStyles()
    if (this.loader) return
    this.loader = document.createElement('div')
    this.loader.id = 'terrain-ar-loader'
    this.loader.innerHTML = `
      <div class="ar-loader-orbit">
        <div class="ar-loader-ring"></div>
        <div class="ar-loader-ball"></div>
      </div>
      <span class="ar-loader-label" id="ar-loader-text">Starting camera</span>`
    document.body.appendChild(this.loader)
    this._t1 = window.setTimeout(() => {
      const el = document.getElementById('ar-loader-text')
      if (el) el.textContent = 'Detecting environment'
    }, 4000)
    this._t2 = window.setTimeout(() => {
      const el = document.getElementById('ar-loader-text')
      if (el) el.textContent = 'Preparing experience'
    }, 8000)
  }

  showRescanLoader(): void {
    injectStyles()
    if (this.loader) return
    this.loader = document.createElement('div')
    this.loader.id = 'terrain-ar-loader'
    this.loader.innerHTML = `
      <div class="ar-loader-orbit">
        <div class="ar-loader-ring"></div>
        <div class="ar-loader-ball"></div>
      </div>
      <span class="ar-loader-label" id="ar-loader-text">Detecting environment</span>`
    document.body.appendChild(this.loader)
  }

  hideLoader(): void {
    window.clearTimeout(this._t1); window.clearTimeout(this._t2)
    if (!this.loader) return
    const el = this.loader; this.loader = null
    el.classList.add('hidden')
    setTimeout(() => el.remove(), 480)
  }

  // ── Reset button ──────────────────────────────────────────────────────────

  showResetButton(onReset: () => void): void {
    const {rowTop} = this._ensureBottomBar()
    if (this.resetBtn) return
    const btn = document.createElement('button')
    btn.id = 'ar-reset-btn'
    btn.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2.6"
           stroke-linecap="round" stroke-linejoin="round">
        <polyline points="1 4 1 10 7 10"/>
        <path d="M3.51 15a9 9 0 1 0 .49-5"/>
      </svg>
      Reset`
    rowTop.appendChild(btn)
    this.resetBtn = btn
    btn.addEventListener('click', () => { this.hideResetButton(); onReset() })
  }

  hideResetButton(): void {
    if (!this.resetBtn) return
    this.resetBtn.remove(); this.resetBtn = null
    this._checkHideBar()
  }

  // ── Rotation track ────────────────────────────────────────────────────────

  showRotationBar(onRotate: (deltaRad: number) => void): void {
    const {rowTop} = this._ensureBottomBar()
    if (this.rotTrack) return
    const track = buildTrack(
      'ar-rot-track', 'ar-rot-thumb', 'Rotate',
      '<polyline points="15 18 9 12 15 6"/>',
      '<polyline points="9 18 15 12 9 6"/>',
    )
    if (rowTop.firstChild) rowTop.insertBefore(track, rowTop.firstChild)
    else                   rowTop.appendChild(track)
    this.rotTrack = track
    this.rotThumb = track.querySelector<HTMLElement>('#ar-rot-thumb')!
    this._showBottomBar()
    this._rotCleanup = attachTrack(track, this.rotThumb, onRotate, this._rotRAF, 0.011)
  }

  hideRotationBar(): void {
    cancelAnimationFrame(this._rotRAF.id)
    this._rotCleanup?.(); this._rotCleanup = null
    this.rotThumb = null
    if (this.rotTrack) { this.rotTrack.remove(); this.rotTrack = null }
    this._checkHideBar()
  }

  // ── Height track ──────────────────────────────────────────────────────────

  showHeightBar(onHeight: (delta: number) => void): void {
    const {rowHeight} = this._ensureBottomBar()
    if (this.heightTrack) return
    const track = buildTrack(
      'ar-height-track', 'ar-height-thumb', 'Height',
      /* left  = lower ↓ */ '<polyline points="6 9 12 15 18 9"/>',
      /* right = raise ↑ */ '<polyline points="18 15 12 9 6 15"/>',
    )
    rowHeight.appendChild(track)
    this.heightTrack = track
    this.heightThumb = track.querySelector<HTMLElement>('#ar-height-thumb')!
    this._showBottomBar()
    this._heightCleanup = attachTrack(track, this.heightThumb, onHeight, this._heightRAF, 0.012)
  }

  hideHeightBar(): void {
    cancelAnimationFrame(this._heightRAF.id)
    this._heightCleanup?.(); this._heightCleanup = null
    this.heightThumb = null
    if (this.heightTrack) { this.heightTrack.remove(); this.heightTrack = null }
    this._checkHideBar()
  }

  // ── Fullscreen button ─────────────────────────────────────────────────────

  showFullscreenButton(): void {
    injectStyles()
    if (this.fsBtn) return
    const btn = document.createElement('button')
    btn.id = 'ar-fullscreen-btn'
    btn.setAttribute('aria-label', 'Toggle fullscreen')
    btn.innerHTML = isFullscreen() ? ICON_COMPRESS : ICON_EXPAND
    document.body.appendChild(btn)
    this.fsBtn = btn
    requestAnimationFrame(() => btn.classList.add('ar-fs-visible'))
    btn.addEventListener('click', () => { isFullscreen() ? exitFullscreen() : enterFullscreen() })
    this._fsListener = () => {
      if (this.fsBtn) this.fsBtn.innerHTML = isFullscreen() ? ICON_COMPRESS : ICON_EXPAND
    }
    document.addEventListener('fullscreenchange',       this._fsListener)
    document.addEventListener('webkitfullscreenchange', this._fsListener)
  }

  hideFullscreenButton(keepFullscreen = false): void {
    if (this.fsBtn) {
      const el = this.fsBtn; this.fsBtn = null
      el.classList.remove('ar-fs-visible')
      setTimeout(() => el.remove(), 280)
    }
    if (this._fsListener) {
      document.removeEventListener('fullscreenchange',       this._fsListener)
      document.removeEventListener('webkitfullscreenchange', this._fsListener)
      this._fsListener = null
    }
    if (!keepFullscreen && isFullscreen()) exitFullscreen()
  }

  // ── Gesture hints ─────────────────────────────────────────────────────────

  showGestureHint(): void {
    injectStyles()
    if (this.gestureHint) return
    const div = document.createElement('div')
    div.id = 'ar-gesture-hint'
    div.innerHTML = `
      <div class="ar-hint-row">
        <svg class="ar-hint-icon ar-hint-icon-pinch" viewBox="0 0 32 32" fill="none"
             stroke="currentColor" stroke-width="1.8"
             stroke-linecap="round" stroke-linejoin="round">
          <circle cx="10" cy="10" r="3"/>
          <circle cx="22" cy="22" r="3"/>
          <line x1="10" y1="13" x2="10" y2="24"/>
          <line x1="22" y1="9"  x2="22" y2="19"/>
        </svg>
        <span class="ar-hint-text">Pinch to scale</span>
      </div>
      <div class="ar-hint-row">
        <svg class="ar-hint-icon ar-hint-icon-drag" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="1.8"
             stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 11V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2v0"/>
          <path d="M14 10V4a2 2 0 0 0-2-2 2 2 0 0 0-2 2v2"/>
          <path d="M10 10.5V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2v8"/>
          <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>
        </svg>
        <span class="ar-hint-text">Drag to move</span>
      </div>`
    document.body.appendChild(div)
    this.gestureHint = div
    requestAnimationFrame(() => div.classList.add('ar-hint-visible'))
    this._hintTimer = window.setTimeout(() => this.hideGestureHint(), 5000)
    window.addEventListener('touchstart', () => this.hideGestureHint(), {passive: true, once: true})
  }

  hideGestureHint(): void {
    window.clearTimeout(this._hintTimer)
    if (!this.gestureHint) return
    const el = this.gestureHint; this.gestureHint = null
    el.classList.remove('ar-hint-visible')
    el.classList.add('ar-hint-hidden')
    setTimeout(() => el.remove(), 450)
  }
}