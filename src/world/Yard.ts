import * as THREE from 'three';
import { Rng } from '../core/rng';
import { decalTexture, netAlphaTexture, skyTexture, treeLineTexture } from '../core/textures';
import type { WorldMaterials } from '../core/materials';
import type { QualitySettings } from '../core/renderer';
import { beam, boltRow, corrugatedSlab, scatterStones, wheel } from './props';

/** Where each machine lives. The whole game reads its geometry from here. */
export const YARD = {
  treeStart: new THREE.Vector3(-5.0, 0, 1.4),
  shaker: new THREE.Vector3(-2.3, 0, 0.9),
  /** Cone axis height: high enough that unfolded branches clear the ground. */
  axisHeight: 1.55,
  balerEntry: new THREE.Vector3(0.7, 1.55, -0.2),
  balerExit: new THREE.Vector3(3.7, 1.55, -0.2),
  gate: new THREE.Vector3(5.6, 0, -0.2),
  gateClearWidth: 0.95,
  gateHeight: 5.1,
};

export class Yard {
  readonly group = new THREE.Group();
  readonly sun: THREE.DirectionalLight;
  private readonly practicals: THREE.PointLight[] = [];
  private readonly disposables: Array<{ dispose(): void }> = [];

  constructor(scene: THREE.Scene, mats: WorldMaterials, quality: QualitySettings) {
    scene.add(this.group);

    // ---- sky, air, light -------------------------------------------------
    const sky = skyTexture();
    scene.background = sky;
    scene.environment = sky;
    scene.environmentIntensity = 0.34;
    scene.fog = new THREE.Fog(0xa7b0b5, 34, 150);

    const hemi = new THREE.HemisphereLight(0x9db1c0, 0x3a3026, 0.5);
    this.group.add(hemi);

    // low winter sun through overcast: soft, warm, raking
    this.sun = new THREE.DirectionalLight(0xffe2c2, 2.1);
    this.sun.position.set(-9, 6.5, 7);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.setScalar(quality.shadowMapSize);
    this.sun.shadow.camera.near = 0.5;
    this.sun.shadow.camera.far = 42;
    const s = 9;
    this.sun.shadow.camera.left = -s;
    this.sun.shadow.camera.right = s;
    this.sun.shadow.camera.top = s;
    this.sun.shadow.camera.bottom = -s;
    this.sun.shadow.bias = -0.0012;
    this.sun.shadow.normalBias = 0.03;
    this.group.add(this.sun);
    this.group.add(this.sun.target);

    const fill = new THREE.DirectionalLight(0xbfd0dd, 0.3);
    fill.position.set(7, 5, -6);
    this.group.add(fill);

    // ---- ground ----------------------------------------------------------
    const groundGeo = new THREE.PlaneGeometry(150, 150, 40, 40);
    const gpos = groundGeo.attributes.position as THREE.BufferAttribute;
    const rng = new Rng(4242);
    for (let i = 0; i < gpos.count; i++) {
      const x = gpos.getX(i);
      const y = gpos.getY(i);
      const d = Math.hypot(x, y);
      // graded flat where the machines stand, rougher further out
      const amp = Math.min(0.42, Math.max(0, d - 9) * 0.028);
      gpos.setZ(i, (Math.sin(x * 0.31) * 0.5 + Math.cos(y * 0.24) * 0.5 + rng.jitter(0.5)) * amp);
    }
    groundGeo.computeVertexNormals();
    const ground = new THREE.Mesh(groundGeo, mats.ground);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.group.add(ground);
    this.disposables.push(groundGeo);

    // dirt that follows drainage and traffic, not uniform noise
    // lorries come in from +X and swing round in front of the shed
    this.addDecal(decalTexture('rut'), new THREE.Vector3(6.5, 0.014, 3.4), 7.5, 30, 1.52, 0.85);
    this.addDecal(decalTexture('rut'), new THREE.Vector3(-6.0, 0.014, -4.4), 5.5, 20, 1.15, 0.65);
    // water stands where nothing drives and the grade dips
    this.addDecal(decalTexture('puddle'), new THREE.Vector3(-9.6, 0.016, -2.2), 3.4, 2.4, 0.4, 0.9, true);
    this.addDecal(decalTexture('puddle'), new THREE.Vector3(9.6, 0.016, 4.4), 2.6, 1.8, 1.2, 0.85, true);
    // needle litter builds up exactly where trees are handled
    this.addDecal(decalTexture('litter'), new THREE.Vector3(-5.0, 0.017, 1.4), 3.8, 3.8, 0, 0.9);
    this.addDecal(decalTexture('litter'), new THREE.Vector3(-2.3, 0.017, 0.9), 3.2, 3.2, 0.6, 0.85);
    this.addDecal(decalTexture('litter'), new THREE.Vector3(2.2, 0.017, -0.2), 3.0, 2.4, 0.2, 0.6);

    const stones = scatterStones(quality.tier === 'low' ? 70 : 160, mats.steelDark, 771, (r, out) => {
      const a = r.range(0, Math.PI * 2);
      const d = 3 + r.next() * 22;
      out.set(Math.cos(a) * d, 0.02, Math.sin(a) * d * 0.7 - 2);
      return r.range(0.03, 0.1);
    });
    this.group.add(stones);
    this.disposables.push(stones.geometry);

    // ---- work shed -------------------------------------------------------
    this.group.add(this.buildShed(mats, quality));

    // ---- loading gate: the reason the tree has to get thin ----------------
    this.group.add(this.buildGate(mats));

    // ---- lorry, parked behind the gate -----------------------------------
    const truck = this.buildTruck(mats);
    truck.position.set(11.2, 0, -3.6);
    truck.rotation.y = -0.34;
    this.group.add(truck);

    // ---- bundles that already went through, stacked ready to load --------
    this.group.add(this.buildBundleStack(mats, quality));

    // ---- yard clutter ----------------------------------------------------
    this.group.add(this.buildClutter(mats));

    // ---- distant conifer belt -------------------------------------------
    const line = treeLineTexture(512);
    for (const [z, scale, opacity] of [
      [-38, 1, 0.98],
      [-62, 1.45, 0.8],
    ] as const) {
      const mat = new THREE.MeshBasicMaterial({
        map: line,
        transparent: true,
        depthWrite: false,
        opacity,
        fog: true,
        color: 0x8f9e93,
      });
      const geo = new THREE.PlaneGeometry(150 * scale, 9 * scale);
      const card = new THREE.Mesh(geo, mat);
      card.position.set(0, 4.5 * scale - 0.7, z);
      this.group.add(card);
      this.disposables.push(geo, mat);
    }

    // mid-ground conifers still standing, as instanced cards
    this.group.add(this.buildMidTrees(quality));
  }

  private addDecal(
    tex: THREE.Texture,
    pos: THREE.Vector3,
    w: number,
    h: number,
    rot: number,
    opacity: number,
    wet = false,
  ): void {
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      opacity,
      // standing water is smooth and picks up the sky; mud and litter do not
      roughness: wet ? 0.09 : 0.98,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const geo = new THREE.PlaneGeometry(w, h);
    const m = new THREE.Mesh(geo, mat);
    m.rotation.set(-Math.PI / 2, 0, rot);
    m.position.copy(pos);
    m.renderOrder = 2;
    this.group.add(m);
    this.disposables.push(geo, mat);
  }

  private buildShed(mats: WorldMaterials, quality: QualitySettings): THREE.Group {
    const g = new THREE.Group();
    g.position.set(-1, 0, -13.5);
    const roof = corrugatedSlab(26, 11, mats.steelDark, quality.tier === 'low' ? 12 : 24);
    roof.position.set(0, 5.2, 0);
    roof.rotation.z = 0.05;
    g.add(roof);
    for (let i = 0; i < 7; i++) {
      const x = -11 + i * 3.7;
      for (const z of [-4.6, 4.6]) {
        const col = beam(0.22, 0.22, 5.2, mats.steelDark);
        col.position.set(x, 2.6, z);
        g.add(col);
      }
      const tie = beam(9.4, 0.12, 0.16, mats.steelDark);
      tie.rotation.y = Math.PI / 2;
      tie.position.set(x, 5.0, 0);
      g.add(tie);
    }
    // back wall in weathered sheet steel
    const wall = beam(26, 0.12, 5.1, mats.paintPale, false);
    wall.position.set(0, 2.55, -4.8);
    wall.receiveShadow = true;
    g.add(wall);

    // practical lighting under the roof
    for (const x of [-6, 2, 9]) {
      const shade = new THREE.Mesh(
        new THREE.ConeGeometry(0.34, 0.3, 12, 1, true),
        mats.paintGreen,
      );
      shade.position.set(x, 4.75, 0.4);
      g.add(shade);
      const bulb = new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 8, 6),
        new THREE.MeshStandardMaterial({ color: 0xffe0a8, emissive: 0xffb964, emissiveIntensity: 3 }),
      );
      bulb.position.set(x, 4.58, 0.4);
      g.add(bulb);
      const light = new THREE.PointLight(0xffc07a, 7, 13, 2);
      light.position.set(x, 4.5, 0.6);
      g.add(light);
      this.practicals.push(light);
    }
    return g;
  }

  /** The narrow steel portal every tree has to fit through to be loaded. */
  private buildGate(mats: WorldMaterials): THREE.Group {
    const g = new THREE.Group();
    g.position.copy(YARD.gate);
    const half = YARD.gateClearWidth / 2;
    const postH = YARD.gateHeight;
    for (const sx of [-1, 1]) {
      const post = beam(0.16, 0.2, postH, mats.paintYellow);
      post.position.set(sx * (half + 0.08), postH / 2, 0);
      g.add(post);
      const plate = beam(0.5, 0.5, 0.04, mats.steelDark);
      plate.position.set(sx * (half + 0.08), 0.02, 0);
      g.add(plate);
      const bolts = boltRow(4, 0.13, mats.steel);
      bolts.position.set(sx * (half + 0.08), 0.05, 0.14);
      g.add(bolts);
      // stiffener braces
      for (const sz of [-1, 1]) {
        const brace = beam(1.0, 0.06, 0.07, mats.paintYellow);
        brace.position.set(sx * (half + 0.34), 0.66, sz * 0.36);
        brace.rotation.z = sx * 0.92;
        brace.rotation.y = sz * 0.55;
        g.add(brace);
      }
    }
    const head = beam(YARD.gateClearWidth + 0.5, 0.2, 0.24, mats.paintYellow);
    head.position.set(0, postH - 0.12, 0);
    g.add(head);
    // rubbing strips: bare steel exactly where trunks touch
    for (const sx of [-1, 1]) {
      const strip = beam(0.06, 0.06, postH * 0.8, mats.steel);
      strip.position.set(sx * half, postH * 0.42, 0);
      g.add(strip);
    }
    return g;
  }

  private buildTruck(mats: WorldMaterials): THREE.Group {
    const g = new THREE.Group();
    const chassis = beam(8.4, 2.3, 0.26, mats.steelDark);
    chassis.position.set(0, 0.95, 0);
    g.add(chassis);
    const bed = beam(6.0, 2.5, 0.12, mats.paintRed);
    bed.position.set(-0.7, 1.14, 0);
    g.add(bed);
    for (const sz of [-1, 1]) {
      const rail = beam(6.0, 0.1, 0.5, mats.paintRed);
      rail.position.set(-0.7, 1.4, sz * 1.2);
      g.add(rail);
      for (let i = 0; i < 5; i++) {
        const stake = beam(0.1, 0.1, 1.5, mats.steelDark);
        stake.position.set(-3.3 + i * 1.35, 1.9, sz * 1.2);
        g.add(stake);
      }
    }
    const cab = beam(2.2, 2.3, 1.9, mats.paintRed);
    cab.position.set(3.3, 2.1, 0);
    g.add(cab);
    const windscreen = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.0, 2.0), mats.glass);
    windscreen.position.set(4.36, 2.5, 0);
    g.add(windscreen);
    const bumper = beam(0.25, 2.4, 0.3, mats.steelDark);
    bumper.position.set(4.5, 0.85, 0);
    g.add(bumper);
    for (const [x, z] of [
      [3.0, 1.28],
      [3.0, -1.28],
      [-1.9, 1.28],
      [-1.9, -1.28],
      [-3.2, 1.28],
      [-3.2, -1.28],
    ] as const) {
      const w = wheel(0.62, 0.36, mats.rubber, mats.steelDark);
      w.position.set(x, 0.62, z);
      g.add(w);
    }
    return g;
  }

  /** Netted bundles already done - the goal state, stated in geometry only. */
  private buildBundleStack(mats: WorldMaterials, quality: QualitySettings): THREE.Group {
    const g = new THREE.Group();
    g.position.set(8.6, 0, -3.8);
    g.rotation.y = 0.22;
    const netMat = new THREE.MeshStandardMaterial({
      color: 0xcd8a58,
      alphaMap: netAlphaTexture(quality.textureSize === 256 ? 128 : 256),
      alphaTest: 0.4,
      side: THREE.DoubleSide,
      roughness: 0.85,
    });
    const trunkMat = mats.cloth;
    const rng = new Rng(1357);
    for (let i = 0; i < 5; i++) {
      const row = Math.floor(i / 3);
      const col = i % 3;
      const bundle = new THREE.Group();
      const len = rng.range(3.4, 4.2);
      const r = rng.range(0.2, 0.26);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r, len, 12, 1, true), netMat);
      body.rotation.z = Math.PI / 2;
      body.castShadow = true;
      bundle.add(body);
      const stub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.4, 8), trunkMat);
      stub.rotation.z = Math.PI / 2;
      stub.position.x = -len / 2 - 0.16;
      bundle.add(stub);
      bundle.position.set(col * 0.06 + rng.jitter(0.08), 0.28 + row * 0.5, col * 0.58 - 0.6 + rng.jitter(0.05));
      bundle.rotation.y = rng.jitter(0.06);
      g.add(bundle);
    }
    this.disposables.push(netMat);
    return g;
  }

  private buildClutter(mats: WorldMaterials): THREE.Group {
    const g = new THREE.Group();
    // pallet stack
    const pallets = new THREE.Group();
    pallets.position.set(-8.6, 0, -6.2);
    pallets.rotation.y = 0.4;
    for (let i = 0; i < 4; i++) {
      const p = beam(1.2, 0.8, 0.12, mats.cloth);
      p.position.set(0, 0.08 + i * 0.15, 0);
      pallets.add(p);
    }
    g.add(pallets);

    // oil drum
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.88, 16, 1), mats.paintGreen);
    drum.position.set(-6.4, 0.44, -4.6);
    drum.castShadow = true;
    g.add(drum);
    for (const y of [0.62, 0.3]) {
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.018, 4, 18), mats.steelDark);
      hoop.rotation.x = Math.PI / 2;
      hoop.position.set(-6.4, y, -4.6);
      g.add(hoop);
    }

    // cable reel of spare netting
    const reel = new THREE.Group();
    reel.position.set(3.0, 0.5, -5.6);
    reel.rotation.z = Math.PI / 2;
    for (const x of [-0.24, 0.24]) {
      const cheek = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.04, 16), mats.cloth);
      cheek.position.y = x;
      reel.add(cheek);
    }
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.45, 14), mats.paintYellow);
    reel.add(core);
    reel.castShadow = true;
    g.add(reel);
    return g;
  }

  private buildMidTrees(quality: QualitySettings): THREE.InstancedMesh {
    // mid-distance conifers: shared instanced geometry, never the hero tree's rig
    const mat = new THREE.MeshStandardMaterial({
      color: 0x4f6647,
      roughness: 0.96,
      metalness: 0,
      vertexColors: true,
    });
    // two stacked tiers give a conifer silhouette without any foliage geometry
    const geo = mergeConifer();
    const count = quality.tier === 'low' ? 14 : 30;
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const rng = new Rng(2024);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      // keep the belt clear of the delivery hall out at x = 40
      p.set(side * rng.range(19, 30), 0, rng.range(-52, -16));
      q.setFromEuler(new THREE.Euler(0, rng.range(0, 6.28), 0));
      const s = rng.range(0.75, 1.15);
      sc.set(s, s * rng.range(0.9, 1.35), s);
      p.y = 0;
      mesh.setMatrixAt(i, m.compose(p, q, sc));
      const tint = 0.72 + rng.next() * 0.5;
      mesh.setColorAt(i, new THREE.Color(tint * 0.92, tint, tint * 0.86));
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    this.disposables.push(geo, mat);
    return mesh;
  }

  /** Keeps the shadow camera tight around whatever the player is looking at. */
  setShadowFocus(x: number, z: number): void {
    this.sun.position.set(x - 9, 6.5, z + 7);
    this.sun.target.position.set(x, 1.2, z);
    this.sun.target.updateMatrixWorld();
  }

  setActive(on: boolean): void {
    this.group.visible = on;
    for (const l of this.practicals) l.visible = on;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}


/** Simple two-tier conifer body shared by every mid-distance tree instance. */
function mergeConifer(): THREE.BufferGeometry {
  const lower = new THREE.ConeGeometry(1, 2.6, 9, 1);
  lower.translate(0, 1.3, 0);
  const upper = new THREE.ConeGeometry(0.66, 2.1, 9, 1);
  upper.translate(0, 2.7, 0);
  const trunk = new THREE.CylinderGeometry(0.07, 0.1, 0.6, 6);
  trunk.translate(0, 0.3, 0);
  const parts = [lower, upper, trunk];
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  for (let pi = 0; pi < parts.length; pi++) {
    const g = parts[pi];
    const p = g.attributes.position as THREE.BufferAttribute;
    const base = pos.length / 3;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      const shade = pi === 2 ? 0.42 : 0.82 + (p.getY(i) / 4) * 0.3;
      col.push(shade, shade, shade * 0.94);
    }
    const gi = g.getIndex();
    if (gi) for (let i = 0; i < gi.count; i++) idx.push(base + gi.getX(i));
    else for (let i = 0; i < p.count; i++) idx.push(base + i);
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}
