/**
 * terrain-tap-place — v4
 *
 * What's new vs v3:
 * ──────────────────
 * 1. Loading detection: polls until the GLTF mesh is ready, shows spinner.
 * 2. Floor shadow: soft circular halo under the dot tower.
 * 3. Post-placement gesture controls via GestureHandler.
 *
 * States
 * ───────
 *  loading   → model not yet in Three.js scene, show spinner
 *  scanning  → raycast + dot tower + floor shadow + grey preview
 *  placed    → terminal; GestureHandler active
 */

import * as ecs from '@8thwall/ecs'
import {DotTower}      from './dot-tower'
import {FloorShadow}   from './floor-shadow'
import {GestureHandler} from './gesture-handler'
import {ArUiOverlay}   from './ar-ui-overlay'

// ─── Config ──────────────────────────────────────────────────────────────────

const PREVIEW_HEIGHT    = 1.35
const PREVIEW_SCALE     = 0.30
const CURSOR_LERP       = 0.18
const PREVIEW_ROT_SPEED = 0.007

// ─── Material helpers ─────────────────────────────────────────────────────────

type MeshEntry = { mesh: any; original: any }

function captureAndGrey(THREE: any, obj: any, store: MeshEntry[]): void {
  store.length = 0
  const greyMat = new THREE.MeshStandardMaterial({
    color: 0x8eaec4, roughness: 0.75, metalness: 0.05,
    transparent: true, opacity: 0.70,
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

/** Returns true once the GLTF has at least one mesh loaded into Three.js. */
function isModelReady(world: any, eid: number): boolean {
  const obj = world.three.entityToObject.get(eid)
  if (!obj) return false
  let hasMesh = false
  obj.traverse((c: any) => { if (c.isMesh) hasMesh = true })
  return hasMesh
}

// ─── ECS Component ───────────────────────────────────────────────────────────

ecs.registerComponent({
  name: 'terrain-tap-place',

  schema: {
    ground:        ecs.eid,
    terrainEntity: ecs.eid,
    yHeight:       ecs.f32,
  },

  schemaDefaults: { yHeight: 0.005 },

  data: {
    cursorX:     ecs.f32,
    cursorY:     ecs.f32,
    cursorZ:     ecs.f32,
    groundHit:   ecs.boolean,
    lastElapsed: ecs.f32,
  },

  stateMachine: ({world, eid, schemaAttribute, dataAttribute}) => {
    const schema = schemaAttribute.get(eid)
    const {THREE} = window as any

    // Runtime helpers (closure — not ECS data)
    const matStore: MeshEntry[]    = []
    let dotTower: DotTower | null  = null
    let floorShadow: FloorShadow | null = null
    let gestures: GestureHandler | null = null
    let materialsApplied           = false
    const ui = new ArUiOverlay()

    const doReady  = ecs.defineTrigger()
    const doPlace  = ecs.defineTrigger()

    // ── helpers ──────────────────────────────────────────────────────────────

    const getTerrainObj = () =>
      world.three.entityToObject.get(schema.terrainEntity) ?? null

    const keepTime = () => {
      dataAttribute.cursor(eid).lastElapsed = world.time.elapsed
    }

    const ensureGrey = () => {
      if (materialsApplied) return
      const obj = getTerrainObj()
      if (!obj) return
      captureAndGrey(THREE, obj, matStore)
      materialsApplied = true
    }

    // ── STATE: loading ────────────────────────────────────────────────────────

    ecs.defineState('loading')
      .initial()
      .onEnter(() => {
        // Keep terrain hidden while loading
        ecs.Hidden.set(world, schema.terrainEntity)
        // Show spinner
        ui.showLoader()
      })
      .onTick(() => {
        // Poll until Three.js has the model
        if (isModelReady(world, Number(schema.terrainEntity))) {
          doReady.trigger()
        }
      })
      .onTrigger(doReady, 'scanning')

    // ── STATE: scanning ───────────────────────────────────────────────────────

    ecs.defineState('scanning')
      .onEnter(() => {
        // Hide loader, show status pill
        ui.hideLoader()

        // Create Three.js helpers
        dotTower    = new DotTower(world.three.scene, THREE)
        floorShadow = new FloorShadow(world.three.scene, THREE)
        dotTower.create()
        floorShadow.create()

        ecs.Hidden.set(world, schema.terrainEntity)
        materialsApplied = false

        keepTime()
        dataAttribute.cursor(eid).groundHit = false

        ui.showStatus()
        ui.setState('scanning')
      })

      .onTick(() => {
        keepTime()

        const hits       = world.raycastFrom(eid)
        const groundHits = hits.filter((h: any) => h.eid === schema.ground)
        const hit        = groundHits.length > 0
        const cd         = dataAttribute.cursor(eid)
        cd.groundHit     = hit

        if (hit) {
          const {x, y, z} = groundHits[0].point

          // Smooth cursor
          cd.cursorX += (x - cd.cursorX) * CURSOR_LERP
          cd.cursorY  = schema.yHeight
          cd.cursorZ += (z - cd.cursorZ) * CURSOR_LERP

          // Update Three.js helpers
          dotTower?.update(cd.cursorX, cd.cursorY, cd.cursorZ)
          floorShadow?.update(cd.cursorX, cd.cursorZ)

          // Lazy-apply grey materials
          ensureGrey()

          if (ecs.Hidden.has(world, schema.terrainEntity)) {
            ecs.Hidden.remove(world, schema.terrainEntity)
          }

          // Float model above tower
          world.setPosition(
            schema.terrainEntity,
            cd.cursorX,
            cd.cursorY + PREVIEW_HEIGHT,
            cd.cursorZ,
          )

          ecs.Scale.set(world, schema.terrainEntity, {
            x: PREVIEW_SCALE, y: PREVIEW_SCALE, z: PREVIEW_SCALE,
          })

          const obj = getTerrainObj()
          if (obj) obj.rotation.y += PREVIEW_ROT_SPEED

          ui.setState('ground-found')
        } else {
          // No ground — update helpers at last known position
          dotTower?.update(cd.cursorX, cd.cursorY, cd.cursorZ)
          floorShadow?.update(cd.cursorX, cd.cursorZ)

          if (!ecs.Hidden.has(world, schema.terrainEntity)) {
            ecs.Hidden.set(world, schema.terrainEntity)
          }
          ui.setState('scanning')
        }
      })

      .listen(world.events.globalId, ecs.input.SCREEN_TOUCH_START, () => {
        if (!dataAttribute.get(eid).groundHit) return
        doPlace.trigger()
      })

      .onTrigger(doPlace, 'placed')

    // ── STATE: placed ─────────────────────────────────────────────────────────

    ecs.defineState('placed')
      .onEnter(() => {
        // Stop preview rotation
        const obj = getTerrainObj()
        if (obj) obj.rotation.y = 0

        // Restore original textures
        restoreMaterials(matStore)
        materialsApplied = false

        // Fade out Three.js helpers
        dotTower?.fadeAndDispose(300)
        dotTower = null
        floorShadow?.fadeAndDispose(300)
        floorShadow = null

        // Update & dismiss UI
        ui.setState('placed')
        ui.hide(900)

        // Activate post-placement gesture controls
        gestures = new GestureHandler(Number(schema.terrainEntity), world, THREE)
        gestures.attach()
      })

      .onExit(() => {
        // Clean up gestures if state ever exits
        gestures?.detach()
        gestures = null
      })
  },

  remove: (_world, _component) => {
    // Gestures live in closure — GC handles it
  },
})