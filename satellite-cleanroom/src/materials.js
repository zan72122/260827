import * as THREE from 'three';

function seededNoise(x, y, seed = 1) {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
  return n - Math.floor(n);
}

function textureFromPixels(size, painter, { colorSpace = THREE.NoColorSpace } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { alpha: false });
  const image = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const value = painter(x / size, y / size, x, y);
      const i = (y * size + x) * 4;
      const rgb = Array.isArray(value) ? value : [value, value, value];
      image.data[i] = rgb[0]; image.data[i + 1] = rgb[1]; image.data[i + 2] = rgb[2]; image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = colorSpace;
  texture.needsUpdate = true;
  return texture;
}

export function createHeroMaterials() {
  const micro = textureFromPixels(64, (u, v, x, y) => {
    const brushed = 0.58 + Math.sin((v * 38 + seededNoise(x, y, 4) * 1.4) * Math.PI) * 0.08;
    return Math.round(255 * brushed);
  });
  micro.repeat.set(6, 6);

  const crinkle = textureFromPixels(128, (u, v, x, y) => {
    const a = Math.sin((u * 13.3 + Math.sin(v * 7.1)) * Math.PI * 2);
    const b = Math.sin((v * 19.7 + Math.cos(u * 5.3)) * Math.PI * 2);
    const c = seededNoise(x >> 2, y >> 2, 9) * 2 - 1;
    return Math.round(128 + a * 25 + b * 18 + c * 16);
  });
  crinkle.repeat.set(3, 3);

  const cellLines = document.createElement('canvas');
  cellLines.width = 128; cellLines.height = 128;
  const cctx = cellLines.getContext('2d');
  const gradient = cctx.createLinearGradient(0, 0, 128, 128);
  gradient.addColorStop(0, '#071728'); gradient.addColorStop(.48, '#123b62'); gradient.addColorStop(1, '#06121f');
  cctx.fillStyle = gradient; cctx.fillRect(0, 0, 128, 128);
  cctx.strokeStyle = 'rgba(94,151,188,.55)'; cctx.lineWidth = 2;
  for (let x = 0; x <= 128; x += 32) { cctx.beginPath(); cctx.moveTo(x, 0); cctx.lineTo(x, 128); cctx.stroke(); }
  cctx.strokeStyle = 'rgba(210,228,240,.3)'; cctx.lineWidth = 1;
  for (let y = 0; y <= 128; y += 16) { cctx.beginPath(); cctx.moveTo(0, y); cctx.lineTo(128, y); cctx.stroke(); }
  const cellMap = new THREE.CanvasTexture(cellLines); cellMap.colorSpace = THREE.SRGBColorSpace;

  return {
    floor: new THREE.MeshStandardMaterial({ color: 0xdde7e9, roughness: .72, metalness: .04 }),
    wall: new THREE.MeshStandardMaterial({ color: 0xf2f7f7, roughness: .66, metalness: .05 }),
    aluminium: new THREE.MeshPhysicalMaterial({
      color: 0xe9eff0, roughness: .39, metalness: .24, clearcoat: .16, clearcoatRoughness: .62,
      bumpMap: micro, bumpScale: .018,
    }),
    aluminiumDark: new THREE.MeshStandardMaterial({ color: 0x53636b, roughness: .4, metalness: .62 }),
    rail: new THREE.MeshStandardMaterial({ color: 0x84979e, roughness: .35, metalness: .72 }),
    blackRadiator: new THREE.MeshStandardMaterial({ color: 0x10191c, roughness: .78, metalness: .12 }),
    mli: new THREE.MeshStandardMaterial({
      color: 0xd0a236, roughness: .36, metalness: .72, bumpMap: crinkle, bumpScale: .095,
      side: THREE.DoubleSide,
    }),
    mliBack: new THREE.MeshStandardMaterial({ color: 0x8c7135, roughness: .66, metalness: .38 }),
    solarCell: new THREE.MeshStandardMaterial({
      color: 0x0a2035, map: cellMap, roughness: .24, metalness: .58,
    }),
    solarFrame: new THREE.MeshStandardMaterial({ color: 0xb6c0c3, roughness: .34, metalness: .74 }),
    suit: new THREE.MeshStandardMaterial({ color: 0xf7fbfb, roughness: .86, metalness: 0 }),
    suitShade: new THREE.MeshStandardMaterial({ color: 0xd6e4e8, roughness: .8, metalness: .02 }),
    visor: new THREE.MeshPhysicalMaterial({ color: 0x6eb3cc, roughness: .28, metalness: .08, transparent: true, opacity: .76 }),
    cyanGlow: new THREE.MeshStandardMaterial({ color: 0x43b9da, emissive: 0x1a9dca, emissiveIntensity: 1.45, roughness: .36 }),
    greenGlow: new THREE.MeshStandardMaterial({ color: 0x5fe28c, emissive: 0x24c861, emissiveIntensity: 1.3, roughness: .35 }),
    amberGlow: new THREE.MeshStandardMaterial({ color: 0xffc84c, emissive: 0xdc8f13, emissiveIntensity: 1.1, roughness: .4 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0xccecf5, roughness: .12, metalness: 0, transparent: true, opacity: .28, depthWrite: false }),
    cableBlue: new THREE.MeshStandardMaterial({ color: 0x2f88dc, roughness: .45 }),
    cableOrange: new THREE.MeshStandardMaterial({ color: 0xef8c32, roughness: .47 }),
    cableGreen: new THREE.MeshStandardMaterial({ color: 0x42b981, roughness: .47 }),
    earth: new THREE.MeshStandardMaterial({ color: 0x1d78aa, roughness: .78, metalness: .02 }),
    cloud: new THREE.MeshStandardMaterial({ color: 0xf8ffff, roughness: .9, transparent: true, opacity: .9 }),
  };
}

export function makeWrinkledMLIGeometry(width = 2.05, height = 1.55, seed = 1) {
  const geometry = new THREE.PlaneGeometry(width, height, 12, 9);
  const position = geometry.attributes.position;
  const folded = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const u = x / width + .5;
    const v = y / height + .5;
    const edge = Math.sin(u * Math.PI) * Math.sin(v * Math.PI);
    const wrinkle = (
      Math.sin((u * 8.1 + v * 2.3 + seed) * Math.PI * 2) * .018
      + Math.sin((v * 11.7 - u * 1.9 + seed * .37) * Math.PI * 2) * .012
      + (seededNoise(Math.round(u * 15), Math.round(v * 12), seed) - .5) * .022
    ) * (.35 + .65 * edge);
    position.setZ(i, wrinkle);
    const accordion = Math.sin(u * Math.PI * 12) * .055;
    folded[i * 3] = -width * .43 + (u - .5) * width * .13;
    folded[i * 3 + 1] = y * .92;
    folded[i * 3 + 2] = accordion + wrinkle;
  }
  position.needsUpdate = true;
  geometry.morphAttributes.position = [new THREE.Float32BufferAttribute(folded, 3)];
  geometry.computeVertexNormals();
  return geometry;
}

export function makeSoftDiscTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(.35, 'rgba(180,235,255,.78)');
  gradient.addColorStop(1, 'rgba(90,180,220,0)');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
