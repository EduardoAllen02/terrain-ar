import * as ecs from '@8thwall/ecs'
import {GestureHandler}     from './gesture-handler'
import {ArUiOverlay}        from './ar-ui-overlay'
import {BillboardManager}   from './billboard-manager'
import {ExperienceRegistry} from './experience-registry'
import {Viewer360}          from './viewer-360'
import {checkArSupport, checkCameraAccess} from './device-check'

const CAMERA_OFFSET  = 0.6
const INITIAL_SCALE  = 0.28
const Y_ABOVE_GROUND = 1.0
const HIDDEN_SCALE   = 0.00001

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
  THREE: any,
  hitX: number, hitZ: number,
  camX: number, camZ: number,
  offset: number,
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
      if (comp?.has?.(world, terrainEid)) {
        comp.remove(world, terrainEid)
        break
      }
    }
  } catch (_) {}
}

function seamlessReload(): void {
  const div = document.createElement('div')
  div.style.cssText = `
    position:fixed;inset:0;z-index:999999;
    background:#000;pointer-events:all;
    opacity:0;transition:opacity 0.25s ease;
  `
  document.body.appendChild(div)
  requestAnimationFrame(() => {
    div.style.opacity = '1'
    setTimeout(() => window.location.reload(), 280)
  })
}

// ─────────────────────────────────────────────────────────────────────────────

ecs.registerComponent({
  name: 'terrain-tap-place',

  schema: {
    ground:        ecs.eid,
    terrainEntity: ecs.eid,
  },

  schemaDefaults: {},

  data: {
    placed: ecs.boolean,
  },

  stateMachine: ({world, eid, schemaAttribute, dataAttribute}) => {
    const schema  = schemaAttribute.get(eid)
    const {THREE} = window as any

    let gestures: GestureHandler | null = null
    let absoluteScaleDisabled           = false
    let viewing360                      = false

    const ui       = new ArUiOverlay()
    const registry = new ExperienceRegistry()
    const viewer   = new Viewer360(THREE)
    const boards   = new BillboardManager(THREE, {
      baseSize:       0.4,
      verticalOffset: 0.025,
      debug:          false,
      onHotspotTap: (name) => {
        if (viewing360) return
        viewing360 = true
        gestures?.detach()
        ui.hideResetButton()
        ui.hideFullscreenButton()
        ui.hideGestureHint()
        viewer.open(name, registry, () => seamlessReload())
      },
    })

    const doReady  = ecs.defineTrigger()
    const doPlaced = ecs.defineTrigger()

    const getTerrainObj = (): any =>
      (world.three.entityToObject as Map<any, any>).get(schema.terrainEntity) ?? null

    const hideModel = () => {
      world.setPosition(schema.terrainEntity, 0, -9999, 0)
      world.setQuaternion(schema.terrainEntity, 0, 0, 0, 1)
      ecs.Scale.set(world, schema.terrainEntity, {
        x: HIDDEN_SCALE, y: HIDDEN_SCALE, z: HIDDEN_SCALE,
      })
    }

    // ── loading ─────────────────────────────────────────────────────────────

    ecs.defineState('loading')
      .initial()
      .onEnter(() => {
        checkArSupport()
        checkCameraAccess(() => {}, () => {})
        hideModel()
        if (ecs.Hidden.has(world, schema.terrainEntity)) {
          ecs.Hidden.remove(world, schema.terrainEntity)
        }
        ui.showLoader()
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

    // ── scanning ─────────────────────────────────────────────────────────────

    ecs.defineState('scanning')
      .onEnter(() => {
        ui.hideLoader()
        hideModel()
        dataAttribute.cursor(eid).placed = false
      })
      .onTick(() => {
        const hits       = world.raycastFrom(eid)
        const groundHits = hits.filter((h: any) => h.eid === schema.ground)
        if (groundHits.length === 0) return

        const hit    = groundHits[0].point
        const camPos = ecs.Position.get(world, eid)
        const {x: px, z: pz} = offsetTowardCamera(
          THREE, hit.x, hit.z, camPos.x, camPos.z, CAMERA_OFFSET,
        )
        const py = hit.y + Y_ABOVE_GROUND

        world.setPosition(schema.terrainEntity, px, py, pz)
        world.setQuaternion(schema.terrainEntity, 0, 0, 0, 1)
        ecs.Scale.set(world, schema.terrainEntity, {
          x: INITIAL_SCALE, y: INITIAL_SCALE, z: INITIAL_SCALE,
        })

        doPlaced.trigger()
      })
      .onTrigger(doPlaced, 'placed')

    // ── placed ───────────────────────────────────────────────────────────────

    ecs.defineState('placed')
      .onEnter(async () => {
        gestures?.detach()
        gestures = new GestureHandler(schema.terrainEntity, world, THREE)
        gestures.attach()

        boards.dispose(world.three.scene)
        const terrainObj = getTerrainObj()
        if (terrainObj) {
          const hotspotNames = await boards.init(terrainObj, world.three.scene)
          registry.register(hotspotNames)
        }

        ui.showResetButton(() => seamlessReload())
        ui.showFullscreenButton()

        // Gesture hint: shown once per session, fades after 5s or on first touch
        ui.showGestureHint()

        dataAttribute.cursor(eid).placed = true
      })
      .onTick(() => {
        if (viewing360) return
        const terrainObj = getTerrainObj()
        if (terrainObj) boards.update(terrainObj)
      })
      .onExit(() => {
        gestures?.detach()
        gestures = null
        boards.dispose(world.three.scene)
        ui.hideResetButton()
        ui.hideFullscreenButton()
        ui.hideGestureHint()
      })
  },

  remove: () => {},
})