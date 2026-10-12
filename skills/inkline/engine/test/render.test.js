'use strict';
// End-to-end: needs Chrome. Skipped automatically when no browser can be launched.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { findSystemChrome } = require('../src/browser');
const { still, render } = require('../src/pipeline');
const { resolveStyle } = require('../src/styles');

const FOX = path.join(__dirname, '..', '..', '..', '..', 'examples', 'fox.svg');
const skip = !findSystemChrome() && !process.env.INKLINE_E2E;

test('SVG renders a finished frame', { skip, timeout: 120000 }, async () => {
  const out = path.join(os.tmpdir(), `inkline-test-${process.pid}.png`);
  const r = await still(FOX, resolveStyle('whiteboard'), { out, quiet: true, format: '1:1', quality: 'draft' });
  assert.ok(r.strokes > 20);
  assert.ok(fs.statSync(out).size > 10000);
  fs.rmSync(out, { force: true });
});

test('a short video encodes with sound', { skip, timeout: 240000 }, async () => {
  const out = path.join(os.tmpdir(), `inkline-test-${process.pid}.mp4`);
  const r = await render(FOX, resolveStyle('fineliner'), { out, quiet: true, format: '1:1', quality: 'draft', duration: 4, workers: 2, poster: false });
  assert.strictEqual(r.frames, 96);
  assert.ok(fs.statSync(out).size > 20000);
  fs.rmSync(out, { force: true });
});
