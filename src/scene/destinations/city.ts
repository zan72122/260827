import * as THREE from 'three';
import type { DestinationModule } from '../DestinationSymbol';
import { makeHand } from '../../core/hand';

export const destination: DestinationModule = {
  id: 'city',
  mapUv: [0.46, 0.55],
  accent: 0x6c6a5c,

  drawPictogram(ctx, w, h, rng, ink) {
    const hand = makeHand(ctx, rng, w * 0.012, w * 0.035);
    ctx.strokeStyle = ink;
    ctx.lineCap = 'round';
    const baseY = h * 0.88;

    const towers: [number, number, number][] = [
      [0.08, 0.56, 0.18],
      [0.28, 0.3, 0.2],
      [0.5, 0.44, 0.16],
      [0.68, 0.2, 0.14],
      [0.84, 0.52, 0.14],
    ];
    for (const [x, top, tw] of towers) {
      hand.poly(
        [
          [w * x, baseY],
          [w * x, h * top],
          [w * (x + tw), h * top],
          [w * (x + tw), baseY],
        ],
        false,
      );
      // a couple of windows each
      for (let r = 0; r < 2; r++) {
        const wy = h * (top + 0.09 + r * 0.13);
        if (wy < baseY - h * 0.05) {
          hand.line(w * (x + tw * 0.25), wy, w * (x + tw * 0.75), wy);
        }
      }
    }
    hand.line(w * 0.02, baseY, w * 0.98, baseY);
  },

  buildSymbol(mats) {
    const g = new THREE.Group();
    const blocks: [number, number, number, number][] = [
      [-0.14, 0.16, 0.06, 0],
      [-0.05, 0.3, 0.07, -0.02],
      [0.05, 0.22, 0.065, 0.03],
      [0.15, 0.13, 0.055, -0.01],
    ];
    for (const [x, hgt, wd, z] of blocks) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(wd, hgt, wd * 0.9), mats.paintedCream);
      m.position.set(x, hgt / 2, z);
      g.add(m);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(wd * 1.12, 0.012, wd), mats.steelPainted);
      cap.position.set(x, hgt + 0.006, z);
      g.add(cap);
    }
    const plaza = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.014, 0.16), mats.woodDark);
    plaza.position.y = 0.007;
    g.add(plaza);
    return g;
  },
};
