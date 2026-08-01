// The tester session page.
//
// What this is for: kill-line #1 needs 30 recordings from 10 people who are not
// us, made on their own hardware in their own rooms, one take each, nothing
// discarded. Adi sends a link. This is the page at the end of that link.
//
// Three constraints shaped every decision here, and they are worth stating
// because they are not obvious from the code:
//
// 1. GitHub Pages is static. There is no server to receive an upload, and a
//    backend would cost money nobody on this project holds. So the results come
//    back the only honest way a static page can send them: the tester saves a
//    file and sends it themselves.
//
// 2. Nobody's voice leaves their device. Not because we lack a place to put it
//    — because it is a stranger's voice and it does not need to move for the
//    bet to be judged. The pitch contour and the loudness envelope are what the
//    kill-line is scored on, and both are computed here, in the browser.
//
// 3. The link cannot be a lock. A static page can check a password only in code
//    the visitor can read, so a "one-time hash" here would be theatre. The code
//    in the link is a label that keeps ten people's results apart. Said as much
//    on the page rather than pretending otherwise.
//
// Three calls, one take each, since 2026-08-01. The kill-line always asked for
// 10 people x 3 calls; this page ran one call because the consent wording it
// shipped with described one. That wording changed, so the page follows it. The
// calls come in REFERENCES order — up, flat, down — the same order for everyone,
// which means any order effect is shared across all thirty recordings rather
// than randomised away. That is a known limitation, written down rather than
// hidden: the bet does not ask for counterbalancing and thirty recordings could
// not measure it if it did.

import { contour, traceability, describeShape, KILL_LINE_1A, ANALYSIS_RATE } from '../src/pitch.js';
import { recordClip, toAnalysisSamples, decodeToBuffer, resample, playSequence } from '../src/audio.js';
import { REFERENCES, loadReferenceBuffer } from '../src/reference.js';
import { drawTraces, COLORS } from '../src/draw.js';

const el = (id) => document.getElementById(id);

const state = {
  config: null,
  callIndex: 0,      // which of REFERENCES is on screen
  reference: null,   // { buffer, contour } for the current call
  take: null,        // the current call's take — set once, never replaced
  takes: [],         // one finished entry per call, in call order
  recorder: null,
  busy: false,
  heardCall: 0,      // times this call was played, reset per call
  startedAt: null,
};

const current = () => REFERENCES[state.callIndex];

// ------------------------------------------------------------------- startup

const config = await fetch('config.json').then((r) => r.json());
state.config = config;
el('consent-version').textContent = `Consent wording version: ${config.consentVersion}`;

if (!config.consentApproved) {
  // Hard interlock. No microphone is opened on this page until the wording
  // below it has been approved by the person whose call that is.
  el('draft-mark').hidden = false;
  el('screen-blocked').hidden = false;
  el('start').disabled = true;
  el('start').textContent = 'Not open yet';
} else {
  el('agree-read').addEventListener('change', gateStart);
  el('agree-age').addEventListener('change', gateStart);
  el('start').addEventListener('click', startSession);
}

// A tester code in the link is a convenience, not a credential.
const fromLink = new URLSearchParams(location.search).get('t');
if (fromLink) el('tester-code').value = fromLink.slice(0, 12);

function gateStart() {
  el('start').disabled = !(el('agree-read').checked && el('agree-age').checked);
}

// ------------------------------------------------------------------- session

async function startSession() {
  el('screen-consent').hidden = true;
  el('screen-session').hidden = false;
  state.startedAt = new Date().toISOString();
  await loadCall();
}

/** Put the current call on screen, from a clean slate. */
async function loadCall() {
  const ref = current();
  state.reference = null;
  state.take = null;
  state.heardCall = 0;

  el('step-title').textContent = `Call ${state.callIndex + 1} of ${REFERENCES.length} — hear the call`;

  // The per-call note slot. `testerNote` is the pigeon sentence and it goes on
  // its own line rather than at the end of the paragraph: a sentence appended to
  // 110 characters of provenance is a sentence nobody reads, and this one exists
  // precisely because it has to be read.
  const note = el('call-note');
  note.textContent = '';
  note.append(`${ref.label} ${ref.note}`);
  if (ref.testerNote) {
    const warn = document.createElement('strong');
    warn.className = 'call-warning';
    warn.textContent = ref.testerNote;
    note.append(warn);
  }
  el('result').hidden = true;
  el('play-ref').disabled = false;
  el('record').disabled = true;
  el('record').textContent = 'Record my one sound';
  el('next').textContent = state.callIndex + 1 < REFERENCES.length ? 'Next call' : 'Finish';
  for (const box of document.querySelectorAll('#flags input')) box.checked = false;
  setStatus('Hear the call first — as many times as you like.');

  try {
    const buffer = await loadReferenceBuffer(ref);
    const samples = await resample(buffer);
    state.reference = { buffer, contour: contour(samples, ANALYSIS_RATE) };
    el('ref-shape').textContent = describeShape(state.reference.contour);
  } catch (err) {
    console.error(err);
    setStatus('The call did not load, so there is nothing to imitate. Reload the page, or tell the person who sent you the link.');
    el('play-ref').disabled = true;
  }
}

/**
 * Bank the finished take and move on. The take is banked here rather than at
 * record time so the "how did it go" boxes for this call travel with it.
 */
function nextCall() {
  if (!state.take) return;
  state.takes.push(finishedTake(state.take, state.reference, current()));

  if (state.callIndex + 1 < REFERENCES.length) {
    state.callIndex += 1;
    loadCall();
    return;
  }
  el('screen-session').hidden = true;
  el('screen-done').hidden = false;
}

async function playReference() {
  if (!state.reference) return;
  setStatus('Listen…');
  await playSequence([state.reference.buffer]);
  state.heardCall += 1;
  el('record').disabled = false;
  setStatus('When you are ready: one sound, then stop. Hear it again as many times as you like first.');
}

function toggleRecord() {
  if (state.take) return;                 // one take, and it has been used
  if (state.recorder) { state.recorder.stop(); return; }
  if (state.busy) return;                 // arming, or still analysing
  state.busy = true;
  record();
}

async function record() {
  setStatus('Waiting for the microphone…');
  try {
    state.recorder = await recordClip(state.config.maxRecordSeconds);
  } catch (err) {
    console.error(err);
    state.busy = false;
    setStatus('The browser would not give this page a microphone. Nothing was recorded. Tell the person who sent you the link.');
    return;
  }

  el('record').textContent = 'Stop';
  el('record').classList.add('recording');
  setStatus('Recording — one sound, then stop.');

  try {
    const blob = await state.recorder.blob;
    state.recorder = null;
    el('record').textContent = 'Recorded';
    el('record').classList.remove('recording');
    el('record').disabled = true;
    el('play-ref').disabled = true;
    el('step-title').textContent = `Call ${state.callIndex + 1} of ${REFERENCES.length} — what came out`;
    setStatus('Reading the pitch. Nothing has been sent anywhere.');

    const samples = await toAnalysisSamples(blob);
    const c = contour(samples, ANALYSIS_RATE);
    state.take = {
      buffer: await decodeToBuffer(blob),
      contour: c,
      metrics: traceability(c),
      envelope: envelopeDb(samples, ANALYSIS_RATE, c.hopSeconds),
      meta: {
        mimeType: blob.type || 'unknown',
        bytes: blob.size,
        seconds: +(samples.length / ANALYSIS_RATE).toFixed(3),
        peakSample: +peak(samples).toFixed(4),
        clippedFraction: +clippedFraction(samples).toFixed(5),
        heardCallTimes: state.heardCall,
      },
    };

    el('you-shape').textContent = describeShape(c);
    el('result').hidden = false;
    drawTraces(el('traces'), [
      { contour: state.reference.contour, color: COLORS.reference, width: 3 },
      { contour: c, color: COLORS.you, width: 2.5 },
    ]);
    const last = state.callIndex + 1 === REFERENCES.length;
    setStatus(state.take.metrics.voiced
      ? `That is your take. Listen to the two side by side if you like, then ${last ? 'finish' : 'go on to the next call'}.`
      : `No pitch was found in that take. That is a real result and it counts — ${last ? 'finish' : 'go on to the next call'} anyway.`);
  } finally {
    state.busy = false;
  }
}

async function compare() {
  if (!state.take || !state.reference) return;
  const seq = [state.reference.buffer, state.take.buffer, state.reference.buffer, state.take.buffer];
  const names = ['The call', 'You', 'The call', 'You'];
  await playSequence(seq, 0.35, (i) => setStatus(`${names[i]}…`));
  setStatus(state.callIndex + 1 === REFERENCES.length
    ? 'That is the last call. Press Finish, then save the file.'
    : 'Go on to the next call when you are ready.');
}

// ------------------------------------------------------------------- results
//
// Numbers only, and every one of them is listed on the consent screen. No
// audio, no free text, nothing typed except the tester code.

/** Freeze one call's take into the shape that goes in the file. */
function finishedTake(t, reference, ref) {
  return {
    reference: {
      id: ref.id,
      species: ref.species,
      synthesized: ref.synthesized,
      contour: packContour(reference.contour),
    },
    ...t.meta,
    analysisRate: ANALYSIS_RATE,
    hopSeconds: t.contour.hopSeconds,
    killLine1A: KILL_LINE_1A,
    metrics: t.metrics,
    diagnostics: diagnostics(t.contour),
    // [time, f0 Hz or null, YIN confidence, frame level in dBFS]
    frames: t.contour.frames.map((f, i) => [
      +f.t.toFixed(3),
      f.f0 === null ? null : +f.f0.toFixed(1),
      +f.confidence.toFixed(3),
      t.envelope[i] ?? null,
    ]),
    notes: [...document.querySelectorAll('#flags input:checked')].map((c) => c.value),
  };
}

function payload() {
  return {
    schema: 'wild-echo/tester-session/3',
    consentVersion: state.config.consentVersion,
    deleteBy: state.config.deleteBy,
    testerCode: el('tester-code').value.trim().slice(0, 12) || 'unlabelled',
    startedAt: state.startedAt,
    finishedAt: new Date().toISOString(),
    device: describeDevice(),
    takes: state.takes,
  };
}

function fileName(p) {
  return `wild-echo-${p.testerCode}-${p.finishedAt.slice(0, 10)}.json`;
}

function finish() {
  const p = payload();
  const name = fileName(p);
  const url = URL.createObjectURL(new Blob([JSON.stringify(p, null, 1)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
  el('finish-status').textContent = `Saved ${name}. Send that file back. Your recordings themselves are still only on this device, and go when you close the tab.`;
}

// Some phones make saving a file awkward. This is the same data as text, for
// pasting into a message — the honest fallback for a page with no server.
async function copyText() {
  const text = JSON.stringify(payload());
  try {
    await navigator.clipboard.writeText(text);
    el('finish-status').textContent = `Copied ${text.length} characters. Paste it into a message to whoever sent you the link.`;
  } catch (err) {
    console.error(err);
    el('finish-status').textContent = 'The browser would not let the page use the clipboard. Use "Save my results file" instead.';
  }
}

// -------------------------------------------------------------- diagnostics
//
// Two things that describe a take without judging it, both known failure modes
// of condition A found before any of these thirty recordings existed:
//
//   bursts  — separate runs of voiced sound. The corpus probe (2026-07-30) found
//             condition A's gap clause failing takes because the person repeated
//             the call, not because their voice was untrackable: median four
//             bursts a clip, pigeon coo 0 of 19.
//   debris  — voiced runs shorter than 100 ms. Nine takes on 2026-07-31 showed a
//             10-60 ms fragment at the edge of a clip inflating the vocalised
//             span (its denominator is first-voiced to last-voiced) and sinking
//             coverage with nothing repeated at all.
//
// Neither number touches condition A. `traceability()` in src/pitch.js is
// unmodified and is the only thing that sets passesA. Ori's call, 2026-08-01:
// the recorder is NOT changed to suppress sub-100 ms debris — cleaning the
// instrument after freezing the test is exactly what we said we would not do.
// So the debris is measured, carried in the file, and reported in the verdict
// document if it mattered. It is never subtracted, and it never renegotiates a
// threshold.

const UTTERANCE_GAP_MS = 150; // the corpus probe's number, unchanged, so the
                              // burst counts are comparable to its 57 clips
const DEBRIS_MAX_MS = 100;    // chosen 2026-07-31 for a diagnosis; judges nothing

/** Maximal runs of voiced frames, as [start ms, length ms] pairs. */
function voicedRuns({ hopSeconds, frames }) {
  const ms = hopSeconds * 1000;
  const runs = [];
  let start = -1;
  frames.forEach((f, i) => {
    if (f.f0 !== null && start < 0) start = i;
    if (f.f0 === null && start >= 0) { runs.push([start, i - start]); start = -1; }
  });
  if (start >= 0) runs.push([start, frames.length - start]);
  return runs.map(([i, n]) => [+(i * ms).toFixed(0), +(n * ms).toFixed(0)]);
}

/**
 * How many separate bursts of voiced sound the take contains. Character-for-
 * character the corpus probe's rule: a gap of UTTERANCE_GAP_MS or more ends a
 * burst. Deliberately under condition A's 250 ms bar — this counts utterances,
 * it does not judge them.
 */
function bursts({ hopSeconds, frames }) {
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

function diagnostics(c) {
  const runs = voicedRuns(c);
  const debris = runs.filter(([, ms]) => ms < DEBRIS_MAX_MS);
  return {
    burstGapMs: UTTERANCE_GAP_MS,
    bursts: bursts(c),
    debrisMaxMs: DEBRIS_MAX_MS,
    debrisRuns: debris.length,
    debrisTotalMs: debris.reduce((n, [, ms]) => n + ms, 0),
    voicedRuns: runs,
  };
}

// --------------------------------------------------------------------- bits

/** Per-frame level in dBFS, on the same clock as the pitch frames. */
function envelopeDb(samples, sampleRate, hopSeconds) {
  const hop = Math.round(hopSeconds * sampleRate);
  const win = 1024;
  const out = [];
  for (let start = 0; start + win <= samples.length; start += hop) {
    let sum = 0;
    for (let i = start; i < start + win; i++) sum += samples[i] * samples[i];
    const rms = Math.sqrt(sum / win);
    out.push(rms > 0 ? +(20 * Math.log10(rms)).toFixed(1) : -120);
  }
  return out;
}

function peak(samples) {
  let p = 0;
  for (let i = 0; i < samples.length; i++) p = Math.max(p, Math.abs(samples[i]));
  return p;
}

function clippedFraction(samples) {
  let n = 0;
  for (let i = 0; i < samples.length; i++) if (Math.abs(samples[i]) >= 0.999) n++;
  return samples.length ? n / samples.length : 0;
}

function packContour({ hopSeconds, frames }) {
  return {
    hopSeconds,
    f0: frames.map((f) => (f.f0 === null ? null : +f.f0.toFixed(1))),
  };
}

/**
 * Browser and platform only, and coarsely. Enough to tell a failed route from a
 * failed microphone; not a fingerprint, and listed on the consent screen in the
 * same words as here.
 */
function describeDevice() {
  const ua = navigator.userAgent;
  const browser = /Firefox\/(\d+)/.exec(ua) ? `Firefox ${RegExp.$1}`
    : /Edg\/(\d+)/.exec(ua) ? `Edge ${RegExp.$1}`
    : /Chrome\/(\d+)/.exec(ua) ? `Chrome ${RegExp.$1}`
    : /Version\/(\d+).*Safari/.exec(ua) ? `Safari ${RegExp.$1}`
    : 'other browser';
  const os = /Android/.test(ua) ? 'Android'
    : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /Mac OS X/.test(ua) ? 'macOS'
    : /Windows/.test(ua) ? 'Windows'
    : /Linux/.test(ua) ? 'Linux'
    : 'other system';
  return `${browser} on ${os}`;
}

function setStatus(s) { el('status').textContent = s; }

// ---------------------------------------------------------------------- wire

el('play-ref').addEventListener('click', playReference);
el('record').addEventListener('click', toggleRecord);
el('compare').addEventListener('click', compare);
el('next').addEventListener('click', nextCall);
el('finish').addEventListener('click', finish);
el('copy').addEventListener('click', copyText);
