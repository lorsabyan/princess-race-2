# Task

You are the asset director for a premium Three.js browser game for a 5-year-old child.

Produce an asset production plan that uses `agy` orchestration rather than `GEMINI_API_KEY`.

Start your answer with:

```text
# Asset Production Brief
```

Do not answer with only your model name. Do not ask what to do next.

The game:

- Princess sits in a pink car, then drives automatically through a refined city.
- The player steers with an on-screen virtual wheel.
- It should feel like a gentle endless runner, close to Minion Rush camera language, but safer and calmer.
- Visual style: premium, soft, professional, subdued colors, not cheap cartoons, not loud neon.
- Target platform: browser, Three.js, desktop and mobile.
- Target child age: 5.

# Output Required

Return a concise Markdown production brief with:

1. A prioritized asset batch list.
2. Exact image-generation prompts for concept images.
3. Exact image-to-3D prompts or instructions for models.
4. Exact audio search or generation prompts.
5. Recommended filenames under `assets/concepts`, `assets/models`, and `assets/audio`.
6. A license and attribution checklist for any open source audio.
7. A short Three.js integration checklist.

# Important Constraints

- Do not assume `GEMINI_API_KEY`.
- Use `agy` as the coordination layer.
- Do not place API keys in browser code.
- Do not include scary, violent, or intense assets.
- Keep all visual prompts child-safe, elegant, and warm.
- Favor readable silhouettes over dense detail.
- Favor GLB/PBR outputs for 3D models.
- Favor short looping audio with gentle musicality.
