/**
 * FloorShadow
 * A soft circular white halo on the ground plane, centred under the dot tower.
 * Uses a canvas radial-gradient texture on a flat CircleGeometry.
 */
export class FloorShadow {
  private mesh: any = null
  private static cachedTexture: any = null

  private static readonly RADIUS  = 0.18   // metres
  private static readonly OPACITY = 0.55
  private static readonly SEGMENTS = 48

  constructor(
    private readonly scene: any,
    private readonly THREE: any,
  ) {}

  create(): void {
    const {THREE} = this

    const geo = new THREE.CircleGeometry(FloorShadow.RADIUS, FloorShadow.SEGMENTS)

    const mat = new THREE.MeshBasicMaterial({
      map:         this._getTexture(),
      transparent: true,
      opacity:     FloorShadow.OPACITY,
      depthWrite:  false,
      side:        THREE.DoubleSide,
    })

    this.mesh = new THREE.Mesh(geo, mat)
    // Rotate flat on the XZ plane
    this.mesh.rotation.x = -Math.PI / 2
    // Tiny Y offset to avoid z-fighting with the ground plane
    this.mesh.position.y = 0.002
    this.scene.add(this.mesh)
  }

  update(x: number, z: number): void {
    if (!this.mesh) return
    this.mesh.position.x = x
    this.mesh.position.z = z
  }

  fadeAndDispose(durationMs = 350): void {
    if (!this.mesh) return
    const mat   = this.mesh.material
    const start = performance.now()
    const init  = FloorShadow.OPACITY

    const tick = () => {
      const p = Math.min((performance.now() - start) / durationMs, 1)
      mat.opacity = init * (1 - p)
      if (p < 1) requestAnimationFrame(tick)
      else this._dispose()
    }
    requestAnimationFrame(tick)
  }

  dispose(): void {
    this._dispose()
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private _getTexture(): any {
    if (FloorShadow.cachedTexture) return FloorShadow.cachedTexture

    const size = 128
    const half = size / 2
    const canvas = document.createElement('canvas')
    canvas.width  = size
    canvas.height = size

    const ctx  = canvas.getContext('2d')!
    const grad = ctx.createRadialGradient(half, half, 0, half, half, half)
    grad.addColorStop(0,    'rgba(255,255,255,0.90)')
    grad.addColorStop(0.35, 'rgba(255,255,255,0.60)')
    grad.addColorStop(0.70, 'rgba(255,255,255,0.20)')
    grad.addColorStop(1,    'rgba(255,255,255,0.00)')

    ctx.fillStyle = grad
    ctx.fillRect(0, 0, size, size)

    const {THREE} = this
    FloorShadow.cachedTexture = new THREE.CanvasTexture(canvas)
    return FloorShadow.cachedTexture
  }

  private _dispose(): void {
    if (!this.mesh) return
    this.scene.remove(this.mesh)
    this.mesh.geometry.dispose()
    this.mesh.material.dispose()
    this.mesh = null
  }
}