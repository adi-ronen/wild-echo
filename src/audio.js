// Microphone capture, decode, downsample, playback.
// Nothing here leaves the machine. There is no upload path in this codebase.

import { ANALYSIS_RATE } from './pitch.js';

export async function recordClip(maxSeconds = 8) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  const chunks = [];
  const rec = new MediaRecorder(stream);
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);

  const done = new Promise((resolve) => {
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      resolve(new Blob(chunks, { type: rec.mimeType }));
    };
  });

  rec.start();
  const timer = setTimeout(() => rec.state === 'recording' && rec.stop(), maxSeconds * 1000);

  return {
    stop: () => { clearTimeout(timer); rec.state === 'recording' && rec.stop(); },
    blob: done,
  };
}

/**
 * Blob -> mono Float32Array at ANALYSIS_RATE.
 * OfflineAudioContext does the mixdown and the resample; doing it by hand would
 * be more code and worse.
 */
export async function toAnalysisSamples(blob) {
  const bytes = await blob.arrayBuffer();
  const tmp = new AudioContext();
  const decoded = await tmp.decodeAudioData(bytes);
  await tmp.close();
  return resample(decoded);
}

export async function resample(buffer) {
  const frames = Math.max(1, Math.ceil(buffer.duration * ANALYSIS_RATE));
  const off = new OfflineAudioContext(1, frames, ANALYSIS_RATE);
  const src = off.createBufferSource();
  src.buffer = buffer;
  src.connect(off.destination);
  src.start();
  const rendered = await off.startRendering();
  return rendered.getChannelData(0);
}

/** Play a list of AudioBuffers back to back, with a gap between them. */
export async function playSequence(buffers, gapSeconds = 0.35, onIndex = () => {}) {
  const ctx = new AudioContext();
  let at = ctx.currentTime + 0.1;
  buffers.forEach((buf, i) => {
    if (!buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(at);
    const startsIn = (at - ctx.currentTime) * 1000;
    setTimeout(() => onIndex(i), Math.max(0, startsIn));
    at += buf.duration + gapSeconds;
  });
  const total = (at - ctx.currentTime) * 1000;
  await new Promise((r) => setTimeout(r, total));
  await ctx.close();
}

export async function decodeToBuffer(blob) {
  const ctx = new AudioContext();
  const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
  await ctx.close();
  return buf;
}
