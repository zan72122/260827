// Game orchestration: phases, one-stroke input, camera work, stamping,
// effects and the test API. Phases:
//   intro → draw → drive → bandview → skate → (reveal, first run) → draw …

import * as THREE from 'three';
import { IceRink } from './rink.js';
import { buildArena } from './arena.js';
import { Resurfacer } from './vehicle.js';
import { Skater } from './skater.js';
import { Effects } from './particles.js';
import { GameAudio } from './audio.js';
import { processStroke, DrivePath, RINK, VEHICLE_SPEC } from './path.js';

const VEH_START = { x: 0, z: 12.5, heading: Math.PI };
const SKATER_START = { x: 3, z: -14, heading: 0.55 };

function easeInOut(t) { return t * t * (3 - 2 * t); }

export class Game {
  constructor(root) {
    this.root = root;
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    this.renderer = renderer;
    root.appendChild(renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x10161b);
    this.scene.fog = new THREE.Fog(0x10161b, 45, 100);

    this.camera = new THREE.PerspectiveCamera(52, 1, 0.1, 220);
    this.camPos = new THREE.Vector3(0, 30, 30);
    this.camLook = new THREE.Vector3(0, 0, 0);
    this.camFov = 52;

    this.rink = new IceRink(renderer);
    this.scene.add(this.rink.mesh);
    buildArena(this.scene);

    this.veh = new Resurfacer();
    this.veh.resetPose(VEH_START.x, VEH_START.z, VEH_START.heading);
    this.scene.add(this.veh.group);

    this.skater = new Skater();
    this.skater.setWaiting(SKATER_START.x, SKATER_START.z, SKATER_START.heading);
    this.scene.add(this.skater.group);

    this.effects = new Effects(this.scene);
    this.audio = new GameAudio();

    this._buildStrokeVisuals();

    // ---- state
    this.phase = 'intro';
    this.introT = 0;
    this.phaseTimer = 0;
    this.firstRun = true;
    this.stroke = null;          // active raw stroke [{x,z,t}]
    this.drivePath = null;
    this.bandPts = [];           // actual conditioner trace (for the skater)
    this.prevCond = null;
    this.prevWheels = null;
    this.idleT = 0;
    this.time = 0;
    this.timeScale = 1;
    this._lastSwaySign = 0;
    this.portrait = true;

    this._bindInput();
    this._bindButtons();
    this._layout();
    window.addEventListener('resize', () => this._layout());

    this.clock = new THREE.Clock();
  }

  // ------------------------------------------------------------ visuals

  _buildStrokeVisuals() {
    // child's stroke ribbon on the ice — drawn slightly ahead of the finger
    const MAXV = 4096;
    const geo = new THREE.BufferGeometry();
    this.ribbonPos = new Float32Array(MAXV * 3);
    this.ribbonS = new Float32Array(MAXV);
    geo.setAttribute('position', new THREE.BufferAttribute(this.ribbonPos, 3));
    geo.setAttribute('aS', new THREE.BufferAttribute(this.ribbonS, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 100);
    this.ribbonMat = new THREE.ShaderMaterial({
      vertexShader: `
        attribute float aS;
        varying float vS;
        void main(){ vS = aS; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        precision mediump float;
        varying float vS;
        uniform float uTotal;
        uniform float uPassed;
        uniform float uTime;
        void main(){
          float tail = smoothstep(uPassed - 1.5, uPassed + 0.5, vS);   // fade where the vehicle already passed
          float tip = 1.0 - smoothstep(uTotal - 0.9, uTotal, vS) * 0.35;
          float glow = 0.75 + 0.25 * sin(uTime * 3.0 - vS * 0.8);
          gl_FragColor = vec4(1.0, 0.98, 0.9, 0.5 * tail * tip * glow);
        }`,
      uniforms: { uTotal: { value: 0 }, uPassed: { value: -10 }, uTime: { value: 0 } },
      transparent: true, depthWrite: false
    });
    this.ribbon = new THREE.Mesh(geo, this.ribbonMat);
    this.ribbon.renderOrder = 2;
    this.ribbon.frustumCulled = false;
    this.ribbon.visible = false;
    this.scene.add(this.ribbon);

    // pulsing "start here" ring around the vehicle
    this.pulseRing = new THREE.Mesh(
      new THREE.RingGeometry(2.3, 2.55, 48),
      new THREE.MeshBasicMaterial({ color: 0xfff3c4, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide })
    );
    this.pulseRing.rotation.x = -Math.PI / 2;
    this.pulseRing.position.y = 0.03;
    this.pulseRing.renderOrder = 2;
    this.scene.add(this.pulseRing);

    // sparkle chain hint drifting from vehicle to skater (no text tutorial)
    const dotTex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d');
      const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30);
      gr.addColorStop(0, 'rgba(255,250,230,1)');
      gr.addColorStop(0.4, 'rgba(255,246,214,0.7)');
      gr.addColorStop(1, 'rgba(255,246,214,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    })();
    this.hintDots = [];
    for (let i = 0; i < 9; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex, transparent: true, opacity: 0, depthWrite: false }));
      s.scale.set(0.7, 0.7, 1);
      s.renderOrder = 3;
      this.scene.add(s);
      this.hintDots.push(s);
    }
  }

  // ------------------------------------------------------------ input

  _bindInput() {
    const el = this.renderer.domElement;
    this.raycaster = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.activePointer = null;

    const toWorld = (clientX, clientY) => {
      const r = el.getBoundingClientRect();
      const nx = ((clientX - r.left) / r.width) * 2 - 1;
      const ny = -((clientY - r.top) / r.height) * 2 + 1;
      this.raycaster.setFromCamera({ x: nx, y: ny }, this.camera);
      const out = new THREE.Vector3();
      if (this.raycaster.ray.intersectPlane(this.groundPlane, out)) return out;
      return null;
    };
    this._toWorld = toWorld;

    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.audio.unlock();
      if (this.phase === 'intro') { this.skipIntro(); return; }
      if (this.phase !== 'draw' || this.activePointer !== null) return;
      const w = toWorld(e.clientX, e.clientY);
      if (!w) return;
      this.activePointer = e.pointerId;
      this.stroke = [{ x: w.x, z: w.z, t: performance.now() }];
      this._updateRibbonFromStroke();
      el.setPointerCapture?.(e.pointerId);
    }, { passive: false });

    el.addEventListener('pointermove', (e) => {
      if (this.activePointer !== e.pointerId || this.phase !== 'draw' || !this.stroke) return;
      e.preventDefault();
      const w = toWorld(e.clientX, e.clientY);
      if (!w) return;
      const last = this.stroke[this.stroke.length - 1];
      if (Math.hypot(w.x - last.x, w.z - last.z) > 0.12) {
        this.stroke.push({ x: w.x, z: w.z, t: performance.now() });
        if (this.stroke.length % 14 === 0) this.audio.drawTick();
        this._updateRibbonFromStroke();
      }
    }, { passive: false });

    const finish = (e) => {
      if (this.activePointer !== e.pointerId) return;
      this.activePointer = null;
      if (this.phase !== 'draw' || !this.stroke) return;
      this._finishStroke();
    };
    el.addEventListener('pointerup', finish);
    el.addEventListener('pointercancel', finish);
    ['touchstart', 'touchmove'].forEach(t =>
      window.addEventListener(t, (e) => { if (e.target === el) e.preventDefault(); }, { passive: false }));
  }

  _finishStroke() {
    const raw = this.stroke;
    this.stroke = null;
    let len = 0;
    for (let i = 1; i < raw.length; i++) len += Math.hypot(raw[i].x - raw[i - 1].x, raw[i].z - raw[i - 1].z);
    if (len < 0.6) { this.ribbon.visible = false; return; }   // a tap — not a stroke

    this.lastStrokeRaw = raw.map(p => ({ x: p.x, z: p.z }));
    this.drivePath = processStroke(raw, this.veh);
    this.bandPts = [];
    this.prevCond = null;
    this.prevWheels = null;
    this.veh.startDrive(this.drivePath);
    if (this.veh.conditionerT < 0.5) this.audio.conditionerDown();
    this.ribbonMat.uniforms.uPassed.value = -10;
    this.phase = 'drive';
    this.phaseTimer = 0;
  }

  _updateRibbonFromStroke() {
    if (!this.stroke || this.stroke.length < 2) { this.ribbon.visible = this.stroke?.length > 1; return; }
    // light display smoothing + a small lead so the finger doesn't hide the tip
    const pts = this.stroke.map(p => ({ x: p.x, z: p.z }));
    for (let k = 0; k < 2; k++) {
      for (let i = 1; i < pts.length - 1; i++) {
        pts[i].x = (pts[i - 1].x + pts[i].x * 2 + pts[i + 1].x) * 0.25;
        pts[i].z = (pts[i - 1].z + pts[i].z * 2 + pts[i + 1].z) * 0.25;
      }
    }
    const a = pts[pts.length - 2], b = pts[pts.length - 1];
    const dl = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    pts.push({ x: b.x + (b.x - a.x) / dl * 0.8, z: b.z + (b.z - a.z) / dl * 0.8 });
    this._fillRibbon(pts, 0.14);
    this.ribbon.visible = true;
  }

  _fillRibbon(pts, halfW) {
    let s = 0;
    let v = 0;
    const P = this.ribbonPos, SS = this.ribbonS;
    for (let i = 0; i < pts.length - 1 && v < 4090; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      if (d < 1e-5) continue;
      const nx = -dz / d * halfW, nz = dx / d * halfW;
      const y = 0.035;
      const quad = [
        [a.x - nx, y, a.z - nz, s], [a.x + nx, y, a.z + nz, s], [b.x - nx, y, b.z - nz, s + d],
        [a.x + nx, y, a.z + nz, s], [b.x + nx, y, b.z + nz, s + d], [b.x - nx, y, b.z - nz, s + d]
      ];
      for (const q of quad) {
        P[v * 3] = q[0]; P[v * 3 + 1] = q[1]; P[v * 3 + 2] = q[2];
        SS[v] = q[3];
        v++;
      }
      s += d;
    }
    this.ribbon.geometry.setDrawRange(0, v);
    this.ribbon.geometry.attributes.position.needsUpdate = true;
    this.ribbon.geometry.attributes.aS.needsUpdate = true;
    this.ribbonMat.uniforms.uTotal.value = s;
    this.ribbonTotal = s;
  }

  _bindButtons() {
    this.replayBtn = document.getElementById('replayBtn');
    this.muteBtn = document.getElementById('muteBtn');
    this.muted = false;
    if (this.replayBtn) {
      this.replayBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
      this.replayBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.audio.unlock();
        this.fullReset();
      });
    }
    if (this.muteBtn) {
      this.muteBtn.style.display = 'flex';
      this.muteBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
      this.muteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.muted = !this.muted;
        this.audio.unlock();
        this.audio.setMuted(this.muted);
        const wave = this.muteBtn.querySelector('.wave');
        if (wave) wave.style.opacity = this.muted ? '0.15' : '1';
      });
    }
  }

  // ------------------------------------------------------------ layout / camera

  _layout() {
    const w = this.root.clientWidth || window.innerWidth;
    const h = this.root.clientHeight || window.innerHeight;
    let pr = Math.min(window.devicePixelRatio || 1, 2);
    if (w * h * pr * pr > 2600000) pr = Math.max(1, Math.sqrt(2600000 / (w * h)));
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.portrait = h >= w;
    this.camera.updateProjectionMatrix();
  }

  _inputView() {
    // rink, vehicle, skater and the rough ice all visible; fixed while drawing
    if (this.portrait) {
      return { pos: new THREE.Vector3(0, 14, 36.5), look: new THREE.Vector3(0, 0, -5), fov: 56 };
    }
    return { pos: new THREE.Vector3(31, 13.5, 0), look: new THREE.Vector3(-2, 0, 0), fov: 50 };
  }

  _desiredCamera() {
    const veh = this.veh;
    const f = veh.forward, r = veh.right;
    const vp = new THREE.Vector3(veh.x, 0, veh.z);
    const local = (lx, ly, lz) => new THREE.Vector3(
      veh.x + r.x * lx + f.x * lz, ly, veh.z + r.z * lx + f.z * lz);

    switch (this.phase) {
      case 'intro': return this._introCamera();
      case 'draw': return this._inputView();
      case 'drive': {
        const p = this.drivePath ? veh.progress / Math.max(1, this.drivePath.total) : 0;
        if (p < 0.13) {
          return { pos: local(0.5, 7.5, -10), look: local(0, 0.4, 4), fov: 52 };
        } else if (p < 0.5) {
          // low, close to the conditioner: rough ice turns into the smooth band
          const ce = veh.conditionerEdges();
          return {
            pos: local(2.5, 1.5, -5.3),
            look: new THREE.Vector3(ce.c.x - f.x * 0.6 + r.x * 0.3, 0.2, ce.c.z - f.z * 0.6 + r.z * 0.3),
            fov: 50
          };
        } else if (p < 0.82) {
          // rear three-quarter: the stroke's curves + the band together
          return { pos: local(3.1, 4.8, -8.0), look: local(-0.5, 0.3, 3.5), fov: 50 };
        }
        return this._wideView();
      }
      case 'bandview': return this._wideView();
      case 'skate': {
        const sk = this.skater;
        const sf = { x: Math.sin(sk.heading), z: Math.cos(sk.heading) };
        if (sk.mode === 'finish') {
          return {
            pos: new THREE.Vector3(sk.x + 2.5, 2.0, sk.z + 4.0),
            look: new THREE.Vector3(sk.x, 0.8, sk.z), fov: 50
          };
        }
        const perp = { x: -sf.z, z: sf.x };
        return {
          pos: new THREE.Vector3(sk.x - sf.x * 5.4 + perp.x * 1.6, 2.5, sk.z - sf.z * 5.4 + perp.z * 1.6),
          look: new THREE.Vector3(sk.x + sf.x * 2.5, 0.55, sk.z + sf.z * 2.5), fov: 50
        };
      }
      case 'reveal': {
        // above and ahead, looking down into the open snow bin
        return { pos: local(0.9, 5.6, 4.9), look: local(0, 0.9, 2.9), fov: 46 };
      }
    }
    return this._inputView();
  }

  _wideView() {
    const iv = this._inputView();
    return { pos: iv.pos.clone().add(new THREE.Vector3(0, 3, 0)), look: iv.look, fov: iv.fov };
  }

  _introCamera() {
    const t = this.introT;
    const seg = (t0, t1, pa, pb, la, lb) => {
      const k = easeInOut(Math.max(0, Math.min(1, (t - t0) / (t1 - t0))));
      return {
        pos: new THREE.Vector3().lerpVectors(pa, pb, k),
        look: new THREE.Vector3().lerpVectors(la, lb, k),
        fov: 48
      };
    };
    if (t < 2.3) {
      // close over the scratched ice
      return seg(0, 2.3,
        new THREE.Vector3(2.2, 1.3, 6.0), new THREE.Vector3(-1.6, 1.7, 1.4),
        new THREE.Vector3(0.5, 0, 2.5), new THREE.Vector3(-2.5, 0, -2.0));
    } else if (t < 4.3) {
      // the waiting skater
      return seg(2.3, 4.3,
        new THREE.Vector3(5.6, 1.6, -10.8), new THREE.Vector3(4.6, 1.3, -11.8),
        new THREE.Vector3(3, 0.9, -14), new THREE.Vector3(3, 0.8, -14));
    } else if (t < 6.5) {
      // the conditioner drops onto the ice
      return seg(4.3, 6.5,
        new THREE.Vector3(4.3, 2.2, 16.9), new THREE.Vector3(3.5, 1.7, 16.3),
        new THREE.Vector3(-0.6, 0.35, 13.7), new THREE.Vector3(-0.6, 0.15, 13.7));
    }
    // pull up over the vehicle, facing down the rink
    const iv = this._inputView();
    return seg(6.5, 8.4,
      new THREE.Vector3(0.8, 2.2, 16.8), iv.pos,
      new THREE.Vector3(0, 0.6, 8), iv.look);
  }

  skipIntro() {
    if (this.phase !== 'intro') return;
    this.introT = 99;
    this.phase = 'draw';
    this.phaseTimer = 0;
    if (this.veh.conditionerT < 1) this.veh.setConditioner(true);
    const iv = this._inputView();
    this.camPos.copy(iv.pos);
    this.camLook.copy(iv.look);
    this.camFov = iv.fov;
  }

  fullReset() {
    this.rink.reset();
    this.veh.resetPose(VEH_START.x, VEH_START.z, VEH_START.heading);
    this.veh.setConditioner(true);
    this.skater.setWaiting(SKATER_START.x, SKATER_START.z, SKATER_START.heading);
    this.stroke = null;
    this.activePointer = null;
    this.drivePath = null;
    this.bandPts = [];
    this.ribbon.visible = false;
    this.phase = 'draw';
    this.phaseTimer = 0;
    this.idleT = 0;
    const iv = this._inputView();
    this.camPos.copy(iv.pos);
    this.camLook.copy(iv.look);
  }

  // ------------------------------------------------------------ main loop

  start() {
    const loop = () => {
      requestAnimationFrame(loop);
      const raw = Math.min(0.08, this.clock.getDelta());
      let total = raw * this.timeScale;
      while (total > 1e-4) {
        const step = Math.min(1 / 45, total);
        this._step(step);
        total -= step;
      }
      this._render(raw);
    };
    loop();
  }

  _step(dt) {
    this.time += dt;
    this.phaseTimer += dt;

    if (this.phase === 'intro') {
      this.introT += dt;
      if (this.introT > 4.6 && this.veh.conditionerT === 0 && this._condCue !== true) {
        this._condCue = true;
        this.veh.setConditioner(true);
        this.audio.conditionerDown();
      }
      if (this.introT > 8.6) { this.phase = 'draw'; this.phaseTimer = 0; }
    }

    // vehicle physics + stamping
    const wasDriving = this.veh.driving;
    const done = this.veh.update(dt);

    if (this.veh.driving || wasDriving) {
      const ce = this.veh.conditionerEdges();
      const working = this.veh.conditionerT > 0.92 && this.veh.speed > 0.04 && this.veh.driving;
      if (working && this.prevCond) {
        const speedNorm = Math.min(1, this.veh.speed / 3.1);
        const wet = 0.7 + 0.3 * (1 - speedNorm);   // slower stroke → slightly thicker film
        this.rink.stampConditioner(this.prevCond.L, this.prevCond.R, ce.L, ce.R, wet);
        const moved = Math.hypot(ce.c.x - this.prevCond.c.x, ce.c.z - this.prevCond.c.z);
        this.veh.addSnow(moved * 0.028);
        // faint wet tire prints ahead of the conditioner (erased when it passes)
        const rw = { l: this.veh.wheelWorld(-0.85, 0), r: this.veh.wheelWorld(0.85, 0) };
        if (this.prevWheels) {
          const rv = this.veh.right;
          this.rink.stampTireMark(this.prevWheels.l, rw.l, rv, 0.1, 0.16);
          this.rink.stampTireMark(this.prevWheels.r, rw.r, rv, 0.1, 0.16);
        }
        this.prevWheels = rw;
        // record the actual band for the skater
        if (!this.bandPts.length ||
          Math.hypot(ce.c.x - this.bandPts[this.bandPts.length - 1].x, ce.c.z - this.bandPts[this.bandPts.length - 1].z) > 0.45) {
          this.bandPts.push({ x: ce.c.x, z: ce.c.z, s: 2.5 });
        }
      }
      this.prevCond = ce;
      this.effects.emitWork(this.veh, dt);
      this.audio.setDrive(Math.min(1, this.veh.speed / 3.1), this.veh.workIntensity);
      if (this.drivePath) {
        this.ribbonMat.uniforms.uPassed.value =
          (this.veh.progress / Math.max(0.01, this.drivePath.total)) * (this.ribbonTotal || 0);
      }
    }

    if (this.phase === 'drive' && done) {
      this.audio.stopDrive();
      this.audio.conditionerUp();
      this.phase = 'bandview';
      this.phaseTimer = 0;
    }

    if (this.phase === 'bandview' && this.phaseTimer > 3.0) {
      this.ribbon.visible = false;
      if (this.bandPts.length > 3) {
        this.skater.startSkating(new DrivePath(this.bandPts));
        this.phase = 'skate';
      } else {
        this.phase = 'draw';
      }
      this.phaseTimer = 0;
    }

    // skater
    this.skater.update(dt, this.time);
    if (this.phase === 'skate') {
      const sway = Math.sign(Math.sin(this.skater.skateS * 1.9));
      if (sway !== this._lastSwaySign && this.skater.mode === 'skate') {
        this._lastSwaySign = sway;
        this.audio.skateSwish();
      }
      if (this.skater.mode === 'finish' && this.skater.finishT < 0.05 && !this._chimed) {
        this._chimed = true;
        this.audio.chime();
      }
      if (this.skater.donePlaying) {
        this._chimed = false;
        if (this.firstRun) {
          this.firstRun = false;
          this.phase = 'reveal';
          this.phaseTimer = 0;
          this._revealCue = false;
        } else {
          this._backToDraw();
        }
      }
    }

    if (this.phase === 'reveal') {
      if (this.phaseTimer > 0.9 && !this._revealCue) {
        this._revealCue = true;
        this.veh.openLid();
        this.audio.lidOpen();
        setTimeout(() => this.effects.burstLidOpen(this.veh), 400);
      }
      if (this.phaseTimer > 4.2) {
        this.veh.closeLid();
        this._backToDraw();
      }
    }

    // draw-phase ambience
    if (this.phase === 'draw') {
      this.idleT = this.stroke ? 0 : this.idleT + dt;
      this.veh.setConditioner(true);   // parked ready, blade down only stamps while moving
    }

    this.effects.update(dt);
  }

  _backToDraw() {
    this.phase = 'draw';
    this.phaseTimer = 0;
    this.idleT = 0;
    if (this.replayBtn) this.replayBtn.style.display = 'flex';
  }

  _render(dt) {
    // camera damping — one continuous eye while playing. The intro is a
    // classic shot sequence (cuts BETWEEN shots, smooth moves within), and
    // during resurfacing the camera never cuts away from the conditioner.
    const d = this._desiredCamera();
    const k = this.phase === 'intro' ? 1 : 1 - Math.exp(-dt * 2.6);
    this.camPos.lerp(d.pos, k);
    this.camLook.lerp(d.look, k);
    this.camFov += (d.fov - this.camFov) * k;
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    if (Math.abs(this.camera.fov - this.camFov) > 0.05) {
      this.camera.fov = this.camFov;
      this.camera.updateProjectionMatrix();
    }

    // hint sparkles + pulse ring (draw phase only)
    const showHint = this.phase === 'draw' && !this.stroke && this.idleT > 1.0;
    const vx = this.veh.x, vz = this.veh.z;
    const sx = this.skater.x, sz = this.skater.z;
    const mx = (vx + sx) / 2 + 3, mz = (vz + sz) / 2;
    for (let i = 0; i < this.hintDots.length; i++) {
      const s = this.hintDots[i];
      if (!showHint) { s.material.opacity = 0; continue; }
      const tt = (this.time * 0.32 + i / this.hintDots.length) % 1;
      const a = 1 - tt, b = tt;
      const px = vx * a * a + mx * 2 * a * b + sx * b * b;
      const pz = vz * a * a + mz * 2 * a * b + sz * b * b;
      s.position.set(px, 0.25, pz);
      s.material.opacity = Math.sin(Math.PI * tt) * 0.75;
    }
    this.pulseRing.visible = showHint;
    if (showHint) {
      this.pulseRing.position.set(vx, 0.03, vz);
      const p = 1 + 0.1 * Math.sin(this.time * 3.2);
      this.pulseRing.scale.set(p, p, 1);
      this.pulseRing.material.opacity = 0.28 + 0.16 * Math.sin(this.time * 3.2);
    }
    this.ribbonMat.uniforms.uTime.value = this.time;

    // mask decay + stamps, then the main render
    this.rink.update(dt, this.camera.position, this.time);
    this.renderer.render(this.scene, this.camera);
  }

  // ------------------------------------------------------------ test API

  testApi() {
    return {
      version: 1,
      phase: () => this.phase,
      introT: () => this.introT,
      debugCam: () => ({
        pos: this.camPos.toArray(), look: this.camLook.toArray(), fov: this.camFov,
        desired: (() => { const d = this._desiredCamera(); return { pos: d.pos.toArray(), look: d.look.toArray(), fov: d.fov }; })(),
        portrait: this.portrait
      }),
      skipIntro: () => this.skipIntro(),
      reset: () => this.fullReset(),
      setTimeScale: (s) => { this.timeScale = Math.max(0.25, Math.min(5, s)); },
      vehicle: () => ({
        x: this.veh.x, z: this.veh.z, heading: this.veh.heading,
        speed: this.veh.speed, steer: this.veh.steer,
        conditioner: this.veh.conditionerT, driving: this.veh.driving, lid: this.veh.lidT,
        progress: this.veh.progress, snowFill: this.veh.snowFill
      }),
      conditionerEdges: () => this.veh.conditionerEdges(),
      maskAt: (x, z) => this.rink.readMask(x, z),
      pathPoints: () => this.drivePath ? this.drivePath.pts.map(p => ({ x: p.x, z: p.z })) : null,
      pathTotal: () => this.drivePath ? this.drivePath.total : 0,
      bandTrace: () => this.bandPts.map(p => ({ x: p.x, z: p.z })),
      lastStroke: () => this.lastStrokeRaw || null,
      skater: () => ({ x: this.skater.x, z: this.skater.z, mode: this.skater.mode }),
      worldToScreen: (x, z) => {
        const v = new THREE.Vector3(x, 0, z).project(this.camera);
        const r = this.renderer.domElement.getBoundingClientRect();
        return { x: (v.x * 0.5 + 0.5) * r.width + r.left, y: (-v.y * 0.5 + 0.5) * r.height + r.top };
      },
      rinkSpec: { ...RINK, vehicle: { ...VEHICLE_SPEC } }
    };
  }
}
