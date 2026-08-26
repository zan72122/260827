import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import * as TX from './textures';

/**
 * THE bag. One Object3D, created once, alive from check-in scale to cargo hold.
 * Identity anchors: worn petrol-teal soft shell, one sun sticker, white paper
 * tag on the top handle, four spinner wheels, scuffed corners, slight belt tilt.
 * The tag is a 2-joint chain (loop + card) animated procedurally — the spec's
 * "few bones" approach, no cloth sim.
 */
export class Bag {
  group = new THREE.Group();
  /** tag joints */
  private loop = new THREE.Group();
  private card = new THREE.Group();
  private wheels: THREE.Mesh[] = [];
  private body: THREE.Mesh;
  private tagSwing = 0;
  private tagSwingV = 0;
  private tagSide = 0;
  private tagSideV = 0;

  // bag rides lying flat: length along travel 0.72, width 0.44, height 0.28
  static readonly L = 0.72;
  static readonly W = 0.44;
  static readonly H = 0.28;

  constructor() {
    const fabric = TX.bagFabric();
    const bodyMat = new THREE.MeshStandardMaterial({
      map: fabric,
      roughness: 0.88,
      metalness: 0.0,
    });
    const geo = new RoundedBoxGeometry(Bag.L, Bag.H, Bag.W, 4, 0.055);
    this.body = new THREE.Mesh(geo, bodyMat);
    this.body.position.y = Bag.H / 2 + 0.02; // wheels lift it slightly
    this.body.castShadow = true;
    this.body.receiveShadow = true;
    this.group.add(this.body);

    // crushed / scuffed corners: darker rubbed caps on two corners (asymmetric)
    const scuffMat = new THREE.MeshStandardMaterial({ color: 0x5f6a66, roughness: 0.95 });
    for (const [sx, sz] of [
      [-1, 1],
      [-1, -1],
    ] as const) {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.038, 8, 6), scuffMat);
      cap.position.set((Bag.L / 2 - 0.045) * sx, 0.055, (Bag.W / 2 - 0.045) * sz);
      cap.scale.set(1, 0.8, 1);
      this.body.add(
        cap.translateY(-Bag.H / 2 + 0.05) as unknown as THREE.Mesh,
      );
    }

    // zipper line around the shell
    const zipMat = new THREE.MeshStandardMaterial({ color: 0x10393d, roughness: 0.6, metalness: 0.3 });
    const zip = new THREE.Mesh(new THREE.TorusGeometry(Bag.W * 0.52, 0.008, 6, 40), zipMat);
    zip.rotation.y = Math.PI / 2;
    zip.scale.set(1, Bag.H / (Bag.W * 1.04), 1);
    zip.position.set(Bag.L * 0.18, 0, 0);
    this.body.add(zip);

    // short top handle (bag lies flat → handle on the top face, leading end)
    const handleMat = new THREE.MeshStandardMaterial({ color: 0x1c1e20, roughness: 0.7 });
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.016, 8, 20, Math.PI), handleMat);
    handle.position.set(-Bag.L * 0.3, Bag.H / 2 + 0.005, 0);
    handle.rotation.z = 0; // arch up
    this.body.add(handle);
    // side carry handle
    const sideHandle = new THREE.Mesh(
      new THREE.TorusGeometry(0.07, 0.015, 8, 20, Math.PI),
      handleMat,
    );
    sideHandle.position.set(Bag.L / 2 - 0.005, 0, 0);
    sideHandle.rotation.z = -Math.PI / 2;
    this.body.add(sideHandle);

    // sticker on the camera-facing side (-z)
    const stickerMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.13, 0.13),
      new THREE.MeshStandardMaterial({
        map: TX.sticker(),
        transparent: true,
        roughness: 0.55,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      }),
    );
    stickerMesh.position.set(-Bag.L * 0.16, 0.01, Bag.W / 2 + 0.002);
    stickerMesh.rotation.z = 0.12; // stuck on slightly crooked
    this.body.add(stickerMesh);

    // wheels: 4 small spinners at the trailing face bottom + feet
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x151517, roughness: 0.5 });
    const wellMat = new THREE.MeshStandardMaterial({ color: 0x0e2a2d, roughness: 0.8 });
    for (const [ex, ez] of [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
    ] as const) {
      const well = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), wellMat);
      well.position.set((Bag.L / 2 - 0.06) * ex, -Bag.H / 2 + 0.015, (Bag.W / 2 - 0.05) * ez);
      this.body.add(well);
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.02, 12), wheelMat);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set((Bag.L / 2 - 0.06) * ex, 0.028, (Bag.W / 2 - 0.05) * ez);
      wheel.castShadow = true;
      this.group.add(wheel);
      this.wheels.push(wheel);
    }

    // ---- tag chain: loop (elastic) → card (paper) ----
    const loopMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.004, 0.004, 0.07, 5),
      new THREE.MeshStandardMaterial({ color: 0xdad7cc, roughness: 0.9 }),
    );
    loopMesh.position.y = -0.035;
    this.loop.add(loopMesh);
    // tied to the top handle, dangling over the leading top edge on the
    // camera side so the white tag stays readable the whole journey
    this.loop.position.set(-Bag.L * 0.36, Bag.H + 0.045, 0.19);
    this.loop.rotation.x = -0.55; // drape outward, clear of the shell
    this.group.add(this.loop);

    const cardMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.065, 0.135),
      new THREE.MeshStandardMaterial({
        map: TX.tagPaper(),
        side: THREE.DoubleSide,
        roughness: 0.9,
      }),
    );
    cardMesh.position.y = -0.068;
    cardMesh.castShadow = true;
    this.card.add(cardMesh);
    this.card.position.y = -0.07;
    this.loop.add(this.card);

    this.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.frustumCulled = false; // small, always near camera
    });
  }

  /**
   * @param speed   bag speed along path (m/s, signed)
   * @param wind    0..1 outdoor wind factor
   * @param hint    0..1 "flutter forward" idle hint strength
   * @param onRollers whether current surface is a roller deck (wheel jitter)
   */
  update(dt: number, speed: number, wind: number, hint: number, onRollers: boolean, time: number): void {
    // tag physics: damped pendulum driven by acceleration/wind/hint
    const drive =
      THREE.MathUtils.clamp(-speed * 0.55, -1.1, 1.1) +
      wind * (0.35 + Math.sin(time * 2.3) * 0.22 + Math.sin(time * 5.1) * 0.08) +
      hint * (0.5 + Math.sin(time * 3.2) * 0.35);
    const k = 26;
    const damp = 5.5;
    this.tagSwingV += (drive * 0.55 - this.tagSwing) * k * dt - this.tagSwingV * damp * dt;
    this.tagSwing += this.tagSwingV * dt;
    this.tagSideV +=
      (Math.sin(time * 1.7) * (0.12 + wind * 0.25) - this.tagSide) * 18 * dt -
      this.tagSideV * 5 * dt;
    this.tagSide += this.tagSideV * dt;
    this.loop.rotation.z = THREE.MathUtils.clamp(this.tagSwing, -1.2, 1.2) * 0.65;
    this.loop.rotation.x = -0.55 + this.tagSide * 0.5;
    this.card.rotation.z = THREE.MathUtils.clamp(this.tagSwing, -1.2, 1.2) * 0.55;
    this.card.rotation.y = Math.sin(time * 2.9) * (0.06 + wind * 0.3 + Math.abs(speed) * 0.05);

    // slight lean into direction of travel (reads as inertia)
    const lean = THREE.MathUtils.clamp(speed * 0.045, -0.09, 0.09);
    this.body.rotation.z = THREE.MathUtils.lerp(this.body.rotation.z, -lean, 1 - Math.exp(-8 * dt));
    // resting tilt on the belt: never perfectly square
    this.body.rotation.y = THREE.MathUtils.lerp(
      this.body.rotation.y,
      0.045 + (onRollers ? Math.sin(time * 13) * 0.006 : 0),
      1 - Math.exp(-4 * dt),
    );
    // wheel spin when surface moves under the bag
    for (const w of this.wheels) w.rotation.y += speed * dt * 18;
    // tiny roller-deck vertical jitter
    this.body.position.y =
      Bag.H / 2 + 0.02 + (onRollers ? Math.abs(Math.sin(time * 21)) * 0.006 * Math.min(1, Math.abs(speed) * 3) : 0);
  }
}
