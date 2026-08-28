import * as THREE from 'three';
import { M } from '../mat/materials';
import { bevelBox, lathe, setShadow } from './geo';
import { BENCH_TOP, ROOM, WINDOW } from './layout';
import { Rng } from '../util/math';
import { makeSoot } from '../mat/textures';

/* ------------------------------------------------------------------ *
 * The workshop shell: floor, plastered walls, ceiling beams, the frosted
 * window, the tool wall, a shelf of turning blanks and the lathe.
 * One shadow-casting light (the ceiling lamp) plus a cold fill from the
 * window; everything else is environment and emissive.
 * ------------------------------------------------------------------ */

export class Room {
  readonly group = new THREE.Group();
  readonly lamp: THREE.SpotLight;
  readonly lampTarget = new THREE.Object3D();
  readonly windowFill: THREE.DirectionalLight;
  readonly ambient: THREE.HemisphereLight;
  readonly windowGlow: THREE.PointLight;
  private lampShade: THREE.Mesh;
  private lampBulbMat: THREE.MeshStandardMaterial;
  private lampLevel = 1;

  constructor(shadowMapSize: number, shadows: boolean) {
    const m = M();
    const g = this.group;

    /* ---- floor ---- */
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(ROOM.rightX - ROOM.leftX, ROOM.frontZ - ROOM.backZ),
      m.floor,
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((ROOM.leftX + ROOM.rightX) / 2, 0, (ROOM.backZ + ROOM.frontZ) / 2);
    floor.receiveShadow = shadows;
    g.add(floor);

    /* ---- walls (back wall built around the window opening) ---- */
    const wallH = ROOM.ceilY;
    const wl = WINDOW.cx - WINDOW.w / 2, wr = WINDOW.cx + WINDOW.w / 2;
    const wb = WINDOW.cy - WINDOW.h / 2, wt = WINDOW.cy + WINDOW.h / 2;
    const backPanel = (x0: number, x1: number, y0: number, y1: number) => {
      const mesh = new THREE.Mesh(bevelBox(x1 - x0, y1 - y0, 0.12), m.wall);
      mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, ROOM.backZ - 0.06);
      mesh.receiveShadow = shadows;
      g.add(mesh);
    };
    backPanel(ROOM.leftX, wl, 0, wallH);
    backPanel(wr, ROOM.rightX, 0, wallH);
    backPanel(wl, wr, 0, wb);
    backPanel(wl, wr, wt, wallH);

    const side = (x: number, flip: number) => {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(ROOM.frontZ - ROOM.backZ, wallH), m.wall);
      mesh.rotation.y = flip * Math.PI / 2;
      mesh.position.set(x, wallH / 2, (ROOM.backZ + ROOM.frontZ) / 2);
      mesh.receiveShadow = shadows;
      g.add(mesh);
    };
    side(ROOM.leftX, 1);
    side(ROOM.rightX, -1);

    const ceil = new THREE.Mesh(
      new THREE.PlaneGeometry(ROOM.rightX - ROOM.leftX, ROOM.frontZ - ROOM.backZ), m.wall);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(0, ROOM.ceilY, (ROOM.backZ + ROOM.frontZ) / 2);
    g.add(ceil);

    /* ---- ceiling beams ---- */
    for (let i = 0; i < 4; i++) {
      const beam = new THREE.Mesh(
        bevelBox(ROOM.rightX - ROOM.leftX, 0.14, 0.11, 0.006), m.beam);
      beam.position.set(0, ROOM.ceilY - 0.075, ROOM.backZ + 0.5 + i * 0.82);
      beam.castShadow = shadows;
      g.add(beam);
    }

    /* ---- window ---- */
    g.add(this.buildWindow(shadows));

    /* ---- timber framing: the shop is built, not wallpapered ---- */
    for (const px of [-0.86, 1.16]) {
      const postM = new THREE.Mesh(bevelBox(0.115, ROOM.ceilY, 0.075, 0.004), m.beam);
      postM.position.set(px, ROOM.ceilY / 2, ROOM.backZ + 0.038);
      postM.castShadow = shadows;
      postM.receiveShadow = shadows;
      g.add(postM);
    }
    const rail = new THREE.Mesh(
      bevelBox(ROOM.rightX - ROOM.leftX, 0.10, 0.06, 0.004), m.beam);
    rail.position.set(0, 1.03, ROOM.backZ + 0.032);
    rail.receiveShadow = shadows;
    g.add(rail);
    const railTop = new THREE.Mesh(
      bevelBox(ROOM.rightX - ROOM.leftX, 0.085, 0.055, 0.004), m.beam);
    railTop.position.set(0, 2.20, ROOM.backZ + 0.030);
    g.add(railTop);

    /* ---- tool wall, shelf, lathe ---- */
    g.add(this.buildToolWall(shadows));
    g.add(this.buildShelf(shadows));
    g.add(this.buildLathe(shadows));
    g.add(this.buildStove(shadows));

    /* ---- lights ---- */
    this.ambient = new THREE.HemisphereLight(0x44607e, 0x2e1e14, 0.46);
    g.add(this.ambient);

    this.windowFill = new THREE.DirectionalLight(0x8fb4e4, 1.35);
    this.windowFill.position.set(WINDOW.cx + 0.5, WINDOW.cy + 0.9, ROOM.backZ - 2.2);
    this.windowFill.target.position.set(0, BENCH_TOP, 0.1);
    g.add(this.windowFill, this.windowFill.target);

    // a small cold bounce right at the glass so the sill and frost read
    this.windowGlow = new THREE.PointLight(0x9fc0e8, 0.8, 2.6, 2);
    this.windowGlow.position.set(WINDOW.cx, WINDOW.cy - 0.1, ROOM.backZ + 0.16);
    g.add(this.windowGlow);

    const lampGroup = new THREE.Group();
    const cord = new THREE.Mesh(
      new THREE.CylinderGeometry(0.004, 0.004, 0.46, 6), m.cloth);
    cord.position.set(0, ROOM.ceilY - 0.23, 0);
    lampGroup.add(cord);
    this.lampShade = new THREE.Mesh(lathe([
      [0.012, 0], [0.014, 0.008], [0.055, 0.028], [0.115, 0.10],
      [0.128, 0.115], [0.128, 0.122], [0.118, 0.118], [0.05, 0.036], [0.012, 0.006],
    ], 28), m.paintTeal);
    this.lampShade.position.set(0, ROOM.ceilY - 0.58, 0);
    this.lampShade.castShadow = shadows;
    lampGroup.add(this.lampShade);
    this.lampBulbMat = new THREE.MeshStandardMaterial({
      color: 0x2a2318, emissive: 0xffd9a0, emissiveIntensity: 3.2, roughness: 0.4,
    });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.026, 12, 10), this.lampBulbMat);
    bulb.position.set(0, ROOM.ceilY - 0.60, 0);
    lampGroup.add(bulb);
    lampGroup.position.set(0.02, 0, 0.12);
    g.add(lampGroup);

    this.lamp = new THREE.SpotLight(0xffdcbc, 6.4, 4.2, Math.PI * 0.34, 0.62, 1.7);
    this.lamp.position.set(0.02, ROOM.ceilY - 0.62, 0.12);
    this.lampTarget.position.set(0.02, BENCH_TOP - 0.05, 0.05);
    this.lamp.target = this.lampTarget;
    this.lamp.castShadow = shadows;
    this.lamp.shadow.mapSize.set(shadowMapSize, shadowMapSize);
    this.lamp.shadow.camera.near = 0.4;
    this.lamp.shadow.camera.far = 4.0;
    this.lamp.shadow.bias = -0.0009;
    this.lamp.shadow.normalBias = 0.012;
    g.add(this.lamp, this.lampTarget);
  }

  /** 1 = working light, 0.28 = the light dropped for the finished room. */
  setLampLevel(v: number) {
    this.lampLevel = v;
    this.lamp.intensity = 6.4 * v;
    this.lampBulbMat.emissiveIntensity = 0.5 + 3.0 * v;
    (this.lampShade.material as THREE.MeshStandardMaterial).emissiveIntensity = v;
    this.ambient.intensity = 0.22 + 0.26 * v;
    this.windowFill.intensity = 1.35 + (1 - v) * 0.55; // the blue outside gains as the lamp drops
  }
  get lampValue() { return this.lampLevel; }

  private buildWindow(shadows: boolean) {
    const m = M();
    const grp = new THREE.Group();
    const { cx, cy, w, h, depth } = WINDOW;
    const frameT = 0.055;

    const frame = (fw: number, fh: number, x: number, y: number) => {
      const mesh = new THREE.Mesh(bevelBox(fw, fh, depth, 0.004), m.walnut);
      mesh.position.set(x, y, ROOM.backZ - depth / 2 + 0.02);
      mesh.castShadow = shadows;
      mesh.receiveShadow = shadows;
      grp.add(mesh);
    };
    frame(w + frameT * 2, frameT, cx, cy + h / 2 + frameT / 2);
    frame(w + frameT * 2, frameT * 1.6, cx, cy - h / 2 - frameT * 0.8);
    frame(frameT, h + frameT * 2, cx - w / 2 - frameT / 2, cy);
    frame(frameT, h + frameT * 2, cx + w / 2 + frameT / 2, cy);
    // mullions: two columns, two rows -> six panes
    frame(0.026, h, cx - w / 6, cy);
    frame(0.026, h, cx + w / 6, cy);
    frame(w, 0.024, cx, cy);

    // sill with a little heap of snow blown onto the outside edge
    const sill = new THREE.Mesh(bevelBox(w + 0.2, 0.036, 0.2, 0.005), m.walnut);
    sill.position.set(cx, cy - h / 2 - frameT * 1.6 - 0.012, ROOM.backZ + 0.03);
    sill.castShadow = shadows; sill.receiveShadow = shadows;
    grp.add(sill);

    const glass = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m.glass);
    glass.position.set(cx, cy, ROOM.backZ - depth + 0.03);
    grp.add(glass);

    const frost = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m.frost);
    frost.position.set(cx, cy, ROOM.backZ - depth + 0.036);
    frost.renderOrder = 3;
    grp.add(frost);

    return grp;
  }

  private buildToolWall(shadows: boolean) {
    const m = M();
    const grp = new THREE.Group();
    const board = new THREE.Mesh(bevelBox(0.86, 0.72, 0.022, 0.003), m.shelf);
    board.position.set(-1.42, 1.62, ROOM.backZ + 0.015);
    board.receiveShadow = shadows;
    grp.add(board);

    // chisels: same blank, six sizes -> one instanced draw call
    const handle = lathe([
      [0.0, 0], [0.008, 0.004], [0.012, 0.02], [0.0125, 0.055],
      [0.0095, 0.082], [0.010, 0.088], [0.006, 0.092], [0, 0.093],
    ], 12);
    const chiselHandles = new THREE.InstancedMesh(handle, m.walnutTurned, 6);
    const blade = new THREE.BoxGeometry(0.013, 0.10, 0.0035);
    const chiselBlades = new THREE.InstancedMesh(blade, m.steel, 6);
    const mtx = new THREE.Matrix4();
    for (let i = 0; i < 6; i++) {
      const x = -1.74 + i * 0.115;
      const s = 0.85 + (i % 3) * 0.14;
      mtx.makeTranslation(x, 1.74, ROOM.backZ + 0.045);
      mtx.scale(new THREE.Vector3(s, s, s));
      chiselHandles.setMatrixAt(i, mtx);
      mtx.makeTranslation(x, 1.74 - 0.052 * s, ROOM.backZ + 0.045);
      mtx.scale(new THREE.Vector3(s, s, s));
      chiselBlades.setMatrixAt(i, mtx);
    }
    chiselHandles.instanceMatrix.needsUpdate = true;
    chiselBlades.instanceMatrix.needsUpdate = true;
    chiselHandles.castShadow = shadows;
    chiselBlades.castShadow = shadows;
    grp.add(chiselHandles, chiselBlades);

    // a saw and a mallet, hung the way a working shop hangs them
    const sawBlade = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.10, 0.0018), m.steel);
    sawBlade.position.set(-1.36, 1.46, ROOM.backZ + 0.042);
    sawBlade.rotation.z = -0.07;
    const sawHandle = new THREE.Mesh(bevelBox(0.10, 0.13, 0.018, 0.004), m.walnut);
    sawHandle.position.set(-1.60, 1.47, ROOM.backZ + 0.042);
    sawHandle.rotation.z = -0.07;
    grp.add(sawBlade, sawHandle);

    const malletHead = new THREE.Mesh(lathe([
      [0, 0], [0.036, 0], [0.038, 0.02], [0.036, 0.088], [0, 0.088],
    ], 14), m.walnutTurned);
    malletHead.position.set(-1.12, 1.42, ROOM.backZ + 0.05);
    malletHead.rotation.z = Math.PI / 2;
    const malletHandle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0105, 0.0125, 0.20, 10), m.mapleTurned);
    malletHandle.position.set(-1.12, 1.31, ROOM.backZ + 0.05);
    grp.add(malletHead, malletHandle);
    setShadow(grp, shadows, shadows);
    return grp;
  }

  private buildShelf(shadows: boolean) {
    const m = M();
    const grp = new THREE.Group();
    for (let s = 0; s < 2; s++) {
      const plank = new THREE.Mesh(bevelBox(0.82, 0.026, 0.24, 0.004), m.shelf);
      plank.position.set(1.55, 1.36 + s * 0.36, ROOM.backZ + 0.13);
      grp.add(plank);
      const bracketGeo = bevelBox(0.02, 0.13, 0.13, 0.002);
      for (const bx of [1.22, 1.88]) {
        const b = new THREE.Mesh(bracketGeo, m.steelDark);
        b.position.set(bx, 1.29 + s * 0.36, ROOM.backZ + 0.11);
        grp.add(b);
      }
    }
    // turning blanks and finished stock waiting to be used
    const rng = new Rng(88);
    for (let i = 0; i < 7; i++) {
      const hgt = 0.10 + rng.next() * 0.14;
      const r = 0.018 + rng.next() * 0.014;
      const blank = new THREE.Mesh(lathe([
        [0, 0], [r, 0], [r * (0.9 + rng.next() * 0.3), hgt * 0.5], [r, hgt], [0, hgt],
      ], 14), i % 2 ? m.mapleTurned : m.walnutTurned);
      blank.position.set(1.26 + i * 0.095, 1.386 + (i % 2 ? 0.36 : 0), ROOM.backZ + 0.10 + rng.next() * 0.06);
      grp.add(blank);
    }
    // a glue pot and a jar of brass pins
    const pot = new THREE.Mesh(lathe([
      [0, 0], [0.035, 0], [0.038, 0.02], [0.030, 0.07], [0.034, 0.08], [0.030, 0.084], [0, 0.084],
    ], 16), m.brassDark);
    pot.position.set(1.80, 1.386, ROOM.backZ + 0.13);
    grp.add(pot);
    setShadow(grp, shadows, shadows);
    return grp;
  }

  private buildLathe(shadows: boolean) {
    const m = M();
    const grp = new THREE.Group();
    const bedTop = 0.86;
    const bed = new THREE.Mesh(bevelBox(1.05, 0.075, 0.20, 0.005), m.benchFrame);
    bed.position.set(0, bedTop, 0);
    grp.add(bed);
    for (const lx of [-0.42, 0.42]) {
      const leg = new THREE.Mesh(bevelBox(0.08, bedTop - 0.04, 0.14, 0.004), m.benchFrame);
      leg.position.set(lx, (bedTop - 0.04) / 2, 0);
      grp.add(leg);
    }
    const head = new THREE.Mesh(bevelBox(0.16, 0.19, 0.17, 0.005), m.steelDark);
    head.position.set(-0.40, bedTop + 0.13, 0);
    grp.add(head);
    const tail = new THREE.Mesh(bevelBox(0.11, 0.15, 0.14, 0.005), m.steelDark);
    tail.position.set(0.40, bedTop + 0.11, 0);
    grp.add(tail);
    const spindle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.011, 0.011, 0.62, 10), m.steel);
    spindle.rotation.z = Math.PI / 2;
    spindle.position.set(0, bedTop + 0.14, 0);
    grp.add(spindle);
    // a half-turned blank still in the machine
    const work = new THREE.Mesh(lathe([
      [0.006, 0], [0.028, 0.02], [0.024, 0.09], [0.033, 0.15],
      [0.026, 0.24], [0.030, 0.30], [0.006, 0.33],
    ], 18), m.mapleTurned);
    work.rotation.z = Math.PI / 2;
    work.position.set(-0.17, bedTop + 0.14, 0);
    grp.add(work);
    const rest = new THREE.Mesh(bevelBox(0.24, 0.016, 0.03, 0.002), m.steelDark);
    rest.position.set(-0.05, bedTop + 0.10, 0.10);
    grp.add(rest);

    grp.position.set(-1.66, 0, -0.12);
    grp.rotation.y = 0.42;
    setShadow(grp, shadows, shadows);
    return grp;
  }

  /** A small iron stove in the corner - the reason the shop is warm at all. */
  private buildStove(shadows: boolean) {
    const m = M();
    const grp = new THREE.Group();
    const body = new THREE.Mesh(lathe([
      [0, 0], [0.13, 0], [0.135, 0.02], [0.13, 0.42], [0.145, 0.45],
      [0.145, 0.47], [0.12, 0.48], [0.05, 0.49], [0.045, 0.50], [0, 0.50],
    ], 18), m.steelDark);
    grp.add(body);
    const pipe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.042, 0.045, 1.5, 12), m.steelDark);
    pipe.position.y = 1.25;
    grp.add(pipe);
    const door = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.055, 0.01, 14), m.brassDark);
    door.rotation.x = Math.PI / 2;
    door.position.set(0, 0.22, 0.128);
    grp.add(door);
    const sootTex = makeSoot();
    sootTex.repeat.set(2, 1);
    const soot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.147, 0.147, 0.3, 18, 1, true),
      new THREE.MeshStandardMaterial({
        color: 0x0d0b0a, alphaMap: sootTex, transparent: true,
        roughness: 1, depthWrite: false, side: THREE.DoubleSide,
      }),
    );
    soot.position.y = 0.36;
    grp.add(soot);
    // an ember glow behind the door grate: warm, tiny, no shadow
    const glow = new THREE.PointLight(0xff7a2a, 0.5, 1.1, 2);
    glow.position.set(0, 0.25, 0.2);
    grp.add(glow);
    grp.position.set(1.92, 0, 0.62);
    setShadow(grp, shadows, shadows);
    return grp;
  }
}
