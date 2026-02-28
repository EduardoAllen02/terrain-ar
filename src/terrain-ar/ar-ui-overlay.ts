const injectStyles = (() => {
  let done = false
  return () => {
    if (done) return
    done = true
    const s = document.createElement('style')
    s.textContent = `
      /* ─────────────────────────────────────────────────────────
         SHARED TOKENS
      ───────────────────────────────────────────────────────── */
      :root {
        --ar-accent:        #4ab8d8;
        --ar-accent-glow:   rgba(74,184,216,0.55);
        --ar-accent-soft:   rgba(74,184,216,0.18);
        --ar-surface:       rgba(255,255,255,0.90);
        --ar-surface-hover: rgba(235,250,255,0.98);
        --ar-overlay:       rgba(0,0,0,0.44);
        --ar-text-dim:      rgba(255,255,255,0.70);
        --ar-text-label:    rgba(255,255,255,0.55);
        --ar-radius-pill:   24px;
        --ar-radius-circle: 50%;
        --ar-shadow:        0 2px 16px rgba(0,0,0,0.20);
        --ar-transition:    0.25s ease;
      }

      /* ─────────────────────────────────────────────────────────
         LOADER
      ───────────────────────────────────────────────────────── */
      #terrain-ar-loader {
        position: fixed; inset: 0;
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        gap: 18px; pointer-events: none;
        z-index: 9999; transition: opacity 0.45s ease;
        background: transparent;
      }
      #terrain-ar-loader.hidden { opacity: 0; }

      .ar-loader-orbit { position: relative; width: 48px; height: 48px; }
      .ar-loader-ring {
        position: absolute; inset: 0; border-radius: 50%;
        border: 1.5px solid var(--ar-accent-soft);
      }
      .ar-loader-ball {
        position: absolute; width: 10px; height: 10px;
        border-radius: 50%; background: var(--ar-accent);
        box-shadow: 0 0 10px var(--ar-accent-glow), 0 0 22px rgba(74,184,216,0.25);
        top: -5px; left: 50%; transform-origin: 50% 29px;
        animation: ar-ball-orbit 1.1s cubic-bezier(0.45,0.05,0.55,0.95) infinite;
      }
      @keyframes ar-ball-orbit {
        from { transform: translateX(-50%) rotate(0deg); }
        to   { transform: translateX(-50%) rotate(360deg); }
      }
      .ar-loader-label {
        font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
        font-size: 11px; font-weight: 300;
        letter-spacing: 0.24em; text-transform: uppercase;
        color: var(--ar-text-label);
        animation: ar-label-pulse 1.8s ease-in-out infinite;
      }
      @keyframes ar-label-pulse {
        0%, 100% { opacity: 0.55; }
        50%       { opacity: 1; }
      }

      /* ─────────────────────────────────────────────────────────
         RESET BUTTON  (bottom-right)
      ───────────────────────────────────────────────────────── */
      #ar-reset-btn {
        position: fixed; bottom: 28px; right: 20px; z-index: 9998;
        display: flex; align-items: center; gap: 7px;
        background: var(--ar-surface); border: none;
        border-radius: var(--ar-radius-pill);
        padding: 11px 18px 11px 14px;
        font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
        font-size: 11px; font-weight: 600; letter-spacing: 0.10em;
        text-transform: uppercase; color: var(--ar-accent); cursor: pointer;
        box-shadow: var(--ar-shadow);
        -webkit-tap-highlight-color: transparent;
        transition: background var(--ar-transition), opacity var(--ar-transition);
        opacity: 0; pointer-events: none;
      }
      #ar-reset-btn.ar-reset-visible { opacity: 1; pointer-events: all; }
      #ar-reset-btn:active { background: var(--ar-surface-hover); }
      #ar-reset-btn svg { color: var(--ar-accent); flex-shrink: 0; }

      /* ─────────────────────────────────────────────────────────
         FULLSCREEN BUTTON  (top-right)
      ───────────────────────────────────────────────────────── */
      #ar-fullscreen-btn {
        position: fixed; top: 20px; right: 20px; z-index: 9998;
        width: 40px; height: 40px;
        display: flex; align-items: center; justify-content: center;
        background: var(--ar-surface); border: none;
        border-radius: var(--ar-radius-circle);
        cursor: pointer; box-shadow: var(--ar-shadow);
        -webkit-tap-highlight-color: transparent;
        transition: background var(--ar-transition), opacity var(--ar-transition);
        opacity: 0; pointer-events: none;
        color: var(--ar-accent);
      }
      #ar-fullscreen-btn.ar-fs-visible { opacity: 1; pointer-events: all; }
      #ar-fullscreen-btn:active { background: var(--ar-surface-hover); }

      /* ─────────────────────────────────────────────────────────
         ROTATION BAR  (bottom-center, above reset)
      ───────────────────────────────────────────────────────── */
      #ar-rotation-bar {
        position: fixed; bottom: 88px; left: 50%;
        transform: translateX(-50%);
        z-index: 9998;
        display: flex; flex-direction: column;
        align-items: center; gap: 7px;
        opacity: 0; transition: opacity var(--ar-transition);
        pointer-events: none;
      }
      #ar-rotation-bar.ar-rot-visible {
        opacity: 1; pointer-events: all;
      }

      .ar-rot-track {
        position: relative;
        width: 240px; height: 48px;
        background: var(--ar-surface);
        border-radius: var(--ar-radius-pill);
        display: flex; align-items: center; justify-content: center;
        box-shadow: var(--ar-shadow);
        cursor: ew-resize;
        overflow: visible;
        -webkit-tap-highlight-color: transparent;
        touch-action: none;
        user-select: none;
      }

      /* track line */
      .ar-rot-line {
        position: absolute;
        left: 52px; right: 52px; height: 2px;
        background: linear-gradient(90deg,
          transparent 0%,
          var(--ar-accent-soft) 20%,
          rgba(74,184,216,0.35) 50%,
          var(--ar-accent-soft) 80%,
          transparent 100%);
        border-radius: 1px;
        pointer-events: none;
      }

      /* chevron arrows */
      .ar-rot-chevron {
        position: absolute;
        top: 50%; transform: translateY(-50%);
        display: flex; align-items: center;
        color: rgba(74,184,216,0.45);
        pointer-events: none;
      }
      .ar-rot-chevron-left  { left: 14px; }
      .ar-rot-chevron-right { right: 14px; }

      /* draggable thumb */
      #ar-rot-thumb {
        position: relative; z-index: 1;
        width: 32px; height: 32px; border-radius: 50%;
        background: var(--ar-accent);
        box-shadow: 0 2px 10px var(--ar-accent-glow);
        flex-shrink: 0;
        will-change: transform;
        pointer-events: none; /* track handles events */
      }

      .ar-rot-label {
        font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
        font-size: 9px; font-weight: 600;
        letter-spacing: 0.22em; text-transform: uppercase;
        color: var(--ar-text-label);
      }

      /* ─────────────────────────────────────────────────────────
         GESTURE HINT  (bottom-center, above rotation bar)
      ───────────────────────────────────────────────────────── */
      #ar-gesture-hint {
        position: fixed; bottom: 176px; left: 50%;
        transform: translateX(-50%);
        z-index: 9998;
        display: flex; flex-direction: column; align-items: center; gap: 8px;
        pointer-events: none;
        opacity: 0; transition: opacity 0.4s ease;
      }
      #ar-gesture-hint.ar-hint-visible { opacity: 1; }
      #ar-gesture-hint.ar-hint-hidden  { opacity: 0; }

      .ar-hint-row {
        display: flex; align-items: center; gap: 10px;
        background: var(--ar-overlay); backdrop-filter: blur(10px);
        border-radius: var(--ar-radius-pill); padding: 9px 16px;
      }
      .ar-hint-icon {
        width: 26px; height: 26px; flex-shrink: 0;
        color: rgba(255,255,255,0.88);
      }
      .ar-hint-text {
        font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
        font-size: 11px; font-weight: 400; letter-spacing: 0.08em;
        color: rgba(255,255,255,0.85); white-space: nowrap;
      }

      /* pinch icon animation */
      .ar-hint-icon-pinch { animation: ar-hint-pinch 1.8s ease-in-out infinite; }
      @keyframes ar-hint-pinch {
        0%,100% { transform: scale(1);    opacity: 0.6; }
        50%      { transform: scale(0.82); opacity: 1;   }
      }

      /* drag icon animation */
      .ar-hint-icon-drag { animation: ar-hint-drag 1.6s ease-in-out infinite; }
      @keyframes ar-hint-drag {
        0%,100% { transform: translateX(0);   opacity: 0.5; }
        50%      { transform: translateX(7px); opacity: 1;   }
      }
    `
    document.head.appendChild(s)
  }
})()

// ── Fullscreen helpers ────────────────────────────────────────────────────────

function enterFullscreen(): void {
  const el = document.documentElement as any
  const fn = el.requestFullscreen ?? el.webkitRequestFullscreen ?? el.mozRequestFullScreen
  fn?.call(el)
}

function exitFullscreen(): void {
  const doc = document as any
  const fn  = doc.exitFullscreen ?? doc.webkitExitFullscreen ?? doc.mozCancelFullScreen
  fn?.call(doc)
}

export function isFullscreen(): boolean {
  const doc = document as any
  return !!(doc.fullscreenElement ?? doc.webkitFullscreenElement ?? doc.mozFullScreenElement)
}

const ICON_EXPAND = `
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" stroke-width="2.4"
       stroke-linecap="round" stroke-linejoin="round">
    <polyline points="15 3 21 3 21 9"/>
    <polyline points="9 21 3 21 3 15"/>
    <line x1="21" y1="3" x2="14" y2="10"/>
    <line x1="3"  y1="21" x2="10" y2="14"/>
  </svg>`

const ICON_COMPRESS = `
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" stroke-width="2.4"
       stroke-linecap="round" stroke-linejoin="round">
    <polyline points="4 14 10 14 10 20"/>
    <polyline points="20 10 14 10 14 4"/>
    <line x1="10" y1="14" x2="3"  y2="21"/>
    <line x1="21" y1="3"  x2="14" y2="10"/>
  </svg>`

// ─────────────────────────────────────────────────────────────────────────────

export class ArUiOverlay {
  private loader:      HTMLElement | null = null
  private resetBtn:    HTMLElement | null = null
  private fsBtn:       HTMLElement | null = null
  private gestureHint: HTMLElement | null = null
  private rotBar:      HTMLElement | null = null
  private rotThumb:    HTMLElement | null = null

  private _t1 = 0
  private _t2 = 0
  private _hintTimer    = 0
  private _fsListener:  (() => void) | null = null
  private _rotSpringRAF = 0
  private _rotCleanup:  (() => void) | null = null

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
      <span class="ar-loader-label" id="ar-loader-text">Starting camera</span>
    `
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
      <span class="ar-loader-label" id="ar-loader-text">Detecting environment</span>
    `
    document.body.appendChild(this.loader)
  }

  hideLoader(): void {
    window.clearTimeout(this._t1)
    window.clearTimeout(this._t2)
    if (!this.loader) return
    const el = this.loader
    this.loader = null
    el.classList.add('hidden')
    setTimeout(() => el.remove(), 480)
  }

  // ── Reset button ──────────────────────────────────────────────────────────

  showResetButton(onReset: () => void): void {
    injectStyles()
    if (this.resetBtn) return

    const btn = document.createElement('button')
    btn.id = 'ar-reset-btn'
    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2.4"
           stroke-linecap="round" stroke-linejoin="round">
        <polyline points="1 4 1 10 7 10"/>
        <path d="M3.51 15a9 9 0 1 0 .49-5"/>
      </svg>
      Reset
    `
    document.body.appendChild(btn)
    this.resetBtn = btn

    requestAnimationFrame(() => btn.classList.add('ar-reset-visible'))
    btn.addEventListener('click', () => {
      this.hideResetButton()
      onReset()
    })
  }

  hideResetButton(): void {
    if (!this.resetBtn) return
    const el = this.resetBtn
    this.resetBtn = null
    el.classList.remove('ar-reset-visible')
    setTimeout(() => el.remove(), 280)
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

    btn.addEventListener('click', () => {
      if (isFullscreen()) {
        exitFullscreen()
      } else {
        enterFullscreen()
      }
    })

    this._fsListener = () => {
      if (this.fsBtn) this.fsBtn.innerHTML = isFullscreen() ? ICON_COMPRESS : ICON_EXPAND
    }
    document.addEventListener('fullscreenchange',       this._fsListener)
    document.addEventListener('webkitfullscreenchange', this._fsListener)
  }

  /**
   * @param keepFullscreen  If true, does NOT call exitFullscreen() — use when
   *                        transitioning to 360 viewer while staying fullscreen.
   */
  hideFullscreenButton(keepFullscreen = false): void {
    if (this.fsBtn) {
      const el = this.fsBtn
      this.fsBtn = null
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

  // ── Rotation bar ──────────────────────────────────────────────────────────
  /**
   * Shows the horizontal drag-to-rotate bar.
   * `onRotate` receives a signed angle delta in radians each drag event.
   */
  showRotationBar(onRotate: (deltaRad: number) => void): void {
    injectStyles()
    if (this.rotBar) return

    const bar = document.createElement('div')
    bar.id = 'ar-rotation-bar'
    bar.innerHTML = `
      <div class="ar-rot-track" id="ar-rot-track">
        <div class="ar-rot-line"></div>
        <div class="ar-rot-chevron ar-rot-chevron-left">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2.4"
               stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </div>
        <div class="ar-rot-chevron ar-rot-chevron-right">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2.4"
               stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </div>
        <div id="ar-rot-thumb"></div>
      </div>
      <span class="ar-rot-label">Rotate</span>
    `
    document.body.appendChild(bar)
    this.rotBar   = bar
    this.rotThumb = bar.querySelector('#ar-rot-thumb')

    requestAnimationFrame(() => bar.classList.add('ar-rot-visible'))

    // ── Drag logic ──────────────────────────────────────────────────────────
    const MAX_TRAVEL      = 88    // px from center
    const SENSITIVITY     = 0.011 // radians per pixel
    let thumbPos          = 0
    let isDragging        = false
    let lastX             = 0

    const setThumb = (px: number) => {
      thumbPos = Math.max(-MAX_TRAVEL, Math.min(MAX_TRAVEL, px))
      if (this.rotThumb) this.rotThumb.style.transform = `translateX(${thumbPos}px)`
    }

    const cancelSpring = () => cancelAnimationFrame(this._rotSpringRAF)

    const springBack = () => {
      cancelSpring()
      const animate = () => {
        thumbPos *= 0.72
        if (this.rotThumb) this.rotThumb.style.transform = `translateX(${thumbPos}px)`
        if (Math.abs(thumbPos) > 0.6) {
          this._rotSpringRAF = requestAnimationFrame(animate)
        } else {
          thumbPos = 0
          if (this.rotThumb) this.rotThumb.style.transform = 'translateX(0)'
        }
      }
      this._rotSpringRAF = requestAnimationFrame(animate)
    }

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      e.stopPropagation()
      isDragging = true
      lastX = e.touches[0].clientX
      cancelSpring()
    }

    const onTouchMove = (e: TouchEvent) => {
      if (!isDragging || e.touches.length !== 1) return
      e.preventDefault()
      e.stopPropagation()
      const dx = e.touches[0].clientX - lastX
      lastX = e.touches[0].clientX
      setThumb(thumbPos + dx)
      if (Math.abs(dx) > 0.2) onRotate(dx * SENSITIVITY)
    }

    const onTouchEnd = () => {
      isDragging = false
      springBack()
    }

    // Also support mouse for desktop testing
    const onMouseDown = (e: MouseEvent) => {
      isDragging = true
      lastX = e.clientX
      cancelSpring()
      e.preventDefault()
    }
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return
      const dx = e.clientX - lastX
      lastX = e.clientX
      setThumb(thumbPos + dx)
      if (Math.abs(dx) > 0.2) onRotate(dx * SENSITIVITY)
    }
    const onMouseUp = () => {
      isDragging = false
      springBack()
    }

    const track = bar.querySelector('#ar-rot-track') as HTMLElement
    track.addEventListener('touchstart',  onTouchStart  as EventListener, {passive: false})
    track.addEventListener('touchmove',   onTouchMove   as EventListener, {passive: false})
    track.addEventListener('touchend',    onTouchEnd,                      {passive: true})
    track.addEventListener('touchcancel', onTouchEnd,                      {passive: true})
    track.addEventListener('mousedown',   onMouseDown   as EventListener)
    window.addEventListener('mousemove',  onMouseMove   as EventListener)
    window.addEventListener('mouseup',    onMouseUp)

    this._rotCleanup = () => {
      track.removeEventListener('touchstart',  onTouchStart  as EventListener)
      track.removeEventListener('touchmove',   onTouchMove   as EventListener)
      track.removeEventListener('touchend',    onTouchEnd)
      track.removeEventListener('touchcancel', onTouchEnd)
      track.removeEventListener('mousedown',   onMouseDown   as EventListener)
      window.removeEventListener('mousemove',  onMouseMove   as EventListener)
      window.removeEventListener('mouseup',    onMouseUp)
    }
  }

  hideRotationBar(): void {
    cancelAnimationFrame(this._rotSpringRAF)
    this._rotCleanup?.()
    this._rotCleanup = null
    this.rotThumb = null

    if (!this.rotBar) return
    const el = this.rotBar
    this.rotBar = null
    el.classList.remove('ar-rot-visible')
    setTimeout(() => el.remove(), 300)
  }

  // ── Gesture hint ──────────────────────────────────────────────────────────
  // Two hints: pinch to zoom, drag to move.
  // Rotation hint removed — handled by the rotation bar.

  showGestureHint(): void {
    injectStyles()
    if (this.gestureHint) return

    const div = document.createElement('div')
    div.id = 'ar-gesture-hint'
    div.innerHTML = `
      <!-- Pinch to zoom -->
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
      <!-- Drag to move -->
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
      </div>
    `
    document.body.appendChild(div)
    this.gestureHint = div

    requestAnimationFrame(() => div.classList.add('ar-hint-visible'))

    this._hintTimer = window.setTimeout(() => this.hideGestureHint(), 5000)

    const onTouch = () => this.hideGestureHint()
    window.addEventListener('touchstart', onTouch, {passive: true, once: true})
  }

  hideGestureHint(): void {
    window.clearTimeout(this._hintTimer)
    if (!this.gestureHint) return
    const el = this.gestureHint
    this.gestureHint = null
    el.classList.remove('ar-hint-visible')
    el.classList.add('ar-hint-hidden')
    setTimeout(() => el.remove(), 450)
  }
}