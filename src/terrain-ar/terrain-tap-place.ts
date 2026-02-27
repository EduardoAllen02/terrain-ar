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
const RESCAN_SETTLE_FRAMES = 30

type MeshEntry = { mesh: any; original: any }

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

// ── Cover negro ───────────────────────────────────────────────────────────────

let _cover: HTMLDivElement | null = null

function showCover(): Promise<void> {
  return new Promise(resolve => {
    if (_cover) { resolve(); return }
    const div = document.createElement('div')
    div.style.cssText = `
      position:fixed;inset:0;z-index:88888;
      background:#000;pointer-events:all;
      opacity:0;transition:opacity 0.2s ease;
    `
    document.body.appendChild(div)
    _cover = div
    requestAnimationFrame(() => {
      div.style.opacity = '1'
      setTimeout(resolve, 230)
    })
  })
}

function hideCover(): void {
  if (!_cover) return
  const el = _cover; _cover = null
  el.style.opacity = '0'
  setTimeout(() => el.remove(), 320)
}

// ── absolute-scale neutralizer ────────────────────────────────────────────────

function disableAbsoluteScale(world: any, terrainEid: any): void {
  try {
    const ecs_ = (window as any).ecs ?? ecs
    for (const name of ['absolute-scale', 'absoluteScale', 'AbsoluteScale']) {
      const comp = ecs_[name] ?? world.components?.[name]
      if (comp?.has?.(world, terrainEid)) {
        comp.remove(world, terrainEid)
        console.log(`[terrain] Removed ${name}`)
        break
      }
    }
  } catch (e) {
    console.warn('[terrain] Could not remove absolute-scale:', e)
  }
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

    const matStore: MeshEntry[]         = []
    let gestures: GestureHandler | null = null
    let absoluteScaleDisabled           = false

    let viewing360    = false
    let pendingRescan = false
    let isRescan      = false
    let coverVisible  = false
    let settleFrames  = 0

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
        showCover().then(() => {
          viewer.open(name, registry, () => {
            viewing360    = false
            pendingRescan = true
          })
        })
      },
    })

    const doReady  = ecs.defineTrigger()
    const doPlaced = ecs.defineTrigger()
    const doRescan = ecs.defineTrigger()

    const getTerrainObj = (): any =>
      (world.three.entityToObject as Map<any, any>).get(schema.terrainEntity) ?? null

    // ── Full entity reset ─────────────────────────────────────────────────
    // Resets position, rotation (identity quaternion) and scale.
    // Critical: without resetting rotation the terrain keeps the accumulated
    // rotation from GestureHandler and the new GestureHandler instance
    // inherits a world space that is misaligned with the current camera.

    const resetEntityTransform = () => {
      // Position: far away so it's invisible
      world.setPosition(schema.terrainEntity, 0, -9999, 0)

      // Rotation: identity — wipes all accumulated gesture rotations
      world.setQuaternion(schema.terrainEntity, 0, 0, 0, 1)

      // Scale: near-zero
      ecs.Scale.set(world, schema.terrainEntity, {
        x: HIDDEN_SCALE, y: HIDDEN_SCALE, z: HIDDEN_SCALE,
      })
    }

    const placeModel = (px: number, py: number, pz: number) => {
      world.setPosition(schema.terrainEntity, px, py, pz)
      ecs.Scale.set(world, schema.terrainEntity, {
        x: INITIAL_SCALE, y: INITIAL_SCALE, z: INITIAL_SCALE,
      })
      // Rotation stays identity from resetEntityTransform —
      // model always faces the same direction on first placement
    }

    const startRescan = async () => {
      gestures?.detach(); gestures = null
      boards.dispose(world.three.scene)
      restoreMaterials(matStore)
      resetEntityTransform()   // ← wipes rotation here
      isRescan      = true
      coverVisible  = true
      settleFrames  = 0
      pendingRescan = false
      await showCover()
      doRescan.trigger()
    }

    // ── STATE: loading ──────────────────────────────────────────────────────

    ecs.defineState('loading')
      .initial()
      .onEnter(() => {
        checkArSupport()
        checkCameraAccess(() => {}, () => {})
        isRescan = false
        resetEntityTransform()
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

    // ── STATE: scanning ─────────────────────────────────────────────────────

    ecs.defineState('scanning')
      .onEnter(() => {
        resetEntityTransform()   // ensure clean state even if entered multiple times
        restoreMaterials(matStore)
        settleFrames = 0
        dataAttribute.cursor(eid).placed = false
        if (!isRescan) ui.hideLoader()
      })

      .onTick(() => {
        const hits       = world.raycastFrom(eid)
        const groundHits = hits.filter((h: any) => h.eid === schema.ground)
        if (groundHits.length === 0) return

        settleFrames++
        if (isRescan && settleFrames < RESCAN_SETTLE_FRAMES) return

        const hit    = groundHits[0].point
        const camPos = ecs.Position.get(world, eid)
        const {x: px, z: pz} = offsetTowardCamera(
          THREE, hit.x, hit.z, camPos.x, camPos.z, CAMERA_OFFSET,
        )
        const py = hit.y + Y_ABOVE_GROUND

        placeModel(px, py, pz)

        if (coverVisible) { hideCover(); coverVisible = false }

        doPlaced.trigger()
      })

      .onTrigger(doPlaced, 'placed')

    // ── STATE: placed ───────────────────────────────────────────────────────

    ecs.defineState('placed')
      .onEnter(async () => {
        isRescan = false

        gestures?.detach()
        gestures = new GestureHandler(schema.terrainEntity, world, THREE)
        gestures.attach()

        boards.dispose(world.three.scene)
        const terrainObj = getTerrainObj()
        if (terrainObj) {
          const hotspotNames = await boards.init(terrainObj, world.three.scene)
          registry.register(hotspotNames)
        }

        ui.showResetButton(() => startRescan())
        dataAttribute.cursor(eid).placed = true
      })

      .onTick(() => {
        if (pendingRescan) {
          startRescan()
          return
        }
        if (viewing360) return
        const terrainObj = getTerrainObj()
        if (terrainObj) boards.update(terrainObj)
      })

      .onExit(() => {
        gestures?.detach(); gestures = null
        boards.dispose(world.three.scene)
        ui.hideResetButton()
      })

      .onTrigger(doRescan, 'scanning')
  },

  remove: () => {},
})