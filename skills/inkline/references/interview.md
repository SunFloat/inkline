# Question rounds

The goal is a video the user loves on the first render, with as few questions as possible.
Ask through the structured question tool (AskUserQuestion in Claude Code). Without one, ask the
same questions as a short numbered list and wait.

Rules:

- Skip any question the request already answers. A round with one question is fine.
- Put the recommended option first and mark it "(Recommended)". The user can always type
  "Other", so never add an "Other" option yourself.
- Write option labels in the user's language. Keep labels 1–5 words; put the trade-off in the
  description.
- After a round, restate the plan in one line ("Graphite portrait, 9:16, 20 s, colour wash, with
  pencil sound") and render. Do not ask for confirmation of that line.

## Round 1 — the essentials (max 4 questions)

### Subject (only if no file and the prompt is ambiguous)

```json
{
  "question": "What should be drawn?",
  "header": "Subject",
  "multiSelect": false,
  "options": [
    { "label": "Use my photo", "description": "Give me the file path; portraits work best with good light and a calm background" },
    { "label": "Draw from my description", "description": "I sketch it as clean line art and the video draws it stroke by stroke" },
    { "label": "Generate an image first", "description": "Photoreal subject via your image tool, then drawn. Only offer when such a tool exists" }
  ]
}
```

### Style

Pick the four options that fit the subject; recommended first. Photos of people: graphite,
charcoal, watercolor, ballpoint. SVG / prompt line art: whiteboard, fineliner, chalkboard,
blueprint. Moody or festive: neon, gold, sanguine.

```json
{
  "question": "Which drawing style?",
  "header": "Style",
  "multiSelect": false,
  "options": [
    { "label": "Graphite (Recommended)", "description": "HB pencil on drawing paper; crosshatched shading, ends with a soft colour wash" },
    { "label": "Charcoal", "description": "Bold, smudgy, dramatic, on grey paper; stays monochrome" },
    { "label": "Ink & wash", "description": "Sepia pen lines, then watercolour blooms in; the drawing comes to life" },
    { "label": "Ballpoint", "description": "Blue Bic-style pen in a ruled school notebook" }
  ]
}
```

If the user answers "Other" with a description ("like a tattoo flash", "red on black"), go to the
custom-style round below.

When the image is a photo and the user hesitates, render a style sheet instead of describing
styles (`inkline sheet photo.jpg --styles …`), show it, then ask this question again with the
sheet's styles as options.

### Format

```json
{
  "question": "Where will the video be posted?",
  "header": "Format",
  "multiSelect": false,
  "options": [
    { "label": "Reels / TikTok / Shorts", "description": "9:16 vertical, 1080×1920" },
    { "label": "Instagram feed", "description": "4:5 portrait, 1080×1350" },
    { "label": "YouTube / presentation", "description": "16:9 landscape, 1920×1080" },
    { "label": "Square", "description": "1:1, 1080×1080, works everywhere" }
  ]
}
```

### Length

```json
{
  "question": "How long should it be?",
  "header": "Length",
  "multiSelect": false,
  "options": [
    { "label": "20 seconds (Recommended)", "description": "Enough to watch every stroke; ideal for reels" },
    { "label": "10 seconds", "description": "Snappy speed drawing" },
    { "label": "30 seconds", "description": "Slow, satisfying, ASMR-like" },
    { "label": "60 seconds", "description": "Long form; renders take a few minutes" }
  ]
}
```

## Round 2 — fine-tune (optional)

Offer only when the user wants control, or after a first render when they say "change something".

```json
{
  "question": "Which extras do you want?",
  "header": "Extras",
  "multiSelect": true,
  "options": [
    { "label": "Colour reveal at the end", "description": "The drawing fills with the photo's colours as a wash" },
    { "label": "Tool visible", "description": "The pencil/pen/marker moves across the page" },
    { "label": "Camera follows the pen", "description": "Gentle zoom that tracks the drawing, then pulls back" },
    { "label": "Drawing sound", "description": "Procedural pencil/marker scratch synced to every stroke" }
  ]
}
```

Map unticked options to `--no-color`, `--no-pen`, `--camera none`, `--no-sound`.

Detail and shading, when the user wants to steer the look:

```json
{
  "question": "How detailed should the drawing be?",
  "header": "Detail",
  "multiSelect": false,
  "options": [
    { "label": "Balanced (Recommended)", "description": "Clear outlines, shading where the shadows are" },
    { "label": "Loose sketch", "description": "Fewer lines, light shading; fast and airy" },
    { "label": "Highly detailed", "description": "Every crease and dense crosshatching; slower to draw" },
    { "label": "Lines only", "description": "Outlines without shading" }
  ]
}
```

Map: Balanced → defaults · Loose → `--detail 0.35 --density 0.3` · Detailed → `--detail 0.85 --density 0.75` · Lines only → `--hatch none`.

## Custom-style round

Run when the user asks for their own look, answers "Other" on style, or describes a brand.
Ask up to four questions, then write the style and render with it.

1. **Base medium** (sets texture, tool and sound): Pencil · Pen / ink · Marker · Chalk.
   Map to `--from graphite | fineliner | whiteboard | chalkboard`; charcoal, sanguine, neon, gold,
   blueprint, ballpoint and watercolor are valid bases too when the description points there.
2. **Ink colour**: offer three concrete swatches that fit the description plus "Other". Labels
   are names with hex in the description, e.g. "Brand blue" — "#1f4fd8".
3. **Ground**: Paper white · Toned grey paper · Black · Kraft brown (map to `--paper` and
   `--texture paper|paper|black|kraft`; dark grounds need a light ink).
4. **Shading**: Crosshatching · Parallel hatching · Marker fill (zigzag) · None.

Then:

```bash
"$INKLINE" style <kebab-name> --from <base> --ink <hex> --paper <hex> --texture <t> --hatch <mode> \
  --label "<Readable name>" --json
```

Tell the user the style is saved and how to reuse it (`--style <name>`), and offer `--global` if
they want it in every project. For keys the flags do not cover (wash strength, layer colours,
tool, sound, glow), edit the saved JSON using [styles.md](styles.md).

## Answer → command cheat sheet

| Answer | Flags |
|---|---|
| Reels / TikTok / Shorts | `-f 9:16` |
| Instagram feed | `-f 4:5` |
| YouTube / presentation | `-f 16:9` |
| Square | `-f 1:1` |
| 10 / 20 / 30 / 60 seconds | `-d 10` … `-d 60` |
| No colour | `--no-color` |
| No tool | `--no-pen` |
| Static camera | `--camera none` |
| Silent | `--no-sound` |
