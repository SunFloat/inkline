# Contributing

Thanks for helping inkline draw better.

## Setup

```bash
cd skills/inkline/engine
npm install
npm test            # unit tests + end-to-end renders (skipped without Chrome)
```

Try changes against real inputs:

```bash
../scripts/inkline still ../../../examples/fox.svg --style whiteboard --no-pen
../scripts/inkline sheet path/to/portrait.jpg --styles graphite,charcoal,neon
../scripts/inkline preview path/to/portrait.jpg
```

## Where things live

| Area | File |
|---|---|
| Photo → strokes (lines, faces, hatching, order) | `engine/core/trace.js` |
| The finished pencil drawing behind reveal mode | `engine/core/sketch.js` |
| Grounds and drawing tools | `engine/core/materials.js` |
| Seekable renderer (timeline, pen, camera, wash) | `engine/core/render.js` |
| Frame capture, encoding, sheets, stills | `engine/src/pipeline.js` |
| Drawing sound | `engine/src/audio.js` |
| Presets | `engine/styles/*.json` |
| What Claude does | `SKILL.md`, `references/*.md` |

## Rules

- Rendering stays deterministic: no `Math.random`, no wall-clock time in `core/`. Use the seeded `rng`.
- `core/` files are classic browser scripts (no imports) so they run from `file://`, in headless Chrome and on the site.
- A new preset needs a row in `references/styles.md`, the README table, and a look at `inkline sheet` output on at least one portrait and one SVG.
- Keep the skill text short and imperative; it is read by a model on every run.

## Regenerating the site data

```bash
node site/build.js
```
