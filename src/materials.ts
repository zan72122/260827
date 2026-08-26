import * as THREE from 'three';
import { mulberry32 } from './journey';

// ---------------------------------------------------------------- GLSL noise
export const GLSL_NOISE = /* glsl */ `
float hash13(vec3 p){ p = fract(p*0.1031); p += dot(p, p.zyx+31.32); return fract((p.x+p.y)*p.z); }
float vnoise(vec3 p){
  vec3 i = floor(p); vec3 f = fract(p); f = f*f*(3.0-2.0*f);
  float n000 = hash13(i+vec3(0.,0.,0.)); float n100 = hash13(i+vec3(1.,0.,0.));
  float n010 = hash13(i+vec3(0.,1.,0.)); float n110 = hash13(i+vec3(1.,1.,0.));
  float n001 = hash13(i+vec3(0.,0.,1.)); float n101 = hash13(i+vec3(1.,0.,1.));
  float n011 = hash13(i+vec3(0.,1.,1.)); float n111 = hash13(i+vec3(1.,1.,1.));
  return mix(mix(mix(n000,n100,f.x), mix(n010,n110,f.x), f.y),
             mix(mix(n001,n101,f.x), mix(n011,n111,f.x), f.y), f.z);
}
float fbm(vec3 p){
  float a = 0.5; float s = 0.0;
  for (int k = 0; k < 4; k++){ s += a*vnoise(p); p *= 2.03; a *= 0.5; }
  return s;
}
`;

// Zone palette shared by wall / outer mass shaders. y in world metres (deep=-60 .. 0).
export const GLSL_ICE_ZONES = /* glsl */ `
vec3 zoneColor(float y){
  vec3 deepC = vec3(0.050, 0.155, 0.295);
  vec3 layC  = vec3(0.105, 0.235, 0.360);
  vec3 traC  = vec3(0.400, 0.545, 0.650);
  vec3 firnC = vec3(0.760, 0.835, 0.885);
  vec3 c = mix(deepC, layC, smoothstep(-46.0, -36.0, y));
  c = mix(c, traC, smoothstep(-22.0, -14.0, y));
  c = mix(c, firnC, smoothstep(-11.0, -5.0, y));
  return c;
}
float bubbleDensity(float y){
  return mix(0.12, 0.9, smoothstep(-34.0, -7.0, y));
}
float firnWeight(float y){ return smoothstep(-16.0, -6.0, y); }
float layerAmp(float y){
  return 0.05 + 0.11 * smoothstep(-44.0, -38.0, y) * (1.0 - smoothstep(-20.0, -13.0, y));
}
float ashBand(float y, float ay, float w){
  float d = abs(y - ay);
  return 1.0 - smoothstep(w*0.35, w, d);
}
`;

// ------------------------------------------------------- procedural textures
export function makeNoiseTexture(size = 256, seed = 7): THREE.CanvasTexture {
  const rnd = mulberry32(seed);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = 110 + rnd() * 120;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // large soft blotches on top
  for (let k = 0; k < 40; k++) {
    const x = rnd() * size, y = rnd() * size, r = 8 + rnd() * 42;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    const a = 0.05 + rnd() * 0.1;
    const light = rnd() > 0.5;
    grad.addColorStop(0, light ? `rgba(255,255,255,${a})` : `rgba(30,40,50,${a})`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

let sharedRough: THREE.CanvasTexture | null = null;
export function roughTex(): THREE.CanvasTexture {
  if (!sharedRough) sharedRough = makeNoiseTexture(256, 7);
  return sharedRough;
}

export interface MetalOpts {
  color: number;
  rough?: number;
  metal?: number;
  frost?: number; // 0..1 lightens & roughens, cold surface film
}
export function metalMat(o: MetalOpts): THREE.MeshStandardMaterial {
  const c = new THREE.Color(o.color);
  if (o.frost) c.lerp(new THREE.Color(0xdfe9f2), o.frost * 0.45);
  return new THREE.MeshStandardMaterial({
    color: c,
    roughness: (o.rough ?? 0.55) + (o.frost ?? 0) * 0.3,
    metalness: (o.metal ?? 0.75) * (1 - (o.frost ?? 0) * 0.5),
    roughnessMap: roughTex(),
  });
}

// ------------------------------------------------------------- core ice hero
// Custom lit shader: absorption tint, frosted ends, internal bubbles, wet sheen.
export function makeCoreIceMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uLightDir: { value: new THREE.Vector3(0.5, 0.8, 0.4).normalize() },
      uAmbient: { value: new THREE.Color(0.45, 0.55, 0.66) },
      uSun: { value: new THREE.Color(1.0, 0.97, 0.9) },
      uSunI: { value: 0.4 },
      uHalfLen: { value: 0.525 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vWp; varying vec3 vLp;
      void main(){
        vN = normalize(mat3(modelMatrix) * normal);
        vLp = position;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWp = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec3 vN; varying vec3 vWp; varying vec3 vLp;
      uniform vec3 uLightDir; uniform vec3 uAmbient; uniform vec3 uSun;
      uniform float uSunI; uniform float uTime; uniform float uHalfLen;
      ${GLSL_NOISE}
      void main(){
        vec3 N = normalize(vN);
        vec3 V = normalize(cameraPosition - vWp);
        // pale glacial ice body, slightly deeper blue toward the core axis
        float rad = length(vLp.xz);
        vec3 body = mix(vec3(0.62, 0.76, 0.84), vec3(0.42, 0.60, 0.72), smoothstep(0.11, 0.0, rad));
        // bubbles: two scales of sparkle noise frozen in the ice
        float b1 = vnoise(vLp * 55.0);
        float b2 = vnoise(vLp * 23.0 + 7.1);
        float bub = smoothstep(0.78, 0.94, b1) * 0.5 + smoothstep(0.8, 0.95, b2) * 0.35;
        // faint annual banding across the length
        float band = vnoise(vec3(0.0, vLp.y * 9.0, 3.3)) * 0.08;
        // frosted broken ends + light end chipping (soft, no torn-paper zigzag)
        float endW = smoothstep(uHalfLen - 0.14, uHalfLen - 0.01, abs(vLp.y));
        float chip = fbm(vLp * 18.0) * endW * 0.1;
        vec3 c = body + bub * vec3(0.55) + band - chip * vec3(0.12, 0.08, 0.02);
        c = mix(c, vec3(0.9, 0.94, 0.97), endW * 0.65);
        // lighting: wrapped diffuse + fake transmission + wet specular
        float dif = max(dot(N, uLightDir), 0.0);
        float wrap = max(dot(N, uLightDir) * 0.5 + 0.5, 0.0);
        float trans = pow(max(dot(-N, uLightDir), 0.0), 2.0) * 0.4;
        vec3 H = normalize(uLightDir + V);
        float spec = pow(max(dot(N, H), 0.0), 60.0) * 0.9; // wet gloss
        float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
        vec3 lit = c * (uAmbient * 0.8 + uSun * uSunI * (dif * 0.75 + wrap * 0.4 + trans));
        lit += uSun * spec * uSunI * 0.8 + fres * vec3(0.5, 0.62, 0.72) * 0.28;
        gl_FragColor = vec4(lit, 1.0);
      }`,
  });
}

// Sky dome: gradient + low sun disc + thin horizon haze.
export function makeSkyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { uSunDir: { value: new THREE.Vector3(0.55, 0.16, -0.6).normalize() } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main(){
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec3 vDir; uniform vec3 uSunDir;
      void main(){
        float h = clamp(vDir.y, -0.1, 1.0);
        vec3 top = vec3(0.42, 0.63, 0.88);
        vec3 hor = vec3(0.93, 0.96, 0.99);
        vec3 c = mix(hor, top, smoothstep(0.0, 0.55, h));
        float s = dot(normalize(vDir), uSunDir);
        c += vec3(1.0, 0.92, 0.75) * pow(max(s, 0.0), 350.0) * 3.0; // sun disc
        c += vec3(1.0, 0.95, 0.85) * pow(max(s, 0.0), 8.0) * 0.22;  // glare
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
}
