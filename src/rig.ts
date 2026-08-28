import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { buildFish, makeFishMaterials, randomForm, type FishBuildOptions, type FishMeshes } from './fish';
import { DropSystem } from './drops';
import { applyUnderwaterFade } from './water';

export const WORLD = {
  waterY: 0,
  deckY: 0.05,
  holeHalfX: 0.26,
  holeHalfZ: 0.46,
  rodTip: new THREE.Vector3(0, 1.45, 0),
  reelPos: new THREE.Vector3(-0.38, 1.78, 0.3),
  /** metres above the sinker; index 0 is the top hook and therefore the first fish seen */
  hookOffsets: [0.68, 0.44, 0.2],
  lineOutDeployed: 2.75,
  lineOutMin: 1.0,
  windSpeed: 0.26,
  spoolRadius: 0.026,
};

const DEEP = new THREE.Color(0x060a10);
const MAIN_POINTS = 56;
const BRANCH_POINTS = 7;
const BRANCH_LEN = 0.072;
/** Each dropper stands off the mainline in its own direction, so a fish never
 *  hangs in front of the line it is tied to. */
const BRANCH_DIR: [number, number][] = [
  [0.94, 0.34],
  [-0.8, -0.6],
  [0.42, -0.91],
];
const BRANCH_STANDOFF = 0.034;

class Oscillator {
  value = 0;
  private vel = 0;
  constructor(private omega: number, private zeta: number) {}
  step(dt: number, extraDamping: number, drive: number): number {
    const z = this.zeta + extraDamping;
    const acc = -this.omega * this.omega * this.value - 2 * z * this.omega * this.vel + drive;
    this.vel += acc * dt;
    this.value += this.vel * dt;
    return this.value;
  }
  kick(v: number): void {
    this.vel += v;
  }
  reset(): void {
    this.value = 0;
    this.vel = 0;
  }
}

interface HookedFish {
  meshes: FishMeshes;
  slot: number;
  swingX: Oscillator;
  swingZ: Oscillator;
  yawPhase: number;
  yawRate: number;
  rollPhase: number;
  wriggle: number;
  outOfWater: number;
  dripTimer: number;
  crossed: boolean;
}

export interface RigCallbacks {
  onRipple(x: number, z: number, strength: number): void;
  onFishSurface(index: number): void;
  onSinkerSurface(): void;
}

export class Rig {
  readonly group = new THREE.Group();
  readonly drops: DropSystem;

  lineOut = WORLD.lineOutMin;
  reelSpeed = 0; // m/s of line coming in
  spoolAngle = 0;
  motor = 0; // 0..1 motor spin-up
  pressing = false;
  fishCount = 0;

  private fishes: HookedFish[] = [];
  private mainLine: Line2;
  private mainGeo: LineGeometry;
  private rodLine: Line2;
  private branchLines: Line2[] = [];
  private branchGeos: LineGeometry[] = [];
  private sinker: THREE.Mesh;
  private swayX1 = new Oscillator(3.0, 0.09);
  private swayX2 = new Oscillator(7.1, 0.16);
  private swayZ1 = new Oscillator(3.2, 0.09);
  private swayZ2 = new Oscillator(7.4, 0.16);
  private mainPositions = new Float32Array(MAIN_POINTS * 3);
  private mainColors = new Float32Array(MAIN_POINTS * 3);
  private branchBuf = new Float32Array(BRANCH_POINTS * 3);
  private branchCol = new Float32Array(BRANCH_POINTS * 3);
  private lineSpawnAccum = 0;
  private nextDropGap = 0.04;
  private ambient = 0;
  private tmp = new THREE.Vector3();
  /** live rod-tip deflection, blended in near the top of the line */
  readonly tipOffset = new THREE.Vector3();
  private materials: ReturnType<typeof makeFishMaterials>;
  private buildOpts: FishBuildOptions;

  constructor(opts: FishBuildOptions, dropCapacity: number) {
    this.buildOpts = opts;
    this.materials = makeFishMaterials(opts);
    applyUnderwaterFade(this.materials.body, DEEP, 3.1);
    applyUnderwaterFade(this.materials.eye, DEEP, 3.1);

    const lineMat = () =>
      new LineMaterial({
        color: 0xffffff,
        linewidth: 1.4,
        vertexColors: true,
        transparent: true,
        opacity: 0.95,
        dashed: false,
        alphaToCoverage: false,
      });

    this.mainGeo = new LineGeometry();
    this.mainGeo.setPositions(new Array(MAIN_POINTS * 3).fill(0));
    this.mainGeo.setColors(new Array(MAIN_POINTS * 3).fill(1));
    this.mainLine = new Line2(this.mainGeo, lineMat());
    this.mainLine.frustumCulled = false;
    this.mainLine.renderOrder = 4;
    this.group.add(this.mainLine);

    for (let i = 0; i < WORLD.hookOffsets.length; i++) {
      const g = new LineGeometry();
      g.setPositions(new Array(BRANCH_POINTS * 3).fill(0));
      g.setColors(new Array(BRANCH_POINTS * 3).fill(1));
      const m = lineMat();
      m.linewidth = 1.05;
      const l = new Line2(g, m);
      l.frustumCulled = false;
      l.renderOrder = 4;
      this.branchGeos.push(g);
      this.branchLines.push(l);
      this.group.add(l);
    }

    const rodGeo = new LineGeometry();
    rodGeo.setPositions(new Array(4 * 3).fill(0));
    rodGeo.setColors(new Array(4 * 3).fill(1));
    this.rodLine = new Line2(rodGeo, lineMat());
    this.rodLine.frustumCulled = false;
    this.group.add(this.rodLine);

    // teardrop lead sinker
    const profile: THREE.Vector2[] = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      const r = 0.0135 * Math.sin(Math.pow(t, 0.72) * Math.PI) * (1 + 0.35 * (1 - t));
      profile.push(new THREE.Vector2(Math.max(0.0006, r), 0.062 * (1 - t) - 0.031));
    }
    const sinkerMat = new THREE.MeshPhysicalMaterial({
      color: 0x53565a,
      metalness: 0.72,
      roughness: 0.52,
      envMap: opts.env,
      envMapIntensity: 0.6,
      clearcoat: 0.1,
    });
    applyUnderwaterFade(sinkerMat, DEEP, 3.4);
    this.sinker = new THREE.Mesh(new THREE.LatheGeometry(profile, 18), sinkerMat);
    this.sinker.castShadow = true;
    this.group.add(this.sinker);

    this.drops = new DropSystem(dropCapacity, opts.env, opts.transmission, DEEP);
    this.group.add(this.drops.mesh);
  }

  setLineResolution(w: number, h: number, dpr: number): void {
    const px = Math.max(1.15, Math.min(2.6, 1.25 * dpr));
    const apply = (l: Line2, scale: number) => {
      const m = l.material as LineMaterial;
      m.resolution.set(w, h);
      m.linewidth = px * scale;
      m.needsUpdate = true;
    };
    apply(this.mainLine, 1);
    apply(this.rodLine, 1);
    for (const b of this.branchLines) apply(b, 0.78);
  }

  setDropCapacity(n: number): void {
    this.drops.setCapacity(n);
  }

  private prepared: FishMeshes[] = [];
  private consumed = 0;

  /** Build the round's three possible fish while nothing is moving, so attaching one
   *  at a bite costs nothing and the reveal never stalls. */
  prepareRound(seedBase: number): void {
    // anything already handed to the rig is owned elsewhere by now
    for (let i = this.consumed; i < this.prepared.length; i++) this.disposeFish(this.prepared[i]);
    this.prepared = [];
    this.consumed = 0;
    for (let i = 0; i < WORLD.hookOffsets.length; i++) {
      const form = randomForm(seedBase * 7919 + i * 104729 + 13);
      this.prepared.push(buildFish(form, this.materials, this.buildOpts));
    }
  }

  /** Attach the next fish, top hook first. Called while the rig is still down,
   *  never during the wind. */
  addFish(): void {
    const slot = this.fishes.length;
    if (slot >= WORLD.hookOffsets.length) return;
    const meshes = this.prepared[slot];
    if (!meshes) return;
    this.group.add(meshes.group);
    this.consumed = slot + 1;
    this.fishes.push({
      meshes,
      slot,
      swingX: new Oscillator(5.6 + slot * 0.42, 0.14),
      swingZ: new Oscillator(5.9 + slot * 0.37, 0.15),
      yawPhase: (slot * 2.1 + meshes.form.seed * 0.0007) % 6.283,
      yawRate: 0.55 + slot * 0.13,
      rollPhase: (slot * 1.37 + meshes.form.seed * 0.0011) % 6.283,
      wriggle: 1,
      outOfWater: 0,
      dripTimer: 0,
      crossed: false,
    });
    this.fishCount = this.fishes.length;
  }

  /** Hand a fish over to the un-hooking sequence; the rig stops driving it. */
  detach(slot: number): FishMeshes | null {
    const i = this.fishes.findIndex((f) => f.slot === slot);
    if (i < 0) return null;
    const f = this.fishes[i];
    this.fishes.splice(i, 1);
    this.fishCount = this.fishes.length;
    return f.meshes;
  }

  disposeFish(m: FishMeshes): void {
    m.body.geometry.dispose();
    m.fins.geometry.dispose();
  }

  clearFish(): void {
    for (const f of this.fishes) {
      this.group.remove(f.meshes.group);
      this.disposeFish(f.meshes);
    }
    this.fishes = [];
    this.fishCount = 0;
    this.drops.clear();
  }

  reset(): void {
    this.reelSpeed = 0;
    this.motor = 0;
    this.pressing = false;
    this.swayX1.reset();
    this.swayX2.reset();
    this.swayZ1.reset();
    this.swayZ2.reset();
  }

  get windProgress(): number {
    const span = WORLD.lineOutDeployed - WORLD.lineOutMin;
    return THREE.MathUtils.clamp((WORLD.lineOutDeployed - this.lineOut) / span, 0, 1);
  }

  get fullyIn(): boolean {
    return this.lineOut <= WORLD.lineOutMin + 1e-4;
  }

  hookY(slot: number): number {
    return WORLD.rodTip.y - this.lineOut + WORLD.hookOffsets[slot];
  }

  get sinkerY(): number {
    return WORLD.rodTip.y - this.lineOut;
  }

  /** Mouth of the topmost fish — the point that actually breaks the surface. */
  get topFishY(): number {
    return this.fishCount > 0 ? this.hookY(0) - BRANCH_LEN * 0.86 : this.sinkerY;
  }

  /** Line-out at which hook `slot` reaches the surface — derived purely from branch spacing. */
  static surfaceLineOut(slot: number): number {
    return WORLD.rodTip.y + WORLD.hookOffsets[slot];
  }

  /** Position on the mainline, `d` metres below the rod tip. */
  pointAt(d: number, out = new THREE.Vector3()): THREE.Vector3 {
    const y = WORLD.rodTip.y - d;
    const s = THREE.MathUtils.clamp(d / Math.max(this.lineOut, 1e-3), 0, 1);
    const m1 = Math.sin((Math.PI * s) / 2);
    const m2 = Math.sin((3 * Math.PI * s) / 2) * 0.35;
    const damp = y < 0 ? Math.exp(y * 5.0) : 1;
    const ox = (this.swayX1.value * m1 + this.swayX2.value * m2) * damp;
    const oz = (this.swayZ1.value * m1 + this.swayZ2.value * m2) * damp;
    const tipBlend = Math.exp(-d * 4.5);
    return out.set(
      WORLD.rodTip.x + ox + this.tipOffset.x * tipBlend,
      y + this.tipOffset.y * tipBlend,
      WORLD.rodTip.z + oz + this.tipOffset.z * tipBlend,
    );
  }

  private pointFromSinker(fromSinker: number, out = new THREE.Vector3()): THREE.Vector3 | null {
    const d = this.lineOut - fromSinker;
    if (d < 0.02 || d > this.lineOut) return null;
    return this.pointAt(d, out);
  }

  update(dt: number, time: number, allowWind: boolean, cb: RigCallbacks): void {
    // --- motor and spool: one state drives both the reel and the line speed
    const target = this.pressing && allowWind && !this.fullyIn ? 1 : 0;
    const rate = target > this.motor ? 2.1 : 3.4;
    this.motor += THREE.MathUtils.clamp(target - this.motor, -rate * dt, rate * dt);
    this.reelSpeed = WORLD.windSpeed * this.motor;
    const prevLineOut = this.lineOut;
    if (this.reelSpeed > 0) {
      this.lineOut = Math.max(WORLD.lineOutMin, this.lineOut - this.reelSpeed * dt);
    }
    const moved = prevLineOut - this.lineOut;
    this.spoolAngle += moved / WORLD.spoolRadius;

    // --- mainline sway; winding pulls it onto the vertical axis
    this.ambient += dt;
    const gust = Math.sin(this.ambient * 0.63) * 0.4 + Math.sin(this.ambient * 1.31 + 1.2) * 0.22;
    const extra = this.motor * 1.5;
    this.swayX1.step(dt, extra, gust * 0.012 + (Math.sin(this.ambient * 2.7) * 0.004));
    this.swayX2.step(dt, extra * 1.3, Math.sin(this.ambient * 3.9 + 0.7) * 0.006);
    this.swayZ1.step(dt, extra, Math.cos(this.ambient * 0.71 + 2.0) * 0.011);
    this.swayZ2.step(dt, extra * 1.3, Math.cos(this.ambient * 4.3) * 0.005);

    // --- fish: branch swing, small self rotation, gentle wriggle
    for (const f of this.fishes) {
      const y = this.hookY(f.slot) - BRANCH_LEN * 0.86;
      const above = y > WORLD.waterY;
      if (above && !f.crossed) {
        f.crossed = true;
        cb.onFishSurface(f.slot);
        cb.onRipple(
          this.pointAt(this.lineOut - WORLD.hookOffsets[f.slot]).x,
          this.pointAt(this.lineOut - WORLD.hookOffsets[f.slot]).z,
          1.0,
        );
        f.dripTimer = 0;
      }
      if (above) f.outOfWater += dt;

      const drive = -moved * 26 + (Math.random() - 0.5) * (above ? 0.09 : 0.02) * f.wriggle;
      const dampBoost = this.motor * 1.1;
      f.swingX.step(dt, dampBoost, drive * Math.cos(f.yawPhase));
      f.swingZ.step(dt, dampBoost, drive * Math.sin(f.yawPhase * 1.3));
      f.wriggle = THREE.MathUtils.damp(f.wriggle, above ? 0.35 : 1, 0.35, dt);

      const anchor = this.pointAt(this.lineOut - WORLD.hookOffsets[f.slot], this.tmp);
      const ax = THREE.MathUtils.clamp(f.swingX.value, -0.4, 0.4);
      const az = THREE.MathUtils.clamp(f.swingZ.value, -0.4, 0.4);
      const dir = BRANCH_DIR[f.slot % BRANCH_DIR.length];
      const g = f.meshes.group;
      g.position.set(
        anchor.x + dir[0] * BRANCH_STANDOFF + Math.sin(ax) * BRANCH_LEN,
        anchor.y - Math.cos(ax) * BRANCH_LEN * 0.86,
        anchor.z + dir[1] * BRANCH_STANDOFF + Math.sin(az) * BRANCH_LEN,
      );
      const yaw = f.yawPhase + Math.sin(time * f.yawRate + f.rollPhase) * (above ? 0.42 : 0.14);
      g.rotation.set(az * 0.85, yaw, -ax * 0.9);
      g.updateMatrixWorld();

      // dripping starts once the body clears the surface
      if (above && f.outOfWater < 6) {
        f.dripTimer -= dt;
        if (f.dripTimer <= 0) {
          f.dripTimer = 0.16 + Math.random() * 0.5 + f.outOfWater * 0.12;
          const L = f.meshes.form.length;
          this.drops.spawnOnFish(
            f.slot,
            new THREE.Vector3(
              L * (0.15 + Math.random() * 0.8),
              (Math.random() - 0.5) * f.meshes.form.depth * 1.1,
              (Math.random() - 0.5) * f.meshes.form.width * 1.4,
            ),
            0.0011 + Math.random() * 0.0016,
            0.15 + Math.random() * 0.7,
          );
        }
      }
    }

    // --- sinker
    const sp = this.pointAt(this.lineOut, this.tmp);
    this.sinker.position.copy(sp);
    this.sinker.rotation.z = Math.sin(time * 0.8) * 0.06;
    if (!this.sinkerCrossed && sp.y > WORLD.waterY) {
      this.sinkerCrossed = true;
      cb.onSinkerSurface();
      cb.onRipple(sp.x, sp.z, 0.8);
    }

    // --- beads picked up as the line leaves the water
    if (moved > 0) {
      this.lineSpawnAccum += moved;
      while (this.lineSpawnAccum > this.nextDropGap) {
        this.lineSpawnAccum -= this.nextDropGap;
        // irregular spacing and size: beads on a line are never a row of pearls
        this.nextDropGap = 0.018 + Math.random() * Math.random() * 0.16;
        // the bead is pinned to the length of line that is leaving the water
        // right now, so it rides upward as the spool takes line in
        const belowSurface = this.lineOut - WORLD.rodTip.y;
        if (belowSurface > 0.05 && Math.random() < 0.75) {
          this.drops.spawnOnLine(
            belowSurface + (Math.random() - 0.5) * 0.02,
            0.0006 + Math.random() * Math.random() * 0.0021,
            0.35 + Math.random() * Math.random() * 3.2,
          );
        }
      }
      const entry = this.pointAt(Math.min(this.lineOut, WORLD.rodTip.y));
      if (this.lineOut > WORLD.rodTip.y && Math.random() < dt * 9) {
        cb.onRipple(entry.x, entry.z, 0.3 + this.motor * 0.35);
      }
    }

    this.drops.update(
      dt,
      (fs) => this.pointFromSinker(fs),
      (host) => {
        const f = this.fishes.find((x) => x.slot === host);
        return f ? f.meshes.group.matrixWorld : null;
      },
      (x, z, s) => cb.onRipple(x, z, s),
    );

    this.updateLines();
  }

  private sinkerCrossed = false;

  resetSurfaceFlags(): void {
    this.sinkerCrossed = false;
  }

  private updateLines(): void {
    const p = new THREE.Vector3();
    for (let i = 0; i < MAIN_POINTS; i++) {
      const d = (i / (MAIN_POINTS - 1)) * this.lineOut;
      this.pointAt(d, p);
      this.mainPositions[i * 3] = p.x;
      this.mainPositions[i * 3 + 1] = p.y;
      this.mainPositions[i * 3 + 2] = p.z;
      const c = this.lineShade(p.y);
      this.mainColors[i * 3] = c * 1.0;
      this.mainColors[i * 3 + 1] = c * 1.02;
      this.mainColors[i * 3 + 2] = c * 1.06;
    }
    this.mainGeo.setPositions(this.mainPositions);
    this.mainGeo.setColors(this.mainColors);
    this.mainGeo.computeBoundingSphere();

    for (let b = 0; b < this.branchLines.length; b++) {
      const anchor = this.pointAt(this.lineOut - WORLD.hookOffsets[b], p).clone();
      const f = this.fishes.find((x) => x.slot === b);
      const dir = BRANCH_DIR[b % BRANCH_DIR.length];
      const end = f
        ? f.meshes.group.position
        : new THREE.Vector3(
            anchor.x + dir[0] * BRANCH_STANDOFF * 0.7 + Math.sin(this.ambient * 1.3 + b) * 0.01,
            anchor.y - BRANCH_LEN * 0.88,
            anchor.z + dir[1] * BRANCH_STANDOFF * 0.7 + Math.cos(this.ambient * 1.1 + b * 2) * 0.01,
          );
      for (let i = 0; i < BRANCH_POINTS; i++) {
        const t = i / (BRANCH_POINTS - 1);
        const x = anchor.x + (end.x - anchor.x) * t;
        const y = anchor.y + (end.y - anchor.y) * t - Math.sin(t * Math.PI) * 0.004;
        const z = anchor.z + (end.z - anchor.z) * t;
        this.branchBuf[i * 3] = x;
        this.branchBuf[i * 3 + 1] = y;
        this.branchBuf[i * 3 + 2] = z;
        const c = this.lineShade(y);
        this.branchCol[i * 3] = c;
        this.branchCol[i * 3 + 1] = c * 1.02;
        this.branchCol[i * 3 + 2] = c * 1.06;
      }
      this.branchGeos[b].setPositions(this.branchBuf);
      this.branchGeos[b].setColors(this.branchCol);
      this.branchGeos[b].computeBoundingSphere();
    }

    // the length lying along the rod, from the spool to the tip
    const reel = WORLD.reelPos;
    const tip = WORLD.rodTip;
    const pts: number[] = [];
    const cols: number[] = [];
    for (let i = 0; i < 4; i++) {
      const t = i / 3;
      pts.push(
        reel.x + (tip.x - reel.x) * t,
        reel.y + (tip.y - reel.y) * t - Math.sin(t * Math.PI) * 0.006,
        reel.z + (tip.z - reel.z) * t,
      );
      cols.push(0.78, 0.8, 0.84);
    }
    (this.rodLine.geometry as LineGeometry).setPositions(pts);
    (this.rodLine.geometry as LineGeometry).setColors(cols);
  }

  /** Above water the line stays bright; below it loses contrast fast. */
  private lineShade(y: number): number {
    if (y >= 0) return 0.86;
    return 0.86 * Math.exp(y * 4.0) + 0.02;
  }
}
