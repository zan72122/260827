import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  RingGeometry,
  Vector3,
} from 'three';
import type { MaterialLibrary } from '../materials/MaterialLibrary';
import type { QualityProfile } from '../core/AdaptiveQuality';
import { Rng } from '../core/Rng';
import { clamp, damp } from '../core/math';

interface Chip {
  pos: Vector3;
  vel: Vector3;
  spin: Vector3;
  life: number;
  maxLife: number;
  scale: number;
}

/**
 * The steel receiver in the middle of the plaza.
 *
 * This is where the lift stops being about the sky and starts being about the
 * ground: plate thickness, the centring spike, the guide plates that funnel the
 * butt in, the anchor bolts that take the load into the foundation, and three
 * jaws that close once the stem is fully seated.
 */
export class BaseSocket {
  readonly group = new Group();
  readonly socketRadius: number;
  readonly rimHeight = 1.05;

  private readonly jaws: Object3D[] = [];
  private readonly chips: Chip[] = [];
  private readonly chipMesh: InstancedMesh;
  private readonly dust: Mesh;
  private readonly dustMaterial: MeshStandardMaterial;
  private readonly rng = new Rng(4242);
  private readonly tmpM = new Matrix4();
  private readonly tmpQ = new Quaternion();
  private readonly tmpS = new Vector3();
  private dustLife = 0;
  private clamp = 0;

  constructor(materials: MaterialLibrary, profile: QualityProfile, buttRadius: number, position: Vector3) {
    this.group.position.copy(position);
    this.socketRadius = buttRadius * 1.14;

    const shadow = profile.shadows;
    const add = (geo: BoxGeometry | CylinderGeometry | RingGeometry, mat: MeshStandardMaterial, x = 0, y = 0, z = 0) => {
      const m = new Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = shadow;
      m.receiveShadow = true;
      this.group.add(m);
      return m;
    };

    // Foundation: a concrete block cast under the paving, its top ring visible.
    add(new CylinderGeometry(2.6, 2.9, 0.5, 28), materials.concrete, 0, -0.2, 0);
    // Base plate, 60 mm of steel — the thickness is meant to be read.
    add(new CylinderGeometry(2.1, 2.1, 0.06, 28), materials.galvanised, 0, 0.08, 0);
    // Ribs carrying the socket wall into the plate.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const rib = add(new BoxGeometry(1.5, 0.7, 0.08), materials.galvanised, Math.cos(a) * 1.15, 0.46, Math.sin(a) * 1.15);
      rib.rotation.y = -a;
    }
    // Socket wall.
    add(new CylinderGeometry(this.socketRadius + 0.06, this.socketRadius + 0.06, this.rimHeight, 24), materials.galvanised, 0, 0.11 + this.rimHeight / 2, 0);
    // Centring spike: the stem is drilled to drop over it.
    add(new CylinderGeometry(0.055, 0.075, 0.85, 12), materials.galvanised, 0, 0.55, 0);
    // Flared guide plates funnel the butt into the socket on the way down.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const plate = new Mesh(new BoxGeometry(0.7, 0.62, 0.035), materials.galvanised);
      plate.position.set(Math.cos(a) * (this.socketRadius + 0.24), 1.42, Math.sin(a) * (this.socketRadius + 0.24));
      plate.rotation.set(0.42, -a, 0);
      plate.castShadow = shadow;
      this.group.add(plate);
    }
    // Anchor bolts into the foundation.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      add(new CylinderGeometry(0.055, 0.055, 0.22, 8), materials.galvanised, Math.cos(a) * 1.8, 0.19, Math.sin(a) * 1.8);
    }
    // Three hinged jaws close on the stem once it is down.
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const hinge = new Object3D();
      hinge.position.set(Math.cos(a) * (this.socketRadius + 0.08), 0.95, Math.sin(a) * (this.socketRadius + 0.08));
      hinge.rotation.y = -a;
      const jaw = new Mesh(new BoxGeometry(0.5, 0.16, 0.34), materials.galvanised);
      jaw.position.set(-0.25, 0, 0);
      jaw.castShadow = shadow;
      hinge.add(jaw);
      this.group.add(hinge);
      this.jaws.push(hinge);
    }

    // Bark chips knocked loose on touchdown.
    const chipCount = Math.max(24, Math.round(profile.particles * 0.35));
    this.chipMesh = new InstancedMesh(new BoxGeometry(0.06, 0.02, 0.035), materials.limbBark, chipCount);
    this.chipMesh.frustumCulled = false;
    this.chipMesh.count = 0;
    this.group.add(this.chipMesh);
    for (let i = 0; i < chipCount; i++) {
      this.chips.push({
        pos: new Vector3(),
        vel: new Vector3(),
        spin: new Vector3(),
        life: 0,
        maxLife: 1,
        scale: 1,
      });
    }

    // A low ring of disturbed dust, expanding once and fading out.
    this.dustMaterial = new MeshStandardMaterial({
      color: 0x8d8579,
      transparent: true,
      opacity: 0,
      roughness: 1,
      depthWrite: false,
    });
    this.dust = new Mesh(new RingGeometry(0.4, 1.5, 24), this.dustMaterial);
    this.dust.rotation.x = -Math.PI / 2;
    this.dust.position.y = 0.06;
    this.group.add(this.dust);
  }

  /** 0 = open, 1 = jaws clamped on the stem. */
  setClamp(v: number): void {
    this.clamp = clamp(v, 0, 1);
  }

  get clampAmount(): number {
    return this.clamp;
  }

  /** Called once on touchdown. */
  impact(strength: number): void {
    this.dustLife = 1;
    const n = Math.min(this.chips.length, Math.round(10 + strength * 18));
    this.chipMesh.count = this.chips.length;
    for (let i = 0; i < n; i++) {
      const chip = this.chips[i];
      const a = this.rng.range(0, Math.PI * 2);
      const r = this.socketRadius * this.rng.range(0.7, 1.05);
      chip.pos.set(Math.cos(a) * r, this.rimHeight * this.rng.range(0.4, 1.0), Math.sin(a) * r);
      chip.vel.set(Math.cos(a) * this.rng.range(0.6, 2.2), this.rng.range(0.8, 2.6), Math.sin(a) * this.rng.range(0.6, 2.2));
      chip.spin.set(this.rng.range(-8, 8), this.rng.range(-8, 8), this.rng.range(-8, 8));
      chip.maxLife = this.rng.range(0.8, 1.7);
      chip.life = chip.maxLife;
      chip.scale = this.rng.range(0.6, 1.6);
    }
  }

  update(dt: number): void {
    for (const hinge of this.jaws) hinge.rotation.z = -this.clamp * 1.15;

    let active = false;
    for (let i = 0; i < this.chips.length; i++) {
      const chip = this.chips[i];
      if (chip.life <= 0) {
        this.tmpM.makeScale(0, 0, 0);
        this.chipMesh.setMatrixAt(i, this.tmpM);
        continue;
      }
      active = true;
      chip.life -= dt;
      chip.vel.y -= 9.81 * dt;
      chip.pos.addScaledVector(chip.vel, dt);
      if (chip.pos.y < 0.03) {
        chip.pos.y = 0.03;
        chip.vel.y *= -0.28;
        chip.vel.x *= 0.6;
        chip.vel.z *= 0.6;
        chip.spin.multiplyScalar(0.5);
      }
      const t = clamp(chip.life / chip.maxLife, 0, 1);
      this.tmpQ.setFromAxisAngle(
        new Vector3(chip.spin.x, chip.spin.y, chip.spin.z).normalize(),
        (chip.maxLife - chip.life) * 4,
      );
      this.tmpS.setScalar(chip.scale * (0.4 + t * 0.6));
      this.tmpM.compose(chip.pos, this.tmpQ, this.tmpS);
      this.chipMesh.setMatrixAt(i, this.tmpM);
    }
    if (active) this.chipMesh.instanceMatrix.needsUpdate = true;
    else this.chipMesh.count = 0;

    if (this.dustLife > 0) {
      this.dustLife = Math.max(0, this.dustLife - dt * 0.8);
      const t = this.dustLife;
      this.dustMaterial.opacity = t * 0.34;
      const s = 1 + (1 - t) * 1.6;
      this.dust.scale.setScalar(s);
    } else {
      this.dustMaterial.opacity = damp(this.dustMaterial.opacity, 0, 6, dt);
    }
  }
}
