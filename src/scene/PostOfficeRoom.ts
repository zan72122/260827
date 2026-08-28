import * as THREE from 'three';
import { Rng } from '../core/rng';
import { snowSprite } from '../core/textures';
import type { MaterialLibrary } from './materials';
import { PostWorker } from './Worker';

export const LAYOUT = {
  floorY: 0,
  counterTop: 0.92,
  counter: { minX: -3.0, maxX: 1.7, minZ: 0.3, maxZ: 1.5 },
  intakeBelt: { fromX: -6.1, toX: -3.0, z: 0.9, height: 0.62 },
  bagDrop: new THREE.Vector3(-3.25, 0.72, 0.9),
  pressPos: new THREE.Vector3(-0.75, 0.92, 0.9),
  inTray: new THREE.Vector3(-1.6, 0.95, 0.5),
  handoffPos: new THREE.Vector3(0.75, 0.945, 0.9),
  sorterOrigin: new THREE.Vector3(0.45, 0, -1.35),
  dockOrigin: new THREE.Vector3(5.6, 0, 0.4),
  mapCenter: new THREE.Vector3(-4.6, 1.95, -4.05),
  roomMinX: -6.4,
  roomMaxX: 5.6,
  roomMinZ: -4.2,
  roomMaxZ: 3.4,
  ceilingY: 3.6,
};

class SnowField {
  readonly points: THREE.Points;
  private velocities: Float32Array;
  private box: THREE.Box3;

  constructor(count: number, box: THREE.Box3, seed: number) {
    this.box = box;
    const positions = new Float32Array(count * 3);
    this.velocities = new Float32Array(count * 2);
    const rng = new Rng(seed);
    const size = box.getSize(new THREE.Vector3());
    for (let i = 0; i < count; i++) {
      positions[i * 3] = box.min.x + rng.next() * size.x;
      positions[i * 3 + 1] = box.min.y + rng.next() * size.y;
      positions[i * 3 + 2] = box.min.z + rng.next() * size.z;
      this.velocities[i * 2] = rng.range(0.12, 0.4);
      this.velocities[i * 2 + 1] = rng.range(-0.09, 0.09);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.055,
      map: snowSprite(),
      transparent: true,
      depthWrite: false,
      opacity: 0.85,
      color: 0xdcebff,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
  }

  update(dt: number, t: number): void {
    const attr = this.points.geometry.attributes.position as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < arr.length / 3; i++) {
      arr[i * 3 + 1] -= this.velocities[i * 2] * dt;
      arr[i * 3] += Math.sin(t * 0.6 + i) * dt * 0.09 + this.velocities[i * 2 + 1] * dt;
      if (arr[i * 3 + 1] < this.box.min.y) {
        arr[i * 3 + 1] = this.box.max.y;
      }
      if (arr[i * 3] < this.box.min.x) arr[i * 3] = this.box.max.x;
      if (arr[i * 3] > this.box.max.x) arr[i * 3] = this.box.min.x;
    }
    attr.needsUpdate = true;
  }
}

/**
 * The building itself: a working postal hall that happens to be in the Arctic.
 * Christmas comes from the window, the cancellation, the bags and the letters,
 * not from red-and-green paint on every surface.
 */
export class PostOfficeRoom {
  readonly group = new THREE.Group();
  readonly counter = new THREE.Group();
  readonly workLights: THREE.SpotLight[] = [];
  readonly workers: PostWorker[] = [];

  private snowOutside: SnowField | null = null;
  private snowDock: SnowField | null = null;
  private mats: MaterialLibrary;
  private lampBulbs: THREE.Mesh[] = [];

  constructor(mats: MaterialLibrary, snowCount: number) {
    this.mats = mats;
    this.buildShell();
    this.buildCounter();
    this.buildLighting();
    this.buildMapLight();
    this.buildOutside();
    this.setSnowCount(snowCount);
    this.buildDressing();
  }

  private buildShell(): void {
    const { roomMinX, roomMaxX, roomMinZ, roomMaxZ, ceilingY } = LAYOUT;
    const w = roomMaxX - roomMinX;
    const d = roomMaxZ - roomMinZ;
    const cx = (roomMinX + roomMaxX) / 2;
    const cz = (roomMinZ + roomMaxZ) / 2;

    const floor = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, d), this.mats.concrete);
    floor.position.set(cx, -0.05, cz);
    floor.receiveShadow = true;
    this.group.add(floor);

    // painted floor lane markings: this is a working floor
    const lane = new THREE.Mesh(
      new THREE.BoxGeometry(w - 1.2, 0.002, 0.06),
      new THREE.MeshStandardMaterial({ color: 0xa5924f, roughness: 0.9 }),
    );
    lane.position.set(cx, 0.002, 1.9);
    this.group.add(lane);

    // single sided and facing down, so the raised portrait shot looks straight in
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(w, d), this.mats.wallPlaster);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(cx, ceilingY, cz);
    this.group.add(ceil);

    for (let i = 0; i < 5; i++) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(w, 0.16, 0.14), this.mats.woodDark);
      beam.position.set(cx, ceilingY - 0.09, roomMinZ + 0.9 + i * 1.5);
      this.group.add(beam);
    }

    // --- back wall with a real window opening
    const winMinX = 2.1;
    const winMaxX = 5.2;
    const winMinY = 1.35;
    const winMaxY = 2.65;
    const wallZ = roomMinZ;
    const seg = (x0: number, x1: number, y0: number, y1: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, 0.16), this.mats.wallPlaster);
      m.position.set((x0 + x1) / 2, (y0 + y1) / 2, wallZ);
      m.receiveShadow = true;
      this.group.add(m);
    };
    seg(roomMinX, winMinX, 0, ceilingY);
    seg(winMaxX, roomMaxX, 0, ceilingY);
    seg(winMinX, winMaxX, 0, winMinY);
    seg(winMinX, winMaxX, winMaxY, ceilingY);

    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(winMaxX - winMinX, winMaxY - winMinY, 0.012),
      this.mats.glass,
    );
    glass.position.set((winMinX + winMaxX) / 2, (winMinY + winMaxY) / 2, wallZ);
    this.group.add(glass);

    // mullions, and a little frost only where the pane meets the frame
    for (let i = 1; i < 4; i++) {
      const mull = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, winMaxY - winMinY, 0.1),
        this.mats.woodDark,
      );
      mull.position.set(winMinX + ((winMaxX - winMinX) * i) / 4, (winMinY + winMaxY) / 2, wallZ);
      this.group.add(mull);
    }
    const sill = new THREE.Mesh(new THREE.BoxGeometry(winMaxX - winMinX + 0.2, 0.07, 0.28), this.mats.woodDark);
    sill.position.set((winMinX + winMaxX) / 2, winMinY - 0.02, wallZ + 0.06);
    this.group.add(sill);
    for (const y of [winMinY + 0.03, winMaxY - 0.03]) {
      const frost = new THREE.Mesh(
        new THREE.BoxGeometry(winMaxX - winMinX, 0.09, 0.006),
        new THREE.MeshStandardMaterial({ color: 0xe6f1ff, roughness: 0.9, transparent: true, opacity: 0.55 }),
      );
      frost.position.set((winMinX + winMaxX) / 2, y, wallZ + 0.012);
      this.group.add(frost);
    }

    // --- side walls, with the dock opening left out of the right one
    const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.16, ceilingY, d), this.mats.wallPlaster);
    leftWall.position.set(roomMinX, ceilingY / 2, cz);
    this.group.add(leftWall);

    const dockZ0 = LAYOUT.dockOrigin.z - 1.15;
    const dockZ1 = LAYOUT.dockOrigin.z + 1.15;
    const rseg = (z0: number, z1: number, y0: number, y1: number) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.16, y1 - y0, z1 - z0), this.mats.wallPlaster);
      m.position.set(roomMaxX, (y0 + y1) / 2, (z0 + z1) / 2);
      this.group.add(m);
    };
    rseg(roomMinZ, dockZ0, 0, ceilingY);
    rseg(dockZ1, roomMaxZ, 0, ceilingY);
    rseg(dockZ0, dockZ1, 2.5, ceilingY);

    // the near wall closes the room when seen from the window, and vanishes
    // for the shots that step back through it
    const frontWall = new THREE.Mesh(new THREE.PlaneGeometry(w, ceilingY), this.mats.wallPlaster);
    frontWall.rotation.y = Math.PI;
    frontWall.position.set(cx, ceilingY / 2, roomMaxZ);
    this.group.add(frontWall);
  }

  private buildCounter(): void {
    const { counter, counterTop } = LAYOUT;
    const w = counter.maxX - counter.minX;
    const d = counter.maxZ - counter.minZ;
    const cx = (counter.minX + counter.maxX) / 2;
    const cz = (counter.minZ + counter.maxZ) / 2;

    const topMat = this.mats.wood.clone();
    if (topMat.map) {
      topMat.map = topMat.map.clone();
      topMat.map.needsUpdate = true;
      topMat.map.repeat.set(5, 2);
    }
    const top = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, d), topMat);
    top.position.set(cx, counterTop - 0.03, cz);
    top.receiveShadow = true;
    top.castShadow = true;
    this.counter.add(top);

    const nosing = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, 0.04), this.mats.woodDark);
    nosing.position.set(cx, counterTop - 0.055, counter.maxZ);
    this.counter.add(nosing);

    for (const x of [counter.minX + 0.3, cx, counter.maxX - 0.3]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.09, counterTop - 0.06, 0.09), this.mats.woodDark);
      leg.position.set(x, (counterTop - 0.06) / 2, counter.minZ + 0.25);
      this.counter.add(leg);
      const leg2 = leg.clone();
      leg2.position.z = counter.maxZ - 0.25;
      this.counter.add(leg2);
    }
    const stretcher = new THREE.Mesh(new THREE.BoxGeometry(w - 0.3, 0.05, 0.05), this.mats.woodDark);
    stretcher.position.set(cx, 0.28, cz);
    this.counter.add(stretcher);

    // the in-tray the day's loose mail waits in
    const trayFloor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.014, 0.2), this.mats.woodDark);
    trayFloor.position.copy(LAYOUT.inTray);
    trayFloor.position.y = LAYOUT.counterTop + 0.007;
    trayFloor.receiveShadow = true;
    this.counter.add(trayFloor);
    for (const [dx, dz, w2, d2] of [
      [0.152, 0, 0.012, 0.21],
      [-0.152, 0, 0.012, 0.21],
      [0, 0.105, 0.32, 0.012],
      [0, -0.105, 0.32, 0.012],
    ] as [number, number, number, number][]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w2, 0.05, d2), this.mats.woodDark);
      wall.position.set(LAYOUT.inTray.x + dx, LAYOUT.counterTop + 0.032, LAYOUT.inTray.z + dz);
      this.counter.add(wall);
    }

    // a shallow tray of rubber bands and string, and a worn pen rest
    const tray = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.03, 0.2), this.mats.brass);
    tray.position.set(counter.minX + 0.45, counterTop + 0.015, counter.minZ + 0.3);
    this.counter.add(tray);
    for (let i = 0; i < 5; i++) {
      const coil = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.005, 5, 12), this.mats.rope);
      coil.rotation.x = Math.PI / 2 + i * 0.2;
      coil.position.set(counter.minX + 0.4 + i * 0.02, counterTop + 0.035, counter.minZ + 0.3);
      this.counter.add(coil);
    }

    this.group.add(this.counter);
  }

  private buildLighting(): void {
    const hemi = new THREE.HemisphereLight(0x9ab8d8, 0x50432f, 0.75);
    this.group.add(hemi);

    // a low warm fill so the hall reads as inhabited from outside the window
    const fill = new THREE.AmbientLight(0xffe0bb, 0.2);
    this.group.add(fill);

    // the cold outside, coming through the window
    const sun = new THREE.DirectionalLight(0xa8cbf0, 1.5);
    sun.position.set(4.4, 5.2, -9);
    sun.target.position.set(1.2, 0.9, -0.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -8;
    sun.shadow.camera.right = 8;
    sun.shadow.camera.top = 7;
    sun.shadow.camera.bottom = -3;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 24;
    sun.shadow.bias = -0.0012;
    this.group.add(sun, sun.target);

    // two warm working lamps, hung from the beams
    const lampSpots: [number, number, number][] = [
      [LAYOUT.pressPos.x, 2.9, 1.0],
      [LAYOUT.sorterOrigin.x + 0.3, 2.9, -1.5],
      [-3.6, 2.9, 0.9],
      [4.2, 2.9, -0.4],
    ];
    for (const [x, y, z] of lampSpots) {
      const shade = new THREE.Mesh(
        new THREE.ConeGeometry(0.24, 0.2, 18, 1, true),
        new THREE.MeshStandardMaterial({ color: 0x2f3a3d, roughness: 0.5, metalness: 0.4, side: THREE.DoubleSide }),
      );
      shade.position.set(x, y, z);
      this.group.add(shade);
      const flex = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, LAYOUT.ceilingY - y, 6), this.mats.steelPainted);
      flex.position.set(x, y + (LAYOUT.ceilingY - y) / 2, z);
      this.group.add(flex);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 9), this.mats.lampOn);
      bulb.position.set(x, y - 0.08, z);
      this.lampBulbs.push(bulb);
      this.group.add(bulb);

      const spot = new THREE.SpotLight(0xffc98d, 30, 10, 0.95, 0.7, 2);
      spot.position.set(x, y - 0.08, z);
      spot.target.position.set(x, 0.8, z);
      spot.castShadow = this.workLights.length < 1;
      spot.shadow.mapSize.set(1024, 1024);
      spot.shadow.bias = -0.001;
      this.workLights.push(spot);
      this.group.add(spot, spot.target);
    }
  }

  private buildMapLight(): void {
    const x = LAYOUT.mapCenter.x;
    const z = LAYOUT.mapCenter.z + 0.5;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.7), this.mats.brass);
    arm.position.set(x, 2.98, z - 0.3);
    this.group.add(arm);
    const hood = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.09, 0.14, 14, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x6b5326, metalness: 0.7, roughness: 0.45, side: THREE.DoubleSide }),
    );
    hood.rotation.x = 0.9;
    hood.position.set(x, 2.94, z);
    this.group.add(hood);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), this.mats.lampOn);
    bulb.position.set(x, 2.9, z);
    this.lampBulbs.push(bulb);
    this.group.add(bulb);

    const chart = new THREE.SpotLight(0xffd9a8, 10, 5.5, 0.95, 0.95, 2);
    chart.position.set(x, 2.9, z);
    chart.target.position.set(x, 1.65, LAYOUT.mapCenter.z);
    this.workLights.push(chart);
    this.group.add(chart, chart.target);
  }

  private buildOutside(): void {
    // snow ground and a dark treeline seen through the window
    const ground = new THREE.Mesh(new THREE.BoxGeometry(30, 0.2, 14), this.mats.snow);
    ground.position.set(0, -0.12, LAYOUT.roomMinZ - 7);
    this.group.add(ground);

    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(38, 16, 10),
      new THREE.MeshBasicMaterial({ color: 0x41628c, side: THREE.BackSide, fog: false }),
    );
    this.group.add(sky);

    const rng = new Rng(88);
    const trunkGeo = new THREE.CylinderGeometry(0.05, 0.08, 1.2, 6);
    const coneGeo = new THREE.ConeGeometry(0.72, 2.6, 8);
    const treeMat = new THREE.MeshStandardMaterial({ color: 0x3a4c40, roughness: 0.95 });
    const snowCapMat = this.mats.snow;
    for (let i = 0; i < 30; i++) {
      const x = rng.range(-14, 15);
      const z = LAYOUT.roomMinZ - rng.range(2.5, 13);
      // keep the sight line from the outside shot into the window clear
      if (x > -1.5 && x < 8.5 && z > -12.2 && z < -4.6) continue;
      const s = rng.range(0.7, 1.5);
      const trunk = new THREE.Mesh(trunkGeo, this.mats.woodDark);
      trunk.position.set(x, 0.6 * s, z);
      trunk.scale.setScalar(s);
      this.group.add(trunk);
      const cone = new THREE.Mesh(coneGeo, treeMat);
      cone.position.set(x, 2.3 * s, z);
      cone.scale.setScalar(s);
      this.group.add(cone);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.7, 8), snowCapMat);
      cap.position.set(x, 3.35 * s, z);
      cap.scale.setScalar(s);
      this.group.add(cap);
    }
  }

  setSnowCount(count: number): void {
    if (this.snowOutside) {
      this.group.remove(this.snowOutside.points);
      this.snowOutside.points.geometry.dispose();
    }
    if (this.snowDock) {
      this.group.remove(this.snowDock.points);
      this.snowDock.points.geometry.dispose();
    }
    this.snowOutside = new SnowField(
      Math.round(count * 0.7),
      new THREE.Box3(
        new THREE.Vector3(-10, 0, LAYOUT.roomMinZ - 11),
        new THREE.Vector3(12, 7.5, LAYOUT.roomMinZ - 1),
      ),
      12,
    );
    this.group.add(this.snowOutside.points);

    this.snowDock = new SnowField(
      Math.round(count * 0.3),
      new THREE.Box3(
        new THREE.Vector3(LAYOUT.roomMaxX + 0.3, 0, LAYOUT.dockOrigin.z - 4),
        new THREE.Vector3(LAYOUT.roomMaxX + 9, 6, LAYOUT.dockOrigin.z + 4),
      ),
      13,
    );
    this.group.add(this.snowDock.points);
  }

  private buildDressing(): void {
    // a few spruce sprigs over the counter - the only seasonal decoration inside
    const rng = new Rng(303);
    const needleMat = new THREE.MeshStandardMaterial({ color: 0x2f4234, roughness: 0.9 });
    for (const [x, z] of [
      [-2.55, 0.45],
      [1.5, 0.45],
    ] as [number, number][]) {
      const sprig = new THREE.Group();
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.3, 5), this.mats.woodDark);
      stem.rotation.z = 0.4;
      sprig.add(stem);
      for (let i = 0; i < 7; i++) {
        const n = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.13, 5), needleMat);
        n.position.set(rng.range(-0.09, 0.09), rng.range(-0.12, 0.12), rng.range(-0.04, 0.04));
        n.rotation.set(rng.range(0, 3), rng.range(0, 3), rng.range(0, 3));
        sprig.add(n);
      }
      const berry = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 6), this.mats.paintedRed);
      berry.position.set(0.03, -0.05, 0.02);
      sprig.add(berry);
      sprig.scale.setScalar(0.62);
      sprig.position.set(x, LAYOUT.counterTop + 0.09, z);
      this.group.add(sprig);
    }

    // wall pegboard with hanging tools, and a stack of empty bags
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.9, 0.04), this.mats.woodDark);
    board.position.set(-2.2, 1.9, LAYOUT.roomMinZ + 0.1);
    this.group.add(board);
    for (let i = 0; i < 5; i++) {
      const tool = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.24, 0.03),
        i % 2 === 0 ? this.mats.steelRaw : this.mats.brass,
      );
      tool.position.set(-2.7 + i * 0.26, 1.95, LAYOUT.roomMinZ + 0.14);
      this.group.add(tool);
    }

    // two workers at their positions
    const w1 = new PostWorker(this.mats, 0);
    w1.group.position.set(-3.6, 0, 0.2);
    w1.group.rotation.y = 0.7;
    this.workers.push(w1);
    this.group.add(w1.group);

    const w2 = new PostWorker(this.mats, 1);
    w2.group.position.set(2.9, 0, -2.4);
    w2.group.rotation.y = -0.9;
    this.workers.push(w2);
    this.group.add(w2.group);
  }

  setLampsOn(on: boolean): void {
    for (const l of this.workLights) l.intensity = on ? 30 : 8;
    for (const b of this.lampBulbs) {
      (b.material as THREE.MeshStandardMaterial).emissiveIntensity = on ? 1.6 : 0.4;
    }
  }

  setShadowMapSize(size: number): void {
    for (const l of this.workLights) {
      l.shadow.mapSize.set(size, size);
      l.shadow.map?.dispose();
      l.shadow.map = null;
    }
  }

  update(dt: number, t: number): void {
    this.snowOutside?.update(dt, t);
    this.snowDock?.update(dt, t);
    for (const w of this.workers) w.update(t);
  }
}
