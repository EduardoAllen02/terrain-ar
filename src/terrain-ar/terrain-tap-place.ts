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
      setTimeout(resolve, 220)
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
// XR8.stop() destruye el pipeline completo: cámara, mapa SLAM, absolute-scale.
// XR8.run() lo reconstruye desde cero — idéntico al primer load de la página.
// Solo se llama en rescan/reset, NUNCA en el primer arranque.

function getXr8Canvas(): HTMLCanvasElement | null {
  return (
    document.querySelector<HTMLCanvasElement>('canvas[id^="XR"]') ??
    document.querySelector<HTMLCanvasElement>('canvas:not(#v360-canvas)')
  )
}

async function restartXR8(): Promise<void> {
  const XR8 = (window as any).XR8
  if (!XR8) return

  XR8.stop()
  await new Promise(r => setTimeout(r, 400))   // espera a que el browser libere la cámara

  const canvas = getXr8Canvas()
  if (canvas) XR8.run({ canvas })
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
    let pendingRescan = false   // flag leído en placed.onTick
    let isRescan      = false   // true en rescan/reset, false en primer scan
    let coverVisible  = false

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
      ecs.Scale.set(world, schema.terrainEntity, {
        x: HIDDEN_SCALE, y: HIDDEN_SCALE, z: HIDDEN_SCALE,
      })
    }

    // Limpieza completa + restart XR8 — solo para rescan/reset
    const doFullRescan = async () => {
      gestures?.detach(); gestures = null
      boards.dispose(world.three.scene)
      restoreMaterials(matStore)
      hideModel()

      coverVisible = true
      await showCover()
      await restartXR8()

      isRescan      = true
      pendingRescan = true   // onTick de placed lo detecta y dispara doRescan
    }

    // ── STATE: loading ──────────────────────────────────────────────────────
    // Solo en el primer arranque — XR8 ya está corriendo, no lo tocamos.

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
        if (isModelReady(world, schema.terrainEntity)) doReady.trigger()
      })
      .onTrigger(doReady, 'scanning')

    // ── STATE: scanning ─────────────────────────────────────────────────────
    // En primer scan: la cámara ya está activa, solo esperamos raycast.
    // En rescan: XR8 ya fue reiniciado, cover negro está encima, esperamos
    // el primer raycast válido para quitar el cover y mostrar el modelo.

    ecs.defineState('scanning')
      .onEnter(() => {
        hideModel()
        restoreMaterials(matStore)
        dataAttribute.cursor(eid).placed = false

        if (!isRescan) {
          // Primer scan: ocultar el loader inicial, cámara ya visible
          ui.hideLoader()
        }
        // En rescan el cover negro ya está encima — no se muestra nada más
      })

      .onTick(() => {
        const hits       = world.raycastFrom(eid)
        const groundHits = hits.filter((h: any) => h.eid === schema.ground)
        if (groundHits.length === 0) return

        // Piso detectado — posicionar el modelo
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

        // Quitar cover negro ahora que tenemos piso real
        if (coverVisible) {
          hideCover()
          coverVisible = false
        }

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

        ui.showResetButton(() => doFullRescan())
        dataAttribute.cursor(eid).placed = true
      })

      .onTick(() => {
        if (pendingRescan) {
          pendingRescan = false
          doRescan.trigger()
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