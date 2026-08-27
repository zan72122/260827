import * as THREE from 'three';
import { clamp, easeIn, easeInOut, easeOut, lerp, mulberry32, smoothstep, Spring } from './util';
import { sackInteriorTexture, quiltTexture, starSpriteTexture } from './textures';
import { Present, PresentKind } from './presents';

// ---------------------------------------------------------------- StarPoints
/** Instanced billboarded soft sprites. One draw call per field.
 *  Per-instance: offset, scale, phase, arc (for trail dimming). */
export class StarPoints {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  count = 0;
  private cap: number;
  private offsets: Float32Array;
  private scales: Float32Array;
  private phases: Float32Array;
  private arcs: Float32Array;
  private geo: THREE.InstancedBufferGeometry;

  constructor(capacity: number, tex: THREE.Texture, tint: THREE.ColorRepresentation, opacity: number) {
    this.cap = capacity;
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.attributes.position);
    geo.setAttribute('uv', base.attributes.uv);
    this.offsets = new Float32Array(capacity * 3);
    this.scales = new Float32Array(capacity);
    this.phases = new Float32Array(capacity);
    this.arcs = new Float32Array(capacity).fill(1e9);
    geo.setAttribute('iOffset', new THREE.InstancedBufferAttribute(this.offsets, 3));
    geo.setAttribute('iScale', new THREE.InstancedBufferAttribute(this.scales, 1));
    geo.setAttribute('iPhase', new THREE.InstancedBufferAttribute(this.phases, 1));
    geo.setAttribute('iArc', new THREE.InstancedBufferAttribute(this.arcs, 1));
    geo.instanceCount = 0;
    this.geo = geo;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uOpacity: { value: opacity },
        uTint: { value: new THREE.Color(tint) },
        uPassed: { value: -1e9 },
        uMap: { value: tex },
      },
      vertexShader: /* glsl */`
        attribute vec3 iOffset;
        attribute float iScale;
        attribute float iPhase;
        attribute float iArc;
        uniform float uTime;
        varying vec2 vUv;
        varying float vTw;
        varying float vArc;
        void main() {
          vUv = uv;
          vArc = iArc;
          vTw = 0.72 + 0.28 * sin(uTime * (0.9 + fract(iPhase) * 1.4) + iPhase * 7.1);
          vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          vec3 p = iOffset + (right * position.x + up * position.y) * iScale;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D uMap;
        uniform vec3 uTint;
        uniform float uOpacity;
        uniform float uPassed;
        varying vec2 vUv;
        varying float vTw;
        varying float vArc;
        void main() {
          vec4 tex = texture2D(uMap, vUv);
          float dim = vArc < uPassed ? 0.5 : 1.0;
          gl_FragColor = vec4(uTint * tex.rgb, tex.a) * vTw * uOpacity * dim;
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
  }

  add(x: number, y: number, z: number, scale: number, phase: number, arc = 1e9) {
    if (this.count >= this.cap) return;
    const i = this.count++;
    this.offsets[i * 3] = x; this.offsets[i * 3 + 1] = y; this.offsets[i * 3 + 2] = z;
    this.scales[i] = scale;
    this.phases[i] = phase;
    this.arcs[i] = arc;
  }

  commit() {
    for (const name of ['iOffset', 'iScale', 'iPhase', 'iArc']) {
      (this.geo.getAttribute(name) as THREE.InstancedBufferAttribute).needsUpdate = true;
    }
    this.geo.instanceCount = this.count;
  }

  clear() { this.count = 0; this.geo.instanceCount = 0; }

  setTime(t: number) { this.material.uniforms.uTime.value = t; }
  setPassed(s: number) { this.material.uniforms.uPassed.value = s; }
  setOpacity(o: number) { this.material.uniforms.uOpacity.value = o; }

  dispose() {
    this.geo.dispose();
    this.material.dispose();
  }
}

// ---------------------------------------------------------------- helpers
/** Tube with varying radius along a curve (for the fabric tunnel). */
function variableTube(curve: THREE.Curve<THREE.Vector3>, seg: number, radial: number,
  radiusFn: (t: number) => number): THREE.BufferGeometry {
  const frames = curve.computeFrenetFrames(seg, false);
  const positions: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  const p = new THREE.Vector3();
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    curve.getPointAt(t, p);
    const r = radiusFn(t);
    const N = frames.normals[Math.min(i, seg - 1)];
    const B = frames.binormals[Math.min(i, seg - 1)];
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const x = p.x + (Math.cos(a) * N.x + Math.sin(a) * B.x) * r;
      const y = p.y + (Math.cos(a) * N.y + Math.sin(a) * B.y) * r;
      const z = p.z + (Math.cos(a) * N.z + Math.sin(a) * B.z) * r;
      positions.push(x, y, z);
      uvs.push(j / radial * 4, t * 6);
    }
  }
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = a + radial + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export interface Bay {
  anchor: THREE.Vector3;       // where captured presents glide to (above platform)
  platformTop: number;
  slots: THREE.Vector3[];
  used: number;
  light: THREE.PointLight;
}

// ---------------------------------------------------------------- InsideScene
export class InsideScene {
  scene = new THREE.Scene();
  tunnelCurve!: THREE.CatmullRomCurve3;
  bays: Bay[] = [];
  private bayRims: THREE.MeshBasicMaterial[] = [];
  presentSpot = new THREE.Vector3(0, 2.4, 5.2);
  private starTex = starSpriteTexture();
  private fields: StarPoints[] = [];
  private pathDusts: StarPoints[] = [];
  private guide: StarPoints | null = null;
  private guideCurve: THREE.CatmullRomCurve3 | null = null;
  /** headlamp that rides with the camera through the tunnel */
  travelLight = new THREE.PointLight(0xffd9b0, 0, 16, 2);
  /** soft warm light that follows the travelling present (keeps it readable) */
  presentLight = new THREE.PointLight(0xffe0b8, 9, 7, 2);
  /** celebration burst on arrival */
  private burst: StarPoints | null = null;
  private burstAge = 0;
  private buildSteps: (() => void)[] = [];
  built = false;
  time = 0;
  /** stored presents kept in scene between visits */
  stored: Present[] = [];

  // camera rest poses: raised, looking down into the depth of the warehouse,
  // so a drawn stroke maps stably onto the draw surface below
  restPosLandscape = new THREE.Vector3(0, 8.5, 14);
  restTargetLandscape = new THREE.Vector3(0, 1.0, -10);
  restPosPortrait = new THREE.Vector3(0, 10, 15);
  restTargetPortrait = new THREE.Vector3(0, 0.5, -9);
  /** invisible tilted sheet through the present + bays; strokes land on it */
  drawPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -2);

  constructor() {
    this.scene.fog = new THREE.FogExp2(0x160709, 0.015);
    this.scene.background = new THREE.Color(0x0e0407);
    const interiorTex = sackInteriorTexture();

    this.scene.add(this.travelLight);
    this.scene.add(this.presentLight);
    // Build in chunks so we can preload across frames while the child drags.
    this.buildSteps = [
      () => this.buildWalls(interiorTex),
      () => this.buildTunnel(interiorTex),
      () => this.buildStars(),
      () => this.buildBays(interiorTex),
      () => this.buildSeamPaths(),
      () => this.buildForeground(interiorTex),
    ];
  }

  /** advance lazy construction; returns true when fully built */
  buildStep(): boolean {
    const s = this.buildSteps.shift();
    if (s) s();
    this.built = this.buildSteps.length === 0;
    return this.built;
  }
  buildAll() { while (!this.buildStep()) { /* run remaining steps */ } }

  private buildWalls(tex: THREE.Texture) {
    // giant fabric cavern: near the mouth the red weave reads as a cave wall,
    // deeper it darkens into the star space (fog does the abstraction)
    const wallMat = new THREE.MeshStandardMaterial({
      map: tex, roughness: 1, side: THREE.BackSide,
      color: 0xcfa8a8, emissive: 0x200a0d, emissiveIntensity: 1,
    });
    wallMat.map!.repeat.set(5, 3);
    const sphere = new THREE.SphereGeometry(48, 48, 32);
    // wrinkle the cavern like hanging cloth
    const pos = sphere.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const theta = Math.atan2(v.z, v.x);
      const k = 1 + Math.sin(theta * 9 + v.y * 0.13) * 0.03 + Math.sin(theta * 23) * 0.012;
      v.multiplyScalar(k);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    sphere.computeVertexNormals();
    const walls = new THREE.Mesh(sphere, wallMat);
    walls.position.set(0, 4, -8);
    this.scene.add(walls);

    // low warm base light — bays / mouth / path carry the real light
    this.scene.add(new THREE.AmbientLight(0x3a2026, 2.6));
    this.scene.add(new THREE.HemisphereLight(0x5a3240, 0x140608, 0.75));
    const mouthGlow = new THREE.PointLight(0xffdcb0, 70, 50, 2);
    mouthGlow.position.set(0, 6, 13);
    this.scene.add(mouthGlow);
    // shaft of light falling from the (unseen) mouth above onto the arrival
    // spot — the reminder that the way in is up there
    const shaftCanvas = document.createElement('canvas');
    shaftCanvas.width = 64; shaftCanvas.height = 256;
    const sg2 = shaftCanvas.getContext('2d')!;
    const shaftGrad = sg2.createLinearGradient(0, 0, 0, 256);
    shaftGrad.addColorStop(0, 'rgba(255,225,180,0.30)');
    shaftGrad.addColorStop(1, 'rgba(255,225,180,0.0)');
    sg2.fillStyle = shaftGrad;
    sg2.fillRect(0, 0, 64, 256);
    const shaftTex = new THREE.CanvasTexture(shaftCanvas);
    shaftTex.colorSpace = THREE.SRGBColorSpace;
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.9, 1.9, 15, 20, 1, true),
      new THREE.MeshBasicMaterial({
        map: shaftTex, transparent: true, opacity: 0.3, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    shaft.position.set(0, 9.5, 5.2);
    this.scene.add(shaft);
  }

  private buildTunnel(tex: THREE.Texture) {
    this.tunnelCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 27, 26),
      new THREE.Vector3(0, 19, 24.5),
      new THREE.Vector3(0, 11, 21.5),
      new THREE.Vector3(0, 6, 17.5),
      new THREE.Vector3(0, 3.6, 12.5),
    ]);
    const mat = new THREE.MeshStandardMaterial({
      map: tex.clone(), roughness: 1, side: THREE.BackSide, color: 0xe0c0c0,
      emissive: 0x2a0d0f, emissiveIntensity: 1,
    });
    mat.map!.repeat.set(3, 5);
    const geo = variableTube(this.tunnelCurve, 60, 24, (t) => 2.3 + easeIn(t) * 7.5);
    const tunnel = new THREE.Mesh(geo, mat);
    this.scene.add(tunnel);
    // light inside the tunnel so the weave (and the present) read while flying
    for (const [u, inten] of [[0.25, 55], [0.6, 45], [0.88, 40]] as const) {
      const tl = new THREE.PointLight(0xffc9a0, inten, 26, 2);
      tl.position.copy(this.tunnelCurve.getPointAt(u));
      this.scene.add(tl);
    }
    // the mouth seen from inside: bright warm disc far up the tunnel
    const mouthDisc = new THREE.Mesh(
      new THREE.CircleGeometry(2.0, 32),
      new THREE.MeshBasicMaterial({ color: 0xffe8c4, transparent: true, opacity: 0.9 })
    );
    mouthDisc.position.set(0, 27.5, 26);
    mouthDisc.rotation.x = Math.PI / 2;
    this.scene.add(mouthDisc);
  }

  private buildStars() {
    const rand = mulberry32(42);
    const mk = (count: number, rMin: number, rMax: number, sMin: number, sMax: number, opacity: number, tint: number) => {
      const f = new StarPoints(count, this.starTex, tint, opacity);
      for (let i = 0; i < count; i++) {
        // biased into the deep half of the cavern
        const a = rand() * Math.PI * 2;
        const cosb = rand() * 1.6 - 0.8;
        const b = Math.acos(clamp(cosb, -1, 1));
        const r = lerp(rMin, rMax, Math.cbrt(rand()));
        const x = r * Math.sin(b) * Math.cos(a);
        const y = 4 + r * Math.cos(b) * 0.7;
        const z = -8 - r * 0.55 + r * Math.sin(b) * Math.sin(a) * 0.6;
        f.add(x, y, z, lerp(sMin, sMax, rand()), rand() * 10);
      }
      f.commit();
      this.scene.add(f.mesh);
      this.fields.push(f);
    };
    mk(150, 6, 16, 0.16, 0.34, 1.0, 0xfff2d8);   // near: few, larger
    mk(500, 14, 28, 0.10, 0.20, 0.85, 0xffe8c8); // mid
    mk(1700, 26, 44, 0.06, 0.12, 0.6, 0xffdfc0); // far: many, dim
  }

  private buildBays(tex: THREE.Texture) {
    const quilt = quiltTexture();
    const defs = [
      { p: new THREE.Vector3(-6.6, 1.0, -13.5), c: 0xffc287 },
      { p: new THREE.Vector3(0.4, 4.2, -21), c: 0xffd9a0 },
      { p: new THREE.Vector3(6.4, 1.6, -11.5), c: 0xffb890 },
    ];
    for (const d of defs) {
      const g = new THREE.Group();
      g.position.copy(d.p);
      // quilted platform: a giant padded patch of the sack lining
      const platMat = new THREE.MeshStandardMaterial({
        map: quilt, roughness: 0.9, emissive: 0x30121a, emissiveIntensity: 0.8,
      });
      const plat = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 3.9, 0.85, 28), platMat);
      plat.position.y = -0.45;
      g.add(plat);
      // rim stitching glow — restrained
      const rimMat = new THREE.MeshBasicMaterial({ color: 0xffd9a8, transparent: true, opacity: 0.7 });
      const rim = new THREE.Mesh(new THREE.TorusGeometry(3.55, 0.045, 8, 48), rimMat);
      rim.rotation.x = Math.PI / 2;
      rim.position.y = -0.02;
      g.add(rim);
      this.bayRims.push(rimMat);
      // fabric-fold backdrop: pleated curtain panels derived from the sack cloth
      const pleatMat = new THREE.MeshStandardMaterial({
        map: tex, roughness: 1, side: THREE.DoubleSide, color: 0xf0caca,
        emissive: 0x1c0a0d, emissiveIntensity: 1,
      });
      // giant curtain pleats of the lining, hanging from far above like
      // folds of cloth — uneven heights, leaning slightly outward
      for (let i = 0; i < 6; i++) {
        const ang = -0.78 + (i / 5) * 1.56; // arc behind (away from camera at +z)
        const rr = 1.3 + (i % 3) * 0.35;
        const panel = new THREE.Mesh(
          new THREE.CylinderGeometry(rr, rr + 0.6, 17 + (i % 2) * 4, 10, 6, true, 0, 1.6), pleatMat);
        panel.position.set(Math.sin(ang) * (4.4 + (i % 2) * 0.9), 4.5 + (i % 3), -Math.cos(ang) * (4.4 + (i % 2) * 0.9));
        panel.rotation.y = -ang + Math.PI + (i % 2 ? 0.15 : -0.1);
        panel.rotation.z = (i % 2 ? 0.04 : -0.05);
        g.add(panel);
      }
      // warm pool of light — one of the few light sources inside
      const light = new THREE.PointLight(d.c, 110, 30, 2);
      light.position.set(0, 3.4, 1);
      g.add(light);
      const glowDisc = new THREE.Mesh(
        new THREE.CircleGeometry(4.4, 28),
        new THREE.MeshBasicMaterial({ color: d.c, transparent: true, opacity: 0.16, depthWrite: false })
      );
      glowDisc.rotation.x = -Math.PI / 2;
      glowDisc.position.y = 0.02;
      g.add(glowDisc);
      this.scene.add(g);

      const slots: THREE.Vector3[] = [];
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + 0.4;
        const r = i === 0 ? 0 : 2.0;
        slots.push(new THREE.Vector3(d.p.x + Math.cos(a) * r, d.p.y, d.p.z + Math.sin(a) * r * 0.8));
      }
      this.bays.push({
        anchor: d.p.clone().add(new THREE.Vector3(0, 1.6, 1.5)),
        platformTop: d.p.y,
        slots, used: 0, light,
      });
    }
    this.drawPlane.setFromCoplanarPoints(
      this.presentSpot, this.bays[0].anchor, this.bays[2].anchor);
    // normal should face up toward the camera
    if (this.drawPlane.normal.y < 0) {
      this.drawPlane.normal.negate();
      this.drawPlane.constant = -this.drawPlane.constant;
    }
  }

  private buildSeamPaths() {
    // seam threads run from the tunnel mouth into the dark and become star lanes
    const start = new THREE.Vector3(0, 11.5, 13.5);
    const stitchTexCanvas = document.createElement('canvas');
    stitchTexCanvas.width = 64; stitchTexCanvas.height = 8;
    const sg = stitchTexCanvas.getContext('2d')!;
    sg.fillStyle = '#000';
    sg.fillRect(0, 0, 64, 8);
    sg.fillStyle = '#ffd9a8';
    for (let x = 0; x < 64; x += 16) sg.fillRect(x, 1, 9, 6);
    const stitchTex = new THREE.CanvasTexture(stitchTexCanvas);
    stitchTex.wrapS = THREE.RepeatWrapping;
    stitchTex.colorSpace = THREE.SRGBColorSpace;

    const lane = new StarPoints(400, this.starTex, 0xffe9c8, 0.6);
    for (const bay of this.bays) {
      const mid = start.clone().lerp(bay.anchor, 0.45);
      mid.y += 2.5;
      const curve = new THREE.CatmullRomCurve3([start.clone(), mid, bay.anchor.clone()]);
      // first stretch: literal stitched thread
      const seg = new THREE.CatmullRomCurve3(
        [0, 0.12, 0.24, 0.38].map((t) => curve.getPointAt(t)));
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(seg, 24, 0.02, 6),
        new THREE.MeshBasicMaterial({
          map: stitchTex, transparent: true, opacity: 0.38,
          blending: THREE.AdditiveBlending, depthWrite: false,
        })
      );
      (tube.material as THREE.MeshBasicMaterial).map!.repeat.set(26, 1);
      this.scene.add(tube);
      // rest: the thread frays into a lane of stars
      const len = curve.getLength();
      const n = Math.floor(len / 1.4);
      for (let i = Math.floor(n * 0.36); i <= n; i++) {
        const p = curve.getPointAt(i / n);
        const fade = smoothstep(0.3, 0.55, i / n);
        lane.add(
          p.x + (Math.random() - 0.5) * 0.5 * fade,
          p.y + (Math.random() - 0.5) * 0.5 * fade,
          p.z + (Math.random() - 0.5) * 0.5 * fade,
          0.09 + Math.random() * 0.07, Math.random() * 10);
      }
    }
    lane.commit();
    this.scene.add(lane.mesh);
    this.fields.push(lane);
  }

  private buildForeground(tex: THREE.Texture) {
    // near-field: giant threads and a fold of cloth at the frame edges,
    // so the eye reads "we are inside enormous fabric"
    const threadMat = new THREE.MeshStandardMaterial({
      color: 0x9a4a40, roughness: 0.8, emissive: 0x2a0d0a, emissiveIntensity: 1,
    });
    const mkThread = (pts: THREE.Vector3[], r: number) => {
      const c = new THREE.CatmullRomCurve3(pts);
      const m = new THREE.Mesh(new THREE.TubeGeometry(c, 32, r, 6), threadMat);
      this.scene.add(m);
    };
    mkThread([
      new THREE.Vector3(-14, 12, 6), new THREE.Vector3(-7, 7, 5),
      new THREE.Vector3(-4, 2, 6), new THREE.Vector3(-6, -4, 8),
    ], 0.16);
    mkThread([
      new THREE.Vector3(12, 14, 4), new THREE.Vector3(8, 8, 5),
      new THREE.Vector3(7, 1, 7), new THREE.Vector3(9, -5, 9),
    ], 0.12);
    const foldMat = new THREE.MeshStandardMaterial({
      map: tex.clone(), roughness: 1, color: 0xd8b0b0, side: THREE.DoubleSide,
      emissive: 0x1c0a0d, emissiveIntensity: 1,
    });
    foldMat.map!.repeat.set(2, 2);
    for (const s of [-1, 1]) {
      const fold = new THREE.Mesh(new THREE.CylinderGeometry(3, 4.5, 22, 12, 4, true, 0, 1.6), foldMat);
      fold.position.set(s * 15, 2, 2);
      fold.rotation.y = s > 0 ? Math.PI + 0.8 : -0.8;
      this.scene.add(fold);
    }
    const fillThread = new THREE.PointLight(0xffc9a0, 20, 20, 2);
    fillThread.position.set(0, 5, 8);
    this.scene.add(fillThread);
  }

  /** first-time guide: a short, clear dotted invitation toward the nearest bay */
  showGuide(from: THREE.Vector3) {
    this.hideGuide();
    const bay = this.bays[0];
    const mid = from.clone().lerp(bay.anchor, 0.5);
    mid.y += 1.5;
    const curve = new THREE.CatmullRomCurve3([from.clone(), mid, bay.anchor.clone()]);
    const g = new StarPoints(26, this.starTex, 0xfff3d0, 1.0);
    for (let i = 1; i <= 16; i++) {
      const p = curve.getPointAt(i / 16);
      g.add(p.x, p.y, p.z, 0.38, i * 0.55); // phases in order -> travelling pulse
    }
    // one bright comet sweeping along the suggested path, over and over
    g.add(from.x, from.y, from.z, 0.6, 0);
    g.commit();
    this.scene.add(g.mesh);
    this.guide = g;
    this.guideCurve = curve;
  }
  hideGuide() {
    if (this.guide) {
      this.scene.remove(this.guide.mesh);
      this.guide.dispose();
      this.guide = null;
      this.guideCurve = null;
    }
  }

  /** create a dust ribbon for a newly drawn path */
  newPathDust(): StarPoints {
    const d = new StarPoints(1400, this.starTex, 0xffeccb, 1.0);
    this.scene.add(d.mesh);
    this.pathDusts.push(d);
    // keep only the last few trails so the space stays calm
    while (this.pathDusts.length > 5) {
      const old = this.pathDusts.shift()!;
      this.scene.remove(old.mesh);
      old.dispose();
    }
    return d;
  }

  /** fade older trails to a faint imprint */
  archiveTrails() {
    for (const d of this.pathDusts) {
      d.setPassed(1e12);
      d.setOpacity(Math.max(0.42, d.material.uniforms.uOpacity.value * 0.8));
    }
  }

  /** celebration sparkle burst when a present reaches its bay */
  celebrate(at: THREE.Vector3, bayIndex: number) {
    if (this.burst) {
      this.scene.remove(this.burst.mesh);
      this.burst.dispose();
    }
    const b = new StarPoints(48, this.starTex, 0xfff0c8, 1.0);
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const r = 0.4 + Math.random() * 2.6;
      b.add(
        at.x + Math.cos(a) * r,
        at.y + Math.random() * 2.8 - 0.4,
        at.z + Math.sin(a) * r,
        0.3 + Math.random() * 0.32, Math.random() * 10);
    }
    b.commit();
    this.scene.add(b.mesh);
    this.burst = b;
    this.burstAge = 0;
    this.bays[bayIndex].light.intensity = 260; // flare, decays in update()
  }

  storePresent(p: Present, bayIndex: number): THREE.Vector3 {
    const bay = this.bays[bayIndex];
    const slot = bay.slots[bay.used % bay.slots.length];
    bay.used++;
    this.stored.push(p);
    return slot.clone();
  }

  restPos(portrait: boolean) { return portrait ? this.restPosPortrait : this.restPosLandscape; }
  restTarget(portrait: boolean) { return portrait ? this.restTargetPortrait : this.restTargetLandscape; }

  update(dt: number) {
    this.time += dt;
    for (const f of this.fields) f.setTime(this.time);
    // celebration burst fades out; bay flare settles back down
    if (this.burst) {
      this.burstAge += dt;
      this.burst.setTime(this.time * 2);
      this.burst.setOpacity(Math.max(0, 1 - this.burstAge / 2.2));
      if (this.burstAge > 2.2) {
        this.scene.remove(this.burst.mesh);
        this.burst.dispose();
        this.burst = null;
      }
    }
    for (const bay of this.bays) {
      if (bay.light.intensity > 110) bay.light.intensity = Math.max(110, bay.light.intensity - dt * 200);
    }
    // rims breathe gently — "here is a good place"
    this.bayRims.forEach((m, i) => {
      m.opacity = 0.5 + 0.28 * (0.5 + 0.5 * Math.sin(this.time * 1.7 + i * 2.1));
    });
    for (const d of this.pathDusts) d.setTime(this.time);
    if (this.guide && this.guideCurve) {
      this.guide.setTime(this.time * 2.2);
      const t = (this.time * 0.3) % 1;
      const p = this.guideCurve.getPointAt(t);
      const i = this.guide.count - 1;
      const off = this.guide.mesh.geometry.getAttribute('iOffset') as THREE.InstancedBufferAttribute;
      off.setXYZ(i, p.x, p.y, p.z);
      off.needsUpdate = true;
    }
    // stored plush presents keep floating gently
    for (const p of this.stored) {
      if (p.kind === 'plush') {
        p.group.position.y = p.group.userData.baseY + Math.sin(this.time * 0.9 + p.group.userData.phase) * 0.12;
      }
    }
  }
}

// ---------------------------------------------------------------- PathSystem
/** One-finger thick path drawing + delayed spline following. */
export class PathSystem {
  pts: THREE.Vector3[] = [];
  cum: number[] = [];
  private lastDir = new THREE.Vector3(0, 0, -1);
  totalLen = 0;
  sPresent = 0;
  dust: StarPoints | null = null;
  active = false;
  fingerDown = false;
  private speed = 0;
  private prevTangent = new THREE.Vector3(0, 0, -1);
  curvature = 0;

  begin(start: THREE.Vector3, dust: StarPoints) {
    this.pts = [start.clone()];
    this.cum = [0];
    this.totalLen = 0;
    this.sPresent = 0;
    this.speed = 0;
    this.dust = dust;
    this.active = true;
    this.fingerDown = true;
    this.lastDir.set(0, 0.2, -1).normalize();
  }

  /** feed a world-space finger point; extends the smoothed polyline */
  feed(world: THREE.Vector3) {
    if (!this.active) return;
    const SPACING = 0.5;
    let guard = 0;
    let last = this.pts[this.pts.length - 1];
    while (last.distanceTo(world) > SPACING && guard++ < 40) {
      const want = world.clone().sub(last).normalize();
      // gentle corner smoothing: direction can only turn so fast
      this.lastDir.lerp(want, 0.42).normalize();
      const next = last.clone().addScaledVector(this.lastDir, SPACING);
      this.pts.push(next);
      this.totalLen += SPACING;
      this.cum.push(this.totalLen);
      // stardust settles along the drawn line
      if (this.dust) {
        for (let k = 0; k < 3; k++) {
          this.dust.add(
            next.x + (Math.random() - 0.5) * 0.5,
            next.y + (Math.random() - 0.5) * 0.5,
            next.z + (Math.random() - 0.5) * 0.5,
            0.15 + Math.random() * 0.16,
            Math.random() * 10,
            this.totalLen
          );
        }
        this.dust.commit();
      }
      last = next;
    }
  }

  release() { this.fingerDown = false; }

  sample(s: number, out: THREE.Vector3) {
    if (this.pts.length === 0) return out.set(0, 0, 0);
    if (this.pts.length === 1) return out.copy(this.pts[0]);
    s = clamp(s, 0, this.totalLen);
    let i = 1;
    while (i < this.cum.length - 1 && this.cum[i] < s) i++;
    const t = (s - this.cum[i - 1]) / Math.max(1e-5, this.cum[i] - this.cum[i - 1]);
    return out.copy(this.pts[i - 1]).lerp(this.pts[i], t);
  }

  /** advance the follower; returns {pos, tangent, speed, curvature} */
  private _p0 = new THREE.Vector3();
  private _p1 = new THREE.Vector3();
  update(dt: number, out: { pos: THREE.Vector3; tangent: THREE.Vector3 }) {
    // the present trails the drawing front, catches up, eases to a stop
    const gap = this.fingerDown ? 1.2 : 0;
    const target = Math.max(0, this.totalLen - gap);
    const want = clamp((target - this.sPresent) * 2.4, 0, 10);
    this.speed = lerp(this.speed, want, 1 - Math.exp(-dt * 5));
    this.sPresent = Math.min(this.sPresent + this.speed * dt, this.totalLen);
    this.sample(this.sPresent, this._p0);
    this.sample(Math.min(this.sPresent + 0.6, this.totalLen), this._p1);
    out.pos.copy(this._p0);
    const tan = this._p1.sub(this._p0);
    if (tan.lengthSq() > 1e-6) {
      tan.normalize();
      // signed curvature about the view (roughly: horizontal turn)
      const cross = this.prevTangent.clone().cross(tan);
      this.curvature = lerp(this.curvature, clamp(cross.y * 8, -1.2, 1.2), 0.12);
      this.prevTangent.copy(tan);
    }
    out.tangent.copy(this.prevTangent);
    this.dust?.setPassed(this.sPresent);
    return this.speed;
  }

  get done() { return !this.fingerDown && this.totalLen - this.sPresent < 0.05; }
}
