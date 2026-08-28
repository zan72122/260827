import * as THREE from 'three';
import type { DestinationModule } from '../DestinationSymbol';
import { makeHand } from '../../core/hand';

export const destination: DestinationModule = {
  id: 'forest',
  mapUv: [0.76, 0.56],
  accent: 0x50663f,

  drawPictogram(ctx, w, h, rng, ink) {
    const hand = makeHand(ctx, rng, w * 0.012, w * 0.035);
    ctx.strokeStyle = ink;
    ctx.lineCap = 'round';
    const baseY = h * 0.86;

    // house
    hand.poly(
      [
        [w * 0.3, baseY],
        [w * 0.3, h * 0.5],
        [w * 0.68, h * 0.5],
        [w * 0.68, baseY],
      ],
      true,
    );
    hand.poly([
      [w * 0.24, h * 0.52],
      [w * 0.49, h * 0.26],
      [w * 0.74, h * 0.52],
    ]);
    hand.poly(
      [
        [w * 0.44, baseY],
        [w * 0.44, h * 0.66],
        [w * 0.56, h * 0.66],
        [w * 0.56, baseY],
      ],
      false,
    );
    // chimney + smoke
    hand.poly(
      [
        [w * 0.6, h * 0.38],
        [w * 0.6, h * 0.24],
        [w * 0.66, h * 0.24],
        [w * 0.66, h * 0.44],
      ],
      false,
    );

    // two conifers
    for (const [tx, s] of [
      [w * 0.12, 1],
      [w * 0.87, 0.82],
    ] as [number, number][]) {
      hand.poly([
        [tx - w * 0.075 * s, h * 0.66],
        [tx, h * 0.4],
        [tx + w * 0.075 * s, h * 0.66],
      ]);
      hand.poly([
        [tx - w * 0.06 * s, h * 0.52],
        [tx, h * 0.3],
        [tx + w * 0.06 * s, h * 0.52],
      ]);
      hand.line(tx, h * 0.66, tx, baseY);
    }
    hand.line(w * 0.04, baseY, w * 0.96, baseY);
  },

  buildSymbol(mats) {
    const g = new THREE.Group();

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.12), mats.paintedCream);
    body.position.y = 0.06;
    g.add(body);

    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.135, 0.1, 4), mats.paintedRed);
    roof.rotation.y = Math.PI / 4;
    roof.position.y = 0.17;
    roof.scale.z = 0.82;
    g.add(roof);

    const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.06, 0.024), mats.woodDark);
    chimney.position.set(0.05, 0.2, 0);
    g.add(chimney);

    const door = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 0.006), mats.woodDark);
    door.position.set(0, 0.03, 0.063);
    g.add(door);

    for (const [x, z, s] of [
      [-0.15, 0.02, 1],
      [0.16, -0.03, 0.8],
    ] as [number, number, number][]) {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.011, 0.05, 8), mats.woodDark);
      trunk.position.set(x, 0.025 * s, z);
      trunk.scale.setScalar(s);
      g.add(trunk);
      const c1 = new THREE.Mesh(new THREE.ConeGeometry(0.05 * s, 0.1 * s, 9), mats.paintedGreen);
      c1.position.set(x, 0.095 * s, z);
      g.add(c1);
      const c2 = new THREE.Mesh(new THREE.ConeGeometry(0.038 * s, 0.08 * s, 9), mats.paintedGreen);
      c2.position.set(x, 0.155 * s, z);
      g.add(c2);
    }
    return g;
  },
};
