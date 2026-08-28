import * as THREE from 'three'
import { SUN_DIR } from './Sky'
import { waterNormal } from './Textures'

export const WATER_Y = -1.35
/** Sea-facing edge of the quay: sea is at z < QUAY_Z. */
export const QUAY_Z = 0.15

/**
 * Shared underwater state. Every solid material in the scene is patched
 * with the same attenuation so a single frame can show air and water at
 * once (the cross-section shot) without switching fog.
 */
export const waterUniforms = {
  uWaterY: { value: WATER_Y },
  /** per-metre extinction, red first: coastal green water, not blue glass */
  uAtten: { value: new THREE.Vector3(0.30, 0.115, 0.175) },
  uNearWater: { value: new THREE.Vector3(0.33, 0.44, 0.42) },
  uDeepWater: { value: new THREE.Vector3(0.055, 0.115, 0.125) },
  uTime: { value: 0 },
  uFlow: { value: new THREE.Vector2(0, 0) },
  uCut: { value: new THREE.Vector4(0, WATER_Y, 0, 0) }, // xyz centre, w amount
  uCutRadius: { value: 1.75 },
}

const UNDERWATER_GLSL = /* glsl */ `
  uniform float uWaterY;
  uniform vec3 uAtten, uNearWater, uDeepWater;
  varying vec3 vWPos_uw;

  vec3 waterBodyColor(float depth) {
    float t = clamp(depth / 7.0, 0.0, 1.0);
    return mix(uNearWater, uDeepWater, t * t * 0.85 + t * 0.15);
  }

  vec3 applyUnderwater(vec3 col, vec3 wpos, vec3 camPos) {
    float a = camPos.y - uWaterY;
    float b = wpos.y - uWaterY;
    float dist = length(wpos - camPos);
    float frac;
    if (a <= 0.0 && b <= 0.0) frac = 1.0;
    else if (a > 0.0 && b > 0.0) frac = 0.0;
    else if (a > 0.0) frac = -b / (a - b);
    else frac = a / (a - b);
    float sub = dist * clamp(frac, 0.0, 1.0);
    if (sub <= 0.0001) return col;
    float midDepth = max(0.0, uWaterY - (min(wpos.y, uWaterY) + min(camPos.y, uWaterY)) * 0.5);
    vec3 body = waterBodyColor(midDepth);
    vec3 trans = exp(-uAtten * sub);
    return mix(body, col, trans);
  }
`

/** Patch a standard material so it dims and shifts through the water column. */
export function applyUnderwater<T extends THREE.Material>(mat: T): T {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWaterY = waterUniforms.uWaterY
    shader.uniforms.uAtten = waterUniforms.uAtten
    shader.uniforms.uNearWater = waterUniforms.uNearWater
    shader.uniforms.uDeepWater = waterUniforms.uDeepWater
    shader.vertexShader = 'varying vec3 vWPos_uw;\n' + shader.vertexShader.replace(
      '#include <fog_vertex>',
      '#include <fog_vertex>\n  vWPos_uw = (modelMatrix * vec4(transformed, 1.0)).xyz;'
    )
    shader.fragmentShader = UNDERWATER_GLSL + shader.fragmentShader.replace(
      '#include <fog_fragment>',
      '#include <fog_fragment>\n  gl_FragColor.rgb = applyUnderwater(gl_FragColor.rgb, vWPos_uw, cameraPosition);'
    )
  }
  mat.customProgramCacheKey = () => 'uw'
  return mat
}

/* ------------------------------------------------------------------ */

const SKY_GLSL = /* glsl */ `
  vec3 skyColor(vec3 d, vec3 sun) {
    float up = clamp(d.y, -1.0, 1.0);
    float t = pow(clamp(up * 1.15 + 0.06, 0.0, 1.0), 0.62);
    vec3 col = mix(vec3(0.725, 0.765, 0.761), vec3(0.373, 0.498, 0.584), t);
    float sd = max(dot(d, sun), 0.0);
    col += vec3(0.847, 0.812, 0.745) * pow(sd, 11.0) * 0.40;
    float band = exp(-pow(abs(up) / 0.055, 1.6));
    col = mix(col, vec3(0.847, 0.812, 0.745) * 0.98, band * 0.62);
    return col;
  }
`

export class SeaSurface {
  readonly mesh: THREE.Mesh
  private mat: THREE.ShaderMaterial

  constructor() {
    const geo = new THREE.PlaneGeometry(1200, 1200, 128, 128)
    geo.rotateX(-Math.PI / 2)
    const nrm = waterNormal()
    nrm.wrapS = nrm.wrapT = THREE.RepeatWrapping
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: waterUniforms.uTime,
        uFlow: waterUniforms.uFlow,
        uCut: waterUniforms.uCut,
        uCutRadius: waterUniforms.uCutRadius,
        uWaterY: waterUniforms.uWaterY,
        uNearWater: waterUniforms.uNearWater,
        uDeepWater: waterUniforms.uDeepWater,
        uAtten: waterUniforms.uAtten,
        uNormalMap: { value: nrm },
        uSun: { value: SUN_DIR.clone() },
        uQuayZ: { value: QUAY_Z },
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        varying vec3 vWPos;
        varying float vDistXZ;
        void main() {
          vec3 p = position;
          float d = length(p.xz);
          // long swell only; chop lives in the normal map
          float damp = 1.0 / (1.0 + d * 0.004);
          p.y += sin(p.x * 0.34 + uTime * 0.85) * 0.035 * damp;
          p.y += sin((p.z * 0.27 - p.x * 0.11) + uTime * 0.62) * 0.045 * damp;
          p.y += sin(p.z * 0.09 + uTime * 0.4) * 0.06 * damp;
          vec4 wp = modelMatrix * vec4(p, 1.0);
          vWPos = wp.xyz;
          vDistXZ = d;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uNormalMap;
        uniform float uTime, uCutRadius, uWaterY, uQuayZ;
        uniform vec2 uFlow;
        uniform vec4 uCut;
        uniform vec3 uSun, uNearWater, uDeepWater, uAtten;
        varying vec3 vWPos;
        varying float vDistXZ;
        ${SKY_GLSL}

        mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

        // three layers at unrelated scales and angles: a single tiling
        // normal map read straight off reads as corrugated metal
        vec3 rippleNormal(vec2 p, float fade) {
          vec2 dr = uFlow * 0.25;
          vec2 a = rot2(0.31) * p * 0.43 + vec2(uTime * 0.019, uTime * 0.011) + dr * uTime * 0.02;
          vec2 b = rot2(2.05) * p * 1.27 - vec2(uTime * 0.031, uTime * -0.022);
          vec2 c = rot2(4.12) * p * 2.63 + vec2(uTime * -0.052, uTime * 0.039);
          vec3 n1 = texture2D(uNormalMap, a).xyz * 2.0 - 1.0;
          vec3 n2 = texture2D(uNormalMap, b).xyz * 2.0 - 1.0;
          vec2 xy = rot2(-0.31) * n1.xy * 0.5 + rot2(-2.05) * n2.xy * 0.7;
          // the finest chop is only resolvable close in: skip the tap
          // once it would alias anyway
          if (fade > 0.35) {
            vec3 n3 = texture2D(uNormalMap, c).xyz * 2.0 - 1.0;
            xy += rot2(-4.12) * n3.xy * 0.45 * fade;
          }
          vec3 n = normalize(vec3(xy, 1.0));
          return normalize(mix(vec3(0.0, 0.0, 1.0), n, fade));
        }

        void main() {
          vec3 V = normalize(cameraPosition - vWPos);
          float fade = 1.0 / (1.0 + vDistXZ * vDistXZ * 0.00028);
          vec3 tn = rippleNormal(vWPos.xz, fade);
          vec3 N = normalize(vec3(tn.x, tn.z * 1.6, tn.y));

          if (!gl_FrontFacing || cameraPosition.y < uWaterY) {
            // ceiling seen from below: mostly total internal reflection,
            // with a soft Snell window toward the sun side
            float ct = clamp(dot(N, -V), 0.0, 1.0);
            float window = smoothstep(0.55, 0.98, ct);
            vec3 under = mix(uNearWater * 0.75, vec3(0.80, 0.83, 0.80), window);
            under += vec3(0.9, 0.88, 0.8) * pow(max(dot(reflect(-V, N), uSun), 0.0), 60.0) * 0.35 * window;
            float depth = max(0.0, uWaterY - cameraPosition.y);
            under *= mix(1.0, 0.45, clamp(depth / 6.0, 0.0, 1.0));
            gl_FragColor = vec4(under, 1.0);
            return;
          }

          vec3 R = reflect(-V, N);
          R.y = abs(R.y);
          vec3 sky = skyColor(R, uSun);
          float f = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
          f = clamp(f, 0.0, 1.0);

          // body colour: darker where the water is deep and the sky is not
          // being mirrored, greener in the shallows over the harbour floor
          float shallow = smoothstep(-14.0, 2.0, vWPos.z);
          vec3 body = mix(uDeepWater * 1.5, uNearWater * 0.62, shallow * 0.55);
          body *= mix(0.85, 1.0, fade);

          vec3 col = mix(body, sky, f);
          // sun glitter
          float spec = pow(max(dot(R, uSun), 0.0), 420.0);
          col += vec3(1.0, 0.95, 0.86) * spec * 1.5 * fade;
          float spec2 = pow(max(dot(R, uSun), 0.0), 40.0);
          col += vec3(0.9, 0.88, 0.82) * spec2 * 0.12;

          // wash along the quay face
          float wash = smoothstep(0.0, 1.0, 1.0 - abs(vWPos.z - uQuayZ) / 0.85);
          float foam = smoothstep(0.45, 0.95, texture2D(uNormalMap, vWPos.xz * 1.1 + vec2(uTime * 0.05, 0.0)).b);
          col = mix(col, vec3(0.78, 0.80, 0.78), wash * foam * 0.35 * (0.6 + 0.4 * sin(uTime * 1.7 + vWPos.x)));

          // haze into the horizon so the far water and the fog band meet
          float haze = 1.0 - 1.0 / (1.0 + vDistXZ * 0.0042);
          col = mix(col, vec3(0.80, 0.792, 0.752), clamp(haze, 0.0, 1.0) * 0.88);

          // looking down into the water, some of what is below shows
          // through -- that is how the shoal is visible from the deck
          float alpha = clamp(0.70 + 0.30 * sqrt(f), 0.0, 1.0);
          if (uCut.w > 0.001) {
            float d = length(vWPos.xz - uCut.xz);
            float w = 1.0 - smoothstep(uCutRadius * 0.55, uCutRadius, d);
            alpha = mix(alpha, 0.12, w * uCut.w);
            col = mix(col, col * 0.9 + vec3(0.03), w * uCut.w * 0.5);
          }
          gl_FragColor = vec4(col, alpha);
        }
      `,
    })
    this.mesh = new THREE.Mesh(geo, this.mat)
    this.mesh.position.set(0, WATER_Y, -60)
    this.mesh.renderOrder = 10
    this.mesh.name = 'sea'
  }

  dispose() {
    this.mesh.geometry.dispose()
    this.mat.dispose()
  }
}

/**
 * The water body itself: an inward-facing shell that gives the far
 * underwater view its murk instead of showing empty background.
 */
export function createMurk(): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(58, 58, 70, 36, 1, true)
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uWaterY: waterUniforms.uWaterY,
      uNearWater: waterUniforms.uNearWater,
      uDeepWater: waterUniforms.uDeepWater,
      uAtten: waterUniforms.uAtten,
    },
    vertexShader: `varying vec3 vWPos;
      void main(){ vec4 wp = modelMatrix*vec4(position,1.0); vWPos = wp.xyz; gl_Position = projectionMatrix*viewMatrix*wp; }`,
    fragmentShader: /* glsl */ `
      uniform float uWaterY; uniform vec3 uNearWater, uDeepWater, uAtten;
      varying vec3 vWPos;
      void main(){
        float depth = max(0.0, uWaterY - vWPos.y);
        float t = clamp(depth / 9.0, 0.0, 1.0);
        vec3 col = mix(uNearWater, uDeepWater, t * 0.9 + 0.1);
        // extinction over the distance to the shell keeps contrast falling
        float d = length(vWPos - cameraPosition);
        col = mix(col, mix(uNearWater, uDeepWater, t) * 0.9, clamp(d / 40.0, 0.0, 1.0));
        float above = smoothstep(uWaterY + 0.2, uWaterY - 0.6, vWPos.y);
        gl_FragColor = vec4(col, above);
      }
    `,
    transparent: true,
  })
  const m = new THREE.Mesh(geo, mat)
  m.position.set(0, WATER_Y - 35, -6)
  m.renderOrder = -900
  m.frustumCulled = false
  m.name = 'murk'
  return m
}

/** Harbour floor: silt with drag marks, only lit by what gets down there. */
export function createSeabed(): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(90, 90, 40, 40)
  geo.rotateX(-Math.PI / 2)
  const pos = geo.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i)
    pos.setY(i, Math.sin(x * 0.4) * 0.06 + Math.cos(z * 0.31 + 1.2) * 0.09 + Math.sin(x * 0.13 + z * 0.2) * 0.18)
  }
  geo.computeVertexNormals()
  const mat = applyUnderwater(new THREE.MeshStandardMaterial({ color: 0x5b5a4e, roughness: 1.0, metalness: 0.0 }))
  const m = new THREE.Mesh(geo, mat)
  m.position.set(0, WATER_Y - 9.2, -12)
  m.name = 'seabed'
  return m
}
