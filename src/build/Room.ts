import * as THREE from 'three';
import { mm } from '../core/units';
import { TAU, makeRandom } from '../util/math';
import { circleRing, loft, orientOutward, revolve, roundedBox } from './geometry';
import type { Materials } from '../render/materials';

/**
 * The room: one bright end with the pastry bench under a window, one warm end
 * with the birthday table. Depth comes from scale, occlusion and the light
 * falling off across the room — not from fog or a blurred backdrop.
 */

export const BENCH_TOP_Y = 0.92;
export const TURNTABLE_POS = new THREE.Vector3(-0.155, BENCH_TOP_Y, 0.0);
/** Where the nail is held while a flower is being piped. */
export const NAIL_WORK_POS = new THREE.Vector3(0.045, BENCH_TOP_Y + 0.115, 0.105);
export const TABLE_TOP_Y = 0.74;
export const TABLE_CENTRE = new THREE.Vector3(1.9, 0, 1.3);
export const TABLE_RADIUS = 0.56;

export const SEATS: Record<'petal' | 'leaf', { bearing: number }> = {
  petal: { bearing: -0.35 },
  leaf: { bearing: 1.35 },
};

export function seatPosition(bearing: number, distance: number): THREE.Vector3 {
  return new THREE.Vector3(
    TABLE_CENTRE.x + Math.cos(bearing) * distance,
    TABLE_TOP_Y,
    TABLE_CENTRE.z + Math.sin(bearing) * distance,
  );
}

function box(
  materials: THREE.Material,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function buildRoom(materials: Materials): THREE.Group {
  const room = new THREE.Group();
  room.name = 'room';

  // --- shell
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), materials.wood);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  (materials.wood.map as THREE.Texture).repeat.set(7, 7);
  (materials.wood.roughnessMap as THREE.Texture).repeat.set(7, 7);
  room.add(floor);

  const wallBack = new THREE.Mesh(new THREE.PlaneGeometry(9, 3.2), materials.wall);
  wallBack.position.set(0, 1.6, -2.1);
  wallBack.receiveShadow = true;
  room.add(wallBack);

  const wallRight = new THREE.Mesh(new THREE.PlaneGeometry(6, 3.2), materials.wall);
  wallRight.position.set(3.4, 1.6, 0.6);
  wallRight.rotation.y = -Math.PI / 2;
  wallRight.receiveShadow = true;
  room.add(wallRight);

  const wallWindow = new THREE.Mesh(new THREE.PlaneGeometry(6, 3.2), materials.wall);
  wallWindow.position.set(-2.05, 1.6, 0.4);
  wallWindow.rotation.y = Math.PI / 2;
  wallWindow.receiveShadow = true;
  room.add(wallWindow);

  // --- window: reveal, frame, mullions, glass
  {
    const g = new THREE.Group();
    g.position.set(-2.04, 1.45, -0.1);
    g.rotation.y = Math.PI / 2;
    const frameMat = materials.paintedWood;
    const W = 1.35;
    const H = 1.5;
    const t = 0.055;
    g.add(box(frameMat, W + 2 * t, t, 0.1, 0, H / 2 + t / 2, 0));
    g.add(box(frameMat, W + 2 * t, t, 0.1, 0, -H / 2 - t / 2, 0));
    g.add(box(frameMat, t, H, 0.1, -W / 2 - t / 2, 0, 0));
    g.add(box(frameMat, t, H, 0.1, W / 2 + t / 2, 0, 0));
    g.add(box(frameMat, 0.03, H, 0.06, 0, 0, 0.01));
    g.add(box(frameMat, W, 0.03, 0.06, 0, 0.12, 0.01));
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(W, H), materials.glass);
    glass.position.z = -0.02;
    g.add(glass);
    // sill
    g.add(box(frameMat, W + 0.16, 0.035, 0.16, 0, -H / 2 - 0.05, 0.05));
    room.add(g);
  }

  // --- pastry bench: stone top on a painted base
  {
    const bench = new THREE.Group();
    const topGeo = roundedBox(1.9, 0.045, 1.15, 0.006, 2);
    const top = new THREE.Mesh(topGeo, materials.stone);
    top.position.set(-0.35, BENCH_TOP_Y - 0.0225, 0);
    top.castShadow = true;
    top.receiveShadow = true;
    bench.add(top);
    bench.add(box(materials.paintedWood, 1.84, BENCH_TOP_Y - 0.05, 1.06, -0.35, (BENCH_TOP_Y - 0.05) / 2, -0.02));
    // a shallow drawer line so the base is not a blank slab
    bench.add(box(materials.paintedWood, 1.7, 0.012, 0.02, -0.35, BENCH_TOP_Y - 0.18, 0.52));
    room.add(bench);
  }

  // --- open shelf on the back wall with a few tins and bowls
  {
    const shelf = new THREE.Group();
    shelf.position.set(-0.3, 0, -2.02);
    shelf.add(box(materials.paintedWood, 1.5, 0.03, 0.26, 0, 1.52, 0.14));
    shelf.add(box(materials.paintedWood, 1.5, 0.03, 0.26, 0, 1.85, 0.14));
    shelf.add(box(materials.paintedWood, 0.03, 0.36, 0.26, -0.74, 1.68, 0.14));
    shelf.add(box(materials.paintedWood, 0.03, 0.36, 0.26, 0.74, 1.68, 0.14));

    const rnd = makeRandom(5150);
    const tinMat = materials.steelDark;
    for (let i = 0; i < 5; i++) {
      const r = 0.045 + rnd() * 0.03;
      const h = 0.09 + rnd() * 0.08;
      const tin = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.97, h, 20), tinMat);
      tin.position.set(-0.6 + i * 0.29 + rnd() * 0.03, 1.555 + h / 2, 0.12 + rnd() * 0.04);
      tin.castShadow = true;
      tin.receiveShadow = true;
      shelf.add(tin);
    }
    for (let i = 0; i < 3; i++) {
      const r = 0.075 + rnd() * 0.035;
      const bowl = new THREE.Mesh(
        orientOutward(
          revolve(
            [
              new THREE.Vector2(0.00001, 0),
              new THREE.Vector2(r * 0.45, 0),
              new THREE.Vector2(r, r * 0.62),
              new THREE.Vector2(r * 0.98, r * 0.66),
              new THREE.Vector2(r * 0.4, r * 0.06),
              new THREE.Vector2(0.00001, r * 0.05),
            ],
            28,
            {},
          ),
        ),
        materials.porcelain,
      );
      bowl.position.set(-0.45 + i * 0.42, 1.885, 0.13);
      bowl.castShadow = true;
      bowl.receiveShadow = true;
      shelf.add(bowl);
    }
    room.add(shelf);
  }

  // --- birthday table
  {
    const table = new THREE.Group();
    table.position.copy(TABLE_CENTRE);

    const topProfile = [
      new THREE.Vector2(0.00001, TABLE_TOP_Y - 0.03),
      new THREE.Vector2(TABLE_RADIUS - 0.01, TABLE_TOP_Y - 0.03),
      new THREE.Vector2(TABLE_RADIUS, TABLE_TOP_Y - 0.022),
      new THREE.Vector2(TABLE_RADIUS, TABLE_TOP_Y - 0.004),
      new THREE.Vector2(TABLE_RADIUS - 0.008, TABLE_TOP_Y),
      new THREE.Vector2(0.00001, TABLE_TOP_Y),
    ];
    const tableTop = new THREE.Mesh(orientOutward(revolve(topProfile, 64, {})), materials.wood);
    tableTop.castShadow = true;
    tableTop.receiveShadow = true;
    table.add(tableTop);

    // A cloth over the near half, hanging with a few soft folds.
    {
      const rings: THREE.Vector3[][] = [];
      const steps = 12;
      const seg = 64;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const ring: THREE.Vector3[] = [];
        for (let j = 0; j < seg; j++) {
          const a = (j / seg) * TAU;
          const drop = Math.max(0, (t - 0.72) / 0.28);
          const fold = 1 + 0.012 * Math.sin(a * 9) * drop;
          const r = (TABLE_RADIUS + 0.012) * Math.min(1, t / 0.72) * fold +
            (drop > 0 ? 0.0 : 0.0);
          const y = TABLE_TOP_Y + 0.004 - drop * 0.19;
          ring.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
        }
        rings.push(ring);
      }
      const cloth = new THREE.Mesh(loft(rings, { capStart: true }), materials.cloth);
      cloth.castShadow = true;
      cloth.receiveShadow = true;
      table.add(cloth);
    }

    const legMat = materials.wood;
    const pedestal = new THREE.Mesh(
      orientOutward(
        revolve(
          [
            new THREE.Vector2(0.00001, 0.005),
            new THREE.Vector2(0.24, 0.005),
            new THREE.Vector2(0.22, 0.035),
            new THREE.Vector2(0.06, 0.09),
            new THREE.Vector2(0.055, TABLE_TOP_Y - 0.16),
            new THREE.Vector2(0.14, TABLE_TOP_Y - 0.05),
            new THREE.Vector2(0.16, TABLE_TOP_Y - 0.032),
            new THREE.Vector2(0.00001, TABLE_TOP_Y - 0.03),
          ],
          32,
          {},
        ),
      ),
      legMat,
    );
    pedestal.castShadow = true;
    pedestal.receiveShadow = true;
    table.add(pedestal);
    room.add(table);
  }

  // --- two chairs, one at each place
  for (const key of ['petal', 'leaf'] as const) {
    const bearing = SEATS[key].bearing;
    const chair = new THREE.Group();
    const dist = TABLE_RADIUS + 0.29;
    chair.position.set(
      TABLE_CENTRE.x + Math.cos(bearing) * dist,
      0,
      TABLE_CENTRE.z + Math.sin(bearing) * dist,
    );
    chair.rotation.y = -bearing + Math.PI / 2;
    const seatH = 0.42;
    chair.add(box(materials.paintedWood, 0.36, 0.03, 0.34, 0, seatH, 0));
    chair.add(box(materials.paintedWood, 0.34, 0.4, 0.028, 0, seatH + 0.21, -0.155));
    for (const [sx, sz] of [
      [-0.15, -0.14],
      [0.15, -0.14],
      [-0.15, 0.14],
      [0.15, 0.14],
    ]) {
      chair.add(box(materials.paintedWood, 0.032, seatH, 0.032, sx, seatH / 2, sz));
    }
    chair.name = `chair:${key}`;
    room.add(chair);
  }

  // --- a mixing bowl and a spare nail left on the bench: lived-in, not clutter
  {
    const bowl = new THREE.Mesh(
      orientOutward(
        revolve(
          [
            new THREE.Vector2(0.00001, 0),
            new THREE.Vector2(0.05, 0),
            new THREE.Vector2(0.115, 0.085),
            new THREE.Vector2(0.118, 0.092),
            new THREE.Vector2(0.108, 0.09),
            new THREE.Vector2(0.045, 0.008),
            new THREE.Vector2(0.00001, 0.007),
          ],
          40,
          {},
        ),
      ),
      materials.porcelain,
    );
    bowl.position.set(-0.86, BENCH_TOP_Y, -0.3);
    bowl.castShadow = true;
    bowl.receiveShadow = true;
    room.add(bowl);
  }

  // A ceiling, so the image based lighting has something to sit under.
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), materials.wall);
  ceiling.position.y = 2.7;
  ceiling.rotation.x = Math.PI / 2;
  room.add(ceiling);

  // Pendant shade over the birthday table.
  {
    const shade = new THREE.Mesh(
      orientOutward(
        revolve(
          [
            new THREE.Vector2(0.00001, 0.16),
            new THREE.Vector2(0.03, 0.15),
            new THREE.Vector2(0.16, 0.0),
            new THREE.Vector2(0.158, -0.004),
            new THREE.Vector2(0.028, 0.146),
            new THREE.Vector2(0.00001, 0.152),
          ],
          32,
          {},
        ),
      ),
      new THREE.MeshStandardMaterial({ color: 0xf0e2cc, roughness: 0.6, side: THREE.DoubleSide }),
    );
    shade.position.set(TABLE_CENTRE.x, 1.58, TABLE_CENTRE.z);
    room.add(shade);
    const flex = new THREE.Mesh(
      new THREE.CylinderGeometry(mm(2), mm(2), 0.92, 6),
      materials.wick,
    );
    flex.position.set(TABLE_CENTRE.x, 2.20, TABLE_CENTRE.z);
    room.add(flex);
    shade.userData.disposeMaterial = true;
  }

  // A few crumbs and a wiped smear on the bench, where work actually happened.
  {
    const rnd = makeRandom(2024);
    const crumbs: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 26; i++) {
      const g = new THREE.SphereGeometry(mm(0.5 + rnd() * 1.1), 5, 4);
      g.scale(1, 0.55, 0.85);
      const a = rnd() * TAU;
      const d = 0.16 + rnd() * 0.2;
      g.translate(TURNTABLE_POS.x + Math.cos(a) * d, BENCH_TOP_Y + mm(0.6), TURNTABLE_POS.z + Math.sin(a) * d);
      crumbs.push(g);
    }
    const merged = crumbs.reduce((acc: THREE.BufferGeometry | null, g) => {
      if (!acc) return g;
      return acc;
    }, null);
    if (merged) {
      const grp = new THREE.Group();
      for (const g of crumbs) {
        const m = new THREE.Mesh(g, materials.crust);
        m.castShadow = true;
        grp.add(m);
      }
      grp.name = 'crumbs';
      room.add(grp);
    }
  }

  return room;
}

/** A ring of buttercream smeared on the cake top to hold a flower down. */
export function buildGlueDab(materials: Materials, radius: number): THREE.Mesh {
  const rings: THREE.Vector3[][] = [];
  const steps = 6;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const r = radius * Math.sqrt(1 - t * t * 0.86);
    rings.push(circleRing(Math.max(r, 0.0002), t * mm(1.6), 20));
  }
  const mesh = new THREE.Mesh(loft(rings, { capStart: true, capEnd: true }), materials.glueCream);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}
