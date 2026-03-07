// gesture-handler.ts
//
// Constructor matches terrain-tap-place.ts exactly:
//   new GestureHandler(terrainEid, world, THREE)
//   gestures.attach()
//   gestures.detach()
//
// Bugs fixed vs previous versions:
//   1. Constructor arg order was wrong (world/THREE/terrainEid) — now (terrainEid/world/THREE)
//   2. Touch not detected: listen on `document` with { passive:false }, not `window`
//      A full-screen HTML overlay with pointer-events:auto swallows window listeners.
//      document.addEventListener fires BEFORE HTML elements can cancel the event.
//   3. Direction stale after rotation/reset: snapshot camera orientation at touchstart,
//      not per-frame. After reset + device rotation, the next touchstart captures the
//      current facing, so "finger up" always means "direction you're now looking".

const HORIZONTAL_SENSITIVITY = 0.003
const DEPTH_SENSITIVITY      = 0.003
const SCALE_SENSITIVITY      = 0.01
const MIN_SCALE              = 0.1
const MAX_SCALE              = 5.0

// Touches that land on elements with this attribute (or their children)
// are ignored by the gesture handler so UI controls remain usable.
// Usage in ArUiOverlay HTML: add data-ar-ui to the #ar-bottom-bar container.
const UI_ATTR = 'data-ar-ui'

interface Vec2 { x: number; z: number }
interface Pt   { x: number; y: number }

export class GestureHandler {
  private terrainEid: number
  private world:      any
  private THREE:      any

  // current and previous touch positions per identifier
  private activeTouches = new Map<number, Pt>()
  private prevTouches   = new Map<number, Pt>()
  private lastPinchDist: number | null = null

  // Camera-relative direction snapshot taken at the first touchstart of each gesture.
  // "finger up" = gestFwd direction in world XZ.
  private gestFwd:   Vec2 = { x: 0, z: -1 }
  private gestRight: Vec2 = { x: 1, z:  0 }

  private _bStart: (e: TouchEvent) => void
  private _bMove:  (e: TouchEvent) => void
  private _bEnd:   (e: TouchEvent) => void

  // ── Constructor matches terrain-tap-place.ts ──────────────────────────────
  constructor(terrainEid: number, world: any, THREE: any) {
    this.terrainEid = terrainEid
    this.world      = world
    this.THREE      = THREE
    this._bStart    = this._onStart.bind(this)
    this._bMove     = this._onMove .bind(this)
    this._bEnd      = this._onEnd  .bind(this)
  }

  // ── Public API ────────────────────────────────────────────────────────────

  attach(): void {
    this.activeTouches.clear()
    this.prevTouches.clear()
    this.lastPinchDist = null
    // document listeners receive events BEFORE any HTML overlay can swallow them.
    // passive:false lets us call preventDefault() in _onMove.
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

  // ── Direction snapshot ────────────────────────────────────────────────────

  private _snapshotDirection(): void {
    const cam = this.world?.three?.camera
    if (!cam) return

    const fwd = new this.THREE.Vector3(0, 0, -1)
    fwd.applyQuaternion(cam.quaternion)
    fwd.y = 0
    if (fwd.lengthSq() < 1e-6) return
    fwd.normalize()

    this.gestFwd   = { x: fwd.x, z: fwd.z }
    this.gestRight = { x: fwd.z, z: -fwd.x }   // 90° CW around Y
  }

  // ── UI target filter ──────────────────────────────────────────────────────

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

  // ── Touch handlers ────────────────────────────────────────────────────────

  private _onStart(e: TouchEvent): void {
    if (this._isUiTarget(e)) return

    const wasEmpty = this.activeTouches.size === 0

    for (const t of Array.from(e.changedTouches)) {
      const pt: Pt = { x: t.clientX, y: t.clientY }
      this.activeTouches.set(t.identifier, pt)
      this.prevTouches.set(t.identifier, { ...pt })
    }

    // Snapshot camera direction at the first touch of every new gesture.
    // This is the fix for the "direction doesn't update after reset" bug:
    // reset → device rotates → lift finger → new touchstart → fresh snapshot.
    if (wasEmpty) this._snapshotDirection()

    if (this.activeTouches.size === 2) {
      const [a, b] = Array.from(this.activeTouches.values())
      this.lastPinchDist = Math.hypot(b.x - a.x, b.y - a.y)
    }
  }

  private _onMove(e: TouchEvent): void {
    if (this._isUiTarget(e)) return
    e.preventDefault()

    for (const t of Array.from(e.changedTouches)) {
      const existing = this.activeTouches.get(t.identifier)
      if (existing) this.prevTouches.set(t.identifier, { ...existing })
      this.activeTouches.set(t.identifier, { x: t.clientX, y: t.clientY })
    }

    if (this.activeTouches.size >= 2) {
      const [a, b] = Array.from(this.activeTouches.values())
      const dist   = Math.hypot(b.x - a.x, b.y - a.y)
      if (this.lastPinchDist !== null) {
        this._applyScale((dist - this.lastPinchDist) * SCALE_SENSITIVITY)
      }
      this.lastPinchDist = dist

    } else if (this.activeTouches.size === 1) {
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
    if (this.activeTouches.size < 2) this.lastPinchDist = null
  }

  // ── Transform appliers ────────────────────────────────────────────────────

  private _applyPan(dx: number, dy: number): void {
    const obj = this.world.three.entityToObject.get(this.terrainEid)
    if (!obj) return

    const wp = new this.THREE.Vector3()
    obj.getWorldPosition(wp)

    this.world.setPosition(
      this.terrainEid,
      wp.x + this.gestRight.x * (dx  * HORIZONTAL_SENSITIVITY)
           + this.gestFwd.x   * (-dy * DEPTH_SENSITIVITY),
      wp.y,
      wp.z + this.gestRight.z * (dx  * HORIZONTAL_SENSITIVITY)
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