import * as THREE from 'three';
import type { Quality } from '../core/quality';

// Burial machine at the touchdown point: a tracked cable plough / ROV with
// work lights and a short-lived sediment plume while it cuts the trench in
// soft sand. Over rock it lifts its share and the cable is surface-laid.
export class Rov {
  readonly group = new THREE.Group();
  private body: THREE.Group;
  private tracksSpin: THREE.Mesh[] = [];
  private lightCones: THREE.Mesh[] = [];
  private workLight: THREE.PointLight;
  private sediment: THREE.Points;
  private sedPos: Float32Array;
  private sedVel: Float32Array;
  private sedLife: Float32Array;
  private sedCount: number;
  private emitting = false;
  private lift = 0; // 0 = ploughing, 1 = lifted over rock

  constructor(quality: Quality) {
    this.body = new THREE.Group();
    const hull = new THREE.MeshStandardMaterial({ color: 0xd9c02a, roughness: 0.5, metalness: 0.3 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.85 });

    const frame = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.1, 2.0), hull);
    frame.position.y = 1.0;
    this.body.add(frame);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.7, 1.4), hull);
    cabin.position.set(-0.5, 1.9, 0);
    this.body.add(cabin);
    for (const s of [-1, 1]) {
      const track = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.8, 0.55), dark);
      track.position.set(0, 0.4, s * 1.05);
      this.body.add(track);
      this.tracksSpin.push(track);
    }
    // Cable guide arch at the rear: the cable runs beneath it into the share.
    const arch = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.09, 8, 12, Math.PI), new THREE.MeshStandardMaterial({
      color: 0x8f979c, roughness: 0.4, metalness: 0.6
    }));
    arch.position.set(1.5, 0.9, 0);
    arch.rotation.y = Math.PI / 2;
    this.body.add(arch);
    // Plough share cutting downward.
    const share = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.2, 6), new THREE.MeshStandardMaterial({
      color: 0x6d6d6d, roughness: 0.5, metalness: 0.6
    }));
    share.rotation.z = Math.PI;
    share.position.set(1.9, 0.15, 0);
    this.body.add(share);

    // Work lights: emissive cones + one real point light (kept local & cheap).
    const coneMat = new THREE.MeshBasicMaterial({
      color: 0xfff2c0, transparent: true, opacity: 0.16, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide
    });
    for (const s of [-1, 1]) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(1.4, 4.2, 12, 1, true), coneMat);
      cone.rotation.x = -Math.PI / 2 + 0.35;
      cone.position.set(-1.2 + 2.2, 1.6, s * 0.7);
      cone.rotation.z = -1.25;
      cone.position.x = 2.6;
      this.lightCones.push(cone);
      this.body.add(cone);
    }
    this.workLight = new THREE.PointLight(0xfff0c8, 55, 26, 2);
    this.workLight.position.set(1.4, 2.2, 0);
    this.body.add(this.workLight);

    this.group.add(this.body);

    // Sediment plume: pooled, short-lived, never an opaque smoke wall.
    this.sedCount = quality.sediment;
    this.sedPos = new Float32Array(this.sedCount * 3);
    this.sedVel = new Float32Array(this.sedCount * 3);
    this.sedLife = new Float32Array(this.sedCount);
    const geo = new THREE.BufferGeometry();
    const attr = new THREE.BufferAttribute(this.sedPos, 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', attr);
    const mat = new THREE.PointsMaterial({
      color: 0x9a8a68, size: 0.55, transparent: true, opacity: 0.4,
      depthWrite: false, sizeAttenuation: true
    });
    this.sediment = new THREE.Points(geo, mat);
    this.sediment.frustumCulled = false;
    this.sediment.visible = false;
    this.group.add(this.sediment);
    for (let i = 0; i < this.sedCount; i++) this.sedLife[i] = -1;
  }

  setVisible(v: boolean): void {
    this.group.visible = v;
  }

  /**
   * Place at the touchdown point. `onSand` = ploughing (share down, plume on);
   * over rock the machine lifts and stops disturbing the bottom.
   */
  place(pos: THREE.Vector3, tangent: THREE.Vector3, onSand: boolean, dt: number): void {
    const targetLift = onSand ? 0 : 1;
    this.lift += (targetLift - this.lift) * Math.min(1, dt * 2.5);
    this.body.position.set(0, this.lift * 1.6, 0);
    this.group.position.set(pos.x, pos.y - 0.3, pos.z);
    this.group.rotation.y = Math.atan2(-tangent.z, tangent.x);
    this.emitting = onSand;
    this.sediment.visible = true;
  }

  update(dt: number): void {
    if (!this.group.visible) return;
    // Track illusion: subtle bobbing.
    for (const t of this.tracksSpin) t.position.y = 0.4 + Math.sin(performance.now() * 0.004) * 0.02;

    // Sediment pool (positions are in the ROV's local frame near the share).
    let spawnBudget = this.emitting ? Math.max(1, Math.round(dt * 90)) : 0;
    for (let i = 0; i < this.sedCount; i++) {
      if (this.sedLife[i] < 0) {
        if (spawnBudget > 0) {
          spawnBudget--;
          this.sedLife[i] = 0.9 + Math.random() * 0.9; // short-lived
          this.sedPos[i * 3] = 1.8 + (Math.random() - 0.5) * 0.7;
          this.sedPos[i * 3 + 1] = 0.2;
          this.sedPos[i * 3 + 2] = (Math.random() - 0.5) * 0.9;
          this.sedVel[i * 3] = -(0.6 + Math.random() * 1.2);
          this.sedVel[i * 3 + 1] = 0.7 + Math.random() * 1.1;
          this.sedVel[i * 3 + 2] = (Math.random() - 0.5) * 1.2;
        } else {
          this.sedPos[i * 3 + 1] = -999; // parked out of sight
        }
        continue;
      }
      this.sedLife[i] -= dt;
      this.sedPos[i * 3] += this.sedVel[i * 3] * dt;
      this.sedPos[i * 3 + 1] += this.sedVel[i * 3 + 1] * dt;
      this.sedPos[i * 3 + 2] += this.sedVel[i * 3 + 2] * dt;
      this.sedVel[i * 3 + 1] *= 1 - dt * 0.8;
    }
    (this.sediment.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    const flicker = 0.92 + Math.sin(performance.now() * 0.02) * 0.08;
    this.workLight.intensity = 55 * flicker;
  }
}
