import * as THREE from 'three';

/**
 * The hero object: one length of Lauscha tubing that becomes an ornament.
 *
 * The whole piece is a surface of revolution whose profile is re-evaluated
 * every frame (a morph, not a fluid sim): a straight tube with a real wall
 * thickness, a closed tip, a swelling bulb, a thin neck, and a gravity sag
 * that only appears where the glass is hot.
 *
 * Local space: the tube axis is +Y and the (closed) tip sits at y = 0, so the
 * group origin is the point the camera looks at during the close-ups.
 * All numbers are metres — a finished ball is ~77 mm across.
 */

const P = {
  tubeR: 0.0060,        // 12 mm tubing
  wall: 0.00135,        // 1.35 mm wall — thick enough to read as glass
  bottom: -0.50,
  tipCap: 0.0095,       // hemispherical closed end
  bulbRMax: 0.0385,
  bulbYc0: -0.014,
  bulbYc1: 0.0245,
  neckY: -0.0205,
  neckSigma: 0.0092,
  neckDepth: 0.56,
  heatY: -0.014,
  heatSigma: 0.021,
  cutY: -0.030,         // where the tweezers take the piece off the tube
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const gauss = (y, c, s) => Math.exp(-Math.pow((y - c) / s, 2));
const _q = new THREE.Quaternion();

export class GlassPiece {
  constructor(env, quality) {
    this.env = env;
    this.nSeg = quality.lathe.rings;
    this.nHalf = Math.floor(quality.lathe.contour / 2);
    this.nC = this.nHalf * 2;

    this.group = new THREE.Group();
    this.spinner = new THREE.Group();          // rotates about the tube axis
    this.group.add(this.spinner);

    // The heat is stored per angular sector of the material itself, so the
    // side facing the flame is the side that glows. Turning the tube is what
    // carries every sector through the flame - which is the whole lesson.
    this.SECT = 24;
    this.ang = new Float32Array(this.SECT);
    this.angSmooth = new Float32Array(this.SECT);
    this.flamePhase = 0;          // local angle that currently faces the flame

    this.state = {
      heat: 0, bulge: 0, bulgeVel: 0, bulgeTarget: 0,
      silver: 0, tint: 0, glitter: 0, cut: 0,
      spin: 0, wobble: 0, wobblePhase: 0, sag: 0,
    };
    this.gravityLocal = new THREE.Vector3(0, -1, 0);

    this._buildMeshes();
    this._buildSeeds();
    this._buildFittings();
    this.rebuild();
  }

  // ---------------------------------------------------------------- geometry

  _makeLathe(nC, nSeg, withHeat) {
    const verts = nC * (nSeg + 1);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(verts * 2), 2));
    if (withHeat) geo.setAttribute('aHeat', new THREE.BufferAttribute(new Float32Array(verts), 1));
    const idx = [];
    for (let i = 0; i < nC - 1; i++) {
      for (let j = 0; j < nSeg; j++) {
        const a = i * (nSeg + 1) + j, b = a + 1, c = a + nSeg + 1, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    geo.setIndex(idx);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -0.1, 0), 0.5);
    return geo;
  }

  _buildMeshes() {
    const env = this.env;

    // 1) clear glass -------------------------------------------------------
    this.glassMat = new THREE.MeshPhysicalMaterial({
      color: 0xe8f2ee, roughness: 0.045, metalness: 0.0,
      transmission: 1.0, thickness: 0.006, ior: 1.52,
      attenuationColor: new THREE.Color(0xb6dbd0), attenuationDistance: 1.1,
      clearcoat: 0.5, clearcoatRoughness: 0.06,
      envMap: env, envMapIntensity: 1.15,
      side: THREE.DoubleSide,
    });
    this.glassUniforms = {
      uHeatGain: { value: 0 },
      uTint: { value: new THREE.Color(0xc0392b) },
      uTintMix: { value: 0 },
    };
    this.glassMat.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, this.glassUniforms);
      s.vertexShader = `attribute float aHeat;\nvarying float vHeat;\n` + s.vertexShader.replace(
        '#include <begin_vertex>', '#include <begin_vertex>\n  vHeat = aHeat;');
      s.fragmentShader = `varying float vHeat;\nuniform float uHeatGain;\nuniform vec3 uTint;\nuniform float uTintMix;\n` +
        s.fragmentShader
          .replace('#include <color_fragment>', `#include <color_fragment>
            diffuseColor.rgb = mix(diffuseColor.rgb, uTint, uTintMix * 0.55);`)
          .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
            float h = clamp(vHeat * uHeatGain, 0.0, 1.7);
            vec3 hot = mix(vec3(0.42, 0.010, 0.0), vec3(1.0, 0.115, 0.008), smoothstep(0.08, 0.62, h));
            hot = mix(hot, vec3(1.0, 0.40, 0.06), smoothstep(0.62, 1.3, h));
            totalEmissiveRadiance += hot * pow(h, 1.7) * 1.05;`);
    };
    this.glassMat.customProgramCacheKey = () => 'lauscha-glass';

    this.glassGeo = this._makeLathe(this.nC, this.nSeg, true);
    this.glass = new THREE.Mesh(this.glassGeo, this.glassMat);
    this.glass.frustumCulled = false;
    this.spinner.add(this.glass);

    // 2) silvered mirror inside + 3) the coloured, glittered coat ----------
    this.mirrorMat = new THREE.MeshPhysicalMaterial({
      color: 0xf4f8ff, metalness: 1.0, roughness: 0.055,
      envMap: env, envMapIntensity: 1.5, side: THREE.FrontSide,
    });
    this.mirrorUniforms = {
      uSilverEdge: { value: -1 },              // local Y of the rising mirror line
      uTint: { value: new THREE.Color(0xc0392b) },
      uTintMix: { value: 0 },
      uGlitter: { value: 0 },
      uTime: { value: 0 },
    };
    this.mirrorMat.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, this.mirrorUniforms);
      s.vertexShader = `varying vec3 vLocal;\n` + s.vertexShader.replace(
        '#include <begin_vertex>', '#include <begin_vertex>\n  vLocal = position;');
      s.fragmentShader = `varying vec3 vLocal;
        uniform float uSilverEdge; uniform vec3 uTint; uniform float uTintMix;
        uniform float uGlitter; uniform float uTime;
        float hash31(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
        ` + s.fragmentShader
        .replace('#include <color_fragment>', `#include <color_fragment>
          // the silver only exists below the liquid line: a wavy meniscus
          float wave = 0.0011 * sin(atan(vLocal.z, vLocal.x) * 3.0 + uTime * 2.2);
          if (vLocal.y > uSilverEdge + wave) discard;
          diffuseColor.rgb = mix(diffuseColor.rgb, uTint, uTintMix);`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          // lamé: tiny animated specks locked to the surface
          vec3 cell = floor(vLocal * 900.0);
          float g = hash31(cell);
          float tw = step(0.955, g) * (0.45 + 0.55 * sin(uTime * 7.0 + g * 60.0));
          totalEmissiveRadiance += vec3(1.0, 0.93, 0.78) * tw * uGlitter * 3.4;`);
    };
    this.mirrorMat.customProgramCacheKey = () => 'lauscha-mirror';

    this.mirrorGeo = this._makeLathe(this.nHalf, this.nSeg, false);
    this.mirror = new THREE.Mesh(this.mirrorGeo, this.mirrorMat);
    this.mirror.frustumCulled = false;
    this.mirror.visible = false;
    this.spinner.add(this.mirror);
  }

  /** A few seeds in the tubing. Real Lauscha glass has them, and they make
   *  the turning of a perfectly round tube something you can actually see. */
  _buildSeeds() {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.30 });
    const geo = new THREE.SphereGeometry(0.00042, 8, 6);
    this.seeds = new THREE.Group();
    const spots = [[-0.060, 0.6], [-0.105, 2.4], [-0.150, 4.1], [-0.195, 1.2], [-0.245, 5.2], [-0.300, 3.3]];
    for (const [y, a] of spots) {
      const m = new THREE.Mesh(geo, mat);
      const r = P.tubeR - P.wall * 0.5;
      m.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
      m.scale.set(1, 1.9 + Math.random(), 1);
      this.seeds.add(m);
    }
    this.spinner.add(this.seeds);
  }

  /** Cap, hook and the little wire the finished ball hangs from. */
  _buildFittings() {
    const metal = new THREE.MeshStandardMaterial({
      color: 0xb9a06a, metalness: 1.0, roughness: 0.32, envMap: this.env, envMapIntensity: 1.1,
    });
    this.fittings = new THREE.Group();
    this.fittings.visible = false;

    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.0072, 0.0062, 0.011, 20, 1, true), metal);
    cap.position.y = P.cutY + 0.004;
    const lip = new THREE.Mesh(new THREE.TorusGeometry(0.0072, 0.0011, 8, 20), metal);
    lip.rotation.x = Math.PI / 2;
    lip.position.y = P.cutY + 0.0095;

    const wire = new THREE.Mesh(new THREE.TorusGeometry(0.0092, 0.0011, 6, 24), metal);
    wire.rotation.x = Math.PI / 2;
    wire.rotation.z = 0.25;
    wire.position.y = P.cutY - 0.010;

    this.fittings.add(cap, lip, wire);
    this.spinner.add(this.fittings);
  }

  // ------------------------------------------------------------------ shape

  _outer(y, s) {
    const b = s.bulgeEase;
    const R = lerp(P.tubeR * 1.02, P.bulbRMax, b);
    const yc = lerp(P.bulbYc0, P.bulbYc1, b);

    let rt;
    if (y <= -P.tipCap) rt = P.tubeR;
    else if (y < 0) rt = P.tubeR * Math.sqrt(Math.max(0, 1 - ((y + P.tipCap) / P.tipCap) ** 2));
    else rt = 0;
    // hot glass gathers into a small bead before it is blown
    rt *= 1 + 0.20 * s.heat * (1 - b) * gauss(y, P.heatY, P.heatSigma);

    let rb = 0;
    const u = (y - yc) / R;
    if (Math.abs(u) < 1) {
      rb = R * Math.sqrt(1 - u * u);
      rb *= 1 - 0.085 * u;                                    // heavier below: hot glass hangs
      rb *= 1 + s.wobble * Math.sin(u * 3.1 + s.wobblePhase);  // elastic jiggle after each puff
      rb *= smoothstep(0.0, 0.12, b);
    }

    const K = 5;
    let r = Math.pow(Math.pow(rt, K) + Math.pow(rb, K), 1 / K);
    r *= 1 - P.neckDepth * b * gauss(y, P.neckY, P.neckSigma);   // the neck pulls thin
    return { r, u, R };
  }

  _wall(y, s) {
    const b = s.bulgeEase;
    const inBulb = smoothstep(P.neckY, P.neckY + 0.012, y);
    return P.wall * (1 - 0.62 * b * inBulb);   // the wall thins as the bubble grows
  }

  _heatAt(y, s, u) {
    let w = gauss(y, P.heatY, P.heatSigma);
    if (s.bulgeEase > 0.05 && Math.abs(u) < 1) {
      // the thin top of a fresh bubble loses its glow first: the red stays
      // down at the neck, and the glass above reads as glass again
      const grad = 0.12 + 0.88 * (0.5 - 0.5 * u);
      w = Math.max(w, smoothstep(0.0, 0.12, s.bulgeEase) * grad);
    }
    return clamp(w, 0, 1);
  }

  _sampleY(t, bottom, top, bias) {
    return bottom + (top - bottom) * (1 - Math.pow(1 - t, bias));
  }

  /** Re-evaluate the whole profile and push it into the vertex buffers. */
  rebuild() {
    const s = this.state;
    s.bulgeEase = smoothstep(0, 1, clamp(s.bulge, 0, 1.25));
    const bottom = lerp(P.bottom, P.cutY - 0.0005, s.cut);
    const R = lerp(P.tubeR * 1.02, P.bulbRMax, s.bulgeEase);
    const yc = lerp(P.bulbYc0, P.bulbYc1, s.bulgeEase);
    const top = Math.max(0.0001, yc + R * (1 + s.wobble));

    // where does the inner cavity end? (outer radius still thicker than a wall)
    let innerTop = bottom;
    for (let i = 60; i >= 0; i--) {
      const y = bottom + (top - bottom) * (i / 60);
      if (this._outer(y, s).r > this._wall(y, s) * 1.06) { innerTop = y; break; }
    }

    const nH = this.nHalf;
    const pts = new Array(this.nC);
    const heats = new Float32Array(this.nC);
    for (let i = 0; i < nH; i++) {                    // outer wall, bottom -> tip
      const y = this._sampleY(i / (nH - 1), bottom, top, 2.6);
      const o = this._outer(y, s);
      pts[i] = { r: o.r, y };
      heats[i] = this._heatAt(y, s, o.u);
    }
    for (let i = 0; i < nH; i++) {                    // inner wall, tip -> bottom
      const y = this._sampleY(1 - i / (nH - 1), bottom, innerTop, 2.6);
      const o = this._outer(y, s);
      const r = Math.max(0.00035, o.r - this._wall(y, s));
      pts[nH + i] = { r, y };
      heats[nH + i] = this._heatAt(y, s, o.u) * 0.9;
    }

    this._fill(this.glassGeo, pts, heats, 1.0, this.nC);

    // the mirror coating is the inner wall, a hair inside the glass
    const mp = new Array(nH);
    for (let i = 0; i < nH; i++) {
      const p = pts[nH + (nH - 1 - i)];               // bottom -> tip again
      mp[i] = { r: p.r * 0.965, y: p.y };
    }
    this._fill(this.mirrorGeo, mp, null, 1.0, nH);
  }

  _fill(geo, pts, heats, scale, nC) {
    const pos = geo.attributes.position.array;
    const nor = geo.attributes.normal.array;
    const uv = geo.attributes.uv.array;
    const heatAttr = heats && geo.attributes.aHeat ? geo.attributes.aHeat.array : null;
    const nSeg = this.nSeg;
    const s = this.state;
    const g = this.gravityLocal;

    // sector heat resampled onto the ring segments (wrapped, linear)
    const nSeg0 = this.nSeg;
    if (!this._angRing || this._angRing.length !== nSeg0 + 1) this._angRing = new Float32Array(nSeg0 + 1);
    const ring = this._angRing;
    for (let j = 0; j <= nSeg0; j++) {
      const a = (j / nSeg0) * this.SECT;
      const i0 = Math.floor(a) % this.SECT, i1 = (i0 + 1) % this.SECT, fr = a - Math.floor(a);
      ring[j] = this.ang[i0] * (1 - fr) + this.ang[i1] * fr;
    }

    let k = 0, k2 = 0;
    for (let i = 0; i < nC; i++) {
      const p = pts[i];
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(nC - 1, i + 1)];
      let tr = b.r - a.r, ty = b.y - a.y;
      const tl = Math.hypot(tr, ty) || 1;
      tr /= tl; ty /= tl;
      let nr = ty, ny = -tr;
      if (p.r < 1e-5) { nr = 0; ny = i < nC / 2 ? 1 : -1; }

      // the hot part of the piece sags along gravity: heavier where softer
      const soft = s.heat * smoothstep(-0.09, 0.0, p.y);
      const sag = s.sag * soft * soft;
      const ox = g.x * sag, oy = g.y * sag * 0.55, oz = g.z * sag;

      const v = i / (nC - 1);
      for (let j = 0; j <= nSeg; j++) {
        const th = (j / nSeg) * Math.PI * 2;
        const c = Math.cos(th), si = Math.sin(th);
        pos[k] = p.r * c * scale + ox;
        pos[k + 1] = p.y + oy;
        pos[k + 2] = p.r * si * scale + oz;
        nor[k] = nr * c; nor[k + 1] = ny; nor[k + 2] = nr * si;
        uv[k2] = j / nSeg; uv[k2 + 1] = v;
        if (heatAttr) heatAttr[k / 3] = heats[i] * ring[j];
        k += 3; k2 += 2;
      }
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.normal.needsUpdate = true;
    geo.attributes.uv.needsUpdate = true;
    if (heatAttr) geo.attributes.aHeat.needsUpdate = true;
  }

  // ----------------------------------------------------------------- runtime

  /** Which local angle is in the flame right now. */
  _facing() { return this.flamePhase - this.state.spin; }

  /** Deposit heat into the sector passing through the flame. */
  addHeat(amount) {
    if (amount <= 0) return;
    const n = this.SECT, f = this._facing();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      let d = Math.abs(((a - f) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
      const w = Math.max(0, 1 - d / 1.15);                 // a soft, wide tongue of flame
      if (w > 0) this.ang[i] = clamp(this.ang[i] + amount * w * w, 0, 1);
    }
  }

  /** Heat every sector at once (used when the whole bubble is hot). */
  soakHeat(level) {
    for (let i = 0; i < this.SECT; i++) this.ang[i] = Math.max(this.ang[i], level);
  }

  cool(rate, dt) {
    for (let i = 0; i < this.SECT; i++) this.ang[i] = Math.max(0, this.ang[i] - rate * dt);
  }

  /** Heat conducts around the glass, so a stripe slowly becomes a ring. */
  _conduct(dt) {
    const n = this.SECT, a = this.ang, o = this.angSmooth;
    const k = Math.min(0.5, dt * 1.4);
    for (let i = 0; i < n; i++) {
      const l = a[(i + n - 1) % n], r = a[(i + 1) % n];
      o[i] = a[i] + ((l + r) * 0.5 - a[i]) * k;
    }
    a.set(o);
  }

  /** One puff of breath: the bubble pushes out a step, then springs back. */
  puff(amount) {
    this.state.bulgeTarget = clamp(this.state.bulgeTarget + amount, 0, 1);
    this.state.bulgeVel += amount * 2.2;
    this.state.wobble = Math.min(0.16, this.state.wobble + amount * 0.5);
    this.state.wobblePhase = Math.random() * 6.28;
  }

  update(dt, time) {
    const s = this.state;
    this._conduct(dt);
    let sum = 0;
    for (let i = 0; i < this.SECT; i++) sum += this.ang[i];
    s.heat = sum / this.SECT;                    // "hot" means hot all the way round
    s.bulgeEase = smoothstep(0, 1, clamp(s.bulge, 0, 1.25));

    // spring for the bubble: gives the "puku" overshoot instead of a fade
    const k = 26, damp = 6.4;
    s.bulgeVel += (s.bulgeTarget - s.bulge) * k * dt;
    s.bulgeVel -= s.bulgeVel * damp * dt;
    s.bulge += s.bulgeVel * dt;
    s.bulge = clamp(s.bulge, 0, 1.12);
    s.wobble *= Math.exp(-3.4 * dt);
    s.wobblePhase += dt * 9;

    // gravity direction in the piece's own space (the piece is tilted)
    this.group.updateMatrixWorld();
    this.gravityLocal.set(0, -1, 0).applyQuaternion(this.group.getWorldQuaternion(_q).invert());
    s.sag = (0.0082 + 0.011 * s.bulgeEase) * s.heat;

    this.spinner.rotation.y = s.spin;

    this.rebuild();

    this.glassUniforms.uHeatGain.value = 1.0;
    this.glassMat.thickness = 0.004 + 0.055 * s.bulgeEase;
    this.glassMat.roughness = 0.045 + 0.05 * s.heat;

    this.seeds.visible = s.cut < 0.01;
    this.mirror.visible = s.silver > 0.001;
    if (this.mirror.visible) {
      const R = lerp(P.tubeR * 1.02, P.bulbRMax, s.bulgeEase);
      const yc = lerp(P.bulbYc0, P.bulbYc1, s.bulgeEase);
      this.mirrorUniforms.uSilverEdge.value = lerp(yc - R - 0.004, yc + R + 0.006, s.silver);
      this.mirrorUniforms.uTintMix.value = s.tint * 0.86;
      this.mirrorUniforms.uGlitter.value = s.glitter;
      this.mirrorUniforms.uTime.value = time;
    }
    this.glassUniforms.uTintMix.value = s.tint * 0.5;
  }

  /** World position of the centre of the growing bubble (camera target). */
  bulbCenter(out) {
    const b = this.state.bulgeEase || 0;
    out.set(0, lerp(P.bulbYc0, P.bulbYc1, b), 0);
    return this.group.localToWorld(out);
  }

  bulbRadius() { return lerp(P.tubeR * 1.02, P.bulbRMax, this.state.bulgeEase || 0); }

  /** World position of the neck, where the tools and the hook meet the glass. */
  neckPoint(out) {
    out.set(0, P.neckY, 0);
    return this.group.localToWorld(out);
  }

  setTint(color) {
    this.glassUniforms.uTint.value.set(color);
    this.mirrorUniforms.uTint.value.set(color);
  }

  reset() {
    const s = this.state;
    this.ang.fill(0);
    s.heat = 0; s.bulge = 0; s.bulgeVel = 0; s.bulgeTarget = 0;
    s.silver = 0; s.tint = 0; s.glitter = 0; s.cut = 0;
    s.spin = 0; s.wobble = 0; s.sag = 0;
    this.fittings.visible = false;
    this.mirror.visible = false;
    this.seeds.visible = true;
    this.group.position.set(0, 0, 0);
    this.group.rotation.set(0, 0, 0);
    this.rebuild();
  }
}
