/**
 * DotTower — v2
 * A clean vertical dotted line in Three.js — like the BARCIS reference image.
 * - Pure vertical, zero horizontal deviation
 * - Soft round dots via radial-gradient canvas texture
 * - White, evenly distributed, large, no trembling
 */
export class DotTower {
  private points: any = null
  private static cachedTexture: any = null  // shared GPU texture across instances

  // ── Tuning ─────────────────────────────────────────────────────────────────
  private static readonly DOT_COUNT    = 9      // fewer = bigger, more breathing room
  private static readonly TOWER_HEIGHT = 1.35   // metres — must match PREVIEW_HEIGHT
  private static readonly DOT_SIZE     = 0.055  // world-space diameter
  private static readonly DOT_OPACITY  = 0.92

  constructor(
    private readonly scene: any,
    private readonly THREE: any,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────

  create(): void {
    const {THREE} = this
    const count = DotTower.DOT_COUNT

    // Positions computed once — perfectly straight vertical line, no curves
    const posArray = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1)                         // 0 at ground, 1 at top
      posArray[i * 3]     = 0                            // X — dead center
      posArray[i * 3 + 1] = t * DotTower.TOWER_HEIGHT   // Y — evenly spaced
      posArray[i * 3 + 2] = 0                            // Z — dead center
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3))

    const material = new THREE.PointsMaterial({
      color:           0xffffff,
      size:            DotTower.DOT_SIZE,
      map:             this._getSoftCircleTexture(),
      transparent:     true,
      opacity:         DotTower.DOT_OPACITY,
      depthWrite:      false,
      sizeAttenuation: true,
      alphaTest:       0.01,
    })

    this.points = new THREE.Points(geometry, material)
    this.scene.add(this.points)
  }

  /**
   * Snap tower base to world position.
   * Pass the already-smoothed cursor coords — no internal lerp here,
   * that was causing the trembling.
   */
  update(x: number, y: number, z: number): void {
    if (this.points) {
      this.points.position.set(x, y, z)
    }
  }

  setVisible(visible: boolean): void {
    if (this.points) this.points.visible = visible
  }

  /** Fade opacity to 0 over `durationMs`, then remove from scene. */
  fadeAndDispose(durationMs = 350): void {
    if (!this.points) return
    const mat   = this.points.material
    const start = performance.now()
    const initialOpacity = DotTower.DOT_OPACITY

    const tick = () => {
      const p = Math.min((performance.now() - start) / durationMs, 1)
      mat.opacity = initialOpacity * (1 - p)
      if (p < 1) {
        requestAnimationFrame(tick)
      } else {
        this._dispose()
      }
    }
    requestAnimationFrame(tick)
  }

  dispose(): void {
    this._dispose()
  }

  // ── Private ───────────────────────────────────────────────────────────────

  /**
   * 64×64 canvas texture: solid white center → transparent edge.
   * Cached statically so all instances share one GPU upload.
   */
  private _getSoftCircleTexture(): any {
    if (DotTower.cachedTexture) return DotTower.cachedTexture

    const size = 64
    const half = size / 2
    const canvas = document.createElement('canvas')
    canvas.width  = size
    canvas.height = size

    const ctx  = canvas.getContext('2d')!
    const grad = ctx.createRadialGradient(half, half, 0, half, half, half)
    grad.addColorStop(0,    'rgba(255,255,255,1.00)')
    grad.addColorStop(0.40, 'rgba(255,255,255,0.95)')
    grad.addColorStop(0.70, 'rgba(255,255,255,0.40)')
    grad.addColorStop(1.00, 'rgba(255,255,255,0.00)')

    ctx.fillStyle = grad
    ctx.fillRect(0, 0, size, size)

    const {THREE} = this
    DotTower.cachedTexture = new THREE.CanvasTexture(canvas)
    return DotTower.cachedTexture
  }

  private _dispose(): void {
    if (!this.points) return
    this.scene.remove(this.points)
    this.points.geometry.dispose()
    this.points.material.dispose()
    this.points = null
  }
}