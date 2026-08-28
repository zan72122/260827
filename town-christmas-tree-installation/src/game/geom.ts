import * as THREE from 'three';

/** Points of a hanging cable between a and b, with `sag` metres of droop. */
export function catenaryPoints(a: THREE.Vector3, b: THREE.Vector3, sag: number, segments = 18): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const p = a.clone().lerp(b, t);
    // Parabolic approximation of a catenary — visually identical at this scale.
    p.y -= sag * 4 * t * (1 - t);
    pts.push(p);
  }
  return pts;
}

/**
 * Rectangular-section extrusion along a polyline. Used for webbing slings and
 * flat steel members, which must read as having real thickness.
 */
export function ribbonGeometry(
  points: THREE.Vector3[],
  width: number,
  thickness: number,
  upHint = new THREE.Vector3(0, 1, 0),
): THREE.BufferGeometry {
  const n = points.length;
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];

  const tangent = new THREE.Vector3();
  const side = new THREE.Vector3();
  const up = new THREE.Vector3();
  let prevUp = upHint.clone().normalize();
  let dist = 0;

  for (let i = 0; i < n; i++) {
    const p = points[i];
    if (i === 0) tangent.copy(points[1]).sub(points[0]);
    else if (i === n - 1) tangent.copy(points[n - 1]).sub(points[n - 2]);
    else tangent.copy(points[i + 1]).sub(points[i - 1]);
    if (tangent.lengthSq() < 1e-12) tangent.set(0, 0, 1);
    tangent.normalize();
    if (i > 0) dist += p.distanceTo(points[i - 1]);

    side.crossVectors(tangent, prevUp);
    if (side.lengthSq() < 1e-8) side.crossVectors(tangent, new THREE.Vector3(1, 0, 0));
    side.normalize();
    up.crossVectors(side, tangent).normalize();
    prevUp.copy(up);

    const hw = width * 0.5;
    const ht = thickness * 0.5;
    const corners = [
      p.clone().addScaledVector(side, -hw).addScaledVector(up, ht),
      p.clone().addScaledVector(side, hw).addScaledVector(up, ht),
      p.clone().addScaledVector(side, hw).addScaledVector(up, -ht),
      p.clone().addScaledVector(side, -hw).addScaledVector(up, -ht),
    ];
    const normals = [up.clone(), up.clone(), up.clone().negate(), up.clone().negate()];
    for (let c = 0; c < 4; c++) {
      pos.push(corners[c].x, corners[c].y, corners[c].z);
      nor.push(normals[c].x, normals[c].y, normals[c].z);
      uv.push(c === 1 || c === 2 ? 1 : 0, dist / Math.max(width, 0.001));
    }
  }

  for (let i = 0; i < n - 1; i++) {
    const a = i * 4;
    const b = (i + 1) * 4;
    for (let c = 0; c < 4; c++) {
      const c2 = (c + 1) % 4;
      idx.push(a + c, b + c, b + c2, a + c, b + c2, a + c2);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Rope / wire rope: a swept tube along a polyline. */
export function ropeGeometry(points: THREE.Vector3[], radius: number, radial = 6): THREE.BufferGeometry {
  const safe = points.length >= 2 ? points : [new THREE.Vector3(), new THREE.Vector3(0, 0.01, 0)];
  const curve = new THREE.CatmullRomCurve3(safe, false, 'catmullrom', 0.4);
  return new THREE.TubeGeometry(curve, Math.max(2, safe.length * 2), radius, radial, false);
}

/**
 * Rebuildable cable: keeps one mesh and swaps its geometry as the path moves.
 * Cheap enough for the handful of cables in the scene.
 */
export class Cable {
  readonly mesh: THREE.Mesh;
  private radius: number;
  private radial: number;

  constructor(material: THREE.Material, radius: number, radial = 6) {
    this.radius = radius;
    this.radial = radial;
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
  }

  update(points: THREE.Vector3[]): void {
    this.mesh.geometry.dispose();
    this.mesh.geometry = ropeGeometry(points, this.radius, this.radial);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
  }
}

/** Critically damped scalar follower — the basis of every "heavy" motion. */
export class Spring {
  value: number;
  velocity = 0;
  constructor(
    value: number,
    public stiffness = 24,
    public damping = 9,
    public maxSpeed = Infinity,
  ) {
    this.value = value;
  }

  step(target: number, dt: number): number {
    const a = (target - this.value) * this.stiffness - this.velocity * this.damping;
    this.velocity += a * dt;
    if (Math.abs(this.velocity) > this.maxSpeed) this.velocity = Math.sign(this.velocity) * this.maxSpeed;
    this.value += this.velocity * dt;
    return this.value;
  }

  reset(v: number): void {
    this.value = v;
    this.velocity = 0;
  }
}

/** Rate limiter with acceleration — gives machinery its spin-up / spin-down. */
export class Inertial {
  value: number;
  velocity = 0;
  constructor(
    value: number,
    public accel: number,
    public maxSpeed: number,
  ) {
    this.value = value;
  }

  step(target: number, dt: number): number {
    const diff = target - this.value;
    // Speed we could still bleed off before reaching the target.
    const stopSpeed = Math.sqrt(Math.max(0, 2 * this.accel * Math.abs(diff)));
    const desired = Math.sign(diff) * Math.min(this.maxSpeed, stopSpeed);
    const dv = desired - this.velocity;
    const maxDv = this.accel * dt;
    this.velocity += Math.abs(dv) <= maxDv ? dv : Math.sign(dv) * maxDv;
    this.value += this.velocity * dt;
    if (Math.abs(target - this.value) < 1e-4 && Math.abs(this.velocity) < 1e-3) {
      this.value = target;
      this.velocity = 0;
    }
    return this.value;
  }

  reset(v: number): void {
    this.value = v;
    this.velocity = 0;
  }
}

/**
 * Swept tube with a per-ring radius, using parallel transport so a curved
 * trunk or hydraulic hose does not twist. Optionally writes vertex colours.
 */
export function taperedTube(
  spine: THREE.Vector3[],
  radii: number[],
  radial = 10,
  capEnds = true,
): THREE.BufferGeometry {
  const n = spine.length;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];

  const tangents: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const t = new THREE.Vector3();
    if (i === 0) t.copy(spine[1]).sub(spine[0]);
    else if (i === n - 1) t.copy(spine[n - 1]).sub(spine[n - 2]);
    else t.copy(spine[i + 1]).sub(spine[i - 1]);
    if (t.lengthSq() < 1e-12) t.set(0, 1, 0);
    tangents.push(t.normalize());
  }

  let normal = new THREE.Vector3(1, 0, 0);
  if (Math.abs(tangents[0].dot(normal)) > 0.9) normal.set(0, 0, 1);
  normal.crossVectors(tangents[0], normal).normalize();

  let vlen = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      const rot = new THREE.Quaternion().setFromUnitVectors(tangents[i - 1], tangents[i]);
      normal = normal.clone().applyQuaternion(rot).normalize();
      vlen += spine[i].distanceTo(spine[i - 1]);
    }
    const binormal = new THREE.Vector3().crossVectors(tangents[i], normal).normalize();
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const dir = normal
        .clone()
        .multiplyScalar(Math.cos(a))
        .addScaledVector(binormal, Math.sin(a));
      const p = spine[i].clone().addScaledVector(dir, radii[i]);
      pos.push(p.x, p.y, p.z);
      uv.push(j / radial, vlen);
    }
  }

  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = a + radial + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();

  if (capEnds) {
    const caps: THREE.BufferGeometry[] = [];
    for (const [ringIndex, flip] of [
      [0, true],
      [n - 1, false],
    ] as [number, boolean][]) {
      const disc = new THREE.CircleGeometry(radii[ringIndex], radial);
      const q = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        flip ? tangents[ringIndex].clone().negate() : tangents[ringIndex],
      );
      disc.applyQuaternion(q);
      disc.translate(spine[ringIndex].x, spine[ringIndex].y, spine[ringIndex].z);
      caps.push(disc);
    }
    return mergeSimple([g, ...caps]);
  }
  return g;
}

/**
 * Minimal geometry merge (position/normal/uv/color only) so we do not pull in
 * the full BufferGeometryUtils dependency for the handful of merges we do.
 */
export function mergeSimple(geoms: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const wantColor = geoms.some((g) => g.getAttribute('color'));
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  let offset = 0;

  for (const g of geoms) {
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    let nAttr = g.getAttribute('normal') as THREE.BufferAttribute | undefined;
    if (!nAttr) {
      g.computeVertexNormals();
      nAttr = g.getAttribute('normal') as THREE.BufferAttribute;
    }
    const uAttr = g.getAttribute('uv') as THREE.BufferAttribute | undefined;
    const cAttr = g.getAttribute('color') as THREE.BufferAttribute | undefined;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(nAttr.getX(i), nAttr.getY(i), nAttr.getZ(i));
      uv.push(uAttr ? uAttr.getX(i) : 0, uAttr ? uAttr.getY(i) : 0);
      if (wantColor) col.push(cAttr ? cAttr.getX(i) : 1, cAttr ? cAttr.getY(i) : 1, cAttr ? cAttr.getZ(i) : 1);
    }
    const index = g.getIndex();
    if (index) {
      for (let i = 0; i < index.count; i++) idx.push(index.getX(i) + offset);
    } else {
      for (let i = 0; i < p.count; i++) idx.push(i + offset);
    }
    offset += p.count;
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (wantColor) out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setIndex(idx);
  return out;
}
