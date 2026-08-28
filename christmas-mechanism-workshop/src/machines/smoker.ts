import * as THREE from 'three';
import { M } from '../mat/materials';
import { contactShadow, hitBox, hitProxy, lathe, setShadow } from '../world/geo';
import { SMOKER_POS } from '../world/layout';
import { SmokeEmitter } from '../fx/smoke';
import { clamp, damp, easeInOut, smoothstep } from '../util/math';
import { audio } from '../audio/audio';
import type { Draggable } from '../game/interaction';

/* ------------------------------------------------------------------ *
 * Module one: the smoking figure.
 *
 * The body is genuinely hollow.  The lower half is a turned cup with a
 * brass saucer on its floor; the upper half is a shell whose inner wall
 * climbs through the neck into the head, where a short duct turns forward
 * and ends at the mouth.  Smoke has exactly one way out, and a section cut
 * shows you why.
 * ------------------------------------------------------------------ */

const H_SPLIT = 0.148;

export class Smoker {
  readonly group = new THREE.Group();
  readonly lower = new THREE.Group();
  readonly upper = new THREE.Group();
  readonly smoke: SmokeEmitter;
  readonly bodyHit: THREE.Object3D;
  // the two halves separate when the body is opened, so each gets its own
  // section plane through its own centre line
  readonly clipLower = new THREE.Plane(new THREE.Vector3(1, 0, 0), 10);
  readonly clipUpper = new THREE.Plane(new THREE.Vector3(1, 0, 0), 10);

  cone!: THREE.Mesh;
  coneDrag!: Draggable;
  lit = false;
  isOpen = false;

  private openAmt = 0;
  private openTarget = 0;
  private cutaway = 0;
  private cutawayTarget = 0;
  private ember: THREE.PointLight;
  private coneMatLit: THREE.MeshStandardMaterial;
  private coneMatCold: THREE.MeshStandardMaterial;
  private clipped: THREE.MeshStandardMaterial[] = [];
  private smokeDelay = -1;
  private mouthLocal = new THREE.Vector3(0, 0.2045, 0.0350);
  private tmp = new THREE.Vector3();
  private emberBase = 0;

  constructor(shadows: boolean, smokeCount: number) {
    const m = M();
    this.group.position.copy(SMOKER_POS);
    this.group.rotation.y = 0.14;
    this.group.add(this.lower, this.upper);

    const clip = (mat: THREE.MeshStandardMaterial, upper = true) => {
      const c = mat.clone();
      c.clippingPlanes = [upper ? this.clipUpper : this.clipLower];
      c.side = THREE.DoubleSide;
      this.clipped.push(c);
      return c;
    };
    const clipLo = (mat: THREE.MeshStandardMaterial) => clip(mat, false);

    /* ---------- lower half: a turned cup with a real cavity ---------- */
    const lowerShell = new THREE.Mesh(lathe([
      [0, 0], [0.0525, 0], [0.0548, 0.010], [0.0512, 0.048],
      [0.0500, 0.086], [0.0512, 0.116], [0.0455, H_SPLIT],   // outer, bottom -> rim
      [0.0365, H_SPLIT],                                      // rim face
      [0.0355, 0.132], [0.0375, 0.098], [0.0355, 0.055],
      [0.0300, 0.032], [0, 0.030],                            // inner wall -> cavity floor
    ], 40), clipLo(m.mapleTurned));
    this.lower.add(lowerShell);

    // painted coat over the turned blank; the paint is a skin, not the form
    const lowerPaint = new THREE.Mesh(lathe([
      [0.0522, 0.022], [0.0530, 0.030], [0.0519, 0.048],
      [0.0508, 0.086], [0.0520, 0.116], [0.0463, H_SPLIT],
    ], 40), clipLo(m.paintRed));
    this.lower.add(lowerPaint);
    const boots = new THREE.Mesh(lathe([
      [0, 0.0005], [0.0528, 0.0005], [0.0551, 0.010], [0.0524, 0.022],
    ], 32), clipLo(m.paintBrown));
    this.lower.add(boots);

    // brass saucer: this is where the cone goes
    const dish = new THREE.Mesh(lathe([
      [0, 0.0295], [0.0225, 0.0305], [0.0245, 0.0345],
      [0.0235, 0.0355], [0.0215, 0.0325], [0, 0.0315],
    ], 24), clipLo(m.brass));
    this.lower.add(dish);

    /* ---------- upper half: shell, duct, mouth ---------- */
    const upperShell = new THREE.Mesh(lathe([
      [0.0455, H_SPLIT], [0.0480, 0.1580], [0.0468, 0.1720], [0.0405, 0.1830],
      [0.0270, 0.1890], [0.0200, 0.1930],                     // shoulders, collar, neck
      [0.0290, 0.1975], [0.0378, 0.2075], [0.0368, 0.2170],
      [0.0280, 0.2240], [0.0140, 0.2285], [0, 0.2295],        // head, crown on axis
      [0.0125, 0.2245], [0.0180, 0.2150], [0.0175, 0.2040],   // head cavity, downward
      [0.0110, 0.1950], [0.0100, 0.1900],                     // throat
      [0.0215, 0.1810], [0.0305, 0.1695], [0.0360, 0.1580], [0.0365, H_SPLIT],
    ], 40), clip(m.mapleTurned));
    this.upper.add(upperShell);

    const coatUpper = new THREE.Mesh(lathe([
      [0.0463, H_SPLIT], [0.0489, 0.1580], [0.0477, 0.1720],
      [0.0414, 0.1830], [0.0279, 0.1890],
    ], 40), clip(m.paintRed));
    this.upper.add(coatUpper);

    const face = new THREE.Mesh(lathe([
      [0.0207, 0.1930], [0.0297, 0.1975], [0.0385, 0.2075],
      [0.0375, 0.2170], [0.0287, 0.2240],
    ], 40), clip(m.skinPaint));
    this.upper.add(face);

    // the duct: head cavity -> forward -> mouth. Real tube, dark inside.
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.1955, 0.000),
      new THREE.Vector3(0, 0.2010, 0.009),
      new THREE.Vector3(0, 0.2040, 0.022),
      new THREE.Vector3(0, 0.2045, 0.0345),
    ]);
    const duct = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 16, 0.0062, 12, false), clip(m.interiorDark));
    this.upper.add(duct);
    // the mouth: a small bored opening, dark and deep, flush with the face
    const mouth = new THREE.Mesh(lathe([
      [0.0058, 0], [0.0058, -0.006], [0.0034, -0.012], [0, -0.013],
    ], 16), clip(m.charBlack));
    mouth.rotation.x = Math.PI / 2;
    mouth.position.copy(this.mouthLocal);
    this.upper.add(mouth);

    // hat with a real brim, eyes, a nose, a chin beard - a face a child reads
    const hat = new THREE.Mesh(lathe([
      [0, 0.2265], [0.0360, 0.2275], [0.0500, 0.2312], [0.0486, 0.2348],
      [0.0310, 0.2358], [0.0256, 0.2392], [0.0250, 0.2680],
      [0.0222, 0.2740], [0, 0.2752],
    ], 32), clip(m.paintTeal));
    this.upper.add(hat);
    const band = new THREE.Mesh(lathe([
      [0.0262, 0.2412], [0.0265, 0.2482], [0.0255, 0.2488],
    ], 32), clip(m.paintOchre));
    this.upper.add(band);

    const beard = new THREE.Mesh(lathe([
      [0.0215, 0.1900], [0.0310, 0.1955], [0.0342, 0.2005], [0.0312, 0.2032],
    ], 26, Math.PI * 0.92), clip(m.paintCream));
    beard.rotation.y = -Math.PI * 0.46;
    this.upper.add(beard);

    const eyeGeo = new THREE.SphereGeometry(0.0030, 8, 6);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(eyeGeo, clip(m.charBlack));
      eye.position.set(s * 0.0125, 0.2135, 0.0342);
      this.upper.add(eye);
    }
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.0050, 0.0105, 8), clip(m.skinPaint));
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 0.2092, 0.0368);
    this.upper.add(nose);

    // short carved arms hanging along the coat, hands at the split line
    const armGeo = lathe([
      [0.0088, 0], [0.0096, 0.005], [0.0082, 0.030], [0.0070, 0.040],
    ], 12);
    const handGeo = new THREE.SphereGeometry(0.0088, 10, 8);
    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(armGeo, clip(m.paintRed));
      arm.position.set(s * 0.0455, 0.1810, 0.0060);
      arm.rotation.set(-0.14, 0, s * (Math.PI - 0.28));
      this.upper.add(arm);
      const hand = new THREE.Mesh(handGeo, clip(m.paintCream));
      hand.position.set(s * 0.0568, 0.1408, 0.0104);
      this.upper.add(hand);
    }
    const buttonGeo = new THREE.SphereGeometry(0.0033, 8, 6);
    for (let i = 0; i < 2; i++) {
      const b = new THREE.Mesh(buttonGeo, clip(m.brass));
      b.position.set(0, 0.1615 + i * 0.0145, 0.0462 - i * 0.0014);
      this.upper.add(b);
    }

    /* ---------- incense cone ---------- */
    this.coneMatCold = m.incense;
    this.coneMatLit = m.incenseLit.clone();
    this.cone = new THREE.Mesh(lathe([
      [0, 0], [0.0092, 0.0005], [0.0088, 0.004], [0.0060, 0.0125],
      [0.0026, 0.0185], [0, 0.0205],
    ], 16), this.coneMatCold);
    this.cone.name = 'incense';
    const coneHit = hitProxy(0.036, 'incense');
    coneHit.position.y = 0.012;
    this.cone.add(coneHit);

    this.ember = new THREE.PointLight(0xff5c14, 0, 0.30, 2);
    this.ember.position.set(0, 0.048, 0);
    this.cone.add(this.ember);

    /* ---------- hit proxies ---------- */
    this.bodyHit = hitBox(0.14, 0.29, 0.14, 'smoker');
    this.bodyHit.position.set(0, 0.142, 0);
    this.group.add(this.bodyHit);

    const shadow = contactShadow(0.085, 0.55);
    shadow.position.y = 0.0012;
    this.group.add(shadow);

    setShadow(this.lower, shadows, true);
    setShadow(this.upper, shadows, false);

    this.smoke = new SmokeEmitter(smokeCount);
    this.updateClip();
  }

  /* ---------------- world-space anchors ---------------- */

  mouthWorld(out = new THREE.Vector3()) {
    this.upper.updateWorldMatrix(true, false);
    return out.copy(this.mouthLocal).applyMatrix4(this.upper.matrixWorld);
  }
  /** Where the mouth sits once the body is closed - the shot has to be framed
   *  on that, not on wherever the lifted half happens to be resting. */
  mouthClosedWorld(out = new THREE.Vector3()) {
    this.group.updateWorldMatrix(true, false);
    return out.copy(this.mouthLocal).applyMatrix4(this.group.matrixWorld);
  }
  mouthDirWorld(out = new THREE.Vector3()) {
    return out.set(0, 0.52, 1).normalize()
      .applyQuaternion(this.group.getWorldQuaternion(new THREE.Quaternion()));
  }
  coneTipWorld(out = new THREE.Vector3()) {
    this.cone.updateWorldMatrix(true, false);
    return out.set(0, 0.021, 0).applyMatrix4(this.cone.matrixWorld);
  }
  dishWorld(out = new THREE.Vector3()) {
    this.lower.updateWorldMatrix(true, false);
    return out.set(0, 0.033, 0).applyMatrix4(this.lower.matrixWorld);
  }
  upperHandleWorld(out = new THREE.Vector3()) {
    this.upper.updateWorldMatrix(true, false);
    return out.set(0, 0.20, 0).applyMatrix4(this.upper.matrixWorld);
  }

  /* ---------------- state ---------------- */

  open() { this.openTarget = 1; this.isOpen = true; this.smokeDelay = -1; }
  close() { this.openTarget = 0; this.isOpen = false; }

  /** Slice the upper half away for a moment so the duct can be read. */
  showSection(on: boolean) { this.cutawayTarget = on ? 1 : 0; }

  ignite() {
    if (this.lit) return;
    this.lit = true;
    this.cone.material = this.coneMatLit;
    audio.igniteWhoosh();
    audio.emberBreath();
  }

  extinguish() {
    this.lit = false;
    this.cone.material = this.coneMatCold;
    this.smoke.rate = 0;
    this.smoke.clear();
  }

  private updateClip() {
    // each half is sectioned on its own centre line, so lifting the top does
    // not slice the bottom away with it
    this.upper.updateWorldMatrix(true, false);
    const ux = this.tmp.setFromMatrixPosition(this.upper.matrixWorld).x;
    const lx = this.group.position.x;
    const on = this.cutaway > 0.001;
    this.clipUpper.constant = on ? -(ux - 0.075 + this.cutaway * 0.075) : 10;
    this.clipLower.constant = on ? -(lx - 0.075 + this.cutaway * 0.075) : 10;
  }

  update(dt: number, time: number) {
    this.openAmt = damp(this.openAmt, this.openTarget, 5.0, dt);
    const e = easeInOut(clamp(this.openAmt, 0, 1));
    // the top half is lifted clear and set down on the bench beside the body:
    // it stands on its own rim, it does not hover
    const arc = Math.sin(e * Math.PI) * 0.085;
    this.upper.position.set(e * 0.108, arc - e * H_SPLIT, e * 0.006);
    this.upper.rotation.set(0, e * 0.34, 0);

    this.cutaway = damp(this.cutaway, this.cutawayTarget, 3.4, dt);
    this.updateClip();

    // the ember only shows while the body is open; closed wood hides it
    const hidden = 1 - smoothstep(0.05, 0.55, this.openAmt);
    this.emberBase = this.lit ? 1 : 0;
    const flick = 0.72 + 0.28 * Math.sin(time * 5.7) * Math.sin(time * 2.3);
    this.ember.intensity = this.emberBase * (1 - hidden * 0.94) * 0.085 * flick;
    this.coneMatLit.emissiveIntensity = this.emberBase * (0.7 + flick * 0.9);

    /* --- where the smoke comes from --- */
    if (this.lit) {
      if (this.openAmt > 0.35) {
        // body open: the cone itself wisps, thin and straight up
        this.smoke.setOrigin(this.coneTipWorld(this.tmp), new THREE.Vector3(0, 1, 0));
        this.smoke.rate = 9;
        this.smoke.strength = 0.55;
        this.smoke.speed = 0.045;
        this.smokeDelay = -1;
      } else {
        // body closed: nothing, then the duct fills, then the mouth
        if (this.smokeDelay < 0) { this.smokeDelay = 0; this.smoke.rate = 0; }
        this.smokeDelay += dt;
        this.smoke.setOrigin(this.mouthWorld(this.tmp), this.mouthDirWorld());
        this.smoke.speed = 0.085;
        this.smoke.strength = 1;
        this.smoke.rate = this.smokeDelay > 1.35
          ? 15 * clamp((this.smokeDelay - 1.35) / 1.1, 0.12, 1)
          : 0;
      }
    } else {
      this.smoke.rate = 0;
    }
    this.smoke.update(dt, time);
  }

  /** true once smoke is actually leaving the mouth */
  get puffing() { return this.lit && !this.isOpen && this.smokeDelay > 1.5; }
}
