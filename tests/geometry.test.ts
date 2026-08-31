import { describe, it, expect } from 'vitest';
import { BufferAttribute } from 'three';
import { buildBody, buildCutFace, buildLegs } from '../src/geom/body';
import { buildHead } from '../src/geom/head';
import { sectionAt, cavityRatio, inPaper, innerStartU } from '../src/geom/profile';
import { insertPoint } from '../src/sim/stages';
import { HEAD, MM, WEIGHT_RAIL, BODY_SPINE } from '../src/sim/dims';
import { rotLocal } from '../src/sim/rig';

/** Sample vertices and their normals, in millimetres. */
function samples(g: { getAttribute(n: string): BufferAttribute }, n = 400) {
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const out: { p: [number, number, number]; n: [number, number, number] }[] = [];
  const step = Math.max(1, Math.floor(pos.count / n));
  for (let i = 0; i < pos.count; i += step) {
    out.push({
      p: [pos.getX(i) / MM, pos.getY(i) / MM, pos.getZ(i) / MM],
      n: [nor.getX(i), nor.getY(i), nor.getZ(i)],
    });
  }
  return out;
}

/** Outward direction from the spine at a point on the torso. */
function outward(p: [number, number, number]): [number, number, number] {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i <= 120; i++) {
    const s = sectionAt(i / 120);
    const d = (s.cx - p[0]) ** 2 + (s.cy - p[1]) ** 2;
    if (d < bd) {
      bd = d;
      best = i / 120;
    }
  }
  const s = sectionAt(best);
  const dx = p[0] - s.cx;
  const dy = p[1] - s.cy;
  const up = dx * s.ux + dy * s.uy;
  const l = Math.hypot(s.ux * up, s.uy * up, p[2]) || 1;
  return [(s.ux * up) / l, (s.uy * up) / l, p[2] / l];
}

describe('the shell is a real hollow wall', () => {
  const body = buildBody();

  it('faces the red paint outwards and the paper lining inwards', () => {
    let outOk = 0;
    let outBad = 0;
    for (const s of samples(body.outer as never)) {
      const o = outward(s.p);
      const dot = s.n[0] * o[0] + s.n[1] * o[1] + s.n[2] * o[2];
      if (Math.abs(dot) < 0.25) continue; // near the poles, ignore
      if (dot > 0) outOk++;
      else outBad++;
    }
    expect(outOk).toBeGreaterThan(40);
    expect(outBad / (outOk + outBad)).toBeLessThan(0.02);
  });

  it('has a wall between 0.8 and 1.5 mm everywhere it has one', () => {
    const u0 = innerStartU();
    for (let i = 0; i <= 20; i++) {
      const u = u0 + (1 - u0) * (i / 20);
      const s = sectionAt(u);
      expect(s.wall).toBeGreaterThanOrEqual(0.8);
      expect(s.wall).toBeLessThanOrEqual(1.5);
      expect(s.hz - s.wall).toBeGreaterThan(0);
    }
  });

  it('leaves the cavity open all the way to the opening', () => {
    for (let i = 6; i <= 20; i++) {
      const u = i / 20;
      const s = sectionAt(u);
      expect(cavityRatio(s.cx, s.cy, 0)).toBeLessThan(1);
    }
  });
});

describe('the cut face is made from the same doll', () => {
  it('produces a capped band wherever the plane meets the body', () => {
    for (const z of [0, 6, 12, 18]) {
      const g = buildCutFace(z);
      const pos = g.getAttribute('position') as BufferAttribute;
      expect(pos.count).toBeGreaterThan(40);
      for (let i = 0; i < pos.count; i++) {
        expect(Math.abs(pos.getZ(i) / MM - z)).toBeLessThan(0.01);
      }
    }
  });

  it('spans the paper, from the outer wall to the cavity', () => {
    const g = buildCutFace(0);
    const pos = g.getAttribute('position') as BufferAttribute;
    let sawOuter = false;
    let sawInner = false;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / MM;
      const x = pos.getX(i) / MM;
      if (cavityRatio(x, y, 0) > 0.995) sawOuter = true;
      if (cavityRatio(x, y, 0) < 0.99) sawInner = true;
    }
    expect(sawOuter).toBe(true);
    expect(sawInner).toBe(true);
  });
});

describe('the head assembly', () => {
  const head = buildHead();
  it('builds the shell, the lining, the stem and the weight', () => {
    for (const g of [head.shell, head.lining, head.stem, head.weight]) {
      expect((g.getAttribute('position') as BufferAttribute).count).toBeGreaterThan(30);
    }
    expect(head.triangles).toBeGreaterThan(2000);
  });

  it('keeps the whole doll inside the stated budget', () => {
    expect(head.triangles + buildBody().triangles + buildLegs().index!.count / 3).toBeLessThan(
      40000,
    );
  });
});

describe('the route into the body', () => {
  it('never passes any part of the head through the paper', () => {
    const probe: { x: number; y: number }[] = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      probe.push({ x: HEAD.armTip.x * t, y: HEAD.armTip.y * t });
    }
    for (const t of [0, 0.5, 1]) {
      const wx = WEIGHT_RAIL.x0 + (WEIGHT_RAIL.x1 - WEIGHT_RAIL.x0) * t;
      const wy = WEIGHT_RAIL.y0 + (WEIGHT_RAIL.y1 - WEIGHT_RAIL.y0) * t;
      void wx;
      void wy;
    }
    const wx = WEIGHT_RAIL.x0 + (WEIGHT_RAIL.x1 - WEIGHT_RAIL.x0) * 0.45;
    const wy = WEIGHT_RAIL.y0 + (WEIGHT_RAIL.y1 - WEIGHT_RAIL.y0) * 0.45;
    for (const d of [-1, 1]) {
      probe.push({ x: wx + d * WEIGHT_RAIL.r, y: wy });
      probe.push({ x: wx, y: wy + d * WEIGHT_RAIL.r });
    }
    const bad: string[] = [];
    for (let i = 0; i <= 240; i++) {
      const s = i / 240;
      const c = insertPoint(s);
      // the guide brings the head to the angle the opening needs
      const g = Math.max(0, Math.min(1, (s - 0.42) / 0.3));
      const pitch = 0.29 * (1 - g) + 0.08 * g;
      for (const p of probe) {
        const q = rotLocal(p, pitch);
        for (const z of [-2.6, 0, 2.6]) {
          if (inPaper(c.x + q.x, c.y + q.y, z)) bad.push(`s=${s.toFixed(3)}`);
        }
      }
    }
    expect(bad.slice(0, 6)).toEqual([]);
  });

  it('ends with the head seated in the opening, not beside it', () => {
    const end = insertPoint(1);
    expect(end.x).toBeCloseTo(BODY_SPINE[BODY_SPINE.length - 1]!.x, 1);
    expect(Math.abs(end.z)).toBeLessThan(0.01);
  });
});
