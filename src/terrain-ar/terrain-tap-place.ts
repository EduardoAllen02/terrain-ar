import * as ecs from '@8thwall/ecs'
import {GestureHandler}                                   from './gesture-handler'
import {ArUiOverlay, requestFullscreenNow,
        maintainFullscreen, installViewportFix}           from './ar-ui-overlay'
import {BillboardManager}                                 from './billboard-manager'
import {ExperienceRegistry}                               from './experience-registry'
import {Viewer360}                                        from './viewer-360'
import {checkArSupport, checkCameraAccess}                from './device-check'

// ── Install orientation fix ASAP ─────────────────────────────────────────────
installViewportFix()

// ── Constants ─────────────────────────────────────────────────────────────────
const CAMERA_OFFSET  = 0.6
const INITIAL_SCALE  = 0.58
const Y_ABOVE_GROUND = 1.0
const HIDDEN_SCALE   = 0.00001

// ── Per-hotspot scale overrides ───────────────────────────────────────────────
const HOTSPOT_SCALE_OVERRIDES: Record<string, number> = {
  'ZEMOLA': 0.9,
  'ERTO':   0.9,
  'CASSO':  0.9,
}

// ─────────────────────────────────────────────────────────────────────────────

function isModelReady(world: any, terrainEid: any): boolean {
  const obj = world.three.entityToObject.get(terrainEid)
  if (!obj) return false
  let ready = false
  obj.traverse((child: any) => {
    if (ready) return
    if (child.isMesh && child.geometry?.attributes &&
        Object.keys(child.geometry.attributes).length > 0) ready = true
  })
  return ready
}

function offsetTowardCamera(
  THREE: any, hitX: number, hitZ: number, camX: number, camZ: number, offset: number,
): {x: number; z: number} {
  const dir = new THREE.Vector3(camX - hitX, 0, camZ - hitZ)
  if (dir.lengthSq() < 0.0001) return {x: hitX, z: hitZ}
  dir.normalize()
  return {x: hitX + dir.x * offset, z: hitZ + dir.z * offset}
}

function disableAbsoluteScale(world: any, terrainEid: any): void {
  try {
    const ecs_ = (window as any).ecs ?? ecs
    for (const name of ['absolute-scale', 'absoluteScale', 'AbsoluteScale']) {
      const comp = ecs_[name] ?? world.components?.[name]
      if (comp?.has?.(world, terrainEid)) { comp.remove(world, terrainEid); break }
    }
  } catch (_) {}
}

function seamlessReload(): void {
  const div = document.createElement('div')
  div.style.cssText =
    'position:fixed;inset:0;z-index:999999;background:#000;pointer-events:all;opacity:0;transition:opacity .25s ease;'
  document.body.appendChild(div)
  requestAnimationFrame(() => {
    div.style.opacity = '1'
    setTimeout(() => window.location.reload(), 280)
  })
}

// ─────────────────────────────────────────────────────────────────────────────

ecs.registerComponent({
  name: 'terrain-tap-place',
  schema:         {ground: ecs.eid, terrainEntity: ecs.eid},
  schemaDefaults: {},
  data:           {placed: ecs.boolean},

  stateMachine: ({world, eid, schemaAttribute, dataAttribute}) => {
    const schema  = schemaAttribute.get(eid)
    const {THREE} = window as any

    let gestures: GestureHandler | null = null
    let absoluteScaleDisabled           = false
    let viewing360                      = false

    // ── Height / position tracking ────────────────────────────────────────
    // placedY = Y of the model at initial placement (hit.y + Y_ABOVE_GROUND).
    // Never changes after first placement — only heightOffset grows from it.
    let placedY      = 0
    let heightOffset = 0

    const ui       = new ArUiOverlay()
    const registry = new ExperienceRegistry()
    const viewer   = new Viewer360(THREE)

    const boards = new BillboardManager(THREE, {
      baseSize:       0.35,
      verticalOffset: 0.025,
      debug:          false,
      scaleOverrides: HOTSPOT_SCALE_OVERRIDES,
      onHotspotTap: (name) => {
        if (viewing360) return
        viewing360 = true

        gestures?.detach()
        ui.hideResetButton()
        ui.hideRotationBar()
        ui.hideHeightBar()
        ui.hideGestureHint()

        viewer.open(name, registry, () => seamlessReload())
      },
    })

    const doReady  = ecs.defineTrigger()
    const doPlaced = ecs.defineTrigger()

    const getTerrainObj = () =>
      (world.three.entityToObject as Map<any, any>).get(schema.terrainEntity) ?? null

    const hideModel = () => {
      world.setPosition(schema.terrainEntity, 0, -9999, 0)
      world.setQuaternion(schema.terrainEntity, 0, 0, 0, 1)
      ecs.Scale.set(world, schema.terrainEntity,
        {x: HIDDEN_SCALE, y: HIDDEN_SCALE, z: HIDDEN_SCALE})
    }

    // ── Soft scene reset ──────────────────────────────────────────────────
    //
    // Replicates exactly what scanning→placed does:
    //  1. Compute position in front of camera (XZ), same Y as first placement.
    //  2. Reset scale to INITIAL_SCALE, quaternion to identity.
    //  3. Destroy & recreate GestureHandler so all internal pan/scale state
    //     (baseScale, initSpread, lastX/Y…) is fully cleared.
    //  4. Reset heightOffset to 0 (placedY stays as the original ground Y).
    //  5. Dispose and reinitialise billboards so their world positions and
    //     anchor references are recalculated against the new placement.
    //  6. Re-register the reset button so it remains available.
    //
    const performReset = async (reRegisterResetBtn: () => void): Promise<void> => {
      // ── 1. Compute new XZ placement in front of camera ──────────────────
      // Get camera position from ECS (the camera entity = eid).
      const camPos = ecs.Position.get(world, eid)

      // Get the THREE camera for its look direction.
      let threeCam: any = null
      world.three.scene.traverse((c: any) => { if (c.isCamera && !threeCam) threeCam = c })

      let px = camPos.x
      let pz = camPos.z

      if (threeCam) {
        // Forward direction projected onto XZ plane, then normalised.
        const fwd = new THREE.Vector3(0, 0, -1)
          .applyQuaternion(threeCam.quaternion)
          .setY(0)
          .normalize()
        // Place model CAMERA_OFFSET metres in front of camera —
        // identical to how scanning offsets toward the camera from the hit point.
        px = camPos.x + fwd.x * CAMERA_OFFSET
        pz = camPos.z + fwd.z * CAMERA_OFFSET
      }

      // Y: reuse placedY (= original hit.y + Y_ABOVE_GROUND); no height offset.
      heightOffset = 0

      // ── 2. Reset model transform ─────────────────────────────────────────
      world.setPosition(schema.terrainEntity, px, placedY, pz)
      world.setQuaternion(schema.terrainEntity, 0, 0, 0, 1)
      ecs.Scale.set(world, schema.terrainEntity,
        {x: INITIAL_SCALE, y: INITIAL_SCALE, z: INITIAL_SCALE})

      // ── 3. Fresh GestureHandler ──────────────────────────────────────────
      // Detaching + creating new clears baseScale, initSpread, lastX/Y etc.
      gestures?.detach()
      gestures = new GestureHandler(schema.terrainEntity, world, THREE)
      gestures.attach()

      // ── 4. Reinitialise billboards ───────────────────────────────────────
      // dispose() removes sprites from scene; init() re-traverses the terrain
      // object at its new world position and attaches fresh sprites.
      boards.dispose(world.three.scene)
      const obj = getTerrainObj()
      if (obj) {
        const names = await boards.init(obj, world.three.scene)
        registry.register(names)
      }

      // ── 5. Re-register reset button ──────────────────────────────────────
      // showResetButton() auto-hides the button on click before calling the
      // callback, so we must re-show it once the reset is complete.
      reRegisterResetBtn()
    }

    // ─────────────────────────────────────────────────────────────────────────

    // ── loading ───────────────────────────────────────────────────────────

    ecs.defineState('loading').initial()
      .onEnter(() => {
        checkArSupport()
        checkCameraAccess(() => {}, () => {})
        hideModel()
        if (ecs.Hidden.has(world, schema.terrainEntity))
          ecs.Hidden.remove(world, schema.terrainEntity)
        ui.showLoader()
        // PNG fullscreen button visible from the start.
        // X close button added to DOM now (hidden), revealed after fs entered.
        ui.showFullscreenButton()
        ui.showCloseButton()
      })
      .onTick(() => {
        if (isModelReady(world, schema.terrainEntity)) {
          if (!absoluteScaleDisabled) {
            disableAbsoluteScale(world, schema.terrainEntity)
            absoluteScaleDisabled = true
          }
          doReady.trigger()
        }
      })
      .onTrigger(doReady, 'scanning')

    // ── scanning ──────────────────────────────────────────────────────────

    ecs.defineState('scanning')
      .onEnter(() => {
        ui.hideLoader()
        hideModel()
        dataAttribute.cursor(eid).placed = false
        heightOffset = 0
      })
      .onTick(() => {
        const hits       = world.raycastFrom(eid)
        const groundHits = hits.filter((h: any) => h.eid === schema.ground)
        if (groundHits.length === 0) return
        const hit = groundHits[0].point
        const cam = ecs.Position.get(world, eid)
        const {x: px, z: pz} = offsetTowardCamera(
          THREE, hit.x, hit.z, cam.x, cam.z, CAMERA_OFFSET,
        )
        world.setPosition(schema.terrainEntity, px, hit.y + Y_ABOVE_GROUND, pz)
        world.setQuaternion(schema.terrainEntity, 0, 0, 0, 1)
        ecs.Scale.set(world, schema.terrainEntity,
          {x: INITIAL_SCALE, y: INITIAL_SCALE, z: INITIAL_SCALE})
        doPlaced.trigger()
      })
      .onTrigger(doPlaced, 'placed')

    // ── placed ────────────────────────────────────────────────────────────

    ecs.defineState('placed')
      .onEnter(async () => {
        gestures?.detach()
        gestures = new GestureHandler(schema.terrainEntity, world, THREE)
        gestures.attach()

        // Capture the Y from the hit-test placement; used by performReset.
        const initPos = world.transform.getWorldPosition(schema.terrainEntity)
        placedY       = initPos.y   // = hit.y + Y_ABOVE_GROUND
        heightOffset  = 0

        boards.dispose(world.three.scene)
        const obj = getTerrainObj()
        if (obj) {
          const names = await boards.init(obj, world.three.scene)
          registry.register(names)
        }

        ui.showRotationBar((deltaRad: number) => {
          const half = deltaRad * 0.5
          world.transform.rotateSelf(schema.terrainEntity,
            {x: 0, y: Math.sin(half), z: 0, w: Math.cos(half)})
        })

        ui.showHeightBar((delta: number) => {
          heightOffset = Math.max(0, heightOffset + delta)
          const pos = world.transform.getWorldPosition(schema.terrainEntity)
          world.setPosition(schema.terrainEntity, pos.x, placedY + heightOffset, pos.z)
        })

        // Reset button: uses a named function so it can re-register itself
        // after each soft reset without reloading the page.
        const registerResetBtn = () => {
          ui.showResetButton(() => {
            // Button auto-hides itself before calling here.
            // performReset will call registerResetBtn() when done.
            performReset(registerResetBtn)
          })
        }
        registerResetBtn()

        ui.showGestureHint()
        dataAttribute.cursor(eid).placed = true
      })
      .onTick(() => {
        if (viewing360) return
        const obj = getTerrainObj()
        if (obj) boards.update(obj)
      })
      .onExit(() => {
        gestures?.detach(); gestures = null
        boards.dispose(world.three.scene)
        ui.hideResetButton()
        ui.hideRotationBar()
        ui.hideHeightBar()
        ui.hideGestureHint()
        // closeButton intentionally kept visible through all states
      })
  },

  remove: () => {},
})