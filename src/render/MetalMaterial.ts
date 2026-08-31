import * as THREE from 'three';

/**
 * Drawn stainless steel. The roughness is anisotropic along the drawing
 * direction (the v axis of the nozzle's UVs), which is what makes a real piping
 * tip read as pressed sheet metal rather than chrome.
 */
export function makeStainless(opts?: {
  color?: number;
  roughness?: number;
  drawn?: number;
}): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: opts?.color ?? 0xc9ccce,
    metalness: 1.0,
    roughness: opts?.roughness ?? 0.29,
    envMapIntensity: 1.0,
    side: THREE.DoubleSide,
  });
  const drawn = opts?.drawn ?? 1.0;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uDrawn = { value: drawn };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uDrawn;
        float steelHash( vec2 p ) {
          return fract( sin( dot( p, vec2( 41.3, 289.1 ) ) ) * 27183.371 );
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        {
          float lane = steelHash( vec2( floor( vMapUv.x * 96.0 ), 0.0 ) );
          float fine = steelHash( vec2( floor( vMapUv.x * 340.0 ), floor( vMapUv.y * 18.0 ) ) );
          roughnessFactor = clamp(
            roughnessFactor + ( lane - 0.5 ) * 0.11 * uDrawn + ( fine - 0.5 ) * 0.05 * uDrawn,
            0.11, 0.55 );
        }`,
      );
  };
  // vMapUv only exists when a map-driven uv varying is compiled in; force it
  (mat as unknown as { defines: Record<string, string> }).defines = { USE_UV: '', USE_MAP: '' };
  mat.map = whiteTexture();
  return mat;
}

let _white: THREE.DataTexture | null = null;
function whiteTexture(): THREE.DataTexture {
  if (!_white) {
    const d = new Uint8Array([255, 255, 255, 255]);
    _white = new THREE.DataTexture(d, 1, 1, THREE.RGBAFormat);
    _white.colorSpace = THREE.SRGBColorSpace;
    _white.needsUpdate = true;
  }
  return _white;
}
