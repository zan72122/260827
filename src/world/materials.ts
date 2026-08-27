import * as THREE from 'three';

// Shared materials so the deck cable, catenary and seabed cable read as the
// same physical object: dark armored jacket, slight sheen, spiral-wire bump.

let cableBump: THREE.Texture | null = null;

function makeCableBump(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, 64, 64);
  // Diagonal armor-wire lay.
  ctx.strokeStyle = '#a8a8a8';
  ctx.lineWidth = 5;
  for (let i = -2; i < 12; i++) {
    ctx.beginPath();
    ctx.moveTo(i * 8 - 20, 70);
    ctx.lineTo(i * 8 + 20, -6);
    ctx.stroke();
  }
  ctx.strokeStyle = '#5c5c5c';
  ctx.lineWidth = 2;
  for (let i = -2; i < 12; i++) {
    ctx.beginPath();
    ctx.moveTo(i * 8 - 16, 70);
    ctx.lineTo(i * 8 + 24, -6);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 1);
  return tex;
}

export function makeCableMaterial(): THREE.MeshStandardMaterial {
  if (!cableBump) cableBump = makeCableBump();
  return new THREE.MeshStandardMaterial({
    color: 0x181a1d,
    roughness: 0.62,
    metalness: 0.2,
    bumpMap: cableBump,
    bumpScale: 0.6
  });
}

export function makeHazardTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 16;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#e8c31c';
  ctx.fillRect(0, 0, 64, 16);
  ctx.fillStyle = '#1c1c1c';
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.moveTo(i * 16, 16);
    ctx.lineTo(i * 16 + 8, 0);
    ctx.lineTo(i * 16 + 16, 0);
    ctx.lineTo(i * 16 + 8, 16);
    ctx.closePath();
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function makeWetDeckMaterial(): THREE.MeshStandardMaterial {
  // Wet painted steel deck: dark green paint, low roughness patches.
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#787878';
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * 128, y = Math.random() * 128, r = 8 + Math.random() * 26;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(40,40,40,0.55)');
    g.addColorStop(1, 'rgba(40,40,40,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const rough = new THREE.CanvasTexture(c);
  return new THREE.MeshStandardMaterial({
    color: 0x2e4a42,
    roughness: 0.45,
    roughnessMap: rough,
    metalness: 0.25,
    envMapIntensity: 1.2
  });
}
