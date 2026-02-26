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

// Frames to wait during rescan before placing — lets SLAM re-settle
const RESCAN_MIN_FRAMES = 45

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

// ── XR8 pause / resume ────────────────────────────────────────────────────────
//
// WHY we pause XR8:
//   8thwall's absolute-scale component writes ECS Scale every tick using:
//     entityScale = desiredScale × slamScaleFactor
//   The slamScaleFactor is refined continuously as SLAM accumulates data.
//   If we leave XR8 running during 360°, SLAM keeps updating and the factor
//   drifts — causing the model to appear smaller each return cycle.
//   Pausing XR8 freezes SLAM at the last known good state.
//
// WHY there's no white flash:
//   We show a full-screen black cover BEFORE hiding the AR canvas.
//   The cover stays visible during XR8.resume() + first SLAM frame.
//   Only removed once scanning confirms a valid floor raycast hit.

let _arCover: HTMLDivElement | null = null

function showArCover(): void {
  if (_arCover) return
  const div = document.createElement('div')
  div.id = 'ar-transition-cover'
  div.style.cssText = `
    position:fixed; inset:0; z-index:88888;
    background:#000; pointer-events:none;
    transition:opacity 0.3s ease; opacity:1;
  `
  document.body.appendChild(div)
  _arCover = div
}

function hideArCover(): void {
  if (!_arCover) return
  const el = _arCover
  _arCover = null
  el.style.opacity = '0'
  setTimeout(() => el.remove(), 320)
}

function findArCanvas(): HTMLCanvasElement | null {
  // 8thwall renders to the first canvas in the DOM that is NOT ours
  return (
    document.querySelector<HTMLCanvasElement>('canvas[id^="XR"]') ??
    document.querySelector<HTMLCanvasElement>('canvas:not(#v360-canvas)')
  )
}

function pauseAr(): void {
  try { (window as any).XR8?.pause() } catch (_) {}
  const c = findArCanvas()
  if (c) c.style.visibility = 'hidden'
}

function resumeAr(): void {
  // Canvas stays hidden — hideArCover() reveals the scene once floor is found
  try { (window as any).XR8?.resume() } catch (_) {}
}

function revealArCanvas(): void {
  const c = findArCanvas()
  if (c) c.style.visibility = ''
  hideArCover()
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

    let viewing360    = false
    let pendingRescan = false
    let isRescan      = false
    let scanFrames    = 0
    let coverShown    = false   // true when AR cover is up waiting for floor

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

        // Show cover FIRST (prevents flash), then pause AR
        showArCover()
        pauseAr()

        viewer.open(name, registry, () => {
          // 360 closed — resume AR under the cover, rescan will reveal canvas
          resumeAr()
          viewing360    = false
          pendingRescan = true
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

    // ── STATE: loading ──────────────────────────────────────────────────────

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
        if (isModelReady(world, schema.terrainEntity)) doReady.trigger()
      })
      .onTrigger(doReady, 'scanning')

    // ── STATE: scanning ─────────────────────────────────────────────────────

    ecs.defineState('scanning')
      .onEnter(() => {
        hideModel()
        restoreMaterials(matStore)
        scanFrames  = 0
        coverShown  = isRescan   // track whether we need to remove cover later
        dataAttribute.cursor(eid).placed = false

        if (isRescan) {
          ui.showRescanLoader()
        } else {
          ui.hideLoader()
        }
      })

      .onTick(() => {
        const hits       = world.raycastFrom(eid)
        const groundHits = hits.filter((h: any) => h.eid === schema.ground)
        if (groundHits.length === 0) return

        scanFrames++

        if (isRescan && scanFrames < RESCAN_MIN_FRAMES) return

        // Floor confirmed
        const hit    = groundHits[0].point
        const camPos = ecs.Position.get(world, eid)
        const {x: px, z: pz} = offsetTowardCamera(
          THREE, hit.x, hit.z, camPos.x, camPos.z, CAMERA_OFFSET,
        )
        const py = hit.y + Y_ABOVE_GROUND

        world.setPosition(schema.terrainEntity, px, py, pz)
        ecs.Scale.set(world, schema.terrainEntity, {
          x: INITIAL_SCALE, y: INITIAL_SCALE, z: INITIAL_SCALE,
        })

        // Reveal AR canvas (removes black cover) now that we have a valid floor
        if (coverShown) {
          revealArCanvas()
          coverShown = false
        }

        ui.hideLoader()
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

        ui.showResetButton(() => {
          gestures?.detach()
          gestures = null
          boards.dispose(world.three.scene)
          restoreMaterials(matStore)
          showArCover()
          isRescan      = true
          pendingRescan = false
          doRescan.trigger()
        })

        dataAttribute.cursor(eid).placed = true
      })

      .onTick(() => {
        if (pendingRescan) {
          pendingRescan = false
          isRescan      = true
          doRescan.trigger()
          return
        }

        if (viewing360) return

        const terrainObj = getTerrainObj()
        if (terrainObj) boards.update(terrainObj)
      })

      .onExit(() => {
        gestures?.detach()
        gestures = null
        boards.dispose(world.three.scene)
        ui.hideResetButton()
      })

      .onTrigger(doRescan, 'scanning')
  },

  remove: () => {},
})