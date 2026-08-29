import * as THREE from 'three';
import type { AdaptiveQuality } from '../core/Quality';
import type { BerryAssets } from './StrawberryCatalog';
import { spongeCrumb, creamSection, creamSurface, brushedSteel, benchWood } from './Textures';

/**
 * Every surface in the scene is authored as a real material: crumb that scatters,
 * cream that is soft rather than plastic, berry skin that is satin, and steel
 * that is metal with a brushed roughness and no invented colour banding. The
 * cut faces get their own materials so the moment the knife opens the cake the
 * inside reads as a different substance from the outside.
 */
export class Materials {
  readonly spongeSurface: THREE.MeshStandardMaterial;
  readonly spongeCut: THREE.MeshStandardMaterial;
  readonly creamSurface: THREE.MeshStandardMaterial;
  readonly creamCut: THREE.MeshPhysicalMaterial;
  readonly creamContact: THREE.MeshStandardMaterial;
  readonly coating: THREE.MeshStandardMaterial;
  readonly steel: THREE.MeshStandardMaterial;
  readonly steelDark: THREE.MeshStandardMaterial;
  readonly wood: THREE.MeshStandardMaterial;
  readonly porcelain: THREE.MeshPhysicalMaterial;
  readonly slate: THREE.MeshStandardMaterial;
  readonly glove: THREE.MeshStandardMaterial;
  readonly skinTone: THREE.MeshStandardMaterial;

  private readonly tiled = new Map<string, THREE.MeshStandardMaterial>();

  private readonly berryCache = new Map<string, {
    flesh: THREE.MeshPhysicalMaterial;
    skin: THREE.MeshStandardMaterial;
    section: THREE.MeshPhysicalMaterial;
    achene: THREE.MeshStandardMaterial;
  }>();

  constructor(private readonly quality: AdaptiveQuality) {
    const aniso = Math.min(8, quality.maxAnisotropy);
    const size = quality.textureSize;
    const sponge = spongeCrumb(size, aniso);
    const creamCutMaps = creamSection(size, aniso);
    const creamMaps = creamSurface(size, aniso);
    const steelMaps = brushedSteel(Math.max(512, size >> 1), aniso);
    const woodMaps = benchWood(Math.max(512, size >> 1), aniso);

    this.spongeSurface = new THREE.MeshStandardMaterial({
      map: sponge.map,
      normalMap: sponge.normalMap,
      roughnessMap: sponge.roughnessMap,
      normalScale: new THREE.Vector2(0.5, 0.5),
      roughness: 1,
      metalness: 0,
      color: 0xdfd2b6,
    });
    // A sheared crumb face is more open and a shade paler than the baked skin.
    this.spongeCut = new THREE.MeshStandardMaterial({
      map: sponge.map,
      normalMap: sponge.normalMap,
      roughnessMap: sponge.roughnessMap,
      normalScale: new THREE.Vector2(0.85, 0.85),
      roughness: 1,
      metalness: 0,
      color: 0xece0c4,
    });
    this.creamSurface = new THREE.MeshStandardMaterial({
      map: creamMaps.map,
      normalMap: creamMaps.normalMap,
      roughnessMap: creamMaps.roughnessMap,
      normalScale: new THREE.Vector2(0.55, 0.55),
      roughness: 1,
      metalness: 0,
      color: 0xeee7da,
    });
    this.creamCut = new THREE.MeshPhysicalMaterial({
      map: creamCutMaps.map,
      normalMap: creamCutMaps.normalMap,
      roughnessMap: creamCutMaps.roughnessMap,
      normalScale: new THREE.Vector2(0.7, 0.7),
      roughness: 1,
      metalness: 0,
      color: 0xefe9dd,
      sheen: 0.35,
      sheenRoughness: 0.85,
      sheenColor: new THREE.Color(0xfff2e6),
      clearcoat: quality.richSections ? 0.06 : 0,
      clearcoatRoughness: 0.7,
    });
    this.creamContact = new THREE.MeshStandardMaterial({
      map: creamCutMaps.map,
      normalMap: creamCutMaps.normalMap,
      roughnessMap: creamCutMaps.roughnessMap,
      normalScale: new THREE.Vector2(0.9, 0.9),
      roughness: 1,
      metalness: 0,
      color: 0xdcd2c2,
    });
    this.coating = new THREE.MeshStandardMaterial({
      map: creamMaps.map,
      normalMap: creamMaps.normalMap,
      roughnessMap: creamMaps.roughnessMap,
      normalScale: new THREE.Vector2(0.75, 0.75),
      roughness: 1,
      metalness: 0,
      color: 0xf0eade,
    });
    this.steel = new THREE.MeshStandardMaterial({
      map: steelMaps.map,
      normalMap: steelMaps.normalMap,
      roughnessMap: steelMaps.roughnessMap,
      normalScale: new THREE.Vector2(0.25, 0.25),
      metalness: 1,
      roughness: 1,
      color: 0xb4b9bc,
    });
    this.steelDark = new THREE.MeshStandardMaterial({
      color: 0x2f3335,
      metalness: 0.15,
      roughness: 0.62,
    });
    this.wood = new THREE.MeshStandardMaterial({
      map: woodMaps.map,
      normalMap: woodMaps.normalMap,
      roughnessMap: woodMaps.roughnessMap,
      roughness: 1,
      metalness: 0,
    });
    this.porcelain = new THREE.MeshPhysicalMaterial({
      color: 0xe9e6e0,
      roughness: 0.28,
      metalness: 0,
      clearcoat: 0.55,
      clearcoatRoughness: 0.2,
    });
    // A dark tray under the prepared slices: the cake keeps the whites.
    this.slate = new THREE.MeshStandardMaterial({
      color: 0x4a4844,
      roughness: 0.78,
      metalness: 0.05,
    });
    this.glove = new THREE.MeshStandardMaterial({
      color: 0xf2f0ec,
      roughness: 0.72,
      metalness: 0,
    });
    this.skinTone = new THREE.MeshStandardMaterial({
      color: 0xdcb098,
      roughness: 0.68,
      metalness: 0,
    });

    // The room reflection is kept low on the matte foods: a strong uniform
    // ambient term is what turns a white cake into a flat white disc and hides
    // the shallow wells the child is meant to see. Metal keeps its full share.
    this.spongeSurface.envMapIntensity = 0.32;
    this.spongeCut.envMapIntensity = 0.32;
    this.creamSurface.envMapIntensity = 0.26;
    this.creamCut.envMapIntensity = 0.26;
    this.creamContact.envMapIntensity = 0.24;
    this.coating.envMapIntensity = 0.26;
    this.steel.envMapIntensity = 0.95;
    this.steelDark.envMapIntensity = 0.6;
    this.wood.envMapIntensity = 0.3;
    this.porcelain.envMapIntensity = 0.55;
    this.slate.envMapIntensity = 0.28;
    this.glove.envMapIntensity = 0.35;
    this.skinTone.envMapIntensity = 0.32;
  }

  /**
   * Steel with its brushed grain retiled for a large part such as the
   * turntable, so the finish stays at the scale of real machining marks.
   */
  steelTiled(repeat: number): THREE.MeshStandardMaterial {
    return this.retile('steel', this.steel, repeat);
  }


  /** Bench timber at bench scale rather than one plank across the room. */
  woodTiled(rx: number, ry = rx): THREE.MeshStandardMaterial {
    return this.retile('wood', this.wood, rx, ry);
  }

  private retile(
    name: string,
    source: THREE.MeshStandardMaterial,
    rx: number,
    ry = rx,
  ): THREE.MeshStandardMaterial {
    const key = `${name}:${rx}:${ry}`;
    const hit = this.tiled.get(key);
    if (hit) return hit;
    const m = source.clone();
    for (const slot of ['map', 'normalMap', 'roughnessMap'] as const) {
      const tex = m[slot];
      if (!tex) continue;
      const copy = tex.clone();
      copy.repeat.set(rx, ry);
      copy.needsUpdate = true;
      m[slot] = copy;
    }
    m.needsUpdate = true;
    this.tiled.set(key, m);
    return m;
  }

  /** Materials for one strawberry variant, including its cut face. */
  berry(assets: BerryAssets): {
    flesh: THREE.MeshPhysicalMaterial;
    skin: THREE.MeshStandardMaterial;
    section: THREE.MeshPhysicalMaterial;
    achene: THREE.MeshStandardMaterial;
  } {
    const hit = this.berryCache.get(assets.variant.id);
    if (hit) return hit;
    const m = assets.maps;
    const flesh = new THREE.MeshPhysicalMaterial({
      map: m.flesh,
      normalMap: m.fleshNormal,
      roughnessMap: m.fleshRough,
      normalScale: new THREE.Vector2(0.32, 0.32),
      roughness: 1,
      metalness: 0,
      // Cut fruit is faintly translucent; it must never glow on its own.
      sheen: 0.12,
      sheenRoughness: 0.62,
      sheenColor: new THREE.Color(0xffb0a4),
      clearcoat: this.quality.richSections ? 0.14 : 0,
      clearcoatRoughness: 0.42,
      envMapIntensity: 0.4,
    });
    const skin = new THREE.MeshStandardMaterial({
      map: m.skin,
      normalMap: m.skinNormal,
      roughnessMap: m.skinRough,
      normalScale: new THREE.Vector2(0.85, 0.85),
      roughness: 1,
      metalness: 0,
      envMapIntensity: 0.45,
    });
    // The face the knife just made: the same painted interior, a touch wetter.
    const detail = this.quality.sectionDetail;
    const section = flesh.clone();
    section.clearcoat = detail === 0 ? 0 : detail === 2 ? 0.3 : 0.2;
    section.clearcoatRoughness = detail === 2 ? 0.24 : 0.32;
    const relief = detail === 2 ? 0.26 : 0.16;
    section.normalScale = new THREE.Vector2(relief, relief);
    section.sheen = detail === 2 ? 0.22 : 0.16;
    const achene = new THREE.MeshStandardMaterial({
      color: 0xd8bd7c,
      roughness: 0.46,
      metalness: 0,
      vertexColors: true,
      envMapIntensity: 0.5,
    });
    const made = { flesh, skin, section, achene };
    this.berryCache.set(assets.variant.id, made);
    return made;
  }

}
