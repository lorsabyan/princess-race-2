# 3D stack: Princess Race 3 (Rose Road)

Decisions for this build. Keep it short and current so later sessions stay consistent.

- **Archetype:** C game + N environments (J upgrade of the existing Princess Race 2).
- **Track:** WebGL (three 0.186.x). `postprocessing` and `n8ao` cap three below 0.187, and the
  game's materials use `onBeforeCompile`, so WebGPU would mean porting 6 shader files for no gameplay gain.
- **Framework:** vanilla three.js + TypeScript, Vite 8, Preact + Signals for UI, installable PWA.
- **Libraries:** three 0.186.1, postprocessing 6.39.5, n8ao 2.0.1, lil-gui 0.21 (dev). No new dependencies.
- **Assets:** procedural only (no network calls after load, no generation keys, works offline).
- **Targets:** phones, budget Android tablets, desktop. A 5-year-old plays it. No fail state, no reading.
- **Perf budget:** desktop/mobile 60/30 fps, under 150/80 draw calls, under 1M/300k visible triangles.
  Measured on a Mac at five stops, shadow pass included: high 104-131 draw calls and 570-715k
  triangles, medium 107-124 and 460-525k, low 78-94 and 280-485k. The mobile budget is still
  exceeded at most stops; phones rely on the quality tiers. `tier.ts` starts old phones on low.
  Neither `main` nor a real phone was measured.
- **Comparing frame rates:** only as an A/B of two production builds, alternating, in one sitting.
  The same build moved by 40% between sittings, and hiding the car or princess changed nothing
  measurable. On a phone-sized screen with the CPU slowed 4x, the tier and scenery work took medium
  from 175 to 220 fps and low from 202 to 266 at the forest stop, with 31% fewer triangles.
- **Static scenery is frozen:** `freeze` in `WorldView` turns off matrix updates for chunks, terrain
  and far scenery, and for their parents, up to the scene. A parent that updates forces all its
  children to, so one unfrozen parent undoes it. Anything that moves must stay outside these groups.

## Decisions from the interview

- Gameplay: **winding road**. Real curves and hills through several areas, still auto-driving,
  still steer-only, still no way to lose.
- Codebase: **reuse the best parts** on branch `winding-road`. Keep princess, car, town, items,
  audio, UI and rule tests; rebuild road, world, camera framing and landscape.
- Look: **explore 2-3 looks** with the rubric below.

## How the road works

- The sim stays straight: `(x, z)` with `s = -z`. Rule tests never see the curve.
- `src/game/sim/track.ts` is a pure 3D centerline. `src/game/sim/landscape.ts` is a pure height field.
- `src/game/view/warp.ts` bends each finished chunk onto the track once, at level load, so geometry,
  normals, shadows and lighting are all truly in world space.
- The shader bend is now a mild radial "tiny planet" around the car, only to hide the far distance.
- Far scenery is one merged mesh per material in road order, so any stretch of road is a single
  ranged draw. Terrain is one mesh; distant trees are blocks along the road, shown by distance.

## Surface and air

- `kit/noise.ts` is one 256 px tiling texture shared by every world shader, so per-pixel detail costs
  a texture read. `curved()` patches it in: drifting cloud shadows and forest dapples dim the direct
  sun on everything but the car and princess (they keep their own materials, and stay readable).
  `detail: 'grass'` and `detail: 'leaves'` add per-pixel surface patterns.
- Every paving stone is drawn twice: into the color atlas and into a height canvas, which
  `reliefTexture` turns into the normal map. Curbs are stone blocks in the ground mesh and atlas.
- `view/Grass.ts`: real grass and tulip heads near the road. Instances are shuffled, so a tier draws
  a share of them; they shrink away with distance instead of popping. The `low` tier has none.
- `view/Air.ts`: petals, seeds, butterflies and forest light shafts, all moved in the vertex shader.
  Near ones slide past fast and far ones barely move: a strong depth cue for very few triangles.
- Clouds are lit in their own shader, soft at the edges, and fade out when right overhead.

## Car and princess

- The car is a 1950s convertible: one clean hull with tail fins and a scooped side panel, meshed
  finely and decimated (`kit/decimate.ts`), so edges stay crisp at about the same triangle count.
- `carMaterials.ts` draws shut-lines, the cream side panel, its pinstripe and paint flakes per pixel
  from object-space position: far finer than vertex colors, and no extra draw calls.
- Car paint looks like paint because of what it mirrors: `carEnv.ts` is a small studio with a bright
  horizon over dark hills and a long cloud overhead. Change that before touching the paint itself.
- Hair is one smooth sculpt; strands come from the shader. Each vertex stores which way the hair
  runs (`hair` attribute: flow + position across strands), and a Kajiya-Kay highlight gives the
  band of shine that slides as she turns. Bows have no flow, so they skip it.
- Ribbon tails live in the hair mesh. `flutter` is 0 at the knot and 1 at the tip; the vertex shader
  blows them back with speed (`uWind`) and lets them hang when she stops.
- Skin keeps its shade rosy (no green bounce from the grass) and warms up where the shadow begins.
- `HERO_SHADOW_VERTEX`: the shadow map is coarse next to the heroes, so they use a bigger normal
  bias than the world. Without it they speckle themselves.

## Time of day

- `lookForLevel` runs the day over the levels: sunny, sunny, golden, dusk, then a new day. `?look=name`
  still holds one look for every level.
- `LOOK_NOW` is one object changed in place by `chooseLook`, which also moves `SUN_DIR`. Anything
  built per level (terrain, water, grass) just reads it. Anything that outlives a level has an
  `applyLook()`: lighting, sky, stage, air, backdrop, car. A new long-lived look reader needs one too.
- `LOOK_NOW.lights` is how far evening has come: windows (one shared glass material), stars,
  headlights and fireflies follow it.
- Reflections are cached per look, in `Game.skyLight` and in `carEnv.ts`. Coins keep one sunny
  reflection map at every time of day, and the distant castle keeps its sunny baked colors.

## Look rubric (score 0-2 each, phone counts as much as desktop)

1. The princess and car read within one second on a busy background.
2. The road ahead reads as a sweeping curve, not a flat strip.
3. Each area is recognisable at a glance (town, meadow, forest, lake, castle).
4. Warm, gentle, safe storybook mood, with nothing dark or scary for a 5-year-old.
5. No blown highlights, haze or banding; grounded with contact shadows and AO.

## Look scores

Scored from a contact sheet at three stops (forest, lake, meadow), desktop and phone.

| Criterion | sunny | golden | dusk |
|---|---|---|---|
| Car and princess read in 1 s | 2 | 2 | 1 |
| Road reads as a sweeping curve | 2 | 2 | 2 |
| Areas recognisable at a glance | 2 | 1 | 1 |
| Warm, gentle, safe mood | 2 | 2 | 1 |
| No blown highlights or haze | 2 | 1 | 1 |
| **Total** | **10** | **8** | **6** |

Pick: **sunny**, with golden's lower, warmer sun and peachier horizon grafted in. Golden turns the
lake beige and dusk merges the pink car into a magenta road. Both stay in `src/game/view/look.ts`:
try `?look=golden`, or change `DEFAULT_LOOK` to switch for good.
