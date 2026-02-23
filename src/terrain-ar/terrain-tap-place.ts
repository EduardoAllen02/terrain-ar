/**
 * terrain-tap-place — v6 (Option C)
 *
 * Auto-placement: model appears as soon as SLAM detects the first surface.
 * No tap required, no dot tower, no floor shadow.
 *
 * ── Tuning constants (adjust these freely) ───────────────────────────────────
 *
 *  CAMERA_OFFSET   How many metres to shift the placement point TOWARD the
 *                  camera from the actual raycast hit. Higher = model appears
 *                  closer to you. (default 0.6)
 *
 *  INITIAL_SCALE   Uniform scale of the model when it first appears.
 *                  1.0 = original GLB size. (default 0.28)
 *
 *  Y_ABOVE_GROUND  Extra height above the detected surface. 0 = sits on floor.
 *                  Small positive value avoids z-fighting. (default 0.01)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as ecs from '@8thwall/ecs'
import {GestureHandler} from './gesture-handler'
import {ArUiOverlay}    from './ar-ui-overlay'

// ══ TUNING — change these to adjust model position and size ══════════════════

const CAMERA_OFFSET  = 0.6    // metres toward camera from raycast hit
const INITIAL_SCALE  = 0.28   // starting scale (tweak until it looks right)
const Y_ABOVE_GROUND = 0.01   // metres above detected floor

// ════════════════════════════════════════════════════════════════════════════

const HIDDEN_SCALE   = 0.00001  // effectively invisible, keeps asset loading

// ─── Material helpers ─────────────────────────────────────────────────────────

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
      original: Array.isArray(child.material)
        ? child.material.slice()
        : child.material,
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
        Object.keys(child.geometry.attributes).length > 0) {
      ready = true
    }
  })
  return ready
}

/**
 * Given a raycast hit point and the camera position, return a point shifted
 * CAMERA_OFFSET metres toward the camera (XZ plane only, Y unchanged).
 */
function offsetTowardCamera(
  THREE: any,
  hitX: number, hitZ: number,
  camX: number, camZ: number,
  offset: number,
): {x: number; z: number} {
  const dir = new THREE.Vector3(camX - hitX, 0, camZ - hitZ)
  if (dir.lengthSq() < 0.0001) return {x: hitX, z: hitZ}
  dir.normalize()
  return {
    x: hitX + dir.x * offset,
    z: hitZ + dir.z * offset,
  }
}

// ─── ECS Component ───────────────────────────────────────────────────────────

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

    const matStore: MeshEntry[]            = []
    let gestures:    GestureHandler | null = null
    let materialsApplied = false

    const ui       = new ArUiOverlay()
    const doReady  = ecs.defineTrigger()
    const doPlaced = ecs.defineTrigger()

    const getTerrainObj = (): any =>
      (world.three.entityToObject as Map<any, any>).get(schema.terrainEntity) ?? null

    // ── STATE: loading ────────────────────────────────────────────────────────

    ecs.defineState('loading')
      .initial()
      .onEnter(() => {
        // Scale to near-zero at origin — stays in-world so engine streams asset
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

    // ── STATE: scanning ───────────────────────────────────────────────────────
    // Raycast every tick. On FIRST hit: apply grey materials, position model,
    // restore materials, activate gestures → placed.

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

        const hit = groundHits[0].point

        // Get camera world position for offset calculation
        const camPos = ecs.Position.get(world, eid)

        const {x: px, z: pz} = offsetTowardCamera(
          THREE,
          hit.x, hit.z,
          camPos.x, camPos.z,
          CAMERA_OFFSET,
        )
        const py = hit.y + Y_ABOVE_GROUND

        // Apply grey preview materials once
        if (!materialsApplied) {
          const obj = getTerrainObj()
          if (obj) {
            captureAndGrey(THREE, obj, matStore)
            materialsApplied = true
          }
        }

        // Position and scale model
        world.setPosition(schema.terrainEntity, px, py, pz)
        ecs.Scale.set(world, schema.terrainEntity, {
          x: INITIAL_SCALE, y: INITIAL_SCALE, z: INITIAL_SCALE,
        })

        // Auto-place immediately on first surface detection
        doPlaced.trigger()
      })

      .onTrigger(doPlaced, 'placed')

    // ── STATE: placed ─────────────────────────────────────────────────────────

    ecs.defineState('placed')
      .onEnter(() => {
        // Restore original textures
        restoreMaterials(matStore)
        materialsApplied = false

        // Activate gesture controls
        gestures = new GestureHandler(schema.terrainEntity, world, THREE)
        gestures.attach()
      })

      .onExit(() => {
        gestures?.detach()
        gestures = null
      })
  },

  remove: () => {},
})