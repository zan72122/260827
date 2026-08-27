// Santa's sleigh — curved wooden runners, painted body, cargo blanket.
import * as THREE from 'three';
import { woodTexture } from './textures';

export class Sled {
  group = new THREE.Group();

  constructor(seed: number) {
    const woodMat = new THREE.MeshStandardMaterial({ map: woodTexture(seed + 60, 22), roughness: 0.62 });
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x7c2226, roughness: 0.55, metalness: 0.05 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0x4a2c1a, roughness: 0.7 });

    // no cast shadows: the parked sleigh's long moon-shadow would smear
    // across the roof and chimney right where the width-compare shot reads
    const cast = (m: THREE.Mesh) => { m.receiveShadow = true; return m; };

    // runners: swept tube along a curled curve (aligned with z, curl at front)
    const mkRunner = (x: number) => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 20; i++) {
        const t = i / 20;
        const z = -0.85 + t * 1.9;
        let y = 0.05;
        if (t > 0.78) {
          const c = (t - 0.78) / 0.22;
          y = 0.05 + Math.sin(c * Math.PI * 0.65) * 0.34;
        }
        pts.push(new THREE.Vector3(x, y, z));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      const runner = cast(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.035, 8), woodMat));
      this.group.add(runner);
      // struts
      for (const z of [-0.5, 0.35]) {
        const strut = cast(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.22, 0.06), woodMat));
        strut.position.set(x, 0.18, z);
        this.group.add(strut);
      }
    };
    mkRunner(-0.32);
    mkRunner(0.32);

    // body: low-sided sleigh box with raised curved back
    const floor = cast(new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.06, 1.5), bodyMat));
    floor.position.set(0, 0.32, -0.05);
    this.group.add(floor);
    for (const s of [1, -1]) {
      const side = cast(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.3, 1.5), bodyMat));
      side.position.set(0.36 * s, 0.48, -0.05);
      this.group.add(side);
    }
    const backB = cast(new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.72, 14, 1, false, 0, Math.PI), bodyMat));
    backB.rotation.z = Math.PI / 2;
    backB.rotation.y = Math.PI / 2;
    backB.position.set(0, 0.52, -0.78);
    this.group.add(backB);
    const front = cast(new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.24, 0.05), bodyMat));
    front.position.set(0, 0.45, 0.68);
    this.group.add(front);

    // bench seat
    const seat = cast(new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.05, 0.34), woodMat));
    seat.position.set(0, 0.5, -0.42);
    this.group.add(seat);

    // wooden trim rails
    for (const s of [1, -1]) {
      const rail = cast(new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1.48, 8), trimMat));
      rail.rotation.x = Math.PI / 2;
      rail.position.set(0.36 * s, 0.64, -0.05);
      this.group.add(rail);
    }

    // folded blanket in the cargo area
    const blanket = cast(new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.12, 0.4),
      new THREE.MeshStandardMaterial({ color: 0x3b5165, roughness: 0.95 })
    ));
    blanket.rotation.y = 0.15;
    blanket.position.set(-0.04, 0.42, 0.28);
    this.group.add(blanket);
  }
}
