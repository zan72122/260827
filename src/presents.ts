import * as THREE from 'three';
import { Spring, clamp, fbm2, lerp } from './util';
import { wrapPaperTexture, ribbonTexture, kraftTexture } from './textures';

export type PresentKind = 'horse' | 'plush' | 'wheel';

interface Bulge { c: THREE.Vector3; r: number; s: number; dir?: THREE.Vector3 }

function displaceBody(geo: THREE.BufferGeometry, bulges: Bulge[], crinkle: number, seed: number) {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const d = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    for (const b of bulges) {
      const dist = v.distanceTo(b.c);
      const w = Math.exp(-((dist / b.r) ** 2));
      if (w < 0.01) continue;
      if (b.dir) d.copy(b.dir);
      else d.copy(v).sub(b.c).normalize();
      v.addScaledVector(d, w * b.s);
    }
    // restrained paper unevenness: gentle low-freq only, no random wrinkle spam
    const n = (fbm2(v.x * 2.1 + seed, v.y * 2.1 + v.z * 1.3 + seed * 2, 2) - 0.5) * crinkle;
    v.multiplyScalar(1 + n);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
}

/** Flat satin ribbon band wrapped around the body.
 *  exp=2 gives an ellipse (soft bodies); higher hugs box corners. */
function ribbonBand(
  A: number, B: number, width: number,
  plane: 'xy' | 'zy', mat: THREE.Material, exp = 2
): THREE.Mesh {
  const SEG = 72;
  const positions: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  const pow = (c: number) => Math.sign(c) * Math.pow(Math.abs(c), 2 / exp);
  for (let i = 0; i <= SEG; i++) {
    const t = (i / SEG) * Math.PI * 2;
    const u = pow(Math.cos(t)) * A;
    const w = pow(Math.sin(t)) * B;
    // half-width offset along the plane normal
    for (const side of [-1, 1]) {
      if (plane === 'xy') positions.push(u, w, side * width / 2);
      else positions.push(side * width / 2, w, u);
      uvs.push(i / SEG * 6, side * 0.5 + 0.5);
    }
    if (i < SEG) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}

function makeBow(mat: THREE.Material, scale = 1): THREE.Group {
  const bow = new THREE.Group();
  const loopG = new THREE.TorusGeometry(0.085 * scale, 0.028 * scale, 8, 20);
  for (const s of [-1, 1]) {
    const loop = new THREE.Mesh(loopG, mat);
    loop.scale.set(1, 0.72, 0.4);
    loop.rotation.z = s * 0.9;
    loop.position.set(s * 0.075 * scale, 0.04 * scale, 0);
    loop.castShadow = true;
    bow.add(loop);
  }
  const knot = new THREE.Mesh(new THREE.SphereGeometry(0.04 * scale, 10, 8), mat);
  knot.scale.set(1.2, 0.8, 0.8);
  bow.add(knot);
  // tails
  for (const s of [-1, 1]) {
    const tail = new THREE.Mesh(new THREE.PlaneGeometry(0.05 * scale, 0.17 * scale, 1, 4), mat);
    tail.position.set(s * 0.05 * scale, -0.075 * scale, 0.01);
    tail.rotation.z = s * 0.35;
    tail.rotation.x = -0.2;
    (tail.material as THREE.Material).side = THREE.DoubleSide;
    bow.add(tail);
  }
  return bow;
}

export class Present {
  group = new THREE.Group();
  /** child used for sway / rocking offsets while travelling inside */
  sway = new THREE.Group();
  body!: THREE.Mesh;
  basePos!: Float32Array;
  /** every deformable mesh (body + ribbon bands) with its rest positions */
  private deformables: { mesh: THREE.Mesh; base: Float32Array }[] = [];
  bow!: THREE.Group;
  bowSpring = new Spring(60, 7);
  bowSpringX = new Spring(50, 6);
  tag!: THREE.Mesh;
  kind: PresentKind;
  /** local axis that is aligned with travel direction during sack entry */
  entryAxis = new THREE.Vector3(0, -1, 0);
  /** rotation applied at the mouth so the right end goes in first */
  entryTilt = new THREE.Euler(0, 0, 0);
  maxSqueeze = 0.4;
  /** rough radius for snapping / spacing */
  radius = 0.7;
  height = 1.1;
  private squeeze = -1;
  private time = Math.random() * 10;
  private rockPhase = 0;

  constructor(kind: PresentKind) {
    this.kind = kind;
    this.group.add(this.sway);
    this.group.name = `present-${kind}`;

    const paperMat = new THREE.MeshStandardMaterial({
      map: wrapPaperTexture(kind),
      roughness: kind === 'plush' ? 0.85 : 0.55,
      metalness: 0.0,
    });
    const ribbonColors: Record<PresentKind, [string, string]> = {
      horse: ['#b3232d', '#e8b7ad'],
      plush: ['#efe3c8', '#d8bf92'],
      wheel: ['#e0b33a', '#f4e2b0'],
    };
    const [rc, rh] = ribbonColors[kind];
    const ribbonMat = new THREE.MeshStandardMaterial({
      map: ribbonTexture(rc, rh), roughness: 0.28, metalness: 0.05, side: THREE.DoubleSide,
    });

    let geo: THREE.BufferGeometry;
    let bandA = 0.5, bandB = 0.5, bandC = 0.5; // x, y, z semi extents for ribbon
    if (kind === 'horse') {
      // wrapped rocking horse: head tent top-front, curved rockers at the base
      geo = new THREE.BoxGeometry(1.0, 0.86, 0.42, 26, 22, 12);
      geo.translate(0, 0.43, 0);
      displaceBody(geo, [
        { c: new THREE.Vector3(0.34, 0.98, 0), r: 0.34, s: 0.26 },              // head
        { c: new THREE.Vector3(0.55, 1.10, 0), r: 0.20, s: 0.09 },              // ears/mane
        { c: new THREE.Vector3(-0.45, 0.72, 0), r: 0.26, s: 0.12 },             // tail
        { c: new THREE.Vector3(0, 0.02, 0.16), r: 0.55, s: -0.10, dir: new THREE.Vector3(0, 1, 0) },
        { c: new THREE.Vector3(0, 0.02, -0.16), r: 0.55, s: -0.10, dir: new THREE.Vector3(0, 1, 0) },
        { c: new THREE.Vector3(0.42, 0.02, 0), r: 0.24, s: 0.10, dir: new THREE.Vector3(0, -1, 0) }, // rocker tips
        { c: new THREE.Vector3(-0.42, 0.02, 0), r: 0.24, s: 0.10, dir: new THREE.Vector3(0, -1, 0) },
      ], 0.007, 3);
      bandA = 0.52; bandB = 0.46; bandC = 0.24;
      this.entryAxis.set(0.35, -1, 0).normalize();
      this.entryTilt.set(0, 0, -0.35);
      this.maxSqueeze = 0.34;
      this.radius = 0.62; this.height = 1.28;
    } else if (kind === 'plush') {
      // big soft plush bear: round, ears, belly — paper barely holds the shape
      geo = new THREE.SphereGeometry(0.6, 42, 34);
      geo.scale(1.0, 1.12, 0.88);
      geo.translate(0, 0.68, 0);
      displaceBody(geo, [
        { c: new THREE.Vector3(-0.24, 1.30, 0), r: 0.20, s: 0.16 },  // ear L
        { c: new THREE.Vector3(0.24, 1.30, 0), r: 0.20, s: 0.16 },   // ear R
        { c: new THREE.Vector3(0, 0.55, 0.5), r: 0.42, s: 0.14 },    // belly
        { c: new THREE.Vector3(-0.42, 0.28, 0.3), r: 0.24, s: 0.10 },// leg
        { c: new THREE.Vector3(0.42, 0.28, 0.3), r: 0.24, s: 0.10 },
        { c: new THREE.Vector3(0, 0.12, 0), r: 0.5, s: -0.08, dir: new THREE.Vector3(0, 1, 0) }, // sits flat
      ], 0.013, 8);
      bandA = 0.55; bandB = 0.64; bandC = 0.48; // presses into the soft body
      this.entryAxis.set(0, -1, 0).normalize();
      this.entryTilt.set(0.15, 0, 0);
      this.maxSqueeze = 0.55;
      this.radius = 0.68; this.height = 1.45;
    } else {
      // wheeled toy: long body, four wheel bumps, cab on top
      geo = new THREE.BoxGeometry(1.2, 0.52, 0.5, 28, 14, 14);
      geo.translate(0, 0.4, 0);
      displaceBody(geo, [
        { c: new THREE.Vector3(0.42, 0.14, 0.26), r: 0.17, s: 0.11 },
        { c: new THREE.Vector3(0.42, 0.14, -0.26), r: 0.17, s: 0.11 },
        { c: new THREE.Vector3(-0.42, 0.14, 0.26), r: 0.17, s: 0.11 },
        { c: new THREE.Vector3(-0.42, 0.14, -0.26), r: 0.17, s: 0.11 },
        { c: new THREE.Vector3(-0.18, 0.72, 0), r: 0.28, s: 0.16 },  // cab
        { c: new THREE.Vector3(0.5, 0.5, 0), r: 0.2, s: 0.06 },      // bonnet
      ], 0.006, 15);
      bandA = 0.62; bandB = 0.34; bandC = 0.28;
      this.entryAxis.set(1, -0.25, 0).normalize(); // slides in nose-first, lengthwise
      this.entryTilt.set(0, 0, 1.1);
      this.maxSqueeze = 0.22;
      this.radius = 0.66; this.height = 0.85;
    }

    this.body = new THREE.Mesh(geo, paperMat);
    this.body.castShadow = true;
    this.body.receiveShadow = true;
    this.basePos = new Float32Array((geo.attributes.position as THREE.BufferAttribute).array);
    this.sway.add(this.body);
    this.deformables.push({ mesh: this.body, base: this.basePos });

    // two crossing ribbon bands
    const yCenter = kind === 'plush' ? 0.7 : kind === 'horse' ? 0.5 : 0.4;
    const bandW = kind === 'plush' ? 0.12 : 0.085;
    const bandExp = kind === 'plush' ? 2 : 3.2; // hug the boxy shapes
    const b1 = ribbonBand(bandA + 0.03, bandB + 0.03, bandW, 'xy', ribbonMat, bandExp);
    b1.position.y = yCenter;
    const b2 = ribbonBand(bandC + 0.03, bandB + 0.03, bandW, 'zy', ribbonMat, bandExp);
    b2.position.y = yCenter;
    this.sway.add(b1, b2);
    for (const b of [b1, b2]) {
      this.deformables.push({
        mesh: b,
        base: new Float32Array((b.geometry.attributes.position as THREE.BufferAttribute).array),
      });
    }

    // bow on top
    this.bow = makeBow(ribbonMat, kind === 'plush' ? 1.5 : 1.25);
    this.bow.position.set(0, yCenter + bandB + 0.05, 0);
    this.sway.add(this.bow);

    // kraft paper tag with string — the loose paper edge that flutters
    const tagMat = new THREE.MeshStandardMaterial({ map: kraftTexture(), roughness: 0.9, side: THREE.DoubleSide });
    this.tag = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.09, 4, 1), tagMat);
    this.tag.position.set(bandA * 0.5, yCenter + bandB - 0.05, bandC + 0.05);
    this.tag.rotation.y = 0.4;
    this.sway.add(this.tag);
    const stringMat = new THREE.MeshBasicMaterial({ color: 0xd8c8a8 });
    const string = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.22, 4), stringMat);
    string.position.set(bandA * 0.35, yCenter + bandB + 0.02, bandC * 0.7);
    string.rotation.z = 0.9; string.rotation.x = 0.4;
    this.sway.add(string);
  }

  /** Authored local compression for squeezing through the sack mouth.
   *  s in [0,1]; radial squash around entryAxis + axial stretch + paper crinkle.
   *  Wrap paper AND ribbon bands compress together. */
  setSqueeze(s: number) {
    s = clamp(s, 0, 1);
    if (Math.abs(s - this.squeeze) < 0.004) return;
    this.squeeze = s;
    const eff = s * this.maxSqueeze;
    const axis = this.entryAxis;
    const v = new THREE.Vector3();
    const tmp = new THREE.Vector3();
    const center = new THREE.Vector3();
    for (const d of this.deformables) {
      const pos = d.mesh.geometry.attributes.position as THREE.BufferAttribute;
      // squeeze center expressed in this mesh's local space
      center.set(0, this.height * 0.5 - d.mesh.position.y, 0);
      for (let i = 0; i < pos.count; i++) {
        v.set(d.base[i * 3], d.base[i * 3 + 1], d.base[i * 3 + 2]);
        tmp.copy(v).sub(center);
        const a = tmp.dot(axis);                 // axial coord
        const radial = tmp.addScaledVector(axis, -a); // radial vector
        // squash more at the leading (entering) end
        const lead = clamp(0.65 + (-a / this.height) * 0.7, 0.35, 1);
        radial.multiplyScalar(1 - eff * lead);
        // crinkle jitter of the compressed paper
        const cr = (fbm2(v.x * 9 + i * 0.01, v.y * 9, 2) - 0.5) * eff * 0.03;
        v.copy(center).addScaledVector(axis, a * (1 + eff * 0.45)).add(radial)
          .multiplyScalar(1 + cr);
        pos.setXYZ(i, v.x, v.y, v.z);
      }
      pos.needsUpdate = true;
      d.mesh.geometry.computeVertexNormals();
    }
    // the bow flattens against the paper
    const bs = 1 - eff * 0.55;
    this.bow.scale.set(bs, bs, bs);
  }

  /** breeze from the sack: ribbon leans toward it, tag paper flutters */
  applyBreeze(strength: number, towardLocal: THREE.Vector3) {
    this.bowSpring.target = towardLocal.x * strength * 0.5;
    this.bowSpringX.target = -towardLocal.z * strength * 0.5;
  }

  /** sway while following a drawn path inside the sack */
  applyTravelSway(curvature: number, speed: number) {
    if (this.kind === 'horse') {
      this.sway.rotation.z = lerp(this.sway.rotation.z, curvature * 0.55 + Math.sin(this.rockPhase) * 0.06 * Math.min(speed, 1), 0.12);
      this.rockPhase += speed * 0.15;
    } else if (this.kind === 'plush') {
      const squish = clamp(1 - Math.abs(curvature) * 0.2 - speed * 0.01, 0.9, 1);
      this.sway.scale.setScalar(lerp(this.sway.scale.x, squish, 0.1));
      this.sway.rotation.z = lerp(this.sway.rotation.z, curvature * 0.8, 0.06); // lags softly
      this.sway.rotation.x = lerp(this.sway.rotation.x, -speed * 0.02, 0.08);
    } else {
      this.sway.rotation.y = lerp(this.sway.rotation.y, -curvature * 0.7, 0.15);
      this.sway.rotation.x += speed * 0.004; // hint of rolling wheels
      this.sway.rotation.x *= 0.92;
    }
    this.bowSpring.target = curvature * 0.9;
  }

  update(dt: number) {
    this.time += dt;
    this.bow.rotation.z = this.bowSpring.update(dt) + Math.sin(this.time * 1.7) * 0.02;
    this.bow.rotation.x = this.bowSpringX.update(dt);
    // tag flutter (predawn breeze + always a little alive)
    this.tag.rotation.y = 0.4 + Math.sin(this.time * 5.1) * 0.16 + Math.sin(this.time * 13.7) * 0.05;
    this.tag.rotation.z = Math.sin(this.time * 4.3) * 0.08;
  }

  resetSway() {
    this.sway.rotation.set(0, 0, 0);
    this.sway.scale.setScalar(1);
  }

  /** stored presents become static set dressing: same-kind presents share
   *  one rest-pose geometry so the warehouse can fill up without the
   *  GPU bill growing per gift */
  private static restGeometries = new Map<string, THREE.BufferGeometry[]>();
  freezeToShared() {
    this.setSqueeze(0);
    const meshes = this.deformables.map((d) => d.mesh);
    const shared = Present.restGeometries.get(this.kind);
    if (!shared) {
      Present.restGeometries.set(this.kind, meshes.map((m) => m.geometry));
    } else {
      meshes.forEach((m, i) => {
        if (m.geometry !== shared[i]) {
          m.geometry.dispose();
          m.geometry = shared[i];
        }
      });
    }
    this.deformables = [];
  }
}
