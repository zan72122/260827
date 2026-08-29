import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { snowMaterial, woodMaterial, tex } from './materials';

/** Deterministic RNG so the scene is identical on every run. */
export function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Centre line of the snow path. z runs negative into the distance. */
function rngLike(i: number) {
  const v = Math.sin(i * 43.7) * 43758.5453;
  return v - Math.floor(v);
}

export function pathX(z: number) {
  return Math.sin((z + 2) * 0.115) * 1.35 + Math.sin((z + 2) * 0.037) * 1.1;
}

export const BENCH_TOP = 0.78;
export const SHELF_Y = 0.70;
export const SHELF_POS = new THREE.Vector3(1.16, 0, -0.05);

function fbm(x: number, y: number, oct = 4) {
  let v = 0;
  let a = 0.5;
  let f = 1;
  for (let i = 0; i < oct; i++) {
    v += a * (Math.sin(x * f * 1.7 + y * f * 0.9) * 0.5 + 0.5) * (Math.cos(y * f * 1.3 - x * f * 0.4) * 0.5 + 0.5);
    a *= 0.5;
    f *= 2.1;
  }
  return v;
}

export class Shed {
  group = new THREE.Group();
  houseWindows: THREE.MeshStandardMaterial;
  stringLights: THREE.InstancedMesh;
  private stringLightMat: THREE.MeshStandardMaterial;
  private lamp: THREE.PointLight;
  private lampGlass: THREE.MeshStandardMaterial;

  constructor() {
    const rng = makeRng(20261225);

    // ---- snow ground -------------------------------------------------
    const g = new THREE.PlaneGeometry(90, 90, 120, 120);
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i); // becomes -z after rotation
      const z = -y;
      let h = (fbm(x * 0.16, z * 0.16) - 0.45) * 0.09 + (fbm(x * 0.03, z * 0.03, 2) - 0.45) * 0.22;
      const d = Math.abs(x - pathX(z));
      if (z < -1.0) {
        // packed, slightly sunken path with soft banks either side
        const inPath = THREE.MathUtils.smoothstep(d, 0.75, 0.28);
        const bank = Math.exp(-Math.pow((d - 0.85) / 0.5, 2)) * 0.05;
        h = THREE.MathUtils.lerp(h, -0.035, inPath) + bank * (1 - inPath);
      }
      pos.setZ(i, h);
    }
    g.computeVertexNormals();
    const ground = new THREE.Mesh(g, snowMaterial());
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.group.add(ground);

    const far = new THREE.Mesh(new THREE.CircleGeometry(320, 48), snowMaterial(0.98));
    far.rotation.x = -Math.PI / 2;
    far.position.y = -0.06;
    this.group.add(far);

    // ---- shed --------------------------------------------------------
    const plank = woodMaterial(0x574636, 0.9);
    const beam = woodMaterial(0x6d5540, 0.85);
    const deckMat = woodMaterial(0x7d6850, 0.9);

    const deck = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.09, 5.0), deckMat);
    deck.position.set(0, 0.06, 1.4);
    deck.receiveShadow = true;
    this.group.add(deck);

    const wallGeos: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 26; i++) {
      const p = new THREE.BoxGeometry(0.17, 2.35, 0.045);
      p.translate(0, 1.2, 0);
      p.rotateY(Math.PI / 2);
      p.translate(-1.98, 0, 3.7 - i * 0.19 - (rng() - 0.5) * 0.01);
      wallGeos.push(p);
      const q = new THREE.BoxGeometry(0.17, 2.35, 0.045);
      q.translate(0, 1.2, 0);
      q.rotateY(Math.PI / 2);
      q.translate(2.02, 0, 3.7 - i * 0.19);
      wallGeos.push(q);
    }
    for (let i = 0; i < 20; i++) {
      const p = new THREE.BoxGeometry(0.19, 2.35, 0.045);
      p.translate(-1.9 + i * 0.2, 1.2, 3.8);
      wallGeos.push(p);
    }
    const walls = new THREE.Mesh(mergeGeometries(wallGeos)!, plank);
    walls.castShadow = true;
    walls.receiveShadow = true;
    this.group.add(walls);

    const roof = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.07, 4.8), beam);
    roof.position.set(0, 2.5, 1.75);
    roof.rotation.x = -0.09;
    roof.castShadow = true;
    this.group.add(roof);
    const roofSnow = new THREE.Mesh(new THREE.BoxGeometry(4.54, 0.07, 4.84), snowMaterial(1.02));
    roofSnow.position.set(0, 2.56, 1.75);
    roofSnow.rotation.x = -0.09;
    this.group.add(roofSnow);

    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.42, 0.12), beam);
      post.position.set(sx * 1.94, 1.21, -0.58);
      post.castShadow = true;
      this.group.add(post);
    }
    const fascia = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.16, 0.08), beam);
    fascia.position.set(0, 2.36, -0.62);
    this.group.add(fascia);

    // ---- work bench --------------------------------------------------
    const benchTop = new THREE.Mesh(new THREE.BoxGeometry(2.24, 0.065, 0.86), woodMaterial(0x7a6047, 0.82));
    benchTop.position.set(0, BENCH_TOP - 0.032, 0.02);
    benchTop.castShadow = true;
    benchTop.receiveShadow = true;
    this.group.add(benchTop);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.09, 0.06), beam);
    rail.position.set(0, 0.6, 0.02);
    this.group.add(rail);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.75, 0.085), beam);
        leg.position.set(sx * 1.0, 0.375, 0.02 + sz * 0.34);
        leg.castShadow = true;
        this.group.add(leg);
      }
    }

    // a little drifted snow where the shelter meets the garden
    const drift = new THREE.Mesh(new THREE.BoxGeometry(2.18, 0.026, 0.09), snowMaterial(1.02));
    drift.position.set(-0.05, BENCH_TOP + 0.006, -0.405);
    drift.rotation.x = 0.05;
    this.group.add(drift);
    const crate = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.34, 0.36), woodMaterial(0x5d4a38, 0.9));
    crate.position.set(-1.4, 0.28, 0.1);
    crate.rotation.y = 0.22;
    crate.castShadow = true;
    crate.receiveShadow = true;
    this.group.add(crate);
    const pail = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.12, 0.26, 18), new THREE.MeshStandardMaterial({ color: 0x6f7a80, metalness: 0.6, roughness: 0.55, roughnessMap: tex.coarse }));
    pail.position.set(1.62, 0.19, 0.4);
    pail.castShadow = true;
    this.group.add(pail);
    const pailSnow = new THREE.Mesh(new THREE.CylinderGeometry(0.128, 0.128, 0.04, 18), snowMaterial(1.02));
    pailSnow.position.set(1.62, 0.31, 0.4);
    this.group.add(pailSnow);

    // ---- freezing shelf ---------------------------------------------
    const shelf = new THREE.Group();
    shelf.position.copy(SHELF_POS);
    const shelfMetal = new THREE.MeshStandardMaterial({
      color: 0x9fabb2,
      metalness: 0.45,
      roughness: 0.55,
      roughnessMap: tex.coarse,
    });
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.035, 0.66), shelfMetal);
    board.position.set(0, SHELF_Y, 0);
    board.receiveShadow = true;
    shelf.add(board);
    // open topped cold frame: nothing overhead to block the freezing shot
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const h = sz < 0 ? SHELF_Y + 0.38 : SHELF_Y + 0.06;
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.045, h, 0.045), shelfMetal);
        post.position.set(sx * 0.36, h / 2, sz * 0.3);
        post.castShadow = true;
        shelf.add(post);
      }
    }
    const backPanel = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.26, 0.02), shelfMetal);
    backPanel.position.set(0, SHELF_Y + 0.15, -0.31);
    shelf.add(backPanel);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.05, 0.02), shelfMetal);
    lip.position.set(0, SHELF_Y + 0.04, 0.31);
    shelf.add(lip);
    const lipSnow = new THREE.Mesh(new THREE.BoxGeometry(0.79, 0.016, 0.04), snowMaterial(1.03));
    lipSnow.position.set(0, SHELF_Y + 0.068, 0.31);
    shelf.add(lipSnow);
    const snowLedge = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.02, 0.05), snowMaterial(1.03));
    snowLedge.position.set(0, SHELF_Y + 0.38, -0.31);
    shelf.add(snowLedge);
    this.group.add(shelf);

    // ---- a single practical: the shed's work lamp --------------------
    const lampGroup = new THREE.Group();
    const flex = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.008, 0.36, 6),
      new THREE.MeshStandardMaterial({ color: 0x22282e, roughness: 0.7 })
    );
    flex.position.y = 0.18;
    const shade = new THREE.Mesh(
      new THREE.ConeGeometry(0.13, 0.12, 20, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x39434b, roughness: 0.5, metalness: 0.5, side: THREE.DoubleSide })
    );
    shade.position.y = -0.05;
    this.lampGlass = new THREE.MeshStandardMaterial({
      color: 0xf6efe2,
      roughness: 0.5,
      emissive: new THREE.Color(0xffe9c4),
      emissiveIntensity: 0,
    });
    const lampBulb = new THREE.Mesh(new THREE.SphereGeometry(0.045, 14, 10), this.lampGlass);
    lampBulb.position.y = -0.09;
    this.lamp = new THREE.PointLight(0xfff2e4, 0, 6.5, 2);
    this.lamp.position.y = -0.11;
    lampGroup.add(flex, shade, lampBulb, this.lamp);
    lampGroup.position.set(0.3, 2.16, 0.14);
    this.group.add(lampGroup);

    // ---- garden: trees, house, unlit christmas string ----------------
    this.group.add(this.buildTrees(rng));

    const house = new THREE.Group();
    const houseMat = woodMaterial(0x4a3c33, 0.9);
    const body = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.3, 3.0), houseMat);
    body.position.y = 1.15;
    house.add(body);
    const roofG = new THREE.ConeGeometry(2.85, 1.5, 4);
    const houseRoof = new THREE.Mesh(roofG, snowMaterial(0.98));
    houseRoof.position.y = 3.0;
    houseRoof.rotation.y = Math.PI / 4;
    house.add(houseRoof);
    this.houseWindows = new THREE.MeshStandardMaterial({
      color: 0x2a3442,
      emissive: new THREE.Color(0xffbe72),
      emissiveIntensity: 0,
      roughness: 0.35,
      metalness: 0,
    });
    for (const wx of [-0.85, 0.85]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.85), this.houseWindows);
      w.position.set(wx, 1.35, 1.52);
      house.add(w);
    }
    const door = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 1.2), this.houseWindows);
    door.position.set(0, 0.62, 1.52);
    house.add(door);
    house.position.set(-4.2, 0, -19.5);
    house.rotation.y = 0.3;
    this.group.add(house);

    // string lights on a garden tree, dark until the finale
    this.stringLightMat = new THREE.MeshStandardMaterial({
      color: 0x2b3038,
      emissive: new THREE.Color(0xffcf92),
      emissiveIntensity: 0,
      roughness: 0.4,
    });
    const bulb = new THREE.SphereGeometry(0.055, 8, 6);
    const count = 46;
    this.stringLights = new THREE.InstancedMesh(bulb, this.stringLightMat, count);
    const m = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const turns = t * 5.2;
      const r = 1.55 * (1 - t * 0.86) + 0.06;
      const y = 0.55 + t * 3.5;
      m.makeTranslation(pathX(-13.5) + 2.0 + Math.cos(turns * Math.PI * 2) * r, y, -13.5 + Math.sin(turns * Math.PI * 2) * r);
      this.stringLights.setMatrixAt(i, m);
    }
    this.stringLights.instanceMatrix.needsUpdate = true;
    this.group.add(this.stringLights);
  }

  private buildTrees(rng: () => number) {
    const grp = new THREE.Group();
    const foliage: THREE.BufferGeometry[] = [];
    const caps: THREE.BufferGeometry[] = [];
    // four slightly irregular skirts rather than three tidy cones
    const layers = [
      { y: 0.62, r: 1.02, h: 1.5 },
      { y: 1.34, r: 0.86, h: 1.32 },
      { y: 2.02, r: 0.64, h: 1.1 },
      { y: 2.62, r: 0.4, h: 0.9 },
    ];
    layers.forEach((L, i) => {
      const c = new THREE.ConeGeometry(L.r, L.h, 8, 1);
      const pos = c.getAttribute('position') as THREE.BufferAttribute;
      for (let v = 0; v < pos.count; v++) {
        const x = pos.getX(v);
        const z = pos.getZ(v);
        const k = 1 + Math.sin(Math.atan2(z, x) * 3 + i * 2.1) * 0.09;
        pos.setX(v, x * k);
        pos.setZ(v, z * k);
      }
      c.computeVertexNormals();
      c.translate(0, L.y + L.h * 0.5, 0);
      foliage.push(c);
      // snow only rests on the upper skirts, and not evenly
      if (i >= 1) {
        const cap = new THREE.ConeGeometry(L.r * 0.66, L.h * 0.34, 8, 1);
        cap.translate(0.02 * (i % 2 ? 1 : -1), L.y + L.h * 0.78, 0.015);
        caps.push(cap);
      }
    });
    const trunk = new THREE.CylinderGeometry(0.08, 0.14, 1.0, 6);
    trunk.translate(0, 0.4, 0);
    foliage.push(trunk);
    const foliageGeo = mergeGeometries(foliage)!;
    const capGeo = mergeGeometries(caps)!;

    const spots: Array<{ x: number; z: number; s: number; r: number; t: number }> = [];
    for (let i = 0; i < 10; i++) {
      const z = -3.0 - rng() * 3.0;
      const side = i % 2 === 0 ? -1 : 1;
      const x = pathX(z) + side * (3.4 + rng() * 3.5);
      spots.push({ x, z, s: 0.75 + rng() * 0.5, r: rng() * Math.PI * 2, t: rng() });
    }
    for (let i = 0; i < 74; i++) {
      const z = -6.2 - rng() * 24;
      const side = rng() < 0.5 ? -1 : 1;
      const off = 2.4 + rng() * 9.0;
      const x = pathX(z) + side * off;
      spots.push({ x, z, s: 0.62 + rng() * 0.62, r: rng() * Math.PI * 2, t: rng() });
    }
    const treeMat = new THREE.MeshStandardMaterial({ color: 0x2b4234, roughness: 0.92, metalness: 0 });
    const im = new THREE.InstancedMesh(foliageGeo, treeMat, spots.length);
    im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(spots.length * 3), 3);
    const cm = new THREE.InstancedMesh(capGeo, snowMaterial(1.0), spots.length);
    const mtx = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    const pv = new THREE.Vector3();
    const col = new THREE.Color();
    const lean = new THREE.Euler();
    spots.forEach((s, i) => {
      lean.set((s.t - 0.5) * 0.06, s.r, (rngLike(i) - 0.5) * 0.06);
      q.setFromEuler(lean);
      sc.set(s.s, s.s * (0.88 + s.t * 0.35), s.s);
      pv.set(s.x, -0.05, s.z);
      mtx.compose(pv, q, sc);
      im.setMatrixAt(i, mtx);
      cm.setMatrixAt(i, mtx);
      col.setHSL(0.33 + s.t * 0.035, 0.16 + s.t * 0.12, 0.36 + s.t * 0.22);
      im.setColorAt(i, col);
      // roughly a third of the trees carry no snow load
      if (s.t < 0.34) {
        sc.multiplyScalar(0.0001);
        mtx.compose(pv, q, sc);
        cm.setMatrixAt(i, mtx);
      }
    });
    im.instanceMatrix.needsUpdate = true;
    cm.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.castShadow = false;
    grp.add(im, cm);
    return grp;
  }

  /** the work lamp comes on as the afternoon turns to dusk */
  setLamp(v: number) {
    this.lamp.intensity = v * 5.2;
    this.lampGlass.emissiveIntensity = v * 3;
  }

  setFestiveLights(v: number) {
    this.stringLightMat.emissiveIntensity = v * 2.4;
    this.stringLightMat.color.setHex(v > 0.05 ? 0x6b5b46 : 0x2b3038);
    this.houseWindows.emissiveIntensity = v * 1.6;
  }
}
