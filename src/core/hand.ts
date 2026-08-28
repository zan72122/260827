import { Rng } from './rng';

/** Wobbly, child-drawn strokes: no two envelopes carry the same hand. */
export interface Hand {
  line(x1: number, y1: number, x2: number, y2: number): void;
  poly(points: [number, number][], close?: boolean): void;
  circle(cx: number, cy: number, r: number): void;
  arc(cx: number, cy: number, r: number, a0: number, a1: number): void;
  fillPoly(points: [number, number][], color: string): void;
}

export function makeHand(
  ctx: CanvasRenderingContext2D,
  rng: Rng,
  wobble = 1.4,
  width = 3,
): Hand {
  const jitter = () => rng.range(-wobble, wobble);

  const stroke = (pts: [number, number][], close: boolean) => {
    ctx.lineWidth = width * rng.range(0.85, 1.18);
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const [x, y] = pts[i];
      const px = x + jitter();
      const py = y + jitter();
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    if (close) ctx.closePath();
    ctx.stroke();
  };

  const subdivide = (x1: number, y1: number, x2: number, y2: number): [number, number][] => {
    const n = Math.max(2, Math.round(Math.hypot(x2 - x1, y2 - y1) / 14));
    const out: [number, number][] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      out.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]);
    }
    return out;
  };

  return {
    line(x1, y1, x2, y2) {
      stroke(subdivide(x1, y1, x2, y2), false);
    },
    poly(points, close = false) {
      const dense: [number, number][] = [];
      for (let i = 0; i < points.length - 1; i++) {
        dense.push(...subdivide(points[i][0], points[i][1], points[i + 1][0], points[i + 1][1]));
      }
      if (close && points.length > 1) {
        dense.push(
          ...subdivide(
            points[points.length - 1][0],
            points[points.length - 1][1],
            points[0][0],
            points[0][1],
          ),
        );
      }
      stroke(dense, false);
    },
    circle(cx, cy, r) {
      this.arc(cx, cy, r, 0, Math.PI * 2);
    },
    arc(cx, cy, r, a0, a1) {
      const n = Math.max(8, Math.round((Math.abs(a1 - a0) * r) / 6));
      const pts: [number, number][] = [];
      for (let i = 0; i <= n; i++) {
        const a = a0 + (a1 - a0) * (i / n);
        pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
      }
      stroke(pts, false);
    },
    fillPoly(points, color) {
      const prev = ctx.fillStyle;
      ctx.fillStyle = color;
      ctx.beginPath();
      points.forEach(([x, y], i) => {
        const px = x + jitter() * 0.6;
        const py = y + jitter() * 0.6;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = prev;
    },
  };
}
