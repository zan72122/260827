/**
 * The workshop furniture the child actually touches: the bench, the cloth-lined
 * tray the parts wait on, the hanging jig, the wooden chin rest, the grip on
 * the counterweight and the toggle on the free end of the thread.
 */
import { BufferGeometry } from 'three';
import { MeshBuilder, addTube, addEllipsoid, addRoundedBox, addGrid } from './mesh';
import { CHIN_REST, GRIP, JIG, TOGGLE, WEIGHT_RAIL } from '../sim/dims';

/** The bench top the whole scene stands on. */
export function buildBench(): BufferGeometry {
  const mb = new MeshBuilder();
  addRoundedBox(mb, { x: -10, y: -26, z: 10 }, { x: 300, y: 26, z: 210 }, 3.0, 3);
  return mb.build();
}

/** Shallow wooden tray, and the red cloth laid in it. */
export function buildTray(): { wood: BufferGeometry; cloth: BufferGeometry } {
  const wood = new MeshBuilder();
  const W = 128;
  const D = 92;
  const cx = -6;
  const cz = 4;
  addRoundedBox(wood, { x: cx, y: -3.4, z: cz }, { x: W, y: 3.4, z: D }, 2.0, 3);
  for (const [ox, oz, hx, hz] of [
    [cx, cz - D, W, 3.6],
    [cx, cz + D, W, 3.6],
    [cx - W, cz, 3.6, D],
    [cx + W, cz, 3.6, D],
  ] as const) {
    addRoundedBox(wood, { x: ox, y: 3.2, z: oz }, { x: hx, y: 6.6, z: hz }, 1.6, 2);
  }
  const cloth = new MeshBuilder();
  // a soft cloth with a little slack, not a flat card
  addGrid(cloth, 22, 22, false, (u, v) => {
    const x = cx - (W - 8) + u * (W - 8) * 2;
    const z = cz - (D - 8) + v * (D - 8) * 2;
    const eu = Math.sin(u * Math.PI);
    const ev = Math.sin(v * Math.PI);
    const y = 0.4 + 1.5 * eu * ev + 0.5 * Math.sin(u * 9.1) * Math.sin(v * 7.3) * eu * ev;
    return { x, y, z };
  });
  return { wood: wood.build(), cloth: cloth.build() };
}

/**
 * The hanging jig: a post, an arm reaching in from behind, and a cradle the
 * neck sits in while the counterweight is being set.
 *
 * The cradle sits below the notch and clear of the head, so nothing of the jig
 * passes through the doll -- the head is visibly carried by it, and the child
 * can see the whole face and the whole inner arm at the same time.
 */
export function buildJig(): BufferGeometry {
  const mb = new MeshBuilder();
  const bx = JIG.hookX - 72;
  const bz = JIG.hookZ - 78;
  const cradleY = JIG.hookY - 5.0;
  addRoundedBox(mb, { x: bx, y: 4, z: bz }, { x: 26, y: 4, z: 24 }, 2, 2);
  addTube(
    mb,
    [
      { x: bx, y: 6, z: bz, r: JIG.postR * 1.35 },
      { x: bx, y: 40, z: bz, r: JIG.postR },
      { x: bx, y: JIG.hookY + 2, z: bz, r: JIG.postR * 0.92 },
    ],
    10,
  );
  // the arm, coming in behind the head and dropping to the cradle
  addTube(
    mb,
    [
      { x: bx, y: JIG.hookY + 2, z: bz, r: 4.0 },
      { x: (bx + JIG.hookX) / 2 - 4, y: JIG.hookY + 1, z: (bz + JIG.hookZ) / 2, r: 3.4 },
      { x: JIG.hookX - 12, y: cradleY + 5, z: JIG.hookZ - 6, r: 3.0 },
    ],
    9,
  );
  // the cradle itself: a shallow U under the notch
  addTube(
    mb,
    [
      { x: JIG.hookX - 12, y: cradleY + 5, z: JIG.hookZ - 6, r: 2.4 },
      { x: JIG.hookX - 9, y: cradleY + 2.4, z: JIG.hookZ - 1, r: 1.8 },
      { x: JIG.hookX - 5, y: cradleY - 0.4, z: JIG.hookZ, r: 1.7 },
      { x: JIG.hookX, y: cradleY - 1.2, z: JIG.hookZ, r: 1.7 },
      { x: JIG.hookX + 5, y: cradleY - 0.4, z: JIG.hookZ, r: 1.7 },
      { x: JIG.hookX + 8.5, y: cradleY + 2.6, z: JIG.hookZ, r: 1.6 },
      { x: JIG.hookX + 10, y: cradleY + 6.5, z: JIG.hookZ, r: 1.5 },
    ],
    8,
  );
  return mb.build();
}

/**
 * The wooden prop the head's jaw sits on until the thread takes its weight.
 * A slim turned post rather than a block: it has to hold the jaw without
 * standing in front of the thing the child is trying to look at.
 */
export function buildChinRest(): BufferGeometry {
  const mb = new MeshBuilder();
  addRoundedBox(mb, { x: CHIN_REST.x, y: 2.6, z: 0 }, { x: 13, y: 2.6, z: 16 }, 1.6, 2);
  addTube(
    mb,
    [
      { x: CHIN_REST.x, y: 4.4, z: 0, r: 6.0 },
      { x: CHIN_REST.x, y: 12, z: 0, r: 4.2 },
      { x: CHIN_REST.x, y: CHIN_REST.y - 14, z: 0, r: 3.6 },
      { x: CHIN_REST.x, y: CHIN_REST.y - 5, z: 0, r: 4.6 },
    ],
    10,
  );
  // a shallow cradle so the jaw sits still instead of rolling off
  addGrid(mb, 8, 12, false, (u, v) => {
    const z = -CHIN_REST.hz + v * CHIN_REST.hz * 2;
    const x = CHIN_REST.x - 7 + u * 14;
    const dip = 2.4 * Math.pow(Math.abs(z) / CHIN_REST.hz - 1, 2);
    return { x, y: CHIN_REST.y - dip, z };
  });
  return mb.build();
}

/** Grip clamped to the counterweight while it is being set. */
export function buildGrip(): BufferGeometry {
  const mb = new MeshBuilder();
  addTube(
    mb,
    [
      { x: 0, y: 0, z: WEIGHT_RAIL.r * 0.5, r: GRIP.stemR },
      { x: 0, y: 0, z: GRIP.z - GRIP.r * 0.7, r: GRIP.stemR },
    ],
    9,
  );
  addEllipsoid(
    mb,
    { x: 0, y: 0, z: GRIP.z },
    { x: GRIP.r, y: GRIP.r, z: GRIP.r * 0.72 },
    12,
    16,
  );
  // The collar the grip is clamped to, riding on the arm: the provisional
  // fixing that keeps the weight where the child put it.
  const ax = -0.55;
  const ay = -0.83;
  addTube(
    mb,
    [
      { x: -ax * 2.4, y: -ay * 2.4, z: 0, r: WEIGHT_RAIL.r * 1.06 },
      { x: ax * 2.4, y: ay * 2.4, z: 0, r: WEIGHT_RAIL.r * 1.06 },
    ],
    14,
    false,
    false,
  );
  return mb.build();
}

/** Wooden toggle on the free end of the support thread. */
export function buildToggle(): BufferGeometry {
  const mb = new MeshBuilder();
  addEllipsoid(mb, { x: 0, y: 0, z: 0 }, { x: TOGGLE.r * 1.25, y: TOGGLE.r, z: TOGGLE.r }, 12, 16);
  return mb.build();
}

/** The knot left on the peg once the length is set. */
export function buildKnot(): BufferGeometry {
  const mb = new MeshBuilder();
  addEllipsoid(mb, { x: 0, y: 0, z: 0 }, { x: 2.4, y: 2.0, z: 2.4 }, 8, 10);
  addTube(
    mb,
    [
      { x: -2.6, y: -0.6, z: 0.9, r: 0.5 },
      { x: 0, y: 0.8, z: 0, r: 0.5 },
      { x: 2.4, y: -1.2, z: -0.8, r: 0.45 },
    ],
    6,
  );
  return mb.build();
}
