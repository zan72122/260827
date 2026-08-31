/**
 * A winter workshop, not a re-creation of any particular one.
 *
 * Depth is made with real objects at real distances -- the near jigs, the doll
 * on its cloth, the drying rack and paper stock behind, the window furthest
 * back -- so occlusion and light do the work instead of a painted backdrop.
 * Every piece here is merged into a couple of geometries to keep draw calls low.
 */
import { BufferGeometry } from 'three';
import { MeshBuilder, addRoundedBox, addTube, addGrid, addEllipsoid } from './mesh';
import { Rng } from '../core/rng';

export interface Room {
  timber: BufferGeometry;
  paper: BufferGeometry;
  wall: BufferGeometry;
  window: BufferGeometry;
  triangles: number;
}

export function buildRoom(seed = 0xb3c0): Room {
  const rng = new Rng(seed);
  const timber = new MeshBuilder();
  const paper = new MeshBuilder();
  const wall = new MeshBuilder();
  const win = new MeshBuilder();

  // --- back wall and the window in it -------------------------------------
  const WZ = -560;
  addRoundedBox(wall, { x: 0, y: 240, z: WZ - 20 }, { x: 700, y: 340, z: 20 }, 4, 2);
  addRoundedBox(wall, { x: -430, y: 130, z: -180 }, { x: 20, y: 240, z: 400 }, 4, 2);
  // window opening: a bright pane set back, with a simple frame
  addGrid(win, 1, 1, false, (u, v) => ({
    x: -260 + u * 330,
    y: 150 + v * 230,
    z: WZ - 2,
  }));
  for (const [x0, x1, y0, y1] of [
    [-268, -256, 144, 386],
    [64, 76, 144, 386],
    [-268, 76, 144, 156],
    [-268, 76, 374, 386],
    [-108, -96, 156, 374],
    [-268, 76, 258, 270],
  ] as const) {
    addRoundedBox(
      timber,
      { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: WZ + 4 },
      { x: (x1 - x0) / 2, y: (y1 - y0) / 2, z: 7 },
      1.5,
      2,
    );
  }

  // --- drying rack, mid ground --------------------------------------------
  const rackZ = -300;
  for (const px of [-300, -60, 180]) {
    addRoundedBox(timber, { x: px, y: 108, z: rackZ }, { x: 7, y: 108, z: 7 }, 1.5, 2);
  }
  for (const by of [96, 168]) {
    addRoundedBox(timber, { x: -60, y: by, z: rackZ }, { x: 246, y: 5, z: 5 }, 1.2, 2);
    // half-made paper forms hanging to dry
    for (let i = 0; i < 7; i++) {
      const x = -276 + i * 76 + rng.sym(9);
      const s = rng.range(0.8, 1.15);
      addEllipsoid(
        paper,
        { x, y: by - 17 * s, z: rackZ + rng.sym(6) },
        { x: 15 * s, y: 10.5 * s, z: 10.5 * s },
        7,
        10,
      );
      addTube(
        timber,
        [
          { x, y: by, z: rackZ, r: 0.7 },
          { x, y: by - 8 * s, z: rackZ, r: 0.7 },
        ],
        5,
      );
    }
  }

  // --- paper stock and wooden moulds on a side bench -----------------------
  addRoundedBox(timber, { x: 300, y: 74, z: -250 }, { x: 130, y: 5, z: 90 }, 2, 2);
  for (const px of [190, 400]) {
    addRoundedBox(timber, { x: px, y: 36, z: -250 }, { x: 6, y: 36, z: 60 }, 1.5, 2);
  }
  for (let i = 0; i < 9; i++) {
    addRoundedBox(
      paper,
      { x: 250 + rng.sym(7), y: 82 + i * 3.1, z: -250 + rng.sym(7) },
      { x: 62, y: 1.5, z: 44 },
      1.0,
      1,
    );
  }
  for (let i = 0; i < 3; i++) {
    // carved wooden moulds the paper is formed over
    addEllipsoid(
      timber,
      { x: 352 + i * 30, y: 92, z: -250 + rng.sym(16) },
      { x: 22, y: 14, z: 13 },
      7,
      10,
    );
  }

  // --- a few finished dolls waiting at the far left ------------------------
  for (let i = 0; i < 3; i++) {
    const x = -330 - i * 62;
    addEllipsoid(paper, { x, y: 96, z: -240 + rng.sym(20) }, { x: 26, y: 15, z: 14 }, 7, 10);
  }

  return {
    timber: timber.build(),
    paper: paper.build(),
    wall: wall.build(),
    window: win.build(),
    triangles:
      timber.triangleCount + paper.triangleCount + wall.triangleCount + win.triangleCount,
  };
}
