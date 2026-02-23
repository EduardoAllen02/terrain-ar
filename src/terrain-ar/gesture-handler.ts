/**
 * GestureHandler — v4
 *
 * Two-finger gestures (simultaneous, independent metrics):
 *
 *   ROTATION — driven by the change in ANGLE of the line connecting the two fingers
 *     Upper-left  + Lower-right moving apart  → counter-clockwise
 *     Upper-right + Lower-left  moving apart  → clockwise
 *
 *   SCALE — driven by the change in DISTANCE (spread) between the two fingers
 *     Fingers spreading apart  → model gets bigger
 *     Fingers pinching together → model gets smaller
 *
 * Single finger:
 *   ↑↓  → depth (forward / back along camera forward vector)
 *   ←→  → horizontal pan (left / right along camera right vector)
 */

const DEPTH_SENSITIVITY      = 0.005
const HORIZONTAL_SENSITIVITY = 0.005
const SCALE_MIN              = 0.02
const SCALE_MAX              = 5.0
const MIN_SPREAD             = 10
// Single-finger rotation sensitivity (radians per pixel of horizontal drag)
const ROTATE_SF_SENSITIVITY  = 0.008

export class GestureHandler {
  private active = false
  private listeners: Array<[EventTarget, string, EventListener]> = []

  // ── Single-finger state ───────────────────────────────────────────────────
  // mode 'pan'    → finger landed ON the model  → move near/far + left/right
  // mode 'rotate' → finger landed OFF the model → rotate model left/right
  private sf: {
    id:    number
    lastX: number
    lastY: number
    mode:  'pan' | 'rotate'
  } | null = null

  // ── Two-finger state ──────────────────────────────────────────────────────
  private tf: {
    idA:       number
    idB:       number
    prevAngle: number   // angle of line A→B (radians) at previous frame
    prevSpread: number  // distance between fingers at previous frame
    baseScale:  number  // model scale when gesture started
    initSpread: number  // spread when gesture started (for ratio-based scale)
  } | null = null

  constructor(
    private readonly terrainEid: any,
    private readonly world: any,
    private readonly THREE: any,
  ) {}

  // ── Public API ────────────────────────────────────────────────────────────

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

  // ── Event wiring ──────────────────────────────────────────────────────────

  private _on(
    target: EventTarget,
    type: string,
    fn: EventListener,
    opts?: AddEventListenerOptions,
  ): void {
    target.addEventListener(type, fn, opts)
    this.listeners.push([target, type, fn])
  }

  // ── Touch start ───────────────────────────────────────────────────────────

  private _onStart = (e: TouchEvent): void => {
    const touches = Array.from(e.touches)

    if (touches.length >= 2) {
      this.sf = null  // cancel single finger

      if (!this.tf) {
        const a = touches[0]
        const b = touches[1]
        const spread = this._spread(a, b)
        this.tf = {
          idA:        a.identifier,
          idB:        b.identifier,
          prevAngle:  this._angle(a, b),
          prevSpread: spread,
          baseScale:  this._getScale(),
          initSpread: spread,
        }
      }
      return
    }

    if (touches.length === 1 && !this.tf) {
      const t    = touches[0]
      const hits = this._hitTestModel(t.clientX, t.clientY)
      this.sf = {
        id:    t.identifier,
        lastX: t.clientX,
        lastY: t.clientY,
        mode:  hits ? 'pan' : 'rotate',
      }
    }
  }

  // ── Touch move ────────────────────────────────────────────────────────────

  private _onMove = (e: TouchEvent): void => {
    e.preventDefault()
    const touches = Array.from(e.touches)

    // ── Two-finger ────────────────────────────────────────────────────────

    if (touches.length >= 2 && this.tf) {
      const a = touches.find(t => t.identifier === this.tf!.idA) ?? touches[0]
      const b = touches.find(t => t.identifier === this.tf!.idB) ?? touches[1]

      const currentAngle  = this._angle(a, b)
      const currentSpread = this._spread(a, b)

      // ── SCALE only ────────────────────────────────────────────────────
      if (currentSpread > MIN_SPREAD && this.tf.initSpread > MIN_SPREAD) {
        const ratio    = currentSpread / this.tf.initSpread
        const newScale = Math.max(SCALE_MIN, Math.min(SCALE_MAX, this.tf.baseScale * ratio))
        this._setScale(newScale)
      }

      this.tf.prevAngle  = currentAngle
      this.tf.prevSpread = currentSpread
      return
    }

    // ── Single finger ─────────────────────────────────────────────────────

    if (this.sf && touches.length === 1) {
      const t = touches.find(t => t.identifier === this.sf!.id)
      if (!t) return

      const dx = t.clientX - this.sf.lastX
      const dy = t.clientY - this.sf.lastY
      this.sf.lastX = t.clientX
      this.sf.lastY = t.clientY

      if (Math.abs(dx) < 0.3 && Math.abs(dy) < 0.3) return

      // ── PAN mode: finger on model → move near/far + left/right ───────────
      if (this.sf.mode === 'pan') {
        const cam = this._getCamera()
        if (!cam) return

        const {THREE} = this

        const forward = new THREE.Vector3(0, 0, -1)
          .applyQuaternion(cam.quaternion)
          .setY(0)
          .normalize()

        const right = new THREE.Vector3(1, 0, 0)
          .applyQuaternion(cam.quaternion)
          .setY(0)
          .normalize()

        const depthDelta = -dy * DEPTH_SENSITIVITY
        const horizDelta =  dx * HORIZONTAL_SENSITIVITY

        const pos = this.world.transform.getWorldPosition(this.terrainEid)
        this.world.transform.setWorldPosition(this.terrainEid, {
          x: pos.x + forward.x * depthDelta + right.x * horizDelta,
          y: pos.y,
          z: pos.z + forward.z * depthDelta + right.z * horizDelta,
        })
        return
      }

      // ── ROTATE mode: finger off model → rotate model on Y axis ───────────
      if (this.sf.mode === 'rotate' && Math.abs(dx) > 0.3) {
        const rot  = dx * ROTATE_SF_SENSITIVITY
        const half = rot * 0.5
        this.world.transform.rotateSelf(this.terrainEid, {
          x: 0,
          y: Math.sin(half),
          z: 0,
          w: Math.cos(half),
        })
      }
    }
  }

  // ── Touch end ─────────────────────────────────────────────────────────────

  private _onEnd = (e: TouchEvent): void => {
    const remaining = Array.from(e.touches)

    if (remaining.length === 0) {
      this.sf = null
      this.tf = null
    } else if (remaining.length === 1) {
      this.tf = null
      const t = remaining[0]
      const hits = this._hitTestModel(t.clientX, t.clientY)
      this.sf = {id: t.identifier, lastX: t.clientX, lastY: t.clientY, mode: hits ? 'pan' : 'rotate'}
    }
  }

  private _onCancel = (_e: TouchEvent): void => {
    this.sf = null
    this.tf = null
  }

  // ── Math helpers ──────────────────────────────────────────────────────────

  /** Euclidean distance between two touch points. */
  private _spread(a: Touch, b: Touch): number {
    const dx = a.clientX - b.clientX
    const dy = a.clientY - b.clientY
    return Math.sqrt(dx * dx + dy * dy)
  }

  /**
   * Angle (radians) of the vector from touch A to touch B.
   * Uses atan2 so it covers full ±π range.
   */
  private _angle(a: Touch, b: Touch): number {
    return Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX)
  }

  /**
   * Shortest signed angle delta between two atan2 angles.
   * Handles wrap-around at ±π correctly.
   */
  private _angleDelta(prev: number, current: number): number {
    let delta = current - prev
    // Normalise to [-π, π]
    while (delta >  Math.PI) delta -= 2 * Math.PI
    while (delta < -Math.PI) delta += 2 * Math.PI
    return delta
  }

  // ── ECS / Three.js accessors ──────────────────────────────────────────────

  private _getScale(): number {
    // Read from ECS — source of truth for scale
    const ecs = (window as any).ecs
    if (ecs?.Scale?.has(this.world, this.terrainEid)) {
      return ecs.Scale.get(this.world, this.terrainEid).x
    }
    // Fallback to Three.js
    const obj = this.world.three.entityToObject.get(this.terrainEid)
    return obj?.scale.x ?? 1
  }

  private _setScale(s: number): void {
    // Must go through ECS — setting Three.js obj.scale directly gets
    // overwritten every frame by the ECS Scale component.
    const ecs = (window as any).ecs
    if (ecs?.Scale) {
      ecs.Scale.set(this.world, this.terrainEid, {x: s, y: s, z: s})
    } else {
      // Fallback: direct Three.js (only if ECS not ready)
      const obj = this.world.three.entityToObject.get(this.terrainEid)
      if (obj) obj.scale.set(s, s, s)
    }
  }

  /**
   * Cast a ray from screen position (clientX, clientY) into the scene.
   * Returns true if it intersects any mesh of the terrain model.
   * Uses Three.js Raycaster with NDC coordinates.
   */
  private _hitTestModel(clientX: number, clientY: number): boolean {
    const cam = this._getCamera()
    if (!cam) return false

    const obj = this.world.three.entityToObject.get(this.terrainEid)
    if (!obj) return false

    const {THREE} = this

    // Convert screen coords to Normalised Device Coordinates [-1, 1]
    const ndcX =  (clientX / window.innerWidth)  * 2 - 1
    const ndcY = -(clientY / window.innerHeight) * 2 + 1

    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera({x: ndcX, y: ndcY}, cam)

    // Collect all meshes in the terrain object
    const meshes: any[] = []
    obj.traverse((child: any) => { if (child.isMesh) meshes.push(child) })

    const intersects = raycaster.intersectObjects(meshes, false)
    return intersects.length > 0
  }

  private _getCamera(): any {
    let cam: any = null
    this.world.three.scene.traverse((c: any) => {
      if (c.isCamera && !cam) cam = c
    })
    return cam
  }
}