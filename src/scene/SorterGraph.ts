import * as THREE from 'three';
import { Rng } from '../core/rng';
import { canvas2d } from '../core/textures';
import type { DestinationId, DispatchKind, ReceptacleKey } from '../types';
import type { DestinationModule } from './DestinationSymbol';
import type { MaterialLibrary } from './materials';
import { PostalBag } from './PostalBag';
import type { Envelope } from './EnvelopeFactory';

export type BayVariant = 'dispatch' | 'storage';

/** One sorting position: solid symbol, metal placard, mechanical window, chute, bag. */
export class SorterBay {
  readonly id: string;
  readonly key: ReceptacleKey;
  readonly variant: BayVariant;
  readonly dest: DestinationModule;
  readonly group = new THREE.Group();
  readonly bag: PostalBag;
  readonly snapAnchor = new THREE.Object3D();
  readonly mouth = new THREE.Object3D();
  readonly path: THREE.CatmullRomCurve3;
  readonly filed: Envelope[] = [];

  private shutterL: THREE.Mesh;
  private shutterR: THREE.Mesh;
  private placard: THREE.Group;
  private gateVanes: THREE.Group;
  private beltMesh: THREE.Mesh;
  private windowOpen = 0;
  private placardRaise = 0;
  private gateSpin = 0;
  private beltRun = 0;

  constructor(dest: DestinationModule, key: ReceptacleKey, variant: BayVariant, mats: MaterialLibrary) {
    this.dest = dest;
    this.key = key;
    this.variant = variant;
    this.id = `${key.destination}:${key.dispatch ?? 'any'}`;

    // --- head: carries the window and the solid symbol, and nothing else
    const bodyMat = mats.wood.clone();
    if (bodyMat.map) {
      bodyMat.map = bodyMat.map.clone();
      bodyMat.map.needsUpdate = true;
      bodyMat.map.rotation = Math.PI / 2;
      bodyMat.map.center.set(0.5, 0.5);
      bodyMat.map.repeat.set(1, 1.1);
    }
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.3, 0.5), bodyMat);
    body.position.set(0, 1.05, 0);
    body.castShadow = true;
    body.receiveShadow = true;
    this.group.add(body);

    const topRail = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.03, 0.54), mats.woodDark);
    topRail.position.set(0, 1.215, 0);
    this.group.add(topRail);

    // --- open steel frame: the letter stays in sight the whole way down
    for (const x of [-0.25, 0.25]) {
      for (const z of [-0.21, 0.21]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.9, 0.045), mats.steelPainted);
        post.position.set(x, 0.45, z);
        this.group.add(post);
      }
    }
    const deck = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.02, 0.48), mats.steelPainted);
    deck.position.set(0, 0.355, 0);
    deck.receiveShadow = true;
    this.group.add(deck);
    const brace = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.02, 0.02), mats.steelPainted);
    brace.position.set(0, 0.1, -0.21);
    this.group.add(brace);

    // --- brass mouth: an open funnel, not a hole in a box
    const mouthFrame = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.03, 0.09), mats.brass);
    mouthFrame.position.set(0, 0.71, 0.235);
    this.group.add(mouthFrame);
    const mouthFrame2 = mouthFrame.clone();
    mouthFrame2.position.y = 0.9;
    this.group.add(mouthFrame2);
    for (const x of [-0.2, 0.2]) {
      const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.22, 0.09), mats.brass);
      jamb.position.set(x, 0.805, 0.235);
      this.group.add(jamb);
    }
    const backPlate = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.26, 0.014), mats.steelPainted);
    backPlate.position.set(0, 0.8, -0.14);
    this.group.add(backPlate);

    // --- gravity chute: a sloped floor and two guide plates, open to the room
    const chuteFloor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.012, 0.36), mats.steelRaw);
    chuteFloor.position.set(0, 0.6, 0.11);
    chuteFloor.rotation.x = -0.95;
    this.group.add(chuteFloor);
    for (const x of [-0.175, 0.175]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.11, 0.36), mats.steelPainted);
      side.position.set(x, 0.625, 0.11);
      side.rotation.x = -0.95;
      this.group.add(side);
    }

    this.mouth.position.set(0, 0.81, 0.24);
    this.group.add(this.mouth);
    this.snapAnchor.position.set(0, 0.86, 0.42);
    this.group.add(this.snapAnchor);

    // --- mechanical window: two leaves that part only for the right letter
    const winFrame = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.18, 0.03), mats.steelPainted);
    winFrame.position.set(0, 1.06, 0.25);
    this.group.add(winFrame);
    const inner = new THREE.Mesh(
      new THREE.BoxGeometry(0.21, 0.14, 0.012),
      new THREE.MeshStandardMaterial({ color: 0xd9b978, emissive: 0x6d4c1b, emissiveIntensity: 0.35, roughness: 0.6 }),
    );
    inner.position.set(0, 1.06, 0.259);
    this.group.add(inner);

    const leafGeo = new THREE.BoxGeometry(0.107, 0.145, 0.008);
    this.shutterL = new THREE.Mesh(leafGeo, mats.brass);
    this.shutterL.position.set(-0.0535, 1.06, 0.268);
    this.shutterR = new THREE.Mesh(leafGeo, mats.brass);
    this.shutterR.position.set(0.0535, 1.06, 0.268);
    this.group.add(this.shutterL, this.shutterR);

    // --- the small metal placard that lifts to name the route
    this.placard = new THREE.Group();
    this.placard.position.set(0.24, 0.98, 0.2);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.075, 0.01), mats.steelRaw);
    arm.position.y = 0.037;
    this.placard.add(arm);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.125, 0.1, 0.006), makePlacardMaterial(dest, mats));
    plate.position.y = 0.11;
    this.placard.add(plate);
    this.placard.rotation.x = -1.35;
    this.group.add(this.placard);

    // --- the solid symbol standing over the bay
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.2, 0.03, 24), mats.woodDark);
    plinth.position.set(0, 1.225, 0);
    this.group.add(plinth);
    const symbol = dest.buildSymbol(mats);
    symbol.position.set(0, 1.24, 0);
    symbol.scale.setScalar(1.45);
    symbol.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
    this.group.add(symbol);

    // --- short belt and rotary gate below the chute
    this.beltMesh = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.26), mats.belt);
    this.beltMesh.position.set(0, 0.4, 0.16);
    this.beltMesh.receiveShadow = true;
    this.group.add(this.beltMesh);
    for (const z of [0.04, 0.29]) {
      const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.3, 12), mats.steelRaw);
      roller.rotation.z = Math.PI / 2;
      roller.position.set(0, 0.4, z);
      this.group.add(roller);
    }

    this.gateVanes = new THREE.Group();
    this.gateVanes.position.set(0, 0.38, 0.36);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.3, 10), mats.steelRaw);
    hub.rotation.z = Math.PI / 2;
    this.gateVanes.add(hub);
    for (let i = 0; i < 4; i++) {
      const spoke = new THREE.Group();
      spoke.rotation.x = (i / 4) * Math.PI * 2;
      const vane = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.07, 0.006), mats.paintedGreen);
      vane.position.y = 0.042;
      spoke.add(vane);
      this.gateVanes.add(spoke);
    }
    this.group.add(this.gateVanes);

    // --- destination bag standing in front, mouth held open by a hoop
    this.bag = new PostalBag(mats, { dark: variant === 'storage' });
    this.bag.group.position.set(0, 0, 0.62);
    this.group.add(this.bag.group);

    const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.008, 6, 22), mats.brass);
    hoop.rotation.x = Math.PI / 2;
    hoop.position.set(0, 0.44, 0.62);
    this.group.add(hoop);
    for (const x of [-0.115, 0.115]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.44, 8), mats.steelPainted);
      leg.position.set(x, 0.22, 0.62);
      this.group.add(leg);
    }

    // --- the route the letter actually takes: gravity chute, belt, rotary gate, bag
    this.path = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(0, 0.86, 0.42),
        new THREE.Vector3(0, 0.83, 0.28),
        new THREE.Vector3(0, 0.75, 0.22),
        new THREE.Vector3(0, 0.62, 0.13),
        new THREE.Vector3(0, 0.48, 0.04),
        new THREE.Vector3(0, 0.432, 0.11),
        new THREE.Vector3(0, 0.428, 0.26),
        new THREE.Vector3(0, 0.43, 0.36),
        new THREE.Vector3(0, 0.46, 0.48),
        new THREE.Vector3(0, 0.42, 0.6),
      ],
      false,
      'catmullrom',
      0.35,
    );
  }

  /** true when this bay is the right home for the letter under the current rule. */
  accepts(env: Envelope, oneCondition: boolean): boolean {
    if (env.destination !== this.key.destination) return false;
    if (oneCondition || this.key.dispatch === null) return true;
    return env.dispatch === this.key.dispatch;
  }

  setWindowOpen(v: number): void {
    this.windowOpen = THREE.MathUtils.clamp(v, 0, 1);
  }

  get windowIsOpen(): boolean {
    return this.windowOpen > 0.5;
  }

  raisePlacard(v: number): void {
    this.placardRaise = THREE.MathUtils.clamp(v, 0, 1);
  }

  runBelt(on: boolean): void {
    this.beltRun = on ? 1 : 0;
  }

  worldSnapPoint(target: THREE.Vector3): THREE.Vector3 {
    return this.snapAnchor.getWorldPosition(target);
  }

  pointAt(t: number, target: THREE.Vector3): THREE.Vector3 {
    this.path.getPoint(THREE.MathUtils.clamp(t, 0, 1), target);
    return this.group.localToWorld(target);
  }

  update(dt: number): void {
    const open = this.windowOpen;
    this.shutterL.position.x = -0.0535 - open * 0.093;
    this.shutterR.position.x = 0.0535 + open * 0.093;
    this.placard.rotation.x = -1.35 + this.placardRaise * 1.35;
    if (this.beltRun > 0) {
      this.gateSpin += dt * 2.4;
      this.gateVanes.rotation.x = this.gateSpin;
      const m = this.beltMesh.material as THREE.MeshStandardMaterial;
      if (m.map) m.map.offset.y = (m.map.offset.y - dt * 0.4) % 1;
    }
  }
}

function makePlacardMaterial(dest: DestinationModule, mats: MaterialLibrary): THREE.MeshStandardMaterial {
  const [c, ctx] = canvas2d(160, 128);
  ctx.fillStyle = '#a4823f';
  ctx.fillRect(0, 0, 160, 128);
  const rng = new Rng(97);
  for (let i = 0; i < 300; i++) {
    ctx.globalAlpha = 0.05;
    ctx.fillStyle = rng.next() > 0.5 ? '#c8a765' : '#7d6330';
    ctx.fillRect(rng.range(0, 160), rng.range(0, 128), 6, 1);
  }
  ctx.globalAlpha = 1;
  ctx.save();
  ctx.translate(20, 12);
  dest.drawPictogram(ctx, 120, 104, new Rng(5), 'rgba(38,30,18,0.85)');
  ctx.restore();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = mats.brass.clone();
  m.map = tex;
  m.color = new THREE.Color(0xffffff);
  m.metalness = 0.85;
  m.roughness = 0.45;
  return m;
}

/** The shelf as a whole: bays laid out, nearest-bay search, one/two condition rule. */
export class SorterGraph {
  readonly group = new THREE.Group();
  readonly bays: SorterBay[] = [];
  private mats: MaterialLibrary;
  private tmp = new THREE.Vector3();
  private portrait = false;

  constructor(mats: MaterialLibrary) {
    this.mats = mats;
  }

  addBay(dest: DestinationModule, dispatch: DispatchKind | null, variant: BayVariant): SorterBay {
    const bay = new SorterBay(dest, { destination: dest.id, dispatch }, variant, this.mats);
    this.bays.push(bay);
    this.group.add(bay.group);
    this.layout();
    return bay;
  }

  clear(): void {
    for (const b of this.bays) {
      this.group.remove(b.group);
      b.bag.dispose();
    }
    this.bays.length = 0;
  }

  /** A turned phone reads the shelf from above, so the chutes close ranks. */
  setPortrait(p: boolean): void {
    if (this.portrait === p) return;
    this.portrait = p;
    this.layout();
  }

  /** Bays fan out from the centre so every symbol stays on a phone screen. */
  layout(): void {
    const n = this.bays.length;
    const wide = n <= 2 ? 0.95 : n === 3 ? 0.88 : 0.82;
    const pitch = this.portrait && n >= 3 ? 0.62 : wide;
    const start = -((n - 1) / 2) * pitch;
    this.bays.forEach((b, i) => {
      b.group.position.x = start + i * pitch;
    });
  }

  bayById(id: string): SorterBay | undefined {
    return this.bays.find((b) => b.id === id);
  }

  baysFor(destination: DestinationId): SorterBay[] {
    return this.bays.filter((b) => b.key.destination === destination);
  }

  /** Horizontal proximity only: a four year old aims across the shelf, not in height. */
  nearest(worldPos: THREE.Vector3, maxDist: number): SorterBay | null {
    let best: SorterBay | null = null;
    let bestD = maxDist;
    for (const b of this.bays) {
      const p = b.worldSnapPoint(this.tmp);
      const d = Math.hypot(p.x - worldPos.x, p.z - worldPos.z);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  update(dt: number): void {
    for (const b of this.bays) b.update(dt);
  }
}
