/**
 * ArUiOverlay — v4 (Option C)
 * Simplified: only shows the loading spinner with phase messages.
 * No placement status pill needed — model auto-places.
 */

const injectStyles = (() => {
  let done = false
  return () => {
    if (done) return
    done = true
    const s = document.createElement('style')
    s.textContent = `
      #terrain-ar-loader {
        position: fixed;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 20px;
        pointer-events: none;
        z-index: 9999;
        transition: opacity 0.45s ease;
      }
      #terrain-ar-loader.hidden { opacity: 0; }

      .ar-loader-orbit {
        position: relative;
        width: 48px;
        height: 48px;
      }
      .ar-loader-ring {
        position: absolute;
        inset: 0;
        border-radius: 50%;
        border: 1.5px solid rgba(79,195,247,0.18);
      }
      .ar-loader-ball {
        position: absolute;
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: #4fc3f7;
        box-shadow: 0 0 10px rgba(79,195,247,0.7), 0 0 20px rgba(79,195,247,0.3);
        top: -5px;
        left: 50%;
        transform-origin: 50% 29px;
        animation: ar-ball-orbit 1.1s cubic-bezier(0.45,0.05,0.55,0.95) infinite;
      }
      @keyframes ar-ball-orbit {
        from { transform: translateX(-50%) rotate(0deg); }
        to   { transform: translateX(-50%) rotate(360deg); }
      }
      .ar-loader-label {
        font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
        font-size: 11px;
        font-weight: 300;
        letter-spacing: 0.22em;
        text-transform: uppercase;
        color: rgba(232,244,255,0.55);
        animation: ar-label-pulse 1.8s ease-in-out infinite;
      }
      @keyframes ar-label-pulse {
        0%, 100% { opacity: 0.55; }
        50%       { opacity: 1; }
      }
    `
    document.head.appendChild(s)
  }
})()

export class ArUiOverlay {
  private loader: HTMLElement | null = null
  private _t1 = 0
  private _t2 = 0

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

  hideLoader(): void {
    window.clearTimeout(this._t1)
    window.clearTimeout(this._t2)
    if (!this.loader) return
    const el = this.loader
    this.loader = null
    el.classList.add('hidden')
    setTimeout(() => el.remove(), 480)
  }
}