import * as THREE from 'three';

/** A small hand-built cabin environment: warm dome above, one cool window patch,
 *  dark water below. Keeps highlights directional instead of studio-even. */
function cabinEquirect(size: number): THREE.DataTexture {
  const w = size;
  const h = size / 2;
  const data = new Float32Array(w * h * 4);
  const ceiling = new THREE.Color(0x8a6a48);
  const wallC = new THREE.Color(0x33322e);
  const belowC = new THREE.Color(0x0a0d11);
  const windowC = new THREE.Color(0xa8bcc8);
  const lampC = new THREE.Color(0xffd9a5);
  const tmp = new THREE.Color();

  for (let y = 0; y < h; y++) {
    const theta = (y / (h - 1)) * Math.PI; // 0 = up
    for (let x = 0; x < w; x++) {
      const phi = (x / (w - 1)) * Math.PI * 2;
      const up = Math.cos(theta);
      if (up > 0) {
        tmp.copy(wallC).lerp(ceiling, Math.pow(up, 0.8));
      } else {
        tmp.copy(wallC).lerp(belowC, Math.pow(-up, 0.7));
      }
      // window band, slightly above the horizon, on one side
      const band = Math.exp(-Math.pow((up - 0.05) / 0.18, 2));
      const side = Math.exp(-Math.pow((Math.cos(phi - 1.1) - 1) / 0.55, 2));
      tmp.lerp(windowC, Math.min(0.92, band * side * 1.15));
      // small deck lamp
      const lampD = Math.hypot(up - 0.72, Math.cos(phi - 4.0) - 1);
      const lamp = Math.exp(-Math.pow(lampD / 0.26, 2));
      tmp.lerp(lampC, Math.min(0.95, lamp));
      const i = (y * w + x) * 4;
      const gain = 1.0 + lamp * 4.5 + band * side * 1.4;
      data[i] = tmp.r * gain;
      data[i + 1] = tmp.g * gain;
      data[i + 2] = tmp.b * gain;
      data[i + 3] = 1;
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.FloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.needsUpdate = true;
  return tex;
}

export function buildEnvironment(renderer: THREE.WebGLRenderer, size: number): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const src = cabinEquirect(size);
  const rt = pmrem.fromEquirectangular(src);
  src.dispose();
  pmrem.dispose();
  return rt.texture;
}
