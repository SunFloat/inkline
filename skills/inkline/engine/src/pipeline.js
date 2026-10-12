'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launch, openComposition } = require('./browser');
const ffmpeg = require('./ffmpeg');
const audio = require('./audio');

const FORMATS = {
  '9:16': [1080, 1920],
  '1:1': [1080, 1080],
  '16:9': [1920, 1080],
  '4:5': [1080, 1350],
  '3:4': [1080, 1440],
  '4:3': [1440, 1080],
};
const IMAGE_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.avif': 'image/avif' };
const QUALITY = {
  draft: { scale: 2 / 3, crf: 24, fps: 24 },
  standard: { scale: 1, crf: 20 },
  high: { scale: 1, crf: 16 },
};

function parseSize(format, size, quality) {
  let w, h;
  if (size) {
    const m = String(size).match(/^(\d+)x(\d+)$/i);
    if (!m) throw new Error(`--size must look like 1080x1920, got "${size}"`);
    w = +m[1];
    h = +m[2];
  } else {
    const f = FORMATS[format || '9:16'];
    if (!f) throw new Error(`Unknown --format "${format}". Use one of ${Object.keys(FORMATS).join(', ')} or --size WxH.`);
    [w, h] = f;
  }
  const q = QUALITY[quality || 'standard'] || QUALITY.standard;
  const even = (v) => Math.max(2, Math.round((v * q.scale) / 2) * 2);
  return [even(w), even(h)];
}

function makeLogger(quiet) {
  const tty = process.stderr.isTTY;
  let lastPct = -1;
  return {
    info: (m) => !quiet && process.stderr.write(`inkline · ${m}\n`),
    progress: (label, done, total) => {
      if (quiet) return;
      const pct = Math.floor((done / total) * 100);
      if (pct === lastPct) return;
      lastPct = pct;
      if (tty) process.stderr.write(`\rinkline · ${label} ${String(pct).padStart(3)}%${done === total ? '\n' : ''}`);
      else if (pct % 10 === 0) process.stderr.write(`inkline · ${label} ${pct}%\n`);
    },
  };
}

async function readInput(input) {
  if (/^https?:\/\//i.test(input)) {
    const res = await fetch(input);
    if (!res.ok) throw new Error(`Could not download ${input}: HTTP ${res.status}`);
    const type = (res.headers.get('content-type') || '').split(';')[0];
    const buf = Buffer.from(await res.arrayBuffer());
    if (type.includes('svg') || input.toLowerCase().endsWith('.svg')) return { kind: 'svg', text: buf.toString('utf8') };
    return { kind: 'image', src: `data:${type || 'image/png'};base64,${buf.toString('base64')}` };
  }
  const file = path.resolve(input);
  if (!fs.existsSync(file)) throw new Error(`Input not found: ${input}`);
  const ext = path.extname(file).toLowerCase();
  if (ext === '.json') return { kind: 'project', project: JSON.parse(fs.readFileSync(file, 'utf8')) };
  if (ext === '.svg') return { kind: 'svg', text: fs.readFileSync(file, 'utf8') };
  if (ext === '.heic' || ext === '.heif') throw new Error('HEIC photos are not supported by Chrome. Convert to JPG first (macOS: `sips -s format jpeg in.heic --out in.jpg`).');
  const mime = IMAGE_EXT[ext];
  if (!mime) throw new Error(`Unsupported input type "${ext}". Use an image (png/jpg/webp/gif/avif), an .svg, or an inkline .json project.`);
  return { kind: 'image', src: `data:${mime};base64,${fs.readFileSync(file).toString('base64')}` };
}

async function traceOnPage(page, input, traceOpts) {
  const src = await readInput(input);
  if (src.kind === 'project') return src.project;
  const project = await page.evaluate((i) => window.__inkline.trace(i), { ...src, options: traceOpts });
  if (!project || !project.strokes || !project.strokes.length) throw new Error('Nothing to draw: the trace found no lines. Try a higher --detail or a higher-contrast image.');
  return project;
}

function rendererOptions(style, o, width, height, fps) {
  return {
    width,
    height,
    fps,
    duration: o.duration === 'auto' ? 'auto' : Number(o.duration || 20),
    seed: Number(o.seed || 7),
    pen: o.pen !== false,
    margin: o.margin != null ? Number(o.margin) : 0.08,
    colorReveal: style.color && style.color.reveal !== 'none',
  };
}

function frameTimes(info) {
  const out = [];
  for (let i = 0; i < info.frames; i++) out.push(i / info.fps);
  return out;
}

function decode(dataUrl) {
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
}

/** Full pipeline: input -> traced project -> frames -> mp4 (+ sound, poster, gif). */
async function render(input, style, o = {}) {
  const log = makeLogger(o.quiet);
  const q = QUALITY[o.quality || 'standard'] || QUALITY.standard;
  const [width, height] = parseSize(o.format, o.size, o.quality);
  const fps = Number(o.fps || q.fps || 30);
  const out = path.resolve(o.out || defaultOut(input, style.name, o.webm ? '.webm' : '.mp4'));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'inkline-'));
  const started = Date.now();
  const { browser, executablePath } = await launch(log.info);
  try {
    log.info(`browser: ${path.basename(executablePath)}`);
    const first = await openComposition(browser, width, height);
    const project = await traceOnPage(first, input, style.trace);
    log.info(`traced ${project.strokes.length} strokes (${project.kind})`);
    if (o.saveProject) {
      const pfile = out.replace(/\.(mp4|webm)$/i, '') + '.inkline.json';
      fs.writeFileSync(pfile, JSON.stringify(project));
      log.info(`project saved: ${pfile}`);
    }
    const ropts = rendererOptions(style, o, width, height, fps);
    const info = await first.evaluate((p, s, r) => window.__inkline.load(p, s, r), project, style, ropts);
    log.info(`${info.frames} frames · ${width}×${height} · ${fps} fps · ${info.duration.toFixed(1)} s · style ${style.name}`);

    const times = frameTimes(info);
    const workers = Math.max(1, Math.min(Number(o.workers) || Math.min(4, Math.max(1, Math.floor(os.cpus().length / 2))), Math.ceil(times.length / 30)));
    const per = Math.ceil(times.length / workers);
    let done = 0;
    const codec = o.webm ? 'webm' : 'h264';
    const segExt = o.webm ? '.webm' : '.mp4';
    const crf = Number(o.crf || q.crf);
    const segments = [];
    await Promise.all(
      Array.from({ length: workers }, async (_, w) => {
        const slice = times.slice(w * per, (w + 1) * per);
        if (!slice.length) return;
        const page = w === 0 ? first : await openComposition(browser, width, height);
        if (w !== 0) await page.evaluate((p, s, r) => window.__inkline.load(p, s, r), project, style, ropts);
        const seg = path.join(work, `seg-${String(w).padStart(2, '0')}${segExt}`);
        segments[w] = seg;
        const enc = ffmpeg.openEncoder(seg, { fps, codec, crf, imageCodec: 'png' });
        for (const t of slice) {
          const url = await page.evaluate((tt) => window.__inkline.frame(tt, 'image/png'), t);
          await enc.write(decode(url));
          done++;
          log.progress('rendering', done, times.length);
        }
        await enc.close();
        if (page.inklineErrors.length) throw new Error('Renderer error: ' + page.inklineErrors[0]);
      })
    );

    const silent = path.join(work, 'video' + segExt);
    const list = path.join(work, 'list.txt');
    fs.writeFileSync(list, segments.filter(Boolean).map((s) => `file '${s.replace(/'/g, "'\\''")}'`).join('\n'));
    await ffmpeg.run(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', silent]);

    const soundKind = style.sound && style.sound.kind;
    if (o.sound !== false && soundKind && soundKind !== 'none') {
      const track = await first.evaluate((r) => window.__inkline.penTrack(r), 200);
      const wav = path.join(work, 'sound.wav');
      audio.writeWav(wav, audio.synthesize(track, { kind: soundKind, volume: (style.sound.volume || 0.8) * (o.volume != null ? Number(o.volume) : 1), duration: info.duration, seed: ropts.seed }));
      const acodec = o.webm ? ['-c:a', 'libopus', '-b:a', '128k'] : ['-c:a', 'aac', '-b:a', '192k'];
      await ffmpeg.run(['-i', silent, '-i', wav, '-c:v', 'copy', ...acodec, '-shortest', ...(o.webm ? [] : ['-movflags', '+faststart']), out]);
    } else {
      await ffmpeg.run(['-i', silent, '-c', 'copy', ...(o.webm ? [] : ['-movflags', '+faststart']), out]);
    }

    const result = { output: out, width, height, fps, duration: Number(info.duration.toFixed(2)), frames: info.frames, strokes: info.strokes, style: style.name };
    if (o.poster !== false) {
      const poster = out.replace(/\.(mp4|webm)$/i, '') + '.poster.png';
      fs.writeFileSync(poster, decode(await first.evaluate((t) => window.__inkline.frame(t, 'image/png'), info.duration)));
      result.poster = poster;
    }
    if (o.gif) {
      const gif = out.replace(/\.(mp4|webm)$/i, '') + '.gif';
      const gw = Math.min(540, width);
      await ffmpeg.run(['-i', out, '-vf', `fps=15,scale=${gw}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`, gif]);
      result.gif = gif;
    }
    result.seconds = Number(((Date.now() - started) / 1000).toFixed(1));
    return result;
  } finally {
    await browser.close().catch(() => {});
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/** Final frames of several styles side by side: the quickest way to choose a look. */
async function sheet(input, styles, o = {}) {
  const log = makeLogger(o.quiet);
  const [width, height] = parseSize(o.format || '4:5', o.size || null, 'draft');
  const out = path.resolve(o.out || defaultOut(input, 'styles', '.png'));
  const { browser } = await launch(log.info);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'inkline-sheet-'));
  try {
    const page = await openComposition(browser, width, height);
    const files = [];
    let traced = null;
    let traceKey = null;
    for (const style of styles) {
      const key = JSON.stringify(style.trace || {});
      if (!traced || key !== traceKey) {
        traced = await traceOnPage(page, input, style.trace);
        traceKey = key;
      }
      const ropts = rendererOptions(style, Object.assign({}, o, { duration: 12 }), width, height, 24);
      const info = await page.evaluate((p, s, r) => window.__inkline.load(p, s, r), traced, style, Object.assign(ropts, { pen: false }));
      const f = path.join(work, `${files.length}.png`);
      fs.writeFileSync(f, decode(await page.evaluate((t) => window.__inkline.frame(t, 'image/png'), info.duration)));
      files.push(f);
      log.info(`styled: ${style.name}`);
    }
    const cols = Math.min(files.length, Number(o.columns) || (files.length <= 4 ? files.length : Math.ceil(Math.sqrt(files.length))));
    const rows = Math.ceil(files.length / cols);
    const tw = Math.round(width / 2) * 2 > 720 ? 540 : Math.round(width / 2);
    const th = Math.round((tw * height) / width / 2) * 2;
    const inputs = files.flatMap((f) => ['-i', f]);
    const parts = files.map((_, i) => `[${i}:v]scale=${tw}:${th}[v${i}]`);
    const layout = files.map((_, i) => `${(i % cols) * tw}_${Math.floor(i / cols) * th}`).join('|');
    const filter = files.length === 1 ? `${parts[0]};[v0]copy[out]` : `${parts.join(';')};${files.map((_, i) => `[v${i}]`).join('')}xstack=inputs=${files.length}:layout=${layout}:fill=white[out]`;
    await ffmpeg.run([...inputs, '-filter_complex', filter, '-map', '[out]', '-frames:v', '1', out]);
    return { output: out, styles: styles.map((s) => s.name), columns: cols, rows };
  } finally {
    await browser.close().catch(() => {});
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/** Single still: the finished drawing, or any moment of it. */
async function still(input, style, o = {}) {
  const log = makeLogger(o.quiet);
  const [width, height] = parseSize(o.format, o.size, o.quality);
  const out = path.resolve(o.out || defaultOut(input, style.name, '.png'));
  const { browser } = await launch(log.info);
  try {
    const page = await openComposition(browser, width, height);
    const project = await traceOnPage(page, input, style.trace);
    const ropts = rendererOptions(style, o, width, height, 30);
    const info = await page.evaluate((p, s, r) => window.__inkline.load(p, s, r), project, style, ropts);
    const t = o.at === undefined || o.at === 'end' ? info.duration : Math.min(info.duration, Number(o.at));
    fs.writeFileSync(out, decode(await page.evaluate((tt) => window.__inkline.frame(tt, 'image/png'), t)));
    return { output: out, at: t, strokes: info.strokes, style: style.name };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function trace(input, style, o = {}) {
  const log = makeLogger(o.quiet);
  const out = path.resolve(o.out || defaultOut(input, 'trace', '.inkline.json'));
  const { browser } = await launch(log.info);
  try {
    const page = await openComposition(browser, 800, 800);
    const project = await traceOnPage(page, input, style.trace);
    fs.writeFileSync(out, JSON.stringify(project));
    const layers = [0, 0, 0];
    for (const s of project.strokes) layers[s.layer || 0]++;
    return { output: out, strokes: project.strokes.length, contour: layers[0], detail: layers[1], shade: layers[2], width: project.width, height: project.height, color: !!project.color };
  } finally {
    await browser.close().catch(() => {});
  }
}

function defaultOut(input, suffix, ext) {
  const base = /^https?:/i.test(input) ? 'inkline' : path.basename(input).replace(/\.(inkline\.json|json|svg|png|jpe?g|webp|gif|bmp|avif)$/i, '');
  return path.join(process.cwd(), 'inkline-out', `${base}-${suffix}${ext}`);
}

module.exports = { render, sheet, still, trace, readInput, traceOnPage, parseSize, rendererOptions, FORMATS };
