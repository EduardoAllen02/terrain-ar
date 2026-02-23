/**
 * GestureHandler — v2
 *
 * Single finger:
 *   ↑↓  → depth (forward/back along camera forward vector)
 *   ←→  → horizontal pan (along camera right vector)
 *
 * Two fingers (simultaneous):
 *   Pinch in/out  → scale model uniformly
 *   Rotation      → rotate model around its own Y axis
 */

const DEPTH_SENSITIVITY      = 0.005   // m per pixel vertical
const HORIZONTAL_SENSITIVITY = 0.005   // m per pixel horizontal
const SCALE_MIN              = 0.02
const SCALE_MAX              = 5.0
const ROTATION_SENSITIVITY   = 1.2

export class GestureHandler {
  private active = false
  private listeners: Array<[EventTarget, string, EventListener]> = []

  // Single-finger state
  private sf: { id: number; lastX: number; lastY: number } | null = null

  // Two-finger state
  private tf: {
    idA: number; idB: number
    initSpread: number
    initScale:  number
    initAngle:  number
  } | null = null

  constructor(
    private readonly terrainEid: any,
    private readonly world: any,
    private readonly THREE: any,
  ) {}

  // ── Public ────────────────────────────────────────────────────────────────

  attach(): void {
    if (this.active) return
    this.active = true
    this._on(window, 'touchstart',  this._onStart  as EventListener, {passive: false})
    this._on(window, 'touchmove',   this._onMove   as EventListener, {passive: false})
    this._on(window, 'touchend',    this._onEnd    as EventListener, {passive: false})
    this._on(window, 'touchcancel', this._onCancel as EventListener, {passive: false})
  }

  detach(): void {
    this.active = false
    for (const [t, type, fn] of this.listeners) t.removeEventListener(type, fn)
    this.listeners = []
    this.sf = null
    this.tf = null
  }

  // ── Wiring ────────────────────────────────────────────────────────────────

  private _on(target: EventTarget, type: string, fn: EventListener, opts?: AddEventListenerOptions) {
    target.addEventListener(type, fn, opts)
    this.listeners.push([target, type, fn])
  }

  // ── Handlers ──────────────────────────────────────────────────────────────

  private _onStart = (e: TouchEvent): void => {
    const touches = Array.from(e.touches)

    if (touches.length >= 2) {
      this.sf = null
      const a = touches[0]
      const b = touches[1]
      this.tf = {
        idA:        a.identifier,
        idB:        b.identifier,
        initSpread: this._spread(a, b),
        initScale:  this._getScale(),
        initAngle:  this._angle(a, b),
      }
      return
    }

    if (touches.length === 1 && !this.tf) {
      const t = touches[0]
      this.sf = {id: t.identifier, lastX: t.clientX, lastY: t.clientY}
    }
  }

  private _onMove = (e: TouchEvent): void => {
    e.preventDefault()
    const touches = Array.from(e.touches)

    // ── Two-finger: pinch scale + rotation (simultaneous) ─────────────────
    if (touches.length >= 2 && this.tf) {
      const a = touches.find(t => t.identifier === this.tf!.idA) ?? touches[0]
      const b = touches.find(t => t.identifier === this.tf!.idB) ?? touches[1]

      // Scale via spread ratio
      const spread     = this._spread(a, b)
      const scaleRatio = spread / this.tf.initSpread
      const newScale   = Math.max(SCALE_MIN, Math.min(SCALE_MAX, this.tf.initScale * scaleRatio))
      this._setScale(newScale)

      // Rotation via angle delta (incremental)
      const angle      = this._angle(a, b)
      const angleDelta = (angle - this.tf.initAngle) * ROTATION_SENSITIVITY
      if (Math.abs(angleDelta) > 0.0005) {
        const half = angleDelta * 0.5
        this.world.transform.rotateSelf(this.terrainEid, {
          x: 0, y: Math.sin(half), z: 0, w: Math.cos(half),
        })
        this.tf.initAngle = angle
      }
      return
    }

    // ── Single finger: depth + horizontal pan ─────────────────────────────
    if (this.sf && touches.length === 1) {
      const t = touches.find(t => t.identifier === this.sf!.id)
      if (!t) return

      const dx = t.clientX - this.sf.lastX
      const dy = t.clientY - this.sf.lastY
      this.sf.lastX = t.clientX
      this.sf.lastY = t.clientY

      if (Math.abs(dx) < 0.3 && Math.abs(dy) < 0.3) return

      const cam = this._getCamera()
      if (!cam) return

      const {THREE} = this

      // Forward vector (depth) — projected on XZ
      const forward = new THREE.Vector3(0, 0, -1)
        .applyQuaternion(cam.quaternion)
        .setY(0)
        .normalize()

      // Right vector (horizontal) — projected on XZ
      const right = new THREE.Vector3(1, 0, 0)
        .applyQuaternion(cam.quaternion)
        .setY(0)
        .normalize()

      // dy < 0 = finger up = model moves away; dy > 0 = toward camera
      const depthDelta = -dy * DEPTH_SENSITIVITY
      // dx > 0 = finger right = model moves right
      const horizDelta =  dx * HORIZONTAL_SENSITIVITY

      const pos = this.world.transform.getWorldPosition(this.terrainEid)
      this.world.transform.setWorldPosition(this.terrainEid, {
        x: pos.x + forward.x * depthDelta + right.x * horizDelta,
        y: pos.y,
        z: pos.z + forward.z * depthDelta + right.z * horizDelta,
      })
    }
  }

  private _onEnd = (e: TouchEvent): void => {
    const remaining = Array.from(e.touches)
    if (remaining.length === 0) {
      this.sf = null
      this.tf = null
    } else if (remaining.length === 1 && this.tf) {
      this.tf = null
      const t = remaining[0]
      this.sf = {id: t.identifier, lastX: t.clientX, lastY: t.clientY}
    }
  }

  private _onCancel = (_e: TouchEvent): void => {
    this.sf = null
    this.tf = null
  }

  // ── Math ──────────────────────────────────────────────────────────────────

  private _spread(a: Touch, b: Touch): number {
    const dx = a.clientX - b.clientX
    const dy = a.clientY - b.clientY
    return Math.sqrt(dx * dx + dy * dy) || 1
  }

  private _angle(a: Touch, b: Touch): number {
    return Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX)
  }

  // ── Accessors ─────────────────────────────────────────────────────────────

  private _getScale(): number {
    const obj = this.world.three.entityToObject.get(this.terrainEid)
    return obj?.scale.x ?? 1
  }

  private _setScale(s: number): void {
    const obj = this.world.three.entityToObject.get(this.terrainEid)
    if (obj) obj.scale.set(s, s, s)
  }

  private _getCamera(): any {
    let cam: any = null
    this.world.three.scene.traverse((c: any) => { if (c.isCamera && !cam) cam = c })
    return cam
  }
}