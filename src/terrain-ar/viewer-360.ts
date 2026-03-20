/**
 * Viewer360 — v2  (iOS-fixed)
 *
 * Changes vs previous:
 *  - open(): gyro permission & manifest load in parallel via Promise.all so
 *    DeviceOrientationEvent.requestPermission() fires within the user-gesture
 *    call stack on iOS (calling it after any prior `await` expires the gesture
 *    context → silent SecurityError → no gyro).
 *  - _initRenderer(): powerPreference:'low-power', pixel ratio capped at 1.0
 *    on iOS, fewer sphere segments to reduce GPU memory pressure.
 *  - _fetchTexture(): on iOS uses a canvas-based loader (_fetchTextureIOS) that
 *    downsamples to ≤4096×2048 before uploading to GPU, preventing the
 *    AR-terrain + panorama combined memory spike that crashes iOS Safari.
 *  - WebGL context-loss handler added so the page degrades gracefully instead
 *    of hanging with a black screen.
 *
 * Multi-image per hotspot with a sliding-window texture cache.
 *
 * ── Directory layout ─────────────────────────────────────────────────────────
 *
 *   assets/360/manifest.json
 *   assets/360/<folder name on disk>/<image stem>.jpg
 *
 * ── manifest.json format ─────────────────────────────────────────────────────
 *
 *   {
 *     "BLENDER_HOTSPOT_NAME": {
 *       "folder": "Exact folder name on disk",
 *       "images": ["stem1", "stem2", ...],
 *       "labels": ["Display name 1", "Display name 2", ...]   ← optional
 *     },
 *     ...
 *   }
 */

import {probeGyroscope} from './device-check'

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_PATH    = 'assets/360/'
const IMAGE_EXT    = '.jpg'
const MANIFEST_URL = `${BASE_PATH}manifest.json`

// Maximum texture dimensions uploaded to GPU on iOS.
// A 4096×2048 RGBA texture = ~32 MB GPU memory — safe alongside the AR terrain.
const IOS_MAX_TEX_W = 4096
const IOS_MAX_TEX_H = 2048

interface HotspotEntry {
  folder: string
  images: string[]
  labels?: string[]
}
type Manifest = Record<string, HotspotEntry>

// ── iOS detection (shared internally) ────────────────────────────────────────

function isIOSDevice(): boolean {
  return (
    /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
  )
}

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

      /* ── Top bar: X close on the left ── */
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
  // iPad axes are transposed vs iPhone (landscape-natural vs portrait-natural),
  // so the correction mirrors: iPhone uses `raw`, iPad uses `90 - raw`.
  // Portrait (raw=90): 90-90=0 → no correction needed  ✓
  // Landscape (raw=0): 90-0=90 → applies -90° via qOrient  ✓
  return isIPad ? 90 - raw : raw
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
  private _gyroOk = false
  private _euler:   any = null
  private _q1:      any = null
  private _qOrient: any = null
  private _zee:     any = null

  // ── Touch drag (fallback when no gyro) ───────────────────────────────────
  private _drag = { active: false, lastX: 0, lastY: 0, lon: 0, lat: 0 }
  private _onTouchStart: ((e: TouchEvent) => void) | null = null
  private _onTouchMove:  ((e: TouchEvent) => void) | null = null
  private _onTouchEnd:   (() => void)              | null = null

  constructor(private readonly THREE: any) {}

  // ── Public API ────────────────────────────────────────────────────────────

  async open(hotspotName: string, onClose: () => void): Promise<void> {
    injectStyles()

    // ── iOS CRITICAL: DeviceOrientationEvent.requestPermission() MUST be
    // called before any prior `await` in this function. Any `await` that
    // completes before the call expires the browser's user-gesture context
    // and iOS throws a silent SecurityError, leaving the viewer without gyro.
    //
    // Solution: start both the manifest fetch AND the gyro permission request
    // simultaneously via Promise.all — both calls begin in the same synchronous
    // call-stack tick as the user tap that opened this viewer.
    const [manifest, gyroOk] = await Promise.all([
      this._loadManifest(),
      this._requestGyroPermission(),
    ])

    this.currentHotspot = hotspotName
    const entry = manifest?.[hotspotName]
    this.currentFolder  = entry?.folder  ?? hotspotName
    this.currentImages  = entry?.images  ?? []
    this.currentIdx     = 0

    if (this.currentImages.length === 0) {
      onClose()
      return
    }

    this._buildOverlay(hotspotName, gyroOk, onClose)
    this._initRenderer()
    this._startResizeHandler()
    if (gyroOk) this._startGyro()
    else         this._startTouchDrag()
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

  /**
   * iOS-safe texture loader.
   * Draws the image through a 2D canvas capped at IOS_MAX_TEX_W × IOS_MAX_TEX_H
   * before uploading to GPU. This keeps the combined AR terrain + panorama
   * memory footprint within iOS Safari's per-tab GPU budget.
   */
  private _fetchTextureIOS(url: string): Promise<any> {
    return new Promise(resolve => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        let w = img.naturalWidth
        let h = img.naturalHeight
        if (w > IOS_MAX_TEX_W || h > IOS_MAX_TEX_H) {
          const ratio = Math.min(IOS_MAX_TEX_W / w, IOS_MAX_TEX_H / h)
          w = Math.floor(w * ratio)
          h = Math.floor(h * ratio)
        }
        try {
          const canvas = document.createElement('canvas')
          canvas.width  = w
          canvas.height = h
          const ctx = canvas.getContext('2d')
          if (!ctx || !this.THREE) { resolve(null); return }
          ctx.drawImage(img, 0, 0, w, h)
          const tex = new this.THREE.CanvasTexture(canvas)
          tex.colorSpace = this.THREE.SRGBColorSpace ?? this.THREE.sRGBEncoding
          resolve(tex)
        } catch {
          resolve(null)
        }
      }
      img.onerror = () => resolve(null)
      img.src = url
    })
  }

  private _fetchTexture(folder: string, filename: string): Promise<any> {
    const key = this._key(folder, filename)

    if (this.texCache.has(key))   return Promise.resolve(this.texCache.get(key))
    if (this.texPending.has(key)) return this.texPending.get(key)!

    const url = `${BASE_PATH}${folder}/${filename}${IMAGE_EXT}`

    // On iOS, use the canvas-based loader that caps dimensions before GPU upload.
    if (isIOSDevice()) {
      const promise = this._fetchTextureIOS(url).then(tex => {
        this.texCache.set(key, tex)
        this.texPending.delete(key)
        return tex
      })
      this.texPending.set(key, promise)
      return promise
    }

    // Non-iOS: standard THREE.TextureLoader path.
    const promise = new Promise<any>(resolve => {
      if (!this.texLoader) { resolve(null); return }

      this.texLoader.load(
        url,
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

    this._showLoading()

    const tex = await this._fetchTexture(folder, imgs[newIdx])
    this._applySphereTexture(tex)
    this.currentIdx = newIdx

    this._hideLoading()
    this._updateNavButtons()
    this._updateDots()
    this._updateTitle()

    this._drag.lon = 0; this._drag.lat = 0

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
    const hintText = gyroOk ? 'Move phone to explore' : 'Drag to explore'

    const div = document.createElement('div')
    div.id = 'v360-overlay'
    div.innerHTML = `
      <canvas id="v360-canvas"></canvas>
      <div id="v360-loading"><div class="v360-spinner"></div></div>

      <div id="v360-topbar">
        <button id="v360-close-360" aria-label="Back to AR">
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
          Previous
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

    // powerPreference: 'low-power' lets iOS choose a less memory-hungry GPU
    // path, reducing the chance of a combined AR + 360 memory crash.
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: false,
        powerPreference: 'low-power',
      })
    } catch (e) {
      console.warn('[Viewer360] WebGLRenderer creation failed:', e)
      // Renderer is null — _startLoop() checks for this and bails out.
      return
    }

    // iOS: pixel ratio 1.0 — halves framebuffer memory vs the default 2.0 on
    // Retina displays, leaving more headroom for the panorama texture.
    const ios = isIOSDevice()
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, ios ? 1.0 : 1.5))
    this.renderer.setSize(window.innerWidth, window.innerHeight)

    this.scene  = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000)

    // Fewer segments on iOS to reduce GPU geometry memory.
    const [wSegs, hSegs] = ios ? [48, 32] : [60, 40]
    const geo = new THREE.SphereGeometry(500, wSegs, hSegs)
    geo.scale(-1, 1, 1)
    this.sphere = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x1a2a3a }))
    this.scene.add(this.sphere)

    this.texLoader = new THREE.TextureLoader()
    this._euler    = new THREE.Euler()
    this._q1       = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5))
    this._qOrient  = new THREE.Quaternion()
    this._zee      = new THREE.Vector3(0, 0, 1)

    // WebGL context-loss handler — prevents an invisible hang on iOS when the
    // browser reclaims GPU memory and invalidates our context.
    canvas.addEventListener('webglcontextlost', (e: Event) => {
      e.preventDefault()
      console.warn('[Viewer360] WebGL context lost — cancelling render loop')
      cancelAnimationFrame(this.rafId)
    }, false)

    canvas.addEventListener('webglcontextrestored', () => {
      console.warn('[Viewer360] WebGL context restored')
      // Re-apply current texture and restart the loop.
      const key = this._key(this.currentFolder, this.currentImages[this.currentIdx] ?? '')
      const tex = this.texCache.get(key) ?? null
      this._applySphereTexture(tex)
      this._startLoop()
    }, false)
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
        // This call is safe because _requestGyroPermission() is now always
        // started before any prior `await` in open() (via Promise.all).
        // iOS sees it as within the user-gesture call stack.
        const result = await DOE.requestPermission()
        if (result !== 'granted') return false
      } catch {
        // SecurityError if called outside gesture context, or if the user
        // dismissed the prompt. Fall through to touch-drag mode.
        return false
      }
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

  // ── Touch drag (fallback when no gyro) ────────────────────────────────────

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