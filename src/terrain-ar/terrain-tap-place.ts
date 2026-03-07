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

    // ── Original placement position (captured once in placed.onEnter) ─────
    // These are the exact XYZ where the model landed after the first hit-test.
    // Reset always returns to these coordinates — no recomputation needed.
    let placedX      = 0
    let placedY      = 0
    let placedZ      = 0
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
    // Restores the scene to exactly the state it was in right after the
    // first hit-test placement:
    //  • Position  → original placedX/Y/Z (no heightOffset)
    //  • Rotation  → identity quaternion
    //  • Scale     → INITIAL_SCALE
    //  • Gestures  → fresh GestureHandler (clears all accumulated pan/scale)
    //  • Billboards → disposed + reinitialised at new world position
    //
    const performReset = async (reRegisterResetBtn: () => void): Promise<void> => {
      // ── 1. Restore original transform ────────────────────────────────────
      heightOffset = 0
      world.setPosition(schema.terrainEntity, placedX, placedY, placedZ)
      world.setQuaternion(schema.terrainEntity, 0, 0, 0, 1)
      ecs.Scale.set(world, schema.terrainEntity,
        {x: INITIAL_SCALE, y: INITIAL_SCALE, z: INITIAL_SCALE})

      // ── 2. Fresh GestureHandler ───────────────────────────────────────────
      gestures?.detach()
      gestures = new GestureHandler(schema.terrainEntity, world, THREE)
      gestures.attach()

      // ── 3. Reinitialise billboards ────────────────────────────────────────
      boards.dispose(world.three.scene)
      const obj = getTerrainObj()
      if (obj) {
        const names = await boards.init(obj, world.three.scene)
        registry.register(names)
      }

      // ── 4. Re-register reset button ───────────────────────────────────────
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

        // Snapshot the exact world position where scanning placed the model.
        // This is the single source of truth for reset — never recomputed.
        const initPos = world.transform.getWorldPosition(schema.terrainEntity)
        placedX      = initPos.x
        placedY      = initPos.y   // = hit.y + Y_ABOVE_GROUND
        placedZ      = initPos.z
        heightOffset = 0

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

        const registerResetBtn = () => {
          ui.showResetButton(() => performReset(registerResetBtn))
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