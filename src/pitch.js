// Pitch tracking: YIN fundamental-frequency estimation, plus the traceability
// metrics that kill-line #1 is judged on.
//
// No model, no training data. This is arithmetic over a window of samples.
// Everything it reports can be described in one sentence to someone who did not
// write it, which is the bar this project holds itself to.

export const ANALYSIS_RATE = 16000; // Hz. Downsampled before analysis — see audio.js
export const HOP_SECONDS = 0.01;    // 10 ms between frames
export const WINDOW = 1024;         // samples, ~64 ms at 16 kHz

const F_MIN = 70;    // Hz — below a human's lowest useful growl
const F_MAX = 1200;  // Hz — above a child's highest howl
const YIN_THRESHOLD = 0.15;
const VOICED_CMND_MAX = 0.45; // above this the frame is called unvoiced

// Silence gating. An absolute amplitude threshold is the wrong instrument here:
// microphone gain varies by more than 30 dB across the phones and laptops this
// will actually run on, so a fixed floor throws away a perfectly clean take
// recorded on a quiet mic. So the gate is relative to the clip's own loud parts
// — a frame is silence if it sits more than GATE_BELOW_LOUD_DB under the 90th
// percentile frame — with a small absolute floor underneath to reject digital
// silence and dither.
const GATE_BELOW_LOUD_DB = 30;
const ABSOLUTE_RMS_FLOOR = 0.0006;

/**
 * YIN pitch estimate for a single window of mono samples.
 * Returns { f0, confidence } or null when the window is unvoiced.
 *
 * `rmsFloor` is the silence gate for this clip; see contour().
 *
 * Deviation from the paper, stated plainly: the cumulative mean is accumulated
 * from tauMin rather than from tau=1, because we band-limit the lag search to
 * F_MIN..F_MAX up front. This is the usual practice for a band-limited search
 * and it costs nothing here; it is noted so nobody reads the code against the
 * paper and thinks it is a bug.
 */
export function yin(buf, sampleRate, rmsFloor = ABSOLUTE_RMS_FLOOR) {
  const tauMin = Math.max(2, Math.floor(sampleRate / F_MAX));
  const tauMax = Math.min(Math.floor(sampleRate / F_MIN), buf.length >> 1);
  if (tauMax <= tauMin) return null;

  if (rms(buf) < rmsFloor) return null;

  // Squared-difference function over the band-limited lag range.
  const cmnd = new Float32Array(tauMax + 1);
  let running = 0;
  for (let tau = tauMin; tau <= tauMax; tau++) {
    let sum = 0;
    const n = buf.length - tau;
    for (let i = 0; i < n; i++) {
      const diff = buf[i] - buf[i + tau];
      sum += diff * diff;
    }
    running += sum;
    cmnd[tau] = running === 0 ? 1 : (sum * (tau - tauMin + 1)) / running;
  }

  // Absolute threshold: first local minimum that dips below the threshold.
  let bestTau = -1;
  for (let tau = tauMin + 1; tau < tauMax; tau++) {
    if (cmnd[tau] < YIN_THRESHOLD && cmnd[tau] <= cmnd[tau + 1]) {
      bestTau = tau;
      break;
    }
  }
  // Nothing crossed the threshold — fall back to the global minimum.
  if (bestTau === -1) {
    let min = Infinity;
    for (let tau = tauMin; tau <= tauMax; tau++) {
      if (cmnd[tau] < min) { min = cmnd[tau]; bestTau = tau; }
    }
    if (min > VOICED_CMND_MAX) return null;
  }

  // Parabolic interpolation around the chosen lag for sub-sample accuracy.
  let tau = bestTau;
  if (bestTau > tauMin && bestTau < tauMax) {
    const a = cmnd[bestTau - 1], b = cmnd[bestTau], c = cmnd[bestTau + 1];
    const denom = 2 * (2 * b - a - c);
    if (denom !== 0) tau = bestTau + (c - a) / denom;
  }

  const f0 = sampleRate / tau;
  if (f0 < F_MIN || f0 > F_MAX) return null;
  return { f0, confidence: 1 - cmnd[bestTau] };
}

/**
 * Run YIN across a whole mono buffer.
 * Returns { hopSeconds, rmsFloor, frames: [{ t, f0|null, confidence }] }
 *
 * Two passes: the first measures how loud this particular recording is and sets
 * the silence gate from that, the second tracks pitch. Two passes cost nothing
 * offline and make the tracker independent of microphone gain.
 */
export function contour(samples, sampleRate = ANALYSIS_RATE) {
  const hop = Math.round(HOP_SECONDS * sampleRate);
  const starts = [];
  for (let start = 0; start + WINDOW <= samples.length; start += hop) starts.push(start);

  const levels = starts.map((s) => rms(samples.subarray(s, s + WINDOW)));
  const rmsFloor = gateFor(levels);

  const frames = starts.map((start, i) => {
    // Skip the correlation entirely for frames already below the gate.
    const est = levels[i] < rmsFloor ? null : yin(samples.subarray(start, start + WINDOW), sampleRate, rmsFloor);
    return {
      t: (start + WINDOW / 2) / sampleRate,
      f0: est ? est.f0 : null,
      confidence: est ? est.confidence : 0,
    };
  });

  return { hopSeconds: hop / sampleRate, rmsFloor, frames };
}

/** Silence gate for one clip: 30 dB under its 90th-percentile frame. */
function gateFor(levels) {
  if (!levels.length) return ABSOLUTE_RMS_FLOOR;
  const sorted = [...levels].sort((a, b) => a - b);
  const loud = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))];
  return Math.max(ABSOLUTE_RMS_FLOOR, loud * Math.pow(10, -GATE_BELOW_LOUD_DB / 20));
}

function rms(buf) {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

/**
 * Traceability metrics — the exact quantities kill-line #1 criterion A is
 * judged on. Written here so the pass/fail is computed by the build and not by
 * whoever is looking at the screen.
 *
 *   vocalized span   first voiced frame .. last voiced frame
 *   coverage         voiced frames inside the span / all frames inside it
 *   maxGapMs         longest unvoiced run strictly inside the span
 *
 * Kill-line #1A passes a track when coverage >= 0.60 AND maxGapMs <= 250.
 */
export const KILL_LINE_1A = { minCoverage: 0.60, maxGapMs: 250 };

export function traceability({ hopSeconds, frames }) {
  const voicedIdx = frames.map((f, i) => (f.f0 !== null ? i : -1)).filter((i) => i >= 0);
  if (voicedIdx.length === 0) {
    return { voiced: false, coverage: 0, maxGapMs: Infinity, spanSeconds: 0, passesA: false };
  }
  const first = voicedIdx[0];
  const last = voicedIdx[voicedIdx.length - 1];
  const spanFrames = last - first + 1;
  const coverage = voicedIdx.length / spanFrames;

  let maxGap = 0, run = 0;
  for (let i = first; i <= last; i++) {
    if (frames[i].f0 === null) { run++; if (run > maxGap) maxGap = run; }
    else run = 0;
  }
  const maxGapMs = maxGap * hopSeconds * 1000;

  return {
    voiced: true,
    coverage,
    maxGapMs,
    spanSeconds: spanFrames * hopSeconds,
    firstVoicedTime: frames[first].t,
    passesA: coverage >= KILL_LINE_1A.minCoverage && maxGapMs <= KILL_LINE_1A.maxGapMs,
  };
}

/**
 * A plain-language description of the shape, for anyone who cannot see the
 * canvas. Every number in here is measured, none of them are designed.
 */
export function describeShape({ hopSeconds, frames }) {
  const voiced = frames.filter((f) => f.f0 !== null);
  if (voiced.length < 3) return 'Too little voiced sound to describe a shape.';

  const f = voiced.map((v) => v.f0);
  const lo = Math.min(...f);
  const hi = Math.max(...f);
  const octaves = Math.log2(hi / lo);
  const seconds = (voiced[voiced.length - 1].t - voiced[0].t);
  const turns = countTurns(f);

  return `${seconds.toFixed(1)} seconds of voiced sound, from ${Math.round(lo)} to ` +
         `${Math.round(hi)} hertz — a range of ${octaves.toFixed(1)} octaves. ` +
         `${cap(arc(f, turns))}.`;
}

/**
 * How the pitch moved, in words.
 *
 * Net start-to-end direction is the obvious thing to report and it is the wrong
 * thing: a howl that rises an octave, holds, and falls back has a net direction
 * of roughly nothing, and describing it as "falling slightly" is false to what
 * anyone heard. So an interior peak or trough is named as an arc, and net
 * direction is only used when the contour really is monotone.
 */
function arc(f, turns) {
  const s = smooth(f, 9);
  const n = s.length;
  const interior = (i) => i > n * 0.15 && i < n * 0.85;
  const maxI = s.indexOf(Math.max(...s));
  const minI = s.indexOf(Math.min(...s));
  const oct = (a, b) => Math.abs(Math.log2(b / a)).toFixed(1);

  if (turns <= 2 && interior(maxI) && !interior(minI)) {
    return `rising ${oct(s[0], s[maxI])} octaves to a peak, then falling ${oct(s[maxI], s[n - 1])} octaves back down`;
  }
  if (turns <= 2 && interior(minI) && !interior(maxI)) {
    return `falling ${oct(s[0], s[minI])} octaves to a dip, then rising ${oct(s[minI], s[n - 1])} octaves again`;
  }

  const head = Math.max(1, Math.round(n * 0.15));
  const netOct = Math.log2(mean(s.slice(-head)) / mean(s.slice(0, head)));
  const shape = turns <= 1 ? 'one smooth bend' : `${turns} changes of direction`;
  if (netOct > 0.15) return `rising ${netOct.toFixed(1)} octaves overall, with ${shape}`;
  if (netOct < -0.15) return `falling ${Math.abs(netOct).toFixed(1)} octaves overall, with ${shape}`;
  return `ending near where it started, with ${shape}`;
}

// Direction changes, counted on a smoothed curve so vibrato is not mistaken
// for structure.
function countTurns(f) {
  const s = smooth(f, 9);
  let turns = 0, dir = 0;
  for (let i = 1; i < s.length; i++) {
    const step = s[i] - s[i - 1];
    if (Math.abs(step) < s[i - 1] * 0.01) continue; // ignore sub-1% wobble
    const d = Math.sign(step);
    if (dir !== 0 && d !== dir) turns++;
    dir = d;
  }
  return turns;
}

function smooth(arr, w) {
  const out = new Array(arr.length);
  const h = w >> 1;
  for (let i = 0; i < arr.length; i++) {
    let sum = 0, n = 0;
    for (let j = Math.max(0, i - h); j <= Math.min(arr.length - 1, i + h); j++) { sum += arr[j]; n++; }
    out[i] = sum / n;
  }
  return out;
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const cap = (s) => s[0].toUpperCase() + s.slice(1);
