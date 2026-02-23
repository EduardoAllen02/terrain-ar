/**
 * ArUiOverlay — v3
 * DOM overlay for AR placement states + loading spinner.
 * Palette: dark navy #080a1c, accent blue #4fc3f7, soft white #e8f4ff
 */

// ─── Shared style injection ───────────────────────────────────────────────────

const injectStyles = (() => {
  let done = false
  return () => {
    if (done) return
    done = true
    const s = document.createElement('style')
    s.textContent = `
      /* ── Loading spinner ─────────────────────────────── */
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
        transition: opacity 0.4s ease;
      }
      #terrain-ar-loader.hidden {
        opacity: 0;
      }
      .ar-loader-orbit {
        position: relative;
        width: 48px;
        height: 48px;
      }
      /* Outer ring */
      .ar-loader-ring {
        position: absolute;
        inset: 0;
        border-radius: 50%;
        border: 1.5px solid rgba(79, 195, 247, 0.18);
      }
      /* Rolling ball */
      .ar-loader-ball {
        position: absolute;
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: #4fc3f7;
        box-shadow: 0 0 10px rgba(79,195,247,0.7), 0 0 20px rgba(79,195,247,0.3);
        top: -5px;
        left: 50%;
        transform: translateX(-50%);
        transform-origin: 50% 29px; /* radius = 24px, offset center */
        animation: ar-ball-orbit 1.1s cubic-bezier(0.45, 0.05, 0.55, 0.95) infinite;
      }
      @keyframes ar-ball-orbit {
        from { transform: translateX(-50%) rotate(0deg);   }
        to   { transform: translateX(-50%) rotate(360deg); }
      }
      /* Label below spinner */
      .ar-loader-label {
        font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
        font-size: 11px;
        font-weight: 300;
        letter-spacing: 0.22em;
        text-transform: uppercase;
        color: rgba(232, 244, 255, 0.55);
        animation: ar-label-pulse 1.8s ease-in-out infinite;
      }
      @keyframes ar-label-pulse {
        0%, 100% { opacity: 0.55; }
        50%       { opacity: 1;    }
      }

      /* ── Status pill ─────────────────────────────────── */
      #terrain-ar-status {
        position: fixed;
        bottom: 100px;
        left: 50%;
        transform: translateX(-50%) translateY(10px);
        opacity: 0;
        display: flex;
        align-items: center;
        gap: 10px;
        background: rgba(8, 10, 28, 0.78);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(79, 195, 247, 0.30);
        border-radius: 100px;
        padding: 10px 22px 10px 16px;
        color: #e8f4ff;
        font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
        font-size: 12px;
        font-weight: 300;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        pointer-events: none;
        z-index: 9998;
        white-space: nowrap;
        transition: opacity 0.35s cubic-bezier(0.4,0,0.2,1),
                    transform 0.35s cubic-bezier(0.4,0,0.2,1);
        will-change: opacity, transform;
      }
      #terrain-ar-status.visible {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
      .ar-status-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        flex-shrink: 0;
        background: #4fc3f7;
        animation: ar-dot-pulse 1.6s ease-in-out infinite;
      }
      @keyframes ar-dot-pulse {
        0%, 100% { opacity: 1;   transform: scale(1);    }
        50%       { opacity: 0.4; transform: scale(0.72); }
      }
    `
    document.head.appendChild(s)
  }
})()

// ─── Types ────────────────────────────────────────────────────────────────────

export type ArUiState = 'scanning' | 'ground-found' | 'placed'

const STATE_MESSAGES: Record<ArUiState, string> = {
  scanning:       'Apunta al piso',
  'ground-found': 'Toca para colocar',
  placed:         'Mapa colocado',
}

const STATE_DOT_COLORS: Record<ArUiState, string> = {
  scanning:       '#4fc3f7',
  'ground-found': '#69f0ae',
  placed:         '#69f0ae',
}

// ─── Class ────────────────────────────────────────────────────────────────────

export class ArUiOverlay {
  private loader: HTMLElement | null = null
  private status: HTMLElement | null = null
  private statusDot: HTMLElement | null = null
  private statusText: HTMLElement | null = null

  // ── Loader ──────────────────────────────────────────────────────────────────

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
      <span class="ar-loader-label">Cargando</span>
    `
    document.body.appendChild(this.loader)
  }

  hideLoader(): void {
    if (!this.loader) return
    const el = this.loader
    this.loader = null
    el.classList.add('hidden')
    setTimeout(() => el.remove(), 450)
  }

  // ── Status pill ─────────────────────────────────────────────────────────────

  showStatus(): void {
    injectStyles()
    if (this.status) return

    this.status = document.createElement('div')
    this.status.id = 'terrain-ar-status'

    this.statusDot = document.createElement('span')
    this.statusDot.className = 'ar-status-dot'

    this.statusText = document.createElement('span')
    this.statusText.textContent = STATE_MESSAGES.scanning

    this.status.appendChild(this.statusDot)
    this.status.appendChild(this.statusText)
    document.body.appendChild(this.status)

    requestAnimationFrame(() => {
      requestAnimationFrame(() => this.status?.classList.add('visible'))
    })
  }

  setState(state: ArUiState): void {
    if (this.statusText) this.statusText.textContent = STATE_MESSAGES[state]
    if (this.statusDot)  this.statusDot.style.background = STATE_DOT_COLORS[state]
  }

  hideStatus(delayMs = 600): void {
    if (!this.status) return
    const el = this.status
    this.status = null
    setTimeout(() => {
      el.classList.remove('visible')
      setTimeout(() => el.remove(), 380)
    }, delayMs)
  }

  /** Convenience: show status pill (kept for backward compat) */
  show(): void { this.showStatus() }
  hide(delayMs = 600): void { this.hideStatus(delayMs) }
}