#!/usr/bin/env node
// Does the pitch tracker actually recover a pitch it was given?
//
// Synthesize signals whose f0 is known exactly, run YIN over them, and compare.
// This is not a test of whether a human howl is trackable — only a real human
// can answer that. It is a test that the arithmetic is not lying, so that when
// a human recording fails, the failure means something.

import { yin, contour, traceability, describeShape, ANALYSIS_RATE } from '../src/pitch.js';

const SR = ANALYSIS_RATE;
let failures = 0;

function ok(name, pass, detail = '') {
  console.log(`${pass ? '  pass' : '  FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
  if (!pass) failures++;
}

// --- steady tones, harmonics included so it is not a pure-sine-only tracker ---
console.log('steady tones (harmonic-rich):');
for (const f of [85, 120, 220, 330, 440, 700, 1000]) {
  const buf = tone(f, 1024 / SR, SR);
  const est = yin(buf, SR);
  const err = est ? Math.abs(est.f0 - f) / f : 1;
  ok(`${f} Hz`, est !== null && err < 0.02,
     est ? `got ${est.f0.toFixed(1)} Hz (${(err * 100).toFixed(2)}% off)` : 'got null');
}

// --- silence and noise must read as unvoiced, or every gap metric is garbage ---
console.log('\nrejection:');
ok('silence -> unvoiced', yin(new Float32Array(1024), SR) === null);
const noise = new Float32Array(1024);
for (let i = 0; i < noise.length; i++) noise[i] = (Math.random() * 2 - 1) * 0.3;
const noiseEst = yin(noise, SR);
ok('white noise -> unvoiced or low confidence', noiseEst === null || noiseEst.confidence < 0.6,
   noiseEst ? `confidence ${noiseEst.confidence.toFixed(2)}` : 'null');

// --- a glide: the actual shape a howl makes ---
console.log('\nglide 180 -> 470 -> 200 Hz over 3s (the reference contour):');
const glide = sweep([[0, 180], [0.3, 470], [0.6, 455], [1, 200]], 3, SR);
const gc = contour(glide, SR);
const gm = traceability(gc);
ok('coverage 100%', gm.coverage > 0.98, `${(gm.coverage * 100).toFixed(1)}%`);
ok('no interior gap', gm.maxGapMs === 0, `${gm.maxGapMs.toFixed(0)} ms`);
ok('passes kill-line 1A', gm.passesA === true);
const errs = gc.frames.filter((f) => f.f0 !== null)
  .map((f, i, a) => Math.abs(f.f0 - freqAt(i / a.length, [[0, 180], [0.3, 470], [0.6, 455], [1, 200]])) /
                    freqAt(i / a.length, [[0, 180], [0.3, 470], [0.6, 455], [1, 200]]));
const med = errs.sort((a, b) => a - b)[errs.length >> 1];
ok('median frame error < 3%', med < 0.03, `${(med * 100).toFixed(2)}%`);
const gDesc = describeShape(gc);
// A howl rises, holds and falls. Reporting its net endpoint direction would call
// it "falling slightly", which is false to what anyone heard.
ok('described as an arc, not a net direction', /rising .* then falling/i.test(gDesc));
console.log(`  described: ${gDesc}`);

// A genuinely monotone glide must still be described as monotone.
const rise = describeShape(contour(sweep([[0, 150], [1, 600]], 2, SR), SR));
ok('monotone rise described as rising', /rising/i.test(rise) && !/then falling/i.test(rise), rise);

// --- a broken take: 400ms of silence in the middle must be caught, not smoothed ---
console.log('\nbroken take (400 ms hole in the middle):');
const broken = Float32Array.from(sweep([[0, 200], [1, 400]], 2, SR));
const holeStart = Math.round(0.8 * SR), holeLen = Math.round(0.4 * SR);
broken.fill(0, holeStart, holeStart + holeLen);
const bm = traceability(contour(broken, SR));
ok('gap detected near 400 ms', bm.maxGapMs > 300, `${bm.maxGapMs.toFixed(0)} ms`);
ok('fails kill-line 1A on gap', bm.passesA === false);

// --- a quiet take: the thing that will actually happen in a living room ---
console.log('\nquiet take (-32 dB, room noise floor):');
const quiet = Float32Array.from(sweep([[0, 200], [1, 400]], 2, SR), (v) => v * 0.025 + (Math.random() * 2 - 1) * 0.002);
const qm = traceability(contour(quiet, SR));
ok('still trackable', qm.coverage > 0.6, `coverage ${(qm.coverage * 100).toFixed(0)}%`);

// --- a howl inside a room: noise before, during and after the vocalisation ---
// This is the case that actually happens. If room noise reads as voiced, the
// span stretches to the whole clip and coverage collapses for no real reason.
console.log('\nnoisy room (1s noise, 2s howl, 1s noise):');
const room = new Float32Array(Math.round(4 * SR));
for (let i = 0; i < room.length; i++) room[i] = (Math.random() * 2 - 1) * 0.004;
const howl = sweep([[0, 200], [0.4, 450], [1, 220]], 2, SR);
for (let i = 0; i < howl.length; i++) room[Math.round(SR) + i] += howl[i] * 0.5;
const rc = contour(room, SR);
const rm = traceability(rc);
ok('span is the howl, not the clip', rm.spanSeconds > 1.7 && rm.spanSeconds < 2.4, `${rm.spanSeconds.toFixed(2)} s of 4.00 s`);
ok('coverage high', rm.coverage > 0.9, `${(rm.coverage * 100).toFixed(0)}%`);
ok('passes kill-line 1A', rm.passesA === true);

// What these tests do NOT cover, stated so nobody reads a green run as more
// than it is: breathy onsets, creak at the bottom of a range, two people in the
// room, phone speaker bleeding into the phone mic, and a six-year-old. Only
// real recordings answer those, which is what kill-line #1 is for.

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall pitch checks passed');
process.exit(failures ? 1 : 0);

// ----------------------------------------------------------------- helpers

function tone(f, seconds, sr) {
  const n = Math.round(seconds * sr);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = (2 * Math.PI * f * i) / sr;
    out[i] = 0.4 * (Math.sin(p) + 0.35 * Math.sin(2 * p) + 0.12 * Math.sin(3 * p));
  }
  return out;
}

function sweep(points, seconds, sr) {
  const n = Math.round(seconds * sr);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const f = freqAt(i / n, points);
    phase += (2 * Math.PI * f) / sr;
    out[i] = 0.4 * (Math.sin(phase) + 0.35 * Math.sin(2 * phase) + 0.12 * Math.sin(3 * phase));
  }
  return out;
}

function freqAt(frac, p) {
  for (let i = 1; i < p.length; i++) {
    if (frac <= p[i][0]) {
      const [t0, f0] = p[i - 1], [t1, f1] = p[i];
      const u = (frac - t0) / (t1 - t0 || 1);
      return f0 * Math.pow(f1 / f0, u * u * (3 - 2 * u));
    }
  }
  return p[p.length - 1][1];
}
