export interface BillboardOptions {
  baseSize?:       number
  verticalOffset?: number
  debug?:          boolean
  onHotspotTap?:   (name: string) => void
  scaleOverrides?: Record<string, number>
  /**
   * Returns the live AR camera used for NDC hit-projection.
   *
   * MUST be provided as `() => world.three.camera` from the ECS component.
   * Without this, BillboardManager falls back to scene.traverse() which finds
   * the 8th Wall static camera placeholder — causing incorrect NDC projection
   * and missed/wrong hotspot taps, especially on iOS where device orientation
   * is reflected in the camera matrix.
   */
  getCamera?:      () => any
}

const ASSET_PATHS = {
  hotspot:  'assets/pois/hotspot/',
  mountain: 'assets/pois/mountain/',
  pin:      'assets/pois/pin/',
} as const

const PREFIXES = {
  hotspot:  'hotspot_',
  mountain: 'mountain_',
  pin:      'pin_',
} as const

type PoiType = keyof typeof PREFIXES

const TAP_MAX_MOVE_PX = 10
const TAP_MAX_MS      = 300

interface Billboard {
  sprite: any
  anchor: any
  name:   string
  type:   PoiType
}

export class BillboardManager {
  private billboards: Billboard[] = []
  private _v3:    any
  private _scale: any
  private opts:   Required<BillboardOptions>

  private _tapStart:       { x: number; y: number; t: number } | null = null
  private _tapListener:    ((e: TouchEvent) => void) | null = null
  private _tapEndListener: ((e: TouchEvent) => void) | null = null

  constructor(
    private readonly THREE: any,
    opts: BillboardOptions = {},
  ) {
    this.opts = {
      baseSize:       opts.baseSize       ?? 0.10,
      verticalOffset: opts.verticalOffset ?? 0,
      debug:          opts.debug          ?? false,
      onHotspotTap:   opts.onHotspotTap   ?? (() => {}),
      scaleOverrides: opts.scaleOverrides  ?? {},
      getCamera:      opts.getCamera       ?? (() => null),
    }
  }

  async init(terrainObject: any, scene: any): Promise<string[]> {
    const { THREE, opts } = this
    this._v3    = new THREE.Vector3()
    this._scale = new THREE.Vector3()

    const loader   = new THREE.TextureLoader()
    const pending: Promise<void>[] = []
    const hotspotNames: string[]   = []

    terrainObject.traverse((node: any) => {
      const type = this._detectType(node.name)
      if (!type) return

      const prefix = PREFIXES[type]
      const name   = node.name.slice(prefix.length)
      const url    = `${ASSET_PATHS[type]}${name}.png`

      if (type === 'hotspot') hotspotNames.push(name)

      pending.push(new Promise<void>(resolve => {
        loader.load(
          url,
          (texture: any) => {
            const sprite = this._makeSprite(texture)
            scene.add(sprite)
            this.billboards.push({ sprite, anchor: node, name, type })
            resolve()
          },
          undefined,
          () => {
            if (opts.debug) {
              const sprite = this._makeDebugSprite(name, type)
              scene.add(sprite)
              this.billboards.push({ sprite, anchor: node, name, type })
            }
            resolve()
          },
        )
      }))
    })

    await Promise.all(pending)
    this._attachTapListener()
    return hotspotNames
  }

  update(terrainObject: any): void {
    const { opts, _v3, _scale } = this
    terrainObject.getWorldScale(_scale)
    const ts = _scale.x

    for (const { sprite, anchor, name } of this.billboards) {
      anchor.getWorldPosition(_v3)
      sprite.position.copy(_v3)

      const multiplier = opts.scaleOverrides[name] ?? 1.0
      const size  = opts.baseSize * multiplier * ts
      const ratio = this._getAspect(sprite)
      sprite.scale.set(size * ratio, size, 1)
    }
  }

  dispose(scene: any): void {
    this._detachTapListener()
    for (const { sprite } of this.billboards) {
      scene.remove(sprite)
      sprite.material.map?.dispose()
      sprite.material.dispose()
    }
    this.billboards = []
  }

  getSprite(name: string): any | undefined {
    return this.billboards.find(b => b.name === name)?.sprite
  }

  private _attachTapListener(): void {
    this._tapListener = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      this._tapStart = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() }
    }
    this._tapEndListener = (e: TouchEvent) => {
      if (!this._tapStart) return
      const start = this._tapStart
      this._tapStart = null
      const t     = e.changedTouches[0]
      const moved = Math.hypot(t.clientX - start.x, t.clientY - start.y)
      if (Date.now() - start.t > TAP_MAX_MS || moved > TAP_MAX_MOVE_PX) return
      this._checkHotspotHit(t.clientX, t.clientY)
    }
    window.addEventListener('touchstart', this._tapListener,    { passive: true })
    window.addEventListener('touchend',   this._tapEndListener, { passive: true })
  }

  private _detachTapListener(): void {
    if (this._tapListener)    window.removeEventListener('touchstart', this._tapListener)
    if (this._tapEndListener) window.removeEventListener('touchend',   this._tapEndListener)
    this._tapListener = this._tapEndListener = null
  }

  private _checkHotspotHit(clientX: number, clientY: number): void {
    const hotspots = this.billboards.filter(b => b.type === 'hotspot' && b.sprite.visible)
    if (!hotspots.length) return
    const cam = this._getCamera()
    if (!cam) return

    const tapX = (clientX / window.innerWidth)  * 2 - 1
    const tapY = -(clientY / window.innerHeight) * 2 + 1

    // Minimum touch target: 44px converted to NDC width units
    const minNDC = (44 / window.innerWidth) * 2

    let closest: Billboard | null = null
    let closestDist = Infinity

    for (const b of hotspots) {
      const tipNDC = b.sprite.position.clone().project(cam)

      // Sprites always face the camera
      const camUp = new this.THREE.Vector3(0, 1, 0)
        .transformDirection(cam.matrixWorld)
        .normalize()

      // World position of the visual top of the sprite
      const topWorld = b.sprite.position.clone()
        .addScaledVector(camUp, b.sprite.scale.y)
      const topNDC = topWorld.clone().project(cam)

      // Visual centre in NDC = midpoint between tip and top
      const cx = (tipNDC.x + topNDC.x) * 0.5
      const cy = (tipNDC.y + topNDC.y) * 0.5

      const ndcH     = Math.abs(topNDC.y - tipNDC.y)
      const ndcW     = ndcH * (b.sprite.scale.x / b.sprite.scale.y)
      const hitR     = Math.max(Math.max(ndcH, ndcW) * 0.6, minNDC)

      const dist = Math.hypot(tapX - cx, tapY - cy)
      if (dist < hitR && dist < closestDist) {
        closest = b
        closestDist = dist
      }
    }

    if (closest) this.opts.onHotspotTap(closest.name)
  }

  /**
   * Returns the live AR camera for NDC projection.
   *
   * Priority:
   *  1. opts.getCamera() — should be () => world.three.camera, provided by
   *     the ECS component. This is the camera with real device orientation.
   *  2. scene.traverse() fallback — finds the static 8th Wall placeholder.
   *     Used only if getCamera was not provided or returns null/undefined.
   *     Kept as fallback so the manager still works in non-8th-Wall contexts.
   */
  private _getCamera(): any {
    const fromOpt = this.opts.getCamera?.()
    if (fromOpt) return fromOpt

    // Fallback: traverse the scene (static placeholder on 8th Wall — works
    // for hit detection only when device orientation hasn't changed the matrix)
    let cam: any = null
    this.billboards[0]?.sprite.parent?.traverse?.((c: any) => {
      if (c.isCamera && !cam) cam = c
    })
    return cam
  }

  private _detectType(nodeName: string): PoiType | null {
    for (const [type, prefix] of Object.entries(PREFIXES)) {
      if (nodeName.startsWith(prefix)) return type as PoiType
    }
    return null
  }

  private _makeSprite(texture: any): any {
    const { THREE } = this
    texture.colorSpace = THREE.SRGBColorSpace ?? THREE.sRGBEncoding
    const mat = new THREE.SpriteMaterial({
      map: texture, transparent: true,
      depthTest: false, depthWrite: false, sizeAttenuation: true,
    })
    const sprite = new THREE.Sprite(mat)
    sprite.center.set(0.5, 0)
    sprite.renderOrder = 999
    return sprite
  }

  private _makeDebugSprite(label: string, type: PoiType): any {
    const colors: Record<PoiType, string> = {
      hotspot:  'rgba(255,140,0,0.9)',
      mountain: 'rgba(80,140,255,0.9)',
      pin:      'rgba(60,200,120,0.9)',
    }
    const canvas = document.createElement('canvas')
    canvas.width = 256; canvas.height = 64
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = colors[type]
    ctx.fillRect(0, 0, 256, 64)
    ctx.fillStyle = '#fff'
    ctx.font = 'bold 20px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(label, 128, 40)
    return this._makeSprite(new this.THREE.CanvasTexture(canvas))
  }

  private _getAspect(sprite: any): number {
    const img = sprite.material.map?.image
    return img?.height ? img.width / img.height : 2
  }
}