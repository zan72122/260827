import { describe, expect, it } from 'vitest';
import {
  LEAF_ENTRY_TRAVEL,
  leafEdgesAt,
  leafJoint,
  leafSlots,
  maxDiameterMM,
  spec,
  starJoint,
  totalHeightMM,
  trunkFaceRadius,
  trunkTopY,
  TRUNK_FACES,
} from '../../src/design/treeSpec';

const slots = leafSlots();

describe('the tree as designed', () => {
  it('is the size it says it is', () => {
    expect(totalHeightMM).toBeGreaterThan(430);
    expect(totalHeightMM).toBeLessThan(470);
    expect(maxDiameterMM).toBeGreaterThan(225);
    expect(maxDiameterMM).toBeLessThan(255);
    expect(spec.leaf.thickness).toBeCloseTo(5, 6);
  });

  it('has sixteen leaf boards, four to a tier, on alternating faces', () => {
    expect(slots.length).toBe(16);
    for (let tier = 0; tier < 4; tier++) {
      const inTier = slots.filter((s) => s.tier === tier);
      expect(inTier.length).toBe(4);
      const faces = new Set(inTier.map((s) => s.face));
      expect(faces.size).toBe(4);
      for (const f of faces) expect(f % 2).toBe(spec.tiers[tier].faceParity);
      expect(Math.max(...inTier.map((s) => s.face))).toBeLessThan(TRUNK_FACES);
    }
    // consecutive tiers are half a face apart
    expect(spec.tiers[0].faceParity).not.toBe(spec.tiers[1].faceParity);
  });

  it('gives every board one straight, horizontal insertion axis', () => {
    for (const slot of slots) {
      const j = leafJoint(slot);
      const [ax, ay, az] = j.axis;
      expect(ay).toBe(0); // horizontal
      expect(Math.hypot(ax, ay, az)).toBeCloseTo(1, 9);
      // the axis points from outside towards the trunk's axis
      const outward = Math.hypot(j.seated[0], j.seated[2]);
      expect(outward).toBeCloseTo(trunkFaceRadius, 6);
      expect(ax * j.seated[0] + az * j.seated[2]).toBeLessThan(0);
      // the entry is outside the seated point by exactly the travel
      expect(Math.hypot(j.entry[0] - j.seated[0], j.entry[2] - j.seated[2])).toBeCloseTo(
        LEAF_ENTRY_TRAVEL,
        6,
      );
      expect(Math.hypot(j.entry[0], j.entry[2])).toBeGreaterThan(trunkFaceRadius);
      expect(j.entry[1]).toBe(j.seated[1]);
    }
  });

  it('cuts a groove that the board actually fits, with clearance but not slop', () => {
    const m = spec.trunk.mortise;
    expect(m.width).toBeGreaterThan(spec.leaf.thickness);
    expect(m.width - spec.leaf.thickness).toBeLessThanOrEqual(0.4);
    expect(m.height).toBeGreaterThan(spec.leaf.tenonHeight);
    // the tenon does not bottom out in the groove: the shoulder is what stops it
    expect(m.depth).toBeGreaterThan(spec.leaf.tenonLength);
    // the groove is a pocket in one octagon face, so it has to fit on that face
    const faceWidth = 2 * trunkFaceRadius * Math.tan(Math.PI / TRUNK_FACES);
    expect(m.width).toBeLessThan(faceWidth - 4);
    // opposing pockets do not meet in the middle of the post
    expect(2 * m.depth).toBeLessThan(spec.trunk.acrossFlats - 8);
  });

  it('keeps the tiers clear of each other and of the pot', () => {
    const potRim = spec.pot.rimDia / 2;
    for (const slot of slots) {
      for (let u = 0; u <= slot.span; u += slot.span / 24) {
        const e = leafEdgesAt(slot, u)!;
        const radius = trunkFaceRadius + u;
        // the bottom tier passes over the pot's rim without touching it
        if (radius <= potRim) {
          expect(e.bottom).toBeGreaterThan(2);
        }
        // no tier reaches into the one above or below it
        for (const other of slots) {
          if (other.tier === slot.tier) continue;
          const oe = leafEdgesAt(other, u);
          if (!oe) continue;
          const overlap = Math.min(e.top, oe.top) - Math.max(e.bottom, oe.bottom);
          expect(overlap).toBeLessThan(0);
        }
      }
    }
  });

  it('drops the star straight down into a stopped slot in the top of the trunk', () => {
    const j = starJoint();
    expect(j.axis).toEqual([0, -1, 0]);
    expect(j.seated[1]).toBe(trunkTopY);
    expect(j.entry[1]).toBeGreaterThan(j.seated[1]);
    // the star's tenon fits the slot, and the slot does not go through the post
    expect(spec.trunk.starSlot.width).toBeGreaterThan(spec.star.thickness);
    expect(spec.trunk.starSlot.depth).toBeGreaterThanOrEqual(spec.star.tenonLength);
    expect(spec.trunk.starSlot.length).toBeLessThan(spec.trunk.acrossFlats);
  });

  it('carries the tree on the pot, not on nothing', () => {
    // the axle is a running fit in the bushing, not a press fit
    const clearance = spec.pot.bushingBore - spec.trunk.axleDia;
    expect(clearance).toBeGreaterThan(0.1);
    expect(clearance).toBeLessThan(1);
    // the axle does not reach the floor of the bore: the shoulder takes the load
    expect(spec.trunk.axleLength + spec.trunk.axleEndClearance).toBeLessThanOrEqual(
      spec.pot.bushingDepth,
    );
    // and the shoulder actually lands on the thrust washer
    expect(spec.trunk.collarDia).toBeGreaterThan(spec.pot.bushingBore);
    expect(spec.pot.washerOuter).toBeGreaterThan(spec.pot.bushingBore);
    expect(spec.pot.washerOuter).toBeLessThan(spec.trunk.collarDia + 6);
  });
});
