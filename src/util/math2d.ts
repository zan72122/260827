// 2D平面（XZ平面）用の軽量ベクトル演算。すべて {x, z} の素朴なオブジェクト。

export interface P2 { x: number; z: number; }

export const p2 = (x: number, z: number): P2 => ({ x, z });
export const sub = (a: P2, b: P2): P2 => ({ x: a.x - b.x, z: a.z - b.z });
export const add = (a: P2, b: P2): P2 => ({ x: a.x + b.x, z: a.z + b.z });
export const scale = (a: P2, s: number): P2 => ({ x: a.x * s, z: a.z * s });
export const len = (a: P2): number => Math.hypot(a.x, a.z);
export const dist = (a: P2, b: P2): number => Math.hypot(a.x - b.x, a.z - b.z);
export const lerp2 = (a: P2, b: P2, t: number): P2 => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
export const norm = (a: P2): P2 => {
  const l = len(a) || 1;
  return { x: a.x / l, z: a.z / l };
};
export const cross = (a: P2, b: P2): number => a.x * b.z - a.z * b.x;
export const dot2 = (a: P2, b: P2): number => a.x * b.x + a.z * b.z;

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

// 線分交差。交差時は [t, u] （各線分内のパラメータ 0..1）を返す。
export function segIntersect(a1: P2, a2: P2, b1: P2, b2: P2): [number, number] | null {
  const r = sub(a2, a1);
  const s = sub(b2, b1);
  const denom = cross(r, s);
  if (Math.abs(denom) < 1e-12) return null;
  const qp = sub(b1, a1);
  const t = cross(qp, s) / denom;
  const u = cross(qp, r) / denom;
  if (t <= 1e-6 || t >= 1 - 1e-6 || u <= 1e-6 || u >= 1 - 1e-6) return null;
  return [t, u];
}

// 決定的な擬似乱数（seed付き）。再プレイ間で機体の汚れ等を固定するため。
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 1D value noise（滑らか・周期なし）
export function makeNoise1D(seed: number): (x: number) => number {
  const rnd = mulberry32(seed);
  const grid: number[] = [];
  for (let i = 0; i < 256; i++) grid.push(rnd() * 2 - 1);
  return (x: number) => {
    const xi = Math.floor(x);
    const xf = x - xi;
    const a = grid[((xi % 256) + 256) % 256];
    const b = grid[(((xi + 1) % 256) + 256) % 256];
    const t = xf * xf * (3 - 2 * xf);
    return a + (b - a) * t;
  };
}
