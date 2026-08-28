import {
  AnimationAction,
  AnimationClip,
  AnimationMixer,
  Bone,
  Box3,
  Color,
  Group,
  LoopRepeat,
  Mesh,
  MeshPhysicalMaterial,
  Object3D,
  SkinnedMesh,
  Texture,
  CanvasTexture,
  Vector3,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { MaterialLibrary } from './materials';

/**
 * The horse.
 *
 * Mesh, 56-bone skeleton and the gait clips come from the Mesh2Motion CC0
 * asset set; everything here is about making them behave: matching stride
 * length to ground speed so the hooves never skate, reading real contact
 * events off the foot bones, and layering breath and ear movement on top so
 * the animal reads as calm without a cartoon face.
 */

export type Gait = 'halt' | 'walk' | 'trot';

/** metres covered by one full cycle of each clip */
const STRIDE = { walk: 1.75, trot: 2.55 };

export interface HoofEvent {
  leg: 0 | 1 | 2 | 3; // FL, FR, HL, HR
  /** 0..1 - how much of the body's weight arrived on this hoof */
  weight: number;
  world: Vector3;
}

interface LegTrack {
  bone: Bone;
  min: number;
  max: number;
  prev: number;
  down: boolean;
  lastAt: number;
}

/**
 * Re-grade the imported colour palette so the animal belongs to this game's
 * winter light instead of the preview render it was authored under.
 */
function restyleCoat(src: Texture): Texture | null {
  const img = src.image as (HTMLImageElement | ImageBitmap | null);
  if (!img || !('width' in img) || !img.width) return null;
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img as CanvasImageSource, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255;
    const g = d[i + 1] / 255;
    const b = d[i + 2] / 255;
    const lum = r * 0.29 + g * 0.6 + b * 0.11;
    // 62 % desaturation, a slight lift in the shadows, a warm bias overall
    const k = 0.26;
    const nr = lum + (r - lum) * k;
    const ng = lum + (g - lum) * k;
    const nb = lum + (b - lum) * k;
    const shape = Math.pow(Math.max(0, Math.min(1, nr * 0.9 + 0.04)), 1.15);
    d[i] = Math.min(255, shape * 255 * 1.02);
    d[i + 1] = Math.min(255, Math.pow(Math.max(0, ng * 0.88 + 0.04), 1.18) * 255);
    d[i + 2] = Math.min(255, Math.pow(Math.max(0, nb * 0.8 + 0.04), 1.22) * 255);
  }
  ctx.putImageData(data, 0, 0);
  const t = new CanvasTexture(c);
  t.colorSpace = src.colorSpace;
  t.flipY = src.flipY;
  t.wrapS = src.wrapS;
  t.wrapT = src.wrapT;
  t.needsUpdate = true;
  return t;
}

/**
 * The imported model has a flat palette texture and no surface detail, which
 * reads as plastic under any decent light. Rather than tile a detail map
 * against palette UVs (which would smear), the coat is broken up in object
 * space: a cheap three-octave value noise perturbs roughness and albedo, and
 * a coarser band darkens the underside the way a winter coat does.
 */
function addCoatDetail(mat: MeshPhysicalMaterial): void {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCoatPos;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n  vCoatPos = position;',
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vCoatPos;
         float coatHash(vec3 p) {
           p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
           p *= 17.0;
           return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
         }
         float coatNoise(vec3 x) {
           vec3 i = floor(x); vec3 f = fract(x);
           f = f * f * (3.0 - 2.0 * f);
           return mix(
             mix(mix(coatHash(i + vec3(0,0,0)), coatHash(i + vec3(1,0,0)), f.x),
                 mix(coatHash(i + vec3(0,1,0)), coatHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(coatHash(i + vec3(0,0,1)), coatHash(i + vec3(1,0,1)), f.x),
                 mix(coatHash(i + vec3(0,1,1)), coatHash(i + vec3(1,1,1)), f.x), f.y), f.z);
         }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
         float coatFine = coatNoise(vCoatPos * 78.0);
         float coatMid = coatNoise(vCoatPos * 19.0);
         roughnessFactor = clamp(roughnessFactor * (0.86 + coatFine * 0.3), 0.35, 1.0);`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         // hair breaks the light up; the belly and inner legs stay darker
         float coatShade = 0.9 + coatNoise(vCoatPos * 26.0) * 0.2;
         float underside = smoothstep(1.35, 0.75, vCoatPos.y) * 0.16;
         diffuseColor.rgb *= coatShade * (1.0 - underside);`,
      );
  };
  mat.customProgramCacheKey = () => 'winter-coat';
}

const LEG_BONES = [
  'front_leg_foot_l',
  'front_leg_foot_r',
  'back_leg_foot_l',
  'back_leg_foot_r',
] as const;

export class Horse {
  readonly group = new Group();
  readonly root = new Group();
  mixer!: AnimationMixer;
  skinned!: SkinnedMesh;

  /** metres per second along the ground */
  speed = 0;
  gait: Gait = 'halt';

  private actions: Record<string, AnimationAction> = {};
  private legs: LegTrack[] = [];
  private bones = new Map<string, Bone>();
  private breathPhase = 0;
  private earTimer = 1.2;
  private stepBudget = 0;
  private time = 0;
  private baseHeadRot = new Vector3();
  private loaded = false;

  constructor(private mats: MaterialLibrary) {
    this.group.add(this.root);
  }

  get isLoaded(): boolean {
    return this.loaded;
  }

  async load(url: string): Promise<void> {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(url);
    const scene = gltf.scene;

    scene.traverse((o: Object3D) => {
      if ((o as SkinnedMesh).isSkinnedMesh) this.skinned = o as SkinnedMesh;
      if ((o as Bone).isBone) this.bones.set(o.name, o as Bone);
    });

    // Re-light the imported model: the shipped material is a glossy clearcoat
    // preview shader, which is wrong for a winter coat under lantern light.
    const src = this.skinned.material as { map?: Texture };
    const coat = this.mats.horseCoat.clone();
    if (src.map) {
      // The shipped palette is a saturated toy chestnut. Pull it toward a
      // dense winter bay: less chroma, darker points, a warmer mid.
      coat.map = restyleCoat(src.map) ?? src.map;
      coat.map.anisotropy = 4;
    }
    coat.color = new Color(0xb9b0a6);
    coat.roughness = 0.92;
    coat.sheen = 0.42;
    coat.sheenColor = new Color(0x9d8a72);
    coat.sheenRoughness = 0.75;
    coat.vertexColors = false;
    addCoatDetail(coat);
    this.skinned.material = coat;
    this.skinned.castShadow = true;
    this.skinned.receiveShadow = true;
    this.skinned.frustumCulled = false;

    scene.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });

    this.root.add(scene);
    // The asset stands ~2.0 m to the ear tips and faces +Z, which is already
    // the game's forward axis; only the ground offset needs fixing.
    const box = new Box3().setFromObject(scene);
    scene.position.y -= box.min.y;

    this.mixer = new AnimationMixer(scene);
    for (const clip of gltf.animations) {
      this.actions[clip.name] = this.mixer.clipAction(clip);
    }
    for (const name of ['Idle', 'Walk', 'Trot']) {
      const a = this.actions[name];
      if (a) {
        a.setLoop(LoopRepeat, Infinity);
        a.enabled = true;
        a.setEffectiveWeight(0);
        a.play();
      }
    }
    this.actions['Idle']?.setEffectiveWeight(1);

    for (const name of LEG_BONES) {
      const bone = this.bones.get(name);
      if (!bone) continue;
      this.legs.push({ bone, min: 0.05, max: 0.4, prev: 0.2, down: false, lastAt: -1 });
    }

    const head = this.bones.get('head');
    if (head) this.baseHeadRot.set(head.rotation.x, head.rotation.y, head.rotation.z);

    this.loaded = true;
  }

  bone(name: string): Bone | undefined {
    return this.bones.get(name);
  }

  /** Ask for exactly one stride, used for the very first step. */
  requestStep(): void {
    this.stepBudget = Math.max(this.stepBudget, STRIDE.walk * 0.4);
  }

  get stepping(): boolean {
    return this.stepBudget > 0;
  }

  clipDuration(name: string): number {
    const a = this.actions[name];
    return a ? (a.getClip() as AnimationClip).duration : 1;
  }

  /**
   * @param targetSpeed metres per second requested by the ride controller
   * @returns metres actually travelled this frame
   */
  update(dt: number, targetSpeed: number, out: HoofEvent[]): number {
    if (!this.loaded) return 0;
    this.time += dt;

    if (this.stepBudget > 0) targetSpeed = Math.max(targetSpeed, 0.95);

    // Acceleration is deliberately unhurried in both directions: a flick can
    // never snap the animal into motion, and letting go coasts it down.
    const accel = targetSpeed > this.speed ? 1.35 : 1.9;
    this.speed += Math.max(-accel * dt, Math.min(accel * dt, targetSpeed - this.speed));
    if (this.speed < 0.04) this.speed = 0;

    const travelled = this.speed * dt;
    if (this.stepBudget > 0) {
      this.stepBudget -= travelled;
      if (this.stepBudget <= 0) this.stepBudget = 0;
    }

    const walkNominal = STRIDE.walk / this.clipDuration('Walk');
    const trotNominal = STRIDE.trot / this.clipDuration('Trot');

    // Gait selection with a hysteresis band, so a wobbling finger cannot make
    // the horse flicker between walk and trot.
    const up = 2.35;
    const down = 2.0;
    if (this.speed > up) this.gait = 'trot';
    else if (this.speed < down) this.gait = this.speed < 0.12 ? 'halt' : 'walk';
    else if (this.gait === 'halt') this.gait = 'walk';

    const blend = Math.max(0, Math.min(1, (this.speed - down) / (up - down)));
    const wIdle = this.speed < 0.12 ? 1 : Math.max(0, 1 - this.speed / 0.6);
    const wTrot = this.gait === 'trot' ? 1 : blend;
    const wWalk = Math.max(0, 1 - wTrot) * (1 - wIdle);

    this.setWeight('Idle', wIdle, dt);
    this.setWeight('Walk', wWalk, dt);
    this.setWeight('Trot', wTrot, dt);

    // Stride length drives clip rate, which is what stops the hooves skating.
    const walkRate = Math.max(0.32, Math.min(1.5, this.speed / walkNominal));
    const trotRate = Math.max(0.55, Math.min(1.35, this.speed / trotNominal));
    if (this.actions['Walk']) this.actions['Walk'].timeScale = walkRate;
    if (this.actions['Trot']) this.actions['Trot'].timeScale = trotRate;

    this.mixer.update(dt);
    this.applyBreath(dt);
    this.applyEars(dt);
    this.detectHooves(out);

    return travelled;
  }

  private setWeight(name: string, w: number, dt: number): void {
    const a = this.actions[name];
    if (!a) return;
    const cur = a.getEffectiveWeight();
    a.setEffectiveWeight(cur + (w - cur) * Math.min(1, dt * 7));
  }

  private applyBreath(dt: number): void {
    // Breathing is faster and deeper when working, but never a pant.
    const effort = Math.min(1, this.speed / 3.4);
    const rate = 0.28 + effort * 0.5;
    this.breathPhase += dt * rate * Math.PI * 2;
    const b = Math.sin(this.breathPhase);
    const amp = 0.012 + effort * 0.014;
    for (const name of ['ribcage_front', 'ribcage_middle']) {
      const bone = this.bones.get(name);
      if (!bone) continue;
      const s = 1 + b * amp;
      bone.scale.set(s, s, 1 + b * amp * 0.5);
    }
    const nostril = this.bones.get('nose');
    if (nostril) {
      const s = 1 + Math.max(0, b) * 0.05;
      nostril.scale.set(s, s, s);
    }
  }

  /** Calm is shown by the ears and the neck, never by a face. */
  private applyEars(dt: number): void {
    this.earTimer -= dt;
    if (this.earTimer <= 0) this.earTimer = 1.6 + Math.random() * 3.4;
    const flick = Math.max(0, this.earTimer > 1.4 ? 0 : Math.sin((1.4 - this.earTimer) * 9)) * 0.28;
    const l = this.bones.get('ear_1_l');
    const r = this.bones.get('ear_1_r');
    const sway = Math.sin(this.time * 0.8) * 0.05;
    if (l) l.rotation.z = sway + flick;
    if (r) r.rotation.z = -sway - flick * 0.6;
  }

  private detectHooves(out: HoofEvent[]): void {
    const world = new Vector3();
    for (let i = 0; i < this.legs.length; i++) {
      const leg = this.legs[i];
      leg.bone.getWorldPosition(world);
      const y = world.y - this.group.position.y;
      // slow envelope tracking, so the threshold adapts to whatever clip runs
      leg.min = Math.min(leg.min, y) * 0.999 + y * 0.001;
      leg.max = Math.max(leg.max, y) * 0.999 + y * 0.001;
      const span = Math.max(0.02, leg.max - leg.min);
      const threshold = leg.min + span * 0.16;
      const descending = y < leg.prev;
      if (!leg.down && y <= threshold && descending) {
        leg.down = true;
        const impact = Math.min(1, (leg.prev - y) / (span * 0.14 + 1e-4));
        // Fore legs carry more of the horse's weight than hind legs.
        const share = i < 2 ? 1 : 0.82;
        out.push({
          leg: i as 0 | 1 | 2 | 3,
          weight: Math.max(0.2, Math.min(1, impact * share * (0.4 + this.speed / 3.2))),
          world: world.clone(),
        });
      } else if (leg.down && y > threshold + span * 0.1) {
        leg.down = false;
      }
      leg.prev = y;
    }
  }

  /** Nose position, used for the breath vapour. */
  nosePosition(out: Vector3): Vector3 {
    const b = this.bones.get('mouth_tip') ?? this.bones.get('nose') ?? this.bones.get('head');
    if (b) b.getWorldPosition(out);
    else out.copy(this.group.position);
    return out;
  }

  addTo(parent: Object3D): void {
    parent.add(this.group);
  }
}
