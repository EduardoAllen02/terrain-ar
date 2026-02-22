/**
 * terrain-tap-place — v3
 *
 * Placement philosophy:
 * ──────────────────────
 * The preview model IS the final model. On tap, nothing moves, nothing scales.
 * We only do two things:
 *   1. Restore original materials (grey → textured)
 *   2. Fade and dispose the dot tower
 *
 * This guarantees the model stays pixel-perfect where the user saw it.
 * Scale adjustments post-placement should be done via pinch gesture.
 */

import * as ecs from '@8thwall/ecs'
import {DotTower} from './dot-tower'
import {ArUiOverlay} from './ar-ui-overlay'

// ─── Config ──────────────────────────────────────────────────────────────────

const PREVIEW_HEIGHT    = 1.35   // metres the model floats above cursor
const PREVIEW_SCALE     = 0.30   // scale during preview (and after placement)
const CURSOR_LERP       = 0.18   // cursor follow smoothing
const PREVIEW_ROT_SPEED = 0.007  // rad/frame slow spin during preview

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

// ─── ECS Component ───────────────────────────────────────────────────────────

ecs.registerComponent({
  name: 'terrain-tap-place',

  schema: {
    ground:        ecs.eid,
    terrainEntity: ecs.eid,
    yHeight:       ecs.f32,   // small offset so cursor sits on surface
  },

  schemaDefaults: {
    yHeight: 0.005,
  },

  data: {
    cursorX:     ecs.f32,
    cursorY:     ecs.f32,
    cursorZ:     ecs.f32,
    groundHit:   ecs.boolean,
    lastElapsed: ecs.f32,
  },

  stateMachine: ({world, eid, schemaAttribute, dataAttribute}) => {
    const schema = schemaAttribute.get(eid)

    const matStore: MeshEntry[] = []
    let dotTower: DotTower | null = null
    const ui = new ArUiOverlay()
    let materialsApplied = false

    const doPlace = ecs.defineTrigger()

    // ── helpers ──────────────────────────────────────────────────────────────

    const getTerrainObj = () =>
      world.three.entityToObject.get(schema.terrainEntity) ?? null

    const keepLastElapsed = () => {
      dataAttribute.cursor(eid).lastElapsed = world.time.elapsed
    }

    const ensureGreyMaterials = () => {
      if (materialsApplied) return
      const obj = getTerrainObj()
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

        keepLastElapsed()
        dataAttribute.cursor(eid).groundHit = false

        ui.show()
        ui.setState('scanning')
      })

      .onTick(() => {
        keepLastElapsed()

        const hits       = world.raycastFrom(eid)
        const groundHits = hits.filter((h: any) => h.eid === schema.ground)
        const hit        = groundHits.length > 0
        const cd         = dataAttribute.cursor(eid)

        cd.groundHit = hit

        if (hit) {
          const {x, y, z} = groundHits[0].point

          // Smooth cursor
          cd.cursorX += (x - cd.cursorX) * CURSOR_LERP
          cd.cursorY  = schema.yHeight
          cd.cursorZ += (z - cd.cursorZ) * CURSOR_LERP

          // Tower follows smoothed position — no internal lerp, no trembling
          dotTower?.update(cd.cursorX, cd.cursorY, cd.cursorZ)

          ensureGreyMaterials()

          if (ecs.Hidden.has(world, schema.terrainEntity)) {
            ecs.Hidden.remove(world, schema.terrainEntity)
          }

          // Position model floating above tower
          world.setPosition(
            schema.terrainEntity,
            cd.cursorX,
            cd.cursorY + PREVIEW_HEIGHT,
            cd.cursorZ,
          )

          // Lock preview scale every tick to prevent drift
          ecs.Scale.set(world, schema.terrainEntity, {
            x: PREVIEW_SCALE,
            y: PREVIEW_SCALE,
            z: PREVIEW_SCALE,
          })

          // Slow spin
          const obj = getTerrainObj()
          if (obj) obj.rotation.y += PREVIEW_ROT_SPEED

          ui.setState('ground-found')
        } else {
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
        doPlace.trigger()
      })

      .onTrigger(doPlace, 'placed')

    // ── STATE: placed ─────────────────────────────────────────────────────────
    //
    // Model is already exactly where it should be — position and scale set
    // last tick in scanning. We only swap materials and remove the dots.

    ecs.defineState('placed')
      .onEnter(() => {
        // Stop rotation — freeze current angle
        const obj = getTerrainObj()
        if (obj) obj.rotation.y = 0

        // Swap grey → original materials
        restoreMaterials(matStore)
        materialsApplied = false

        // Fade out dot tower
        if (dotTower) {
          dotTower.fadeAndDispose(300)
          dotTower = null
        }

        // Update and dismiss UI
        ui.setState('placed')
        ui.hide(900)

        // Terminal state — model stays exactly where it was in last scanning tick
      })
  },

  remove: (_world, _component) => {
    // No ECS cleanup needed; Three.js objects live in closure
  },
})