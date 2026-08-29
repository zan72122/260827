import * as THREE from 'three';
import { Noise, clamp01, mix, smoothstep } from '../util/noise';
import { Rng } from '../util/rng';

type RGB = [number, number, number];

function canvasOf(size: number): { c: HTMLCanvasElement; d: ImageData } {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  return { c, d: ctx.createImageData(size, size) };
}

function commit(c: HTMLCanvasElement, d: ImageData): HTMLCanvasElement {
  c.getContext('2d')!.putImageData(d, 0, 0);
  return c;
}

function texFromCanvas(c: HTMLCanvasElement, srgb: boolean, repeat = 1): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Colour texture from a per-texel callback. */
function colorTex(size: number, fn: (u: number, v: number) => RGB, repeat = 1): THREE.CanvasTexture {
  const { c, d } = canvasOf(size);
  const px = d.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const rgb = fn(x / size, y / size);
      const i = (y * size + x) * 4;
      px[i] = clamp01(rgb[0]) * 255;
      px[i + 1] = clamp01(rgb[1]) * 255;
      px[i + 2] = clamp01(rgb[2]) * 255;
      px[i + 3] = 255;
    }
  }
  return texFromCanvas(commit(c, d), true, repeat);
}

/** Single-channel data texture (roughness / AO / metalness masks). */
function dataTex(size: number, fn: (u: number, v: number) => number, repeat = 1): THREE.CanvasTexture {
  const { c, d } = canvasOf(size);
  const px = d.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = clamp01(fn(x / size, y / size)) * 255;
      const i = (y * size + x) * 4;
      px[i] = px[i + 1] = px[i + 2] = v;
      px[i + 3] = 255;
    }
  }
  return texFromCanvas(commit(c, d), false, repeat);
}

/** Tangent-space normal map derived from a tiling height field. */
function normalTex(size: number, h: (u: number, v: number) => number, strength = 1, repeat = 1): THREE.CanvasTexture {
  const field = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) field[y * size + x] = h(x / size, y / size);
  const at = (x: number, y: number) => field[(((y % size) + size) % size) * size + (((x % size) + size) % size)];
  const { c, d } = canvasOf(size);
  const px = d.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength * size * 0.02;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength * size * 0.02;
      const len = Math.sqrt(dx * dx + dy * dy + 1);
      const i = (y * size + x) * 4;
      px[i] = (-dx / len * 0.5 + 0.5) * 255;
      px[i + 1] = (-dy / len * 0.5 + 0.5) * 255;
      px[i + 2] = (1 / len * 0.5 + 0.5) * 255;
      px[i + 3] = 255;
    }
  }
  return texFromCanvas(commit(c, d), false, repeat);
}

export interface TextureSet {
  spongeCutColor: THREE.Texture;
  spongeCutRough: THREE.Texture;
  spongeCutNormal: THREE.Texture;
  spongeCutAO: THREE.Texture;
  spongeBakeColor: THREE.Texture;
  spongeBakeNormal: THREE.Texture;
  spongeBakeRough: THREE.Texture;
  creamColor: THREE.Texture;
  creamRough: THREE.Texture;
  creamNormal: THREE.Texture;
  creamCutColor: THREE.Texture;
  creamCutNormal: THREE.Texture;
  berrySkinColor: THREE.Texture;
  berrySkinNormal: THREE.Texture;
  berrySkinRough: THREE.Texture;
  metalNormal: THREE.Texture;
  metalRough: THREE.Texture;
  benchColor: THREE.Texture;
  benchRough: THREE.Texture;
  benchNormal: THREE.Texture;
  boardColor: THREE.Texture;
  boardNormal: THREE.Texture;
  wallColor: THREE.Texture;
}

const yieldFrame = () => new Promise<void>((r) => setTimeout(r, 0));

export async function buildTextures(onStep: (done: number, total: number) => void): Promise<TextureSet> {
  const n = new Noise(1337);
  const n2 = new Noise(90210);
  const total = 12;
  let step = 0;
  const tick = async () => {
    onStep(++step, total);
    await yieldFrame();
  };

  /* ---------- sponge, cut face: irregular open crumb ---------- */
  const poreField = (u: number, v: number) => {
    // Domain warp so the cells never read as a regular dot grid.
    const wu = u + n.fbm(u * 6, v * 6, 6, 3) * 0.12;
    const wv = v + n2.fbm(u * 6 + 3, v * 6 + 5, 6, 3) * 0.12;
    const big = n.cell(wu, wv, 9);
    const small = n2.cell(wu * 1.0 + 0.31, wv * 1.0 + 0.77, 22);
    // Each cell gets its own pore radius -> strongly varied hole sizes.
    const rBig = 0.13 + 0.24 * ((Math.sin(big.id * 12.9898) * 43758.5453) % 1 + 1) * 0.5;
    const rSml = 0.10 + 0.22 * ((Math.sin(small.id * 78.233) * 12345.6789) % 1 + 1) * 0.5;
    const a = smoothstep(rBig, rBig * 0.35, big.f1);
    const b = smoothstep(rSml, rSml * 0.4, small.f1) * 0.7;
    return clamp01(Math.max(a, b));
  };
  const spongeCutH = (u: number, v: number) => {
    const p = poreField(u, v);
    const grain = n.fbm(u * 30, v * 30, 30, 3) * 0.12;
    return 1 - p * 0.72 + grain;
  };
  const cutColor = colorTex(512, (u, v) => {
    const p = poreField(u, v);
    const grain = n.fbm(u * 26, v * 26, 26, 4) * 0.5 + 0.5;
    const crumbSpeck = smoothstep(0.72, 0.92, n2.fbm(u * 60, v * 60, 60, 2) * 0.5 + 0.5);
    let base: RGB = [0.965, 0.892, 0.717];
    base = [
      base[0] * mix(0.94, 1.04, grain),
      base[1] * mix(0.93, 1.03, grain),
      base[2] * mix(0.9, 1.05, grain),
    ];
    const inPore: RGB = [0.855, 0.762, 0.567];
    const col: RGB = [mix(base[0], inPore[0], p), mix(base[1], inPore[1], p), mix(base[2], inPore[2], p)];
    return [
      col[0] + crumbSpeck * 0.04,
      col[1] + crumbSpeck * 0.035,
      col[2] + crumbSpeck * 0.02,
    ];
  }, 1);
  await tick();
  const cutRough = dataTex(256, (u, v) => 0.86 + poreField(u, v) * 0.1 + n.fbm(u * 20, v * 20, 20, 2) * 0.06);
  const cutNormal = normalTex(512, spongeCutH, 1.5);
  const cutAO = dataTex(256, (u, v) => 1 - poreField(u, v) * 0.42);
  await tick();

  /* ---------- sponge, baked surface: browned skin, no open crumb ---------- */
  const bakeH = (u: number, v: number) => n.fbm(u * 14, v * 14, 14, 4) * 0.5 + 0.5;
  const bakeColor = colorTex(256, (u, v) => {
    const f = n.fbm(u * 9, v * 9, 9, 4) * 0.5 + 0.5;
    const blotch = smoothstep(0.45, 0.85, n2.fbm(u * 4, v * 4, 4, 3) * 0.5 + 0.5);
    const base: RGB = [0.79, 0.585, 0.335];
    const dark: RGB = [0.6, 0.4, 0.208];
    return [mix(base[0], dark[0], blotch * 0.75) * mix(0.92, 1.06, f),
            mix(base[1], dark[1], blotch * 0.75) * mix(0.92, 1.06, f),
            mix(base[2], dark[2], blotch * 0.75) * mix(0.9, 1.08, f)];
  });
  const bakeNormal = normalTex(256, bakeH, 0.7);
  const bakeRough = dataTex(256, (u, v) => 0.7 + (n.fbm(u * 12, v * 12, 12, 3) * 0.5 + 0.5) * 0.2);
  await tick();

  /* ---------- whipped cream: warm off-white, uneven sheen ---------- */
  const creamH = (u: number, v: number) => {
    const soft = n.fbm(u * 7, v * 7, 7, 4) * 0.5 + 0.5;
    const fine = n2.fbm(u * 34, v * 34, 34, 2) * 0.5 + 0.5;
    return soft * 0.75 + fine * 0.25;
  };
  const creamColor = colorTex(256, (u, v) => {
    const f = creamH(u, v);
    // Not pure white: a milk-fat warmth that keeps it off plaster/toothpaste.
    return [mix(0.905, 0.962, f), mix(0.874, 0.933, f), mix(0.808, 0.872, f)];
  });
  const creamRough = dataTex(256, (u, v) => {
    const f = creamH(u, v);
    const patch = n2.fbm(u * 5 + 2, v * 5 + 9, 5, 3) * 0.5 + 0.5;
    // Varied, never uniform: freshly smoothed patches read glossier.
    return 0.33 + patch * 0.28 + f * 0.14;
  });
  const creamNormal = normalTex(256, creamH, 0.55);
  await tick();

  /* ---------- cream, cut face: knife drag striations along u ---------- */
  const creamCutH = (u: number, v: number) => {
    const drag = Math.sin((v * 11 + n.fbm(u * 3, v * 7, 7, 2) * 5) * Math.PI) * 0.5 + 0.5;
    const streak = smoothstep(0.45, 1, drag) * (0.35 + 0.65 * (n2.fbm(u * 4, v * 9, 9, 2) * 0.5 + 0.5));
    return 0.78 + streak * 0.22 + n.fbm(u * 22, v * 22, 22, 2) * 0.06;
  };
  const creamCutColor = colorTex(256, (u, v) => {
    const s = creamCutH(u, v);
    return [mix(0.9, 0.958, s), mix(0.868, 0.929, s), mix(0.802, 0.868, s)];
  });
  const creamCutNormal = normalTex(256, creamCutH, 0.28);
  await tick();

  /* ---------- strawberry skin: achene dents with varying density ---------- */
  const acheneRng = new Rng(4242);
  const achenes: { u: number; v: number; r: number; ang: number; deep: number }[] = [];
  for (let i = 0; i < 260; i++) {
    achenes.push({
      u: acheneRng.next(),
      v: acheneRng.next(),
      r: acheneRng.range(0.008, 0.019),
      ang: acheneRng.range(0, Math.PI),
      deep: acheneRng.range(0.4, 1),
    });
  }
  const acheneAt = (u: number, v: number) => {
    let best = 0;
    let ang = 0;
    for (const a of achenes) {
      // Density rises toward the shoulder (v small) as on a real berry.
      const densityGate = smoothstep(0.05, 0.55, 1 - Math.abs(a.v - 0.42) * 1.4);
      if (densityGate < 0.15) continue;
      let du = u - a.u;
      du -= Math.round(du);
      const dv = v - a.v;
      const ca = Math.cos(a.ang);
      const sa = Math.sin(a.ang);
      const ex = (du * ca + dv * sa) / (a.r * 1.35);
      const ey = (-du * sa + dv * ca) / a.r;
      const d = Math.sqrt(ex * ex + ey * ey);
      const val = smoothstep(1, 0.15, d) * a.deep * densityGate;
      if (val > best) {
        best = val;
        ang = a.ang;
      }
    }
    return { val: best, ang };
  };
  const berryColor = colorTex(512, (u, v) => {
    const a = acheneAt(u, v);
    const mottle = n.fbm(u * 10, v * 10, 10, 4) * 0.5 + 0.5;
    const ripe = smoothstep(0.0, 0.85, v);
    let r = mix(0.74, 0.86, mottle) * mix(0.86, 1.0, ripe);
    let g = mix(0.075, 0.14, mottle) * mix(1.5, 0.85, ripe);
    let b = mix(0.085, 0.13, mottle) * mix(1.2, 0.9, ripe);
    // Seed itself is a pale straw dot sitting inside its dent.
    r = mix(r, 0.86, a.val * 0.75);
    g = mix(g, 0.7, a.val * 0.8);
    b = mix(b, 0.36, a.val * 0.8);
    return [r, g, b];
  });
  const berryNormal = normalTex(512, (u, v) => {
    const a = acheneAt(u, v);
    return 1 - a.val * 0.55 + n2.fbm(u * 40, v * 40, 40, 2) * 0.05;
  }, 1.5);
  const berryRough = dataTex(256, (u, v) => {
    const a = acheneAt(u, v);
    return 0.24 + a.val * 0.35 + (n.fbm(u * 14, v * 14, 14, 3) * 0.5 + 0.5) * 0.14;
  });
  await tick();

  /* ---------- stainless: directional grind + use scuffs ---------- */
  const metalH = (u: number, v: number) => {
    const grind = n.fbm(u * 220, v * 3, 220, 2) * 0.5 + 0.5;
    const scuff = smoothstep(0.86, 1, n2.fbm(u * 70, v * 8, 70, 3) * 0.5 + 0.5);
    return grind * 0.55 + scuff * 0.45;
  };
  const metalNormal = normalTex(512, metalH, 0.35);
  const metalRough = dataTex(512, (u, v) => {
    const grind = n.fbm(u * 220, v * 3, 220, 2) * 0.5 + 0.5;
    const scuff = smoothstep(0.8, 1, n2.fbm(u * 70, v * 8, 70, 3) * 0.5 + 0.5);
    // Working part of the blade is scratched dull; the spine stays brighter.
    return 0.14 + grind * 0.1 + scuff * 0.3 + smoothstep(0.2, 0.95, v) * 0.1;
  });
  await tick();

  /* ---------- stainless bench: fine scratches, asymmetric wear ---------- */
  const benchH = (u: number, v: number) => {
    const brush = n.fbm(u * 180, v * 4, 180, 2) * 0.5 + 0.5;
    // Wear concentrated where a right-handed pâtissier works, never mirrored.
    const wearZone = smoothstep(0.85, 0.2, Math.hypot(u - 0.62, v - 0.44) * 1.6);
    const scratches = smoothstep(0.72, 1, n2.fbm(u * 40 + v * 9, v * 6, 40, 3) * 0.5 + 0.5);
    return brush * 0.5 + scratches * wearZone * 0.5;
  };
  const benchColor = colorTex(512, (u, v) => {
    const h = benchH(u, v);
    const g = mix(0.30, 0.42, h);
    return [g * 1.02, g, g * 0.975];
  });
  const benchNormal = normalTex(512, benchH, 0.4);
  const benchRough = dataTex(512, (u, v) => 0.28 + benchH(u, v) * 0.22 + n.fbm(u * 9, v * 9, 9, 2) * 0.06);
  await tick();

  /* ---------- cake board: matte laminated card ---------- */
  const boardH = (u: number, v: number) => n.fbm(u * 60, v * 60, 60, 3) * 0.5 + 0.5;
  const boardColor = colorTex(256, (u, v) => {
    const h = boardH(u, v);
    const g = mix(0.86, 0.93, h);
    return [g, g * 0.985, g * 0.955];
  });
  const boardNormal = normalTex(256, boardH, 0.35);
  await tick();

  /* ---------- back wall tiling ---------- */
  const wallColor = colorTex(256, (u, v) => {
    const gu = smoothstep(0.0, 0.03, Math.min(u % 0.25, 0.25 - (u % 0.25)) / 0.25 * 4);
    const gv = smoothstep(0.0, 0.03, Math.min(v % 0.5, 0.5 - (v % 0.5)) / 0.5 * 4);
    const grout = Math.min(gu, gv);
    const stain = n.fbm(u * 5, v * 5, 5, 3) * 0.5 + 0.5;
    const base = mix(0.62, 0.74, stain);
    return [mix(0.5, base, grout), mix(0.49, base * 0.99, grout), mix(0.47, base * 0.965, grout)];
  }, 1);
  await tick();

  return {
    spongeCutColor: cutColor,
    spongeCutRough: cutRough,
    spongeCutNormal: cutNormal,
    spongeCutAO: cutAO,
    spongeBakeColor: bakeColor,
    spongeBakeNormal: bakeNormal,
    spongeBakeRough: bakeRough,
    creamColor,
    creamRough,
    creamNormal,
    creamCutColor,
    creamCutNormal,
    berrySkinColor: berryColor,
    berrySkinNormal: berryNormal,
    berrySkinRough: berryRough,
    metalNormal,
    metalRough,
    benchColor,
    benchRough,
    benchNormal,
    boardColor,
    boardNormal,
    wallColor,
  };
}
