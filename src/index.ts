/**
 * Terrain AR – entry point
 * Registers all ECS components for the 8th Wall scene.
 * Import this once from your bundle entry (e.g. bundle.js via webpack/vite).
 */

// ─── Terrain AR ────────────────────────────────────────────────────────────────
// The main placement component (dot tower + grey preview + tap to place).
import './terrain-ar/terrain-tap-place'

// Note: DotTower and ArUiOverlay are plain TS classes imported by terrain-tap-place.
// They do not need to be registered here.