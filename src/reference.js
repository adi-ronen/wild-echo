// The reference call the person imitates.
//
// HONEST LABEL, READ THIS BEFORE USING ANY NUMBER OUT OF THIS PROTOTYPE:
// the call below is SYNTHESIZED. It is not a wolf. It is an oscillator following
// a hand-written pitch contour that has roughly the shape of a howl. It exists
// so the prototype runs today without shipping audio whose licence has not been
// verified — hard rule 2 — and it is enough to test the pitch tracker, the
// canvas, the playback and the metrics.
//
// It is NOT enough to run kill-line #1. A person imitating a synthesizer is
// imitating a synthesizer. The 30-recording run needs a real, licence-verified
// animal recording with a complete manifest row, or the result measures the
// wrong thing. See assets/manifest.json and ASSETS.md.

export const REFERENCE = {
  id: 'placeholder-howl',
  label: 'Placeholder howl (synthesized — not a wolf)',
  synthesized: true,
  seconds: 3.4,
  // [time fraction, frequency Hz] — a slow rise, a long held top, a slow fall.
  // The shape a wolf howl has; none of the timbre a wolf howl has.
  points: [
    [0.00, 180],
    [0.08, 300],
    [0.18, 430],
    [0.30, 470],
    [0.55, 455],
    [0.72, 400],
    [0.88, 280],
    [1.00, 200],
  ],
};

/** Render the reference to an AudioBuffer at the given context's rate. */
export function renderReference(sampleRate = 44100) {
  const n = Math.round(REFERENCE.seconds * sampleRate);
  const off = new OfflineAudioContext(1, n, sampleRate);
  const buf = off.createBuffer(1, n, sampleRate);
  const ch = buf.getChannelData(0);

  let phase = 0;
  for (let i = 0; i < n; i++) {
    const frac = i / n;
    const f = freqAt(frac);
    phase += (2 * Math.PI * f) / sampleRate;
    // A few harmonics so it is audible as a voice-like tone rather than a beep.
    const s = Math.sin(phase) + 0.35 * Math.sin(2 * phase) + 0.12 * Math.sin(3 * phase);
    ch[i] = s * 0.28 * envelope(frac);
  }

  const src = off.createBufferSource();
  src.buffer = buf;
  src.connect(off.destination);
  src.start();
  return off.startRendering();
}

function freqAt(frac) {
  const p = REFERENCE.points;
  for (let i = 1; i < p.length; i++) {
    if (frac <= p[i][0]) {
      const [t0, f0] = p[i - 1], [t1, f1] = p[i];
      const u = (frac - t0) / (t1 - t0 || 1);
      const eased = u * u * (3 - 2 * u); // smoothstep, no corners in the pitch
      return f0 * Math.pow(f1 / f0, eased); // interpolate in log-frequency
    }
  }
  return p[p.length - 1][1];
}

function envelope(frac) {
  const attack = Math.min(1, frac / 0.06);
  const release = Math.min(1, (1 - frac) / 0.12);
  return attack * release;
}
