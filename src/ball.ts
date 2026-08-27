import * as THREE from 'three';
import { ropeTexture, steelBallTexture } from './textures';

export const BALL_RADIUS = 0.78;

/**
 * The wrecking ball and its wire rope. The ball is forged steel with dents
 * and rust; a slight low-frequency displacement keeps it from reading as a
 * perfect CG sphere. The rope is a textured cylinder stretched from the
 * sheave to the shackle every frame, with a hint of twist while swinging.
 */
export class BallVisual {
  readonly group = new THREE.Group();
  private ball: THREE.Mesh;
  private rope: THREE.Mesh;
  private shackle: THREE.Group;
  private ropeTex: THREE.Texture;
  private spin = 0;

  constructor(parent: THREE.Object3D) {
    const geo = new THREE.SphereGeometry(BALL_RADIUS, 42, 30);
    // forged irregularity: gentle low-frequency dents baked into the mesh
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const n = v.clone().normalize();
      const bump =
        Math.sin(n.x * 5.1 + 1.3) * Math.sin(n.y * 4.3 + 0.7) * Math.sin(n.z * 6.2 + 2.1) * 0.012 +
        Math.sin(n.x * 11.7) * Math.sin(n.y * 9.1) * 0.005;
      v.addScaledVector(n, bump);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      map: steelBallTexture(),
      roughness: 0.52,
      metalness: 0.86,
    });
    this.ball = new THREE.Mesh(geo, mat);
    this.ball.castShadow = true;
    this.ball.receiveShadow = true;
    this.group.add(this.ball);

    // forged lifting eye + shackle on top of the ball
    this.shackle = new THREE.Group();
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x4c4a4e, roughness: 0.45, metalness: 0.85 });
    const eye = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.05, 8, 14), eyeMat);
    eye.position.y = BALL_RADIUS + 0.06;
    this.shackle.add(eye);
    const pin = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.038, 8, 12), eyeMat);
    pin.rotation.y = Math.PI / 2;
    pin.position.y = BALL_RADIUS + 0.22;
    this.shackle.add(pin);
    this.group.add(this.shackle);

    this.ropeTex = ropeTexture();
    const ropeGeo = new THREE.CylinderGeometry(0.034, 0.038, 1, 8, 1, true);
    ropeGeo.translate(0, 0.5, 0); // pivot at bottom for easy stretch
    this.rope = new THREE.Mesh(
      ropeGeo,
      new THREE.MeshStandardMaterial({ map: this.ropeTex, roughness: 0.6, metalness: 0.45 })
    );
    this.rope.castShadow = true;
    parent.add(this.rope);
    parent.add(this.group);
  }

  /** Place ball at pos, rope from ball to pivot. speed drives rope twist. */
  update(pos: THREE.Vector3, pivot: THREE.Vector3, speed: number, dt: number): void {
    this.group.position.copy(pos);
    // ball slowly rotates about the rope axis; faster when moving
    this.spin += dt * (0.15 + speed * 0.05);
    this.ball.rotation.y = this.spin;

    const up = new THREE.Vector3(0, 1, 0);
    const dir = pivot.clone().sub(pos);
    const len = dir.length();
    dir.normalize();
    // rope starts just above the shackle
    const start = pos.clone().addScaledVector(dir, BALL_RADIUS + 0.26);
    this.rope.position.copy(start);
    this.rope.quaternion.setFromUnitVectors(up, dir);
    this.rope.scale.set(1, Math.max(0.01, len - BALL_RADIUS - 0.26), 1);
    this.ropeTex.offset.y = this.spin * 0.12;
    // shackle points along the rope
    this.shackle.quaternion.setFromUnitVectors(up, dir);
  }
}
