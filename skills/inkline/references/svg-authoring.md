# Authoring SVG that draws well

When the user only gives a prompt, you draw the picture as SVG and inkline animates it. The
video replays your SVG **in document order, path by path, along each path's direction**. So
an SVG for inkline is not just a picture; it is a drawing performance. Author it the way an
illustrator would draw it live.

## The contract

- Root: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 W H">`. Use portrait
  `0 0 800 1000` for 9:16 / 4:5, square `0 0 1000 1000`, landscape `0 0 1600 900` for 16:9.
  Leave ~6% empty margin; the engine adds its own margin too.
- Drawable elements: `path`, `line`, `polyline`, `polygon`, `circle`, `ellipse`, `rect`.
- **Order = time.** The first element is drawn first. A path is drawn from its start point to its end.
- **Stroke = line work.** Elements with a `stroke` are drawn with it. Black or near-black strokes
  take the style's ink colour; coloured strokes keep their colour (use sparingly, for accents).
- **Fill = colour wash.** Fills are not drawn stroke by stroke; after the line work, all fills
  appear together as the colour reveal. A filled element without a stroke still gets its outline
  drawn (`data-ink="fill-only"` suppresses that).
- `stroke-width` is respected (in viewBox units). 2.5–4 for contours, 1.5–2.5 for details,
  1–1.6 for hatching in an 800-wide viewBox.
- Layers: wrap groups in `<g data-ink-layer="contour">`, `"detail"`, `"shade"`. Layers change
  weight, opacity and speed (shading draws faster and lighter). Default is contour.
- Skip an element's lines entirely: `data-ink="none"` (e.g. a sky rectangle that should only
  appear as colour).
- Not supported, do not use: `<text>` (draw lettering as paths), `<image>`, `stroke-dasharray`
  (it is drawn solid), filters, masks, clip paths for line work, CSS animations.
  Gradients are fine in fills (they appear in the wash).

## Draw like a person

1. **Big shapes first, then features, then texture, then shading.** For a face: head outline,
   eyes, nose, mouth, hair mass, then hair strands, then hatching. For a scene: horizon and main
   subject, then secondary objects, then details, then shading.
2. **Long continuous paths.** One `path` per natural pen stroke. A cat's back is one curve, not
   twelve segments. Avoid `Z`-closed boxes for organic shapes; let curves overlap slightly at the
   ends, as a hand would.
3. **Use curves.** Cubic `C`/`S` and quadratic `Q`/`T` beziers, not polylines with dozens of
   points. Slightly asymmetric curves look hand-made; perfect geometry looks like an icon set.
4. **Vary line weight on purpose.** Heavier contour on the shadow side and at overlaps; thin
   interior lines.
5. **Shading is hatching.** Put it in `data-ink-layer="shade"`: groups of 6–20 short parallel
   strokes (`M x y l dx dy` repeated) following the form, crossing them for darker areas. Never
   use a grey fill to mean shadow in the line work.
6. **Leave air.** Not every edge needs a line. Lost-and-found edges read as confident drawing.
7. **Composition.** One clear subject that fills ~60% of the frame, placed slightly above centre,
   with a little ground or context. Odd numbers of secondary elements.
8. **Colour plan.** 3–5 flat fill colours that harmonise, assigned to big shapes. The wash
   multiplies over the paper, so mid-tones read best; avoid pure black fills.

## Sizes that work

An 800×1000 drawing reads well with roughly 40–150 drawable elements. Under 20 looks empty;
over 400 small paths turns into noise and slows the drawing to a crawl. Hatching groups count as
one path per stroke, so keep them compact.

## Skeleton

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1000">
  <rect width="800" height="1000" fill="#f3efe6" data-ink="none"/>            <!-- colour only -->
  <g data-ink-layer="contour" fill="none" stroke="#111" stroke-width="3.2"
     stroke-linecap="round" stroke-linejoin="round">
    <path d="M220 640 C230 520 300 430 400 420 C520 410 590 500 600 640" fill="#e8b48a"/>
    …
  </g>
  <g data-ink-layer="detail" fill="none" stroke="#111" stroke-width="2" stroke-linecap="round">
    …
  </g>
  <g data-ink-layer="shade" fill="none" stroke="#111" stroke-width="1.3" stroke-linecap="round">
    <path d="M520 560 l26 -30 M530 570 l26 -30 M540 580 l26 -30"/>
  </g>
</svg>
```

Repo examples you can open for reference: `examples/lighthouse.svg`, `examples/fox.svg`.

## Check before rendering

```bash
"$INKLINE" still drawing.svg --style whiteboard --no-pen --json            # finished frame
"$INKLINE" still drawing.svg --style whiteboard --no-pen --at 6 --json     # mid-drawing
```

Look at both PNGs. Fix proportions, missing parts, stray paths and the drawing order (does the
mid-drawing frame show the main subject emerging first?) before the full render.
