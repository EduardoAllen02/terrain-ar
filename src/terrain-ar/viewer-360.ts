import {ExperienceRegistry} from './experience-registry'

const IMAGES_PATH = 'assets/360/'
const IMAGE_EXT   = '.jpg'

// ── Styles ────────────────────────────────────────────────────────────────────

const injectStyles = (() => {
  let done = false
  return () => {
    if (done) return
    done = true
    const s = document.createElement('style')
    s.textContent = `
      #v360-overlay {
        position: fixed;
        inset: 0;
        z-index: 99999;
        background: #000;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: opacity 0.35s ease;
      }
      #v360-overlay.v360-visible { opacity: 1; }

      #v360-canvas {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
      }

      /* ── Top bar ── */
      #v360-topbar {
        position: absolute;
        top: 0; left: 0; right: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 18px 16px 0;
        pointer-events: none;
        z-index: 2;
      }

      #v360-back {
        position: absolute;
        left: 16px;
        display: flex;
        align-items: center;
        gap: 6px;
        background: rgba(255,255,255,0.92);
        border: none;
        border-radius: 22px;
        padding: 8px 16px 8px 10px;
        font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
        font-size: 13px;
        font-weight: 500;
        color: #4ab8d8;
        letter-spacing: 0.04em;
        cursor: pointer;
        pointer-events: all;
        box-shadow: 0 2px 12px rgba(0,0,0,0.18);
        -webkit-tap-highlight-color: transparent;
        transition: background 0.15s;
      }
      #v360-back:active { background: rgba(235,248,255,0.98); }

      #v360-back svg { flex-shrink: 0; }

      #v360-title {
        background: rgba(255,255,255,0.92);
        border-radius: 18px;
        padding: 7px 18px;
        font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
        font-size: 13px;
        font-weight: 500;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: #4ab8d8;
        box-shadow: 0 2px 12px rgba(0,0,0,0.18);
        max-width: 50vw;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      /* ── Nav arrows ── */
      .v360-nav {
        position: absolute;
        top: 50%;
        transform: translateY(-50%);
        z-index: 2;
        background: rgba(255,255,255,0.92);
        border: none;
        border-radius: 50%;
        width: 48px;
        height: 48px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        box-shadow: 0 2px 12px rgba(0,0,0,0.22);
        -webkit-tap-highlight-color: transparent;
        transition: background 0.15s, transform 0.15s;
      }
      .v360-nav:active {
        background: rgba(235,248,255,0.98);
        transform: translateY(-50%) scale(0.93);
      }
      #v360-prev { left: 14px; }
      #v360-next { right: 14px; }
      .v360-nav svg { color: #4ab8d8; }

      /* ── Counter ── */
      #v360-counter {
        position: absolute;
        bottom: 28px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        gap: 6px;
        z-index: 2;
      }
      .v360-dot {
        width: 6px; height: 6px;
        border-radius: 50%;
        background: rgba(255,255,255,0.35);
        transition: background 0.2s;
      }
      .v360-dot.active { background: rgba(255,255,255,0.95); }

      /* ── Gyro hint ── */
      #v360-hint {
        position: absolute;
        bottom: 52px;
        left: 50%;
        transform: translateX(-50%);
        font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
        font-size: 10px;
        font-weight: 300;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: rgba(255,255,255,0.45);
        white-space: nowrap;
        pointer-events: none;
        z-index: 2;
        transition: opacity 0.5s;
      }
      #v360-hint.hidden { opacity: 0; }

      /* ── Loading spinner inside 360 ── */
      #v360-loading {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0,0,0,0.55);
        z-index: 3;
        transition: opacity 0.3s;
      }
      #v360-loading.hidden { opacity: 0; pointer-events: none; }
      .v360-spinner {
        width: 32px; height: 32px;
        border: 2px solid rgba(74,184,216,0.25);
        border-top-color: #4ab8d8;
        border-radius: 50%;
        animation: v360-spin 0.8s linear infinite;
      }
      @keyframes v360-spin { to { transform: rotate(360deg); } }
    `
    document.head.appendChild(s)
  }
})()

// ── Viewer360 ─────────────────────────────────────────────────────────────────

export class Viewer360 {
  private overlay:   HTMLElement | null = null
  private renderer:  any = null
  private scene:     any = null
  private camera:    any = null
  private sphere:    any = null
  private texLoader: any = null
  private rafId      = 0

  // Gyro state
  private _gyroHandler: ((e: DeviceOrientationEvent) => void) | null = null
  private _alpha = 0
  private _beta  = 90   // default: looking forward (portrait)
  private _gamma = 0
  private _gyroActive = false

  // Euler / quaternion helpers (created once per session)
  private _euler: any = null
  private _q1:    any = null

  constructor(private readonly THREE: any) {}

  // ── Public ────────────────────────────────────────────────────────────────

  async open(
    name:     string,
    registry: ExperienceRegistry,
    onClose:  () => void,
  ): Promise<void> {
    injectStyles()
    registry.setCurrent(name)

    await this._requestGyroPermission()

    this._buildOverlay(name, registry, onClose)
    this._initRenderer()
    this._startGyro()
    this._startLoop()

    await this._loadImage(name)
    this._hideLoading()
    this._hideHintAfterDelay()
  }

  private close(onClose: () => void): void {
    cancelAnimationFrame(this.rafId)
    this._stopGyro()

    const el = this.overlay
    if (el) {
      el.classList.remove('v360-visible')
      setTimeout(() => {
        el.remove()
        this._disposeRenderer()
      }, 380)
    }

    this.overlay = null
    onClose()
  }

  // ── Overlay / UI ──────────────────────────────────────────────────────────

  private _buildOverlay(
    name:     string,
    registry: ExperienceRegistry,
    onClose:  () => void,
  ): void {
    const count = registry.getCount()

    const div = document.createElement('div')
    div.id = 'v360-overlay'
    div.innerHTML = `
      <canvas id="v360-canvas"></canvas>

      <div id="v360-loading">
        <div class="v360-spinner"></div>
      </div>

      <div id="v360-topbar">
        <button id="v360-back">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          Mapa AR
        </button>
        <span id="v360-title">${this._formatName(name)}</span>
      </div>

      ${count > 1 ? `
        <button class="v360-nav" id="v360-prev" aria-label="Anterior">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <button class="v360-nav" id="v360-next" aria-label="Siguiente">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>
      ` : ''}

      <span id="v360-hint">Mueve el teléfono para explorar</span>

      ${count > 1 ? `<div id="v360-counter">${
        Array.from({length: count}, (_, i) => `<div class="v360-dot${i === 0 ? ' active' : ''}"></div>`).join('')
      }</div>` : ''}
    `

    document.body.appendChild(div)
    this.overlay = div

    // Wire buttons
    div.querySelector('#v360-back')!.addEventListener('click', () => this.close(onClose))

    if (count > 1) {
      div.querySelector('#v360-prev')!.addEventListener('click', async () => {
        const next = registry.navigatePrev()
        if (next) await this._navigateTo(next, registry)
      })
      div.querySelector('#v360-next')!.addEventListener('click', async () => {
        const next = registry.navigateNext()
        if (next) await this._navigateTo(next, registry)
      })
    }

    // Trigger fade-in
    requestAnimationFrame(() => div.classList.add('v360-visible'))
  }

  private async _navigateTo(name: string, registry: ExperienceRegistry): Promise<void> {
    this._showLoading()
    this._updateTitle(name)
    this._updateDots(registry)
    await this._loadImage(name)
    this._hideLoading()
  }

  private _updateTitle(name: string): void {
    const el = this.overlay?.querySelector('#v360-title')
    if (el) el.textContent = this._formatName(name)
  }

  private _updateDots(registry: ExperienceRegistry): void {
    const dots = this.overlay?.querySelectorAll('.v360-dot')
    if (!dots) return
    const current = registry.getCurrentName()
    const names   = Array.from({length: registry.getCount()}, (_, i) => i)
    dots.forEach((dot, i) => {
      dot.classList.toggle('active', i === names.indexOf(
        (registry as any).idx ?? 0,
      ))
    })
    // Simpler: just mark the idx
    const idx = (registry as any).idx as number
    dots.forEach((dot, i) => dot.classList.toggle('active', i === idx))
  }

  private _showLoading(): void {
    this.overlay?.querySelector('#v360-loading')?.classList.remove('hidden')
  }

  private _hideLoading(): void {
    this.overlay?.querySelector('#v360-loading')?.classList.add('hidden')
  }

  private _hideHintAfterDelay(): void {
    setTimeout(() => {
      this.overlay?.querySelector('#v360-hint')?.classList.add('hidden')
    }, 3500)
  }

  private _formatName(name: string): string {
    return name.replace(/_/g, ' ')
  }

  // ── Three.js ──────────────────────────────────────────────────────────────

  private _initRenderer(): void {
    const {THREE} = this
    const canvas  = document.getElementById('v360-canvas') as HTMLCanvasElement

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

    this.scene  = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000,
    )

    this.texLoader = new THREE.TextureLoader()

    // Pre-allocate helpers
    this._euler = new THREE.Euler()
    this._q1    = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5))
  }

  private async _loadImage(name: string): Promise<void> {
    const {THREE} = this
    const url     = `${IMAGES_PATH}${name}${IMAGE_EXT}`

    const texture: any = await new Promise((resolve, reject) => {
      this.texLoader.load(url, resolve, undefined, reject)
    }).catch(() => null)

    if (this.sphere) {
      this.scene.remove(this.sphere)
      this.sphere.material.map?.dispose()
      this.sphere.material.dispose()
      this.sphere.geometry.dispose()
      this.sphere = null
    }

    if (texture) {
      texture.colorSpace = THREE.SRGBColorSpace ?? THREE.sRGBEncoding
    }

    const geo = new THREE.SphereGeometry(500, 60, 40)
    geo.scale(-1, 1, 1)   // normals inward

    const mat = new THREE.MeshBasicMaterial({
      map:   texture ?? null,
      color: texture ? 0xffffff : 0x1a2a3a,
    })

    this.sphere = new THREE.Mesh(geo, mat)
    this.scene.add(this.sphere)
  }

  private _disposeRenderer(): void {
    if (this.sphere) {
      this.sphere.material.map?.dispose()
      this.sphere.material.dispose()
      this.sphere.geometry.dispose()
    }
    this.renderer?.dispose()
    this.renderer = null
    this.scene    = null
    this.camera   = null
    this.sphere   = null
  }

  // ── Gyroscope ─────────────────────────────────────────────────────────────

  private async _requestGyroPermission(): Promise<void> {
    const DOE = (DeviceOrientationEvent as any)
    if (typeof DOE?.requestPermission === 'function') {
      try {
        await DOE.requestPermission()
      } catch (_) { /* permission denied — gyro won't work but app won't crash */ }
    }
  }

  private _startGyro(): void {
    this._gyroHandler = (e: DeviceOrientationEvent) => {
      this._alpha     = e.alpha ?? 0
      this._beta      = e.beta  ?? 90
      this._gamma     = e.gamma ?? 0
      this._gyroActive = true
    }
    window.addEventListener('deviceorientation', this._gyroHandler)
  }

  private _stopGyro(): void {
    if (this._gyroHandler) {
      window.removeEventListener('deviceorientation', this._gyroHandler)
      this._gyroHandler = null
    }
  }

  // ── Render loop ───────────────────────────────────────────────────────────

  private _startLoop(): void {
    const {THREE} = this

    const tick = () => {
      if (!this.renderer) return
      this.rafId = requestAnimationFrame(tick)

      if (this._gyroActive) {
        // Standard device-orientation → camera quaternion conversion
        // Matches Three.js DeviceOrientationControls approach
        const alpha = THREE.MathUtils.degToRad(this._alpha)
        const beta  = THREE.MathUtils.degToRad(this._beta)
        const gamma = THREE.MathUtils.degToRad(this._gamma)

        this._euler.set(beta, alpha, -gamma, 'YXZ')
        this.camera.quaternion.setFromEuler(this._euler)
        this.camera.quaternion.multiply(this._q1)
      }

      this.renderer.render(this.scene, this.camera)
    }

    tick()
  }
}