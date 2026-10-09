# Princess Race 2

**[Play it here](https://lorsabyan.github.io/princess-race-2/)**

A gentle 3D driving game for a 5-year-old: the princess hops into her pink convertible, drives through Rose Town collecting coins, and arrives at the castle. There is no way to lose — bumps just slow the car down and knock a few coins loose to catch again.

Runs in any modern browser on phones, tablets and computers, and installs to the home screen as an app that works offline.

## Play / develop

```bash
npm install
npm run dev          # http://127.0.0.1:5190
```

To try it on a phone or tablet on the same Wi-Fi:

```bash
npx vite --host 0.0.0.0
```

then open `http://<your-computer-ip>:5190` on the device. (Offline/install needs HTTPS, so use a deployed build for that.)

Controls: drag anywhere to steer (or tap the left/right side to hop a lane), the gold button honks the horn. Keyboard: ←/→ or A/D, Space = horn, Esc/P = pause.

## Build & deploy

```bash
npm run build        # typecheck + production build into dist/
npm run preview      # serve dist/ locally
```

`dist/` is a static site: drop it on any static host with HTTPS (Cloudflare Pages, Netlify, GitHub Pages). For a sub-path host such as GitHub Pages use `BASE=/<repo>/ npm run build`.

This repo deploys itself: every push to `main` runs [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml), which builds with `BASE=/princess-race-2/` and publishes to GitHub Pages.

## Tests

```bash
npm test             # simulation rules: every level finishable, trails steerable, no soft-locks
npm run test:e2e     # browser play-through on desktop, Android phone and Android tablet
```

## Project layout

| Path | What |
|---|---|
| `src/game/sim/` | Pure gameplay rules (no rendering): level generator, fixed-step simulation |
| `src/game/view/` | Renderer + post-processing, sky, lighting, camera, world streaming, particles |
| `src/game/models/` | Procedural models: `kit/` (SDF sculpting, part builder, materials), `car/`, `princess/`, `town/`, `items/`, `landmarks/` |
| `src/game/audio/` | Synthesized music and sound effects |
| `src/app/` | Preact UI (title, HUD, pause, results) and saved progress |
| `lab.html` | Model lab: `/lab.html?m=<item>` renders any model with the game's lighting |
| `tools/shot.mjs` | Headless screenshots: `node tools/shot.mjs "/?autoplay&freeze=8" out.png` |

Useful URL flags: `?debug` (fps / draw calls), `?q=high|medium|low` (quality), `?level=3`, `?autoplay`, `?bot` (auto-drive), `?at=500` (start 500 m in), `?freeze=8` (stop time at 8 s for screenshots).

The previous prototype is preserved in git under the `legacy` tag.
