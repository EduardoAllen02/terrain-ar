export interface BillboardOptions {
  texturesPath?: string
  textureExt?: string
  baseSize?: number
  referenceDistance?: number
  verticalOffset?: number
  nodePrefix?: string
  debug?: boolean
}

interface Billboard {
  sprite: any
  anchor: any
  name:   string
}

export class BillboardManager {
  private billboards: Billboard[] = []
  private _v3: any
  private opts: Required<BillboardOptions>

  constructor(
    private readonly THREE: any,
    opts: BillboardOptions = {},
  ) {
    this.opts = {
      texturesPath:      opts.texturesPath      ?? 'assets/pois/',
      textureExt:        opts.textureExt        ?? 'png',
      baseSize:          opts.baseSize          ?? 0.12,
      referenceDistance: opts.referenceDistance ?? 1.5,
      verticalOffset:    opts.verticalOffset    ?? 0.02,
      nodePrefix:        opts.nodePrefix        ?? 'poi_',
      debug:             opts.debug             ?? false,
    }
  }

  async init(terrainObject: any, scene: any): Promise<void> {
    const { THREE, opts } = this
    this._v3 = new THREE.Vector3()
    const loader   = new THREE.TextureLoader()
    const pending: Promise<void>[] = []

    terrainObject.traverse((node: any) => {
      if (!node.name.startsWith(opts.nodePrefix)) return
      const poiName = node.name.slice(opts.nodePrefix.length)
      const url     = `${opts.texturesPath}${poiName}.${opts.textureExt}`

      pending.push(new Promise<void>(resolve => {
        loader.load(
          url,
          (texture: any) => {
            const sprite = this._makeSprite(texture)
            scene.add(sprite)
            this.billboards.push({ sprite, anchor: node, name: poiName })
            resolve()
          },
          undefined,
          () => {
            if (opts.debug) {
              const sprite = this._makeDebugSprite(poiName)
              scene.add(sprite)
              this.billboards.push({ sprite, anchor: node, name: poiName })
            }
            resolve()
          },
        )
      }))
    })

    await Promise.all(pending)
  }

  update(camera: any): void {
    const { opts, _v3 } = this
    for (const { sprite, anchor } of this.billboards) {
      anchor.getWorldPosition(_v3)
      _v3.y += opts.verticalOffset
      sprite.position.copy(_v3)

      const dist  = camera.position.distanceTo(_v3)
      const scale = (opts.baseSize * dist) / opts.referenceDistance
      const ratio = this._getAspect(sprite)
      sprite.scale.set(scale * ratio, scale, 1)
    }
  }

  dispose(scene: any): void {
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

  private _makeSprite(texture: any): any {
    const { THREE } = this
    texture.colorSpace = THREE.SRGBColorSpace ?? THREE.sRGBEncoding
    const mat = new THREE.SpriteMaterial({
      map:             texture,
      transparent:     true,
      depthTest:       false,
      depthWrite:      false,
      sizeAttenuation: true,
    })
    const sprite = new THREE.Sprite(mat)
    sprite.renderOrder = 999
    return sprite
  }

  private _makeDebugSprite(label: string): any {
    const canvas  = document.createElement('canvas')
    canvas.width  = 256
    canvas.height = 64
    const ctx     = canvas.getContext('2d')!
    ctx.fillStyle = 'rgba(255,80,80,0.85)'
    ctx.fillRect(0, 0, 256, 64)
    ctx.fillStyle = '#fff'
    ctx.font      = 'bold 22px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(label, 128, 40)
    const texture = new this.THREE.CanvasTexture(canvas)
    return this._makeSprite(texture)
  }

  private _getAspect(sprite: any): number {
    const img = sprite.material.map?.image
    if (!img || !img.height) return 2
    return img.width / img.height
  }
}