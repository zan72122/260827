import * as THREE from 'three';
import type { RingSample } from './ExtrusionBuilder';
import type { GestureResult, PathPoint } from './GestureClassifier';
import type { GenContext } from './RosetteGenerator';
import { clamp, lerp, smoothstep } from '../util/math';

/**
 * A shell has three stages: the head that piles up where the pressure starts,
 * the belly, and the tail that is dragged out thin as the pressure stops.
 * The path is the child's own short stroke, extended so the tail can run out.
 */
export function buildShell(path: PathPoint[], g: GestureResult, ctx: GenContext): RingSample[] {
  const out: RingSample[] = [];
  const t0 = ctx.now;
  const len = Math.max(0.010, g.net);
  const tailLen = len * 0.85 + 0.006;
  const total = len + tailLen;
  const steps = Math.max(40, Math.round(total * 1700));
  const foot = ctx.sectionR * 0.8;
  const head = clamp(len * 0.62, 0.007, 0.016);

  const p0 = path[0];
  const dirX = g.dirX;
  const dirZ = g.dirZ;

  // resample the recorded path by arc length so wobble in the stroke survives
  const cum: number[] = [0];
  for (let i = 1; i < path.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z));
  }
  const recorded = cum[cum.length - 1];
  const sampleAt = (d: number): { x: number; z: number } => {
    if (d <= 0) return { x: p0.x, z: p0.z };
    if (d >= recorded) {
      const last = path[path.length - 1];
      const over = d - recorded;
      return { x: last.x + dirX * over, z: last.z + dirZ * over };
    }
    let i = 1;
    while (i < cum.length && cum[i] < d) i++;
    const a = path[i - 1];
    const b = path[i];
    const seg = cum[i] - cum[i - 1] || 1;
    const k = (d - cum[i - 1]) / seg;
    return { x: lerp(a.x, b.x, k), z: lerp(a.z, b.z, k) };
  };

  const ground0 = ctx.groundY(p0.x, p0.z);
  for (let k = 0; k < 3; k++) {
    const u = k / 3;
    out.push({
      c: new THREE.Vector3(p0.x, ground0 - 0.0004 + foot * 0.7 * u, p0.z),
      t: new THREE.Vector3(0, 1, 0),
      su: lerp(0.90, 1.0, u),
      sv: lerp(0.90, 1.0, u),
      roll: 0,
      flare: Math.pow(1 - u, 1.3) * 0.0022,
      lift: 0,
      time: t0,
    });
  }

  const prev = new THREE.Vector3(p0.x, ground0 + foot * 0.7, p0.z);
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const d = total * u;
    const p = sampleAt(d);
    const ground = ctx.groundY(p.x, p.z);

    // stage 1 head, stage 2 belly, stage 3 tail
    const rise =
      head * smoothstep(0.0, 0.22, u) * (1 - smoothstep(0.34, 1.0, u) * 0.97);
    const belly =
      1.0 +
      0.30 * Math.exp(-Math.pow((u - 0.26) / 0.19, 2)) -
      0.10 * smoothstep(0.30, 0.62, u);
    const tail = smoothstep(0.52, 0.995, u);
    const s = clamp(belly * (1 - tail * 0.93), 0.06, 1.35);

    const y = ground + foot * lerp(0.7, 1.0, smoothstep(0, 0.2, u)) * s + rise;
    const c = new THREE.Vector3(p.x, y, p.z);
    const tan = c.clone().sub(prev);
    if (tan.lengthSq() < 1e-10) tan.set(dirX, 0.15, dirZ);
    tan.normalize();
    const near = clamp((y - ground) / 0.0062, 0, 1);
    out.push({
      c,
      t: tan,
      su: s,
      sv: s,
      roll: 0,
      flare: Math.pow(1 - near, 1.6) * 0.0020,
      lift: clamp(rise / head, 0, 1),
      time: t0,
    });
    prev.copy(c);
  }
  return out;
}
