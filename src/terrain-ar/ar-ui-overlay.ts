/**
 * ArUiOverlay — v7
 *
 * ════════════════════════════════════════════════════════════
 * DEFINITIVE ORIENTATION FIX
 * ════════════════════════════════════════════════════════════
 *
 * Root cause (confirmed via Android Chromium issue tracker):
 *   Chrome Android does NOT correctly reset the viewport scale
 *   when the device rotates BACK to portrait.  The layout
 *   viewport keeps its landscape-width value, so `position:fixed`
 *   elements are placed relative to a coordinate space that is
 *   still as wide as the landscape screen — everything appears
 *   proportionally smaller / "zoomed out".
 *
 * The fix is NOT about CSS heights or custom properties.
 * It is about resetting the <meta name="viewport"> tag via JS
 * on every `orientationchange`.  The two-step trick:
 *
 *   1. Set  width=10000  (forces browser to blow away cached layout)
 *   2. One rAF later:  restore  width=device-width
 *
 * This is the canonical fix from the Android Browser / Sencha Touch
 * community and it works on modern Chrome Android as well because
 * Chrome still inherits the WebKit layout-viewport stale-cache bug
 * on rotation.
 *
 * The fix is installed ONCE per page via `installViewportFix()`,
 * which is exported and must be called from your app entry point
 * (index.ts / main.ts) as early as possible — well before any AR
 * component mounts.
 *
 * ════════════════════════════════════════════════════════════
 */

// ─── Viewport orientation fix ────────────────────────────────────────────────

let _viewportFixInstalled = false

/**
 * Call once at app startup.  Survives HMR because of the guard flag.
 */
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
      meta!.content =
        'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1'
    })
  }

  const onOrientChange = () => setTimeout(resetViewport, 200)

  window.addEventListener('orientationchange', onOrientChange, {passive: true})
  window.addEventListener('resize', onOrientChange, {passive: true})
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
        --ar-accent-soft: rgba(74,184,216,0.20);
        --ar-surface:     rgba(255,255,255,0.92);
        --ar-surface-act: rgba(228,248,255,0.98);
        --ar-overlay:     rgba(0,0,0,0.46);
        --ar-text-label:  rgba(100,148,170,0.90);
        --ar-shadow:      0 2px 18px rgba(0,0,0,0.18);
        --ar-gap:         10px;
        --ar-edge:        16px;
        --ar-bottom:      24px;
        --ar-pill:        100px;
        --ar-h:           48px;
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
      .ar-loader-ring {
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
        from{transform:translateX(-50%) rotate(0deg)}
        to  {transform:translateX(-50%) rotate(360deg)}
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
        position:fixed; top:20px; right:20px; z-index:9998;
        width:40px; height:40px;
        display:flex; align-items:center; justify-content:center;
        background:var(--ar-surface); border:none; border-radius:50%;
        cursor:pointer; box-shadow:var(--ar-shadow);
        -webkit-tap-highlight-color:transparent;
        transition:background .2s, opacity .25s;
        opacity:0; pointer-events:none; color:var(--ar-accent);
      }
      #ar-fullscreen-btn.ar-fs-visible { opacity:1; pointer-events:all; }
      #ar-fullscreen-btn:active { background:var(--ar-surface-act); }

      /* ── Bottom bar — column layout, two rows ───────────────────────── */
      #ar-bottom-bar {
        position: fixed;
        bottom: var(--ar-bottom);
        left:   var(--ar-edge);
        right:  var(--ar-edge);
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

      /* Top row: rotation track + reset button */
      #ar-bar-row-top {
        display: flex;
        align-items: stretch;
        gap: var(--ar-gap);
      }

      /* Bottom row: height track full-width */
      #ar-bar-row-height {
        display: flex;
        align-items: stretch;
      }

      /* ── Rotation track  (flex:3 → ≈75 %) ──────────────────────────── */
      #ar-rot-track {
        flex: 3; min-width: 0;
        height: var(--ar-h);
        background: var(--ar-surface);
        border-radius: var(--ar-pill);
        box-shadow: var(--ar-shadow);
        display:flex; align-items:center; justify-content:center;
        position:relative; overflow:visible;
        cursor:ew-resize; touch-action:none; user-select:none;
        -webkit-tap-highlight-color:transparent;
      }

      /* ── Height track (flex:1 → full row width) ─────────────────────── */
      #ar-height-track {
        flex: 1; min-width: 0;
        height: var(--ar-h);
        background: var(--ar-surface);
        border-radius: var(--ar-pill);
        box-shadow: var(--ar-shadow);
        display:flex; align-items:center; justify-content:center;
        position:relative; overflow:visible;
        cursor:ew-resize; touch-action:none; user-select:none;
        -webkit-tap-highlight-color:transparent;
      }

      /* Shared track internals */
      .ar-track-line {
        position:absolute; left:52px; right:52px; height:2px;
        background:linear-gradient(90deg,
          transparent 0%, var(--ar-accent-soft) 20%,
          rgba(74,184,216,.30) 50%, var(--ar-accent-soft) 80%, transparent 100%);
        border-radius:1px; pointer-events:none;
      }
      .ar-track-chevron {
        position:absolute; top:50%; transform:translateY(-50%);
        display:flex; align-items:center;
        color:rgba(74,184,216,.40); pointer-events:none;
      }
      .ar-track-chevron-left  { left:14px; }
      .ar-track-chevron-right { right:14px; }
      .ar-track-thumb {
        position:relative; z-index:1;
        width:32px; height:32px; border-radius:50%;
        background:var(--ar-accent);
        box-shadow:0 2px 10px var(--ar-accent-glow);
        flex-shrink:0; will-change:transform; pointer-events:none;
        transition:box-shadow .15s;
      }
      #ar-rot-track:active    .ar-track-thumb,
      #ar-height-track:active .ar-track-thumb {
        box-shadow:0 2px 18px var(--ar-accent-glow), 0 0 0 6px var(--ar-accent-soft);
      }
      .ar-track-label {
        position:absolute; bottom:-18px; left:50%; transform:translateX(-50%);
        font-family:var(--ar-font); font-size:9px; font-weight:600;
        letter-spacing:.22em; text-transform:uppercase;
        color:var(--ar-text-label); white-space:nowrap; pointer-events:none;
      }

      /* Keep old selectors as aliases so nothing breaks */
      .ar-rot-line    { position:absolute; left:52px; right:52px; height:2px;
        background:linear-gradient(90deg,transparent 0%,var(--ar-accent-soft) 20%,
        rgba(74,184,216,.30) 50%,var(--ar-accent-soft) 80%,transparent 100%);
        border-radius:1px; pointer-events:none; }
      .ar-rot-chevron { position:absolute; top:50%; transform:translateY(-50%);
        display:flex; align-items:center; color:rgba(74,184,216,.40); pointer-events:none; }
      .ar-rot-chevron-left  { left:14px; }
      .ar-rot-chevron-right { right:14px; }
      #ar-rot-thumb {
        position:relative; z-index:1; width:32px; height:32px; border-radius:50%;
        background:var(--ar-accent); box-shadow:0 2px 10px var(--ar-accent-glow);
        flex-shrink:0; will-change:transform; pointer-events:none; transition:box-shadow .15s;
      }
      #ar-rot-track:active #ar-rot-thumb {
        box-shadow:0 2px 18px var(--ar-accent-glow), 0 0 0 6px var(--ar-accent-soft);
      }
      .ar-rot-label {
        position:absolute; bottom:-18px; left:50%; transform:translateX(-50%);
        font-family:var(--ar-font); font-size:9px; font-weight:600;
        letter-spacing:.22em; text-transform:uppercase;
        color:var(--ar-text-label); white-space:nowrap; pointer-events:none;
      }

      /* ── Reset button  (flex:1 → ≈25 %) ────────────────────────────── */
      #ar-reset-btn {
        flex:1; min-width:0;
        height:var(--ar-h);
        display:flex; align-items:center; justify-content:center; gap:6px;
        background:var(--ar-surface); border:none;
        border-radius:var(--ar-pill);
        box-shadow:var(--ar-shadow);
        font-family:var(--ar-font); font-size:11px; font-weight:600;
        letter-spacing:.10em; text-transform:uppercase;
        color:var(--ar-accent); cursor:pointer;
        -webkit-tap-highlight-color:transparent;
        transition:background .2s;
        white-space:nowrap;
      }
      #ar-reset-btn:active { background:var(--ar-surface-act); }
      #ar-reset-btn svg { flex-shrink:0; color:var(--ar-accent); }

      /* ── Gesture hints — pushed above both bars ──────────────────────── */
      #ar-gesture-hint {
        position:fixed;
        bottom:calc(var(--ar-bottom) + var(--ar-h) * 2 + var(--ar-gap) + 22px);
        left:var(--ar-edge);
        z-index:9998;
        display:flex; flex-direction:column;
        align-items:flex-start; gap:8px;
        pointer-events:none;
        opacity:0; transition:opacity .4s ease;
      }
      #ar-gesture-hint.ar-hint-visible { opacity:1; }
      #ar-gesture-hint.ar-hint-hidden  { opacity:0; }
      .ar-hint-row {
        display:flex; align-items:center; gap:10px;
        background:var(--ar-overlay); backdrop-filter:blur(10px);
        border-radius:var(--ar-pill); padding:9px 16px;
      }
      .ar-hint-icon { width:24px; height:24px; flex-shrink:0; color:rgba(255,255,255,.88); }
      .ar-hint-text {
        font-family:var(--ar-font); font-size:11px; font-weight:400;
        letter-spacing:.08em; color:rgba(255,255,255,.85); white-space:nowrap;
      }
      .ar-hint-icon-pinch { animation:ar-pinch 1.8s ease-in-out infinite; }
      @keyframes ar-pinch { 0%,100%{transform:scale(1);opacity:.6} 50%{transform:scale(.80);opacity:1} }
      .ar-hint-icon-drag  { animation:ar-drag  1.6s ease-in-out infinite; }
      @keyframes ar-drag  { 0%,100%{transform:translateX(0);opacity:.5} 50%{transform:translateX(7px);opacity:1} }

      /* ── Landscape overrides ────────────────────────────────────────── */
      @media (orientation: landscape) {
        :root {
          --ar-h:      42px;
          --ar-bottom: 14px;
          --ar-edge:   20px;
          --ar-gap:     8px;
        }
        #ar-bottom-bar    { max-width:560px; }
        #ar-fullscreen-btn{ top:12px; right:16px; width:36px; height:36px; }
        .ar-hint-row      { padding:7px 13px; }
        .ar-hint-text     { font-size:10px; }
        .ar-hint-icon     { width:20px; height:20px; }
        #ar-reset-btn     { font-size:10px; gap:5px; }
        #ar-reset-btn svg { width:12px; height:12px; }
        .ar-rot-label     { font-size:8px; }
        .ar-track-label   { font-size:8px; }
        #ar-gesture-hint  {
          bottom:calc(var(--ar-bottom) + var(--ar-h) * 2 + var(--ar-gap) + 18px);
        }
      }
      @media (orientation:landscape) and (min-width:768px) {
        :root { --ar-h:46px; --ar-edge:28px; }
        #ar-bottom-bar { max-width:640px; }
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

const ICON_EXPAND = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
  <polyline points="15 3 21 3 21 9"/>
  <polyline points="9 21 3 21 3 15"/>
  <line x1="21" y1="3" x2="14" y2="10"/>
  <line x1="3" y1="21" x2="10" y2="14"/>
</svg>`

const ICON_COMPRESS = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
  <polyline points="4 14 10 14 10 20"/>
  <polyline points="20 10 14 10 14 4"/>
  <line x1="10" y1="14" x2="3" y2="21"/>
  <line x1="21" y1="3" x2="14" y2="10"/>
</svg>`

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

  private _t1 = 0
  private _t2 = 0
  private _hintTimer      = 0
  private _fsListener:    (() => void) | null = null
  private _rotSpringRAF   = 0
  private _rotCleanup:    (() => void) | null = null
  private _heightSpringRAF = 0
  private _heightCleanup: (() => void) | null = null

  // ── Bottom bar lifecycle ──────────────────────────────────────────────────

  private _ensureBottomBar(): { bar: HTMLElement; rowTop: HTMLElement; rowHeight: HTMLElement } {
    if (this.bottomBar && this.rowTop && this.rowHeight) {
      return { bar: this.bottomBar, rowTop: this.rowTop, rowHeight: this.rowHeight }
    }
    injectStyles()
    const bar = document.createElement('div')
    bar.id = 'ar-bottom-bar'
    bar.innerHTML = `
      <div id="ar-bar-row-top"></div>
      <div id="ar-bar-row-height"></div>
    `
    document.body.appendChild(bar)
    this.bottomBar  = bar
    this.rowTop     = bar.querySelector<HTMLElement>('#ar-bar-row-top')!
    this.rowHeight  = bar.querySelector<HTMLElement>('#ar-bar-row-height')!
    return { bar, rowTop: this.rowTop, rowHeight: this.rowHeight }
  }

  private _showBottomBar(): void {
    requestAnimationFrame(() => this._ensureBottomBar().bar.classList.add('ar-bar-visible'))
  }

  private _hideBottomBar(): void {
    if (!this.bottomBar) return
    const el = this.bottomBar
    this.bottomBar   = null
    this.rowTop      = null
    this.rowHeight   = null
    this.rotTrack    = null
    this.rotThumb    = null
    this.resetBtn    = null
    this.heightTrack = null
    this.heightThumb = null
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
    window.clearTimeout(this._t1)
    window.clearTimeout(this._t2)
    if (!this.loader) return
    const el = this.loader; this.loader = null
    el.classList.add('hidden')
    setTimeout(() => el.remove(), 480)
  }

  // ── Reset button ──────────────────────────────────────────────────────────

  showResetButton(onReset: () => void): void {
    const { rowTop } = this._ensureBottomBar()
    if (this.resetBtn) return
    const btn = document.createElement('button')
    btn.id = 'ar-reset-btn'
    btn.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2.5"
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
    const { rowTop } = this._ensureBottomBar()
    if (this.rotTrack) return

    const track = document.createElement('div')
    track.id = 'ar-rot-track'
    track.innerHTML = `
      <div class="ar-rot-line"></div>
      <div class="ar-rot-chevron ar-rot-chevron-left">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2.5"
             stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
      </div>
      <div class="ar-rot-chevron ar-rot-chevron-right">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2.5"
             stroke-linecap="round" stroke-linejoin="round">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </div>
      <div id="ar-rot-thumb"></div>
      <span class="ar-rot-label">Rotate</span>`

    if (rowTop.firstChild) rowTop.insertBefore(track, rowTop.firstChild)
    else                   rowTop.appendChild(track)

    this.rotTrack = track
    this.rotThumb = track.querySelector<HTMLElement>('#ar-rot-thumb')!
    this._showBottomBar()

    const SENSITIVITY = 0.011
    let thumbPos = 0, dragging = false, lastX = 0

    const maxTravel = () => Math.max(24, (track.clientWidth / 2) - 28)
    const setThumb  = (px: number) => {
      thumbPos = Math.max(-maxTravel(), Math.min(maxTravel(), px))
      if (this.rotThumb) this.rotThumb.style.transform = `translateX(${thumbPos}px)`
    }
    const stopSpring = () => cancelAnimationFrame(this._rotSpringRAF)
    const springBack = () => {
      stopSpring()
      const step = () => {
        thumbPos *= 0.72
        if (this.rotThumb) this.rotThumb.style.transform = `translateX(${thumbPos}px)`
        if (Math.abs(thumbPos) > 0.5) this._rotSpringRAF = requestAnimationFrame(step)
        else { thumbPos = 0; if (this.rotThumb) this.rotThumb.style.transform = 'translateX(0)' }
      }
      this._rotSpringRAF = requestAnimationFrame(step)
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
      if (Math.abs(dx) > 0.2) onRotate(dx * SENSITIVITY)
    }
    const onTouchEnd   = () => { dragging = false; springBack() }
    const onMouseDown  = (e: MouseEvent) => { dragging = true; lastX = e.clientX; stopSpring(); e.preventDefault() }
    const onMouseMove  = (e: MouseEvent) => {
      if (!dragging) return
      const dx = e.clientX - lastX; lastX = e.clientX
      setThumb(thumbPos + dx)
      if (Math.abs(dx) > 0.2) onRotate(dx * SENSITIVITY)
    }
    const onMouseUp = () => { dragging = false; springBack() }

    track.addEventListener('touchstart',  onTouchStart as EventListener, {passive: false})
    track.addEventListener('touchmove',   onTouchMove  as EventListener, {passive: false})
    track.addEventListener('touchend',    onTouchEnd,                     {passive: true})
    track.addEventListener('touchcancel', onTouchEnd,                     {passive: true})
    track.addEventListener('mousedown',   onMouseDown  as EventListener)
    window.addEventListener('mousemove',  onMouseMove  as EventListener)
    window.addEventListener('mouseup',    onMouseUp)

    this._rotCleanup = () => {
      track.removeEventListener('touchstart',  onTouchStart as EventListener)
      track.removeEventListener('touchmove',   onTouchMove  as EventListener)
      track.removeEventListener('touchend',    onTouchEnd)
      track.removeEventListener('touchcancel', onTouchEnd)
      track.removeEventListener('mousedown',   onMouseDown  as EventListener)
      window.removeEventListener('mousemove',  onMouseMove  as EventListener)
      window.removeEventListener('mouseup',    onMouseUp)
    }
  }

  hideRotationBar(): void {
    cancelAnimationFrame(this._rotSpringRAF)
    this._rotCleanup?.(); this._rotCleanup = null
    this.rotThumb = null
    if (this.rotTrack) { this.rotTrack.remove(); this.rotTrack = null }
    this._checkHideBar()
  }

  // ── Height track ──────────────────────────────────────────────────────────
  /**
   * Displays a horizontal drag bar whose thumb springs back to centre.
   * Dragging RIGHT raises the model; dragging LEFT lowers it (clamped at floor).
   * `onHeight(delta)` receives a signed world-unit delta to apply to the model Y.
   */
  showHeightBar(onHeight: (delta: number) => void): void {
    const { rowHeight } = this._ensureBottomBar()
    if (this.heightTrack) return

    const track = document.createElement('div')
    track.id = 'ar-height-track'
    track.innerHTML = `
      <div class="ar-track-line"></div>
      <div class="ar-track-chevron ar-track-chevron-left">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2.5"
             stroke-linecap="round" stroke-linejoin="round">
          <polyline points="18 15 12 9 6 15"/>
        </svg>
      </div>
      <div class="ar-track-chevron ar-track-chevron-right">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2.5"
             stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </div>
      <div id="ar-height-thumb" class="ar-track-thumb"></div>
      <span class="ar-track-label">Height</span>`

    rowHeight.appendChild(track)
    this.heightTrack = track
    this.heightThumb = track.querySelector<HTMLElement>('#ar-height-thumb')!
    this._showBottomBar()

    // pixels → world units (tweak to taste)
    const SENSITIVITY = 0.012
    let thumbPos = 0, dragging = false, lastX = 0

    const maxTravel  = () => Math.max(24, (track.clientWidth / 2) - 28)
    const setThumb   = (px: number) => {
      thumbPos = Math.max(-maxTravel(), Math.min(maxTravel(), px))
      if (this.heightThumb) this.heightThumb.style.transform = `translateX(${thumbPos}px)`
    }
    const stopSpring = () => cancelAnimationFrame(this._heightSpringRAF)
    const springBack = () => {
      stopSpring()
      const step = () => {
        thumbPos *= 0.72
        if (this.heightThumb) this.heightThumb.style.transform = `translateX(${thumbPos}px)`
        if (Math.abs(thumbPos) > 0.5) this._heightSpringRAF = requestAnimationFrame(step)
        else { thumbPos = 0; if (this.heightThumb) this.heightThumb.style.transform = 'translateX(0)' }
      }
      this._heightSpringRAF = requestAnimationFrame(step)
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
      // right = positive delta (up), left = negative delta (down)
      if (Math.abs(dx) > 0.2) onHeight(dx * SENSITIVITY)
    }
    const onTouchEnd   = () => { dragging = false; springBack() }
    const onMouseDown  = (e: MouseEvent) => { dragging = true; lastX = e.clientX; stopSpring(); e.preventDefault() }
    const onMouseMove  = (e: MouseEvent) => {
      if (!dragging) return
      const dx = e.clientX - lastX; lastX = e.clientX
      setThumb(thumbPos + dx)
      if (Math.abs(dx) > 0.2) onHeight(dx * SENSITIVITY)
    }
    const onMouseUp = () => { dragging = false; springBack() }

    track.addEventListener('touchstart',  onTouchStart as EventListener, {passive: false})
    track.addEventListener('touchmove',   onTouchMove  as EventListener, {passive: false})
    track.addEventListener('touchend',    onTouchEnd,                     {passive: true})
    track.addEventListener('touchcancel', onTouchEnd,                     {passive: true})
    track.addEventListener('mousedown',   onMouseDown  as EventListener)
    window.addEventListener('mousemove',  onMouseMove  as EventListener)
    window.addEventListener('mouseup',    onMouseUp)

    this._heightCleanup = () => {
      track.removeEventListener('touchstart',  onTouchStart as EventListener)
      track.removeEventListener('touchmove',   onTouchMove  as EventListener)
      track.removeEventListener('touchend',    onTouchEnd)
      track.removeEventListener('touchcancel', onTouchEnd)
      track.removeEventListener('mousedown',   onMouseDown  as EventListener)
      window.removeEventListener('mousemove',  onMouseMove  as EventListener)
      window.removeEventListener('mouseup',    onMouseUp)
    }
  }

  hideHeightBar(): void {
    cancelAnimationFrame(this._heightSpringRAF)
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