/**
 * terrain-tap-place
 *
 * State machine for AR terrain placement.
 * Attach this component to the Camera entity.
 *
 * States
 * ───────
 *  scanning  →  cursor follows raycast hit, shows dot tower + grey terrain preview
 *  placed    →  terrain placed with original textures, dot tower fades out
 *
 * Visual flow
 * ────────────
 *  1. Camera points at floor → raycast hits ground plane
 *  2. DotTower appears at cursor position, animated helix rising to PREVIEW_HEIGHT
 *  3. Grey semi-transparent terrain model floats at top of tower
 *  4. User taps → terrain snaps to ground, grows to full scale, tower fades
 */

import * as ecs from '@8thwall/ecs'
import {DotTower} from './dot-tower'
import {ArUiOverlay} from './ar-ui-overlay'

// ─── Constants ────────────────────────────────────────────────────────────────

const PREVIEW_HEIGHT    = 1.4   // metres: how high the grey model floats
const PREVIEW_SCALE     = 0.28  // scale of the grey preview model
const FINAL_SCALE       = 1.0   // scale after placement
const CURSOR_LERP       = 0.25  // cursor follow speed (0-1, lower = smoother)
const PREVIEW_ROT_SPEED = 0.008 // rad/frame: slow preview rotation
const PLACE_ANIM_MS     = 750   // placement grow animation duration

// ─── Grey material cache ───────────────────────────────────────────────────────

type MeshMaterialEntry = {mesh: any; original: any}

function applyGreyPreviewMaterials(
  THREE: any,
  terrainObj: any,
  entries: MeshMaterialEntry[],
): void {
  entries.length = 0
  terrainObj.traverse((child: any) => {
    if (!child.isMesh) return
    // Store originals
    const originals = Array.isArray(child.material)
      ? child.material.slice()
      : child.material
    entries.push({mesh: child, original: originals})

    // Apply grey preview material
    const greyMat = new THREE.MeshStandardMaterial({
      color: 0x8eaec4,
      roughness: 0.75,
      metalness: 0.05,
      transparent: true,
      opacity: 0.72,
      wireframe: false,
    })

    if (Array.isArray(child.material)) {
      child.material = child.material.map(() => greyMat)
    } else {
      child.material = greyMat
    }
  })
}

function restoreOriginalMaterials(entries: MeshMaterialEntry[]): void {
  for (const {mesh, original} of entries) {
    mesh.material = original
  }
  entries.length = 0
}

// ─── Component registration ────────────────────────────────────────────────────

ecs.registerComponent({
  name: 'terrain-tap-place',

  schema: {
    /** Ground plane entity used for raycasting */
    ground: ecs.eid,
    /** The terrain GLTF entity (terrain_optimized3.glb) */
    terrainEntity: ecs.eid,
    /** Y offset so cursor sits just above the ground plane */
    yHeight: ecs.f32,
    /** Final uniform scale of terrain after placement */
    finalScale: ecs.f32,
  },

  schemaDefaults: {
    yHeight: 0.005,
    finalScale: FINAL_SCALE,
  },

  data: {
    finalPositionX: ecs.f32,
    finalPositionY: ecs.f32,
    finalPositionZ: ecs.f32,
    // Whether ground was hit in the most recent tick (used by touch listener)
    groundDetected: ecs.boolean,
    // Delta time accumulator (ms → seconds)
    lastElapsed: ecs.f32,
  },

  stateMachine: ({world, eid, schemaAttribute, dataAttribute}) => {
    // Resolved once on state-machine init (schema is static)
    const schema = schemaAttribute.get(eid)

    // Smoothed cursor world position
    const cursor = {x: 0, y: 0, z: 0}

    // Triggers
    const doPlace = ecs.defineTrigger()

    // Runtime helpers (not ECS data – live only in JS closure)
    let dotTower: DotTower | null = null
    const materialEntries: MeshMaterialEntry[] = []
    const ui = new ArUiOverlay()
    let materialsApplied = false

    // ── Helpers ──────────────────────────────────────────────────────────────

    /** Get the raw Three.js Object3D for the terrain entity. */
    const getTerrainObj = () =>
      world.three.entityToObject.get(schema.terrainEntity) ?? null

    /** Lazily apply grey materials once GLTF is loaded. */
    const ensureGreyMaterials = () => {
      if (materialsApplied) return
      const terrainObj = getTerrainObj()
      if (!terrainObj) return
      const {THREE} = window as any
      applyGreyPreviewMaterials(THREE, terrainObj, materialEntries)
      materialsApplied = true
    }

    /** Compute dt in seconds from world.time.elapsed (milliseconds). */
    const getDt = (): number => {
      const now = world.time.elapsed
      const data = dataAttribute.cursor(eid)
      const dt = Math.min((now - data.lastElapsed) / 1000, 0.1) // clamp spikes
      data.lastElapsed = now
      return dt
    }

    // ── State: scanning ───────────────────────────────────────────────────────

    ecs.defineState('scanning')
      .initial()
      .onEnter(() => {
        const {THREE} = window as any

        // Create dot tower
        dotTower = new DotTower(world.three.scene, THREE)
        dotTower.create()

        // Ensure terrain starts hidden
        ecs.Hidden.set(world, schema.terrainEntity)
        materialsApplied = false

        // Init dt tracking
        dataAttribute.cursor(eid).lastElapsed = world.time.elapsed
        dataAttribute.cursor(eid).groundDetected = false

        // Show UI
        ui.show()
        ui.setState('scanning')
      })

      .onTick(() => {
        const dt = getDt()
        const data = dataAttribute.cursor(eid)

        // Raycast from camera (eid must be the Camera entity)
        const hits = world.raycastFrom(eid)
        const groundHits = hits.filter((h: any) => h.eid === schema.ground)
        const hit = groundHits.length > 0

        data.groundDetected = hit

        if (hit) {
          const {x, y, z} = groundHits[0].point

          // Smooth cursor towards hit position
          cursor.x += (x - cursor.x) * CURSOR_LERP
          cursor.y  = schema.yHeight
          cursor.z += (z - cursor.z) * CURSOR_LERP

          // Update dot tower
          dotTower?.update(cursor.x, cursor.y, cursor.z, dt)

          // Lazily apply grey materials and show terrain preview
          ensureGreyMaterials()
          if (ecs.Hidden.has(world, schema.terrainEntity)) {
            ecs.Hidden.remove(world, schema.terrainEntity)
          }

          // Position preview above dot tower apex
          world.setPosition(
            schema.terrainEntity,
            cursor.x,
            cursor.y + PREVIEW_HEIGHT,
            cursor.z,
          )

          // Uniform preview scale
          ecs.Scale.set(world, schema.terrainEntity, {
            x: PREVIEW_SCALE,
            y: PREVIEW_SCALE,
            z: PREVIEW_SCALE,
          })

          // Slowly rotate preview for holographic feel
          const terrainObj = getTerrainObj()
          if (terrainObj) {
            terrainObj.rotation.y += PREVIEW_ROT_SPEED
          }

          ui.setState('ground-found')
        } else {
          // Still animate dots even without ground hit
          dotTower?.update(cursor.x, cursor.y, cursor.z, dt)
          ui.setState('scanning')
        }
      })

      // Listen globally so the tap lands regardless of hit target
      .listen(world.events.globalId, ecs.input.SCREEN_TOUCH_START, () => {
        const data = dataAttribute.get(eid)
        // Only place if ground was detected this/last frame
        if (!data.groundDetected) return

        const cd = dataAttribute.cursor(eid)
        cd.finalPositionX = cursor.x
        cd.finalPositionY = cursor.y
        cd.finalPositionZ = cursor.z

        doPlace.trigger()
      })

      .onTrigger(doPlace, 'placed')

    // ── State: placed ─────────────────────────────────────────────────────────

    ecs.defineState('placed')
      .onEnter(() => {
        const data = dataAttribute.get(eid)

        // 1. Restore original materials
        restoreOriginalMaterials(materialEntries)
        materialsApplied = false

        // 2. Stop any ongoing rotation by resetting on the Three.js object
        const terrainObj = getTerrainObj()
        if (terrainObj) terrainObj.rotation.y = 0

        // 3. Position terrain at ground level at the tapped point
        world.setPosition(
          schema.terrainEntity,
          data.finalPositionX,
          data.finalPositionY,
          data.finalPositionZ,
        )
        ecs.Hidden.remove(world, schema.terrainEntity)

        // 4. Grow animation: from preview scale → final scale
        const fs = schema.finalScale
        ecs.ScaleAnimation.set(world, eid, {
          target: schema.terrainEntity,
          loop: false,
          duration: PLACE_ANIM_MS,
          easeOut: true,
          easingFunction: 'Back',
          fromX: PREVIEW_SCALE,
          fromY: PREVIEW_SCALE,
          fromZ: PREVIEW_SCALE,
          toX: fs,
          toY: fs,
          toZ: fs,
        })

        // 5. Fade dot tower, then dispose
        if (dotTower) {
          dotTower.fadeAndDispose(350)
          dotTower = null
        }

        // 6. Update UI then hide
        ui.setState('placed')
        ui.hide(800)
      })

      // Placed state is terminal in this demo.
      // Extend here if you want re-placement logic (e.g. tap again to move).
  },

  // ── Cleanup ─────────────────────────────────────────────────────────────────

  remove: (world, component) => {
    // If component is removed mid-session, clean up Three.js objects
    const {eid} = component
    // Note: dotTower lives in closure – nothing to clean from ECS side.
    // Grey materials would persist on the entity but it will be destroyed
    // along with the entity anyway.
  },
})