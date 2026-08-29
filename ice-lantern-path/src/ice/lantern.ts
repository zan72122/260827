import * as THREE from 'three';
import { D } from './dims';
import { makeIceMaterials, makeIceUniforms, type IceUniforms } from './iceMaterial';
import { innerMoldRadiusAt, moldInnerRadiusAt } from '../world/props';
import { contactShadow } from '../world/materials';

function rng(seed: number) {
  let s = (seed * 9871 + 12345) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function n2(x: number, y: number) {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
}
function smoothN(x: number, y: number) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  return (
    n2(ix, iy) * (1 - ux) * (1 - uy) +
    n2(ix + 1, iy) * ux * (1 - uy) +
    n2(ix, iy + 1) * (1 - ux) * uy +
    n2(ix + 1, iy + 1) * ux * uy
  );
}

export const LANTERN_H = D.waterTop;

/** outer surface radius of the finished ice at local height y */
export function iceOuterR(y: number) {
  return moldInnerRadiusAt(y + D.outerFloor) - 0.0009;
}
/** cavity radius of the finished ice at local height y */
export function iceCavityR(y: number) {
  return innerMoldRadiusAt(Math.max(y, D.spacerH) + D.outerFloor) + 0.0009;
}

/**
 * The lantern is the exact solid the water occupied: a thick walled cup with a
 * load bearing base. Built as a lathe so the wall thickness reads from every
 * angle, then roughened so it is never a perfect cylinder.
 */
export function buildIceGeometry(seed: number, segments = 84) {
  const H = LANTERN_H;
  const pts: THREE.Vector2[] = [];
  pts.push(new THREE.Vector2(0, 0));
  pts.push(new THREE.Vector2(iceOuterR(0) - 0.008, 0));
  pts.push(new THREE.Vector2(iceOuterR(0.0035) - 0.001, 0.0035));
  const steps = 16;
  for (let i = 0; i <= steps; i++) {
    const y = 0.008 + (H - 0.014 - 0.008) * (i / steps);
    pts.push(new THREE.Vector2(iceOuterR(y), y));
  }
  pts.push(new THREE.Vector2(iceOuterR(H - 0.006) - 0.0015, H - 0.004));
  pts.push(new THREE.Vector2(iceOuterR(H) - 0.006, H));
  // rim, then down the cavity
  pts.push(new THREE.Vector2(iceCavityR(H) + 0.005, H));
  pts.push(new THREE.Vector2(iceCavityR(H) + 0.0005, H - 0.005));
  const csteps = 10;
  for (let i = 0; i <= csteps; i++) {
    const y = H - 0.012 - (H - 0.012 - (D.spacerH + 0.006)) * (i / csteps);
    pts.push(new THREE.Vector2(iceCavityR(y), y));
  }
  pts.push(new THREE.Vector2(iceCavityR(D.spacerH) - 0.004, D.spacerH + 0.001));
  pts.push(new THREE.Vector2(0, D.spacerH));

  const geo = new THREE.LatheGeometry(pts, segments);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const r = rng(seed);
  const chipA = r() * Math.PI * 2;
  const grooveA = [0.35, 0.35 + 2.094, 0.35 + 4.189];
  const jitter = r() * 10;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const rad = Math.hypot(x, z);
    if (rad < 1e-5) continue;
    const th = Math.atan2(z, x);
    const outer = Math.abs(rad - iceOuterR(y)) < 0.004 && y < LANTERN_H - 0.002;
    const cavity = Math.abs(rad - iceCavityR(y)) < 0.004 && y > D.spacerH;
    let dr = 0;

    const cx = x / rad;
    const cz = z / rad;
    if (outer) {
      // the gap between two hand made moulds is never perfectly even
      dr += (smoothN(cx * 2.3 + jitter, y * 9) - 0.5) * 0.0032;
      dr += (smoothN(cz * 2.7 + jitter * 1.7 + 5, y * 7.5) - 0.5) * 0.0034;
      dr += (smoothN(cx * 6.1 + cz * 3.3 + jitter * 2, y * 26) - 0.5) * 0.0016;
      // three shallow grooves left by the spacer fins
      for (const ga of grooveA) {
        let da = th - ga;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        const g = Math.exp(-(da * da) / 0.012) * Math.exp(-Math.pow((y - 0.03) / 0.03, 2));
        dr -= g * 0.0035;
      }
      // one very small chip on the rim
      let dc = th - chipA;
      while (dc > Math.PI) dc -= Math.PI * 2;
      while (dc < -Math.PI) dc += Math.PI * 2;
      const chip = Math.exp(-(dc * dc) / 0.02) * Math.exp(-Math.pow((y - LANTERN_H) / 0.01, 2));
      dr -= chip * 0.0034;
    } else if (cavity) {
      dr += (smoothN(cx * 2.6 + 30, y * 11) - 0.5) * 0.0022;
      dr += (smoothN(cz * 3.1 + 12, y * 8) - 0.5) * 0.0022;
    }

    if (dr !== 0) {
      const k = (rad + dr) / rad;
      pos.setX(i, x * k);
      pos.setZ(i, z * k);
    }
  }
  geo.computeVertexNormals();
  // LatheGeometry duplicates the seam column; average the two so the wrap
  // never shows as a crease.
  const nrm = geo.getAttribute('normal') as THREE.BufferAttribute;
  const np = pts.length;
  for (let j = 0; j < np; j++) {
    const a = j;
    const b = segments * np + j;
    const nx = (nrm.getX(a) + nrm.getX(b)) * 0.5;
    const ny = (nrm.getY(a) + nrm.getY(b)) * 0.5;
    const nz = (nrm.getZ(a) + nrm.getZ(b)) * 0.5;
    const l = Math.hypot(nx, ny, nz) || 1;
    nrm.setXYZ(a, nx / l, ny / l, nz / l);
    nrm.setXYZ(b, nx / l, ny / l, nz / l);
  }
  nrm.needsUpdate = true;
  geo.computeBoundingSphere();
  return geo;
}

export class IceLantern {
  group = new THREE.Group();
  front: THREE.Mesh;
  back: THREE.Mesh;
  uniforms: IceUniforms;
  /** decorations frozen inside */
  inclusions = new THREE.Group();
  seed: number;
  private useTransmission: boolean;

  constructor(seed: number, transmission: number, segments = 84) {
    this.seed = seed;
    this.useTransmission = transmission > 0.01;
    const geo = buildIceGeometry(seed, segments);
    this.uniforms = makeIceUniforms(iceCavityR(LANTERN_H * 0.5), iceOuterR(LANTERN_H * 0.5), LANTERN_H);
    const mats = makeIceMaterials(this.uniforms, transmission);
    this.back = new THREE.Mesh(geo, mats.back);
    this.back.renderOrder = 11;
    this.front = new THREE.Mesh(geo, mats.front);
    this.front.renderOrder = 13;
    this.front.castShadow = false;
    // a real lantern sits on its base; give it a contact shadow to prove it
    const shadow = contactShadow(0.26, 0.5);
    shadow.position.y = 0.002;
    this.group.add(this.back, this.front, this.inclusions, shadow);
    this.setFreeze(0);
  }

  setFreeze(t: number) {
    const f = THREE.MathUtils.clamp(t, 0, 1);
    this.uniforms.uFreeze.value = f;
    // the front marches in from both mould walls; frost and heave follow it
    this.uniforms.uFront.value = THREE.MathUtils.clamp((f - 0.08) / 0.78, 0, 1);
    this.uniforms.uHeave.value = THREE.MathUtils.smoothstep(f, 0.55, 1) * 0.0028;
  }

  /** Quality can drop mid session: rebuild only when transmission toggles. */
  setTransmission(t: number) {
    const want = t > 0.01;
    if (want === this.useTransmission) {
      if (want) (this.front.material as THREE.MeshPhysicalMaterial).transmission = t;
      return;
    }
    (this.front.material as THREE.Material).dispose();
    (this.back.material as THREE.Material).dispose();
    const mats = makeIceMaterials(this.uniforms, t);
    this.front.material = mats.front;
    this.back.material = mats.back;
    this.useTransmission = want;
  }

  setLit(v: number) {
    this.uniforms.uLit.value = v;
  }

  update(elapsed: number) {
    this.uniforms.uTime.value = elapsed;
  }

  dispose() {
    this.front.geometry.dispose();
    (this.front.material as THREE.Material).dispose();
    (this.back.material as THREE.Material).dispose();
  }
}
