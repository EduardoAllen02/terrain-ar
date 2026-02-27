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
const SETTLE_FRAMES  = 20   // frames válidos antes de confirmar posición post-reset

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

// ── XR8 restart ───────────────────────────────────────────────────────────────
//
// KEY: capturamos el canvas ANTES de llamar stop().
// XR8.run({ canvas: mismoCanvas }) reutiliza el elemento DOM existente —
// no crea uno nuevo, no rompe el z-order, no toca el DOM.
// El pipeline interno (SLAM, absolute-scale, world coordinates) se destruye
// y reconstruye desde cero sobre el mismo canvas.

let _xr8Canvas: HTMLCanvasElement | null = null

function captureXr8Canvas(): void {
  if (_xr8Canvas) return
  _xr8Canvas = (
    document.querySelector<HTMLCanvasElement>('canvas[id^="XR"]') ??
    document.querySelector<HTMLCanvasElement>('canvas:not(#v360-canvas)')
  )
}

async function restartXR8(): Promise<void> {
  const XR8 = (window as any).XR8
  if (!XR8 || !_xr8Canvas) return

  XR8.stop()
  await new Promise(r => setTimeout(r, 400))   // browser libera el camera track
  XR8.run({ canvas: _xr8Canvas })              // mismo canvas — sin tocar DOM
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
    let materialsApplied = false

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
        viewer.open(name, registry, () => {
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
      world.setQuaternion(schema.terrainEntity, 0, 0, 0, 1)
      ecs.Scale.set(world, schema.terrainEntity, {
        x: HIDDEN_SCALE, y: HIDDEN_SCALE, z: HIDDEN_SCALE,
      })
    }

    const startRescan = async () => {
      gestures?.detach(); gestures = null
      boards.dispose(world.three.scene)
      restoreMaterials(matStore)
      hideModel()
      materialsApplied = false
      isRescan         = true
      coverVisible     = true
      settleFrames     = 0
      pendingRescan    = false

      await showCover()
      await restartXR8()   // SLAM y world coords destruidos y reconstruidos
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
        // Captura el canvas de XR8 en el primer tick — ya está en el DOM
        captureXr8Canvas()

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
        hideModel()
        restoreMaterials(matStore)
        materialsApplied = false
        settleFrames = 0
        dataAttribute.cursor(eid).placed = false
        if (!isRescan) ui.hideLoader()
      })

      .onTick(() => {
        const hits       = world.raycastFrom(eid)
        const groundHits = hits.filter((h: any) => h.eid === schema.ground)
        if (groundHits.length === 0) return

        settleFrames++
        // Esperar frames estables en rescan para que SLAM fije el nuevo origen
        if (isRescan && settleFrames < SETTLE_FRAMES) return

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