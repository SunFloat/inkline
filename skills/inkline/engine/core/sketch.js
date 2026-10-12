/*
 * inkline · sketch
 * Builds the finished drawing as a raster: dodge-and-burn line work plus tone laid
 * down as real hatching texture. The renderer never shows it whole; strokes reveal
 * it band by band, in drawing order, under the moving tool.
 */
(function (root) {
  'use strict';
  const Inkline = (root.Inkline = root.Inkline || {});
  const M = Inkline.materials;

  function blur(src, w, h, sigma) {
    return Inkline.trace.blur(src, w, h, sigma);
  }

  /** A seamless tile of short, slightly bent pencil strokes at one angle. */
  function hatchTile(size, angleDeg, spacing, seed, weight) {
    const rand = M.rng(seed);
    const c = M.canvas(size, size);
    const ctx = c.getContext('2d');
    ctx.lineCap = 'round';
    const a = (angleDeg * Math.PI) / 180;
    const dx = Math.cos(a), dy = Math.sin(a);
    const nx = -dy, ny = dx;
    const reach = size * 1.5;
    for (let o = -reach; o < reach; o += spacing * (0.8 + rand() * 0.4)) {
      let t = -reach + rand() * 20;
      while (t < reach) {
        const len = spacing * (4 + rand() * 9);
        const x0 = size / 2 + nx * o + dx * t, y0 = size / 2 + ny * o + dy * t;
        const x1 = x0 + dx * len, y1 = y0 + dy * len;
        const bend = (rand() - 0.5) * spacing * 0.8;
        ctx.globalAlpha = 0.45 + rand() * 0.55;
        ctx.lineWidth = weight * (0.7 + rand() * 0.6);
        // draw with wrap-around so the tile is seamless
        for (let wy = -1; wy <= 1; wy++) {
          for (let wx = -1; wx <= 1; wx++) {
            ctx.beginPath();
            ctx.moveTo(x0 + wx * size, y0 + wy * size);
            ctx.quadraticCurveTo((x0 + x1) / 2 + nx * bend + wx * size, (y0 + y1) / 2 + ny * bend + wy * size, x1 + wx * size, y1 + wy * size);
            ctx.stroke();
          }
        }
        t += len + spacing * (0.5 + rand() * 2.5);
      }
    }
    return ctx.getImageData(0, 0, size, size).data;
  }

  function smoothstep(a, b, v) {
    const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }

  /**
   * img: decoded source image. matte: optional subject matte image (white = subject).
   * Returns a canvas (image resolution) whose alpha is the drawing, coloured with ink.
   */
  function buildSketch(img, matte, cfg, inkColor, seed, scale) {
    const maxSide = 1400;
    const s = Math.min(1, maxSide / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
    const w = Math.max(8, Math.round((img.naturalWidth || img.width) * s));
    const h = Math.max(8, Math.round((img.naturalHeight || img.height) * s));
    const c = M.canvas(w, h);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const px = ctx.getImageData(0, 0, w, h).data;
    const n = w * h;
    let G = new Float32Array(n);
    for (let i = 0; i < n; i++) G[i] = (0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255;
    // percentile stretch
    {
      const hist = new Uint32Array(256);
      for (let i = 0; i < n; i++) hist[Math.min(255, (G[i] * 255) | 0)]++;
      const q = (f) => {
        let acc = 0;
        for (let i = 0; i < 256; i++) if ((acc += hist[i]) >= f * n) return i / 255;
        return 1;
      };
      const lo = q(0.01), hi = Math.max(lo + 0.05, q(0.99));
      for (let i = 0; i < n; i++) G[i] = Math.min(1, Math.max(0, (G[i] - lo) / (hi - lo)));
    }
    // a touch of smoothing: canvas craquelure and sensor noise are not line work
    G = blur(G, w, h, Math.max(0.6, 1.1 * Math.min(w, h) / 900) * (cfg.presmooth != null ? cfg.presmooth : 1));
    let mt = null;
    if (matte) {
      const m = M.canvas(w, h);
      const mctx = m.getContext('2d', { willReadFrequently: true });
      mctx.drawImage(matte, 0, 0, w, h);
      const md = mctx.getImageData(0, 0, w, h).data;
      mt = new Float32Array(n);
      for (let i = 0; i < n; i++) mt[i] = md[i * 4] / 255;
    }
    const unit = Math.min(w, h) / 900;

    // 1. line work: colour-dodge of the inverted blur (the classic pencil-sketch response)
    const inv = new Float32Array(n);
    for (let i = 0; i < n; i++) inv[i] = 1 - G[i];
    const B = blur(inv, w, h, Math.max(1.2, 2.4 * unit) * (cfg.lineSoftness || 1));
    const line = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const dodge = Math.min(1, G[i] / Math.max(0.02, 1 - B[i]));
      line[i] = Math.pow(Math.max(0, (1 - dodge - 0.015) * 2.6), 0.85);
    }

    // 2. tone: smoothed darkness, laid down as hatching texture
    const T = blur(G, w, h, 2 * unit + 0.6);
    const tileSize = 256;
    const sp = Math.max(3, 5.2 * unit * (cfg.hatchScale || 1));
    const wgt = Math.max(0.8, 1.15 * unit);
    const t1 = hatchTile(tileSize, cfg.angle != null ? cfg.angle : 42, sp, seed + 1, wgt);
    const t2 = hatchTile(tileSize, (cfg.angle != null ? cfg.angle : 42) + 76, sp * 0.9, seed + 2, wgt);
    const t3 = hatchTile(tileSize, (cfg.angle != null ? cfg.angle : 42) + 32, sp * 0.8, seed + 3, wgt);
    const tone = cfg.tone != null ? cfg.tone : 0.85;
    const lines = cfg.lines != null ? cfg.lines : 1;
    const vig = cfg.vignette != null ? cfg.vignette : 0.4;
    const ew = Math.ceil(w / 8), eh = Math.ceil(h / 8);
    const edgeNoise = M.fbmField(ew, eh, seed + 41, 5);
    const A = new Float32Array(n);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        // on dark grounds the tool lays down light, so tone follows brightness
        let dark = cfg.invert ? T[i] : 1 - T[i];
        const d = Math.min(1, Math.hypot((x / w - 0.5) * 1.15, y / h - 0.44) / 0.62);
        let k = 1 - vig * d * d;
        // with a subject matte the background stays paper: the sketch fades out around the figure
        if (mt) k *= mt[i] * mt[i];
        dark *= k;
        const ti = ((y & 255) * tileSize + (x & 255)) * 4 + 3;
        const h1 = t1[ti] / 255, h2 = t2[ti] / 255, h3 = t3[ti] / 255;
        const shade =
          smoothstep(0.12, 0.55, dark) * h1 * 0.55 +
          smoothstep(0.38, 0.78, dark) * h2 * 0.5 +
          smoothstep(0.62, 0.95, dark) * h3 * 0.45 +
          smoothstep(0.3, 1, dark) * 0.12;
        // soften the dodge halo where subject meets background, and tear the sheet edge
        const mk = mt ? (0.04 + 0.96 * mt[i] * mt[i]) * (1 - 2.4 * mt[i] * (1 - mt[i])) : 1;
        const de = Math.min(x, y, w - 1 - x, h - 1 - y) / Math.min(w, h);
        const edge = Math.min(1, Math.max(0, (de - 0.01 - edgeNoise[((y >> 3) * ew + (x >> 3))] * 0.08) / 0.12));
        A[i] = Math.min(1, line[i] * lines * mk + shade * tone) * edge;
      }
    }
    const out = M.canvas(w, h);
    const octx = out.getContext('2d');
    const od = octx.createImageData(w, h);
    const [r, g, b] = M.hexToRgb(inkColor);
    for (let i = 0; i < n; i++) {
      od.data[i * 4] = r;
      od.data[i * 4 + 1] = g;
      od.data[i * 4 + 2] = b;
      od.data[i * 4 + 3] = Math.round(Math.min(1, A[i]) * 255);
    }
    octx.putImageData(od, 0, 0);
    void scale;
    return out;
  }

  Inkline.sketch = { buildSketch, hatchTile };
})(typeof window !== 'undefined' ? window : globalThis);
