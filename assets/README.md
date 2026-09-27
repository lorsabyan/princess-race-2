# Princess Race Asset Pipeline

This project uses `agy` as the asset-direction route instead of `GEMINI_API_KEY`.

The browser game never calls image, sound, or 3D generation APIs. Generated assets are treated as local production files that are reviewed, compressed, licensed, and then imported into Three.js.

## Run the agy asset director

```bash
npm run assets:agy
```

This sends `assets/briefs/agy-asset-director.md` to the installed `agy` CLI and saves the response to:

```text
assets/briefs/agy-output.md
```

Optional overrides:

```bash
AGY_MODEL="Gemini 3.5 Flash (High)" npm run assets:agy
node scripts/run-agy-asset-director.mjs --prompt assets/briefs/agy-asset-director.md --out assets/briefs/agy-output.md --timeout 15m
```

## Folder layout

- `assets/concepts/`: source images for image-to-3D, texture references, title art, UI icons.
- `assets/models/`: downloaded and optimized GLB/FBX models.
- `assets/audio/`: music loops, ambience, SFX, and voice lines.
- `assets/licenses/`: source URLs, license text, attribution notes, and generation receipts.
- `assets/asset-plan.json`: target asset list and production prompts.

## Rules

- Do not add API keys to `src/`, Vite env files, or committed assets.
- Do not use generated assets in the game until their license/source notes are recorded.
- Prefer GLB for Three.js runtime models.
- Keep high-value assets small enough for mobile browser play.
- Test generated models in-game, not only in a model viewer.
