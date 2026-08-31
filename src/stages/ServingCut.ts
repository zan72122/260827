import * as THREE from 'three';
import type { StageBehaviour, StageContext } from '../app/StageContext';
import type { ChoiceButton } from '../ui/Overlay';
import { buildCakeSector, CAKE_H, CAKE_R, cakeRadiusAt } from '../build/Cake';
import { SEATS, TABLE_CENTRE, TABLE_TOP_Y } from '../build/Room';
import { orientHand } from '../app/World';
import { mm } from '../core/units';
import { TAU, clamp, easeInOut, easeOut, makeRandom, wrapAngle } from '../util/math';
import type { FlowerBuilder } from '../flower/FlowerBuilder';

/**
 * Cutting and giving.
 *
 * Two cuts are made either side of the flower the child piped, so the slice
 * that leaves the cake is the slice with their flower on it. Nothing is
 * replaced at any point: the wedge that arrives on the plate is the same
 * geometry, carrying the same petals, that was on the board a moment before.
 */

const _v = new THREE.Vector3();

type Phase = 'aiming' | 'cut1' | 'cut2' | 'separating' | 'giving' | 'done';

export class ServingCut implements StageBehaviour {
  private readonly ctx: StageContext;
  private phase: Phase = 'aiming';
  private clock = 0;
  private from = 0;
  private to = 0;
  private wedge: THREE.Group | null = null;
  private wedgeStart = new THREE.Vector3();
  private wedgeTarget = new THREE.Vector3();
  private wedgeYawFrom = 0;
  private wedgeYawTo = 0;

  constructor(ctx: StageContext) {
    this.ctx = ctx;
  }

  enter(): void {
    this.phase = 'aiming';
    this.clock = 0;
    this.ctx.camera.goTo('cutting', 1.1);
    this.ctx.lights.setMode('table');
    this.chooseWedge();
    const world = this.ctx.world;
    world.cakeCarrier.add(world.knifeRig);
    world.knifeRig.visible = true;
    this.placeKnife(this.from, 1);
  }

  exit(): void {
    const world = this.ctx.world;
    world.knifeRig.visible = false;
    world.scene.attach(world.knifeRig);
  }

  choices(): ChoiceButton[] {
    return [];
  }

  /** Pick two radial cuts that clear the flower on either side. */
  private chooseWedge(): void {
    const state = this.ctx.state;
    const flowers = this.ctx.placedFlowers();

    const inRange = (a: number, r: { from: number; to: number }) => {
      const full = r.to - r.from >= TAU - 1e-6;
      if (full) return true;
      let x = a;
      while (x < r.from) x += TAU;
      return x <= r.to;
    };

    let chosen: FlowerBuilder | null = null;
    let range = state.remaining[0] ?? { from: 0, to: TAU };
    for (const r of state.remaining) {
      for (const f of flowers) {
        if (f.group.parent === null) continue;
        const b = (Math.atan2(f.group.position.z, f.group.position.x) + TAU) % TAU;
        if (inRange(b, r)) {
          chosen = f;
          range = r;
          break;
        }
      }
      if (chosen) break;
    }

    const full = range.to - range.from >= TAU - 1e-6;
    let bearing: number;
    let half = 0.55;
    if (chosen) {
      let b = (Math.atan2(chosen.group.position.z, chosen.group.position.x) + TAU) % TAU;
      while (b < range.from) b += TAU;
      bearing = b;
      const d = Math.max(Math.hypot(chosen.group.position.x, chosen.group.position.z), mm(6));
      const need = Math.asin(clamp((chosen.radius() + mm(7)) / d, 0, 0.94));
      half = clamp(need + 0.2, 0.42, 0.8);
    } else {
      bearing = (range.from + range.to) / 2;
      half = Math.min(0.6, (range.to - range.from) / 2 - 0.05);
    }

    let from = bearing - half;
    let to = bearing + half;
    if (!full) {
      // Do not cut outside what is left of the cake.
      if (from < range.from) {
        to += range.from - from;
        from = range.from;
      }
      if (to > range.to) {
        from -= to - range.to;
        to = range.to;
      }
      from = Math.max(from, range.from);
      to = Math.min(to, range.to);
    }
    this.from = from;
    this.to = to;
  }

  /** Lay the blade along a radius, handle outboard, at a given height factor. */
  private placeKnife(angle: number, raise: number): void {
    const rig = this.ctx.world.knifeRig;
    const outer = cakeRadiusAt(this.ctx.state.roughness, angle, CAKE_H * 0.5) + mm(4);
    rig.rotation.set(0, Math.PI - angle, 0);
    rig.position.set(
      Math.cos(angle) * outer,
      CAKE_H + mm(4) + raise * 0.075,
      Math.sin(angle) * outer,
    );
  }

  update(dt: number): void {
    const world = this.ctx.world;
    this.clock += dt;

    if (this.phase === 'aiming') {
      if (!this.ctx.camera.moving && this.clock > 0.5) {
        this.phase = 'cut1';
        this.clock = 0;
        this.ctx.audio.cut();
      }
      return;
    }

    if (this.phase === 'cut1' || this.phase === 'cut2') {
      const angle = this.phase === 'cut1' ? this.from : this.to;
      const t = clamp(this.clock / 0.85, 0, 1);
      // down through the cake, then back up and clear
      const dip = t < 0.62 ? easeInOut(t / 0.62) : 1 - easeInOut((t - 0.62) / 0.38);
      this.placeKnife(angle, 1 - dip * 0.96);
      if (t >= 1) {
        if (this.phase === 'cut1') {
          this.phase = 'cut2';
          this.clock = 0;
          this.ctx.audio.cut();
        } else {
          world.knifeRig.visible = false;
          this.separate();
          this.phase = 'separating';
          this.clock = 0;
        }
      }
      return;
    }

    if (this.phase === 'separating') {
      const t = clamp(this.clock / 1.5, 0, 1);
      const k = easeInOut(t);
      if (this.wedge) {
        this.wedge.position.lerpVectors(this.wedgeStart, this.wedgeTarget, k);
        this.wedge.position.y += Math.sin(Math.PI * t) * 0.055;
        this.wedge.rotation.y = this.wedgeYawFrom + (this.wedgeYawTo - this.wedgeYawFrom) * k;
      }
      if (t >= 1) {
        this.phase = 'giving';
        this.clock = 0;
        this.showGuestHand();
        this.frameThePlate();
        this.ctx.audio.given();
      }
      return;
    }

    if (this.phase === 'giving') {
      const t = clamp(this.clock / 1.1, 0, 1);
      const hand = world.guestHand;
      hand.position.y = (hand.userData.baseY as number) - (1 - easeOut(t)) * 0.05;
      if (t >= 1) {
        this.phase = 'done';
        this.ctx.state.sessionsServed += 1;
        this.ctx.goTo('after');
      }
    }
  }

  /** Replace the cake with the two pieces the cuts actually made. */
  private separate(): void {
    const { world, state, materials } = this.ctx;

    state.takeWedge(this.from, this.to);

    // Park the flowers on the cake itself before anything they might be
    // standing on is taken away, so none of them loses its place.
    for (const f of this.ctx.placedFlowers()) world.cakeTop.attach(f.group);

    // Whatever was standing in for the cake goes; the pieces take its place.
    world.cake.group.visible = false;
    for (const piece of world.cakePieces) {
      // Pieces from an earlier cut are rebuilt from the new ranges.
      world.releasePiece(piece);
    }
    world.cakePieces.length = 0;

    const wedge = buildCakeSector(materials, state.roughness, this.from, this.to);
    wedge.name = 'slice';
    world.cakeCarrier.add(wedge);
    world.cakePieces.push(wedge);
    this.wedge = wedge;

    for (const r of state.remaining) {
      const piece = buildCakeSector(materials, state.roughness, r.from, r.to);
      piece.name = 'remainder';
      world.cakeCarrier.add(piece);
      world.cakePieces.push(piece);
    }
    // Send each flower with the piece it is standing on.
    const contains = (a: number, r: { from: number; to: number }) => {
      let x = a;
      while (x < r.from) x += TAU;
      return x <= r.to;
    };
    for (const f of this.ctx.placedFlowers()) {
      const b = (Math.atan2(f.group.position.z, f.group.position.x) + TAU) % TAU;
      let host: THREE.Object3D = world.cakeTop;
      if (contains(b, { from: this.from, to: this.to })) host = wedge;
      else {
        for (let i = 0; i < state.remaining.length; i++) {
          if (contains(b, state.remaining[i])) {
            host = world.cakePieces[i + 1];
            break;
          }
        }
      }
      host.attach(f.group);
    }

    // Where the slice is going: the plate at the chosen place.
    const bearing = SEATS[state.seat].bearing;
    const plate = world.plates[state.seat];
    plate.getWorldPosition(_v);
    _v.y = TABLE_TOP_Y + mm(14);
    world.cakeCarrier.worldToLocal(_v);

    const mid = (this.from + this.to) / 2;
    const centroid = new THREE.Vector3(Math.cos(mid), 0, Math.sin(mid)).multiplyScalar(CAKE_R * 0.58);
    // Turn the slice so its point faces the guest, then offset so the body of
    // it — not its tip — sits over the middle of the plate.
    const facing = bearing + Math.PI - world.cakeCarrier.rotation.y;
    const yaw = wrapAngle(facing - mid);
    const rotated = centroid.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);

    this.wedgeStart.set(0, 0, 0);
    this.wedgeTarget.copy(_v).sub(rotated);
    this.wedgeYawFrom = 0;
    this.wedgeYawTo = yaw;

    this.dropCrumbs(mid);
  }

  /** A knife through sponge leaves crumbs. They fall where the cut was. */
  private dropCrumbs(mid: number): void {
    const { world, materials, state } = this.ctx;
    const rnd = makeRandom(Math.round(mid * 1000) + state.sessionsServed * 17);
    const group = new THREE.Group();
    group.name = 'crumbs';
    for (let i = 0; i < 14; i++) {
      const geo = new THREE.SphereGeometry(mm(0.6 + rnd() * 1.4), 5, 4);
      geo.scale(1, 0.5 + rnd() * 0.3, 0.8 + rnd() * 0.4);
      const a = mid + (rnd() - 0.5) * 1.1;
      const d = CAKE_R * (1.02 + rnd() * 0.28);
      geo.translate(Math.cos(a) * d, mm(0.6), Math.sin(a) * d);
      const m = new THREE.Mesh(geo, rnd() > 0.45 ? materials.sponge : materials.crust);
      m.castShadow = true;
      group.add(m);
    }
    world.cakeCarrier.add(group);
    world.cakePieces.push(group);
  }

  /** The plate is at whichever place was chosen, so this shot is worked out. */
  private frameThePlate(): void {
    const { world, state, viewport } = this.ctx;
    const plate = world.plates[state.seat];
    plate.getWorldPosition(_v);
    const target = _v.clone();
    target.y += mm(24);
    // Stand back on the side the cake came from, a little above the table.
    const away = new THREE.Vector3(target.x - TABLE_CENTRE.x, 0, target.z - TABLE_CENTRE.z).normalize();
    const back = new THREE.Vector3(-0.55, 0, -0.83).normalize();
    const dir = away.multiplyScalar(0.25).add(back.multiplyScalar(0.75)).normalize();
    const dist = viewport.portrait ? 0.56 : 0.46;
    this.ctx.camera.goToCustom(
      {
        position: new THREE.Vector3(
          target.x + dir.x * dist,
          target.y + (viewport.portrait ? 0.26 : 0.21),
          target.z + dir.z * dist,
        ),
        target,
        fov: viewport.portrait ? 44 : 36,
      },
      1.3,
    );
  }

  private showGuestHand(): void {
    const { world, state } = this.ctx;
    const bearing = SEATS[state.seat].bearing;
    const plate = world.plates[state.seat];
    plate.getWorldPosition(_v);
    const hand = world.guestHand;
    hand.visible = true;
    orientHand(
      hand,
      new THREE.Vector3(
        _v.x + Math.cos(bearing) * 0.10,
        TABLE_TOP_Y + mm(18),
        _v.z + Math.sin(bearing) * 0.10,
      ),
      new THREE.Vector3(-Math.sin(bearing), 0, Math.cos(bearing)),
      new THREE.Vector3(Math.cos(bearing), 0.2, Math.sin(bearing)),
    );
    hand.userData.baseY = hand.position.y;
  }
}
