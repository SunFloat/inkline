'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const PRESET_DIR = path.join(__dirname, '..', 'styles');
const PROJECT_DIR = () => path.join(process.cwd(), '.inkline', 'styles');
const GLOBAL_DIR = path.join(os.homedir(), '.inkline', 'styles');

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
function merge(base, over) {
  const out = Object.assign({}, base);
  if (!isObj(over)) return out;
  for (const k of Object.keys(over)) {
    if (over[k] === undefined) continue;
    out[k] = isObj(base && base[k]) && isObj(over[k]) ? merge(base[k], over[k]) : over[k];
  }
  return out;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`Style file ${file} is not valid JSON: ${e.message}`);
  }
}

function listDir(dir, source) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const file = path.join(dir, f);
      const data = readJson(file);
      return { name: data.name || path.basename(f, '.json'), label: data.label, medium: data.medium, extends: data.extends, source, file };
    });
}

/** Project styles shadow global styles, which shadow presets. */
function listStyles() {
  const seen = new Map();
  for (const s of [...listDir(PROJECT_DIR(), 'project'), ...listDir(GLOBAL_DIR, 'global'), ...listDir(PRESET_DIR, 'preset')]) {
    if (!seen.has(s.name)) seen.set(s.name, s);
  }
  return [...seen.values()];
}

function findStyle(name) {
  if (name.endsWith('.json') && fs.existsSync(name)) return path.resolve(name);
  const hit = listStyles().find((s) => s.name === name);
  if (!hit) {
    const names = listStyles().map((s) => s.name).join(', ');
    throw new Error(`Unknown style "${name}". Available: ${names}`);
  }
  return hit.file;
}

function resolveStyle(name, depth = 0) {
  if (depth > 8) throw new Error('Style "extends" chain is too deep (cycle?)');
  const data = readJson(findStyle(name || 'graphite'));
  delete data.$schema;
  if (data.extends) {
    const parent = resolveStyle(data.extends, depth + 1);
    return merge(parent, Object.assign({}, data, { extends: undefined }));
  }
  return data;
}

/** CLI flags that tweak a style without writing a file. */
function applyOverrides(style, o) {
  const s = merge(style, {});
  const set = (pathStr, value) => {
    if (value === undefined || value === null || Number.isNaN(value)) return;
    const keys = pathStr.split('.');
    let cur = s;
    for (const k of keys.slice(0, -1)) cur = cur[k] = isObj(cur[k]) ? Object.assign({}, cur[k]) : {};
    cur[keys[keys.length - 1]] = value;
  };
  set('ink.color', o.ink);
  set('paper.color', o.paper);
  set('paper.texture', o.texture);
  if (o.line != null) set('ink.width', (s.ink && s.ink.width ? s.ink.width : 2) * Number(o.line));
  set('trace.detail', o.detail != null ? Number(o.detail) : undefined);
  set('trace.hatch', o.hatch);
  set('trace.hatchDensity', o.density != null ? Number(o.density) : undefined);
  set('pen.tool', o.tool);
  set('ink.glow', o.glow != null ? Number(o.glow) : undefined);
  if (o.camera) set('camera.mode', o.camera);
  if (o.zoom != null) set('camera.zoom', Number(o.zoom));
  if (o.color === false) set('color.reveal', 'none');
  if (o.reveal) set('color.reveal', o.reveal);
  if (o.sound === false) set('sound.kind', 'none');
  if (o.soundKind) set('sound.kind', o.soundKind);
  return s;
}

function saveStyle(name, data, { global } = {}) {
  if (!/^[a-z0-9][a-z0-9-_]{0,40}$/i.test(name)) throw new Error('Style names use letters, digits, - and _ (max 41 chars).');
  const dir = global ? GLOBAL_DIR : PROJECT_DIR();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name + '.json');
  fs.writeFileSync(file, JSON.stringify(Object.assign({ name }, data), null, 2) + '\n');
  return file;
}

module.exports = { listStyles, resolveStyle, applyOverrides, saveStyle, merge, PRESET_DIR, GLOBAL_DIR, PROJECT_DIR };
