import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  ExtrudeGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import type { MaterialLibrary } from './materials';

/**
 * The sleigh, the adult handler, and the billboard puffs used for hoof spray,
 * runner spray and the horse's breath.
 */

// ------------------------------------------------------------- the sleigh --

export class Sleigh {
  /** carries position and heading */
  readonly group = new Group();
  /** carries pitch, so the slope tips the body and not the heading */
  readonly body = new Group();
  readonly seatAnchor = new Object3D();

  constructor(mats: MaterialLibrary) {
    this.group.add(this.body);
    const g = this.body;

    // Runner: a side profile swept across the runner's thickness. The front
    // curls up so it climbs over loose snow rather than digging in.
    const runner = new Shape();
    runner.moveTo(-1.05, 0.0);
    runner.lineTo(0.72, 0.0);
    runner.quadraticCurveTo(1.12, 0.02, 1.24, 0.3);
    runner.quadraticCurveTo(1.3, 0.52, 1.16, 0.62);
    runner.lineTo(1.06, 0.55);
    runner.quadraticCurveTo(1.16, 0.44, 1.1, 0.3);
    runner.quadraticCurveTo(0.99, 0.09, 0.7, 0.075);
    runner.lineTo(-1.05, 0.075);
    runner.closePath();

    for (const side of [-1, 1]) {
      const geo = new ExtrudeGeometry(runner, { depth: 0.045, bevelEnabled: false });
      geo.translate(0, 0, -0.0225);
      const m = new Mesh(geo, mats.steel);
      m.position.set(0, 0.03, side * 0.44);
      m.castShadow = true;
      g.add(m);

      // wooden runner beam sitting on the steel shoe
      const beam = new Mesh(new BoxGeometry(1.95, 0.06, 0.07), mats.wood);
      beam.position.set(-0.05, 0.115, side * 0.44);
      beam.castShadow = true;
      g.add(beam);

      // stanchions tying beam to body
      for (const x of [-0.72, -0.05, 0.62]) {
        const post = new Mesh(new BoxGeometry(0.055, 0.3, 0.055), mats.wood);
        post.position.set(x, 0.28, side * 0.44);
        post.castShadow = true;
        g.add(post);
      }
    }

    // Body: a cutter's swept side panel, extruded across the full width.
    const body = new Shape();
    body.moveTo(-0.95, 0);
    body.lineTo(0.5, 0);
    body.quadraticCurveTo(0.92, 0.02, 0.98, 0.36);
    body.quadraticCurveTo(1.0, 0.6, 0.78, 0.66);
    body.lineTo(0.62, 0.62);
    body.quadraticCurveTo(0.8, 0.55, 0.78, 0.36);
    body.quadraticCurveTo(0.72, 0.12, 0.44, 0.11);
    body.lineTo(-0.78, 0.11);
    body.lineTo(-0.78, 0.55);
    body.lineTo(-0.95, 0.55);
    body.closePath();

    for (const side of [-1, 1]) {
      const geo = new ExtrudeGeometry(body, { depth: 0.05, bevelEnabled: false });
      const m = new Mesh(geo, mats.wood);
      m.position.set(0, 0.42, side * 0.4 - side * 0.025);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    }

    const floor = new Mesh(new BoxGeometry(1.62, 0.05, 0.82), mats.woodDark);
    floor.position.set(-0.2, 0.46, 0);
    floor.castShadow = true;
    floor.receiveShadow = true;
    g.add(floor);

    const back = new Mesh(new BoxGeometry(0.07, 0.58, 0.84), mats.wood);
    back.position.set(-0.94, 0.75, 0);
    back.castShadow = true;
    g.add(back);

    const seat = new Mesh(new BoxGeometry(0.6, 0.1, 0.8), mats.woodDark);
    seat.position.set(-0.6, 0.72, 0);
    seat.castShadow = true;
    g.add(seat);

    const cushion = new Mesh(new BoxGeometry(0.58, 0.09, 0.76), mats.clothLight);
    cushion.position.set(-0.6, 0.81, 0);
    cushion.castShadow = true;
    g.add(cushion);

    // a folded wool rug over the front board
    const rug = new Mesh(new BoxGeometry(0.46, 0.12, 0.72), mats.cloth);
    rug.position.set(0.12, 0.55, 0);
    rug.rotation.z = -0.06;
    g.add(rug);

    // Shafts run forward to the horse's sides.
    for (const side of [-1, 1]) {
      const shaft = new Mesh(new CylinderGeometry(0.03, 0.04, 2.3, 6), mats.wood);
      shaft.rotation.z = Math.PI / 2;
      shaft.rotation.y = side * 0.05;
      shaft.position.set(1.4, 0.46, side * 0.42);
      shaft.castShadow = true;
      g.add(shaft);
      const tipRing = new Mesh(new TorusGeometry(0.045, 0.011, 5, 10), mats.iron);
      tipRing.position.set(2.5, 0.48, side * 0.48);
      tipRing.rotation.y = Math.PI / 2;
      g.add(tipRing);
    }

    // snow packed into the corners of the floor
    const snowPile = new Mesh(new SphereGeometry(0.2, 8, 5), mats.snow.clone());
    (snowPile.material as { map: unknown }).map = null;
    snowPile.scale.set(1.4, 0.28, 1.6);
    snowPile.position.set(-0.1, 0.48, 0);
    g.add(snowPile);

    this.seatAnchor.position.set(-0.62, 0.86, 0);
    g.add(this.seatAnchor);
  }

  addTo(parent: Object3D): void {
    parent.add(this.group);
  }
}

// ------------------------------------------------------------ the handler --

/**
 * The adult who does the parts of the job a four-year-old must not: leading
 * the horse, holding the strap up, buckling the harness, hitching the sleigh.
 * Deliberately simple - a coat, a hat and mittens, no face.
 */
export class Handler {
  readonly group = new Group();
  readonly leftArm = new Group();
  readonly rightArm = new Group();
  readonly leftHand = new Object3D();
  readonly rightHand = new Object3D();
  private legs = new Group();
  private upperBody = new Group();
  private time = 0;

  constructor(mats: MaterialLibrary) {
    const g = this.group;
    this.legs.position.y = 0.86;
    g.add(this.legs);
    g.add(this.upperBody);

    for (const side of [-1, 1]) {
      const boot = new Mesh(new BoxGeometry(0.12, 0.12, 0.24), mats.woodDark);
      boot.position.set(side * 0.1, -0.8, 0.03);
      boot.castShadow = true;
      this.legs.add(boot);
      const leg = new Mesh(new CylinderGeometry(0.068, 0.058, 0.78, 7), mats.cloth);
      leg.position.set(side * 0.1, -0.4, 0);
      leg.castShadow = true;
      this.legs.add(leg);
    }

    // long coat: a tapered barrel, which reads as wool at any distance
    const coat = new Mesh(new CylinderGeometry(0.17, 0.235, 0.86, 10), mats.cloth);
    coat.position.y = 1.2;
    coat.castShadow = true;
    this.upperBody.add(coat);
    const shoulders = new Mesh(new SphereGeometry(0.19, 10, 7), mats.cloth);
    shoulders.scale.set(1.32, 0.68, 0.8);
    shoulders.position.y = 1.57;
    shoulders.castShadow = true;
    this.upperBody.add(shoulders);

    // Wrapped up against the cold: a scarf over the chin, a hat pulled down.
    const scarf = new Mesh(new TorusGeometry(0.105, 0.05, 6, 12), mats.clothLight);
    scarf.rotation.x = Math.PI / 2;
    scarf.position.y = 1.66;
    this.upperBody.add(scarf);
    const scarfTail = new Mesh(new BoxGeometry(0.085, 0.32, 0.05), mats.clothLight);
    scarfTail.position.set(0.075, 1.5, 0.115);
    scarfTail.rotation.z = 0.16;
    this.upperBody.add(scarfTail);

    const head = new Mesh(new SphereGeometry(0.105, 12, 9), mats.skin);
    head.position.y = 1.78;
    head.castShadow = true;
    this.upperBody.add(head);
    const hat = new Mesh(new CylinderGeometry(0.115, 0.122, 0.17, 10), mats.cloth);
    hat.position.y = 1.855;
    this.upperBody.add(hat);
    const brim = new Mesh(new CylinderGeometry(0.165, 0.165, 0.024, 12), mats.cloth);
    brim.position.y = 1.79;
    this.upperBody.add(brim);

    for (const [side, arm, hand] of [
      [-1, this.leftArm, this.leftHand],
      [1, this.rightArm, this.rightHand],
    ] as Array<[number, Group, Object3D]>) {
      arm.position.set(side * 0.225, 1.55, 0);
      const upper = new Mesh(new CylinderGeometry(0.058, 0.05, 0.36, 7), mats.cloth);
      upper.position.y = -0.18;
      upper.castShadow = true;
      arm.add(upper);
      const fore = new Group();
      fore.position.y = -0.36;
      const foreMesh = new Mesh(new CylinderGeometry(0.05, 0.044, 0.34, 7), mats.cloth);
      foreMesh.position.y = -0.17;
      fore.add(foreMesh);
      const mitten = new Mesh(new SphereGeometry(0.062, 8, 6), mats.clothLight);
      mitten.position.y = -0.36;
      mitten.scale.set(1, 1.25, 0.85);
      fore.add(mitten);
      hand.position.y = -0.36;
      fore.add(hand);
      arm.add(fore);
      arm.rotation.x = 0.12;
      this.upperBody.add(arm);
    }
  }

  /** Standing on the ground, or seated on the sleigh's box. */
  setPose(pose: 'stand' | 'sit'): void {
    if (pose === 'sit') {
      this.legs.rotation.x = -1.35;
      this.legs.position.set(0, 0.84, 0.04);
      this.upperBody.position.y = -0.02;
      this.leftArm.rotation.x = -0.75;
      this.rightArm.rotation.x = -0.75;
    } else {
      this.legs.rotation.x = 0;
      this.legs.position.set(0, 0.86, 0);
      this.upperBody.position.y = 0;
    }
  }

  /** Reach both hands toward a world point, e.g. to hold the strap up. */
  reachTo(world: Vector3 | null, blend = 1): void {
    const local = new Vector3();
    for (const [arm, sign] of [
      [this.leftArm, -1],
      [this.rightArm, 1],
    ] as Array<[Group, number]>) {
      let tx = 0.25;
      let tz = 0.5;
      if (world) {
        this.group.worldToLocal(local.copy(world));
        tx = Math.max(-1.1, Math.min(1.1, -(local.y - 1.56) * 1.15));
        tz = Math.max(-0.2, Math.min(1.35, local.z * 0.95));
      }
      // Elbows stay bent: a person holding something in front of them, not a
      // mannequin with its arms out.
      const targetX = Math.max(-1.0, Math.min(0.15, -tz * 0.75 * blend));
      const targetZ = sign * Math.max(-0.5, Math.min(0.5, tx * 0.2 * blend)) + sign * 0.18;
      arm.rotation.x += (targetX - arm.rotation.x) * 0.16;
      arm.rotation.z += (targetZ - arm.rotation.z) * 0.16;
    }
  }

  update(dt: number): void {
    this.time += dt;
    // A person standing in the cold is never perfectly still.
    this.group.position.y += 0;
    const sway = Math.sin(this.time * 0.7) * 0.006;
    this.group.rotation.z = sway * 0.5;
  }

  addTo(parent: Object3D): void {
    parent.add(this.group);
  }
}

// ---------------------------------------------------------------- puffs ----

interface Puff {
  pos: Vector3;
  vel: Vector3;
  age: number;
  life: number;
  size: number;
  grow: number;
  opacity: number;
}

/**
 * Billboards for hoof spray, runner spray and breath. A single instanced
 * quad, oriented to the camera once per frame.
 */
export class PuffField {
  readonly mesh: InstancedMesh;
  private pool: Puff[] = [];
  private capacity: number;
  private mat: MeshBasicMaterial;

  constructor(mats: MaterialLibrary, capacity = 110) {
    this.capacity = capacity;
    this.mat = new MeshBasicMaterial({
      map: mats.tex.puff,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      color: new Color(0xffffff),
      opacity: 0.85,
    });
    this.mesh = new InstancedMesh(new PlaneGeometry(1, 1), this.mat, capacity);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 5;
  }

  setCapacity(n: number): void {
    this.capacity = Math.min(n, this.mesh.instanceMatrix.count);
  }

  spawn(pos: Vector3, vel: Vector3, size: number, life: number, opacity = 0.7): void {
    if (this.pool.length >= this.capacity) this.pool.shift();
    this.pool.push({
      pos: pos.clone(),
      vel: vel.clone(),
      age: 0,
      life,
      size,
      grow: 1 + Math.random() * 1.4,
      opacity,
    });
  }

  /** A hoof landing throws a low, wide fan of loose snow forward. */
  hoofSpray(at: Vector3, forward: Vector3, weight: number, speed: number): void {
    const n = 1 + Math.round(weight * speed * 0.9);
    for (let i = 0; i < n; i++) {
      const v = new Vector3(
        forward.x * (0.4 + Math.random() * speed * 0.35) + (Math.random() - 0.5) * 0.5,
        0.35 + Math.random() * 0.6,
        forward.z * (0.4 + Math.random() * speed * 0.35) + (Math.random() - 0.5) * 0.5,
      );
      this.spawn(at, v, 0.1 + Math.random() * 0.12, 0.5 + Math.random() * 0.4, 0.42 * weight);
    }
  }

  /** Warm breath condenses in front of the nose and drifts back. */
  breath(at: Vector3, forward: Vector3, effort: number): void {
    for (let i = 0; i < 2; i++) {
      const v = new Vector3(
        forward.x * (0.7 + effort) + (Math.random() - 0.5) * 0.18,
        0.16 + Math.random() * 0.14,
        forward.z * (0.7 + effort) + (Math.random() - 0.5) * 0.18,
      );
      this.spawn(at, v, 0.08, 0.75 + Math.random() * 0.5, 0.3 + effort * 0.2);
    }
  }

  update(dt: number, cameraQuat: Quaternion): void {
    const m = new Matrix4();
    const s = new Vector3();
    let n = 0;
    for (let i = this.pool.length - 1; i >= 0; i--) {
      const p = this.pool[i];
      p.age += dt;
      if (p.age >= p.life) {
        this.pool.splice(i, 1);
        continue;
      }
      p.vel.y -= 1.1 * dt;
      p.vel.multiplyScalar(1 - 1.7 * dt);
      p.pos.addScaledVector(p.vel, dt);
    }
    for (const p of this.pool) {
      if (n >= this.capacity) break;
      const t = p.age / p.life;
      const size = p.size * (1 + t * p.grow);
      s.setScalar(size);
      m.compose(p.pos, cameraQuat, s);
      this.mesh.setMatrixAt(n, m);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    // One material for the whole field: fade the newest and oldest together.
    this.mat.opacity = 0.8;
  }

  clear(): void {
    this.pool.length = 0;
    this.mesh.count = 0;
  }

  addTo(parent: Object3D): void {
    parent.add(this.mesh);
  }
}
