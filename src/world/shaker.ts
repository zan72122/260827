/**
 * The shaker table. A butt clamp on an eccentric head, a spring-mounted frame
 * and one very large safety lever — the only control a small hand needs.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { box, boltRow, tube } from './props';
import type { Materials } from './materials';
import { clamp } from '../core/rand';

export const SHAKER_BUTT_Y = 0.66;

export class Shaker {
  readonly group = new THREE.Group();
  /** where the trunk butt is held, local space */
  readonly anchor = new THREE.Vector3(0, SHAKER_BUTT_Y, 0);
  readonly leverAnchor = new THREE.Vector3(1.62, 1.36, 0.16);

  private head: THREE.Object3D;
  private jawL: THREE.Object3D;
  private jawR: THREE.Object3D;
  private lever: THREE.Object3D;
  private shakeT = 0;

  constructor(mats: Materials) {
    // ---- ground frame on rubber feet ----
    const frame = mergeGeometries(
      [
        box(1.24, 0.09, 1.0, 0, 0.045, 0),
        box(0.12, 0.42, 0.12, -0.5, 0.26, -0.38),
        box(0.12, 0.42, 0.12, 0.5, 0.26, -0.38),
        box(0.12, 0.42, 0.12, -0.5, 0.26, 0.38),
        box(0.12, 0.42, 0.12, 0.5, 0.26, 0.38),
        box(1.16, 0.07, 0.92, 0, 0.5, 0),
        box(0.11, 0.62, 0.11, 1.62, 0.31, 0.16),
        box(1.0, 0.1, 0.12, 1.15, 0.56, 0.16),
      ],
      false,
    )!;
    const frameMesh = new THREE.Mesh(frame, mats.shakerPaint);
    frameMesh.castShadow = true;
    frameMesh.receiveShadow = true;
    this.group.add(frameMesh);

    const feet = new THREE.Mesh(
      mergeGeometries(
        [
          tube(0.09, 0.05, 10, 'y', -0.5, 0.025, -0.38),
          tube(0.09, 0.05, 10, 'y', 0.5, 0.025, -0.38),
          tube(0.09, 0.05, 10, 'y', -0.5, 0.025, 0.38),
          tube(0.09, 0.05, 10, 'y', 0.5, 0.025, 0.38),
        ],
        false,
      )!,
      mats.rubber,
    );
    this.group.add(feet);

    // ---- the vibrating head sits on four springs ----
    this.head = new THREE.Object3D();
    this.head.position.set(0, 0.5, 0);
    this.group.add(this.head);

    const springs = new THREE.Mesh(
      mergeGeometries(
        [
          tube(0.05, 0.12, 8, 'y', -0.32, 0.06, -0.26),
          tube(0.05, 0.12, 8, 'y', 0.32, 0.06, -0.26),
          tube(0.05, 0.12, 8, 'y', -0.32, 0.06, 0.26),
          tube(0.05, 0.12, 8, 'y', 0.32, 0.06, 0.26),
        ],
        false,
      )!,
      mats.darkSteel,
    );
    this.head.add(springs);

    const deck = new THREE.Mesh(
      mergeGeometries(
        [
          box(0.86, 0.06, 0.7, 0, 0.15, 0),
          tube(0.3, 0.12, 16, 'y', 0, 0.24, 0, 0.27),
          // eccentric motor hung off the side
          tube(0.15, 0.34, 14, 'z', -0.42, 0.22, 0.0),
          box(0.14, 0.1, 0.16, -0.42, 0.05, 0),
        ],
        false,
      )!,
      mats.shakerPaint,
    );
    deck.castShadow = true;
    this.head.add(deck);

    const motorFace = new THREE.Mesh(tube(0.16, 0.03, 14, 'z', -0.42, 0.22, 0.18), mats.darkSteel);
    this.head.add(motorFace);
    const bolts = new THREE.Mesh(
      boltRow(4, 0.017, new THREE.Vector3(-0.34, 0.15, 0.36), new THREE.Vector3(0.34, 0.15, 0.36)),
      mats.darkSteel,
    );
    this.head.add(bolts);

    // ---- V clamp: two jaws that close on the trunk ----
    const jawGeo = () => {
      const g = new THREE.CylinderGeometry(0.2, 0.22, 0.2, 14, 1, true, -Math.PI * 0.55, Math.PI * 1.1);
      g.translate(0, 0, 0);
      const inner = new THREE.CylinderGeometry(0.185, 0.205, 0.2, 14, 1, true, -Math.PI * 0.55, Math.PI * 1.1);
      const rim = new THREE.TorusGeometry(0.2, 0.014, 5, 20, Math.PI * 1.1);
      rim.rotateX(Math.PI / 2);
      rim.rotateY(-Math.PI * 0.55);
      rim.translate(0, 0.1, 0);
      return mergeGeometries([g, inner, rim], false)!;
    };
    this.jawL = new THREE.Object3D();
    this.jawR = new THREE.Object3D();
    this.jawL.position.set(0, 0.4, 0);
    this.jawR.position.set(0, 0.4, 0);
    const jl = new THREE.Mesh(jawGeo(), mats.wear);
    jl.castShadow = true;
    const jr = new THREE.Mesh(jawGeo(), mats.wear);
    jr.rotation.y = Math.PI;
    jr.castShadow = true;
    this.jawL.add(jl);
    this.jawR.add(jr);
    this.head.add(this.jawL, this.jawR);

    // ---- the safety lever ----
    this.lever = new THREE.Object3D();
    this.lever.position.set(1.62, 0.62, 0.16);
    this.group.add(this.lever);
    const leverArm = new THREE.Mesh(
      mergeGeometries([tube(0.042, 0.62, 8, 'y', 0, 0.31, 0), box(0.12, 0.08, 0.12, 0, 0.62, 0)], false)!,
      mats.darkSteel,
    );
    leverArm.castShadow = true;
    this.lever.add(leverArm);
    const grip = new THREE.Mesh(
      new THREE.SphereGeometry(0.145, 18, 14),
      new THREE.MeshStandardMaterial({ color: 0xc0341f, roughness: 0.55, metalness: 0.05 }),
    );
    grip.position.y = 0.72;
    grip.castShadow = true;
    this.lever.add(grip);

    const guard = new THREE.Mesh(
      mergeGeometries([tube(0.15, 0.03, 16, 'y', 0, 0.02, 0), tube(0.14, 0.02, 16, 'y', 0, 0.06, 0)], false)!,
      mats.shakerPaint,
    );
    this.lever.add(guard);
  }

  /** Where the finger should press, in world space. */
  leverWorldPoint(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.leverAnchor).applyMatrix4(this.group.matrixWorld);
  }

  buttWorldPoint(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.anchor).applyMatrix4(this.group.matrixWorld);
  }

  /** clamp 0 = jaws open, 1 = closed on the trunk. */
  setClamp(t: number): void {
    const open = (1 - clamp(t, 0, 1)) * 0.26;
    this.jawL.position.z = open;
    this.jawR.position.z = -open;
  }

  /** amount 0..1 from the lever; drives the machine's own visible buzz. */
  update(dt: number, amount: number, pressed: number): void {
    this.shakeT += dt;
    const a = clamp(amount, 0, 1);
    const t = this.shakeT;
    this.head.position.x = Math.sin(t * 46.5) * 0.006 * a;
    this.head.position.z = Math.cos(t * 46.5 * 0.83) * 0.005 * a;
    this.head.position.y = 0.5 + Math.sin(t * 108) * 0.0028 * a;
    this.head.rotation.z = Math.sin(t * 46.5 + 1.1) * 0.008 * a;
    this.lever.rotation.z = -clamp(pressed, 0, 1) * 0.42;
  }
}
