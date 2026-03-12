/**
 * Viewer360 — v6
 *
 * Base: v4 (fluido, gyro + touchBaseQuat).
 *
 * Problema de v4: tras un drag horizontal grande (~180°), el quaternion de
 * corrección acumulado (_gyroCorrection = gyroQuat⁻¹ × dragQuat) conjuga
 * los deltas futuros del gyro, invirtiendo los controles.
 *
 * Fix (mínimo):
 *   1. touchstart → _gyroOk = false. El gyro se "apaga" durante el drag.
 *      El touchBaseQuat maneja la cámara exclusivamente (como en v4).
 *   2. touchend  → leveling animado (igual que v4), luego al terminar:
 *      _gyroCorrection = identity, _gyroOk = true.
 *      El gyro arranca LIMPIO. camera = gyroQuat × identity = gyroQuat.
 *      Sin correction quaternion → sin conjugación → sin inversión posible.
 *   3. Snap tras restart: en la práctica el teléfono se mueve físicamente
 *      ~igual que el drag, por lo que gyroQuat ≈ posición del dedo. OK.
 *   4. Límite vertical ±70° en touch (gyro y touch-only) para que el snap
 *      horizontal sea imperceptible y el usuario no quede mirando al cénit.
 */

import {probeGyroscope} from './device-check'

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_PATH    = 'assets/360/'
const IMAGE_EXT    = '.jpg'
const MANIFEST_URL = `${BASE_PATH}manifest.json`

const MAX_PITCH_DEG = 70  // ±70° from horizon — limits touch AND gyro pitch

interface HotspotEntry {
  folder: string
  images: string[]
  /** Display names matching each image by index. Falls back to image stem. */
  labels?: string[]
}
type Manifest = Record<string, HotspotEntry>

// ── Styles ────────────────────────────────────────────────────────────────────

const injectStyles = (() => {
  let done = false
  return (): void => {
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

      /* ── Top bar: single X to close 360 ── */
      #v360-topbar {
        position: absolute; top: 0; left: 0; right: 0;
        display: flex; align-items: center; justify-content: flex-start;
        padding: 18px 16px 0;
        z-index: 2; pointer-events: none;
      }
      #v360-close-360 {
        display: flex; align-items: center; justify-content: center;
        background: rgba(255,255,255,0.92); border: none; border-radius: 50%;
        width: 42px; height: 42px; flex-shrink: 0;
        color: #4ab8d8; cursor: pointer; pointer-events: all;
        box-shadow: 0 2px 12px rgba(0,0,0,0.18);
        -webkit-tap-highlight-color: transparent;
        transition: background 0.15s;
      }
      #v360-close-360:active { background: rgba(235,248,255,0.98); }

      /* ── Side navigation buttons ── */
      .v360-nav-btn {
        position: absolute; top: 50%; transform: translateY(-50%);
        z-index: 2;
        background: rgba(255,255,255,0.92); border: none; border-radius: 22px;
        padding: 10px 16px;
        font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
        font-size: 12px; font-weight: 600; color: #4ab8d8;
        letter-spacing: 0.06em; text-transform: uppercase;
        cursor: pointer;
        box-shadow: 0 2px 12px rgba(0,0,0,0.22);
        -webkit-tap-highlight-color: transparent;
        display: flex; align-items: center; gap: 6px;
        transition: background 0.15s, opacity 0.2s, transform 0.15s;
      }
      .v360-nav-btn:active {
        background: rgba(235,248,255,0.98);
        transform: translateY(-50%) scale(0.94);
      }
      .v360-nav-btn.v360-nav-hidden { opacity: 0; pointer-events: none; }
      #v360-prev-btn { left: 14px; }
      #v360-next-btn { right: 14px; }

      /* ── Bottom: place name + dots ── */
      #v360-bottom {
        position: absolute; bottom: 28px; left: 0; right: 0;
        display: flex; flex-direction: column; align-items: center; gap: 10px;
        z-index: 2; pointer-events: none;
      }
      #v360-title {
        background: rgba(255,255,255,0.92); border-radius: 18px;
        padding: 7px 22px;
        font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
        font-size: 12px; font-weight: 600;
        letter-spacing: 0.10em; text-transform: uppercase; color: #4ab8d8;
        box-shadow: 0 2px 12px rgba(0,0,0,0.18);
        max-width: 74vw;
        white-space: normal;
        word-break: break-word;
        text-align: center;
        line-height: 1.4em;
        overflow: hidden;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
      }
      #v360-counter { display: flex; gap: 7px; }
      .v360-dot {
        width: 6px; height: 6px; border-radius: 50%;
        background: rgba(255,255,255,0.35); transition: background 0.2s;
      }
      .v360-dot.active { background: rgba(255,255,255,0.95); }

      /* ── Explore hint ── */
      #v360-hint {
        position: absolute;
        bottom: 110px; left: 50%; transform: translateX(-50%);
        font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
        font-size: 10px; font-weight: 300;
        letter-spacing: 0.18em; text-transform: uppercase;
        color: rgba(255,255,255,0.45); white-space: nowrap;
        pointer-events: none; z-index: 2; transition: opacity 0.5s;
      }
      #v360-hint.v360-hidden { opacity: 0; }

      /* ── Loading spinner ── */
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

      /* ── Gyro badge ── */
      #v360-gyro-badge {
        position: absolute; top: 72px; right: 14px;
        background: rgba(0,0,0,0.45); border-radius: 12px;
        padding: 5px 10px; z-index: 2;
        font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
        font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase;
        color: rgba(255,255,255,0.55); pointer-events: none;
      }

      /* ── Landscape ── */
      @media (orientation: landscape) {
        #v360-topbar    { padding: 10px 14px 0; }
        #v360-close-360 { width: 34px; height: 34px; }
        .v360-nav-btn   { padding: 8px 12px; font-size: 11px; }
        #v360-bottom    { bottom: 14px; gap: 7px; }
        #v360-title     { font-size: 11px; padding: 5px 16px; }
        #v360-hint      { bottom: 80px; font-size: 9px; }
      }
    `
    document.head.appendChild(s)
  }
})()

// ── Orientation helper ────────────────────────────────────────────────────────

function getOrientAngleDeg(): number {
  const raw = window.screen?.orientation?.angle ?? (window as any).orientation ?? 0
  const isIPad =
    /iPad/.test(navigator.userAgent) ||
    (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
  return isIPad ? raw - 90 : raw
}

// ─────────────────────────────────────────────────────────────────────────────

export class Viewer360 {

  // ── Three.js objects ──────────────────────────────────────────────────────
  private overlay:   HTMLElement | null = null
  private renderer:  any = null
  private scene:     any = null
  private camera:    any = null
  private sphere:    any = null
  private texLoader: any = null
  private rafId      = 0

  // ── Manifest ──────────────────────────────────────────────────────────────
  private manifest:        Manifest | null = null
  private manifestPromise: Promise<Manifest | null> | null = null

  // ── Texture sliding-window cache ──────────────────────────────────────────
  private texCache   = new Map<string, any>()
  private texPending = new Map<string, Promise<any>>()

  // ── Per-open navigation state ─────────────────────────────────────────────
  private currentHotspot = ''
  private currentFolder  = ''
  private currentImages:  string[] = []
  private currentIdx     = 0

  // ── Gyroscope ─────────────────────────────────────────────────────────────
  private _gyroHandler:   ((e: DeviceOrientationEvent) => void) | null = null
  private _resizeHandler: (() => void) | null = null
  private _alpha = 0; private _beta = 90; private _gamma = 0
  /**
   * Whether the gyro is currently ACTIVE (driving the render loop).
   * Set to false on touchstart, restored to true after leveling completes.
   */
  private _gyroOk   = false
  /**
   * Permanent flag: true if this device has gyro and it was initialized.
   * Never reset to false — used to distinguish "gyro paused during touch"
   * from "device has no gyro at all".
   */
  private _hasGyro  = false
  private _euler:         any = null
  private _q1:            any = null
  private _qOrient:       any = null
  private _zee:           any = null
  private _gyroCorrection: any = null

  // ── Touch drag ────────────────────────────────────────────────────────────
  private _touchBaseQuat: any = null
  private _isTouching = false
  private _lastTouchX = 0
  private _lastTouchY = 0
  private _drag = { lon: 0, lat: 0 }
  private _onTouchStart: ((e: TouchEvent) => void) | null = null
  private _onTouchMove:  ((e: TouchEvent) => void) | null = null
  private _onTouchEnd:   (() => void)              | null = null

  // ── Horizon leveling animation ────────────────────────────────────────────
  private _isLeveling    = false
  private _levelingRaf   = 0
  private _levelingFrom: any = null
  private _levelingTo:   any = null
  private _levelingStart = 0
  private readonly _levelingDuration = 380

  constructor(private readonly THREE: any) {}

  // ── Public API ────────────────────────────────────────────────────────────

  async open(hotspotName: string, onClose: () => void): Promise<void> {
    injectStyles()

    const manifest = await this._loadManifest()
    this.currentHotspot = hotspotName
    const entry = manifest?.[hotspotName]
    this.currentFolder  = entry?.folder  ?? hotspotName
    this.currentImages  = entry?.images  ?? []
    this.currentIdx     = 0

    if (this.currentImages.length === 0) {
      onClose()
      return
    }

    const gyroOk = await this._requestGyroPermission()

    this._buildOverlay(hotspotName, gyroOk, onClose)
    this._initRenderer()
    this._startResizeHandler()
    if (gyroOk) this._startGyro()
    this._startTouchDrag()
    this._startLoop()

    const tex = await this._fetchTexture(this.currentFolder, this.currentImages[0])
    this._applySphereTexture(tex)
    this._hideLoading()
    this._updateNavButtons()
    this._updateDots()
    this._updateTitle()
    this._hideHintAfterDelay()

    if (this.currentImages.length > 1) {
      void this._fetchTexture(this.currentFolder, this.currentImages[1])
    }
  }

  // ── Manifest ──────────────────────────────────────────────────────────────

  private async _loadManifest(): Promise<Manifest | null> {
    if (this.manifest)        return this.manifest
    if (this.manifestPromise) return this.manifestPromise

    this.manifestPromise = fetch(MANIFEST_URL)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<Manifest>
      })
      .then(m => { this.manifest = m; return m })
      .catch(() => null)

    return this.manifestPromise
  }

  // ── Label helpers ─────────────────────────────────────────────────────────

  private _getCurrentLabel(): string {
    const entry  = this.manifest?.[this.currentHotspot]
    const labels = entry?.labels
    if (labels && labels[this.currentIdx]) return labels[this.currentIdx]
    const stem = this.currentImages[this.currentIdx] ?? this.currentHotspot
    return stem.replace(/^\d+\.\s*/, '')
  }

  private _updateTitle(): void {
    const el = this.overlay?.querySelector<HTMLElement>('#v360-title')
    if (el) el.textContent = this._getCurrentLabel()
  }

  // ── Texture cache ─────────────────────────────────────────────────────────

  private _key(folder: string, filename: string): string {
    return `${folder}/${filename}`
  }

  private _fetchTexture(folder: string, filename: string): Promise<any> {
    const key = this._key(folder, filename)

    if (this.texCache.has(key))   return Promise.resolve(this.texCache.get(key))
    if (this.texPending.has(key)) return this.texPending.get(key)!

    const promise = new Promise<any>(resolve => {
      if (!this.texLoader) { resolve(null); return }

      this.texLoader.load(
        `${BASE_PATH}${folder}/${filename}${IMAGE_EXT}`,
        (tex: any) => {
          if (!this.texLoader) { tex.dispose(); resolve(null); return }
          tex.colorSpace = this.THREE.SRGBColorSpace ?? this.THREE.sRGBEncoding
          this.texCache.set(key, tex)
          this.texPending.delete(key)
          resolve(tex)
        },
        undefined,
        () => {
          this.texCache.set(key, null)
          this.texPending.delete(key)
          resolve(null)
        },
      )
    })

    this.texPending.set(key, promise)
    return promise
  }

  private _evictOutside(folder: string, centerIdx: number): void {
    const keep = new Set(
      [centerIdx - 1, centerIdx, centerIdx + 1]
        .filter(i => i >= 0 && i < this.currentImages.length)
        .map(i => this._key(folder, this.currentImages[i])),
    )
    for (const [key, tex] of this.texCache) {
      if (!keep.has(key) && tex) {
        tex.dispose()
        this.texCache.delete(key)
      }
    }
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  private async _navigateTo(newIdx: number): Promise<void> {
    const { currentFolder: folder, currentImages: imgs } = this
    if (newIdx < 0 || newIdx >= imgs.length) return

    this._applySphereTexture(null)
    this._showLoading()

    const tex = await this._fetchTexture(folder, imgs[newIdx])
    this._applySphereTexture(tex)
    this.currentIdx = newIdx

    this._drag.lon = 0
    this._drag.lat = 0
    if (this._gyroCorrection) this._gyroCorrection.set(0, 0, 0, 1)
    this._cancelLeveling()

    this._hideLoading()
    this._updateNavButtons()
    this._updateDots()
    this._updateTitle()

    if (newIdx + 1 < imgs.length) void this._fetchTexture(folder, imgs[newIdx + 1])
    if (newIdx - 1 >= 0)          void this._fetchTexture(folder, imgs[newIdx - 1])

    setTimeout(() => this._evictOutside(folder, newIdx), 600)
  }

  private _applySphereTexture(texture: any): void {
    if (!this.sphere) return
    this.sphere.material.map = texture ?? null
    this.sphere.material.color.set(texture ? 0xffffff : 0x1a2a3a)
    this.sphere.material.needsUpdate = true
  }

  // ── UI ────────────────────────────────────────────────────────────────────

  private _buildOverlay(
    hotspotName: string, gyroOk: boolean, onClose: () => void,
  ): void {
    const count    = this.currentImages.length
    const hintText = gyroOk ? 'Move phone · drag to explore' : 'Drag to explore'

    const div = document.createElement('div')
    div.id = 'v360-overlay'
    div.innerHTML = `
      <canvas id="v360-canvas"></canvas>
      <div id="v360-loading"><div class="v360-spinner"></div></div>

      <div id="v360-topbar">
        <button id="v360-close-360" aria-label="Close 360">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2.6"
               stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6"  x2="6"  y2="18"/>
            <line x1="6"  y1="6"  x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      ${!gyroOk ? `<div id="v360-gyro-badge">Touch mode</div>` : ''}

      ${count > 1 ? `
        <button class="v360-nav-btn v360-nav-hidden" id="v360-prev-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2.6"
               stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          Prev
        </button>
        <button class="v360-nav-btn" id="v360-next-btn">
          Next
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2.6"
               stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>
      ` : ''}

      <span id="v360-hint">${hintText}</span>

      <div id="v360-bottom">
        <span id="v360-title"></span>
        ${count > 1 ? `
          <div id="v360-counter">
            ${Array.from({length: count}, (_, i) =>
              `<div class="v360-dot${i === 0 ? ' active' : ''}"></div>`,
            ).join('')}
          </div>
        ` : ''}
      </div>
    `

    document.body.appendChild(div)
    this.overlay = div

    div.querySelector('#v360-close-360')!.addEventListener('click', () => this._close(onClose))

    if (count > 1) {
      div.querySelector('#v360-prev-btn')!.addEventListener('click', async () => {
        await this._navigateTo(this.currentIdx - 1)
      })
      div.querySelector('#v360-next-btn')!.addEventListener('click', async () => {
        await this._navigateTo(this.currentIdx + 1)
      })
    }

    requestAnimationFrame(() => div.classList.add('v360-visible'))
  }

  private _updateNavButtons(): void {
    const prev = this.overlay?.querySelector('#v360-prev-btn')
    const next = this.overlay?.querySelector('#v360-next-btn')
    if (prev) prev.classList.toggle('v360-nav-hidden', this.currentIdx === 0)
    if (next) next.classList.toggle('v360-nav-hidden', this.currentIdx === this.currentImages.length - 1)
  }

  private _updateDots(): void {
    const dots = this.overlay?.querySelectorAll('.v360-dot')
    if (!dots) return
    dots.forEach((d, i) => d.classList.toggle('active', i === this.currentIdx))
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

  // ── Close ─────────────────────────────────────────────────────────────────

  private _close(onClose: () => void): void {
    cancelAnimationFrame(this.rafId)
    this._cancelLeveling()
    this._stopGyro()
    this._stopTouchDrag()
    this._stopResizeHandler()
    const el = this.overlay
    if (el) {
      el.classList.remove('v360-visible')
      setTimeout(() => { el.remove(); this._fullDispose() }, 380)
    }
    this.overlay = null
    onClose()
  }

  // ── Three.js ──────────────────────────────────────────────────────────────

  private _initRenderer(): void {
    const { THREE } = this
    const canvas = document.getElementById('v360-canvas') as HTMLCanvasElement

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    this.renderer.setSize(window.innerWidth, window.innerHeight)

    this.scene  = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000)

    const geo = new THREE.SphereGeometry(500, 60, 40)
    geo.scale(-1, 1, 1)
    this.sphere = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x1a2a3a }))
    this.scene.add(this.sphere)

    this.texLoader = new THREE.TextureLoader()
    this._euler    = new THREE.Euler()
    this._q1       = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5))
    this._qOrient  = new THREE.Quaternion()
    this._zee      = new THREE.Vector3(0, 0, 1)
    this._gyroCorrection = new THREE.Quaternion()
  }

  private _fullDispose(): void {
    for (const tex of this.texCache.values()) {
      if (tex) tex.dispose()
    }
    this.texCache.clear()
    this.texPending.clear()

    if (this.sphere) {
      this.sphere.geometry.dispose()
      this.sphere.material.dispose()
      this.sphere = null
    }
    this.renderer?.dispose()
    this.renderer = this.scene = this.camera = this.texLoader = null
  }

  // ── Resize ────────────────────────────────────────────────────────────────

  private _startResizeHandler(): void {
    this._resizeHandler = () => {
      if (!this.renderer || !this.camera) return
      this.renderer.setSize(window.innerWidth, window.innerHeight)
      this.camera.aspect = window.innerWidth / window.innerHeight
      this.camera.updateProjectionMatrix()
    }
    window.addEventListener('resize', this._resizeHandler)
  }

  private _stopResizeHandler(): void {
    if (this._resizeHandler) {
      window.removeEventListener('resize', this._resizeHandler)
      this._resizeHandler = null
    }
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
    this._gyroOk  = true
    this._hasGyro = true   // permanent — never reset to false
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
    this._gyroOk  = false
    this._hasGyro = false
  }

  // ── Leveling ──────────────────────────────────────────────────────────────

  private _deRoll(q: any): any {
    const { THREE } = this
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q)
    if (Math.abs(fwd.y) > 0.999) return q.clone()
    const m = new THREE.Matrix4().lookAt(
      new THREE.Vector3(0, 0, 0), fwd, new THREE.Vector3(0, 1, 0),
    )
    return new THREE.Quaternion().setFromRotationMatrix(m)
  }

  private _cancelLeveling(): void {
    cancelAnimationFrame(this._levelingRaf)
    this._isLeveling = false
    this._levelingFrom = this._levelingTo = null
  }

  /**
   * Animates from fromQuat to its de-rolled version (ease-out cubic, 380ms).
   *
   * KEY CHANGE vs v4: on completion, instead of baking a correction quaternion
   * (which caused inversion after large drags), we:
   *   1. Reset _gyroCorrection to identity.
   *   2. Set _gyroOk = true.
   * The gyro restarts completely clean. camera = gyroQuat × identity = gyroQuat.
   * No correction → no possible conjugation → no inversion at any drag angle.
   */
  private _startLevelingAnimation(fromQuat: any): void {
    this._cancelLeveling()
    const toQuat = this._deRoll(fromQuat)

    // Already level — restart gyro immediately
    if (Math.abs(fromQuat.dot(toQuat)) > 0.9998) {
      this._gyroCorrection.set(0, 0, 0, 1)
      this._gyroOk = true
      return
    }

    this._levelingFrom  = fromQuat.clone()
    this._levelingTo    = toQuat
    this._levelingStart = performance.now()
    this._isLeveling    = true

    const step = () => {
      if (!this.renderer || !this._isLeveling) return
      const elapsed = performance.now() - this._levelingStart
      const raw     = Math.min(elapsed / this._levelingDuration, 1)
      const eased   = 1 - Math.pow(1 - raw, 3)

      this.camera.quaternion.slerpQuaternions(
        this._levelingFrom, this._levelingTo, eased,
      )

      if (raw < 1) {
        this._levelingRaf = requestAnimationFrame(step)
      } else {
        // Leveling complete — restart gyro clean (identity correction)
        this._isLeveling = false
        this._gyroCorrection.set(0, 0, 0, 1)
        this._gyroOk = true
      }
    }
    this._levelingRaf = requestAnimationFrame(step)
  }

  /** Raw gyro quaternion for current device orientation. */
  private _computeGyroQuat(): any {
    const { THREE } = this
    const alpha  = THREE.MathUtils.degToRad(this._alpha)
    const beta   = THREE.MathUtils.degToRad(this._beta)
    const gamma  = THREE.MathUtils.degToRad(this._gamma)
    const orient = THREE.MathUtils.degToRad(getOrientAngleDeg())
    const e = new THREE.Euler(beta, alpha, -gamma, 'YXZ')
    const q = new THREE.Quaternion().setFromEuler(e)
    q.multiply(this._q1)
    const qOrient = new THREE.Quaternion().setFromAxisAngle(this._zee, -orient)
    q.multiply(qOrient)
    return q
  }

  // ── Touch drag ────────────────────────────────────────────────────────────
  //
  // GYRO MODE:
  //   touchstart → _gyroOk = false (gyro fully disabled for duration of touch).
  //                Capture camera.quaternion as _touchBaseQuat.
  //   touchmove  → apply yaw/pitch deltas to _touchBaseQuat, with pitch
  //                clamped to ±MAX_PITCH_DEG (prevents looking near zenith).
  //   touchend   → leveling animation (380ms ease-out to roll=0).
  //                On completion: _gyroCorrection = identity, _gyroOk = true.
  //                Gyro restarts CLEAN — no inversion possible at any drag angle.
  //
  // TOUCH-ONLY MODE — classic lon/lat spherical, vertical ±MAX_PITCH_DEG.

  private _startTouchDrag(): void {
    this._drag.lon = 0
    this._drag.lat = 0
    this._isTouching = false

    this._onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      const target = e.target as HTMLElement
      if (target.closest('.v360-nav-btn') || target.closest('#v360-close-360')) return

      // Cancel any in-progress leveling
      this._cancelLeveling()

      // Disable gyro for the duration of the touch.
      // _gyroCorrection is cleared so gyro restarts clean on touchend.
      this._gyroOk = false
      if (this._gyroCorrection) this._gyroCorrection.set(0, 0, 0, 1)

      this._isTouching = true
      this._lastTouchX = e.touches[0].clientX
      this._lastTouchY = e.touches[0].clientY

      // Always capture base quaternion (used in both gyro and touch-only paths
      // when _hasGyro, not used in pure touch-only lat/lon path)
      if (this._hasGyro) {
        this._touchBaseQuat = this.camera.quaternion.clone()
      }
    }

    this._onTouchMove = (e: TouchEvent) => {
      if (!this._isTouching || e.touches.length !== 1) return

      const dx = e.touches[0].clientX - this._lastTouchX
      const dy = e.touches[0].clientY - this._lastTouchY
      this._lastTouchX = e.touches[0].clientX
      this._lastTouchY = e.touches[0].clientY

      if (this._hasGyro && this._touchBaseQuat) {
        // Gyro device — use quaternion-based drag (preserves roll=0 during drag)
        const { THREE } = this
        const SENS = 0.003
        const MAX_PITCH_RAD = THREE.MathUtils.degToRad(MAX_PITCH_DEG)

        // Yaw: always applied (no vertical limit on horizontal panning)
        const yawQ = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 1, 0), dx * SENS,
        )
        this._touchBaseQuat.premultiply(yawQ)

        // Pitch: apply only if result is within ±MAX_PITCH_DEG from horizon
        const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(this._touchBaseQuat)
        camRight.y = 0
        if (camRight.lengthSq() < 0.001) camRight.set(1, 0, 0)
        camRight.normalize()
        const pitchQ = new THREE.Quaternion().setFromAxisAngle(camRight, dy * SENS)

        // Test result before committing
        const testQuat = this._touchBaseQuat.clone().premultiply(pitchQ)
        const fwd      = new THREE.Vector3(0, 0, -1).applyQuaternion(testQuat)
        // fwd.y = sin(pitchAngle): positive = looking up, negative = looking down
        const pitchAngle = Math.asin(Math.max(-1, Math.min(1, fwd.y)))
        if (Math.abs(pitchAngle) < MAX_PITCH_RAD) {
          this._touchBaseQuat.premultiply(pitchQ)
        }

        this.camera.quaternion.copy(this._touchBaseQuat)

      } else if (!this._hasGyro) {
        // Touch-only (no gyro on device)
        this._drag.lon -= dx * 0.25
        this._drag.lat += dy * 0.15
        this._drag.lat  = Math.max(-MAX_PITCH_DEG, Math.min(MAX_PITCH_DEG, this._drag.lat))
      }
    }

    this._onTouchEnd = () => {
      if (!this._isTouching) return
      this._isTouching = false

      // _hasGyro: leveling animation → gyro restarts clean on completion
      if (this._hasGyro) {
        this._startLevelingAnimation(this.camera.quaternion.clone())
      }
      // touch-only: no leveling needed, _drag.lon/lat hold the position
    }

    const canvas = document.getElementById('v360-canvas')!
    canvas.addEventListener('touchstart',  this._onTouchStart, { passive: true })
    canvas.addEventListener('touchmove',   this._onTouchMove,  { passive: true })
    canvas.addEventListener('touchend',    this._onTouchEnd,   { passive: true })
    canvas.addEventListener('touchcancel', this._onTouchEnd,   { passive: true })
  }

  private _stopTouchDrag(): void {
    const canvas = document.getElementById('v360-canvas')
    if (!canvas) return
    if (this._onTouchStart) canvas.removeEventListener('touchstart',  this._onTouchStart)
    if (this._onTouchMove)  canvas.removeEventListener('touchmove',   this._onTouchMove)
    if (this._onTouchEnd) {
      canvas.removeEventListener('touchend',    this._onTouchEnd)
      canvas.removeEventListener('touchcancel', this._onTouchEnd)
    }
    this._onTouchStart = this._onTouchMove = this._onTouchEnd = null
    this._isTouching = false
    this._cancelLeveling()
  }

  // ── Render loop ───────────────────────────────────────────────────────────

  private _startLoop(): void {
    const { THREE } = this

    const tick = () => {
      if (!this.renderer) return
      this.rafId = requestAnimationFrame(tick)

      if (this._isLeveling) {
        // Leveling animation runs its own RAF — render only
      } else if (this._gyroOk) {
        // Gyro active (not currently touching — _gyroOk is false during touch)
        // _gyroCorrection is identity here (reset on touchstart / leveling end)
        this.camera.quaternion.copy(this._computeGyroQuat()).multiply(this._gyroCorrection)
      } else if (!this._hasGyro) {
        // Pure touch-only device: lookAt from lon/lat
        const phi   = THREE.MathUtils.degToRad(90 - this._drag.lat)
        const theta = THREE.MathUtils.degToRad(this._drag.lon)
        this.camera.lookAt(
          500 * Math.sin(phi) * Math.cos(theta),
          500 * Math.cos(phi),
          500 * Math.sin(phi) * Math.sin(theta),
        )
      }
      // _hasGyro && !_gyroOk && _isTouching:
      //   camera was updated live in touchmove (_touchBaseQuat path). No-op here.
      // _hasGyro && !_gyroOk && !_isTouching && !_isLeveling:
      //   transient state during touchend before _startLevelingAnimation runs.
      //   Camera holds last touchmove position. Fine — next frame leveling starts.

      this.renderer.render(this.scene, this.camera)
    }

    tick()
  }
}