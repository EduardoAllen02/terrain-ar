/**
 * GestureHandler — v6 (ground-plane drag)
 *
 * Single finger — DRAG
 *   Casts a ray from the camera through the touch point onto a horizontal
 *   plane at the model's current Y. The model follows the finger exactly,
 *   like sliding a piece on a table. Camera direction is IRRELEVANT —
 *   this completely eliminates the "direction stale after rotation/reset" bug.
 *
 * Two fingers — PINCH TO SCALE
 *   Unchanged from v5: ratio of current spread / initial spread.
 *
 * External API unchanged — no edits needed in terrain-tap-place.ts:
 *   new GestureHandler(terrainEid, world, THREE)
 *   gestures.attach()
 *   gestures.detach()
 *
 * Camera lookup uses scene.traverse (same as the original v5 that worked).
 * world.three.camera was tried but caused movement to stop entirely,
 * so we stay with traverse which is proven to return a valid camera object.
 */

const SCALE_MIN  = 0.02
const MIN_SPREAD = 10

export class GestureHandler {
  private active    = false
  private listeners: Array<[EventTarget, string, EventListener]> = []

  // ── single-finger drag state ──────────────────────────────────────────────
  // dragPlaneY  : world Y of the horizontal drag plane (model Y at drag start)
  // dragOffset  : model world pos minus the first ray-hit on the plane
  //               so the model doesn't snap its centre to the finger
  private sf: {
    id:         number
    dragPlaneY: number
    dragOffset: any     // THREE.Vector3  (XZ only, Y always 0)
  } | null = null

  // ── two-finger pinch state ────────────────────────────────────────────────
  private tf: {
    idA: number; idB: number
    baseScale: number; initSpread: number; prevSpread: number
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

  // ── Private helpers ───────────────────────────────────────────────────────

  private _on(
    target: EventTarget, type: string, fn: EventListener,
    opts?: AddEventListenerOptions,
  ): void {
    target.addEventListener(type, fn, opts)
    this.listeners.push([target, type, fn])
  }

  // Returns the first camera found by scene.traverse — same method used in
  // the original v5 which was proven to detect touches and move the model.
  private _getCamera(): any {
    let cam: any = null
    this.world.three.scene.traverse((c: any) => { if (c.isCamera && !cam) cam = c })
    return cam
  }

  // Convert a clientX/Y touch position to NDC [-1..1] for THREE.Raycaster.
  private _toNDC(clientX: number, clientY: number): any {
    return new this.THREE.Vector2(
      ( clientX / window.innerWidth)  * 2 - 1,
      -(clientY / window.innerHeight) * 2 + 1,
    )
  }

  /**
   * Cast a ray from the camera through NDC coords onto a horizontal plane
   * at world Y = planeY. Returns the THREE.Vector3 hit point, or null if
   * the ray is parallel to the plane (extremely unlikely in normal AR use).
   */
  private _rayHitAtY(clientX: number, clientY: number, planeY: number): any | null {
    const cam = this._getCamera()
    if (!cam) return null

    const raycaster = new this.THREE.Raycaster()
    raycaster.setFromCamera(this._toNDC(clientX, clientY), cam)

    // Horizontal plane: normal = (0,1,0), constant = -planeY
    const plane = new this.THREE.Plane(new this.THREE.Vector3(0, 1, 0), -planeY)
    const hit   = new this.THREE.Vector3()
    const ok    = raycaster.ray.intersectPlane(plane, hit)
    return ok ? hit : null
  }

  private _getModelWorldPos(): any | null {
    const obj = this.world.three.entityToObject.get(this.terrainEid)
    if (!obj) return null
    const v = new this.THREE.Vector3()
    obj.getWorldPosition(v)
    return v
  }

  // ── Touch handlers ────────────────────────────────────────────────────────

  private _onStart = (e: TouchEvent): void => {
    const touches = Array.from(e.touches)

    if (touches.length >= 2) {
      // ── two fingers: start pinch ──────────────────────────────────────────
      this.sf = null
      if (!this.tf) {
        const a = touches[0], b = touches[1]
        const spread = this._spread(a, b)
        this.tf = {
          idA: a.identifier, idB: b.identifier,
          baseScale: this._getScale(), initSpread: spread, prevSpread: spread,
        }
      }
      return
    }

    if (touches.length === 1 && !this.tf) {
      // ── one finger: start ground-plane drag ───────────────────────────────
      const t    = touches[0]
      const mPos = this._getModelWorldPos()
      if (!mPos) return

      const planeY = mPos.y
      const hit    = this._rayHitAtY(t.clientX, t.clientY, planeY)
      if (!hit) return

      // Offset keeps the model from snapping its centre to the finger.
      const offset = new this.THREE.Vector3(mPos.x - hit.x, 0, mPos.z - hit.z)

      this.sf = { id: t.identifier, dragPlaneY: planeY, dragOffset: offset }
    }
  }

  private _onMove = (e: TouchEvent): void => {
    e.preventDefault()
    const touches = Array.from(e.touches)

    if (touches.length >= 2 && this.tf) {
      // ── pinch-to-scale ────────────────────────────────────────────────────
      const a = touches.find(t => t.identifier === this.tf!.idA) ?? touches[0]
      const b = touches.find(t => t.identifier === this.tf!.idB) ?? touches[1]
      const spread = this._spread(a, b)
      if (spread > MIN_SPREAD && this.tf.initSpread > MIN_SPREAD) {
        const s = Math.max(SCALE_MIN, this.tf.baseScale * (spread / this.tf.initSpread))
        this._setScale(s)
      }
      this.tf.prevSpread = spread
      return
    }

    if (this.sf && touches.length === 1) {
      // ── ground-plane drag ─────────────────────────────────────────────────
      const t = touches.find(t => t.identifier === this.sf!.id)
      if (!t) return

      const hit = this._rayHitAtY(t.clientX, t.clientY, this.sf.dragPlaneY)
      if (!hit) return

      this.world.setPosition(
        this.terrainEid,
        hit.x + this.sf.dragOffset.x,
        this.sf.dragPlaneY,
        hit.z + this.sf.dragOffset.z,
      )
    }
  }

  private _onEnd = (e: TouchEvent): void => {
    const remaining = Array.from(e.touches)
    if (remaining.length === 0) {
      this.sf = null
      this.tf = null
    } else if (remaining.length === 1) {
      // Pinch released — restart drag from the remaining finger
      this.tf = null
      const t    = remaining[0]
      const mPos = this._getModelWorldPos()
      if (!mPos) { this.sf = null; return }
      const planeY = mPos.y
      const hit    = this._rayHitAtY(t.clientX, t.clientY, planeY)
      if (!hit)    { this.sf = null; return }
      const offset = new this.THREE.Vector3(mPos.x - hit.x, 0, mPos.z - hit.z)
      this.sf = { id: t.identifier, dragPlaneY: planeY, dragOffset: offset }
    }
  }

  private _onCancel = (_e: TouchEvent): void => {
    this.sf = null
    this.tf = null
  }

  // ── Scale helpers (unchanged from v5) ────────────────────────────────────

  private _spread(a: Touch, b: Touch): number {
    const dx = a.clientX - b.clientX, dy = a.clientY - b.clientY
    return Math.sqrt(dx * dx + dy * dy)
  }

  private _getScale(): number {
    const ecs = (window as any).ecs
    if (ecs?.Scale?.has(this.world, this.terrainEid))
      return ecs.Scale.get(this.world, this.terrainEid).x
    return this.world.three.entityToObject.get(this.terrainEid)?.scale.x ?? 1
  }

  private _setScale(s: number): void {
    const ecs = (window as any).ecs
    if (ecs?.Scale) {
      ecs.Scale.set(this.world, this.terrainEid, {x: s, y: s, z: s})
    } else {
      const obj = this.world.three.entityToObject.get(this.terrainEid)
      if (obj) obj.scale.set(s, s, s)
    }
  }
}