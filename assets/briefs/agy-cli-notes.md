# agy CLI Notes

Current project route: use `agy` instead of `GEMINI_API_KEY` for asset planning and provider orchestration.

Probe results:

- `agy models` is available and lists Gemini, Claude, and GPT-OSS models.
- `agy --help` exposes agent/session commands, not a direct image or audio generation subcommand.
- `agy --print` runs from this workspace, but current responses did not follow exact production-brief prompts during the probe.

Operational meaning:

- The game and tooling should not depend on `GEMINI_API_KEY`.
- `agy` can be used as the interactive agent layer for browser/platform work.
- Direct image, 3D, and audio generation still needs a connected platform, plugin, browser session, or another provider tool.
- Keep generated files local under `assets/` and keep license/source notes under `assets/licenses/`.

Useful commands:

```bash
agy models
npm run assets:agy
node scripts/run-agy-asset-director.mjs --allow-unstructured
```
