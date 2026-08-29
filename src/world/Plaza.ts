import {
  BoxGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
import type { MaterialLibrary } from '../materials/MaterialLibrary';
import type { QualityProfile } from '../core/AdaptiveQuality';
import { Rng } from '../core/Rng';
import { clamp, lerp, smoothstep } from '../core/math';

/**
 * The square itself: an invented civic plaza, not a copy of any real one.
 *
 * Everything is arranged so the tree can be read against something: the
 * buildings give vertical lines to judge plumb by, the fence gives the work
 * area a size, the paving gives the crane outriggers something to bear on.
 */
export class Plaza {
  readonly group = new Group();
  readonly center = new Vector3(0, 0, 0);
  readonly fenceRadius = 22;

  private readonly windows: InstancedMesh;
  private readonly windowOrder: number[] = [];
  private readonly crowdBody: InstancedMesh;
  private readonly crowdHead: InstancedMesh;
  private readonly crowdBase: Matrix4[] = [];
  private readonly lampHeadMaterial: MeshStandardMaterial;
  private readonly windowMaterial: MeshStandardMaterial;
  private readonly tmpM = new Matrix4();
  private readonly tmpQ = new Quaternion();
  private readonly tmpV = new Vector3();
  private readonly tmpS = new Vector3(1, 1, 1);
  private crowdShown = 0;
  private crowdTotal: number;

  constructor(materials: MaterialLibrary, profile: QualityProfile) {
    const rng = new Rng(2025);

    // ---- ground ----------------------------------------------------------
    const ground = new Mesh(new PlaneGeometry(220, 220, 1, 1), materials.paving);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.group.add(ground);

    // A darker granite band rings the tree platform, flush with the setts.
    const ring = new Mesh(new RingGeometry(5.7, 6.6, 56), materials.granite);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    ring.receiveShadow = true;
    this.group.add(ring);

    // ---- buildings -------------------------------------------------------
    const facadeWindows: Vector3[] = [];
    const windowNormals: number[] = [];
    const blockCount = 16;
    for (let i = 0; i < blockCount; i++) {
      const a = (i / blockCount) * Math.PI * 2 + rng.jitter(0.06);
      const dist = rng.range(52, 74);
      const w = rng.range(16, 30);
      const d = rng.range(14, 26);
      const h = rng.range(18, 46);
      const b = new Mesh(new BoxGeometry(w, h, d), materials.facadeAlt[i % materials.facadeAlt.length]);
      b.position.set(Math.cos(a) * dist, h / 2, Math.sin(a) * dist);
      b.rotation.y = -a + rng.jitter(0.15);
      b.castShadow = false;
      b.receiveShadow = false;
      this.group.add(b);

      // Parapet and plant room, so the skyline is not a row of clean boxes.
      const cap = new Mesh(new BoxGeometry(w * 0.98, 0.7, d * 0.98), materials.concrete);
      cap.position.copy(b.position).setY(h + 0.35);
      cap.rotation.y = b.rotation.y;
      this.group.add(cap);
      if (rng.chance(0.6)) {
        const plant = new Mesh(new BoxGeometry(w * 0.3, 2.4, d * 0.3), materials.concrete);
        plant.position.copy(b.position).setY(h + 1.5);
        plant.rotation.y = b.rotation.y;
        this.group.add(plant);
      }

      // Window positions on the plaza-facing wall.
      const rows = Math.floor(h / 3.4);
      const cols = Math.floor(w / 3.2);
      const inward = new Vector3(-Math.cos(a), 0, -Math.sin(a));
      for (let r = 1; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (!rng.chance(0.55)) continue;
          const local = new Vector3((c - (cols - 1) / 2) * 3.2, r * 3.4, 0);
          const rot = -b.rotation.y;
          const x = local.x * Math.cos(rot) - local.z * Math.sin(rot);
          const z = local.x * Math.sin(rot) + local.z * Math.cos(rot);
          const p = new Vector3(b.position.x + x, local.y, b.position.z + z).addScaledVector(
            inward,
            d / 2 + 0.06,
          );
          facadeWindows.push(p);
          windowNormals.push(Math.atan2(inward.x, inward.z));
        }
      }
    }

    // ---- window lights ---------------------------------------------------
    this.windowMaterial = new MeshStandardMaterial({
      color: 0x1a1c22,
      emissive: new Color(0xffcf8a),
      emissiveIntensity: 0,
      roughness: 0.6,
      metalness: 0,
    });
    const windowCount = Math.min(facadeWindows.length, profile.tier === 'low' ? 260 : 520);
    this.windows = new InstancedMesh(new PlaneGeometry(1.5, 2.0), this.windowMaterial, windowCount);
    this.windows.count = 0;
    this.windows.frustumCulled = false;
    for (let i = 0; i < windowCount; i++) {
      this.tmpQ.setFromAxisAngle(new Vector3(0, 1, 0), windowNormals[i]);
      this.tmpM.compose(facadeWindows[i], this.tmpQ, this.tmpS);
      this.windows.setMatrixAt(i, this.tmpM);
      this.windowOrder.push(i);
    }
    this.windows.instanceMatrix.needsUpdate = true;
    this.group.add(this.windows);

    // ---- street lamps and bollards ---------------------------------------
    this.lampHeadMaterial = new MeshStandardMaterial({
      color: 0x2b2e33,
      emissive: new Color(0xffd9a8),
      emissiveIntensity: 0,
      roughness: 0.5,
      metalness: 0.4,
    });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + 0.3;
      const r = 31 + rng.range(-1.5, 1.5);
      const pole = new Mesh(new CylinderGeometry(0.07, 0.1, 6.6, 8), materials.craneDark);
      pole.position.set(Math.cos(a) * r, 3.3, Math.sin(a) * r);
      pole.castShadow = profile.shadows;
      this.group.add(pole);
      const head = new Mesh(new BoxGeometry(0.6, 0.16, 0.34), this.lampHeadMaterial);
      head.position.copy(pole.position).setY(6.6);
      this.group.add(head);
    }

    // ---- safety fence ----------------------------------------------------
    // Panels are butted, not spaced: the fence has to read as a closed line.
    const panelCount = Math.round((Math.PI * 2 * this.fenceRadius) / 2.45);
    const panel = new BoxGeometry(2.42, 1.1, 0.04);
    const fence = new InstancedMesh(panel, materials.fenceMesh, panelCount);
    const rail = new InstancedMesh(new BoxGeometry(2.42, 0.08, 0.08), materials.galvanised, panelCount * 2);
    const feet = new InstancedMesh(new BoxGeometry(0.7, 0.1, 0.34), materials.matPlate, panelCount);
    for (let i = 0; i < panelCount; i++) {
      const a = (i / panelCount) * Math.PI * 2;
      const p = new Vector3(Math.cos(a) * this.fenceRadius, 1.05, Math.sin(a) * this.fenceRadius);
      this.tmpQ.setFromAxisAngle(new Vector3(0, 1, 0), -a + Math.PI / 2);
      this.tmpM.compose(p, this.tmpQ, this.tmpS);
      fence.setMatrixAt(i, this.tmpM);
      this.tmpM.compose(p.clone().setY(1.62), this.tmpQ, this.tmpS);
      rail.setMatrixAt(i * 2, this.tmpM);
      this.tmpM.compose(p.clone().setY(0.5), this.tmpQ, this.tmpS);
      rail.setMatrixAt(i * 2 + 1, this.tmpM);
      this.tmpM.compose(p.clone().setY(0.05), this.tmpQ, this.tmpS);
      feet.setMatrixAt(i, this.tmpM);
    }
    fence.instanceMatrix.needsUpdate = true;
    rail.instanceMatrix.needsUpdate = true;
    feet.instanceMatrix.needsUpdate = true;
    fence.castShadow = profile.shadows;
    this.group.add(fence, rail, feet);

    // ---- spectators ------------------------------------------------------
    this.crowdTotal = profile.crowdCount;
    this.crowdBody = new InstancedMesh(new CapsuleGeometry(0.24, 0.85, 4, 7), materials.crowdCoat, this.crowdTotal);
    this.crowdHead = new InstancedMesh(new SphereGeometry(0.15, 6, 5), materials.crowdCoat, this.crowdTotal);
    this.crowdBody.count = 0;
    this.crowdHead.count = 0;
    this.crowdBody.frustumCulled = false;
    this.crowdHead.frustumCulled = false;
    const coatColors = [0x2b3340, 0x4a3a34, 0x33403a, 0x5a4650, 0x24303c, 0x6a5b48];
    for (let i = 0; i < this.crowdTotal; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = this.fenceRadius + rng.range(1.4, 9.5);
      const p = new Vector3(Math.cos(a) * r, 0.95 + rng.range(-0.06, 0.1), Math.sin(a) * r);
      this.tmpQ.setFromAxisAngle(new Vector3(0, 1, 0), -a + Math.PI + rng.jitter(0.5));
      const scale = rng.range(0.86, 1.12);
      this.tmpS.setScalar(scale);
      this.tmpM.compose(p, this.tmpQ, this.tmpS);
      this.crowdBase.push(this.tmpM.clone());
      this.crowdBody.setMatrixAt(i, this.tmpM);
      this.tmpM.compose(p.clone().setY(p.y + 0.72 * scale), this.tmpQ, this.tmpS);
      this.crowdHead.setMatrixAt(i, this.tmpM);
      const c = new Color(coatColors[i % coatColors.length]).multiplyScalar(rng.range(0.8, 1.2));
      this.crowdBody.setColorAt(i, c);
      this.crowdHead.setColorAt(i, c.clone().lerp(new Color(0x8a6a58), 0.7));
      this.tmpS.setScalar(1);
    }
    this.crowdBody.instanceMatrix.needsUpdate = true;
    this.crowdHead.instanceMatrix.needsUpdate = true;
    this.group.add(this.crowdBody, this.crowdHead);
  }

  /** Spectators gather as the afternoon goes on. */
  setCrowdFill(fill: number): void {
    const target = Math.round(clamp(fill, 0, 1) * this.crowdTotal);
    if (target === this.crowdShown) return;
    this.crowdShown = target;
    this.crowdBody.count = target;
    this.crowdHead.count = target;
  }

  /** Windows come on gradually, then the street lights at dusk. */
  setEvening(t: number): void {
    const lit = smoothstep((t - 0.42) / 0.5);
    this.windows.count = Math.round(lit * this.windowOrder.length);
    this.windowMaterial.emissiveIntensity = lerp(0.2, 2.6, lit);
    this.lampHeadMaterial.emissiveIntensity = smoothstep((t - 0.62) / 0.2) * 3.4;
  }

  /** Cheap crowd life: a slow shuffle so the far ring is not a field of posts. */
  animateCrowd(time: number): void {
    const n = this.crowdBody.count;
    if (!n) return;
    for (let i = 0; i < n; i += 3) {
      const base = this.crowdBase[i];
      base.decompose(this.tmpV, this.tmpQ, this.tmpS);
      const bob = Math.sin(time * 1.2 + i * 0.7) * 0.02;
      this.tmpV.y += bob;
      this.tmpM.compose(this.tmpV, this.tmpQ, this.tmpS);
      this.crowdBody.setMatrixAt(i, this.tmpM);
      this.tmpV.y += 0.72 * this.tmpS.x;
      this.tmpM.compose(this.tmpV, this.tmpQ, this.tmpS);
      this.crowdHead.setMatrixAt(i, this.tmpM);
    }
    this.crowdBody.instanceMatrix.needsUpdate = true;
    this.crowdHead.instanceMatrix.needsUpdate = true;
  }
}
