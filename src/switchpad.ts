import * as THREE from 'three';
import { makeGripMaps } from './textures';

/** The electric reel's hand switch, rendered as real geometry in a band along the
 *  bottom edge so a thumb never covers the hatch. */
export class SwitchPad {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 3, 0.02, 2);
  private pad: THREE.Mesh;
  private press = 0;

  constructor(env: THREE.Texture) {
    const grip = makeGripMaps(256);
    const resin = new THREE.MeshPhysicalMaterial({
      color: 0x23272b,
      metalness: 0.1,
      roughness: 0.44,
      clearcoat: 0.4,
      clearcoatRoughness: 0.3,
      envMap: env,
      envMapIntensity: 0.6,
    });
    const rubber = new THREE.MeshPhysicalMaterial({
      map: grip.map,
      roughnessMap: grip.roughnessMap,
      normalMap: grip.normalMap,
      normalScale: new THREE.Vector2(0.85, 0.85),
      color: 0xffffff,
      metalness: 0,
      roughness: 1,
      envMap: env,
      envMapIntensity: 0.3,
    });
    const steel = new THREE.MeshPhysicalMaterial({
      color: 0x8b9197,
      metalness: 0.9,
      roughness: 0.36,
      envMap: env,
      envMapIntensity: 0.8,
    });

    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.028, 0.075), resin);
    housing.position.y = -0.014;
    this.scene.add(housing);

    const shoulder = new THREE.Mesh(new THREE.BoxGeometry(0.244, 0.012, 0.062), resin);
    shoulder.position.y = 0.004;
    this.scene.add(shoulder);

    this.pad = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.031, 0.011, 40), rubber);
    this.pad.scale.set(3.1, 1, 1);
    this.pad.position.y = 0.013;
    this.scene.add(this.pad);

    for (const x of [-0.112, 0.112]) {
      const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.004, 10), steel);
      screw.position.set(x, 0.007, 0.024);
      this.scene.add(screw);
    }

    const boot = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.011, 0.03, 14), rubber);
    boot.rotation.z = Math.PI / 2;
    boot.position.set(-0.142, -0.01, 0);
    this.scene.add(boot);
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.1, 10), rubber);
    cord.rotation.z = Math.PI / 2;
    cord.position.set(-0.2, -0.01, 0);
    this.scene.add(cord);

    this.scene.add(new THREE.HemisphereLight(0x556069, 0x14181c, 1.1));
    const key = new THREE.DirectionalLight(0xffe0bd, 3.2);
    key.position.set(0.2, 0.5, 0.35);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x93b0c6, 0.9);
    fill.position.set(-0.4, 0.2, 0.3);
    this.scene.add(fill);

    this.camera.position.set(0.0, 0.19, 0.235);
    this.camera.lookAt(0, -0.006, 0);
  }

  update(dt: number, pressing: boolean): void {
    this.press = THREE.MathUtils.damp(this.press, pressing ? 1 : 0, 18, dt);
    this.pad.position.y = 0.013 - this.press * 0.0055;
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    // keep the switch the same physical width regardless of band shape
    this.camera.fov = 2 * THREE.MathUtils.radToDeg(Math.atan(0.155 / aspect / 0.245));
    this.camera.updateProjectionMatrix();
  }
}
