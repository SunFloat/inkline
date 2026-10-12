'use strict';
const { spawn, spawnSync } = require('child_process');

function resolveFfmpeg() {
  if (process.env.INKLINE_FFMPEG) return process.env.INKLINE_FFMPEG;
  try {
    const p = require('ffmpeg-static');
    if (p) return p;
  } catch {}
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['ffmpeg'], { encoding: 'utf8' });
  if (probe.status === 0) return probe.stdout.split(/\r?\n/)[0].trim();
  throw new Error('ffmpeg not found. Run `inkline doctor` or set INKLINE_FFMPEG.');
}

function run(args, { input } = {}) {
  const bin = resolveFfmpeg();
  return new Promise((resolve, reject) => {
    const p = spawn(bin, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: [input ? 'pipe' : 'ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error('ffmpeg failed: ' + err.trim()))));
    if (input) input(p.stdin);
  });
}

/** Opens an encoder that accepts PNG/JPEG frames on stdin. */
function openEncoder(out, { fps, codec = 'h264', crf = 17, imageCodec = 'png' }) {
  const bin = resolveFfmpeg();
  const vcodec =
    codec === 'webm'
      ? ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', String(crf + 14), '-row-mt', '1', '-pix_fmt', 'yuv420p']
      : ['-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-g', String(fps * 2)];
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', imageCodec === 'jpeg' ? 'mjpeg' : 'png', '-i', '-', ...vcodec, '-r', String(fps), out];
  const p = spawn(bin, args, { stdio: ['pipe', 'ignore', 'pipe'] });
  let err = '';
  let failed = null;
  p.stderr.on('data', (d) => (err += d));
  p.stdin.on('error', (e) => (failed = e));
  const done = new Promise((resolve, reject) => {
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error('ffmpeg encode failed: ' + err.trim()))));
  });
  return {
    write(buf) {
      if (failed) return Promise.reject(new Error('ffmpeg stopped accepting frames: ' + (err.trim() || failed.message)));
      return new Promise((resolve) => {
        if (!p.stdin.write(buf)) p.stdin.once('drain', resolve);
        else resolve();
      });
    },
    async close() {
      p.stdin.end();
      await done;
    },
  };
}

module.exports = { resolveFfmpeg, run, openEncoder };
