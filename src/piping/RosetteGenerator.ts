import * as THREE from 'three';
import type { RingSample } from './ExtrusionBuilder';
import type { GestureResult, PathPoint } from './GestureClassifier';
import { clamp, lerp, smoothstep } from '../util/math';

export interface GenContext {
  /** cake top + already piped cream at (x, z) */
  groundY(x: number, z: number): number;
  /** half-width of the section at scale 1 */
  sectionR: number;
  now: number;
}

/**
 * A rosette is not a flat ring of tube: it is a spiral that walks inward while
 * it climbs, so the outer coil supports the inner one and the tail flicks over
 * the centre. Built from the loop the child actually drew.
 */
export function buildRosette(
  path: PathPoint[],
  g: GestureResult,
  ctx: GenContext,
): RingSample[] {
  const out: RingSample[] = [];
  const R = clamp(g.radius, 0.0055, 0.030);
  const sign = Math.sign(g.turns) || 1;
  const start = Math.atan2(path[0].z - g.cz, path[0].x - g.cx);
  const turns = clamp(Math.abs(g.turns), 0.85, 2.1) + 0.28;
  const steps = Math.max(46, Math.round(turns * 44));
  const rise = clamp(R * 0.78, 0.005, 0.019);
  const foot = ctx.sectionR * 0.82;
  const t0 = ctx.now;

  const at = (u: number) => {
    const ang = start + sign * turns * Math.PI * 2 * u;
    const rad = R * (1 - 0.66 * Math.pow(u, 1.22));
    return {
      x: g.cx + Math.cos(ang) * rad,
      z: g.cz + Math.sin(ang) * rad,
      ang,
      rad,
    };
  };

  // short lead-in: the cream reaches the cake before the loop begins
  const p0 = at(0);
  const ground0 = ctx.groundY(p0.x, p0.z);
  for (let k = 0; k < 3; k++) {
    const u = k / 3;
    out.push({
      c: new THREE.Vector3(p0.x, ground0 - 0.0004 + foot * u, p0.z),
      t: new THREE.Vector3(0, 1, 0),
      su: lerp(0.92, 1, u),
      sv: lerp(0.92, 1, u),
      roll: 0,
      flare: Math.pow(1 - u, 1.3) * 0.0022,
      lift: u * 0.2,
      time: t0,
    });
  }

  const prev = new THREE.Vector3(p0.x, ground0 + foot, p0.z);
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const p = at(u);
    const ground = ctx.groundY(p.x, p.z);
    const climb = rise * Math.pow(u, 1.45);
    const y = ground + foot + climb;
    const c = new THREE.Vector3(p.x, y, p.z);
    const tan = c.clone().sub(prev);
    if (tan.lengthSq() < 1e-10) tan.set(-Math.sin(p.ang) * sign, 0.2, Math.cos(p.ang) * sign);
    tan.normalize();
    // the last eighth collapses into the flick that finishes a rosette
    const tail = smoothstep(0.86, 1.0, u);
    const s = lerp(1.0, 0.78, u) * (1 - tail * 0.9);
    const near = clamp((y - ground) / 0.0062, 0, 1);
    out.push({
      c,
      t: tan,
      su: s,
      sv: s,
      roll: 0,
      flare: Math.pow(1 - near, 1.6) * 0.0020,
      lift: clamp(climb / rise, 0, 1),
      time: t0,
    });
    prev.copy(c);
  }
  return out;
}
