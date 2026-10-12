'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const vm = require('vm');
const fs = require('fs');

const styles = require('../src/styles');
const audio = require('../src/audio');
const { parseSize } = require('../src/pipeline');

// trace.js is a classic browser script; its raster core needs no DOM.
const sandbox = { globalThis: {} };
sandbox.globalThis = sandbox;
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'core', 'trace.js'), 'utf8'), sandbox);
const { traceRaster } = sandbox.Inkline.trace;

function disc(w, h) {
  const rgba = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - w / 2, y - h / 2);
      const v = d < w * 0.3 ? 40 + d : 245;
      const i = (y * w + x) * 4;
      rgba[i] = rgba[i + 1] = rgba[i + 2] = v;
    }
  }
  return rgba;
}

test('every preset resolves and carries the keys the renderer needs', () => {
  const list = styles.listStyles().filter((s) => s.source === 'preset');
  assert.ok(list.length >= 11);
  for (const s of list) {
    const st = styles.resolveStyle(s.name);
    assert.ok(st.paper && st.ink && st.trace && st.pen, s.name);
    assert.match(st.ink.color, /^#[0-9a-f]{6}$/i, s.name);
  }
});

test('overrides change only what they name', () => {
  const base = styles.resolveStyle('graphite');
  const s = styles.applyOverrides(base, { ink: '#1f4fd8', line: '2', color: false });
  assert.strictEqual(s.ink.color, '#1f4fd8');
  assert.strictEqual(s.ink.width, base.ink.width * 2);
  assert.strictEqual(s.color.reveal, 'none');
  assert.strictEqual(s.paper.color, base.paper.color);
});

test('styles extend each other deeply', () => {
  const merged = styles.merge({ a: { b: 1, c: 2 } }, { a: { c: 3 } });
  assert.deepStrictEqual(merged, { a: { b: 1, c: 3 } });
});

test('formats map to even pixel sizes', () => {
  assert.deepStrictEqual(parseSize('9:16'), [1080, 1920]);
  assert.deepStrictEqual(parseSize('16:9'), [1920, 1080]);
  assert.deepStrictEqual(parseSize(null, '721x1281'), [722, 1282]);
  assert.deepStrictEqual(parseSize('9:16', null, 'draft'), [720, 1280]);
  assert.throws(() => parseSize('5:7'));
});

test('tracing finds the outline, shades the dark disc, and is deterministic', () => {
  const w = 240, h = 240;
  const a = traceRaster(disc(w, h), w, h, { seed: 3 });
  const b = traceRaster(disc(w, h), w, h, { seed: 3 });
  assert.ok(a.strokes.length > 20, `got ${a.strokes.length} strokes`);
  assert.ok(a.strokes.some((s) => s.layer === 0), 'has contour strokes');
  assert.ok(a.strokes.some((s) => s.layer === 2), 'has shading strokes');
  assert.deepStrictEqual(a.strokes.slice(0, 50), b.strokes.slice(0, 50));
  for (const s of a.strokes.slice(0, 200)) {
    for (let i = 0; i < s.p.length; i++) assert.ok(s.p[i] >= -2 && s.p[i] <= w + 2);
  }
});

test('hatch none yields no shading strokes', () => {
  const w = 200, h = 200;
  const r = traceRaster(disc(w, h), w, h, { hatch: 'none' });
  assert.ok(!r.strokes.some((s) => s.layer === 2));
});

test('drawing sound follows the pen and is deterministic', () => {
  const rate = 100;
  const n = 300;
  const track = { rate, down: Array.from({ length: n }, (_, i) => (i > 100 && i < 200 ? 1 : 0)), speed: Array(n).fill(900), layer: Array(n).fill(0) };
  const a = audio.synthesize(track, { duration: 3 });
  const b = audio.synthesize(track, { duration: 3 });
  assert.deepStrictEqual(a.samples.slice(40000, 45000), b.samples.slice(40000, 45000));
  const rms = (from, to) => Math.sqrt(a.samples.slice(from, to).reduce((s, v) => s + v * v, 0) / (to - from));
  assert.ok(rms(60000, 80000) > rms(10000, 30000) * 5, 'louder while drawing');
});
