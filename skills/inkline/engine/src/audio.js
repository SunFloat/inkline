'use strict';
const fs = require('fs');

/*
 * Procedural drawing sound. Filtered noise whose loudness follows pen speed,
 * a soft tap on every pen-down, and a hint of room. Deterministic per seed.
 */

const VOICES = {
  pencil: { bands: [[3200, 0.9, 1], [7200, 1.2, 0.45]], grit: 0.55, tap: 0.5, gain: 0.9 },
  pen: { bands: [[4600, 1.1, 1], [9000, 1.4, 0.3]], grit: 0.25, tap: 0.35, gain: 0.55 },
  marker: { bands: [[1700, 1.3, 1], [4200, 1.0, 0.5]], grit: 0.15, tap: 0.7, gain: 0.8, squeak: 0.05 },
  chalk: { bands: [[2400, 0.7, 1], [6000, 0.9, 0.6]], grit: 0.9, tap: 0.8, gain: 0.85, squeak: 0.025 },
};

function biquadBandpass(freq, q, sr) {
  const w = (2 * Math.PI * freq) / sr;
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  const b0 = alpha / a0, b2 = -alpha / a0, a1 = (-2 * Math.cos(w)) / a0, a2 = (1 - alpha) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x) => {
    const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  };
}

function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function synthesize(track, { kind = 'pencil', volume = 0.8, duration, sampleRate = 48000, seed = 7 } = {}) {
  const voice = VOICES[kind] || VOICES.pencil;
  const n = Math.ceil(duration * sampleRate);
  const out = new Float32Array(n);
  const rand = rng(seed * 31 + 5);
  const filters = voice.bands.map(([f, q]) => biquadBandpass(f, q, sampleRate));
  const env = { v: 0 };
  const attack = 1 - Math.exp(-1 / (0.004 * sampleRate));
  const release = 1 - Math.exp(-1 / (0.03 * sampleRate));
  let texture = 0;
  let tap = 0;
  let prevDown = 0;
  let squeakPhase = 0;
  for (let i = 0; i < n; i++) {
    const ti = Math.min(track.down.length - 1, Math.floor((i / sampleRate) * track.rate));
    const down = track.down[ti] || 0;
    const speed = track.speed[ti] || 0;
    if (down && !prevDown) tap = 1;
    prevDown = down;
    const target = down ? Math.pow(Math.min(1, speed / 1400), 0.55) * (track.layer[ti] === 2 ? 0.8 : 1) : 0;
    env.v += (target - env.v) * (target > env.v ? attack : release);
    texture += (rand() - texture) * 0.0008; // slow paper-tooth wander
    const white = rand() * 2 - 1;
    let s = 0;
    for (let b = 0; b < filters.length; b++) s += filters[b](white) * voice.bands[b][2];
    const gritty = rand() < voice.grit * 0.004 * env.v ? (rand() * 2 - 1) * 0.6 : 0;
    let sample = (s * (0.7 + texture * 0.6) + gritty) * env.v;
    if (voice.squeak && env.v > 0.6) {
      squeakPhase += (2 * Math.PI * (950 + 300 * texture)) / sampleRate;
      sample += Math.sin(squeakPhase) * voice.squeak * (env.v - 0.6);
    }
    if (tap > 0.001) {
      sample += (rand() * 2 - 1) * tap * voice.tap * 0.5;
      tap *= Math.exp(-1 / (0.0025 * sampleRate));
    }
    out[i] = sample * voice.gain * volume;
  }
  // a small room: two early reflections
  const d1 = Math.round(0.019 * sampleRate), d2 = Math.round(0.037 * sampleRate);
  for (let i = n - 1; i >= d2; i--) out[i] += out[i - d1] * 0.16 + out[i - d2] * 0.08;
  for (let i = 0; i < n; i++) out[i] = Math.tanh(out[i] * 1.6) * 0.8;
  // fade the edges
  const f = Math.min(n, Math.round(0.08 * sampleRate));
  for (let i = 0; i < f; i++) {
    out[i] *= i / f;
    out[n - 1 - i] *= i / f;
  }
  return { samples: out, sampleRate };
}

function writeWav(file, { samples, sampleRate }) {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  fs.writeFileSync(file, buf);
}

module.exports = { synthesize, writeWav, VOICES };
