/*
 * inkline · materials
 * Procedural grounds (paper, whiteboard, slate, blueprint …) and the drawing tools
 * that ride the stroke tip. Everything is generated from a seed: no image assets.
 */
(function (root) {
  'use strict';
  const Inkline = (root.Inkline = root.Inkline || {});

  function rng(seed) {
    let a = seed >>> 0 || 0x9e3779b9;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function canvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
  }

  /** Smooth fractal noise field in [0,1], generated small and meant to be upscaled. */
  function fbmField(w, h, seed, octaves) {
    const rand = rng(seed);
    const out = new Float32Array(w * h);
    let amp = 1;
    let total = 0;
    for (let o = 0; o < octaves; o++) {
      const cell = Math.max(2, Math.round(Math.min(w, h) / (2 << o)));
      const gw = Math.ceil(w / cell) + 2;
      const gh = Math.ceil(h / cell) + 2;
      const g = new Float32Array(gw * gh);
      for (let i = 0; i < g.length; i++) g[i] = rand();
      for (let y = 0; y < h; y++) {
        const fy = y / cell;
        const y0 = fy | 0;
        const ty = fy - y0;
        const sy = ty * ty * (3 - 2 * ty);
        for (let x = 0; x < w; x++) {
          const fx = x / cell;
          const x0 = fx | 0;
          const tx = fx - x0;
          const sx = tx * tx * (3 - 2 * tx);
          const a = g[y0 * gw + x0], b = g[y0 * gw + x0 + 1];
          const c = g[(y0 + 1) * gw + x0], d = g[(y0 + 1) * gw + x0 + 1];
          out[y * w + x] += amp * ((a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy);
        }
      }
      total += amp;
      amp *= 0.5;
    }
    for (let i = 0; i < out.length; i++) out[i] /= total;
    return out;
  }

  function fieldCanvas(field, w, h, rgb, alphaFn) {
    const c = canvas(w, h);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(w, h);
    for (let i = 0, p = 0; i < field.length; i++, p += 4) {
      img.data[p] = rgb[0];
      img.data[p + 1] = rgb[1];
      img.data[p + 2] = rgb[2];
      img.data[p + 3] = Math.max(0, Math.min(255, alphaFn(field[i]) * 255));
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  /** Fine tooth: a tile of per-pixel noise used both for the paper and for breaking up graphite. */
  function toothTile(size, seed, softness) {
    const rand = rng(seed);
    const c = canvas(size, size);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    for (let i = 0; i < size * size; i++) {
      const v = rand();
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 0;
      img.data[i * 4 + 3] = v * 255;
    }
    ctx.putImageData(img, 0, 0);
    if (softness > 0) {
      const s = canvas(size, size);
      const sctx = s.getContext('2d');
      sctx.filter = `blur(${softness}px)`;
      // draw 3×3 so the blur wraps and the tile stays seamless
      for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) sctx.drawImage(c, x * size, y * size);
      return s;
    }
    return c;
  }

  /** Contrast-stretched tooth so destination-out leaves real gaps, like graphite skipping paper valleys. */
  function grainTile(size, seed, amount) {
    const base = toothTile(size, seed, 0.6);
    const ctx = base.getContext('2d');
    const img = ctx.getImageData(0, 0, size, size);
    for (let i = 3; i < img.data.length; i += 4) {
      const v = img.data[i] / 255;
      const k = Math.max(0, Math.min(1, (v - (1 - amount)) / Math.max(0.05, amount)));
      img.data[i] = k * k * 255;
    }
    ctx.putImageData(img, 0, 0);
    return base;
  }

  /* ---------------------------------------------------------------- grounds */

  function paintGround(ctx, w, h, paper, seed, unit) {
    const tex = paper.texture || 'paper';
    const rand = rng(seed * 7 + 3);
    ctx.save();
    ctx.fillStyle = paper.color;
    ctx.fillRect(0, 0, w, h);

    const blotch = (alpha, rgb, scale, mode, oct) => {
      const fw = Math.max(8, Math.round(w / scale));
      const fh = Math.max(8, Math.round(h / scale));
      const f = fbmField(fw, fh, seed + scale, oct || 4);
      const c = fieldCanvas(f, fw, fh, rgb, (v) => Math.max(0, v - 0.45) * 2 * alpha);
      ctx.globalCompositeOperation = mode || 'multiply';
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(c, 0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
    };

    const tooth = (alpha, light) => {
      const tile = toothTile(256, seed + 11, 0.5);
      const pat = ctx.createPattern(tile, 'repeat');
      ctx.globalAlpha = alpha;
      ctx.globalCompositeOperation = light ? 'screen' : 'multiply';
      if (light) {
        // screen needs light pixels: invert the tile into white specks
        const inv = canvas(256, 256);
        const ictx = inv.getContext('2d');
        ictx.drawImage(tile, 0, 0);
        ictx.globalCompositeOperation = 'source-in';
        ictx.fillStyle = '#fff';
        ictx.fillRect(0, 0, 256, 256);
        ctx.fillStyle = ctx.createPattern(inv, 'repeat');
      } else ctx.fillStyle = pat;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    };

    const vignette = (amount, color) => {
      if (!amount) return;
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.hypot(w, h) * 0.62);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, color || `rgba(40,30,20,${amount})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    };

    const fibers = (n, color, alpha) => {
      ctx.strokeStyle = color;
      ctx.lineCap = 'round';
      for (let i = 0; i < n; i++) {
        const x = rand() * w;
        const y = rand() * h;
        const a = rand() * Math.PI * 2;
        const l = (6 + rand() * 22) * unit;
        ctx.globalAlpha = alpha * (0.3 + rand() * 0.7);
        ctx.lineWidth = (0.4 + rand() * 0.8) * unit;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + Math.cos(a + 0.6) * l * 0.5, y + Math.sin(a + 0.6) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };

    const ghost = (n, color, alpha, blurPx) => {
      // residue of earlier, erased drawings: the board has history
      const g = canvas(w, h);
      const gctx = g.getContext('2d');
      gctx.strokeStyle = color;
      gctx.lineCap = 'round';
      for (let i = 0; i < n; i++) {
        let x = rand() * w;
        let y = rand() * h;
        gctx.lineWidth = (6 + rand() * 16) * unit;
        gctx.globalAlpha = 0.4 + rand() * 0.6;
        gctx.beginPath();
        gctx.moveTo(x, y);
        const segs = 3 + ((rand() * 5) | 0);
        for (let k = 0; k < segs; k++) {
          const nx = x + (rand() - 0.5) * 260 * unit;
          const ny = y + (rand() - 0.5) * 120 * unit;
          gctx.quadraticCurveTo(x + (rand() - 0.5) * 200 * unit, y + (rand() - 0.5) * 200 * unit, nx, ny);
          x = nx;
          y = ny;
        }
        gctx.stroke();
      }
      ctx.save();
      ctx.filter = `blur(${blurPx * unit}px)`;
      ctx.globalAlpha = alpha;
      ctx.drawImage(g, 0, 0);
      ctx.restore();
    };

    switch (tex) {
      case 'whiteboard': {
        ghost(14, '#5a6470', 0.05, 10);
        const g = ctx.createLinearGradient(0, 0, w, h);
        g.addColorStop(0, 'rgba(255,255,255,0)');
        g.addColorStop(0.38, 'rgba(255,255,255,0.0)');
        g.addColorStop(0.46, 'rgba(255,255,255,0.55)');
        g.addColorStop(0.55, 'rgba(255,255,255,0)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
        blotch(0.05, [120, 130, 140], 6, 'multiply', 3);
        vignette(0.06, 'rgba(60,70,80,0.08)');
        break;
      }
      case 'chalkboard': {
        blotch(0.35, [0, 0, 0], 5, 'multiply', 5);
        ghost(22, '#e8efe9', 0.08, 14);
        tooth(0.1, true);
        vignette(0.35, 'rgba(0,0,0,0.35)');
        break;
      }
      case 'blueprint': {
        blotch(0.25, [0, 20, 60], 6, 'multiply', 4);
        const minor = 24 * unit;
        ctx.strokeStyle = 'rgba(255,255,255,0.10)';
        ctx.lineWidth = Math.max(1, unit);
        ctx.beginPath();
        for (let x = (w / 2) % minor; x < w; x += minor) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
        for (let y = (h / 2) % minor; y < h; y += minor) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.beginPath();
        for (let x = (w / 2) % (minor * 5); x < w; x += minor * 5) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
        for (let y = (h / 2) % (minor * 5); y < h; y += minor * 5) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
        ctx.stroke();
        tooth(0.06, true);
        vignette(0.3, 'rgba(0,10,40,0.35)');
        break;
      }
      case 'notebook': {
        blotch(0.05, [120, 110, 90], 5, 'multiply', 3);
        const gap = 54 * unit;
        ctx.strokeStyle = 'rgba(96,140,205,0.45)';
        ctx.lineWidth = 1.6 * unit;
        ctx.beginPath();
        for (let y = gap * 2.2; y < h; y += gap) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
        ctx.stroke();
        ctx.strokeStyle = 'rgba(222,96,96,0.6)';
        ctx.lineWidth = 2 * unit;
        ctx.beginPath();
        ctx.moveTo(w * 0.12, 0);
        ctx.lineTo(w * 0.12, h);
        ctx.stroke();
        tooth(0.05);
        break;
      }
      case 'black': {
        blotch(0.5, [0, 0, 0], 5, 'multiply', 4);
        tooth(0.05, true);
        vignette(0.5, 'rgba(0,0,0,0.6)');
        break;
      }
      case 'aged': {
        blotch(0.35, [130, 90, 40], 3, 'multiply', 5);
        blotch(0.2, [110, 70, 30], 9, 'multiply', 3);
        fibers(500, '#7a5a30', 0.12);
        tooth(0.12);
        vignette(0.4);
        break;
      }
      case 'kraft': {
        blotch(0.25, [90, 60, 30], 4, 'multiply', 5);
        fibers(1600, '#6b4a26', 0.22);
        fibers(500, '#f3e2c4', 0.25);
        tooth(0.14);
        vignette(0.2);
        break;
      }
      case 'none':
        break;
      default: {
        // drawing paper
        blotch(0.08, [150, 130, 100], 4, 'multiply', 4);
        fibers(700, '#9a8f80', 0.1);
        tooth(paper.grain != null ? paper.grain * 0.3 : 0.1);
        vignette(paper.vignette != null ? paper.vignette : 0.12);
      }
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------------- tools
   * Each tool is drawn horizontally, tip at (0, h/2), body extending to +x.
   */

  function shade(hex, k) {
    const [r, g, b] = hexToRgb(hex);
    const f = (v) => Math.max(0, Math.min(255, Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k)));
    return `rgb(${f(r)},${f(g)},${f(b)})`;
  }

  const TOOLS = {
    pencil: (ink) => ({
      w: 620,
      h: 64,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="620" height="64" viewBox="0 0 620 64">
<defs>
<linearGradient id="fer" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e9e6df"/><stop offset=".35" stop-color="#b8b2a6"/><stop offset=".6" stop-color="#f4f1ea"/><stop offset="1" stop-color="#8d877c"/></linearGradient>
<linearGradient id="wood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f0d2a6"/><stop offset=".5" stop-color="#e2b884"/><stop offset="1" stop-color="#c99560"/></linearGradient>
<linearGradient id="er" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f2a6b0"/><stop offset=".5" stop-color="#e8848f"/><stop offset="1" stop-color="#c9606c"/></linearGradient>
</defs>
<path d="M0 32 L30 26.5 L30 37.5 Z" fill="${ink}"/>
<path d="M2 31.6 L22 28.5" stroke="#fff" stroke-opacity=".35" stroke-width="1.2"/>
<path d="M30 26.5 L118 8 L118 56 L30 37.5 Z" fill="url(#wood)"/>
<path d="M118 8 C110 13 112 17 118 21 C110 26 110 38 118 43 C112 47 110 51 118 56" fill="#c99560" opacity=".55"/>
<rect x="118" y="8" width="380" height="16" fill="#f7c831"/>
<rect x="118" y="24" width="380" height="16" fill="#f3b80a"/>
<rect x="118" y="40" width="380" height="16" fill="#cf9300"/>
<rect x="118" y="23.2" width="380" height="1.6" fill="#b8860b" opacity=".35"/>
<rect x="118" y="39.2" width="380" height="1.6" fill="#8a5f00" opacity=".4"/>
<rect x="118" y="10" width="380" height="3" fill="#fff" opacity=".35"/>
<rect x="498" y="6" width="46" height="52" rx="3" fill="url(#fer)"/>
<g stroke="#7d776c" stroke-opacity=".55" stroke-width="2"><line x1="506" y1="7" x2="506" y2="57"/><line x1="512" y1="7" x2="512" y2="57"/><line x1="530" y1="7" x2="530" y2="57"/><line x1="536" y1="7" x2="536" y2="57"/></g>
<path d="M544 7 H596 a14 14 0 0 1 14 14 V43 a14 14 0 0 1 -14 14 H544 Z" fill="url(#er)"/>
</svg>`,
    }),
    fineliner: (ink) => ({
      w: 600,
      h: 60,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="60" viewBox="0 0 600 60">
<defs><linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a3a3c"/><stop offset=".3" stop-color="#5a5a5e"/><stop offset=".55" stop-color="#1c1c1e"/><stop offset="1" stop-color="#0b0b0c"/></linearGradient>
<linearGradient id="m" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9d9d9"/><stop offset=".5" stop-color="#8f8f8f"/><stop offset="1" stop-color="#5b5b5b"/></linearGradient>
<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6b6b70"/><stop offset=".5" stop-color="#9a9aa0"/><stop offset="1" stop-color="#4a4a4f"/></linearGradient></defs>
<path d="M0 30 L6 29 L6 31 Z" fill="${ink}"/>
<rect x="6" y="28.4" width="22" height="3.2" fill="url(#m)"/>
<path d="M28 27 L64 18 L64 42 L28 33 Z" fill="url(#m)"/>
<rect x="64" y="14" width="96" height="32" rx="6" fill="url(#g)"/>
<g stroke="#2e2e32" stroke-opacity=".5" stroke-width="2">${Array.from({ length: 14 }, (_, i) => `<line x1="${72 + i * 6}" y1="15" x2="${72 + i * 6}" y2="45"/>`).join('')}</g>
<rect x="158" y="12" width="420" height="36" rx="8" fill="url(#b)"/>
<rect x="170" y="15" width="400" height="4" rx="2" fill="#fff" opacity=".18"/>
<rect x="452" y="4" width="120" height="8" rx="4" fill="url(#b)"/>
<rect x="572" y="13" width="26" height="34" rx="10" fill="${ink}"/>
</svg>`,
    }),
    ballpoint: (ink) => ({
      w: 600,
      h: 56,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="56" viewBox="0 0 600 56">
<defs><linearGradient id="c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity=".85"/><stop offset=".4" stop-color="#e8eef5" stop-opacity=".45"/><stop offset="1" stop-color="#b9c4d1" stop-opacity=".75"/></linearGradient>
<linearGradient id="m" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e6e6e6"/><stop offset=".5" stop-color="#9b9b9b"/><stop offset="1" stop-color="#666"/></linearGradient></defs>
<circle cx="2" cy="28" r="2" fill="#555"/>
<path d="M3 26.5 L26 24 L26 32 L3 29.5 Z" fill="url(#m)"/>
<path d="M26 22 L70 12 L70 44 L26 34 Z" fill="${ink}" opacity=".95"/>
<rect x="70" y="10" width="480" height="36" fill="url(#c)" stroke="#9aa6b4" stroke-width="1"/>
<rect x="76" y="24" width="460" height="8" rx="4" fill="${ink}" opacity=".85"/>
<g stroke="#9aa6b4" stroke-width="1" opacity=".7"><line x1="70" y1="22" x2="550" y2="22"/><line x1="70" y1="34" x2="550" y2="34"/></g>
<rect x="76" y="13" width="470" height="3" fill="#fff" opacity=".7"/>
<path d="M550 10 H580 a8 18 0 0 1 0 36 H550 Z" fill="${ink}"/>
</svg>`,
    }),
    marker: (ink) => ({
      w: 560,
      h: 84,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="84" viewBox="0 0 560 84">
<defs><linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".45" stop-color="#ececec"/><stop offset=".75" stop-color="#c9c9c9"/><stop offset="1" stop-color="#9e9e9e"/></linearGradient>
<linearGradient id="k" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(ink, 0.25)}"/><stop offset=".5" stop-color="${ink}"/><stop offset="1" stop-color="${shade(ink, -0.45)}"/></linearGradient></defs>
<path d="M0 36 L16 30 L22 46 L4 50 Z" fill="${ink}"/>
<path d="M14 26 L52 18 L52 66 L18 56 Z" fill="url(#b)" stroke="#8e8e8e" stroke-width="1"/>
<rect x="52" y="12" width="96" height="60" rx="6" fill="url(#k)"/>
<rect x="148" y="10" width="360" height="64" rx="10" fill="url(#b)" stroke="#a3a3a3" stroke-width="1"/>
<rect x="160" y="16" width="340" height="6" rx="3" fill="#fff" opacity=".9"/>
<rect x="508" y="14" width="44" height="56" rx="12" fill="url(#k)"/>
</svg>`,
    }),
    chalk: (ink) => ({
      w: 240,
      h: 48,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="48" viewBox="0 0 240 48">
<defs><linearGradient id="c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".6" stop-color="${shade(ink, -0.05)}"/><stop offset="1" stop-color="${shade(ink, -0.25)}"/></linearGradient>
<filter id="r"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="3"/><feDisplacementMap in="SourceGraphic" scale="3"/></filter></defs>
<g filter="url(#r)"><path d="M0 24 Q4 12 18 8 L232 8 Q238 24 232 40 L18 40 Q4 36 0 24 Z" fill="url(#c)"/></g>
</svg>`,
    }),
    brush: (ink) => ({
      w: 640,
      h: 56,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="56" viewBox="0 0 640 56">
<defs><linearGradient id="w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8a5a34"/><stop offset=".4" stop-color="#b07a4a"/><stop offset="1" stop-color="#5e3a1e"/></linearGradient>
<linearGradient id="m" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f1e7c8"/><stop offset=".5" stop-color="#b9a46b"/><stop offset="1" stop-color="#7b6838"/></linearGradient></defs>
<path d="M0 28 Q30 18 70 17 L70 39 Q30 38 0 28 Z" fill="${ink}"/>
<path d="M40 19 Q58 16 70 17 L70 39 Q58 40 40 37 Z" fill="#3a2a1a" opacity=".55"/>
<rect x="70" y="14" width="70" height="28" rx="3" fill="url(#m)"/>
<path d="M140 15 L620 20 a8 8 0 0 1 0 16 L140 41 Z" fill="url(#w)"/>
</svg>`,
    }),
  };

  function toolImage(name, ink) {
    const make = TOOLS[name];
    if (!make) return Promise.resolve(null);
    const t = make(ink || '#1a1a1a');
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ img, w: t.w, h: t.h });
      img.onerror = () => reject(new Error('inkline: tool art failed to load: ' + name));
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(t.svg);
    });
  }

  Inkline.materials = { rng, canvas, fbmField, fieldCanvas, toothTile, grainTile, paintGround, toolImage, hexToRgb, TOOLS };
})(typeof window !== 'undefined' ? window : globalThis);
