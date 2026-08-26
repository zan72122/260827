import * as THREE from 'three';
import { M } from '../materials';
import { rollerDeck } from './conveyor';
import { stripCurtain } from './curtain';
import { journey } from '../journey';
import type { Segment, FrameState } from './types';

/**
 * ScreeningSegment: a generalized in-line hold-baggage screening machine.
 * Plain industrial shell, roller conveyor through it, shielding flap
 * curtains at both portals, a status beacon and a modest tag-read light.
 * No sci-fi interior.
 */
export function buildScreening(): Segment {
  const g = new THREE.Group();
  const FLOOR = -2.35;
  const BELT = -1.5;
  const IN_X = 16.4;
  const OUT_X = 19.4;
  const MID = (IN_X + OUT_X) / 2;

  // roller conveyor through the machine
  const deck = rollerDeck(
    new THREE.Vector3(15.95, BELT, 0),
    new THREE.Vector3(19.85, BELT, 0),
    0.85,
    0.14,
  );
  g.add(deck.group);
  // deck support legs
  for (const lx of [16.3, 18, 19.6]) {
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, BELT - 0.1 - FLOOR, 0.07), M.steelDark);
      leg.position.set(lx, (BELT - 0.1 + FLOOR) / 2, 0.38 * sz);
      g.add(leg);
    }
  }

  // machine shell (two halves so the tunnel is a real opening)
  const shellH = 1.35;
  const shellY = BELT - 0.35 + shellH / 2; // from below belt to above
  for (const sz of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.BoxGeometry(OUT_X - IN_X, shellH, 0.42), M.machineShell);
    side.position.set(MID, shellY, (0.475 + 0.21) * sz);
    side.castShadow = true;
    side.receiveShadow = true;
    g.add(side);
  }
  const top = new THREE.Mesh(new THREE.BoxGeometry(OUT_X - IN_X, 0.45, 1.8), M.machineShell);
  top.position.set(MID, BELT + 0.78, 0);
  top.castShadow = true;
  g.add(top);
  const base = new THREE.Mesh(new THREE.BoxGeometry(OUT_X - IN_X, 0.28, 1.8), M.machineShell);
  base.position.set(MID, BELT - 0.24, 0);
  g.add(base);
  // rounded corner trims + face plates (front/back portals)
  const portalMat = new THREE.MeshStandardMaterial({ color: 0x4a5056, roughness: 0.6 });
  for (const px of [IN_X, OUT_X]) {
    const face = new THREE.Mesh(new THREE.BoxGeometry(0.08, shellH + 0.1, 1.9), portalMat);
    face.position.set(px, shellY + 0.02, 0);
    g.add(face);
    // portal cutout is implied by the flap curtain frame below
    const lip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.09, 1.05), M.steelDark);
    lip.position.set(px, BELT + 0.6, 0);
    g.add(lip);
  }
  // trim stripe along the shell (restrained branding, no text)
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(OUT_X - IN_X + 0.02, 0.09, 1.82),
    new THREE.MeshStandardMaterial({ color: 0x39647e, roughness: 0.55 }),
  );
  stripe.position.set(MID, BELT + 0.99, 0);
  g.add(stripe);

  // portal shielding flap curtains
  const sIn = journey.sAtWaypoint[5] + (IN_X - 16.0);
  const sOut = journey.sAtWaypoint[5] + (OUT_X - 16.0);
  const flapsIn = stripCurtain(0.95, 0.68, { stripW: 0.055, maxAngle: 1.25, frame: false });
  flapsIn.group.position.set(IN_X + 0.06, BELT - 0.02, 0);
  g.add(flapsIn.group);
  const flapsOut = stripCurtain(0.95, 0.68, { stripW: 0.055, maxAngle: 1.25, frame: false });
  flapsOut.group.position.set(OUT_X - 0.06, BELT - 0.02, 0);
  g.add(flapsOut.group);

  // dark tunnel interior with a quiet inspection band
  const tunnel = new THREE.Mesh(
    new THREE.BoxGeometry(OUT_X - IN_X - 0.2, 0.75, 0.98),
    new THREE.MeshStandardMaterial({ color: 0x17191c, roughness: 1, side: THREE.BackSide }),
  );
  tunnel.position.set(MID, BELT + 0.36, 0);
  g.add(tunnel);
  const scanMat = new THREE.MeshStandardMaterial({
    color: 0x201408,
    emissive: 0xcf8a2e,
    emissiveIntensity: 0.0,
  });
  const scanBand = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.66, 0.95), scanMat);
  scanBand.position.set(MID, BELT + 0.36, 0);
  g.add(scanBand);
  const scanLight = new THREE.PointLight(0xcf8a2e, 0, 2.2, 2);
  scanLight.position.set(MID, BELT + 0.5, 0);
  g.add(scanLight);

  // status beacon on top (green run / amber busy)
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.4, 6), M.steelDark);
  pole.position.set(MID + 0.9, BELT + 1.2, -0.6);
  g.add(pole);
  const lampGreenMat = new THREE.MeshStandardMaterial({
    color: 0x0a2a12,
    emissive: 0x2fae52,
    emissiveIntensity: 1.4,
  });
  const lampAmberMat = new THREE.MeshStandardMaterial({
    color: 0x2a1c06,
    emissive: 0xd08a1e,
    emissiveIntensity: 0.15,
  });
  const lampGreen = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.09, 10), lampGreenMat);
  lampGreen.position.set(MID + 0.9, BELT + 1.45, -0.6);
  g.add(lampGreen);
  const lampAmber = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.09, 10), lampAmberMat);
  lampAmber.position.set(MID + 0.9, BELT + 1.55, -0.6);
  g.add(lampAmber);

  // control cabinet
  const cab = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.5, 0.4), M.machineShell);
  cab.position.set(MID + 1.6, FLOOR + 0.75, -1.35);
  g.add(cab);
  const cabScreen = new THREE.Mesh(
    new THREE.BoxGeometry(0.26, 0.18, 0.02),
    new THREE.MeshStandardMaterial({ color: 0x10161c, emissive: 0x24404e, emissiveIntensity: 0.9 }),
  );
  cabScreen.position.set(MID + 1.6, FLOOR + 1.25, -1.14);
  g.add(cabScreen);

  // barcode/tag reader arch before the inlet
  const READER_X = 15.3;
  const sReader = journey.sAtWaypoint[5] - (16.0 - READER_X);
  for (const sz of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.85, 0.05), M.steelDark);
    post.position.set(READER_X, BELT + 0.32, 0.58 * sz);
    g.add(post);
  }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 1.2), M.steelDark);
  bar.position.set(READER_X, BELT + 0.76, 0);
  g.add(bar);
  const readerLedMat = new THREE.MeshStandardMaterial({
    color: 0x111111,
    emissive: 0x2fae52,
    emissiveIntensity: 0.0,
  });
  const readerLed = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.03, 0.14), readerLedMat);
  readerLed.position.set(READER_X, BELT + 0.72, 0);
  g.add(readerLed);

  // limited floor hazard marking at the service face only
  const mark = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.16), M.hazard);
  mark.rotation.x = -Math.PI / 2;
  mark.position.set(MID, FLOOR + 0.012, 1.05);
  g.add(mark);

  const update = (st: FrameState) => {
    flapsIn.update(st.s - sIn);
    flapsOut.update(st.s - sOut);
    // bag inside window 0..1
    const inside = THREE.MathUtils.smoothstep(st.s, sIn - 0.2, sIn + 0.3) *
      (1 - THREE.MathUtils.smoothstep(st.s, sOut - 0.3, sOut + 0.2));
    scanMat.emissiveIntensity = inside * (0.45 + Math.sin(st.time * 7) * 0.1);
    scanLight.intensity = inside * 0.4;
    lampAmberMat.emissiveIntensity = 0.15 + inside * 1.5;
    lampGreenMat.emissiveIntensity = 1.4 - inside * 1.1;
    // tag reader blink while the tag passes underneath
    const read = Math.max(0, 1 - Math.abs(st.s - sReader) / 0.45);
    readerLedMat.emissiveIntensity = read * (1.5 + Math.sin(st.time * 18) * 0.8);
  };

  return { group: g, range: [0.32, 0.62], update };
}
