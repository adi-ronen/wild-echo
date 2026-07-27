// Two pitch contours on one set of axes.
//
// y is log-frequency, because pitch is perceived in ratios: the distance from
// 200 to 400 Hz should look the same as 400 to 800.
// x is seconds since each trace's first voiced frame, so a person who waited
// half a second before howling still lands on top of the reference.

const F_LO = 70, F_HI = 1200;

export const COLORS = {
  reference: '#f0b429', // the animal
  you: '#3aa8c1',       // the person
  grid: '#2a2f3a',
  text: '#8b93a7',
  gap: '#4a2020',
};

export function drawTraces(canvas, traces) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const pad = { l: 46, r: 12, t: 14, b: 26 };
  const plotW = w - pad.l - pad.r;
  const plotH = h - pad.t - pad.b;

  const maxT = Math.max(1.5, ...traces.map((tr) => spanSeconds(tr)));

  drawGrid(ctx, pad, plotW, plotH, maxT);

  for (const tr of traces) {
    if (!tr || !tr.contour) continue;
    drawOne(ctx, tr, pad, plotW, plotH, maxT);
  }
}

function spanSeconds(tr) {
  if (!tr || !tr.contour) return 0;
  const v = tr.contour.frames.filter((f) => f.f0 !== null);
  if (!v.length) return 0;
  return v[v.length - 1].t - v[0].t;
}

function drawGrid(ctx, pad, plotW, plotH, maxT) {
  ctx.strokeStyle = COLORS.grid;
  ctx.fillStyle = COLORS.text;
  ctx.lineWidth = 1;
  ctx.font = '11px ui-monospace, monospace';

  for (const f of [100, 200, 400, 800]) {
    const y = pad.t + yFor(f, plotH);
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(pad.l + plotW, y);
    ctx.stroke();
    ctx.textAlign = 'right';
    ctx.fillText(`${f} Hz`, pad.l - 6, y + 4);
  }

  ctx.textAlign = 'center';
  const step = maxT <= 3 ? 0.5 : 1;
  for (let t = 0; t <= maxT + 1e-6; t += step) {
    const x = pad.l + (t / maxT) * plotW;
    ctx.beginPath();
    ctx.moveTo(x, pad.t);
    ctx.lineTo(x, pad.t + plotH);
    ctx.stroke();
    ctx.fillText(`${t.toFixed(step < 1 ? 1 : 0)}s`, x, pad.t + plotH + 17);
  }
}

function yFor(f, plotH) {
  const r = (Math.log2(f) - Math.log2(F_LO)) / (Math.log2(F_HI) - Math.log2(F_LO));
  return plotH * (1 - Math.min(1, Math.max(0, r)));
}

function drawOne(ctx, tr, pad, plotW, plotH, maxT) {
  const frames = tr.contour.frames;
  const voiced = frames.filter((f) => f.f0 !== null);
  if (!voiced.length) return;
  const t0 = voiced[0].t;

  ctx.strokeStyle = tr.color;
  ctx.lineWidth = tr.width || 2.5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Each voiced run is its own stroke. Unvoiced frames are a real break in the
  // line, not an interpolated guess — a gap in the trace is information.
  let pen = false;
  ctx.beginPath();
  for (const fr of frames) {
    if (fr.f0 === null) { pen = false; continue; }
    const x = pad.l + ((fr.t - t0) / maxT) * plotW;
    const y = pad.t + yFor(fr.f0, plotH);
    if (!pen) { ctx.moveTo(x, y); pen = true; } else { ctx.lineTo(x, y); }
  }
  ctx.stroke();
}
