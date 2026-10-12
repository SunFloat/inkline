/*
 * inkline · trace
 * Turns pixels or SVG line art into an ordered list of hand-drawable strokes.
 * Classic script (no modules) so it runs from file://, in headless Chrome and on the site.
 */
(function (root) {
  'use strict';
  const Inkline = (root.Inkline = root.Inkline || {});

  /* ------------------------------------------------------------------ rng */

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

  /* ------------------------------------------------------- raster helpers */

  function luminance(rgba, w, h) {
    const L = new Float32Array(w * h);
    for (let i = 0, p = 0; i < L.length; i++, p += 4) {
      const a = rgba[p + 3] / 255;
      // composite over white so transparent PNGs trace as line art on paper
      const r = rgba[p] * a + 255 * (1 - a);
      const g = rgba[p + 1] * a + 255 * (1 - a);
      const b = rgba[p + 2] * a + 255 * (1 - a);
      L[i] = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    }
    return L;
  }

  function stretch(L, lo, hi) {
    const hist = new Uint32Array(256);
    for (let i = 0; i < L.length; i++) hist[Math.min(255, (L[i] * 255) | 0)]++;
    const target = (q) => {
      let acc = 0;
      const want = q * L.length;
      for (let i = 0; i < 256; i++) {
        acc += hist[i];
        if (acc >= want) return i / 255;
      }
      return 1;
    };
    const a = target(lo);
    const b = Math.max(a + 0.05, target(hi));
    const out = new Float32Array(L.length);
    for (let i = 0; i < L.length; i++) out[i] = Math.min(1, Math.max(0, (L[i] - a) / (b - a)));
    return out;
  }

  function gamma(L, g) {
    if (g === 1) return L;
    const out = new Float32Array(L.length);
    for (let i = 0; i < L.length; i++) out[i] = Math.pow(L[i], g);
    return out;
  }

  function blur(src, w, h, sigma) {
    if (sigma <= 0.01) return Float32Array.from(src);
    const r = Math.max(1, Math.ceil(sigma * 3));
    const k = new Float32Array(r * 2 + 1);
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
    for (let i = 0; i < k.length; i++) k[i] /= sum;
    const tmp = new Float32Array(w * h);
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        let acc = 0;
        for (let i = -r; i <= r; i++) {
          const xx = x + i < 0 ? 0 : x + i >= w ? w - 1 : x + i;
          acc += src[row + xx] * k[i + r];
        }
        tmp[row + x] = acc;
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let acc = 0;
        for (let i = -r; i <= r; i++) {
          const yy = y + i < 0 ? 0 : y + i >= h ? h - 1 : y + i;
          acc += tmp[yy * w + x] * k[i + r];
        }
        out[y * w + x] = acc;
      }
    }
    return out;
  }

  /**
   * Difference-of-Gaussians line mask. Keeps the darkest `coverage` share of
   * pixels on the dark side of an edge, so every image yields a comparable
   * amount of line work regardless of exposure.
   */
  function dogLines(L, w, h, sigma, coverage, floor, boost) {
    const g1 = blur(L, w, h, sigma);
    const g2 = blur(L, w, h, sigma * 1.6);
    const n = w * h;
    const d = new Float32Array(n);
    const neg = [];
    for (let i = 0; i < n; i++) {
      d[i] = g1[i] - g2[i];
      if (d[i] < 0) neg.push(d[i]);
    }
    if (!neg.length) return new Uint8Array(n);
    // percentile of the negative responses, computed on a sample for speed
    const sample = [];
    const step = Math.max(1, Math.floor(neg.length / 40000));
    for (let i = 0; i < neg.length; i += step) sample.push(neg[i]);
    sample.sort((a, b) => a - b);
    const want = Math.min(0.999, coverage * (n / neg.length));
    const t = Math.min(-floor, sample[Math.floor(want * (sample.length - 1))]);
    // hysteresis: weak responses survive only when connected to a strong one,
    // which keeps lines continuous and drops isolated texture specks
    const weakK = 0.5;
    const mask = new Uint8Array(n);
    const queue = new Int32Array(n);
    let tail = 0;
    for (let i = 0; i < n; i++) {
      const ti = boost ? t * boost[i] : t;
      if (d[i] < ti) {
        mask[i] = 1;
        queue[tail++] = i;
      }
    }
    let head = 0;
    while (head < tail) {
      const p = queue[head++];
      const x = p % w, y = (p / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const q = yy * w + xx;
          if (mask[q]) continue;
          const tq = (boost ? t * boost[q] : t) * weakK;
          if (d[q] < tq) {
            mask[q] = 1;
            queue[tail++] = q;
          }
        }
      }
    }
    return mask;
  }

  function despeckle(mask, w, h, minArea) {
    // drop tiny connected blobs before thinning; they become hairy noise otherwise
    const seen = new Uint8Array(w * h);
    const stack = [];
    const comp = [];
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i] || seen[i]) continue;
      comp.length = 0;
      stack.push(i);
      seen[i] = 1;
      while (stack.length) {
        const p = stack.pop();
        comp.push(p);
        const x = p % w;
        const y = (p / w) | 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            const q = yy * w + xx;
            if (mask[q] && !seen[q]) {
              seen[q] = 1;
              stack.push(q);
            }
          }
        }
      }
      if (comp.length < minArea) for (const p of comp) mask[p] = 0;
    }
    return mask;
  }

  /** Zhang–Suen thinning: line masks become one-pixel centre lines. */
  function thin(mask, w, h) {
    const m = Uint8Array.from(mask);
    for (let x = 0; x < w; x++) m[x] = m[(h - 1) * w + x] = 0;
    for (let y = 0; y < h; y++) m[y * w] = m[y * w + w - 1] = 0;
    const del = [];
    let changed = true;
    let pass = 0;
    while (changed && pass < 80) {
      changed = false;
      for (let sub = 0; sub < 2; sub++) {
        del.length = 0;
        for (let y = 1; y < h - 1; y++) {
          for (let x = 1; x < w - 1; x++) {
            const i = y * w + x;
            if (!m[i]) continue;
            const p2 = m[i - w], p3 = m[i - w + 1], p4 = m[i + 1], p5 = m[i + w + 1];
            const p6 = m[i + w], p7 = m[i + w - 1], p8 = m[i - 1], p9 = m[i - w - 1];
            const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
            if (b < 2 || b > 6) continue;
            const a =
              (!p2 && p3) + (!p3 && p4) + (!p4 && p5) + (!p5 && p6) +
              (!p6 && p7) + (!p7 && p8) + (!p8 && p9) + (!p9 && p2);
            if (a !== 1) continue;
            if (sub === 0 ? p2 * p4 * p6 || p4 * p6 * p8 : p2 * p4 * p8 || p2 * p6 * p8) continue;
            del.push(i);
          }
        }
        if (del.length) changed = true;
        for (const i of del) m[i] = 0;
      }
      pass++;
    }
    return m;
  }

  const N8 = [
    [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
  ];

  /** Walk a skeleton into polylines, preferring to keep the current heading. */
  function traceSkeleton(sk, w, h) {
    const deg = new Uint8Array(w * h);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (!sk[i]) continue;
        let c = 0;
        for (const [dx, dy] of N8) c += sk[i + dy * w + dx];
        deg[i] = c;
      }
    }
    const used = new Uint8Array(w * h);
    const paths = [];

    const walk = (start) => {
      const pts = [start % w, (start / w) | 0];
      used[start] = 1;
      let cur = start;
      let hx = 0;
      let hy = 0;
      for (;;) {
        const cx = cur % w;
        const cy = (cur / w) | 0;
        let best = -1;
        let bestScore = -Infinity;
        for (const [dx, dy] of N8) {
          const q = (cy + dy) * w + (cx + dx);
          if (!sk[q] || used[q]) continue;
          const len = Math.hypot(dx, dy);
          const score = (dx * hx + dy * hy) / len - (len > 1 ? 0.05 : 0);
          if (score > bestScore) {
            bestScore = score;
            best = q;
          }
        }
        if (best < 0) break;
        hx = (best % w) - cx;
        hy = ((best / w) | 0) - cy;
        used[best] = 1;
        pts.push(best % w, (best / w) | 0);
        cur = best;
        if (deg[best] > 2) break; // stop at junctions, the branch continues as its own stroke
      }
      return pts;
    };

    // endpoints first so strokes start where a hand would start
    for (let i = 0; i < sk.length; i++) if (sk[i] && !used[i] && deg[i] === 1) paths.push(walk(i));
    for (let i = 0; i < sk.length; i++) if (sk[i] && !used[i] && deg[i] > 2) paths.push(walk(i));
    for (let i = 0; i < sk.length; i++) if (sk[i] && !used[i]) paths.push(walk(i));
    return paths;
  }

  /* ------------------------------------------------------ polyline helpers */

  function polyLength(p) {
    let l = 0;
    for (let i = 2; i < p.length; i += 2) l += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
    return l;
  }

  function smooth(p, passes) {
    let a = p;
    for (let k = 0; k < passes; k++) {
      if (a.length < 6) return a;
      const b = a.slice();
      for (let i = 2; i < a.length - 2; i += 2) {
        b[i] = (a[i - 2] + 2 * a[i] + a[i + 2]) / 4;
        b[i + 1] = (a[i - 1] + 2 * a[i + 1] + a[i + 3]) / 4;
      }
      a = b;
    }
    return a;
  }

  function simplify(p, eps) {
    const n = p.length / 2;
    if (n < 3) return p;
    const keep = new Uint8Array(n);
    keep[0] = keep[n - 1] = 1;
    const stack = [[0, n - 1]];
    while (stack.length) {
      const [s, e] = stack.pop();
      const ax = p[s * 2], ay = p[s * 2 + 1], bx = p[e * 2], by = p[e * 2 + 1];
      const dx = bx - ax, dy = by - ay;
      const len = Math.hypot(dx, dy) || 1;
      let md = -1, mi = -1;
      for (let i = s + 1; i < e; i++) {
        const d = Math.abs((p[i * 2] - ax) * dy - (p[i * 2 + 1] - ay) * dx) / len;
        if (d > md) {
          md = d;
          mi = i;
        }
      }
      if (md > eps) {
        keep[mi] = 1;
        stack.push([s, mi], [mi, e]);
      }
    }
    const out = [];
    for (let i = 0; i < n; i++) if (keep[i]) out.push(p[i * 2], p[i * 2 + 1]);
    return out;
  }

  function reversePoly(p) {
    const out = new Array(p.length);
    for (let i = 0, j = p.length - 2; j >= 0; i += 2, j -= 2) {
      out[i] = p[j];
      out[i + 1] = p[j + 1];
    }
    return out;
  }

  /** Join strokes whose ends nearly touch and continue the same direction. */
  function joinStrokes(paths, gap) {
    const alive = paths.map(() => true);
    const dirAt = (p, atEnd) => {
      const n = p.length;
      const k = Math.min(n - 2, 8);
      if (atEnd) return [p[n - 2] - p[n - 2 - k], p[n - 1] - p[n - 1 - k]];
      return [p[0] - p[k], p[1] - p[k + 1]];
    };
    let merged = true;
    let guard = 0;
    while (merged && guard++ < 4) {
      merged = false;
      const ends = [];
      paths.forEach((p, i) => {
        if (!alive[i] || p.length < 4) return;
        ends.push({ i, end: false, x: p[0], y: p[1] });
        ends.push({ i, end: true, x: p[p.length - 2], y: p[p.length - 1] });
      });
      const cell = Math.max(2, gap);
      const grid = new Map();
      const key = (x, y) => ((x / cell) | 0) + ',' + ((y / cell) | 0);
      for (const e of ends) {
        const k = key(e.x, e.y);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(e);
      }
      for (const e of ends) {
        if (!alive[e.i]) continue;
        const cx = (e.x / cell) | 0;
        const cy = (e.y / cell) | 0;
        let best = null;
        let bestD = gap;
        for (let gy = cy - 1; gy <= cy + 1; gy++) {
          for (let gx = cx - 1; gx <= cx + 1; gx++) {
            for (const o of grid.get(gx + ',' + gy) || []) {
              if (o.i === e.i || !alive[o.i]) continue;
              const d = Math.hypot(o.x - e.x, o.y - e.y);
              if (d >= bestD) continue;
              const a = dirAt(paths[e.i], e.end);
              const b = dirAt(paths[o.i], o.end);
              const la = Math.hypot(a[0], a[1]) || 1;
              const lb = Math.hypot(b[0], b[1]) || 1;
              // continuing means the two outward directions point at each other
              const cos = -(a[0] * b[0] + a[1] * b[1]) / (la * lb);
              if (cos < 0.5) continue;
              best = o;
              bestD = d;
            }
          }
        }
        if (!best) continue;
        let A = paths[e.i];
        let B = paths[best.i];
        if (!e.end) A = reversePoly(A);
        if (best.end) B = reversePoly(B);
        paths[e.i] = A.concat(B);
        alive[best.i] = false;
        merged = true;
        break; // endpoints changed; rebuild the grid
      }
    }
    return paths.filter((_, i) => alive[i]);
  }

  /* ------------------------------------------------------------- ordering */

  /**
   * Greedy nearest-neighbour ordering with endpoint flipping. `bias` adds a
   * gentle downward drift so a drawing grows the way a hand works a page.
   */
  function order(strokes, start, bias) {
    const n = strokes.length;
    if (n < 2) return strokes;
    const done = new Uint8Array(n);
    const out = [];
    let cx = start[0];
    let cy = start[1];
    const cell = 48;
    const grid = new Map();
    const add = (i, x, y, end) => {
      const k = ((x / cell) | 0) + ',' + ((y / cell) | 0);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push([i, end]);
    };
    strokes.forEach((s, i) => {
      add(i, s.p[0], s.p[1], false);
      add(i, s.p[s.p.length - 2], s.p[s.p.length - 1], true);
    });
    for (let k = 0; k < n; k++) {
      let best = -1, bestEnd = false, bestD = Infinity;
      const gx = (cx / cell) | 0;
      const gy = (cy / cell) | 0;
      for (let r = 0; r < 400; r++) {
        for (let y = gy - r; y <= gy + r; y++) {
          for (let x = gx - r; x <= gx + r; x++) {
            if (r > 0 && y !== gy - r && y !== gy + r && x !== gx - r && x !== gx + r) continue;
            const list = grid.get(x + ',' + y);
            if (!list) continue;
            for (const [i, end] of list) {
              if (done[i]) continue;
              const s = strokes[i].p;
              const px = end ? s[s.length - 2] : s[0];
              const py = end ? s[s.length - 1] : s[1];
              const d = Math.hypot(px - cx, py - cy) + Math.max(0, cy - py) * bias;
              if (d < bestD) {
                bestD = d;
                best = i;
                bestEnd = end;
              }
            }
          }
        }
        // every point closer than r*cell has been seen once ring r is scanned
        if (best >= 0 && r * cell >= bestD) break;
      }
      if (best < 0) {
        for (let i = 0; i < n; i++) if (!done[i]) { best = i; break; }
      }
      done[best] = 1;
      const s = strokes[best];
      if (bestEnd) s.p = reversePoly(s.p);
      out.push(s);
      cx = s.p[s.p.length - 2];
      cy = s.p[s.p.length - 1];
    }
    return out;
  }

  /** Where the eye lands first: the densest patch of fine detail. */
  function focusPoint(mask, w, h) {
    const cell = Math.max(8, Math.round(Math.min(w, h) / 12));
    const gw = Math.ceil(w / cell);
    const gh = Math.ceil(h / cell);
    const acc = new Float32Array(gw * gh);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!mask[y * w + x]) continue;
        // centre weighting keeps busy backgrounds from stealing the opening stroke
        const cxw = 1 - Math.abs(x / w - 0.5) * 1.2;
        const cyw = 1 - Math.abs(y / h - 0.42) * 1.2;
        acc[((y / cell) | 0) * gw + ((x / cell) | 0)] += Math.max(0.05, cxw * cyw);
      }
    }
    let bi = 0;
    for (let i = 1; i < acc.length; i++) if (acc[i] > acc[bi]) bi = i;
    return [(bi % gw + 0.5) * cell, (((bi / gw) | 0) + 0.5) * cell];
  }

  /* ------------------------------------------------------------- hatching */

  /* ------------------------------------------------- tone & form fields */

  /** Local contrast normalisation: soft facial edges become as legible as hard ones. */
  function localContrast(L, w, h, sigma) {
    const mean = blur(L, w, h, sigma);
    const sq = new Float32Array(L.length);
    for (let i = 0; i < L.length; i++) sq[i] = L[i] * L[i];
    const msq = blur(sq, w, h, sigma);
    const out = new Float32Array(L.length);
    for (let i = 0; i < L.length; i++) {
      const sd = Math.sqrt(Math.max(0, msq[i] - mean[i] * mean[i]));
      out[i] = Math.min(1, Math.max(0, 0.5 + (L[i] - mean[i]) / (3 * sd + 0.06)));
    }
    return out;
  }

  /** Edge-tangent field from the smoothed structure tensor. */
  function flowField(L, w, h, sigma) {
    const n = w * h;
    const xx = new Float32Array(n), yy = new Float32Array(n), xy = new Float32Array(n);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const gx = L[i + 1] - L[i - 1];
        const gy = L[i + w] - L[i - w];
        xx[i] = gx * gx;
        yy[i] = gy * gy;
        xy[i] = gx * gy;
      }
    }
    const bxx = blur(xx, w, h, sigma), byy = blur(yy, w, h, sigma), bxy = blur(xy, w, h, sigma);
    const angle = new Float32Array(n);
    const coh = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = bxx[i], b = byy[i], c = bxy[i];
      angle[i] = 0.5 * Math.atan2(2 * c, a - b) + Math.PI / 2;
      coh[i] = Math.sqrt((a - b) * (a - b) + 4 * c * c) / (a + b + 1e-6);
    }
    return { angle, coh };
  }

  /**
   * Background = smooth, flat territory reachable from the image border. Artists
   * rarely render it at full weight; it is what makes the subject pop.
   */
  function backgroundMask(L, w, h, unit, faces) {
    const sigma = 5 * unit + 1;
    const m = blur(L, w, h, sigma);
    const sq = new Float32Array(L.length);
    for (let i = 0; i < L.length; i++) sq[i] = L[i] * L[i];
    const m2 = blur(sq, w, h, sigma);
    const flat = new Uint8Array(L.length);
    for (let i = 0; i < L.length; i++) flat[i] = Math.sqrt(Math.max(0, m2[i] - m[i] * m[i])) < 0.05 ? 1 : 0;
    const bg = new Uint8Array(L.length);
    const queue = new Int32Array(L.length);
    let head = 0, tail = 0;
    const seed = (i) => {
      if (flat[i] && !bg[i]) {
        bg[i] = 1;
        queue[tail++] = i;
      }
    };
    // subjects usually rest on the bottom edge, so the flood starts from the top and upper sides only
    for (let x = 0; x < w; x++) seed(x);
    for (let y = 0; y < Math.round(h * 0.55); y++) { seed(y * w); seed(y * w + w - 1); }
    void faces;
    while (head < tail) {
      const p = queue[head++];
      const x = p % w, y = (p / w) | 0;
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of nb) {
        if (q < 0 || bg[q] || !flat[q]) continue;
        if (Math.abs(m[q] - m[p]) > 0.025) continue;
        bg[q] = 1;
        queue[tail++] = q;
      }
    }
    let count = 0;
    for (let i = 0; i < bg.length; i++) count += bg[i];
    // a "background" covering almost everything means the image is the subject (texture, landscape)
    if (count > bg.length * 0.9 || count < bg.length * 0.04) return new Uint8Array(L.length);
    return bg;
  }

  function erode(mask, w, h, r) {
    const f = blur(Float32Array.from(mask), w, h, r);
    const out = new Uint8Array(mask.length);
    for (let i = 0; i < mask.length; i++) out[i] = f[i] > 0.97 ? 1 : 0;
    return out;
  }

  /* ------------------------------------------------------------- hatching */

  // per level: angle offset from the local form direction (degrees)
  const CROSS = [0, 72, 36, 108];
  const PARALLEL = [0, 8, -8];

  /**
   * Patch hatching: the page is worked in overlapping patches whose direction
   * follows the form underneath, light values first, darker passes crossing them.
   */
  function hatch(tone, flow, bg, w, h, opts, rand) {
    const mode = opts.hatch;
    if (mode === 'none') return [];
    const unit = Math.min(w, h) / 900;
    const density = Math.max(0, Math.min(1, opts.hatchDensity));
    const spacing = (9 - density * 5) * Math.max(0.6, unit) * (opts.hatchSpacing || 1);
    let levels = Math.max(1, Math.min(4, opts.levels || 4));
    if (mode === 'hatch') levels = Math.min(levels, 3);
    const TH = [0.8, 0.6, 0.4, 0.22];
    const bgMode = opts.background || 'light';
    const cell = Math.round(70 * Math.max(0.7, unit));
    const gw = Math.ceil(w / cell), gh = Math.ceil(h / cell);
    const fixed = typeof opts.hatchAngle === 'number' ? (opts.hatchAngle * Math.PI) / 180 : null;
    const maxRun = spacing * (mode === 'scribble' ? 16 : 8);
    const minRun = spacing * 0.9;
    // patch ownership: every pixel belongs to exactly one patch, along wobbly borders
    const owner = new Int32Array(w * h);
    {
      const fw = Math.max(4, Math.ceil(w / 24)), fh = Math.max(4, Math.ceil(h / 24));
      const nxF = blur(Float32Array.from({ length: fw * fh }, () => rand() - 0.5), fw, fh, 1.2);
      const nyF = blur(Float32Array.from({ length: fw * fh }, () => rand() - 0.5), fw, fh, 1.2);
      const norm = (f) => {
        let v = 0;
        for (let i = 0; i < f.length; i++) v += f[i] * f[i];
        const sd = Math.sqrt(v / f.length) || 1;
        for (let i = 0; i < f.length; i++) f[i] /= sd;
      };
      norm(nxF);
      norm(nyF);
      const amp = cell * 0.38;
      for (let y = 0; y < h; y++) {
        const fy = Math.min(fh - 1, (y / 24) | 0);
        for (let x = 0; x < w; x++) {
          const fx = Math.min(fw - 1, (x / 24) | 0);
          const px = Math.min(w - 1, Math.max(0, x + nxF[fy * fw + fx] * amp));
          const py = Math.min(h - 1, Math.max(0, y + nyF[fy * fw + fx] * amp));
          owner[y * w + x] = ((py / cell) | 0) * gw + ((px / cell) | 0);
        }
      }
    }
    const out = [];
    for (let li = 0; li < levels; li++) {
      const th = TH[li];
      const offs = ((mode === 'hatch' ? PARALLEL : CROSS)[li] * Math.PI) / 180;
      const sp = spacing * (mode === 'hatch' ? 1 - li * 0.25 : 1);
      for (let cy = 0; cy < gh; cy++) {
        for (let cx = 0; cx < gw; cx++) {
          const id = cy * gw + cx;
          const ccx = Math.min(w - 1, Math.round((cx + 0.5) * cell));
          const ccy = Math.min(h - 1, Math.round((cy + 0.5) * cell));
          const ci = ccy * w + ccx;
          const inBg = bg[ci] === 1;
          let base = fixed;
          if (base === null) base = !inBg && flow.coh[ci] > 0.18 ? flow.angle[ci] : (42 * Math.PI) / 180;
          const a = base + offs + (rand() - 0.5) * 0.12;
          const dx = Math.cos(a), dy = Math.sin(a);
          const nx = -dy, ny = dx;
          const pad = cell * 0.9; // owner map decides the real border
          const x0 = cx * cell - pad, x1 = (cx + 1) * cell + pad;
          const y0 = cy * cell - pad, y1 = (cy + 1) * cell + pad;
          const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
          const half = Math.hypot(x1 - x0, y1 - y0) / 2;
          const lsp = sp;
          let lineNo = 0;
          for (let o = -half + rand() * lsp; o < half; o += lsp * (0.85 + rand() * 0.3)) {
            const sparse = (lineNo++ & 1) === 1;
            let run = null;
            const flush = () => {
              if (run && Math.hypot(run[2] - run[0], run[3] - run[1]) >= minRun) {
                const bend = (rand() - 0.5) * lsp * 0.7;
                out.push({
                  p: [run[0], run[1], (run[0] + run[2]) / 2 + nx * bend, (run[1] + run[3]) / 2 + ny * bend, run[2], run[3]],
                  layer: 2,
                  level: li,
                });
              }
              run = null;
            };
            for (let t = -half; t <= half; t += 1) {
              const x = mx + nx * o + dx * t;
              const y = my + ny * o + dy * t;
              if (x < 0 || y < 0 || x >= w || y >= h) {
                flush();
                continue;
              }
              const pi = (y | 0) * w + (x | 0);
              if (owner[pi] !== id) {
                flush();
                continue;
              }
              // background: one light pass at half density, or nothing
              const blocked = bg[pi] === 1 && (bgMode === 'none' || (bgMode === 'light' && (li > 0 || sparse)));
              if (!blocked && tone[pi] < th + (rand() - 0.5) * 0.05) {
                if (!run) run = [x, y, x, y];
                else {
                  run[2] = x;
                  run[3] = y;
                  if (Math.hypot(run[2] - run[0], run[3] - run[1]) > maxRun * (0.55 + rand() * 0.7)) {
                    flush();
                    t += 1 + rand() * 2;
                  }
                }
              } else flush();
            }
            flush();
          }
        }
      }
    }
    if (mode === 'zigzag') return zigzag(out, spacing);
    return out;
  }

  /** Marker fill: chain neighbouring hatch runs into one back-and-forth stroke. */
  function zigzag(runs, spacing) {
    const byLevel = new Map();
    for (const r of runs) {
      if (!byLevel.has(r.level)) byLevel.set(r.level, []);
      byLevel.get(r.level).push(r);
    }
    const out = [];
    for (const [level, list] of byLevel) {
      const used = new Uint8Array(list.length);
      for (let i = 0; i < list.length; i++) {
        if (used[i]) continue;
        used[i] = 1;
        let chain = list[i].p.slice();
        let flip = true;
        for (let k = 0; k < 40; k++) {
          const ex = chain[chain.length - 2];
          const ey = chain[chain.length - 1];
          let best = -1;
          let bd = spacing * 2.6;
          for (let j = i + 1; j < Math.min(list.length, i + 400); j++) {
            if (used[j]) continue;
            const q = list[j].p;
            const sx = flip ? q[4] : q[0];
            const sy = flip ? q[5] : q[1];
            const d = Math.hypot(sx - ex, sy - ey);
            if (d < bd) {
              bd = d;
              best = j;
            }
          }
          if (best < 0) break;
          used[best] = 1;
          const q = list[best].p;
          chain = chain.concat(flip ? [q[4], q[5], q[2], q[3], q[0], q[1]] : q);
          flip = !flip;
        }
        out.push({ p: chain, layer: 2, level });
      }
    }
    return out;
  }

  /* ------------------------------------------------------------ image API */

  const DEFAULTS = {
    maxSide: 960,
    detail: 0.6, // 0 = bold outlines only, 1 = every crease
    hatch: 'crosshatch', // none | hatch | crosshatch | zigzag | scribble
    hatchDensity: 0.55,
    hatchAngle: 'flow', // 'flow' follows the form, or a fixed angle in degrees
    levels: 4,
    background: 'light', // light | none | full
    vignette: 0.45, // 0 = shade edge to edge
    contrast: 1,
    seed: 7,
  };

  /**
   * rgba: Uint8ClampedArray, w, h: working size.
   * Returns { width, height, strokes: [{p:[x,y,...], layer:0|1|2}] }
   * layer 0 = contour, 1 = detail, 2 = shading.
   */
  function traceRaster(rgba, w, h, options) {
    const o = Object.assign({}, DEFAULTS, options || {});
    const rand = rng(o.seed);
    const unit = Math.min(w, h) / 900;
    let L = luminance(rgba, w, h);
    L = gamma(stretch(L, 0.01, 0.985), o.contrast);
    const det = Math.max(0, Math.min(1, o.detail));

    // faces (when the browser can find them) get finer line work and are drawn first
    const faces = (o.faces || []).filter((f) => f.box && f.box[2] > 12);
    const bg = o.background === 'full' ? new Uint8Array(w * h) : backgroundMask(L, w, h, unit, faces);
    const bgCore = erode(bg, w, h, 3 * unit + 1);
    const inFace = new Uint8Array(w * h);
    let boost = null;
    if (faces.length) {
      boost = new Float32Array(w * h).fill(1);
      for (const f of faces) {
        const [fx, fy, fw, fh] = f.box;
        const cx = fx + fw / 2, cy = fy + fh * 0.52, rx = fw * 0.66, ry = fh * 0.8;
        for (let y = Math.max(0, Math.floor(cy - ry)); y < Math.min(h, Math.ceil(cy + ry)); y++) {
          for (let x = Math.max(0, Math.floor(cx - rx)); x < Math.min(w, Math.ceil(cx + rx)); x++) {
            const e = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
            if (e > 1) continue;
            inFace[y * w + x] = 1;
            boost[y * w + x] = Math.min(boost[y * w + x], 0.55 + 0.45 * e * e);
          }
        }
      }
    }

    // contour: broad structure on the plain image
    const contourMask = dogLines(L, w, h, 2.4 * unit + 0.6, 0.045 + det * 0.035, 0.004, boost);
    // detail: on a contrast-normalised image so soft features (eyes, lips) survive
    const lcn = localContrast(L, w, h, 14 * unit + 2);
    const mix = new Float32Array(L.length);
    for (let i = 0; i < L.length; i++) mix[i] = 0.45 * L[i] + 0.55 * lcn[i];
    const detailMask = dogLines(mix, w, h, 1.2 * unit + 0.5, 0.035 + det * 0.06, 0.006, boost);
    for (let i = 0; i < bgCore.length; i++) if (bgCore[i]) contourMask[i] = detailMask[i] = 0;
    despeckle(contourMask, w, h, 26 * unit);
    despeckle(detailMask, w, h, 12 * unit);

    const midInFace = (p) => {
      const k = (p.length >> 2) << 1;
      const x = p[k] | 0, y = p[k + 1] | 0;
      return x >= 0 && y >= 0 && x < w && y < h && inFace[y * w + x] === 1;
    };
    const toStrokes = (mask, layer, minLen) => {
      const raw = traceSkeleton(thin(mask, w, h), w, h).filter((p) => p.length >= 6);
      const joined = joinStrokes(raw, 6 * Math.max(1, unit));
      const out = [];
      for (const p of joined) {
        const face = midInFace(p);
        if (polyLength(p) < (face ? minLen * 0.6 : minLen)) continue;
        const sm = simplify(smooth(p, 3), (face ? 0.5 : 0.7) * Math.max(0.8, unit));
        if (sm.length >= 4) out.push({ p: sm, layer, face });
      }
      return out;
    };

    const contours = toStrokes(contourMask, 0, (20 - det * 8) * unit + 6);
    // suppress detail lines that duplicate a contour
    const near = blur(Float32Array.from(contourMask), w, h, 1.6 * unit + 0.6);
    for (let i = 0; i < detailMask.length; i++) if (near[i] > 0.22) detailMask[i] = 0;
    const details = toStrokes(detailMask, 1, (18 - det * 9) * unit + 5);

    const tone = blur(L, w, h, 2.6 * unit + 1);
    if (o.invert) for (let i = 0; i < tone.length; i++) tone[i] = 1 - tone[i];
    if (o.vignette > 0) {
      // shading thins out toward the edges, the way a sketch fades off the page
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const d = Math.min(1, Math.hypot((x / w - 0.5) * 1.15, (y / h - 0.44) * 1.0) / 0.62);
        const k = 1 - o.vignette * d * d;
        tone[y * w + x] = 1 - (1 - tone[y * w + x]) * k;
      }
    }
    const flow = flowField(L, w, h, 9 * unit + 2);
    const shading = hatch(tone, flow, bg, w, h, o, rand);

    // pupils: the darkest spot inside each detected eye becomes a small filled spiral
    const pupils = [];
    for (const f of faces) {
      for (const e of f.eyes || []) {
        const r = Math.max(3, f.box[2] * 0.06);
        let best = Infinity, bx = e[0], by = e[1];
        for (let y = Math.round(e[1] - r); y <= e[1] + r; y++) for (let x = Math.round(e[0] - r * 1.4); x <= e[0] + r * 1.4; x++) {
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          const v = L[y * w + x] + 0.002 * Math.hypot(x - e[0], y - e[1]);
          if (v < best) { best = v; bx = x; by = y; }
        }
        const pr = Math.max(1.6, f.box[2] * 0.022);
        const pts = [];
        for (let a = 0; a < Math.PI * 2 * 3.2; a += 0.35) {
          const rr = pr * (1 - a / (Math.PI * 2 * 3.4));
          pts.push(bx + Math.cos(a) * rr, by + Math.sin(a) * rr * 0.95);
        }
        pupils.push({ p: pts, layer: 1, face: true });
      }
    }

    let focus = focusPoint(detailMask, w, h);
    if (faces.length) {
      const f = faces.reduce((a, b) => (a.box[2] * a.box[3] > b.box[2] * b.box[3] ? a : b));
      focus = f.eyes && f.eyes.length ? [f.eyes.reduce((a, e) => a + e[0], 0) / f.eyes.length, f.eyes.reduce((a, e) => a + e[1], 0) / f.eyes.length] : [f.box[0] + f.box[2] / 2, f.box[1] + f.box[3] * 0.4];
    }
    // a portraitist starts with the eyes and the face, then builds outward
    const faceFirst = order(contours.filter((x) => x.face).concat(details.filter((x) => x.face), pupils), focus, 0.25);
    const orderedContours = order(contours.filter((x) => !x.face), faceFirst.length ? [faceFirst[faceFirst.length - 1].p.slice(-2)[0], faceFirst[faceFirst.length - 1].p.slice(-1)[0]] : focus, 0.35);
    const orderedDetails = order(details.filter((x) => !x.face), focus, 0.35);
    // shading goes light to dark, patch by patch
    const levels = new Map();
    for (const s of shading) {
      const k = s.level || 0;
      if (!levels.has(k)) levels.set(k, []);
      levels.get(k).push(s);
    }
    let orderedShading = [];
    for (const k of [...levels.keys()].sort((a, b) => a - b)) orderedShading = orderedShading.concat(order(levels.get(k), focus, 0.15));

    const round = (s) => ({
      p: s.p.map((v) => Math.round(v * 10) / 10),
      layer: s.layer,
      ...(s.level !== undefined ? { level: s.level } : {}),
    });
    return {
      width: w,
      height: h,
      focus,
      faces: faces.map((f) => f.box),
      background: bg,
      strokes: faceFirst.concat(orderedContours, orderedDetails, orderedShading).map(round),
    };
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('inkline: could not decode image'));
      img.src = src;
    });
  }

  /** Shape Detection API where available (Chrome on macOS / Windows / Android); silent no-op elsewhere. */
  async function detectFaces(img, scale) {
    try {
      if (typeof FaceDetector === 'undefined') return [];
      const found = await new FaceDetector({ fastMode: false, maxDetectedFaces: 4 }).detect(img);
      return found.map((f) => ({
        box: [f.boundingBox.x * scale, f.boundingBox.y * scale, f.boundingBox.width * scale, f.boundingBox.height * scale],
        eyes: (f.landmarks || [])
          .filter((l) => l.type === 'eye' && l.locations.length)
          .map((l) => [
            (l.locations.reduce((a, q) => a + q.x, 0) / l.locations.length) * scale,
            (l.locations.reduce((a, q) => a + q.y, 0) / l.locations.length) * scale,
          ]),
      }));
    } catch (e) {
      return [];
    }
  }

  /**
   * Browser entry: any image URL / data URL -> inkline project.
   * The colour layer travels with the project so a render can reveal it.
   */
  async function traceImage(src, options) {
    const o = Object.assign({}, DEFAULTS, options || {});
    const img = await loadImage(src);
    const scale = Math.min(1, o.maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(16, Math.round(img.naturalWidth * scale));
    const h = Math.max(16, Math.round(img.naturalHeight * scale));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    if (o.faces === undefined) o.faces = await detectFaces(img, scale);
    const traced = traceRaster(data, w, h, o);

    // subject matte (white = subject), soft-edged, used to keep tone and colour off the background
    let matte = null;
    const bgArr = traced.background;
    let any = 0;
    for (let i = 0; i < bgArr.length; i++) any |= bgArr[i];
    if (any) {
      // closing: grow the subject over small background pockets, then soften the edge
      const grown = blur(Float32Array.from(bgArr, (v) => 1 - v), w, h, 10 * Math.min(w, h) / 900 + 2);
      for (let i = 0; i < grown.length; i++) grown[i] = grown[i] > 0.5 ? 1 : 0;
      const soft = blur(grown, w, h, 5);
      const mc = document.createElement('canvas');
      mc.width = w;
      mc.height = h;
      const mctx = mc.getContext('2d');
      const md = mctx.createImageData(w, h);
      for (let i = 0; i < soft.length; i++) {
        const v = Math.round(Math.min(1, Math.max(0, (soft[i] - 0.1) / 0.8)) * 255);
        md.data[i * 4] = md.data[i * 4 + 1] = md.data[i * 4 + 2] = v;
        md.data[i * 4 + 3] = 255;
      }
      mctx.putImageData(md, 0, 0);
      matte = mc.toDataURL('image/png');
    }
    delete traced.background;

    const cs = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const cc = document.createElement('canvas');
    cc.width = Math.round(img.naturalWidth * cs);
    cc.height = Math.round(img.naturalHeight * cs);
    const cctx = cc.getContext('2d');
    cctx.fillStyle = '#fff';
    cctx.fillRect(0, 0, cc.width, cc.height);
    cctx.drawImage(img, 0, 0, cc.width, cc.height);

    return {
      inkline: 1,
      kind: 'image',
      width: traced.width,
      height: traced.height,
      focus: traced.focus,
      faces: traced.faces,
      strokes: traced.strokes,
      color: cc.toDataURL('image/jpeg', 0.9),
      matte,
      trace: { detail: o.detail, hatch: o.hatch, hatchDensity: o.hatchDensity, levels: o.levels },
    };
  }

  /* -------------------------------------------------------------- SVG API */

  const SKIP_PARENTS = new Set(['defs', 'clippath', 'mask', 'symbol', 'marker', 'pattern', 'lineargradient', 'radialgradient', 'filter']);
  const LAYERS = { contour: 0, outline: 0, detail: 1, details: 1, shade: 2, shading: 2, hatch: 2 };

  function parseColor(c) {
    if (!c || c === 'none' || c === 'transparent') return null;
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return c;
    const parts = m[1].split(',').map((v) => parseFloat(v));
    if (parts.length > 3 && parts[3] === 0) return null;
    return '#' + parts.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  }

  function isInk(hex) {
    // black and near-black strokes mean "use the style's ink"
    if (!hex || hex[0] !== '#') return true;
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return Math.max(r, g, b) < 70;
  }

  /**
   * Browser entry: SVG source -> inkline project. Document order is drawing order.
   * data-ink="none" skips an element's lines, data-ink-layer picks contour|detail|shade,
   * fills become the colour layer revealed after the line work.
   */
  async function traceSVG(svgText, options) {
    const o = Object.assign({ step: 2 }, options || {});
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    const src = doc.documentElement;
    if (!src || src.nodeName.toLowerCase() !== 'svg') throw new Error('inkline: not an SVG document');
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:0;top:0;opacity:0;pointer-events:none;z-index:-1';
    const svg = document.importNode(src, true);
    host.appendChild(svg);
    document.body.appendChild(host);
    try {
      const vb = svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.width ? svg.viewBox.baseVal : null;
      const width = vb ? vb.width : parseFloat(svg.getAttribute('width')) || 1000;
      const height = vb ? vb.height : parseFloat(svg.getAttribute('height')) || 1000;
      const ox = vb ? vb.x : 0;
      const oy = vb ? vb.y : 0;
      svg.setAttribute('width', width);
      svg.setAttribute('height', height);
      const rootInv = svg.getScreenCTM().inverse();
      const strokes = [];
      let hasFill = false;
      const all = svg.querySelectorAll('path,line,polyline,polygon,circle,ellipse,rect');
      for (const el of all) {
        let skip = false;
        let layer = null;
        let ink = null;
        for (let n = el; n && n !== svg; n = n.parentNode) {
          const name = n.nodeName.toLowerCase();
          if (SKIP_PARENTS.has(name)) skip = true;
          if (layer === null && n.getAttribute && n.getAttribute('data-ink-layer')) layer = n.getAttribute('data-ink-layer');
          if (ink === null && n.getAttribute && n.getAttribute('data-ink')) ink = n.getAttribute('data-ink');
        }
        if (skip) continue;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const fill = parseColor(cs.fill);
        const stroke = parseColor(cs.stroke);
        if (fill && cs.fillOpacity !== '0') hasFill = true;
        if (ink === 'none' || ink === 'fill-only') continue;
        if (!stroke && ink !== 'outline' && !(fill && !stroke && o.outlineFills !== false)) continue;
        const total = el.getTotalLength();
        if (!(total > 0.5)) continue;
        const m = rootInv.multiply(el.getScreenCTM());
        const scale = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;
        const n = Math.max(2, Math.ceil((total * scale) / o.step));
        let cur = [];
        let px = null, py = null;
        const flush = () => {
          if (cur.length >= 4) {
            const s = { p: cur, layer: LAYERS[layer] !== undefined ? LAYERS[layer] : 0 };
            const sw = stroke ? parseFloat(cs.strokeWidth) * scale : 0;
            if (sw) s.w = Math.round(sw * 100) / 100;
            if (stroke && !isInk(stroke)) s.c = stroke;
            strokes.push(s);
          }
          cur = [];
        };
        for (let i = 0; i < n; i++) {
          const pt = el.getPointAtLength((total * i) / (n - 1));
          const x = m.a * pt.x + m.c * pt.y + m.e - ox;
          const y = m.b * pt.x + m.d * pt.y + m.f - oy;
          if (px !== null && Math.hypot(x - px, y - py) > o.step * 3) flush();
          cur.push(Math.round(x * 10) / 10, Math.round(y * 10) / 10);
          px = x;
          py = y;
        }
        flush();
      }

      let color = null;
      if (hasFill && o.color !== false) {
        // colour layer: the same artwork with every stroke removed
        const clone = src.cloneNode(true);
        const style = doc.createElementNS('http://www.w3.org/2000/svg', 'style');
        style.textContent = '*{stroke:none!important}';
        clone.insertBefore(style, clone.firstChild);
        clone.setAttribute('width', width * 2);
        clone.setAttribute('height', height * 2);
        const blob = new XMLSerializer().serializeToString(clone);
        const img = await loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(blob));
        const c = document.createElement('canvas');
        c.width = Math.round(width * 2);
        c.height = Math.round(height * 2);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        color = c.toDataURL('image/png');
      }
      return {
        inkline: 1,
        kind: 'svg',
        width,
        height,
        focus: [width / 2, height / 2],
        strokes,
        color,
      };
    } finally {
      host.remove();
    }
  }

  Inkline.trace = { traceRaster, traceImage, traceSVG, rng, blur };
})(typeof window !== 'undefined' ? window : globalThis);
