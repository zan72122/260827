import * as THREE from 'three';
import {
  BONDS,
  COVER_HALF,
  CLASP_OFF,
  CLASP_ON,
  HANDLE_Y,
  OPEN_MAX,
  PAPER_HALF,
  SHEETS,
  TREE_HEIGHT,
  stackGapFor,
} from '../config';
import { buildHoneycombGeometry } from './honeycombGeometry';
import { createPaperDepthMaterial, createPaperMaterial, createPaperUniforms } from './paperMaterial';
import { makeCoverGeometry } from './profileBoard';
import { radiusAtY } from './profile';
import type { Textures } from '../textures';

const STACK_EDGE = (SHEETS - 1) / 2;

/**
 * The whole paper object: 48 tissue leaves, two cardboard covers, the steel
 * clasp and the thread it hangs from. One `open` value in [0,1] drives all of
 * it, continuously, in both directions.
 */
export class PaperTree {
  readonly group = new THREE.Group();
  readonly triangles: number;

  private uniforms = createPaperUniforms();
  private leaves: THREE.Mesh;
  private coverA = new THREE.Group();
  private coverB = new THREE.Group();
  private clip: THREE.Mesh;
  private eyelet: THREE.Mesh;
  private disposables: { dispose(): void }[] = [];

  private open = 0;
  private clasped = 0;
  private claspTarget = 0;

  constructor(tex: Textures) {
    const build = buildHoneycombGeometry();
    this.triangles = build.triangles;

    const leafMat = createPaperMaterial(this.uniforms, {
      color: new THREE.Color(0x4e7145),
      roughness: 0.94,
      metalness: 0.0,
      normalMap: tex.paperNormal,
      normalScale: new THREE.Vector2(0.15, 0.15),
      roughnessMap: tex.paperRough,
      side: THREE.FrontSide,
    });
    this.leaves = new THREE.Mesh(build.geometry, leafMat);
    this.leaves.customDepthMaterial = createPaperDepthMaterial(this.uniforms);
    this.leaves.castShadow = true;
    this.leaves.receiveShadow = true;
    this.leaves.frustumCulled = false;
    this.group.add(this.leaves);
    this.disposables.push(build.geometry, leafMat, this.leaves.customDepthMaterial);

    const coverGeo = makeCoverGeometry(COVER_HALF);
    const coverMat = new THREE.MeshStandardMaterial({
      color: 0xcfc6b0,
      roughness: 0.92,
      metalness: 0.0,
      normalMap: tex.cardNormal,
      normalScale: new THREE.Vector2(0.16, 0.16),
      roughnessMap: tex.cardRough,
    });
    this.disposables.push(coverGeo, coverMat);
    for (const g of [this.coverA, this.coverB]) {
      const m = new THREE.Mesh(coverGeo, coverMat);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
      this.group.add(g);
    }

    // --- clasp: an eyelet on the fixed cover, a swinging steel clip on the
    // moving one. It bites when the ends meet and falls away as soon as the
    // finger starts closing the tree - never a separate puzzle.
    const steel = new THREE.MeshStandardMaterial({
      color: 0xb4b8bd,
      roughness: 0.33,
      metalness: 0.92,
    });
    const eyeGeo = new THREE.TorusGeometry(0.0042, 0.0007, 6, 16);
    const clipGeo = new THREE.TorusGeometry(0.0052, 0.0009, 6, 18, Math.PI * 1.55);
    this.disposables.push(steel, eyeGeo, clipGeo);
    this.eyelet = new THREE.Mesh(eyeGeo, steel);
    this.clip = new THREE.Mesh(clipGeo, steel);
    this.eyelet.castShadow = this.clip.castShadow = true;
    const claspY = 0.152;
    const claspR = radiusAtY(claspY) * 0.9;
    this.eyelet.position.set(claspR, claspY, 0);
    this.clip.position.set(claspR, claspY, 0);
    this.coverA.add(this.eyelet);
    this.coverB.add(this.clip);

    this.apply();
  }

  /** Fan angle of the moving cover, radians. */
  get openAngle(): number {
    return this.open * OPEN_MAX;
  }

  get openness(): number {
    return this.open;
  }

  set openness(v: number) {
    this.open = Math.min(1, Math.max(0, v));
    this.apply();
  }

  private coverPose(theta: number, sign: number, gap: number) {
    const off = sign * (STACK_EDGE * gap + PAPER_HALF + COVER_HALF);
    return {
      theta,
      pos: new THREE.Vector3(-Math.sin(theta) * off, 0, Math.cos(theta) * off),
    };
  }

  private apply() {
    const angle = this.openAngle;
    const gap = stackGapFor(angle);
    this.uniforms.uOpen.value = angle;
    this.uniforms.uStackGap.value = gap;
    this.uniforms.uOpenAmount.value = Math.min(1, this.open * 4);

    // Half a cell of clearance on each side, so at full open the two covers
    // arrive back to back at one seam instead of passing through each other.
    const half = angle / BONDS / 2;
    const a = this.coverPose(-half, -1, gap);
    const b = this.coverPose(angle + half, 1, gap);
    this.coverA.rotation.y = -a.theta;
    this.coverA.position.copy(a.pos);
    this.coverB.rotation.y = -b.theta;
    this.coverB.position.copy(b.pos);

    this.claspTarget =
      this.open >= CLASP_ON ? 1 : this.open <= CLASP_OFF ? 0 : this.claspTarget;
    // engaged: ring lies flat across both covers. free: it hangs off the edge.
    this.clip.rotation.set(0, 0, -1.15 * (1 - this.clasped));
    this.clip.position.z = -0.0016 * this.clasped;
  }

  /** Swings the clasp; nothing else needs a clock. */
  update(dt: number) {
    if (this.clasped === this.claspTarget) return;
    const step = Math.min(1, dt * 9);
    this.clasped += (this.claspTarget - this.clasped) * step;
    if (Math.abs(this.claspTarget - this.clasped) < 0.002) this.clasped = this.claspTarget;
    this.apply();
  }

  /** World point the finger nominally holds: the lower edge of the moving cover. */
  handlePoint(out = new THREE.Vector3()): THREE.Vector3 {
    const r = radiusAtY(HANDLE_Y) * 0.88;
    out.set(r, HANDLE_Y, 0);
    this.coverB.localToWorld(out);
    return out;
  }

  /**
   * A scatter of points that lie on the paper as it is right now. Used only for
   * hit testing, so the child can re-grab anywhere on the body without the
   * paper itself being fattened up to catch the finger.
   */
  grabPoints(out: THREE.Vector3[]): THREE.Vector3[] {
    out.length = 0;
    const angle = this.openAngle;
    const heights = [0.03, 0.06, 0.1, 0.145, 0.19, 0.235, 0.275];
    const steps = 9;
    for (let s = 0; s <= steps; s++) {
      const th = (angle * s) / steps;
      const c = Math.cos(th);
      const sn = Math.sin(th);
      for (const y of heights) {
        const r = radiusAtY(y);
        out.push(new THREE.Vector3(c * r * 0.72, y, sn * r * 0.72));
        out.push(new THREE.Vector3(c * r, y, sn * r));
      }
    }
    out.push(this.handlePoint());
    return out;
  }

  setSun(dirView: THREE.Vector3, color: THREE.Color) {
    this.uniforms.uSunDirView.value.copy(dirView);
    this.uniforms.uSunColor.value.copy(color);
  }

  setCoversVisible(v: boolean) {
    this.coverA.visible = v;
    this.coverB.visible = v;
  }

  setTranslucency(v: number) {
    this.uniforms.uThrough.value = v;
  }

  get apexY() {
    return TREE_HEIGHT;
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}
