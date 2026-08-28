import * as THREE from 'three';
import type { DestinationModule } from '../DestinationSymbol';
import { makeHand } from '../../core/hand';

export const destination: DestinationModule = {
  id: 'lighthouse',
  mapUv: [0.35, 0.66],
  accent: 0x9c4b3c,

  drawPictogram(ctx, w, h, rng, ink) {
    const hand = makeHand(ctx, rng, w * 0.012, w * 0.035);
    ctx.strokeStyle = ink;
    ctx.lineCap = 'round';
    const cx = w * 0.5;
    const baseY = h * 0.82;

    // island
    hand.arc(cx, baseY + h * 0.16, w * 0.34, Math.PI, Math.PI * 2);
    // tower
    hand.poly([
      [cx - w * 0.13, baseY],
      [cx - w * 0.085, h * 0.3],
      [cx + w * 0.085, h * 0.3],
      [cx + w * 0.13, baseY],
    ]);
    // lamp room
    hand.poly(
      [
        [cx - w * 0.105, h * 0.3],
        [cx - w * 0.09, h * 0.19],
        [cx + w * 0.09, h * 0.19],
        [cx + w * 0.105, h * 0.3],
      ],
      true,
    );
    // roof
    hand.poly([
      [cx - w * 0.12, h * 0.19],
      [cx, h * 0.09],
      [cx + w * 0.12, h * 0.19],
    ]);
    // two bands
    hand.line(cx - w * 0.115, baseY - h * 0.12, cx + w * 0.115, baseY - h * 0.12);
    hand.line(cx - w * 0.1, h * 0.46, cx + w * 0.1, h * 0.46);
    // small water lines
    hand.line(cx - w * 0.4, baseY + h * 0.1, cx - w * 0.24, baseY + h * 0.1);
    hand.line(cx + w * 0.24, baseY + h * 0.13, cx + w * 0.4, baseY + h * 0.13);
  },

  buildSymbol(mats) {
    const g = new THREE.Group();

    const island = new THREE.Mesh(new THREE.SphereGeometry(0.15, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), mats.woodDark);
    island.scale.set(1, 0.34, 1);
    g.add(island);

    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.075, 0.3, 18), mats.paintedCream);
    tower.position.y = 0.2;
    g.add(tower);

    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.068, 0.055, 18), mats.paintedRed);
    band.position.y = 0.16;
    g.add(band);
    const band2 = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.054, 0.05, 18), mats.paintedRed);
    band2.position.y = 0.28;
    g.add(band2);

    const gallery = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.012, 18), mats.brass);
    gallery.position.y = 0.352;
    g.add(gallery);

    const lampRoom = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.042, 0.055, 12), mats.brass);
    lampRoom.position.y = 0.385;
    g.add(lampRoom);

    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.06, 12), mats.paintedRed);
    roof.position.y = 0.44;
    g.add(roof);

    return g;
  },
};
