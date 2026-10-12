/*
 * inkline · render
 * A seekable, deterministic stroke renderer. `seek(t)` always produces the same
 * pixels for the same project, style and options, so frames can be captured in
 * any order, in parallel, by any number of headless pages.
 */
(function (root) {
  'use strict';
  const Inkline = (root.Inkline = root.Inkline || {});
  const M = Inkline.materials;

  const DEFAULT_STYLE = {
    name: 'graphite',
    paper: { texture: 'paper', color: '#f3f1ec', grain: 0.35, vignette: 0.12 },
    ink: {
      color: '#2a2a2c',
      width: 2.2,
      opacity: 0.9,
      taper: 0.55,
      grain: 0.45,
      jitter: 0.5,
      glow: 0,
      glowColor: null,
      blend: 'multiply',
      smudge: 0,
      mode: 'auto', // auto | reveal | strokes
    },
    sketch: { lines: 1, tone: 0.85, vignette: 0.4, angle: 42, hatchScale: 1, strokeLines: 0.18, band: 1 },
    layers: {
      contour: { width: 1, opacity: 1, speed: 1 },
      detail: { width: 0.7, opacity: 0.9, speed: 0.85 },
      shade: { width: 0.55, opacity: 0.5, speed: 0.55, color: null },
    },
    pen: { tool: 'pencil', scale: 1, angle: 32, color: null },
    color: { reveal: 'wash', duration: 2.6, opacity: 0.95, saturation: 1.05, inkAfter: 0.85, blend: 'multiply', strength: 0.72 },
    camera: { mode: 'follow', zoom: 1.32 },
    timing: { intro: 0.6, outro: 2.0 },
    trace: { detail: 0.6, hatch: 'crosshatch', hatchDensity: 0.55, levels: 4 },
    sound: { kind: 'pencil', volume: 0.8 },
  };

  function isObj(v) {
    return v && typeof v === 'object' && !Array.isArray(v);
  }

  function merge(base, over) {
    const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
    if (!isObj(over)) return out;
    for (const k of Object.keys(over)) {
      if (over[k] === undefined) continue;
      out[k] = isObj(base && base[k]) && isObj(over[k]) ? merge(base[k], over[k]) : over[k];
    }
    return out;
  }

  const LAYER_NAMES = ['contour', 'detail', 'shade'];

  function noise1(seed) {
    const r = M.rng(seed);
    const g = new Float32Array(512);
    for (let i = 0; i < g.length; i++) g[i] = r() * 2 - 1;
    return (x) => {
      const i = Math.floor(x);
      const f = x - i;
      const s = f * f * (3 - 2 * f);
      return g[i & 511] * (1 - s) + g[(i + 1) & 511] * s;
    };
  }

  /** Catmull-Rom resample so every stroke is a dense, evenly spaced curve. */
  function resample(pts, step) {
    const n = pts.length / 2;
    if (n < 2) return Float32Array.from(pts);
    const out = [pts[0], pts[1]];
    for (let i = 0; i < n - 1; i++) {
      const i0 = Math.max(0, i - 1), i2 = i + 1, i3 = Math.min(n - 1, i + 2);
      const p0x = pts[i0 * 2], p0y = pts[i0 * 2 + 1];
      const p1x = pts[i * 2], p1y = pts[i * 2 + 1];
      const p2x = pts[i2 * 2], p2y = pts[i2 * 2 + 1];
      const p3x = pts[i3 * 2], p3y = pts[i3 * 2 + 1];
      const seg = Math.hypot(p2x - p1x, p2y - p1y);
      const k = Math.max(1, Math.ceil(seg / step));
      for (let j = 1; j <= k; j++) {
        const t = j / k, t2 = t * t, t3 = t2 * t;
        out.push(
          0.5 * (2 * p1x + (-p0x + p2x) * t + (2 * p0x - 5 * p1x + 4 * p2x - p3x) * t2 + (-p0x + 3 * p1x - 3 * p2x + p3x) * t3),
          0.5 * (2 * p1y + (-p0y + p2y) * t + (2 * p0y - 5 * p1y + 4 * p2y - p3y) * t2 + (-p0y + 3 * p1y - 3 * p2y + p3y) * t3)
        );
      }
    }
    return Float32Array.from(out);
  }

  const ease = (u) => 0.72 * u + 0.28 * u * u * (3 - 2 * u);
  const smooth = (u) => u * u * (3 - 2 * u);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('inkline: colour layer failed to load'));
      img.src = src;
    });
  }

  /**
   * canvas: output canvas. project: from Inkline.trace. style: partial style (merged
   * over defaults). opts: { width, height, fps, duration, seed, pen, camera, margin }.
   */
  function createRenderer(canvas, project, styleIn, optsIn) {
    const style = merge(DEFAULT_STYLE, styleIn || {});
    const opts = Object.assign({ width: 1080, height: 1920, fps: 30, duration: 20, seed: 7, pen: true, margin: 0.08 }, optsIn || {});
    if (opts.camera) style.camera = merge(style.camera, typeof opts.camera === 'string' ? { mode: opts.camera } : opts.camera);
    if (opts.colorReveal === false) style.color.reveal = 'none';
    const W = opts.width;
    const H = opts.height;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    const follow = style.camera.mode === 'follow';
    const zoomMax = follow ? clamp(style.camera.zoom || 1.3, 1, 2) : style.camera.mode === 'push' ? 1.08 : 1;
    const ss = Math.min(1.5, zoomMax); // supersample the page so zoomed views stay sharp
    const PW = Math.round(W * ss);
    const PH = Math.round(H * ss);
    const pu = Math.min(PW, PH) / 1080; // page unit: 1px at 1080p
    const seed = opts.seed | 0;

    // ---- fit the subject on the page
    const margin = opts.margin * Math.min(PW, PH);
    const sc = Math.min((PW - margin * 2) / project.width, (PH - margin * 2) / project.height);
    const ox = (PW - project.width * sc) / 2;
    const oy = (PH - project.height * sc) / 2 - PH * 0.015;

    // ---- prepare strokes
    const jit = noise1(seed + 101);
    const prs = noise1(seed + 202);
    const strokes = [];
    const layerCfg = LAYER_NAMES.map((n) => style.layers[n]);
    const step = 2.2 * pu;
    for (let si = 0; si < project.strokes.length; si++) {
      const s = project.strokes[si];
      const raw = new Array(s.p.length);
      for (let k = 0; k < s.p.length; k += 2) {
        raw[k] = ox + s.p[k] * sc;
        raw[k + 1] = oy + s.p[k + 1] * sc;
      }
      const pts = resample(raw, step);
      const n = pts.length / 2;
      if (n < 2) continue;
      const lay = clamp(s.layer | 0, 0, 2);
      const cfg = layerCfg[lay];
      // hand wobble: low-frequency drift perpendicular to travel
      const amp = style.ink.jitter * 1.4 * pu;
      if (amp > 0) {
        const phase = si * 7.31;
        const copy = Float32Array.from(pts);
        let acc = 0;
        for (let i = 0; i < n; i++) {
          const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
          let tx = copy[b * 2] - copy[a * 2];
          let ty = copy[b * 2 + 1] - copy[a * 2 + 1];
          const tl = Math.hypot(tx, ty) || 1;
          tx /= tl;
          ty /= tl;
          if (i > 0) acc += Math.hypot(copy[i * 2] - copy[i * 2 - 2], copy[i * 2 + 1] - copy[i * 2 - 1]);
          const off = jit(phase + acc / (90 * pu)) * amp;
          pts[i * 2] = copy[i * 2] - ty * off;
          pts[i * 2 + 1] = copy[i * 2 + 1] + tx * off;
        }
      }
      const cum = new Float32Array(n);
      let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
      for (let i = 0; i < n; i++) {
        if (i) cum[i] = cum[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
        minx = Math.min(minx, pts[i * 2]); maxx = Math.max(maxx, pts[i * 2]);
        miny = Math.min(miny, pts[i * 2 + 1]); maxy = Math.max(maxy, pts[i * 2 + 1]);
      }
      const L = cum[n - 1];
      if (L < 0.5) continue;
      let width = style.ink.width * cfg.width * pu;
      if (s.w) width = s.w * sc * (style.ink.svgWidth != null ? style.ink.svgWidth : 1);
      // pressure: tapered ends plus a slow wander
      const pr = new Float32Array(n);
      const taper = style.ink.taper;
      const tl = clamp(L * 0.3, 2 * pu, 60 * pu);
      for (let i = 0; i < n; i++) {
        const e = Math.min(cum[i], L - cum[i]);
        const tp = e < tl ? 0.2 + 0.8 * Math.sin((e / tl) * Math.PI * 0.5) : 1;
        pr[i] = (1 - taper + taper * tp) * (1 + 0.16 * prs(si * 3.7 + cum[i] / (70 * pu)));
      }
      const pad = width * 2 + (style.ink.glow ? style.ink.glow * 3 * pu + 4 : 2) + (style.ink.smudge ? 8 * pu : 0);
      strokes.push({
        pts, cum, pr, L, n, layer: lay, width,
        opacity: style.ink.opacity * cfg.opacity,
        color: s.c || cfg.color || style.ink.color,
        box: [
          Math.max(0, Math.floor(minx - pad)), Math.max(0, Math.floor(miny - pad)),
          Math.min(PW, Math.ceil(maxx + pad)), Math.min(PH, Math.ceil(maxy + pad)),
        ],
        speed: cfg.speed || 1,
        t0: 0, t1: 0,
      });
    }

    // reveal mode: strokes uncover a finished raster drawing (photos); strokes mode draws vector lines only
    const sketchMode = project.kind === 'image' && !!project.color && (style.ink.mode === 'reveal' || style.ink.mode === 'auto');

    // ---- timeline
    const hasColor = !!project.color && style.color.reveal !== 'none';
    const settle = sketchMode ? 0.9 : 0;
    const intro = style.timing.intro;
    const outro = style.timing.outro;
    const reveal = hasColor ? style.color.duration : 0;
    const v0 = 1500 * pu; // natural pen speed, page px per second
    let natural = 0;
    const lifts = new Float32Array(strokes.length);
    const draws = new Float32Array(strokes.length);
    for (let i = 0; i < strokes.length; i++) {
      const s = strokes[i];
      const prev = strokes[i - 1];
      const d = prev ? Math.hypot(s.pts[0] - prev.pts[prev.n * 2 - 2], s.pts[1] - prev.pts[prev.n * 2 - 1]) : 0;
      lifts[i] = prev ? 0.05 + Math.sqrt(d / pu) * 0.006 : 0;
      draws[i] = 0.03 + Math.pow(s.L / pu, 0.92) / (v0 / pu) / s.speed;
      natural += lifts[i] + draws[i];
    }
    let duration = opts.duration;
    if (duration === 'auto' || !(duration > 0)) duration = clamp(intro + outro + reveal + Math.sqrt(natural) * 2.4, 10, 45);
    const drawWindow = Math.max(1, duration - intro - outro - reveal - settle);
    const k = natural > 0 ? drawWindow / natural : 1;
    let t = intro;
    for (let i = 0; i < strokes.length; i++) {
      t += lifts[i] * k;
      strokes[i].t0 = t;
      t += draws[i] * k;
      strokes[i].t1 = t;
    }
    const drawEnd = strokes.length ? strokes[strokes.length - 1].t1 : intro;
    const settleEnd = drawEnd + settle;
    const revealStart = settleEnd + 0.15;
    const revealEnd = revealStart + reveal;

    // ---- pen state
    const penHome = [PW * 1.08, PH * 1.05];
    function pointAt(s, len) {
      const cum = s.cum;
      let lo = 0, hi = s.n - 1;
      while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] <= len) lo = mid;
        else hi = mid;
      }
      const seg = cum[hi] - cum[lo] || 1;
      const f = clamp((len - cum[lo]) / seg, 0, 1);
      return [s.pts[lo * 2] + (s.pts[hi * 2] - s.pts[lo * 2]) * f, s.pts[lo * 2 + 1] + (s.pts[hi * 2 + 1] - s.pts[lo * 2 + 1]) * f, lo];
    }
    function strokeIndexAt(time) {
      let lo = 0, hi = strokes.length - 1, ans = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (strokes[mid].t0 <= time) {
          ans = mid;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      return ans;
    }
    function penState(time) {
      if (!strokes.length) return { x: penHome[0], y: penHome[1], down: false, lift: 1, idx: -1 };
      const first = strokes[0];
      if (time < first.t0) {
        const u = smooth(clamp((time - intro * 0.15) / Math.max(0.01, first.t0 - intro * 0.15), 0, 1));
        return { x: penHome[0] + (first.pts[0] - penHome[0]) * u, y: penHome[1] + (first.pts[1] - penHome[1]) * u, down: false, lift: 1 - u * 0.8, idx: -1 };
      }
      const i = strokeIndexAt(time);
      const s = strokes[i];
      if (time <= s.t1) {
        const u = ease(clamp((time - s.t0) / Math.max(1e-4, s.t1 - s.t0), 0, 1));
        const p = pointAt(s, u * s.L);
        return { x: p[0], y: p[1], down: true, lift: 0, idx: i, u };
      }
      const next = strokes[i + 1];
      if (next) {
        const u = smooth(clamp((time - s.t1) / Math.max(1e-4, next.t0 - s.t1), 0, 1));
        const ex = s.pts[s.n * 2 - 2], ey = s.pts[s.n * 2 - 1];
        return { x: ex + (next.pts[0] - ex) * u, y: ey + (next.pts[1] - ey) * u, down: false, lift: Math.sin(u * Math.PI), idx: i };
      }
      const ex = s.pts[s.n * 2 - 2], ey = s.pts[s.n * 2 - 1];
      const u = smooth(clamp((time - drawEnd) / 1.1, 0, 1));
      return { x: ex + (penHome[0] - ex) * u, y: ey + (penHome[1] - ey) * u, down: false, lift: Math.min(1, u * 3), idx: i };
    }

    // ---- camera path, precomputed and smoothed so seeking is order-independent
    const camRate = 12;
    const camN = Math.ceil(duration * camRate) + 2;
    const cam = new Float32Array(camN * 3);
    {
      const raw = new Float32Array(camN * 2);
      for (let i = 0; i < camN; i++) {
        const st = penState(Math.min(i / camRate, drawEnd));
        raw[i * 2] = st.x;
        raw[i * 2 + 1] = st.y;
      }
      const win = Math.round(camRate * 1.6);
      for (let i = 0; i < camN; i++) {
        let sx = 0, sy = 0, sw = 0;
        for (let j = -win; j <= win; j++) {
          const q = clamp(i + j, 0, camN - 1);
          const wgt = Math.exp(-(j * j) / (2 * (win / 2) * (win / 2)));
          sx += raw[q * 2] * wgt;
          sy += raw[q * 2 + 1] * wgt;
          sw += wgt;
        }
        const time = i / camRate;
        let z = 1;
        if (follow) {
          const zin = smooth(clamp((time - intro * 0.5) / 2.2, 0, 1));
          const zout = smooth(clamp((time - (drawEnd - 1.6)) / 2.0, 0, 1));
          z = 1 + (zoomMax - 1) * zin * (1 - zout);
        } else if (style.camera.mode === 'push') {
          z = 1 + (zoomMax - 1) * smooth(clamp(time / Math.max(1, drawEnd), 0, 1)) * (1 - smooth(clamp((time - drawEnd) / 1.5, 0, 1)));
        }
        const blend = (z - 1) / Math.max(1e-3, zoomMax - 1);
        cam[i * 3] = PW / 2 + (sx / sw - PW / 2) * (follow ? blend : 0);
        cam[i * 3 + 1] = PH / 2 + (sy / sw - PH / 2) * (follow ? blend : 0);
        cam[i * 3 + 2] = z;
      }
    }
    function cameraAt(time) {
      const f = clamp(time * camRate, 0, camN - 1.001);
      const i = Math.floor(f);
      const u = f - i;
      const lerp = (o) => cam[i * 3 + o] * (1 - u) + cam[(i + 1) * 3 + o] * u;
      const z = lerp(2);
      const hw = PW / (2 * z), hh = PH / (2 * z);
      return [clamp(lerp(0), hw, PW - hw), clamp(lerp(1), hh, PH - hh), z];
    }

    // ---- surfaces
    const paper = M.canvas(PW, PH);
    const ink = M.canvas(PW, PH);
    const scratch = M.canvas(PW, PH);
    const inkCtx = ink.getContext('2d');
    const scrCtx = scratch.getContext('2d');
    let grainPattern = null;
    if (style.ink.grain > 0) grainPattern = scrCtx.createPattern(M.grainTile(256, seed + 5, style.ink.grain), 'repeat');

    let sketchPage = null;
    let revealed = null;
    let mask = null;
    let colorCanvas = null;
    let revealCanvas = null;
    let maskCanvas = null;
    let maskField = null;
    let mw = 0, mh = 0;
    let tool = null;
    let toolShadow = null;

    const ready = (async () => {
      M.paintGround(paper.getContext('2d'), PW, PH, style.paper, seed, pu);
      const src = project.color ? await loadImage(project.color) : null;
      const matteImg = project.matte ? await loadImage(project.matte) : null;
      if (sketchMode) {
        const sk = Inkline.sketch.buildSketch(src, matteImg, style.sketch, style.ink.color, seed);
        sketchPage = M.canvas(PW, PH);
        const sctx = sketchPage.getContext('2d');
        sctx.imageSmoothingQuality = 'high';
        sctx.drawImage(sk, ox, oy, project.width * sc, project.height * sc);
        if (grainPattern) {
          sctx.globalCompositeOperation = 'destination-out';
          sctx.fillStyle = sctx.createPattern(M.grainTile(256, seed + 9, style.ink.grain * 0.8), 'repeat');
          sctx.fillRect(0, 0, PW, PH);
          sctx.globalCompositeOperation = 'source-over';
        }
        if (style.ink.glow) {
          // light media bloom: a blurred copy of the drawing sits underneath it
          const g = M.canvas(PW, PH);
          const gctx = g.getContext('2d');
          gctx.filter = `blur(${style.ink.glow * 1.6 * pu}px)`;
          gctx.drawImage(sketchPage, 0, 0);
          gctx.filter = 'none';
          gctx.globalCompositeOperation = 'source-in';
          gctx.fillStyle = style.ink.glowColor || style.ink.color;
          gctx.fillRect(0, 0, PW, PH);
          sctx.globalCompositeOperation = 'destination-over';
          sctx.globalAlpha = 0.9;
          sctx.drawImage(g, 0, 0);
          sctx.globalAlpha = 1;
          sctx.globalCompositeOperation = 'source-over';
        }
        revealed = M.canvas(PW, PH);
        mask = M.canvas(PW, PH);
      }
      if (hasColor) {
        const img = src;
        colorCanvas = M.canvas(PW, PH);
        const cctx = colorCanvas.getContext('2d');
        if (style.color.saturation && style.color.saturation !== 1) cctx.filter = `saturate(${style.color.saturation})`;
        cctx.drawImage(img, ox, oy, project.width * sc, project.height * sc);
        cctx.filter = 'none';
        // a wash, not a photo: lift the colour toward white so the drawing stays legible
        const strength = style.color.strength != null ? style.color.strength : 0.72;
        if (strength < 1) {
          cctx.globalCompositeOperation = 'source-atop';
          cctx.fillStyle = `rgba(255,255,255,${1 - strength})`;
          cctx.fillRect(0, 0, PW, PH);
          cctx.globalCompositeOperation = 'source-over';
        }
        // keep colour on the subject, with a hand-torn wash edge instead of a photo rectangle
        const ew = Math.ceil(project.width * sc / 6), eh = Math.ceil(project.height * sc / 6);
        if (project.kind === 'image') {
          const edge = M.canvas(ew, eh);
          const ectx = edge.getContext('2d');
          const ed = ectx.createImageData(ew, eh);
          const nf = M.fbmField(ew, eh, seed + 41, 5);
          for (let y = 0; y < eh; y++) for (let x = 0; x < ew; x++) {
            const dEdge = Math.min(x, y, ew - 1 - x, eh - 1 - y) / Math.min(ew, eh);
            const v = clamp((dEdge - 0.015 - nf[y * ew + x] * 0.07) / 0.05, 0, 1);
            ed.data[(y * ew + x) * 4 + 3] = v * 255;
          }
          ectx.putImageData(ed, 0, 0);
          cctx.globalCompositeOperation = 'destination-in';
          cctx.drawImage(edge, ox, oy, project.width * sc, project.height * sc);
        }
        if (matteImg) {
          const mc = M.canvas(PW, PH);
          const mctx = mc.getContext('2d');
          mctx.filter = `blur(${6 * pu}px)`;
          mctx.drawImage(matteImg, ox, oy, project.width * sc, project.height * sc);
          // matte is white-on-black; turn luminance into alpha
          const lum = M.canvas(PW, PH);
          const lctx = lum.getContext('2d');
          lctx.drawImage(mc, 0, 0);
          const id = lctx.getImageData(0, 0, PW, PH);
          for (let i = 0; i < id.data.length; i += 4) {
            id.data[i + 3] = id.data[i];
            id.data[i] = id.data[i + 1] = id.data[i + 2] = 0;
          }
          lctx.putImageData(id, 0, 0);
          cctx.drawImage(lum, 0, 0);
        }
        cctx.globalCompositeOperation = 'source-over';
        revealCanvas = M.canvas(PW, PH);
        mw = Math.ceil(PW / 8);
        mh = Math.ceil(PH / 8);
        maskCanvas = M.canvas(mw, mh);
        const f = M.fbmField(mw, mh, seed + 77, 5);
        const fx = (ox + (project.focus ? project.focus[0] : project.width / 2) * sc) / 8;
        const fy = (oy + (project.focus ? project.focus[1] : project.height / 2) * sc) / 8;
        const maxd = Math.hypot(mw, mh) * 0.6;
        maskField = new Float32Array(mw * mh);
        for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) maskField[y * mw + x] = 0.55 * f[y * mw + x] + 0.45 * Math.min(1, Math.hypot(x - fx, y - fy) / maxd);
      }
      if (opts.pen !== false && style.pen.tool && style.pen.tool !== 'none' && style.pen.tool !== 'glow') {
        tool = await M.toolImage(style.pen.tool, style.pen.color || style.ink.color);
        if (tool) {
          const len = Math.min(PW, PH) * 0.5 * (style.pen.scale || 1);
          tool.scale = len / tool.w;
          toolShadow = M.canvas(tool.w * tool.scale + 80, tool.h * tool.scale + 80);
          const tctx = toolShadow.getContext('2d');
          tctx.filter = `blur(${10 * pu}px)`;
          tctx.drawImage(tool.img, 40, 40, tool.w * tool.scale, tool.h * tool.scale);
          tctx.filter = 'none';
          tctx.globalCompositeOperation = 'source-in';
          tctx.fillStyle = 'rgba(20,16,10,1)';
          tctx.fillRect(0, 0, toolShadow.width, toolShadow.height);
        }
      }
    })();

    // ---- stroke painting
    function paintStroke(s, upto) {
      const [x0, y0, x1, y1] = s.box;
      const bw = x1 - x0, bh = y1 - y0;
      if (bw <= 0 || bh <= 0) return null;
      scrCtx.clearRect(x0, y0, bw, bh);
      scrCtx.strokeStyle = s.color;
      scrCtx.lineCap = 'round';
      scrCtx.lineJoin = 'round';
      const pts = s.pts, pr = s.pr, cum = s.cum;
      let last = 1;
      while (last < s.n && cum[last] <= upto) last++;
      let curW = -1;
      scrCtx.beginPath();
      for (let i = 1; i < last; i++) {
        const w = Math.max(0.35, Math.round(s.width * (pr[i - 1] + pr[i]) * 0.5 * 4) / 4);
        if (w !== curW) {
          if (curW > 0) scrCtx.stroke();
          scrCtx.beginPath();
          scrCtx.lineWidth = w;
          scrCtx.moveTo(pts[i * 2 - 2], pts[i * 2 - 1]);
          curW = w;
        }
        scrCtx.lineTo(pts[i * 2], pts[i * 2 + 1]);
      }
      if (last < s.n && upto > 0) {
        const p = pointAt(s, upto);
        if (curW < 0) {
          scrCtx.beginPath();
          scrCtx.lineWidth = Math.max(0.35, s.width * pr[0]);
          scrCtx.moveTo(pts[0], pts[1]);
        }
        scrCtx.lineTo(p[0], p[1]);
      }
      scrCtx.stroke();
      if (grainPattern) {
        scrCtx.globalCompositeOperation = 'destination-out';
        scrCtx.fillStyle = grainPattern;
        scrCtx.fillRect(x0, y0, bw, bh);
        scrCtx.globalCompositeOperation = 'source-over';
      }
      return [x0, y0, bw, bh];
    }

    /** Paint a stroke's reveal band (opaque) into ctx2 up to arc length `upto`. */
    function bandPath(ctx2, s, upto) {
      const band = (s.layer === 0 ? 12 : s.layer === 1 ? 9 : 15) * pu * (style.sketch.band || 1);
      ctx2.lineCap = 'round';
      ctx2.lineJoin = 'round';
      ctx2.lineWidth = band;
      ctx2.strokeStyle = '#000';
      ctx2.beginPath();
      ctx2.moveTo(s.pts[0], s.pts[1]);
      let i = 1;
      for (; i < s.n && s.cum[i] <= upto; i++) ctx2.lineTo(s.pts[i * 2], s.pts[i * 2 + 1]);
      if (i < s.n) {
        const p = pointAt(s, upto);
        ctx2.lineTo(p[0], p[1]);
      }
      ctx2.stroke();
      const pad = band;
      const [x0, y0, x1, y1] = s.box;
      const bx = Math.max(0, Math.floor(x0 - pad)), by = Math.max(0, Math.floor(y0 - pad));
      return [bx, by, Math.min(PW, Math.ceil(x1 + pad)) - bx, Math.min(PH, Math.ceil(y1 + pad)) - by];
    }

    function blit(target, s, r, alpha) {
      target.save();
      target.globalAlpha = s.opacity * alpha;
      if (style.ink.glow) {
        target.shadowBlur = style.ink.glow * pu * 3;
        target.shadowColor = style.ink.glowColor || s.color;
      }
      target.drawImage(scratch, r[0], r[1], r[2], r[3], r[0], r[1], r[2], r[3]);
      if (style.ink.smudge) {
        target.shadowBlur = 0;
        target.globalAlpha = s.opacity * style.ink.smudge * alpha;
        target.filter = `blur(${3 * pu}px)`;
        target.drawImage(scratch, r[0], r[1], r[2], r[3], r[0], r[1], r[2], r[3]);
      }
      target.restore();
    }

    let committed = 0;
    let lastT = -1;
    function reset() {
      inkCtx.clearRect(0, 0, PW, PH);
      if (sketchMode) {
        mask.getContext('2d').clearRect(0, 0, PW, PH);
        revealed.getContext('2d').clearRect(0, 0, PW, PH);
      }
      committed = 0;
    }
    function commitUntil(time) {
      while (committed < strokes.length && strokes[committed].t1 <= time) {
        const s = strokes[committed];
        if (sketchMode) {
          const r = bandPath(mask.getContext('2d'), s, s.L + 1);
          if (r[2] > 0 && r[3] > 0) {
            const rv = revealed.getContext('2d');
            // clip: source-in would otherwise wipe everything outside the band's box
            rv.save();
            rv.beginPath();
            rv.rect(r[0], r[1], r[2], r[3]);
            rv.clip();
            rv.clearRect(r[0], r[1], r[2], r[3]);
            rv.drawImage(mask, r[0], r[1], r[2], r[3], r[0], r[1], r[2], r[3]);
            rv.globalCompositeOperation = 'source-in';
            rv.drawImage(sketchPage, r[0], r[1], r[2], r[3], r[0], r[1], r[2], r[3]);
            rv.restore();
          }
          if (style.sketch.strokeLines > 0 && s.layer < 2) {
            const r2 = paintStroke(s, s.L + 1);
            if (r2) blit(inkCtx, s, r2, style.sketch.strokeLines);
          }
        } else {
          const r = paintStroke(s, s.L + 1);
          if (r) blit(inkCtx, s, r, 1);
        }
        committed++;
      }
    }

    function drawReveal(time) {
      if (!colorCanvas || time <= revealStart) return 0;
      const r = smooth(clamp((time - revealStart) / Math.max(0.01, reveal), 0, 1));
      const rctx = revealCanvas.getContext('2d');
      if (style.color.reveal === 'fade' || r >= 1) {
        ctx.save();
        ctx.globalAlpha = style.color.opacity * r;
        ctx.globalCompositeOperation = style.color.blend;
        ctx.drawImage(colorCanvas, 0, 0);
        ctx.restore();
        return r;
      }
      const mctx = maskCanvas.getContext('2d');
      const img = mctx.createImageData(mw, mh);
      const edge = 0.14;
      const front = r * (1 + edge * 2) - edge;
      for (let i = 0; i < maskField.length; i++) {
        img.data[i * 4 + 3] = clamp((front - maskField[i]) / edge, 0, 1) * 255;
      }
      mctx.putImageData(img, 0, 0);
      rctx.clearRect(0, 0, PW, PH);
      rctx.globalCompositeOperation = 'source-over';
      rctx.imageSmoothingEnabled = true;
      rctx.imageSmoothingQuality = 'high';
      rctx.drawImage(maskCanvas, 0, 0, PW, PH);
      rctx.globalCompositeOperation = 'source-in';
      rctx.drawImage(colorCanvas, 0, 0);
      rctx.globalCompositeOperation = 'source-over';
      ctx.save();
      ctx.globalAlpha = style.color.opacity;
      ctx.globalCompositeOperation = style.color.blend;
      ctx.drawImage(revealCanvas, 0, 0);
      ctx.restore();
      return r;
    }

    function drawTool(st, time) {
      if (style.pen.tool === 'glow' && opts.pen !== false) {
        if (st.lift >= 0.99) return;
        const g = ctx.createRadialGradient(st.x, st.y, 0, st.x, st.y, 26 * pu);
        const c = style.ink.glowColor || style.ink.color;
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.15, c);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = 1 - st.lift * 0.6;
        ctx.fillStyle = g;
        ctx.fillRect(st.x - 30 * pu, st.y - 30 * pu, 60 * pu, 60 * pu);
        ctx.restore();
        return;
      }
      if (!tool) return;
      const base = ((style.pen.angle || 32) * Math.PI) / 180;
      const wob = 0.035 * Math.sin(time * 5.1) + 0.02 * Math.sin(time * 11.7 + 1.3);
      const a = base + wob - st.lift * 0.05;
      const lift = st.lift;
      const sx = (10 + lift * 34) * pu;
      const sy = (14 + lift * 40) * pu;
      ctx.save();
      ctx.globalAlpha = 0.2 - lift * 0.06;
      ctx.translate(st.x + sx, st.y + sy);
      ctx.rotate(a);
      ctx.drawImage(toolShadow, -40, -toolShadow.height / 2);
      ctx.restore();
      ctx.save();
      ctx.translate(st.x - lift * 4 * pu, st.y - lift * 10 * pu);
      ctx.rotate(a);
      const lsc = tool.scale * (1 + lift * 0.025);
      ctx.drawImage(tool.img, 0, (-tool.h * lsc) / 2, tool.w * lsc, tool.h * lsc);
      ctx.restore();
    }

    function seek(time) {
      time = clamp(time, 0, duration);
      if (time < lastT - 1e-6) reset();
      lastT = time;
      commitUntil(time);
      const [cx, cy, z] = cameraAt(time);
      const a = z / ss;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, W, H);
      ctx.setTransform(a, 0, 0, a, W / 2 - cx * a, H / 2 - cy * a);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(paper, 0, 0);
      const r = drawReveal(time);
      const inkAlpha = 1 - (1 - style.color.inkAfter) * r;
      const st = penState(time);
      if (sketchMode) {
        ctx.save();
        ctx.globalCompositeOperation = style.ink.blend;
        ctx.globalAlpha = inkAlpha;
        const fill = smooth(clamp((time - drawEnd) / Math.max(0.01, settle), 0, 1));
        if (fill >= 1) ctx.drawImage(sketchPage, 0, 0);
        else {
          ctx.drawImage(revealed, 0, 0);
          if (st.down && st.idx >= committed) {
            // live band: only the part not yet revealed, so nothing is inked twice
            const s = strokes[st.idx];
            const [x0, y0, x1, y1] = s.box;
            const pad = 16 * pu;
            const bx = Math.max(0, Math.floor(x0 - pad)), by = Math.max(0, Math.floor(y0 - pad));
            const bw = Math.min(PW, Math.ceil(x1 + pad)) - bx, bh = Math.min(PH, Math.ceil(y1 + pad)) - by;
            if (bw > 0 && bh > 0) {
              scrCtx.save();
              scrCtx.beginPath();
              scrCtx.rect(bx, by, bw, bh);
              scrCtx.clip();
              scrCtx.clearRect(bx, by, bw, bh);
              bandPath(scrCtx, s, st.u * s.L);
              scrCtx.globalCompositeOperation = 'destination-out';
              scrCtx.drawImage(mask, bx, by, bw, bh, bx, by, bw, bh);
              scrCtx.globalCompositeOperation = 'source-in';
              scrCtx.drawImage(sketchPage, bx, by, bw, bh, bx, by, bw, bh);
              scrCtx.restore();
              ctx.drawImage(scratch, bx, by, bw, bh, bx, by, bw, bh);
            }
          }
          if (fill > 0) {
            ctx.globalAlpha = inkAlpha * fill;
            ctx.drawImage(sketchPage, 0, 0);
          }
        }
        ctx.restore();
      }
      ctx.save();
      ctx.globalCompositeOperation = style.ink.blend;
      ctx.globalAlpha = inkAlpha;
      ctx.drawImage(ink, 0, 0);
      ctx.restore();
      if (st.down && st.idx >= committed && (!sketchMode || (style.sketch.strokeLines > 0 && strokes[st.idx].layer < 2))) {
        const s = strokes[st.idx];
        const rr = paintStroke(s, st.u * s.L);
        if (rr) {
          ctx.save();
          ctx.globalCompositeOperation = style.ink.blend;
          blit(ctx, s, rr, sketchMode ? style.sketch.strokeLines * inkAlpha : inkAlpha);
          ctx.restore();
        }
      }
      if (opts.pen !== false) drawTool(st, time);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    /** Pen activity sampled at `rate` Hz; drives the procedural drawing sound. */
    function penTrack(rate) {
      const n = Math.ceil(duration * rate);
      const down = new Array(n);
      const speed = new Array(n);
      const layer = new Array(n);
      let prev = penState(0);
      for (let i = 0; i < n; i++) {
        const st = penState((i + 1) / rate);
        down[i] = st.down ? 1 : 0;
        speed[i] = Math.round((Math.hypot(st.x - prev.x, st.y - prev.y) * rate) / pu);
        layer[i] = st.idx >= 0 && strokes[st.idx] ? strokes[st.idx].layer : 0;
        prev = st;
      }
      return { rate, down, speed, layer };
    }

    return {
      ready,
      seek,
      penTrack,
      style,
      info: () => ({
        duration,
        fps: opts.fps,
        frames: Math.round(duration * opts.fps),
        width: W,
        height: H,
        strokes: strokes.length,
        drawEnd,
        mode: sketchMode ? 'reveal' : 'strokes',
        revealStart: hasColor ? revealStart : null,
        revealEnd: hasColor ? revealEnd : null,
      }),
    };
  }

  Inkline.render = { createRenderer, DEFAULT_STYLE, merge };
})(typeof window !== 'undefined' ? window : globalThis);
