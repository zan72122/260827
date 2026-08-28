import { Rng } from '../core/rng';

/**
 * The special arctic cancellation of this fictional central office:
 * an invented six-point snow crystal over a mail sleigh, ringed by feed dashes.
 * Drawn as ink soaking into fibre - layered multiply passes, uneven pressure,
 * ragged edges. Never an emissive decal.
 */

const INK = '20,33,58';

function ring(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, lw: number): void {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.lineWidth = lw;
  ctx.stroke();
}

function drawDevice(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  ring(ctx, cx, cy, r * 0.96, r * 0.09);
  ring(ctx, cx, cy, r * 0.8, r * 0.045);

  // feed dashes around the rim
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    ctx.beginPath();
    ctx.lineWidth = r * 0.05;
    ctx.moveTo(cx + Math.cos(a) * r * 0.83, cy + Math.sin(a) * r * 0.83);
    ctx.lineTo(cx + Math.cos(a) * r * 0.91, cy + Math.sin(a) * r * 0.91);
    ctx.stroke();
  }

  // snow crystal, upper half
  const scy = cy - r * 0.24;
  const arm = r * 0.42;
  ctx.lineWidth = r * 0.055;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const ax = Math.cos(a) * arm;
    const ay = Math.sin(a) * arm;
    ctx.beginPath();
    ctx.moveTo(cx, scy);
    ctx.lineTo(cx + ax, scy + ay);
    ctx.stroke();
    // barbs
    for (const t of [0.5, 0.78]) {
      const bx = cx + ax * t;
      const by = scy + ay * t;
      const spread = arm * 0.22 * (1 - t + 0.35);
      for (const s of [-1, 1]) {
        const ba = a + s * 0.9;
        ctx.beginPath();
        ctx.lineWidth = r * 0.04;
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + Math.cos(ba) * spread, by + Math.sin(ba) * spread);
        ctx.stroke();
      }
    }
  }

  // mail sleigh, lower half
  const sy = cy + r * 0.42;
  ctx.lineWidth = r * 0.06;
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.42, sy + r * 0.12);
  ctx.lineTo(cx + r * 0.3, sy + r * 0.12);
  ctx.quadraticCurveTo(cx + r * 0.5, sy + r * 0.12, cx + r * 0.46, sy - r * 0.02);
  ctx.stroke();
  // body (a mail chest on the runners)
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.3, sy + r * 0.06);
  ctx.lineTo(cx - r * 0.3, sy - r * 0.14);
  ctx.lineTo(cx + r * 0.16, sy - r * 0.14);
  ctx.lineTo(cx + r * 0.16, sy + r * 0.06);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.3, sy - r * 0.05);
  ctx.lineTo(cx + r * 0.16, sy - r * 0.05);
  ctx.stroke();
  // front upsweep
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.3, sy + r * 0.12);
  ctx.lineTo(cx - r * 0.44, sy - r * 0.02);
  ctx.stroke();
}

/** Stamp the mark into a face canvas, ink soaking outwards from the pressure points. */
export function drawPostmarkInk(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  seed: number,
  pressure = 1,
): void {
  const rng = new Rng(seed);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rng.range(-0.11, 0.11));
  ctx.translate(-cx, -cy);
  ctx.globalCompositeOperation = 'multiply';

  // pressure is never even across a hand-pulled lever: one side bites harder
  const lean = rng.range(-1, 1);

  // soaked halo first, then the crisp bite
  const passes: [number, number, number][] = [
    [0.3 * pressure, 1.35, 1.6],
    [0.55 * pressure, 1.06, 0.7],
    [0.85 * pressure, 1.0, 0],
    [0.8 * pressure, 0.995, 0],
  ];
  for (const [alpha, scale, blur] of passes) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = `rgba(${INK},1)`;
    if (blur > 0) {
      ctx.shadowColor = `rgba(${INK},0.5)`;
      ctx.shadowBlur = blur * r * 0.06;
    }
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cy);
    drawDevice(ctx, cx, cy, r);
    ctx.restore();
  }

  // uneven contact: lift ink off one edge
  ctx.globalCompositeOperation = 'multiply';
  for (let i = 0; i < 90; i++) {
    const a = rng.range(0, Math.PI * 2);
    const rr = r * Math.sqrt(rng.next()) * 1.02;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    ctx.globalAlpha = rng.range(0.03, 0.12) * pressure * (0.6 + 0.4 * (Math.cos(a) * lean + 1) * 0.5);
    ctx.fillStyle = `rgba(${INK},1)`;
    ctx.beginPath();
    ctx.arc(x, y, rng.range(0.4, 1.7), 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}

/** Relief map for the rubber die itself, so the face reads as cut rubber. */
export function drawDieRelief(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.fillStyle = '#2b2926';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#b9b2a4';
  ctx.save();
  drawDevice(ctx, size / 2, size / 2, size * 0.42);
  ctx.restore();
}
