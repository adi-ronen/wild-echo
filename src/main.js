import { contour, traceability, describeShape, KILL_LINE_1A, ANALYSIS_RATE } from './pitch.js';
import { recordClip, toAnalysisSamples, decodeToBuffer, resample, playSequence } from './audio.js';
import { PROTOTYPE_REFERENCES as REFERENCES, loadReferenceBuffer } from './reference.js';
import { drawTraces, COLORS } from './draw.js';

const el = (id) => document.getElementById(id);
const canvas = el('traces');

// Metrics, subject label and Save are the instrument, not the page. Anyone who
// arrives without ?lab=1 gets the comparison only; the instrument stays
// reachable at a URL I can hand a tester. See rnd/tal-to-noam/2026-08-02.md.
if (new URLSearchParams(location.search).get('lab') === '1') {
  document.body.classList.add('lab-mode');
}

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

// Which of the three calls is loaded right now. Changing it throws away the
// take that was compared against the old one — a contour drawn against a
// different call is not evidence about this one.
let current = REFERENCES[0];

function fillCallPicker() {
  const sel = el('call');
  sel.innerHTML = '';
  for (const ref of REFERENCES) {
    const opt = document.createElement('option');
    opt.value = ref.id;
    opt.textContent = ref.animal;
    sel.appendChild(opt);
  }
  sel.value = current.id;
}

function changeCall() {
  const next = REFERENCES.find((r) => r.id === el('call').value);
  if (!next || next.id === current.id) return;
  current = next;
  state.reference = null;
  state.you = null;
  state.attempt = 0;
  el('you-shape').textContent = 'Nothing recorded yet.';
  el('metrics').innerHTML = '<p class="hint">Record something to find out.</p>';
  el('compare').disabled = true;
  el('export').disabled = true;
  el('listen-cta').hidden = true;
  setStatus('Loading the new call…');
  redraw();
  loadReference();
}

function nextAnimal() {
  const i = REFERENCES.findIndex((r) => r.id === current.id);
  const next = REFERENCES[(i + 1) % REFERENCES.length];
  el('call').value = next.id;
  changeCall();
}

async function loadReference() {
  let buffer;
  try {
    buffer = await loadReferenceBuffer(current);
  } catch (err) {
    // Say it. Do not fall back to the oscillator without saying it — a number
    // taken against a synthesizer is a number about a synthesizer.
    console.error(err);
    setStatus('The call could not be loaded, so there is nothing to imitate yet. Reload, or check your connection.');
    el('ref-shape').textContent = 'not loaded';
    return;
  }
  const samples = await resample(buffer);
  state.reference = { buffer, contour: contour(samples, ANALYSIS_RATE) };
  el('ref-shape').textContent = describeShape(state.reference.contour);
  el('ref-credit').textContent = `${current.label}. ${current.note} ${current.credit}`;
  redraw();
}

// ------------------------------------------------------------------ actions

async function playReference() {
  if (!state.reference) {
    setStatus('The call has not loaded yet. Wait a moment, or reload the page.');
    return;
  }
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
    setStatus('No microphone. You can still hear each call and watch its shape — press "Next animal" to keep going without one.');
    console.error(err);
    return;
  }
  el('record').textContent = 'Stop';
  el('record').classList.add('recording');
  setStatus('Recording. Make the call.');

  try {
    const blob = await state.recorder.blob;
    el('record').textContent = 'Record your call';
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
    el('listen-cta').hidden = false;
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
  if (!state.you || !state.reference) return;
  const seq = [state.reference.buffer, state.you.buffer, state.reference.buffer, state.you.buffer];
  const names = [current.animal, 'You', current.animal, 'You'];
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
  el('metrics').innerHTML = `
    <dl>
      <dt>Voiced span</dt><dd>${m.spanSeconds.toFixed(2)} s</dd>
      <dt>Coverage</dt><dd>${(m.coverage * 100).toFixed(0)}%</dd>
      <dt>Longest interior gap</dt><dd>${m.maxGapMs.toFixed(0)} ms</dd>
    </dl>
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
    reference: { id: current.id, synthesized: current.synthesized, label: current.label },
    attempt: state.attempt,
    analysisRate: ANALYSIS_RATE,
    killLine1A: KILL_LINE_1A,
    notice: el('notice').value.trim() || null,
    metrics: state.you.metrics,
    contour: state.you.contour.frames.map((f) => [
      +f.t.toFixed(3),
      f.f0 === null ? null : +f.f0.toFixed(1),
    ]),
  };
  const name = `wild-echo-${payload.subject}-${current.id}-${state.attempt}.json`;
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
  setStatus(`Saved ${name} to your downloads. The audio stays here.`);
}

// --------------------------------------------------------------------- wire

el('call').addEventListener('change', changeCall);
el('play-ref').addEventListener('click', playReference);
el('record').addEventListener('click', toggleRecord);
el('compare').addEventListener('click', compare);
el('export').addEventListener('click', exportSession);
el('next-animal').addEventListener('click', nextAnimal);
window.addEventListener('resize', redraw);

fillCallPicker();
loadReference();
