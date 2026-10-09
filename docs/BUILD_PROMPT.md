# Build prompt: Princess Coin Drive

Paste everything below this line to a coding agent (Claude Code or similar) in an
empty project directory to build this game from scratch. It is self-contained:
it does not assume the agent has seen this repo before.

---

## The brief

Build **Princess Coin Drive**, a 3D driving game for a 5-year-old girl, for the
browser, running well on phones, tablets and computers. A princess hops into
her pink convertible, drives automatically down a street through a sunny
storybook town ("Rose Town") steered left/right by the player, collects gold
coins and a rare heart gem, passes a few silly obstacles, and arrives at a
castle. **There is no way to lose.** Bumping an obstacle only slows the car and
knocks a few coins loose (they fly forward and can be caught again); every run
ends at the castle with 1–3 stars. The whole interface is icons and big round
buttons — no reading required.

Visual target: a premium stylized "toy diorama" look — think Animal Crossing,
Tiny Glade, Toca Boca — soft sculpted forms, a cohesive pastel palette with a
few saturated accents (gold coins, berry pinks), dense authored detail, no
default-primitive "prototype" look anywhere a 5-year-old would look.

Non-negotiables:
- **Kid-safe.** No ads, no purchases, no network calls after the page loads, no
  data collection, no text the game depends on her reading.
- **No fail state.** A child who never touches the controls must still reach
  the castle and get at least one star.
- **Installable, offline-capable PWA.** No app store, no Capacitor. One link,
  works on phone/tablet/computer, installs to the home screen, plays offline
  after first load.
- **No asset-generation API keys assumed.** Build every visual asset
  procedurally in code (see "Procedural modeling kit" below). Do not write
  code that calls an image/3D/audio generation API at runtime, and do not
  assume `GEMINI_API_KEY` / `TRIPO_API_KEY` / `ELEVENLABS_API_KEY` exist. If
  you have real asset-generation tools available and the user wants to use
  them for a hero asset, that's a bonus on top of this plan, not a
  replacement for it — the procedural path must work standalone.
- **Tests, not vibes.** A pure-logic simulation layer with unit tests must
  prove every level is finishable and nothing can soft-lock, independent of
  the renderer.

## Tech stack (exact versions — check for newer compatible ones, but these are
known to work together)

```json
{
  "dependencies": {
    "@fontsource-variable/fredoka": "^5.3.0",
    "@preact/signals": "^2.11.2",
    "n8ao": "^2.0.1",
    "postprocessing": "^6.39.5",
    "preact": "^10.29.8",
    "three": "^0.186.1"
  },
  "devDependencies": {
    "@babel/core": "^7.28.0",
    "@playwright/test": "^1.63.0",
    "@preact/preset-vite": "^2.10.6",
    "@types/three": "^0.186.0",
    "lil-gui": "^0.21.0",
    "typescript": "^7.0.2",
    "vite": "^8.3.1",
    "vite-plugin-pwa": "^1.3.0",
    "vitest": "^5.0.2"
  }
}
```

Why this stack, in case you need to deviate: Three.js (WebGL2) is the smallest
mature 3D engine that still runs well on budget Android tablets — Unity/Godot
web exports ship a multi-MB engine before the first frame. Preact + Signals
gives componentized UI without React's weight. Vite + vite-plugin-pwa gives an
installable offline app with zero backend. `postprocessing` + `n8ao` give a
real post-processing chain (ambient occlusion, bloom, tone mapping) that is
compatible with Three r186 (`postprocessing` peer-depends on
`three >= 0.168.0 < 0.187.0` — check this constraint if you bump versions).

Three.js r186 removed `THREE.PCFSoftShadowMap` — use `THREE.PCFShadowMap` with
`shadow.radius` for softness, not the removed soft type.

## Project layout

```
src/
  app/                 Preact UI
    App.tsx            screens: loading, title, HUD, pause, results
    icons.tsx           hand-drawn SVG icons (no raster assets, no text glyphs as meaning)
    state.ts            @preact/signals UI state + localStorage save/load
    styles.css          candy-button design system, safe-area aware, responsive
  game/
    sim/                PURE GAME LOGIC — no three.js import anywhere in this folder
      config.ts         tuning constants, level-difficulty curve, star thresholds
      rng.ts            seeded PRNG (mulberry32) — deterministic levels
      level.ts          procedural level generator (coin trails, obstacle placement)
      Sim.ts            fixed-step simulation: car physics, pickups, bumps, finish
    view/               rendering only, reads Sim state, never mutates game rules
      Stage.ts          renderer + post-processing chain + quality tiers
      Sky.ts            sky dome, parallax clouds, PMREM environment bake
      Lighting.ts       sun/hemisphere/rim lights, shadow-box following
      CameraRig.ts      chase camera, orbit camera (title/finish), easing
      WorldView.ts      streams town chunks + obstacles + instanced coins along the track
      Vfx.ts            GPU-instanced particles (sparkle/confetti/heart/drop/ring)
    input/Input.ts       drag-to-steer, tap-to-hop-lane, keyboard
    audio/Audio.ts       fully synthesized Web Audio music + SFX (no audio files)
    models/
      contracts.ts      TypeScript interfaces every asset module must implement
      library.ts        import.meta.glob-based loader: missing/broken asset module
                         falls back to a placeholder instead of crashing the game
      placeholders.ts   minimal box/sphere stand-ins satisfying every contract
      kit/              shared procedural-modeling toolkit (see below)
      car/              hero vehicle
      princess/         hero character
      town/             street/building/prop kit + chunk composer
      items/            coins, heart gem, obstacles
      landmarks/        castle gate, princess's home, distant backdrop
    Game.ts             orchestrates everything: boot, title, intro cinematic,
                         drive, finish, results; fixed-step sim loop + render loop
  lab/                  dev-only "model lab": render any asset alone with real
                         lighting/post, for building and QA (see below)
  main.tsx              entry point
tests/
  sim.test.ts           Vitest: level generation + simulation guarantees
  e2e/game.spec.ts      Playwright: desktop + Android phone + Android tablet
tools/
  shot.mjs              headless screenshot of any URL, waits for window.__ready
  tris.mjs              visible-triangle breakdown by scene object (perf debugging)
index.html              the game
lab.html                 the model lab
```

## Architecture rule: simulation and rendering are strictly separate

`src/game/sim/**` must not import `three`. It is plain TypeScript: positions,
velocities, collision boxes, scores, as numbers. This is what makes it
possible to unit-test "every level is finishable" in milliseconds without a
browser. `src/game/view/**` and `src/game/models/**` read `Sim` state each
frame and never feed state back into it except through explicit `Sim` methods
(`setTargetX`, `start`, `warpTo`).

Render at a fixed 60 Hz step independent of frame rate:

```ts
const STEP = 1 / 60;
// each rAF:
accumulator += dt;
while (accumulator >= STEP && steps < 8) {
  sim.step(STEP);
  accumulator -= STEP;
  steps += 1;
}
// interpolate the visual car position between the previous and current sim step
// using accumulator / STEP as alpha, so rendering stays smooth above/below 60 fps.
```

## Gameplay simulation — exact tuning

```ts
// src/game/sim/config.ts
export const TUNING = {
  roadHalf: 4.3,          // paved road half-width
  driveHalf: 3.1,         // car center stays within ±driveHalf
  carHalfWidth: 0.82,
  carHalfLength: 1.45,
  coinHover: 1.0,         // coin height above ground
  pickupHalfWidth: 1.45,  // generous pickup box around the car
  pickupHalfLength: 1.9,
  steerOmega: 9,          // critically-damped steering spring (rad/s)
  accel: 5.5,             // acceleration toward cruise speed
  bumpSlow: 0.5,          // fraction of speed lost right after a bump
  bumpRecover: 1.5,       // seconds to recover from bumpSlow
  invulnerable: 1.6,      // seconds of invulnerability after a bump
  bumpCoinLoss: 3,        // coins knocked loose per bump (fly forward, re-catchable)
  finishRunout: 18,       // distance past the finish line where the car rolls to a stop
  maxTrailSlope: 0.34,    // max |dx/dz| of a coin trail — must stay steerable by a toddler
  comboWindow: 0.9,       // seconds between coins to keep a combo going
} as const;

export function levelSpec(level: number) {
  const step = Math.min(level - 1, 7); // difficulty caps out at level 8
  return {
    seed: 1000 + level * 7919,
    length: 600 + step * 40,
    speed: 10.5 + step * 0.4,
    obstacleSpacing: Math.max(44, 78 - step * 5),
    gems: level === 1 ? 1 : 2,
  };
}

export function starsFor(collected: number, total: number): number {
  const ratio = total > 0 ? collected / total : 1;
  if (ratio >= 0.85) return 3;
  if (ratio >= 0.55) return 2;
  return 1; // finishing always earns at least one star
}
```

Collision footprints (x, z half-extents) for obstacle kinds `cones | ducks |
cart | puddle`: `{1.0,0.5} {0.9,0.5} {1.1,0.8} {1.2,1.0}`. Puddles never
bump — they only trigger a splash VFX/SFX and a giggle.

### Level generator (`level.ts`)

Generate levels from short hand-designed *patterns* laid end to end along
decreasing `z`, not from independent random placement — this is what
guarantees every level is finishable and steerable:

- `line(x, count)` — straight run of coins in one lane.
- `slalom(count, amp)` — a sine-wave coin trail, wavelength chosen so the peak
  slope never exceeds `maxTrailSlope`.
- `travelTo(x, withCoins)` — smoothly change lanes over a distance implied by
  `maxTrailSlope`, optionally dropping a coin trail along the way.
- `obstacleDodge()` / `coneGate()` / `duckCrossing()` / `puddleSplash()` — each
  places one obstacle plus a coin trail that steers *away* from it, so
  following the coins is itself the safe line.
- A shuffled "obstacle deck" (duplicate duck/dodge entries so ducks appear
  often, shuffle, draw without replacement, reshuffle when empty) guarantees
  variety without back-to-back repeats, and guarantees ducks show up in every
  level.
- Heart gems are spaced evenly through the level via a `nextGemZ` cursor.
- The last stretch before the castle is one long straight coin "carpet" at
  lane 0 — a calm, rewarding finish approach.
- After generation, **filter out any coin that overlaps a non-puddle
  obstacle's footprint** (expanded by the car's half-width plus margin), and
  **assert in a test** that at every z-slice, some contiguous band of the
  drivable width (`±driveHalf`) is free of every obstacle at that z — i.e. the
  road is never fully blocked.
- Keep the first ~40m and last ~45–60m of every level free of obstacles (safe
  start, safe castle approach).

### Simulation (`Sim.ts`)

State machine: `ready → drive → finish → done`. `drive` runs full gameplay.
On crossing the finish `z`, switch to `finish` and decelerate smoothly to a
stop using `v² = 2·a·d` solved for the exact remaining `finishRunout` distance
(no sudden stop). `done` is terminal for that run.

Steering: treat `targetX` (where the player wants to be) and the car's actual
`x` as a critically-damped spring (`steerOmega`), not a raw position write —
this is what makes dragging feel like steering a toy car instead of teleporting
a cursor.

Bumps: on overlap with a non-puddle obstacle (once per obstacle, cooldown via
`invulnerable`), do **not** fail the run. Instead: set `bump` impulse (for
visual squash/shake), start `invulnerable`, apply `bumpSlow` for
`bumpRecover` seconds, push the car sideways slightly, and spawn
`bumpCoinLoss` coins from the *collected* total back into the world as
"flying" coins that arc forward from the car (gravity + initial velocity) and
land back on the track as normal catchable coins. This is the mechanism that
makes bumps feel like a fun setback, not a punishment.

Emit a typed event queue (`coin`, `gem`, `bump`, `splash`, `coinsLost`,
`finish`, `stopped`) that the game drains each frame to trigger VFX/SFX/UI —
the sim never calls into rendering/audio directly.

### Required unit tests (`tests/sim.test.ts`, Vitest, no browser)

For every level in a representative set (e.g. 1,2,3,4,5,6,8,12):
1. **Determinism** — same level number generates byte-identical output.
2. **Steerable trails** — no coin-to-coin gap in a trail exceeds
   `maxTrailSlope` (with a small tolerance for eased curves).
3. **Road never fully blocked** — sample the drivable width in fine steps at
   every z where an obstacle is near; some band stays free.
4. **Coins never overlap solid obstacles.**
5. **A coin-chasing scripted driver** (steer toward the nearest reachable
   uncollected coin each step) finishes every level with **3 stars and ≤1
   bump**.
6. **A driver that never touches the controls** still reaches `done` with
   **≥1 star** — this is the actual "can't lose" proof.
7. **A randomly-wiggling driver** always reaches `done` (no soft-lock, ever).
8. **A driver that deliberately drives into an obstacle** triggers a `bump`
   event, loses coins, and at least one knocked-loose coin becomes catchable
   again.
9. Finishing lands within `[length, length + finishRunout]` and ends at speed
   0.

## Rendering: the "storybook globe" curved world

Make geometry far from the car curve down below the horizon and drift
sideways — like driving on a tiny round planet — rather than a flat road into
a flat skybox. This is what makes the world feel toylike and bounds how much
geometry you need to render (anything past the curve is naturally hidden).

Implement as a vertex shader patch applied to every world-space material:

```glsl
// uniform float uCurveOrigin; // = current car z
// uniform float uCurveY;      // bend strength, e.g. 0.0016
// uniform float uCurveX;      // slight sideways drift, e.g. 0.00045 * sin(...)
float dz = abs(uCurveOrigin - worldPos.z); // symmetric: bends ahead AND behind
worldPos.y -= uCurveY * dz * dz;
worldPos.x += uCurveX * dz * dz;
```

Patch it onto `MeshStandardMaterial`/`MeshPhysicalMaterial` via
`material.onBeforeCompile`, replacing `#include <project_vertex>`. Provide a
`curved(material, { wind?: true })` helper used by every world object's
material (town, obstacles, landmarks). Hero objects that sit at the curve
origin (the car, the princess) do **not** need it. Also add an optional `wind`
vertex attribute + sway function in the same shader patch, driven by a global
`uTime` uniform, so foliage/flags/bunting can sway without a separate
material.

Ease `uCurveY` toward a gentler value during the finish/results cinematic so
the castle "stands up" instead of looking bent during the celebration.

### Renderer + post-processing (`Stage.ts`)

- `outputColorSpace = SRGBColorSpace`, `toneMapping = NoToneMapping` on the
  renderer itself (tone mapping happens once, in the post chain, via
  `ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL })`) — don't double up
  tone mapping between the renderer and the composer.
- Post chain order: scene → `N8AOPostPass` (ambient occlusion) → one
  `EffectPass` combining `BloomEffect` (mipmap blur, `luminanceThreshold:
  0.92`, `intensity: 0.75`, `radius: 0.72`, 7 levels — so only strongly
  emissive things bloom, not every bright pastel surface) → `HueSaturationEffect`
  (+0.08 saturation) → `BrightnessContrastEffect` (+0.06 contrast) →
  `VignetteEffect` (`offset: 0.28`, `darkness: 0.34`) → `ToneMappingEffect` →
  `SMAAEffect` when MSAA is off.
- N8AO config: `aoRadius: 1.6`, `distanceFalloff: 1.0`, `intensity: 2.4`,
  `color: '#5a3a66'` (a warm-shadow tint, not flat black), `gammaCorrection:
  false` (it isn't the last pass), `depthAwareUpsampling: true`.
- Quality tiers (switch via `?q=high|medium|low`, auto-detected from
  `matchMedia('(pointer: coarse)')` otherwise):
  ```
  high:   dpr 2,    msaa 4, ao Medium,      aoHalfRes false, shadow 2048
  medium: dpr 1.6,  msaa 0, ao Performance, aoHalfRes true,  shadow 2048
  low:    dpr 1.25, msaa 0, ao off,                          shadow 1024
  ```
  Track a rolling average frame time; if it implies <42fps for two
  ~2-second windows in a row, step down one tier automatically (never
  up automatically — only an explicit `?q=` forces that).
- Shadows: `PCFShadowMap` (not the removed soft variant), `shadow.radius`
  for softness, `shadow.bias`/`normalBias` tuned to avoid acne, a shadow
  camera box that **follows the car** and snaps its center to shadow-texel
  increments along the light's right/up axes every frame (prevents
  shimmering). Only the car, obstacles, and nearby coins cast shadows; coins
  farther than ~36m skip the shadow pass entirely (draw them with a second,
  no-shadow instanced mesh).
- A PMREM environment, baked once from a small stand-in scene (simplified
  sky + ground-tinted disc + a few cloud blobs), so car paint/chrome/gold
  reflect believable sky colors without reflecting the real, expensive scene.

### Lighting

Hemisphere light (warm sky / cool ground bounce, low intensity) + one
directional "sun" with shadows (positioned from the upper-left-behind, i.e.
mostly behind/above the chase camera) + a weak cool rim light from the
opposite side to separate the hero from the background. Keep intensities
modest — oversaturated light on pastel colors reads as washed-out white, not
premium; tune by eye against the actual palette, not defaults.

### Sky

A big inverted sphere with a custom shader: vertical gradient
(ground-tint → horizon → mid → top) plus a sun disc/halo and a warm glow
band toward the horizon in the direction of travel. Separately, instanced
puffy cloud meshes (built once from blended-sphere SDF shapes, a handful of
variants) drift slowly toward the camera at a small fraction of camera speed
and wrap around — this parallax is what sells "far away" cheaply. The sky
dome is **not** affected by the curve shader (it's infinitely far); clouds use
their own simple parallax instead.

### Camera

One `CameraRig` producing a desired `{position, target, fov}` each frame,
eased toward with exponential damping (`1 - exp(-lambda * dt)`), never
snapped except on scene load — this is what makes mode transitions (title →
intro → drive → finish) feel directed instead of jarring.

- **Chase mode** (normal driving): position behind+above the car, scaled by
  aspect ratio so portrait phones get a higher, farther-back, steeper-down
  camera (the road must fill a tall screen, not the sky). FOV widens slightly
  with speed and is solved so a fixed amount of road width stays visible
  regardless of aspect. Add a tiny camera roll proportional to steering and a
  brief shake impulse on bumps, both damped quickly.
- **Orbit mode** (title screen, finish/results celebration): orbits a target
  point at a given radius/height/angle; portrait screens widen the radius and
  raise the height so the subject stays framed above a bottom results card.
- Keep look-behind culling distance mode-aware: while chasing the car nothing
  behind the camera needs to exist (~15m is enough); the title camera looks
  back up the street, so it needs a much larger look-behind window (~125m).

## World streaming (`WorldView.ts`)

The level is a sequence of town "chunks" of fixed length (e.g. 40m) placed
end to end along -z, built once up front during loading (chunks build in
single-digit milliseconds each once their variant is cached, so this doesn't
need to be lazy/streamed at runtime — just toggle `.visible` based on
distance from the camera). Cull aggressively: a chunk is visible only if it
falls within `[viewZ - lookAheadDistance, viewZ + lookBehindDistance]`; pick a
look-ahead distance that matches how far the curve shader keeps things above
the horizon (don't render chunks that are curved away into the ground anyway).
Coins and gems render via one `THREE.InstancedMesh` each (not one mesh per
coin) and are windowed the same way. The castle/home landmarks toggle
visibility based on remaining distance so they aren't drawn for the whole
level.

The first and last couple of chunks need a `clearLeft`/`clearRight` option on
the chunk builder: keep road/curb/sidewalk/lawn continuous but omit houses,
fences, lamps, and road-spanning props on the side occupied by the princess's
home (start) or the castle grounds (finish), and skip arches/bunting over the
road entirely when either side is cleared.

## Procedural modeling kit (`src/game/models/kit/`)

This is the toolkit every asset module builds on. Build it first.

**`palette.ts`** — one object of named hex colors (sky, ground, wall, roof,
trim, door, foliage, flower, hero-car, princess, coin/hazard colors) plus a
small set of `HOUSE_SCHEMES` (wall/roof/door/trim 4-tuples that are
pre-validated to look good together). Every model pulls colors from here, not
from ad-hoc hex strings, so the whole world reads as one cohesive palette.
Keep saturation a bit higher than looks right in isolation — rendered through
tone mapping + AO + a warm sun, flat pastel hexes wash out toward white; test
actual colors through the real render pipeline, not in a color picker.

**`geo.ts`** — a `PartBuilder` class: accumulate vertex-colored primitive
parts (each with position/rotation/scale, an optional baked gradient-shade
option for fake contact AO, an optional per-vertex `wind` amplitude, optional
flat/faceted normals) and merge them into **one** `BufferGeometry` per
material role per object — this is what keeps draw calls low (a whole street
chunk should render in ~5 draw calls, not fifty). Plus geometry factories:
rounded box, sphere, cylinder, cone, torus, capsule, a spline-smoothed
`lathe` (for towers/domes/bottles), a beveled `extrude` (for signs/badges/
hearts/stars from 2D shapes), `tube` (cables/rails/trails), shape helpers
(heart, star, rounded-rect, arch), and a noisy `blob` (displaced icosahedron —
good for bushes/canopies).

**`sdf.ts` + `mesher.ts`** — a small signed-distance-field sculpting kit:
primitives (`sphere`, `ellipsoid`, `roundBox`, `capsule`, `roundCone`,
`torus`, `cylinder`), boolean-ish operators (`union`, `blend` = smooth union
with a radius — this is the one that gives the "soft clay" look instead of
hard-edged CSG, `subtract` = smooth carve with an optional *different*
material id for the newly-exposed inner surface, `intersect`), and transforms
(`move`, `rotate`, `scale`, `mirrorX`, `inflate`, `shell`, `displace`,
`paint`, `paintBy`). `meshSdf(node, { min, max, cell, colors|colorFn,
project })` turns a composed SDF tree into a smooth, vertex-colored
`BufferGeometry` via surface nets with a coarse pre-pass (sample a sparse
grid first, only refine near the surface) so a ~60k-triangle mesh builds in
roughly 100–200ms. Use this for the hero car body (blended fenders/hood/
cockpit) and parts of the princess (hair, dress) where a seamless sculpted
look matters more than raw speed; use the cheaper `PartBuilder` primitives for
everything repeated (houses, props, obstacles).

**`materials.ts`** — a small fixed set of shared material *roles*, not
per-object materials: `matte`, `matteWind`, `satin`, `gloss` (clearcoat),
`metal`, `glass` (tinted, reflects env), `glow` (unlit, for things meant to
bloom), `foliage` (wind + slight emissive tint for self-shadow fill). Every
vertex-colored mesh picks one of these roles via `mat(role)` / `meshOf(geo,
role)`, so dozens of differently-colored objects share a handful of actual
GPU materials/programs. This file also owns the `curved()` shader patch
above.

## Model contracts (`contracts.ts`) — build placeholders first, real assets second

Define these interfaces before writing any real asset, and write a
`placeholders.ts` that trivially satisfies every one of them with boxes/
spheres. Wire `library.ts` to discover real implementations by
`import.meta.glob` over `models/<domain>/*.ts` (excluding `*.lab.ts`), falling
back to the placeholder per-export if a module is missing or throws on load.
This lets the whole game run and be tested end-to-end from day one, and lets
you (or parallel workers) build each visual domain independently without ever
having a broken build.

```ts
interface CarRig {
  root: THREE.Group;
  seat: THREE.Object3D;           // world-attachable seat anchor for the princess
  steeringWheel: THREE.Object3D;  // rotates with steer input
  update(dt: number, state: { time; speed; steer; bump }): void;
  setPaint(color: THREE.ColorRepresentation): void; // future recolor/garage feature
  dispose(): void;
}

interface PrincessRig {
  root: THREE.Group;
  standHeight: number;            // root.y when standing on the ground
  setPose(pose: 'stand' | 'sit'): void;
  setMood(mood: 'happy' | 'surprised' | 'joy', holdSeconds?: number): void;
  wave(): void;
  cheer(): void;
  update(dt: number, state: { time; steer; speed; walk }): void;
  dispose(): void;
}

interface TownChunk { group: THREE.Group; dispose(): void; }
function buildTownChunk(index: number, seed: number, opts?: { clearLeft?: boolean; clearRight?: boolean }): TownChunk;

type ObstacleKind = 'cones' | 'ducks' | 'cart' | 'puddle';
interface ObstacleRig {
  root: THREE.Group; kind: ObstacleKind; halfWidth: number; halfDepth: number;
  update(dt: number, time: number, driftX?: number): void; // driftX = root's current sideways velocity, so animals can face where they're going
  react(side: -1 | 1): void;   // hit reaction, side = direction things fly/hop toward
  reset(): void;               // back to idle, for pooling
  dispose(): void;
}
function createObstacle(kind: ObstacleKind, seed?: number): ObstacleRig;

interface Landmark { group: THREE.Group; update(dt, time): void; dispose(): void; }
interface PrincessHome extends Landmark { doorPosition: THREE.Vector3; pathPoints: THREE.Vector3[]; }
interface Backdrop extends Landmark { update(camera: THREE.Camera): void; }

function createCoinGeometry(): THREE.BufferGeometry;      // caller owns it (instanced)
function coinMaterial(): THREE.Material;                   // one shared material
function createHeartGemGeometry(): THREE.BufferGeometry;
function heartGemMaterial(): THREE.Material;
function createCastleGate(): Landmark;
function createPrincessHome(): PrincessHome;
function createBackdrop(): Backdrop;
```

**Contact points between the car and the princess rig (must match exactly, or
she'll float outside the seat / clip through the steering wheel):**
- `seat` sits at the top-center of the seat cushion, roughly `(0, 0.62, 0.25)`
  relative to the car root.
- `steeringWheel`'s center is roughly `(0, 0.42, -0.52)` relative to `seat`,
  radius ~0.2, tilted ~55° from horizontal, facing the driver.
- The seat-back rises behind the seat up to roughly `0.55` above it — tall
  enough to read as a seat, short enough that her shoulders/head/hair/crown
  stay clearly visible above it from the chase camera (which sits ~3–4 units
  above and ~6–8 units behind the car, looking slightly down).
- `PrincessRig.standHeight` + the rig's own height must put her head
  comfortably below typical UI chrome in the title shot.

**Visual quality bar per domain** (score your own screenshots honestly before
calling a domain done — see "visual QA" below):
- **Car** (hero, ≤60k tris, ≤10 draw calls): a bubbly retro convertible, body
  sculpted as one smooth blended SDF shape (no boxes-and-cylinders feel):
  rounded fenders, carved cockpit with a contrasting interior color, a heart-
  or scallop-shaped seat back, gold-framed windshield, round chrome
  headlights + a friendly chrome grille, glowing heart tail lights (bloom),
  whitewall tires with patterned gold hubcaps, a visible spare wheel and a
  small pennant flag on the back (the rear is what the chase camera shows
  95% of the time — make it delightful), a tiny crown hood ornament, pearl-
  clearcoat paint that reflects the sky.
- **Princess** (hero, ≤35k tris, ≤12 draw calls): chibi proportions (big
  round head), a face texture atlas swapped by mood (happy/surprised/joy,
  plus blinking) rather than separate geometry per expression, sculpted hair
  with pigtails/bow or ponytail that physically sways with steering and speed
  (a single high ponytail can disappear behind the head from the chase
  camera and clip the seat-back — test this), a gold crown, a puffy-sleeved
  dress, idle breathing, a one-shot `wave()` and `cheer()`.
- **Town** (≤60k tris, ≤6 draw calls per chunk, builds in low-tens of ms):
  at least 5–6 distinct chunk "archetypes" (ordinary cottage street, a
  blossom avenue with a rose arch over the road, a market square with
  striped stalls, a park with a fountain and balloons, tower houses with
  bunting) so a full level never feels repetitive; houses with varied
  roofs/trim/windows from `HOUSE_SCHEMES`, trees/hedges/flowers, lamp posts,
  fences, a textured cobblestone road with a soft heart/dash center line.
- **Coins/gem/obstacles**: a thick, chunky, embossed coin (not a flat disc)
  that pops visually against the road and grass; a faceted heart-shaped gem
  with its own warm "studio" reflection (the real sky/grass env map turns
  gold/pink olive-green — bake a separate warm env for pickups); obstacles
  with distinct, readable-at-a-distance silhouettes and a genuinely cute
  idle animation each (traffic cones, a mother-duck-and-ducklings crossing
  that waddles and turns to face wherever it's currently drifting, a flower
  cart, a shiny puddle that only splashes).
- **Landmarks**: an iconic, multi-tower pink castle spanning the road with a
  clear, wide archway (≥10m clear width, ≥6m vertical clearance) the car
  drives straight through, flags/banners/garlands, a checkered finish line;
  a smaller, homely manor for the princess's start with a short garden path
  to where the car is parked; 2–3 parallax hill layers plus a hazy silhouette
  of the castle visible from far away down the road, fading in as the real
  one approaches over the curved horizon.

## Input

Core control: **drag anywhere on the screen** and the car's target position
follows the finger's horizontal delta from where the drag started (relative,
not absolute — so the car doesn't jump to wherever she first touches). A
quick tap (not a drag) on the left or right half hops one lane that
direction. Only the first touch point counts, so a resting palm elsewhere on
a tablet screen can't hijack steering. Keyboard: arrow keys / A-D for
steering, Space = horn, Escape/P = pause, Enter = confirm. No control should
require precision smaller than roughly a thumb's width on a phone.

## Audio

Synthesize everything with the Web Audio API — no audio files, nothing to
license or attribute. A tiny step-sequencer plays simple pentatonic "music
box" melodies (different short loops for title / driving / results) over a
soft bass pluck and pad, through a convolution reverb (an exponentially-
decaying noise buffer makes a perfectly good impulse response — no file
needed) and a limiter so nothing can ever be harsh. One-shot SFX (coin
chime, gem shimmer, soft bump thud + short noise burst, splash, horn,
fanfare, per-star chime) are built from a handful of enveloped oscillators
plus filtered noise. A continuous low engine hum oscillator tracks speed.
Unlock the `AudioContext` on first pointer/key event (required by mobile
browsers) and suspend it when the tab is hidden.

## UI

Preact + `@preact/signals` for state (`screen`, `coins`, `progress`, `stars`,
`paused`, `muted`, saved best-stars per level in `localStorage`). Every
interactive control is a big circular "candy button" (layered gradient +
white rim + bottom drop-shadow + a glossy highlight) rendered as inline SVG
icons — pause/play, home, replay, next-level, mute, horn, stars, a coin icon,
a tiny road-progress bar with house/car/castle icons. No label text anywhere
the player needs to read to play. Respect safe-area insets
(`env(safe-area-inset-*)`) everywhere, support both portrait and landscape,
and make sure nothing blocks the driving surface.

## PWA / installable / offline

`vite-plugin-pwa` with `registerType: 'autoUpdate'`, a manifest
(`display: 'fullscreen'`, apple touch icon, 192/512/maskable PNG icons — fine
to render these from inline SVG with a headless browser script rather than
hand-drawing), and `workbox` precaching everything the build emits. Block
pinch-zoom/double-tap-zoom (`viewport` meta + a `gesturestart`/`dblclick`
preventDefault) so it feels like an app, not a web page. `vite.config.ts`
should read a `BASE` env var for the base path, for hosts that serve from a
sub-path.

## Dev/QA tooling — build this alongside the game, not after

**Model lab (`lab.html` + `src/lab/`)**: a second, minimal entry point that
renders a registered model (car/princess/any town prop/obstacle/landmark) in
isolation, lit and post-processed exactly like the real game, driven by URL
params (`?m=<name>&yaw=&pitch=&dist=&fov=&ground=grass|road|none&anim=0&t=`).
Every asset module exports a `.lab.ts` sibling registering its showcase
views. This is how you (or a sub-agent) iterate on one model's look and
triangle budget without booting the whole game, and it's what makes the
visual-quality bar in this prompt actually checkable.

**Headless screenshot tool (`tools/shot.mjs`)**: Playwright-driven; navigates
to a URL, waits for `window.__ready === true`, screenshots, optionally reports
`window.__GAME__.stats()` (renderer draw calls/triangles, sim phase/
position/score) and any console errors. Support `--device "Pixel 7"` style
device emulation and a `--delay` for letting an idle animation settle. The
game should expose:
```ts
window.__ready = true;          // set once the first meaningful frame is up
                                  // (and after a few settle-frames when ?freeze is used)
window.__GAME__ = { stats(): {...}, game };
```
Add URL flags purely for QA, guarded so they can't accidentally ship visible
to players: `?debug` (on-screen fps/drawcalls/triangles/tier/dpr overlay),
`?autoplay` (skip straight past the title), `?bot` (a scripted "always steer
toward the nearest reachable coin" driver, for automated full-level runs),
`?nobot` (disable the bot even with `?freeze` set, so you can script your own
test driver into a specific obstacle), `?at=<meters>` (warp the sim to a
distance instantly, for screenshotting any part of a level without driving
there), `?freeze=<seconds>` (pause sim time at a given moment and then set
`window.__ready`), `?timescale=<n>` (speed up the whole game for fast
end-to-end full-level test runs), `?cam=hero|side` (alternate showcase
cameras while driving), `?q=high|medium|low` (force a quality tier), `?level=`.

**Playwright e2e (`tests/e2e/game.spec.ts`)** against the **production
build** (`vite build && vite preview`), not the dev server (dev-server HMR and
missing service worker produce different behavior than what ships) — set
`reducedMotion: 'reduce'` in the test config so CSS breathing animations on
buttons don't make Playwright's actionability checks flaky. Projects for
Desktop Chrome, a Pixel-class Android phone, and a Galaxy-Tab-class Android
tablet (Playwright's built-in device descriptors). Minimum coverage:
1. Title screen renders, Play works, steering input actually moves the car
   (drag on desktop, tap-to-hop-lane on touch devices), coins get collected,
   pause freezes sim time and resume continues it, zero console errors, draw
   calls stay under a sane cap (e.g. <250).
2. A full level, driven by `?autoplay&bot&timescale=3`, reaches the results
   screen with a plausible number of coins collected and zero console
   errors, within a generous timeout (full-speed real-time level completion
   can be 60–90 real seconds; budget accordingly even with timescale).

**`tools/tris.mjs`**: dumps a visible-triangle/draw-call breakdown by top-level
scene object from a running page, for finding which system blew the budget
after a change (town chunks vs. coins vs. the car vs. particles, etc.) — far
faster than guessing from `renderer.info` alone.

## Performance budgets (target, not aspirational)

- Whole-scene draw calls: under ~130 while driving through town, under ~90 in
  isolated/title shots.
- A full town chunk: ≤60k triangles, ≤6 draw calls, builds in ≲15ms.
- Hero car ≤60k tris/≤10 calls; princess ≤35k tris/≤12 calls; any one
  obstacle kind ≤6k tris/≤4 calls; castle gate ≤120k tris/≤10 calls; home
  ≤60k tris/≤8 calls; backdrop ≤40k tris/≤6 calls.
- Measure with `tools/tris.mjs` and `?debug` after every visual change, not
  just once at the end — it's much cheaper to catch an accidental 3× triangle
  regression immediately than to find it in a final pass.
- It is fine to defer low-end/budget-tablet-specific optimization to a later
  pass if the user says so explicitly, but keep the instancing/culling/shared-
  material discipline above from day one regardless — retrofitting it later
  is far more expensive than building it in.

## Build order (do not skip ahead — each phase should leave a playable,
non-broken game)

0. **Foundation.** Vite + TS + Preact scaffold, `tsconfig` strict, the
   procedural modeling kit (`kit/`), `Stage`/`Sky`/`Lighting`/`CameraRig`,
   the model lab + screenshot tool, contracts + placeholders +
   `library.ts`'s glob-with-fallback loading. Render a placeholder box-car on
   a placeholder road. Get this fully working and screenshot-verified before
   writing a single real asset.
1. **Vertical slice.** `sim/` (full simulation + its unit tests), `Game.ts`
   wiring boot → title → drive → finish → results with placeholder models,
   `Input`, basic HUD. You should be able to drag-steer a box through a
   level and reach a results screen with stars, end to end, before any real
   art exists.
2. **Art pass.** Build car → princess → town → items/obstacles → landmarks,
   each against the model lab first, each replacing its placeholder in
   `library.ts` automatically once it exports the right names. These five
   domains are largely independent of each other (they only share the
   `contracts.ts` interfaces and the `kit/`), so if you have the ability to
   parallelize work (e.g. multiple sub-agents), this is the phase to do it —
   but keep each one inside its own folder and don't let them edit shared
   kit files concurrently.
3. **Feel pass.** `Vfx.ts` particle systems wired to every sim event,
   `Audio.ts`, camera polish (shake, roll, mode-specific framing), the intro
   walk-to-car cinematic, honk/wave/cheer interactions.
4. **Ship.** PWA manifest + icons + offline caching, responsive UI pass on
   real phone/tablet aspect ratios, full Playwright e2e across
   desktop/phone/tablet against the production build, a README explaining
   how to run/build/test and every QA URL flag.

## Definition of done

- `tsc --noEmit` is clean across the whole project.
- All Vitest sim tests pass (determinism, steerability, never-blocked-road,
  no-coins-on-obstacles, scripted-driver-gets-3-stars, idle-driver-still-
  finishes, random-driver-never-soft-locks, bump-knocks-coins-loose-and-
  recoverable, smooth-finish-stop).
- Playwright e2e passes on Desktop Chrome, an Android phone profile, and an
  Android tablet profile, against the production build.
- `window.__GAME__.stats().models.placeholder` is empty — every real asset
  module loaded successfully, nothing silently fell back.
- Screenshots taken via `tools/shot.mjs` at the title screen, mid-drive
  (desktop + phone + tablet), the castle approach, and the results screen all
  show: no default Three.js primitives, no placeholder boxes, coherent
  pastel art direction, readable HUD with safe-area margins respected, and a
  nonblank, correctly-colored canvas.
- The production build is installable (manifest + service worker present,
  Lighthouse-installable) and the game is playable after going offline post
  first load.
- Driving into every obstacle kind at least once during manual or scripted
  testing confirms: the run never ends in failure, and a knocked-loose coin
  can be caught again.
