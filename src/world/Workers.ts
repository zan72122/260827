import { CapsuleGeometry, CylinderGeometry, Group, Mesh, SphereGeometry, Vector3 } from 'three';
import type { MaterialLibrary } from '../materials/MaterialLibrary';
import { damp, lerp } from '../core/math';

export type Station =
  | 'rigging'
  | 'raising'
  | 'seating'
  | 'plumbing'
  | 'release'
  | 'harness'
  | 'star'
  | 'ceremony';

interface Worker {
  group: Group;
  arm: Group;
  role: 'rigger' | 'ground' | 'electrician' | 'signaller';
  phase: number;
  stations: Partial<Record<Station, Vector3>>;
  home: Vector3;
}

const figure = (materials: MaterialLibrary): { group: Group; arm: Group } => {
  const group = new Group();
  for (const side of [-0.11, 0.11]) {
    const leg = new Mesh(new CapsuleGeometry(0.095, 0.6, 3, 6), materials.workwear);
    leg.position.set(0, 0.48, side);
    leg.castShadow = true;
    group.add(leg);
  }
  const torso = new Mesh(new CapsuleGeometry(0.2, 0.5, 3, 7), materials.workwear);
  torso.position.y = 1.16;
  torso.castShadow = true;
  // The vest is the only high-visibility item; the rest is workwear, so the
  // crew reads as people rather than as safety cones.
  const vest = new Mesh(new CapsuleGeometry(0.2, 0.36, 3, 8), materials.hiVis);
  vest.position.y = 1.14;
  const head = new Mesh(new SphereGeometry(0.115, 8, 6), materials.skin);
  head.position.y = 1.53;
  const helmet = new Mesh(new SphereGeometry(0.145, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), materials.helmet);
  helmet.position.y = 1.55;
  const arm = new Group();
  arm.position.set(0, 1.32, 0.2);
  const upper = new Mesh(new CylinderGeometry(0.05, 0.045, 0.58, 6), materials.workwear);
  upper.position.y = -0.29;
  const glove = new Mesh(new SphereGeometry(0.06, 6, 5), materials.skin);
  glove.position.y = -0.6;
  arm.add(upper, glove);
  // The other arm just hangs; only the signalling arm is animated.
  const idleArm = new Mesh(new CapsuleGeometry(0.05, 0.5, 3, 6), materials.workwear);
  idleArm.position.set(0, 1.02, -0.24);
  group.add(torso, vest, head, helmet, arm, idleArm);
  return { group, arm };
};

/**
 * The crew.
 *
 * Adults do every dangerous thing on this site: the operator is in the cab, the
 * slinger works the hook, the ground crew hold the taglines, the electrician
 * makes off the connectors. The player is at a console outside the fence, which
 * is the only reason a four-year-old is anywhere near this work.
 */
export class Workers {
  readonly group = new Group();
  private readonly workers: Worker[] = [];
  private station: Station = 'rigging';
  private time = 0;

  constructor(materials: MaterialLibrary, treeButt: Vector3, socket: Vector3) {
    const make = (role: Worker['role'], home: Vector3, stations: Worker['stations']) => {
      const { group, arm } = figure(materials);
      group.position.copy(home);
      this.group.add(group);
      this.workers.push({ group, arm, role, phase: this.workers.length * 1.7, stations, home });
    };

    const near = (base: Vector3, dx: number, dz: number) => new Vector3(base.x + dx, 0, base.z + dz);

    make('rigger', near(treeButt, 2.4, -1.6), {
      rigging: near(treeButt, 2.6, 3.6),
      raising: near(treeButt, 4.4, -3.2),
      seating: near(socket, 2.2, 1.8),
      plumbing: near(socket, 3.0, -2.4),
      release: near(socket, 2.0, 2.4),
      harness: near(socket, 1.4, 5.8),
      star: near(socket, -3.2, 4.0),
      ceremony: near(socket, -6.0, 6.0),
    });
    make('rigger', near(treeButt, 5.6, 1.8), {
      rigging: near(treeButt, 6.2, 3.2),
      raising: near(treeButt, 7.2, 3.0),
      seating: near(socket, -2.4, 2.0),
      plumbing: near(socket, -3.4, 1.6),
      release: near(socket, -2.2, -2.6),
      harness: near(socket, -4.6, 2.2),
      star: near(socket, 3.6, 4.4),
      ceremony: near(socket, 6.4, 5.6),
    });
    make('ground', near(socket, 8.5, 7.0), {
      raising: near(socket, 9.5, 7.5),
      seating: near(socket, 6.0, 5.5),
      plumbing: near(socket, 9.9, 5.6),
      star: near(socket, 7.0, 6.6),
      ceremony: near(socket, 8.0, 8.0),
    });
    make('signaller', near(socket, -6.5, 5.5), {
      rigging: near(socket, 1.5, 12.5),
      raising: near(socket, -6.0, 4.6),
      seating: near(socket, -4.6, 3.6),
      star: near(socket, -6.6, 4.2),
      ceremony: near(socket, -8.0, 7.0),
    });
    make('electrician', near(socket, 5.6, 1.4), {
      // Beside the distribution board, not in front of it: the player has to be
      // able to see the connector they are being asked to make off.
      harness: near(socket, 5.4, 1.2),
      star: near(socket, 4.4, 4.6),
      ceremony: near(socket, 5.2, 5.2),
    });
  }

  setStation(station: Station): void {
    this.station = station;
  }

  update(dt: number): void {
    this.time += dt;
    for (const w of this.workers) {
      const target = w.stations[this.station] ?? w.home;
      w.group.position.x = damp(w.group.position.x, target.x, 1.3, dt);
      w.group.position.z = damp(w.group.position.z, target.z, 1.3, dt);
      // Idle life: weight shifting, and the signaller keeps an arm up while
      // the load is in the air.
      const idle = Math.sin(this.time * 1.1 + w.phase);
      w.group.rotation.y = damp(w.group.rotation.y, Math.atan2(-w.group.position.x, -w.group.position.z), 1.4, dt);
      w.group.position.y = Math.abs(idle) * 0.012;
      const signalling = w.role === 'signaller' && (this.station === 'raising' || this.station === 'star');
      const checking = w.role === 'electrician' && this.station === 'harness';
      const raise = signalling ? lerp(-2.3, -2.7, idle * 0.5 + 0.5) : checking ? -1.2 + idle * 0.25 : idle * 0.12;
      w.arm.rotation.x = damp(w.arm.rotation.x, raise, 3, dt);
    }
  }
}
