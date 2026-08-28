import * as THREE from 'three';
import type { DestinationModule } from '../DestinationSymbol';
import { makeHand } from '../../core/hand';

export const destination: DestinationModule = {
  id: 'snowvillage',
  mapUv: [0.68, 0.22],
  accent: 0x7d96a8,

  drawPictogram(ctx, w, h, rng, ink) {
    const hand = makeHand(ctx, rng, w * 0.012, w * 0.035);
    ctx.strokeStyle = ink;
    ctx.lineCap = 'round';
    const baseY = h * 0.84;

    const house = (x: number, s: number) => {
      hand.poly(
        [
          [x - w * 0.11 * s, baseY],
          [x - w * 0.11 * s, h * (0.84 - 0.24 * s)],
          [x + w * 0.11 * s, h * (0.84 - 0.24 * s)],
          [x + w * 0.11 * s, baseY],
        ],
        false,
      );
      hand.poly([
        [x - w * 0.15 * s, h * (0.84 - 0.24 * s)],
        [x, h * (0.84 - 0.44 * s)],
        [x + w * 0.15 * s, h * (0.84 - 0.24 * s)],
      ]);
      // snow lying on the roof
      hand.arc(x, h * (0.84 - 0.42 * s), w * 0.1 * s, Math.PI * 1.1, Math.PI * 1.9);
    };
    house(w * 0.3, 1);
    house(w * 0.72, 0.78);

    hand.line(w * 0.03, baseY, w * 0.97, baseY);
    // falling flakes
    for (let i = 0; i < 4; i++) {
      const fx = w * (0.12 + i * 0.22);
      const fy = h * (0.16 + (i % 2) * 0.1);
      hand.line(fx - w * 0.025, fy, fx + w * 0.025, fy);
      hand.line(fx, fy - h * 0.035, fx, fy + h * 0.035);
    }
  },

  buildSymbol(mats) {
    const g = new THREE.Group();

    const ground = new THREE.Mesh(new THREE.SphereGeometry(0.17, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), mats.snow);
    ground.scale.set(1, 0.2, 0.72);
    g.add(ground);

    const make = (x: number, z: number, s: number) => {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.1 * s, 0.08 * s, 0.09 * s), mats.woodDark);
      body.position.set(x, 0.045 * s, z);
      g.add(body);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(0.085 * s, 0.07 * s, 4), mats.snow);
      roof.rotation.y = Math.PI / 4;
      roof.position.set(x, 0.115 * s, z);
      roof.scale.z = 0.85;
      g.add(roof);
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.024 * s, 0.02 * s, 0.005), mats.lampOn);
      win.position.set(x, 0.05 * s, z + 0.047 * s);
      g.add(win);
    };
    make(-0.08, 0.01, 1);
    make(0.09, -0.02, 0.78);

    const tree = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.11, 9), mats.paintedGreen);
    tree.position.set(0.18, 0.06, 0.03);
    g.add(tree);
    return g;
  },
};
