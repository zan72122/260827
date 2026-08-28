import * as THREE from 'three';
import { makeWood, makeWall, makeToolSteel } from '../gfx/textures';
import { Rng } from '../core/util';

/**
 * Three readable depth layers, built once:
 *   near  - the front lip of the bench and the tools resting on it
 *   mid   - the bench top where all the work happens
 *   far   - window, racks and the tool wall, dim but still legible in silhouette
 * Depth comes from silhouette, exposure and haze rather than from blurring the
 * background away.
 */
export class Workshop {
  readonly root = new THREE.Group();
  readonly keyLight: THREE.DirectionalLight;
  readonly lamp: THREE.SpotLight;
  readonly benchMaterial: THREE.MeshStandardMaterial;
  private farLight!: THREE.DirectionalLight;

  constructor(env: THREE.Texture) {
    const wood = makeWood(1024);
    const wall = makeWall(512);
    const steel = makeToolSteel(512);
    const rng = new Rng(4242);

    this.benchMaterial = new THREE.MeshStandardMaterial({
      map: wood.map,
      roughnessMap: wood.roughnessMap,
      bumpMap: wood.bumpMap,
      bumpScale: 0.0035,
      roughness: 1.0,
      color: 0xa79a86,
      metalness: 0.0,
      envMap: env,
      envMapIntensity: 0.35,
    });
    wood.map.repeat.set(2.6, 1.9);
    wood.roughnessMap.repeat.set(2.6, 1.9);
    wood.bumpMap.repeat.set(2.6, 1.9);

    // ------------------------------------------------------------ mid: bench
    const top = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.13, 2.0), this.benchMaterial);
    top.position.set(0, -0.065, -0.15);
    top.receiveShadow = true;
    this.root.add(top);

    // front lip: the near layer, catching the least light
    const lipMat = this.benchMaterial.clone();
    lipMat.color = new THREE.Color(0x9a8c78);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.10, 0.10), lipMat);
    lip.position.set(0, -0.045, 0.83);
    lip.receiveShadow = true;
    this.root.add(lip);

    // near layer: the oiled leather mat the tools live on, right at the front
    // of frame, dark enough to read as foreground against the lit work
    const matMat = new THREE.MeshStandardMaterial({
      color: 0x2a2018, roughness: 0.88, metalness: 0.0,
      envMap: env, envMapIntensity: 0.18,
    });
    const mat = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.008, 0.36), matMat);
    mat.position.set(0.12, 0.004, 0.60);
    mat.rotation.y = -0.05;
    mat.receiveShadow = true;
    this.root.add(mat);
    const roll = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 0.13, 14), matMat
    );
    roll.rotation.z = Math.PI / 2;
    roll.rotation.y = 0.3;
    roll.position.set(-0.44, 0.038, 0.58);
    roll.castShadow = true;
    this.root.add(roll);

    for (const sx of [-1.2, 1.2]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.2, 0.16), this.benchMaterial);
      leg.position.set(sx, -0.72, 0.6);
      this.root.add(leg);
    }

    // vice jaw at the far left of the bench: a heavy silhouette anchor
    const steelMat = new THREE.MeshStandardMaterial({
      map: steel.map, roughnessMap: steel.roughnessMap,
      metalness: 0.92, roughness: 0.55, envMap: env, envMapIntensity: 0.7,
      color: 0x9aa0a8,
    });
    const vice = new THREE.Group();
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.17, 0.22), steelMat);
    jaw.position.y = 0.085;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.13, 0.5), steelMat);
    body.position.set(0, 0.06, 0.2);
    const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.42, 12), steelMat);
    screw.rotation.x = Math.PI / 2;
    screw.position.set(0, 0.085, 0.3);
    vice.add(jaw, body, screw);
    vice.position.set(-1.02, 0, -0.42);
    vice.rotation.y = 0.22;
    vice.traverse((o) => { (o as THREE.Mesh).castShadow = true; });
    this.root.add(vice);

    // a few small tools lying about, low and dark
    const toolMat = steelMat.clone();
    toolMat.color = new THREE.Color(0x6c7076);
    const handleMat = new THREE.MeshStandardMaterial({
      color: 0x4a3524, roughness: 0.85, metalness: 0.0, envMap: env, envMapIntensity: 0.25,
    });
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      const len = rng.range(0.18, 0.3);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, len, 10), toolMat);
      shaft.rotation.z = Math.PI / 2;
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.024, 0.13, 10), handleMat);
      grip.rotation.z = Math.PI / 2;
      grip.position.x = -len / 2 - 0.06;
      g.add(shaft, grip);
      g.position.set(rng.range(0.42, 0.78), 0.02, rng.range(0.52, 0.66));
      g.rotation.y = rng.range(-0.7, 0.7);
      g.traverse((o) => { (o as THREE.Mesh).castShadow = true; });
      this.root.add(g);
    }

    // ------------------------------------------------------- far: the room
    const wallMat = new THREE.MeshStandardMaterial({
      map: wall.map, roughness: 0.98, metalness: 0.0, color: 0xa39b8e,
    });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(9, 4.6), wallMat);
    back.receiveShadow = false;
    back.position.set(0, 1.2, -2.6);
    this.root.add(back);

    // overcast window: the reason the metal has a cool edge
    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(1.55, 1.5),
      new THREE.MeshBasicMaterial({ color: 0x9fb6c9 })
    );
    glass.position.set(-1.65, 1.32, -2.55);
    this.root.add(glass);
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x3b2f23, roughness: 0.9 });
    for (const [w, h, x, y] of [[1.7, 0.06, -1.65, 2.09], [1.7, 0.06, -1.65, 0.56],
                                [0.06, 1.6, -2.45, 1.32], [0.06, 1.6, -0.85, 1.32],
                                [0.05, 1.5, -1.65, 1.32], [1.6, 0.045, -1.65, 1.32]] as const) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.05), frameMat);
      bar.position.set(x, y, -2.5);
      this.root.add(bar);
    }

    // shelving on the right: jars and boxes, only their shapes need to read
    const shelfMat = new THREE.MeshStandardMaterial({
      map: wood.map, color: 0x6a5844, roughness: 0.95, metalness: 0,
    });
    for (let s = 0; s < 2; s++) {
      const board = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.05, 0.34), shelfMat);
      board.position.set(1.55, 0.62 + s * 0.72, -2.3);
      this.root.add(board);
      for (let i = 0; i < 7; i++) {
        const kind = rng.next();
        const h = rng.range(0.12, 0.26);
        const m = kind < 0.5
          ? new THREE.Mesh(new THREE.CylinderGeometry(rng.range(0.05, 0.08), rng.range(0.05, 0.08), h, 12),
              new THREE.MeshStandardMaterial({ color: 0x5c5a50, roughness: 0.6, metalness: 0.15 }))
          : new THREE.Mesh(new THREE.BoxGeometry(rng.range(0.1, 0.2), h, rng.range(0.1, 0.2)),
              new THREE.MeshStandardMaterial({ color: 0x6d5f4e, roughness: 0.9 }));
        m.position.set(0.62 + i * 0.27, 0.645 + s * 0.72 + h / 2, -2.3 + rng.range(-0.05, 0.05));
        this.root.add(m);
      }
    }

    // tool wall behind the bench: hanging silhouettes
    const hangMat = new THREE.MeshStandardMaterial({ color: 0x4a4844, roughness: 0.75, metalness: 0.4 });
    for (let i = 0; i < 11; i++) {
      const x = -2.35 + i * 0.2 + rng.range(-0.03, 0.03);
      if (x > -0.95 && x < 0.35) continue;
      const len = rng.range(0.2, 0.44);
      const t = new THREE.Mesh(new THREE.BoxGeometry(rng.range(0.025, 0.06), len, 0.03), hangMat);
      t.position.set(x, 0.72 - len / 2 + rng.range(0, 0.35), -2.42);
      this.root.add(t);
    }
    const rail = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.035, 0.05), frameMat);
    rail.position.set(-0.4, 0.86, -2.44);
    this.root.add(rail);

    // ------------------------------------------------------------- lighting
    this.keyLight = new THREE.DirectionalLight(0xcfe2f2, 3.4);
    this.keyLight.position.set(-2.1, 2.0, 1.15);
    this.keyLight.target.position.set(0, 0.16, 0);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(1024, 1024);
    this.keyLight.shadow.camera.near = 0.6;
    this.keyLight.shadow.camera.far = 6.5;
    const c = this.keyLight.shadow.camera;
    c.left = -0.95; c.right = 0.95; c.top = 0.95; c.bottom = -0.95;
    c.updateProjectionMatrix();
    this.keyLight.shadow.bias = -0.0009;
    this.keyLight.shadow.normalBias = 0.012;
    this.root.add(this.keyLight, this.keyLight.target);

    this.lamp = new THREE.SpotLight(0xffd0a0, 8.5, 4.6, 0.82, 0.8, 1.5);
    this.lamp.position.set(1.05, 1.18, 0.72);
    this.lamp.target.position.set(0.02, 0.2, -0.04);
    this.root.add(this.lamp, this.lamp.target);

    const hemi = new THREE.HemisphereLight(0xa8c0d4, 0x40301f, 1.15);
    this.root.add(hemi);

    // dim wash on the far wall only: keeps the room legible without lifting
    // the work, which stays the brightest thing in frame
    const far = this.farLight = new THREE.DirectionalLight(0xa9bccd, 1.7);
    far.position.set(-1.4, 1.6, 1.4);
    far.target.position.set(0, 1.0, -2.6);
    this.root.add(far, far.target);

    // a soft, close fill straight down into the tooling: without it the drawn
    // cup reads as a black hole rather than a bowl you can drop a ball into
    const cupFill = new THREE.PointLight(0xffdcb4, 0.55, 1.1, 2);
    cupFill.position.set(0.05, 0.5, 0.24);
    this.root.add(cupFill);

    // cold kick from the window side so the far edge of the metal separates
    const rim = new THREE.PointLight(0x9cc0dd, 2.4, 4.2, 2);
    rim.position.set(-1.35, 0.9, -0.9);
    this.root.add(rim);

    // the lamp housing itself, just in frame at the top right in landscape
    const shadeMat = new THREE.MeshStandardMaterial({
      color: 0x1f2225, roughness: 0.5, metalness: 0.6, side: THREE.DoubleSide,
    });
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.24, 20, 1, true), shadeMat);
    shade.position.set(1.1, 1.26, 0.76);
    shade.rotation.set(0.62, 0, -0.42);
    this.root.add(shade);
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xffe2b8 })
    );
    bulb.position.set(1.05, 1.19, 0.72);
    this.root.add(bulb);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.0, 8), shadeMat);
    arm.position.set(1.42, 1.05, 0.28);
    arm.rotation.set(-0.5, 0, 0.62);
    this.root.add(arm);
  }

  /** Shed work on a struggling device without changing what the scene means. */
  setTier(tier: number) {
    if (tier <= 1) {
      this.keyLight.shadow.mapSize.set(512, 512);
      this.keyLight.shadow.map?.dispose();
      this.keyLight.shadow.map = null;
    }
    if (tier === 0) {
      this.keyLight.castShadow = false;
      // put the light the shadow was doing back into the ambient balance
      this.keyLight.intensity = 3.0;
      this.farLight.intensity = 1.2;
    }
  }
}
