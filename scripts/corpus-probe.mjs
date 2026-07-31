#!/usr/bin/env node
// Run the real pitch tracker over somebody else's corpus of vocal imitations.
//
// Why this exists: kill-line #1 asks whether an untrained person imitating an
// animal call produces a legible pitch contour. Thirty recordings from ten
// adults answer that. None of them exist yet, and recruiting them is not mine.
// A public corpus of crowd-sourced vocal imitations can answer a strictly
// smaller question today, for the cost of an afternoon:
//
//   if clean imitations of animal calls do not produce traceable contours,
//   the route is dead and no recruiting is needed.
//
// This instrument can only kill. It cannot pass. It was not recorded on our
// hardware, in our rooms, with our prompt, so a good result here means the
// arithmetic works on somebody else's easy input — which was never in doubt.
// Whatever it says, kill-line #1's numbers and date do not move.
//
// Corpus: Vocal Imitation Set v1.1.3, Bongjun Kim and Bryan Pardo,
// Northwestern University (Interactive Audio Lab). CC BY 4.0, per the Zenodo
// record 10.5281/zenodo.1340763. Nothing from it is copied into this repo or
// shipped — the audio is fetched to a scratch directory, measured, and the
// numbers are what survive.
//
// Usage:
//   node scripts/corpus-probe.mjs <dir-of-wavs> [--json out.json]
//
// Filenames are expected in the corpus's own form, `<NNN><class>-<id>.wav`,
// which is how a file is grouped into a class here.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { contour, traceability, describeShape, KILL_LINE_1A, ANALYSIS_RATE } from '../src/pitch.js';

// A gap longer than this inside the span is read as "they stopped and started
// again", not "the tracker lost the note". 150 ms is under condition A's 250 ms
// bar on purpose: this counts utterances, it does not judge anything.
const UTTERANCE_GAP_MS = 150;

/** How many separate bursts of voiced sound the clip contains. */
function utterances({ hopSeconds, frames }) {
  const gapFrames = Math.ceil((UTTERANCE_GAP_MS / 1000) / hopSeconds);
  let count = 0, run = 0, inVoiced = false;
  for (const f of frames) {
    if (f.f0 !== null) {
      if (!inVoiced) { count++; inVoiced = true; }
      run = 0;
    } else if (inVoiced && ++run >= gapFrames) {
      inVoiced = false;
    }
  }
  return count;
}

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
const jsonAt = args.indexOf('--json') >= 0 ? args[args.indexOf('--json') + 1] : null;

if (!dir) {
  console.error('usage: node scripts/corpus-probe.mjs <dir-of-wavs> [--json out.json]');
  process.exit(2);
}

// --- WAV reading -----------------------------------------------------------
// Enough of RIFF to read what this corpus actually is: 16-bit PCM, mono,
// 44.1 or 48 kHz. Anything else throws rather than being guessed at, because a
// silently mis-decoded file would read as a failed imitation.

function readWav(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.toString('latin1', 0, 4) !== 'RIFF' || bytes.toString('latin1', 8, 12) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file');
  }
  let pos = 12, fmt = null, data = null;
  while (pos + 8 <= bytes.length) {
    const id = bytes.toString('latin1', pos, pos + 4);
    const size = view.getUint32(pos + 4, true);
    const body = pos + 8;
    if (id === 'fmt ') {
      fmt = {
        format: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      };
    } else if (id === 'data') {
      data = { start: body, size: Math.min(size, bytes.length - body) };
    }
    pos = body + size + (size % 2); // chunks are word-aligned
  }
  if (!fmt || !data) throw new Error('missing fmt or data chunk');
  if (fmt.format !== 1 || fmt.bits !== 16) {
    throw new Error(`unsupported: format ${fmt.format}, ${fmt.bits}-bit (want 16-bit PCM)`);
  }

  const frames = Math.floor(data.size / 2 / fmt.channels);
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < fmt.channels; c++) {
      sum += view.getInt16(data.start + (i * fmt.channels + c) * 2, true) / 32768;
    }
    mono[i] = sum / fmt.channels;
  }
  return { samples: mono, sampleRate: fmt.sampleRate };
}

// --- resampling to the analysis rate --------------------------------------
// TAPE, and named as such. In the browser the downsample to 16 kHz is done by
// OfflineAudioContext, which low-passes properly. Here it is a box average over
// the decimation ratio followed by linear interpolation: cheap, dependency-free,
// and not the same filter. It attenuates rather than removes what sits above
// 8 kHz, so a little aliasing can land in the pitch band.
//
// Why that is acceptable for this instrument: the bias runs against us. Extra
// broadband junk makes YIN's periodicity worse, not better, so a file that
// passes here would also pass through a cleaner filter. A kill-only instrument
// is allowed to be pessimistic. It is not allowed to be optimistic.

function toAnalysisRate(samples, sampleRate) {
  if (sampleRate === ANALYSIS_RATE) return samples;
  const ratio = sampleRate / ANALYSIS_RATE;
  const width = Math.max(1, Math.round(ratio));
  const smoothed = new Float32Array(samples.length);
  let acc = 0;
  for (let i = 0; i < samples.length; i++) {
    acc += samples[i];
    if (i >= width) acc -= samples[i - width];
    smoothed[i] = acc / Math.min(i + 1, width);
  }
  const out = new Float32Array(Math.max(1, Math.floor(samples.length / ratio)));
  for (let i = 0; i < out.length; i++) {
    const x = i * ratio;
    const i0 = Math.floor(x);
    const i1 = Math.min(smoothed.length - 1, i0 + 1);
    const frac = x - i0;
    out[i] = smoothed[i0] * (1 - frac) + smoothed[i1] * frac;
  }
  return out;
}

// --- grouping --------------------------------------------------------------
// `006Animal_Domestic animals_ pets_Dog_Howl-4808870065078272.wav` -> the class
// prefix before the final `-<digits>`. Percent-escapes survive downloading and
// are decoded for reading only.

function classOf(file) {
  const name = decodeURIComponent(basename(file, '.wav'));
  return name.replace(/-\d+$/, '');
}

// --- run -------------------------------------------------------------------

const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.wav')).sort();
if (!files.length) {
  console.error(`no .wav files in ${dir}`);
  process.exit(2);
}

const rows = [];
for (const file of files) {
  const row = { file: decodeURIComponent(file), class: classOf(file) };
  try {
    const { samples, sampleRate } = readWav(readFileSync(join(dir, file)));
    const analysed = toAnalysisRate(samples, sampleRate);
    const c = contour(analysed, ANALYSIS_RATE);
    const t = traceability(c);
    Object.assign(row, {
      sourceRate: sampleRate,
      seconds: +(samples.length / sampleRate).toFixed(2),
      coverage: +t.coverage.toFixed(3),
      maxGapMs: Math.round(t.maxGapMs === Infinity ? -1 : t.maxGapMs),
      spanSeconds: +t.spanSeconds.toFixed(2),
      passesA: t.passesA,
      utterances: utterances(c),
      shape: describeShape(c),
    });
  } catch (err) {
    Object.assign(row, { error: err.message, passesA: false });
  }
  rows.push(row);
}

// --- report ----------------------------------------------------------------

const pad = (s, n) => String(s).padEnd(n);
const classes = [...new Set(rows.map((r) => r.class))].sort();

console.log(`Corpus probe — Vocal Imitation Set v1.1.3 (CC BY 4.0), ${rows.length} files`);
console.log(`Condition A bar, unchanged: coverage >= ${KILL_LINE_1A.minCoverage}, ` +
            `longest interior unvoiced gap <= ${KILL_LINE_1A.maxGapMs} ms\n`);

for (const cls of classes) {
  const group = rows.filter((r) => r.class === cls);
  const passed = group.filter((r) => r.passesA).length;
  console.log(`${cls}  —  ${passed}/${group.length} clear condition A`);
  for (const r of group) {
    if (r.error) {
      console.log(`  ${pad('SKIP', 5)} ${r.file}  ${r.error}`);
      continue;
    }
    console.log(`  ${pad(r.passesA ? 'pass' : 'FAIL', 5)} ` +
                `cov ${pad((r.coverage * 100).toFixed(0) + '%', 5)} ` +
                `gap ${pad(r.maxGapMs + 'ms', 7)} ` +
                `span ${pad(r.spanSeconds + 's', 7)} ` +
                `${pad(r.utterances + 'x', 4)} ` +
                `${r.file}`);
  }
  console.log();
}

const passed = rows.filter((r) => r.passesA).length;
const errored = rows.filter((r) => r.error).length;
const rate = passed / rows.length;

console.log(`Total: ${passed}/${rows.length} clear condition A (${(rate * 100).toFixed(0)}%)` +
            (errored ? `, ${errored} unreadable` : ''));
console.log(`Kill-line #1A asks for 24/30 = 80% on our own recordings.`);
console.log(rate >= 0.80
  ? 'Above that rate here. This does NOT pass anything — different people, different\n' +
    'microphones, different prompt. It only means the route is not obviously dead.'
  : 'Below that rate here. Also not a verdict — but if it is far below, that is the\n' +
    'signal worth bringing as a kill recommendation before ten people are recruited.');

// --- why the failures failed ----------------------------------------------
// Condition A has two clauses and they fail for different reasons. Coverage
// failing means the tracker could not hold the note. The gap clause failing on
// otherwise-high coverage means the person stopped and started again — which is
// a fact about how they chose to imitate, not about whether their voice is
// trackable. Reporting one number for both would hide that.

const measured = rows.filter((r) => !r.error);
const covFails = measured.filter((r) => r.coverage < KILL_LINE_1A.minCoverage);
const gapOnly = measured.filter((r) => r.coverage >= KILL_LINE_1A.minCoverage &&
                                       r.maxGapMs > KILL_LINE_1A.maxGapMs);
const single = measured.filter((r) => r.utterances <= 1);
const singlePass = single.filter((r) => r.passesA).length;

console.log(`\nWhy the failures failed:`);
console.log(`  coverage below ${KILL_LINE_1A.minCoverage}:            ${covFails.length}`);
console.log(`  coverage fine, interior gap too long: ${gapOnly.length}` +
            `  (median utterances in these: ${median(gapOnly.map((r) => r.utterances))})`);
console.log(`  single-utterance clips: ${singlePass}/${single.length} clear condition A`);
console.log(`  median coverage across everything: ` +
            `${(median(measured.map((r) => r.coverage)) * 100).toFixed(0)}%`);

function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

if (jsonAt) {
  writeFileSync(jsonAt, JSON.stringify({
    corpus: 'Vocal Imitation Set v1.1.3 (Kim & Pardo, CC BY 4.0, zenodo 1340763)',
    bar: KILL_LINE_1A,
    ranAt: new Date().toISOString(),
    passed, total: rows.length, rows,
  }, null, 2));
  console.log(`\nwrote ${jsonAt}`);
}
