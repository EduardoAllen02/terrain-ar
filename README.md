# AR Terrain Experience — Dolomiti Friulane UNESCO

> A WebAR experience built on 8th Wall that places an interactive 3D terrain model of the Dolomiti Friulane UNESCO site into the real world, with tappable hotspots that open immersive 360° panoramic viewers.

---

## Table of Contents

- [Overview](#overview)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Architecture](#architecture)
- [Configuration](#configuration)
- [Adding Content](#adding-content)
- [Build & Deploy](#build--deploy)
- [Known Constraints](#known-constraints)

---

## Overview

The experience runs entirely in the mobile browser — no app install required. When the user opens the URL on a supported device, 8th Wall detects a flat surface and places a scaled 3D terrain model of the Friuli Venezia Giulia Dolomites on it. The user can then:

- **Pinch to scale** and **pan** the terrain using touch gestures
- **Rotate and adjust the height** of the model via on-screen controls
- **Tap hotspot pins** to open a full-screen 360° panoramic viewer for that location
- **Navigate** between multiple panoramas per hotspot via Prev/Next buttons
- **Reset** the model placement at any time

Devices that do not support WebAR are redirected to a 3D web viewer fallback URL.

---

## Tech Stack

| Layer | Technology |
|---|---|
| AR Runtime | [8th Wall](https://www.8thwall.com/) (ECS framework) |
| Language | TypeScript |
| 3D Engine | Three.js (provided by 8th Wall) |
| 360° Rendering | Custom Three.js sphere renderer with DeviceOrientation gyro |
| Build Tool | Vite |
| Hosting | GitHub Pages (`lardoallen02.github.io`) |

---

## Project Structure

```
project/
│
├── src/
│   ├── terrain-tap-place.ts   # Main ECS component — orchestrates the full experience
│   ├── billboard-manager.ts   # 3D hotspot/pin sprites with NDC hit detection
│   ├── viewer-360.ts          # 360° panoramic viewer (gyro-driven, multi-image)
│   ├── ar-ui-overlay.ts       # All AR UI elements (buttons, bars, hints)
│   └── device-check.ts        # AR support detection and bilingual error handling
│
├── public/
│   └── assets/
│       ├── 360/
│       │   ├── manifest.json  # Hotspot → image mapping and display labels
│       │   └── <HOTSPOT>/     # One folder per hotspot, containing *.jpg panoramas
│       ├── pois/
│       │   ├── hotspot/       # PNG icons for 360° viewpoint pins
│       │   ├── mountain/      # PNG icons for summit labels
│       │   └── pin/           # PNG icons for general points of interest
│       └── ui/
│           └── fullscreen-btn.png
│
├── dist/                      # Generated build output — do not edit manually
├── package.json
└── tsconfig.json
```

---

## Getting Started

### Prerequisites

- Node.js v18 or higher — [nodejs.org](https://nodejs.org)
- An 8th Wall project key configured in the entry HTML

### Install

```bash
npm install
```

### Development

```bash
npm run dev
```

Opens a local Vite dev server at `http://localhost:5173`. To test on a real device, use the Network URL printed in the terminal (device and computer must be on the same Wi-Fi network).

### Production build

```bash
npm run build
```

Output is written to `dist/`. Upload the **contents** of `dist/` (not the folder itself) to the web server root.

---

## Architecture

### ECS Component — `terrain-tap-place`

The main component is registered as an 8th Wall ECS component and drives a three-state machine:

```
loading  ──►  scanning  ──►  placed
```

| State | Behaviour |
|---|---|
| `loading` | Shows loader, waits for the 3D model geometry to be ready |
| `scanning` | Hides model, raycasts against the ground plane each tick, auto-places on first hit |
| `placed` | Attaches gestures, initialises billboards, shows UI controls |

**Key constants:**

```typescript
const CAMERA_OFFSET  = 0.6    // metres the model is placed toward the camera from the hit point
const INITIAL_SCALE  = 0.58   // world-space scale at placement
const Y_ABOVE_GROUND = 1.0    // vertical offset from the detected ground plane
const HIDDEN_SCALE   = 0.00001 // effectively invisible scale during scanning
```

### Gesture Handler — `gesture-handler.ts`

Handles pinch-to-scale and two-finger pan on the placed terrain. Pan is computed by raycasting both touch points onto a horizontal plane at the model's Y position, eliminating camera-direction dependency. The active camera is retrieved via `scene.traverse()` — `world.three.camera` is null in this version of 8th Wall.

### Billboard Manager — `billboard-manager.ts`

Reads the Three.js scene graph for nodes whose names match the prefixes `hotspot_`, `mountain_`, and `pin_`. For each node it creates a sprite using the corresponding PNG from `assets/pois/<type>/`. Hit detection is performed in NDC space on every frame tick. Per-hotspot scale overrides are supported via the `scaleOverrides` option.

**Base size:** `0.35` · **Vertical offset:** `0.025`

### Viewer360 — `viewer-360.ts`

A self-contained full-screen 360° viewer that:

- Loads a `manifest.json` index once and caches it for the instance lifetime
- Maintains a **sliding-window texture cache**: loads the current image, prefetches `±1`, and disposes textures outside that window after 600 ms
- Drives camera rotation exclusively via `DeviceOrientationEvent` (gyroscope), using additive Euler offsets to avoid gimbal lock issues with right-multiplied correction quaternions
- Exposes a minimal public API: `new Viewer360(THREE)` / `.open(hotspotName, onClose)`

### 360° Back-to-AR Behaviour

When the user closes the 360° viewer, the page performs a **full reload** (`window.location.reload()`). This is intentional: 8th Wall's SLAM pipeline continues accumulating drift while the 360° overlay is active, causing the ground plane to shift on return. A reload guarantees the AR engine restarts from a clean state identical to the initial page load.

---

## Configuration

### Hotspot size overrides

In `src/terrain-tap-place.ts`:

```typescript
const HOTSPOT_SCALE_OVERRIDES: Record<string, number> = {
  'ZEMOLA': 0.9,
  'ERTO':   0.9,
  'CASSO':  0.9,
}
```

Values are multipliers relative to `baseSize: 0.35`. `1.0` = standard size.

### Redirect URLs

| Constant | File | Triggered when |
|---|---|---|
| `FALLBACK_3D_URL` | `src/device-check.ts` | Device does not support WebAR |
| `CLOSE_REDIRECT_URL` | `src/ar-ui-overlay.ts` | User taps the X close button |

---

## Adding Content

### New hotspot (complete workflow)

1. Create an empty in Blender named `hotspot_MYPLACE` and export the `.glb`
2. Add `public/assets/pois/hotspot/MYPLACE.png`
3. Create `public/assets/360/MYPLACE/` with at least `1.jpg`
4. Register in `manifest.json`:

```json
"MYPLACE": {
  "folder": "MYPLACE",
  "images": ["1", "2"],
  "labels": ["Main view", "Looking south"]
}
```

5. Run `npm run build` and deploy

### manifest.json format

```json
{
  "HOTSPOT_NAME": {
    "folder": "exact-folder-name-on-disk",
    "images": ["stem1", "stem2"],
    "labels": ["Display name 1", "Display name 2"]
  }
}
```

| Field | Required | Notes |
|---|---|---|
| `folder` | Yes | Exact subfolder name inside `assets/360/` |
| `images` | Yes | Filename stems without `.jpg` extension |
| `labels` | No | One label per image. Falls back to the stem if omitted. |

### Blender empty naming convention

| Prefix | Result |
|---|---|
| `hotspot_` | Tappable pin that opens the 360° viewer |
| `mountain_` | Summit label |
| `pin_` | General point of interest |

Names are **case-sensitive**. The part after the prefix must be **UPPERCASE** and match the PNG filename and manifest key exactly.

---

## Build & Deploy

```bash
# Install dependencies (once)
npm install

# Local preview
npm run dev

# Production build
npm run build
# → upload contents of dist/ to server root (public_html/ or equivalent)
```

> **Important:** Upload the *contents* of `dist/`, not the `dist/` folder itself. The `index.html` must be directly under the server root.

After any change to content files (`manifest.json`, PNGs, images) or source files, a new build is required before the changes are visible on the live site.

---

## Known Constraints

| Constraint | Detail |
|---|---|
| `world.three.camera` is null | This version of 8th Wall does not expose the active camera via `world.three.camera`. Use `scene.traverse()` to find the first `PerspectiveCamera`. |
| `world.transform.getWorldPosition` / `setWorldPosition` do not exist | Use `world.setPosition(eid, x, y, z)` and `ecs.Scale.set(world, eid, {x, y, z})` instead. |
| 360° → AR transition causes SLAM drift | 8th Wall's ground detection continues accumulating while the 360° overlay is active. `window.location.reload()` on viewer close is the only reliable way to get a clean AR restart. |
| Gyro correction uses additive Euler offsets | Right-multiplied correction quaternions corrupt the gyro reference frame at large offsets. The correct pattern for combining DeviceOrientation with touch offsets is additive Euler (`β + pitchOff`, `α + yawOff`). |
| Images must be `.jpg` | The 360° viewer's texture loader only handles JPEG. PNG and WebP are not supported. |
| Empty names are case-sensitive | The billboard manager matches node names with strict string equality after stripping the prefix. |

---

*Dolomiti Friulane UNESCO AR Experience · 2026*
