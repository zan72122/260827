import * as THREE from 'three';
import type { DestinationModule } from '../DestinationSymbol';
import { makeHand } from '../../core/hand';

export const destination: DestinationModule = {
  id: 'desert',
  mapUv: [0.55, 0.78],
  accent: 0xa07d4a,

  drawPictogram(ctx, w, h, rng, ink) {
    const hand = makeHand(ctx, rng, w * 0.012, w * 0.035);
    ctx.strokeStyle = ink;
    ctx.lineCap = 'round';
    const baseY = h * 0.84;

    // dunes
    hand.arc(w * 0.24, baseY + h * 0.2, w * 0.3, Math.PI * 1.05, Math.PI * 1.95);
    hand.arc(w * 0.76, baseY + h * 0.24, w * 0.34, Math.PI * 1.05, Math.PI * 1.95);

    // observatory dome on a short drum
    const cx = w * 0.5;
    hand.arc(cx, h * 0.52, w * 0.16, Math.PI, Math.PI * 2);
    hand.poly(
      [
        [cx - w * 0.16, h * 0.52],
        [cx - w * 0.16, baseY],
        [cx + w * 0.16, baseY],
        [cx + w * 0.16, h * 0.52],
      ],
      false,
    );
    // dome slit
    hand.line(cx, h * 0.38, cx, h * 0.52);
    // little star above
    hand.line(w * 0.8, h * 0.2, w * 0.8, h * 0.3);
    hand.line(w * 0.75, h * 0.25, w * 0.85, h * 0.25);
    hand.line(w * 0.16, h * 0.3, w * 0.16, h * 0.36);
    hand.line(w * 0.13, h * 0.33, w * 0.19, h * 0.33);
  },

  buildSymbol(mats) {
    const g = new THREE.Group();

    const dune = new THREE.Mesh(new THREE.SphereGeometry(0.19, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), mats.paintedCream);
    dune.scale.set(1, 0.22, 0.7);
    g.add(dune);

    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.082, 0.1, 20), mats.paintedCream);
    drum.position.y = 0.09;
    g.add(drum);

    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.078, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2), mats.steelRaw);
    dome.position.y = 0.14;
    g.add(dome);

    const slit = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.09, 0.086), mats.steelPainted);
    slit.position.set(0, 0.175, 0.01);
    g.add(slit);

    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.079, 0.006, 8, 24), mats.brass);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.14;
    g.add(ring);

    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.09, 6), mats.steelRaw);
    mast.position.set(0.13, 0.06, -0.02);
    g.add(mast);
    return g;
  },
};
