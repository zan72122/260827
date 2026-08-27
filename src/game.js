import * as THREE from 'three';
import { RectBounds, StrokeBuilder, splitRectByCurve, simplifyCurve, polygonCentroid, polygonArea } from './curve2d.js';
import { buildPieceGeometry, validatePieceGeometry } from './glassgeo.js';
import { makeGlassMaterialSet, disposeMaterialSet, GLASS_PALETTE } from './materials.js';
import { makeHand, makeCutter, makeRunningPliers, makeSuctionCup } from './hands.js';
import { ScoreRibbon } from './scoreribbon.js';
import { TABLE_TOP } from './workshop.js';
import { softDotTexture, lightPoolTexture, rand } from './textures.js';

const THICK = 0.005; // ~5 mm float glass

// Phases:
// place -> ready -> scoring -> complete -> pliers -> press -> crack
//   -> separate -> lift -> choice -> (place ...)
export class Game {
  constructor({ scene, director, audio, workshop, renderer, envMap }) {
    this.scene = scene;
    this.director = director;
    this.audio = audio;
    this.workshop = workshop;
    this.renderer = renderer;
    this.envMap = envMap;

    this.phase = 'boot';
    this.phaseT = 0;
    this.timeScale = 1;
    this.round = 0;
    this.lastValidation = null;
    this.lastOutlines = null;

    this.sheetGroup = new THREE.Group();
    this.sheetGroup.position.set(0, TABLE_TOP, 0);
    scene.add(this.sheetGroup);

    this.ribbon = new ScoreRibbon(this.sheetGroup, THICK + 0.0006);

    // artisan rigs -----------------------------------------------------------
    this.cutter = makeCutter();
    this.rightHand = makeHand({ mirror: false });
    this.rightHand.setCurl(0.8);
    // side grip: palm wraps the barrel from screen-right, low, so the barrel,
    // head, wheel and the fresh score all stay visible from the play camera
    this.rightHand.group.position.set(0.052, 0.042, 0.062);
    this.rightHand.group.rotation.set(-0.35, 0.15, -1.15);
    this.cutter.group.add(this.rightHand.group);
    this.cutter.group.visible = false;
    scene.add(this.cutter.group);

    this.steadyHand = makeHand({ mirror: true });
    this.steadyHand.setCurl(0.08);
    this.steadyHand.group.visible = false;
    scene.add(this.steadyHand.group);

    this.pliers = makeRunningPliers();
    this.pliersHand = makeHand({ mirror: false });
    this.pliersHand.setCurl(0.8);
    this.pliersHand.group.position.set(0, 0.005, 0.155);
    this.pliersHand.group.rotation.set(-0.15, 0, 0);
    this.pliers.group.add(this.pliersHand.group);
    this.pliers.group.visible = false;
    scene.add(this.pliers.group);

    this.suction = makeSuctionCup();
    this.suction.group.visible = false;
    scene.add(this.suction.group);

    // hint + press-pulse sprites --------------------------------------------
    const dotTex = softDotTexture();
    this.hintGroup = new THREE.Group();
    this.hintDots = [];
    for (let i = 0; i < 7; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: dotTex, color: 0xfff6da, transparent: true, opacity: 0, depthWrite: false
      }));
      s.scale.setScalar(i === 0 ? 0.055 : 0.028);
      this.hintGroup.add(s);
      this.hintDots.push(s);
    }
    this.hintGroup.visible = false;
    scene.add(this.hintGroup);

    this.pulse = new THREE.Sprite(new THREE.SpriteMaterial({
      map: dotTex, color: 0xffedb8, transparent: true, opacity: 0, depthWrite: false
    }));
    this.pulse.scale.setScalar(0.09);
    this.pulse.visible = false;
    scene.add(this.pulse);

    // colored light pool (showcase) -----------------------------------------
    this.lightPool = null;

    this.raycaster = new THREE.Raycaster();
    this.sheetPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(TABLE_TOP + THICK));

    this.sheetMesh = null;
    this.pieces = [];
    this.materialSet = null;
    this.builder = null;
    this.curve = null;         // finished score polyline (sheet local)
    this.completionQueue = null;
    this.pointerActive = false;
    this.lastTipWorld = new THREE.Vector3();
    this.scoreSpeed = 0;
    this.tickTimer = 0;
    this.disposables = [];

    this.colorIdx = 0;
    this.onPhaseChange = null;
  }

  // ---------------------------------------------------------------- rounds --
  newRound(colorIdx = -1) {
    this.teardownRound();
    this.round++;
    this.colorIdx = colorIdx >= 0 ? colorIdx : Math.floor(rand() * GLASS_PALETTE.length);

    // sheet size varies with round and with orientation (portrait: long axis
    // toward the far edge; landscape: long axis left-right)
    const portrait = this.director.isPortrait();
    const varA = 0.9 + rand() * 0.25;
    const varB = 0.9 + rand() * 0.25;
    if (portrait) this.rect = new RectBounds(0.205 * varA, 0.275 * varB);
    else this.rect = new RectBounds(0.295 * varA, 0.195 * varB);

    this.materialSet = makeGlassMaterialSet(GLASS_PALETTE[this.colorIdx], this.envMap);

    const hw = this.rect.hw, hh = this.rect.hh;
    const poly = [
      { x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh }
    ];
    const geo = buildPieceGeometry({ poly, cutEdges: 0, thickness: THICK, uvRect: this.rect });
    this.sheetMesh = new THREE.Mesh(geo, this.materialSet);
    this.sheetMesh.castShadow = true;
    this.sheetMesh.renderOrder = 10;
    this.sheetGroup.add(this.sheetMesh);
    this.disposables.push(geo);

    // contact shadow matches the sheet footprint
    this.workshop.contactShadow.scale.set(hw * 2.4, hh * 2.4, 1);
    this.workshop.contactShadow.visible = true;

    // small per-round daylight variation
    const sun = this.workshop.sun;
    sun.position.set(-2.4 + rand() * 0.5, 2.1 + rand() * 0.5, -0.9 + rand() * 0.8);
    sun.intensity = 2.3 + rand() * 0.7;

    // suggested start: portrait bottom(near) edge -> top; landscape left -> right
    if (portrait) {
      this.hintStart = { x: (rand() - 0.5) * hw * 0.7, y: hh };
      this.hintEnd = { x: (rand() - 0.5) * hw * 0.8, y: -hh };
    } else {
      this.hintStart = { x: -hw, y: (rand() - 0.5) * hh * 0.7 };
      this.hintEnd = { x: hw, y: (rand() - 0.5) * hh * 0.8 };
    }

    this.builder = null;
    this.curve = null;
    this.ribbon.reset();
    this._setPhase('place');

    // intro framing then settle into the scoring frame
    this._frameIntro();

    // sheet enters held by the suction cup
    this.sheetGroup.position.set(0.12, TABLE_TOP + 0.32, -0.1);
    this.sheetGroup.rotation.set(-0.35, 0, 0.06);
    this.suction.group.visible = true;
    this.steadyHand.group.visible = true;
    this.audio.suctionPop();
  }

  teardownRound() {
    this.scene.add(this.suction.group); // reparent off any lifted piece
    for (const p of this.pieces) {
      this.sheetGroup.remove(p.mesh);
      p.mesh.geometry.dispose();
    }
    this.pieces = [];
    if (this.sheetMesh) {
      this.sheetGroup.remove(this.sheetMesh);
      this.sheetMesh.geometry.dispose();
      this.sheetMesh = null;
    }
    if (this.materialSet) {
      disposeMaterialSet(this.materialSet);
      this.materialSet = null;
    }
    if (this.lightPool) {
      this.scene.remove(this.lightPool);
      this.lightPool.material.map.dispose();
      this.lightPool.material.dispose();
      this.lightPool.geometry.dispose();
      this.lightPool = null;
    }
    this.ribbon.reset();
    this.disposables = [];
    this.sheetGroup.position.set(0, TABLE_TOP, 0);
    this.sheetGroup.rotation.set(0, 0, 0);
    this.cutter.group.visible = false;
    this.pliers.group.visible = false;
    this.suction.group.visible = false;
    this.steadyHand.group.visible = false;
    this.pulse.visible = false;
    this.hintGroup.visible = false;
  }

  _setPhase(p) {
    this.phase = p;
    this.phaseT = 0;
    if (this.onPhaseChange) this.onPhaseChange(p);
  }

  // -------------------------------------------------------------- framing --
  _sheetCorners(pad = 0.05) {
    const { hw, hh } = this.rect;
    const y = TABLE_TOP + THICK;
    return [
      new THREE.Vector3(-hw - pad, y, -hh - pad),
      new THREE.Vector3(hw + pad, y, -hh - pad),
      new THREE.Vector3(-hw - pad, y, hh + pad),
      new THREE.Vector3(hw + pad, y, hh + pad)
    ];
  }

  _frameIntro() {
    const eye = new THREE.Vector3(1.15, 1.95, 1.45);
    const target = new THREE.Vector3(-0.25, 1.0, -0.35);
    this.director.jumpTo(eye, target);
  }

  _frameScoring(dur = 1.2) {
    const portrait = this.director.isPortrait();
    const target = new THREE.Vector3(0, TABLE_TOP, 0);
    let dir;
    if (portrait) {
      // 3/4 from the near edge: whole pane, its near starting edge and the
      // approaching cutter all stay on screen with visible depth
      dir = new THREE.Vector3(0.05, 1.06, 0.62).normalize();
    } else {
      dir = new THREE.Vector3(0.05, 0.98, 0.55).normalize();
    }
    const d = this.director.fitDistance(target, dir, this._sheetCorners(0.075), 0.8);
    const eye = target.clone().addScaledVector(dir, d);
    this.director.moveTo(eye, target, dur);
  }

  _frameCrack(dur = 0.9) {
    // low oblique view along the score from the pliers end; shows the pane
    // thickness, the pliers and the whole line. Locked while the crack runs.
    const pts = this.builder.points;
    const a = pts[0], b = pts[pts.length - 1];
    const entry = this._toWorld(a);
    const mid = this._toWorld(pts[Math.floor(pts.length / 2)]);
    const chord = new THREE.Vector3(b.x - a.x, 0, b.y - a.y).normalize();
    let perp = new THREE.Vector3(-chord.z, 0, chord.x);
    if (perp.z < 0) perp.multiplyScalar(-1); // stay on the camera side
    const eye = entry.clone()
      .addScaledVector(chord, -0.26)
      .addScaledVector(perp, 0.30);
    eye.y = TABLE_TOP + 0.28;
    const target = mid.clone();
    target.y = TABLE_TOP + THICK;
    this.director.moveTo(eye, target, dur);
  }

  _frameSeparate(dur = 1.1) {
    const target = new THREE.Vector3(0, TABLE_TOP, 0);
    const dir = new THREE.Vector3(0.05, Math.tan(1.12), 0.42).normalize();
    const d = this.director.fitDistance(target, dir, this._sheetCorners(0.1), 0.82);
    this.director.moveTo(target.clone().addScaledVector(dir, d), target, dur);
  }

  _frameShowcase(dur = 1.4) {
    // from the right: held piece and window light on the left, the tinted
    // pool it casts on the felt below it
    const eye = new THREE.Vector3(0.8, 1.34, 0.98);
    const target = new THREE.Vector3(-0.22, 1.02, -0.02);
    this.director.moveTo(eye, target, dur);
  }

  refreshFraming() {
    // called on resize / rotation: re-frame current phase without losing state
    switch (this.phase) {
      case 'place': this._frameIntro(); break;
      case 'ready': case 'scoring': case 'complete': this._frameScoring(0.4); break;
      case 'pliers': case 'press': this._frameCrack(0.4); break;
      case 'crack': break; // locked: never cut away mid-crack
      case 'separate': this._frameSeparate(0.4); break;
      case 'lift': case 'choice': this._frameShowcase(0.4); break;
    }
  }

  // ---------------------------------------------------------------- input --
  _toWorld(p2) {
    return new THREE.Vector3(p2.x, TABLE_TOP + THICK, p2.y);
  }

  screenToSheet(ndcX, ndcY, camera) {
    this.raycaster.setFromCamera({ x: ndcX, y: ndcY }, camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.sheetPlane, hit)) return null;
    return { x: hit.x, y: hit.z };
  }

  pointerDown(p2) {
    this.audio.unlock();
    if (this.phase === 'ready') {
      if (!p2) return;
      const { hw, hh } = this.rect;
      // forgiving: touches just outside the pane still start (clamped inside)
      if (Math.abs(p2.x) > hw + 0.06 || Math.abs(p2.y) > hh + 0.06) return;
      this.hintGroup.visible = false;
      this.builder = new StrokeBuilder(this.rect);
      this.builder.begin(p2);
      this._syncRibbon();
      this.cutter.group.visible = true;
      this.pointerActive = true;
      this.audio.startScore();
      this._setPhase('scoring');
      this._placeCutterAtTip(true);
    } else if (this.phase === 'press') {
      this._startCrack();
    } else if (this.phase === 'choice') {
      this.newRound();
    }
  }

  pointerMove(p2) {
    if (this.phase !== 'scoring' || !this.pointerActive || !p2) return;
    const before = this.ribbon.totalLen;
    this.builder.addSample(p2);
    this._syncRibbon();
    this._placeCutterAtTip();
    this.scoreSpeed = this.scoreSpeed * 0.7 + (this.ribbon.totalLen - before) * 18;
    if (this.builder.done) this._strokeFinished();
  }

  pointerUp() {
    if (this.phase === 'scoring') {
      this.pointerActive = false;
      if (this.builder.done) {
        this._strokeFinished();
        return;
      }
      if (this.builder.arcLength() < 0.05) {
        // too short to be a real score: quietly reset and invite again
        this.audio.stopScore();
        this.cutter.group.visible = false;
        this.ribbon.reset();
        this.builder = null;
        this._setPhase('ready');
        this.hintGroup.visible = true;
        return;
      }
      // artisan assist: the hand carries the score on to the far edge
      const completion = this.builder.buildCompletion();
      if (completion && completion.length) {
        this.completionQueue = completion;
        this._setPhase('complete');
      } else {
        this.builder.markDone();
        this._strokeFinished();
      }
    }
  }

  _syncRibbon() {
    const pts = this.builder.points;
    for (let i = this.ribbon.points.length; i < pts.length; i++) {
      this.ribbon.appendPoint(pts[i]);
    }
  }

  _placeCutterAtTip(jump = false) {
    const pts = this.builder.points;
    const tip = pts[pts.length - 1];
    const prev = pts[Math.max(0, pts.length - 2)];
    const world = this._toWorld(tip);
    let dx = tip.x - prev.x, dy = tip.y - prev.y;
    const l = Math.hypot(dx, dy);
    if (l > 1e-6) { dx /= l; dy /= l; } else { dx = 0; dy = -1; }
    const yaw = Math.atan2(-dx, -dy);
    if (jump) {
      this.cutter.group.position.copy(world);
      this.cutter.group.rotation.set(0, yaw, 0);
    } else {
      this.cutter.group.position.lerp(world, 0.55);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0));
      this.cutter.group.quaternion.slerp(q, 0.3);
    }
    // the gripping hand's forearm always trails toward the artisan (near
    // side) instead of sweeping across the pane with the tool's heading
    const rigYaw = new THREE.Euler().setFromQuaternion(this.cutter.group.quaternion, 'YXZ').y;
    this.rightHand.group.rotation.y = 0.35 - rigYaw * 0.75;
    // the other hand steadies the pane from the far side, clear of the line
    const sh = this.steadyHand.group;
    sh.visible = true;
    const sx = THREE.MathUtils.clamp(
      tip.x >= 0 ? -this.rect.hw * 0.5 : this.rect.hw * 0.5,
      -this.rect.hw + 0.06, this.rect.hw - 0.06
    );
    const sy = -this.rect.hh + 0.06;
    const target = this._toWorld({ x: sx, y: sy });
    target.y += 0.012;
    sh.position.lerp(target, 0.08);
    sh.rotation.set(0, Math.PI, 0); // fingers toward the camera, arm reaching over the far edge
  }

  _strokeFinished() {
    this.pointerActive = false;
    this.audio.stopScore();
    this.builder.markDone();
    this.curve = simplifyCurve(this.builder.points, 0.0008);
    this.scoreSpeed = 0;
    this._setPhase('pliers');
    this._placePliers();
    this._frameCrack(1.0);
  }

  _placePliers() {
    const pts = this.builder.points;
    const a = pts[0], b = pts[Math.min(4, pts.length - 1)];
    let dx = b.x - a.x, dy = b.y - a.y;
    const l = Math.hypot(dx, dy) || 1;
    dx /= l; dy /= l;
    const yaw = Math.atan2(-dx, -dy);
    const mouth = this._toWorld({ x: a.x + dx * 0.018, y: a.y + dy * 0.018 });
    mouth.y = TABLE_TOP + THICK / 2;
    this.pliersTarget = { pos: mouth, yaw };
    // slide in from outside the pane edge
    this.pliers.group.position.copy(mouth).add(new THREE.Vector3(-dx * 0.3, 0.12, -dy * 0.3));
    this.pliers.group.rotation.set(0, yaw, 0);
    this.pliers.group.visible = true;
    this.pliers.setSqueeze(0);
    this.cutter.group.visible = false;
    this.steadyHand.group.visible = false;
  }

  _startCrack() {
    this.pulse.visible = false;
    this._setPhase('crack');
    this.director.lock();
    this.crackLen = 0;
    this.tickTimer = 0;
  }

  _finishCrack() {
    this.audio.snap();
    this._buildPieces();
    this.director.unlock();
    this._setPhase('separate');
    this._frameSeparate(1.2);
  }

  _buildPieces() {
    const halves = splitRectByCurve(this.rect, this.curve);
    const totalArea = 4 * this.rect.hw * this.rect.hh;
    const reports = [];
    const outlines = [];
    const pts = this.curve;
    const a = pts[0], b = pts[pts.length - 1];
    const chordN = { x: -(b.y - a.y), y: b.x - a.x };
    const nl = Math.hypot(chordN.x, chordN.y) || 1;
    chordN.x /= nl; chordN.y /= nl;
    const mid = pts[Math.floor(pts.length / 2)];

    let areaSum = 0;
    for (const half of halves) {
      const geo = buildPieceGeometry({
        poly: half.poly, cutEdges: half.cutEdges, thickness: THICK, uvRect: this.rect
      });
      const c = polygonCentroid(half.poly);
      geo.translate(-c.x, 0, -c.y);
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, this.materialSet);
      mesh.castShadow = true;
      mesh.renderOrder = 10;
      mesh.position.set(c.x, 0, c.y);
      this.sheetGroup.add(mesh);
      const side = Math.sign((c.x - mid.x) * chordN.x + (c.y - mid.y) * chordN.y) || 1;
      const area = Math.abs(polygonArea(half.poly));
      areaSum += area;
      this.pieces.push({
        mesh,
        home: mesh.position.clone(),
        sep: new THREE.Vector3(chordN.x * side, 0, chordN.y * side),
        area,
        poly: half.poly
      });
      reports.push(validatePieceGeometry(geo, THICK));
      outlines.push(half.poly.map(p => ({ x: +p.x.toFixed(4), y: +p.y.toFixed(4) })));
    }
    this.lastValidation = {
      reports,
      areaOriginal: +totalArea.toFixed(6),
      areaPieces: +areaSum.toFixed(6),
      areaError: +(Math.abs(areaSum - totalArea) / totalArea).toFixed(6)
    };
    this.lastOutlines = outlines;

    // the un-split sheet disappears only now, replaced in place by the halves
    this.sheetGroup.remove(this.sheetMesh);
    this.sheetMesh.geometry.dispose();
    this.sheetMesh = null;
  }

  _startLift() {
    this._setPhase('lift');
    // the artisan lifts the smaller half safely with the suction cup
    const small = this.pieces.reduce((m, p) => (p.area < m.area ? p : m), this.pieces[0]);
    this.lifted = small;
    this.liftStart = small.mesh.position.clone();
    // the cup rides on the piece's face while it is carried
    small.mesh.add(this.suction.group);
    this.suction.group.position.set(0, THICK + 0.001, 0);
    this.suction.group.rotation.set(0, 0, 0);
    this.suction.group.visible = true;
    this.audio.suctionPop();
    this._frameShowcase(1.4);

    // colored light pool: window daylight through the held piece drops its
    // cut silhouette as tinted light onto the felt beside it
    const pal = GLASS_PALETTE[this.colorIdx];
    const tex = lightPoolTexture(small.poly, pal.css);
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.46), mat);
    quad.rotation.x = -Math.PI / 2;
    quad.rotation.z = -0.2 + rand() * 0.3;
    // stretched away from the window (light comes from -x)
    quad.scale.x = 1.35;
    quad.position.set(0.16, TABLE_TOP + 0.0025, 0.1);
    quad.renderOrder = 3;
    this.scene.add(quad);
    this.lightPool = quad;
  }

  // --------------------------------------------------------------- update --
  update(rawDt, camera) {
    const dt = Math.min(rawDt, 0.1) * this.timeScale;
    this.phaseT += dt;
    const t = this.phaseT;

    switch (this.phase) {
      case 'place': {
        // artisan sets the pane down on the felt
        const k = Math.min(1, t / 1.35);
        const e = 1 - Math.pow(1 - k, 3);
        this.sheetGroup.position.set(0.12 * (1 - e), TABLE_TOP + 0.32 * (1 - e), -0.1 * (1 - e));
        this.sheetGroup.rotation.set(-0.35 * (1 - e), 0, 0.06 * (1 - e));
        const sc = this.suction.group;
        sc.position.copy(this.sheetGroup.position).add(new THREE.Vector3(0, THICK + 0.001, 0));
        sc.rotation.copy(this.sheetGroup.rotation);
        const shg = this.steadyHand.group;
        shg.position.copy(this.sheetGroup.position).add(new THREE.Vector3(-this.rect.hw * 0.8, 0.02, 0.05));
        shg.rotation.set(0, 0.6, 0);
        if (k >= 1) {
          this.audio.thud();
          this.suction.group.visible = false;
          this.steadyHand.group.visible = false;
          this.sheetGroup.position.set(0, TABLE_TOP, 0);
          this.sheetGroup.rotation.set(0, 0, 0);
          this._setPhase('ready');
          this.hintGroup.visible = true;
          this._frameScoring(1.1);
        }
        break;
      }
      case 'ready': {
        // pulsing start dot + dots drifting to the far edge along a soft arc
        const hs = this.hintStart, he = this.hintEnd;
        for (let i = 0; i < this.hintDots.length; i++) {
          const s = this.hintDots[i];
          if (i === 0) {
            const w = this._toWorld(hs); w.y += 0.012;
            s.position.copy(w);
            s.material.opacity = 0.55 + 0.4 * Math.sin(t * 3.4);
            s.scale.setScalar(0.05 + 0.012 * Math.sin(t * 3.4));
          } else {
            const u = ((t * 0.16 + i / (this.hintDots.length - 1)) % 1);
            const x = hs.x + (he.x - hs.x) * u;
            const y = hs.y + (he.y - hs.y) * u;
            const w = this._toWorld({ x, y }); w.y += 0.01;
            s.position.copy(w);
            s.material.opacity = 0.35 * Math.sin(u * Math.PI);
          }
        }
        break;
      }
      case 'scoring': {
        this.scoreSpeed *= 0.94;
        this.audio.updateScore(this.scoreSpeed);
        break;
      }
      case 'complete': {
        // the artisan's hand carries the wheel on to the edge at a calm pace
        const speed = 0.34;
        let travel = speed * dt;
        while (travel > 0 && this.completionQueue.length) {
          const p = this.completionQueue[0];
          const tip = this.builder.points[this.builder.points.length - 1];
          const d = Math.hypot(p.x - tip.x, p.y - tip.y);
          if (d <= travel) {
            this.builder.appendPoint(this.completionQueue.shift());
            travel -= d;
          } else {
            break; // wheel is mid-segment; wait for the next frame
          }
        }
        this._syncRibbon();
        this._placeCutterAtTip();
        this.audio.updateScore(speed);
        if (!this.completionQueue.length) {
          this.completionQueue = null;
          this._strokeFinished();
        }
        break;
      }
      case 'pliers': {
        const k = Math.min(1, t / 0.8);
        const e = 1 - Math.pow(1 - k, 3);
        const tgt = this.pliersTarget;
        this.pliers.group.position.lerpVectors(
          this.pliers.group.position, tgt.pos, Math.min(1, e + 0.08)
        );
        if (k >= 1) {
          this.pliers.group.position.copy(tgt.pos);
          this.audio.pliersSet();
          this._setPhase('press');
          this.pulse.visible = true;
        }
        break;
      }
      case 'press': {
        const w = this.pliers.group.position;
        this.pulse.position.set(w.x, w.y + 0.07, w.z);
        this.pulse.material.opacity = 0.5 + 0.4 * Math.sin(t * 4.2);
        this.pulse.scale.setScalar(0.075 + 0.02 * Math.sin(t * 4.2));
        break;
      }
      case 'crack': {
        // short squeeze, then the crack front runs the score in stroke order
        const squeeze = Math.min(1, t / 0.22);
        this.pliers.setSqueeze(squeeze);
        if (squeeze >= 1) {
          const total = this.ribbon.totalLen;
          const dur = THREE.MathUtils.clamp(total / 0.42, 0.7, 1.5);
          const tt = (t - 0.22) / dur;
          const eased = tt * tt * 0.4 + tt * 0.6;
          this.crackLen = Math.min(total, eased * total);
          this.ribbon.setCrack(this.crackLen);
          // gentle flex of the pane about the score chord while it runs
          const amp = 0.006 * Math.sin(Math.min(1, tt) * Math.PI);
          this.sheetGroup.rotation.z = amp * 0.4;
          this.tickTimer -= dt;
          if (this.tickTimer <= 0 && this.crackLen < total) {
            this.audio.crackTick();
            this.tickTimer = 0.05 + Math.random() * 0.04;
          }
          if (tt >= 1) {
            this.sheetGroup.rotation.z = 0;
            this.ribbon.setCrack(this.ribbon.totalLen + 1);
            this._finishCrack();
          }
        }
        break;
      }
      case 'separate': {
        const k = Math.min(1, t / 0.7);
        const e = 1 - Math.pow(1 - k, 2);
        for (const p of this.pieces) {
          p.mesh.position.copy(p.home).addScaledVector(p.sep, 0.006 * e);
        }
        this.ribbon.fade(1 - e * 0.85);
        this.pliers.setSqueeze(1 - e);
        if (k >= 1 && t > 1.6) {
          this.pliers.group.visible = false;
          this._startLift();
        }
        break;
      }
      case 'lift': {
        const k = Math.min(1, t / 1.6);
        const e = k * k * (3 - 2 * k);
        const m = this.lifted.mesh;
        // up off the felt, then held upright with its face toward the window
        const holdLocal = new THREE.Vector3(-0.3, 0.4, 0.02); // relative to sheetGroup
        m.position.lerpVectors(this.liftStart, holdLocal, e);
        m.rotation.z = 1.2 * e;   // face normal swings toward the window (-x)
        m.rotation.y = 0.25 * e;
        // supporting gloved hand cradles the lower edge, palm up
        const shg = this.steadyHand.group;
        shg.visible = true;
        const w = this.sheetGroup.localToWorld(m.position.clone());
        shg.position.set(w.x - 0.05, w.y - 0.17, w.z + 0.04);
        shg.rotation.set(Math.PI * 0.92, 0, 0.15);
        if (this.lightPool) {
          this.lightPool.material.opacity = Math.max(0, (k - 0.45) / 0.55) * 0.75;
        }
        if (k >= 1 && this.phaseT > 2.6) {
          this.audio.chime();
          this._setPhase('choice');
        }
        break;
      }
      case 'choice':
        break;
    }
  }

  // ---------------------------------------------------------------- debug --
  diagnostics() {
    const info = this.renderer.info;
    return {
      phase: this.phase,
      round: this.round,
      colorIdx: this.colorIdx,
      rect: this.rect ? { hw: this.rect.hw, hh: this.rect.hh } : null,
      curveLen: this.ribbon.totalLen,
      curvePoints: this.curve ? this.curve.length : 0,
      validation: this.lastValidation,
      outlines: this.lastOutlines,
      memory: { geometries: info.memory.geometries, textures: info.memory.textures },
      programs: info.programs ? info.programs.length : 0
    };
  }
}
