/**
 * terrain-tap-place — v5 final
 *
 * ecs.eid is bigint — all 8th Wall / ECS APIs expect bigint directly.
 * No Number() casts. Raw schema.terrainEntity / schema.ground / eid used as-is.
 */

import * as ecs from '@8thwall/ecs'
import {DotTower}        from './dot-tower'
import {FloorShadow}     from './floor-shadow'
import {GestureHandler}  from './gesture-handler'
import {ArUiOverlay}     from './ar-ui-overlay'

// ─── Config ──────────────────────────────────────────────────────────────────

const PREVIEW_HEIGHT    = 1.35
const PREVIEW_SCALE     = 0.30
const CURSOR_LERP       = 0.18
const PREVIEW_ROT_SPEED = 0.007
const HIDDEN_SCALE      = 0.00001  // near-zero scale hides model while keeping it in-world for asset loading

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

function isModelReady(world: any, terrainEid: any): boolean {
  const obj = world.three.entityToObject.get(terrainEid)
  if (!obj) return false
  let ready = false
  obj.traverse((child: any) => {
    if (ready) return
    if (
      child.isMesh &&
      child.geometry?.attributes &&
      Object.keys(child.geometry.attributes).length > 0
    ) ready = true
  })
  return ready
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
    cursorX:   ecs.f32,
    cursorY:   ecs.f32,
    cursorZ:   ecs.f32,
    groundHit: ecs.boolean,
  },

  stateMachine: ({world, eid, schemaAttribute, dataAttribute}) => {
    const schema  = schemaAttribute.get(eid)
    const {THREE} = window as any

    const matStore: MeshEntry[]            = []
    let dotTower:    DotTower    | null    = null
    let floorShadow: FloorShadow | null   = null
    let gestures:    GestureHandler | null = null
    let materialsApplied = false

    const ui      = new ArUiOverlay()
    const doReady = ecs.defineTrigger()
    const doPlace = ecs.defineTrigger()

    // Three.js object accessor — uses Map with raw eid key
    const getTerrainObj = (): any =>
      (world.three.entityToObject as Map<any, any>).get(schema.terrainEntity) ?? null

    const ensureGrey = (): void => {
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
        // Keep at origin with near-zero scale — stays in-world so the engine
        // streams and uploads the GLTF asset immediately.
        // NEVER use ecs.Hidden or park at extreme Y: both block asset loading.
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

    ecs.defineState('scanning')
      .onEnter(() => {
        ui.hideLoader()

        // Hide by scale until first ground hit
        world.setPosition(schema.terrainEntity, 0, 0, 0)
        ecs.Scale.set(world, schema.terrainEntity, {
          x: HIDDEN_SCALE, y: HIDDEN_SCALE, z: HIDDEN_SCALE,
        })
        materialsApplied = false

        dotTower    = new DotTower(world.three.scene, THREE)
        floorShadow = new FloorShadow(world.three.scene, THREE)
        dotTower.create()
        floorShadow.create()

        const cd     = dataAttribute.cursor(eid)
        cd.groundHit = false
        cd.cursorX   = 0
        cd.cursorY   = 0
        cd.cursorZ   = 0

        ui.showStatus()
        ui.setState('scanning')
      })

      .onTick(() => {
        const hits       = world.raycastFrom(eid)
        const groundHits = hits.filter((h: any) => h.eid === schema.ground)
        const hit        = groundHits.length > 0
        const cd         = dataAttribute.cursor(eid)
        cd.groundHit     = hit

        if (hit) {
          const {x, y, z} = groundHits[0].point

          cd.cursorX += (x - cd.cursorX) * CURSOR_LERP
          cd.cursorY  = schema.yHeight
          cd.cursorZ += (z - cd.cursorZ) * CURSOR_LERP

          dotTower?.update(cd.cursorX, cd.cursorY, cd.cursorZ)
          floorShadow?.update(cd.cursorX, cd.cursorZ)

          ensureGrey()

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
          dotTower?.update(cd.cursorX, cd.cursorY, cd.cursorZ)
          floorShadow?.update(cd.cursorX, cd.cursorZ)

          // Hide model by scale when no ground detected
          ecs.Scale.set(world, schema.terrainEntity, {
            x: HIDDEN_SCALE, y: HIDDEN_SCALE, z: HIDDEN_SCALE,
          })
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
        const obj = getTerrainObj()
        if (obj) obj.rotation.y = 0

        restoreMaterials(matStore)
        materialsApplied = false

        dotTower?.fadeAndDispose(300)
        dotTower = null
        floorShadow?.fadeAndDispose(300)
        floorShadow = null

        ui.setState('placed')
        ui.hide(900)

        // Pass raw eid — GestureHandler uses it only with Three.js Map (any key)
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