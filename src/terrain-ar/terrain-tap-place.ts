import {ExperienceRegistry} from './experience-registry'
import {probeGyroscope}     from './device-check'

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
        position: fixed; inset: 0; z-index: 99999;
        background: #000;
        opacity: 0; transition: opacity 0.35s ease;
        touch-action: none;
      }
      #v360-overlay.v360-visible { opacity: 1; }
      #v360-canvas {
        position: absolute; inset: 0;
        width: 100%; height: 100%; display: block;
      }
      #v360-topbar {
        position: absolute; top: 0; left: 0; right: 0;
        display: flex; align-items: center; justify-content: center;
        padding: 18px 16px 0;
        pointer-events: none; z-index: 2;
      }
      #v360-back {
        position: absolute; left: 16px;
        display: flex; align-items: center; gap: 6px;
        background: rgba(255,255,255,0.92); border: none; border-radius: 22px;
        padding: 8px 16px 8px 10px;
        font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
        font-size: 13px; font-weight: 500; color: #4ab8d8;
        letter-spacing: 0.04em; cursor: pointer; pointer-events: all;
        box-shadow: 0 2px 12px rgba(0,0,0,0.18);
        -webkit-tap-highlight-color: transparent;
        transition: background 0.15s;
      }
      #v360-back:active { background: rgba(235,248,255,0.98); }
      #v360-title {
        background: rgba(255,255,255,0.92); border-radius: 18px;
        padding: 7px 18px;
        font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
        font-size: 13px; font-weight: 500;
        letter-spacing: 0.12em; text-transform: uppercase; color: #4ab8d8;
        box-shadow: 0 2px 12px rgba(0,0,0,0.18);
        max-width: 48vw; white-space: nowrap;
        overflow: hidden; text-overflow: ellipsis;
      }
      .v360-nav {
        position: absolute; top: 50%; transform: translateY(-50%);
        z-index: 2; background: rgba(255,255,255,0.92); border: none;
        border-radius: 50%; width: 48px; height: 48px;
        display: flex; align-items: center; justify-content: center;
        cursor: pointer; box-shadow: 0 2px 12px rgba(0,0,0,0.22);
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
      #v360-counter {
        position: absolute; bottom: 28px; left: 50%; transform: translateX(-50%);
        display: flex; gap: 6px; z-index: 2;
      }
      .v360-dot {
        width: 6px; height: 6px; border-radius: 50%;
        background: rgba(255,255,255,0.35); transition: background 0.2s;
      }
      .v360-dot.active { background: rgba(255,255,255,0.95); }
      #v360-hint {
        position: absolute; bottom: 52px; left: 50%; transform: translateX(-50%);
        font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
        font-size: 10px; font-weight: 300;
        letter-spacing: 0.18em; text-transform: uppercase;
        color: rgba(255,255,255,0.45); white-space: nowrap;
        pointer-events: none; z-index: 2; transition: opacity 0.5s;
      }
      #v360-hint.v360-hidden { opacity: 0; }
      #v360-loading {
        position: absolute; inset: 0;
        display: flex; align-items: center; justify-content: center;
        background: rgba(0,0,0,0.55); z-index: 3; transition: opacity 0.3s;
      }
      #v360-loading.v360-hidden { opacity: 0; pointer-events: none; }
      .v360-spinner {
        width: 32px; height: 32px;
        border: 2px solid rgba(74,184,216,0.25);
        border-top-color: #4ab8d8; border-radius: 50%;
        animation: v360-spin 0.8s linear infinite;
      }
      @keyframes v360-spin { to { transform: rotate(360deg); } }
      #v360-gyro-badge {
        position: absolute; top: 72px; right: 14px;
        background: rgba(0,0,0,0.45); border-radius: 12px;
        padding: 5px 10px; z-index: 2;
        font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
        font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase;
        color: rgba(255,255,255,0.55); pointer-events: none;
      }
    `
    document.head.appendChild(s)
  }
})()

// ── Screen orientation angle ──────────────────────────────────────────────────
//
// The problem: iPad Pro's natural orientation is LANDSCAPE (angle = 0°).
// iPhone's natural orientation is PORTRAIT (angle = 0°).
//
// DeviceOrientationEvent angles (alpha/beta/gamma) are always relative to
// the device's natural orientation. So the same physical position gives
// different beta/gamma values on iPad vs iPhone.
//
// Three.js DeviceOrientationControls assumes portrait-natural (phone).
// On iPad in portrait: screen.orientation.angle = 90°, but the sensor
// data is already compensated for landscape-natural, so we get double rotation.
//
// Fix: detect iPad (landscape-natural) and subtract 90° from the orient angle.
// This realigns the coordinate system to match phone behavior.

function getOrientAngleDeg(): number {
  const raw = window.screen?.orientation?.angle
    ?? (window as any).orientation
    ?? 0

  // Detect iPad: natural orientation is landscape (screen.width > screen.height
  // when angle === 0, i.e. in natural/home orientation)
  const isIPad = /iPad/.test(navigator.userAgent)
    || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)

  if (isIPad) {
    // iPad natural = landscape = 0°.
    // We subtract 90° so the math matches the portrait-natural assumption.
    return raw - 90
  }

  return raw
}

// ── Viewer360 ─────────────────────────────────────────────────────────────────

export class Viewer360 {
  private overlay:   HTMLElement | null = null
  private renderer:  any = null
  private scene:     any = null
  private camera:    any = null
  private sphere:    any = null
  private texLoader: any = null
  private rafId      = 0

  private texCache = new Map<string, any>()

  // Gyro
  private _gyroHandler: ((e: DeviceOrientationEvent) => void) | null = null
  private _alpha = 0; private _beta = 90; private _gamma = 0
  private _gyroOk = false

  // Three helpers
  private _euler:   any = null
  private _q1:      any = null
  private _qOrient: any = null
  private _zee:     any = null

  // Touch drag
  private _drag = { active: false, lastX: 0, lastY: 0, lon: 0, lat: 0 }
  private _onTouchStart: ((e: TouchEvent) => void) | null = null
  private _onTouchMove:  ((e: TouchEvent) => void) | null = null
  private _onTouchEnd:   (() => void)              | null = null

  constructor(private readonly THREE: any) {}

  // ── Public ────────────────────────────────────────────────────────────────

  async open(
    name:     string,
    registry: ExperienceRegistry,
    onClose:  () => void,
  ): Promise<void> {
    injectStyles()
    registry.setCurrent(name)

    const gyroOk = await this._requestGyroPermission()
    this._buildOverlay(name, registry, gyroOk, onClose)
    this._initRenderer()
    if (gyroOk) this._startGyro()
    else         this._startTouchDrag()
    this._startLoop()
    await this._loadImage(name)
    this._hideLoading()
    this._hideHintAfterDelay()
  }

  private close(onClose: () => void): void {
    cancelAnimationFrame(this.rafId)
    this._stopGyro()
    this._stopTouchDrag()
    const el = this.overlay
    if (el) {
      el.classList.remove('v360-visible')
      setTimeout(() => { el.remove(); this._fullDispose() }, 380)
    }
    this.overlay = null
    onClose()
  }

  // ── UI ────────────────────────────────────────────────────────────────────

  private _buildOverlay(
    name: string, registry: ExperienceRegistry,
    gyroOk: boolean, onClose: () => void,
  ): void {
    const count    = registry.getCount()
    const hintText = gyroOk ? 'Mueve el teléfono para explorar' : 'Arrastra para explorar'

    const div = document.createElement('div')
    div.id = 'v360-overlay'
    div.innerHTML = `
      <canvas id="v360-canvas"></canvas>
      <div id="v360-loading"><div class="v360-spinner"></div></div>
      <div id="v360-topbar">
        <button id="v360-back">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2.2"
               stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          Mapa AR
        </button>
        <span id="v360-title">${this._fmt(name)}</span>
      </div>
      ${!gyroOk ? `<div id="v360-gyro-badge">Modo táctil</div>` : ''}
      ${count > 1 ? `
        <button class="v360-nav" id="v360-prev" aria-label="Anterior">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2.2"
               stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <button class="v360-nav" id="v360-next" aria-label="Siguiente">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2.2"
               stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>
        <div id="v360-counter">
          ${Array.from({length: count}, (_, i) =>
            `<div class="v360-dot${i === 0 ? ' active' : ''}"></div>`).join('')}
        </div>` : ''}
      <span id="v360-hint">${hintText}</span>
    `

    document.body.appendChild(div)
    this.overlay = div

    div.querySelector('#v360-back')!.addEventListener('click', () => this.close(onClose))

    if (count > 1) {
      div.querySelector('#v360-prev')!.addEventListener('click', async () => {
        const next = registry.navigatePrev()
        if (next) await this._navTo(next, registry)
      })
      div.querySelector('#v360-next')!.addEventListener('click', async () => {
        const next = registry.navigateNext()
        if (next) await this._navTo(next, registry)
      })
    }

    requestAnimationFrame(() => div.classList.add('v360-visible'))
  }

  private async _navTo(name: string, registry: ExperienceRegistry): Promise<void> {
    this._showLoading()
    this._updateTitle(name)
    this._updateDots(registry)
    this._drag.lon = 0; this._drag.lat = 0
    await this._loadImage(name)
    this._hideLoading()
  }

  private _updateTitle(name: string): void {
    const el = this.overlay?.querySelector('#v360-title')
    if (el) el.textContent = this._fmt(name)
  }

  private _updateDots(registry: ExperienceRegistry): void {
    const dots = this.overlay?.querySelectorAll('.v360-dot')
    if (!dots) return
    const idx = (registry as any).idx as number
    dots.forEach((d, i) => d.classList.toggle('active', i === idx))
  }

  private _showLoading(): void {
    this.overlay?.querySelector('#v360-loading')?.classList.remove('v360-hidden')
  }

  private _hideLoading(): void {
    this.overlay?.querySelector('#v360-loading')?.classList.add('v360-hidden')
  }

  private _hideHintAfterDelay(): void {
    setTimeout(() => {
      this.overlay?.querySelector('#v360-hint')?.classList.add('v360-hidden')
    }, 3500)
  }

  private _fmt(name: string): string { return name.replace(/_/g, ' ') }

  // ── Three.js ──────────────────────────────────────────────────────────────

  private _initRenderer(): void {
    const { THREE } = this
    const canvas    = document.getElementById('v360-canvas') as HTMLCanvasElement

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false })
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))

    this.scene  = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(
      75, window.innerWidth / window.innerHeight, 0.1, 1000,
    )
    this.texLoader = new THREE.TextureLoader()
    this._euler   = new THREE.Euler()
    this._q1      = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5))
    this._qOrient = new THREE.Quaternion()
    this._zee     = new THREE.Vector3(0, 0, 1)
  }

  private async _loadImage(name: string): Promise<void> {
    const { THREE } = this

    if (this.sphere) {
      this.scene.remove(this.sphere)
      this.sphere.material.dispose()
      this.sphere.geometry.dispose()
      this.sphere = null
    }

    let texture = this.texCache.get(name) ?? null
    if (!texture) {
      texture = await new Promise(resolve => {
        this.texLoader.load(
          `${IMAGES_PATH}${name}${IMAGE_EXT}`,
          resolve,
          undefined,
          () => resolve(null),
        )
      })
      if (texture) {
        texture.colorSpace = THREE.SRGBColorSpace ?? THREE.sRGBEncoding
        this.texCache.set(name, texture)
      }
    }

    const geo = new THREE.SphereGeometry(500, 60, 40)
    geo.scale(-1, 1, 1)

    this.sphere = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map:   texture ?? null,
      color: texture ? 0xffffff : 0x1a2a3a,
    }))
    this.scene.add(this.sphere)
  }

  private _fullDispose(): void {
    if (this.sphere) {
      this.sphere.geometry.dispose()
      this.sphere.material.dispose()
      this.sphere = null
    }
    this.texCache.forEach(tex => tex.dispose())
    this.texCache.clear()
    this.renderer?.dispose()
    this.renderer = this.scene = this.camera = null
  }

  // ── Gyroscope ─────────────────────────────────────────────────────────────

  private async _requestGyroPermission(): Promise<boolean> {
    const DOE = (DeviceOrientationEvent as any)
    if (typeof DOE?.requestPermission === 'function') {
      try {
        const result = await DOE.requestPermission()
        if (result !== 'granted') return false
      } catch { return false }
    }
    return probeGyroscope(1200)
  }

  private _startGyro(): void {
    this._gyroOk = true
    this._gyroHandler = (e: DeviceOrientationEvent) => {
      if (e.alpha === null) return
      this._alpha = e.alpha
      this._beta  = e.beta  ?? 90
      this._gamma = e.gamma ?? 0
    }
    window.addEventListener('deviceorientation', this._gyroHandler)
  }

  private _stopGyro(): void {
    if (this._gyroHandler) {
      window.removeEventListener('deviceorientation', this._gyroHandler)
      this._gyroHandler = null
    }
    this._gyroOk = false
  }

  // ── Touch drag ────────────────────────────────────────────────────────────

  private _startTouchDrag(): void {
    const d = this._drag
    this._onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      d.active = true
      d.lastX  = e.touches[0].clientX
      d.lastY  = e.touches[0].clientY
    }
    this._onTouchMove = (e: TouchEvent) => {
      if (!d.active || e.touches.length !== 1) return
      d.lon  -= (e.touches[0].clientX - d.lastX) * 0.25
      d.lat  += (e.touches[0].clientY - d.lastY) * 0.15
      d.lat   = Math.max(-85, Math.min(85, d.lat))
      d.lastX = e.touches[0].clientX
      d.lastY = e.touches[0].clientY
    }
    this._onTouchEnd = () => { d.active = false }

    const canvas = document.getElementById('v360-canvas')!
    canvas.addEventListener('touchstart', this._onTouchStart, { passive: true })
    canvas.addEventListener('touchmove',  this._onTouchMove,  { passive: true })
    canvas.addEventListener('touchend',   this._onTouchEnd,   { passive: true })
  }

  private _stopTouchDrag(): void {
    const canvas = document.getElementById('v360-canvas')
    if (!canvas) return
    if (this._onTouchStart) canvas.removeEventListener('touchstart', this._onTouchStart)
    if (this._onTouchMove)  canvas.removeEventListener('touchmove',  this._onTouchMove)
    if (this._onTouchEnd)   canvas.removeEventListener('touchend',   this._onTouchEnd)
    this._onTouchStart = this._onTouchMove = this._onTouchEnd = null
  }

  // ── Render loop ───────────────────────────────────────────────────────────

  private _startLoop(): void {
    const { THREE } = this

    const tick = () => {
      if (!this.renderer) return
      this.rafId = requestAnimationFrame(tick)

      if (this._gyroOk) {
        const alpha  = THREE.MathUtils.degToRad(this._alpha)
        const beta   = THREE.MathUtils.degToRad(this._beta)
        const gamma  = THREE.MathUtils.degToRad(this._gamma)
        const orient = THREE.MathUtils.degToRad(getOrientAngleDeg())

        this._euler.set(beta, alpha, -gamma, 'YXZ')
        this.camera.quaternion.setFromEuler(this._euler)
        this.camera.quaternion.multiply(this._q1)
        this._qOrient.setFromAxisAngle(this._zee, -orient)
        this.camera.quaternion.multiply(this._qOrient)
      } else {
        const phi   = THREE.MathUtils.degToRad(90 - this._drag.lat)
        const theta = THREE.MathUtils.degToRad(this._drag.lon)
        this.camera.lookAt(
          500 * Math.sin(phi) * Math.cos(theta),
          500 * Math.cos(phi),
          500 * Math.sin(phi) * Math.sin(theta),
        )
      }

      this.renderer.render(this.scene, this.camera)
    }

    tick()
  }
}