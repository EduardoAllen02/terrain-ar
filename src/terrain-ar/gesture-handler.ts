// gesture-handler.ts
//
// Bugs fixed:
//   1. Touch not detected  → listen on `document` with { passive:false }
//                            (full-screen HTML overlays block window listeners)
//   2. Direction stale     → snapshot camera forward/right at touchstart,
//                            not live per-frame and not once at placement time.
//                            This means: after rotating the device and doing reset,
//                            the next touchstart captures the NEW orientation and
//                            "up" correctly maps to wherever the camera now faces.
//
// API is identical to the original — no changes needed in terrain-tap-place.ts:
//   const gestures = new GestureHandler(world, THREE, terrainEid)
//   gestures.attach()
//   gestures.detach()

const HORIZONTAL_SENSITIVITY = 0.003
const DEPTH_SENSITIVITY      = 0.003
const SCALE_SENSITIVITY      = 0.01
const MIN_SCALE              = 0.1
const MAX_SCALE              = 5.0

// Add this attribute to any container of interactive UI elements so that
// touches on buttons/sliders are not consumed by the gesture handler:
//   <div data-ar-ui> <button>Reset</button> <input type="range" …/> </div>
const UI_ATTR = 'data-ar-ui'

interface Vec2 { x: number; z: number }
interface Pt   { x: number; y: number }

export class GestureHandler {
  private world:      any
  private THREE:      any
  private terrainEid: number

  // ── active touches ────────────────────────────────────────────────────────
  // activeTouches : latest clientX/Y per touch identifier
  // prevTouches   : position from the previous move event (delta source)
  private activeTouches = new Map<number, Pt>()
  private prevTouches   = new Map<number, Pt>()
  private lastPinchDist: number | null = null

  // ── direction snapshot ────────────────────────────────────────────────────
  // Captured once at the FIRST touchstart of every gesture.
  // Guarantees that "finger up" always means "toward where you're now looking",
  // even after a reset or after rotating the device between gestures.
  private gestFwd:   Vec2 = { x: 0, z: -1 }
  private gestRight: Vec2 = { x: 1, z:  0 }

  // ── bound handlers (preserved for removeEventListener) ───────────────────
  private _bStart: (e: TouchEvent) => void
  private _bMove:  (e: TouchEvent) => void
  private _bEnd:   (e: TouchEvent) => void

  constructor(world: any, THREE: any, terrainEid: number) {
    this.world      = world
    this.THREE      = THREE
    this.terrainEid = terrainEid

    this._bStart = this._onStart.bind(this)
    this._bMove  = this._onMove .bind(this)
    this._bEnd   = this._onEnd  .bind(this)
  }

  // ── public API ────────────────────────────────────────────────────────────

  attach(): void {
    this.activeTouches.clear()
    this.prevTouches.clear()
    this.lastPinchDist = null

    // Use document-level listeners, NOT window.
    // A full-screen HTML overlay with pointer-events:auto will swallow events
    // before they bubble to `window`, but document listeners always fire first.
    // passive:false is required so we can call preventDefault() in _onMove.
    document.addEventListener('touchstart',  this._bStart, { passive: false })
    document.addEventListener('touchmove',   this._bMove,  { passive: false })
    document.addEventListener('touchend',    this._bEnd,   { passive: false })
    document.addEventListener('touchcancel', this._bEnd,   { passive: false })
  }

  detach(): void {
    document.removeEventListener('touchstart',  this._bStart)
    document.removeEventListener('touchmove',   this._bMove)
    document.removeEventListener('touchend',    this._bEnd)
    document.removeEventListener('touchcancel', this._bEnd)
    this.activeTouches.clear()
    this.prevTouches.clear()
    this.lastPinchDist = null
  }

  // ── private helpers ───────────────────────────────────────────────────────

  /**
   * Read the camera's current horizontal orientation from world.three.camera
   * and store the forward and right vectors (flattened to XZ).
   *
   * Called exactly once at the start of every new gesture (first finger down).
   *
   * Why this fixes the direction bug:
   *   - Old code: read camera quaternion live per-frame → stale after rotation
   *   - This code: snapshot at touchstart → every new gesture gets fresh orientation
   *   - After reset: the NEXT gesture is always a new touchstart → correct direction
   *
   * Scenario:
   *   1. Facing North, touch → gestFwd = North  → drag up moves terrain North  ✓
   *   2. Rotate to face East, reset, lift finger
   *   3. New touch → _snapshotDirection() → gestFwd = East
   *   4. Drag up moves terrain East  ✓
   */
  private _snapshotDirection(): void {
    // world.three.camera is the live Three.js PerspectiveCamera — no entity ID needed
    const cam = this.world?.three?.camera
    if (!cam) return

    // The camera looks down its local -Z axis
    const fwd = new this.THREE.Vector3(0, 0, -1)
    fwd.applyQuaternion(cam.quaternion)

    // Flatten to the horizontal plane (ignore device tilt up/down)
    fwd.y = 0
    if (fwd.lengthSq() < 1e-6) return  // degenerate: camera pointing straight up/down
    fwd.normalize()

    this.gestFwd = { x: fwd.x, z: fwd.z }

    // Right = fwd rotated 90° clockwise around Y  →  (fwd.z, 0, -fwd.x)
    this.gestRight = { x: fwd.z, z: -fwd.x }
  }

  /**
   * Returns true if the touch target is an interactive UI element.
   * These touches are passed through untouched so the overlay buttons/sliders work.
   */
  private _isUiTarget(e: TouchEvent): boolean {
    const el = e.target as HTMLElement | null
    if (!el) return false
    return (
      el.tagName === 'BUTTON' ||
      el.tagName === 'INPUT'  ||
      el.tagName === 'SELECT' ||
      el.closest(`[${UI_ATTR}]`) !== null
    )
  }

  // ── touch event handlers ──────────────────────────────────────────────────

  private _onStart(e: TouchEvent): void {
    if (this._isUiTarget(e)) return

    const wasEmpty = this.activeTouches.size === 0

    for (const t of Array.from(e.changedTouches)) {
      const pt: Pt = { x: t.clientX, y: t.clientY }
      this.activeTouches.set(t.identifier, pt)
      this.prevTouches.set(t.identifier, { ...pt })
    }

    // Snapshot direction at the very first finger of every new gesture.
    if (wasEmpty) {
      this._snapshotDirection()
    }

    // Initialise pinch baseline when a second finger joins
    if (this.activeTouches.size === 2) {
      const [a, b] = Array.from(this.activeTouches.values())
      this.lastPinchDist = Math.hypot(b.x - a.x, b.y - a.y)
    }
  }

  private _onMove(e: TouchEvent): void {
    if (this._isUiTarget(e)) return
    // Prevent native scroll / browser pinch-zoom while panning the model
    e.preventDefault()

    // Advance prev → current for every changed touch
    for (const t of Array.from(e.changedTouches)) {
      const existing = this.activeTouches.get(t.identifier)
      if (existing) {
        this.prevTouches.set(t.identifier, { ...existing })
      }
      this.activeTouches.set(t.identifier, { x: t.clientX, y: t.clientY })
    }

    if (this.activeTouches.size >= 2) {
      // ── two fingers: pinch-to-scale ──────────────────────────────────────
      const [a, b] = Array.from(this.activeTouches.values())
      const dist   = Math.hypot(b.x - a.x, b.y - a.y)
      if (this.lastPinchDist !== null) {
        this._applyScale((dist - this.lastPinchDist) * SCALE_SENSITIVITY)
      }
      this.lastPinchDist = dist

    } else if (this.activeTouches.size === 1) {
      // ── one finger: pan ───────────────────────────────────────────────────
      const [id]  = Array.from(this.activeTouches.keys())
      const curr  = this.activeTouches.get(id)!
      const prev  = this.prevTouches.get(id)
      if (!prev) return

      const dx = curr.x - prev.x
      const dy = curr.y - prev.y
      if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return
      this._applyPan(dx, dy)
    }
  }

  private _onEnd(e: TouchEvent): void {
    for (const t of Array.from(e.changedTouches)) {
      this.activeTouches.delete(t.identifier)
      this.prevTouches.delete(t.identifier)
    }
    if (this.activeTouches.size < 2) {
      this.lastPinchDist = null
    }
  }

  // ── transform appliers ────────────────────────────────────────────────────

  /**
   * Translate the terrain entity using the direction snapshot taken at gesture start.
   *
   * Screen → world mapping (using camera-relative snapshot):
   *   finger right (+dx)  →  gestRight  (camera's right in XZ plane)
   *   finger up   (−dy)   →  gestFwd    (camera's forward in XZ plane)
   *   (screen Y is inverted relative to world Z, hence the minus on dy)
   */
  private _applyPan(dx: number, dy: number): void {
    const obj = this.world.three.entityToObject.get(this.terrainEid)
    if (!obj) return

    const wp = new this.THREE.Vector3()
    obj.getWorldPosition(wp)

    this.world.setPosition(
      this.terrainEid,
      wp.x
        + this.gestRight.x * (dx  * HORIZONTAL_SENSITIVITY)
        + this.gestFwd.x   * (-dy * DEPTH_SENSITIVITY),
      wp.y,  // height controlled separately by the height slider
      wp.z
        + this.gestRight.z * (dx  * HORIZONTAL_SENSITIVITY)
        + this.gestFwd.z   * (-dy * DEPTH_SENSITIVITY),
    )
  }

  private _applyScale(delta: number): void {
    const obj = this.world.three.entityToObject.get(this.terrainEid)
    if (!obj) return

    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, obj.scale.x + delta))
    this.world.setScale(this.terrainEid, next, next, next)
  }
}