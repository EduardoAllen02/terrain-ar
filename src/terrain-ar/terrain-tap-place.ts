/**
 * terrain-tap-place — v2
 *
 * Fixes vs v1:
 * ─────────────
 * 1. NO second entity spawned on placement.
 *    The preview entity IS the final entity. On tap we:
 *      a) stop it floating → animate Y down to ground
 *      b) restore its original materials
 *      c) animate scale from PREVIEW_SCALE → finalScale
 *      d) fade & dispose dot tower
 *
 * 2. Cursor smoothing decoupled from tower update.
 *    Tower receives already-smoothed position → no trembling.
 *
 * States
 * ───────
 *  scanning  → raycast follows ground, shows dot tower + grey floating preview
 *  landing   → tap received, model drops to ground while restoring materials
 *  placed    → terminal, model at rest on ground
 */

import * as ecs from '@8thwall/ecs'
import {DotTower} from './dot-tower'
import {ArUiOverlay} from './ar-ui-overlay'

// ─── Config ──────────────────────────────────────────────────────────────────

const PREVIEW_HEIGHT    = 1.35   // metres the model floats above cursor
const PREVIEW_SCALE     = 0.30
const FINAL_SCALE       = 1.0
const CURSOR_LERP       = 0.18   // lower = smoother cursor follow
const PREVIEW_ROT_SPEED = 0.007  // rad/frame slow spin during preview
const LAND_DURATION_MS  = 600    // how long the "drop to ground" takes
const GROW_DURATION_MS  = 700

// ─── Material helpers ─────────────────────────────────────────────────────────

type MeshEntry = { mesh: any; original: any }

function captureAndGrey(THREE: any, obj: any, store: MeshEntry[]): void {
  store.length = 0
  const greyMat = new THREE.MeshStandardMaterial({
    color:       0x8eaec4,
    roughness:   0.75,
    metalness:   0.05,
    transparent: true,
    opacity:     0.70,
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

// ─── ECS Component ───────────────────────────────────────────────────────────

ecs.registerComponent({
  name: 'terrain-tap-place',

  schema: {
    ground:        ecs.eid,   // invisible ground plane for raycasting
    terrainEntity: ecs.eid,   // terrain_optimized3.glb entity
    yHeight:       ecs.f32,   // small offset so model sits on surface
    finalScale:    ecs.f32,
  },

  schemaDefaults: {
    yHeight:    0.005,
    finalScale: FINAL_SCALE,
  },

  data: {
    // Smoothed cursor world position (updated every tick in scanning)
    cursorX:       ecs.f32,
    cursorY:       ecs.f32,
    cursorZ:       ecs.f32,
    // Where the model will land (set on tap)
    landX:         ecs.f32,
    landY:         ecs.f32,
    landZ:         ecs.f32,
    groundHit:     ecs.boolean,
    // dt tracking
    lastElapsed:   ecs.f32,
    // landing animation progress (0 → 1)
    landProgress:  ecs.f32,
    // Y at moment tap occurred (model starts falling from here)
    landFromY:     ecs.f32,
  },

  stateMachine: ({world, eid, schemaAttribute, dataAttribute}) => {
    const schema = schemaAttribute.get(eid)

    const matStore: MeshEntry[] = []
    let dotTower: DotTower | null = null
    const ui = new ArUiOverlay()
    let materialsApplied = false

    const doPlace   = ecs.defineTrigger()
    const doLanded  = ecs.defineTrigger()

    // ── helpers ──────────────────────────────────────────────────────────────

    const terrainObj = () =>
      world.three.entityToObject.get(schema.terrainEntity) ?? null

    const getDt = (): number => {
      const now = world.time.elapsed
      const cd  = dataAttribute.cursor(eid)
      const dt  = Math.min((now - cd.lastElapsed) / 1000, 0.1)
      cd.lastElapsed = now
      return dt
    }

    const ensureGreyMaterials = () => {
      if (materialsApplied) return
      const obj = terrainObj()
      if (!obj) return
      captureAndGrey((window as any).THREE, obj, matStore)
      materialsApplied = true
    }

    // ── STATE: scanning ───────────────────────────────────────────────────────

    ecs.defineState('scanning')
      .initial()
      .onEnter(() => {
        const {THREE} = window as any
        dotTower = new DotTower(world.three.scene, THREE)
        dotTower.create()

        ecs.Hidden.set(world, schema.terrainEntity)
        materialsApplied = false

        const cd = dataAttribute.cursor(eid)
        cd.lastElapsed = world.time.elapsed
        cd.groundHit   = false

        ui.show()
        ui.setState('scanning')
      })

      .onTick(() => {
        getDt()   // keep lastElapsed current (we don't need dt value here)

        const hits        = world.raycastFrom(eid)
        const groundHits  = hits.filter((h: any) => h.eid === schema.ground)
        const hit         = groundHits.length > 0
        const cd          = dataAttribute.cursor(eid)

        cd.groundHit = hit

        if (hit) {
          const {x, y, z} = groundHits[0].point

          // Smooth cursor position — lerp toward raycast hit
          cd.cursorX += (x        - cd.cursorX) * CURSOR_LERP
          cd.cursorY  = schema.yHeight
          cd.cursorZ += (z        - cd.cursorZ) * CURSOR_LERP

          // Move dot tower to smoothed position (no extra lerp inside tower)
          dotTower?.update(cd.cursorX, cd.cursorY, cd.cursorZ)

          // Apply grey materials once GLTF is ready
          ensureGreyMaterials()

          if (ecs.Hidden.has(world, schema.terrainEntity)) {
            ecs.Hidden.remove(world, schema.terrainEntity)
          }

          // Float preview above tower apex
          world.setPosition(
            schema.terrainEntity,
            cd.cursorX,
            cd.cursorY + PREVIEW_HEIGHT,
            cd.cursorZ,
          )

          // Lock preview scale
          ecs.Scale.set(world, schema.terrainEntity, {
            x: PREVIEW_SCALE, y: PREVIEW_SCALE, z: PREVIEW_SCALE,
          })

          // Slow rotation for holographic feel
          const obj = terrainObj()
          if (obj) obj.rotation.y += PREVIEW_ROT_SPEED

          ui.setState('ground-found')
        } else {
          // No ground hit — keep tower at last known position, hide terrain
          dotTower?.update(cd.cursorX, cd.cursorY, cd.cursorZ)
          if (!ecs.Hidden.has(world, schema.terrainEntity)) {
            ecs.Hidden.set(world, schema.terrainEntity)
          }
          ui.setState('scanning')
        }
      })

      .listen(world.events.globalId, ecs.input.SCREEN_TOUCH_START, () => {
        const cd = dataAttribute.get(eid)
        if (!cd.groundHit) return

        // Record where the model is RIGHT NOW (floating above cursor)
        // and where it needs to land (on the ground)
        const data = dataAttribute.cursor(eid)
        data.landX        = cd.cursorX
        data.landY        = cd.cursorY + PREVIEW_HEIGHT  // keep at preview height
        data.landZ        = cd.cursorZ
        data.landFromY    = cd.cursorY + PREVIEW_HEIGHT  // same — no drop
        data.landProgress = 0

        doPlace.trigger()
      })

      .onTrigger(doPlace, 'landing')

    // ── STATE: landing ────────────────────────────────────────────────────────
    //
    // The SAME entity drops from PREVIEW_HEIGHT → yHeight.
    // Materials restored immediately so the "full texture" reveal
    // happens as it descends.

    ecs.defineState('landing')
      .onEnter(() => {
        // 1. Restore original textures immediately
        restoreMaterials(matStore)
        materialsApplied = false

        // 2. Stop preview rotation
        const obj = terrainObj()
        if (obj) obj.rotation.y = 0

        // 3. Fade dot tower
        if (dotTower) {
          dotTower.fadeAndDispose(300)
          dotTower = null
        }

        // 4. Update UI
        ui.setState('placed')
        ui.hide(900)
      })

      .onTick(() => {
        const data = dataAttribute.cursor(eid)

        // Advance progress using elapsed time
        // We use a simple fixed increment per tick for smoothness
        data.landProgress = Math.min(
          data.landProgress + (1 / (LAND_DURATION_MS / 16.67)),
          1,
        )

        // Ease out cubic
        const t    = data.landProgress
        const ease = 1 - Math.pow(1 - t, 3)

        const currentY = data.landFromY + (data.landY - data.landFromY) * ease

        // Also grow scale during descent: PREVIEW_SCALE → finalScale
        const currentScale =
          PREVIEW_SCALE + (schema.finalScale - PREVIEW_SCALE) * ease

        world.setPosition(
          schema.terrainEntity,
          data.landX,
          currentY,
          data.landZ,
        )

        ecs.Scale.set(world, schema.terrainEntity, {
          x: currentScale,
          y: currentScale,
          z: currentScale,
        })

        if (data.landProgress >= 1) {
          doLanded.trigger()
        }
      })

      .onTrigger(doLanded, 'placed')

    // ── STATE: placed ────────────────────────────────────────────────────────
    ecs.defineState('placed')
      .onEnter(() => {
        // Snap to exact final values in case of float imprecision
        const data = dataAttribute.get(eid)
        const fs   = schema.finalScale

        world.setPosition(schema.terrainEntity, data.landX, data.landY, data.landZ)
        ecs.Scale.set(world, schema.terrainEntity, {x: fs, y: fs, z: fs})

        // Terminal state — extend here for re-placement if needed
      })
  },

  remove: (_world, _component) => {
    // dot tower lives in closure; no ECS cleanup needed
  },
})