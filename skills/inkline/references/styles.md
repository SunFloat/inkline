# Styles

A style is a JSON file. Presets live in `engine/styles/`; user styles in `./.inkline/styles/`
(project) and `~/.inkline/styles/` (global). Lookup order: project → global → preset, so a
project style named `graphite` shadows the preset. Pass a name (`--style graphite`) or a path
(`--style ./my-look.json`).

## Presets

| Name | Medium | Mode on photos | Tool | Sound | Colour wash |
|---|---|---|---|---|---|
| `graphite` | HB pencil on cold-press paper | reveal | pencil | pencil | yes |
| `charcoal` | willow charcoal on grey Ingres paper | reveal | charcoal stick | chalk | no |
| `sanguine` | red chalk on aged laid paper | reveal | chalk | chalk | no |
| `watercolor` | sepia fineliner, then watercolour | reveal | fineliner | pen | yes, strong |
| `ballpoint` | blue ballpoint in a ruled notebook | reveal | ballpoint | pen | no |
| `fineliner` | 0.3 mm ink on bristol, engraving-like | strokes | fineliner | pen | yes, light |
| `whiteboard` | chisel marker on melamine, blue shading | strokes | marker | marker | yes |
| `chalkboard` | white chalk on slate | reveal (inverted) | chalk | chalk | no |
| `blueprint` | technical pen on cyanotype | reveal (inverted) | fineliner | pen | no |
| `neon` | light painting on black, glowing | reveal (inverted) | light dot | pen | no |
| `gold` | metallic gold ink on black card | reveal (inverted) | fineliner | pen | no |

**Modes.** On photos, `reveal` builds the finished drawing as a raster (pencil-sketch line work
plus hatching texture) and the strokes uncover it band by band under the tool; this is what makes
portraits look like real drawings. `strokes` draws vector lines only (engraving / marker look).
SVG input always uses `strokes`. `ink.mode: "auto"` picks reveal for photos.

**Inverted.** On dark grounds the tool lays down light, so tone follows brightness:
`trace.invert` and `sketch.invert` are `true` for chalkboard, blueprint, neon and gold. Set both
when you make a dark-ground style.

## Writing a style

```json
{
  "name": "brand",
  "extends": "fineliner",
  "label": "Brand blue",
  "medium": "fineliner in brand blue on warm white",
  "ink": { "color": "#1f4fd8" },
  "paper": { "color": "#fffdf7" },
  "trace": { "hatch": "hatch", "hatchDensity": 0.45 }
}
```

`extends` merges deeply: only the keys you write change. Chains are allowed (max 8 deep).

## Every key

### `paper` — the ground

| Key | Type | Default | Meaning |
|---|---|---|---|
| `texture` | `paper` · `whiteboard` · `chalkboard` · `blueprint` · `notebook` · `black` · `aged` · `kraft` · `none` | `paper` | procedural ground: fibres, tooth, rules, grid, ghosting of erased drawings |
| `color` | hex | `#f3f1ec` | base colour |
| `grain` | 0–1 | 0.35 | paper tooth strength (`paper` texture) |
| `vignette` | 0–1 | 0.12 | edge darkening |

### `ink` — the line

| Key | Type | Default | Meaning |
|---|---|---|---|
| `color` | hex | `#2a2a2c` | line colour (black strokes in SVG input are replaced by it) |
| `width` | px at 1080p | 2.2 | base line width |
| `opacity` | 0–1 | 0.9 | line opacity |
| `taper` | 0–1 | 0.55 | thinning at stroke ends (pressure) |
| `grain` | 0–1 | 0.45 | broken-up texture where the tool skips the paper tooth |
| `jitter` | 0–1+ | 0.5 | hand wobble |
| `glow` | 0–10 | 0 | bloom radius (light media) |
| `glowColor` | hex | ink colour | bloom colour |
| `blend` | `multiply` · `source-over` · `screen` | `multiply` | how ink sits on the ground; use `source-over`/`screen` on dark grounds |
| `smudge` | 0–1 | 0 | soft charcoal halo |
| `mode` | `auto` · `reveal` · `strokes` | `auto` | see Modes |
| `svgWidth` | number | 1 | multiplier for stroke widths authored in SVG |

### `layers` — contour, detail, shade

Each of `contour`, `detail`, `shade` takes `width` (multiplier), `opacity` (multiplier),
`speed` (relative drawing speed; shading is usually faster), and `color` (hex, e.g. blue marker
shading on a whiteboard).

### `trace` — how a photo becomes strokes

| Key | Type | Default | Meaning |
|---|---|---|---|
| `detail` | 0–1 | 0.6 | how many fine lines survive |
| `hatch` | `none` · `hatch` · `crosshatch` · `zigzag` · `scribble` | `crosshatch` | shading strokes |
| `hatchDensity` | 0–1 | 0.55 | spacing of shading |
| `hatchAngle` | `flow` or degrees | `flow` | `flow` follows the form; a number fixes the direction |
| `levels` | 1–4 | 4 | tonal passes (light to dark) |
| `background` | `light` · `none` · `full` | `light` | how much the detected background gets shaded |
| `vignette` | 0–1 | 0.45 | shading fades toward the edges |
| `invert` | bool | false | shade the light areas (dark grounds) |
| `maxSide` | px | 960 | analysis resolution |

### `sketch` — the finished drawing in reveal mode

| Key | Type | Default | Meaning |
|---|---|---|---|
| `lines` | 0–2 | 1 | strength of line work |
| `tone` | 0–2 | 0.85 | strength of hatched tone |
| `angle` | degrees | 42 | main hatching direction |
| `hatchScale` | number | 1 | hatching spacing multiplier |
| `vignette` | 0–1 | 0.4 | tone fades toward the edges |
| `invert` | bool | false | see Inverted |
| `presmooth` | number | 1 | smoothing before line extraction (raise for noisy photos, paintings) |
| `band` | number | 1 | width of the uncovering brush |
| `strokeLines` | 0–1 | 0.18 | extra crisp vector lines drawn on top |

### `pen` — the tool in frame

`tool`: `pencil` · `fineliner` · `ballpoint` · `marker` · `chalk` · `brush` · `glow` · `none`;
`color` (tip / barrel accent, defaults to ink); `scale` (size); `angle` (degrees, default 32).

### `color` — the closing wash (photos and SVG fills)

| Key | Type | Default | Meaning |
|---|---|---|---|
| `reveal` | `wash` · `fade` · `none` | `wash` | organic bloom from the face outward, simple fade, or none |
| `duration` | seconds | 2.6 | length of the reveal |
| `strength` | 0–1 | 0.72 | how strongly colour covers the drawing (1 = full photo colour) |
| `opacity` | 0–1 | 0.95 | overall wash opacity |
| `saturation` | number | 1.05 | colour saturation |
| `inkAfter` | 0–1 | 0.85 | line opacity once coloured |
| `blend` | canvas blend | `multiply` | how the wash sits on the paper |

### `camera`, `timing`, `sound`

- `camera.mode`: `follow` (zooms in and tracks the tool, then pulls back) · `push` (slow push-in) · `none`; `camera.zoom` (default 1.32).
- `timing.intro` (blank page before the first stroke, s) · `timing.outro` (hold at the end, s).
- `sound.kind`: `pencil` · `pen` · `marker` · `chalk` · `none`; `sound.volume` 0–1.

## CLI flags that write styles

`inkline style <name> --from <base>` accepts `--ink --paper --texture --line --detail --hatch
--density --tool --glow --camera --zoom --no-color --reveal --no-sound --sound --label --medium`
and `--global`. The same flags work on `render`, `still`, `sheet` and `preview` as one-off
overrides without saving anything.
