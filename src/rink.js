// Ice surface: one large plane whose scratches / snow / roughness / normal /
// wetness are driven by (a) a procedural pre-damage texture and (b) a GPU mask
// render-target that the conditioner stamps into while driving.
// The water film is a shader parameter of the same surface — no stacked
// transparent planes, so no sorting / z-fighting.

import * as THREE from 'three';
import { RINK } from './path.js';

const MASK_RES = 1024;

// ---------------------------------------------------------------- textures

function makeScratchTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 1024;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, 1024, 1024);
  g.globalCompositeOperation = 'lighter';

  const rnd = mulberry32(20260826);
  const gauss = () => (rnd() + rnd() + rnd() + rnd() - 2) / 2;

  // B channel: locally worn white patches at traffic spots (center, faceoffs, goal mouths)
  const spots = [
    [512, 512, 220], [512, 250, 150], [512, 774, 150],
    [300, 300, 120], [724, 300, 120], [300, 724, 120], [724, 724, 120],
    [512, 90, 110], [512, 934, 110]
  ];
  for (const [x, y, r] of spots) {
    for (let i = 0; i < 5; i++) {
      const gr = g.createRadialGradient(x + gauss() * 40, y + gauss() * 40, 0, x, y, r * (0.6 + rnd() * 0.6));
      gr.addColorStop(0, `rgba(0,0,${40 + (rnd() * 40) | 0},1)`);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 1024, 1024);
    }
  }

  // R channel: skate scratches — several direction families + curved arcs
  const families = [0.1, 0.6, 1.2, 1.9, 2.4, 2.9];
  for (let i = 0; i < 3000; i++) {
    const fam = families[(rnd() * families.length) | 0];
    const ang = fam + gauss() * 0.25;
    // 60% clustered center traffic, 40% spread over the whole sheet so the
    // band boundary stays readable out to the boards and rink ends
    const uniform = rnd() < 0.4;
    const cx = uniform ? 40 + rnd() * 944 : 512 + gauss() * 430;
    const cy = uniform ? 40 + rnd() * 944 : 512 + gauss() * 450;
    const len = 30 + rnd() * 150;
    const a = 0.05 + rnd() * 0.13;
    g.strokeStyle = `rgba(${(a * 255) | 0},0,0,1)`;
    g.lineWidth = 0.5 + rnd() * 0.7;
    g.beginPath();
    const bend = gauss() * 30;
    const dx = Math.cos(ang), dy = Math.sin(ang);
    g.moveTo(cx - dx * len / 2, cy - dy * len / 2);
    g.quadraticCurveTo(cx - dy * bend, cy + dx * bend, cx + dx * len / 2, cy + dy * len / 2);
    g.stroke();
  }
  // deep hockey-stop gouges
  for (let i = 0; i < 130; i++) {
    const cx = 512 + gauss() * 380, cy = 512 + gauss() * 420;
    const r = 15 + rnd() * 55;
    const a0 = rnd() * Math.PI * 2;
    g.strokeStyle = `rgba(${45 + (rnd() * 55) | 0},0,0,1)`;
    g.lineWidth = 0.8 + rnd() * 1.4;
    g.beginPath();
    g.arc(cx, cy, r, a0, a0 + 0.5 + rnd() * 1.2);
    g.stroke();
  }

  // G channel: snow powder speckle, denser where scratches cluster
  for (let i = 0; i < 5200; i++) {
    const u2 = rnd() < 0.35;
    const cx = u2 ? rnd() * 1024 : 512 + gauss() * 420;
    const cy = u2 ? rnd() * 1024 : 512 + gauss() * 450;
    const a = 40 + rnd() * 150;
    g.fillStyle = `rgba(0,${a | 0},0,1)`;
    const s = 0.7 + rnd() * 1.8;
    g.fillRect(cx, cy, s, s);
  }
  // powder drifts along a few long lines
  for (let i = 0; i < 60; i++) {
    const ang = rnd() * Math.PI;
    const cx = 512 + gauss() * 300, cy = 512 + gauss() * 380;
    const dx = Math.cos(ang), dy = Math.sin(ang);
    for (let j = 0; j < 60; j++) {
      const t = (j - 30) * 3;
      g.fillStyle = `rgba(0,${(40 + rnd() * 120) | 0},0,1)`;
      g.fillRect(cx + dx * t + gauss() * 3, cy + dy * t + gauss() * 3, 1.2, 1.2);
    }
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  return tex;
}

function makeDetailTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 256, 256);
  g.globalCompositeOperation = 'lighter';
  const rnd = mulberry32(7);
  for (let i = 0; i < 800; i++) {
    const ang = rnd() * Math.PI;
    const cx = rnd() * 256, cy = rnd() * 256;
    const len = 8 + rnd() * 40;
    g.strokeStyle = `rgba(${(20 + rnd() * 90) | 0},0,0,1)`;
    g.lineWidth = 0.5 + rnd() * 0.8;
    g.beginPath();
    g.moveTo(cx - Math.cos(ang) * len, cy - Math.sin(ang) * len);
    g.lineTo(cx + Math.cos(ang) * len, cy + Math.sin(ang) * len);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- shaders

const ICE_VERT = /* glsl */`
varying vec3 vWorld;
varying vec2 vUv;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const ICE_FRAG = /* glsl */`
precision highp float;
varying vec3 vWorld;
varying vec2 vUv;
uniform sampler2D uScratch;  // r scratch height, g powder, b worn white
uniform sampler2D uDetail;   // r fine scratches
uniform sampler2D uMask;     // r resurfaced-smooth, g wetness
uniform vec3 uCamPos;
uniform vec3 uLights[6];
uniform float uTime;

float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float iceHeight(vec2 uv, float m){
  vec3 s = texture2D(uScratch, uv).rgb;
  float d = texture2D(uDetail, uv * vec2(7.0, 11.9)).r;
  float h = s.r * 0.8 + d * 0.55 * (0.35 + 0.65 * clamp(s.r * 2.0 + s.b, 0.0, 1.0));
  return h * (1.0 - 0.96 * m);   // conditioner pass shaves scratches away
}

vec3 linesColor(vec2 p, out float lm){
  lm = 0.0;
  vec3 col = vec3(0.0);
  float w;
  w = 1.0 - smoothstep(0.13, 0.18, abs(p.y));                    // red center line
  col = mix(col, vec3(0.72, 0.13, 0.16), step(0.01,w)); lm = max(lm, w);
  w = 1.0 - smoothstep(0.13, 0.18, abs(abs(p.y) - 6.0));          // blue lines
  col = mix(col, vec3(0.12, 0.24, 0.60), w); lm = max(lm, w);
  w = 1.0 - smoothstep(0.035, 0.07, abs(abs(p.y) - 13.0));        // goal lines
  col = mix(col, vec3(0.72, 0.13, 0.16), w); lm = max(lm, w);
  float r = length(p);
  w = 1.0 - smoothstep(0.05, 0.10, abs(r - 2.2));                 // center circle
  col = mix(col, vec3(0.12, 0.24, 0.60), w); lm = max(lm, w);
  for (int i = 0; i < 4; i++){
    vec2 c = vec2(i < 2 ? -5.0 : 5.0, (i == 0 || i == 2) ? -9.0 : 9.0);
    float rr = length(p - c);
    float fr = 1.0 - smoothstep(0.05, 0.10, abs(rr - 1.8));
    float fd = 1.0 - smoothstep(0.16, 0.24, rr);
    w = max(fr, fd);
    col = mix(col, vec3(0.72, 0.13, 0.16), w); lm = max(lm, w);
  }
  return col;
}

void main(){
  vec2 uv = vUv;
  vec4 mask = texture2D(uMask, uv);
  float m = mask.r;          // resurfaced
  float wet = mask.g;        // fresh water film (decays over seconds)

  vec3 s = texture2D(uScratch, uv).rgb;
  float powder = s.g * (1.0 - 0.97 * m);
  float worn = s.b;

  // normal from scratch height field — only the band changes continuously
  vec2 e = vec2(1.0 / 1024.0);
  float h  = iceHeight(uv, m);
  float hx = iceHeight(uv + vec2(e.x, 0.0), m);
  float hy = iceHeight(uv + vec2(0.0, e.y), m);
  float bump = 20.0;
  vec3 N = normalize(vec3(-(hx - h) * bump, 1.0, (hy - h) * bump));

  float lm;
  vec3 lc = linesColor(vec2(vWorld.x, vWorld.z), lm);

  // ice body: white layers below, embedded painted lines, faint cloudiness.
  // Lines and inner white stay visible in the resurfaced band too.
  vec3 deep = mix(vec3(0.795, 0.845, 0.885), vec3(0.93, 0.95, 0.965), worn * 0.9);
  vec3 alb = mix(deep, lc, lm * 0.52);
  alb = mix(alb, vec3(0.975, 0.98, 0.985), clamp(powder * 1.5, 0.0, 1.0) * 0.85);
  alb = mix(alb, alb * vec3(0.955, 0.98, 1.0), m * 0.55);   // clean ice reads cooler
  alb *= 1.0 - 0.10 * wet;                       // thin film darkens slightly
  alb = mix(alb, alb * vec3(0.94, 0.97, 1.0), wet * 0.6);

  float rough = 0.42 + 0.4 * clamp(s.r * 1.4 + powder, 0.0, 1.0);
  rough = mix(rough, 0.15, m);                   // smooth band
  rough = mix(rough, 0.045, clamp(wet, 0.0, 1.0) * 0.9);

  vec3 V = normalize(uCamPos - vWorld);
  vec3 col = alb * (0.50 + 0.16 * N.y);

  for (int i = 0; i < 6; i++){
    vec3 Ld = uLights[i] - vWorld;
    float d2 = dot(Ld, Ld);
    Ld = normalize(Ld);
    vec3 H = normalize(Ld + V);
    float ndl = max(dot(N, Ld), 0.0);
    col += alb * ndl * (62.0 / d2);
    float shin = mix(700.0, 9.0, rough);
    float spec = pow(max(dot(N, H), 0.0), shin) * (shin + 2.0) * 0.012;
    col += vec3(1.0, 0.99, 0.965) * spec * (85.0 / d2) * mix(0.55, 1.35, m + wet * 0.5);
  }

  // neutral arena sheen (fresnel) — calmer reflection on the resurfaced band
  float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
  col += vec3(0.42, 0.45, 0.49) * fres * mix(0.14, 0.55, m) * (1.0 - 0.35 * powder);

  // powder sparkle
  float spk = hash12(floor(vUv * vec2(950.0, 1600.0)));
  col += vec3(1.0) * step(0.994, spk) * powder * 0.55;

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const DECAY_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D uPrev;
uniform float uSub;
void main(){
  vec4 p = texture2D(uPrev, vUv);
  p.g = max(0.0, p.g - uSub * (0.35 + p.g));  // film settles over ~10s
  gl_FragColor = p;
}`;

const STAMP_VERT = /* glsl */`
attribute vec2 aVal;   // x: smooth amount, y: wetness
attribute float aEdge; // -1..1 across band width
varying vec2 vVal;
varying float vEdge;
void main(){
  vVal = aVal;
  vEdge = aEdge;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const STAMP_FRAG = /* glsl */`
precision highp float;
varying vec2 vVal;
varying float vEdge;
void main(){
  float feather = 1.0 - smoothstep(0.86, 1.0, abs(vEdge));
  gl_FragColor = vec4(vVal.x * feather, vVal.y * feather, 0.0, 1.0);
}`;

// ---------------------------------------------------------------- rink

const MAX_QUADS = 512;

export class IceRink {
  constructor(renderer) {
    this.renderer = renderer;

    const mk = () => new THREE.WebGLRenderTarget(MASK_RES, MASK_RES, {
      depthBuffer: false,
      stencilBuffer: false,
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter
    });
    this.rtA = mk();
    this.rtB = mk();
    this.curr = this.rtA;
    this.other = this.rtB;
    this.pendingDecay = 0;

    // ortho camera in rink meters: NDC(+1 y) ↔ rink v=1 ↔ world z = -halfL
    this.stampCam = new THREE.OrthographicCamera(-RINK.halfW, RINK.halfW, -RINK.halfL, RINK.halfL, -1, 1);
    this.stampCam.position.z = 0.5;

    // decay pass
    this.decayScene = new THREE.Scene();
    const dq = new THREE.PlaneGeometry(2, 2);
    this.decayMat = new THREE.ShaderMaterial({
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy,0.,1.);}`,
      fragmentShader: DECAY_FRAG,
      uniforms: { uPrev: { value: null }, uSub: { value: 0 } },
      depthTest: false, depthWrite: false
    });
    this.decayScene.add(new THREE.Mesh(dq, this.decayMat));

    // stamp pass — dynamic quads, MAX blending so the band only accumulates
    this.stampScene = new THREE.Scene();
    const geo = new THREE.BufferGeometry();
    const verts = MAX_QUADS * 6;
    this.stampPos = new Float32Array(verts * 3);
    this.stampVal = new Float32Array(verts * 2);
    this.stampEdge = new Float32Array(verts);
    geo.setAttribute('position', new THREE.BufferAttribute(this.stampPos, 3));
    geo.setAttribute('aVal', new THREE.BufferAttribute(this.stampVal, 2));
    geo.setAttribute('aEdge', new THREE.BufferAttribute(this.stampEdge, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 100);
    this.stampGeo = geo;
    const smat = new THREE.ShaderMaterial({
      vertexShader: STAMP_VERT,
      fragmentShader: STAMP_FRAG,
      depthTest: false, depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendEquation: THREE.MaxEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor
    });
    this.stampMesh = new THREE.Mesh(geo, smat);
    this.stampMesh.frustumCulled = false;
    this.stampScene.add(this.stampMesh);
    this.quadCount = 0;

    // ice mesh
    this.lightPositions = [
      new THREE.Vector3(-6.5, 12.6, -11), new THREE.Vector3(6.5, 12.6, -11),
      new THREE.Vector3(-6.5, 12.6, 0), new THREE.Vector3(6.5, 12.6, 0),
      new THREE.Vector3(-6.5, 12.6, 11), new THREE.Vector3(6.5, 12.6, 11)
    ];
    const planeGeo = new THREE.PlaneGeometry(RINK.halfW * 2, RINK.halfL * 2, 1, 1);
    planeGeo.rotateX(-Math.PI / 2);
    this.iceMat = new THREE.ShaderMaterial({
      vertexShader: ICE_VERT,
      fragmentShader: ICE_FRAG,
      uniforms: {
        uScratch: { value: makeScratchTexture() },
        uDetail: { value: makeDetailTexture() },
        uMask: { value: this.curr.texture },
        uCamPos: { value: new THREE.Vector3() },
        uLights: { value: this.lightPositions },
        uTime: { value: 0 }
      }
    });
    this.mesh = new THREE.Mesh(planeGeo, this.iceMat);
    this.mesh.renderOrder = 0;

    this.reset();
  }

  reset() {
    const prev = this.renderer.getRenderTarget();
    const oldColor = new THREE.Color();
    this.renderer.getClearColor(oldColor);
    const oldAlpha = this.renderer.getClearAlpha();
    this.renderer.setClearColor(0x000000, 1);
    for (const rt of [this.rtA, this.rtB]) {
      this.renderer.setRenderTarget(rt);
      this.renderer.clear(true, false, false);
    }
    this.renderer.setRenderTarget(prev);
    this.renderer.setClearColor(oldColor, oldAlpha);
    this.iceMat.uniforms.uMask.value = this.curr.texture;
    this.quadCount = 0;
  }

  // queue one quad in world meters. corners: [ax,az, bx,bz, cx,cz, dx,dz]
  // laid out as left/right pairs (a=prevL, b=prevR, c=currL, d=currR)
  _pushQuad(ax, az, bx, bz, cx, cz, dx, dz, smoothV, wetV, feathered) {
    if (this.quadCount >= MAX_QUADS) return;
    const i = this.quadCount * 6;
    const P = this.stampPos, V = this.stampVal, E = this.stampEdge;
    const set = (k, x, z, edge) => {
      P[(i + k) * 3] = x; P[(i + k) * 3 + 1] = z; P[(i + k) * 3 + 2] = 0;
      V[(i + k) * 2] = smoothV; V[(i + k) * 2 + 1] = wetV;
      E[i + k] = feathered ? edge : 0;
    };
    set(0, ax, az, -1); set(1, bx, bz, 1); set(2, cx, cz, -1);
    set(3, bx, bz, 1); set(4, dx, dz, 1); set(5, cx, cz, -1);
    this.quadCount++;
  }

  // conditioner sweep segment: prev/curr left & right edge points (Vector3-like)
  stampConditioner(pL, pR, cL, cR, wet) {
    this._pushQuad(pL.x, pL.z, pR.x, pR.z, cL.x, cL.z, cR.x, cR.z, 1.0, wet, true);
  }

  // faint wet tire print (thin quad along travel)
  stampTireMark(prev, curr, right, halfW, wet) {
    this._pushQuad(
      prev.x - right.x * halfW, prev.z - right.z * halfW,
      prev.x + right.x * halfW, prev.z + right.z * halfW,
      curr.x - right.x * halfW, curr.z - right.z * halfW,
      curr.x + right.x * halfW, curr.z + right.z * halfW,
      0.0, wet, false);
  }

  update(dt, camPos, time) {
    this.iceMat.uniforms.uCamPos.value.copy(camPos);
    this.iceMat.uniforms.uTime.value = time;

    this.pendingDecay += dt * 0.055;
    const prevRT = this.renderer.getRenderTarget();

    if (this.pendingDecay >= 3 / 255) {
      this.decayMat.uniforms.uPrev.value = this.curr.texture;
      this.decayMat.uniforms.uSub.value = this.pendingDecay;
      this.pendingDecay = 0;
      this.renderer.setRenderTarget(this.other);
      this.renderer.render(this.decayScene, this.stampCam);
      const t = this.curr; this.curr = this.other; this.other = t;
      this.iceMat.uniforms.uMask.value = this.curr.texture;
    }

    if (this.quadCount > 0) {
      this.stampGeo.setDrawRange(0, this.quadCount * 6);
      this.stampGeo.attributes.position.needsUpdate = true;
      this.stampGeo.attributes.aVal.needsUpdate = true;
      this.stampGeo.attributes.aEdge.needsUpdate = true;
      const oldAuto = this.renderer.autoClear;
      this.renderer.autoClear = false;
      this.renderer.setRenderTarget(this.curr);
      this.renderer.render(this.stampScene, this.stampCam);
      this.renderer.autoClear = oldAuto;
      this.quadCount = 0;
    }
    this.renderer.setRenderTarget(prevRT);
  }

  // test hook: read mask at world position → {smooth:0..1, wet:0..1}
  readMask(x, z) {
    const u = (x + RINK.halfW) / (RINK.halfW * 2);
    const v = (RINK.halfL - z) / (RINK.halfL * 2);
    const px = Math.max(0, Math.min(MASK_RES - 1, Math.round(u * (MASK_RES - 1))));
    const py = Math.max(0, Math.min(MASK_RES - 1, Math.round(v * (MASK_RES - 1))));
    const buf = new Uint8Array(4);
    this.renderer.readRenderTargetPixels(this.curr, px, py, 1, 1, buf);
    return { smooth: buf[0] / 255, wet: buf[1] / 255 };
  }
}
