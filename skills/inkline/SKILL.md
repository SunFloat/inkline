---
name: inkline
description: >
  Turn a prompt, a photo or an SVG into a hand-drawn video: a pencil, pen, marker, chalk or
  neon drawing that appears stroke by stroke with the tool in frame, then an optional colour
  wash and procedural drawing sound. Use for portrait sketch reels ("draw my photo"), speed-
  drawing and whiteboard animations, drawn intros and title cards, "draw a ___" requests, and
  any image-to-drawing-video job. Offers optional question rounds to pick or invent a style,
  and saves custom styles for reuse. Renders locally from HTML/JS (headless Chrome + bundled
  ffmpeg); no server, no account, no upload.
license: MIT
compatibility: >
  Needs Node.js 18+ and a Chromium-based browser (Chrome, Edge, Chromium or Brave). A one-time,
  user-approved setup installs three npm packages (~80 MB incl. ffmpeg). Renders locally, offline after setup.
metadata:
  version: "1.1.0"
  author: Benjamin Buchta
  homepage: https://sunfloat.github.io/inkline/site/
---

# inkline

inkline is an instrument, you are the art director. The engine turns pixels or SVG paths into an
ordered set of strokes and renders them deterministically, frame by frame, in headless Chrome.
Your job is everything a human illustrator would decide: what gets drawn, in which medium, in
which order, at which length and aspect, and whether the result is good enough to hand over.

Reply in the user's language. Everything below is written for you, not for them.

## 0. Runtime and consent

Run every inkline command exactly in this form, with the variable left as written:

```bash
INKLINE_DATA="${CLAUDE_PLUGIN_DATA}" "<this skill's directory>/scripts/inkline" <command> …
```

In a plugin install, Claude Code fills in `${CLAUDE_PLUGIN_DATA}`, a folder that survives plugin updates
and is removed on uninstall. Installed any other way, the variable is empty and inkline uses
`~/.cache/inkline`. Below and in the references, `"$INKLINE"` is shorthand for that whole prefix.

```bash
"$INKLINE" doctor --json      # reports what is installed; changes nothing
```

inkline never installs anything on its own. Before the first render, run `doctor`:

- `status: ready` → go on.
- `status: setup required` → the render engine (npm packages `puppeteer-core`, `@puppeteer/browsers`,
  `ffmpeg-static`, about 80 MB including an ffmpeg binary, from the npm registry, into the folder the
  `setup` line of the report names) is missing, or an inkline update needs different packages. Tell the user exactly that, in one or two sentences, and ask
  for permission with the structured question tool. Only after a clear yes run `"$INKLINE" setup --json`.
  If they decline, stop and explain that nothing can be rendered without it; they can run
  `inkline setup` themselves later.
- `chrome: not found` → ask whether to use a browser they install themselves, point `INKLINE_CHROME`
  at one, or download headless Chrome (~90 MB into `~/.cache/inkline`). Only after a yes run
  `"$INKLINE" setup --with-chrome --json`.
- Node is the one prerequisite inkline cannot provide. If `node` is missing or older than 18, tell
  the user to install Node.js LTS and stop.

Ask once per machine: when `doctor` says `ready`, never mention setup again. A render command that
exits with code 3 means setup is missing; go back to this section instead of retrying.
Every command accepts `--json` and prints one JSON line on success. Use it.

## 1. Decide: fast path or question round

**Fast path** (no questions) when the user already gave the subject and either named a look or
said anything like "just do it", "surprise me", "quick". Pick defaults from the table in §4 and
render.

**Question round** otherwise, and always when the user asks to choose or create a style. Follow
[references/interview.md](references/interview.md): one round of up to four questions through the
structured question tool, an optional fine-tune round, and a custom-style round when they want
their own look. Never ask more than two rounds before the first render; a render is the best
question you can ask.

## 2. Get the subject

| User gives you | Do this |
|---|---|
| A photo or image file | Use it as is. HEIC: convert first (`sips -s format jpeg in.heic --out in.jpg` on macOS). |
| An image URL | Pass the URL directly; the engine downloads it. |
| An SVG | Use it as is. |
| Only a prompt | See below. |

**Prompt only.** Two routes; choose by subject:

1. **Author SVG line art yourself** (default; always available, free, exact). Best for objects,
   scenes, icons, diagrams, logos, lettering, animals, architecture, illustrations, explainers.
   Follow [references/svg-authoring.md](references/svg-authoring.md) strictly: it is the difference
   between a drawing that looks drawn and one that looks like clip art. Save as
   `inkline-out/<slug>.svg`, preview the finished frame (`still`), look at it, fix, then render.
2. **Generate an image** only when a tool for it is available in this session (an image-generation
   MCP or tool) **and** the subject needs realism (a photoreal portrait, a specific animal's fur,
   a landscape photo). Ask for: one subject, plain light background, strong light and shadow, no
   text, portrait or square framing. Then treat the result as a photo. If generation costs credits,
   say so before generating.

Real people: drawing someone's photo is fine when it is the user's own or they have the right to
use it. Do not fetch photos of private individuals from the web.

## 3. Look before you render (photos)

When the style is not settled, show options on the user's own image. It takes ~30 s:

```bash
"$INKLINE" sheet photo.jpg --styles graphite,charcoal,ballpoint,watercolor --json
```

Open the PNG it writes with your file-reading tool, describe the differences in one line each,
and let the user pick (structured question tool, the sheet's style names as options).

## 4. Render

```bash
"$INKLINE" render <input> --style graphite --format 9:16 --duration 20 --json
```

Defaults that work, by intent:

| Intent | Style | Format | Duration | Notes |
|---|---|---|---|---|
| Portrait reel (TikTok/Reels/Shorts) | `graphite` | `9:16` | 20 | colour wash on, camera follow |
| Gift / framed portrait | `charcoal` or `sanguine` | `4:5` | 25 | `--no-color` keeps it classic |
| "Drawing comes to life" | `watercolor` | `9:16` | 22 | the wash is the payoff |
| Notebook doodle vibe | `ballpoint` | `9:16` | 18 | |
| Explainer / whiteboard | `whiteboard` | `16:9` | 15–30 | SVG input, marker sound |
| Classroom / chalk talk | `chalkboard` | `16:9` | 20 | |
| Tech / product intro | `blueprint` | `16:9` | 12 | |
| Night / party / music | `neon` | `9:16` | 15 | |
| Premium / wedding / logo | `gold` | `1:1` | 15 | |
| Clean line illustration | `fineliner` | `4:5` | 15 | best with SVG |

Useful flags (full list: [references/cli.md](references/cli.md)):

- `--detail 0..1` more or fewer lines · `--density 0..1` more or less shading · `--hatch none|hatch|crosshatch|zigzag`
- `--ink #hex --paper #hex --texture …` quick recolour · `--line 1.4` heavier lines
- `--no-color` · `--reveal fade` · `--no-pen` · `--tool marker` · `--camera none|push|follow` · `--zoom 1.5`
- `--no-sound` · `--sound marker` · `--gif` (small preview for chats/READMEs) · `--webm`
- `-q draft` for a fast first pass (2/3 resolution, 24 fps), `-q high` for the final
- `--seed n` gives a different but reproducible hand; same inputs + seed = identical frames

Long renders: a 20 s 1080×1920 video takes roughly 30–90 s depending on the machine. For anything
over 30 s, render `-q draft` first and confirm with the user before the final.

## 5. Check the result, then hand it over

Never hand over a video you have not looked at.

1. Read the `poster` PNG from the JSON result (the finished frame).
2. For drawings from photos, also look at a mid-drawing moment:
   `"$INKLINE" still <input> --style <s> --at 8 --json` (same flags as the render).
3. Check: is the subject recognisable, is the face (if any) clean, is anything important missing
   or drowned in shading, does the colour wash sit on the subject.
4. Fix with flags, not excuses: muddy → `--density 0.35` or `--hatch hatch`; sparse →
   `--detail 0.8`; too dark → a lighter `--paper` or `--line 0.8`; background noise → crop the
   photo tighter around the subject; wrong vibe → another style.

Report: the output path, format, length, style, and one sentence on what to tweak next if they
want (e.g. "say *more shading* or *try charcoal*"). Offer `preview` when they want to scrub through
it: `"$INKLINE" preview <input> --style <s>` opens an interactive player in the browser.

## 6. Custom styles

Styles are JSON. Any preset can be extended; anything a preset does, a user style can do.

```bash
"$INKLINE" style brand --from fineliner --ink "#1f4fd8" --paper "#fffdf7" --hatch hatch --label "Brand blue" --json
"$INKLINE" render logo.svg --style brand
```

Saved to `./.inkline/styles/<name>.json` (project) or with `--global` to `~/.inkline/styles/`.
For anything beyond the flags (pen tool, colour wash strength, layer weights, sound), write the
JSON directly; the schema and every key are in [references/styles.md](references/styles.md).
`"$INKLINE" styles` lists presets and user styles.

## 7. When something fails

Read the error line; it says what to do. Common cases and fixes are in
[references/cli.md#troubleshooting](references/cli.md#troubleshooting). Do not retry the same
command unchanged.
