import * as THREE from 'three';

export interface Shot {
  /** camera position in world space */
  pos: THREE.Vector3;
  /** what the camera looks at */
  target: THREE.Vector3;
  fov: number;
  /**
   * World radius that must stay in frame. The director dollies back along the
   * shot direction until it fits the current aspect, so nothing the child needs
   * to touch can fall off the side of a turned phone.
   */
  radius?: number;
  /** portrait overrides: phones get a taller, steeper read of the same action */
  portrait?: Partial<Pick<Shot, 'pos' | 'target' | 'fov' | 'radius'>>;
  /** seconds to glide into this shot */
  glide?: number;
}

export type ShotName =
  | 'outside'
  | 'intake'
  | 'counter'
  | 'press'
  | 'pressMacro'
  | 'sorterOverview'
  | 'follow'
  | 'bag'
  | 'dock'
  | 'map';

/**
 * A fixed chain of shots - no free camera. Each shot has a portrait variant so a
 * letter never leaves frame when the phone is turned.
 */
export class CameraDirector {
  readonly camera: THREE.PerspectiveCamera;

  private shots = new Map<ShotName, Shot>();
  private current: ShotName = 'outside';
  private portrait = false;

  private pos = new THREE.Vector3();
  private target = new THREE.Vector3();
  private wantPos = new THREE.Vector3();
  private wantTarget = new THREE.Vector3();
  private wantFov = 45;
  private glide = 1.4;

  private followObject: THREE.Object3D | null = null;
  private followOffset = new THREE.Vector3(0, 0.22, 0.62);
  private followLook = new THREE.Vector3();
  private followRadius = 0.42;
  private tmp = new THREE.Vector3();
  private scratch = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.05, 80);
  }

  define(name: ShotName, shot: Shot): void {
    this.shots.set(name, shot);
  }

  setPortrait(p: boolean): void {
    if (this.portrait === p) return;
    this.portrait = p;
    this.applyShot(this.current, true);
  }

  get isPortrait(): boolean {
    return this.portrait;
  }

  get shot(): ShotName {
    return this.current;
  }

  cut(name: ShotName): void {
    this.applyShot(name, true);
    this.pos.copy(this.wantPos);
    this.target.copy(this.wantTarget);
    this.camera.fov = this.wantFov;
    this.camera.updateProjectionMatrix();
  }

  go(name: ShotName): void {
    if (this.current === name && !this.followObject) return;
    this.followObject = null;
    this.applyShot(name, false);
  }

  /** Low travelling shot that keeps one envelope in frame the whole way. */
  follow(object: THREE.Object3D, offset?: THREE.Vector3): void {
    this.current = 'follow';
    this.followObject = object;
    if (offset) this.followOffset.copy(offset);
    const s = this.shots.get('follow');
    this.wantFov = this.resolve(s).fov;
    this.glide = 0.5;
  }

  stopFollow(): void {
    this.followObject = null;
  }

  /** Half of the narrower on-screen angle, in radians. */
  private narrowHalfAngle(fovDeg: number): number {
    const vHalf = THREE.MathUtils.degToRad(fovDeg / 2);
    const hHalf = Math.atan(Math.tan(vHalf) * this.camera.aspect);
    return Math.min(vHalf, hHalf);
  }

  private fitDistance(radius: number, fovDeg: number): number {
    return radius / Math.max(0.05, Math.tan(this.narrowHalfAngle(fovDeg)));
  }

  private resolve(shot: Shot | undefined): Shot {
    if (!shot) {
      return { pos: new THREE.Vector3(0, 1.6, 3), target: new THREE.Vector3(0, 1.2, 0), fov: 45 };
    }
    const base: Shot =
      this.portrait && shot.portrait
        ? {
            pos: shot.portrait.pos ?? shot.pos,
            target: shot.portrait.target ?? shot.target,
            fov: shot.portrait.fov ?? shot.fov,
            radius: shot.portrait.radius ?? shot.radius,
            glide: shot.glide,
          }
        : shot;

    if (!base.radius) return base;

    const dir = this.scratch.copy(base.pos).sub(base.target);
    const authored = dir.length();
    const want = this.fitDistance(base.radius, base.fov);
    if (want <= authored) return base;
    dir.multiplyScalar(want / Math.max(1e-4, authored));
    return {
      pos: base.target.clone().add(dir),
      target: base.target,
      fov: base.fov,
      radius: base.radius,
      glide: base.glide,
    };
  }

  private applyShot(name: ShotName, immediate: boolean): void {
    this.current = name;
    const s = this.resolve(this.shots.get(name));
    this.wantPos.copy(s.pos);
    this.wantTarget.copy(s.target);
    this.wantFov = s.fov;
    this.glide = immediate ? 0.001 : s.glide ?? 1.4;
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    // a turned phone reframes the same shot rather than losing its subject
    if (!this.followObject) this.applyShot(this.current, false);
  }

  update(dt: number): void {
    if (this.followObject) {
      this.followObject.getWorldPosition(this.followLook);
      this.wantTarget.copy(this.followLook);
      const dist = Math.max(
        this.followOffset.length(),
        this.fitDistance(this.followRadius, this.wantFov),
      );
      this.scratch.copy(this.followOffset).normalize().multiplyScalar(dist);
      this.wantPos.copy(this.followLook).add(this.scratch);
    }

    const k = 1 - Math.exp(-dt / Math.max(0.016, this.glide * 0.32));
    this.pos.lerp(this.wantPos, k);
    this.target.lerp(this.wantTarget, k);

    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.target);

    if (Math.abs(this.camera.fov - this.wantFov) > 0.01) {
      this.camera.fov += (this.wantFov - this.camera.fov) * k;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Screen-space projection used by the guidance layer and by tests. */
  project(worldPos: THREE.Vector3, width: number, height: number): { x: number; y: number; visible: boolean } {
    this.tmp.copy(worldPos).project(this.camera);
    return {
      x: (this.tmp.x * 0.5 + 0.5) * width,
      y: (-this.tmp.y * 0.5 + 0.5) * height,
      visible: this.tmp.z > -1 && this.tmp.z < 1 && Math.abs(this.tmp.x) <= 1.05 && Math.abs(this.tmp.y) <= 1.05,
    };
  }
}
