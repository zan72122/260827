import * as THREE from 'three';

/**
 * The room the metal and the wood see: a broad window on the left, warm
 * plaster around it, dark floor. Built as a small HDR equirect so the
 * chisel actually reflects a workshop instead of rendering black.
 */
export function makeEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const w = 256, h = 128;
  const data = new Float32Array(w * h * 4);
  const put = (i: number, r: number, g: number, b: number) => {
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 1;
  };
  for (let y = 0; y < h; y++) {
    const v = y / (h - 1);                 // 0 = up
    const el = (0.5 - v) * Math.PI;        // +pi/2 up, -pi/2 down
    for (let x = 0; x < w; x++) {
      const u = x / (w - 1);
      const i = (y * w + x) * 4;
      // base: warm ceiling, mid wall, dark boards underfoot
      let r: number, g: number, b: number;
      if (el > 0.15) { const k = (el - 0.15) / 1.42; r = 0.44 + 0.22 * k; g = 0.41 + 0.20 * k; b = 0.36 + 0.17 * k; }
      else if (el > -0.12) { r = 0.40; g = 0.36; b = 0.31; }
      else { const k = Math.min(1, (-el - 0.12) / 1.45); r = 0.20 - 0.13 * k; g = 0.16 - 0.10 * k; b = 0.12 - 0.08 * k; }
      // the window: one broad, soft, slightly cool opening
      const du = Math.abs(((u - 0.30) % 1 + 1) % 1);
      const wu = Math.min(du, 1 - du);
      const win = Math.max(0, 1 - Math.pow(wu / 0.135, 2.2)) * Math.max(0, 1 - Math.pow(Math.abs(el - 0.28) / 0.62, 2.4));
      r += win * 7.0; g += win * 7.2; b += win * 7.6;
      // a weaker bounce card opposite it
      const du2 = Math.abs(((u - 0.82) % 1 + 1) % 1);
      const wu2 = Math.min(du2, 1 - du2);
      const bnc = Math.max(0, 1 - Math.pow(wu2 / 0.22, 2)) * Math.max(0, 1 - Math.pow(Math.abs(el - 0.05) / 0.5, 2));
      r += bnc * 0.55; g += bnc * 0.48; b += bnc * 0.38;
      put(i, r, g, b);
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.needsUpdate = true;
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const rt = pmrem.fromEquirectangular(tex);
  tex.dispose();
  pmrem.dispose();
  return rt.texture;
}
