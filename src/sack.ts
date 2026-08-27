import * as THREE from 'three';
import { clamp, fbm2, smoothstep, lerp } from './util';
import { sackFabricTexture, furTexture } from './textures';

/**
 * The realistic sack outside. Thick red woven fabric with:
 * sagging profile, flattened floor contact, rolled hem, fur trim,
 * drawstring + wooden toggle, seam ridges, worn grab areas (in texture).
 * Mouth opening is a CPU morph (open amount + directional lean toward
 * the approaching present).
 */
export class Sack {
  group = new THREE.Group();
  mesh: THREE.Mesh;
  fur: THREE.Mesh;
  private basePos: Float32Array;
  private furBase: Float32Array;
  /** 0 = relaxed, 1 = fully open */
  open = 0;
  private appliedOpen = -1;
  /** world-space direction the mouth leans toward (normalized, y ignored) */
  leanDir = new THREE.Vector3();
  leanAmt = 0;
  private appliedLean = -1;
  private appliedLeanX = 0;
  private appliedLeanZ = 0;
  mouthY = 1.42;
  mouthRadius = 0.27;
  /** interior throat that reads as deep darkness when looking in */
  throat: THREE.Mesh;
  jiggle = 0; // set >0 for a "spon" wobble
  private jigglePhase = 0;
  weight = 0; // grows a little as presents go in

  constructor() {
    const { map, bump } = sackFabricTexture();
    const mat = new THREE.MeshStandardMaterial({
      map, bumpMap: bump, bumpScale: 0.6,
      roughness: 0.92, metalness: 0,
      side: THREE.DoubleSide,
    });

    // ---- profile (y up). Realistic sag: fat base, flattened bottom,
    // gentle taper, neck, rolled hem folding back down outside.
    const prof: THREE.Vector2[] = [];
    const P = (r: number, y: number) => prof.push(new THREE.Vector2(r, y));
    P(0.0, 0.012);
    P(0.30, 0.008);
    P(0.52, 0.015);        // floor contact spread
    P(0.60, 0.09);         // bottom bulge (weight)
    P(0.64, 0.28);
    P(0.63, 0.52);         // belly
    P(0.575, 0.82);
    P(0.485, 1.08);
    P(0.38, 1.28);         // shoulder into neck
    P(0.315, 1.40);
    P(0.30, 1.50);         // neck (clearly narrower than any present)
    P(0.315, 1.56);        // hem starts rolling out
    P(0.35, 1.585);        // rolled hem outer
    P(0.34, 1.53);         // folds back DOWN outside (hem return)
    P(0.31, 1.49);
    const geo = new THREE.LatheGeometry(prof, 96);
    // wrinkles: vertical cloth folds, stronger near bottom where weight gathers,
    // seam ridges at 4 angles, slight ellipse
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const theta = Math.atan2(v.z, v.x);
      const r = Math.hypot(v.x, v.z);
      if (r > 0.02) {
        const h = clamp(v.y / 1.5, 0, 1);
        const foldAmp = 0.045 * (1 - h * 0.6) * smoothstep(0.03, 0.2, v.y);
        let dr = (fbm2(theta * 1.6 + 4, v.y * 2.2, 3) - 0.5) * 2 * foldAmp;
        dr += Math.sin(theta * 7 + 1.7) * foldAmp * 0.4;
        // seam ridges every 90deg
        const seam = Math.pow(Math.abs(Math.sin(theta * 2)), 60) * 0.008;
        dr += seam;
        const k = (r + dr) / r;
        v.x *= k; v.z *= k;
        v.z *= 0.96; // slight ellipse, not a perfect solid of revolution
      }
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    // planar-ish UVs: theta/height so the texture seams line up vertically
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const theta = Math.atan2(v.z, v.x);
      uv.setXY(i, (theta / (Math.PI * 2) + 0.5) * 2, 1 - v.y / 1.6);
    }
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.basePos = new Float32Array(pos.array);
    this.group.add(this.mesh);

    // ---- white fur trim (compressed, clumped) as a squashed torus at the hem
    const furGeo = new THREE.TorusGeometry(0.335, 0.04, 12, 72);
    furGeo.rotateX(Math.PI / 2);
    furGeo.translate(0, 1.545, 0);
    const fpos = furGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < fpos.count; i++) {
      v.fromBufferAttribute(fpos, i);
      const theta = Math.atan2(v.z, v.x);
      // clumping + compression: uneven tufts, flattened top (pressed by hands)
      const tuft = (fbm2(theta * 3.5, v.y * 8, 3) - 0.5) * 0.03;
      const press = v.y > 1.56 ? -0.012 : 0;
      const r = Math.hypot(v.x, v.z);
      const k = (r + tuft) / r;
      v.x *= k; v.z *= k * 0.96; v.y += press + tuft * 0.5;
      fpos.setXYZ(i, v.x, v.y, v.z);
    }
    furGeo.computeVertexNormals();
    this.fur = new THREE.Mesh(furGeo, new THREE.MeshStandardMaterial({
      map: furTexture(), roughness: 0.95, side: THREE.DoubleSide,
    }));
    this.fur.castShadow = true;
    this.furBase = new Float32Array(fpos.array);
    this.group.add(this.fur);

    // ---- drawstring: cord ring through the hem + hanging ends + toggle
    const cordMat = new THREE.MeshStandardMaterial({ color: 0xb59f76, roughness: 0.85 });
    const hangCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.35, 1.44, 0.13),
      new THREE.Vector3(0.42, 1.28, 0.2),
      new THREE.Vector3(0.40, 1.06, 0.24),
      new THREE.Vector3(0.435, 0.9, 0.22),
    ]);
    const hang = new THREE.Mesh(new THREE.TubeGeometry(hangCurve, 20, 0.013, 6), cordMat);
    this.group.add(hang);
    const toggle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.028, 0.028, 0.07, 10),
      new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.6 })
    );
    toggle.position.set(0.435, 0.86, 0.22);
    toggle.rotation.z = 0.4;
    this.group.add(toggle);

    // ---- interior throat: deep dark red, hides the inside until entry
    const throatGeo = new THREE.CylinderGeometry(0.29, 0.1, 0.9, 32, 8, true);
    throatGeo.translate(0, 1.0, 0);
    const tCanvas = document.createElement('canvas');
    tCanvas.width = 64; tCanvas.height = 256;
    const tg = tCanvas.getContext('2d')!;
    const grad = tg.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#0d0304');
    grad.addColorStop(0.5, '#2a0a0c');
    grad.addColorStop(1, '#5a1518');
    tg.fillStyle = grad; tg.fillRect(0, 0, 64, 256);
    const tTex = new THREE.CanvasTexture(tCanvas);
    tTex.colorSpace = THREE.SRGBColorSpace;
    this.throat = new THREE.Mesh(throatGeo, new THREE.MeshBasicMaterial({
      map: tTex, side: THREE.BackSide,
    }));
    this.group.add(this.throat);
    const throatCap = new THREE.Mesh(
      new THREE.CircleGeometry(0.14, 24),
      new THREE.MeshBasicMaterial({ color: 0x050102 })
    );
    throatCap.rotation.x = Math.PI / 2;
    throatCap.position.y = 0.56;
    this.throat.add(throatCap);
  }

  /** world position of the mouth center (sack may lean) */
  mouthWorld(target: THREE.Vector3) {
    target.set(0, this.mouthY, 0);
    this.group.updateMatrixWorld();
    return this.group.localToWorld(target);
  }

  update(dt: number, time: number) {
    if (this.jiggle > 0.001) {
      this.jigglePhase += dt * 26;
      const j = this.jiggle * Math.sin(this.jigglePhase);
      this.mesh.scale.set(1 + j * 0.05, 1 - j * 0.04, 1 + j * 0.05);
      this.fur.scale.copy(this.mesh.scale);
      this.jiggle *= Math.exp(-dt * 4.5);
    } else if (this.mesh.scale.x !== 1) {
      this.mesh.scale.setScalar(1);
      this.fur.scale.setScalar(1);
    }

    const targetLeanX = this.leanDir.x * this.leanAmt;
    const targetLeanZ = this.leanDir.z * this.leanAmt;
    const needMorph =
      Math.abs(this.open - this.appliedOpen) > 0.004 ||
      Math.abs(targetLeanX - this.appliedLeanX) > 0.004 ||
      Math.abs(targetLeanZ - this.appliedLeanZ) > 0.004;
    if (!needMorph) return;
    this.appliedOpen = this.open;
    this.appliedLeanX = lerp(this.appliedLeanX, targetLeanX, 0.35);
    this.appliedLeanZ = lerp(this.appliedLeanZ, targetLeanZ, 0.35);

    const morph = (posAttr: THREE.BufferAttribute, base: Float32Array) => {
      const v = new THREE.Vector3();
      for (let i = 0; i < posAttr.count; i++) {
        v.set(base[i * 3], base[i * 3 + 1], base[i * 3 + 2]);
        const w = smoothstep(1.05, 1.5, v.y); // only the neck moves
        if (w > 0) {
          const r = Math.hypot(v.x, v.z);
          if (r > 0.01) {
            const nx = v.x / r, nz = v.z / r;
            // radial opening
            const stretch = this.open * 0.5 * w;
            // lean toward the present: the near side reaches out, far side follows less
            const facing = (nx * this.appliedLeanX + nz * this.appliedLeanZ);
            const leanOut = Math.max(0, facing) * 0.55 * w;
            const newR = r * (1 + stretch) + leanOut;
            v.x = nx * newR + this.appliedLeanX * 0.16 * w;
            v.z = nz * newR + this.appliedLeanZ * 0.16 * w;
            // cloth pays for the stretch: neck drops slightly as it opens
            v.y -= (this.open * 0.05 + Math.max(0, facing) * this.leanAmt * 0.05) * w;
          }
        }
        posAttr.setXYZ(i, v.x, v.y, v.z);
      }
      posAttr.needsUpdate = true;
    };
    morph(this.mesh.geometry.attributes.position as THREE.BufferAttribute, this.basePos);
    morph(this.fur.geometry.attributes.position as THREE.BufferAttribute, this.furBase);
    this.mesh.geometry.computeVertexNormals();
    // throat follows the opening
    const s = 1 + this.open * 0.45;
    this.throat.scale.set(s, 1, s);
  }
}
