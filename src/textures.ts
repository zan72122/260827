import * as THREE from 'three';

/**
 * Every texture here is generated procedurally at start-up. They add surface
 * detail only - grain, fibre, wear. No image ever stands in for the shape or
 * the openings of the paper.
 */

function noiseCanvas(size: number, fill: (x: number, y: number) => [number, number, number]) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const [r, g, b] = fill(x, y);
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function hash2(x: number, y: number) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function valueNoise(x: number, y: number, size: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = (a: number, b: number) => hash2((a + size) % size, (b + size) % size);
  const a = w(xi, yi);
  const b = w(xi + 1, yi);
  const c = w(xi, yi + 1);
  const d = w(xi + 1, yi + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

function fbm(x: number, y: number, size: number, octaves: number) {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x * f, y * f, size);
    amp *= 0.5;
    f *= 2;
  }
  return sum;
}

function finish(c: HTMLCanvasElement, repeat: number, srgb: boolean) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Height field -> tangent-space normal map. */
function normalFromHeight(height: (x: number, y: number) => number, size: number, strength: number) {
  return noiseCanvas(size, (x, y) => {
    const dx = (height(x + 1, y) - height(x - 1, y)) * strength;
    const dy = (height(x, y + 1) - height(x, y - 1)) * strength;
    const len = Math.hypot(dx, dy, 1);
    return [
      Math.round(((-dx / len) * 0.5 + 0.5) * 255),
      Math.round(((-dy / len) * 0.5 + 0.5) * 255),
      Math.round((1 / len) * 0.5 * 255 + 127),
    ];
  });
}

export type Textures = {
  paperNormal: THREE.Texture;
  paperRough: THREE.Texture;
  cardNormal: THREE.Texture;
  cardRough: THREE.Texture;
  wood: THREE.Texture;
  woodRough: THREE.Texture;
  woodNormal: THREE.Texture;
};

export function buildTextures(detail: number): Textures {
  const S = detail >= 1 ? 256 : 128;
  const W = detail >= 1 ? 512 : 256;

  // tissue paper: long, faint fibres
  const paperH = (x: number, y: number) =>
    fbm(x * 0.9, y * 0.11, S, 3) * 0.7 + fbm(x * 0.06, y * 0.06, S, 2) * 0.3;
  const paperNormal = finish(normalFromHeight(paperH, S, 30), 11, false);
  const paperRough = finish(
    noiseCanvas(S, (x, y) => {
      const v = 208 + paperH(x, y) * 42;
      return [v, v, v];
    }),
    11,
    false
  );

  // cardboard: coarser, more felted
  const cardH = (x: number, y: number) => fbm(x * 0.22, y * 0.22, S, 4);
  const cardNormal = finish(normalFromHeight(cardH, S, 26), 9, false);
  const cardRough = finish(
    noiseCanvas(S, (x, y) => {
      const v = 218 + cardH(x, y) * 30;
      return [v, v, v];
    }),
    9,
    false
  );

  // beech worktop: grain lines that wander a little
  const woodH = (x: number, y: number) => {
    const warp = fbm(x * 0.012, y * 0.03, W, 3) * 60;
    const rings = Math.sin((y + warp) * 0.10) * 0.5 + 0.5;
    return rings * 0.58 + fbm(x * 0.35, y * 0.08, W, 3) * 0.42;
  };
  const wood = finish(
    noiseCanvas(W, (x, y) => {
      const h = woodH(x, y);
      return [Math.round(158 + h * 38), Math.round(128 + h * 34), Math.round(98 + h * 26)];
    }),
    1,
    true
  );
  const woodRough = finish(
    noiseCanvas(W, (x, y) => {
      const v = 196 + woodH(x, y) * 54;
      return [v, v, v];
    }),
    1,
    false
  );
  const woodNormal = finish(normalFromHeight(woodH, W, 9), 1, false);

  return { paperNormal, paperRough, cardNormal, cardRough, wood, woodRough, woodNormal };
}

/** Same image, different tiling. Cheap: clones share the underlying bitmap. */
export function repeated(tex: THREE.Texture, x: number, y: number): THREE.Texture {
  const t = tex.clone();
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(x, y);
  t.needsUpdate = true;
  return t;
}

export function disposeTextures(t: Textures) {
  Object.values(t).forEach((tex) => tex.dispose());
}
