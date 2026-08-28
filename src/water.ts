import * as THREE from 'three';

export const MAX_RIPPLES = 8;

const VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
precision highp float;
varying vec3 vWorld;

uniform float uTime;
uniform vec3 uCeil;
uniform vec3 uWall;
uniform vec3 uDeep;
uniform vec3 uWindow;
uniform vec3 uLamp;
uniform vec3 uLampDir;
uniform vec3 uWinDir;
uniform vec4 uRipples[${MAX_RIPPLES}];
uniform float uHoleX;
uniform float uHoleZ;

vec3 skyColor(vec3 r) {
  float up = clamp(r.y, -1.0, 1.0);
  vec3 c = mix(uWall, uCeil, pow(max(up, 0.0), 0.65));
  c = mix(c, uDeep, pow(max(-up, 0.0), 0.6));
  vec3 h = normalize(vec3(r.x, 0.0, r.z) + 1e-5);
  float win = exp(-pow((up - 0.08) / 0.24, 2.0)) * exp(-pow((dot(h, uWinDir) - 1.0) / 0.55, 2.0));
  c = mix(c, uWindow, min(0.88, win));
  float lamp = exp(-pow(distance(normalize(r), normalize(uLampDir)) / 0.20, 2.0));
  c += uLamp * lamp * 2.6;
  return c;
}

// small confused chop, with its slope solved rather than sampled twice
vec3 chopSlope(vec2 p, float t) {
  float a1 = 41.0, a2 = 33.0, a3 = 57.0, a4 = 78.0;
  float p1 = p.x * a1 + t * 2.3;
  float p2 = p.y * a2 - t * 1.9 + 1.7;
  float p3 = (p.x * 0.7 + p.y) * a3 + t * 3.1;
  float p4 = (p.x - p.y * 0.6) * a4 - t * 4.2;
  float s1 = 0.0034, s2 = 0.0038, s3 = 0.0021, s4 = 0.0013;
  float h = sin(p1) * s1 + sin(p2) * s2 + sin(p3) * s3 + sin(p4) * s4;
  float dx = cos(p1) * s1 * a1 + cos(p3) * s3 * a3 * 0.7 + cos(p4) * s4 * a4;
  float dz = cos(p2) * s2 * a2 + cos(p3) * s3 * a3 - cos(p4) * s4 * a4 * 0.6;
  return vec3(h, dx, dz);
}

void main() {
  vec2 p = vWorld.xz;
  float t = uTime;
  vec3 cs = chopSlope(p, t);
  float gx = cs.y;
  float gz = cs.z;

  // expanding rings from drops, the line entry and fish breaking through
  for (int i = 0; i < ${MAX_RIPPLES}; i++) {
    vec4 r = uRipples[i];
    if (r.w <= 0.0) continue;
    float age = t - r.z;
    if (age < 0.0 || age > 2.6) continue;
    vec2 d = p - r.xy;
    float dist = length(d);
    float front = age * 0.42;
    float q = (dist - front) / 0.028;
    float amp = exp(-q * q) * exp(-age * 1.9) * r.w * 0.0016;
    float k = 210.0;
    float ph = (dist - front) * k;
    // d/ddist of amp * sin(ph)
    float dhd = amp * (k * cos(ph) - (2.0 * q / 0.028) * sin(ph));
    vec2 dn = d / max(dist, 1e-4);
    gx += dhd * dn.x;
    gz += dhd * dn.y;
  }

  vec3 n = normalize(vec3(-gx, 1.0, -gz));
  vec3 v = normalize(cameraPosition - vWorld);
  float ndv = max(dot(n, v), 0.0);
  float fres = 0.028 + 0.972 * pow(1.0 - ndv, 5.0);

  vec3 refl = skyColor(reflect(-v, n));

  // outside the hatch the deck blocks the sky, so the water there is nearly black
  float inHole = smoothstep(uHoleX + 0.12, uHoleX - 0.02, abs(p.x)) *
                 smoothstep(uHoleZ + 0.12, uHoleZ - 0.02, abs(p.y));
  float shade = mix(0.10, 1.0, inHole);
  // the far end of the well gets less of everything
  float reach = exp(-max(0.0, abs(p.y) - 0.06) * 1.15);
  vec3 col = mix(uDeep, refl * 0.5, clamp(fres * 1.05, 0.0, 1.0)) * shade * (0.45 + 0.55 * reach);

  // surface glare only where the lamp actually lands
  float gl = pow(max(dot(reflect(-v, n), normalize(uLampDir)), 0.0), 260.0);
  col += uLamp * gl * 1.4 * inHole;

  // how much of what is underneath survives: strong looking down, none at grazing
  float alpha = clamp(mix(0.2, 1.0, pow(1.0 - ndv, 1.9)), 0.18, 0.99);
  alpha = mix(1.0, alpha, inHole * 0.94 + 0.06);

  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface WaterHandle {
  mesh: THREE.Mesh;
  abyss: THREE.Mesh;
  update(time: number): void;
  ripple(x: number, z: number, strength: number, time: number): void;
}

export function buildWater(holeHalfX: number, holeHalfZ: number): WaterHandle {
  const ripples = new Array(MAX_RIPPLES).fill(0).map(() => new THREE.Vector4(0, 0, 0, 0));
  const uniforms = {
    uTime: { value: 0 },
    uCeil: { value: new THREE.Color(0x241a10) },
    uWall: { value: new THREE.Color(0x0f1216) },
    uDeep: { value: new THREE.Color(0x080e1a) },
    uWindow: { value: new THREE.Color(0x54687a) },
    uLamp: { value: new THREE.Color(0xffd7a0) },
    uLampDir: { value: new THREE.Vector3(-0.45, 0.82, 0.35) },
    uWinDir: { value: new THREE.Vector3(0.42, 0, 0.91).normalize() },
    uRipples: { value: ripples },
    uHoleX: { value: holeHalfX },
    uHoleZ: { value: holeHalfZ },
  };

  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
  });

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(9, 9, 1, 1), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 20;
  mesh.name = 'water';

  const abyss = new THREE.Mesh(
    new THREE.PlaneGeometry(9, 9),
    new THREE.MeshBasicMaterial({ color: 0x03060a }),
  );
  abyss.rotation.x = -Math.PI / 2;
  abyss.position.y = -2.4;
  abyss.name = 'abyss';

  let cursor = 0;
  return {
    mesh,
    abyss,
    update(time: number) {
      uniforms.uTime.value = time;
    },
    ripple(x: number, z: number, strength: number, time: number) {
      const r = ripples[cursor % MAX_RIPPLES];
      cursor++;
      r.set(x, z, time, strength);
    },
  };
}

/** Underwater extinction for anything that can be below the surface: the deeper it is,
 *  the more it collapses into the dark water colour instead of staying lit. */
export function applyUnderwaterFade(mat: THREE.Material, deep: THREE.Color, density = 5.2): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uDeepCol = { value: deep };
    shader.uniforms.uExt = { value: density };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vWaterY;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvWaterY = (modelMatrix * vec4(transformed, 1.0)).y;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying float vWaterY;\nuniform vec3 uDeepCol;\nuniform float uExt;',
      )
      .replace(
        '#include <opaque_fragment>',
        `float depthBelow = max(0.0, -vWaterY);
         float ext = exp(-depthBelow * uExt);
         outgoingLight = mix(uDeepCol, outgoingLight, ext);
         #include <opaque_fragment>`,
      );
  };
  mat.needsUpdate = true;
}
