import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import type { MaterialLibrary } from '../materials/MaterialLibrary';
import type { QualityProfile } from '../core/AdaptiveQuality';
import type { TreeHierarchy } from '../tree/TreeHierarchy';
import { TubeStrip, makePoints } from '../world/Cable';
import { Rng } from '../core/Rng';
import { clamp, damp, lerp } from '../core/math';

export const SECTOR_COUNT = 5;

interface Strand {
  azimuth: number;
  anchor: Vector3;
  points: Vector3[];
  tube: TubeStrip;
  /** Total pay-out length of this strand, fixed once it leaves the reel. */
  length: number;
}

/**
 * The light harness.
 *
 * Real plaza trees of this size are lit with pre-made sectioned harnesses, not
 * with fifty thousand individually placed bulbs: strands are hung as a vertical
 * curtain from a hoop at the leader and dropped to ground anchors, and each
 * sector is fed separately through a weatherproof connector. That is exactly
 * the sequence the player performs — pay out the reel, clip to the guide rope,
 * winch the hoop up, then confirm the sectors.
 */
export class LightHarness {
  readonly group = new Group();
  readonly lampGlass: InstancedMesh;
  readonly lampSockets: InstancedMesh;
  readonly connectors: Group[] = [];

  private readonly strands: Strand[] = [];
  private readonly glowAttr: InstancedBufferAttribute;
  private readonly lampStrand: number[] = [];
  private readonly lampU: number[] = [];
  private readonly lampSector: number[] = [];
  private readonly lampSpin: number[] = [];
  private readonly sectorGlow = new Float32Array(SECTOR_COUNT);
  private readonly sectorCentroid: Vector3[] = [];
  private readonly connectorMated: number[] = [];
  private readonly connectorTarget: number[] = [];
  private readonly hoop: Mesh;
  private readonly reel: Mesh;
  private readonly winchDrum: Mesh;
  private readonly guideRope: TubeStrip;
  private readonly guidePoints: Vector3[];
  private readonly tmpM = new Matrix4();
  private readonly tmpQ = new Quaternion();
  private readonly tmpV = new Vector3();
  private readonly tmpV2 = new Vector3();
  private readonly scaleOne = new Vector3(1, 1, 1);
  private readonly lampsPerStrand: number;
  private readonly topT = 0.93;
  private readonly anchorRadius: number;

  /** 0 = harness coiled on the reel, 1 = fully paid out on the paving. */
  payOut = 0;
  /** 0 = hoop on the ground, 1 = hoop at the leader, curtain hanging. */
  hoist = 0;
  private dirty = true;

  constructor(
    private readonly tree: TreeHierarchy,
    materials: MaterialLibrary,
    profile: QualityProfile,
    center: Vector3,
  ) {
    this.group.position.copy(center);
    const rng = new Rng(808);

    const strandCount = Math.max(12, Math.round(24 * clamp(profile.lampDensity, 0.4, 1.4)));
    this.lampsPerStrand = Math.max(24, Math.round(58 * clamp(profile.lampDensity, 0.4, 1.4)));
    // Curtain anchors sit just outside the finished crown, not out on the square.
    this.anchorRadius = 5.6;

    // Hoop at the leader that every strand hangs from.
    this.hoop = new Mesh(new TorusGeometry(0.55, 0.05, 6, 22), materials.galvanised);
    this.hoop.rotation.x = Math.PI / 2;
    this.group.add(this.hoop);

    // Cable reel and the hand winch that lifts the hoop up the guide rope.
    this.reel = new Mesh(new CylinderGeometry(0.95, 0.95, 1.1, 18), materials.cable);
    this.reel.rotation.z = Math.PI / 2;
    this.reel.position.set(-6.2, 1.0, 5.4);
    this.reel.castShadow = true;
    this.group.add(this.reel);
    for (const side of [-0.62, 0.62]) {
      const flange = new Mesh(new CylinderGeometry(1.15, 1.15, 0.08, 20), materials.craneEnamel);
      flange.rotation.z = Math.PI / 2;
      flange.position.set(-6.2 + side, 1.0, 5.4);
      this.group.add(flange);
    }
    const stand = new Mesh(new BoxGeometry(1.7, 1.0, 0.16), materials.craneDark);
    stand.position.set(-6.2, 0.5, 5.4);
    this.group.add(stand);

    this.winchDrum = new Mesh(new CylinderGeometry(0.26, 0.26, 0.44, 14), materials.craneEnamel);
    this.winchDrum.rotation.z = Math.PI / 2;
    this.winchDrum.position.set(2.9, 0.6, 1.4);
    this.group.add(this.winchDrum);

    this.guidePoints = makePoints(9);
    this.guideRope = new TubeStrip(8, 4, 0.02, materials.wireRope);
    this.group.add(this.guideRope.mesh);

    // ---- strands ---------------------------------------------------------
    for (let i = 0; i < strandCount; i++) {
      const azimuth = (i / strandCount) * Math.PI * 2 + rng.jitter(0.04);
      const r = this.anchorRadius * rng.range(0.94, 1.06);
      const anchor = new Vector3(Math.cos(azimuth) * r, 0.06, Math.sin(azimuth) * r);
      const tube = new TubeStrip(18, 4, 0.017, materials.cable);
      this.group.add(tube.mesh);
      this.strands.push({
        azimuth,
        anchor,
        points: makePoints(19),
        tube,
        length: tree.height * this.topT + r * 0.55 + 3,
      });
    }

    // ---- lamps -----------------------------------------------------------
    const lampTotal = strandCount * this.lampsPerStrand;
    const bulb = new SphereGeometry(0.05, 6, 5);
    const socket = new CylinderGeometry(0.028, 0.036, 0.075, 6);
    this.lampGlass = new InstancedMesh(bulb, materials.lampGlass, lampTotal);
    this.lampSockets = new InstancedMesh(socket, materials.lampSocket, lampTotal);
    this.lampGlass.frustumCulled = false;
    this.lampSockets.frustumCulled = false;
    this.group.add(this.lampGlass, this.lampSockets);

    const glow = new Float32Array(lampTotal);
    this.glowAttr = new InstancedBufferAttribute(glow, 1);
    this.glowAttr.setUsage(35048 /* DynamicDrawUsage */);
    bulb.setAttribute('aGlow', this.glowAttr);

    // Per-instance emission: a float attribute feeding the emissive term, so a
    // sector can come up on its own without one light per bulb.
    materials.lampGlass.onBeforeCompile = (shader) => {
      shader.vertexShader = `attribute float aGlow;\nvarying float vGlow;\n${shader.vertexShader}`.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n  vGlow = aGlow;',
      );
      shader.fragmentShader = `varying float vGlow;\n${shader.fragmentShader}`.replace(
        'vec3 totalEmissiveRadiance = emissive;',
        'vec3 totalEmissiveRadiance = emissive * vGlow;',
      );
    };
    materials.lampGlass.customProgramCacheKey = () => 'lamp-glow';

    for (let s = 0; s < strandCount; s++) {
      for (let j = 0; j < this.lampsPerStrand; j++) {
        this.lampStrand.push(s);
        this.lampU.push((j + 0.5) / this.lampsPerStrand);
        this.lampSpin.push(rng.range(0, Math.PI * 2));
        this.lampSector.push(0);
      }
    }

    // ---- sector distribution board and weatherproof connectors -----------
    // The board faces out of the square, so the connector the player has to
    // push home is towards the camera rather than against the tree.
    const boardRoot = new Group();
    boardRoot.position.set(3.4, 0, 3.0);
    boardRoot.rotation.y = Math.atan2(3.4, 3.0);
    this.group.add(boardRoot);
    const board = new Mesh(new BoxGeometry(1.7, 1.15, 0.5), materials.connectorShell);
    board.position.set(0, 0.68, 0);
    board.castShadow = true;
    boardRoot.add(board);
    for (let i = 0; i < SECTOR_COUNT; i++) {
      const pair = new Group();
      pair.position.set(-0.6 + (i % 3) * 0.6, 0.42 + Math.floor(i / 3) * 0.48, 0.3);
      const socketHalf = new Mesh(new CylinderGeometry(0.13, 0.14, 0.3, 12), materials.connectorShell);
      socketHalf.rotation.x = Math.PI / 2;
      socketHalf.position.z = -0.14;
      const plugHalf = new Mesh(new CylinderGeometry(0.12, 0.13, 0.32, 12), materials.connectorShell);
      plugHalf.rotation.x = Math.PI / 2;
      plugHalf.position.z = 0.18;
      const collar = new Mesh(new TorusGeometry(0.14, 0.028, 6, 16), materials.hiVis);
      collar.position.z = 0.03;
      const tail = new Mesh(new CylinderGeometry(0.035, 0.035, 0.5, 8), materials.cable);
      tail.rotation.x = Math.PI / 2;
      tail.position.z = 0.5;
      pair.add(socketHalf, plugHalf, collar, tail);
      pair.userData.plug = plugHalf;
      pair.userData.collar = collar;
      pair.userData.tail = tail;
      boardRoot.add(pair);
      this.connectors.push(pair);
      this.connectorMated.push(1);
      this.connectorTarget.push(1);
    }

    for (let i = 0; i < SECTOR_COUNT; i++) this.sectorCentroid.push(new Vector3());

    this.computeStrandShape(1, 1);
    this.assignSectors();
    this.computeStrandShape(0, 0);
    this.refresh(0);
  }

  /** World-space centroid of a sector, for its light proxy. */
  sectorProxy(index: number, out = new Vector3()): Vector3 {
    return out.copy(this.sectorCentroid[index]).add(this.group.position);
  }

  setSectorGlow(index: number, v: number): void {
    this.sectorGlow[index] = clamp(v, 0, 1);
    this.dirty = true;
  }

  getSectorGlow(index: number): number {
    return this.sectorGlow[index];
  }

  /** Pull a connector apart (the fault the sector test is supposed to find). */
  unmate(index: number): void {
    this.connectorTarget[index] = 0;
  }

  mate(index: number): void {
    this.connectorTarget[index] = 1;
  }

  isMated(index: number): boolean {
    return this.connectorMated[index] > 0.92;
  }

  update(dt: number): void {
    this.reel.rotation.x = -this.payOut * 9;
    this.winchDrum.rotation.x = this.hoist * 11;

    for (let i = 0; i < SECTOR_COUNT; i++) {
      this.connectorMated[i] = damp(this.connectorMated[i], this.connectorTarget[i], 5, dt);
      const pair = this.connectors[i];
      const plug = pair.userData.plug as Mesh;
      const collar = pair.userData.collar as Mesh;
      plug.position.z = lerp(0.44, 0.18, this.connectorMated[i]);
      collar.rotation.z = this.connectorMated[i] * 1.4;
      (pair.userData.tail as Mesh).position.z = plug.position.z + 0.32;
    }

    this.computeStrandShape(this.payOut, this.hoist);
    this.refresh(dt);
  }

  /** Recompute every strand polyline for the current pay-out and hoist state. */
  private computeStrandShape(payOut: number, hoist: number): void {
    const topPoint = this.tree.pointOnStem(this.topT, this.tmpV).sub(this.group.position);
    const hoopY = lerp(0.6, topPoint.y, hoist);
    const hoopX = lerp(-3.0, topPoint.x, hoist);
    const hoopZ = lerp(2.2, topPoint.z, hoist);
    this.hoop.position.set(hoopX, hoopY, hoopZ);
    this.hoop.visible = payOut > 0.05;

    // Guide rope from the winch at the base up to the leader.
    for (let i = 0; i < this.guidePoints.length; i++) {
      const t = i / (this.guidePoints.length - 1);
      this.guidePoints[i].set(
        lerp(2.9, topPoint.x, t),
        lerp(0.6, topPoint.y + 0.3, t),
        lerp(1.4, topPoint.z, t),
      );
    }
    this.guideRope.update(this.guidePoints);
    this.guideRope.mesh.visible = payOut > 0.02;

    for (const strand of this.strands) {
      const hoopPoint = this.tmpV.set(
        hoopX + Math.cos(strand.azimuth) * 0.55,
        hoopY,
        hoopZ + Math.sin(strand.azimuth) * 0.55,
      );
      const anchor = strand.anchor;
      const pts = strand.points;
      const n = pts.length - 1;
      const spanLen = hoopPoint.distanceTo(anchor);
      const laid = clamp(strand.length * payOut, 0.5, strand.length);

      if (laid <= spanLen + 0.01) {
        // Not enough cable off the reel yet: it runs from the reel outward.
        const reelPos = this.tmpV2.set(-6.2, 0.9, 5.4);
        for (let i = 0; i <= n; i++) {
          const t = i / n;
          pts[i].lerpVectors(reelPos, anchor, t);
          pts[i].y = lerp(0.9, anchor.y, Math.min(1, t * 1.6));
        }
      } else {
        // Enough cable: the aerial span is straight, the surplus lies on the
        // paving between the anchor and the foot of the span.
        const slack = laid - spanLen;
        const groundRun = Math.min(slack, 3.4);
        const dirX = anchor.x - hoopPoint.x;
        const dirZ = anchor.z - hoopPoint.z;
        const horiz = Math.hypot(dirX, dirZ) || 1;
        const tailX = anchor.x + (dirX / horiz) * groundRun;
        const tailZ = anchor.z + (dirZ / horiz) * groundRun;
        const split = Math.round(n * 0.78);
        for (let i = 0; i <= n; i++) {
          if (i <= split) {
            const t = i / split;
            pts[i].lerpVectors(hoopPoint, anchor, t);
            // A hung strand is not a taut wire: it bows out over the branches.
            const bow = Math.sin(t * Math.PI) * 0.5 * hoist;
            pts[i].x += Math.cos(strand.azimuth) * bow;
            pts[i].z += Math.sin(strand.azimuth) * bow;
          } else {
            const t = (i - split) / (n - split);
            pts[i].set(lerp(anchor.x, tailX, t), 0.06, lerp(anchor.z, tailZ, t));
          }
        }
      }
      strand.tube.update(pts);
      strand.tube.mesh.visible = payOut > 0.02;
    }
  }

  /** Assign each lamp to a sector from its height in the finished curtain. */
  private assignSectors(): void {
    const top = this.tree.height * this.topT;
    for (let i = 0; i < this.lampStrand.length; i++) {
      const strand = this.strands[this.lampStrand[i]];
      const p = this.samplePolyline(strand.points, this.lampU[i], this.tmpV);
      const frac = clamp(p.y / top, 0, 0.999);
      // Sector 0 is the bottom band: the test runs upward from there.
      this.lampSector[i] = Math.min(SECTOR_COUNT - 1, Math.floor(frac * SECTOR_COUNT));
    }
    for (let s = 0; s < SECTOR_COUNT; s++) {
      const c = this.sectorCentroid[s].set(0, 0, 0);
      let count = 0;
      for (let i = 0; i < this.lampStrand.length; i++) {
        if (this.lampSector[i] !== s) continue;
        const strand = this.strands[this.lampStrand[i]];
        c.add(this.samplePolyline(strand.points, this.lampU[i], this.tmpV));
        count++;
      }
      if (count) c.multiplyScalar(1 / count);
    }
  }

  private samplePolyline(points: Vector3[], u: number, out: Vector3): Vector3 {
    const n = points.length - 1;
    const f = clamp(u, 0, 1) * n;
    const i = Math.min(n - 1, Math.floor(f));
    return out.lerpVectors(points[i], points[i + 1], f - i);
  }

  private refresh(dt: number): void {
    const glowArray = this.glowAttr.array as Float32Array;
    const moving = this.payOut > 0.001 && (this.hoist < 0.999 || dt === 0 || this.payOut < 0.999);
    for (let i = 0; i < this.lampStrand.length; i++) {
      if (moving || dt === 0) {
        const strand = this.strands[this.lampStrand[i]];
        const p = this.samplePolyline(strand.points, this.lampU[i], this.tmpV);
        this.tmpQ.setFromAxisAngle(this.tmpV2.set(0, 1, 0), this.lampSpin[i]);
        this.tmpM.compose(p, this.tmpQ, this.scaleOne);
        this.lampGlass.setMatrixAt(i, this.tmpM);
        this.tmpM.compose(this.tmpV.setY(p.y + 0.06), this.tmpQ, this.scaleOne);
        this.lampSockets.setMatrixAt(i, this.tmpM);
      }
      const sector = this.lampSector[i];
      const mated = this.connectorMated[sector];
      const target = this.sectorGlow[sector] * (mated > 0.9 ? 1 : 0);
      glowArray[i] = target;
    }
    if (moving || dt === 0) {
      this.lampGlass.instanceMatrix.needsUpdate = true;
      this.lampSockets.instanceMatrix.needsUpdate = true;
    }
    if (this.dirty || moving || dt === 0) {
      this.glowAttr.needsUpdate = true;
      this.dirty = false;
    }
    const visible = this.payOut > 0.02;
    this.lampGlass.visible = visible;
    this.lampSockets.visible = visible;
  }

  /** Total lamp count, for the completion report. */
  get lampCount(): number {
    return this.lampStrand.length;
  }
}
