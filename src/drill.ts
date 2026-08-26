import * as THREE from 'three';
import {
  CORE_LEN, DRILL_HALF, R_BARREL, R_CABLE, R_CORE,
  P_BREAK_END, P_OUT_END, clamp01, drillCenterY, lerp, revealT, smooth,
} from './journey';
import { makeCoreIceMaterial, metalMat } from './materials';

const HINGE = new THREE.Vector3(0, 0.5, 0); // tower tilt hinge above the hole

// The persistent drill: cable + anti-torque + motor + core barrel + core.
// One object travels the whole journey; the core never leaves the barrel
// until the reveal at the surface.
export class Drill {
  group = new THREE.Group();
  private cable: THREE.Mesh;
  private slide = new THREE.Group(); // parts that withdraw to expose the core
  private core: THREE.Mesh;
  private coreMat = makeCoreIceMaterial();
  private puff!: THREE.Points;
  private puffMat!: THREE.PointsMaterial;
  private tmpQ = new THREE.Quaternion();
  private zAxis = new THREE.Vector3(0, 0, 1);

  constructor(parent: THREE.Object3D) {
    const g = this.group;

    const alu = metalMat({ color: 0xc6ced5, rough: 0.5, metal: 0.45 });
    alu.side = THREE.DoubleSide;
    const steel = metalMat({ color: 0x7d868e, rough: 0.52, metal: 0.55 });
    const darkSteel = metalMat({ color: 0x565e65, rough: 0.62, metal: 0.55 });
    const scuffed = metalMat({ color: 0x848a90, rough: 0.75, metal: 0.45 });
    const frosty = metalMat({ color: 0x8d969d, rough: 0.5, metal: 0.55, frost: 0.55 });

    // ---- lower assembly that slides off during the reveal (head + barrel shell)
    const slide = this.slide;
    g.add(slide);

    // cutter head: an open ring (the core passes through it when pushed out)
    const scuffedDS = scuffed.clone();
    scuffedDS.side = THREE.DoubleSide;
    const head = new THREE.Mesh(
      new THREE.CylinderGeometry(R_BARREL + 0.006, R_BARREL - 0.008, 0.1, 28, 1, true), scuffedDS);
    head.position.y = -DRILL_HALF + 0.05;
    slide.add(head);
    const headRim = new THREE.Mesh(new THREE.TorusGeometry(R_BARREL - 0.005, 0.012, 8, 28), scuffedDS);
    headRim.rotation.x = Math.PI / 2;
    headRim.position.y = -DRILL_HALF + 0.01;
    slide.add(headRim);
    for (let i = 0; i < 5; i++) {
      const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.05, 0.02), darkSteel);
      const a = (i / 5) * Math.PI * 2 + 0.4;
      tooth.position.set(Math.sin(a) * (R_BARREL - 0.02), -DRILL_HALF + 0.005, Math.cos(a) * (R_BARREL - 0.02));
      tooth.rotation.y = a;
      slide.add(tooth);
    }

    // core barrel: metal shell with a 52° educational cut-out facing the camera
    const gap = (52 * Math.PI) / 180;
    const slotTwist = 0.30; // slot turned slightly off-axis so the shell reads as metal
    const shell = new THREE.Mesh(
      new THREE.CylinderGeometry(R_BARREL, R_BARREL, 1.35, 36, 1, true, gap / 2 + slotTwist, Math.PI * 2 - gap),
      alu,
    );
    shell.position.y = -0.985;
    slide.add(shell);
    // slot edge strips
    for (const s of [-1, 1]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1.35, 0.022), steel);
      const a = (s * gap) / 2 + slotTwist;
      strip.position.set(Math.sin(a) * R_BARREL, -0.985, Math.cos(a) * R_BARREL);
      strip.rotation.y = a;
      slide.add(strip);
    }
    // barrel end rings
    for (const y of [-1.66, -0.32]) {
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(R_BARREL + 0.008, R_BARREL + 0.008, 0.05, 28), steel);
      ring.position.y = y;
      slide.add(ring);
    }

    // ---- the ice core, held inside the barrel from the very start
    this.core = new THREE.Mesh(new THREE.CylinderGeometry(R_CORE, R_CORE, CORE_LEN, 24, 1), this.coreMat);
    this.coreMat.uniforms.uHalfLen.value = CORE_LEN / 2;
    this.core.position.y = -1.095;
    g.add(this.core);

    // ---- motor / gear section (slightly slimmer than the barrel, as on the
    // real sonde — the withdrawn shell can pass over it during the reveal)
    const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.146, 0.146, 0.85, 28), steel);
    motor.position.y = 0.175;
    g.add(motor);
    for (const y of [-0.05, 0.175, 0.4]) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(0.147, 0.008, 8, 28), darkSteel);
      rib.rotation.x = Math.PI / 2;
      rib.position.y = y;
      g.add(rib);
    }
    const joint = new THREE.Mesh(new THREE.CylinderGeometry(0.148, 0.148, 0.07, 28), darkSteel);
    joint.position.y = -0.28;
    g.add(joint);

    // ---- anti-torque section: shaft + 3 leaf springs pressing the wall
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.62, 16), frosty);
    shaft.position.y = 0.93;
    g.add(shaft);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      // leaf springs bow outward and run parallel to the shaft
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.5, 0.012), frosty);
      leaf.position.set(Math.sin(a) * 0.165, 0.93, Math.cos(a) * 0.165);
      leaf.rotation.y = a;
      g.add(leaf);
      // standoff bracket so the spring visibly attaches to the shaft
      const brk = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.12), darkSteel);
      brk.position.set(Math.sin(a) * 0.1, 0.93, Math.cos(a) * 0.1);
      brk.rotation.y = a + Math.PI / 2;
      g.add(brk);
      for (const s of [-1, 1]) {
        const tip = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.13, 0.012), frosty);
        tip.position.set(Math.sin(a) * 0.11, 0.93 + s * 0.3, Math.cos(a) * 0.11);
        tip.rotation.y = a;
        tip.rotateX(-s * 0.45);
        g.add(tip);
      }
    }
    for (const y of [0.64, 1.22]) {
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.06, 16), darkSteel);
      collar.position.y = y;
      g.add(collar);
    }

    // ---- cable termination + cable
    const term = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.07, 0.3, 16), frosty);
    term.position.y = 1.42;
    g.add(term);
    // unit-height cable anchored at its bottom, scaled per-frame
    const cgeo = new THREE.CylinderGeometry(R_CABLE, R_CABLE, 1, 8, 1);
    cgeo.translate(0, 0.5, 0);
    this.cable = new THREE.Mesh(cgeo, metalMat({ color: 0x23272b, rough: 0.6, metal: 0.6 }));
    this.cable.position.y = 1.55;
    g.add(this.cable);

    // ice-dust puff for the moment the core is snapped off its base
    {
      const N = 42;
      const pts = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2 * 3.7, b = ((i * 7919) % N) / N;
        pts[i * 3] = Math.sin(a) * (0.4 + b * 0.6);
        pts[i * 3 + 1] = (b - 0.4) * 0.7;
        pts[i * 3 + 2] = Math.cos(a) * (0.4 + b * 0.6);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
      this.puffMat = new THREE.PointsMaterial({
        color: 0xd8ecfa, size: 0.035, transparent: true, opacity: 0,
        depthWrite: false, blending: THREE.AdditiveBlending,
      });
      this.puff = new THREE.Points(geo, this.puffMat);
      this.puff.position.y = -DRILL_HALF + 0.1;
      g.add(this.puff);
    }

    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) { o.castShadow = true; }
    });
    parent.add(g);
  }

  /** Tower tilt angle in radians for the reveal (also used by the surface rig). */
  static tiltAngle(p: number): number {
    const t = revealT(p);
    return -Math.PI / 2 * smooth(clamp01(t / 0.45));
  }

  update(p: number, time: number, reduced: boolean): void {
    const g = this.group;
    const y = drillCenterY(p);
    const t = revealT(p);

    // base vertical pose with gentle pendulum sway during ascent
    let sway = 0;
    let jitter = 0;
    if (p > P_BREAK_END && p < 0.88) {
      sway = reduced ? 0 : Math.sin(time * 0.9) * 0.012 + Math.sin(time * 2.3) * 0.004;
    }
    if (p > 0.055 && p < P_BREAK_END && !reduced) {
      // the moment the core is broken off its base: short decaying shake
      const k = smooth((p - 0.055) / 0.02) * (1 - smooth((p - 0.08) / 0.02));
      jitter = Math.sin(time * 55.0) * 0.008 * k;
    }

    if (t <= 0) {
      g.position.set(sway + jitter, y, 0);
      g.quaternion.identity();
      g.rotation.z = sway * 0.6;
    } else {
      // reveal: rotate about the tower hinge, drill comes to rest horizontally
      const ang = Drill.tiltAngle(p);
      this.tmpQ.setFromAxisAngle(this.zAxis, ang);
      g.quaternion.copy(this.tmpQ);
      const rel = new THREE.Vector3(0, y, 0).sub(HINGE).applyQuaternion(this.tmpQ);
      g.position.copy(HINGE).add(rel);
      // settle a touch lower onto the cradle
      const settle = smooth(clamp01((t - 0.3) / 0.2));
      g.position.y -= settle * 0.12;
    }

    // the barrel shell is drawn back over the slim motor section, so the core
    // is pushed out through the open head ring onto the cradle
    const slideT = smooth(clamp01((t - 0.5) / 0.38));
    this.slide.position.y = slideT * 1.05;

    // cable: long while in the hole, short strap up to the sheave once out
    const strain = p < P_BREAK_END ? smooth(p / P_BREAK_END) : 1;
    const inHole = clamp01((-y - 1.6) / 3);
    const len = lerp(1.45, 70, inHole);
    this.cable.scale.y = len * (0.995 + strain * 0.005);
    this.cable.visible = t < 0.35;

    // deterministic dust puff around the break-off (reconstructable from p)
    const pw = clamp01((p - 0.055) / 0.11);
    const puffR = 0.15 + pw * 1.1;
    this.puff.scale.setScalar(puffR);
    this.puffMat.opacity = p > 0.045 && p < 0.19
      ? 0.75 * smooth(pw / 0.25) * (1 - smooth((pw - 0.45) / 0.55))
      : 0;

    this.coreMat.uniforms.uTime.value = time;
  }

  /** Ambient tint for the core material as it travels from blue depth to daylight. */
  setLightMood(deepness: number): void {
    const amb = this.coreMat.uniforms.uAmbient.value as THREE.Color;
    amb.setRGB(
      lerp(0.5, 0.2, deepness) + 0.02,
      lerp(0.6, 0.33, deepness),
      lerp(0.68, 0.5, deepness),
    );
    this.coreMat.uniforms.uSunI.value = lerp(0.85, 0.32, deepness);
  }
}
