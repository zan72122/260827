import * as THREE from 'three'

export const SUN_DIR = new THREE.Vector3(-0.66, 0.33, 0.68).normalize()

/**
 * Morning sky dome. Cool grey-blue overhead, warm low haze around the
 * sun, and a dense band of sea fog at the horizon that does the work of
 * separating the far breakwater from the water -- not a depth-of-field
 * blur.
 */
export function createSky(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(600, 32, 20)
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uSun: { value: SUN_DIR.clone() },
      uZenith: { value: new THREE.Color(0x5f7f95) },
      uHorizon: { value: new THREE.Color(0xb9c3c2) },
      uHaze: { value: new THREE.Color(0xd8cfbe) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      uniform vec3 uSun, uZenith, uHorizon, uHaze;
      void main() {
        vec3 d = normalize(vDir);
        float up = clamp(d.y, -1.0, 1.0);
        float t = pow(clamp(up * 1.15 + 0.06, 0.0, 1.0), 0.62);
        vec3 col = mix(uHorizon, uZenith, t);
        // low warm glow around the morning sun
        float sd = max(dot(d, normalize(uSun)), 0.0);
        col += uHaze * pow(sd, 11.0) * 0.40;
        col += vec3(1.0, 0.94, 0.84) * pow(sd, 900.0) * 0.8;
        // sea fog band hugging the horizon
        float band = exp(-pow(abs(up) / 0.055, 1.6));
        col = mix(col, uHaze * 0.96, band * 0.5);
        // below the horizon the dome is only ever seen as haze
        col = mix(col, uHorizon * 0.86, clamp(-up * 6.0, 0.0, 1.0));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.frustumCulled = false
  mesh.renderOrder = -1000
  mesh.name = 'sky'
  return mesh
}
