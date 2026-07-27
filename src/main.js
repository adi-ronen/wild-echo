import { contour, traceability, describeShape, KILL_LINE_1A, ANALYSIS_RATE } from './pitch.js';
import { recordClip, toAnalysisSamples, decodeToBuffer, resample, playSequence } from './audio.js';
import { REFERENCE, renderReference } from './reference.js';
import { drawTraces, COLORS } from './draw.js';

const el = (id) => document.getElementById(id);
const canvas = el('traces');

const state = {
  reference: null, // { buffer, contour }
  you: null,       // { buffer, blob, contour, metrics }
  recorder: null,
  // Set synchronously on the click, before any await. `recorder` itself only
  // exists after getUserMedia resolves, and on a cold permission prompt that is
  // far from instant — a second click inside that window would open a second
  // microphone stream instead of stopping the first one.
  busy: false,
  attempt: 0,
};

// ---------------------------------------------------------------- reference

async function loadReference() {
  const buffer = await renderReference();
  const samples = await resample(buffer);
  state.reference = { buffer, contour: contour(samples, ANALYSIS_RATE) };
  el('ref-shape').textContent = describeShape(state.reference.contour);
  redraw();
}

// ------------------------------------------------------------------ actions

async function playReference() {
  setStatus('Playing the call…');
  await playSequence([state.reference.buffer]);
  setStatus('Now you try.');
}

async function startRecording() {
  setStatus('Waiting for the microphone…');
  try {
    state.recorder = await recordClip(8);
  } catch (err) {
    state.busy = false;
    setStatus('No microphone. You can still hear the call and watch its trace — that works without one.');
    console.error(err);
    return;
  }
  el('record').textContent = 'Stop';
  el('record').classList.add('recording');
  setStatus('Recording. Howl.');

  try {
    const blob = await state.recorder.blob;
    el('record').textContent = 'Record your howl';
    el('record').classList.remove('recording');
    state.recorder = null;

    setStatus('Reading the pitch…');
    const samples = await toAnalysisSamples(blob);
    const c = contour(samples, ANALYSIS_RATE);
    const metrics = traceability(c);
    state.you = { blob, buffer: await decodeToBuffer(blob), contour: c, metrics };
    state.attempt += 1;

    el('you-shape').textContent = describeShape(c);
    renderMetrics(metrics);
    redraw();
    el('compare').disabled = false;
    el('export').disabled = false;
    setStatus(metrics.voiced
      ? `Attempt ${state.attempt}. Compare, then go again.`
      : 'Nothing voiced was found in that take. Closer to the mic, and louder.');
  } finally {
    state.busy = false;
  }
}

function toggleRecord() {
  if (state.recorder) { state.recorder.stop(); return; }
  if (state.busy) return; // arming, or still analysing the last take
  state.busy = true;
  startRecording();
}

async function compare() {
  if (!state.you) return;
  const seq = [state.reference.buffer, state.you.buffer, state.reference.buffer, state.you.buffer];
  const names = ['The call', 'You', 'The call', 'You'];
  setStatus('Listen: call, you, call, you.');
  await playSequence(seq, 0.35, (i) => setStatus(`${names[i]}…`));
  setStatus('Go again and watch your line move.');
}

// ------------------------------------------------------------------ display

function redraw() {
  drawTraces(canvas, [
    state.reference && { contour: state.reference.contour, color: COLORS.reference, width: 3 },
    state.you && { contour: state.you.contour, color: COLORS.you, width: 2.5 },
  ].filter(Boolean));
}

function renderMetrics(m) {
  if (!m.voiced) {
    el('metrics').innerHTML = '<p class="fail">No voiced sound found.</p>';
    return;
  }
  const pass = m.passesA;
  el('metrics').innerHTML = `
    <dl>
      <dt>Voiced span</dt><dd>${m.spanSeconds.toFixed(2)} s</dd>
      <dt>Coverage</dt><dd>${(m.coverage * 100).toFixed(0)}%
        <span class="thr">(needs ≥ ${KILL_LINE_1A.minCoverage * 100}%)</span></dd>
      <dt>Longest interior gap</dt><dd>${m.maxGapMs.toFixed(0)} ms
        <span class="thr">(needs ≤ ${KILL_LINE_1A.maxGapMs} ms)</span></dd>
    </dl>
    <p class="${pass ? 'pass' : 'fail'}">Kill-line #1A: ${pass ? 'this track passes' : 'this track fails'}</p>
    <p class="note">Measured, not scored. Coverage is voiced frames divided by frames
    between your first and last voiced frame. Nothing here is a judgment of the
    imitation — only of whether the pitch was trackable at all.</p>`;
}

function setStatus(s) { el('status').textContent = s; }

// ------------------------------------------------------------------- export
//
// Contours and metrics only. The recording itself is NOT included: it is a
// person's voice, and this project does not move anyone's voice off the machine
// it was recorded on. Grading for kill-line #1 runs on the contours.

function exportSession() {
  const payload = {
    schema: 'wild-echo/session/1',
    recordedAt: new Date().toISOString(),
    subject: el('subject').value.trim() || 'unlabelled',
    reference: { id: REFERENCE.id, synthesized: REFERENCE.synthesized, label: REFERENCE.label },
    attempt: state.attempt,
    analysisRate: ANALYSIS_RATE,
    killLine1A: KILL_LINE_1A,
    metrics: state.you.metrics,
    contour: state.you.contour.frames.map((f) => [
      +f.t.toFixed(3),
      f.f0 === null ? null : +f.f0.toFixed(1),
    ]),
  };
  const name = `wild-echo-${payload.subject}-${state.attempt}.json`;
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
  setStatus(`Saved ${name} to your downloads. The audio stays here.`);
}

// --------------------------------------------------------------------- wire

el('play-ref').addEventListener('click', playReference);
el('record').addEventListener('click', toggleRecord);
el('compare').addEventListener('click', compare);
el('export').addEventListener('click', exportSession);
window.addEventListener('resize', redraw);

loadReference();
