import * as THREE from 'three';
import { BLANK, CHIP, ROW_COUNT, ROW_Y, blankRadius } from '../config';
import { ChipField } from './chipfield';
import type { ChipParams } from './chip';

/**
 * A Spanbaum the craftsman finished: same blank, same shavings, every row
 * complete. Used for the pieces standing on the shelf. One geometry, cloned.
 */
export function makeFinishedTree(wood: THREE.Material, shaving: THREE.Material, seed = 5): THREE.Group {
  const g = new THREE.Group();
  const pts: THREE.Vector2[] = [];
  for (let y = -0.02; y <= BLANK.height; y += 0.05) pts.push(new THREE.Vector2(Math.max(0.004, blankRadius(y)), y));
  pts.push(new THREE.Vector2(0.004, BLANK.height));
  const lathe = new THREE.LatheGeometry(pts, 28);
  const trunk = new THREE.Mesh(lathe, wood);
  trunk.castShadow = true; trunk.receiveShadow = true;
  g.add(trunk);

  const total = ROW_COUNT.reduce((a, b) => a + b, 0);
  const field = new ChipField(total, 22, 8, shaving);
  let k = 0;
  let a = seed >>> 0;
  const rnd = () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
  for (let r = 0; r < ROW_Y.length; r++) {
    for (let i = 0; i < ROW_COUNT[r]; i++) {
      const p: ChipParams = {
        yStart: ROW_Y[r], phi: (i * Math.PI * 2) / ROW_COUNT[r] + r * 0.21,
        length: CHIP.length, width: CHIP.width * (0.96 + rnd() * 0.07), depth: CHIP.depth,
        tipRadius: CHIP.tipRadius * (0.9 + rnd() * 0.2), curlOpen: CHIP.curlOpen, rake: CHIP.rake,
        skew: (rnd() - 0.5) * 0.16, cup: 0.045 + rnd() * 0.04,
      };
      field.set(k++, p, CHIP.length);
    }
  }
  field.commit();
  field.mesh.frustumCulled = true;
  field.mesh.geometry.computeBoundingSphere();
  g.add(field.mesh);
  return g;
}
