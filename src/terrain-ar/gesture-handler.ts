/**
 * GestureHandler
 * Post-placement touch gesture controls for the terrain model.
 *
 * Gestures:
 * ──────────
 *  Single finger drag ↑↓  → move model along camera forward vector (depth)
 *  Two-finger pinch        → scale model uniformly
 *  Two-finger rotation     → rotate model around its own Y axis
 *    (upper finger right + lower finger left = rotate right, vice-versa)
 *
 * Call attach() after placement, detach() to clean up.
 */

const DEPTH_SENSITIVITY    = 0.004  // metres per pixel of vertical drag
const SCALE_MIN            = 0.05
const SCALE_MAX            = 3.0
const ROTATION_SENSITIVITY = 1.0    // multiplier on angle delta

interface Touch2 {
  id: number
  x:  number
  y:  number
}

export class GestureHandler {
  private active    = false
  private listeners: Array<[EventTarget, string, EventListener]> = []

  // Single-finger state
  private sf: { id: number; startY: number; lastY: number } | null = null

  // Two-finger state
  private tf: {
    a:            Touch2
    b:            Touch2
    initSpread:   number
    initScale:    number
    initAngle:    number
  } | null = null

  constructor(
    private readonly terrainEid: number,
    private readonly world: any,
    private readonly THREE: any,
  ) {}

  attach(): void {
    if (this.active) return
    this.active = true

    this._on(window, 'touchstart',  this._onTouchStart  as EventListener, {passive: false})
    this._on(window, 'touchmove',   this._onTouchMove   as EventListener, {passive: false})
    this._on(window, 'touchend',    this._onTouchEnd    as EventListener, {passive: false})
    this._on(window, 'touchcancel', this._onTouchCancel as EventListener, {passive: false})
  }

  detach(): void {
    this.active = false
    for (const [target, type, fn] of this.listeners) {
      target.removeEventListener(type, fn)
    }
    this.listeners = []
    this.sf = null
    this.tf = null
  }

  // ── Internal event wiring ─────────────────────────────────────────────────

  private _on(
    target: EventTarget,
    type: string,
    fn: EventListener,
    opts?: AddEventListenerOptions,
  ): void {
    target.addEventListener(type, fn, opts)
    this.listeners.push([target, type, fn])
  }

  // ── Touch handlers ────────────────────────────────────────────────────────

  private _onTouchStart = (e: TouchEvent): void => {
    const touches = Array.from(e.touches)

    if (touches.length === 1 && !this.tf) {
      // Start single-finger depth drag
      const t = touches[0]
      this.sf = {id: t.identifier, startY: t.clientY, lastY: t.clientY}
      this.tf = null
    }

    if (touches.length >= 2) {
      // Transition to two-finger mode — cancel any single-finger drag
      this.sf = null
      const a = touches[0]
      const b = touches[1]

      const spread    = this._spread(a, b)
      const angle     = this._angle(a, b)
      const curScale  = this._getScale()

      this.tf = {
        a:          {id: a.identifier, x: a.clientX, y: a.clientY},
        b:          {id: b.identifier, x: b.clientX, y: b.clientY},
        initSpread: spread,
        initScale:  curScale,
        initAngle:  angle,
      }
    }
  }

  private _onTouchMove = (e: TouchEvent): void => {
    e.preventDefault()
    const touches = Array.from(e.touches)

    // ── Two-finger gestures ───────────────────────────────────────────────

    if (touches.length >= 2 && this.tf) {
      const rawA = touches.find(t => t.identifier === this.tf!.a.id) ?? touches[0]
      const rawB = touches.find(t => t.identifier === this.tf!.b.id) ?? touches[1]

      // Pinch → scale
      const currentSpread = this._spread(rawA, rawB)
      const scaleRatio    = currentSpread / this.tf.initSpread
      let   newScale      = this.tf.initScale * scaleRatio
      newScale = Math.max(SCALE_MIN, Math.min(SCALE_MAX, newScale))
      this._setScale(newScale)

      // Rotation → Y axis
      // Angle between two fingers; delta drives rotation
      const currentAngle  = this._angle(rawA, rawB)
      const angleDelta    = (currentAngle - this.tf.initAngle) * ROTATION_SENSITIVITY

      const half = angleDelta * 0.5
      const dy   = Math.sin(half)
      const dw   = Math.cos(half)

      this.world.transform.rotateSelf(this.terrainEid, {x: 0, y: dy, z: 0, w: dw})

      // Update reference angle for incremental deltas
      this.tf.initAngle = currentAngle

      return
    }

    // ── Single-finger depth drag ──────────────────────────────────────────

    if (this.sf && touches.length === 1) {
      const t = touches.find(t => t.identifier === this.sf!.id)
      if (!t) return

      const deltaY = t.clientY - this.sf.lastY  // positive = finger moving down
      this.sf.lastY = t.clientY

      if (Math.abs(deltaY) < 0.5) return

      // Get camera forward direction projected on XZ plane
      const cameraObj = this._getCamera()
      if (!cameraObj) return

      const {THREE} = this
      const forward = new THREE.Vector3(0, 0, -1)
        .applyQuaternion(cameraObj.quaternion)
        .setY(0)
        .normalize()

      // deltaY < 0 = finger moves up = model moves away from camera (into scene)
      // deltaY > 0 = finger moves down = model moves toward camera
      const depthDelta = -deltaY * DEPTH_SENSITIVITY

      const currentPos = this.world.transform.getWorldPosition(this.terrainEid)
      this.world.transform.setWorldPosition(this.terrainEid, {
        x: currentPos.x + forward.x * depthDelta,
        y: currentPos.y,
        z: currentPos.z + forward.z * depthDelta,
      })
    }
  }

  private _onTouchEnd = (e: TouchEvent): void => {
    const remaining = Array.from(e.touches)

    if (remaining.length === 0) {
      this.sf = null
      this.tf = null
    } else if (remaining.length === 1 && this.tf) {
      // Dropped to one finger — reset to single-finger mode
      this.tf = null
      const t  = remaining[0]
      this.sf  = {id: t.identifier, startY: t.clientY, lastY: t.clientY}

      // Freeze current scale as new baseline
      // (already set per-frame, nothing extra needed)
    }
  }

  private _onTouchCancel = (e: TouchEvent): void => {
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
   * Signed angle (radians) from touch A to touch B.
   * This naturally captures the "two-finger rotation" gesture.
   */
  private _angle(a: Touch, b: Touch): number {
    return Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX)
  }

  // ── ECS / Three.js accessors ──────────────────────────────────────────────

  private _getScale(): number {
    const {ecs} = this.world as any
    // Read current X scale as uniform scale
    try {
      const obj = this.world.three.entityToObject.get(this.terrainEid)
      return obj ? obj.scale.x : 1
    } catch {
      return 1
    }
  }

  private _setScale(s: number): void {
    // Use world.transform if available, fall back to direct Three.js
    const obj = this.world.three.entityToObject.get(this.terrainEid)
    if (obj) obj.scale.set(s, s, s)
  }

  private _getCamera(): any {
    let cam: any = null
    this.world.three.scene.traverse((c: any) => {
      if (c.isCamera && !cam) cam = c
    })
    return cam
  }
}