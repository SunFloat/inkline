#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { parseArgs } = require('util');

const VERSION = require('../package.json').version;

const HELP = `inkline ${VERSION} — turn a prompt, photo or SVG into a hand-drawn video

Usage
  inkline render  <input> [options]      draw it and write an .mp4 (input: image, .svg, .inkline.json, URL)
  inkline still   <input> [options]      one frame as .png (default: the finished drawing)
  inkline sheet   <input> --styles a,b,c compare styles side by side in one .png
  inkline preview <input> [options]      open an interactive player in your browser
  inkline trace   <input> [-o file]      save the stroke plan as .inkline.json for reuse
  inkline styles  [--json]               list presets and your own styles
  inkline style   <name> [--from base] [style flags] [--global]   save a custom style
  inkline doctor                         show what is installed (changes nothing)
  inkline setup [--with-chrome]          install the render engine (3 npm packages, ~80 MB);
                                         --with-chrome also downloads headless Chrome (~90 MB)

Output
  -o, --out <file>        output path (default ./inkline-out/<name>-<style>.mp4)
  -f, --format <ratio>    9:16 (default) | 1:1 | 4:5 | 16:9 | 3:4 | 4:3
      --size <WxH>        explicit pixel size, e.g. 2160x3840
  -d, --duration <sec>    total length incl. intro, colour reveal and hold (default 20, or "auto")
      --fps <n>           frames per second (default 30)
  -q, --quality <q>       draft | standard | high
      --gif               also write a lightweight .gif preview
      --webm              write .webm (VP9) instead of .mp4
      --no-poster         skip the .poster.png
      --workers <n>       parallel render pages (default: half your cores, max 4)

Look
  -s, --style <name>      graphite | fineliner | charcoal | whiteboard | chalkboard | blueprint |
                          sanguine | neon | gold | ballpoint | watercolor | <your style> | path.json
      --ink <#hex>        line colour            --paper <#hex>     ground colour
      --texture <t>       paper | whiteboard | chalkboard | blueprint | notebook | black | aged | kraft | none
      --line <x>          line weight multiplier (e.g. 1.4)
      --detail <0-1>      how much fine detail to trace (default from style)
      --hatch <mode>      none | hatch | crosshatch | zigzag | scribble
      --density <0-1>     shading density
      --tool <t>          pencil | fineliner | ballpoint | marker | chalk | brush | glow | none
      --no-pen            hide the drawing tool
      --no-color          skip the colour reveal at the end
      --reveal <r>        wash | fade | none
      --camera <c>        follow | push | none
      --zoom <x>          follow-camera zoom (default 1.32)
      --no-sound          silent video
      --sound <kind>      pencil | pen | marker | chalk
      --seed <n>          variation seed (same seed = same video)

Other
      --save-project      keep the traced strokes next to the video
      --json              machine-readable result on stdout
      --quiet             no progress output
`;

const OPTIONS = {
  out: { type: 'string', short: 'o' },
  format: { type: 'string', short: 'f' },
  size: { type: 'string' },
  duration: { type: 'string', short: 'd' },
  fps: { type: 'string' },
  quality: { type: 'string', short: 'q' },
  gif: { type: 'boolean' },
  webm: { type: 'boolean' },
  'no-poster': { type: 'boolean' },
  workers: { type: 'string' },
  style: { type: 'string', short: 's' },
  styles: { type: 'string' },
  ink: { type: 'string' },
  paper: { type: 'string' },
  texture: { type: 'string' },
  line: { type: 'string' },
  detail: { type: 'string' },
  hatch: { type: 'string' },
  density: { type: 'string' },
  tool: { type: 'string' },
  'no-pen': { type: 'boolean' },
  'no-color': { type: 'boolean' },
  reveal: { type: 'string' },
  camera: { type: 'string' },
  zoom: { type: 'string' },
  'no-sound': { type: 'boolean' },
  sound: { type: 'string' },
  volume: { type: 'string' },
  seed: { type: 'string' },
  at: { type: 'string' },
  columns: { type: 'string' },
  from: { type: 'string' },
  label: { type: 'string' },
  medium: { type: 'string' },
  glow: { type: 'string' },
  global: { type: 'boolean' },
  'with-chrome': { type: 'boolean' },
  'save-project': { type: 'boolean' },
  'no-open': { type: 'boolean' },
  json: { type: 'boolean' },
  quiet: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
};

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function fail(msg) {
  process.stderr.write(`inkline · error: ${msg}\n`);
  process.exit(1);
}

function validate(v) {
  for (const k of ['ink', 'paper']) if (v[k] && !HEX.test(v[k])) fail(`--${k} expects a hex colour like #1f4fd8, got "${v[k]}"`);
  for (const k of ['detail', 'density']) if (v[k] != null && !(Number(v[k]) >= 0 && Number(v[k]) <= 1)) fail(`--${k} expects a number between 0 and 1`);
  if (v.duration && v.duration !== 'auto' && !(Number(v.duration) >= 3 && Number(v.duration) <= 600)) fail('--duration expects seconds between 3 and 600, or "auto"');
  if (v.fps && !(Number(v.fps) >= 6 && Number(v.fps) <= 120)) fail('--fps expects 6–120');
  const enums = {
    hatch: ['none', 'hatch', 'crosshatch', 'zigzag', 'scribble'],
    tool: ['pencil', 'fineliner', 'ballpoint', 'marker', 'chalk', 'brush', 'glow', 'none'],
    camera: ['follow', 'push', 'none'],
    reveal: ['wash', 'fade', 'none'],
    sound: ['pencil', 'pen', 'marker', 'chalk', 'none'],
    quality: ['draft', 'standard', 'high'],
    texture: ['paper', 'whiteboard', 'chalkboard', 'blueprint', 'notebook', 'black', 'aged', 'kraft', 'none'],
  };
  for (const [k, list] of Object.entries(enums)) if (v[k] && !list.includes(v[k])) fail(`--${k} must be one of: ${list.join(', ')}`);
}

function overridesFrom(v) {
  return {
    ink: v.ink,
    paper: v.paper,
    texture: v.texture,
    line: v.line,
    detail: v.detail,
    hatch: v.hatch,
    density: v.density,
    tool: v['no-pen'] ? undefined : v.tool,
    glow: v.glow,
    camera: v.camera,
    zoom: v.zoom,
    color: v['no-color'] ? false : undefined,
    reveal: v.reveal,
    sound: v['no-sound'] ? false : undefined,
    soundKind: v.sound,
  };
}

function print(result, asJson) {
  if (asJson) {
    process.stdout.write(JSON.stringify(result) + '\n');
    return;
  }
  for (const [k, val] of Object.entries(result)) process.stdout.write(`${k.padEnd(9)} ${Array.isArray(val) ? val.join(', ') : val}\n`);
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs({ options: OPTIONS, allowPositionals: true, strict: true });
  } catch (e) {
    fail(e.message.replace(/^.*?: /, '') + '\nRun `inkline --help` for all options.');
  }
  const v = parsed.values;
  const [cmd, ...rest] = parsed.positionals;
  if (v.version) return process.stdout.write(VERSION + '\n');
  if (v.help || !cmd || cmd === 'help') return process.stdout.write(HELP);
  validate(v);

  const styles = require('../src/styles');
  const resolve = (name) => styles.applyOverrides(styles.resolveStyle(name || 'graphite'), overridesFrom(v));
  const opts = {
    out: v.out,
    format: v.format,
    size: v.size,
    duration: v.duration,
    fps: v.fps,
    quality: v.quality,
    gif: v.gif,
    webm: v.webm,
    poster: !v['no-poster'],
    workers: v.workers,
    seed: v.seed,
    pen: !v['no-pen'] && v.tool !== 'none',
    sound: !v['no-sound'],
    volume: v.volume,
    saveProject: v['save-project'],
    quiet: v.quiet || v.json,
    at: v.at,
    columns: v.columns,
  };
  const needInput = () => {
    if (!rest[0]) fail(`\`inkline ${cmd}\` needs an input: an image, an .svg, an .inkline.json or a URL.`);
    return rest[0];
  };

  switch (cmd) {
    case 'render': {
      const { render } = require('../src/pipeline');
      return print(await render(needInput(), resolve(v.style), opts), v.json);
    }
    case 'still': {
      const { still } = require('../src/pipeline');
      return print(await still(needInput(), resolve(v.style), opts), v.json);
    }
    case 'sheet': {
      const { sheet } = require('../src/pipeline');
      const names = (v.styles || 'graphite,fineliner,charcoal,whiteboard,watercolor,neon').split(',').map((s) => s.trim()).filter(Boolean);
      return print(await sheet(needInput(), names.map(resolve), opts), v.json);
    }
    case 'trace': {
      const { trace } = require('../src/pipeline');
      return print(await trace(needInput(), resolve(v.style), opts), v.json);
    }
    case 'preview': {
      const { preview } = require('../src/preview');
      return print(await preview(needInput(), resolve(v.style), Object.assign(opts, { open: !v['no-open'], argv: process.argv.slice(2) })), v.json);
    }
    case 'styles': {
      const list = styles.listStyles();
      if (v.json) return process.stdout.write(JSON.stringify(list) + '\n');
      for (const s of list) process.stdout.write(`${s.name.padEnd(12)} ${(s.label || '').padEnd(14)} ${s.medium || (s.extends ? 'extends ' + s.extends : '')}${s.source === 'preset' ? '' : `  [${s.source}]`}\n`);
      return;
    }
    case 'style': {
      const name = rest[0];
      if (!name) fail('`inkline style <name>` needs a name for the new style.');
      const base = v.from || 'graphite';
      styles.resolveStyle(base); // validates the base exists
      const tweaked = styles.applyOverrides({}, overridesFrom(v));
      const data = Object.assign({ extends: base }, v.label ? { label: v.label } : {}, v.medium ? { medium: v.medium } : {}, tweaked);
      const file = styles.saveStyle(name, data, { global: v.global });
      return print({ saved: file, extends: base, use: `inkline render <input> --style ${name}` }, v.json);
    }
    case 'doctor': {
      const { doctor } = require('../src/doctor');
      return print(await doctor(), v.json);
    }
    case 'setup': {
      // the launcher has already run npm install; this step only fetches Chrome when asked to
      const { setup } = require('../src/doctor');
      return print(await setup({ withChrome: v['with-chrome'] }), v.json);
    }
    default:
      fail(`Unknown command "${cmd}". Run \`inkline --help\`.`);
  }
}

main().catch((e) => fail(e && e.message ? e.message : String(e)));
