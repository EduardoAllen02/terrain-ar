/**
 * ArUiOverlay
 * Manages the DOM overlay shown during AR placement.
 * Matches the dark-navy + light-blue palette of the turismofvg.it site.
 */

const OVERLAY_ID = 'terrain-ar-ui'

const BASE_STYLES = `
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
  border: 1px solid rgba(79, 195, 247, 0.35);
  border-radius: 100px;
  padding: 10px 22px 10px 16px;
  color: #e8f4ff;
  font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
  font-size: 13px;
  font-weight: 300;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  pointer-events: none;
  z-index: 9999;
  white-space: nowrap;
  transition: opacity 0.35s cubic-bezier(0.4, 0, 0.2, 1),
              transform 0.35s cubic-bezier(0.4, 0, 0.2, 1);
  will-change: opacity, transform;
`

// Dot indicator styles (pulsing dot on the left)
const DOT_STYLES = `
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #4fc3f7;
  flex-shrink: 0;
  animation: ar-pulse 1.6s ease-in-out infinite;
`

// Inject keyframes once
const injectKeyframes = (() => {
  let injected = false
  return () => {
    if (injected) return
    injected = true
    const style = document.createElement('style')
    style.textContent = `
      @keyframes ar-pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50%       { opacity: 0.4; transform: scale(0.75); }
      }
    `
    document.head.appendChild(style)
  }
})()

export type ArUiState = 'scanning' | 'ground-found' | 'placed'

export class ArUiOverlay {
  private container: HTMLElement | null = null
  private dotEl: HTMLElement | null = null
  private textEl: HTMLElement | null = null

  private static readonly MESSAGES: Record<ArUiState, string> = {
    scanning:     'Apunta al piso',
    'ground-found': 'Toca para colocar',
    placed:       'Mapa colocado',
  }

  show(): void {
    injectKeyframes()
    if (this.container) return

    this.container = document.createElement('div')
    this.container.id = OVERLAY_ID
    this.container.style.cssText = BASE_STYLES

    this.dotEl = document.createElement('span')
    this.dotEl.style.cssText = DOT_STYLES

    this.textEl = document.createElement('span')
    this.textEl.textContent = ArUiOverlay.MESSAGES.scanning

    this.container.appendChild(this.dotEl)
    this.container.appendChild(this.textEl)
    document.body.appendChild(this.container)

    // Trigger entrance animation
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (this.container) {
          this.container.style.opacity = '1'
          this.container.style.transform = 'translateX(-50%) translateY(0)'
        }
      })
    })
  }

  setState(state: ArUiState): void {
    if (!this.textEl) return
    this.textEl.textContent = ArUiOverlay.MESSAGES[state]

    if (this.dotEl) {
      // Change dot color: blue scanning, green found, fade on placed
      const colors: Record<ArUiState, string> = {
        scanning: '#4fc3f7',
        'ground-found': '#69f0ae',
        placed: '#69f0ae',
      }
      this.dotEl.style.background = colors[state]
    }
  }

  /** Hides and removes the overlay element. */
  hide(delayMs = 600): void {
    if (!this.container) return
    const el = this.container
    this.container = null
    this.dotEl = null
    this.textEl = null

    setTimeout(() => {
      el.style.opacity = '0'
      el.style.transform = 'translateX(-50%) translateY(10px)'
      setTimeout(() => el.remove(), 380)
    }, delayMs)
  }
}