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

type MeshEntry = { mesh: any; original: any }

function captureAndGrey(THREE: any, obj: any, store: MeshEntry[]): void {
  store.length = 0
  const greyMat = new THREE.MeshStandardMaterial({
    color: 0x8eaec4, roughness: 0.75, metalness: 0.05,
    transparent: true, opacity: 0.72,
  })
  obj.traverse((child: any) => {
    if (!child.isMesh) return
    store.push({
      mesh:     child,
      original: Array.isArray(child.material) ? child.material.slice() : child.material,
    })
    child.material = Array.isArray(child.material)
      ? child.material.map(() => greyMat)
      : greyMat
  })
}

function restoreMaterials(store: MeshEntry[]): void {
  for (const {mesh, original} of store) mesh.material = original
  store.length = 0
}

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

    const matStore: MeshEntry[]          = []
    let gestures: GestureHandler | null  = null
    let materialsApplied                 = false
    let viewing360                       = false
    let boardsReady                      = false

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
        viewer.open(name, registry, () => {
          viewing360 = false
          // ── KEY FIX: re-enter scanning so AR re-detects floor cleanly ───
          // Hides the model, clears placed, starts new surface detection.
          // The user sees "Detectando entorno" spinner while SLAM resets.
          boards.dispose(world.three.scene)
          boardsReady = false
          restoreMaterials(matStore)  // safety clear
          doRescan.trigger()
        })
      },
    })

    const doReady  = ecs.defineTrigger()
    const doPlaced = ecs.defineTrigger()
    const doRescan = ecs.defineTrigger()

    const getTerrainObj = (): any =>
      (world.three.entityToObject as Map<any, any>).get(schema.terrainEntity) ?? null

    // ── STATE: loading ──────────────────────────────────────────────────────

    ecs.defineState('loading')
      .initial()
      .onEnter(() => {
        // Device checks run once here
        checkArSupport()
        checkCameraAccess(
          () => { /* OK — 8thwall takes over camera */ },
          () => { /* alert already shown by checkCameraAccess */ },
        )

        world.setPosition(schema.terrainEntity, 0, 0, 0)
        ecs.Scale.set(world, schema.terrainEntity, {
          x: HIDDEN_SCALE, y: HIDDEN_SCALE, z: HIDDEN_SCALE,
        })
        if (ecs.Hidden.has(world, schema.terrainEntity)) {
          ecs.Hidden.remove(world, schema.terrainEntity)
        }
        ui.showLoader()
      })
      .onTick(() => {
        if (isModelReady(world, schema.terrainEntity)) doReady.trigger()
      })
      .onTrigger(doReady, 'scanning')

    // ── STATE: scanning ─────────────────────────────────────────────────────
    // Used both for initial placement AND after returning from 360°.
    // On re-entry the model is hidden so the user sees clean AR while
    // SLAM re-settles, then the model snaps to the new surface hit.

    ecs.defineState('scanning')
      .onEnter(() => {
        ui.hideLoader()
        world.setPosition(schema.terrainEntity, 0, 0, 0)
        ecs.Scale.set(world, schema.terrainEntity, {
          x: HIDDEN_SCALE, y: HIDDEN_SCALE, z: HIDDEN_SCALE,
        })
        materialsApplied = false
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

        if (!materialsApplied) {
          const obj = getTerrainObj()
          if (obj) { captureAndGrey(THREE, obj, matStore); materialsApplied = true }
        }

        world.setPosition(schema.terrainEntity, px, py, pz)
        ecs.Scale.set(world, schema.terrainEntity, {
          x: INITIAL_SCALE, y: INITIAL_SCALE, z: INITIAL_SCALE,
        })

        doPlaced.trigger()
      })

      .onTrigger(doPlaced, 'placed')
      .onTrigger(doRescan, 'scanning')   // self-loop: re-enter scanning cleanly

    // ── STATE: placed ───────────────────────────────────────────────────────

    ecs.defineState('placed')
      .onEnter(async () => {
        restoreMaterials(matStore)
        materialsApplied = false

        gestures = new GestureHandler(schema.terrainEntity, world, THREE)
        gestures.attach()

        if (!boardsReady) {
          const terrainObj = getTerrainObj()
          if (terrainObj) {
            const hotspotNames = await boards.init(terrainObj, world.three.scene)
            registry.register(hotspotNames)
            boardsReady = true
          }
        }

        dataAttribute.cursor(eid).placed = true
      })

      .onTick(() => {
        if (viewing360) return
        const terrainObj = getTerrainObj()
        if (terrainObj && boardsReady) boards.update(terrainObj)
      })

      .onExit(() => {
        gestures?.detach()
        gestures = null
      })
  },

  remove: () => {},
})