import * as THREE from 'three';

function fract(x: number) {
  return x - Math.floor(x);
}
function hash2(x: number, y: number) {
  let h = fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453);
  h = fract(h * 1.61803);
  return h;
}
function vnoise2(x: number, y: number) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return a * (1 - ux) * (1 - uy) + b * ux * (1 - uy) + c * (1 - ux) * uy + d * ux * uy;
}

/** Tileable-ish fbm grayscale texture used for bump / roughness variation. */
export function noiseTexture(size = 128, scale = 8, octaves = 4, contrast = 1, stretchY = 1) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let amp = 0.5;
      let f = scale;
      let v = 0;
      for (let o = 0; o < octaves; o++) {
        v += amp * vnoise2((x / size) * f, ((y / size) * f) / stretchY);
        amp *= 0.5;
        f *= 2.02;
      }
      v = Math.pow(THREE.MathUtils.clamp(v, 0, 1), contrast);
      const i = (y * size + x) * 4;
      const c = Math.round(v * 255);
      data[i] = data[i + 1] = data[i + 2] = c;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

/** Soft round gradient used for contact shadows and light pools on snow. */
export function radialTexture(inner = 'rgba(0,0,0,0.55)', outer = 'rgba(0,0,0,0)', size = 128, power = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, inner);
  grd.addColorStop(Math.min(0.85, 0.35 * power), inner.replace(/[\d.]+\)$/, '0.28)'));
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let cached: {
  fine?: THREE.Texture;
  coarse?: THREE.Texture;
  streak?: THREE.Texture;
  sparkle?: THREE.Texture;
  shadow?: THREE.Texture;
  glow?: THREE.Texture;
} = {};

export const tex = {
  get fine() {
    return (cached.fine ??= noiseTexture(128, 22, 4, 1));
  },
  get coarse() {
    return (cached.coarse ??= noiseTexture(128, 6, 4, 1.3));
  },
  get streak() {
    return (cached.streak ??= noiseTexture(128, 10, 3, 1, 9));
  },
  get sparkle() {
    return (cached.sparkle ??= noiseTexture(96, 40, 2, 0.35));
  },
  get shadow() {
    return (cached.shadow ??= radialTexture('rgba(10,18,28,0.6)', 'rgba(10,18,28,0)'));
  },
  get glow() {
    return (cached.glow ??= radialTexture('rgba(255,196,120,0.95)', 'rgba(255,150,60,0)', 160, 0.7));
  },
};

export function snowMaterial(bright = 1) {
  // dry powder: mostly matte, with a scatter of facets that catch the sun
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xdfeaf4).multiplyScalar(bright),
    roughness: 0.92,
    metalness: 0,
    bumpMap: tex.fine,
    bumpScale: 0.35,
    roughnessMap: tex.sparkle,
    envMapIntensity: 0.6,
  });
  m.bumpMap!.repeat.set(6, 6);
  return m;
}

export function woodMaterial(color = 0x6a5442, rough = 0.86) {
  const m = new THREE.MeshStandardMaterial({
    color,
    roughness: rough,
    metalness: 0,
    bumpMap: tex.streak,
    bumpScale: 0.5,
    roughnessMap: tex.streak,
    envMapIntensity: 0.4,
  });
  return m;
}

/** Scuffed galvanised steel for the outer mould. */
export function metalMaterial() {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0x8d979e,
    metalness: 0.82,
    roughness: 0.44,
    roughnessMap: tex.coarse,
    bumpMap: tex.fine,
    bumpScale: 0.12,
    envMapIntensity: 1.0,
  });
  m.roughnessMap!.repeat.set(2, 2);
  return m;
}

/**
 * Scuffed translucent polypropylene for the outer mould. Kept to a single
 * alpha blended layer (depthWrite on, drawn after the ice) so the water level
 * and the freezing front stay readable without stacking transparency.
 */
export function resinMaterial() {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xdbe7ec,
    metalness: 0,
    roughness: 0.34,
    transparent: true,
    opacity: 0.4,
    depthWrite: true,
    side: THREE.DoubleSide,
    clearcoat: 0.45,
    clearcoatRoughness: 0.3,
    roughnessMap: tex.coarse,
    envMapIntensity: 1.0,
  });
  m.roughnessMap!.repeat.set(3, 3);
  return m;
}

/** Food grade polypropylene for the inner mould / pitcher. */
export function plasticMaterial(color = 0xaebcc6, rough = 0.4) {
  return new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0,
    roughness: rough,
    clearcoat: 0.35,
    clearcoatRoughness: 0.4,
    roughnessMap: tex.coarse,
    envMapIntensity: 0.8,
  });
}

export function fabricMaterial(color = 0xb8493c) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.95,
    metalness: 0,
    bumpMap: tex.fine,
    bumpScale: 0.5,
  });
}

export function needleMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0x33533a,
    roughness: 0.72,
    metalness: 0,
    side: THREE.DoubleSide,
  });
}

export function berryMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: 0x9e2420,
    roughness: 0.28,
    metalness: 0,
    clearcoat: 0.7,
    clearcoatRoughness: 0.22,
  });
}

/**
 * Invisible but pickable proxy. Every small prop gets one so a four year old
 * (or a test harness) can grab it with a fat, imprecise touch.
 */
export function pickProxy(radius: number, yOffset = 0) {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 8, 6),
    new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, transparent: true, opacity: 0 })
  );
  m.position.y = yOffset;
  m.renderOrder = -50;
  m.userData.proxy = true;
  return m;
}

/** Small ground-contact shadow decal so objects never look like they float. */
export function contactShadow(radius: number, opacity = 0.28) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 2, radius * 2),
    new THREE.MeshBasicMaterial({
      map: tex.shadow,
      transparent: true,
      opacity,
      depthWrite: false,
      toneMapped: false,
    })
  );
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 2;
  return m;
}
