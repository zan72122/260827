import * as THREE from 'three';
import { WORLD } from './rig';
import { makeDeckMaps, makeGripMaps, makeLakeBackdrop } from './textures';
import type { QualitySettings } from './quality';

const ROD_BUTT = new THREE.Vector3(-0.52, 1.9, 0.42);
const ROD_SEGMENTS = 26;
const ROD_RADIAL = 8;

export interface RodHandle {
  group: THREE.Group;
  /** static load bend, 0..1 */
  bend: number;
  /** live vibration in metres of tip travel */
  vib: number;
  vibDir: THREE.Vector3;
  tip: THREE.Vector3;
  update(): void;
}

function buildRod(env: THREE.Texture): RodHandle {
  const group = new THREE.Group();
  const nominalTip = WORLD.rodTip.clone();
  const positions = new Float32Array((ROD_SEGMENTS + 1) * (ROD_RADIAL + 1) * 3);
  const normals = new Float32Array(positions.length);
  const uvs: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= ROD_SEGMENTS; i++) {
    for (let j = 0; j <= ROD_RADIAL; j++) {
      uvs.push(i / ROD_SEGMENTS, j / ROD_RADIAL);
    }
  }
  for (let i = 0; i < ROD_SEGMENTS; i++) {
    for (let j = 0; j < ROD_RADIAL; j++) {
      const a = i * (ROD_RADIAL + 1) + j;
      const b = a + ROD_RADIAL + 1;
      index.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(index);

  const mat = new THREE.MeshPhysicalMaterial({
    color: 0x1a1d21,
    metalness: 0.1,
    roughness: 0.32,
    clearcoat: 0.7,
    clearcoatRoughness: 0.16,
    envMap: env,
    envMapIntensity: 0.6,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  group.add(mesh);

  const guideMat = new THREE.MeshPhysicalMaterial({
    color: 0x9aa0a6,
    metalness: 0.85,
    roughness: 0.36,
    envMap: env,
    envMapIntensity: 0.8,
  });
  const guides: THREE.Mesh[] = [];
  for (let k = 0; k < 4; k++) {
    const r = 0.011 - k * 0.0017;
    const g = new THREE.Mesh(new THREE.TorusGeometry(r, r * 0.22, 6, 14), guideMat);
    g.castShadow = true;
    guides.push(g);
    group.add(g);
  }

  const P = new THREE.Vector3();
  const T = new THREE.Vector3();
  const N = new THREE.Vector3();
  const B = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= ROD_SEGMENTS; i++) pts.push(new THREE.Vector3());

  const handle: RodHandle = {
    group,
    bend: 0,
    vib: 0,
    vibDir: new THREE.Vector3(0, -1, 0),
    tip: nominalTip.clone(),
    update() {
      const drop = handle.bend * 0.075 + handle.vib;
      for (let i = 0; i <= ROD_SEGMENTS; i++) {
        const t = i / ROD_SEGMENTS;
        pts[i].lerpVectors(ROD_BUTT, nominalTip, t);
        const shape = t * t;
        pts[i].y -= drop * shape;
        pts[i].addScaledVector(handle.vibDir, handle.vib * shape * 0.35);
      }
      handle.tip.copy(pts[ROD_SEGMENTS]);
      const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
      const norAttr = geo.getAttribute('normal') as THREE.BufferAttribute;
      for (let i = 0; i <= ROD_SEGMENTS; i++) {
        const t = i / ROD_SEGMENTS;
        P.copy(pts[i]);
        T.copy(pts[Math.min(ROD_SEGMENTS, i + 1)]).sub(pts[Math.max(0, i - 1)]).normalize();
        N.copy(up).cross(T).normalize();
        B.copy(T).cross(N).normalize();
        const r = 0.0115 * Math.pow(1 - t, 1.35) + 0.0016;
        for (let j = 0; j <= ROD_RADIAL; j++) {
          const a = (j / ROD_RADIAL) * Math.PI * 2;
          const nx = N.x * Math.cos(a) + B.x * Math.sin(a);
          const ny = N.y * Math.cos(a) + B.y * Math.sin(a);
          const nz = N.z * Math.cos(a) + B.z * Math.sin(a);
          const idx = i * (ROD_RADIAL + 1) + j;
          posAttr.setXYZ(idx, P.x + nx * r, P.y + ny * r, P.z + nz * r);
          norAttr.setXYZ(idx, nx, ny, nz);
        }
      }
      posAttr.needsUpdate = true;
      norAttr.needsUpdate = true;
      geo.computeBoundingSphere();

      const gt = [0.42, 0.6, 0.78, 0.95];
      for (let k = 0; k < guides.length; k++) {
        const i = Math.round(gt[k] * ROD_SEGMENTS);
        T.copy(pts[Math.min(ROD_SEGMENTS, i + 1)]).sub(pts[Math.max(0, i - 1)]).normalize();
        guides[k].position.copy(pts[i]).addScaledVector(up, -0.012);
        guides[k].quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), T);
      }
    },
  };
  handle.update();
  return handle;
}

export interface ReelHandle {
  group: THREE.Group;
  setSpool(angle: number): void;
}

function buildReel(env: THREE.Texture, grip: ReturnType<typeof makeGripMaps>): ReelHandle {
  const group = new THREE.Group();
  const resin = new THREE.MeshPhysicalMaterial({
    color: 0x23282d,
    metalness: 0.12,
    roughness: 0.42,
    clearcoat: 0.45,
    clearcoatRoughness: 0.28,
    envMap: env,
    envMapIntensity: 0.55,
  });
  const alu = new THREE.MeshPhysicalMaterial({
    color: 0x8f959b,
    metalness: 0.92,
    roughness: 0.31,
    envMap: env,
    envMapIntensity: 0.85,
  });
  const rubber = new THREE.MeshPhysicalMaterial({
    map: grip.map,
    roughnessMap: grip.roughnessMap,
    normalMap: grip.normalMap,
    normalScale: new THREE.Vector2(0.7, 0.7),
    color: 0xffffff,
    metalness: 0,
    roughness: 1,
    envMap: env,
    envMapIntensity: 0.3,
  });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.088, 0.062, 0.052), resin);
  body.position.set(0, 0.036, 0);
  body.castShadow = true;
  group.add(body);

  const plateGeo = new THREE.CylinderGeometry(0.037, 0.037, 0.006, 26);
  for (const s of [1, -1]) {
    const plate = new THREE.Mesh(plateGeo, resin);
    plate.rotation.z = Math.PI / 2;
    plate.position.set(s * 0.032, 0.036, 0);
    plate.castShadow = true;
    group.add(plate);
  }

  const spool = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.CylinderGeometry(WORLD.spoolRadius, WORLD.spoolRadius, 0.05, 24),
    alu,
  );
  core.rotation.z = Math.PI / 2;
  core.castShadow = true;
  spool.add(core);
  const flangeGeo = new THREE.CylinderGeometry(0.0315, 0.0315, 0.0035, 26);
  for (const s of [1, -1]) {
    const fl = new THREE.Mesh(flangeGeo, alu);
    fl.rotation.z = Math.PI / 2;
    fl.position.x = s * 0.026;
    spool.add(fl);
  }
  // wound line: a matt spool of monofilament, not a shiny ring
  const wound = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0295, 0.0295, 0.046, 24),
    new THREE.MeshPhysicalMaterial({
      color: 0xb9bfc4,
      metalness: 0,
      roughness: 0.55,
      envMap: env,
      envMapIntensity: 0.35,
    }),
  );
  wound.rotation.z = Math.PI / 2;
  spool.add(wound);
  spool.position.set(0, 0.036, 0);
  group.add(spool);

  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.016, 0.03), rubber);
  seat.position.set(0, 0.0, 0);
  group.add(seat);

  const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.012, 18), alu);
  knob.rotation.z = Math.PI / 2;
  knob.position.set(0.044, 0.036, 0);
  group.add(knob);
  const knobGrip = new THREE.Mesh(new THREE.CylinderGeometry(0.0105, 0.0105, 0.014, 16), rubber);
  knobGrip.rotation.z = Math.PI / 2;
  knobGrip.position.set(0.053, 0.036, 0);
  group.add(knobGrip);

  const levelWind = new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.008, 0.009), alu);
  levelWind.position.set(0, 0.062, 0.026);
  group.add(levelWind);

  // control cord leaving toward the hand switch
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.14, 8), rubber);
  cord.position.set(-0.03, 0.0, 0.06);
  cord.rotation.set(0.9, 0, 0.4);
  group.add(cord);

  return {
    group,
    setSpool(angle: number) {
      spool.rotation.x = angle;
    },
  };
}

export interface TankHandle {
  group: THREE.Group;
  /** local-space centre of the water body */
  centre: THREE.Vector3;
  /** local-space swim radii that keep a small fish clear of the glass */
  swim: THREE.Vector2;
  /** local-space mouth of the release chute */
  chute: THREE.Vector3;
}

function buildTank(env: THREE.Texture, quality: QualitySettings): TankHandle {
  const group = new THREE.Group();
  const W = 0.4;
  const H = 0.15;
  const D = 0.27;
  const T = 0.009;

  // one glass volume rather than four panels: every extra transparent surface
  // muddies the only place in the scene where transparency is the subject
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xeff5f7,
    metalness: 0,
    roughness: 0.04,
    transparent: true,
    opacity: quality.transmission ? 0.08 : 0.11,
    transmission: quality.transmission ? 0.85 : 0,
    thickness: T,
    ior: 1.5,
    envMap: env,
    envMapIntensity: 0.75,
    clearcoat: 0.9,
    clearcoatRoughness: 0.03,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const shell = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), glass);
  shell.position.y = H / 2;
  shell.renderOrder = 14;
  group.add(shell);

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(W + 0.012, T * 2, D + 0.012),
    new THREE.MeshPhysicalMaterial({
      color: 0x262b2f,
      metalness: 0.2,
      roughness: 0.62,
      envMap: env,
      envMapIntensity: 0.35,
    }),
  );
  base.position.y = T;
  base.receiveShadow = true;
  group.add(base);

  // water body with its own surface, so the water line is legible
  const waterH = H * 0.7;
  const waterBody = new THREE.Mesh(
    new THREE.BoxGeometry(W - T * 2.4, waterH, D - T * 2.4),
    new THREE.MeshPhysicalMaterial({
      color: 0x53818c,
      metalness: 0,
      roughness: 0.06,
      transparent: true,
      opacity: 0.22,
      envMap: env,
      envMapIntensity: 0.55,
      depthWrite: false,
      side: THREE.FrontSide,
    }),
  );
  waterBody.position.y = T * 2 + waterH / 2;
  waterBody.renderOrder = 13;
  group.add(waterBody);

  const rimMat = new THREE.MeshPhysicalMaterial({
    color: 0x2c3237,
    metalness: 0.3,
    roughness: 0.5,
    envMap: env,
    envMapIntensity: 0.4,
  });
  const rimShape = new THREE.Shape();
  rimShape.moveTo(-W / 2 - 0.006, -D / 2 - 0.006);
  rimShape.lineTo(W / 2 + 0.006, -D / 2 - 0.006);
  rimShape.lineTo(W / 2 + 0.006, D / 2 + 0.006);
  rimShape.lineTo(-W / 2 - 0.006, D / 2 + 0.006);
  rimShape.closePath();
  const rimHole = new THREE.Path();
  rimHole.moveTo(-W / 2 + T, -D / 2 + T);
  rimHole.lineTo(-W / 2 + T, D / 2 - T);
  rimHole.lineTo(W / 2 - T, D / 2 - T);
  rimHole.lineTo(W / 2 - T, -D / 2 + T);
  rimHole.closePath();
  rimShape.holes.push(rimHole);
  const rimGeo = new THREE.ExtrudeGeometry(rimShape, { depth: 0.01, bevelEnabled: false });
  rimGeo.rotateX(-Math.PI / 2);
  rimGeo.translate(0, H, 0);
  const rim = new THREE.Mesh(rimGeo, rimMat);
  group.add(rim);

  // release chute back to the water
  const chuteMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.075, 0.005, 0.12),
    new THREE.MeshPhysicalMaterial({
      color: 0x23282c,
      metalness: 0.25,
      roughness: 0.62,
      envMap: env,
      envMapIntensity: 0.4,
    }),
  );
  chuteMesh.position.set(-W / 2 - 0.035, H * 0.44, 0);
  chuteMesh.rotation.z = 0.3;
  chuteMesh.castShadow = true;
  group.add(chuteMesh);

  const centre = new THREE.Vector3(0, T * 2 + waterH * 0.5, 0);
  const swim = new THREE.Vector2(W / 2 - 0.105, D / 2 - 0.082);
  const chute = new THREE.Vector3(-W / 2 - 0.05, H * 0.42, 0);
  return { group, centre, swim, chute };
}

/** Two rubber rollers on the coaming that strip the fish off the hooks. */
function buildUnhooker(env: THREE.Texture, grip: ReturnType<typeof makeGripMaps>): THREE.Group {
  const g = new THREE.Group();
  const frame = new THREE.MeshPhysicalMaterial({
    color: 0x4a5055,
    metalness: 0.7,
    roughness: 0.52,
    envMap: env,
    envMapIntensity: 0.4,
  });
  const roller = new THREE.MeshPhysicalMaterial({
    map: grip.map,
    roughnessMap: grip.roughnessMap,
    color: 0x5c6165,
    metalness: 0,
    roughness: 1,
    envMap: env,
    envMapIntensity: 0.2,
  });
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.1, 0.016), frame);
  arm.position.set(0, 0.05, 0);
  arm.castShadow = true;
  g.add(arm);
  const cross = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.012, 0.016), frame);
  cross.position.set(0.06, 0.098, 0);
  g.add(cross);
  for (const s of [1, -1]) {
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.035, 16), roller);
    r.rotation.x = Math.PI / 2;
    r.position.set(0.115 + s * 0.016, 0.082, 0);
    r.castShadow = true;
    g.add(r);
  }
  return g;
}

export interface SceneBuild {
  scene: THREE.Scene;
  rod: RodHandle;
  reel: ReelHandle;
  tank: TankHandle;
  keyLight: THREE.SpotLight;
  lamp: THREE.PointLight;
}

export function buildScene(env: THREE.Texture, quality: QualitySettings): SceneBuild {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x090c10);
  scene.fog = new THREE.Fog(0x11161b, 2.4, 9.5);
  scene.environment = env;

  const deckMaps = makeDeckMaps(quality.envSize >= 256 ? 1024 : 512);
  deckMaps.map.repeat.set(3, 3);
  deckMaps.roughnessMap.repeat.set(3, 3);
  const grip = makeGripMaps(quality.envSize >= 256 ? 512 : 256);

  // ---- deck with the fishing hatch cut out
  const shape = new THREE.Shape();
  shape.moveTo(-3.0, -3.0);
  shape.lineTo(3.0, -3.0);
  shape.lineTo(3.0, 3.0);
  shape.lineTo(-3.0, 3.0);
  shape.closePath();
  const hole = new THREE.Path();
  const hx = WORLD.holeHalfX;
  const hz = WORLD.holeHalfZ;
  hole.moveTo(-hx, -hz);
  hole.lineTo(-hx, hz);
  hole.lineTo(hx, hz);
  hole.lineTo(hx, -hz);
  hole.closePath();
  shape.holes.push(hole);
  const deckGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.055, bevelEnabled: false });
  deckGeo.rotateX(-Math.PI / 2);
  deckGeo.translate(0, WORLD.deckY, 0);
  const deckMat = new THREE.MeshPhysicalMaterial({
    map: deckMaps.map,
    roughnessMap: deckMaps.roughnessMap,
    color: 0xffffff,
    metalness: 0,
    roughness: 1,
    clearcoat: 0.22,
    clearcoatRoughness: 0.5,
    envMap: env,
    envMapIntensity: 0.35,
  });
  const deck = new THREE.Mesh(deckGeo, deckMat);
  deck.receiveShadow = true;
  scene.add(deck);

  // ---- coaming and the dark shaft down to the water
  const coamMat = new THREE.MeshPhysicalMaterial({
    color: 0x1b1f23,
    metalness: 0.05,
    roughness: 0.34,
    clearcoat: 0.55,
    clearcoatRoughness: 0.22,
    envMap: env,
    envMapIntensity: 0.3,
    side: THREE.DoubleSide,
  });
  const shaftH = WORLD.deckY + 0.18;
  const shaftY = WORLD.deckY + 0.028 - shaftH / 2;
  const wallDefs: [number, number, number, number][] = [
    [hx * 2, 0.012, 0, -hz],
    [hx * 2, 0.012, 0, hz],
    [0.012, hz * 2, -hx, 0],
    [0.012, hz * 2, hx, 0],
  ];
  for (const [w, d, x, z] of wallDefs) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(w, shaftH, d), coamMat);
    panel.position.set(x, shaftY, z);
    panel.receiveShadow = true;
    scene.add(panel);
  }
  // coaming lip: a frame around the opening, not a lid over it
  const lipShape = new THREE.Shape();
  const lx = hx + 0.028;
  const lz = hz + 0.028;
  lipShape.moveTo(-lx, -lz);
  lipShape.lineTo(lx, -lz);
  lipShape.lineTo(lx, lz);
  lipShape.lineTo(-lx, lz);
  lipShape.closePath();
  const lipHole = new THREE.Path();
  lipHole.moveTo(-hx, -hz);
  lipHole.lineTo(-hx, hz);
  lipHole.lineTo(hx, hz);
  lipHole.lineTo(hx, -hz);
  lipHole.closePath();
  lipShape.holes.push(lipHole);
  const lipGeo = new THREE.ExtrudeGeometry(lipShape, { depth: 0.022, bevelEnabled: false });
  lipGeo.rotateX(-Math.PI / 2);
  lipGeo.translate(0, WORLD.deckY + 0.062, 0);
  const lip = new THREE.Mesh(
    lipGeo,
    new THREE.MeshPhysicalMaterial({
      color: 0x2a2f33,
      metalness: 0.15,
      roughness: 0.3,
      clearcoat: 0.7,
      clearcoatRoughness: 0.18,
      envMap: env,
      envMapIntensity: 0.5,
    }),
  );
  lip.receiveShadow = true;
  scene.add(lip);

  // ---- the deck stays wet where water comes over the coaming
  const apronShape = new THREE.Shape();
  const ax = hx + 0.3;
  const az = hz + 0.42;
  apronShape.moveTo(-ax, -az);
  apronShape.lineTo(ax, -az);
  apronShape.lineTo(ax, az);
  apronShape.lineTo(-ax, az);
  apronShape.closePath();
  const apronHole = new THREE.Path();
  apronHole.moveTo(-hx, -hz);
  apronHole.lineTo(-hx, hz);
  apronHole.lineTo(hx, hz);
  apronHole.lineTo(hx, -hz);
  apronHole.closePath();
  apronShape.holes.push(apronHole);
  const apronGeo = new THREE.ShapeGeometry(apronShape);
  apronGeo.rotateX(-Math.PI / 2);
  apronGeo.translate(0, WORLD.deckY + 0.056, 0);
  const apron = new THREE.Mesh(
    apronGeo,
    new THREE.MeshPhysicalMaterial({
      color: 0x1c1e1f,
      metalness: 0,
      roughness: 0.3,
      clearcoat: 0.85,
      clearcoatRoughness: 0.1,
      envMap: env,
      envMapIntensity: 0.5,
      transparent: true,
      opacity: 0.92,
    }),
  );
  apron.receiveShadow = true;
  scene.add(apron);

  // ---- cabin shell
  // the cabin lining is the same painted ply as the deck, run horizontally
  const liningMap = deckMaps.map.clone();
  liningMap.needsUpdate = true;
  liningMap.repeat.set(2, 1.1);
  liningMap.rotation = Math.PI / 2;
  liningMap.center.set(0.5, 0.5);
  const liningRough = deckMaps.roughnessMap.clone();
  liningRough.needsUpdate = true;
  liningRough.repeat.copy(liningMap.repeat);
  liningRough.rotation = liningMap.rotation;
  liningRough.center.copy(liningMap.center);
  const wallMat = new THREE.MeshStandardMaterial({
    map: liningMap,
    roughnessMap: liningRough,
    color: 0xb9a98d,
    roughness: 1,
    metalness: 0,
    side: THREE.FrontSide,
  });
  // four upright walls, no floor face: the hatch must stay open to the water
  const wallH = 2.5;
  const wallY = WORLD.deckY + wallH / 2;
  const walls: [number, number, number, number, number][] = [
    [6, wallH, 0, -3, 0],
    [6, wallH, 0, 3, Math.PI],
    [6, wallH, -3, 0, Math.PI / 2],
    [6, wallH, 3, 0, -Math.PI / 2],
  ];
  for (const [w, h, x, z, ry] of walls) {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wallMat);
    panel.position.set(x, wallY, z);
    panel.rotation.y = ry;
    scene.add(panel);
  }

  const ceil = new THREE.Mesh(
    new THREE.PlaneGeometry(6, 6),
    new THREE.MeshStandardMaterial({ color: 0x4a4438, roughness: 0.94 }),
  );
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = WORLD.deckY + 2.48;
  scene.add(ceil);

  const lake = makeLakeBackdrop(512, 256);
  const winMat = new THREE.MeshBasicMaterial({ map: lake, toneMapped: true, color: 0x7b8388 });
  for (const [x, z, ry, w] of [
    [0, -2.98, 0, 4.2],
    [2.98, 0.4, -Math.PI / 2, 4.2],
  ] as const) {
    const win = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.72), winMat);
    win.position.set(x, WORLD.deckY + 1.32, z);
    win.rotation.y = ry;
    scene.add(win);
    const framePts = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.06, 0.8, 0.03),
      new THREE.MeshStandardMaterial({ color: 0x2e2a24, roughness: 0.8 }),
    );
    framePts.position.set(x, WORLD.deckY + 1.32, z);
    framePts.rotation.y = ry;
    framePts.translateZ(-0.02);
    scene.add(framePts);
  }

  // ---- lighting
  scene.add(new THREE.HemisphereLight(0x46525d, 0x14181c, 0.5));

  const lamp = new THREE.PointLight(0xffcf9c, 9, 8, 2);
  lamp.position.set(-0.55, WORLD.deckY + 2.02, 0.42);
  scene.add(lamp);
  const lampBody = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.065, 0.055, 18, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x40474d, roughness: 0.55, side: THREE.DoubleSide }),
  );
  lampBody.position.copy(lamp.position).setY(lamp.position.y + 0.045);
  scene.add(lampBody);
  const lampGlass = new THREE.Mesh(
    new THREE.CircleGeometry(0.05, 18),
    new THREE.MeshBasicMaterial({ color: 0xffe4bf }),
  );
  lampGlass.rotation.x = Math.PI / 2;
  lampGlass.position.copy(lamp.position).setY(lamp.position.y + 0.018);
  scene.add(lampGlass);

  const keyLight = new THREE.SpotLight(0xffe3c2, 5.5, 4.6, 0.66, 0.6, 1.5);
  keyLight.position.set(0.36, WORLD.deckY + 1.66, 0.72);
  keyLight.target.position.set(0, 0.45, 0);
  keyLight.castShadow = quality.shadows;
  keyLight.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
  keyLight.shadow.camera.near = 0.4;
  keyLight.shadow.camera.far = 4.5;
  keyLight.shadow.bias = -0.0009;
  keyLight.shadow.normalBias = 0.006;
  scene.add(keyLight, keyLight.target);

  // cool daylight spilling in over the coaming keeps wet silver from reading warm
  const coldFill = new THREE.SpotLight(0xa9c8e0, 5.6, 3.2, 0.85, 0.9, 1.4);
  coldFill.position.set(1.5, WORLD.deckY + 0.95, 1.35);
  coldFill.target.position.set(0, 0.7, 0);
  scene.add(coldFill, coldFill.target);

  // the deck lamp reaches a little way down the well, so a fish coming up
  // starts to catch light before it reaches the surface
  const wellLight = new THREE.SpotLight(0xe6dcc8, 3.6, 2.2, 0.5, 0.85, 1.2);
  wellLight.position.set(0.06, WORLD.deckY + 0.9, 0.1);
  wellLight.target.position.set(0, -0.6, 0);
  scene.add(wellLight, wellLight.target);

  const windowLight = new THREE.DirectionalLight(0xa9c4d8, 1.2);
  windowLight.position.set(2.4, 1.9, -2.2);
  windowLight.target.position.set(0, 0.5, 0);
  scene.add(windowLight, windowLight.target);

  const rod = buildRod(env);
  scene.add(rod.group);
  const reel = buildReel(env, grip);
  reel.group.position.copy(WORLD.reelPos);
  reel.group.rotation.set(0.3, 0.18, -0.66);
  scene.add(reel.group);

  // rod holder on the gunwale
  const holder = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.034, 0.16, 16, 1, true),
    new THREE.MeshPhysicalMaterial({
      color: 0x2c3237,
      metalness: 0.4,
      roughness: 0.5,
      envMap: env,
      envMapIntensity: 0.4,
      side: THREE.DoubleSide,
    }),
  );
  holder.position.set(-0.5, WORLD.deckY + 0.26, 0.44);
  holder.rotation.set(0.52, 0, 0.62);
  holder.castShadow = true;
  scene.add(holder);
  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.016, 0.016, 0.28, 12),
    new THREE.MeshPhysicalMaterial({
      color: 0x30363b,
      metalness: 0.5,
      roughness: 0.48,
      envMap: env,
      envMapIntensity: 0.4,
    }),
  );
  post.position.set(-0.5, WORLD.deckY + 0.14, 0.44);
  scene.add(post);

  const unhooker = buildUnhooker(env, grip);
  unhooker.position.set(-hx - 0.03, WORLD.deckY + 0.02, 0);
  scene.add(unhooker);

  const tank = buildTank(env, quality);
  tank.group.position.set(0.62, WORLD.deckY + 0.03, 0.3);
  tank.group.rotation.y = Math.PI / 2 - 0.26;

  // a small task light over the observation tank
  const tankLight = new THREE.SpotLight(0xf2ead9, 3.4, 1.6, 0.66, 0.85, 1.5);
  tankLight.position.set(0.62, WORLD.deckY + 0.62, 0.36);
  tankLight.target.position.set(0.6, WORLD.deckY + 0.05, 0.3);
  scene.add(tankLight, tankLight.target);
  scene.add(tank.group);

  // a low bench and a tackle box give the mid ground some honest clutter
  const bench = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 0.05, 0.34),
    new THREE.MeshStandardMaterial({ color: 0x6b5c46, roughness: 0.85 }),
  );
  bench.position.set(-0.9, WORLD.deckY + 0.36, -0.7);
  bench.receiveShadow = true;
  scene.add(bench);
  for (const bx of [-1.35, -0.45]) {
    const leg = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.36, 0.3),
      new THREE.MeshStandardMaterial({ color: 0x584c3d, roughness: 0.88 }),
    );
    leg.position.set(bx, WORLD.deckY + 0.18, -0.7);
    scene.add(leg);
  }
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.14, 0.2),
    new THREE.MeshPhysicalMaterial({
      color: 0x36434c,
      metalness: 0.05,
      roughness: 0.55,
      clearcoat: 0.3,
      envMap: env,
      envMapIntensity: 0.3,
    }),
  );
  box.position.set(-0.75, WORLD.deckY + 0.075, -0.62);
  box.castShadow = true;
  scene.add(box);

  return { scene, rod, reel, tank, keyLight, lamp };
}
