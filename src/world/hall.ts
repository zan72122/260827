/**
 * Where the tree is delivered: a covered public hall with real ceiling height,
 * warm practical lighting and a person standing by, so the opened tree can be
 * read against something familiar.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { box, makeWorker, tube } from './props';
import type { Materials } from './materials';
import { mulberry32, range } from '../core/rand';

export const HALL_POS = new THREE.Vector3(42, 0, 0);
/** where the tree butt is set down, world space */
export const HALL_STAND = new THREE.Vector3(42, 0.16, 0);

export class Hall {
  readonly group = new THREE.Group();
  readonly lights: THREE.Light[] = [];

  constructor(mats: Materials) {
    this.group.position.copy(HALL_POS);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 24), mats.concrete);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.02;
    floor.receiveShadow = true;
    this.group.add(floor);

    const height = 6.4;
    const parts: THREE.BufferGeometry[] = [];
    for (const x of [-9, -3, 3, 9]) {
      for (const z of [-8, 8]) {
        parts.push(box(0.6, height, 0.6, x, height / 2, z));
        parts.push(box(0.9, 0.16, 0.9, x, 0.08, z));
        parts.push(box(0.86, 0.2, 0.86, x, height - 0.1, z));
      }
    }
    parts.push(box(20, 0.5, 0.7, 0, height + 0.25, -8));
    parts.push(box(20, 0.5, 0.7, 0, height + 0.25, 8));
    for (let i = 0; i < 9; i++) {
      parts.push(box(0.5, 0.4, 16.6, -8 + i * 2, height + 0.2, 0));
    }
    const structure = new THREE.Mesh(mergeGeometries(parts, false)!, mats.plaster);
    structure.castShadow = true;
    structure.receiveShadow = true;
    this.group.add(structure);

    const ceiling = new THREE.Mesh(box(21, 0.24, 17.6, 0, height + 0.62, 0), mats.plaster);
    ceiling.receiveShadow = true;
    this.group.add(ceiling);

    // back wall with warm windows toward the winter evening
    const wall = new THREE.Mesh(box(21, height + 1.2, 0.3, 0, (height + 1.2) / 2, -9), mats.plaster);
    wall.receiveShadow = true;
    this.group.add(wall);
    const windows: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 6; i++) windows.push(box(2.1, 2.4, 0.06, -8 + i * 3.2, 3.1, -8.83));
    this.group.add(new THREE.Mesh(mergeGeometries(windows, false)!, mats.glass));

    // the hall is closed on three sides: the way in is behind the camera
    const walls = new THREE.Mesh(
      mergeGeometries(
        [
          box(0.3, height + 1.2, 18, -10.6, (height + 1.2) / 2, 0),
          box(0.3, height + 1.2, 18, 10.6, (height + 1.2) / 2, 0),
          // front wall with a wide opening for the doors
          box(6.5, height + 1.2, 0.3, -7.25, (height + 1.2) / 2, 9),
          box(6.5, height + 1.2, 0.3, 7.25, (height + 1.2) / 2, 9),
          box(8, height - 2, 0.3, 0, height + 1.2 - (height - 2) / 2, 9),
        ],
        false,
      )!,
      mats.plaster,
    );
    walls.receiveShadow = true;
    walls.castShadow = true;
    this.group.add(walls);

    // glazing in the end wall, warm evening light beyond it
    const endGlass: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 4; i++) endGlass.push(box(0.06, 2.6, 2.4, 10.42, 3.3, -5.4 + i * 3.6));
    this.group.add(new THREE.Mesh(mergeGeometries(endGlass, false)!, mats.glass));

    // pendant lamps
    for (const x of [-6, 0, 6]) {
      for (const z of [-4, 4]) {
        const rod = new THREE.Mesh(tube(0.02, 1.2, 6, 'y', x, height - 0.6, z), mats.darkSteel);
        this.group.add(rod);
        const shade = new THREE.Mesh(
          new THREE.ConeGeometry(0.42, 0.36, 16, 1, true),
          mats.darkSteel,
        );
        shade.position.set(x, height - 1.2, z);
        this.group.add(shade);
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), mats.lampGlow);
        bulb.position.set(x, height - 1.34, z);
        this.group.add(bulb);
        const l = new THREE.PointLight(0xffcf94, 34, 24, 2);
        l.position.set(x, height - 1.3, z);
        this.group.add(l);
        this.lights.push(l);
      }
    }

    // cold daylight through the end glazing, to keep the hall from going
    // uniformly amber
    const dayTarget = new THREE.Object3D();
    dayTarget.position.set(-2, 1.6, 0);
    this.group.add(dayTarget);
    const daylight = new THREE.DirectionalLight(0xb6cadb, 0.5);
    daylight.position.set(15, 4.2, -3);
    daylight.target = dayTarget;
    this.group.add(daylight);
    this.lights.push(daylight);

    // the cast-iron stand the tree is set into
    const stand = new THREE.Mesh(
      mergeGeometries(
        [
          tube(0.42, 0.16, 20, 'y', 0, 0.08, 0, 0.36),
          tube(0.13, 0.3, 12, 'y', 0, 0.24, 0),
          box(0.9, 0.05, 0.12, 0, 0.03, 0),
          box(0.12, 0.05, 0.9, 0, 0.03, 0),
        ],
        false,
      )!,
      mats.darkSteel,
    );
    stand.castShadow = true;
    stand.receiveShadow = true;
    this.group.add(stand);

    // a bench and a doormat, for scale and for life
    const bench = new THREE.Mesh(
      mergeGeometries(
        [
          box(2.4, 0.1, 0.5, 0, 0.46, 0),
          box(0.12, 0.44, 0.42, -1.0, 0.22, 0),
          box(0.12, 0.44, 0.42, 1.0, 0.22, 0),
        ],
        false,
      )!,
      mats.timber,
    );
    bench.position.set(-5.4, 0, 4.2);
    bench.castShadow = true;
    this.group.add(bench);

    const mat = new THREE.Mesh(box(2.6, 0.03, 1.4, 0, 0.03, 6.4), mats.cloth);
    this.group.add(mat);

    const rng = mulberry32(606);
    const person = makeWorker(mats, 404);
    person.position.set(range(rng, 1.85, 2.05), 0, range(rng, 1.3, 1.7));
    person.rotation.y = -1.9;
    this.group.add(person);
  }
}
