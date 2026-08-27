/**
 * tissuePyramid.ts — MultiresolutionTissuePyramid.
 *
 * The pyramid is NOT a stack of separately authored pictures. Every level is the one
 * parametric model in tissueShader.ts, evaluated over the same TISSUE millimetres and
 * band-limited to that level's own texel size and to the objective's diffraction
 * limit. Diving therefore reveals structure that genuinely was not present in the
 * coarser level, rather than magnifying pixels that already existed.
 *
 * Residency: only a handful of levels are held on the GPU. Levels are generated in
 * horizontal strips across successive frames so a build never stalls the swipe, and
 * the next level down is started while the current one is still on screen.
 */

import * as THREE from 'three';
import { createTissueMaterial } from './tissueMaterial';
import { HERO_TISSUE } from './specimen';
import { OBJECTIVES, resolutionMM } from './optics';

/**
 * Field width in mm covered by each level. Ratio 1.6 keeps every level sharp over its
 * whole working range at the texture sizes below, so the picture is never a stretched
 * copy of a coarser one. Level 0 also serves as the specimen texture on the 3D slide.
 */
export const LEVEL_COVER_MM = [
  18.0, 11.25, 7.03, 4.39, 2.75, 1.72, 1.07, 0.67, 0.42, 0.29,
] as const;

/** Level 0 frames the whole section; every deeper level is locked to the hero anchor. */
const SECTION_CENTRE = { x: 0.0, y: 2.75 };

export interface LevelRect {
  centreX: number;
  centreY: number;
  halfW: number;
  halfH: number;
}

interface Level {
  index: number;
  coverMM: number;
  texelMM: number;
  rect: LevelRect;
  /** Numerical aperture in force at this scale — sets the diffraction limit baked in. */
  na: number;
  target: THREE.WebGLRenderTarget | null;
  /** Strips completed so far; equals stripCount when the level is ready. */
  stripsDone: number;
  stripCount: number;
  ready: boolean;
  /** Frame counter of last use, for eviction. */
  lastUsed: number;
}

export interface PyramidBinding {
  texA: THREE.Texture;
  rectA: LevelRect;
  texB: THREE.Texture;
  rectB: LevelRect;
  blend: number;
  levelA: number;
  levelB: number;
}

/** The objective whose resolution limit a level should be baked with. */
function naForCover(coverMM: number): number {
  const workingField = coverMM / 1.25;
  if (workingField > 5.5) return OBJECTIVES[0].na;
  if (workingField > 2.2) return OBJECTIVES[1].na;
  if (workingField > 1.1) return OBJECTIVES[2].na;
  return OBJECTIVES[3].na;
}

export class MultiresolutionTissuePyramid {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.Camera();
  private readonly material: THREE.ShaderMaterial;
  private readonly levels: Level[];
  private readonly texels: number;
  private readonly maxResident: number;
  private frame = 0;
  /** Level indices queued for generation, nearest-needed first. */
  private queue: number[] = [];

  constructor(
    renderer: THREE.WebGLRenderer,
    opts: { texels: number; samples: 1 | 2 | 4; maxResident: number; strips: number },
  ) {
    this.renderer = renderer;
    this.texels = opts.texels;
    this.maxResident = Math.max(2, opts.maxResident);
    this.material = createTissueMaterial(opts.samples);
    // Development aid: ?mark=1 paints the hero anchor into every level.
    this.material.uniforms.uDebugMark.value =
      new URLSearchParams(location.search).get('mark') === '1' ? 1 : 0;
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);

    this.levels = LEVEL_COVER_MM.map((coverMM, index) => {
      const centre = index === 0 ? SECTION_CENTRE : HERO_TISSUE;
      return {
        index,
        coverMM,
        texelMM: coverMM / opts.texels,
        rect: {
          centreX: centre.x,
          centreY: centre.y,
          halfW: coverMM * 0.5,
          halfH: coverMM * 0.5,
        },
        na: naForCover(coverMM),
        target: null,
        stripsDone: 0,
        stripCount: Math.max(1, opts.strips),
        ready: false,
        lastUsed: -1,
      };
    });
  }

  get levelCount(): number {
    return this.levels.length;
  }

  /** True while any level still has strips left to build. */
  get building(): boolean {
    return this.queue.length > 0;
  }

  /** True once the level's texture is fully built. */
  isReady(index: number): boolean {
    return this.levels[index]?.ready ?? false;
  }

  texture(index: number): THREE.Texture | null {
    const l = this.levels[index];
    return l?.ready && l.target ? l.target.texture : null;
  }

  rect(index: number): LevelRect {
    return this.levels[index].rect;
  }

  /**
   * The continuous level-of-detail for a given displayed field, expressed as a
   * fractional level index. Fractional part drives the cross-level blend.
   */
  lodFor(fieldMM: number, screenPx: number): number {
    const displayPx = fieldMM / Math.max(screenPx, 1);
    const levels = this.levels;
    // Coarsest level that still covers the whole screen.
    let maxUsable = 0;
    for (let i = 0; i < levels.length; i++) {
      if (levels[i].coverMM >= fieldMM * 1.005) maxUsable = i;
    }
    let lod = 0;
    for (let i = 0; i < levels.length - 1; i++) {
      if (levels[i].texelMM <= displayPx) {
        lod = i;
        break;
      }
      const a = levels[i].texelMM;
      const b = levels[i + 1].texelMM;
      if (displayPx > b) {
        lod = i + Math.log(a / displayPx) / Math.log(a / b);
        break;
      }
      lod = levels.length - 1;
    }
    return Math.max(0, Math.min(lod, maxUsable));
  }

  /**
   * Called every frame. Decides which levels should exist, evicts the rest, and
   * spends a small, bounded amount of GPU time building whatever is missing.
   */
  update(fieldMM: number, screenPx: number, budgetStrips = 1): void {
    this.frame++;
    const lod = this.lodFor(fieldMM, screenPx);
    const a = Math.floor(lod);
    const b = Math.min(a + 1, this.levels.length - 1);

    // Wanted: the two levels in use, the next one down (preload before the boundary),
    // one coarser as a safety net, and level 0 which the 3D slide always needs.
    const wanted = new Set<number>([0, a, b, Math.min(b + 1, this.levels.length - 1)]);
    if (a > 0) wanted.add(a - 1);

    for (const i of wanted) this.levels[i].lastUsed = this.frame;
    this.evictBeyond(wanted);

    this.queue = [...wanted]
      .filter((i) => !this.levels[i].ready)
      .sort((x, y) => Math.abs(x - lod) - Math.abs(y - lod));

    let spent = 0;
    while (spent < budgetStrips && this.queue.length > 0) {
      const index = this.queue[0];
      this.generateStrip(index);
      if (this.levels[index].ready) this.queue.shift();
      spent++;
    }
  }

  /** Build a level to completion right now. Used at boot and when a level is urgent. */
  generateNow(index: number): void {
    const level = this.levels[index];
    while (!level.ready) this.generateStrip(index);
    level.lastUsed = this.frame;
  }

  /** Textures and rectangles for the compositor, with a graceful fallback. */
  binding(fieldMM: number, screenPx: number): PyramidBinding | null {
    const lod = this.lodFor(fieldMM, screenPx);
    const idealA = Math.floor(lod);
    const idealB = Math.min(idealA + 1, this.levels.length - 1);
    let blend = lod - idealA;

    // If the finer level is not built yet, lean on the coarser one. It reads as the
    // objective settling rather than as a missing image.
    const a = this.nearestReady(idealA);
    let b = this.nearestReady(idealB);
    if (a === null) return null;
    if (b === null || b === a) {
      b = a;
      blend = 0;
    } else if (b !== idealB) {
      blend = 0;
    }

    const la = this.levels[a];
    const lb = this.levels[b];
    la.lastUsed = this.frame;
    lb.lastUsed = this.frame;
    return {
      texA: la.target!.texture,
      rectA: la.rect,
      texB: lb.target!.texture,
      rectB: lb.rect,
      blend,
      levelA: a,
      levelB: b,
    };
  }

  /** Development aid: read a built level back off the GPU for inspection. */
  readLevel(index: number): { data: Uint8Array; size: number } | null {
    const l = this.levels[index];
    if (!l?.ready || !l.target) return null;
    const data = new Uint8Array(this.texels * this.texels * 4);
    this.renderer.readRenderTargetPixels(l.target, 0, 0, this.texels, this.texels, data);
    return { data, size: this.texels };
  }

  dispose(): void {
    for (const l of this.levels) {
      l.target?.dispose();
      l.target = null;
      l.ready = false;
      l.stripsDone = 0;
    }
    this.material.dispose();
  }

  /** Approximate GPU memory held by resident levels, in bytes. */
  residentBytes(): number {
    const per = this.texels * this.texels * 4;
    return this.levels.reduce((n, l) => n + (l.target ? per : 0), 0);
  }

  residentLevels(): number[] {
    return this.levels.filter((l) => l.target).map((l) => l.index);
  }

  // ------------------------------------------------------------------ internals

  private nearestReady(from: number): number | null {
    for (let d = 0; d < this.levels.length; d++) {
      const up = from - d;
      if (up >= 0 && this.levels[up].ready) return up;
      const down = from + d;
      if (down < this.levels.length && this.levels[down].ready) return down;
    }
    return null;
  }

  private evictBeyond(wanted: Set<number>): void {
    const resident = this.levels.filter((l) => l.target !== null);
    if (resident.length <= this.maxResident) return;
    resident
      .filter((l) => !wanted.has(l.index))
      .sort((x, y) => x.lastUsed - y.lastUsed)
      .slice(0, resident.length - this.maxResident)
      .forEach((l) => {
        l.target!.dispose();
        l.target = null;
        l.ready = false;
        l.stripsDone = 0;
      });
  }

  private ensureTarget(level: Level): THREE.WebGLRenderTarget {
    if (level.target) return level.target;
    level.target = new THREE.WebGLRenderTarget(this.texels, this.texels, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    level.target.texture.colorSpace = THREE.NoColorSpace;
    level.stripsDone = 0;
    level.ready = false;
    return level.target;
  }

  private generateStrip(index: number): void {
    const level = this.levels[index];
    const target = this.ensureTarget(level);
    const u = this.material.uniforms;
    u.uCentre.value.set(level.rect.centreX, level.rect.centreY);
    u.uFieldMM.value = level.coverMM;
    u.uAspect.value = 1;
    u.uTexelMM.value = level.texelMM;
    u.uOptResMM.value = resolutionMM(level.na);
    // Levels are baked at the middle of the section. Racking the focus is a
    // screen-space operation in the compositor, so a rack never forces a rebuild.
    u.uFocusZ.value = 0;
    u.uNA.value = level.na;

    const strips = level.stripCount;
    const h = Math.ceil(this.texels / strips);
    const y = level.stripsDone * h;
    const height = Math.min(h, this.texels - y);

    // The strip window is set on the render target itself, NOT through
    // renderer.setViewport/setScissor: those multiply by the canvas pixel ratio, which
    // on a retina device would render each level into a quarter of its own texture.
    target.viewport.set(0, 0, this.texels, this.texels);
    target.scissor.set(0, y, this.texels, height);
    target.scissorTest = true;

    const prevTarget = this.renderer.getRenderTarget();
    const prevAutoClear = this.renderer.autoClear;
    this.renderer.setRenderTarget(target);
    this.renderer.autoClear = false;
    this.renderer.render(this.scene, this.camera);
    this.renderer.autoClear = prevAutoClear;
    this.renderer.setRenderTarget(prevTarget);

    level.stripsDone++;
    if (level.stripsDone >= strips) level.ready = true;
  }
}
