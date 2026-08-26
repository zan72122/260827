import * as THREE from 'three';
import { M } from '../materials';
import { rnd } from '../textures';

/**
 * Rubber strip curtain: strips hinge at the header and are dragged over the
 * bag as a pure function of the bag's arc-length distance to the curtain
 * plane — fully scrubbable in both directions, no timeline.
 */
export interface StripCurtain {
  group: THREE.Group;
  /** d = bagS - curtainS (meters along path) */
  update(d: number): void;
}

export function stripCurtain(
  width: number,
  height: number,
  opts: { stripW?: number; maxAngle?: number; frame?: boolean; mat?: THREE.Material } = {},
): StripCurtain {
  const { stripW = 0.1, maxAngle = 1.15, frame = true, mat = M.rubberStrip } = opts;
  const group = new THREE.Group();
  const strips: { pivot: THREE.Group; off: number; phase: number }[] = [];
  const n = Math.floor(width / (stripW + 0.012));
  const geo = new THREE.BoxGeometry(0.008, height, stripW);
  for (let i = 0; i < n; i++) {
    const pivot = new THREE.Group();
    const z = -width / 2 + (stripW + 0.012) * (i + 0.5);
    pivot.position.set(0, height, z);
    const strip = new THREE.Mesh(geo, mat);
    strip.position.y = -height / 2;
    strip.castShadow = true;
    pivot.add(strip);
    group.add(pivot);
    strips.push({ pivot, off: Math.abs(z), phase: rnd() * 0.5 });
  }
  if (frame) {
    const header = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, width + 0.24), M.beltFrame);
    header.position.y = height + 0.06;
    group.add(header);
    for (const sz of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.07, height + 0.12, 0.07), M.beltFrame);
      post.position.set(0, (height + 0.12) / 2, (width / 2 + 0.09) * sz);
      group.add(post);
    }
  }
  const halfContact = 0.55; // bag half length + slack
  return {
    group,
    update(d: number) {
      // asymmetric bell: rises as the bag nose arrives, holds during pass,
      // relaxes after the tail clears
      let base = 0;
      if (d > -halfContact && d < halfContact + 0.45) {
        if (d < 0) base = 1 - Math.pow(-d / halfContact, 1.6);
        else if (d < halfContact * 0.6) base = 1;
        else base = Math.max(0, 1 - (d - halfContact * 0.6) / 0.75);
      }
      for (const s of strips) {
        const reach = Math.max(0, 1 - s.off / 0.45); // strips near the bag line deflect most
        const a = maxAngle * base * (0.25 + 0.75 * reach) * (1 - s.phase * 0.25);
        s.pivot.rotation.z = a;
      }
    },
  };
}
