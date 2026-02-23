/**
 * GestureHandler — v3
 *
 * Single finger:
 *   ↑↓  → depth (forward/back along camera forward vector)
 *   ←→  → horizontal pan (left/right along camera right vector)
 *
 * Two fingers — mutually exclusive, determined by dominant axis:
 *   Dominant horizontal (dx >> dy) → ROTATION around model Y axis
 *   Dominant vertical   (dy >> dx) → SCALE (fingers apart = bigger, together = smaller)
 *
 * Gesture lock: once the dominant axis is identified it stays locked
 * until ALL fingers are lifted. This prevents accidental mode switching
 * mid-gesture and makes the UX feel intentional and precise.
 */

// ─── Tuning ───────────────────────────────────────────────────────────────────

const DEPTH_SENSITIVITY      = 0.005   // m per pixel (single finger depth)
const HORIZONTAL_SENSITIVITY = 0.005   // m per pixel (single finger pan)
const ROTATION_SENSITIVITY   = 2.5     // rad per normalised horizontal delta
const SCALE_MIN              = 0.02
const SCALE_MAX              = 5.0

// Two-finger gesture lock thresholds
const LOCK_THRESHOLD         = 18      // px total movement before we commit to a gesture
const DOMINANCE_RATIO        = 1.8     // dominant axis must be this much larger than other

// ─── Types ────────────────────────────────────────────────────────────────────

type TwoFingerMode = 'undecided' | 'rotation' | 'scale'

interface SingleFingerState {
  id:    number
  lastX: number
  lastY: number
}

interface TwoFingerState {
  idA:        number
  idB:        number
  // Accumulated deltas while undecided (used to determine dominant axis)
  accumDx:    number   // sum of |horizontal midpoint deltas|
  accumDy:    number   // sum of |spread changes| (for scale detection)
  // Baseline values captured at lock moment
  initSpread: number
  initScale:  number
  prevAngle:  number
  prevMidX:   number
  prevMidY:   number
  mode:       TwoFingerMode
}

// ─────────────────────────────────────────────────────────────────────────────

export class GestureHandler {
  private active = false
  private listeners: Array<[EventTarget, string, EventListener]> = []

  private sf: SingleFingerState | null = null
  private tf: TwoFingerState    | null = null

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

  private _on(
    target: EventTarget,
    type:   string,
    fn:     EventListener,
    opts?:  AddEventListenerOptions,
  ): void {
    target.addEventListener(type, fn, opts)
    this.listeners.push([target, type, fn])
  }

  // ── Touch start ───────────────────────────────────────────────────────────

  private _onStart = (e: TouchEvent): void => {
    const touches = Array.from(e.touches)

    if (touches.length >= 2) {
      // Cancel any single-finger gesture
      this.sf = null

      // Only init two-finger state if not already tracking
      if (!this.tf) {
        const a = touches[0]
        const b = touches[1]
        const mid = this._midpoint(a, b)
        this.tf = {
          idA:        a.identifier,
          idB:        b.identifier,
          accumDx:    0,
          accumDy:    0,
          initSpread: this._spread(a, b),
          initScale:  this._getScale(),
          prevAngle:  this._angle(a, b),
          prevMidX:   mid.x,
          prevMidY:   mid.y,
          mode:       'undecided',
        }
      }
      return
    }

    if (touches.length === 1 && !this.tf) {
      const t = touches[0]
      this.sf = {id: t.identifier, lastX: t.clientX, lastY: t.clientY}
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

      const currentSpread = this._spread(a, b)
      const currentAngle  = this._angle(a, b)
      const currentMid    = this._midpoint(a, b)

      // Deltas from previous frame
      const dMidX    = Math.abs(currentMid.x - this.tf.prevMidX)
      const dSpread  = Math.abs(currentSpread - this.tf.initSpread)

      // ── Undecided: accumulate movement to find dominant axis ────────────
      if (this.tf.mode === 'undecided') {
        this.tf.accumDx += dMidX
        this.tf.accumDy += Math.abs(currentSpread - (this.tf.initSpread + this.tf.accumDy))

        const totalMovement = this.tf.accumDx + dSpread

        if (totalMovement >= LOCK_THRESHOLD) {
          // Enough movement accumulated — determine dominant axis
          const horizScore = this.tf.accumDx
          const vertScore  = dSpread  // how much spread has changed

          if (horizScore > vertScore * DOMINANCE_RATIO) {
            this.tf.mode = 'rotation'
          } else if (vertScore > horizScore * DOMINANCE_RATIO) {
            this.tf.mode      = 'scale'
            this.tf.initSpread = currentSpread   // lock spread baseline at decision moment
            this.tf.initScale  = this._getScale()
          } else {
            // Not dominant enough — keep accumulating
          }
        }

        // Update prev values but don't apply anything yet
        this.tf.prevMidX  = currentMid.x
        this.tf.prevMidY  = currentMid.y
        this.tf.prevAngle = currentAngle
        return
      }

      // ── ROTATION mode ───────────────────────────────────────────────────
      if (this.tf.mode === 'rotation') {
        // Use horizontal midpoint delta directly for intuitive feel:
        // moving both fingers right → rotate right, left → rotate left
        const midDeltaX = currentMid.x - this.tf.prevMidX

        if (Math.abs(midDeltaX) > 0.2) {
          // Convert pixel delta to radians
          // Normalise by screen width so speed is consistent across devices
          const screenWidth  = window.innerWidth || 375
          const rotationRad  = (midDeltaX / screenWidth) * Math.PI * ROTATION_SENSITIVITY

          const half = rotationRad * 0.5
          this.world.transform.rotateSelf(this.terrainEid, {
            x: 0,
            y: Math.sin(half),
            z: 0,
            w: Math.cos(half),
          })
        }
      }

      // ── SCALE mode ──────────────────────────────────────────────────────
      if (this.tf.mode === 'scale') {
        // Ratio of current spread to spread at lock moment
        const ratio    = currentSpread / this.tf.initSpread
        const newScale = Math.max(SCALE_MIN, Math.min(SCALE_MAX, this.tf.initScale * ratio))
        this._setScale(newScale)
      }

      // Update prev values
      this.tf.prevMidX  = currentMid.x
      this.tf.prevMidY  = currentMid.y
      this.tf.prevAngle = currentAngle
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
    }
  }

  // ── Touch end ─────────────────────────────────────────────────────────────

  private _onEnd = (e: TouchEvent): void => {
    const remaining = Array.from(e.touches)

    if (remaining.length === 0) {
      // All fingers lifted — full reset
      this.sf = null
      this.tf = null
    } else if (remaining.length === 1) {
      // Dropped from two fingers to one
      this.tf = null
      const t = remaining[0]
      this.sf = {id: t.identifier, lastX: t.clientX, lastY: t.clientY}
    }
  }

  private _onCancel = (_e: TouchEvent): void => {
    this.sf = null
    this.tf = null
  }

  // ── Math helpers ──────────────────────────────────────────────────────────

  private _spread(a: Touch, b: Touch): number {
    const dx = a.clientX - b.clientX
    const dy = a.clientY - b.clientY
    return Math.sqrt(dx * dx + dy * dy) || 1
  }

  private _angle(a: Touch, b: Touch): number {
    return Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX)
  }

  private _midpoint(a: Touch, b: Touch): {x: number; y: number} {
    return {
      x: (a.clientX + b.clientX) / 2,
      y: (a.clientY + b.clientY) / 2,
    }
  }

  // ── ECS / Three.js accessors ──────────────────────────────────────────────

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
    this.world.three.scene.traverse((c: any) => {
      if (c.isCamera && !cam) cam = c
    })
    return cam
  }
}