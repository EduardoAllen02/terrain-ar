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

// Frames of valid raycasts to accumulate before placing on rescan.
// Gives SLAM a moment to re-observe the new floor position.
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

// ── Black cover ───────────────────────────────────────────────────────────────

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
//
// absolute-scale reads the SLAM slamScaleFactor and writes:
//   ECS Scale = desiredScale × slamScaleFactor
// every tick, overwriting whatever scale we set.
// The slamScaleFactor grows as SLAM accumulates data across sessions,
// making the model appear smaller each rescan.
//
// Fix: remove the absolute-scale component from the terrain entity entirely.
// Our code owns scale from this point on — GestureHandler handles pinch zoom.

function disableAbsoluteScale(world: any, terrainEid: any): void {
  try {
    const ecs_ = (window as any).ecs ?? ecs
    // Try both possible component names used by 8thwall
    const names = ['absolute-scale', 'absoluteScale', 'AbsoluteScale']
    for (const name of names) {
      const comp = ecs_[name] ?? world.components?.[name]
      if (comp?.has?.(world, terrainEid)) {
        comp.remove(world, terrainEid)
        console.log(`[terrain] Removed ${name} component`)
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

        // Cover before opening viewer so transition is clean
        showCover().then(() => {
          viewer.open(name, registry, () => {
            viewing360    = false
            pendingRescan = true
          })
          // Show 360 overlay — cover will be removed when floor is re-detected
        })
      },
    })

    const doReady  = ecs.defineTrigger()
    const doPlaced = ecs.defineTrigger()
    const doRescan = ecs.defineTrigger()

    const getTerrainObj = (): any =>
      (world.three.entityToObject as Map<any, any>).get(schema.terrainEntity) ?? null

    const hideModel = () => {
      world.setPosition(schema.terrainEntity, 0, -9999, 0)
      ecs.Scale.set(world, schema.terrainEntity, {
        x: HIDDEN_SCALE, y: HIDDEN_SCALE, z: HIDDEN_SCALE,
      })
    }

    const placeModel = (px: number, py: number, pz: number) => {
      world.setPosition(schema.terrainEntity, px, py, pz)
      // Always set scale directly — absolute-scale must be disabled first
      ecs.Scale.set(world, schema.terrainEntity, {
        x: INITIAL_SCALE, y: INITIAL_SCALE, z: INITIAL_SCALE,
      })
    }

    const startRescan = async () => {
      gestures?.detach(); gestures = null
      boards.dispose(world.three.scene)
      restoreMaterials(matStore)
      hideModel()
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
        hideModel()
        if (ecs.Hidden.has(world, schema.terrainEntity)) {
          ecs.Hidden.remove(world, schema.terrainEntity)
        }
        ui.showLoader()
      })
      .onTick(() => {
        if (isModelReady(world, schema.terrainEntity)) {
          // Disable absolute-scale once, here, before first placement
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
        hideModel()
        restoreMaterials(matStore)
        settleFrames = 0
        dataAttribute.cursor(eid).placed = false
        if (!isRescan) ui.hideLoader()
        // On rescan: cover is already up, no other UI needed
      })

      .onTick(() => {
        const hits       = world.raycastFrom(eid)
        const groundHits = hits.filter((h: any) => h.eid === schema.ground)
        if (groundHits.length === 0) return

        settleFrames++
        // On rescan: wait RESCAN_SETTLE_FRAMES of consistent hits before placing
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