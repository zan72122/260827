import * as THREE from 'three';
import type { Seabed } from '../world/terrain';

export const CABLE_RADIUS = 0.3;

export interface Station {
  s: number;                 // arc length along the route
  pos: THREE.Vector3;        // cable centre resting on the seabed
  tangent: THREE.Vector3;    // horizontal route tangent
  buriable: boolean;         // soft sand/mud -> plough can bury here
}

/**
 * A confirmed lay route. The SAME child-drawn polyline drives:
 *  - the ship's surface track
 *  - the catenary hand-off point
 *  - the seabed cable stations (adaptively spaced by curvature/slope)
 */
export class LayRoute {
  readonly points: THREE.Vector3[];
  readonly cum: number[] = [];
  readonly length: number;
  readonly stations: Station[] = [];
  readonly shipStartS: number;
  readonly shipEndS: number;

  constructor(points: THREE.Vector3[], readonly seabed: Seabed) {
    this.points = points;
    let acc = 0;
    this.cum.push(0);
    for (let i = 1; i < points.length; i++) {
      acc += points[i].distanceTo(points[i - 1]);
      this.cum.push(acc);
    }
    this.length = acc;

    // Ship can only sail where there is enough water under the keel.
    const minDepth = -5;
    let startS = 0, endS = this.length;
    for (let s = 0; s < this.length; s += 1.5) {
      const p = this.surfaceAt(s, new THREE.Vector3());
      if (seabed.height(p.x, p.z) < minDepth) { startS = s; break; }
    }
    for (let s = this.length; s > 0; s -= 1.5) {
      const p = this.surfaceAt(s, new THREE.Vector3());
      if (seabed.height(p.x, p.z) < minDepth) { endS = s; break; }
    }
    this.shipStartS = startS;
    this.shipEndS = Math.max(endS, startS + 10);

    this.buildStations();
  }

  /** XZ point on the water plane at arc length s. */
  surfaceAt(s: number, out: THREE.Vector3): THREE.Vector3 {
    s = THREE.MathUtils.clamp(s, 0, this.length);
    let lo = 0, hi = this.cum.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] <= s) lo = mid; else hi = mid;
    }
    const segLen = this.cum[hi] - this.cum[lo];
    const t = segLen > 1e-6 ? (s - this.cum[lo]) / segLen : 0;
    out.copy(this.points[lo]).lerp(this.points[hi], t);
    out.y = 0;
    return out;
  }

  tangentAt(s: number, out: THREE.Vector3): THREE.Vector3 {
    const a = this.surfaceAt(Math.max(0, s - 1), new THREE.Vector3());
    const b = this.surfaceAt(Math.min(this.length, s + 1), new THREE.Vector3());
    out.subVectors(b, a);
    out.y = 0;
    if (out.lengthSq() < 1e-8) out.set(1, 0, 0);
    return out.normalize();
  }

  depthAt(s: number): number {
    const p = this.surfaceAt(s, new THREE.Vector3());
    return this.seabed.height(p.x, p.z);
  }

  private curvatureAt(s: number): number {
    const a = this.tangentAt(s - 2, new THREE.Vector3());
    const b = this.tangentAt(s + 2, new THREE.Vector3());
    const ang = Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1));
    return ang / 4; // radians per metre
  }

  /**
   * Adaptive ring stations: dense where the route curves or the bottom is
   * steep, sparse on straight sandy runs. This keeps the seabed cable tube
   * cheap without using a uniformly dense TubeGeometry.
   */
  private buildStations(): void {
    let s = 0;
    let guard = 0;
    while (s < this.length && guard++ < 4000) {
      const p = this.surfaceAt(s, new THREE.Vector3());
      const tan = this.tangentAt(s, new THREE.Vector3());
      const h = this.seabed.height(p.x, p.z);
      this.stations.push({
        s,
        pos: new THREE.Vector3(p.x, h + CABLE_RADIUS, p.z),
        tangent: tan,
        buriable: this.seabed.buriable(p.x, p.z) && h < -6
      });
      const k = this.curvatureAt(s);
      let ds = THREE.MathUtils.clamp(4.8 / (1 + k * 40), 1.4, 4.8);
      // Refine where the bottom changes fast so the cable follows terrain.
      const h2 = this.depthAt(s + ds);
      if (Math.abs(h2 - h) > 1.6) ds = Math.max(1.4, ds * 0.5);
      s += ds;
    }
    const pe = this.surfaceAt(this.length, new THREE.Vector3());
    const he = this.seabed.height(pe.x, pe.z);
    this.stations.push({
      s: this.length,
      pos: new THREE.Vector3(pe.x, he + CABLE_RADIUS, pe.z),
      tangent: this.tangentAt(this.length, new THREE.Vector3()),
      buriable: false
    });
  }

  /** Station index whose s is <= s (for drawRange reveals). */
  stationIndexAt(s: number): number {
    let lo = 0, hi = this.stations.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (this.stations[mid].s <= s) lo = mid; else hi = mid;
    }
    return lo;
  }
}
