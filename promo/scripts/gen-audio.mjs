// Synthesizes public/soundtrack.wav from src/cues.mjs. No samples and no downloads,
// so there is nothing to license, and every run gives the same file.
import { writeFileSync } from "node:fs";
import { CUES, FPS, INTRO, INTRO_CUES, TOTAL_FRAMES } from "../src/cues.mjs";

const RATE = 48000;
const AAC_DELAY = 2048; // AAC adds this much delay in the MP4, so the mix starts this much early.
const LENGTH = Math.ceil((TOTAL_FRAMES / FPS) * RATE);
const TARGET_LUFS = -16;
const CEILING_DB = -3;
const TAU = Math.PI * 2;

const L = new Float64Array(LENGTH);
const R = new Float64Array(LENGTH);

let seed = 310;
const noise = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2147483648 - 1;
};
const midi = (n) => 440 * 2 ** ((n - 69) / 12);

function add(start, seconds, pan, sample) {
  const from = Math.round(start * RATE) - AAC_DELAY;
  const count = Math.round(seconds * RATE);
  const gl = Math.cos(((pan + 1) * Math.PI) / 4);
  const gr = Math.sin(((pan + 1) * Math.PI) / 4);
  for (let i = 0; i < count; i++) {
    const at = from + i;
    if (at < 0 || at >= LENGTH) continue;
    const v = sample(i / RATE, i / count);
    L[at] += v * gl;
    R[at] += v * gr;
  }
}

// --- Bed: quiet pad, soft bass, and a sparse pluck at 100 BPM ---
const BEAT_S = 60 / 100;
const BAR_S = BEAT_S * 4;
const END_S = (INTRO + 492) / FPS;
const CHORDS = [
  [50, 57, 62, 65, 69], // Dm
  [46, 53, 58, 62, 65], // Bb
  [48, 55, 60, 64, 67], // C
  [45, 52, 57, 60, 64], // Am
];

function pad(start, seconds, notes, level) {
  notes.forEach((n, k) => {
    const hz = midi(n);
    const pan = (k / (notes.length - 1)) * 1.2 - 0.6;
    add(start, seconds, pan, (t, p) => {
      const env = Math.min(1, t / 0.5) * Math.min(1, (1 - p) * seconds / 0.7);
      return level * env * (Math.sin(TAU * hz * t) + 0.35 * Math.sin(TAU * hz * 2.003 * t + 1) + 0.12 * Math.sin(TAU * hz * 3.01 * t));
    });
  });
}

function pluck(start, n, level, pan) {
  const hz = midi(n);
  add(start, 0.7, pan, (t) => level * Math.exp(-t * 6) * (Math.sin(TAU * hz * t) + 0.4 * Math.sin(TAU * hz * 2 * t) * Math.exp(-t * 14)));
}

function bass(start, n, level) {
  const hz = midi(n - 12);
  add(start, BAR_S * 0.9, 0, (t, p) => level * Math.min(1, t / 0.02) * Math.min(1, (1 - p) * 8) * Math.sin(TAU * hz * t));
}

function kick(start, level) {
  add(start, 0.22, 0, (t) => level * Math.exp(-t * 20) * Math.sin(TAU * (48 * t + 6 * (1 - Math.exp(-t * 40)))));
}

const bars = Math.floor(END_S / BAR_S);
for (let b = 0; b < bars; b++) {
  const t = b * BAR_S;
  const chord = CHORDS[b % 4];
  pad(t, BAR_S + 0.4, chord, 0.012);
  if (b >= 2) bass(t, chord[0], 0.05);
  const steps = [0, 3, 6, 8, 11, 14];
  steps.forEach((s, i) => {
    if (b >= 2) pluck(t + (s * BEAT_S) / 4, chord[1 + (i % 4)] + 12, 0.022, i % 2 ? 0.35 : -0.35);
  });
  if (b >= 2) for (let k = 0; k < 4; k++) kick(t + k * BEAT_S, 0.05);
}
// The end card resolves on one long D chord.
pad(END_S, TOTAL_FRAMES / FPS - END_S + 0.2, [38, 50, 57, 62, 65, 69, 74], 0.016);

// --- Cues ---
const SOUNDS = {
  tap: (at) => add(at, 0.05, 0.1, (t) => 0.2 * Math.exp(-t * 110) * (noise() * 0.7 + Math.sin(TAU * 1900 * t))),
  click: (at) => add(at, 0.05, 0, (t) => 0.2 * Math.exp(-t * 150) * (noise() * 0.5 + Math.sin(TAU * 2600 * t))),
  shutter: (at) => {
    add(at, 0.05, 0, (t) => 0.34 * Math.exp(-t * 130) * noise());
    add(at + 0.055, 0.07, 0, (t) => 0.28 * Math.exp(-t * 90) * (noise() * 0.6 + Math.sin(TAU * 1300 * t)));
  },
  slide: (at) => add(at, 1.05, 0, (t, p) => 0.035 * Math.sin(Math.PI * p) * Math.sin(TAU * (300 * t + 160 * t * t))),
  pop: (at) => add(at, 0.12, 0.1, (t) => 0.2 * Math.exp(-t * 30) * Math.sin(TAU * (520 * t + 900 * t * t))),
  whoosh: (at) => {
    let low = 0;
    add(at, 0.42, 0, (t, p) => {
      low += (noise() - low) * (0.03 + 0.25 * p);
      return 0.42 * Math.sin(Math.PI * p) * low;
    });
  },
  // A soft, heavy stamp for each redaction landing.
  stamp: (at) => {
    add(at, 0.24, 0, (t) => 0.42 * Math.exp(-t * 20) * Math.sin(TAU * (68 * t + 3 * (1 - Math.exp(-t * 50)))));
    add(at, 0.05, 0, (t) => 0.14 * Math.exp(-t * 90) * noise());
  },
  drop: (at) => {
    add(at, 0.2, 0.2, (t) => 0.3 * Math.exp(-t * 22) * Math.sin(TAU * 140 * t));
    [69, 76].forEach((n, i) => add(at + 0.02 + i * 0.07, 0.6, 0.2, (t) => 0.1 * Math.exp(-t * 7) * Math.sin(TAU * midi(n) * t)));
  },
  chime: (at) => [74, 81].forEach((n, i) => add(at + i * 0.09, 0.8, -0.1, (t) => 0.1 * Math.exp(-t * 6) * Math.sin(TAU * midi(n) * t))),
  bloom: (at) => [62, 69, 74, 77].forEach((n, i) => add(at + i * 0.05, 1.8, i % 2 ? 0.25 : -0.25, (t) => 0.07 * Math.exp(-t * 2.4) * (Math.sin(TAU * midi(n) * t) + 0.3 * Math.sin(TAU * midi(n) * 2 * t)))),
};

for (const [name, frame] of INTRO_CUES) SOUNDS[name](frame / FPS);
for (const [name, frame] of CUES) SOUNDS[name]((INTRO + frame) / FPS);

// --- Measure and level (ITU-R BS.1770 K-weighting and gating) ---
function biquad(input, b0, b1, b2, a1, a2) {
  const out = new Float64Array(input.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x = input[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    out[i] = y;
  }
  return out;
}
const kWeight = (s) =>
  biquad(
    biquad(s, 1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585),
    1, -2, 1, -1.99004745483398, 0.99007225036621,
  );
function lufs(left, right) {
  const a = kWeight(left);
  const b = kWeight(right);
  const size = Math.round(0.4 * RATE);
  const hop = Math.round(0.1 * RATE);
  const blocks = [];
  for (let s = 0; s + size <= a.length; s += hop) {
    let sum = 0;
    for (let i = s; i < s + size; i++) sum += a[i] * a[i] + b[i] * b[i];
    blocks.push(sum / size);
  }
  const loud = (list) => -0.691 + 10 * Math.log10(list.reduce((x, y) => x + y, 0) / list.length);
  const absolute = blocks.filter((p) => -0.691 + 10 * Math.log10(p) > -70);
  const threshold = loud(absolute) - 10;
  return loud(absolute.filter((p) => -0.691 + 10 * Math.log10(p) > threshold));
}
const peak = (s) => s.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

// Soft-limit the transients so the mix can reach the target without clipping.
const limit = 10 ** (CEILING_DB / 20);
const limited = (source, g) => source.map((v) => limit * Math.tanh((v * g) / limit));
let gain = 1;
for (let pass = 0; pass < 8; pass++) gain *= 10 ** ((TARGET_LUFS - lufs(limited(L, gain), limited(R, gain))) / 20);
const fadeFrom = LENGTH - Math.round(0.4 * RATE);
const finalL = limited(L, gain);
const finalR = limited(R, gain);
for (let i = fadeFrom; i < LENGTH; i++) {
  const fade = (LENGTH - i) / (LENGTH - fadeFrom);
  finalL[i] *= fade;
  finalR[i] *= fade;
}
L.set(finalL);
R.set(finalR);

const buf = Buffer.alloc(44 + LENGTH * 4);
buf.write("RIFF", 0);
buf.writeUInt32LE(36 + LENGTH * 4, 4);
buf.write("WAVEfmt ", 8);
buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20);
buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(RATE, 24);
buf.writeUInt32LE(RATE * 4, 28);
buf.writeUInt16LE(4, 32);
buf.writeUInt16LE(16, 34);
buf.write("data", 36);
buf.writeUInt32LE(LENGTH * 4, 40);
const pcm = (v) => Math.round(Math.max(-1, Math.min(1, v)) * 32767);
for (let i = 0; i < LENGTH; i++) {
  buf.writeInt16LE(pcm(L[i]), 44 + i * 4);
  buf.writeInt16LE(pcm(R[i]), 46 + i * 4);
}
writeFileSync(new URL("../public/soundtrack.wav", import.meta.url), buf);
console.log(`soundtrack.wav  ${(LENGTH / RATE).toFixed(2)}s  ${lufs(L, R).toFixed(1)} LUFS  sample peak ${(20 * Math.log10(Math.max(peak(L), peak(R)))).toFixed(1)} dBFS`);
