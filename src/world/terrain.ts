import * as THREE from 'three';
import { Rng, fbm2, valueNoise2 } from '../core/rng';
import type { Quality } from '../core/quality';

// World extents (meters). Islands sit at +-ISLAND_X on the x axis.
export const WORLD = {
  minX: -120, maxX: 120,
  minZ: -80, maxZ: 80,
  islandAX: -95, islandBX: 95
};

export type SurfaceType = 'sand' | 'rock' | 'coral';

interface Patch {
  x: number; z: number; rx: number; rz: number; rot: number;
}

function patchField(p: Patch, x: number, z: number): number {
  const dx = x - p.x, dz = z - p.z;
  const c = Math.cos(p.rot), s = Math.sin(p.rot);
  const lx = (dx * c + dz * s) / p.rx;
  const lz = (-dx * s + dz * c) / p.rz;
  const d = lx * lx + lz * lz;
  return Math.max(0, 1 - d); // 1 at center -> 0 at ellipse edge
}

function smoothMax(a: number, b: number, k: number): number {
  const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (b - a)) / k));
  return a + (b - a) * h + k * h * (1 - h);
}

export class Seabed {
  readonly group = new THREE.Group();
  readonly seed: number;
  readonly rockPatches: Patch[] = [];
  readonly coralPatches: Patch[] = [];
  readonly anchorA = new THREE.Vector3();
  readonly anchorB = new THREE.Vector3();
  private valleyAmp: number;
  private valleyPhase: number;
  private valleyFreq: number;
  private valleyWidth: number;
  private valleyDepth: number;
  private causticsUniform = { value: 0 };
  private terrainMesh!: THREE.Mesh;
  depthTexture!: THREE.DataTexture;

  constructor(seed: number, private quality: Quality) {
    this.seed = seed;
    const rng = new Rng(seed);
    this.valleyAmp = rng.range(10, 22);
    this.valleyPhase = rng.range(0, Math.PI * 2);
    this.valleyFreq = rng.range(0.018, 0.03);
    this.valleyWidth = rng.range(11, 16);
    this.valleyDepth = rng.range(10, 15);

    // Rock patches: real obstacles, kept off the very shorelines.
    const nRock = 3;
    for (let i = 0; i < nRock; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      this.rockPatches.push({
        x: rng.range(-52, 52),
        z: side * rng.range(6, 40),
        rx: rng.range(13, 22),
        rz: rng.range(9, 16),
        rot: rng.range(0, Math.PI)
      });
    }
    // Seagrass / coral: protected areas the child should route around.
    for (let i = 0; i < 2; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      this.coralPatches.push({
        x: rng.range(-58, 58),
        z: side * rng.range(4, 42),
        rx: rng.range(10, 16),
        rz: rng.range(8, 13),
        rot: rng.range(0, Math.PI)
      });
    }

    this.computeAnchors();
    this.buildTerrainMesh();
    this.buildDepthTexture();
    this.buildBoulders();
    this.buildFlora();
  }

  private valleyCenterZ(x: number): number {
    return this.valleyAmp * Math.sin(x * this.valleyFreq * Math.PI * 2 + this.valleyPhase);
  }

  rockMask(x: number, z: number): number {
    let m = 0;
    for (const p of this.rockPatches) m = Math.max(m, patchField(p, x, z));
    return m;
  }

  coralMask(x: number, z: number): number {
    let m = 0;
    for (const p of this.coralPatches) m = Math.max(m, patchField(p, x, z));
    return m;
  }

  /** Seabed / island height at world (x, z). Water surface is y = 0. */
  height(x: number, z: number): number {
    // Rolling sand plain.
    let h = -33 + 6 * (fbm2(x * 0.016, z * 0.02, this.seed, 3) - 0.5) * 2;

    // Submarine valley.
    const dv = Math.abs(z - this.valleyCenterZ(x));
    const vt = Math.max(0, 1 - (dv / this.valleyWidth) ** 2);
    h -= this.valleyDepth * vt * vt * (3 - 2 * vt);

    // Rocky outcrops rise from the plain with high frequency roughness.
    const rm = this.rockMask(x, z);
    if (rm > 0.02) {
      const bump = fbm2(x * 0.12, z * 0.12, this.seed + 7, 3);
      h += rm * (9 + 5 * bump) * (0.6 + 0.4 * rm);
    }

    // Islands (cones with a shallow shelf), smooth-blended into the seabed.
    for (const ix of [WORLD.islandAX, WORLD.islandBX]) {
      const d = Math.hypot(x - ix, z);
      const island = 13 - d * 1.05;
      h = smoothMax(h, island, 4);
    }
    return h;
  }

  surfaceType(x: number, z: number): SurfaceType {
    if (this.rockMask(x, z) > 0.4) return 'rock';
    if (this.coralMask(x, z) > 0.45) return 'coral';
    return 'sand';
  }

  /** Soft mud/sand where the plough can bury cable. */
  buriable(x: number, z: number): boolean {
    return this.surfaceType(x, z) === 'sand';
  }

  private computeAnchors(): void {
    // Walk from each island centre toward the sea until the shore drops to ~+0.7.
    const find = (cx: number, dir: number, out: THREE.Vector3) => {
      let x = cx;
      for (let i = 0; i < 400; i++) {
        x += dir * 0.15;
        const h = this.height(x, 0);
        if (h < 0.7) {
          out.set(x - dir * 0.4, this.height(x - dir * 0.4, 0), 0);
          return;
        }
      }
      out.set(cx + dir * 12, 0.7, 0);
    };
    find(WORLD.islandAX, 1, this.anchorA);
    find(WORLD.islandBX, -1, this.anchorB);
  }

  private buildTerrainMesh(): void {
    const segX = this.quality.terrainSeg;
    const segZ = Math.round(segX * 0.66);
    const geo = new THREE.PlaneGeometry(
      WORLD.maxX - WORLD.minX, WORLD.maxZ - WORLD.minZ, segX, segZ
    );
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const cSand = new THREE.Color(0xb9a37c);
    const cSandDeep = new THREE.Color(0x6e7a72);
    const cValley = new THREE.Color(0x565f63);
    const cRock = new THREE.Color(0x4d4a45);
    const cCoral = new THREE.Color(0x7d9a6c);
    const cBeach = new THREE.Color(0xd9c9a2);
    const cGreen = new THREE.Color(0x4c7a3f);
    const tmp = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = this.height(x, z);
      pos.setY(i, h);

      const rm = this.rockMask(x, z);
      const cm = this.coralMask(x, z);
      const depth01 = THREE.MathUtils.clamp(-h / 48, 0, 1);
      tmp.copy(cSand).lerp(cSandDeep, depth01 * 0.85);
      if (h < -38) tmp.lerp(cValley, THREE.MathUtils.clamp((-h - 38) / 10, 0, 1) * 0.8);
      if (rm > 0.25) tmp.lerp(cRock, THREE.MathUtils.clamp((rm - 0.25) / 0.3, 0, 1));
      else if (cm > 0.3) tmp.lerp(cCoral, THREE.MathUtils.clamp((cm - 0.3) / 0.3, 0, 1) * 0.7);
      if (h > -3.5) tmp.lerp(cBeach, THREE.MathUtils.clamp((h + 3.5) / 4, 0, 1));
      if (h > 1.6) tmp.lerp(cGreen, THREE.MathUtils.clamp((h - 1.6) / 2.5, 0, 1));

      // Cheap AO: darken with local slope noise so it does not read flat.
      const ao = 0.88 + 0.12 * valueNoise2(x * 0.3, z * 0.3, this.seed + 31);
      colors[i * 3] = tmp.r * ao;
      colors[i * 3 + 1] = tmp.g * ao;
      colors[i * 3 + 2] = tmp.b * ao;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      metalness: 0.0
    });
    const uTime = this.causticsUniform;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uCausTime = uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vCausPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCausPos = (modelMatrix * vec4(position, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vCausPos;\nuniform float uCausTime;')
        .replace('#include <color_fragment>', `#include <color_fragment>
{
  // Sunlight caustics: only near the surface, fading with depth.
  float depthW = smoothstep(-26.0, -3.0, vCausPos.y) * step(vCausPos.y, -0.4);
  if (depthW > 0.001) {
    vec2 p = vCausPos.xz * 0.14;
    float t = uCausTime;
    float c1 = 0.5 + 0.5 * sin(p.x * 3.1 + t * 1.4 + sin(p.y * 2.7 + t * 1.1) * 1.5);
    float c2 = 0.5 + 0.5 * sin(p.y * 3.7 - t * 1.7 + sin(p.x * 2.3 - t * 0.9) * 1.5);
    float ca = pow(c1 * c2, 3.0);
    diffuseColor.rgb += vec3(0.45, 0.55, 0.5) * ca * depthW * 0.6;
  }
}`);
    };

    this.terrainMesh = new THREE.Mesh(geo, mat);
    this.terrainMesh.name = 'seabed';
    this.group.add(this.terrainMesh);
  }

  private buildDepthTexture(): void {
    const w = 128, hgt = 96;
    const data = new Uint8Array(w * hgt * 4);
    for (let j = 0; j < hgt; j++) {
      for (let i = 0; i < w; i++) {
        const x = WORLD.minX + ((i + 0.5) / w) * (WORLD.maxX - WORLD.minX);
        const z = WORLD.minZ + ((j + 0.5) / hgt) * (WORLD.maxZ - WORLD.minZ);
        const h = this.height(x, z);
        const d01 = THREE.MathUtils.clamp(-h / 52, 0, 1);
        const k = (j * w + i) * 4;
        data[k] = Math.round(d01 * 255);
        data[k + 1] = data[k];
        data[k + 2] = data[k];
        data[k + 3] = 255;
      }
    }
    this.depthTexture = new THREE.DataTexture(data, w, hgt);
    this.depthTexture.needsUpdate = true;
    this.depthTexture.minFilter = THREE.LinearFilter;
    this.depthTexture.magFilter = THREE.LinearFilter;
  }

  private buildBoulders(): void {
    const rng = new Rng(this.seed + 55);
    const geo = new THREE.DodecahedronGeometry(1, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0x55504a, roughness: 0.9, flatShading: true });
    const count = 70;
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const eu = new THREE.Euler();
    const sc = new THREE.Vector3();
    const tp = new THREE.Vector3();
    let placed = 0;
    for (let tries = 0; tries < 900 && placed < count; tries++) {
      const x = rng.range(WORLD.minX + 15, WORLD.maxX - 15);
      const z = rng.range(WORLD.minZ + 10, WORLD.maxZ - 10);
      if (this.rockMask(x, z) < 0.35) continue;
      const h = this.height(x, z);
      if (h > -4) continue;
      const s = rng.range(0.9, 3.1);
      eu.set(rng.range(0, 3), rng.range(0, 3), rng.range(0, 3));
      q.setFromEuler(eu);
      sc.set(s, s * rng.range(0.6, 1), s);
      tp.set(x, h + s * 0.25, z);
      m.compose(tp, q, sc);
      mesh.setMatrixAt(placed, m);
      placed++;
    }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
  }

  private buildFlora(): void {
    const rng = new Rng(this.seed + 91);
    // Seagrass blades: instanced thin cones inside coral/grass patches.
    const bladeGeo = new THREE.ConeGeometry(0.14, 2.4, 4, 1);
    bladeGeo.translate(0, 1.2, 0);
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0x3f7a45, roughness: 0.85 });
    const grass = new THREE.InstancedMesh(bladeGeo, bladeMat, this.quality.grass);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const eu = new THREE.Euler();
    const sc = new THREE.Vector3();
    const tp = new THREE.Vector3();
    let placed = 0;
    for (let tries = 0; tries < this.quality.grass * 8 && placed < this.quality.grass; tries++) {
      const p = rng.pick(this.coralPatches);
      const x = p.x + rng.range(-p.rx, p.rx);
      const z = p.z + rng.range(-p.rz, p.rz);
      if (patchField(p, x, z) < 0.15) continue;
      const h = this.height(x, z);
      if (h > -5 || this.rockMask(x, z) > 0.4) continue;
      eu.set(rng.range(-0.25, 0.25), rng.range(0, 6.28), rng.range(-0.25, 0.25));
      q.setFromEuler(eu);
      const s = rng.range(0.6, 1.5);
      sc.set(s, s, s);
      tp.set(x, h, z);
      m.compose(tp, q, sc);
      grass.setMatrixAt(placed, m);
      placed++;
    }
    grass.count = placed;
    grass.instanceMatrix.needsUpdate = true;
    this.group.add(grass);

    // A few muted coral heads for silhouette variety.
    const coralGeo = new THREE.IcosahedronGeometry(1, 1);
    const cpos = coralGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < cpos.count; i++) {
      const n = 1 + 0.3 * (valueNoise2(cpos.getX(i) * 2, cpos.getZ(i) * 2, 5) - 0.5);
      cpos.setXYZ(i, cpos.getX(i) * n, Math.abs(cpos.getY(i)) * n * 0.8, cpos.getZ(i) * n);
    }
    coralGeo.computeVertexNormals();
    const coralMat = new THREE.MeshStandardMaterial({ color: 0xa8785f, roughness: 0.9 });
    const corals = new THREE.InstancedMesh(coralGeo, coralMat, 26);
    placed = 0;
    for (let tries = 0; tries < 300 && placed < 26; tries++) {
      const p = rng.pick(this.coralPatches);
      const x = p.x + rng.range(-p.rx, p.rx);
      const z = p.z + rng.range(-p.rz, p.rz);
      if (patchField(p, x, z) < 0.3) continue;
      const h = this.height(x, z);
      if (h > -6) continue;
      q.setFromEuler(eu.set(0, rng.range(0, 6.28), 0));
      const s = rng.range(0.5, 1.6);
      sc.set(s, s * 0.8, s);
      tp.set(x, h + 0.1, z);
      m.compose(tp, q, sc);
      corals.setMatrixAt(placed, m);
      placed++;
    }
    corals.count = placed;
    corals.instanceMatrix.needsUpdate = true;
    this.group.add(corals);
  }

  update(t: number): void {
    this.causticsUniform.value = t;
  }

  dispose(): void {
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mm = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mm)) mm.forEach((x) => x.dispose());
      else if (mm) mm.dispose();
    });
    this.depthTexture.dispose();
  }
}
