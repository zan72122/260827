import {
  Color,
  DoubleSide,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  type Texture,
} from 'three';
import type { QualityProfile } from '../core/AdaptiveQuality';
import {
  bakeBarkBump,
  bakeBarkColor,
  bakeBarkRoughness,
  bakeCableJacket,
  bakeCutFace,
  bakeFacade,
  bakeFencePanel,
  bakeGalvanised,
  bakePaintedSteel,
  bakePaving,
  bakePavingBump,
  bakePavingRoughness,
  bakeSlingBump,
  bakeSlingWebbing,
} from './Textures';

const repeat = (tex: Texture, x: number, y: number): Texture => {
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.repeat.set(x, y);
  return tex;
};

/**
 * One place where every hero material is defined, so wood, webbing, zinc,
 * enamel, stone and cable stay readable as different substances rather than
 * differently tinted plastic.
 */
export class MaterialLibrary {
  readonly trunkBark: MeshStandardMaterial;
  readonly limbBark: MeshStandardMaterial;
  readonly cutFace: MeshStandardMaterial;
  readonly foliage: MeshStandardMaterial;
  readonly foliageFar: MeshStandardMaterial;
  readonly slingWebbing: MeshStandardMaterial;
  readonly transportStrap: MeshStandardMaterial;
  readonly galvanised: MeshStandardMaterial;
  readonly craneEnamel: MeshStandardMaterial;
  readonly craneDark: MeshStandardMaterial;
  readonly wireRope: MeshStandardMaterial;
  readonly cable: MeshStandardMaterial;
  readonly paving: MeshStandardMaterial;
  readonly concrete: MeshStandardMaterial;
  readonly matPlate: MeshStandardMaterial;
  readonly deckTimber: MeshStandardMaterial;
  readonly rubber: MeshStandardMaterial;
  readonly facade: MeshStandardMaterial;
  readonly facadeAlt: MeshStandardMaterial[];
  readonly granite: MeshStandardMaterial;
  readonly fenceMesh: MeshStandardMaterial;
  readonly glassLit: MeshBasicMaterial;
  readonly hiVis: MeshStandardMaterial;
  readonly helmet: MeshStandardMaterial;
  readonly workwear: MeshStandardMaterial;
  readonly skin: MeshStandardMaterial;
  readonly crowdCoat: MeshStandardMaterial;
  readonly lampGlass: MeshStandardMaterial;
  readonly lampSocket: MeshStandardMaterial;
  readonly starAlloy: MeshPhysicalMaterial;
  readonly connectorShell: MeshStandardMaterial;

  private readonly all: Array<MeshStandardMaterial | MeshPhysicalMaterial> = [];

  constructor(profile: QualityProfile) {
    const texSize = profile.tier === 'low' ? 256 : profile.tier === 'mid' ? 384 : 512;

    const barkColor = repeat(bakeBarkColor(texSize), 2, 1);
    const barkBump = repeat(bakeBarkBump(texSize), 2, 1);
    const barkRough = repeat(bakeBarkRoughness(Math.min(256, texSize)), 2, 1);

    this.trunkBark = this.reg(
      new MeshStandardMaterial({
        map: barkColor,
        bumpMap: barkBump,
        bumpScale: 0.5,
        roughnessMap: barkRough,
        roughness: 1,
        metalness: 0,
        color: new Color(0.9, 0.88, 0.86),
      }),
    );

    this.limbBark = this.reg(
      new MeshStandardMaterial({
        map: repeat(bakeBarkColor(Math.min(256, texSize), 12), 1, 4),
        roughness: 0.95,
        metalness: 0,
        color: new Color(0.72, 0.68, 0.62),
      }),
    );

    this.cutFace = this.reg(
      new MeshStandardMaterial({ map: bakeCutFace(256), roughness: 0.75, metalness: 0 }),
    );

    // Needles: no alpha cards, so no glowing cut-out fringe. Geometry + vertex
    // colour carries the tone variation between sun and shade side.
    this.foliage = this.reg(
      new MeshStandardMaterial({
        color: new Color(0.152, 0.242, 0.148),
        roughness: 0.86,
        metalness: 0,
        vertexColors: true,
        side: DoubleSide,
        flatShading: false,
      }),
    );
    this.foliageFar = this.reg(
      new MeshStandardMaterial({
        color: new Color(0.104, 0.164, 0.112),
        roughness: 0.92,
        metalness: 0,
        side: DoubleSide,
      }),
    );

    this.slingWebbing = this.reg(
      new MeshStandardMaterial({
        map: repeat(bakeSlingWebbing(256), 1, 8),
        bumpMap: repeat(bakeSlingBump(256), 1, 8),
        bumpScale: 0.12,
        roughness: 0.82,
        metalness: 0,
      }),
    );

    // Transport strapping is the same webbing in a duller duty colour, and it
    // has been dragged through a forest landing.
    this.transportStrap = this.reg(
      new MeshStandardMaterial({
        bumpMap: repeat(bakeSlingBump(128), 1, 6),
        bumpScale: 0.08,
        roughness: 0.9,
        metalness: 0,
        color: new Color(0.19, 0.2, 0.17),
      }),
    );

    const galv = bakeGalvanised(256);
    galv.repeat.set(0.5, 0.5);
    this.galvanised = this.reg(
      new MeshStandardMaterial({ map: galv, roughness: 0.44, metalness: 0.92 }),
    );

    this.craneEnamel = this.reg(
      new MeshStandardMaterial({
        map: bakePaintedSteel(196, 132, 40, 256, 61),
        roughness: 0.52,
        metalness: 0.28,
      }),
    );
    this.craneDark = this.reg(
      new MeshStandardMaterial({
        map: bakePaintedSteel(74, 78, 84, 256, 63),
        roughness: 0.62,
        metalness: 0.42,
      }),
    );
    this.wireRope = this.reg(
      new MeshStandardMaterial({ color: new Color(0.24, 0.25, 0.27), roughness: 0.5, metalness: 0.9 }),
    );

    this.cable = this.reg(
      new MeshStandardMaterial({
        map: repeat(bakeCableJacket(128), 1, 6),
        roughness: 0.78,
        metalness: 0.02,
      }),
    );

    // One tile covers 4x4 setts, so this puts the setts at roughly a metre.
    const pavingScale = 54;
    this.paving = this.reg(
      new MeshStandardMaterial({
        map: repeat(bakePaving(texSize), pavingScale, pavingScale),
        bumpMap: repeat(bakePavingBump(texSize), pavingScale, pavingScale),
        bumpScale: 0.35,
        roughnessMap: repeat(bakePavingRoughness(256), pavingScale, pavingScale),
        roughness: 1,
        metalness: 0.02,
      }),
    );

    this.concrete = this.reg(
      new MeshStandardMaterial({ color: new Color(0.42, 0.42, 0.4), roughness: 0.94, metalness: 0 }),
    );
    this.matPlate = this.reg(
      new MeshStandardMaterial({ color: new Color(0.2, 0.22, 0.24), roughness: 0.7, metalness: 0.1 }),
    );
    this.deckTimber = this.reg(
      new MeshStandardMaterial({ color: new Color(0.21, 0.17, 0.13), roughness: 0.94, metalness: 0 }),
    );
    this.rubber = this.reg(
      new MeshStandardMaterial({ color: new Color(0.06, 0.06, 0.07), roughness: 0.96, metalness: 0 }),
    );

    this.facade = this.reg(
      new MeshStandardMaterial({ map: repeat(bakeFacade(256), 3, 6), roughness: 0.82, metalness: 0.05 }),
    );
    // A city block is not one building repeated: three stone tones and two
    // window rhythms are enough to stop the skyline reading as wallpaper.
    this.facadeAlt = [
      new Color(0.86, 0.84, 0.8),
      new Color(0.66, 0.64, 0.63),
      new Color(0.74, 0.7, 0.62),
    ].map((tint, i) =>
      this.reg(
        new MeshStandardMaterial({
          map: repeat(bakeFacade(256, 101 + i * 7), i === 1 ? 4 : 3, i === 2 ? 8 : 6),
          color: tint,
          roughness: 0.84,
          metalness: 0.04,
        }),
      ),
    );

    this.granite = this.reg(
      new MeshStandardMaterial({ color: new Color(0.24, 0.24, 0.25), roughness: 0.72, metalness: 0.04 }),
    );

    this.fenceMesh = this.reg(
      new MeshStandardMaterial({
        map: repeat(bakeFencePanel(128), 1, 1),
        roughness: 0.7,
        metalness: 0.3,
        color: new Color(0.6, 0.62, 0.64),
      }),
    );
    this.glassLit = new MeshBasicMaterial({ color: new Color(1, 0.82, 0.52), toneMapped: true });

    this.hiVis = this.reg(
      new MeshStandardMaterial({ color: new Color(0.72, 0.56, 0.07), roughness: 0.78, metalness: 0 }),
    );
    this.helmet = this.reg(
      new MeshStandardMaterial({ color: new Color(0.88, 0.88, 0.86), roughness: 0.45, metalness: 0 }),
    );
    this.workwear = this.reg(
      new MeshStandardMaterial({ color: new Color(0.14, 0.17, 0.24), roughness: 0.9, metalness: 0 }),
    );
    this.skin = this.reg(
      new MeshStandardMaterial({ color: new Color(0.62, 0.46, 0.38), roughness: 0.78, metalness: 0 }),
    );
    this.crowdCoat = this.reg(
      new MeshStandardMaterial({ color: new Color(0.3, 0.3, 0.34), roughness: 0.9, metalness: 0, vertexColors: true }),
    );

    // Lamp bulbs are instanced geometry with an emissive channel driven per
    // instance; unlit they read as small frosted glass beads on a socket.
    this.lampGlass = this.reg(
      new MeshStandardMaterial({
        color: new Color(0.86, 0.86, 0.83),
        roughness: 0.35,
        metalness: 0,
        emissive: new Color(1, 0.86, 0.62),
        // The per-instance glow attribute scales this, so the base intensity
        // has to be non-zero or every lamp stays dark however bright the sector.
        emissiveIntensity: 2.8,
        vertexColors: true,
      }),
    );
    this.lampSocket = this.reg(
      new MeshStandardMaterial({ color: new Color(0.09, 0.1, 0.11), roughness: 0.85, metalness: 0.05 }),
    );

    this.starAlloy = this.reg(
      new MeshPhysicalMaterial({
        color: new Color(0.78, 0.79, 0.82),
        roughness: 0.34,
        metalness: 0.95,
        clearcoat: 0.35,
        clearcoatRoughness: 0.4,
      }),
    ) as MeshPhysicalMaterial;

    this.connectorShell = this.reg(
      new MeshStandardMaterial({ color: new Color(0.09, 0.11, 0.13), roughness: 0.6, metalness: 0.15 }),
    );
  }

  private reg<T extends MeshStandardMaterial | MeshPhysicalMaterial>(m: T): T {
    this.all.push(m);
    return m;
  }

  /** Env intensity follows the sky as the afternoon turns to night. */
  setEnvironmentIntensity(v: number): void {
    for (const m of this.all) m.envMapIntensity = v;
  }

  dispose(): void {
    for (const m of this.all) m.dispose();
    this.glassLit.dispose();
  }
}
