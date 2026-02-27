const injectStyles = (() => {
  let done = false
  return () => {
    if (done) return
    done = true
    const s = document.createElement('style')
    s.textContent = `
      #terrain-ar-loader {
        position: fixed; inset: 0;
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        gap: 20px; pointer-events: none;
        z-index: 9999; transition: opacity 0.45s ease;
        background: transparent;
      }
      #terrain-ar-loader.hidden { opacity: 0; }

      .ar-loader-orbit { position: relative; width: 48px; height: 48px; }
      .ar-loader-ring {
        position: absolute; inset: 0; border-radius: 50%;
        border: 1.5px solid rgba(79,195,247,0.18);
      }
      .ar-loader-ball {
        position: absolute; width: 10px; height: 10px;
        border-radius: 50%; background: #4fc3f7;
        box-shadow: 0 0 10px rgba(79,195,247,0.7), 0 0 20px rgba(79,195,247,0.3);
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
        letter-spacing: 0.22em; text-transform: uppercase;
        color: rgba(232,244,255,0.55);
        animation: ar-label-pulse 1.8s ease-in-out infinite;
      }
      @keyframes ar-label-pulse {
        0%, 100% { opacity: 0.55; }
        50%       { opacity: 1; }
      }

      /* ── Reset button ── */
      #ar-reset-btn {
        position: fixed; bottom: 32px; right: 20px; z-index: 9998;
        display: flex; align-items: center; gap: 6px;
        background: rgba(255,255,255,0.88); border: none; border-radius: 22px;
        padding: 10px 16px 10px 12px;
        font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
        font-size: 12px; font-weight: 500; letter-spacing: 0.06em;
        text-transform: uppercase; color: #4ab8d8; cursor: pointer;
        box-shadow: 0 2px 14px rgba(0,0,0,0.18);
        -webkit-tap-highlight-color: transparent;
        transition: background 0.15s, opacity 0.25s;
        opacity: 0; pointer-events: none;
      }
      #ar-reset-btn.ar-reset-visible { opacity: 1; pointer-events: all; }
      #ar-reset-btn:active { background: rgba(235,248,255,0.98); }
      #ar-reset-btn svg { color: #4ab8d8; flex-shrink: 0; }

      /* ── Fullscreen button ── */
      #ar-fullscreen-btn {
        position: fixed; top: 20px; right: 20px; z-index: 9998;
        width: 38px; height: 38px;
        display: flex; align-items: center; justify-content: center;
        background: rgba(255,255,255,0.88); border: none; border-radius: 50%;
        cursor: pointer; box-shadow: 0 2px 14px rgba(0,0,0,0.18);
        -webkit-tap-highlight-color: transparent;
        transition: background 0.15s, opacity 0.25s;
        opacity: 0; pointer-events: none;
        color: #4ab8d8;
      }
      #ar-fullscreen-btn.ar-fs-visible { opacity: 1; pointer-events: all; }
      #ar-fullscreen-btn:active { background: rgba(235,248,255,0.98); }

      /* ── Gesture hint ── */
      #ar-gesture-hint {
        position: fixed; bottom: 90px; left: 50%; transform: translateX(-50%);
        z-index: 9998;
        display: flex; flex-direction: column; align-items: center; gap: 10px;
        pointer-events: none;
        opacity: 0; transition: opacity 0.4s ease;
      }
      #ar-gesture-hint.ar-hint-visible { opacity: 1; }
      #ar-gesture-hint.ar-hint-hidden  { opacity: 0; }

      .ar-hint-row {
        display: flex; align-items: center; gap: 10px;
        background: rgba(0,0,0,0.42); backdrop-filter: blur(8px);
        border-radius: 20px; padding: 8px 14px;
      }
      .ar-hint-icon {
        width: 28px; height: 28px; flex-shrink: 0;
        color: rgba(255,255,255,0.9);
      }
      .ar-hint-text {
        font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
        font-size: 11px; font-weight: 400; letter-spacing: 0.08em;
        color: rgba(255,255,255,0.85); white-space: nowrap;
      }

      /* finger drag animation */
      .ar-hint-finger {
        width: 22px; height: 22px; flex-shrink: 0;
        color: rgba(255,255,255,0.9);
        animation: ar-hint-drag 1.6s ease-in-out infinite;
      }
      @keyframes ar-hint-drag {
        0%,100% { transform: translateX(0);   opacity: 0.5; }
        50%      { transform: translateX(8px); opacity: 1;   }
      }
      .ar-hint-finger-rotate {
        animation: ar-hint-rotate 1.6s ease-in-out infinite;
      }
      @keyframes ar-hint-rotate {
        0%,100% { transform: rotate(-20deg); opacity: 0.5; }
        50%      { transform: rotate( 20deg); opacity: 1;   }
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

function isFullscreen(): boolean {
  const doc = document as any
  return !!(doc.fullscreenElement ?? doc.webkitFullscreenElement ?? doc.mozFullScreenElement)
}

const ICON_EXPAND = `
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" stroke-width="2.2"
       stroke-linecap="round" stroke-linejoin="round">
    <polyline points="15 3 21 3 21 9"/>
    <polyline points="9 21 3 21 3 15"/>
    <line x1="21" y1="3" x2="14" y2="10"/>
    <line x1="3"  y1="21" x2="10" y2="14"/>
  </svg>`

const ICON_COMPRESS = `
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
       stroke="currentColor" stroke-width="2.2"
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
  private _t1 = 0
  private _t2 = 0
  private _hintTimer   = 0
  private _fsListener: (() => void) | null = null

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
      <span class="ar-loader-label" id="ar-loader-text">Iniciando cámara</span>
    `
    document.body.appendChild(this.loader)

    this._t1 = window.setTimeout(() => {
      const el = document.getElementById('ar-loader-text')
      if (el) el.textContent = 'Detectando entorno'
    }, 4000)
    this._t2 = window.setTimeout(() => {
      const el = document.getElementById('ar-loader-text')
      if (el) el.textContent = 'Preparando experiencia'
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
      <span class="ar-loader-label" id="ar-loader-text">Detectando entorno</span>
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
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2.2"
           stroke-linecap="round" stroke-linejoin="round">
        <polyline points="1 4 1 10 7 10"/>
        <path d="M3.51 15a9 9 0 1 0 .49-5"/>
      </svg>
      Reiniciar
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
    btn.setAttribute('aria-label', 'Pantalla completa')
    btn.innerHTML = ICON_EXPAND
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

    // Update icon when fullscreen state changes externally (back button, etc.)
    this._fsListener = () => {
      if (this.fsBtn) this.fsBtn.innerHTML = isFullscreen() ? ICON_COMPRESS : ICON_EXPAND
    }
    document.addEventListener('fullscreenchange',       this._fsListener)
    document.addEventListener('webkitfullscreenchange', this._fsListener)
  }

  hideFullscreenButton(): void {
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
    if (isFullscreen()) exitFullscreen()
  }

  // ── Gesture hint ──────────────────────────────────────────────────────────
  // Shows two rows: pan/zoom hint and rotation hint.
  // Fades in immediately, fades out after 5 s automatically.

  showGestureHint(): void {
    injectStyles()
    if (this.gestureHint) return

    const div = document.createElement('div')
    div.id = 'ar-gesture-hint'
    div.innerHTML = `
      <div class="ar-hint-row">
        <!-- two-finger pinch icon -->
        <svg class="ar-hint-icon" viewBox="0 0 32 32" fill="none"
             stroke="currentColor" stroke-width="1.8"
             stroke-linecap="round" stroke-linejoin="round">
          <circle cx="10" cy="10" r="3"/>
          <circle cx="22" cy="22" r="3"/>
          <line x1="10" y1="13" x2="10" y2="24"/>
          <line x1="22" y1="9"  x2="22" y2="19"/>
        </svg>
        <span class="ar-hint-text">Pellizca para escalar</span>
      </div>
      <div class="ar-hint-row">
        <!-- single finger drag icon -->
        <svg class="ar-hint-finger ar-hint-finger-rotate" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="1.8"
             stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <line x1="12" y1="22" x2="12" y2="22.01"/>
        </svg>
        <span class="ar-hint-text">Arrastra fuera del mapa para rotar</span>
      </div>
      <div class="ar-hint-row">
        <svg class="ar-hint-finger" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="1.8"
             stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 11V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2v0"/>
          <path d="M14 10V4a2 2 0 0 0-2-2 2 2 0 0 0-2 2v2"/>
          <path d="M10 10.5V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2v8"/>
          <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>
        </svg>
        <span class="ar-hint-text">Arrastra sobre el mapa para mover</span>
      </div>
    `
    document.body.appendChild(div)
    this.gestureHint = div

    requestAnimationFrame(() => div.classList.add('ar-hint-visible'))

    // Auto-hide after 5 s
    this._hintTimer = window.setTimeout(() => this.hideGestureHint(), 5000)

    // Also hide on first touch (user understood)
    const onTouch = () => {
      this.hideGestureHint()
      window.removeEventListener('touchstart', onTouch)
    }
    window.addEventListener('touchstart', onTouch, { passive: true, once: true })
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