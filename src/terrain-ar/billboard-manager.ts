export interface BillboardOptions {
  baseSize?:       number
  verticalOffset?: number
  debug?:          boolean
  onHotspotTap?:   (name: string) => void
}

// Asset folder per type — structure in repo:
//   assets/pois/hotspot/NAME.png
//   assets/pois/mountain/NAME.png
//   assets/pois/pin/NAME.png
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

  private _tapStart:      { x: number; y: number; t: number } | null = null
  private _tapListener:   ((e: TouchEvent) => void) | null = null
  private _tapEndListener:((e: TouchEvent) => void) | null = null

  constructor(
    private readonly THREE: any,
    opts: BillboardOptions = {},
  ) {
    this.opts = {
      baseSize:       opts.baseSize       ?? 0.8,
      verticalOffset: opts.verticalOffset ?? 0.025,
      debug:          opts.debug          ?? false,
      onHotspotTap:   opts.onHotspotTap   ?? (() => {}),
    }
  }

  // Returns names of all discovered hotspot nodes (for ExperienceRegistry)
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

      const prefix  = PREFIXES[type]
      const name    = node.name.slice(prefix.length)
      const url     = `${ASSET_PATHS[type]}${name}.png`

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

    for (const { sprite, anchor } of this.billboards) {
      anchor.getWorldPosition(_v3)
      _v3.y += opts.verticalOffset * ts
      sprite.position.copy(_v3)

      const size  = opts.baseSize * ts
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

  // ── Tap detection ──────────────────────────────────────────────────────────

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
    const hotspots  = this.billboards.filter(b => b.type === 'hotspot' && b.sprite.visible)
    if (!hotspots.length) return

    const cam = this._getCamera()
    if (!cam) return

    const tap = new this.THREE.Vector2(
       (clientX / window.innerWidth)  * 2 - 1,
      -(clientY / window.innerHeight) * 2 + 1,
    )

    const threshold = (44 / window.innerWidth) * 2
    let closest: Billboard | null = null
    let closestDist = Infinity

    for (const b of hotspots) {
      const ndc  = b.sprite.position.clone().project(cam)
      const dist = tap.distanceTo(new this.THREE.Vector2(ndc.x, ndc.y))
      if (dist < threshold && dist < closestDist) {
        closest     = b
        closestDist = dist
      }
    }

    if (closest) this.opts.onHotspotTap(closest.name)
  }

  private _getCamera(): any {
    let cam: any = null
    this.billboards[0]?.sprite.parent?.traverse?.((c: any) => {
      if (c.isCamera && !cam) cam = c
    })
    return cam
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

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
    const ctx    = canvas.getContext('2d')!
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