import { PerspectiveCamera, Vector3 } from 'three';
import { clamp, damp, lerp, smoothstep } from '../core/math';

export type ShotName =
  | 'arrival'
  | 'rigging'
  | 'raising'
  | 'seating'
  | 'plumbing'
  | 'release'
  | 'harness'
  | 'star'
  | 'test'
  | 'ceremony'
  | 'finale';

export interface ShotContext {
  butt: Vector3;
  tip: Vector3;
  socket: Vector3;
  hook: Vector3;
  star: Vector3;
  crane: Vector3;
  console: Vector3;
  /** Sector distribution board at the foot of the tree. */
  board: Vector3;
  raiseAngle: number;
  /** 0..1 progress inside the current step, for slow pushes. */
  progress: number;
  time: number;
}

const V = () => new Vector3();

/**
 * Camera direction.
 *
 * Two rules drive everything here. The raise is never cut — one continuous
 * move from a low three-quarter view up to a high one, framed on the whole
 * stem, so the silhouette is discovered rather than revealed by an edit. And
 * height is never allowed to collapse: whenever something is going up, the
 * frame is fitted to a segment that still contains the ground.
 */
export class CameraDirector {
  readonly camera: PerspectiveCamera;
  private shot: ShotName = 'arrival';
  private readonly position = V();
  private readonly target = V();
  private readonly desiredPos = V();
  private readonly desiredTarget = V();
  private readonly tmp = V();
  private readonly tmpB = V();
  private portrait = true;
  private shotTime = 0;
  private firstFrame = true;

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(58, aspect, 0.25, 600);
    this.position.set(12, 1.6, 16);
    this.target.set(0, 3, 0);
    this.camera.position.copy(this.position);
    this.camera.lookAt(this.target);
  }

  resize(width: number, height: number): void {
    this.portrait = height >= width;
    this.camera.aspect = width / height;
    // Portrait needs a taller frame to read height; landscape a wider one to
    // read the crane's relationship to the tree.
    this.camera.fov = this.portrait ? 62 : 46;
    this.camera.updateProjectionMatrix();
  }

  get isPortrait(): boolean {
    return this.portrait;
  }

  setShot(shot: ShotName): void {
    if (this.shot === shot) return;
    this.shot = shot;
    this.shotTime = 0;
  }

  get currentShot(): ShotName {
    return this.shot;
  }

  /**
   * Distance at which a segment fits the frame. The horizontal and vertical
   * extents are fitted separately, so a tree lying down fills the width and the
   * same tree standing fills the height, instead of both being framed for the
   * narrower axis and left small.
   */
  private fitDistance(a: Vector3, b: Vector3, margin: number): number {
    const vHalf = (this.camera.fov * Math.PI) / 360;
    const hHalf = Math.atan(Math.tan(vHalf) * this.camera.aspect);
    const horizontal = Math.hypot(a.x - b.x, a.z - b.z);
    const vertical = Math.abs(a.y - b.y);
    const dH = (horizontal * 0.5 * margin) / Math.tan(hHalf);
    const dV = (vertical * 0.5 * margin) / Math.tan(vHalf);
    return Math.max(dH, dV);
  }

  update(dt: number, ctx: ShotContext): void {
    this.shotTime += dt;
    switch (this.shot) {
      case 'arrival':
        this.shotArrival(ctx);
        break;
      case 'rigging':
        this.shotRigging(ctx);
        break;
      case 'raising':
        this.shotRaising(ctx);
        break;
      case 'seating':
        this.shotSeating(ctx);
        break;
      case 'plumbing':
        this.shotPlumbing(ctx);
        break;
      case 'release':
        this.shotRelease(ctx);
        break;
      case 'harness':
        this.shotHarness(ctx);
        break;
      case 'star':
        this.shotStar(ctx);
        break;
      case 'test':
        this.shotTest(ctx);
        break;
      case 'ceremony':
        this.shotCeremony(ctx);
        break;
      case 'finale':
        this.shotFinale(ctx);
        break;
    }

    // The raise gets a slower, heavier follow so it never feels snappy.
    // The raise still gets the heaviest follow, but not so heavy that the
    // frame lags behind a tree that is gaining height every second.
    const posRate = this.shot === 'raising' ? 1.35 : 1.6;
    const targetRate = this.shot === 'raising' ? 1.7 : 2.2;
    if (this.firstFrame) {
      this.position.copy(this.desiredPos);
      this.target.copy(this.desiredTarget);
      this.firstFrame = false;
    } else {
      this.position.x = damp(this.position.x, this.desiredPos.x, posRate, dt);
      this.position.y = damp(this.position.y, this.desiredPos.y, posRate, dt);
      this.position.z = damp(this.position.z, this.desiredPos.z, posRate, dt);
      this.target.x = damp(this.target.x, this.desiredTarget.x, targetRate, dt);
      this.target.y = damp(this.target.y, this.desiredTarget.y, targetRate, dt);
      this.target.z = damp(this.target.z, this.desiredTarget.z, targetRate, dt);
    }
    // Never let the camera drop through the paving.
    this.camera.position.copy(this.position).setY(Math.max(0.9, this.position.y));
    this.camera.lookAt(this.target);
  }

  /** Position the camera on an orbit around `center`. */
  private orbit(center: Vector3, azimuth: number, elevation: number, distance: number): void {
    const cosE = Math.cos(elevation);
    this.desiredPos.set(
      center.x + Math.cos(azimuth) * cosE * distance,
      center.y + Math.sin(elevation) * distance,
      center.z + Math.sin(azimuth) * cosE * distance,
    );
  }

  private shotArrival(ctx: ShotContext): void {
    // Low, and only a little off the axis of the load: the whole length is in
    // frame but the eye reads a long strapped package on a trailer, not a tree.
    const along = this.tmp.copy(ctx.tip).sub(ctx.butt).setY(0).normalize();
    const across = this.tmpB.set(-along.z, 0, along.x);
    // Inside the work area, low, three-quarters on to the butt end and sighting
    // down the load. It reads as one long strapped package receding away — no
    // crown, no silhouette, nothing tree-shaped to give the game away — and no
    // fence line between the camera and the thing the child is looking at.
    this.desiredPos
      .copy(ctx.butt)
      .addScaledVector(along, -3.4 - ctx.progress * 1.2)
      .addScaledVector(across, -4.4);
    this.desiredPos.y = lerp(1.85, 1.5, ctx.progress);
    this.desiredTarget.copy(ctx.butt).addScaledVector(along, 6.5).setY(1.95);
  }

  private shotRigging(ctx: ShotContext): void {
    const mid = this.tmp.copy(ctx.butt).lerp(ctx.tip, 0.42);
    const dist = this.fitDistance(ctx.hook, mid, 1.35) + 2;
    this.orbit(mid, -0.9, 0.16, clamp(dist, 12, 30));
    this.desiredPos.y = Math.max(2.2, this.desiredPos.y);
    this.desiredTarget.copy(mid).lerp(ctx.hook, 0.35);
  }

  private shotRaising(ctx: ShotContext): void {
    // One continuous move: the camera rises and pulls back exactly as fast as
    // the tree needs it to, and the frame always holds butt and tip together.
    const t = smoothstep(ctx.raiseAngle / (Math.PI / 2));
    const mid = this.tmp.copy(ctx.butt).lerp(ctx.tip, lerp(0.45, 0.52, t));
    const dist = this.fitDistance(ctx.butt, ctx.tip, this.portrait ? 1.35 : 1.72);
    const azimuth = lerp(-1.15, -0.72, t) + Math.sin(ctx.time * 0.06) * 0.02;
    const elevation = lerp(0.03, 0.24, t);
    this.orbit(mid, azimuth, elevation, clamp(dist, 16, 62));
    this.desiredPos.y = Math.max(1.6, this.desiredPos.y);
    this.desiredTarget.copy(mid);
  }

  private shotSeating(ctx: ShotContext): void {
    // Down at the socket: plate thickness, guide plates, the butt coming in.
    const focus = this.tmp.copy(ctx.socket).setY(1.6);
    this.orbit(focus, -0.45 + ctx.progress * 0.25, 0.1, lerp(9.5, 5.2, ctx.progress));
    this.desiredPos.y = lerp(3.0, 1.5, ctx.progress);
    this.desiredTarget.copy(ctx.socket).setY(lerp(2.4, 1.0, ctx.progress));
  }

  private shotPlumbing(ctx: ShotContext): void {
    // Far enough back that the leader can be compared with a building edge,
    // low enough that the base indicator is still in frame.
    const dist = this.fitDistance(ctx.socket, ctx.tip, this.portrait ? 1.3 : 1.6);
    const mid = this.tmp.copy(ctx.socket).lerp(ctx.tip, 0.48);
    this.orbit(mid, -0.62 + Math.sin(ctx.time * 0.08) * 0.05, 0.14, clamp(dist, 20, 52));
    this.desiredTarget.copy(mid);
  }

  private shotRelease(ctx: ShotContext): void {
    const focus = this.tmp.copy(ctx.socket).setY(lerp(3.0, 9.0, ctx.progress));
    const dist = this.fitDistance(ctx.socket, ctx.tip, this.portrait ? 1.18 : 1.45);
    this.orbit(focus, -1.05, 0.1, clamp(dist * 0.8, 14, 40));
    this.desiredTarget.copy(focus);
  }

  private shotHarness(ctx: ShotContext): void {
    const dist = this.fitDistance(ctx.socket, ctx.tip, this.portrait ? 1.24 : 1.55);
    const mid = this.tmp.copy(ctx.socket).lerp(ctx.tip, 0.46);
    this.orbit(mid, -1.5 + ctx.progress * 0.35, 0.12, clamp(dist, 18, 48));
    this.desiredTarget.copy(mid);
  }

  private shotStar(ctx: ShotContext): void {
    // Follow the star, but frame it against a segment that runs from the paving
    // at the foot of the tree up to whichever is higher, star or leader — so the
    // height it has gained, and what it is going onto, are both always legible.
    const ground = this.tmp.copy(ctx.socket).setY(0);
    const top = this.tmpB.copy(ctx.star.y > ctx.tip.y ? ctx.star : ctx.tip);
    const dist = this.fitDistance(ground, top, this.portrait ? 1.2 : 1.45);
    const mid = ground.clone().lerp(top, 0.55).lerp(ctx.star, 0.25);
    this.orbit(mid, -1.9 + ctx.progress * 0.5, 0.1, clamp(dist, 14, 54));
    this.desiredPos.y = Math.max(2.0, this.desiredPos.y * 0.9);
    this.desiredTarget.copy(mid);
  }

  private shotTest(ctx: ShotContext): void {
    // Start on the distribution board — the player has to be able to see the
    // connector they are asked to push home — then widen up the tree as the
    // test light climbs.
    const boardAzimuth = Math.atan2(ctx.board.z - ctx.socket.z, ctx.board.x - ctx.socket.x);
    const dist = this.fitDistance(ctx.socket, ctx.tip, this.portrait ? 1.22 : 1.5);
    const focus = this.tmp
      .copy(ctx.board)
      .setY(1.4)
      .lerp(this.tmpB.copy(ctx.socket).lerp(ctx.tip, 0.5), ctx.progress);
    this.orbit(focus, boardAzimuth + 0.3, 0.16, clamp(lerp(13, dist, ctx.progress), 12, 50));
    this.desiredPos.y = Math.max(2.2, this.desiredPos.y);
    this.desiredTarget.copy(focus);
  }

  private shotCeremony(ctx: ShotContext): void {
    // Over the console, with the tree beyond it: the player's own hand and the
    // thing it is about to switch on, in one frame.
    const toTree = this.tmp.copy(ctx.socket).sub(ctx.console).setY(0).normalize();
    this.desiredPos.copy(ctx.console).addScaledVector(toTree, -3.4).setY(2.5);
    this.desiredTarget.copy(ctx.socket).setY(lerp(4.0, 11.0, ctx.progress));
  }

  private shotFinale(ctx: ShotContext): void {
    const dist = this.fitDistance(ctx.socket, ctx.star, this.portrait ? 1.34 : 1.5);
    const mid = this.tmp.copy(ctx.socket).lerp(ctx.star, 0.5);
    this.orbit(mid, -0.6 - ctx.time * 0.035, 0.12, clamp(dist, 20, 60));
    this.desiredTarget.copy(mid);
  }
}
