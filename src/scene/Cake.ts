import * as THREE from 'three';
import { CAKE_RADIUS, CAKE_TOP, CakeSurfaceContact } from './CakeSurfaceContact';
import { fbm2, clamp } from '../util/math';

/**
 * A 15 cm strawberry shortcake, napped in white cream. The top is not a plane:
 * it carries the shallow spiral the palette knife left, and it dents where the
 * nozzle presses.
 */
export class Cake {
  readonly group = new THREE.Group();
  private topGeo: THREE.PlaneGeometry | THREE.BufferGeometry;
  private topPos: THREE.BufferAttribute;
  private topRings: number;
  private topSegs: number;
  private accum = 0;

  constructor(private contact: CakeSurfaceContact, quality: { cakeRings: number; cakeSegs: number }) {
    this.topRings = quality.cakeRings;
    this.topSegs = quality.cakeSegs;

    const nappe = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0.936, 0.918, 0.885),
      roughness: 0.62,
      metalness: 0,
      sheen: 0.4,
      sheenRoughness: 0.9,
      sheenColor: new THREE.Color(1, 0.96, 0.92),
      clearcoat: 0.06,
      clearcoatRoughness: 0.8,
    });

    // ---- top disc -------------------------------------------------------
    const g = new THREE.BufferGeometry();
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const R = this.topRings;
    const S = this.topSegs;
    for (let r = 0; r <= R; r++) {
      const rad = (r / R) * CAKE_RADIUS;
      for (let s = 0; s <= S; s++) {
        const th = (s / S) * Math.PI * 2;
        pos.push(Math.cos(th) * rad, CAKE_TOP, Math.sin(th) * rad);
        uv.push(0.5 + (Math.cos(th) * rad) / (2 * CAKE_RADIUS), 0.5 + (Math.sin(th) * rad) / (2 * CAKE_RADIUS));
      }
    }
    for (let r = 0; r < R; r++) {
      for (let s = 0; s < S; s++) {
        const a = r * (S + 1) + s;
        const b = a + 1;
        const c = (r + 1) * (S + 1) + s + 1;
        const d = (r + 1) * (S + 1) + s;
        if (r > 0) idx.push(a, b, c);
        idx.push(a, c, d);
      }
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.topGeo = g;
    this.topPos = g.getAttribute('position') as THREE.BufferAttribute;
    const top = new THREE.Mesh(g, nappe);
    top.receiveShadow = true;
    top.castShadow = false;
    this.group.add(top);
    this.refreshTop();

    // ---- side: spatula streaks -----------------------------------------
    const sideSegs = Math.max(64, S);
    const sideRows = 22;
    const sg = new THREE.CylinderGeometry(CAKE_RADIUS, CAKE_RADIUS * 0.988, CAKE_TOP, sideSegs, sideRows, true);
    const sp = sg.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < sp.count; i++) {
      const x = sp.getX(i);
      const y = sp.getY(i);
      const z = sp.getZ(i);
      const th = Math.atan2(z, x);
      const r = Math.hypot(x, z);
      const streak =
        Math.sin(th * 42) * 0.00055 + fbm2(th * 7, (y + 0.03) * 120, 3) * 0.0006;
      const nr = r + streak;
      sp.setXYZ(i, Math.cos(th) * nr, y, Math.sin(th) * nr);
    }
    sg.translate(0, CAKE_TOP * 0.5, 0);
    sg.computeVertexNormals();
    const side = new THREE.Mesh(sg, nappe);
    side.castShadow = true;
    side.receiveShadow = true;
    this.group.add(side);

    // ---- bottom / board contact ----------------------------------------
    const bg = new THREE.CircleGeometry(CAKE_RADIUS * 0.988, sideSegs);
    bg.rotateX(Math.PI / 2);
    const bottom = new THREE.Mesh(bg, new THREE.MeshStandardMaterial({ color: 0xe4dcce, roughness: 0.9 }));
    bottom.position.y = 0.0006;
    this.group.add(bottom);
  }

  /** Rebuild the top's Y from the nappe + dent fields. Throttled by the caller. */
  refreshTop(): void {
    const R = this.topRings;
    const S = this.topSegs;
    for (let r = 0; r <= R; r++) {
      for (let s = 0; s <= S; s++) {
        const i = r * (S + 1) + s;
        const x = this.topPos.getX(i);
        const z = this.topPos.getZ(i);
        // let the very edge stay put so the top meets the side cleanly
        const edge = 1 - clamp((Math.hypot(x, z) - CAKE_RADIUS * 0.9) / (CAKE_RADIUS * 0.1), 0, 1);
        this.topPos.setY(i, CAKE_TOP + this.contact.nappe(x, z) * edge);
      }
    }
    this.topPos.needsUpdate = true;
    (this.topGeo as THREE.BufferGeometry).computeVertexNormals();
  }

  update(dt: number): void {
    this.accum += dt;
    if (this.contact.dirty && this.accum > 0.1) {
      this.accum = 0;
      this.contact.clearDirty();
      this.refreshTop();
    }
  }
}
