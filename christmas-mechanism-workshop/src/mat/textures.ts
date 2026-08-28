import * as THREE from 'three';
import { clamp, fbm2, lerp, Rng, valueNoise2 } from '../util/math';

/* ------------------------------------------------------------------ *
 * Procedural texture bakery.
 * Everything the workshop is made of is painted here into 2-D canvases:
 * grain that has a direction, lathe rings that run around a turning,
 * paint that has worn where hands hold, brass that is polished on the
 * strike face and dull in the recesses.  No image assets, no downloads.
 * ------------------------------------------------------------------ */

let TEX_SCALE = 1;
export function setTextureScale(s: number) { TEX_SCALE = s; }

function canvas(w: number, h = w) {
  const c = document.createElement('canvas');
  c.width = Math.max(32, Math.round(w * TEX_SCALE));
  c.height = Math.max(32, Math.round(h * TEX_SCALE));
  return c;
}

function toTexture(c: HTMLCanvasElement, srgb: boolean, repeat = 1, repeatY = repeat) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeatY);
  t.needsUpdate = true;
  return t;
}

let maxAniso = 4;
export function setAnisotropy(a: number) { maxAniso = a; }
function aniso<T extends THREE.Texture>(t: T): T { t.anisotropy = maxAniso; return t; }

/* ---------------- height -> normal ---------------- */

export function normalFromHeight(src: HTMLCanvasElement, strength = 1.6): THREE.Texture {
  const w = src.width, h = src.height;
  const sctx = src.getContext('2d')!;
  const sd = sctx.getImageData(0, 0, w, h).data;
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const octx = out.getContext('2d')!;
  const od = octx.createImageData(w, h);
  const at = (x: number, y: number) => sd[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      let nx = -dx, ny = -dy, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const i = (y * w + x) * 4;
      od.data[i] = (nx * 0.5 + 0.5) * 255;
      od.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      od.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      od.data[i + 3] = 255;
    }
  }
  octx.putImageData(od, 0, 0);
  const t = new THREE.CanvasTexture(out);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return aniso(t);
}

/* ---------------- wood ---------------- */

export interface WoodOpts {
  light: [number, number, number];
  dark: [number, number, number];
  grainScaleX: number;   // stretch along the grain direction (U)
  grainScaleY: number;
  ringDensity: number;
  knots: number;
  size?: number;
  seed?: number;
}

interface WoodSet { map: THREE.Texture; rough: THREE.Texture; normal: THREE.Texture; }

/**
 * Straight grain running along +U. Rings are wobbled by low-frequency noise
 * so the plank never reads as a repeating stripe, and pores add the fine
 * broken speckle that separates wood from painted plastic.
 */
export function makeWood(o: WoodOpts): WoodSet {
  const S = o.size ?? 512;
  const rng = new Rng(o.seed ?? 7);
  const knots: { x: number; y: number; r: number }[] = [];
  for (let i = 0; i < o.knots; i++)
    knots.push({ x: rng.next(), y: rng.next(), r: rng.range(0.018, 0.05) });

  const col = canvas(S), hgt = canvas(S), rgh = canvas(S);
  const cw = col.width, ch = col.height;
  const cd = col.getContext('2d')!.createImageData(cw, ch);
  const hd = hgt.getContext('2d')!.createImageData(cw, ch);
  const rd = rgh.getContext('2d')!.createImageData(cw, ch);

  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const u = x / cw, v = y / ch;
      // ring coordinate: the grain axis warped by two noise octaves
      let g = v * o.grainScaleY + fbm2(u * o.grainScaleX, v * 1.5, 3, o.seed ?? 7) * 0.40;
      for (const k of knots) {
        // a knot pinches the rings around it; it does not repaint the board
        const d = Math.hypot((u - k.x) * 0.45, v - k.y);
        if (d < k.r * 3.0) g += (k.r * 3.0 - d) * 2.1;
      }
      let ring = Math.sin(g * o.ringDensity * Math.PI * 2) * 0.5 + 0.5;
      ring = Math.pow(ring, 2.3);
      // pores: fine broken dashes elongated along the grain
      const pore = valueNoise2(u * 320 * 0.32, v * 320, 991);
      const poreMask = pore > 0.74 ? (pore - 0.74) * 3.4 : 0;
      let t = clamp(ring * 0.62 + poreMask * 0.34, 0, 1);
      // large scale colour drift so boards are not uniform
      t = clamp(t * 0.80 + fbm2(u * 2.4, v * 1.6, 3, 313) * 0.24, 0, 1);

      const i = (y * cw + x) * 4;
      cd.data[i] = lerp(o.light[0], o.dark[0], t);
      cd.data[i + 1] = lerp(o.light[1], o.dark[1], t);
      cd.data[i + 2] = lerp(o.light[2], o.dark[2], t);
      cd.data[i + 3] = 255;

      const hv = clamp(0.55 - ring * 0.16 - poreMask * 0.42, 0, 1) * 255;
      hd.data[i] = hd.data[i + 1] = hd.data[i + 2] = hv; hd.data[i + 3] = 255;

      // late wood (dark ring) is denser -> a little smoother; pores are rough
      const rv = clamp(0.86 - ring * 0.13 + poreMask * 0.14, 0, 1) * 255;
      rd.data[i] = rd.data[i + 1] = rd.data[i + 2] = rv; rd.data[i + 3] = 255;
    }
  }
  col.getContext('2d')!.putImageData(cd, 0, 0);
  hgt.getContext('2d')!.putImageData(hd, 0, 0);
  rgh.getContext('2d')!.putImageData(rd, 0, 0);

  return {
    map: aniso(toTexture(col, true)),
    rough: aniso(toTexture(rgh, false)),
    normal: normalFromHeight(hgt, 1.3),
  };
}

/**
 * Wood as it comes off a lathe: the grain still runs vertically through the
 * turning, but the tool leaves fine rings around it. U wraps the turning,
 * V climbs it, so rings must be horizontal bands in texture space.
 */
export function makeTurnedWood(o: WoodOpts & { toolMarks?: number }): WoodSet {
  const S = o.size ?? 512;
  const marks = o.toolMarks ?? 150;
  const col = canvas(S), hgt = canvas(S), rgh = canvas(S);
  const cw = col.width, ch = col.height;
  const cd = col.getContext('2d')!.createImageData(cw, ch);
  const hd = hgt.getContext('2d')!.createImageData(cw, ch);
  const rd = rgh.getContext('2d')!.createImageData(cw, ch);
  const seed = o.seed ?? 21;

  for (let y = 0; y < ch; y++) {
    const v = y / ch;
    // lathe rings: a dense, slightly irregular horizontal ripple
    const ringPhase = v * marks * Math.PI * 2 + fbm2(0, v * 8, 2, seed + 5) * 3.2;
    const tool = (Math.sin(ringPhase) * 0.5 + 0.5) ** 2;
    for (let x = 0; x < cw; x++) {
      const u = x / cw;
      // grain runs up the blank -> stretched along V, banded along U
      let g = u * o.grainScaleX + fbm2(u * 2.4, v * o.grainScaleY * 0.28, 3, seed) * 0.55;
      let ring = Math.sin(g * o.ringDensity * Math.PI * 2) * 0.5 + 0.5;
      ring = Math.pow(ring, 2.1);
      const pore = valueNoise2(u * 300, v * 300 * 0.3, 77);
      const poreMask = pore > 0.78 ? (pore - 0.78) * 3.2 : 0;
      let t = clamp(ring * 0.50 + poreMask * 0.30 + tool * 0.12, 0, 1);
      t = clamp(t * 0.84 + fbm2(u * 2.0, v * 2.0, 3, 404) * 0.18, 0, 1);

      const i = (y * cw + x) * 4;
      cd.data[i] = lerp(o.light[0], o.dark[0], t);
      cd.data[i + 1] = lerp(o.light[1], o.dark[1], t);
      cd.data[i + 2] = lerp(o.light[2], o.dark[2], t);
      cd.data[i + 3] = 255;

      const hv = clamp(0.55 - tool * 0.34 - poreMask * 0.4, 0, 1) * 255;
      hd.data[i] = hd.data[i + 1] = hd.data[i + 2] = hv; hd.data[i + 3] = 255;
      const rv = clamp(0.8 - ring * 0.12 + tool * 0.1 + poreMask * 0.14, 0, 1) * 255;
      rd.data[i] = rd.data[i + 1] = rd.data[i + 2] = rv; rd.data[i + 3] = 255;
    }
  }
  col.getContext('2d')!.putImageData(cd, 0, 0);
  hgt.getContext('2d')!.putImageData(hd, 0, 0);
  rgh.getContext('2d')!.putImageData(rd, 0, 0);
  return {
    map: aniso(toTexture(col, true)),
    rough: aniso(toTexture(rgh, false)),
    normal: normalFromHeight(hgt, 1.05),
  };
}

/** End grain: concentric rings, for sawn faces and shaving ends. */
export function makeEndGrain(o: WoodOpts): WoodSet {
  const S = o.size ?? 256;
  const col = canvas(S), hgt = canvas(S);
  const cw = col.width, ch = col.height;
  const cd = col.getContext('2d')!.createImageData(cw, ch);
  const hd = hgt.getContext('2d')!.createImageData(cw, ch);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const u = x / cw - 0.5, v = y / ch - 0.5;
      const r = Math.hypot(u, v) + fbm2(u * 6 + 3, v * 6 + 3, 3, 12) * 0.06;
      let ring = Math.sin(r * o.ringDensity * Math.PI * 2 * 6) * 0.5 + 0.5;
      ring = Math.pow(ring, 1.8);
      const t = clamp(ring * 0.55 + 0.12, 0, 1);
      const i = (y * cw + x) * 4;
      cd.data[i] = lerp(o.light[0], o.dark[0], t);
      cd.data[i + 1] = lerp(o.light[1], o.dark[1], t);
      cd.data[i + 2] = lerp(o.light[2], o.dark[2], t);
      cd.data[i + 3] = 255;
      const hv = clamp(0.5 - ring * 0.3, 0, 1) * 255;
      hd.data[i] = hd.data[i + 1] = hd.data[i + 2] = hv; hd.data[i + 3] = 255;
    }
  }
  col.getContext('2d')!.putImageData(cd, 0, 0);
  hgt.getContext('2d')!.putImageData(hd, 0, 0);
  return { map: aniso(toTexture(col, true)), rough: aniso(toTexture(hgt, false)),
           normal: normalFromHeight(hgt, 0.9) };
}

/* ---------------- hand paint ---------------- */

/**
 * Matte hand paint over wood. `wearBand` is where fingers actually touch
 * (in V), so the wear is not symmetric decoration: it follows the grip.
 */
export function makePaint(
  rgb: [number, number, number],
  under: [number, number, number],
  wearBand: [number, number],
  seed = 3,
): { map: THREE.Texture; rough: THREE.Texture } {
  const S = 256;
  const col = canvas(S), rgh = canvas(S);
  const cw = col.width, ch = col.height;
  const cd = col.getContext('2d')!.createImageData(cw, ch);
  const rd = rgh.getContext('2d')!.createImageData(cw, ch);
  for (let y = 0; y < ch; y++) {
    const v = y / ch;
    const inBand = v > wearBand[0] && v < wearBand[1]
      ? 1 - Math.abs((v - (wearBand[0] + wearBand[1]) / 2) / ((wearBand[1] - wearBand[0]) / 2))
      : 0;
    for (let x = 0; x < cw; x++) {
      const u = x / cw;
      // brush streaks follow the turning, thin coverage lets the wood show
      const brush = fbm2(u * 26, v * 3.4, 3, seed) * 0.5 + 0.5;
      const wear = clamp((fbm2(u * 9, v * 9, 3, seed + 40) - 0.42) * 3.4, 0, 1) * inBand;
      const coverage = clamp(1 - wear * 0.85 - (brush - 0.5) * 0.16, 0, 1);
      const i = (y * cw + x) * 4;
      cd.data[i] = lerp(under[0], rgb[0], coverage);
      cd.data[i + 1] = lerp(under[1], rgb[1], coverage);
      cd.data[i + 2] = lerp(under[2], rgb[2], coverage);
      cd.data[i + 3] = 255;
      // handled paint burnishes to a low sheen exactly where it wore
      const rv = clamp(0.82 - inBand * 0.3 - wear * 0.1 + (brush - 0.5) * 0.1, 0.24, 1) * 255;
      rd.data[i] = rd.data[i + 1] = rd.data[i + 2] = rv; rd.data[i + 3] = 255;
    }
  }
  col.getContext('2d')!.putImageData(cd, 0, 0);
  rgh.getContext('2d')!.putImageData(rd, 0, 0);
  return { map: aniso(toTexture(col, true)), rough: aniso(toTexture(rgh, false)) };
}

/* ---------------- brass ---------------- */

/**
 * Brass roughness: bright drawn streaks where it is wiped, cloudy dull
 * patches of oxide elsewhere.  Metalness stays 1 - it is the roughness
 * variation, not a gold colour, that stops it reading as plastic.
 */
export function makeBrass(seed = 5, oxide = 0.55): { rough: THREE.Texture; map: THREE.Texture } {
  const S = 256;
  const rgh = canvas(S), col = canvas(S);
  const cw = rgh.width, ch = rgh.height;
  const rd = rgh.getContext('2d')!.createImageData(cw, ch);
  const cd = col.getContext('2d')!.createImageData(cw, ch);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const u = x / cw, v = y / ch;
      const streak = fbm2(u * 190, v * 3.0, 3, seed) * 0.5 + 0.5;
      const patch = fbm2(u * 4.2, v * 4.2, 4, seed + 17);
      const tarnish = clamp((patch - 0.46) * 3.0, 0, 1) * oxide;
      const r = clamp(0.13 + streak * 0.16 + tarnish * 0.55, 0.06, 0.95);
      const i = (y * cw + x) * 4;
      rd.data[i] = rd.data[i + 1] = rd.data[i + 2] = r * 255; rd.data[i + 3] = 255;
      // oxide shifts hue toward brown-green, never a flat gold
      cd.data[i] = lerp(232, 150, tarnish);
      cd.data[i + 1] = lerp(196, 132, tarnish);
      cd.data[i + 2] = lerp(126, 96, tarnish);
      cd.data[i + 3] = 255;
    }
  }
  rgh.getContext('2d')!.putImageData(rd, 0, 0);
  col.getContext('2d')!.putImageData(cd, 0, 0);
  return { rough: aniso(toTexture(rgh, false)), map: aniso(toTexture(col, true)) };
}

/** Worn tool steel: scratched, slightly pitted, never mirror. */
export function makeSteel(seed = 9): { rough: THREE.Texture } {
  const S = 256;
  const rgh = canvas(S);
  const cw = rgh.width, ch = rgh.height;
  const rd = rgh.getContext('2d')!.createImageData(cw, ch);
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) {
      const u = x / cw, v = y / ch;
      const scratch = fbm2(u * 240, v * 2.0, 2, seed) * 0.5 + 0.5;
      const pit = clamp((valueNoise2(u * 90, v * 90, seed + 3) - 0.72) * 4, 0, 1);
      const r = clamp(0.3 + scratch * 0.22 + pit * 0.4, 0.12, 0.95);
      const i = (y * cw + x) * 4;
      rd.data[i] = rd.data[i + 1] = rd.data[i + 2] = r * 255; rd.data[i + 3] = 255;
    }
  rgh.getContext('2d')!.putImageData(rd, 0, 0);
  return { rough: aniso(toTexture(rgh, false)) };
}

/* ---------------- room surfaces ---------------- */

export function makePlaster(tint: [number, number, number], seed = 31) {
  const S = 256;
  const col = canvas(S), hgt = canvas(S);
  const cw = col.width, ch = col.height;
  const cd = col.getContext('2d')!.createImageData(cw, ch);
  const hd = hgt.getContext('2d')!.createImageData(cw, ch);
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) {
      const u = x / cw, v = y / ch;
      const n = fbm2(u * 9, v * 9, 4, seed);
      const fine = valueNoise2(u * 130, v * 130, seed + 2);
      const t = clamp(n * 0.7 + fine * 0.3, 0, 1);
      const i = (y * cw + x) * 4;
      cd.data[i] = tint[0] * (0.82 + t * 0.3);
      cd.data[i + 1] = tint[1] * (0.82 + t * 0.3);
      cd.data[i + 2] = tint[2] * (0.82 + t * 0.3);
      cd.data[i + 3] = 255;
      hd.data[i] = hd.data[i + 1] = hd.data[i + 2] = t * 255; hd.data[i + 3] = 255;
    }
  col.getContext('2d')!.putImageData(cd, 0, 0);
  hgt.getContext('2d')!.putImageData(hd, 0, 0);
  return { map: aniso(toTexture(col, true)), normal: normalFromHeight(hgt, 0.5) };
}

/** Frost on cold glass: crystals crowd the edges of the pane. */
export function makeFrost(): { alpha: THREE.Texture; normal: THREE.Texture } {
  const S = 512;
  const a = canvas(S), h = canvas(S);
  const cw = a.width, ch = a.height;
  const ad = a.getContext('2d')!.createImageData(cw, ch);
  const hd = h.getContext('2d')!.createImageData(cw, ch);
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) {
      const u = x / cw, v = y / ch;
      // frost creeps in from the cold edges of the pane as fine ferns,
      // and the middle stays clear enough to see the village through
      const edge = clamp(1 - Math.min(u, 1 - u, v, 1 - v) * 15.0, 0, 1);
      const fern = Math.abs(fbm2(u * 26, v * 26, 5, 61) - 0.5) * 2;
      const fine = Math.abs(fbm2(u * 60, v * 60, 3, 91) - 0.5) * 2;
      const crystal = clamp((1 - fern) * 1.35 - 0.72, 0, 1)
                    + clamp((1 - fine) * 1.1 - 0.68, 0, 1) * 0.5;
      const t = clamp(crystal * Math.pow(edge, 3.0) * 1.0, 0, 1);
      const i = (y * cw + x) * 4;
      ad.data[i] = ad.data[i + 1] = ad.data[i + 2] = 255;
      ad.data[i + 3] = t * 120;
      hd.data[i] = hd.data[i + 1] = hd.data[i + 2] = t * 255; hd.data[i + 3] = 255;
    }
  a.getContext('2d')!.putImageData(ad, 0, 0);
  h.getContext('2d')!.putImageData(hd, 0, 0);
  return { alpha: aniso(toTexture(a, true)), normal: normalFromHeight(h, 1.4) };
}

/* ---------------- particles ---------------- */

/** Soft smoke puff: a broken, off-centre blob so no two sprites tile. */
export function makeSmokeSprite(): THREE.Texture {
  const S = 128;
  const c = canvas(S);
  const cw = c.width, ch = c.height;
  const d = c.getContext('2d')!.createImageData(cw, ch);
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) {
      const u = x / cw - 0.5, v = y / ch - 0.5;
      const r = Math.hypot(u, v) * 2;
      const n = fbm2(x / cw * 5.5, y / ch * 5.5, 4, 88);
      let a = clamp(1 - r, 0, 1);
      a = Math.pow(a, 1.35) * (0.55 + n * 0.75);
      a = clamp(a, 0, 1);
      const i = (y * cw + x) * 4;
      d.data[i] = d.data[i + 1] = d.data[i + 2] = 255;
      d.data[i + 3] = a * 255;
    }
  c.getContext('2d')!.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Round soft dot for dust motes and snow. */
export function makeDotSprite(hardness = 0.35): THREE.Texture {
  const S = 64;
  const c = canvas(S);
  const cw = c.width, ch = c.height;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(cw / 2, ch / 2, 0, cw / 2, ch / 2, cw / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(hardness, 'rgba(255,255,255,0.82)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, cw, ch);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Soft contact-shadow blob so nothing floats above the bench. */
export function makeContactShadow(): THREE.Texture {
  const S = 128;
  const c = canvas(S);
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(c.width / 2, c.height / 2, 0, c.width / 2, c.height / 2, c.width / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.72)');
  g.addColorStop(0.45, 'rgba(0,0,0,0.34)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, c.width, c.height);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Soot: gathers on one side, above the flame, never as a symmetric ring. */
export function makeSoot(): THREE.Texture {
  const S = 128;
  const c = canvas(S);
  const cw = c.width, ch = c.height;
  const d = c.getContext('2d')!.createImageData(cw, ch);
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) {
      const u = x / cw, v = y / ch;
      const n = fbm2(u * 6, v * 6, 4, 133);
      const up = clamp(1 - v * 1.7, 0, 1);
      const lean = clamp(0.35 + Math.sin(u * Math.PI * 2 + 0.9) * 0.5, 0, 1);
      const a = clamp(n * up * lean * 1.9 - 0.16, 0, 1);
      const i = (y * cw + x) * 4;
      d.data[i] = d.data[i + 1] = d.data[i + 2] = 14;
      d.data[i + 3] = a * 255;
    }
  c.getContext('2d')!.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
