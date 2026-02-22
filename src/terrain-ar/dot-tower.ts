/**
 * DotTower
 * Creates and animates a fine vertical column of dots in Three.js.
 * Dots flow upward in a slow helix pattern, giving a "holographic scan" feel.
 */
export class DotTower {
  private points: any = null
  private posArray!: Float32Array
  private elapsed = 0

  private static readonly DOT_COUNT = 70
  private static readonly TOWER_HEIGHT = 1.4  // metres — adjust to match preview height
  private static readonly HELIX_RADIUS = 0.014
  private static readonly HELIX_TURNS = 3
  private static readonly FLOW_SPEED = 0.45   // upward flow speed (units/sec normalised)
  private static readonly ROTATION_SPEED = 0.4 // helix spin speed (rad/sec)
  private static readonly DOT_SIZE = 0.011

  constructor(
    private readonly scene: any,
    private readonly THREE: any,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────────────────

  create(): void {
    const {THREE} = this
    const count = DotTower.DOT_COUNT

    this.posArray = new Float32Array(count * 3)

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(this.posArray, 3))

    const material = new THREE.PointsMaterial({
      color: 0x4fc3f7,
      size: DotTower.DOT_SIZE,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
      sizeAttenuation: true,
    })

    this.points = new THREE.Points(geometry, material)
    this.elapsed = 0
    this._writeDotPositions()
    this.scene.add(this.points)
  }

  /**
   * Call every frame from onTick.
   * @param x  World position X (cursor on ground)
   * @param y  World position Y (ground level)
   * @param z  World position Z (cursor on ground)
   * @param dt Delta time in seconds
   */
  update(x: number, y: number, z: number, dt: number): void {
    if (!this.points) return
    this.elapsed += dt
    this.points.position.set(x, y, z)
    this._writeDotPositions()
  }

  setVisible(visible: boolean): void {
    if (this.points) this.points.visible = visible
  }

  /** Fade out dots over `durationMs` then dispose. */
  fadeAndDispose(durationMs = 400): void {
    if (!this.points) return
    const material = this.points.material
    const start = performance.now()

    const tick = () => {
      const progress = Math.min((performance.now() - start) / durationMs, 1)
      material.opacity = 0.88 * (1 - progress)
      if (progress < 1) {
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

  // ─────────────────────────────────────────────────────────────────────────
  // Internal
  // ─────────────────────────────────────────────────────────────────────────

  private _writeDotPositions(): void {
    const count = DotTower.DOT_COUNT
    const height = DotTower.TOWER_HEIGHT
    const radius = DotTower.HELIX_RADIUS
    const turns = DotTower.HELIX_TURNS
    const flow = DotTower.FLOW_SPEED
    const spin = DotTower.ROTATION_SPEED

    for (let i = 0; i < count; i++) {
      const t = i / count
      // Flowing Y: each dot moves upward and wraps
      const flowedT = (t + this.elapsed * flow) % 1.0
      const yPos = flowedT * height

      // Helix angle: spiral based on position, plus time-based rotation
      const angle = flowedT * Math.PI * 2 * turns + this.elapsed * spin

      // Vary radius slightly for organic feel
      const r = radius * (1 + 0.35 * Math.sin(i * 1.7 + this.elapsed * 0.8))

      this.posArray[i * 3]     = Math.cos(angle) * r
      this.posArray[i * 3 + 1] = yPos
      this.posArray[i * 3 + 2] = Math.sin(angle) * r
    }

    if (this.points) {
      this.points.geometry.attributes.position.needsUpdate = true
    }
  }

  private _dispose(): void {
    if (!this.points) return
    this.scene.remove(this.points)
    this.points.geometry.dispose()
    this.points.material.dispose()
    this.points = null
  }
}