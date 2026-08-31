/**
 * The workshop: every object the child sees, and the once-per-frame job of
 * moving them to wherever the rig says they are.
 *
 * Nothing here decides anything. The head's transform is the rig's support
 * point and the rig's angle; the counterweight's transform is the rig's rail
 * parameter; the thread is drawn between the points that are actually holding
 * the head up. If the drawing and the physics ever disagreed it would be
 * because this file made something up, so it does not.
 */
import {
  AmbientLight,
  BufferGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  Material,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Plane,
  Raycaster,
  Scene,
  Sphere,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
  ACESFilmicToneMapping,
  SRGBColorSpace,
  PCFSoftShadowMap,
} from 'three';
import { buildBody, buildCutFace, buildLegs, buildPegs } from '../geom/body';
import { buildHead } from '../geom/head';
import { buildBench, buildChinRest, buildGrip, buildJig, buildKnot, buildToggle, buildTray } from '../geom/props';
import { buildRoom } from '../geom/room';
import { Cord } from '../geom/cord';
import { buildMaterials, type Materials } from './materials';
import { CameraRig } from './camera';
import { GRIP, HEAD, JIG, MM, THREAD_PEGS, THREAD_R, TOGGLE } from '../sim/dims';
import { HeadRig, threadSag } from '../sim/rig';
import type { Stage } from '../sim/stages';
import { pullFraction } from '../sim/stages';

const v = (x: number, y: number, z: number): Vector3 => new Vector3(x * MM, y * MM, z * MM);

/** Named grab targets. Their size is set in screen pixels, not in millimetres. */
export type PickName = 'grip' | 'head' | 'toggle' | 'tie';

interface Pickable {
  name: PickName;
  mesh: Mesh;
  px: number;
}

export interface SceneStats {
  triangles: number;
  drawCalls: number;
}

export class Workshop {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly rig = new CameraRig();

  private mats: Materials;
  private headGroup = new Group();
  private weightPivot = new Group();
  private gripMesh: Mesh;
  private chinRest: Mesh;
  private jigMesh: Mesh;
  private toggleMesh: Mesh;
  private knotMesh: Mesh;
  private supportCord = new Cord(10, 6, THREAD_R * MM);
  private tailCord = new Cord(26, 6, THREAD_R * MM);
  private tailMesh!: Mesh;
  private cutFace: Mesh;
  private cutZ = 999;
  private clip = new Plane(new Vector3(0, 0, -1), 999);
  private clipped: Material[] = [];
  private pickables: Pickable[] = [];
  private ray = new Raycaster();
  private ndc = new Vector2();
  private sun: DirectionalLight;
  readonly baseTriangles: number;

  constructor(host: HTMLElement) {
    const canvas = document.createElement('canvas');
    host.appendChild(canvas);
    const ctx = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });
    if (!ctx) throw new Error('WebGL2 unavailable');
    this.renderer = new WebGLRenderer({ canvas, context: ctx, antialias: true });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.localClippingEnabled = true;
    this.renderer.setClearColor('#2a211a');

    this.mats = buildMaterials();
    let tris = 0;

    // --- room, furthest back first ----------------------------------------
    const room = buildRoom();
    tris += room.triangles;
    this.add(room.wall, this.mats.wall, false, false);
    this.add(room.window, this.mats.windowPane, false, false);
    this.add(room.timber, this.mats.woodDark, false, false);
    this.add(room.paper, this.mats.paper, false, false);

    // --- bench and the cloth-lined tray -----------------------------------
    tris += this.add(buildBench(), this.mats.bench, false, true);
    const tray = buildTray();
    tris += this.add(tray.wood, this.mats.wood, true, true);
    tris += this.add(tray.cloth, this.mats.cloth, false, true);

    // --- the body -----------------------------------------------------------
    const body = buildBody();
    tris += body.triangles;
    this.add(body.outer, this.mats.red, true, true, true);
    this.add(body.inner, this.mats.lining, false, false, true);
    this.add(body.edge, this.mats.edge, true, false, true);
    // The legs are solid forms and stand below the window, so the section
    // leaves them alone rather than slicing a hollow into one.
    tris += this.add(buildLegs(), this.mats.redPlain, true, true);
    tris += this.add(buildPegs(THREAD_PEGS), this.mats.woodDark, true, false);

    // the cut face, generated from this body's own walls when the plane moves
    this.cutFace = new Mesh(buildCutFace(0), this.mats.edge);
    this.cutFace.visible = false;
    this.scene.add(this.cutFace);

    // --- the head assembly --------------------------------------------------
    const head = buildHead();
    tris += head.triangles;
    this.headGroup.rotation.order = 'YZX';
    this.scene.add(this.headGroup);
    for (const [g, m, shadow] of [
      [head.shell, this.mats.redHead, true],
      [head.lining, this.mats.lining, false],
      [head.stem, this.mats.wood, true],
    ] as const) {
      const mesh = new Mesh(g, m);
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      this.headGroup.add(mesh);
    }
    const weightMesh = new Mesh(head.weight, this.mats.lead);
    weightMesh.castShadow = true;
    this.weightPivot.add(weightMesh);
    this.headGroup.add(this.weightPivot);
    this.gripMesh = new Mesh(buildGrip(), this.mats.wood);
    this.gripMesh.castShadow = true;
    this.weightPivot.add(this.gripMesh);

    // --- jigs the child works against --------------------------------------
    this.chinRest = this.addMesh(buildChinRest(), this.mats.wood, true, true);
    this.jigMesh = this.addMesh(buildJig(), this.mats.woodDark, true, true);
    this.toggleMesh = this.addMesh(buildToggle(), this.mats.wood, true, false);
    this.knotMesh = this.addMesh(buildKnot(), this.mats.thread, false, false);
    this.knotMesh.visible = false;

    // --- the thread ----------------------------------------------------------
    const cordMeshes = [this.supportCord, this.tailCord].map((c) => {
      const m = new Mesh(c.geometry, this.mats.thread);
      m.castShadow = false;
      m.frustumCulled = false;
      this.scene.add(m);
      return m;
    });
    this.tailMesh = cordMeshes[1]!;

    // --- light: a broad window and a quiet work lamp -------------------------
    this.scene.add(new HemisphereLight('#cfe2f2', '#6a5440', 1.15));
    this.scene.add(new AmbientLight('#f2e8da', 0.42));
    const sun = new DirectionalLight('#fff3e2', 2.3);
    sun.position.set(-0.28, 0.52, -0.42);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 0.02;
    sun.shadow.camera.far = 1.4;
    const sc = sun.shadow.camera;
    sc.left = -0.22;
    sc.right = 0.22;
    sc.top = 0.22;
    sc.bottom = -0.22;
    sun.shadow.bias = -0.0009;
    sun.shadow.normalBias = 0.004;
    sun.target.position.set(0, 0.05, 0);
    this.scene.add(sun.target);
    this.scene.add(sun);
    this.sun = sun;
    const lamp = new DirectionalLight('#ffd9b0', 0.72);
    lamp.position.set(0.5, 0.42, 0.55);
    this.scene.add(lamp);

    // --- invisible, generously sized grab targets ---------------------------
    for (const [name, px] of [
      ['grip', 60],
      ['head', 64],
      ['toggle', 58],
      ['tie', 52],
    ] as const) {
      const mesh = new Mesh(new SphereGeometry(1, 10, 8), new MeshBasicMaterial({ visible: false }));
      mesh.visible = true;
      mesh.renderOrder = -1;
      (mesh.material as MeshBasicMaterial).colorWrite = false;
      (mesh.material as MeshBasicMaterial).depthWrite = false;
      (mesh.material as MeshBasicMaterial).depthTest = false;
      this.scene.add(mesh);
      this.pickables.push({ name, mesh, px });
    }

    this.baseTriangles = Math.round(tris);
  }

  private add(
    g: BufferGeometry,
    m: Material,
    cast: boolean,
    receive: boolean,
    clip = false,
  ): number {
    this.addMesh(g, m, cast, receive, clip);
    return (g.index?.count ?? 0) / 3;
  }

  private addMesh(
    g: BufferGeometry,
    m: Material,
    cast: boolean,
    receive: boolean,
    clip = false,
  ): Mesh {
    const mesh = new Mesh(g, m);
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    if (clip) {
      m.clippingPlanes = [this.clip];
      if (!this.clipped.includes(m)) this.clipped.push(m);
    }
    this.scene.add(mesh);
    return mesh;
  }

  /* ------------------------------------------------------------- viewport --- */

  resize(w: number, h: number, dprCap = 1.5): void {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap));
    this.renderer.setSize(w, h, false);
    this.rig.camera.aspect = w / h;
    this.rig.camera.updateProjectionMatrix();
  }

  get aspect(): number {
    return this.rig.camera.aspect;
  }

  /** World radius that projects to `px` CSS pixels at `at`. */
  private worldRadiusFor(px: number, at: Vector3, viewportH: number): number {
    const d = this.rig.camera.position.distanceTo(at);
    const halfV = (this.rig.camera.fov * Math.PI) / 360;
    return (px / viewportH) * 2 * d * Math.tan(halfV);
  }

  /* --------------------------------------------------------------- update --- */

  /**
   * Put everything where the rig says it is. `cut` slides the explanatory
   * section in and out; it is a plane sweeping through the body, and the face
   * it leaves is rebuilt from the body's own surfaces, so no second interior
   * is ever shown.
   */
  update(
    rig: HeadRig,
    stage: Stage,
    opts: { cut: number; gripVisible: boolean; jigVisible: boolean; viewportH: number },
  ): void {
    const s = rig.supportWorld();
    this.headGroup.position.set(s.x * MM, s.y * MM, s.z * MM);
    this.headGroup.rotation.set(0, rig.yaw, -rig.pitch);

    const w = rig.weightPos();
    this.weightPivot.position.set(w.x * MM, w.y * MM, 0);
    this.gripMesh.visible = opts.gripVisible;
    this.jigMesh.visible = opts.jigVisible;
    this.chinRest.visible = rig.restPresent;
    this.chinRest.position.y = rig.restPresent ? 0 : -0.2;

    // --- the thread, drawn between the things that really carry the head ---
    const sag = threadSag(rig.threadLen, THREAD_PEGS.hz * 2);
    const apexY = THREAD_PEGS.y - sag;
    const pegL = v(THREAD_PEGS.x, THREAD_PEGS.y, -THREAD_PEGS.hz);
    const pegR = v(THREAD_PEGS.x, THREAD_PEGS.y, THREAD_PEGS.hz);
    const notch = new Vector3(s.x * MM, s.y * MM, s.z * MM);
    // Until the head is hanging on it, the thread lies slack in its own V
    // between the pegs; once it takes the weight, the V goes to the notch and
    // the two are the same point.
    const hanging = rig.supportKind === 'thread' && !rig.resting;
    const apex = new Vector3(THREAD_PEGS.x * MM, apexY * MM, 0);
    this.supportCord.update([pegL, hanging ? notch : apex, pegR]);

    // the free end, run through the peg and down to the toggle on the bench
    const pull = Math.max(0, Math.min(1, pullFraction(rig)));
    const tp = this.togglePoint(pull);
    // Once the length is knotted the free end is trimmed off, as it would be.
    const loose = stage === 'insert' || stage === 'thread';
    this.toggleMesh.visible = loose;
    this.tailMesh.visible = loose;
    this.toggleMesh.position.copy(tp);
    if (loose) {
      this.tailCord.update([
        pegR,
        v(THREAD_PEGS.x + 8, THREAD_PEGS.y - 4, THREAD_PEGS.hz + 5),
        new Vector3().lerpVectors(pegR, tp, 0.55).setY(Math.max(tp.y, pegR.y * 0.42)),
        tp,
      ]);
    }
    this.knotMesh.position.copy(pegR).add(v(1.5, 1.0, 1.6));
    this.knotMesh.visible = stage === 'tie' || stage === 'firstNod' || stage === 'play';

    // --- the explanatory section --------------------------------------------
    // The plane stops short of halfway: enough of the near wall comes away to
    // follow the arm and the weight, while the doll still reads as a doll.
    // Only the outer part of the near flank is taken away, leaving a window in
    // the side of the body rather than half a doll: the shell still reads as a
    // shell, and the arm and the weight are visible through it.
    const z = 44 - 34 * Math.max(0, Math.min(1, opts.cut));
    if (Math.abs(z - this.cutZ) > 0.35) {
      this.cutZ = z;
      // The plane keeps everything behind it, so the near wall comes away and
      // the far one -- the inside of the shell -- is what is left to look at.
      this.clip.constant = z * MM;
      const g = buildCutFace(z);
      this.cutFace.geometry.dispose();
      this.cutFace.geometry = g;
      // A hair in front of the clip plane, so the two do not fight for the
      // same pixels along the edge of the window.
      this.cutFace.position.z = 0.00006;
    }
    const cutting = opts.cut > 0.001;
    this.cutFace.visible = cutting && z < 21.5;
    for (const m of this.clipped) m.clippingPlanes = cutting ? [this.clip] : null;

    // --- keep the one shadow tight on the doll ------------------------------
    const focus = stage === 'balance' ? v(JIG.hookX, JIG.hookY - 10, JIG.hookZ) : v(0, 46, 0);
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).add(new Vector3(-0.1, 0.2, -0.16));
    this.sun.target.updateMatrixWorld();

    // --- grab targets, sized in screen pixels -------------------------------
    const headWorld = new Vector3(HEAD.cx * MM, HEAD.cy * MM, 0).applyMatrix4(
      this.headGroup.matrixWorld,
    );
    const gripWorld = new Vector3(0, 0, GRIP.z * MM).applyMatrix4(this.weightPivot.matrixWorld);
    const spots: Record<PickName, Vector3> = {
      grip: gripWorld,
      head: headWorld,
      toggle: tp,
      tie: pegR.clone().add(v(2, 2, 3)),
    };
    for (const p of this.pickables) {
      const at = spots[p.name];
      p.mesh.position.copy(at);
      const r = this.worldRadiusFor(p.px / 2, at, opts.viewportH);
      p.mesh.scale.setScalar(r);
    }
  }

  /** Where the toggle on the free end sits for a given amount pulled in. */
  togglePoint(pull: number): Vector3 {
    const a = v(TOGGLE.restX, TOGGLE.restY + TOGGLE.r, TOGGLE.restZ);
    const b = v(TOGGLE.restX + TOGGLE.travel * 0.62, TOGGLE.restY + TOGGLE.r, TOGGLE.restZ + TOGGLE.travel * 0.78);
    return a.clone().lerp(b, pull);
  }

  /* ----------------------------------------------------------------- input --- */

  /** Which grab target, if any, is under a point in normalised coordinates. */
  pick(nx: number, ny: number, allowed: PickName[]): PickName | null {
    this.ndc.set(nx, ny);
    this.ray.setFromCamera(this.ndc, this.rig.camera);
    let best: { name: PickName; d: number } | null = null;
    for (const p of this.pickables) {
      if (!allowed.includes(p.name)) continue;
      const sph = new Sphere(p.mesh.position, p.mesh.scale.x);
      const hit = this.ray.ray.intersectSphere(sph, new Vector3());
      if (!hit) continue;
      const d = hit.distanceTo(this.ray.ray.origin);
      if (!best || d < best.d) best = { name: p.name, d };
    }
    return best ? best.name : null;
  }

  /** World position of a grab target, or null if it is not in play. */
  spotOf(name: PickName): Vector3 | null {
    const p = this.pickables.find((q) => q.name === name);
    return p ? p.mesh.position.clone() : null;
  }

  /** Project a world point (metres) to normalised device coordinates. */
  project(p: Vector3): { nx: number; ny: number } {
    const q = p.clone().project(this.rig.camera);
    return { nx: q.x, ny: q.y };
  }

  /**
   * How many normalised units one CSS pixel is worth near a world point, so a
   * drag can be turned into a parameter change with a stable feel whatever the
   * screen size or the current framing.
   */
  pixelScale(at: Vector3, viewportH: number): number {
    const d = this.rig.camera.position.distanceTo(at);
    const halfV = (this.rig.camera.fov * Math.PI) / 360;
    return (2 * d * Math.tan(halfV)) / viewportH;
  }

  render(): void {
    this.renderer.render(this.scene, this.rig.camera);
  }

  stats(): SceneStats {
    const info = this.renderer.info.render;
    return { triangles: info.triangles, drawCalls: info.calls };
  }

  dispose(): void {
    this.mats.dispose();
    this.scene.traverse((o: Object3D) => {
      const m = o as Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    this.renderer.dispose();
  }
}
