import * as THREE from 'three';
import { ANCHOR, ornamentGeometry } from './workshop.js';

/**
 * The show. One unbroken take, no menus, no screen changes:
 *
 *   establish -> approach -> SPIN (drag) -> macro -> BLOW (swipe up / hold)
 *             -> SILVER (drag) -> COLOUR (touch) -> hang -> again
 *
 * Every phase that carries a signature action waits for the child, and every
 * change happens where they can see the cause: the glass reddens under the
 * flame while they turn it, the bubble pushes out while they blow.
 */

const LIFT_OFF_FLAME = new THREE.Vector3(-0.02, 0.035, 0.012);
const HANG_EULER = new THREE.Euler(0.05, 0.25, Math.PI);
const HANG_OFFSET = new THREE.Vector3(0, -0.030, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v1 = new THREE.Vector3();

const COLORS = [0xcc2b2f, 0xdda32c, 0x1f9160, 0x2f74ad, 0xa33174];
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

// How much work each stage asks for, tuned so a small screen needs about
// three to five gestures per stage.
const HEAT_PER_RAD = 0.34;      // heat enters the glass as it turns through the flame
const SILVER_PER_PX = 0.0013;
const BLOW_PER_PX = 0.0017;
const BLOW_PER_SEC = 0.42;

export class Director {
  constructor(ctx) {
    Object.assign(this, ctx);           // scene, piece, flame, hands, ws, glitter, rig, input, hints, sfx, quality
    this.phase = '';
    this.t = 0;
    this.run = 0;
    this.spinVel = 0;
    this.popStep = 0;
    this.silverStep = 0;
    this.parked = [];
    this.tmp = new THREE.Vector3();
    this.tmp2 = new THREE.Vector3();
    this.pieceHome = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
    this.lift = 0;

    this._placePiece();
    this._buildShots();
    this.setPhase('establish');
  }

  // --------------------------------------------------------------- staging

  _placePiece() {
    const p = this.piece.group;
    p.position.copy(ANCHOR.pieceOrigin);
    p.rotation.set(ANCHOR.pieceTilt.x, 0, ANCHOR.pieceTilt.z);
    p.updateMatrixWorld();
    this.pieceHome.pos.copy(p.position);
    this.pieceHome.quat.copy(p.quaternion);

    // the hands share the tube's pose but never its spin or its flip
    const anchor = new THREE.Object3D();
    anchor.position.copy(p.position);
    anchor.quaternion.copy(p.quaternion);
    this.scene.add(anchor);
    anchor.add(this.hands.group);
    this.handsAnchor = anchor;
    this.handsHome = anchor.position.clone();

    // aim the forearms down and toward the viewer, out of the glass
    const want = new THREE.Vector3(0.40, -0.70, 0.59).normalize();
    want.applyQuaternion(this.pieceHome.quat.clone().invert());
    this.hands.group.rotation.y = Math.atan2(want.z, want.x);

    // which side of the tube the flame licks, in the glass's own frame
    const toFlame = new THREE.Vector3().subVectors(ANCHOR.nozzle, ANCHOR.heatSpot)
      .applyQuaternion(this.pieceHome.quat.clone().invert());
    this.piece.flamePhase = Math.atan2(toFlame.z, toFlame.x);

    this.flame.aim(ANCHOR.nozzle, ANCHOR.heatSpot);
    const need = ANCHOR.nozzle.distanceTo(ANCHOR.heatSpot) + 0.045;
    this.flame.group.scale.setScalar(need / 0.155);
  }

  _buildShots() {
    const piece = this.piece;
    const heat = () => piece.group.localToWorld(this.tmp.set(0, -0.014, 0));
    const bulb = () => piece.bulbCenter(this.tmp);
    const tip = () => piece.group.localToWorld(this.tmp.set(0, -0.05, 0));
    const hook = () => this.tmp.copy(ANCHOR.hook).add(_v1.set(0, -0.045, 0));

    this.shots = {
      establish: { pos: new THREE.Vector3(0.44, 1.46, 1.60), look: new THREE.Vector3(-0.05, 1.19, -0.35), frame: 1.84, bias: 0.09, vfit: 0.44, shake: 1.0 },
      approach: { pos: new THREE.Vector3(0.20, 1.300, 0.72), look: tip, frame: 0.55, bias: 0.14, shake: 0.9 },
      spin: { pos: new THREE.Vector3(0.090, 1.190, 0.455), look: heat, frame: 0.250, bias: 0.24, shake: 0.7 },
      macro: { pos: new THREE.Vector3(0.055, 1.235, 0.175), look: heat, frame: 0.080, bias: 0.14, shake: 0.5 },
      blow: {
        pos: new THREE.Vector3(0.075, 1.205, 0.500), look: bulb,
        frame: () => 0.130 + 0.125 * (piece.state.bulgeEase || 0), bias: 0.24, shake: 0.6,
      },
      silver: { pos: new THREE.Vector3(0.075, 1.215, 0.500), look: bulb, frame: 0.250, bias: 0.22, shake: 0.5 },
      hang: { pos: new THREE.Vector3(0.020, 1.500, 0.360), look: hook, frame: 0.30, bias: 0.10, shake: 0.8 },
      again: { pos: new THREE.Vector3(0.090, 1.195, 0.470), look: tip, frame: 0.36, bias: 0.20, shake: 0.8 },
    };
  }

  // ---------------------------------------------------------------- phases

  setPhase(name) {
    this.phase = name;
    this.t = 0;

    switch (name) {
      case 'establish':
        this.rig.cut(this.shots.establish);
        this.hints.hide();
        break;

      case 'approach':
        this.rig.move(this.shots.approach, 1.7);
        break;

      case 'spin':
        this.rig.move(this.shots.spin, 1.5);
        break;

      case 'macro':
        this.rig.move(this.shots.macro, 0.9);
        this.hints.hide();
        break;

      case 'blow':
        this.rig.move(this.shots.blow, 0.8);
        this.popStep = 0;
        break;

      case 'silver':
        this.rig.move(this.shots.silver, 0.9);
        this.ws.dropper.visible = true;
        this.silverStep = 0;
        break;

      case 'colour':
        this.hints.show('tap');
        break;

      case 'finish':
        this.hints.hide();
        this.heroLit = 0;
        this.cutDone = false;
        this.hung = false;
        break;

      case 'again':
        break;
    }
  }

  /** The child has been still for a while: coach harder, then help a little. */
  _assist(kind, apply, dt) {
    const idle = this.input.idleFor();
    if (idle > 1.1) this.hints.show(kind); else this.hints.hide();
    this.hints.urgent(idle > 5.5);
    if (idle > 8.5) apply(dt * 0.35);          // never a dead end
  }

  update(dt, time) {
    this.t += dt;
    const s = this.piece.state;
    const inp = this.input;

    // spin is shared by two phases; keep the roll alive between frames
    this.spinVel *= Math.exp(-4.2 * dt);
    s.spin += this.spinVel * dt;
    this.hands.update(s.spin, this.phase !== 'finish' || !this.cutDone);

    switch (this.phase) {
      case 'establish': this._establish(dt); break;
      case 'approach': this._approach(dt); break;
      case 'spin': this._spin(dt); break;
      case 'macro': this._macro(dt); break;
      case 'blow': this._blow(dt); break;
      case 'silver': this._silver(dt); break;
      case 'colour': this._colour(dt); break;
      case 'finish': this._finish(dt, time); break;
      case 'again': this._again(dt); break;
    }

    // the burner keeps a small flame all the time; it flares while working
    const want = this.phase === 'establish' ? sstep(0.2, 1.3, this.t) : 1.0;
    this.flame.setIntensity(lerp(this.flame.intensity, want, dt * 3));
    this.sfx.heat(s.heat);
  }

  // ---- 1. establish: read the room ---------------------------------------
  _establish(dt) {
    if (this.t > 0.35) this.sfx.burner(true);
    if (this.t > 3.3) this.setPhase('approach');
  }

  // ---- 2. approach: the tube tip and the flame ---------------------------
  _approach(dt) {
    if (this.t > 1.55) this.setPhase('spin');
  }

  // ---- 3. SPIN: turn the glass in the flame, it goes red ------------------
  _rollFromDrag(dt) {
    const dx = this.input.takeDX();
    this.input.updateSpeed(dt, dx);
    this.spinVel += dx * 0.10;
    this.spinVel = clamp(this.spinVel, -24, 24);
    this.sfx.spin(clamp(this.input.speed / 900, 0, 1));
    return Math.abs(dx);
  }

  _spin(dt) {
    const s = this.piece.state;
    const px = this._rollFromDrag(dt);
    const gain = (amount) => this.piece.addHeat(amount);

    // the flame is always working on whatever side faces it: leave the tube
    // still and one stripe glows, turn it and the glow goes all the way round
    gain(dt * 0.075);
    gain(Math.min(24, Math.abs(this.spinVel)) * dt * HEAT_PER_RAD);
    this.piece.cool(0.035, dt);
    this._assist('spin', (a) => this.piece.soakHeat(s.heat + a), dt);
    if (px > 0.5) this.hints.hide();
    if (s.heat >= 0.88) this.setPhase('macro');
  }

  // ---- 4. macro: soft, dripping, ready ------------------------------------
  _macro(dt) {
    const s = this.piece.state;
    this._rollFromDrag(dt);
    this.piece.soakHeat(Math.min(1, s.heat + dt * 0.9));
    if (this.t > 1.25) this.setPhase('blow');
  }

  // ---- 5. BLOW: the bubble pushes out — the peak of the middle ------------
  _blow(dt) {
    const s = this.piece.state;
    this._rollFromDrag(dt);
    this.piece.soakHeat(0.92);

    // lift the piece clear of the flame: breath, not fire, does this part
    this.lift = Math.min(1, this.lift + dt * 2.2);
    this.piece.group.position.copy(this.pieceHome.pos).addScaledVector(LIFT_OFF_FLAME, this.lift);
    this.handsAnchor.position.copy(this.piece.group.position);

    const push = (amount) => {
      if (amount <= 0) return;
      this.piece.puff(amount);
      this.sfx.breath(true, clamp(amount * 12, 0.35, 1));
      this.breathHold = 0.12;
    };

    const up = this.input.takeUp();
    let amount = up * BLOW_PER_PX;
    if (this.input.holdTime() > 0.22) amount += dt * BLOW_PER_SEC;
    push(amount);
    if (up > 1) this.hints.hide();
    this._assist('blow', push, dt);

    this.breathHold = (this.breathHold || 0) - dt;
    if (this.breathHold <= 0) this.sfx.breath(false);

    // one "puku" per quarter of the way out
    const step = Math.floor(s.bulgeTarget * 4 + 0.001);
    if (step > this.popStep) {
      this.popStep = step;
      this.sfx.pop(1.15 - step * 0.12);
      this.rig.kick(step >= 4 ? 0.9 : 0.5);
      if (navigator.vibrate) navigator.vibrate(step >= 4 ? 45 : 22);
      this.piece.bulbCenter(this.tmp);
      this.glitter.burst(this.tmp, 6, 0.25, 0.5);
    }

    if (s.bulgeTarget >= 0.995) {
      this.doneAt = (this.doneAt || 0) + dt;
      if (this.doneAt > 0.75) { this.doneAt = 0; this.setPhase('silver'); }
    }
  }

  // ---- 6. SILVER: the same turning gesture, a mirror rises inside ---------
  _silver(dt) {
    const s = this.piece.state;
    const px = this._rollFromDrag(dt);

    this.piece.cool(0.55, dt);                       // the glass cools, red fades

    // the dropper comes in, touches the neck and lets the silver run in
    const enter = sstep(0, 0.55, this.t);
    this.piece.neckPoint(this.tmp);
    this.ws.dropper.position.lerpVectors(
      this.tmp2.copy(this.tmp).add(_v1.set(0.10, 0.10, 0.05)), this.tmp, enter);
    this.ws.dropper.rotation.set(0.5, 0, -0.6);
    if (!this.touched && enter >= 1) { this.touched = true; this.sfx.tick(0.06); }
    if (this.t > 1.15) this.ws.dropper.visible = false;

    if (this.t > 0.7) {
      const gain = (a) => { s.silver = clamp(s.silver + a, 0, 1); };
      gain(px * SILVER_PER_PX);
      this._assist('spin', gain, dt);
      if (px > 0.5) this.hints.hide();
      const step = Math.floor(s.silver * 3 + 0.001);
      if (step > this.silverStep) { this.silverStep = step; this.sfx.shimmer(); }
    }

    if (s.silver >= 0.999) { this.touched = false; this.setPhase('colour'); }
  }

  // ---- 7. COLOUR: one touch, the colour and the glitter go on -------------
  _colour(dt) {
    const s = this.piece.state;
    this._rollFromDrag(dt);
    this.piece.cool(0.55, dt);

    const started = this.tintStarted || this.input.down || this.input.takeTap();
    if (started && !this.tintStarted) {
      this.tintStarted = true;
      this.hints.hide();
      this.sfx.sparkle(6);
      this.piece.bulbCenter(this.tmp);
      this.glitter.burst(this.tmp, Math.min(70, this.quality.glitter), 1.0, 0.9);
      if (navigator.vibrate) navigator.vibrate([18, 40, 18]);
    }
    if (this.tintStarted) {
      s.tint = Math.min(1, s.tint + dt * 2.4);
      s.glitter = Math.min(1, s.glitter + dt * 1.6);
      if (s.tint >= 1) {
        this.holdAdmire = (this.holdAdmire || 0) + dt;
        if (this.holdAdmire > 0.9) { this.holdAdmire = 0; this.tintStarted = false; this.setPhase('finish'); }
      }
    } else {
      this._assist('tap', () => { this.tintStarted = true; }, dt);
    }
  }

  // ---- 8. finish: off the tube, onto the hook ----------------------------
  _finish(dt, time) {
    const s = this.piece.state;
    const t = this.t;

    // tweezers come in and take the piece off the tube
    if (t < 0.9) {
      this.ws.tweezers.visible = true;
      this.piece.neckPoint(this.tmp);
      const k = sstep(0, 0.45, t);
      this.ws.tweezers.position.lerpVectors(
        this.tmp2.copy(this.tmp).add(_v1.set(0.13, -0.10, 0.08)), this.tmp, k);
      this.ws.tweezers.rotation.set(0.3, 0.4, 1.25);
    } else {
      this.ws.tweezers.visible = false;
    }

    if (t > 0.5 && !this.cutDone) {
      this.cutDone = true;
      this.sfx.tick(0.08);
      this.piece.fittings.visible = true;
    }
    if (this.cutDone) s.cut = Math.min(1, s.cut + dt * 6);

    if (t > 0.55) {
      if (!this.movedCam) { this.movedCam = true; this.rig.move(this.shots.hang, 2.0); }

      // lift, turn the neck upwards and carry it to the hook
      const k = sstep(0, 1.25, t - 0.55);
      const target = this.tmp.copy(ANCHOR.hook).add(HANG_OFFSET);
      const qHang = _q1.setFromEuler(HANG_EULER);
      this.piece.group.position.lerpVectors(this.pieceHome.pos, target, k);
      this.piece.group.position.y += Math.sin(k * Math.PI) * 0.05;
      this.piece.group.quaternion.copy(this.pieceHome.quat).slerp(qHang, k);

      // the hands lower the tube out of frame
      this.handsAnchor.position.copy(this.handsHome).addScaledVector(_v1.set(0.10, -0.30, 0.10), k);

      if (k >= 1 && !this.hung) {
        this.hung = true;
        this.sfx.chime();
        this.sfx.sparkle(5);
        this.swingT = 0;
      }
    }

    // the hero light comes up as the piece travels to the hook
    this.heroLit = Math.min(1, (this.heroLit || 0) + dt * (t > 0.6 ? 0.7 : 0));
    this.ws.heroLight.intensity = this.heroLit * 3.6;

    if (this.hung) {
      // it hangs with weight: a slow, damped pendulum about the hook
      this.swingT += dt;
      const a = 0.16 * Math.exp(-0.85 * this.swingT) * Math.cos(this.swingT * 4.4);
      const q = _q1.setFromEuler(HANG_EULER);
      const sw = _q2.setFromAxisAngle(Z_AXIS, a);
      this.piece.group.quaternion.copy(sw).multiply(q);
      const off = _v1.copy(HANG_OFFSET).applyQuaternion(sw);
      this.piece.group.position.copy(ANCHOR.hook).add(off);
      if (this.swingT > 0.9 && this.swingT < 1.0) this.sfx.sparkle(3);
      if (this.swingT > 2.4 || (this.swingT > 1.0 && this.input.takeTap())) this.setPhase('again');
    }
  }

  // ---- 9. again: a fresh tube, straight back to the signature move --------
  _again(dt) {
    if (!this.reset) {
      this.reset = true;
      this._parkFinished();
      this.piece.reset();
      this.run++;
      this.piece.setTint(COLORS[this.run % COLORS.length]);
      this.piece.group.position.copy(this.pieceHome.pos);
      this.piece.group.quaternion.copy(this.pieceHome.quat);
      this.handsAnchor.position.copy(this.handsHome);
      this.lift = 0;
      this.movedCam = false;
      this.hung = false;
      this.cutDone = false;
      this.spinVel = 0;
      this.rig.move(this.shots.again, 1.2);
    }
    if (this.t > 1.25) {
      this.reset = false;
      this.setPhase('spin');
    }
  }

  /** Keep every ornament the child made: they line up on the stand. */
  _parkFinished() {
    const colour = COLORS[this.run % COLORS.length];
    const m = new THREE.Mesh(ornamentGeometry(), new THREE.MeshStandardMaterial({
      color: colour, metalness: 1.0, roughness: 0.16,
      envMap: this.piece.env, envMapIntensity: 1.4,
    }));
    const slot = this.parked.length % 3;
    const g = new THREE.Group();
    const wire = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0013, 0.0013, 0.052, 6),
      new THREE.MeshStandardMaterial({ color: 0x3a3d42, metalness: 0.9, roughness: 0.5 })
    );
    wire.position.y = 0.112;
    m.rotation.y = Math.random() * 3;
    g.add(m, wire);
    g.position.set(ANCHOR.hook.x + (slot + 1) * 0.115, ANCHOR.benchTop + 0.505, ANCHOR.hook.z);
    this.scene.add(g);
    if (this.parked[slot]) this.scene.remove(this.parked[slot]);
    this.parked[slot] = g;
  }
}
