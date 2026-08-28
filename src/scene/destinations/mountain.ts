import * as THREE from 'three';
import type { DestinationModule } from '../DestinationSymbol';
import { makeHand } from '../../core/hand';

export const destination: DestinationModule = {
  id: 'mountain',
  mapUv: [0.6, 0.42],
  accent: 0x4e6a72,

  drawPictogram(ctx, w, h, rng, ink) {
    const hand = makeHand(ctx, rng, w * 0.012, w * 0.035);
    ctx.strokeStyle = ink;
    ctx.lineCap = 'round';
    const baseY = h * 0.74;

    hand.poly([
      [w * 0.06, baseY],
      [w * 0.32, h * 0.2],
      [w * 0.56, baseY],
    ]);
    hand.poly([
      [w * 0.42, baseY],
      [w * 0.66, h * 0.32],
      [w * 0.94, baseY],
    ]);
    // snow cap
    hand.poly([
      [w * 0.24, h * 0.32],
      [w * 0.32, h * 0.24],
      [w * 0.4, h * 0.32],
    ]);

    // train under the mountains
    hand.poly(
      [
        [w * 0.26, h * 0.8],
        [w * 0.26, h * 0.92],
        [w * 0.62, h * 0.92],
        [w * 0.62, h * 0.8],
      ],
      true,
    );
    hand.poly(
      [
        [w * 0.62, h * 0.84],
        [w * 0.62, h * 0.92],
        [w * 0.78, h * 0.92],
        [w * 0.78, h * 0.84],
      ],
      true,
    );
    hand.circle(w * 0.34, h * 0.95, w * 0.035);
    hand.circle(w * 0.54, h * 0.95, w * 0.035);
    hand.circle(w * 0.71, h * 0.95, w * 0.03);
    hand.line(w * 0.14, h * 0.98, w * 0.9, h * 0.98);
  },

  buildSymbol(mats) {
    const g = new THREE.Group();

    const peakA = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.34, 4), mats.paintedBlue);
    peakA.position.set(-0.06, 0.17, 0);
    peakA.rotation.y = Math.PI / 4;
    g.add(peakA);

    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.1, 4), mats.snow);
    cap.position.set(-0.06, 0.29, 0);
    cap.rotation.y = Math.PI / 4;
    g.add(cap);

    const peakB = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.24, 4), mats.paintedBlue);
    peakB.position.set(0.11, 0.12, -0.03);
    peakB.rotation.y = Math.PI / 4;
    g.add(peakB);

    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.008, 0.05), mats.steelRaw);
    rail.position.set(0, 0.012, 0.1);
    g.add(rail);

    const loco = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.05), mats.paintedGreen);
    loco.position.set(-0.06, 0.048, 0.1);
    g.add(loco);
    const car = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.045, 0.048), mats.paintedGreen);
    car.position.set(0.06, 0.04, 0.1);
    g.add(car);

    const wheelGeo = new THREE.CylinderGeometry(0.016, 0.016, 0.055, 10);
    for (const x of [-0.09, -0.03, 0.04, 0.09]) {
      const wheel = new THREE.Mesh(wheelGeo, mats.steelPainted);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(x, 0.02, 0.1);
      g.add(wheel);
    }
    return g;
  },
};
