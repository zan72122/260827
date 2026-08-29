import {
  BoxGeometry,
  CatmullRomCurve3,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import type { MaterialLibrary } from '../materials/MaterialLibrary';
import type { TreeHierarchy } from '../tree/TreeHierarchy';
import { RibbonStrip, TubeStrip, makePoints, sampleCatenary } from '../world/Cable';
import { clamp, damp, lerp, smoothstep } from '../core/math';

/**
 * The topper.
 *
 * It is built on the ground as a real object — welded alloy frame, a ring of
 * lens fixtures, a certified lifting eye, two taglines — so that when the crane
 * picks it up the child is watching a heavy thing go up, not a sprite appear.
 * The lift is slow, the taglines stay manned, and the weight only leaves the
 * hook once the collar at the leader has closed.
 */
export class StarHoist {
  readonly group = new Group();
  readonly star = new Group();
  readonly outerRadius = 1.55;

  private readonly lamps: InstancedMesh;
  private readonly lampMaterial: MeshStandardMaterial;
  private readonly bridle: RibbonStrip[] = [];
  private readonly bridlePoints = [makePoints(7), makePoints(7)];
  private readonly taglines: TubeStrip[] = [];
  private readonly taglinePoints = [makePoints(9), makePoints(9)];
  private readonly collar: Object3D;
  private readonly stand: Mesh;
  private readonly groundPose = new Vector3();
  private readonly hookWorld = new Vector3();
  private readonly tmp = new Vector3();
  private readonly tmp2 = new Vector3();
  private readonly liftPoints: Vector3[] = [];

  /** 0 = on its stand, 1 = seated and locked at the leader. */
  progress = 0;
  /** Reads 1 once the collar has taken the weight off the hook. */
  seated = 0;
  private swing = 0;
  private swingVel = 0;

  constructor(
    private readonly tree: TreeHierarchy,
    materials: MaterialLibrary,
    center: Vector3,
  ) {
    this.group.position.copy(center);
    this.groundPose.set(-5.6, 1.35, -6.4);

    // ---- frame -----------------------------------------------------------
    const pts: Vector3[] = [];
    const points = 5;
    for (let i = 0; i < points * 2; i++) {
      const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 === 0 ? this.outerRadius : this.outerRadius * 0.42;
      pts.push(new Vector3(Math.cos(a) * r, Math.sin(a) * r, 0));
    }
    pts.push(pts[0].clone());
    const curve = new CatmullRomCurve3(pts, true, 'catmullrom', 0.02);
    const frame = new Mesh(new TubeGeometry(curve, 90, 0.055, 6, true), materials.starAlloy);
    frame.castShadow = true;
    this.star.add(frame);

    // Back bracing: this is a structure, not a cut-out.
    for (let i = 0; i < points; i++) {
      const a = (i / points) * Math.PI * 2 - Math.PI / 2;
      const brace = new Mesh(new BoxGeometry(this.outerRadius, 0.05, 0.05), materials.starAlloy);
      brace.position.set((Math.cos(a) * this.outerRadius) / 2, (Math.sin(a) * this.outerRadius) / 2, -0.12);
      brace.rotation.z = a;
      this.star.add(brace);
    }
    const hub = new Mesh(new CylinderGeometry(0.28, 0.28, 0.16, 12), materials.starAlloy);
    hub.rotation.x = Math.PI / 2;
    hub.position.z = -0.12;
    this.star.add(hub);

    // Lifting eye at the top point, and tagline eyes at the lower points.
    const eye = new Mesh(new TorusGeometry(0.1, 0.03, 6, 14), materials.galvanised);
    eye.position.set(0, this.outerRadius + 0.08, 0);
    this.star.add(eye);

    // ---- fixtures ---------------------------------------------------------
    const fixtureCount = 60;
    const lens = new SphereGeometry(0.075, 7, 6);
    this.lampMaterial = new MeshStandardMaterial({
      color: 0xd8d4c8,
      roughness: 0.3,
      metalness: 0.1,
      emissive: 0xffd9a0,
      emissiveIntensity: 0,
    });
    this.lamps = new InstancedMesh(lens, this.lampMaterial, fixtureCount);
    const m = new Matrix4();
    const q = new Quaternion();
    const s = new Vector3(1, 1, 1);
    for (let i = 0; i < fixtureCount; i++) {
      const t = i / fixtureCount;
      const p = curve.getPointAt(t);
      m.compose(new Vector3(p.x, p.y, p.z + 0.03), q, s);
      this.lamps.setMatrixAt(i, m);
      // Each lens sits in a shallow housing on the frame.
      const housing = new Mesh(new CylinderGeometry(0.085, 0.1, 0.09, 8), materials.starAlloy);
      housing.position.set(p.x, p.y, p.z - 0.03);
      housing.rotation.x = Math.PI / 2;
      if (i % 2 === 0) this.star.add(housing);
    }
    this.star.add(this.lamps);

    // Locking collar at the leader that finally takes the load.
    this.collar = new Group();
    const spigot = new Mesh(new CylinderGeometry(0.09, 0.11, 0.55, 10), materials.galvanised);
    spigot.position.y = 0.28;
    this.collar.add(spigot);
    for (let i = 0; i < 2; i++) {
      const jaw = new Mesh(new BoxGeometry(0.3, 0.1, 0.12), materials.galvanised);
      jaw.position.set(i === 0 ? -0.16 : 0.16, 0.5, 0);
      jaw.name = `jaw${i}`;
      this.collar.add(jaw);
    }
    this.group.add(this.collar);

    // Transport stand the star is assembled on.
    this.stand = new Mesh(new BoxGeometry(2.6, 0.7, 1.0), materials.craneDark);
    this.stand.position.copy(this.groundPose).setY(0.35);
    this.group.add(this.stand);

    this.group.add(this.star);

    // Bridle: two webbing legs from the hook to the lifting eye and the hub.
    for (let i = 0; i < 2; i++) {
      const strap = new RibbonStrip(6, 0.2, 0.035, materials.slingWebbing);
      this.group.add(strap.mesh);
      this.bridle.push(strap);
      const line = new TubeStrip(8, 4, 0.018, materials.wireRope);
      this.group.add(line.mesh);
      this.taglines.push(line);
    }

    // The lift path: up off the stand, across, then down onto the spigot.
    this.liftPoints = [
      this.groundPose.clone(),
      new Vector3(-5.0, 8.0, -5.2),
      new Vector3(-2.4, tree.height * 0.86, -2.2),
      new Vector3(0, tree.height + 1.35, 0),
    ];
  }

  setHookWorld(v: Vector3): void {
    this.hookWorld.copy(v);
  }

  /** Where the hook must be to hold the star at its current point on the path. */
  hookTarget(out = new Vector3()): Vector3 {
    this.starWorldTarget(out);
    out.y += 3.2;
    return out;
  }

  private starWorldTarget(out: Vector3): Vector3 {
    const p = clamp(this.progress, 0, 1);
    const seg = p * (this.liftPoints.length - 1);
    const i = Math.min(this.liftPoints.length - 2, Math.floor(seg));
    const t = smoothstep(seg - i);
    out.lerpVectors(this.liftPoints[i], this.liftPoints[i + 1], t);
    return out.add(this.group.position);
  }

  update(dt: number): void {
    const target = this.starWorldTarget(this.tmp);
    const local = this.tmp2.copy(target).sub(this.group.position);
    this.star.position.copy(local);

    // Off the stand the star hangs from a single point, so it swings a little
    // and the ground crew's taglines are what stop it turning.
    const airborne = clamp((this.progress - 0.04) * 6, 0, 1) * (1 - this.seated);
    this.swingVel += (-this.swing * 3.4 - this.swingVel * 1.1) * dt;
    this.swing += this.swingVel * dt;
    this.star.rotation.z = this.swing * airborne;
    this.star.rotation.y = lerp(0.35, 0, smoothstep(this.progress * 1.4)) + this.swing * 0.4 * airborne;
    this.stand.visible = this.progress < 0.08;

    // Collar rides at the leader and closes once the star is home.
    const leader = this.tree.pointOnStem(1.0, this.tmp);
    this.collar.position.copy(leader).sub(this.group.position);
    const seatT = clamp((this.progress - 0.94) / 0.06, 0, 1);
    this.seated = damp(this.seated, seatT, 4, dt);
    for (let i = 0; i < 2; i++) {
      const jaw = this.collar.getObjectByName(`jaw${i}`);
      if (jaw) jaw.rotation.z = (i === 0 ? 1 : -1) * this.seated * 0.8;
    }

    // Bridle legs: taut while the hook carries the star, slack after the
    // collar takes the weight.
    const eyeWorld = this.tmp.copy(this.star.position).add(this.group.position);
    for (let i = 0; i < 2; i++) {
      const attach = this.tmp2
        .copy(eyeWorld)
        .add(new Vector3(i === 0 ? -0.25 : 0.25, this.outerRadius * 0.75, 0));
      const sag = lerp(0.04, 0.6, this.seated) + (1 - airborne) * 0.3;
      sampleCatenary(this.hookWorld, attach, sag, this.bridlePoints[i]);
      this.bridle[i].update(this.bridlePoints[i], new Vector3(0, 1, 0), 1 - this.seated);
      this.bridle[i].mesh.visible = this.progress > 0.02 && this.seated < 0.95;

      const groundAnchor = this.tmp2.set(i === 0 ? -7.5 : 6.5, 0.15, 7.0).add(this.group.position);
      sampleCatenary(eyeWorld, groundAnchor, 1.1, this.taglinePoints[i]);
      this.taglines[i].update(this.taglinePoints[i]);
      this.taglines[i].mesh.visible = this.progress > 0.02 && this.progress < 0.99;
    }
  }

  /** Star fixtures come up last in the ceremony. */
  setGlow(v: number): void {
    this.lampMaterial.emissiveIntensity = clamp(v, 0, 1) * 3.2;
  }

  /** World position of the star, for the camera and its light proxy. */
  starWorld(out = new Vector3()): Vector3 {
    return out.copy(this.star.position).add(this.group.position);
  }
}
