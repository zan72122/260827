import * as THREE from 'three';
import type { Sky } from '../world/sky';
import type { Water } from '../world/water';

export interface CamTarget {
  pos: THREE.Vector3;
  look: THREE.Vector3;
}

/**
 * Smoothly damped camera rig. Every consumer only writes a *desired* pos/look;
 * the rig integrates toward it, which keeps the whole 7-stage camera chain a
 * single continuous move (no cuts, up-direction always preserved).
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private velP = new THREE.Vector3();
  private velL = new THREE.Vector3();
  stiffness = 3.2;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(55, aspect, 0.5, 1600);
  }

  snap(pos: THREE.Vector3, look: THREE.Vector3): void {
    this.pos.copy(pos);
    this.look.copy(look);
    this.velP.set(0, 0, 0);
    this.velL.set(0, 0, 0);
    this.apply();
  }

  private acc = new THREE.Vector3();

  update(target: CamTarget, dt: number): void {
    // Critically damped spring.
    const k = this.stiffness;
    const damp = 2 * Math.sqrt(k);
    const acc = this.acc;
    acc.subVectors(target.pos, this.pos).multiplyScalar(k).addScaledVector(this.velP, -damp);
    this.velP.addScaledVector(acc, dt);
    this.pos.addScaledVector(this.velP, dt);
    acc.subVectors(target.look, this.look).multiplyScalar(k * 1.15).addScaledVector(this.velL, -damp);
    this.velL.addScaledVector(acc, dt);
    this.look.addScaledVector(this.velL, dt);
    this.apply();
  }

  private apply(): void {
    this.camera.position.copy(this.pos);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.look);
  }

  get position(): THREE.Vector3 {
    return this.pos;
  }
}

/**
 * Above/below water ambience: fog color+density by camera depth, sun dimming,
 * clear color, and hiding the sky dome underwater. Materials are shared and
 * precompiled, so crossing the surface never causes a shader hitch.
 */
export class EnvironmentFX {
  private fog: THREE.FogExp2;
  private surfaceFogColor = new THREE.Color(0xbfd9e6);
  private midColor = new THREE.Color(0x14506b);
  private deepColor = new THREE.Color(0x0a2e40);
  private tmp = new THREE.Color();

  constructor(
    scene: THREE.Scene,
    private renderer: THREE.WebGLRenderer,
    private sky: Sky,
    private water: Water
  ) {
    this.fog = new THREE.FogExp2(0xbfd9e6, 0.0012);
    scene.fog = this.fog;
  }

  update(camY: number): void {
    const under = camY < 0.1;
    const depth01 = THREE.MathUtils.clamp(-camY / 42, 0, 1);
    if (under) {
      // Colour shifts from teal near the surface to blue-green depths.
      this.tmp.copy(this.midColor).lerp(this.deepColor, depth01);
      this.fog.color.copy(this.tmp);
      this.fog.density = THREE.MathUtils.lerp(0.016, 0.028, depth01);
      this.renderer.setClearColor(this.tmp, 1);
      this.sky.group.children[0].visible = false; // dome
      this.sky.setUnderwater(depth01);
      this.water.setUnderFog(this.tmp, this.fog.density);
    } else {
      this.fog.color.copy(this.surfaceFogColor);
      this.fog.density = 0.0012;
      this.renderer.setClearColor(this.surfaceFogColor, 1);
      this.sky.group.children[0].visible = true;
      this.sky.setUnderwater(0);
    }
  }
}
