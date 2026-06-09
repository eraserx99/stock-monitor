import { createCanvas } from '@napi-rs/canvas';

export function sparklinePNG(prices) {
  if (!prices || prices.length < 2) return null;

  const W = 80, H = 24, pad = 1;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const color = prices[prices.length - 1] >= prices[0] ? '#4ade80' : '#f87171';

  const xs = prices.map((_, i) => pad + (i / (prices.length - 1)) * (W - pad * 2));
  const ys = prices.map(p => H - pad - ((p - min) / range) * (H - pad * 2));

  ctx.beginPath();
  ctx.moveTo(xs[0], H);
  xs.forEach((x, i) => ctx.lineTo(x, ys[i]));
  ctx.lineTo(xs[xs.length - 1], H);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.12;
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.beginPath();
  xs.forEach((x, i) => i === 0 ? ctx.moveTo(x, ys[i]) : ctx.lineTo(x, ys[i]));
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();

  return canvas.toBuffer('image/png');
}

export function chartPNG(dailyChart) {
  if (!dailyChart?.closes?.length) return null;
  const { closes, ma50, ma200, vwap30 } = dailyChart;
  const n = closes.length;
  if (n < 2) return null;

  const W = 600, H = 90, padL = 2, padR = 2, padT = 5, padB = 5;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, W, H);

  const allVals = [
    ...closes,
    ...ma50.filter(v => v != null),
    ...ma200.filter(v => v != null),
    ...vwap30.filter(v => v != null),
  ];
  const yMin = Math.min(...allVals);
  const yMax = Math.max(...allVals);
  const yRange = yMax - yMin || 1;

  const toX = i => padL + (i / (n - 1)) * plotW;
  const toY = v => H - padB - ((v - yMin) / yRange) * plotH;

  const priceColor = closes[n - 1] >= closes[0] ? '#4ade80' : '#f87171';

  // Price area fill
  ctx.beginPath();
  ctx.moveTo(toX(0), H - padB);
  closes.forEach((c, i) => ctx.lineTo(toX(i), toY(c)));
  ctx.lineTo(toX(n - 1), H - padB);
  ctx.closePath();
  ctx.fillStyle = priceColor;
  ctx.globalAlpha = 0.08;
  ctx.fill();
  ctx.globalAlpha = 1;

  function drawSeries(series, color, lineWidth, dash) {
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = 'round';
    if (dash) ctx.setLineDash(dash);
    let inPath = false;
    series.forEach((v, i) => {
      if (v == null) {
        if (inPath) { ctx.stroke(); inPath = false; }
        return;
      }
      if (!inPath) { ctx.beginPath(); ctx.moveTo(toX(i), toY(v)); inPath = true; }
      else ctx.lineTo(toX(i), toY(v));
    });
    if (inPath) ctx.stroke();
    if (dash) ctx.setLineDash([]);
  }

  drawSeries(ma200, '#fb923c', 1, null);
  drawSeries(ma50, '#60a5fa', 1, null);
  drawSeries(vwap30, '#c084fc', 1, [3, 2]);

  ctx.beginPath();
  ctx.strokeStyle = priceColor;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  closes.forEach((c, i) => i === 0 ? ctx.moveTo(toX(i), toY(c)) : ctx.lineTo(toX(i), toY(c)));
  ctx.stroke();

  return canvas.toBuffer('image/png');
}
