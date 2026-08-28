import * as THREE from 'three';
import { Rng } from '../core/rng';
import { canvas2d, fbm } from '../core/textures';
import type { DestinationId } from '../types';
import type { MaterialLibrary } from './materials';

const BOARD_W = 3.1;
const BOARD_H = 1.8;
const MAX_LAMPS = 12;

/**
 * A painted board on the wall with real little lamps set into it and a miniature
 * vehicle that crawls a groove to the destination. No neon arcs in the air.
 */
export class PhysicalWorldMap {
  readonly group = new THREE.Group();

  private lampLenses: THREE.InstancedMesh;
  private lampHousings: THREE.InstancedMesh;
  private lampIndex = new Map<DestinationId, number>();
  private lampOn = new Map<DestinationId, number>();
  private lampTarget = new Map<DestinationId, number>();
  private lampPos = new Map<DestinationId, THREE.Vector3>();
  private keptMarkers = new Map<DestinationId, THREE.Mesh>();

  private vehicle: THREE.Group;
  private vehicleCurve: THREE.CatmullRomCurve3 | null = null;
  private vehicleT = 1;
  private vehicleSpeed = 0.32;
  private originPoint = new THREE.Vector3(-0.95, -0.05, 0.03);
  private tmpColor = new THREE.Color();
  private tmpVec = new THREE.Vector3();
  private mats: MaterialLibrary;

  constructor(mats: MaterialLibrary) {
    this.mats = mats;

    const frameGeo = new THREE.BoxGeometry(BOARD_W + 0.12, BOARD_H + 0.12, 0.06);
    const frame = new THREE.Mesh(frameGeo, mats.woodDark);
    frame.position.z = -0.02;
    frame.castShadow = true;
    this.group.add(frame);

    const board = new THREE.Mesh(
      new THREE.BoxGeometry(BOARD_W, BOARD_H, 0.03),
      new THREE.MeshStandardMaterial({ map: makeBoardTexture(), roughness: 0.86, metalness: 0.02 }),
    );
    board.position.z = 0.012;
    board.receiveShadow = true;
    this.group.add(board);

    // brass rails top and bottom, the way a workroom chart is hung
    for (const y of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, BOARD_W + 0.16, 10), mats.brass);
      rail.rotation.z = Math.PI / 2;
      rail.position.set(0, y * (BOARD_H / 2 + 0.06), 0.02);
      this.group.add(rail);
    }

    const lensGeo = new THREE.SphereGeometry(0.021, 12, 8);
    const lensMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.lampLenses = new THREE.InstancedMesh(lensGeo, lensMat, MAX_LAMPS);
    this.lampLenses.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_LAMPS * 3), 3);
    this.lampLenses.frustumCulled = false;
    this.group.add(this.lampLenses);

    const housingGeo = new THREE.CylinderGeometry(0.03, 0.034, 0.026, 12);
    this.lampHousings = new THREE.InstancedMesh(housingGeo, mats.brass, MAX_LAMPS);
    this.lampHousings.frustumCulled = false;
    this.group.add(this.lampHousings);

    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < MAX_LAMPS; i++) {
      this.lampLenses.setMatrixAt(i, hidden);
      this.lampHousings.setMatrixAt(i, hidden);
    }

    this.vehicle = buildMiniVehicle(mats);
    this.vehicle.visible = false;
    this.group.add(this.vehicle);

    // the central office marker: a small brass building on the board
    const office = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.03), mats.brass);
    office.position.copy(this.originPoint).setZ(0.04);
    this.group.add(office);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.035, 4), mats.paintedRed);
    roof.rotation.y = Math.PI / 4;
    roof.position.copy(office.position).add(new THREE.Vector3(0, 0.042, 0));
    this.group.add(roof);
  }

  /** Register a destination lamp at its board position; called as routes are opened. */
  addLamp(id: DestinationId, uv: [number, number]): void {
    if (this.lampIndex.has(id)) return;
    const i = this.lampIndex.size;
    if (i >= MAX_LAMPS) return;
    this.lampIndex.set(id, i);
    this.lampOn.set(id, 0);
    this.lampTarget.set(id, 0);

    const p = new THREE.Vector3((uv[0] - 0.5) * BOARD_W * 0.92, (uv[1] - 0.5) * BOARD_H * 0.86, 0.03);
    this.lampPos.set(id, p);

    const m = new THREE.Matrix4();
    m.makeTranslation(p.x, p.y, p.z + 0.016);
    this.lampLenses.setMatrixAt(i, m);
    this.lampLenses.instanceMatrix.needsUpdate = true;

    const hm = new THREE.Matrix4();
    hm.makeRotationX(Math.PI / 2);
    hm.setPosition(p.x, p.y, p.z + 0.004);
    this.lampHousings.setMatrixAt(i, hm);
    this.lampHousings.instanceMatrix.needsUpdate = true;

    this.setLamp(id, 0);
  }

  private setLamp(id: DestinationId, v: number): void {
    const i = this.lampIndex.get(id);
    if (i === undefined || !this.lampLenses.instanceColor) return;
    // off is a dull unlit bulb; on is a warm filament, not a neon sign
    this.tmpColor.setRGB(0.09 + v * 0.95, 0.08 + v * 0.72, 0.07 + v * 0.35);
    this.lampLenses.setColorAt(i, this.tmpColor);
    this.lampLenses.instanceColor.needsUpdate = true;
  }

  /** Drive the miniature vehicle along the board, then light the lamp. */
  routeTo(id: DestinationId): void {
    const to = this.lampPos.get(id);
    if (!to) return;
    const from = this.originPoint;
    const mid = from.clone().lerp(to, 0.5);
    mid.y += 0.16;
    mid.z = 0.05;
    this.vehicleCurve = new THREE.CatmullRomCurve3([
      from.clone().setZ(0.05),
      mid,
      to.clone().setZ(0.05),
    ]);
    this.vehicleT = 0;
    this.vehicle.visible = true;
    this.lampTarget.set(id, 1);
  }

  /** Mail kept for Christmas gets a small held marker instead of a lit lamp. */
  markKept(id: DestinationId): void {
    if (this.keptMarkers.has(id)) return;
    const p = this.lampPos.get(id);
    if (!p) return;
    const shape = new THREE.Shape();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 === 0 ? 0.028 : 0.013;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    shape.closePath();
    const star = new THREE.Mesh(
      new THREE.ExtrudeGeometry(shape, { depth: 0.006, bevelEnabled: false }),
      this.mats.paintedBlue,
    );
    star.position.set(p.x + 0.055, p.y + 0.045, 0.035);
    this.group.add(star);
    this.keptMarkers.set(id, star);
  }

  isLit(id: DestinationId): boolean {
    return (this.lampOn.get(id) ?? 0) > 0.7;
  }

  update(dt: number): void {
    for (const [id, target] of this.lampTarget) {
      const cur = this.lampOn.get(id) ?? 0;
      if (Math.abs(cur - target) < 0.002) continue;
      // filaments warm up, they do not snap on
      const next = cur + (target - cur) * Math.min(1, dt * 2.2);
      this.lampOn.set(id, next);
      this.setLamp(id, next);
    }

    if (this.vehicleCurve && this.vehicleT < 1) {
      this.vehicleT = Math.min(1, this.vehicleT + dt * this.vehicleSpeed);
      this.vehicleCurve.getPoint(this.vehicleT, this.tmpVec);
      this.vehicle.position.copy(this.tmpVec);
      const tan = this.vehicleCurve.getTangent(this.vehicleT, new THREE.Vector3());
      this.vehicle.rotation.z = Math.atan2(tan.y, tan.x);
      if (this.vehicleT >= 1) this.vehicle.visible = false;
    }
  }
}

function buildMiniVehicle(mats: MaterialLibrary): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.026, 0.024), mats.paintedRed);
  g.add(body);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.016, 0.022), mats.paintedCream);
  cab.position.set(0.016, 0.019, 0);
  g.add(cab);
  for (const x of [-0.016, 0.016]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.028, 8), mats.steelPainted);
    w.rotation.x = Math.PI / 2;
    w.position.set(x, -0.012, 0);
    g.add(w);
  }
  return g;
}

/** Abstract painted landmasses - invented shapes, no real geography, no place names. */
function makeBoardTexture(): THREE.CanvasTexture {
  const W = 1024;
  const H = 594;
  const [c, ctx] = canvas2d(W, H);
  const rng = new Rng(4242);
  const noise = fbm(rng, 4, 5);

  const base = ctx.createLinearGradient(0, 0, 0, H);
  base.addColorStop(0, '#9aa8a2');
  base.addColorStop(0.5, '#a8b1ab');
  base.addColorStop(1, '#93a09a');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);

  // paper mottle
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const n = noise(x / W * 3, y / H * 3);
      const i = (y * W + x) * 4;
      const k = 1 + (n - 0.5) * 0.16;
      d[i] *= k;
      d[i + 1] *= k;
      d[i + 2] *= k;
    }
  }
  ctx.putImageData(img, 0, 0);

  // invented landmasses
  const blobs: [number, number, number, number][] = [
    [0.2, 0.62, 0.16, 0.2],
    [0.44, 0.5, 0.2, 0.26],
    [0.68, 0.55, 0.15, 0.22],
    [0.6, 0.2, 0.22, 0.14],
    [0.5, 0.8, 0.18, 0.14],
    [0.86, 0.34, 0.1, 0.16],
  ];
  for (const [cx, cy, rx, ry] of blobs) {
    ctx.beginPath();
    const steps = 42;
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const wob = 0.72 + noise(Math.cos(a) * 0.5 + cx, Math.sin(a) * 0.5 + cy) * 0.6;
      const x = (cx + Math.cos(a) * rx * wob) * W;
      const y = (cy + Math.sin(a) * ry * wob) * H;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = '#c0bf98';
    ctx.fill();
    ctx.strokeStyle = 'rgba(58,58,44,0.5)';
    ctx.lineWidth = 2.4;
    ctx.stroke();
  }

  // graticule
  ctx.strokeStyle = 'rgba(40,48,52,0.22)';
  ctx.lineWidth = 1.4;
  for (let i = 1; i < 8; i++) {
    ctx.beginPath();
    ctx.moveTo((i / 8) * W, 0);
    ctx.lineTo((i / 8) * W, H);
    ctx.stroke();
  }
  for (let i = 1; i < 5; i++) {
    ctx.beginPath();
    ctx.moveTo(0, (i / 5) * H);
    ctx.lineTo(W, (i / 5) * H);
    ctx.stroke();
  }

  // routes engraved as shallow grooves, unlit until a bag actually goes out
  ctx.strokeStyle = 'rgba(52,44,34,0.4)';
  ctx.setLineDash([9, 8]);
  ctx.lineWidth = 2.6;
  const office: [number, number] = [0.19, 0.53];
  for (const [tx, ty] of [
    [0.35, 0.66],
    [0.6, 0.42],
    [0.46, 0.55],
    [0.76, 0.56],
    [0.55, 0.78],
    [0.68, 0.22],
  ] as [number, number][]) {
    ctx.beginPath();
    ctx.moveTo(office[0] * W, (1 - office[1]) * H);
    ctx.quadraticCurveTo(
      ((office[0] + tx) / 2) * W,
      (1 - (office[1] + ty) / 2 - 0.09) * H,
      tx * W,
      (1 - ty) * H,
    );
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // wear from years of hands
  ctx.globalAlpha = 0.1;
  ctx.fillStyle = '#3a3128';
  for (let i = 0; i < 40; i++) {
    ctx.beginPath();
    ctx.ellipse(rng.range(0, W), rng.range(0, H), rng.range(6, 40), rng.range(4, 22), rng.range(0, 3), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
