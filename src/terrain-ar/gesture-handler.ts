/**
 * GestureHandler — v5
 *
 * Two-finger:
 *   SCALE — driven by spread distance between fingers
 *
 * Single finger:
 *   PAN — move model forward/back + left/right relative to the camera's
 *         current orientation, read live every frame so controls always
 *         match wherever the user is facing.
 */

const DEPTH_SENSITIVITY      = 0.005
const HORIZONTAL_SENSITIVITY = 0.005
const SCALE_MIN              = 0.02
const SCALE_MAX              = Infinity
const MIN_SPREAD             = 10

export class GestureHandler {
  private active = false
  private listeners: Array<[EventTarget, string, EventListener]> = []

  private sf: { id: number; lastX: number; lastY: number } | null = null
  private tf: {
    idA: number; idB: number
    prevSpread: number; baseScale: number; initSpread: number
  } | null = null

  constructor(
    private readonly terrainEid: any,
    private readonly world: any,
    private readonly THREE: any,
  ) {}

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

  private _on(target: EventTarget, type: string, fn: EventListener, opts?: AddEventListenerOptions): void {
    target.addEventListener(type, fn, opts)
    this.listeners.push([target, type, fn])
  }

  private _onStart = (e: TouchEvent): void => {
    const touches = Array.from(e.touches)
    if (touches.length >= 2) {
      this.sf = null
      if (!this.tf) {
        const a = touches[0], b = touches[1]
        const spread = this._spread(a, b)
        this.tf = {idA: a.identifier, idB: b.identifier,
                   prevSpread: spread, baseScale: this._getScale(), initSpread: spread}
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

    if (touches.length >= 2 && this.tf) {
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
      const t = touches.find(t => t.identifier === this.sf!.id)
      if (!t) return
      const dx = t.clientX - this.sf.lastX
      const dy = t.clientY - this.sf.lastY
      this.sf.lastX = t.clientX
      this.sf.lastY = t.clientY
      if (Math.abs(dx) < 0.3 && Math.abs(dy) < 0.3) return

      // Read camera orientation live every move event — always reflects
      // the user's current facing direction.
      const cam = this._getCamera()
      if (!cam) return
      const {THREE} = this
      const fwd   = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion).setY(0).normalize()
      const right = new THREE.Vector3(1, 0,  0).applyQuaternion(cam.quaternion).setY(0).normalize()
      const pos   = this.world.transform.getWorldPosition(this.terrainEid)
      this.world.transform.setWorldPosition(this.terrainEid, {
        x: pos.x + fwd.x * (-dy * DEPTH_SENSITIVITY) + right.x * (dx * HORIZONTAL_SENSITIVITY),
        y: pos.y,
        z: pos.z + fwd.z * (-dy * DEPTH_SENSITIVITY) + right.z * (dx * HORIZONTAL_SENSITIVITY),
      })
    }
  }

  private _onEnd = (e: TouchEvent): void => {
    const remaining = Array.from(e.touches)
    if (remaining.length === 0)      { this.sf = null; this.tf = null }
    else if (remaining.length === 1) {
      this.tf = null
      const t = remaining[0]
      this.sf = {id: t.identifier, lastX: t.clientX, lastY: t.clientY}
    }
  }

  private _onCancel = (_e: TouchEvent): void => { this.sf = null; this.tf = null }

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
    if (ecs?.Scale) ecs.Scale.set(this.world, this.terrainEid, {x: s, y: s, z: s})
    else {
      const obj = this.world.three.entityToObject.get(this.terrainEid)
      if (obj) obj.scale.set(s, s, s)
    }
  }

  private _getCamera(): any {
    let cam: any = null
    this.world.three.scene.traverse((c: any) => { if (c.isCamera && !cam) cam = c })
    return cam
  }
}