import * as THREE from 'three';
import { makeToolSteel } from '../gfx/textures';
import { clamp, lerp, smoothstep } from '../core/util';
import type { Orientation } from '../core/stage';

/**
 * The tooling. The child never touches hot or sharp metal: everything is done
 * through a big lever, a guarded press and an automatic collet.
 */

export const DIE_FACE_Y = 0.02;

export class Fixture {
  readonly root = new THREE.Group();
  readonly steel: THREE.MeshStandardMaterial;
  readonly die = new THREE.Group();
  readonly press = new THREE.Group();
  readonly ram = new THREE.Group();
  readonly collet = new THREE.Group();
  readonly lever: Lever;
  readonly clinchLever: Lever;
  private colletFingers: THREE.Mesh[] = [];
  private punchRadius: number;
  private bellRadius: number;

  constructor(env: THREE.Texture, bellRadius: number, thickness: number) {
    this.bellRadius = bellRadius;
    const tex = makeToolSteel(512);
    this.steel = new THREE.MeshStandardMaterial({
      map: tex.map, roughnessMap: tex.roughnessMap,
      color: 0x7f868e, metalness: 0.6, roughness: 0.5,
      envMap: env, envMapIntensity: 0.75,
    });
    const dark = this.steel.clone();
    dark.color = new THREE.Color(0x646a72);
    dark.roughness = 0.78;

    const rimClosed = bellRadius * 0.8187;
    const bore = rimClosed + thickness * 1.05;
    this.punchRadius = bellRadius - thickness * 0.5;

    // ------------------------------------------------------------- the die
    const bead = thickness * 1.7;
    const outer = bellRadius * 2.15;
    // profile walked outer-bottom -> up -> in across the face -> down the draw
    // radius -> down the bore, which is the winding Lathe wants for outward normals
    const prof: THREE.Vector2[] = [];
    prof.push(new THREE.Vector2(outer, DIE_FACE_Y - 0.30));
    prof.push(new THREE.Vector2(outer, DIE_FACE_Y - 0.014));
    prof.push(new THREE.Vector2(outer * 0.985, DIE_FACE_Y));
    prof.push(new THREE.Vector2(bore + bead, DIE_FACE_Y));
    for (let k = 6; k >= 0; k--) {
      // rounded draw radius: the edge the cup and later every petal bends over
      const a = (k / 6) * (Math.PI / 2);
      prof.push(new THREE.Vector2(
        bore + bead * (1 - Math.cos(a)),
        DIE_FACE_Y - bead * (1 - Math.sin(a))
      ));
    }
    prof.push(new THREE.Vector2(bore, DIE_FACE_Y - 0.30));
    const dieMesh = new THREE.Mesh(new THREE.LatheGeometry(prof, 56), this.steel);
    dieMesh.castShadow = true;
    dieMesh.receiveShadow = true;
    this.die.add(dieMesh);

    // a heavy bolster under the die, so the tooling reads as a real machine part
    const bolster = new THREE.Mesh(
      new THREE.CylinderGeometry(outer * 1.14, outer * 1.2, 0.05, 40), dark
    );
    bolster.position.y = DIE_FACE_Y - 0.30;
    bolster.castShadow = true; bolster.receiveShadow = true;
    this.die.add(bolster);
    this.root.add(this.die);

    // ----------------------------------------------------------- the press
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.30, 1.05, 0.17), dark);
    frame.position.set(0, 0.525, -0.62);
    frame.castShadow = true;
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.34), dark);
    foot.position.set(0, 0.03, -0.6);
    foot.castShadow = true; foot.receiveShadow = true;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.62), dark);
    head.position.set(0, 0.98, -0.34);
    head.castShadow = true;
    const gib = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.6, 0.13), this.steel);
    gib.position.set(0, 0.66, -0.06);
    this.press.add(frame, foot, head, gib);

    // ram + spherical-nosed punch
    const shank = new THREE.Mesh(
      new THREE.CylinderGeometry(bellRadius * 0.34, bellRadius * 0.34, 0.5, 20), this.steel
    );
    shank.position.y = 0.25 + this.punchRadius * 0.55;
    const punch = new THREE.Mesh(
      new THREE.SphereGeometry(this.punchRadius, 34, 22, 0, Math.PI * 2, 0, Math.PI * 0.62),
      this.steel
    );
    punch.rotation.x = Math.PI;   // nose down
    const punchTop = new THREE.Mesh(
      new THREE.CylinderGeometry(this.punchRadius * 0.99, this.punchRadius * 0.99, 0.02, 34),
      this.steel
    );
    punchTop.position.y = this.punchRadius * 0.53;
    const guide = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.11), dark);
    guide.position.set(0, 0.62, -0.06);
    shank.castShadow = true; punch.castShadow = true;
    this.ram.add(shank, punch, punchTop, guide);
    this.press.add(this.ram);

    // safety guard: real, but deliberately not between the eye and the metal
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0xd6e6ef, transparent: true, opacity: 0.03, roughness: 0.04,
      metalness: 0.0, envMap: env, envMapIntensity: 1.2, side: THREE.DoubleSide,
      depthWrite: false,
    });
    const guardFrameMat = dark.clone();
    guardFrameMat.color = new THREE.Color(0x6b5a30);
    for (const [x, rot] of [[-0.26, 0.9], [0.26, -0.9]] as const) {
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.34), glassMat);
      panel.position.set(x, 0.34, -0.44);
      panel.rotation.y = rot;
      this.press.add(panel);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.42, 0.014), guardFrameMat);
      bar.position.set(x * 1.5, 0.34, -0.32);
      this.press.add(bar);
    }
    const hood = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.24), glassMat);
    hood.position.set(0, 0.60, -0.30);
    hood.rotation.x = -0.9;
    this.press.add(hood);
    const hoodBar = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.014, 0.014), guardFrameMat);
    hoodBar.position.set(0, 0.49, -0.18);
    this.press.add(hoodBar);
    this.press.position.set(-0.52, 0, -0.30);
    this.press.rotation.y = 0.42;
    this.root.add(this.press);

    // ---------------------------------------------------- the clinch collet
    const colletR = bellRadius * 1.12;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const f = new THREE.Group();
      const finger = new THREE.Mesh(
        new THREE.BoxGeometry(bellRadius * 0.5, bellRadius * 0.86, bellRadius * 0.2), this.steel
      );
      finger.position.y = -bellRadius * 0.4;
      finger.castShadow = true;
      const tip = new THREE.Mesh(
        new THREE.CylinderGeometry(bellRadius * 0.09, bellRadius * 0.09, bellRadius * 0.5, 12),
        this.steel
      );
      tip.rotation.z = Math.PI / 2;
      tip.position.y = -bellRadius * 0.82;
      f.add(finger, tip);
      f.position.set(Math.cos(a) * colletR, 0, Math.sin(a) * colletR);
      f.rotation.y = -a;
      f.userData.angle = a;
      this.colletFingers.push(f as unknown as THREE.Mesh);
      this.collet.add(f);
    }
    const colletBody = new THREE.Mesh(
      new THREE.CylinderGeometry(colletR * 1.16, colletR * 1.16, bellRadius * 0.3, 30), dark
    );
    colletBody.position.y = bellRadius * 0.16;
    colletBody.castShadow = true;
    const colletStem = new THREE.Mesh(
      new THREE.CylinderGeometry(bellRadius * 0.2, bellRadius * 0.2, 0.5, 16), this.steel
    );
    colletStem.position.y = bellRadius * 0.16 + 0.25;
    this.collet.add(colletBody, colletStem);
    this.collet.visible = false;
    this.root.add(this.collet);

    // ----------------------------------------------------------- the levers
    this.lever = new Lever(env, 0x3a2515, 'ball');
    this.clinchLever = new Lever(env, 0x241a12, 'grip');
    this.root.add(this.lever.root, this.clinchLever.root);
    this.clinchLever.root.visible = false;
    this.setRamProgress(0, 0);
    this.setColletProgress(0);
  }

  /** Punch height. `contactY` is where the metal it is forming currently is. */
  setRamProgress(approach: number, contactY: number) {
    const restY = 0.86;
    const touchY = DIE_FACE_Y + this.punchRadius;
    const y = approach < 1
      ? lerp(restY, touchY, smoothstep(0, 1, approach))
      : contactY + this.punchRadius;
    this.ram.position.y = y;
  }

  /** 0 = parked above, 1 = closed hard around the shell. */
  setColletProgress(t: number) {
    const drop = smoothstep(0, 0.62, t);
    const squeeze = smoothstep(0.55, 1, t);
    this.collet.visible = t > 0.001;
    this.collet.position.y = lerp(0.66, DIE_FACE_Y + this.bellRadius * 1.02, drop);
    for (const f of this.colletFingers) {
      const a = f.userData.angle as number;
      const r = this.bellRadius * lerp(1.12, 0.995, squeeze);
      f.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    }
  }

  layout(o: Orientation) {
    this.lever.layout(o);
    this.clinchLever.layout(o);
  }
}

/** A big two-hand lever. The only control the game ever asks for. */
export const LEVER_KNOB_Y = 0.35;

export class Lever {
  readonly root = new THREE.Group();
  readonly pivot = new THREE.Group();
  readonly knob: THREE.Mesh;
  /** 0 = up, 1 = fully pulled */
  progress = 0;
  private maxAngle = 1.12;

  constructor(env: THREE.Texture, knobColor: number, shape: 'ball' | 'grip') {
    const steel = new THREE.MeshStandardMaterial({
      color: 0x8a9199, metalness: 0.85, roughness: 0.55, envMap: env, envMapIntensity: 0.6,
    });
    const dark = new THREE.MeshStandardMaterial({
      color: 0x2b3036, metalness: 0.2, roughness: 0.88, envMap: env, envMapIntensity: 0.2,
    });
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.125, 0.13, 20), dark);
    pedestal.position.y = 0.065;
    pedestal.castShadow = true; pedestal.receiveShadow = true;
    const boss = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.12, 16), steel);
    boss.rotation.z = Math.PI / 2;
    boss.position.y = 0.13;
    this.root.add(pedestal, boss);

    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.03, 0.20, 14), steel);
    arm.position.y = 0.10;
    arm.castShadow = true;
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.05, 14), dark);
    collar.position.y = 0.18;
    const knobMat = new THREE.MeshStandardMaterial({
      color: knobColor, roughness: 0.8, metalness: 0.0,
      envMap: env, envMapIntensity: 0.14,
    });
    this.knob = shape === 'ball'
      ? new THREE.Mesh(new THREE.SphereGeometry(0.064, 22, 16), knobMat)
      : new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.058, 0.15, 18), knobMat);
    this.knob.position.y = 0.22;
    this.knob.castShadow = true;
    this.pivot.add(arm, collar, this.knob);
    this.pivot.position.y = 0.13;
    this.root.add(this.pivot);
    this.setProgress(0);
  }

  setProgress(p: number) {
    this.progress = clamp(p, 0, 1);
    this.pivot.rotation.x = this.progress * this.maxAngle;
  }

  knobWorld(out = new THREE.Vector3()) {
    this.knob.updateWorldMatrix(true, false);
    return out.setFromMatrixPosition(this.knob.matrixWorld);
  }

  layout(o: Orientation) {
    this.root.rotation.y = o === 'landscape' ? 0.34 : -0.12;
  }

  /** Stand the lever on the bench at a solved world position. */
  standAt(x: number, z: number, smooth: number) {
    const a = clamp(smooth, 0, 1);
    this.root.position.x += (x - this.root.position.x) * a;
    this.root.position.z += (z - this.root.position.z) * a;
  }
}
