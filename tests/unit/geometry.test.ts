import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { MM } from '../../src/core/units';
import {
  spec,
  trunkFaceRadius,
  trunkTopY,
  leafSlots,
} from '../../src/design/treeSpec';
import {
  buildLeafGeometry,
  buildStarGeometry,
  buildTrunkGeometry,
  leafOutline,
} from '../../src/render/parts';

const mm = (v: number) => v / MM;

describe('the boards as built', () => {
  it('makes a rigid 5 mm board with a tenon of the stated length', () => {
    const span = spec.tiers[0].span;
    const g = buildLeafGeometry(span);
    const b = g.boundingBox!;
    const thickness = mm(b.max.z - b.min.z);
    expect(thickness).toBeCloseTo(spec.leaf.thickness, 4);
    // the tenon sticks out behind the shoulder by exactly the tenon length
    expect(mm(b.min.x)).toBeCloseTo(-spec.leaf.tenonLength, 3);
    expect(mm(b.max.x)).toBeCloseTo(span, 3);
    // and it is no taller than the root of the board
    expect(mm(b.max.y)).toBeLessThanOrEqual(spec.leaf.rootHalfHeight + 0.01);
  });

  it('cuts the tenon at exactly the mortise height, so it lands on the groove floor', () => {
    const pts = leafOutline(spec.tiers[0].span);
    const behind = pts.filter((p) => p.x < -0.01);
    expect(behind.length).toBeGreaterThan(0);
    for (const p of behind) {
      expect(Math.abs(p.y)).toBeCloseTo(spec.leaf.tenonHeight / 2, 6);
      expect(p.x).toBeCloseTo(-spec.leaf.tenonLength, 6);
    }
  });

  it('is the same board every time, so nothing is squashed to make it fit', () => {
    const a = buildLeafGeometry(spec.tiers[1].span).getAttribute('position').array;
    const b = buildLeafGeometry(spec.tiers[1].span).getAttribute('position').array;
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) expect(a[i]).toBeCloseTo(b[i], 9);
  });

  it('gives each tier its own board, not one board rescaled in place', () => {
    const spans = new Set(spec.tiers.map((t) => t.span));
    expect(spans.size).toBe(4);
  });
});

describe('the trunk as built', () => {
  const geo = buildTrunkGeometry();
  const pos = geo.getAttribute('position');

  it('has a real pocket at every one of the sixteen leaf positions', () => {
    const floorRadius = (trunkFaceRadius - spec.trunk.mortise.depth) * MM;
    let found = 0;
    for (const slot of leafSlots()) {
      const n = new THREE.Vector3(Math.sin(slot.yaw), 0, Math.cos(slot.yaw));
      const want = n.clone().multiplyScalar(floorRadius);
      let hit = false;
      for (let i = 0; i < pos.count; i++) {
        const y = mm(pos.getY(i));
        if (Math.abs(y - slot.height) > spec.trunk.mortise.height / 2 + 0.01) continue;
        const dx = pos.getX(i) - want.x;
        const dz = pos.getZ(i) - want.z;
        // a pocket floor corner sits half the mortise width to either side
        if (Math.hypot(dx, dz) <= (spec.trunk.mortise.width / 2 + 0.01) * MM) {
          hit = true;
          break;
        }
      }
      if (hit) found++;
    }
    expect(found).toBe(16);
  });

  it('never cuts deeper than the pocket depth', () => {
    const minRadius = (trunkFaceRadius - spec.trunk.mortise.depth) * MM - 1e-6;
    for (let i = 0; i < pos.count; i++) {
      const y = mm(pos.getY(i));
      if (y < spec.trunk.collarHeight - 0.01 || y > trunkTopY - spec.trunk.starSlot.depth - 0.01) {
        continue;
      }
      const r = Math.hypot(pos.getX(i), pos.getZ(i));
      expect(r).toBeGreaterThanOrEqual(minRadius);
    }
  });

  it('stops the star slot short of going through the post', () => {
    const floor = (trunkTopY - spec.trunk.starSlot.depth) * MM;
    let atFloor = 0;
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getY(i) - floor) < 1e-6) atFloor++;
    }
    expect(atFloor).toBeGreaterThan(0);
  });
});

describe('the star as built', () => {
  const { boardA, boardB } = buildStarGeometry();

  it('is two boards cross-lapped, each notched half way', () => {
    const w = (spec.star.thickness + 0.2) * MM;
    const inLapColumn = (g: THREE.BufferGeometry, above: boolean, axis: 'x' | 'z') => {
      const p = g.getAttribute('position');
      let n = 0;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i);
        const across = axis === 'x' ? p.getX(i) : p.getZ(i);
        if (Math.abs(across) < w / 2 - 1e-4 && (above ? y > 1e-4 : y < -1e-4)) n++;
      }
      return n;
    };
    // board A is cut away above the centre; board B is cut away below it
    expect(inLapColumn(boardA, true, 'x')).toBe(0);
    expect(inLapColumn(boardA, false, 'x')).toBeGreaterThan(0);
    expect(inLapColumn(boardB, false, 'z')).toBe(0);
    expect(inLapColumn(boardB, true, 'z')).toBeGreaterThan(0);
  });

  it('carries its tenon on board A only', () => {
    const low = (g: THREE.BufferGeometry) => mm(g.boundingBox!.min.y);
    boardA.computeBoundingBox();
    boardB.computeBoundingBox();
    expect(low(boardA)).toBeLessThan(-spec.star.height / 2 - spec.star.tenonLength + 1);
    expect(low(boardB)).toBeGreaterThan(-spec.star.height / 2 - 1);
  });
});
