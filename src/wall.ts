import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { WallKind } from './audio';
import { DebrisSystem } from './debris';
import { DustSystem } from './dust';
import { clamp, hash2, randRange } from './math';
import {
  brickFaceTexture,
  blockFaceTexture,
  concreteTexture,
  crackDecalTexture,
  cellTone,
} from './textures';

export interface ImpactResult {
  destroyed: number;
  damaged: number;
  energy: number; // 0..1 normalized
  point: THREE.Vector3;
}

interface Cell {
  alive: boolean;
  hp: number;
  maxHp: number;
  shellBroken: boolean; // block only: cavity exposed
  x: number; // local center x
  y: number; // local center y
  w: number;
  h: number;
  slot: number; // instance index
  falling: boolean;
  fallAt: number; // scheduled time
}

interface MaterialSpec {
  kind: WallKind;
  cols: number;
  rows: number;
  cellW: number;
  cellH: number;
  depth: number;
  hp: number;
  /** below this normalized impact energy the material only chips/cracks */
  energyMin: number;
  /** radius fully destroyed at maximum energy */
  destroyRadiusMax: number;
  /** width of the damaged/cracked annulus beyond the destroyed core */
  crackWidth: number;
  /** hp damage scale inside the annulus */
  crackDmg: number;
  /** annulus damage saturates at this energy (keeps tough walls tough) */
  crackEnergyCap: number;
  baseColor: THREE.Color;
  dustColor: THREE.Color;
  toneSpread: number;
  staggered: boolean;
}

const SPECS: Record<WallKind, MaterialSpec> = {
  brick: {
    kind: 'brick',
    cols: 11,
    rows: 14,
    cellW: 0.62,
    cellH: 0.3,
    depth: 0.36,
    hp: 1.0,
    energyMin: 0.085,
    destroyRadiusMax: 1.02,
    crackWidth: 0.5,
    crackDmg: 1.7,
    crackEnergyCap: 1.35,
    baseColor: new THREE.Color('#a45a42'),
    dustColor: new THREE.Color('#b98a6c'),
    toneSpread: 0.09,
    staggered: true,
  },
  block: {
    kind: 'block',
    cols: 9,
    rows: 11,
    cellW: 0.78,
    cellH: 0.4,
    depth: 0.4,
    hp: 2.0,
    energyMin: 0.13,
    destroyRadiusMax: 0.92,
    crackWidth: 0.7,
    crackDmg: 2.4,
    crackEnergyCap: 0.95,
    baseColor: new THREE.Color('#a09c93'),
    dustColor: new THREE.Color('#a8a49a'),
    toneSpread: 0.06,
    staggered: true,
  },
  concrete: {
    kind: 'concrete',
    cols: 8,
    rows: 7,
    cellW: 0.9,
    cellH: 0.64,
    depth: 0.26,
    hp: 2.3,
    energyMin: 0.26,
    destroyRadiusMax: 0.78,
    crackWidth: 0.95,
    crackDmg: 5.0,
    crackEnergyCap: 0.5,
    baseColor: new THREE.Color('#a3a19b'),
    dustColor: new THREE.Color('#b0aea6'),
    toneSpread: 0.045,
    staggered: false,
  },
};

const HIDDEN = new THREE.Matrix4().compose(
  new THREE.Vector3(0, -100, 0),
  new THREE.Quaternion(),
  new THREE.Vector3(0.0001, 0.0001, 0.0001)
);

/**
 * A free-standing demolition test wall built from pre-fractured units.
 * Damage is applied locally around the impact point; units that lose their
 * bearing (nothing overlapping below) collapse with a staggered delay so
 * heavy pieces fall a beat after the hit.
 */
export class Wall {
  readonly group = new THREE.Group();
  readonly kind: WallKind;
  readonly spec: MaterialSpec;
  readonly width: number;
  readonly height: number;
  readonly frontZ: number;

  private cells: Cell[][] = [];
  private intactMesh: THREE.InstancedMesh;
  private brokenMesh: THREE.InstancedMesh | null = null; // block cavity state
  private rebarGroup = new THREE.Group();
  private decals: THREE.Mesh[] = [];
  private decalCursor = 0;
  private collapseQueue: Cell[] = [];
  private time = 0;
  private totalCells: number;
  private destroyedCells = 0;
  private dummy = new THREE.Object3D();

  constructor(kind: WallKind, private debris: DebrisSystem) {
    this.kind = kind;
    const spec = SPECS[kind];
    this.spec = spec;
    this.width = spec.cols * spec.cellW;
    this.height = spec.rows * spec.cellH;
    this.frontZ = -spec.depth / 2;
    this.totalCells = spec.cols * spec.rows;

    const geo = new THREE.BoxGeometry(1, 1, 1);
    let tex: THREE.Texture;
    if (kind === 'brick') tex = brickFaceTexture();
    else if (kind === 'block') tex = blockFaceTexture();
    else tex = concreteTexture();
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.93,
      metalness: 0.0,
    });
    this.intactMesh = new THREE.InstancedMesh(geo, mat, this.totalCells);
    this.intactMesh.castShadow = true;
    this.intactMesh.receiveShadow = true;
    this.group.add(this.intactMesh);

    if (kind === 'block') {
      // open-fronted shell: back plate + two side webs + top/bottom lips
      const parts: THREE.BufferGeometry[] = [];
      const back = new THREE.BoxGeometry(1, 1, 0.3);
      back.translate(0, 0, 0.35);
      parts.push(back);
      for (const sx of [-0.42, 0.42]) {
        const web = new THREE.BoxGeometry(0.16, 1, 0.7);
        web.translate(sx, 0, 0);
        parts.push(web);
      }
      const mid = new THREE.BoxGeometry(0.14, 1, 0.7);
      parts.push(mid);
      const shellGeo = mergeGeometries(parts)!;
      const shellMat = new THREE.MeshStandardMaterial({
        map: blockFaceTexture(),
        color: new THREE.Color('#7d7a73'),
        roughness: 0.97,
      });
      this.brokenMesh = new THREE.InstancedMesh(shellGeo, shellMat, this.totalCells);
      this.brokenMesh.castShadow = true;
      this.brokenMesh.receiveShadow = true;
      this.group.add(this.brokenMesh);
    }

    if (kind === 'concrete') {
      // pooled radial crack decals
      const decalMat = new THREE.MeshBasicMaterial({
        map: crackDecalTexture(),
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      });
      for (let i = 0; i < 6; i++) {
        const d = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), decalMat.clone());
        (d.material as THREE.MeshBasicMaterial).map = crackDecalTexture();
        d.visible = false;
        d.rotation.y = Math.PI; // face -z
        this.decals.push(d);
        this.group.add(d);
      }
    }

    this.group.add(this.rebarGroup);
    this.buildCells();
  }

  private buildCells(): void {
    const s = this.spec;
    this.cells = [];
    let slot = 0;
    for (let r = 0; r < s.rows; r++) {
      const row: Cell[] = [];
      const offset = s.staggered && r % 2 === 1 ? s.cellW / 2 : 0;
      for (let c = 0; c < s.cols; c++) {
        let x = -this.width / 2 + s.cellW / 2 + c * s.cellW + offset;
        let w = s.cellW;
        // staggered rows: last unit wraps -> render as half unit at both ends
        if (s.staggered && r % 2 === 1 && c === s.cols - 1) {
          // split into a half at the right edge; a matching half at the left
          x = this.width / 2 - s.cellW / 4;
          w = s.cellW / 2;
        }
        const cell: Cell = {
          alive: true,
          hp: s.hp * (0.9 + hash2(c * 1.3, r * 2.7) * 0.25),
          maxHp: s.hp,
          shellBroken: false,
          x,
          y: s.cellH / 2 + r * s.cellH,
          w,
          h: s.cellH,
          slot: slot++,
          falling: false,
          fallAt: 0,
        };
        row.push(cell);
      }
      // left half-brick for staggered rows
      if (s.staggered && r % 2 === 1) {
        const cell: Cell = {
          alive: true,
          hp: s.hp,
          maxHp: s.hp,
          shellBroken: false,
          x: -this.width / 2 + s.cellW / 4,
          y: s.cellH / 2 + r * s.cellH,
          w: s.cellW / 2,
          h: s.cellH,
          slot: slot++,
          falling: false,
          fallAt: 0,
        };
        row.push(cell);
        this.totalCells++;
      }
      this.cells.push(row);
    }
    // instanced meshes may need more room for extra half bricks
    if (this.intactMesh.count < this.totalCells) {
      // rebuild instanced mesh with the exact count
      const old = this.intactMesh;
      this.intactMesh = new THREE.InstancedMesh(old.geometry, old.material, this.totalCells);
      this.intactMesh.castShadow = true;
      this.intactMesh.receiveShadow = true;
      this.group.remove(old);
      old.dispose();
      this.group.add(this.intactMesh);
      if (this.brokenMesh) {
        const oldB = this.brokenMesh;
        this.brokenMesh = new THREE.InstancedMesh(oldB.geometry, oldB.material, this.totalCells);
        this.brokenMesh.castShadow = true;
        this.brokenMesh.receiveShadow = true;
        this.group.remove(oldB);
        oldB.dispose();
        this.group.add(this.brokenMesh);
      }
    }
    this.writeAll();
  }

  private writeAll(): void {
    const s = this.spec;
    for (const row of this.cells) {
      for (const cell of row) {
        if (!cell.alive) {
          this.intactMesh.setMatrixAt(cell.slot, HIDDEN);
          this.brokenMesh?.setMatrixAt(cell.slot, HIDDEN);
          continue;
        }
        this.writeCell(cell);
        const rr = this.cells.indexOf(row);
        const tone = cellTone(Math.round(cell.x * 10), rr, s.baseColor, s.toneSpread);
        this.intactMesh.setColorAt(cell.slot, tone);
        this.brokenMesh?.setColorAt(cell.slot, tone.clone().multiplyScalar(0.85));
      }
    }
    this.intactMesh.instanceMatrix.needsUpdate = true;
    if (this.intactMesh.instanceColor) this.intactMesh.instanceColor.needsUpdate = true;
    if (this.brokenMesh) {
      this.brokenMesh.instanceMatrix.needsUpdate = true;
      if (this.brokenMesh.instanceColor) this.brokenMesh.instanceColor.needsUpdate = true;
    }
  }

  private writeCell(cell: Cell): void {
    const s = this.spec;
    this.dummy.position.set(cell.x, cell.y, 0);
    this.dummy.rotation.set(0, 0, 0);
    // tiny per-unit imperfection so courses do not read as machine-perfect
    if (this.kind === 'concrete') {
      this.dummy.scale.set(cell.w * 1.001, cell.h * 1.001, s.depth);
    } else {
      const j = hash2(cell.x * 31.7, cell.y * 17.3);
      this.dummy.rotation.z = (j - 0.5) * 0.012;
      this.dummy.scale.set(cell.w * 0.985, cell.h * 0.97, s.depth);
    }
    this.dummy.updateMatrix();
    if (cell.shellBroken && this.brokenMesh) {
      this.intactMesh.setMatrixAt(cell.slot, HIDDEN);
      this.brokenMesh.setMatrixAt(cell.slot, this.dummy.matrix);
    } else {
      this.intactMesh.setMatrixAt(cell.slot, this.dummy.matrix);
      this.brokenMesh?.setMatrixAt(cell.slot, HIDDEN);
    }
  }

  private tintDamage(cell: Cell, rowIdx: number): void {
    const s = this.spec;
    const t = clamp(cell.hp / cell.maxHp, 0, 1);
    const tone = cellTone(Math.round(cell.x * 10), rowIdx, s.baseColor, s.toneSpread);
    tone.multiplyScalar(0.55 + 0.45 * t); // cracked units darken with soot/fracture
    this.intactMesh.setColorAt(cell.slot, tone);
    this.brokenMesh?.setColorAt(cell.slot, tone.multiplyScalar(0.85));
  }

  destructionRatio(): number {
    return this.destroyedCells / this.totalCells;
  }

  /**
   * Test the ball sphere against remaining units near the front face.
   * Returns the contact point in world space, or null.
   */
  testBallContact(ballPos: THREE.Vector3, ballR: number, ballVel: THREE.Vector3): THREE.Vector3 | null {
    if (ballVel.z < 0.25) return null; // must be moving into the wall
    const s = this.spec;
    if (ballPos.z + ballR < this.frontZ) return null;
    if (ballPos.z > s.depth) return null; // already through
    if (Math.abs(ballPos.x) > this.width / 2 + ballR) return null;
    if (ballPos.y > this.height + ballR || ballPos.y < -ballR) return null;
    // is there anything left to hit near the contact circle?
    const hitR = ballR * 0.85;
    for (const row of this.cells) {
      for (const cell of row) {
        if (!cell.alive || cell.falling) continue;
        const dx = Math.max(Math.abs(ballPos.x - cell.x) - cell.w / 2, 0);
        const dy = Math.max(Math.abs(ballPos.y - cell.y) - cell.h / 2, 0);
        if (dx * dx + dy * dy < hitR * hitR) {
          return new THREE.Vector3(
            clamp(ballPos.x, -this.width / 2, this.width / 2),
            clamp(ballPos.y, 0.05, this.height),
            this.frontZ
          );
        }
      }
    }
    return null;
  }

  /**
   * Apply an impact at `point` (world == wall local here) with the ball's
   * velocity. Returns what happened so game/camera/audio can react.
   */
  applyImpact(point: THREE.Vector3, vel: THREE.Vector3, dustSys: DustSystem): ImpactResult {
    const s = this.spec;
    const speed = vel.length();
    const energy = clamp((speed * speed) / 64, 0, 1.35); // 1.0 at 8 m/s
    const dir = vel.clone().normalize();

    // energy above the material threshold carves a hole whose radius grows
    // continuously with the surplus; below it, only cracks and chips
    let destroyR = 0;
    if (energy > s.energyMin) {
      const surplus = clamp((energy - s.energyMin) / (1 - s.energyMin), 0, 1);
      destroyR = s.destroyRadiusMax * Math.pow(surplus, 0.72);
    }
    const crackR = destroyR + s.crackWidth + energy * 0.35;

    let destroyed = 0;
    let damaged = 0;
    let nearest: { cell: Cell; r: number; d: number } | null = null;
    for (let r = 0; r < this.cells.length; r++) {
      for (const cell of this.cells[r]) {
        if (!cell.alive || cell.falling) continue;
        const dx = cell.x - point.x;
        const dy = cell.y - point.y;
        const d = Math.hypot(dx, dy);
        if (!nearest || d < nearest.d) nearest = { cell, r, d };
        if (d > crackR) continue;
        if (d <= destroyR) {
          const falloff = 1 - d / Math.max(crackR, 0.001);
          this.killCell(cell, r, dir, speed * 0.32 * (0.45 + falloff * 0.55), false);
          destroyed++;
          continue;
        }
        const t = (d - destroyR) / Math.max(crackR - destroyR, 0.001);
        const dmg = Math.min(energy, s.crackEnergyCap) * s.crackDmg * (1 - t);
        if (dmg < 0.03) continue;
        cell.hp -= dmg;
        if (cell.hp <= 0) {
          this.killCell(cell, r, dir, speed * 0.24, false);
          destroyed++;
        } else {
          damaged++;
          if (this.kind === 'block' && !cell.shellBroken && cell.hp < cell.maxHp * 0.55) {
            // outer shell spalls off, cavity shows
            cell.shellBroken = true;
            this.spawnShellPlates(cell, dir, speed * 0.25);
          }
          this.tintDamage(cell, r);
          this.writeCell(cell);
        }
      }
    }
    // a solid hit always takes at least one unit out of the face
    if (destroyed === 0 && energy > s.energyMin * 1.35 && nearest && nearest.d < 0.7) {
      this.killCell(nearest.cell, nearest.r, dir, speed * 0.28, false);
      destroyed++;
    }

    // guaranteed local response even on a soft touch: chips and dust
    const chipN = 1 + Math.floor(energy * 3);
    for (let i = 0; i < chipN; i++) {
      this.debris.spawn(
        this.kind,
        'chunk',
        new THREE.Vector3(point.x + randRange(-0.2, 0.2), point.y + randRange(-0.2, 0.2), this.frontZ),
        new THREE.Vector3(randRange(-1, 1) - dir.x, randRange(0.5, 1.6), -randRange(1, 2.4)),
        new THREE.Vector3(0.09, 0.07, 0.08).multiplyScalar(randRange(0.7, 1.5)),
        s.baseColor.clone().multiplyScalar(randRange(0.8, 1.05))
      );
    }
    const normal = new THREE.Vector3(0, 0, -1);
    dustSys.burst(point, normal, s.dustColor, Math.round(10 + energy * 26), 1.6 + energy * 2.4);

    if (this.kind === 'concrete' && energy > 0.12) {
      this.placeCrackDecal(point, 0.5 + crackR * 0.6);
    }

    if (destroyed > 0) {
      this.scheduleSupportCheck();
    }

    this.intactMesh.instanceMatrix.needsUpdate = true;
    if (this.intactMesh.instanceColor) this.intactMesh.instanceColor.needsUpdate = true;
    if (this.brokenMesh) {
      this.brokenMesh.instanceMatrix.needsUpdate = true;
      if (this.brokenMesh.instanceColor) this.brokenMesh.instanceColor.needsUpdate = true;
    }
    return { destroyed, damaged, energy, point: point.clone() };
  }

  private placeCrackDecal(point: THREE.Vector3, radius: number): void {
    const d = this.decals[this.decalCursor % this.decals.length];
    this.decalCursor++;
    d.visible = true;
    d.position.set(point.x, point.y, this.frontZ - 0.012);
    d.rotation.z = randRange(0, Math.PI * 2);
    const sc = radius * 2.4;
    d.scale.set(sc, sc, 1);
  }

  private spawnShellPlates(cell: Cell, dir: THREE.Vector3, speed: number): void {
    const s = this.spec;
    for (let i = 0; i < 2; i++) {
      this.debris.spawn(
        this.kind,
        'plate',
        new THREE.Vector3(cell.x + randRange(-0.1, 0.1), cell.y + randRange(-0.1, 0.1), this.frontZ),
        new THREE.Vector3(dir.x * speed * 0.4 + randRange(-0.6, 0.6), randRange(0.2, 1), -randRange(0.8, 2)),
        new THREE.Vector3(cell.w * randRange(0.35, 0.6), cell.h * randRange(0.5, 0.9), 0.05),
        s.baseColor.clone().multiplyScalar(randRange(0.85, 1.0))
      );
    }
  }

  /** Remove the unit and turn it into material-appropriate debris. */
  private killCell(cell: Cell, rowIdx: number, dir: THREE.Vector3, speed: number, byCollapse: boolean): void {
    const s = this.spec;
    cell.alive = false;
    this.destroyedCells++;
    this.intactMesh.setMatrixAt(cell.slot, HIDDEN);
    this.brokenMesh?.setMatrixAt(cell.slot, HIDDEN);
    const base = new THREE.Vector3(cell.x, cell.y, 0);
    const tone = cellTone(Math.round(cell.x * 10), rowIdx, s.baseColor, s.toneSpread);

    const vel = (spread: number, punch: number): THREE.Vector3 =>
      byCollapse
        ? new THREE.Vector3(randRange(-0.3, 0.3), randRange(-0.4, 0), randRange(-0.5, 0.2))
        : new THREE.Vector3(
            dir.x * speed * punch + randRange(-spread, spread),
            Math.abs(dir.y) * speed * 0.3 + randRange(-0.2, spread),
            dir.z * speed * punch * 0.55 + randRange(-spread * 0.4, spread * 0.2)
          );

    if (this.kind === 'brick') {
      // the brick itself survives as a piece, mortar goes to dust
      this.debris.spawn(this.kind, 'box', base, vel(1.2, 1), new THREE.Vector3(cell.w * 0.95, cell.h * 0.92, s.depth * 0.95), tone);
      if (Math.random() > 0.5) {
        this.debris.spawn(
          this.kind,
          'box',
          base.clone().add(new THREE.Vector3(randRange(-0.15, 0.15), 0.05, 0)),
          vel(1.6, 0.8),
          new THREE.Vector3(cell.w * 0.4, cell.h * 0.6, s.depth * 0.5),
          tone.clone().multiplyScalar(0.9)
        );
      }
    } else if (this.kind === 'block') {
      // shell plates + a heavier web piece
      this.debris.spawn(this.kind, 'plate', base.clone().setZ(this.frontZ + 0.03), vel(1.0, 1.1), new THREE.Vector3(cell.w * 0.8, cell.h * 0.75, 0.06), tone);
      this.debris.spawn(this.kind, 'plate', base.clone().setZ(-this.frontZ - 0.03), vel(1.0, 0.9), new THREE.Vector3(cell.w * 0.6, cell.h * 0.8, 0.06), tone.clone().multiplyScalar(0.92));
      this.debris.spawn(this.kind, 'box', base, vel(0.8, 0.7), new THREE.Vector3(cell.w * 0.45, cell.h * 0.85, s.depth * 0.5), tone.clone().multiplyScalar(0.8));
    } else {
      // concrete: one heavy chunk, a couple of smaller ones, rebar stays
      this.debris.spawn(this.kind, 'chunk', base, vel(0.5, 0.8), new THREE.Vector3(cell.w * 0.85, cell.h * 0.8, s.depth * 1.6), tone);
      const n = 1 + ((Math.random() * 2) | 0);
      for (let i = 0; i < n; i++) {
        this.debris.spawn(
          this.kind,
          'chunk',
          base.clone().add(new THREE.Vector3(randRange(-0.3, 0.3), randRange(-0.2, 0.2), 0)),
          vel(1.4, 0.9),
          new THREE.Vector3(cell.w * 0.3, cell.h * 0.3, s.depth).multiplyScalar(randRange(0.7, 1.2)),
          tone.clone().multiplyScalar(randRange(0.85, 1))
        );
      }
      this.maybeAddRebar(cell);
    }
  }

  private maybeAddRebar(cell: Cell): void {
    if (this.rebarGroup.children.length >= 22) return;
    const mat = new THREE.MeshStandardMaterial({ color: '#5a4638', roughness: 0.7, metalness: 0.5 });
    const n = 1 + ((Math.random() * 2) | 0);
    for (let i = 0; i < n; i++) {
      const horizontal = Math.random() > 0.4;
      const len = randRange(0.3, 0.6);
      const g = new THREE.CylinderGeometry(0.016, 0.016, len, 5);
      const rod = new THREE.Mesh(g, mat);
      if (horizontal) {
        rod.rotation.z = Math.PI / 2 + randRange(-0.35, 0.35);
        rod.rotation.y = randRange(-0.5, 0.5);
        rod.position.set(cell.x + (Math.random() > 0.5 ? 1 : -1) * cell.w * 0.4, cell.y + randRange(-0.2, 0.2), randRange(-0.04, 0.04));
      } else {
        rod.rotation.x = randRange(-0.35, 0.35);
        rod.rotation.z = randRange(-0.25, 0.25);
        rod.position.set(cell.x + randRange(-0.3, 0.3), cell.y + (Math.random() > 0.5 ? 1 : -1) * cell.h * 0.4, randRange(-0.04, 0.04));
      }
      this.rebarGroup.add(rod);
    }
  }

  /** After a hit, find units left hanging and let them come down in a cascade. */
  private scheduleSupportCheck(): void {
    const supported: boolean[][] = this.cells.map((row) => row.map(() => false));
    // bottom row is supported by the ground
    for (let r = 0; r < this.cells.length; r++) {
      for (let c = 0; c < this.cells[r].length; c++) {
        const cell = this.cells[r][c];
        if (!cell.alive || cell.falling) continue;
        if (r === 0) {
          supported[r][c] = true;
          continue;
        }
        // supported if any live unit in the row below overlaps >= 22% of width
        for (let bc = 0; bc < this.cells[r - 1].length; bc++) {
          const below = this.cells[r - 1][bc];
          if (!below.alive || below.falling || !supported[r - 1][bc]) continue;
          const overlap =
            Math.min(cell.x + cell.w / 2, below.x + below.w / 2) -
            Math.max(cell.x - cell.w / 2, below.x - below.w / 2);
          if (overlap > cell.w * 0.22) {
            supported[r][c] = true;
            break;
          }
        }
      }
    }
    for (let r = 1; r < this.cells.length; r++) {
      for (let c = 0; c < this.cells[r].length; c++) {
        const cell = this.cells[r][c];
        if (!cell.alive || cell.falling || supported[r][c]) continue;
        cell.falling = true;
        cell.fallAt = this.time + 0.12 + r * 0.045 + Math.random() * 0.1;
        this.collapseQueue.push(cell);
      }
    }
  }

  update(dt: number): number {
    this.time += dt;
    let fell = 0;
    if (this.collapseQueue.length > 0) {
      const dir = new THREE.Vector3(0, -1, 0);
      const remaining: Cell[] = [];
      for (const cell of this.collapseQueue) {
        if (cell.fallAt <= this.time) {
          const rowIdx = Math.floor(cell.y / this.spec.cellH);
          this.killCell(cell, rowIdx, dir, 0, true);
          fell++;
        } else {
          remaining.push(cell);
        }
      }
      this.collapseQueue = remaining;
      if (fell > 0) {
        this.intactMesh.instanceMatrix.needsUpdate = true;
        this.brokenMesh && (this.brokenMesh.instanceMatrix.needsUpdate = true);
        // a fall can undermine what is above it
        this.scheduleSupportCheck();
      }
    }
    return fell;
  }

  reset(): void {
    this.collapseQueue.length = 0;
    this.destroyedCells = 0;
    this.totalCells = 0;
    for (const row of this.cells) this.totalCells += row.length;
    for (const row of this.cells) {
      for (const cell of row) {
        cell.alive = true;
        cell.falling = false;
        cell.shellBroken = false;
        cell.hp = cell.maxHp * (0.9 + Math.random() * 0.25);
      }
    }
    for (const d of this.decals) d.visible = false;
    this.rebarGroup.clear();
    this.writeAll();
  }

  dispose(): void {
    this.group.removeFromParent();
  }
}
