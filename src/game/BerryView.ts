import * as THREE from 'three';
import type { BerryAssets } from '../content/StrawberryCatalog';
import type { Materials } from '../content/Materials';
import type { AdaptiveQuality } from '../core/Quality';
import { sectionOf, type SectionResult } from './SectionGenerator';

const ONE = new THREE.Vector3(1, 1, 1);

export interface CapRequest {
  /** Plane in cake space, oriented so its normal points into this piece. */
  plane: THREE.Plane;
  /** Face the cap away from the piece it belongs to. */
  flip: boolean;
  /** Signed nudge along the plane normal, into the solid. */
  offset: number;
  /** Direction the knife travelled out from the middle. */
  reach: THREE.Vector3;
}

export interface CapInfo {
  area: number;
  centre: THREE.Vector3;
  extent: THREE.Vector2;
}

/**
 * One strawberry slice in the cake: a real solid at near range with seeds on its
 * skin, a cheaper hull further away, and — once the knife has been through — the
 * cut face generated from its actual intersection with the blade's plane.
 */
export class BerryView {
  readonly root = new THREE.Group();
  private readonly lod = new THREE.LOD();
  private readonly caps: THREE.Object3D[] = [];
  /** Body materials get the piece's clipping planes; cut faces never do. */
  private readonly bodyMaterials: THREE.Material[] = [];
  private readonly capMaterials: THREE.Material[] = [];
  private readonly sectionMaterial: THREE.MeshPhysicalMaterial;
  private readonly contactMaterial: THREE.MeshStandardMaterial;

  constructor(
    readonly assets: BerryAssets,
    materials: Materials,
    quality: AdaptiveQuality,
  ) {
    const base = materials.berry(assets);
    const flesh = base.flesh.clone();
    const skin = base.skin.clone();
    this.sectionMaterial = base.section.clone();
    // Cream that was pushed aside by the fruit before it set: a slightly
    // denser, slightly shaded collar right where the two touch.
    this.contactMaterial = materials.creamContact.clone();
    this.bodyMaterials.push(flesh, skin);
    this.capMaterials.push(this.sectionMaterial, this.contactMaterial);

    const near = new THREE.Group();
    const nearMesh = new THREE.Mesh(assets.near, [flesh, skin]);
    nearMesh.castShadow = true;
    nearMesh.receiveShadow = true;
    near.add(nearMesh);

    if (assets.achenes.matrices.length) {
      const achene = base.achene.clone();
      this.bodyMaterials.push(achene);
      const seeds = new THREE.InstancedMesh(
        new THREE.SphereGeometry(1, 8, 6),
        achene,
        assets.achenes.matrices.length,
      );
      assets.achenes.matrices.forEach((m, i) => {
        seeds.setMatrixAt(i, m);
        seeds.setColorAt(i, assets.achenes.colors[i]);
      });
      seeds.instanceMatrix.needsUpdate = true;
      if (seeds.instanceColor) seeds.instanceColor.needsUpdate = true;
      seeds.castShadow = false;
      near.add(seeds);
    }

    const far = new THREE.Mesh(assets.far, [flesh, skin]);
    far.castShadow = quality.tier !== 'low';

    this.lod.addLevel(near, 0);
    this.lod.addLevel(far, quality.tier === 'low' ? 0.18 : 0.34);
    this.root.add(this.lod);
  }

  updateLod(camera: THREE.Camera): void {
    this.lod.update(camera);
  }

  setTransform(position: THREE.Vector3, quaternion: THREE.Quaternion): void {
    this.root.position.copy(position);
    this.root.quaternion.copy(quaternion);
    this.root.updateMatrix();
  }

  setOpacity(value: number): void {
    for (const m of [...this.bodyMaterials, ...this.capMaterials]) {
      m.transparent = value < 1;
      (m as THREE.MeshStandardMaterial).opacity = value;
      m.depthWrite = value > 0.98;
    }
  }

  /**
   * Applied to the berry's body only. The cut faces are trimmed as geometry
   * instead, so they can sit a hair proud of the cream and sponge they share
   * the plane with rather than being clipped away by it.
   */
  setClipping(planes: THREE.Plane[] | null, union: boolean): void {
    for (const m of this.bodyMaterials) {
      m.clippingPlanes = planes;
      m.clipIntersection = union;
      m.needsUpdate = true;
    }
  }

  clearCaps(): void {
    for (const c of this.caps) {
      c.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
      this.root.remove(c);
    }
    this.caps.length = 0;
  }

  /**
   * Cut this berry with the planes the knife actually travelled and show the
   * resulting face. Returns one entry per plane the berry really meets — empty
   * when the knife missed it, which is the honest answer for most of the ring.
   */
  buildCaps(requests: readonly CapRequest[]): CapInfo[] {
    this.clearCaps();
    const out: CapInfo[] = [];
    const matrix = new THREE.Matrix4().compose(
      this.root.position,
      this.root.quaternion,
      ONE,
    );
    const inverse = matrix.clone().invert();

    for (const req of requests) {
      const local = req.plane.clone().applyMatrix4(inverse);
      const res: SectionResult | null = sectionOf(this.assets.collider, local, {
        uvBox: this.assets.box,
        thickness: this.assets.variant.thickness,
        flip: req.flip,
        offset: req.offset,
        trim: {
          axis: new THREE.Vector3(0, 0, 0).applyMatrix4(inverse),
          outward: req.reach.clone().transformDirection(inverse),
        },
      });
      if (!res) continue;
      if (res.area < 4e-6) {
        res.geometry.dispose();
        continue;
      }
      const mesh = new THREE.Mesh(res.geometry, this.sectionMaterial);
      mesh.renderOrder = 3;
      this.root.add(mesh);
      this.caps.push(mesh);

      // The collar of displaced cream, taken from the same outline so it hugs
      // the exact shape of this berry rather than being a painted ring.
      const collar = new THREE.Group();
      const inner = new THREE.Mesh(res.geometry.clone(), this.contactMaterial);
      inner.position.copy(res.centroid).multiplyScalar(-1);
      inner.renderOrder = 2;
      collar.add(inner);
      collar.position.copy(res.centroid).addScaledVector(local.normal, -req.offset * 0.55);
      collar.scale.setScalar(1.055);
      this.root.add(collar);
      this.caps.push(collar);
      out.push({
        area: res.area,
        centre: res.centroid.clone().applyMatrix4(matrix),
        extent: res.extent,
      });
    }
    return out;
  }

  dispose(): void {
    this.clearCaps();
    for (const m of [...this.bodyMaterials, ...this.capMaterials]) m.dispose();
    this.root.removeFromParent();
  }
}
