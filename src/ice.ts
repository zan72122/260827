import * as THREE from 'three';
import { GLSL_ICE_ZONES, GLSL_NOISE } from './materials';
import { DEEP_Y, hash1, mulberry32 } from './journey';

const WALL_R = 0.55; // visual borehole wall radius (cutaway convention)

function makeWallMaterial(outer: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      uTime: { value: 0 },
      uExitGlow: { value: 0 },
      uFogColor: { value: new THREE.Color(0x05141f) },
      uOuter: { value: outer ? 1 : 0 },
      uLampY: { value: -58 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWp; varying vec3 vN;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWp = wp.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec3 vWp; varying vec3 vN;
      uniform float uTime; uniform float uExitGlow; uniform float uOuter;
      uniform float uLampY;
      uniform vec3 uFogColor;
      ${GLSL_NOISE}
      ${GLSL_ICE_ZONES}
      void main(){
        if (vWp.y > 0.0) discard; // the ice sheet ends at the snow surface
        float y = vWp.y;
        vec3 c = zoneColor(y);
        float ang = atan(vWp.z, vWp.x);
        vec3 sp = vec3(ang * 2.2, y, 1.0);

        // annual layering: thin at depth, thicker near the top
        float freq = mix(3.2, 1.1, smoothstep(-52.0, -8.0, y));
        float band = vnoise(vec3(1.7, y * freq, 4.2)) - 0.5;
        c *= 1.0 + band * layerAmp(y) * 2.0;

        // ash / dust layers at fixed depths (deterministic landmarks)
        float ash = ashBand(y, -33.5, 0.10) + ashBand(y, -28.2, 0.06) + ashBand(y, -24.7, 0.14);
        c = mix(c, vec3(0.21, 0.185, 0.16), clamp(ash, 0.0, 1.0) * 0.8);
        float dusty = ashBand(y, -21.6, 0.35);
        c = mix(c, vec3(0.42, 0.40, 0.36), dusty * 0.25);

        // wall texture: fbm mottling + faint horizontal cutter marks
        float m = fbm(vec3(sp.x * 2.0, y * 1.4, 8.0));
        c *= 0.78 + m * 0.44;
        // faint vertical crystal streaks
        c *= 1.0 + (vnoise(vec3(sp.x * 9.0, y * 0.3, 2.2)) - 0.5) * 0.12;
        c *= 1.0 + sin(y * 55.0 + vnoise(sp * 3.0) * 6.0) * 0.02 * (1.0 - uOuter);

        // frozen bubbles: sparse sparkle at depth, dense grain in firn
        float dens = bubbleDensity(y);
        float b = vnoise(vWp * 72.0);
        float b2 = vnoise(vWp * 31.0 + 9.7);
        float spark = smoothstep(1.0 - 0.04 - dens * 0.13, 1.0 - dens * 0.13, b) * (0.4 + b2 * 0.6);
        c += spark * vec3(0.7, 0.8, 0.88) * (0.18 + dens * 0.3);
        float grain = fbm(vWp * 58.0) * firnWeight(y);
        c = mix(c, vec3(0.88, 0.92, 0.95), grain * 0.3);

        // working light travelling with the sonde: a soft blue pool
        float lampGlow = exp(-abs(y - uLampY) * 0.38) * (1.0 - uOuter * 0.7);
        c += vec3(0.13, 0.24, 0.34) * lampGlow;

        // light from the exit above + subtle depth absorption facing shading
        float glow = smoothstep(-16.0, -0.3, y) * uExitGlow;
        c = mix(c, vec3(0.86, 0.93, 1.0), glow * 0.6);
        vec3 V = normalize(cameraPosition - vWp);
        float face = max(dot(normalize(vN), V), 0.0);
        c *= mix(0.62, 1.05, face); // thick ice never fully transmits

        // manual fog toward depth ambience
        float d = length(cameraPosition - vWp);
        float fogF = 1.0 - exp(-d * mix(0.055, 0.10, uOuter));
        c = mix(c, uFogColor, fogF * 0.85);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
}

// The borehole world below the surface: near wall half-pipe, distant ice mass,
// recycled BoreholeSegment detail, instanced bubbles, dust, and the exit light.
export class IceWorld {
  group = new THREE.Group();
  private wallMat = makeWallMaterial(false);
  private outerMat = makeWallMaterial(true);
  private wall: THREE.Mesh;
  private outer: THREE.Mesh;
  private segs: THREE.Mesh[] = [];
  private segMat: THREE.MeshStandardMaterial;
  private bubbles: THREE.InstancedMesh;
  private dust: THREE.Points;
  private dustPos: Float32Array;
  private glowCone: THREE.Mesh;
  private glowDisc: THREE.Mesh;
  private seamDown: THREE.Mesh;
  private collar: THREE.Mesh;
  private dummy = new THREE.Object3D();
  bubbleBudget = 1; // AdaptiveQuality scales this

  constructor(parent: THREE.Object3D) {
    const g = this.group;

    this.wall = new THREE.Mesh(new THREE.CylinderGeometry(WALL_R, WALL_R, 44, 40, 44, true), this.wallMat);
    g.add(this.wall);
    this.outer = new THREE.Mesh(new THREE.CylinderGeometry(30, 30, 170, 24, 1, true), this.outerMat);
    this.outer.position.y = -32;
    g.add(this.outer);

    // recycled BoreholeSegment detail arcs (frost collars / ledges on the far wall)
    this.segMat = new THREE.MeshStandardMaterial({
      color: 0xbcd6e8, roughness: 0.85, metalness: 0, transparent: true, opacity: 0.5,
    });
    const segGeo = new THREE.TorusGeometry(WALL_R - 0.015, 0.012, 6, 28, Math.PI);
    segGeo.rotateZ(Math.PI); // arc on the far (-z) side after the X flip below
    segGeo.rotateX(Math.PI / 2);
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(segGeo, this.segMat);
      g.add(m);
      this.segs.push(m);
    }

    // instanced bubbles floating in the cut-open ice around the hole
    const bg = new THREE.SphereGeometry(1, 6, 5);
    const bm = new THREE.MeshBasicMaterial({
      color: 0xcfe6f5, transparent: true, opacity: 0.35,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.bubbles = new THREE.InstancedMesh(bg, bm, 240);
    this.bubbles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    g.add(this.bubbles);

    // drifting dust motes
    const N = 140;
    this.dustPos = new Float32Array(N * 3);
    const rnd = mulberry32(42);
    for (let i = 0; i < N; i++) {
      this.dustPos[i * 3] = (rnd() - 0.5) * 2.2;
      this.dustPos[i * 3 + 1] = rnd() * 30 - 15;
      this.dustPos[i * 3 + 2] = (rnd() - 0.5) * 2.2;
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(this.dustPos, 3));
    this.dust = new THREE.Points(dg, new THREE.PointsMaterial({
      color: 0x9fc4d8, size: 0.02, transparent: true, opacity: 0.5,
      sizeAttenuation: true, depthWrite: false,
    }));
    g.add(this.dust);

    // exit light: additive cone + bright disc in the hole mouth
    const cone = new THREE.ConeGeometry(WALL_R * 0.9, 10, 24, 1, true);
    cone.translate(0, -5, 0);
    this.glowCone = new THREE.Mesh(cone, new THREE.MeshBasicMaterial({
      color: 0xdff0ff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.glowCone.position.y = 0;
    g.add(this.glowCone);
    this.glowDisc = new THREE.Mesh(new THREE.CircleGeometry(0.42, 32), new THREE.MeshBasicMaterial({
      color: 0xf4faff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.glowDisc.rotation.x = Math.PI / 2;
    this.glowDisc.position.y = -0.6; // fills the seam aperture, visible from the deep
    g.add(this.glowDisc);

    // SurfaceSeam: from below, the world above is a dark ceiling with one hole.
    // Sits under the funnel of the hole mouth so the terrain never shows through.
    const seam = new THREE.RingGeometry(0.34, 400, 32, 1);
    seam.rotateX(Math.PI / 2); // faces -Y (visible from below only)
    this.seamDown = new THREE.Mesh(seam, new THREE.MeshBasicMaterial({ color: 0x122a42 }));
    this.seamDown.position.y = -0.62;
    g.add(this.seamDown);

    // hole collar: firn walls of the uppermost metre + frost lip
    this.collar = new THREE.Mesh(
      new THREE.CylinderGeometry(WALL_R * 0.95, WALL_R * 0.98, 1.4, 32, 1, true),
      new THREE.MeshStandardMaterial({ color: 0xdde9f2, roughness: 0.95, side: THREE.BackSide }),
    );
    this.collar.position.y = -0.7;
    g.add(this.collar);
    const lip = new THREE.Mesh(
      new THREE.TorusGeometry(WALL_R * 0.99, 0.045, 8, 40),
      new THREE.MeshStandardMaterial({ color: 0xf3f8fc, roughness: 0.9 }),
    );
    lip.rotation.x = Math.PI / 2;
    lip.position.y = 0.02;
    g.add(lip);

    parent.add(g);
  }

  update(camY: number, time: number, exitGlowV: number, lampY: number, reduced: boolean): void {
    // wall + fog follow the camera; the pattern lives in world space
    this.wall.position.y = Math.min(camY, -22); // top never pokes above the seam
    this.wallMat.uniforms.uTime.value = time;
    this.wallMat.uniforms.uExitGlow.value = exitGlowV;
    this.wallMat.uniforms.uLampY.value = lampY;
    this.outerMat.uniforms.uLampY.value = lampY;
    this.outerMat.uniforms.uExitGlow.value = exitGlowV;
    const deep = THREE.MathUtils.clamp(-camY / 55, 0, 1);
    (this.wallMat.uniforms.uFogColor.value as THREE.Color)
      .setRGB(0.02 + (1 - deep) * 0.25, 0.07 + (1 - deep) * 0.3, 0.14 + (1 - deep) * 0.33);
    (this.outerMat.uniforms.uFogColor.value as THREE.Color)
      .copy(this.wallMat.uniforms.uFogColor.value as THREE.Color);

    // recycled segment rings, deterministic per index (spacing / tone vary)
    const spacing = 4.6;
    const baseIdx = Math.floor(camY / spacing);
    for (let s = 0; s < this.segs.length; s++) {
      const idx = baseIdx - 4 + s;
      const m = this.segs[s];
      const h = hash1(idx * 3.7);
      const y = idx * spacing + h * 2.4;
      if (y > -1.2 || y < DEEP_Y) { m.visible = false; continue; }
      m.visible = true;
      m.position.y = y;
      const sc = 0.97 + hash1(idx * 9.1) * 0.06;
      m.rotation.y = Math.PI + hash1(idx * 2.1) * 1.2 - 0.6; // hug the far wall
      m.scale.set(sc, 1 + hash1(idx * 5.3) * 1.6, sc);
      (m.material as THREE.MeshStandardMaterial).opacity = 0.12 + hash1(idx * 7.7) * 0.25;
    }

    // bubbles: deterministic placement in a window around the camera,
    // density and size follow the depth zone (sparse deep, dense in firn)
    const span = 26;
    const count = Math.floor(240 * this.bubbleBudget);
    let vis = 0;
    for (let i = 0; i < count; i++) {
      const h0 = hash1(i * 1.3), h1 = hash1(i * 2.9), h2 = hash1(i * 4.7), h3 = hash1(i * 6.1);
      const rep = Math.floor((camY - (h0 * span)) / span) * span + h0 * span;
      const y = rep + span / 2;
      if (y > -1 || y < DEEP_Y) continue;
      const dens = 0.12 + 0.78 * THREE.MathUtils.smoothstep(y, -34, -7);
      if (h3 > dens) continue;
      const r = 0.36 + h1 * 0.16; // embedded just inside the far wall face
      const a = h2 * Math.PI * 2 + i;
      const drift = reduced ? 0 : Math.sin(time * (0.3 + h1) + i) * 0.015;
      this.dummy.position.set(Math.sin(a) * r + drift, y + Math.sin(time * 0.2 + i) * (reduced ? 0 : 0.02), Math.cos(a) * r);
      const s = 0.008 + h1 * h1 * 0.03 * (0.6 + dens);
      this.dummy.scale.setScalar(s);
      this.dummy.updateMatrix();
      this.bubbles.setMatrixAt(vis++, this.dummy.matrix);
    }
    this.bubbles.count = vis;
    this.bubbles.instanceMatrix.needsUpdate = true;

    // dust drifts down slowly as the drill rises
    this.dust.position.y = Math.min(camY, -2);
    this.dust.rotation.y = reduced ? 0 : time * 0.02;
    (this.dust.material as THREE.PointsMaterial).opacity = 0.5 * THREE.MathUtils.clamp(-camY / 8, 0, 1);

    // exit light grows as the seam approaches
    (this.glowCone.material as THREE.MeshBasicMaterial).opacity = exitGlowV * 0.16;
    (this.glowDisc.material as THREE.MeshBasicMaterial).opacity =
      exitGlowV * 0.9 * THREE.MathUtils.clamp(-camY / 2, 0, 1);
  }
}
