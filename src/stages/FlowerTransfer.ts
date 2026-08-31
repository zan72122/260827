import * as THREE from 'three';
import type { StageBehaviour, StageContext } from '../app/StageContext';
import type { ChoiceButton } from '../ui/Overlay';
import type { PointerFrame } from '../input/PointerInput';
import { CAKE_R, cakeTopY } from '../build/Cake';
import { buildGlueDab } from '../build/Room';
import { mm } from '../core/units';
import { clamp, easeInOut, easeOut, TAU } from '../util/math';

/**
 * Moving the flower onto the cake.
 *
 * The flower is not re-made: the same group of petals is lifted off the paper
 * on the blade of a flower lifter and set down on a dab of cream, so its shape,
 * its colour and its identity all survive the journey. The paper and the steel
 * stay behind on the bench — nothing that is not food ends up on the cake.
 */

const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _w = new THREE.Vector3();
const _seatOffset = new THREE.Vector3();

/**
 * Which way the lifter is held. The handle runs back and to the right, away
 * from the camera, so the arm holding it leaves the frame behind the cake
 * instead of lying across it.
 */
const LIFTER_YAW = -1.9;

type Phase = 'lifting' | 'choosing' | 'carrying' | 'settling' | 'done';

export class FlowerTransfer implements StageBehaviour {
  private readonly ctx: StageContext;
  private phase: Phase = 'choosing';
  private marker: THREE.Mesh | null = null;
  private seat: THREE.Object3D | null = null;
  private target = new THREE.Vector3();
  private targetYaw = 0;
  private clock = 0;
  private idle = 0;
  private startPos = new THREE.Vector3();
  private glue: THREE.Mesh | null = null;

  constructor(ctx: StageContext) {
    this.ctx = ctx;
  }

  enter(): void {
    // The flower comes off the paper first, in the same close view it was made
    // in, so a child sees it leave the nail. Only then does the camera go to
    // the cake to ask where it should go.
    this.phase = 'lifting';
    this.clock = 0;
    this.idle = 0;
    this.ctx.lights.setMode('bench');
    this.ctx.world.nailPivot.visible = true;
    // The bag is set down while the flower is moved.
    this.ctx.world.pipingRig.visible = false;

    if (!this.marker) {
      const geo = new THREE.RingGeometry(mm(15), mm(20), 40);
      geo.rotateX(-Math.PI / 2);
      this.marker = new THREE.Mesh(geo, this.ctx.materials.ghost);
      this.marker.renderOrder = 2;
    }
    this.marker.visible = false;
    this.ctx.world.cakeTop.add(this.marker);

    if (!this.seat) {
      this.seat = new THREE.Object3D();
      this.seat.position.set(mm(12), mm(1.2), 0);
      this.ctx.world.lifterRig.add(this.seat);
    }

    // A sensible first suggestion, so a tap anywhere still works out.
    this.pickDefaultTarget();

    const flower = this.ctx.activeFlower();
    if (!flower) {
      this.phase = 'done';
      return;
    }
    flower.group.getWorldPosition(this.startPos);
    this.ctx.world.lifterRig.visible = true;
    this.placeLifter(this.startPos, 0.06, 0);
  }

  exit(): void {
    if (this.marker) {
      // The marker belongs to this stage, not to the cake: leaving it parented
      // there would let a fresh cake dispose geometry still in use.
      this.marker.visible = false;
      this.marker.parent?.remove(this.marker);
    }
    this.ctx.world.lifterRig.visible = false;
    this.ctx.overlay.setHint(null);
  }

  choices(): ChoiceButton[] {
    if (this.phase !== 'done') return [];
    return [
      { id: 'another', icon: 'flowerSmall', label: 'make another flower' },
      { id: 'toTable', icon: 'cakeGo', label: 'take the cake to the table' },
    ];
  }

  onChoice(id: string): void {
    this.ctx.audio.tap();
    if (id === 'another') this.ctx.goTo('piping');
    else if (id === 'toTable') this.ctx.goTo('serving');
  }

  onDown(f: PointerFrame): void {
    if (this.phase !== 'choosing' || this.ctx.camera.moving) return;
    this.idle = 0;
    this.aim(f);
  }

  onMove(f: PointerFrame): void {
    if (this.phase !== 'choosing') return;
    this.idle = 0;
    this.aim(f);
  }

  onUp(): void {
    if (this.phase !== 'choosing' || this.ctx.camera.moving) return;
    this.commit();
  }

  private aim(f: PointerFrame): void {
    const world = this.ctx.world;
    world.cakeTop.getWorldPosition(_p);
    if (!this.ctx.pickOnPlane(f.x, f.y, _p.y + 0.0, _q)) return;
    world.cakeTop.worldToLocal(_q);
    this.setTarget(_q.x, _q.z);
  }

  private setTarget(x: number, z: number): void {
    const flower = this.ctx.activeFlower();
    const r = flower ? flower.radius() : mm(18);
    const limit = CAKE_R - r - mm(6);
    // Keep it off the very middle as well, so a slice can be cut either side of
    // it later without the knife going through the flower.
    const inner = Math.min(limit, r + mm(13));
    let d = Math.hypot(x, z);
    let ax = x;
    let az = z;
    if (d < 1e-4) {
      ax = inner;
      az = 0;
      d = inner;
    } else if (d > limit || d < inner) {
      const k = clamp(d, inner, limit) / d;
      ax *= k;
      az *= k;
      d = Math.hypot(ax, az);
    }
    // Keep clear of flowers that are already there.
    for (const other of this.ctx.placedFlowers()) {
      const p = other.group.position;
      const dx = ax - p.x;
      const dz = az - p.z;
      const need = r + other.radius() + mm(4);
      const dist = Math.hypot(dx, dz);
      if (dist < need && dist > 1e-5) {
        ax = p.x + (dx / dist) * need;
        az = p.z + (dz / dist) * need;
      }
    }
    this.target.set(ax, cakeTopY(ax, az), az);
    this.targetYaw = Math.atan2(az, ax) + Math.PI * 0.25;
    if (this.marker) {
      this.marker.visible = true;
      this.marker.position.set(ax, this.target.y + mm(0.6), az);
      const s = (r + mm(3)) / mm(20);
      this.marker.scale.set(s, 1, s);
    }
  }

  private pickDefaultTarget(): void {
    const used = this.ctx.placedFlowers().length;
    const a = 0.9 + used * (TAU / 3);
    const d = used === 0 ? mm(26) : mm(40);
    this.setTarget(Math.cos(a) * d, Math.sin(a) * d);
    if (this.marker) this.marker.visible = false;
  }

  private commit(): void {
    const flower = this.ctx.activeFlower();
    const world = this.ctx.world;
    if (!flower || !this.seat) return;
    this.phase = 'carrying';
    this.clock = 0;
    if (this.marker) this.marker.visible = false;

    // A little cream on the cake, so the flower has something to hold on to.
    this.glue = buildGlueDab(this.ctx.materials, flower.radius() * 0.55);
    this.glue.position.set(this.target.x, this.target.y - mm(0.4), this.target.z);
    world.cakeTop.add(this.glue);

    // The blade is now carrying the flower, so this is where it starts from.
    world.lifterRig.getWorldPosition(_p);
    this.startPos
      .copy(_p)
      .add(_seatOffset.set(mm(12), mm(1.2), 0).applyEuler(world.lifterRig.rotation));
    this.ctx.audio.place();
  }

  /** Put the blade under a point, with the handle running off to the left. */
  private placeLifter(basePoint: THREE.Vector3, backOff: number, tilt: number): void {
    const rig = this.ctx.world.lifterRig;
    rig.rotation.set(0, LIFTER_YAW, tilt);
    _seatOffset.set(mm(12), mm(1.2), 0).applyEuler(rig.rotation);
    rig.position.copy(basePoint).sub(_seatOffset);
    rig.position.x -= backOff;
  }

  update(dt: number): void {
    const world = this.ctx.world;
    const flower = this.ctx.activeFlower();
    this.clock += dt;

    if (this.phase === 'lifting') {
      if (!flower || !this.seat) {
        this.phase = 'done';
        return;
      }
      // Slide in under the flower, then take its weight.
      const t = clamp(this.clock / 1.1, 0, 1);
      this.placeLifter(this.startPos, 0.06 * (1 - easeInOut(t)), 0);
      if (t >= 1) {
        this.seat.attach(flower.group);
        this.phase = 'choosing';
        this.clock = 0;
        this.idle = 0;
        // The nail's work is done. Taking it out of shot leaves the cake, the
        // blade and the flower, which is all the next choice is about.
        this.ctx.world.nailPivot.visible = false;
        this.ctx.camera.goTo('placing', 1.2);
      }
      return;
    }

    if (this.phase === 'choosing') {
      this.idle += dt;
      // The blade waits above the cake, holding the flower, until it is told
      // where to put it down.
      const world2 = this.ctx.world;
      world2.cakeTop.localToWorld(_p.copy(this.target));
      const rig = world2.lifterRig;
      _seatOffset.set(mm(12), mm(1.2), 0).applyEuler(rig.rotation);
      _w.set(_p.x - _seatOffset.x, _p.y + 0.075, _p.z - _seatOffset.z);
      rig.position.lerp(_w, 1 - Math.exp(-3.5 * dt));
      this.ctx.overlay.setHint(this.idle > 2.4 && !this.ctx.camera.moving ? 'tap' : null);
      return;
    }
    this.ctx.overlay.setHint(null);

    if (this.phase === 'carrying') {
      // Only this phase still has the flower in hand. Once it is down the
      // stage carries on without it, so the guard belongs here and not above.
      if (!flower || !this.seat) {
        this.phase = 'done';
        return;
      }
      const t = clamp(this.clock / 1.2, 0, 1);
      const k = easeInOut(t);
      world.cakeTop.localToWorld(_p.copy(this.target));
      const rig = world.lifterRig;
      const from = this.startPos;
      // Across and down: the arc a hand actually makes.
      const lift = Math.sin(Math.PI * t) * 0.018;
      _seatOffset.set(mm(12), mm(1.2), 0).applyEuler(rig.rotation);
      rig.position.set(
        from.x + (_p.x - from.x) * k - _seatOffset.x,
        from.y + (_p.y - from.y) * k + lift - _seatOffset.y,
        from.z + (_p.z - from.z) * k,
      );
      if (t >= 1) {
        // Hand the flower over to the cake, exactly where it was aimed.
        world.cakeTop.add(flower.group);
        flower.group.position.copy(this.target);
        flower.group.rotation.set(0, this.targetYaw, 0);
        flower.record.placement = { x: this.target.x, z: this.target.z, yaw: this.targetYaw };
        this.ctx.addPlacedFlower(flower);
        this.ctx.setActiveFlower(null);
        this.phase = 'settling';
        this.clock = 0;
        this.ctx.audio.place();
      }
      return;
    }

    if (this.phase === 'settling') {
      const t = clamp(this.clock / 0.7, 0, 1);
      const rig = world.lifterRig;
      rig.position.x -= easeOut(t) * 0.0018;
      rig.position.y += easeOut(t) * 0.0004;
      if (t >= 1) {
        rig.visible = false;
        this.phase = 'done';
        this.glue = null;
      }
    }
  }
}
