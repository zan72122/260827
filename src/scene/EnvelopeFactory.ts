import * as THREE from 'three';
import { Rng } from '../core/rng';
import { canvas2d, paintPaper } from '../core/textures';
import { makeHand } from '../core/hand';
import type { DestinationId, DispatchKind, EnvelopeSpec } from '../types';
import type { DestinationModule } from './DestinationSymbol';
import { drawPostmarkInk } from './PostmarkDie';

const ATLAS_SIZE = 1024;
const ATLAS_COLS = 4;
const ATLAS_ROWS = 8;
const CELL_W = ATLAS_SIZE / ATLAS_COLS; // 256
const CELL_H = ATLAS_SIZE / ATLAS_ROWS; // 128
const MAX_INSTANCES = ATLAS_COLS * ATLAS_ROWS;

/** Where the machine bites the sheet, in face-canvas normalised coords. */
export const POSTMARK_UV = { x: 0.735, y: 0.4 };

export interface FaceState {
  postmarkSeed: number | null;
  showSchedule: boolean;
}

/** One letter. Lives either as an atlas instance or, when the camera is close, as its own mesh. */
export class Envelope {
  readonly spec: EnvelopeSpec;
  readonly dest: DestinationModule;
  readonly slot: number;

  readonly position = new THREE.Vector3();
  readonly quaternion = new THREE.Quaternion();

  bend = 0;
  sink = 0;
  fold = 0;

  postmarked = false;
  visible = true;
  /** which receptacle it finally entered */
  filedIn: string | null = null;

  face: FaceState = { postmarkSeed: null, showSchedule: false };

  group: THREE.Group | null = null;
  private front: THREE.Mesh | null = null;
  private back: THREE.Mesh | null = null;
  private texture: THREE.CanvasTexture | null = null;
  private ctx: CanvasRenderingContext2D | null = null;

  constructor(spec: EnvelopeSpec, dest: DestinationModule, slot: number) {
    this.spec = spec;
    this.dest = dest;
    this.slot = slot;
  }

  get destination(): DestinationId {
    return this.spec.destination;
  }

  get dispatch(): DispatchKind {
    return this.spec.dispatch;
  }

  get promoted(): boolean {
    return this.group !== null;
  }

  /** internal - used by the factory when promoting */
  attach(group: THREE.Group, front: THREE.Mesh, back: THREE.Mesh, tex: THREE.CanvasTexture, ctx: CanvasRenderingContext2D): void {
    this.group = group;
    this.front = front;
    this.back = back;
    this.texture = tex;
    this.ctx = ctx;
  }

  detach(): void {
    this.group = null;
    this.front = null;
    this.back = null;
    this.texture = null;
    this.ctx = null;
  }

  get faceContext(): CanvasRenderingContext2D | null {
    return this.ctx;
  }

  markTextureDirty(): void {
    if (this.texture) this.texture.needsUpdate = true;
  }

  applyMorphs(): void {
    for (const m of [this.front, this.back]) {
      if (!m || !m.morphTargetInfluences) continue;
      m.morphTargetInfluences[0] = this.bend;
      m.morphTargetInfluences[1] = this.sink;
      m.morphTargetInfluences[2] = this.fold;
    }
  }
}

export class EnvelopeFactory {
  readonly group = new THREE.Group();

  private atlasCtx: CanvasRenderingContext2D;
  private atlasTex: THREE.CanvasTexture;

  private flatGeo: THREE.PlaneGeometry;
  private morphGeo: THREE.PlaneGeometry;
  private instanced: THREE.InstancedMesh;
  private cellAttr: THREE.InstancedBufferAttribute;

  private backMat: THREE.MeshStandardMaterial;
  private faceRes: number;

  private envelopes: Envelope[] = [];
  private freeSlots: number[] = [];
  private tmpMatrix = new THREE.Matrix4();
  private tmpScale = new THREE.Vector3();
  private hidden = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(highQuality: boolean) {
    this.faceRes = highQuality ? 1024 : 512;

    const [c, ctx] = canvas2d(ATLAS_SIZE, ATLAS_SIZE);
    this.atlasCtx = ctx;
    ctx.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
    this.atlasTex = new THREE.CanvasTexture(c);
    this.atlasTex.colorSpace = THREE.SRGBColorSpace;
    this.atlasTex.anisotropy = 4;
    this.atlasTex.generateMipmaps = false;
    this.atlasTex.minFilter = THREE.LinearFilter;

    for (let i = MAX_INSTANCES - 1; i >= 0; i--) this.freeSlots.push(i);

    this.flatGeo = new THREE.PlaneGeometry(1, 1, 1, 1);
    this.morphGeo = buildMorphGeometry();

    const instMat = new THREE.MeshStandardMaterial({
      map: this.atlasTex,
      roughness: 0.92,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    // remap each instance onto its own atlas cell
    instMat.onBeforeCompile = (shader) => {
      if (!shader.vertexShader.includes('#include <uv_vertex>')) {
        throw new Error('envelope atlas: uv_vertex chunk missing');
      }
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aCell;')
        .replace(
          '#include <uv_vertex>',
          `#include <uv_vertex>
          vMapUv = vMapUv * vec2(${(1 / ATLAS_COLS).toFixed(6)}, ${(1 / ATLAS_ROWS).toFixed(6)}) + aCell;`,
        );
    };
    instMat.customProgramCacheKey = () => 'envelope-atlas';

    this.instanced = new THREE.InstancedMesh(this.flatGeo, instMat, MAX_INSTANCES);
    this.instanced.frustumCulled = false;
    this.instanced.receiveShadow = true;
    this.cellAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_INSTANCES * 2), 2);
    this.flatGeo.setAttribute('aCell', this.cellAttr);
    for (let i = 0; i < MAX_INSTANCES; i++) this.instanced.setMatrixAt(i, this.hidden);
    this.instanced.instanceMatrix.needsUpdate = true;
    this.group.add(this.instanced);

    const [bc, bctx] = canvas2d(256, 128);
    drawEnvelopeBack(bctx, 256, 128, 5);
    const backTex = new THREE.CanvasTexture(bc);
    backTex.colorSpace = THREE.SRGBColorSpace;
    this.backMat = new THREE.MeshStandardMaterial({
      map: backTex,
      roughness: 0.94,
      metalness: 0,
      side: THREE.BackSide,
    });
  }

  get atlasTexture(): THREE.CanvasTexture {
    return this.atlasTex;
  }

  create(spec: EnvelopeSpec, dest: DestinationModule, showSchedule: boolean): Envelope {
    const slot = this.freeSlots.pop();
    if (slot === undefined) throw new Error('envelope atlas exhausted');
    const env = new Envelope(spec, dest, slot);
    env.face.showSchedule = showSchedule;
    this.envelopes.push(env);

    const col = slot % ATLAS_COLS;
    const row = Math.floor(slot / ATLAS_COLS);
    this.cellAttr.setXY(slot, col / ATLAS_COLS, 1 - (row + 1) / ATLAS_ROWS);
    this.cellAttr.needsUpdate = true;

    this.redrawAtlasCell(env);
    return env;
  }

  release(env: Envelope): void {
    this.demote(env);
    const i = this.envelopes.indexOf(env);
    if (i >= 0) this.envelopes.splice(i, 1);
    this.instanced.setMatrixAt(env.slot, this.hidden);
    this.instanced.instanceMatrix.needsUpdate = true;
    this.freeSlots.push(env.slot);
  }

  /** The one letter the camera is close to gets a real mesh with paper morphs. */
  promote(env: Envelope): THREE.Group {
    if (env.group) return env.group;

    const [c, ctx] = canvas2d(this.faceRes, this.faceRes / 2);
    drawEnvelopeFace(ctx, this.faceRes, this.faceRes / 2, env.spec, env.dest, env.face);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;

    const frontMat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.9,
      metalness: 0,
      side: THREE.FrontSide,
    });

    const group = new THREE.Group();
    const front = new THREE.Mesh(this.morphGeo, frontMat);
    front.castShadow = true;
    front.receiveShadow = true;
    const back = new THREE.Mesh(this.morphGeo, this.backMat);
    back.position.z = -0.0007;
    group.add(front, back);
    group.scale.set(env.spec.width, env.spec.height, 1);
    this.group.add(group);

    env.attach(group, front, back, tex, ctx);
    env.applyMorphs();

    this.instanced.setMatrixAt(env.slot, this.hidden);
    this.instanced.instanceMatrix.needsUpdate = true;
    return group;
  }

  demote(env: Envelope): void {
    const group = env.group;
    if (!group) return;
    this.group.remove(group);
    const front = group.children[0] as THREE.Mesh;
    const mat = front.material as THREE.MeshStandardMaterial;
    mat.map?.dispose();
    mat.dispose();
    env.detach();
    this.redrawAtlasCell(env);
  }

  redrawAtlasCell(env: Envelope): void {
    const col = env.slot % ATLAS_COLS;
    const row = Math.floor(env.slot / ATLAS_COLS);
    const ctx = this.atlasCtx;
    ctx.save();
    ctx.translate(col * CELL_W, row * CELL_H);
    ctx.beginPath();
    ctx.rect(0, 0, CELL_W, CELL_H);
    ctx.clip();
    drawEnvelopeFace(ctx, CELL_W, CELL_H, env.spec, env.dest, env.face);
    ctx.restore();
    this.atlasTex.needsUpdate = true;
  }

  /** Re-ink the promoted sheet where the die touched it. */
  stamp(env: Envelope, pressure: number): void {
    const ctx = env.faceContext;
    env.postmarked = true;
    env.face.postmarkSeed = env.spec.seed + 977;
    if (ctx) {
      const w = this.faceRes;
      const h = this.faceRes / 2;
      drawPostmarkInk(ctx, w * POSTMARK_UV.x, h * POSTMARK_UV.y, h * 0.34, env.face.postmarkSeed, pressure);
      env.markTextureDirty();
    } else {
      this.redrawAtlasCell(env);
    }
  }

  update(): void {
    let dirty = false;
    for (const env of this.envelopes) {
      if (env.group) {
        env.group.position.copy(env.position);
        env.group.quaternion.copy(env.quaternion);
        env.group.visible = env.visible;
        env.applyMorphs();
      } else {
        if (!env.visible) {
          this.instanced.setMatrixAt(env.slot, this.hidden);
        } else {
          this.tmpScale.set(env.spec.width, env.spec.height, 1);
          this.tmpMatrix.compose(env.position, env.quaternion, this.tmpScale);
          this.instanced.setMatrixAt(env.slot, this.tmpMatrix);
        }
        dirty = true;
      }
    }
    if (dirty) this.instanced.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.flatGeo.dispose();
    this.morphGeo.dispose();
    this.atlasTex.dispose();
    (this.instanced.material as THREE.Material).dispose();
    this.backMat.map?.dispose();
    this.backMat.dispose();
  }
}

/** Flat sheet plus three paper morphs: a bow, the press dent, one worn corner fold. */
function buildMorphGeometry(): THREE.PlaneGeometry {
  const segX = 14;
  const segY = 8;
  const geo = new THREE.PlaneGeometry(1, 1, segX, segY);
  const base = geo.attributes.position.array as Float32Array;
  const count = geo.attributes.position.count;

  const bend = new Float32Array(base.length);
  const sink = new Float32Array(base.length);
  const fold = new Float32Array(base.length);

  for (let i = 0; i < count; i++) {
    const x = base[i * 3];
    const y = base[i * 3 + 1];
    const u = x + 0.5;
    const v = y + 0.5;

    bend[i * 3] = x;
    bend[i * 3 + 1] = y;
    bend[i * 3 + 2] = 0.075 * (1 - (2 * u - 1) ** 2) * (0.55 + 0.45 * (1 - (2 * v - 1) ** 2));

    const dx = u - POSTMARK_UV.x;
    const dy = v - (1 - POSTMARK_UV.y);
    const d2 = (dx * dx) / 0.05 + (dy * dy) / 0.05;
    sink[i * 3] = x;
    sink[i * 3 + 1] = y;
    sink[i * 3 + 2] = -0.03 * Math.exp(-d2);

    // one dog-eared corner (bottom-left of the sheet)
    const k = Math.max(0, 1 - (u * 2.6 + (1 - v) * 2.6));
    fold[i * 3] = x + k * 0.06;
    fold[i * 3 + 1] = y + k * 0.06;
    fold[i * 3 + 2] = k * 0.05;
  }

  geo.morphAttributes.position = [
    new THREE.BufferAttribute(bend, 3),
    new THREE.BufferAttribute(sink, 3),
    new THREE.BufferAttribute(fold, 3),
  ];
  geo.morphTargetsRelative = false;
  return geo;
}

function drawStamp(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  rng: Rng,
  accent: number,
): void {
  // perforated edge
  ctx.save();
  ctx.fillStyle = '#f2ecdc';
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.fill();
  ctx.globalCompositeOperation = 'destination-out';
  const teeth = 9;
  for (let i = 0; i <= teeth; i++) {
    const t = i / teeth;
    ctx.beginPath();
    ctx.arc(x + t * w, y, w / teeth / 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + t * w, y + h, w / teeth / 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
  const teethV = 7;
  for (let i = 0; i <= teethV; i++) {
    const t = i / teethV;
    ctx.beginPath();
    ctx.arc(x, y + t * h, w / teeth / 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + w, y + t * h, w / teeth / 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // an abstract printed vignette: low sun over ridges, no wording
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(rng.range(-0.02, 0.02));
  ctx.translate(-(x + w / 2), -(y + h / 2));
  ctx.beginPath();
  ctx.rect(x + w * 0.1, y + h * 0.1, w * 0.8, h * 0.8);
  ctx.clip();
  const c = new THREE.Color(accent);
  ctx.fillStyle = `rgb(${(c.r * 255) | 0},${(c.g * 255) | 0},${(c.b * 255) | 0})`;
  ctx.globalAlpha = 0.35;
  ctx.fillRect(x + w * 0.1, y + h * 0.1, w * 0.8, h * 0.8);
  ctx.globalAlpha = 0.75;
  ctx.beginPath();
  ctx.arc(x + w * 0.5, y + h * 0.52, h * 0.16, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.moveTo(x + w * 0.08, y + h * 0.9);
  ctx.lineTo(x + w * 0.36, y + h * 0.5);
  ctx.lineTo(x + w * 0.62, y + h * 0.9);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.3;
  ctx.strokeStyle = '#8a7c60';
  ctx.lineWidth = Math.max(1, w * 0.012);
  ctx.strokeRect(x + w * 0.08, y + h * 0.08, w * 0.84, h * 0.84);
  ctx.restore();
}

/** The two dispatch seals of this fictional office: a day disc, or a keeping star. */
function drawScheduleSeal(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  kind: DispatchKind,
  rng: Rng,
): void {
  const hand = makeHand(ctx, rng, r * 0.06, r * 0.18);
  ctx.save();
  if (kind === 'today') {
    ctx.strokeStyle = 'rgba(150,74,52,0.85)';
    hand.circle(cx, cy, r * 0.62);
    ctx.fillStyle = 'rgba(150,74,52,0.5)';
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.34, 0, Math.PI * 2);
    ctx.fill();
    hand.line(cx - r * 0.85, cy + r * 0.9, cx + r * 0.85, cy + r * 0.9);
  } else {
    ctx.strokeStyle = 'rgba(58,86,110,0.85)';
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI;
      hand.line(cx - Math.cos(a) * r * 0.72, cy - Math.sin(a) * r * 0.72, cx + Math.cos(a) * r * 0.72, cy + Math.sin(a) * r * 0.72);
    }
    hand.circle(cx, cy, r * 0.92);
  }
  ctx.restore();
}

export function drawEnvelopeFace(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  spec: EnvelopeSpec,
  dest: DestinationModule,
  state: FaceState,
): void {
  const rng = new Rng(spec.seed);
  paintPaper(ctx, w, h, { seed: spec.seed, tone: spec.tone, fibre: spec.fibre, wear: spec.wear });

  // the crease this sheet picked up in transit
  if (spec.fold > 0.01) {
    ctx.save();
    ctx.globalAlpha = 0.14 * spec.fold;
    ctx.strokeStyle = '#6f6249';
    ctx.lineWidth = Math.max(1, h * 0.014);
    ctx.beginPath();
    ctx.moveTo(0, h * (0.72 + rng.range(-0.1, 0.1)));
    ctx.lineTo(w * 0.42, h * (0.86 + rng.range(-0.06, 0.06)));
    ctx.stroke();
    ctx.restore();
  }

  // the picture that stands in for an address
  const boxW = w * 0.4;
  const boxH = h * 0.66;
  const boxX = w * 0.06;
  const boxY = h * 0.17;
  ctx.save();
  ctx.translate(boxX, boxY);
  ctx.globalAlpha = 0.94;
  dest.drawPictogram(ctx, boxW, boxH, new Rng(spec.seed * 3 + 17), 'rgba(48,42,36,0.9)');
  ctx.restore();

  // a light rule under the picture, like a ruled address block
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = '#6d6047';
  ctx.lineWidth = Math.max(1, h * 0.008);
  ctx.beginPath();
  ctx.moveTo(boxX, boxY + boxH + h * 0.05);
  ctx.lineTo(boxX + boxW * 1.05, boxY + boxH + h * 0.05);
  ctx.stroke();
  ctx.restore();

  const sw = w * 0.15;
  const sh = h * 0.3;
  const sx = spec.stampCorner === 0 ? w * 0.79 : w * 0.63;
  const sy = h * 0.09;
  drawStamp(ctx, sx, sy, sw, sh, rng, dest.accent);

  if (state.showSchedule) {
    drawScheduleSeal(ctx, w * 0.5, h * 0.78, h * 0.11, spec.dispatch, new Rng(spec.seed + 41));
  }

  if (state.postmarkSeed !== null) {
    drawPostmarkInk(ctx, w * POSTMARK_UV.x, h * POSTMARK_UV.y, h * 0.34, state.postmarkSeed, 1);
  }
}

function drawEnvelopeBack(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number): void {
  paintPaper(ctx, w, h, { seed, tone: [214, 203, 180], fibre: 1, wear: 0.9 });
  ctx.save();
  ctx.globalAlpha = 0.2;
  ctx.strokeStyle = '#6f6249';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(w * 0.5, h * 0.52);
  ctx.lineTo(w, 0);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, h);
  ctx.lineTo(w * 0.5, h * 0.52);
  ctx.lineTo(w, h);
  ctx.stroke();
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = '#8d7a58';
  ctx.beginPath();
  ctx.arc(w * 0.5, h * 0.52, h * 0.09, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
