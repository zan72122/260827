import * as THREE from 'three';

/**
 * Procedural environment + surface textures.
 * Nothing is downloaded: the reflections that make the glass and the silvered
 * interior readable are painted into a canvas and pre-filtered with PMREM.
 */

function canvas2d(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return { c, g: c.getContext('2d') };
}

/** Equirectangular painting of the workshop: cold window, warm burner, wood. */
export function buildEnvironment(renderer) {
  const { c, g } = canvas2d(512, 256);

  // sky/ceiling -> floor vertical gradient (cold above, warm wood below)
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0.00, '#2b333d');
  grad.addColorStop(0.42, '#3a3630');
  grad.addColorStop(0.62, '#4a392b');
  grad.addColorStop(1.00, '#1e1510');
  g.fillStyle = grad; g.fillRect(0, 0, 512, 256);

  // cold winter window (behind-left): the key highlight in every glass surface
  const win = g.createRadialGradient(150, 96, 4, 150, 96, 96);
  win.addColorStop(0, '#eaf4ff');
  win.addColorStop(0.35, '#b9d4ea');
  win.addColorStop(1, 'rgba(90,120,150,0)');
  g.fillStyle = win; g.fillRect(40, 10, 230, 180);
  g.fillStyle = '#f2f8ff';
  g.fillRect(120, 62, 62, 74);              // hard window pane -> crisp reflection
  g.fillStyle = '#6b7d8d';
  g.fillRect(150, 62, 3, 74); g.fillRect(120, 96, 62, 3);

  // burner glow (warm, low, in front)
  const fire = g.createRadialGradient(360, 168, 2, 360, 168, 70);
  fire.addColorStop(0, '#ffd9a0');
  fire.addColorStop(0.3, '#ff8a34');
  fire.addColorStop(1, 'rgba(120,40,0,0)');
  g.fillStyle = fire; g.fillRect(280, 100, 170, 140);

  // shelf of finished ornaments: small coloured blobs to catch in reflections
  const cols = ['#c0393f', '#2f6b53', '#c9a24a', '#8fb8c9', '#a4453f'];
  for (let i = 0; i < 22; i++) {
    const x = 20 + Math.random() * 472, y = 120 + Math.random() * 60;
    g.fillStyle = cols[i % cols.length];
    g.globalAlpha = 0.5;
    g.beginPath(); g.arc(x, y, 3 + Math.random() * 5, 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const envMap = pmrem.fromEquirectangular(tex).texture;
  pmrem.dispose();
  tex.dispose();
  return envMap;
}

/** Worn workbench wood: planks, grain, burn marks. No plastic sheen. */
export function woodTexture(dark = false) {
  const { c, g } = canvas2d(512, 512);
  const base = dark ? '#3a2a1d' : '#6b4a2d';
  g.fillStyle = base; g.fillRect(0, 0, 512, 512);
  for (let p = 0; p < 6; p++) {                       // plank seams
    const y = p * 85 + 4;
    g.fillStyle = 'rgba(0,0,0,.45)';
    g.fillRect(0, y, 512, 3);
  }
  for (let i = 0; i < 2600; i++) {                    // grain
    const y = Math.random() * 512;
    const len = 20 + Math.random() * 150;
    const x = Math.random() * 512;
    g.strokeStyle = `rgba(${dark ? 20 : 40},${dark ? 14 : 26},${dark ? 8 : 14},${0.05 + Math.random() * 0.18})`;
    g.lineWidth = 0.6 + Math.random() * 1.6;
    g.beginPath();
    g.moveTo(x, y);
    g.bezierCurveTo(x + len * 0.4, y + 2, x + len * 0.7, y - 2, x + len, y);
    g.stroke();
  }
  for (let i = 0; i < 26; i++) {                      // scorch marks / stains
    const x = Math.random() * 512, y = Math.random() * 512, r = 6 + Math.random() * 26;
    const s = g.createRadialGradient(x, y, 1, x, y, r);
    s.addColorStop(0, 'rgba(20,12,6,.5)');
    s.addColorStop(1, 'rgba(20,12,6,0)');
    g.fillStyle = s; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Cold, chalky plaster for the walls. */
export function plasterTexture() {
  const { c, g } = canvas2d(256, 256);
  g.fillStyle = '#8c8377'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9000; i++) {
    const a = Math.random() * 0.12;
    g.fillStyle = Math.random() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Soft round sprite used for glitter, embers and snow. */
export function sparkTexture(cross = true) {
  const { c, g } = canvas2d(64, 64);
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 30);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.25, 'rgba(255,255,255,.75)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  if (cross) {                                     // tiny star flare = "lamé"
    g.globalCompositeOperation = 'lighter';
    g.strokeStyle = 'rgba(255,255,255,.55)';
    g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(32, 4); g.lineTo(32, 60); g.moveTo(4, 32); g.lineTo(60, 32); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A soft dark blob used as a cheap contact shadow under objects. */
export function blobShadowTexture() {
  const { c, g } = canvas2d(128, 128);
  const r = g.createRadialGradient(64, 64, 2, 64, 64, 62);
  r.addColorStop(0, 'rgba(0,0,0,.72)');
  r.addColorStop(0.55, 'rgba(0,0,0,.28)');
  r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
