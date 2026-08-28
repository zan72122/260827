import * as THREE from 'three';
import type { DestinationId, DispatchKind } from '../types';
import type { MaterialLibrary } from './materials';

export function reparentKeepWorld(obj: THREE.Object3D, parent: THREE.Object3D): void {
  obj.updateWorldMatrix(true, false);
  const m = obj.matrixWorld.clone();
  parent.add(obj);
  parent.updateWorldMatrix(true, false);
  const inv = new THREE.Matrix4().copy(parent.matrixWorld).invert();
  m.premultiply(inv);
  m.decompose(obj.position, obj.quaternion, obj.scale);
}

type Job = {
  bag: THREE.Object3D;
  kind: DispatchKind;
  destination: DestinationId;
  t: number;
  curve: THREE.CatmullRomCurve3;
  done: boolean;
};

/**
 * The two dispatch methods of this fictional central office, shown as machinery:
 * a loading gate that opens and shuts at once, or a keeping rack with a date wheel.
 * No wording, only different hardware and different seal tags.
 */
export class DispatchSchedule {
  readonly group = new THREE.Group();
  readonly transit = new THREE.Group();
  readonly doorGroup = new THREE.Group();
  readonly outsideGroup = new THREE.Group();

  onDeparted: ((destination: DestinationId, kind: DispatchKind) => void) | null = null;
  onStored: ((destination: DestinationId) => void) | null = null;
  onDoorOpen: (() => void) | null = null;

  private slats: THREE.Mesh[] = [];
  private doorOpen = 0;
  private doorTarget = 0;
  private doorAnnounced = false;

  private postalVan: THREE.Group;
  private snowVan: THREE.Group;
  private vanDriveT = 1;
  private activeVan: THREE.Group | null = null;
  private pendingDeparture: { destination: DestinationId; kind: DispatchKind } | null = null;

  private dateWheel: THREE.Mesh;
  private wheelAngle = 0;
  private wheelTarget = 0;
  private storedCount = 0;
  private shelfSlots: THREE.Object3D[] = [];

  private jobs: Job[] = [];
  private tmp = new THREE.Vector3();

  readonly rack: THREE.Group;
  readonly chain: THREE.Group;
  readonly chainGrip: THREE.Mesh;
  readonly chainHit: THREE.Mesh;
  private chainPull = 0;

  constructor(mats: MaterialLibrary) {
    this.group.add(this.transit);

    // --- loading dock opening in the wall
    const jambGeo = new THREE.BoxGeometry(0.14, 2.5, 0.4);
    for (const z of [-1.15, 1.15]) {
      const jamb = new THREE.Mesh(jambGeo, mats.concrete);
      jamb.position.set(0, 1.25, z);
      this.doorGroup.add(jamb);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.24, 2.7), mats.concrete);
    lintel.position.set(0, 2.4, 0);
    this.doorGroup.add(lintel);

    // rolling shutter of real slats
    for (let i = 0; i < 14; i++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.15, 2.24), mats.steelPainted);
      slat.position.set(0, 0.09 + i * 0.155, 0);
      this.slats.push(slat);
      this.doorGroup.add(slat);
    }
    const guide = new THREE.Mesh(new THREE.BoxGeometry(0.07, 2.3, 0.05), mats.steelRaw);
    guide.position.set(-0.05, 1.2, -1.12);
    this.doorGroup.add(guide);
    const guide2 = guide.clone();
    guide2.position.z = 1.12;
    this.doorGroup.add(guide2);

    // the pull chain that works the shutter
    const chainGroup = new THREE.Group();
    chainGroup.position.set(-0.12, 0, -1.02);
    const chainGeo = new THREE.TorusGeometry(0.017, 0.005, 5, 10);
    for (let i = 0; i < 12; i++) {
      const link = new THREE.Mesh(chainGeo, mats.steelRaw);
      link.position.y = 2.15 - i * 0.026;
      link.rotation.y = (i % 2) * Math.PI * 0.5;
      chainGroup.add(link);
    }
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.038, 0.14, 12), mats.woodDark);
    grip.position.y = 1.78;
    grip.castShadow = true;
    chainGroup.add(grip);
    const gripHit = new THREE.Mesh(
      new THREE.BoxGeometry(0.26, 0.34, 0.26),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    gripHit.position.y = 1.78;
    chainGroup.add(gripHit);
    this.chain = chainGroup;
    this.chainGrip = grip;
    this.chainHit = gripHit;
    this.doorGroup.add(chainGroup);

    this.group.add(this.doorGroup);

    // --- outside: cold snow apron, a low ramp, the vehicles
    const apron = new THREE.Mesh(new THREE.BoxGeometry(6, 0.08, 7), mats.snow);
    apron.position.set(3.1, -0.04, 0);
    apron.receiveShadow = true;
    this.outsideGroup.add(apron);

    const ramp = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 2.1), mats.concrete);
    ramp.position.set(0.5, 0.03, 0);
    this.outsideGroup.add(ramp);

    this.postalVan = buildPostalVan(mats);
    this.postalVan.position.set(1.55, 0, -0.15);
    this.postalVan.rotation.y = Math.PI;
    this.outsideGroup.add(this.postalVan);

    this.snowVan = buildSnowVan(mats);
    this.snowVan.position.set(1.55, 0, 1.9);
    this.snowVan.rotation.y = Math.PI;
    this.outsideGroup.add(this.snowVan);
    this.group.add(this.outsideGroup);

    // --- keeping rack with its date wheel
    const rack = new THREE.Group();
    const post = new THREE.BoxGeometry(0.06, 1.2, 0.06);
    for (const x of [-0.5, 0.5]) {
      for (const z of [-0.22, 0.22]) {
        const p = new THREE.Mesh(post, mats.woodDark);
        p.position.set(x, 0.6, z);
        rack.add(p);
      }
    }
    for (const y of [0.42, 0.86]) {
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.04, 0.52), mats.wood);
      shelf.position.set(0, y, 0);
      shelf.receiveShadow = true;
      rack.add(shelf);
      for (const x of [-0.28, 0.28]) {
        const slot = new THREE.Object3D();
        slot.position.set(x, y + 0.02, 0);
        rack.add(slot);
        this.shelfSlots.push(slot);
      }
    }

    const wheelHub = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.06, 10), mats.steelRaw);
    wheelHub.rotation.x = Math.PI / 2;
    wheelHub.position.set(0, 1.12, 0.2);
    rack.add(wheelHub);

    this.dateWheel = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.03, 24), mats.brass);
    this.dateWheel.rotation.x = Math.PI / 2;
    this.dateWheel.position.set(0, 1.12, 0.22);
    rack.add(this.dateWheel);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const notch = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.03, 0.034), mats.steelPainted);
      notch.position.set(Math.cos(a) * 0.15, Math.sin(a) * 0.15, 0);
      notch.rotation.z = a;
      this.dateWheel.add(notch);
    }
    const pointer = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.05, 3), mats.paintedRed);
    pointer.position.set(0, 1.32, 0.22);
    pointer.rotation.z = Math.PI;
    rack.add(pointer);

    this.rack = rack;
    this.group.add(rack);
  }

  /** The child's hand on the chain, 0..1. */
  setChainPull(v: number): void {
    this.chainPull = THREE.MathUtils.clamp(v, 0, 1);
    this.chainGrip.position.y = 1.78 - this.chainPull * 0.3;
  }

  get chainPullAmount(): number {
    return this.chainPull;
  }

  releaseChain(): void {
    this.chainPull = 0;
    this.chainGrip.position.y = 1.78;
  }

  setRackTransform(pos: THREE.Vector3, rotY: number): void {
    this.rack.position.copy(pos);
    this.rack.rotation.y = rotY;
  }

  openDoor(): void {
    this.doorTarget = 1;
    this.doorAnnounced = false;
  }

  closeDoor(): void {
    this.doorTarget = 0;
  }

  get doorAmount(): number {
    return this.doorOpen;
  }

  /** Carry a sealed bag to the dock and load it, or to the keeping rack. */
  dispatchBag(bagRoot: THREE.Object3D, kind: DispatchKind, destination: DestinationId): void {
    reparentKeepWorld(bagRoot, this.transit);
    const from = bagRoot.position.clone();

    let to: THREE.Vector3;
    const waypoints: THREE.Vector3[] = [from];
    if (kind === 'today') {
      const van = destination === 'snowvillage' || destination === 'mountain' ? this.snowVan : this.postalVan;
      this.activeVan = van;
      to = van.getWorldPosition(new THREE.Vector3());
      this.transit.worldToLocal(to);
      to.y += 1.02;
      to.z += 0.05;
      // pushed along the floor to the doorway, then lifted onto the bed
      waypoints.push(new THREE.Vector3(-0.45, from.y + 0.02, -0.08));
      this.openDoor();
    } else {
      const slot = this.shelfSlots[Math.min(this.storedCount, this.shelfSlots.length - 1)];
      to = slot.getWorldPosition(new THREE.Vector3());
      this.transit.worldToLocal(to);
      this.storedCount++;
      this.wheelTarget += (Math.PI * 2) / 12;
      const mid = from.clone().lerp(to, 0.55);
      mid.y = Math.max(from.y, to.y) + 0.28;
      waypoints.push(mid);
    }
    waypoints.push(to);

    this.jobs.push({
      bag: bagRoot,
      kind,
      destination,
      t: 0,
      curve: new THREE.CatmullRomCurve3(waypoints, false, 'catmullrom', 0.2),
      done: false,
    });
  }

  update(dt: number): void {
    // shutter
    const prev = this.doorOpen;
    this.doorOpen += (this.doorTarget - this.doorOpen) * Math.min(1, dt * 1.5);
    if (Math.abs(prev - this.doorOpen) > 1e-5) {
      for (let i = 0; i < this.slats.length; i++) {
        const lift = this.doorOpen * 2.05;
        const y = 0.09 + i * 0.155 + lift;
        const top = 2.28;
        this.slats[i].position.y = Math.min(y, top);
        this.slats[i].visible = y < top + 0.02;
      }
    }
    if (!this.doorAnnounced && this.doorOpen > 0.85) {
      this.doorAnnounced = true;
      this.onDoorOpen?.();
    }

    // date wheel indexes one notch per stored bag
    if (Math.abs(this.wheelAngle - this.wheelTarget) > 1e-4) {
      this.wheelAngle += (this.wheelTarget - this.wheelAngle) * Math.min(1, dt * 3.2);
      this.dateWheel.rotation.y = this.wheelAngle;
    }

    // bags in transit
    for (const job of this.jobs) {
      if (job.done) continue;
      job.t = Math.min(1, job.t + dt * 0.55);
      job.curve.getPoint(job.t, this.tmp);
      job.bag.position.copy(this.tmp);
      if (job.t >= 1) {
        job.done = true;
        if (job.kind === 'today') {
          this.pendingDeparture = { destination: job.destination, kind: job.kind };
          this.vanDriveT = 0;
        } else {
          this.onStored?.(job.destination);
        }
      }
    }
    this.jobs = this.jobs.filter((j) => !j.done || j.kind === 'today');

    // the van pulls away into the snow
    if (this.vanDriveT < 1 && this.activeVan) {
      this.vanDriveT = Math.min(1, this.vanDriveT + dt * 0.32);
      const k = this.vanDriveT;
      const dx = k * 7.5;
      this.activeVan.position.x = 1.55 + dx;
      for (const job of this.jobs) {
        if (job.kind === 'today' && job.done) job.bag.position.x += dt * 0.32 * 7.5;
      }
      if (k >= 1) {
        const p = this.pendingDeparture;
        this.pendingDeparture = null;
        this.jobs = this.jobs.filter((j) => !j.done);
        this.closeDoor();
        if (p) this.onDeparted?.(p.destination, p.kind);
      }
    }
  }

  reset(): void {
    this.releaseChain();
    this.jobs.length = 0;
    this.doorTarget = 0;
    this.vanDriveT = 1;
    this.postalVan.position.x = 1.55;
    this.snowVan.position.x = 1.55;
    this.storedCount = 0;
    this.wheelTarget = 0;
    while (this.transit.children.length) this.transit.remove(this.transit.children[0]);
  }
}

function buildPostalVan(mats: MaterialLibrary): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.75, 1.0), mats.paintedCream);
  body.position.y = 0.62;
  body.castShadow = true;
  g.add(body);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.5, 0.96), mats.paintedRed);
  cab.position.set(0.62, 1.2, 0);
  g.add(cab);
  const box = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.72, 1.0), mats.paintedRed);
  box.position.set(-0.36, 1.32, 0);
  g.add(box);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.28, 0.8), mats.glass);
  glass.position.set(0.98, 1.24, 0);
  g.add(glass);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.92, 0.1, 1.02), mats.paintedBlue);
  stripe.position.y = 0.92;
  g.add(stripe);
  const wheelGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.22, 16);
  for (const x of [-0.55, 0.6]) {
    for (const z of [-0.48, 0.48]) {
      const w = new THREE.Mesh(wheelGeo, mats.steelPainted);
      w.rotation.x = Math.PI / 2;
      w.position.set(x, 0.28, z);
      g.add(w);
    }
  }
  return g;
}

function buildSnowVan(mats: MaterialLibrary): THREE.Group {
  const g = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.6, 1.1), mats.paintedBlue);
  hull.position.y = 0.7;
  hull.castShadow = true;
  g.add(hull);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.55, 1.0), mats.paintedCream);
  cab.position.set(0.5, 1.25, 0);
  g.add(cab);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 1.04), mats.woodDark);
  deck.position.set(-0.44, 1.06, 0);
  g.add(deck);
  for (const z of [-0.55, 0.55]) {
    const track = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.3, 0.26), mats.steelPainted);
    track.position.set(0, 0.3, z);
    g.add(track);
    for (let i = 0; i < 6; i++) {
      const cleat = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.34, 0.28), mats.steelRaw);
      cleat.position.set(-0.8 + i * 0.32, 0.3, z);
      g.add(cleat);
    }
  }
  const ski = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.06, 0.16), mats.steelRaw);
  ski.position.set(0.95, 0.16, 0);
  g.add(ski);
  return g;
}
