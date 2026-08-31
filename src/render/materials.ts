import * as THREE from 'three';
import type { TextureLibrary } from './textures';
import { CREAM_COLORS, type CreamColorId } from '../core/FlowerRecord';

/**
 * Material library.
 *
 * The rule the whole look follows: buttercream is a soft dielectric with a
 * local sheen, steel is a real metal with directional wear, porcelain is a
 * glazed dielectric with a clearcoat, paper and sponge are matte. Nothing here
 * shares a single plastic gloss, nothing emits except an actual flame.
 */
export class Materials {
  readonly cream: Record<CreamColorId, THREE.MeshPhysicalMaterial>;
  readonly coatCream: THREE.MeshPhysicalMaterial;
  readonly glueCream: THREE.MeshPhysicalMaterial;
  readonly steel: THREE.MeshStandardMaterial;
  readonly steelDark: THREE.MeshStandardMaterial;
  readonly brushedAlloy: THREE.MeshStandardMaterial;
  readonly paper: THREE.MeshStandardMaterial;
  readonly porcelain: THREE.MeshPhysicalMaterial;
  readonly sponge: THREE.MeshStandardMaterial;
  readonly crust: THREE.MeshStandardMaterial;
  readonly wood: THREE.MeshStandardMaterial;
  readonly stone: THREE.MeshStandardMaterial;
  readonly cloth: THREE.MeshStandardMaterial;
  readonly skin: THREE.MeshPhysicalMaterial;
  readonly bagFabric: THREE.MeshPhysicalMaterial;
  readonly wax: THREE.MeshPhysicalMaterial;
  readonly flame: THREE.MeshBasicMaterial;
  readonly wick: THREE.MeshStandardMaterial;
  readonly card: THREE.MeshStandardMaterial;
  readonly paintedWood: THREE.MeshStandardMaterial;
  readonly wall: THREE.MeshStandardMaterial;
  readonly glass: THREE.MeshBasicMaterial;
  readonly ghost: THREE.MeshBasicMaterial;

  private readonly all: THREE.Material[] = [];

  constructor(tex: TextureLibrary) {
    const keep = <T extends THREE.Material>(m: T): T => {
      this.all.push(m);
      return m;
    };

    const creamOf = (id: CreamColorId) =>
      keep(
        new THREE.MeshPhysicalMaterial({
          color: CREAM_COLORS[id].hex,
          // Buttercream is fat: soft and matte with a low, broad sheen, not a
          // glossy plastic. The clear coat is only just there.
          roughness: 0.52,
          metalness: 0,
          clearcoat: 0.06,
          clearcoatRoughness: 0.62,
          sheen: 0.45,
          sheenRoughness: 0.6,
          sheenColor: new THREE.Color(0xffffff),
          normalMap: tex.creamNormal,
          normalScale: new THREE.Vector2(0.85, 0.85),
          roughnessMap: tex.creamRough,
          envMapIntensity: 1.0,
        }),
      );

    this.cream = {
      rose: creamOf('rose'),
      butter: creamOf('butter'),
      lilac: creamOf('lilac'),
    };
    // The grain of piped buttercream is well under a millimetre, so the map has
    // to tile many times across a 12 mm ribbon to read as texture, not as lumps.
    tex.creamNormal.repeat.set(10, 5);
    tex.creamRough.repeat.set(10, 5);

    this.coatCream = keep(
      new THREE.MeshPhysicalMaterial({
        color: 0xfaf1e2,
        roughness: 0.55,
        metalness: 0,
        clearcoat: 0.05,
        clearcoatRoughness: 0.65,
        sheen: 0.38,
        sheenRoughness: 0.65,
        normalMap: tex.creamNormal,
        normalScale: new THREE.Vector2(0.55, 0.55),
        roughnessMap: tex.creamRough,
      }),
    );
    this.glueCream = keep(
      new THREE.MeshPhysicalMaterial({
        color: 0xfaf1e2,
        roughness: 0.4,
        metalness: 0,
        sheen: 0.3,
        normalMap: tex.creamNormal,
        normalScale: new THREE.Vector2(0.4, 0.4),
      }),
    );

    this.steel = keep(
      new THREE.MeshStandardMaterial({
        // Stainless, not a mirror: a touch of diffuse keeps a piping tip
        // legible when it is turned away from the window.
        color: 0xeceef0,
        metalness: 0.88,
        roughness: 0.26,
        roughnessMap: tex.steelRough,
        normalMap: tex.steelNormal,
        normalScale: new THREE.Vector2(0.22, 0.22),
        envMapIntensity: 2.4,
        side: THREE.DoubleSide,
      }),
    );
    this.steelDark = keep(
      new THREE.MeshStandardMaterial({
        color: 0xc6cacd,
        metalness: 0.9,
        roughness: 0.42,
        roughnessMap: tex.steelRough,
        envMapIntensity: 1.6,
      }),
    );
    // A turntable plate is spun aluminium, not a mirror: matte enough to read
    // as a surface the cake is standing on.
    this.brushedAlloy = keep(
      new THREE.MeshStandardMaterial({
        color: 0xd2d4d5,
        metalness: 0.92,
        roughness: 0.5,
        roughnessMap: tex.steelRough,
        envMapIntensity: 1.3,
      }),
    );

    this.paper = keep(
      new THREE.MeshStandardMaterial({
        color: 0xf6f0e4,
        roughness: 0.88,
        metalness: 0,
        map: tex.paperColor,
        normalMap: tex.paperNormal,
        normalScale: new THREE.Vector2(0.35, 0.35),
        side: THREE.DoubleSide,
      }),
    );

    this.porcelain = keep(
      new THREE.MeshPhysicalMaterial({
        color: 0xf7f5f1,
        roughness: 0.09,
        metalness: 0,
        clearcoat: 0.9,
        clearcoatRoughness: 0.06,
        roughnessMap: tex.porcelainRough,
        envMapIntensity: 1.05,
      }),
    );

    this.sponge = keep(
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: tex.spongeColor,
        normalMap: tex.spongeNormal,
        normalScale: new THREE.Vector2(0.9, 0.9),
        roughness: 0.9,
        metalness: 0,
      }),
    );
    this.crust = keep(
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: tex.crustColor,
        roughness: 0.82,
        metalness: 0,
      }),
    );

    this.wood = keep(
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: tex.woodColor,
        roughnessMap: tex.woodRough,
        roughness: 0.62,
        metalness: 0,
      }),
    );
    this.stone = keep(
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: tex.stoneColor,
        roughnessMap: tex.stoneRough,
        roughness: 0.4,
        metalness: 0,
      }),
    );
    // The cloth's UVs run once around the whole tablecloth, so the weave has to
    // tile hard or it reads as wood grain rather than linen.
    tex.clothColor.repeat.set(10, 10);
    tex.clothNormal.repeat.set(10, 10);
    this.cloth = keep(
      new THREE.MeshStandardMaterial({
        color: 0xe8e3da,
        map: tex.clothColor,
        normalMap: tex.clothNormal,
        normalScale: new THREE.Vector2(0.45, 0.45),
        roughness: 0.88,
        metalness: 0,
      }),
    );

    this.skin = keep(
      new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        map: tex.skinColor,
        normalMap: tex.skinNormal,
        normalScale: new THREE.Vector2(0.4, 0.4),
        roughness: 0.62,
        metalness: 0,
        sheen: 0.2,
        sheenRoughness: 0.85,
        clearcoat: 0.08,
        clearcoatRoughness: 0.7,
      }),
    );

    // A piping bag is thin polythene. Rather than paying for a real
    // transmission pass — which every material in the scene would then share
    // the cost of — it is a pale dielectric with a strong sheen and a clear
    // coat, which is what it reads as at this distance anyway.
    this.bagFabric = keep(
      new THREE.MeshPhysicalMaterial({
        color: 0xe4e1d8,
        roughness: 0.3,
        metalness: 0,
        clearcoat: 0.55,
        clearcoatRoughness: 0.22,
        sheen: 0.4,
        sheenRoughness: 0.5,
        sheenColor: new THREE.Color(0xffffff),
        side: THREE.DoubleSide,
      }),
    );

    this.wax = keep(
      new THREE.MeshPhysicalMaterial({
        color: 0xf6e9df,
        roughness: 0.3,
        metalness: 0,
        clearcoat: 0.35,
        clearcoatRoughness: 0.3,
        sheen: 0.5,
        sheenRoughness: 0.45,
        sheenColor: new THREE.Color(0xffd9c2),
      }),
    );
    this.flame = keep(new THREE.MeshBasicMaterial({ color: 0xffd08a, transparent: true, opacity: 0.95, depthWrite: false }));
    this.wick = keep(new THREE.MeshStandardMaterial({ color: 0x2b2622, roughness: 0.95, metalness: 0 }));

    this.card = keep(
      new THREE.MeshStandardMaterial({
        color: 0xfbf6ec,
        map: tex.paperColor,
        roughness: 0.8,
        metalness: 0,
        side: THREE.DoubleSide,
      }),
    );
    this.paintedWood = keep(
      new THREE.MeshStandardMaterial({ color: 0xd9cfc0, roughness: 0.55, metalness: 0 }),
    );
    this.wall = keep(new THREE.MeshStandardMaterial({ color: 0xeee7dc, roughness: 0.94, metalness: 0 }));
    // The window pane: the daylight beyond it is the brightest thing in the
    // room, so it is drawn as that light rather than as glass to see through.
    this.glass = keep(
      new THREE.MeshBasicMaterial({ color: 0xf2f6ff, side: THREE.DoubleSide }),
    );

    this.ghost = keep(
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false }),
    );
  }

  /**
   * Scale every material's environment contribution together when the lighting
   * changes, without losing the relative values each material was given.
   */
  setEnvIntensity(v: number): void {
    if (this.baseEnv.size === 0) {
      for (const m of this.all) {
        const s = m as THREE.MeshStandardMaterial;
        if ('envMapIntensity' in s) this.baseEnv.set(m, s.envMapIntensity ?? 1);
      }
    }
    for (const [m, base] of this.baseEnv) {
      (m as THREE.MeshStandardMaterial).envMapIntensity = base * v;
    }
  }

  private readonly baseEnv = new Map<THREE.Material, number>();

  dispose(): void {
    for (const m of this.all) m.dispose();
  }
}
