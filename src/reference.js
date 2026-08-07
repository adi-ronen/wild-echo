// The reference calls a person imitates.
//
// As of 2026-07-29 there are three, all REAL and all CC0, each licence read off
// that recording's own page at the source — per file, never per site. See
// assets/manifest.json and ASSETS.md.
//
// They are ordered by shape on purpose: a line that goes up, a line that stays
// flat, a line that drops at the end. Kill-line #1B asks an outside grader to
// match unlabelled contours against these three, so three references that all
// drew the same shape would be testing the grader's patience rather than the
// route.
//
// The synthesized howl that stood here before is kept below as a fallback, and
// only as a fallback: if the audio file fails to load, the app says so in the
// interface rather than quietly substituting an oscillator for an animal. A
// person imitating a synthesizer is imitating a synthesizer, and any number
// taken from that measures the wrong thing.

export const REFERENCES = [
  {
    id: 'black-throated-loon-XC803905',
    kind: 'file',
    url: new URL('../assets/audio/black-throated-loon-XC803905-clip.wav', import.meta.url).href,
    animal: 'Black-throated loon',
    species: 'Gavia arctica',
    label: 'Black-throated loon (Gavia arctica) — real recording',
    synthesized: false,
    credit: 'Grégoire Chauvot, XC803905, xeno-canto.org/803905, CC0 1.0',
    // What the recording is, said plainly, so nobody has to infer it from a
    // filename: one call trimmed out of a longer bout on a lake at night.
    note: 'One call, trimmed from a longer recording made on a Swedish lake in May.',
    // Measured from the shipped clip by src/pitch.js, not asserted by hand.
    shape: 'rises about an octave in one smooth bend',
  },
  {
    id: 'whooper-swan-XC803772',
    kind: 'file',
    url: new URL('../assets/audio/whooper-swan-XC803772-clip.wav', import.meta.url).href,
    animal: 'Whooper swan',
    species: 'Cygnus cygnus',
    label: 'Whooper swan (Cygnus cygnus) — real recording',
    synthesized: false,
    credit: 'Grégoire Chauvot, XC803772, xeno-canto.org/803772, CC0 1.0',
    note: 'One note of a flight call, trimmed from a longer recording made in northern Norway in May.',
    shape: 'holds one note nearly flat',
  },
  {
    id: 'common-wood-pigeon-XC1107845',
    kind: 'file',
    url: new URL('../assets/audio/common-wood-pigeon-XC1107845-clip.wav', import.meta.url).href,
    animal: 'Common wood pigeon',
    species: 'Columba palumbus',
    label: 'Common wood pigeon (Columba palumbus) — real recording',
    synthesized: false,
    credit: 'Sonothèque ADVL, XC1107845, xeno-canto.org/1107845, CC0 1.0',
    note: 'One coo, trimmed from a longer song recorded in Normandy at dawn in March.',
    shape: 'holds, then drops most of an octave at the end',
    // Shown to testers on this call's screen only. A real wood pigeon coos in a
    // series and this clip is one coo out of that series. The corpus probe found
    // people imitating a pigeon produced a median of six separate bursts and 0
    // of 19 cleared condition A, so the mismatch is named out loud on the screen
    // rather than hoped away. It is a sentence, not a second reference.
    testerNote: 'A real wood pigeon coos over and over. This clip is one single coo. Copy this one coo, not the whole series.',
  },
];

// Prototype only. Same three calls, longer loon — Noam's re-cut order after the
// cheap tier (2026-08-03), loon first. The tester (tester/tester.js) keeps
// importing REFERENCES above and stays on the short clip: kill-line #1 runs
// through 2026-08-14 and changing a tester's clip mid-run breaks comparability
// with the takes already collected against it. Swan and pigeon are untouched.
export const PROTOTYPE_REFERENCES = REFERENCES.map((ref) =>
  ref.id === 'black-throated-loon-XC803905'
    ? {
        ...ref,
        id: 'black-throated-loon-XC803905-long',
        url: new URL('../assets/audio/black-throated-loon-XC803905-long-clip.wav', import.meta.url).href,
        note: 'One continuous wail, 3.81 s, trimmed from a longer recording made on a Swedish lake in May.',
        // Measured 2026-08-07 by this repo's own src/pitch.js over the shipped clip.
        shape: 'rises 1.4 octaves overall across 3.2 octaves of range, with several turns rather than one smooth bend',
      }
    : ref
);

// Fallback only. Never a silent substitute for a real call — see the header.
export const SYNTH_FALLBACK = {
  id: 'placeholder-howl',
  kind: 'synth',
  animal: 'Nothing',
  label: 'Synthesized placeholder — not an animal',
  synthesized: true,
  seconds: 3.4,
  // [time fraction, frequency Hz] — a slow rise, a long held top, a slow fall.
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

/**
 * Load a reference to an AudioBuffer.
 * Throws if a file-backed reference cannot be fetched or decoded. The caller
 * surfaces that; it does not paper over it.
 */
export async function loadReferenceBuffer(ref) {
  if (ref.kind === 'synth') return renderSynth(ref);

  const res = await fetch(ref.url);
  if (!res.ok) throw new Error(`reference audio ${ref.id}: HTTP ${res.status}`);
  const bytes = await res.arrayBuffer();
  const ctx = new AudioContext();
  try {
    return await ctx.decodeAudioData(bytes);
  } finally {
    await ctx.close();
  }
}

/** Render the synthesized fallback to an AudioBuffer. */
export async function renderSynth(ref = SYNTH_FALLBACK, sampleRate = 44100) {
  const n = Math.round(ref.seconds * sampleRate);
  const off = new OfflineAudioContext(1, n, sampleRate);
  const buf = off.createBuffer(1, n, sampleRate);
  const ch = buf.getChannelData(0);

  let phase = 0;
  for (let i = 0; i < n; i++) {
    const frac = i / n;
    const f = freqAt(ref.points, frac);
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

function freqAt(points, frac) {
  for (let i = 1; i < points.length; i++) {
    if (frac <= points[i][0]) {
      const [t0, f0] = points[i - 1], [t1, f1] = points[i];
      const u = (frac - t0) / (t1 - t0 || 1);
      const eased = u * u * (3 - 2 * u); // smoothstep, no corners in the pitch
      return f0 * Math.pow(f1 / f0, eased); // interpolate in log-frequency
    }
  }
  return points[points.length - 1][1];
}

function envelope(frac) {
  const attack = Math.min(1, frac / 0.06);
  const release = Math.min(1, (1 - frac) / 0.12);
  return attack * release;
}
