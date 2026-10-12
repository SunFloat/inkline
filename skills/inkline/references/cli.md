# CLI reference

`scripts/inkline <command> [input] [options]`. Every command takes `--json` (one JSON line on
stdout, progress silenced) and `--quiet`.

## Commands

| Command | What it does | JSON result |
|---|---|---|
| `render <input>` | full video (.mp4, or .webm with `--webm`), poster PNG, optional GIF | `output, poster, gif?, width, height, fps, duration, frames, strokes, style, seconds` |
| `still <input>` | one PNG frame; `--at <s>` or the finished drawing (default) | `output, at, strokes, style` |
| `sheet <input> --styles a,b,c` | finished frames of several styles side by side | `output, styles, columns, rows` |
| `preview <input>` | traces, writes a self-contained player `.html`, opens the browser (`--no-open` to skip) | `output, opened` |
| `trace <input>` | saves the stroke plan as `.inkline.json` (reuse with any command) | `output, strokes, contour, detail, shade, width, height, color` |
| `styles` | lists presets and user styles | array with `--json` |
| `style <name> --from <base> …` | saves a custom style | `saved, extends, use` |
| `doctor` | reports Node, engine packages, Chrome and ffmpeg; changes nothing | `node, engine, chrome, ffmpeg, status, setup?` |
| `setup [--with-chrome]` | installs the engine packages (~80 MB); `--with-chrome` also downloads headless Chrome (~90 MB) | same as `doctor` |

Inputs: `.png .jpg .jpeg .webp .gif .bmp .avif`, `.svg`, `.inkline.json`, or an `http(s)` URL.

Default output folder: `./inkline-out/`, named `<input>-<style>.<ext>`.

## Options

Output: `-o/--out`, `-f/--format 9:16|1:1|4:5|16:9|3:4|4:3`, `--size WxH`, `-d/--duration <s>|auto`,
`--fps`, `-q/--quality draft|standard|high`, `--gif`, `--webm`, `--no-poster`, `--workers <n>`,
`--save-project`.

Look: `-s/--style`, `--ink`, `--paper`, `--texture`, `--line`, `--detail`, `--hatch`,
`--density`, `--tool`, `--no-pen`, `--no-color`, `--reveal`, `--camera`, `--zoom`, `--glow`,
`--no-sound`, `--sound`, `--volume`, `--seed`.

Style authoring (`style` command): `--from`, `--label`, `--medium`, `--global` plus the look flags.

## Timing model

`duration` = intro (blank page, ~0.6 s) + drawing + settle (reveal mode, ~0.9 s) + colour wash
(~2.6 s if on) + hold (~2 s). The drawing phase is stretched or compressed to fit, so a 10 s and a
60 s video show the same drawing at different speeds. Shading draws faster than contours. With
`-d auto` the length follows the drawing's complexity (10–45 s).

## Determinism

Frames are a pure function of input, style, options and `--seed`. Re-rendering gives identical
frames; parallel workers render disjoint frame ranges and are stitched losslessly.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `node: command not found` | Install Node.js 18+ (LTS) from nodejs.org, then rerun. |
| `setup required` / exit code 3 | The engine is not installed, or an inkline update needs other package versions. `inkline doctor` lists what `inkline setup` would do and where; run it once you agree. |
| Where is the engine? | `$INKLINE_DATA/engine` (Claude Code's plugin data folder) or `~/.cache/inkline/engine`. Deleting that folder is a clean uninstall of the engine. |
| `No Chrome … found` | Install Chrome/Edge/Chromium, set `INKLINE_CHROME=/path/to/chrome`, or run `inkline setup --with-chrome`. |
| `ffmpeg … failed` | Set `INKLINE_FFMPEG=/path/to/ffmpeg`, or delete `engine/node_modules` and run `inkline setup` again. |
| `Nothing to draw` | The image is nearly flat. Use a higher-contrast photo, `--detail 0.9`, or crop to the subject. |
| HEIC not supported | macOS: `sips -s format jpeg in.heic --out in.jpg`; elsewhere any converter. |
| Muddy, too dark | `--density 0.35`, `--hatch hatch`, or a lighter style (`watercolor`). |
| Too sparse | `--detail 0.85 --density 0.7`. |
| Busy background drowns the subject | Crop tighter; `--style` with `trace.background: "none"`; or remove the background first. |
| Face looks rough | Use a sharper, frontal, well-lit photo at least 800 px on the short side. Face detection (which draws eyes first and finer) uses Chrome's Shape Detection API: macOS and Windows yes, Linux falls back to a heuristic. |
| Video too fast / slow | Change `--duration`; the drawing always fits. |
| Render is slow | `-q draft` for iterations; `--workers` up to your core count; shorter `--duration`. |
| SVG draws nothing | Elements need a `stroke` or a `fill`; `<text>` is not drawn (convert to paths); check `data-ink="none"` is not on a parent group. |
