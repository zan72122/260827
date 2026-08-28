import * as THREE from 'three';
import { NoiseField } from './noise';
import { clamp } from './rng';

type Ctx = CanvasRenderingContext2D;

function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: Ctx } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as Ctx;
  return { canvas, ctx };
}

function finish(canvas: HTMLCanvasElement, srgb: boolean, repeat: [number, number]): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/** Sobel-converts a height field into a tangent space normal map. */
function heightToNormal(height: Float32Array, w: number, h: number, strength: number): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(w, h);
  const img = ctx.createImageData(w, h);
  const at = (x: number, y: number) => height[((y + h) % h) * w + ((x + w) % w)];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      let nx = -dx;
      let ny = -dy;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      const i = (y * w + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz / len) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return finish(canvas, false, [1, 1]);
}

export interface SurfaceSet {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
}

const TEX_CACHE = new Map<string, unknown>();
function cached<T>(key: string, build: () => T): T {
  const hit = TEX_CACHE.get(key);
  if (hit) return hit as T;
  const made = build();
  TEX_CACHE.set(key, made);
  return made;
}

/**
 * Conifer bark: vertical fissures, overlapping scale plates, a resin bleed here and
 * there. Deliberately not a uniform brown - the plates read at arm's length.
 */
export function barkSurface(size = 512): SurfaceSet {
  return cached('bark' + size, () => {
    const w = size;
    const h = size * 2;
    const n = new NoiseField(21);
    const { canvas, ctx } = makeCanvas(w, h);
    const img = ctx.createImageData(w, h);
    const height = new Float32Array(w * h);
    const rough = ctx.createImageData(w, h);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const u = (x / w) * 8;
        const v = (y / h) * 22;
        // vertical fissures: noise stretched along the trunk axis
        const warp = n.fbm(u * 2.0, v * 0.35, 16, 3) - 0.5;
        const fissure = n.fbm(u * 3.0 + warp * 1.6, v * 0.28, 24, 4);
        const crack = clamp(1 - Math.abs(fissure - 0.5) * 6.5, 0, 1);
        // scale plates
        const plate = n.cell(u * 3.1 + warp, v * 1.35, 24);
        const plateEdge = clamp(1 - plate.d * 2.2, 0, 1);
        const grain = n.fbm(u * 14, v * 5.5, 96, 3);

        let hgt = 0.55 + plateEdge * -0.35 + (0.5 - crack) * 0.5 + (grain - 0.5) * 0.28;
        hgt = clamp(hgt, 0, 1);
        height[y * w + x] = hgt;

        const plateTone = ((plate.id % 17) / 17 - 0.5) * 0.14;
        let r = 0.24 + plateTone;
        let g = 0.183 + plateTone * 0.85;
        let b = 0.138 + plateTone * 0.7;
        // grey lichen wash on the raised plates
        const lichen = clamp((n.fbm(u * 1.5, v * 0.9, 12, 3) - 0.56) * 5, 0, 1) * (1 - plateEdge);
        r += lichen * 0.16;
        g += lichen * 0.18;
        b += lichen * 0.13;
        // dark, damp cracks
        const dark = crack * 0.55 + plateEdge * 0.3;
        r *= 1 - dark * 0.62;
        g *= 1 - dark * 0.66;
        b *= 1 - dark * 0.68;
        r += (grain - 0.5) * 0.05;
        g += (grain - 0.5) * 0.045;

        // resin bleed - rare amber streaks
        const resin = clamp((n.fbm(u * 0.9 + 3.1, v * 0.5, 8, 2) - 0.78) * 7, 0, 1) * 0.7;
        if (resin > 0) {
          r = r * (1 - resin) + 0.44 * resin;
          g = g * (1 - resin) + 0.31 * resin;
          b = b * (1 - resin) + 0.12 * resin;
        }

        const i = (y * w + x) * 4;
        img.data[i] = clamp(r, 0, 1) * 255;
        img.data[i + 1] = clamp(g, 0, 1) * 255;
        img.data[i + 2] = clamp(b, 0, 1) * 255;
        img.data[i + 3] = 255;

        // resin is glossy, cracks and lichen are matte
        const rr = clamp(0.93 - resin * 0.55 + crack * 0.05 - grain * 0.06, 0.2, 1);
        rough.data[i] = rough.data[i + 1] = rough.data[i + 2] = rr * 255;
        rough.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const map = finish(canvas, true, [1, 1]);

    const rc = makeCanvas(w, h);
    rc.ctx.putImageData(rough, 0, 0);

    return {
      map,
      normalMap: heightToNormal(height, w, h, 2.6),
      roughnessMap: finish(rc.canvas, false, [1, 1]),
    };
  });
}

/** Freshly sawn butt end: growth rings, a saw-blade arc, damp sapwood rim. */
export function cutFaceTexture(size = 256): THREE.Texture {
  return cached('cut' + size, () => {
    const { canvas, ctx } = makeCanvas(size, size);
    const n = new NoiseField(5);
    const img = ctx.createImageData(size, size);
    const c = size / 2;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (x - c) / c;
        const dy = (y - c) / c;
        const rad = Math.hypot(dx, dy);
        const ang = Math.atan2(dy, dx);
        const wob = (n.fbm(dx * 3 + 2, dy * 3 + 2, 16, 3) - 0.5) * 0.06;
        const rings = 0.5 + 0.5 * Math.sin((rad + wob) * 58 + Math.sin(ang * 3) * 0.4);
        const late = Math.pow(rings, 3);
        let r = 0.78 - late * 0.2;
        let g = 0.66 - late * 0.2;
        let b = 0.47 - late * 0.16;
        // sapwood is paler near the bark, heartwood warmer at the pith
        const heart = clamp(1 - rad * 1.6, 0, 1);
        r += heart * 0.05;
        g -= heart * 0.02;
        b -= heart * 0.05;
        // saw kerf arcs
        const kerf = 0.5 + 0.5 * Math.sin((dx * 0.9 + dy * 0.35) * 90);
        const shade = 1 - kerf * 0.06;
        const i = (y * size + x) * 4;
        img.data[i] = clamp(r * shade, 0, 1) * 255;
        img.data[i + 1] = clamp(g * shade, 0, 1) * 255;
        img.data[i + 2] = clamp(b * shade, 0, 1) * 255;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return finish(canvas, true, [1, 1]);
  });
}

/** Painted steel: orange peel, honest dirt streaks, chips only where noted by callers. */
export function paintedSteelSurface(hex: number, size = 512, wear = 0.35): SurfaceSet {
  return cached('paint' + hex + size + wear, () => {
    const base = new THREE.Color(hex);
    const n = new NoiseField(hex & 0xffff);
    const { canvas, ctx } = makeCanvas(size, size);
    const img = ctx.createImageData(size, size);
    const rough = ctx.createImageData(size, size);
    const height = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = (x / size) * 6;
        const v = (y / size) * 6;
        const peel = n.fbm(u * 9, v * 9, 64, 3);
        const dirt = clamp((n.fbm(u * 1.4, v * 0.5 + 4, 12, 4) - 0.48) * 2.4, 0, 1) * wear;
        const streak = clamp((n.fbm(u * 6, v * 0.35, 48, 3) - 0.55) * 3, 0, 1) * wear * 0.8;
        const chip = clamp((n.cell(u * 5, v * 5, 32).d - 0.62) * 4, 0, 1) * wear * 0.5;

        let r = base.r * (1 + (peel - 0.5) * 0.09);
        let g = base.g * (1 + (peel - 0.5) * 0.09);
        let b = base.b * (1 + (peel - 0.5) * 0.09);
        // grey grime settles, rust creeps from chips
        r = r * (1 - dirt * 0.5) + 0.24 * dirt * 0.5;
        g = g * (1 - dirt * 0.5) + 0.23 * dirt * 0.5;
        b = b * (1 - dirt * 0.5) + 0.21 * dirt * 0.5;
        r = r * (1 - chip) + 0.35 * chip;
        g = g * (1 - chip) + 0.22 * chip;
        b = b * (1 - chip) + 0.14 * chip;
        r *= 1 - streak * 0.25;
        g *= 1 - streak * 0.25;
        b *= 1 - streak * 0.22;

        const i = (y * size + x) * 4;
        img.data[i] = clamp(r, 0, 1) * 255;
        img.data[i + 1] = clamp(g, 0, 1) * 255;
        img.data[i + 2] = clamp(b, 0, 1) * 255;
        img.data[i + 3] = 255;

        const rr = clamp(0.42 + peel * 0.12 + dirt * 0.4 + chip * 0.3, 0.2, 1);
        rough.data[i] = rough.data[i + 1] = rough.data[i + 2] = rr * 255;
        rough.data[i + 3] = 255;
        height[y * size + x] = peel * 0.35 + chip * 0.6;
      }
    }
    ctx.putImageData(img, 0, 0);
    const rc = makeCanvas(size, size);
    rc.ctx.putImageData(rough, 0, 0);
    return {
      map: finish(canvas, true, [1, 1]),
      normalMap: heightToNormal(height, size, size, 1.1),
      roughnessMap: finish(rc.canvas, false, [1, 1]),
    };
  });
}

/** Bare steel that trees have rubbed shiny: the baler mouth ring, roller shafts. */
export function scuffedSteelSurface(size = 256): SurfaceSet {
  return cached('scuff' + size, () => {
    const n = new NoiseField(909);
    const { canvas, ctx } = makeCanvas(size, size);
    const img = ctx.createImageData(size, size);
    const rough = ctx.createImageData(size, size);
    const height = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = (x / size) * 8;
        const v = (y / size) * 8;
        const scratch = n.fbm(u * 30, v * 1.2, 128, 2);
        const patina = n.fbm(u * 2, v * 2, 16, 3);
        const polish = clamp((n.fbm(u * 1.1 + 5, v * 3, 8, 2) - 0.42) * 2.4, 0, 1);
        let g = 0.36 + patina * 0.12 + polish * 0.24 + (scratch - 0.5) * 0.1;
        const rust = clamp((patina - 0.68) * 4, 0, 1) * (1 - polish);
        const r = clamp(g + rust * 0.2, 0, 1);
        const bl = clamp(g - rust * 0.16, 0, 1);
        g = clamp(g - rust * 0.05, 0, 1);
        const i = (y * size + x) * 4;
        img.data[i] = r * 255;
        img.data[i + 1] = g * 255;
        img.data[i + 2] = bl * 255;
        img.data[i + 3] = 255;
        const rr = clamp(0.62 - polish * 0.34 + rust * 0.25 + (scratch - 0.5) * 0.12, 0.12, 1);
        rough.data[i] = rough.data[i + 1] = rough.data[i + 2] = rr * 255;
        rough.data[i + 3] = 255;
        height[y * size + x] = scratch * 0.5 + rust * 0.4;
      }
    }
    ctx.putImageData(img, 0, 0);
    const rc = makeCanvas(size, size);
    rc.ctx.putImageData(rough, 0, 0);
    return {
      map: finish(canvas, true, [1, 1]),
      normalMap: heightToNormal(height, size, size, 0.8),
      roughnessMap: finish(rc.canvas, false, [1, 1]),
    };
  });
}

/** Feed roller rubber: dull, slightly compressed, stained by needle contact. */
export function rubberSurface(size = 256): SurfaceSet {
  return cached('rubber' + size, () => {
    const n = new NoiseField(4242);
    const { canvas, ctx } = makeCanvas(size, size);
    const img = ctx.createImageData(size, size);
    const height = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = (x / size) * 6;
        const v = (y / size) * 6;
        const grain = n.fbm(u * 26, v * 26, 96, 3);
        const rib = 0.5 + 0.5 * Math.sin(v * 34);
        const needleStain = clamp((n.fbm(u * 3 + 9, v * 9, 24, 3) - 0.55) * 3, 0, 1);
        let r = 0.075 + grain * 0.05 + rib * 0.012;
        let g = 0.077 + grain * 0.05 + rib * 0.012;
        let b = 0.08 + grain * 0.05 + rib * 0.012;
        r = r * (1 - needleStain * 0.6) + 0.13 * needleStain * 0.6;
        g = g * (1 - needleStain * 0.6) + 0.16 * needleStain * 0.6;
        b = b * (1 - needleStain * 0.6) + 0.09 * needleStain * 0.6;
        const i = (y * size + x) * 4;
        img.data[i] = clamp(r, 0, 1) * 255;
        img.data[i + 1] = clamp(g, 0, 1) * 255;
        img.data[i + 2] = clamp(b, 0, 1) * 255;
        img.data[i + 3] = 255;
        height[y * size + x] = grain * 0.5 + rib * 0.5;
      }
    }
    ctx.putImageData(img, 0, 0);
    return {
      map: finish(canvas, true, [1, 1]),
      normalMap: heightToNormal(height, size, size, 1.4),
      roughnessMap: finish(canvas, false, [1, 1]),
    };
  });
}

/** Yard floor: wet soil, crushed stone, trodden needle litter. */
export function groundSurface(size = 512): SurfaceSet {
  return cached('ground' + size, () => {
    const n = new NoiseField(777);
    const { canvas, ctx } = makeCanvas(size, size);
    const img = ctx.createImageData(size, size);
    const rough = ctx.createImageData(size, size);
    const height = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = (x / size) * 8;
        const v = (y / size) * 8;
        const soil = n.fbm(u * 3, v * 3, 24, 4);
        const stone = n.cell(u * 15, v * 15, 120);
        const stoneMask = clamp((0.42 - stone.d) * 3.4, 0, 1);
        const stoneTone = ((stone.id % 13) / 13 - 0.5) * 0.12;
        const litter = clamp((n.fbm(u * 16 + 3, v * 5, 128, 2) - 0.62) * 4, 0, 1);

        let r = 0.2 + soil * 0.13;
        let g = 0.163 + soil * 0.108;
        let b = 0.126 + soil * 0.08;
        // stones
        r = r * (1 - stoneMask) + (0.4 + stoneTone) * stoneMask;
        g = g * (1 - stoneMask) + (0.385 + stoneTone) * stoneMask;
        b = b * (1 - stoneMask) + (0.355 + stoneTone) * stoneMask;
        // dead needle litter
        r = r * (1 - litter) + 0.31 * litter;
        g = g * (1 - litter) + 0.2 * litter;
        b = b * (1 - litter) + 0.1 * litter;

        const i = (y * size + x) * 4;
        img.data[i] = clamp(r, 0, 1) * 255;
        img.data[i + 1] = clamp(g, 0, 1) * 255;
        img.data[i + 2] = clamp(b, 0, 1) * 255;
        img.data[i + 3] = 255;
        const rr = clamp(0.95 - stoneMask * 0.12 - litter * 0.05, 0.35, 1);
        rough.data[i] = rough.data[i + 1] = rough.data[i + 2] = rr * 255;
        rough.data[i + 3] = 255;
        height[y * size + x] = soil * 0.4 + stoneMask * 0.6 + litter * 0.2;
      }
    }
    ctx.putImageData(img, 0, 0);
    const rc = makeCanvas(size, size);
    rc.ctx.putImageData(rough, 0, 0);
    return {
      map: finish(canvas, true, [1, 1]),
      normalMap: heightToNormal(height, size, size, 1.6),
      roughnessMap: finish(rc.canvas, false, [1, 1]),
    };
  });
}

/** Soft-edged alpha blob used for wheel ruts, puddles and swept litter decals. */
export function decalTexture(kind: 'rut' | 'puddle' | 'litter', size = 256): THREE.Texture {
  return cached('decal' + kind + size, () => {
    const n = new NoiseField(kind === 'rut' ? 11 : kind === 'puddle' ? 33 : 55);
    const { canvas, ctx } = makeCanvas(size, size);
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const fx = x / size;
        const fy = y / size;
        let a = 0;
        let r = 0.1;
        let g = 0.08;
        let b = 0.06;
        if (kind === 'rut') {
          // two parallel tyre tracks running the length of the decal
          const t1 = Math.exp(-Math.pow((fx - 0.32) / 0.075, 2));
          const t2 = Math.exp(-Math.pow((fx - 0.68) / 0.075, 2));
          const tread = 0.55 + 0.45 * Math.sin(fy * 150 + n.fbm(fx * 4, fy * 20, 32, 2) * 6);
          a = clamp((t1 + t2) * (0.55 + tread * 0.45), 0, 1);
          a *= clamp(1 - Math.abs(fy - 0.5) * 1.7, 0, 1);
          r = 0.09;
          g = 0.072;
          b = 0.055;
        } else if (kind === 'puddle') {
          const d = Math.hypot(fx - 0.5, fy - 0.5) * 2;
          const wob = (n.fbm(fx * 5, fy * 5, 32, 3) - 0.5) * 0.55;
          a = clamp((0.82 - d + wob) * 3, 0, 1);
          r = 0.055;
          g = 0.055;
          b = 0.06;
        } else {
          const d = Math.hypot(fx - 0.5, fy - 0.5) * 2;
          const clump = n.fbm(fx * 9, fy * 9, 64, 3);
          a = clamp((0.85 - d) * 2, 0, 1) * clamp((clump - 0.4) * 2.6, 0, 1);
          r = 0.28;
          g = 0.18;
          b = 0.09;
        }
        const i = (y * size + x) * 4;
        img.data[i] = r * 255;
        img.data[i + 1] = g * 255;
        img.data[i + 2] = b * 255;
        img.data[i + 3] = a * 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const tex = finish(canvas, true, [1, 1]);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  });
}

/** Baling net: knitted diamond mesh with knots. Alpha map, not a see-through bag. */
export function netAlphaTexture(size = 256): THREE.Texture {
  return cached('net' + size, () => {
    const { canvas, ctx } = makeCanvas(size, size);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = '#fff';
    ctx.lineCap = 'round';
    const cells = 6;
    const step = size / cells;
    ctx.lineWidth = Math.max(1.5, size / 190);
    for (let i = -cells; i <= cells * 2; i++) {
      ctx.beginPath();
      ctx.moveTo(i * step, 0);
      ctx.lineTo(i * step + size, size);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(i * step, 0);
      ctx.lineTo(i * step - size, size);
      ctx.stroke();
    }
    // knots where strands cross
    ctx.fillStyle = '#fff';
    for (let y = 0; y <= cells; y++) {
      for (let x = 0; x <= cells; x++) {
        ctx.beginPath();
        ctx.arc(x * step, y * step, size / 120, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    return finish(canvas, false, [1, 1]);
  });
}

/** Poured concrete for the delivery hall: float marks, control joints, scuffs. */
export function concreteSurface(size = 512): SurfaceSet {
  return cached('concrete' + size, () => {
    const n = new NoiseField(1212);
    const { canvas, ctx } = makeCanvas(size, size);
    const img = ctx.createImageData(size, size);
    const rough = ctx.createImageData(size, size);
    const height = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = (x / size) * 5;
        const v = (y / size) * 5;
        const grain = n.fbm(u * 12, v * 12, 64, 4);
        const float = n.fbm(u * 2 + 4, v * 2, 16, 3);
        const scuff = clamp((n.fbm(u * 7, v * 1.5, 48, 2) - 0.6) * 3, 0, 1);
        let c = 0.36 + grain * 0.08 + (float - 0.5) * 0.07 - scuff * 0.06;
        const i = (y * size + x) * 4;
        img.data[i] = clamp(c * 1.02, 0, 1) * 255;
        img.data[i + 1] = clamp(c, 0, 1) * 255;
        img.data[i + 2] = clamp(c * 0.96, 0, 1) * 255;
        img.data[i + 3] = 255;
        const rr = clamp(0.72 + grain * 0.15 - scuff * 0.18, 0.3, 1);
        rough.data[i] = rough.data[i + 1] = rough.data[i + 2] = rr * 255;
        rough.data[i + 3] = 255;
        height[y * size + x] = grain * 0.5 + float * 0.3;
      }
    }
    ctx.putImageData(img, 0, 0);
    const rc = makeCanvas(size, size);
    rc.ctx.putImageData(rough, 0, 0);
    return {
      map: finish(canvas, true, [1, 1]),
      normalMap: heightToNormal(height, size, size, 0.7),
      roughnessMap: finish(rc.canvas, false, [1, 1]),
    };
  });
}

/** Overcast winter sky, slightly brighter toward the horizon. */
export function skyTexture(): THREE.Texture {
  return cached('sky', () => {
    const { canvas, ctx } = makeCanvas(16, 256);
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0.0, '#5d6f7d');
    g.addColorStop(0.42, '#8c9aa4');
    g.addColorStop(0.62, '#b6bcbd');
    g.addColorStop(0.78, '#c9c6bd');
    g.addColorStop(1.0, '#8e8a80');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 16, 256);
    const tex = finish(canvas, true, [1, 1]);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  });
}

/** Distant conifer belt drawn as an alpha silhouette card. */
export function treeLineTexture(size = 512): THREE.Texture {
  return cached('treeline' + size, () => {
    const { canvas, ctx } = makeCanvas(size, size / 2);
    const h = size / 2;
    ctx.clearRect(0, 0, size, h);
    const n = new NoiseField(64);
    for (let layer = 0; layer < 2; layer++) {
      ctx.fillStyle = layer === 0 ? 'rgba(52,66,66,0.92)' : 'rgba(38,52,52,0.96)';
      const count = layer === 0 ? 46 : 34;
      for (let i = 0; i < count; i++) {
        const x = (i / count) * size + n.value(i * 3, layer * 7, 64) * 14;
        const th = h * (0.34 + n.value(i * 5 + 1, layer, 64) * 0.5) * (layer === 0 ? 0.8 : 1);
        const wdt = th * (0.3 + n.value(i, layer * 3, 64) * 0.2);
        ctx.beginPath();
        ctx.moveTo(x, h - th);
        for (let s = 0; s < 5; s++) {
          const t = (s + 1) / 5;
          ctx.lineTo(x + wdt * t, h - th * (1 - t) - th * 0.04);
          ctx.lineTo(x + wdt * t * 0.72, h - th * (1 - t));
        }
        ctx.lineTo(x, h);
        for (let s = 4; s >= 0; s--) {
          const t = (s + 1) / 5;
          ctx.lineTo(x - wdt * t * 0.72, h - th * (1 - t));
          ctx.lineTo(x - wdt * t, h - th * (1 - t) - th * 0.04);
        }
        ctx.closePath();
        ctx.fill();
      }
    }
    const tex = finish(canvas, true, [1, 1]);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  });
}

/** Soft radial blob for contact shadows under the tree and the machines. */
export function blobShadowTexture(size = 128): THREE.Texture {
  return cached('blob' + size, () => {
    const { canvas, ctx } = makeCanvas(size, size);
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(0,0,0,0.72)');
    g.addColorStop(0.45, 'rgba(0,0,0,0.4)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = finish(canvas, true, [1, 1]);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  });
}

/** Needle card for mid and far foliage - real sprig geometry is reserved for the hero tree. */
export function needleCardTexture(size = 128): THREE.Texture {
  return cached('needlecard' + size, () => {
    const { canvas, ctx } = makeCanvas(size, size);
    ctx.clearRect(0, 0, size, size);
    const n = new NoiseField(88);
    ctx.lineCap = 'round';
    for (let i = 0; i < 90; i++) {
      const x = n.value(i * 2, 1, 64) * size;
      const y = n.value(i * 2 + 1, 5, 64) * size;
      const a = (n.value(i, 9, 64) - 0.5) * 2.4;
      const len = size * (0.08 + n.value(i, 13, 64) * 0.1);
      const shade = 0.5 + n.value(i, 17, 64) * 0.5;
      ctx.strokeStyle = 'rgba(' + Math.round(40 * shade) + ',' + Math.round(82 * shade) + ',' + Math.round(46 * shade) + ',0.95)';
      ctx.lineWidth = Math.max(1, size / 70);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
      ctx.stroke();
    }
    const tex = finish(canvas, true, [1, 1]);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  });
}
