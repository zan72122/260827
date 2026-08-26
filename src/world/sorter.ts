import * as THREE from 'three';
import { M } from '../materials';
import { beltRun, rollerDeck, otherBagGeometry } from './conveyor';
import { wp } from '../journey';
import type { Segment, FrameState } from './types';

/**
 * SorterSegment: the kinetic peak. A paddle diverter swings across the fast
 * main line and pushes THE bag onto the branch lane. The arm angle is a pure
 * function of journeyProgress, so scrubbing back replays it in reverse.
 * Other bags continue straight on the main line (ambient life), and the
 * branch-side hero roller pre-spins just before the divert as a non-verbal
 * "this way" cue.
 */
export function buildSorter(): Segment {
  const g = new THREE.Group();
  const FLOOR = -2.35;
  const BELT = -1.5;

  // fast approach belt from screening outlet to the diverter
  g.add(
    beltRun(new THREE.Vector3(19.9, BELT, 0), new THREE.Vector3(23.35, BELT, 0), {
      width: 0.85,
      legsTo: FLOOR,
    }),
  );
  // main line continues straight past the diverter (other bags' lane)
  g.add(
    beltRun(new THREE.Vector3(24.75, BELT, 0), new THREE.Vector3(29.9, BELT, 0), {
      width: 0.85,
      legsTo: FLOOR,
    }),
  );

  // steel transfer plate across the divert point
  const plate = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.05, 1.7), M.galvanized);
  plate.position.set(24.0, BELT - 0.032, 0.35);
  plate.receiveShadow = true;
  g.add(plate);
  for (const [lx, lz] of [
    [23.4, -0.3],
    [24.6, 1.0],
  ] as const) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, BELT - FLOOR, 0.08), M.steelDark);
    leg.position.set(lx, (BELT + FLOOR) / 2, lz);
    g.add(leg);
  }

  // branch lane: powered roller deck then belt toward the make-up incline
  const dir = wp(8).clone().sub(wp(7)).normalize();
  const branchStart = wp(7).clone().addScaledVector(dir, 1.1);
  const deck = rollerDeck(branchStart, wp(8), 0.85, 0.14);
  g.add(deck.group);
  for (const t of [0.15, 0.6]) {
    const p = branchStart.clone().lerp(wp(8), t);
    for (const so of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, BELT - 0.1 - FLOOR, 0.07), M.steelDark);
      leg.position.set(p.x - dir.z * 0.35 * so, (BELT - 0.1 + FLOOR) / 2, p.z + dir.x * 0.35 * so);
      g.add(leg);
    }
  }
  g.add(beltRun(wp(8), wp(9), { width: 0.85, legsTo: FLOOR }));

  // ---- the paddle diverter ----
  const arm = new THREE.Group();
  arm.position.set(23.35, BELT + 0.02, -0.62); // pivot on the opposite side of the branch
  const armSteel = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.42, 0.12), M.beltFrame);
  armSteel.position.set(0.75, 0.23, 0);
  armSteel.castShadow = true;
  arm.add(armSteel);
  const armFace = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 0.38, 0.035),
    new THREE.MeshStandardMaterial({ color: 0x1c1e20, roughness: 0.95 }),
  );
  armFace.position.set(0.75, 0.23, 0.075);
  arm.add(armFace);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.55, 12), M.steelDark);
  hub.position.y = 0.26;
  arm.add(hub);
  g.add(arm);
  // drive housing under the pivot
  const motor = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.45, 0.45), M.yellowRail);
  motor.position.set(23.35, BELT - 0.35, -0.85);
  g.add(motor);
  const motorCap = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.08, 0.47), M.steelDark);
  motorCap.position.set(23.35, BELT - 0.1, -0.85);
  g.add(motorCap);

  // other bags rolling straight through on the main line
  const others: THREE.Mesh[] = [];
  const obGeo = otherBagGeometry();
  for (let i = 0; i < 3; i++) {
    const ob = new THREE.Mesh(obGeo, M.otherBag[i % M.otherBag.length]);
    ob.castShadow = true;
    ob.rotation.y = 0.1 * (i - 1);
    g.add(ob);
    others.push(ob);
  }
  // dark exit opening with flaps where the main line leaves the hall
  const exit = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 1.1, 1.3),
    new THREE.MeshStandardMaterial({ color: 0x0a0c0e, roughness: 1 }),
  );
  exit.position.set(30.0, BELT + 0.45, 0);
  g.add(exit);

  // branch chevron marker on a small post (shape-only lane cue)
  const chev = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.35), M.chevron);
  chev.position.set(24.6, BELT + 0.75, 1.35);
  chev.rotation.y = 0.7; // angled toward the camera, pointing along the branch
  g.add(chev);
  const chevPost = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.35, 0.04), M.steelDark);
  chevPost.position.set(24.6, BELT + 0.1, 1.35);
  g.add(chevPost);

  const update = (st: FrameState) => {
    // arm swing as pure function of progress: deploy 0.575→0.61, hold, stow 0.675→0.71
    const deploy = THREE.MathUtils.smoothstep(st.p, 0.575, 0.608);
    const stow = THREE.MathUtils.smoothstep(st.p, 0.675, 0.71);
    const aRaw = deploy * (1 - stow);
    // tiny mechanical overshoot at the end of the throw
    const over = deploy >= 1 ? 0 : Math.sin(deploy * Math.PI) * 0.06;
    arm.rotation.y = -(aRaw * 0.88 + over * deploy);
    // pre-spin the branch hero roller just before the divert (lane cue)
    const cue = THREE.MathUtils.smoothstep(st.p, 0.54, 0.575) * (1 - THREE.MathUtils.smoothstep(st.p, 0.64, 0.7));
    deck.heroRoller.rotation.z += (cue * 2.2 + Math.abs(st.speed) * 1.5) * st.dt;
    // ambient: other bags run the main line and vanish into the exit
    for (let i = 0; i < others.length; i++) {
      // downstream of the diverter only, so they never clip the deployed arm
      const x = 24.9 + (((st.time * 0.55 + i * 1.9) % 5.6) + 5.6) % 5.6;
      others[i].position.set(x, BELT + 0.14, 0);
      others[i].visible = x < 29.6;
    }
  };

  return { group: g, range: [0.5, 0.76], update };
}
