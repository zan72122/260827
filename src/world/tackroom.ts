import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PointLight,
  RectAreaLight,
  SphereGeometry,
  SpotLight,
  TorusGeometry,
  Vector3,
} from 'three';
import type { MaterialLibrary } from './materials';

/**
 * Scene 1-4: the tack room.
 *
 * Built for depth reading rather than for prop count. Three bands, each with
 * its own silhouette weight and its own light:
 *   near  - the bench edge and a spare strap end, warm and almost in shadow
 *   mid   - the working bench top under the lantern, the brightest thing
 *   far   - the stall and the winter window, cool and low-contrast
 */

export const BENCH_TOP = 0.94;

export class TackRoom {
  readonly group = new Group();
  readonly lanternLight: PointLight;
  readonly benchLight: SpotLight;
  readonly windowLight: RectAreaLight;
  readonly doorLight: RectAreaLight;
  readonly lanternFlame: Mesh;
  private time = 0;

  constructor(mats: MaterialLibrary) {
    const g = this.group;

    // ---------------------------------------------------------- shell ----
    const floor = new Mesh(new PlaneGeometry(11, 11), mats.wood.clone());
    (floor.material as MeshStandardMaterial).map = mats.tex.woodColor.clone();
    (floor.material as MeshStandardMaterial).map!.repeat.set(9, 9);
    (floor.material as MeshStandardMaterial).map!.needsUpdate = true;
    (floor.material as MeshStandardMaterial).color.setHex(0x5a4433);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    g.add(floor);

    const wallMat = mats.plaster;
    const backWall = new Mesh(new BoxGeometry(11, 3.4, 0.18), wallMat);
    backWall.position.set(0, 1.7, -3.1);
    backWall.receiveShadow = true;
    g.add(backWall);

    // The left wall carries the open barn door: the cold light in the room,
    // and the direction the horse is facing.
    for (const [z, depth] of [
      [-2.35, 1.7],
      [2.35, 1.7],
    ] as Array<[number, number]>) {
      const seg = new Mesh(new BoxGeometry(0.18, 3.4, depth), wallMat);
      seg.position.set(-3.2, 1.7, z);
      seg.receiveShadow = true;
      g.add(seg);
    }
    const lintel = new Mesh(new BoxGeometry(0.22, 0.7, 3.1), mats.woodDark);
    lintel.position.set(-3.2, 3.05, 0);
    g.add(lintel);
    for (const z of [-1.5, 1.5]) {
      const jamb = new Mesh(new BoxGeometry(0.26, 2.7, 0.22), mats.woodDark);
      jamb.position.set(-3.2, 1.35, z);
      g.add(jamb);
    }
    // what is beyond the door: bright snow, deliberately flat and blown out
    const outside = new Mesh(
      new PlaneGeometry(3.0, 2.7),
      new MeshBasicMaterial({ color: 0xaec4dc }),
    );
    outside.position.set(-3.34, 1.35, 0);
    outside.rotation.y = Math.PI / 2;
    g.add(outside);
    const doorSill = new Mesh(new BoxGeometry(0.5, 0.06, 2.9), mats.snow.clone());
    (doorSill.material as MeshStandardMaterial).map = null;
    doorSill.position.set(-3.05, 0.03, 0);
    g.add(doorSill);

    const rightWall = new Mesh(new BoxGeometry(0.18, 3.4, 6.4), wallMat);
    rightWall.position.set(3.2, 1.7, 0);
    rightWall.receiveShadow = true;
    g.add(rightWall);

    const ceiling = new Mesh(new BoxGeometry(11, 0.2, 6.6), mats.woodDark);
    ceiling.position.set(0, 3.3, 0);
    g.add(ceiling);

    // exposed beams give the far band a readable silhouette
    for (let i = -1; i <= 2; i++) {
      const beam = new Mesh(new BoxGeometry(7, 0.19, 0.17), mats.woodDark);
      beam.position.set(0, 3.05, i * 1.5 - 0.4);
      beam.castShadow = false;
      g.add(beam);
    }

    // vertical boarding on the back wall: the far band needs edges, not blur
    for (let i = -6; i <= 6; i++) {
      const board = new Mesh(new BoxGeometry(0.42, 3.3, 0.05), mats.woodDark);
      board.position.set(i * 0.46, 1.66, -2.98);
      board.receiveShadow = true;
      g.add(board);
      const gap = new Mesh(new BoxGeometry(0.035, 3.3, 0.07), mats.wood);
      gap.position.set(i * 0.46 + 0.23, 1.66, -2.965);
      g.add(gap);
    }

    // ------------------------------------------------ window (far, cold) --
    const winFrame = new Group();
    winFrame.position.set(-1.85, 1.75, -3.0);
    const frame = new Mesh(new BoxGeometry(1.28, 1.28, 0.16), mats.woodDark);
    winFrame.add(frame);
    const pane = new Mesh(
      new PlaneGeometry(1.05, 1.05),
      new MeshBasicMaterial({ color: 0xc9dcef }),
    );
    pane.position.z = 0.11;
    winFrame.add(pane);
    for (let i = 0; i < 2; i++) {
      const bar = new Mesh(
        new BoxGeometry(i === 0 ? 1.1 : 0.05, i === 0 ? 0.05 : 1.1, 0.07),
        mats.woodDark,
      );
      bar.position.z = 0.14;
      winFrame.add(bar);
    }
    // snow gathered on the outer sill
    const sill = new Mesh(new BoxGeometry(1.36, 0.055, 0.22), mats.woodDark);
    sill.position.set(0, -0.68, 0.1);
    winFrame.add(sill);
    g.add(winFrame);

    this.windowLight = new RectAreaLight(0xbfd6ef, 15, 1.05, 1.05);
    this.windowLight.position.set(-1.85, 1.75, -2.88);
    this.windowLight.lookAt(new Vector3(0.4, 1.0, 1.2));
    g.add(this.windowLight);

    // The doorway is the room's largest cool source; it rakes across the bench
    // from the left and separates the warm mid band from the cold far band.
    this.doorLight = new RectAreaLight(0xc5d9f0, 8.5, 2.6, 2.4);
    this.doorLight.position.set(-3.1, 1.4, 0);
    this.doorLight.lookAt(new Vector3(1.4, 1.0, -0.2));
    g.add(this.doorLight);

    // ------------------------------------------------------ stall (far) --
    const stall = new Group();
    stall.position.set(2.15, 0, -2.72);
    for (let i = 0; i < 2; i++) {
      const post = new Mesh(new CylinderGeometry(0.075, 0.085, 2.2, 8), mats.woodDark);
      post.position.set(i === 0 ? -1.05 : 1.05, 1.1, 0);
      stall.add(post);
    }
    for (let i = 0; i < 4; i++) {
      const rail = new Mesh(new BoxGeometry(2.2, 0.11, 0.06), mats.woodDark);
      rail.position.set(0, 0.42 + i * 0.42, 0);
      stall.add(rail);
    }
    const stallBack = new Mesh(new PlaneGeometry(2.2, 2.2), mats.woodDark);
    stallBack.position.set(0, 1.1, -0.5);
    stall.add(stallBack);
    // loose hay on the stall floor
    for (let i = 0; i < 22; i++) {
      const straw = new Mesh(new BoxGeometry(0.16 + Math.random() * 0.2, 0.012, 0.02), mats.hay);
      straw.position.set(
        (Math.random() - 0.5) * 2,
        0.01 + Math.random() * 0.02,
        -0.4 + Math.random() * 0.55,
      );
      straw.rotation.y = Math.random() * Math.PI;
      stall.add(straw);
    }
    g.add(stall);

    // ------------------------------------------------- bench (mid, warm) --
    const bench = new Group();
    bench.position.set(0, 0, 0.05);

    const top = new Mesh(new BoxGeometry(1.72, 0.085, 1.5), mats.wood);
    top.position.set(0, BENCH_TOP - 0.043, 0);
    top.castShadow = true;
    top.receiveShadow = true;
    bench.add(top);

    // a second, thicker plank at the front edge: the near-band silhouette
    const lip = new Mesh(new BoxGeometry(1.72, 0.13, 0.1), mats.woodDark);
    lip.position.set(0, BENCH_TOP - 0.085, 0.75);
    lip.castShadow = true;
    bench.add(lip);

    for (const [x, z] of [
      [-0.72, -0.62],
      [0.72, -0.62],
      [-0.72, 0.62],
      [0.72, 0.62],
    ]) {
      const leg = new Mesh(new BoxGeometry(0.11, BENCH_TOP - 0.085, 0.11), mats.woodDark);
      leg.position.set(x, (BENCH_TOP - 0.085) / 2, z);
      leg.castShadow = true;
      bench.add(leg);
    }
    const stretcher = new Mesh(new BoxGeometry(1.55, 0.07, 0.07), mats.woodDark);
    stretcher.position.set(0, 0.26, 0);
    bench.add(stretcher);
    g.add(bench);

    // ------------------------------------------------ props on the wall --
    const rack = new Group();
    rack.position.set(2.55, 1.86, -1.2);
    rack.rotation.y = -Math.PI / 2;
    const board = new Mesh(new BoxGeometry(1.5, 0.14, 0.09), mats.woodDark);
    rack.add(board);
    for (let i = 0; i < 4; i++) {
      const peg = new Mesh(new CylinderGeometry(0.022, 0.026, 0.18, 6), mats.iron);
      peg.rotation.x = Math.PI / 2;
      peg.position.set(-0.55 + i * 0.37, -0.02, 0.1);
      rack.add(peg);
      // spare harness hanging in loose loops
      const loop = new Mesh(new TorusGeometry(0.15 + i * 0.03, 0.014, 5, 12), mats.leatherEdge);
      loop.position.set(-0.55 + i * 0.37, -0.2 - i * 0.02, 0.13);
      loop.scale.set(1, 1.45, 0.5);
      rack.add(loop);
    }
    g.add(rack);

    // buckles and rings hanging by the bench
    for (let i = 0; i < 3; i++) {
      const ring = new Mesh(new TorusGeometry(0.05, 0.009, 6, 14), mats.iron);
      ring.position.set(2.9, 1.5 - i * 0.17, 0.3);
      ring.rotation.y = Math.PI / 2;
      g.add(ring);
    }

    // an oil tin and a brush on the bench, to the side
    const tin = new Mesh(new CylinderGeometry(0.05, 0.055, 0.13, 12), mats.iron);
    tin.position.set(-0.7, BENCH_TOP + 0.065, -0.58);
    tin.castShadow = true;
    g.add(tin);
    const brush = new Mesh(new BoxGeometry(0.19, 0.05, 0.075), mats.woodDark);
    brush.position.set(0.7, BENCH_TOP + 0.03, -0.6);
    brush.castShadow = true;
    g.add(brush);
    const bristles = new Mesh(new BoxGeometry(0.17, 0.035, 0.065), mats.hay);
    bristles.position.set(0.7, BENCH_TOP - 0.005, -0.6);
    g.add(bristles);

    // ------------------------------------------------------- lantern -----
    const lantern = new Group();
    lantern.position.set(0.05, 2.06, 0.2);
    const hook = new Mesh(new CylinderGeometry(0.008, 0.008, 1.3, 5), mats.iron);
    hook.position.y = 0.72;
    lantern.add(hook);
    const cage = new Mesh(new CylinderGeometry(0.085, 0.1, 0.24, 10, 1, true), mats.brassDark);
    lantern.add(cage);
    const capTop = new Mesh(new CylinderGeometry(0.045, 0.11, 0.07, 10), mats.brassDark);
    capTop.position.y = 0.15;
    lantern.add(capTop);
    const capBottom = new Mesh(new CylinderGeometry(0.1, 0.085, 0.05, 10), mats.brassDark);
    capBottom.position.y = -0.14;
    lantern.add(capBottom);
    this.lanternFlame = new Mesh(
      new SphereGeometry(0.032, 8, 6),
      new MeshBasicMaterial({ color: 0xffd79a }),
    );
    this.lanternFlame.scale.set(1, 1.5, 1);
    lantern.add(this.lanternFlame);
    g.add(lantern);

    this.lanternLight = new PointLight(0xffb469, 3.2, 7.5, 2);
    this.lanternLight.position.copy(lantern.position);
    this.lanternLight.castShadow = false;
    g.add(this.lanternLight);

    // A tight spot picks the bench out of the room: this is what makes the
    // mid band read brighter than the near and far bands.
    this.benchLight = new SpotLight(0xffd0a0, 7.6, 5.6, 0.8, 0.6, 1.6);
    this.benchLight.position.set(0.05, 2.24, 0.25);
    this.benchLight.target.position.set(0, BENCH_TOP, 0.0);
    this.benchLight.castShadow = true;
    this.benchLight.shadow.mapSize.set(1024, 1024);
    this.benchLight.shadow.bias = -0.0004;
    this.benchLight.shadow.normalBias = 0.0035;
    this.benchLight.shadow.camera.near = 0.4;
    this.benchLight.shadow.camera.far = 5;
    g.add(this.benchLight);
    g.add(this.benchLight.target);
  }

  setShadowSize(px: number): void {
    this.benchLight.castShadow = px > 0;
    if (px > 0) this.benchLight.shadow.mapSize.set(px, px);
  }

  update(dt: number): void {
    this.time += dt;
    // A flame is never perfectly steady, but it must not strobe either.
    const f =
      0.94 +
      Math.sin(this.time * 7.3) * 0.03 +
      Math.sin(this.time * 2.1 + 1.4) * 0.025 +
      Math.sin(this.time * 17.7) * 0.012;
    this.lanternLight.intensity = 3.2 * f;
    this.lanternFlame.scale.set(f, 1.5 * f, f);
  }

  addTo(parent: Object3D): void {
    parent.add(this.group);
  }
}
