/**
 * The shipping yard: worked ground, the netting line, a loaded truck behind a
 * narrow loading gate, the work shed and the tree line beyond it. Depth is
 * carried by silhouette density, light level and haze — not by blurring.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { box, makeBaleGeometry, makeFarConiferGeometry, makeWorker, tube } from './props';
import type { Materials } from './materials';
import { fbm2, mulberry32, range, smoothstep } from '../core/rand';

export const TREE_PAD = new THREE.Vector3(-9.0, 0, 3.6);
export const SHAKER_POS = new THREE.Vector3(-6.4, 0, 3.4);
export const BALER_POS = new THREE.Vector3(-2.4, 0, 0);
export const GATE_POS = new THREE.Vector3(7.5, 0, 5.5);
export const GATE_HALF_WIDTH = 0.66;
export const GATE_HEIGHT = 4.7;

/** The lane the trucks use: dirt is wet and rutted here and nowhere else. */
function laneCentre(x: number): number {
  return 7.4 + Math.sin(x * 0.11) * 0.7;
}

function makeWetMask(): THREE.Texture {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, S, S);
  const toU = (x: number) => ((x + 60) / 120) * S;
  const toV = (z: number) => ((z + 60) / 120) * S;

  // two ruts along the lane
  ctx.lineCap = 'round';
  for (const off of [-1.15, 1.15]) {
    ctx.beginPath();
    for (let x = -60; x <= 60; x += 2) {
      const z = laneCentre(x) + off + Math.sin(x * 0.7) * 0.06;
      const u = toU(x);
      const v = toV(z);
      if (x === -60) ctx.moveTo(u, v);
      else ctx.lineTo(u, v);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.82)';
    ctx.lineWidth = (0.3 / 120) * S * 2;
    ctx.stroke();
  }
  // standing water where the ruts dip
  const rng = mulberry32(4242);
  for (let i = 0; i < 26; i++) {
    const x = range(rng, -26, 26);
    const z = laneCentre(x) + range(rng, -1.7, 1.7);
    const r = range(rng, 0.5, 2.3);
    const g = ctx.createRadialGradient(toU(x), toV(z), 0, toU(x), toV(z), (r / 120) * S);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.72, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(toU(x), toV(z), (r / 120) * S, (r / 120) * S * 0.55, rng() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // splash under the machines where boots and meltwater collect
  for (const p of [SHAKER_POS, BALER_POS, new THREE.Vector3(0.6, 0, 0.4)]) {
    const g = ctx.createRadialGradient(toU(p.x), toV(p.z), 0, toU(p.x), toV(p.z), (2.6 / 120) * S);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

export class Yard {
  readonly group = new THREE.Group();
  readonly gateWorld = GATE_POS.clone();
  readonly lights: THREE.Light[] = [];
  private litter: THREE.InstancedMesh;

  constructor(mats: Materials, budget: { tier: string }) {
    // ---------- ground ----------
    const seg = budget.tier === 'low' ? 48 : 84;
    const g = new THREE.PlaneGeometry(120, 120, seg, seg);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const lane = Math.abs(z - laneCentre(x));
      const inLane = smoothstep(2.4, 0.6, lane);
      const rut = Math.exp(-((lane - 1.15) ** 2) / 0.06) + Math.exp(-((lane + 1.15) ** 2) / 0.06);
      let y = (fbm2(x * 0.07 + 30, z * 0.07 + 30, 5, 64, 4) - 0.5) * 0.34;
      y -= rut * inLane * 0.075;
      y -= inLane * 0.045;
      // graded apron around the working line
      const apron = smoothstep(9, 4.5, Math.hypot((x + 3) * 0.55, z - 1.6));
      y = y * (1 - apron * 0.8);
      pos.setY(i, y);

      const wet = inLane * 0.55;
      const gravel = apron * 0.5;
      const litterZone = smoothstep(7, 2, Math.hypot(x - TREE_PAD.x, z - TREE_PAD.z));
      const shade = 1 - wet * 0.4 + gravel * 0.24;
      col[i * 3] = shade * (1 + litterZone * 0.1);
      col[i * 3 + 1] = shade * (1 - litterZone * 0.02);
      col[i * 3 + 2] = shade * (1 - wet * 0.06 - litterZone * 0.12);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    const ground = new THREE.Mesh(g, mats.ground);
    ground.receiveShadow = true;
    this.group.add(ground);

    // wet film that follows the ruts and the low spots
    const wetGeo = new THREE.PlaneGeometry(120, 120, 1, 1);
    wetGeo.rotateX(-Math.PI / 2);
    const wetMat = mats.wet.clone();
    wetMat.alphaMap = makeWetMask();
    wetMat.opacity = 0.62;
    const wet = new THREE.Mesh(wetGeo, wetMat);
    wet.position.y = 0.012;
    this.group.add(wet);

    // ---------- scattered needle litter ----------
    const litterGeo = new THREE.BufferGeometry();
    litterGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([0, 0, 0, 0.008, 0, 0.004, 0.05, 0, 0.004, 0.05, 0, 0]), 3),
    );
    litterGeo.setAttribute(
      'normal',
      new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), 3),
    );
    litterGeo.setIndex([0, 2, 1, 0, 3, 2]);
    const count = budget.tier === 'low' ? 160 : 420;
    this.litter = new THREE.InstancedMesh(litterGeo, mats.debris, count);
    const rng = mulberry32(70707);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      // density follows the working line, not the whole yard
      const near = rng() < 0.62;
      const x = near ? range(rng, -11, 4) : range(rng, -24, 20);
      const z = near ? range(rng, -1.5, 6) : range(rng, -10, 10);
      q.setFromEuler(new THREE.Euler(Math.PI / 2, 0, rng() * 6.28));
      const s = range(rng, 0.7, 2.1);
      m.compose(new THREE.Vector3(x, 0.02, z), q, new THREE.Vector3(s, s, s));
      this.litter.setMatrixAt(i, m);
      c.setRGB(range(rng, 0.22, 0.42), range(rng, 0.14, 0.24), 0.075);
      this.litter.setColorAt(i, c);
    }
    this.litter.receiveShadow = false;
    this.group.add(this.litter);

    // ---------- loading gate ----------
    const gate = new THREE.Group();
    gate.position.copy(GATE_POS);
    // the slot faces along the yard, so trees pass through it onto the bed
    gate.rotation.y = Math.PI / 2;
    const post = (s: number) =>
      mergeGeometries(
        [
          box(0.16, GATE_HEIGHT, 0.16, s * (GATE_HALF_WIDTH + 0.08), GATE_HEIGHT / 2, 0),
          box(0.42, 0.05, 0.42, s * (GATE_HALF_WIDTH + 0.08), 0.025, 0),
          box(0.1, 0.1, 0.9, s * (GATE_HALF_WIDTH + 0.08), GATE_HEIGHT * 0.55, 0.45),
        ],
        false,
      )!;
    const gateMesh = new THREE.Mesh(
      mergeGeometries(
        [
          post(-1),
          post(1),
          box(GATE_HALF_WIDTH * 2 + 0.36, 0.18, 0.18, 0, GATE_HEIGHT + 0.09, 0),
          box(0.1, 0.1, 0.1, 0, GATE_HEIGHT + 0.24, 0),
        ],
        false,
      )!,
      mats.shakerPaint,
    );
    gateMesh.castShadow = true;
    gateMesh.receiveShadow = true;
    gate.add(gateMesh);
    // wear only on the inner faces the trees rub past
    const rubStrips = new THREE.Mesh(
      mergeGeometries(
        [
          box(0.03, GATE_HEIGHT * 0.8, 0.14, -GATE_HALF_WIDTH, GATE_HEIGHT * 0.42, 0),
          box(0.03, GATE_HEIGHT * 0.8, 0.14, GATE_HALF_WIDTH, GATE_HEIGHT * 0.42, 0),
        ],
        false,
      )!,
      mats.wear,
    );
    gate.add(rubStrips);
    this.group.add(gate);

    // ---------- truck ----------
    this.group.add(this.buildTruck(mats));

    // ---------- work shed ----------
    this.group.add(this.buildShed(mats));

    // ---------- tree line ----------
    const farGeo = makeFarConiferGeometry(1234);
    const farCount = budget.tier === 'low' ? 34 : 62;
    const far = new THREE.InstancedMesh(farGeo, mats.farFoliage, farCount);
    const r2 = mulberry32(8181);
    for (let i = 0; i < farCount; i++) {
      const row = i % 2;
      const x = range(r2, -60, 95);
      const z = -23 - row * 9 - range(r2, 0, 7);
      const s = range(r2, 0.78, 1.28);
      q.setFromEuler(new THREE.Euler(0, r2() * 6.28, 0));
      m.compose(new THREE.Vector3(x, -0.1, z), q, new THREE.Vector3(s, s * range(r2, 0.9, 1.35), s));
      far.setMatrixAt(i, m);
      // no two trees in a shelter belt are the same green
      c.setRGB(range(r2, 0.78, 1.15), range(r2, 0.82, 1.1), range(r2, 0.8, 1.2));
      far.setColorAt(i, c);
    }
    far.castShadow = false;
    far.receiveShadow = false;
    this.group.add(far);

    // ---------- finished bales waiting by the gate ----------
    const stackMat = new THREE.MeshStandardMaterial({ color: 0x3d4629, roughness: 0.9 });
    const stackRng = mulberry32(2024);
    const pallet = new THREE.Mesh(box(1.3, 0.14, 2.6, 0, 0.07, 0), mats.timber);
    pallet.position.set(4.4, 0, 3.0);
    pallet.receiveShadow = true;
    pallet.castShadow = true;
    this.group.add(pallet);
    for (let i = 0; i < 4; i++) {
      const b = new THREE.Mesh(makeBaleGeometry(range(stackRng, 3.2, 3.9), 300 + i), stackMat);
      b.rotation.y = Math.PI / 2 + range(stackRng, -0.05, 0.05);
      b.position.set(4.4 + (i % 2) * 0.34 - 0.17, 0.28 + Math.floor(i / 2) * 0.42, 3.0);
      b.castShadow = true;
      this.group.add(b);
    }

    // ---------- foreground working clutter ----------
    const fg = new THREE.Group();
    fg.position.set(-16.6, 0, 6.2);
    fg.rotation.y = 0.7;
    const palletParts: THREE.BufferGeometry[] = [];
    for (let layer = 0; layer < 3; layer++) {
      const y = 0.02 + layer * 0.135;
      const jx = layer * 0.035 - 0.03;
      for (let sl = 0; sl < 5; sl++) {
        palletParts.push(box(1.15, 0.022, 0.13, jx, y + 0.088, -0.38 + sl * 0.19));
      }
      for (const bx of [-0.5, 0, 0.5]) palletParts.push(box(0.1, 0.07, 0.9, jx + bx, y + 0.04, 0));
      palletParts.push(box(1.15, 0.022, 0.9, jx, y, 0));
    }
    const stack = new THREE.Mesh(mergeGeometries(palletParts, false)!, mats.timber);
    stack.castShadow = true;
    stack.receiveShadow = true;
    fg.add(stack);
    const netRoll = new THREE.Mesh(
      tube(0.24, 0.5, 16, 'x', 0.95, 0.24, 0.4),
      new THREE.MeshStandardMaterial({ color: 0xc4571c, roughness: 0.82 }),
    );
    netRoll.castShadow = true;
    fg.add(netRoll);
    const bucket = new THREE.Mesh(tube(0.16, 0.3, 12, 'y', -0.95, 0.15, 0.5, 0.19), mats.darkSteel);
    bucket.castShadow = true;
    fg.add(bucket);
    this.group.add(fg);

    // ---------- people ----------
    const w1 = makeWorker(mats, 12);
    w1.position.set(5.6, 0, 3.1);
    w1.rotation.y = -1.9;
    this.group.add(w1);
    const w2 = makeWorker(mats, 77);
    w2.position.set(-14.5, 0, -3.2);
    w2.rotation.y = 1.9;
    this.group.add(w2);
  }

  private buildTruck(mats: Materials): THREE.Group {
    const t = new THREE.Group();
    t.position.set(12.8, 0, 5.3);
    t.rotation.y = 0.06;
    const deck = 1.12;
    const body = new THREE.Mesh(
      mergeGeometries(
        [
          box(8.6, 0.22, 2.45, 0, deck, 0),
          box(8.6, 0.14, 0.1, 0, deck + 0.34, -1.2),
          box(8.6, 0.14, 0.1, 0, deck + 0.34, 1.2),
          box(0.5, 0.36, 0.12, -3.6, deck + 0.5, -1.2),
          box(0.5, 0.36, 0.12, -0.6, deck + 0.5, -1.2),
          box(0.5, 0.36, 0.12, 2.4, deck + 0.5, -1.2),
          box(0.5, 0.36, 0.12, -3.6, deck + 0.5, 1.2),
          box(0.5, 0.36, 0.12, -0.6, deck + 0.5, 1.2),
          box(0.5, 0.36, 0.12, 2.4, deck + 0.5, 1.2),
          box(9.4, 0.34, 0.9, 0, deck - 0.3, 0),
          // side skirt and toolboxes break up the slab
          box(8.4, 0.5, 0.1, 0, deck - 0.42, -1.2),
          box(8.4, 0.5, 0.1, 0, deck - 0.42, 1.2),
          box(1.1, 0.5, 0.6, -0.4, deck - 0.36, 1.05),
        ],
        false,
      )!,
      mats.truckPaint,
    );
    body.castShadow = true;
    body.receiveShadow = true;
    t.add(body);

    const cab = new THREE.Mesh(
      mergeGeometries(
        [box(2.3, 1.85, 2.4, 5.6, deck + 0.85, 0), box(2.4, 0.16, 2.5, 5.6, deck + 1.82, 0)],
        false,
      )!,
      mats.truckPaint,
    );
    cab.castShadow = true;
    t.add(cab);
    const glass = new THREE.Mesh(
      mergeGeometries(
        [box(0.08, 0.9, 2.0, 6.72, deck + 1.24, 0), box(1.7, 0.8, 0.08, 5.5, deck + 1.2, 1.22)],
        false,
      )!,
      mats.glass,
    );
    t.add(glass);

    const wheels: THREE.BufferGeometry[] = [];
    for (const x of [-3.1, -1.9, 5.3]) {
      for (const z of [-1.24, 1.24]) wheels.push(tube(0.56, 0.36, 16, 'z', x, 0.56, z));
    }
    const wheelMesh = new THREE.Mesh(mergeGeometries(wheels, false)!, mats.rubber);
    wheelMesh.castShadow = true;
    t.add(wheelMesh);
    const hubs: THREE.BufferGeometry[] = [];
    for (const x of [-3.1, -1.9, 5.3]) {
      for (const z of [-1.4, 1.4]) hubs.push(tube(0.22, 0.06, 12, 'z', x, 0.56, z));
    }
    t.add(new THREE.Mesh(mergeGeometries(hubs, false)!, mats.darkSteel));

    // cargo: bales that already went through the machine
    const baleMat = new THREE.MeshStandardMaterial({ color: 0x3d4629, roughness: 0.9 });
    const rng = mulberry32(515);
    for (let i = 0; i < 5; i++) {
      const bale = new THREE.Mesh(makeBaleGeometry(range(rng, 3.4, 4.1), 100 + i), baleMat);
      bale.position.set(range(rng, -1.6, 1.2), deck + 0.5 + Math.floor(i / 3) * 0.52, -0.8 + (i % 3) * 0.8);
      bale.rotation.set(range(rng, -0.05, 0.05), range(rng, -0.06, 0.06), 0);
      bale.castShadow = true;
      t.add(bale);
    }
    return t;
  }

  private buildShed(mats: Materials): THREE.Group {
    const s = new THREE.Group();
    s.position.set(-7, 0, -15.5);
    const parts: THREE.BufferGeometry[] = [];
    for (const x of [-6.5, -2.2, 2.2, 6.5]) {
      parts.push(box(0.22, 4.2, 0.22, x, 2.1, -2.6));
      parts.push(box(0.22, 4.2, 0.22, x, 2.1, 2.6));
    }
    parts.push(box(14, 0.3, 0.3, 0, 4.25, -2.6));
    parts.push(box(14, 0.3, 0.3, 0, 4.25, 2.6));
    const frame = new THREE.Mesh(mergeGeometries(parts, false)!, mats.darkSteel);
    frame.castShadow = true;
    s.add(frame);

    // shallow gable in profiled sheet, with a fascia at the eaves
    const roofParts: THREE.BufferGeometry[] = [];
    for (const side of [-1, 1]) {
      const slab = box(14.6, 0.1, 3.2, 0, 4.62, side * 1.6);
      slab.rotateX(side * 0.11);
      slab.translate(0, 0.06, 0);
      roofParts.push(slab);
    }
    roofParts.push(box(14.8, 0.26, 0.12, 0, 4.5, -3.15));
    roofParts.push(box(14.8, 0.26, 0.12, 0, 4.5, 3.15));
    roofParts.push(box(0.3, 0.2, 6.4, 0, 4.86, 0));
    for (const x of [-6.5, -2.2, 2.2, 6.5]) roofParts.push(box(0.16, 0.22, 6.2, x, 4.42, 0));
    const roof = new THREE.Mesh(mergeGeometries(roofParts, false)!, mats.truckPaint);
    roof.castShadow = true;
    s.add(roof);

    const back = new THREE.Mesh(box(14, 4.2, 0.1, 0, 2.1, -2.72), mats.truckPaint);
    back.receiveShadow = true;
    s.add(back);

    // practical lamps under the roof
    for (const x of [-5, 0, 5]) {
      const lamp = new THREE.Mesh(box(0.9, 0.08, 0.28, x, 4.3, 0), mats.lampGlow);
      s.add(lamp);
      const shade = new THREE.Mesh(box(1.05, 0.1, 0.4, x, 4.4, 0), mats.darkSteel);
      s.add(shade);
      const light = new THREE.PointLight(0xffe0b0, 14, 17, 2);
      light.position.set(x, 4.1, 0);
      s.add(light);
      this.lights.push(light);
    }

    // pallets and stacked stock
    const rng = mulberry32(99);
    for (let i = 0; i < 5; i++) {
      const p = new THREE.Mesh(box(1.2, 0.14, 1.0, 0, 0.07, 0), mats.timber);
      p.position.set(range(rng, -6, 6), 0, range(rng, -2, 2));
      p.rotation.y = rng() * 0.6;
      p.castShadow = true;
      s.add(p);
    }
    return s;
  }
}
