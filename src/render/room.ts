import * as THREE from 'three';
import { MM } from '../core/units';
import { makeWood, FIBRE_X, FIBRE_Y, type Palette } from './materials';
import { mergeSimple } from './parts';

export interface RoomLayout {
  /** where the assembly jig stands on the bench */
  jigOrigin: THREE.Vector3;
  /** height of the tree's shoulder plane while it is in the jig */
  jigShoulderY: number;
  /** where the pot is screwed down */
  potOrigin: THREE.Vector3;
  /** where the loose pieces wait, front of the bench */
  trayOrigin: THREE.Vector3;
}

export const layout: RoomLayout = {
  jigOrigin: new THREE.Vector3(-0.135, 0, 0.02),
  jigShoulderY: 0.062,
  potOrigin: new THREE.Vector3(0.105, 0, -0.035),
  trayOrigin: new THREE.Vector3(-0.088, 0.004, 0.205),
};

/** Collects geometry per material so the whole room is only a few draw calls. */
class Batch {
  private bins = new Map<THREE.Material, THREE.BufferGeometry[]>();

  add(mat: THREE.Material, geo: THREE.BufferGeometry, m?: THREE.Matrix4) {
    if (m) geo.applyMatrix4(m);
    const list = this.bins.get(mat) ?? [];
    list.push(geo);
    this.bins.set(mat, list);
  }

  box(mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    this.add(mat, g);
  }

  flush(parent: THREE.Object3D, cast = true, receive = true) {
    for (const [mat, list] of this.bins) {
      const mesh = new THREE.Mesh(mergeSimple(list), mat);
      mesh.castShadow = cast;
      mesh.receiveShadow = receive;
      parent.add(mesh);
    }
    this.bins.clear();
  }
}

/**
 * A winter workshop, built out of real geometry.  Depth comes from things
 * standing in front of other things, from their sizes and from the light —
 * there is no fog and no heavy background blur.
 */
export function buildRoom(palette: Palette, scene: THREE.Scene) {
  const worn = makeWood({
    name: 'worn',
    light: 0x9d8560,
    dark: 0x836b48,
    fibre: FIBRE_X,
    ringFreq: 110,
    wander: 0.02,
    roughness: 0.92,
    clearcoat: 0,
    contrast: 0.7,
    ringCentre: [0.41, 0.26],
  });

  const group = new THREE.Group();
  group.name = 'room';
  const b = new Batch();

  // ---- bench ------------------------------------------------------------
  b.box(palette.bench, 1.9, 0.052, 1.18, 0, -0.026, 0.11);
  for (const x of [-0.8, 0.8]) {
    b.box(palette.bench, 0.075, 0.72, 0.075, x, -0.41, 0.6);
    b.box(palette.bench, 0.075, 0.72, 0.075, x, -0.41, -0.36);
  }
  b.box(worn, 1.9, 0.1, 0.032, 0, -0.1, 0.685);
  // the patch of bench the jig has been clamped to for years
  b.box(worn, 0.19, 0.0014, 0.16, layout.jigOrigin.x, 0.0007, layout.jigOrigin.z);

  // ---- 治具 assembly jig -------------------------------------------------
  const j = layout.jigOrigin;
  b.box(palette.jig, 0.15, 0.018, 0.13, j.x, 0.009, j.z);
  {
    const socket = new THREE.CylinderGeometry(0.019, 0.023, layout.jigShoulderY - 0.018, 18);
    socket.translate(j.x, 0.018 + (layout.jigShoulderY - 0.018) / 2, j.z);
    b.add(palette.jig, socket);
    // rubbed ring on top of the socket, where the collar lands every time
    const face = new THREE.CylinderGeometry(0.019, 0.019, 0.0012, 18);
    face.translate(j.x, layout.jigShoulderY - 0.0004, j.z);
    b.add(worn, face);
    // brass ferrule round the socket, so it does not split
    const ferrule = new THREE.CylinderGeometry(0.0205, 0.0205, 0.006, 18, 1, true);
    ferrule.translate(j.x, 0.03, j.z);
    b.add(palette.brass, ferrule);
  }
  for (const s of [-1, 1]) {
    b.box(palette.jig, 0.015, 0.19, 0.015, j.x + s * 0.055, 0.113, j.z - 0.036);
    const from = new THREE.Vector3(j.x + s * 0.055, j.y + 0.135, j.z - 0.036);
    const to = new THREE.Vector3(j.x + s * 0.0195, j.y + 0.135, j.z - 0.009);
    const len = from.distanceTo(to);
    const ry = Math.atan2(-(to.z - from.z), to.x - from.x);
    const mid = from.clone().lerp(to, 0.5);
    b.box(palette.jig, len, 0.013, 0.013, mid.x, mid.y, mid.z, ry);
    // felt face, worn shiny, that actually touches the post
    b.box(palette.felt, 0.004, 0.013, 0.012, to.x, to.y, to.z, ry);
  }

  // ---- tray of loose parts ---------------------------------------------
  const t = layout.trayOrigin;
  b.box(palette.jig, 0.3, 0.006, 0.13, t.x, t.y - 0.003, t.z);
  b.box(worn, 0.3, 0.014, 0.006, t.x, t.y + 0.004, t.z - 0.068);
  b.box(worn, 0.3, 0.014, 0.006, t.x, t.y + 0.004, t.z + 0.068);
  b.box(worn, 0.006, 0.014, 0.136, t.x - 0.147, t.y + 0.004, t.z);
  b.box(worn, 0.006, 0.014, 0.136, t.x + 0.147, t.y + 0.004, t.z);

  // a chisel, laid where a chisel gets laid
  b.box(palette.steel, 0.088, 0.0035, 0.012, 0.335, 0.0045, 0.145, -0.5);
  {
    const handle = new THREE.CylinderGeometry(0.009, 0.011, 0.072, 10);
    handle.rotateZ(Math.PI / 2);
    handle.rotateY(-0.5);
    handle.translate(0.335 - Math.cos(-0.5) * 0.072, 0.0105, 0.145 + Math.sin(-0.5) * 0.072);
    b.add(worn, handle);
  }
  b.flush(group);

  // ---- 材の収納棚 lumber rack, behind the bench --------------------------
  const rack = new Batch();
  const rx = -0.3;
  const rz = -1.0;
  for (const x of [-0.52, 0.52]) rack.box(palette.rack, 0.05, 1.7, 0.05, rx + x, 0.1, rz);
  for (let s = 0; s < 4; s++) {
    const y = -0.6 + s * 0.35;
    rack.box(palette.rack, 1.09, 0.03, 0.3, rx, y, rz);
    const n = 4 + (s % 3);
    for (let i = 0; i < n; i++) {
      rack.box(
        palette.stock,
        0.92 - i * 0.03,
        0.016,
        0.2,
        rx + (i % 2) * 0.012 - 0.006,
        y + 0.024 + i * 0.018,
        rz + (i % 3) * 0.006,
      );
    }
  }
  rack.flush(group, true, true);

  // ---- walls, floor and the window --------------------------------------
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 8),
    new THREE.MeshStandardMaterial({ color: 0x3a3128, roughness: 1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.75;
  floor.receiveShadow = true;
  group.add(floor);

  const walls = new Batch();
  walls.box(palette.wall, 7, 3.4, 0.04, 0, 0.6, -1.56);
  walls.box(palette.wall, 0.04, 3.4, 3.4, -1.72, 0.6, 0);
  walls.flush(group, false, true);

  const win = new THREE.Group();
  win.position.set(0.92, 0.5, -1.5);
  const winLight = new THREE.Mesh(
    new THREE.PlaneGeometry(0.86, 1.0),
    new THREE.MeshBasicMaterial({ color: 0xccdcea }),
  );
  win.add(winLight);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 1.0), palette.glass);
  glass.position.z = 0.02;
  win.add(glass);
  const frameBits: THREE.BufferGeometry[] = [];
  for (const [w, h, x, y] of [
    [0.94, 0.05, 0, 0.525],
    [0.94, 0.05, 0, -0.525],
    [0.05, 1.1, -0.455, 0],
    [0.05, 1.1, 0.455, 0],
    [0.026, 1.0, 0, 0],
    [0.86, 0.026, 0, 0],
  ] as const) {
    const g = new THREE.BoxGeometry(w, h, 0.045);
    g.translate(x, y, 0.022);
    frameBits.push(g);
  }
  win.add(new THREE.Mesh(mergeSimple(frameBits), palette.rack));
  group.add(win);

  scene.add(group);

  // ---- light ------------------------------------------------------------
  const hemi = new THREE.HemisphereLight(0xc8d9ea, 0x53422f, 0.95);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xf6f2e6, 2.3);
  key.position.set(1.25, 1.55, -0.12);
  key.target.position.set(0.0, 0.12, 0.02);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 0.4;
  key.shadow.camera.far = 4.2;
  key.shadow.camera.left = -0.55;
  key.shadow.camera.right = 0.55;
  key.shadow.camera.top = 0.65;
  key.shadow.camera.bottom = -0.3;
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.012;
  scene.add(key, key.target);

  // warm bounce off the room, and a soft front fill so the near faces read
  const fill = new THREE.PointLight(0xffcf9a, 1.05, 3.0, 2);
  fill.position.set(-0.62, 0.5, 0.5);
  scene.add(fill);

  const front = new THREE.DirectionalLight(0xdfe8f0, 0.45);
  front.position.set(0.1, 0.55, 1.3);
  front.target.position.set(0, 0.12, 0);
  scene.add(front, front.target);

  return { group, key, hemi, fill, front };
}

/**
 * A small procedural environment, so the brass and steel have something to
 * reflect and the oil finish has a sheen.  It is generated in code — there is no
 * image to download.
 */
export function buildEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const w = 96;
  const h = 48;
  const data = new Float32Array(w * h * 4);
  const put = (i: number, r: number, g: number, b: number) => {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 1;
  };
  for (let y = 0; y < h; y++) {
    const v = y / (h - 1); // 0 at the top
    for (let x = 0; x < w; x++) {
      const u = x / (w - 1);
      // ceiling and upper wall are cool, the floor is warm timber
      let r = 0.30 + (1 - v) * 0.30;
      let g = 0.31 + (1 - v) * 0.32;
      let b = 0.33 + (1 - v) * 0.36;
      if (v > 0.58) {
        const k = (v - 0.58) / 0.42;
        r = 0.26 - k * 0.14;
        g = 0.20 - k * 0.11;
        b = 0.15 - k * 0.09;
      }
      // the window: one bright patch, on the right of the room
      const du = Math.min(Math.abs(u - 0.22), 1 - Math.abs(u - 0.22));
      const dv = v - 0.44;
      const win = Math.exp(-(du * du) / 0.004 - (dv * dv) / 0.012);
      r += win * 2.7;
      g += win * 2.9;
      b += win * 3.1;
      put(y * w + x, r, g, b);
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.needsUpdate = true;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(tex).texture;
  pmrem.dispose();
  tex.dispose();
  return env;
}

/** Small turned beads on cloth cords: a few, hung from real places. */
export function buildOrnaments(palette: Palette) {
  const bead = new THREE.SphereGeometry(6.5 * MM, 14, 10);
  const cordGeo = new THREE.CylinderGeometry(0.55 * MM, 0.55 * MM, 26 * MM, 6);
  cordGeo.translate(0, -13 * MM, 0);
  const beadWood = makeWood({
    name: 'bead',
    light: 0xd8b487,
    dark: 0xb08a5c,
    fibre: FIBRE_Y,
    ringFreq: 520,
    wander: 0.02,
    roughness: 0.5,
    clearcoat: 0.35,
    contrast: 0.6,
    ringCentre: [0.004, 0.002],
  });
  return { bead, cordGeo, beadWood, cordMat: palette.cord };
}
