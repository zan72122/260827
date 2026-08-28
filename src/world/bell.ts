import * as THREE from 'three';
import { SheetMesh, type SheetSurface } from './sheet';
import { smoothstep } from '../core/util';
import type { MetalMaps } from '../gfx/textures';

/**
 * The flower blank and everything it becomes.
 *
 * One arc-length parameter `s` runs from the centre of the flat blank outwards.
 * The metal is bent by giving that arc a curvature: `bowlForm` curves the inner
 * disc into the cup, each `petalFold[i]` curls one petal up onto the sphere.
 * Because the bend preserves arc length, the metal never stretches or pops --
 * the flat flower and the closed shell are literally the same sheet.
 *
 * At full fold every petal lies exactly on a sphere of radius R, so the pellet
 * inside can be contained by one sphere test and can never poke through.
 */

const PETALS = 6;
const THETA_B = 2.182;     // 125 deg: where the cup stops and the petals start
const THETA_TOP = 0.244;   // 14 deg: where the petal tips meet under the crown

export interface BellOptions {
  radius: number;
  metal: MetalMaps;
  env: THREE.Texture;
}

export class Bell {
  readonly root = new THREE.Group();
  readonly R: number;
  readonly thickness: number;
  readonly petalCount = PETALS;

  /** 0 = flat blank, 1 = cup fully drawn */
  bowlForm = 0;
  /** per petal, 0 = flat, 1 = closed onto the sphere */
  readonly petalFold: number[] = new Array(PETALS).fill(0);
  /** extra squeeze applied by the jig at the very end */
  clinch = 0;

  readonly petalMeshes: THREE.Mesh[] = [];
  bowlMesh!: THREE.Mesh;
  readonly crown = new THREE.Group();

  private sB: number;
  private A: number;
  private wHalf = Math.PI / PETALS;
  private bowlSheet!: SheetMesh;
  private petalSheets: SheetMesh[] = [];
  private material: THREE.MeshStandardMaterial;
  private polishCanvas: HTMLCanvasElement;
  private polishCtx: CanvasRenderingContext2D;
  private polishTex: THREE.CanvasTexture;
  private uvScale = 2;
  private blankSpan: number;
  private dirtyBowl = true;
  private dirtyPetals = new Array(PETALS).fill(true);

  constructor(opts: BellOptions) {
    this.R = opts.radius;
    this.thickness = opts.radius * 0.075;
    this.sB = this.R * (Math.PI - THETA_B);
    this.A = this.R * (THETA_B - THETA_TOP);
    this.blankSpan = 2 * (this.sB + this.A) * 1.06;

    this.polishCanvas = document.createElement('canvas');
    this.polishCanvas.width = this.polishCanvas.height = 512;
    this.polishCtx = this.polishCanvas.getContext('2d')!;
    this.polishCtx.fillStyle = '#000';
    this.polishCtx.fillRect(0, 0, 512, 512);
    this.polishTex = new THREE.CanvasTexture(this.polishCanvas);
    this.polishTex.wrapS = this.polishTex.wrapT = THREE.RepeatWrapping;

    this.material = new THREE.MeshStandardMaterial({
      map: opts.metal.map,
      roughnessMap: opts.metal.roughnessMap,
      bumpMap: opts.metal.bumpMap,
      bumpScale: 0.0017,
      metalness: 1.0,
      roughness: 1.0,
      envMap: opts.env,
      envMapIntensity: 1.1,
      color: new THREE.Color(0xffffff),
    });
    const polishTex = this.polishTex;
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uPolish = { value: polishTex };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vPolishUv;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n\tvPolishUv = uv;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uPolish;\nvarying vec2 vPolishUv;\nfloat polishAmt;')
        .replace('#include <roughnessmap_fragment>',
          '#include <roughnessmap_fragment>\n\tpolishAmt = clamp(texture2D(uPolish, vPolishUv).r, 0.0, 1.0);\n\troughnessFactor *= mix(1.0, 0.66, polishAmt);')
        .replace('#include <color_fragment>',
          '#include <color_fragment>\n\tdiffuseColor.rgb *= mix(1.0, 1.13, clamp(texture2D(uPolish, vPolishUv).r, 0.0, 1.0));');
    };
    this.material.customProgramCacheKey = () => 'bellPolish';

    this.build();
  }

  get metalMaterial() { return this.material; }

  // ----------------------------------------------------------- the profile

  /** Meridian profile: material arc `s` -> (axis distance, height, tangent angle). */
  private profile(s: number, tp: number, out: { r: number; y: number; a: number }) {
    const R = this.R, sB = this.sB;
    const tb = this.bowlForm;
    const kb = tb / R;
    let r: number, y: number, a: number;
    const bowlS = Math.min(s, sB);
    const ab = kb * bowlS;
    if (kb > 1e-6) { r = Math.sin(ab) / kb; y = (1 - Math.cos(ab)) / kb; }
    else { r = bowlS; y = 0; }
    a = ab;
    if (s > sB) {
      const a0 = kb * sB * tp;      // the root kink formed over the jig
      const kp = tp / R;
      const aa = s - sB;
      // start the petal from the rim but at the (partially) raised root angle
      a = a0 + kp * aa;
      if (kp > 1e-6) {
        r += (Math.sin(a) - Math.sin(a0)) / kp;
        y += (Math.cos(a0) - Math.cos(a)) / kp;
      } else {
        r += Math.cos(a0) * aa;
        y += Math.sin(a0) * aa;
      }
    }
    out.r = r;
    out.y = y - this.rimHeightRaw();
    out.a = a;
  }

  private rimHeightRaw() {
    const kb = this.bowlForm / this.R;
    return kb > 1e-6 ? (1 - Math.cos(kb * this.sB)) / kb : 0;
  }

  /** azimuthal half angle that keeps the material width constant */
  private halfAngle(s: number, r: number) {
    const matHalf = this.R * Math.sin(s / this.R) * this.wHalf;
    return matHalf / Math.max(r, 1e-4);
  }

  /** Centre of the sphere the closed shell lies on, in bell-local space. */
  localCentre(out = new THREE.Vector3()) {
    return out.set(0, this.R - this.R * (1 - Math.cos(Math.PI - THETA_B)), 0);
  }

  worldCentre(out = new THREE.Vector3()) {
    this.localCentre(out);
    return this.root.localToWorld(out);
  }

  /** inner wall radius available to the pellet */
  get innerRadius() { return this.R - this.thickness * 0.5 - this.clinch * this.R * 0.004; }

  /** local height of the crown seat above the rim */
  get topLocalY() {
    const o = _prof;
    this.profile(this.sB + this.A, 1, o);
    return o.y;
  }

  // -------------------------------------------------------------- surfaces

  private bowlSurface(): SheetSurface {
    const nu = 26, nv = 108;
    const sB = this.sB;
    const slotHalf = this.R * 0.052;
    const s0 = sB * 0.14, s1 = sB * 0.90;
    const holeR = this.R * 0.049, holeS = sB * 0.56;
    const self = this;
    // slots are described in the same polar frame as the grid, so their edges
    // come out straight instead of stepped
    const cut = (s: number, phi: number) => {
      if (s > s0 && s < s1) {
        for (const base of [0, Math.PI]) {
          let d = Math.abs(((phi - base + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
          if (d * s < slotHalf) return true;
        }
      }
      const mx = s * Math.cos(phi), my = s * Math.sin(phi);
      const dy = Math.abs(my) - holeS;
      if (mx * mx + dy * dy < holeR * holeR) return true;
      return false;
    };
    return {
      nu, nv,
      point(i, j, out) {
        const s = (i / nu) * sB;
        const phi = (j / nv) * Math.PI * 2;
        self.profile(s, 0, _prof);
        out.set(_prof.r * Math.cos(phi), _prof.y, _prof.r * Math.sin(phi));
      },
      normalAt(i, j, out) {
        const s = (i / nu) * sB;
        const phi = (j / nv) * Math.PI * 2;
        self.profile(s, 0, _prof);
        const sa = Math.sin(_prof.a), ca = Math.cos(_prof.a);
        out.set(sa * Math.cos(phi), -ca, sa * Math.sin(phi));
        if (out.lengthSq() < 1e-9) out.set(0, -1, 0); else out.normalize();
      },
      half: () => self.thickness * 0.5,
      uvAt(i, j, out) {
        const s = (i / nu) * sB;
        const phi = (j / nv) * Math.PI * 2;
        const k = self.uvScale / self.blankSpan;
        out.set(0.5 + s * Math.cos(phi) * k, 0.5 + s * Math.sin(phi) * k);
      },
      cellOn(i, j) {
        const s = ((i + 0.5) / nu) * sB;
        const phi = ((j + 0.5) / nv) * Math.PI * 2;
        return !cut(s, phi);
      },
    };
  }

  private petalSurface(index: number): SheetSurface {
    const nu = 22, nv = 16;
    const self = this;
    const phiC = (index / PETALS) * Math.PI * 2;
    const sB = this.sB, A = this.A;
    // slight scallop on the tip so the six petals read as separate leaves
    const tipR = (v: number) => 1 - 0.022 * Math.pow(v, 4);
    const sAt = (i: number, v: number) => sB + A * (i / nu) * tipR(v);
    const fadeTip = (i: number) => 1 - smoothstep(0.76, 1.0, i / nu);
    const lapV = (v: number, i: number) => v + 0.12 * fadeTip(i) * smoothstep(0.55, 1.0, v);

    const place = (i: number, j: number, out: THREE.Vector3, normal: THREE.Vector3) => {
      const v = (j / nv) * 2 - 1;
      const s = sAt(i, v);
      const tp = self.petalFold[index];
      self.profile(s, tp, _prof);
      const ha = self.halfAngle(s, _prof.r);
      const phi = phiC + ha * lapV(v, i);
      const sa = Math.sin(_prof.a), ca = Math.cos(_prof.a);
      normal.set(sa * Math.cos(phi), -ca, sa * Math.sin(phi));
      if (normal.lengthSq() < 1e-9) normal.set(0, -1, 0); else normal.normalize();
      const lift = self.thickness * smoothstep(0.5, 0.94, v) * fadeTip(i);
      out.set(_prof.r * Math.cos(phi), _prof.y, _prof.r * Math.sin(phi));
      out.addScaledVector(normal, lift);
    };

    return {
      nu, nv,
      point(i, j, out) { place(i, j, out, _nrm); },
      normalAt(i, j, out) { place(i, j, _pt, out); },
      half: () => self.thickness * 0.5,
      uvAt(i, j, out) {
        const v = (j / nv) * 2 - 1;
        const s = sAt(i, v);
        const off = self.R * Math.sin(s / self.R) * self.wHalf * lapV(v, i);
        const bx = s * Math.cos(phiC) - off * Math.sin(phiC);
        const by = s * Math.sin(phiC) + off * Math.cos(phiC);
        const k = self.uvScale / self.blankSpan;
        out.set(0.5 + bx * k, 0.5 + by * k);
      },
    };
  }

  // ----------------------------------------------------------------- build

  private build() {
    this.bowlSheet = new SheetMesh(this.bowlSurface());
    this.bowlMesh = new THREE.Mesh(this.bowlSheet.geometry, this.material);
    this.bowlMesh.castShadow = true;
    this.bowlMesh.receiveShadow = true;
    this.bowlMesh.name = 'bowl';
    this.root.add(this.bowlMesh);

    for (let i = 0; i < PETALS; i++) {
      const sheet = new SheetMesh(this.petalSurface(i));
      this.petalSheets.push(sheet);
      const m = new THREE.Mesh(sheet.geometry, this.material);
      m.castShadow = true;
      m.receiveShadow = true;
      m.name = `petal${i}`;
      m.userData.petal = i;
      this.petalMeshes.push(m);
      this.root.add(m);
    }

    this.buildCrown();
    this.root.add(this.crown);
    this.crown.visible = false;
  }

  private buildCrown() {
    const R = this.R;
    const pts: THREE.Vector2[] = [
      new THREE.Vector2(0.0, 0.30 * R),
      new THREE.Vector2(0.09 * R, 0.292 * R),
      new THREE.Vector2(0.19 * R, 0.252 * R),
      new THREE.Vector2(0.28 * R, 0.163 * R),
      new THREE.Vector2(0.33 * R, 0.055 * R),
      new THREE.Vector2(0.345 * R, -0.012 * R),
      new THREE.Vector2(0.345 * R, -0.045 * R),
      new THREE.Vector2(0.305 * R, -0.045 * R),
      new THREE.Vector2(0.30 * R, 0.02 * R),
      new THREE.Vector2(0.25 * R, 0.125 * R),
      new THREE.Vector2(0.15 * R, 0.205 * R),
      new THREE.Vector2(0.0, 0.24 * R),
    ];
    const capGeo = new THREE.LatheGeometry(pts, 40);
    capGeo.computeVertexNormals();
    const cap = new THREE.Mesh(capGeo, this.material);
    cap.castShadow = true; cap.receiveShadow = true;

    // the suspension loop: brazed on, and the one part hands actually touch
    const loop = new THREE.Mesh(
      new THREE.TorusGeometry(0.13 * R, 0.038 * R, 12, 30),
      this.material
    );
    loop.position.y = 0.40 * R;
    loop.castShadow = true;
    const collar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.075 * R, 0.10 * R, 0.075 * R, 20),
      this.material
    );
    collar.position.y = 0.30 * R;
    collar.castShadow = true;

    this.crown.add(cap, collar, loop);
    this.crown.name = 'crown';
  }

  /** world position of the suspension loop */
  loopWorld(out = new THREE.Vector3()) {
    out.set(0, this.topLocalY - 0.03 * this.R + 0.40 * this.R, 0);
    return this.root.localToWorld(out);
  }

  // ---------------------------------------------------------------- update

  markBowlDirty() { this.dirtyBowl = true; for (let i = 0; i < PETALS; i++) this.dirtyPetals[i] = true; }
  markPetalDirty(i: number) { this.dirtyPetals[i] = true; }

  /** Rebuild only the pieces whose forming parameters changed this frame. */
  sync() {
    if (this.dirtyBowl) { this.bowlSheet.refresh(); this.dirtyBowl = false; }
    for (let i = 0; i < PETALS; i++) {
      if (this.dirtyPetals[i]) {
        this.petalSheets[i].refresh();
        this.dirtyPetals[i] = false;
      }
    }
    this.crown.position.y = this.topLocalY - 0.03 * this.R;
  }

  /** Centroid of a petal in world space, used for touch targeting. */
  petalWorld(index: number, out = new THREE.Vector3()) {
    const phiC = (index / PETALS) * Math.PI * 2;
    const s = this.sB + this.A * 0.62;
    this.profile(s, this.petalFold[index], _prof);
    out.set(_prof.r * Math.cos(phiC), _prof.y, _prof.r * Math.sin(phiC));
    return this.root.localToWorld(out);
  }

  /** Where a petal's tip sits at a given fold -- used to work out which way a
   *  finger has to travel on screen to close it, from any camera angle. */
  petalTipWorld(index: number, fold: number, out = new THREE.Vector3()) {
    const phiC = (index / PETALS) * Math.PI * 2;
    const s = this.sB + this.A * 0.95;
    const keep = this.petalFold[index];
    this.petalFold[index] = fold;
    this.profile(s, fold, _prof);
    this.petalFold[index] = keep;
    out.set(_prof.r * Math.cos(phiC), _prof.y, _prof.r * Math.sin(phiC));
    return this.root.localToWorld(out);
  }

  get closedCount() { return this.petalFold.filter((f) => f > 0.995).length; }

  // ---------------------------------------------------------------- polish

  /** Paint gloss at a UV touched by the brush. Returns how much was new. */
  polishAt(u: number, v: number, radius = 26, strength = 0.34): number {
    const c = this.polishCtx;
    const x = u * 512, y = (1 - v) * 512;
    const g = c.createRadialGradient(x, y, 0, x, y, radius);
    g.addColorStop(0, `rgba(255,255,255,${strength})`);
    g.addColorStop(0.6, `rgba(255,255,255,${strength * 0.45})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.globalCompositeOperation = 'lighter';
    c.fillStyle = g;
    c.beginPath(); c.arc(x, y, radius, 0, Math.PI * 2); c.fill();
    c.globalCompositeOperation = 'source-over';
    this.polishTex.needsUpdate = true;
    return strength;
  }

  resetPolish() {
    this.polishCtx.globalCompositeOperation = 'source-over';
    this.polishCtx.fillStyle = '#000';
    this.polishCtx.fillRect(0, 0, 512, 512);
    this.polishTex.needsUpdate = true;
  }

  dispose() {
    this.bowlSheet.dispose();
    this.petalSheets.forEach((p) => p.dispose());
    this.crown.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    this.polishTex.dispose();
    this.material.dispose();
  }
}

const _prof = { r: 0, y: 0, a: 0 };
const _nrm = new THREE.Vector3();
const _pt = new THREE.Vector3();
