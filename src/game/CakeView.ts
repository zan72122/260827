import * as THREE from 'three';
import { TAU } from '../core/rng';
import type { Materials } from '../content/Materials';
import type { StrawberryCatalog } from '../content/StrawberryCatalog';
import type { AdaptiveQuality } from '../core/Quality';
import { CreamField } from '../content/CreamField';
import { buildPolarSolid, updatePolarSolid } from '../content/PolarSolid';
import { CAKE } from './CakeSpec';
import { PlacementRing, seatPlacement, type Placement } from './PlacementRing';
import { BerryView, type CapInfo, type CapRequest } from './BerryView';

const SPONGE_UV = 0.052;
const CREAM_UV = 0.046;

export interface CakeViewOptions {
  a0: number;
  a1: number;
  /** Clipping applied to the strawberries, which are not sector geometry. */
  clip?: { planes: THREE.Plane[]; union: boolean };
  caps?: CapRequest[];
}

export interface RevealItem {
  slotId: number;
  variantId: string;
  orientation: string;
  /** The child put this one in themselves. */
  byPlayer: boolean;
  cap: CapInfo;
}

/**
 * One physical piece of cake — the whole thing during assembly, or a wedge and
 * its remainder after the knife. Sponge and cream are built as real angular
 * sectors with their knife faces in the mesh; the strawberries are clipped to
 * the same sector and capped with their true cross sections.
 */
export class CakeView {
  readonly root = new THREE.Group();
  readonly berries = new Map<number, BerryView>();

  private readonly bottom: THREE.Mesh;
  private readonly creamMesh: THREE.Mesh;
  private readonly topSponge: THREE.Mesh;
  private readonly coatWall: THREE.Mesh;
  private readonly coatLid: THREE.Mesh;
  private readonly berryRoot = new THREE.Group();
  private creamRevision = -1;
  private topBaseY = CAKE.creamBase + CAKE.creamInitial;
  private coatSweep = 0;
  private cakeTopY = CAKE.creamBase + CAKE.creamInitial + CAKE.topSpongeThickness;

  constructor(
    private readonly materials: Materials,
    private readonly catalog: StrawberryCatalog,
    private readonly quality: AdaptiveQuality,
    private readonly cream: CreamField,
    private readonly ring: PlacementRing,
    private opts: CakeViewOptions,
  ) {
    const seg = this.angularSegments();
    const spongeMats = [materials.spongeSurface, materials.spongeCut];
    const creamMats = [materials.creamSurface, materials.creamCut];
    const coatMats = [materials.coating, materials.creamCut];

    this.bottom = new THREE.Mesh(
      buildPolarSolid({
        rOuter: CAKE.radius,
        bottom: CAKE.baseY,
        top: CAKE.baseTop,
        a0: opts.a0,
        a1: opts.a1,
        angularSegments: seg,
        radialSegments: 4,
        uvScale: SPONGE_UV,
      }),
      spongeMats,
    );
    this.bottom.castShadow = true;
    this.bottom.receiveShadow = true;

    this.creamMesh = new THREE.Mesh(
      cream.buildGeometry(opts.a0, opts.a1, CREAM_UV),
      creamMats,
    );
    this.creamMesh.castShadow = false;
    this.creamMesh.receiveShadow = true;
    this.creamRevision = cream.revision;

    this.topSponge = new THREE.Mesh(this.buildTopSpongeGeometry(), spongeMats);
    this.topSponge.castShadow = true;
    this.topSponge.receiveShadow = true;
    this.topSponge.visible = false;

    this.coatWall = new THREE.Mesh(this.buildCoatWall(0), coatMats);
    this.coatLid = new THREE.Mesh(this.buildCoatLid(0), coatMats);
    this.coatWall.castShadow = true;
    this.coatLid.castShadow = true;
    this.coatWall.visible = false;
    this.coatLid.visible = false;

    this.root.add(this.bottom, this.creamMesh, this.topSponge, this.coatWall, this.coatLid, this.berryRoot);
  }

  private angularSegments(): number {
    const span = Math.abs(this.opts.a1 - this.opts.a0);
    return Math.max(6, Math.round((span / TAU) * this.cream.nA));
  }

  private buildTopSpongeGeometry(): THREE.BufferGeometry {
    return buildPolarSolid({
      rOuter: CAKE.radius,
      bottom: this.topBaseY,
      top: this.topBaseY + CAKE.topSpongeThickness,
      a0: this.opts.a0,
      a1: this.opts.a1,
      angularSegments: this.angularSegments(),
      radialSegments: 4,
      uvScale: SPONGE_UV,
    });
  }

  private coatRange(sweep: number): { a0: number; a1: number } {
    const span = this.opts.a1 - this.opts.a0;
    return { a0: this.opts.a0, a1: this.opts.a0 + span * Math.max(0.001, sweep) };
  }

  private buildCoatWall(sweep: number): THREE.BufferGeometry {
    const { a0, a1 } = this.coatRange(sweep);
    return buildPolarSolid({
      rInner: CAKE.radius - 0.0003,
      rOuter: CAKE.radius + CAKE.coatThickness,
      bottom: CAKE.baseY,
      top: this.cakeTopY,
      a0,
      a1,
      angularSegments: 96,
      radialSegments: 1,
      uvScale: CREAM_UV,
    });
  }

  private buildCoatLid(sweep: number): THREE.BufferGeometry {
    const { a0, a1 } = this.coatRange(sweep);
    return buildPolarSolid({
      rOuter: CAKE.radius + CAKE.coatThickness,
      bottom: this.cakeTopY - 0.0003,
      top: this.cakeTopY + CAKE.coatThickness,
      a0,
      a1,
      angularSegments: 96,
      radialSegments: 6,
      uvScale: CREAM_UV,
    });
  }

  /**
   * Slide this piece away from the cake. Clipping planes live in world space,
   * so they travel with the piece — otherwise a lifted wedge would keep being
   * cut by the plane the cake is still sitting on and its strawberries would
   * spill out through the cut face.
   */
  setOffset(x: number, y: number, z: number): void {
    this.root.position.set(x, y, z);
    for (const plane of this.opts.clip?.planes ?? []) {
      plane.constant = -(plane.normal.x * x + plane.normal.z * z);
    }
  }

  /** Follow the cream height field; cheap enough to run while piping. */
  refreshCream(force = false): void {
    if (!force && this.creamRevision === this.cream.revision) return;
    this.creamRevision = this.cream.revision;
    if (!this.cream.refreshGeometry(this.creamMesh.geometry, this.opts.a0, this.opts.a1, CREAM_UV)) {
      this.creamMesh.geometry.dispose();
      this.creamMesh.geometry = this.cream.buildGeometry(this.opts.a0, this.opts.a1, CREAM_UV);
    }
  }

  setTopSponge(visible: boolean, baseY: number, lift = 0): void {
    if (Math.abs(baseY - this.topBaseY) > 1e-6) {
      this.topBaseY = baseY;
      this.cakeTopY = baseY + CAKE.topSpongeThickness;
      this.topSponge.geometry.dispose();
      this.topSponge.geometry = this.buildTopSpongeGeometry();
    }
    this.topSponge.visible = visible;
    this.topSponge.position.y = lift;
  }

  get topY(): number {
    return this.cakeTopY;
  }

  setCoat(sweep: number, lid: boolean): void {
    const s = Math.max(0, Math.min(1, sweep));
    this.coatSweep = s;
    this.coatWall.visible = s > 0.002;
    this.coatLid.visible = lid && s > 0.002;
    const wall = this.coatRange(s);
    if (!updatePolarSolid(this.coatWall.geometry, {
      rInner: CAKE.radius - 0.0003,
      rOuter: CAKE.radius + CAKE.coatThickness,
      bottom: CAKE.baseY,
      top: this.cakeTopY,
      a0: wall.a0,
      a1: wall.a1,
      angularSegments: 96,
      radialSegments: 1,
      uvScale: CREAM_UV,
    })) {
      this.coatWall.geometry.dispose();
      this.coatWall.geometry = this.buildCoatWall(s);
    }
    if (!updatePolarSolid(this.coatLid.geometry, {
      rOuter: CAKE.radius + CAKE.coatThickness,
      bottom: this.cakeTopY - 0.0003,
      top: this.cakeTopY + CAKE.coatThickness,
      a0: wall.a0,
      a1: wall.a1,
      angularSegments: 96,
      radialSegments: 6,
      uvScale: CREAM_UV,
    })) {
      this.coatLid.geometry.dispose();
      this.coatLid.geometry = this.buildCoatLid(s);
    }
  }

  get coat(): number {
    return this.coatSweep;
  }

  /** Pick the near or far strawberry mesh for the current viewing distance. */
  updateLods(camera: THREE.Camera): void {
    for (const view of this.berries.values()) view.updateLod(camera);
  }

  /** Create, move or drop strawberry views so they match the placement list. */
  syncPlacements(placements: readonly Placement[]): void {
    const wanted = new Set(placements.map((p) => p.slotId));
    for (const [slotId, view] of this.berries) {
      if (!wanted.has(slotId)) {
        view.dispose();
        this.berries.delete(slotId);
      }
    }
    for (const p of placements) {
      let view = this.berries.get(p.slotId);
      if (!view || view.assets.variant.id !== p.variantId) {
        if (view) {
          view.dispose();
          this.berries.delete(p.slotId);
        }
        view = new BerryView(this.catalog.get(p.variantId), this.materials, this.quality);
        if (this.opts.clip) view.setClipping(this.opts.clip.planes, this.opts.clip.union);
        // Tag for picking: a tap anywhere on the slice finds its well.
        view.root.userData.slotId = p.slotId;
        this.berryRoot.add(view.root);
        this.berries.set(p.slotId, view);
      }
      const seated = seatPlacement(this.ring.slot(p.slotId), p);
      view.setTransform(seated.position, seated.quaternion);
    }
  }

  /** Run the knife through every berry and keep the faces that really exist. */
  buildCaps(placements: readonly Placement[]): RevealItem[] {
    const out: RevealItem[] = [];
    if (!this.opts.caps?.length) {
      for (const view of this.berries.values()) view.clearCaps();
      return out;
    }
    for (const p of placements) {
      const view = this.berries.get(p.slotId);
      if (!view) continue;
      for (const cap of view.buildCaps(this.opts.caps)) {
        out.push({
          slotId: p.slotId,
          variantId: p.variantId,
          orientation: p.orientation,
          byPlayer: p.byPlayer,
          cap,
        });
      }
    }
    return out;
  }

  dispose(): void {
    for (const view of this.berries.values()) view.dispose();
    this.berries.clear();
    for (const m of [this.bottom, this.creamMesh, this.topSponge, this.coatWall, this.coatLid]) {
      m.geometry.dispose();
    }
    this.root.removeFromParent();
  }
}
