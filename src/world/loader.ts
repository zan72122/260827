import * as THREE from 'three';
import { M } from '../materials';
import { beltRun } from './conveyor';
import { wp } from '../journey';
import type { Segment, FrameState } from './types';

/**
 * BeltLoaderSegment: a self-propelled belt loader parked square-on to the
 * cargo door. The boom belt is part of the journey path (the bag rides it).
 */
export function buildLoader(): Segment {
  const g = new THREE.Group();
  const a = wp(14);
  const b = wp(15);
  const dir = b.clone().sub(a).normalize();
  const dirH = new THREE.Vector3(dir.x, 0, dir.z).normalize();

  // boom belt (extends a little past both waypoints for receive/discharge)
  const boomA = a.clone().addScaledVector(dir, -0.55);
  const boomB = b.clone().addScaledVector(dir, 0.35);
  g.add(beltRun(boomA, boomB, { width: 0.78, guards: true, guardH: 0.24, frame: true }));
  // boom underside pan + edge rails
  const mid = boomA.clone().add(boomB).multiplyScalar(0.5);
  const boomLen = boomA.distanceTo(boomB);
  const pan = new THREE.Mesh(new THREE.BoxGeometry(boomLen, 0.16, 0.95), M.steelDark);
  pan.position.copy(mid).add(new THREE.Vector3(0, -0.26, 0));
  pan.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
  pan.castShadow = true;
  g.add(pan);
  // black/yellow tip marking at the head (real hazard point)
  const tip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.2, 0.9), M.hazard);
  tip.position.copy(boomB).add(new THREE.Vector3(0, -0.12, 0));
  g.add(tip);

  // chassis under the lower third of the boom
  const chassisPos = a.clone().addScaledVector(dirH, 1.0);
  chassisPos.y = 0.42;
  const chassis = new THREE.Group();
  chassis.position.copy(chassisPos);
  chassis.rotation.y = Math.atan2(dirH.x, dirH.z) - Math.PI / 2 + Math.PI; // face along travel
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x33566e, roughness: 0.55 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.55, 1.15), bodyMat);
  body.castShadow = true;
  chassis.add(body);
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.3, 1.15), M.steelDark);
  bumper.position.set(-1.28, -0.1, 0);
  chassis.add(bumper);
  // wheels
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.9 });
  for (const [ex, ez] of [
    [-0.95, -0.62],
    [-0.95, 0.62],
    [0.95, -0.62],
    [0.95, 0.62],
  ] as const) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.22, 14), tyreMat);
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(ex, -0.42, ez);
    wheel.castShadow = true;
    chassis.add(wheel);
    const hubcap = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.24, 10), M.roller);
    hubcap.rotation.x = Math.PI / 2;
    hubcap.position.set(ex, -0.42, ez);
    chassis.add(hubcap);
  }
  // driver seat + steering column (open cab at the rear)
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.42), M.steelDark);
  seat.position.set(-0.85, 0.35, -0.28);
  chassis.add(seat);
  const seatBack = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.42, 0.42), M.steelDark);
  seatBack.position.set(-1.06, 0.6, -0.28);
  chassis.add(seatBack);
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.55, 8), M.steelDark);
  column.position.set(-0.35, 0.55, -0.28);
  column.rotation.z = 0.5;
  chassis.add(column);
  const wheelRing = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.025, 8, 18), M.steelDark);
  wheelRing.position.set(-0.22, 0.68, -0.28);
  wheelRing.rotation.y = Math.PI / 2;
  wheelRing.rotation.z = 0.5;
  chassis.add(wheelRing);
  // headlights
  for (const ez of [-0.4, 0.4]) {
    const hl = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, 0.05, 10),
      new THREE.MeshStandardMaterial({ color: 0xcfd4d8, emissive: 0x554e30, emissiveIntensity: 0.4 }),
    );
    hl.rotation.z = Math.PI / 2;
    hl.position.set(1.28, 0.05, ez);
    chassis.add(hl);
  }
  g.add(chassis);

  // hydraulic lift cylinder from chassis to boom mid
  const boomMidLow = a.clone().lerp(b, 0.45);
  const cylBase = chassisPos.clone().add(new THREE.Vector3(0, -0.1, 0));
  const cylVec = boomMidLow.clone().add(new THREE.Vector3(0, -0.35, 0)).sub(cylBase);
  const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.075, cylVec.length(), 10), M.roller);
  cyl.position.copy(cylBase).addScaledVector(cylVec, 0.5);
  cyl.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), cylVec.clone().normalize());
  g.add(cyl);

  // small stabilizer legs at the head end
  const headBase = b.clone().addScaledVector(dirH, -0.6);
  for (const so of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.2, 0.08), M.steelDark);
    leg.position.set(headBase.x - dirH.z * 0.45 * so, 0.6, headBase.z + dirH.x * 0.45 * so);
    g.add(leg);
  }
  // boom support A-frame near chassis
  const aFramePos = a.clone().addScaledVector(dirH, 1.7);
  const aFrame = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.5, 0.9), M.steelDark);
  aFrame.position.set(aFramePos.x, 0.75, aFramePos.z);
  aFrame.rotation.y = Math.atan2(dirH.x, dirH.z) - Math.PI / 2;
  g.add(aFrame);

  const update = (_st: FrameState) => {};
  return { group: g, range: [0.74, 1.01], update };
}
