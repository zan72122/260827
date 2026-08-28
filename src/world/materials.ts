import {
  Color,
  DoubleSide,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Vector2,
} from 'three';
import { buildTextures, type TextureLibrary } from './textures';

/**
 * The hero materials. Each one is tuned against the two lighting rigs the
 * game uses (lantern-warm tack room, open snow field) rather than being left
 * at library defaults.
 */
export interface MaterialLibrary {
  tex: TextureLibrary;
  leather: MeshStandardMaterial;
  leatherEdge: MeshStandardMaterial;
  brass: MeshStandardMaterial;
  brassDark: MeshStandardMaterial;
  steel: MeshStandardMaterial;
  iron: MeshStandardMaterial;
  bellMouth: MeshStandardMaterial;
  wood: MeshStandardMaterial;
  woodDark: MeshStandardMaterial;
  snow: MeshStandardMaterial;
  packedSnow: MeshStandardMaterial;
  plaster: MeshStandardMaterial;
  bark: MeshStandardMaterial;
  needle: MeshStandardMaterial;
  needleFar: MeshStandardMaterial;
  cloth: MeshStandardMaterial;
  clothLight: MeshStandardMaterial;
  skin: MeshStandardMaterial;
  windowGlow: MeshBasicMaterial;
  hay: MeshStandardMaterial;
  horseCoat: MeshPhysicalMaterial;
}

let cached: MaterialLibrary | null = null;

export function buildMaterials(): MaterialLibrary {
  if (cached) return cached;
  const tex = buildTextures();

  const leather = new MeshStandardMaterial({
    map: tex.leatherColor,
    normalMap: tex.leatherNormal,
    normalScale: new Vector2(0.55, 0.55),
    roughnessMap: tex.leatherRough,
    roughness: 1,
    metalness: 0,
    color: new Color(0xffffff),
  });
  // One texture tile per ~45 cm of strap: fine enough to see grain, coarse
  // enough that creases and wear read as features rather than noise.
  leather.map!.repeat.set(3, 1);
  leather.normalMap!.repeat.set(3, 1);
  leather.roughnessMap!.repeat.set(3, 1);

  // The cut edge of a strap is paler and fuzzier than its finished face.
  const leatherEdge = new MeshStandardMaterial({
    color: new Color(0x9a7752),
    roughness: 0.95,
    metalness: 0,
    map: tex.leatherColor,
    normalMap: tex.leatherNormal,
    normalScale: new Vector2(0.4, 0.4),
  });

  const brass = new MeshStandardMaterial({
    map: tex.brassColor,
    roughnessMap: tex.brassRough,
    normalMap: tex.brassNormal,
    normalScale: new Vector2(1.0, 1.0),
    metalness: 1,
    roughness: 1,
    color: new Color(0xffffff),
  });

  const brassDark = brass.clone();
  brassDark.color = new Color(0x8a7442);
  brassDark.roughness = 0.68;

  const steel = new MeshStandardMaterial({
    color: new Color(0xb6bcc2),
    metalness: 1,
    roughness: 0.42,
    map: tex.ironColor,
    roughnessMap: tex.ironRough,
  });

  const iron = new MeshStandardMaterial({
    map: tex.ironColor,
    roughnessMap: tex.ironRough,
    color: new Color(0xa8abb0),
    metalness: 0.92,
    roughness: 0.62,
  });

  // Inside of the bell shell, seen through the slit: dark and non-reflective.
  const bellMouth = new MeshStandardMaterial({
    color: new Color(0x3a3025),
    roughness: 0.9,
    metalness: 0.4,
    side: DoubleSide,
  });

  const wood = new MeshStandardMaterial({
    map: tex.woodColor,
    normalMap: tex.woodNormal,
    normalScale: new Vector2(0.7, 0.7),
    roughnessMap: tex.woodRough,
    roughness: 1,
    metalness: 0,
    color: new Color(0xc9bda9),
  });

  const woodDark = wood.clone();
  woodDark.color = new Color(0x7a6553);

  const snow = new MeshStandardMaterial({
    map: tex.snowColor,
    normalMap: tex.snowNormal,
    normalScale: new Vector2(0.55, 0.55),
    roughnessMap: tex.snowRough,
    roughness: 0.88,
    metalness: 0,
    color: new Color(0xdde5ee),
  });
  snow.map!.repeat.set(90, 90);
  snow.normalMap!.repeat.set(120, 120);
  snow.roughnessMap!.repeat.set(60, 60);

  // Compressed snow is denser, slightly greyer and a touch glossier.
  const packedSnow = new MeshStandardMaterial({
    color: new Color(0xb4c2d2),
    roughness: 0.6,
    metalness: 0,
    map: tex.snowColor,
    normalMap: tex.snowNormal,
    normalScale: new Vector2(0.3, 0.3),
    transparent: true,
    depthWrite: false,
  });

  const plaster = new MeshStandardMaterial({
    map: tex.plasterColor,
    color: new Color(0xbdb2a0),
    roughness: 0.97,
    metalness: 0,
  });
  plaster.map!.repeat.set(4, 3);

  const bark = new MeshStandardMaterial({
    map: tex.barkColor,
    color: new Color(0xa2938a),
    roughness: 0.95,
    metalness: 0,
  });

  const needle = new MeshStandardMaterial({
    color: new Color(0x2f4436),
    roughness: 0.92,
    metalness: 0,
    flatShading: true,
  });

  // Distant conifers lose saturation and local contrast, but keep their shape.
  const needleFar = new MeshStandardMaterial({
    color: new Color(0x64757a),
    roughness: 1,
    metalness: 0,
    flatShading: true,
  });

  const cloth = new MeshStandardMaterial({
    color: new Color(0x3b4250),
    roughness: 0.95,
    metalness: 0,
  });
  const clothLight = new MeshStandardMaterial({
    color: new Color(0x8d5f4a),
    roughness: 0.95,
    metalness: 0,
  });
  const skin = new MeshStandardMaterial({
    color: new Color(0xb08a6a),
    roughness: 0.8,
    metalness: 0,
  });

  const windowGlow = new MeshBasicMaterial({ color: new Color(0xffe0ae) });

  const hay = new MeshStandardMaterial({
    color: new Color(0xa08a4e),
    roughness: 1,
    metalness: 0,
  });

  // Winter coat: dense, matte, with a faint sheen along the grain.
  const horseCoat = new MeshPhysicalMaterial({
    color: new Color(0xffffff),
    roughness: 0.86,
    metalness: 0,
    sheen: 0.5,
    sheenRoughness: 0.85,
    sheenColor: new Color(0x6b5a48),
    clearcoat: 0,
  });

  cached = {
    tex,
    leather,
    leatherEdge,
    brass,
    brassDark,
    steel,
    iron,
    bellMouth,
    wood,
    woodDark,
    snow,
    packedSnow,
    plaster,
    bark,
    needle,
    needleFar,
    cloth,
    clothLight,
    skin,
    windowGlow,
    hay,
    horseCoat,
  };
  return cached;
}
