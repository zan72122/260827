import * as THREE from 'three';
import type { StageBehaviour, StageContext } from '../app/StageContext';
import type { ChoiceButton } from '../ui/Overlay';
import type { PointerFrame } from '../input/PointerInput';
import { FlowerBuilder, ROWS } from '../flower/FlowerBuilder';
import { newFlowerRecord, CREAM_COLORS, CREAM_COLOR_ORDER, type CreamColorId } from '../core/FlowerRecord';
import { makePipingFrame, pipingFrameAt } from '../flower/petalPath';
import type { PetalRecord } from '../core/FlowerRecord';
import { clamp, damp, wrapAngle } from '../util/math';

/**
 * Piping the flower.
 *
 * One finger describes an arc. That arc is turned into three things at once —
 * how far the nail turns, where the tip therefore sits relative to the flower,
 * and how much cream is leaving the slot — so the child is only ever doing one
 * thing. The arc does not have to be round, or centred, or even curved: any
 * sustained movement advances the work, and a long press does too, for a child
 * who cannot yet draw a circle.
 *
 * What the finger does is never undone. Lifting it stops the flow and leaves
 * the ribbon exactly where it is; moving back the other way does not suck cream
 * back into the bag, because nothing in the model runs backwards.
 */

const _frame = makePipingFrame();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();

function prototypeRecord(row: number, startAngle: number, color: CreamColorId): PetalRecord {
  const cfg = ROWS[row];
  return {
    row,
    startAngle,
    sweep: 0,
    arch: cfg.arch,
    baseY: cfg.baseY,
    radius: cfg.radius,
    lean: cfg.lean,
    furl: cfg.furl,
    band: cfg.band,
    thickness: cfg.thickness,
    color,
  };
}

export class FlowerStage implements StageBehaviour {
  private readonly ctx: StageContext;
  private builder: FlowerBuilder | null = null;
  private theta = 0;
  private pressing = false;
  private lastAngle = 0;
  private flow = 1;
  private extrusion = 0;
  private idle = 0;
  /** Seconds since the finger last actually moved, while it is still down. */
  private stillFor = 0;
  private strokeTravel = 0;
  private awaitingSize = false;
  private finished = false;
  private settle = 0;
  private nudge = 0;
  private colour: CreamColorId = 'rose';
  private readonly nailScreen = new THREE.Vector2();
  private readonly nailWorld = new THREE.Vector3();
  private petalsDone = 0;

  constructor(ctx: StageContext) {
    this.ctx = ctx;
  }

  enter(): void {
    const { world, ctx } = { world: this.ctx.world, ctx: this.ctx };
    ctx.camera.goTo('piping', 1.1);
    ctx.lights.setMode('bench');
    world.scraperRig.visible = false;
    world.nailPivot.visible = true;
    world.pipingRig.visible = true;
    this.theta = world.nailSpin.rotation.y;
    this.awaitingSize = false;
    this.finished = false;
    this.settle = 0;
    this.idle = 0;
    this.petalsDone = 0;
    this.extrusion = 0;

    let builder = ctx.activeFlower();
    if (!builder) {
      this.colour = world.currentBagColor();
      builder = new FlowerBuilder(newFlowerRecord(this.colour), ctx.materials);
      world.flowerHost.add(builder.group);
      ctx.setActiveFlower(builder);
    } else {
      this.colour = builder.record.color;
    }
    this.builder = builder;
    this.updateRig(0);
  }

  exit(): void {
    this.builder?.endPetal();
    this.pressing = false;
    this.ctx.audio.setPiping(0);
    this.ctx.overlay.setHint(null);
  }

  choices(): ChoiceButton[] {
    const swatches: ChoiceButton[] = CREAM_COLOR_ORDER.map((id) => ({
      id: `colour:${id}`,
      icon: '',
      label: `${id} buttercream`,
      selected: this.colour === id,
      tint: CREAM_COLORS[id].swatch,
    }));
    if (this.finished) return [];
    if (this.awaitingSize) {
      return [
        { id: 'size:small', icon: 'flowerSmall', label: 'keep it small' },
        { id: 'size:large', icon: 'flowerLarge', label: 'add outer petals' },
      ];
    }
    return swatches;
  }

  onChoice(id: string): void {
    if (id.startsWith('colour:')) {
      const c = id.slice(7) as CreamColorId;
      this.colour = c;
      this.ctx.world.setBagColor(c);
      if (this.builder && this.builder.petalCount === 0) this.builder.record.color = c;
      this.ctx.audio.tap();
      return;
    }
    if (id === 'size:small') {
      this.ctx.audio.tap();
      this.complete('small');
    } else if (id === 'size:large') {
      this.ctx.audio.tap();
      this.awaitingSize = false;
      if (this.builder) this.builder.record.size = 'large';
    }
  }

  onDown(f: PointerFrame): void {
    if (this.finished) return;
    // A finger that goes down while the camera is still arriving is still a
    // finger going down. The stroke is tracked from here; `canPipe` decides
    // when cream may actually start leaving the tip.
    this.idle = 0;
    this.stillFor = 0;
    this.strokeTravel = 0;
    this.pressing = true;
    this.ctx.world.nailPivot.getWorldPosition(this.nailWorld);
    this.ctx.screenOf(this.nailWorld, this.nailScreen);
    this.lastAngle = Math.atan2(f.y - this.nailScreen.y, f.x - this.nailScreen.x);
  }

  onMove(f: PointerFrame): void {
    if (!this.pressing) return;
    this.strokeTravel = f.travelled;
    const moved = Math.hypot(f.dx, f.dy);
    if (moved > 0.4) {
      this.idle = 0;
      this.stillFor = 0;
    }
    const a = Math.atan2(f.y - this.nailScreen.y, f.x - this.nailScreen.x);
    const angular = Math.abs(wrapAngle(a - this.lastAngle));
    this.lastAngle = a;
    // A straight drag counts too: how far the finger went, scaled by how far
    // out from the nail it is working.
    const reach = Math.max(60, Math.hypot(f.x - this.nailScreen.x, f.y - this.nailScreen.y));
    const linear = Math.hypot(f.dx, f.dy) / reach;
    this.pendingTurn += Math.min(Math.max(angular, linear * 0.72), 0.22);
  }

  onUp(): void {
    this.pressing = false;
    this.builder?.endPetal();
    this.pendingTurn = 0;
    this.stillFor = 0;
  }

  private pendingTurn = 0;

  update(dt: number): void {
    const builder = this.builder;
    if (!builder) return;
    this.idle += dt;

    // Where the nail is on screen, refreshed every frame, so that a stroke
    // begun while the camera was still arriving is still measured correctly.
    this.ctx.world.nailPivot.getWorldPosition(this.nailWorld);
    this.ctx.screenOf(this.nailWorld, this.nailScreen);

    let turn = this.pendingTurn;
    this.pendingTurn = 0;
    if (this.pressing) this.stillFor += dt;

    // Long press, for a child who cannot draw a circle yet: holding still on
    // the nail keeps it turning by itself. This is a press that never became a
    // stroke — pausing part-way through an arc stops the flow instead, because
    // stopping the finger has to stop the cream.
    const isLongPress = this.pressing && this.strokeTravel < 16 && this.stillFor > 0.34;
    if (isLongPress && turn < 0.0008) {
      turn = 1.25 * dt;
    }
    // Never let a flick outrun what a bag of buttercream could actually do.
    turn = clamp(turn, 0, 3.4 * dt);

    const canPipe = this.pressing && !this.awaitingSize && !this.finished && !this.ctx.camera.moving;
    // A finger that stops mid-arc simply stops the flow: `turn` is zero, so
    // nothing new is deposited and what is already there stays untouched. The
    // petal is not ended, because easing off the bag and squeezing again
    // continues the same ribbon from where the tip still is.
    if (canPipe && turn > 0) {
      if (!builder.hasLivePetal()) {
        if (this.rowStillOpen(builder)) builder.beginPetal(this.theta, this.colour);
      }
      if (builder.hasLivePetal()) {
        const speed = turn / Math.max(dt, 1e-3);
        this.flow = damp(this.flow, clamp(1.2 - speed * 0.1, 0.82, 1.24), 8, dt);
        this.theta += turn;
        builder.extendPetal(turn, this.flow);
        this.extrusion = damp(this.extrusion, 1, 14, dt);

        if (builder.livePetalProgress() >= 1) {
          builder.endPetal();
          this.petalsDone += 1;
          this.ctx.audio.petalDone(this.petalsDone - 1);
        }
      }
    } else {
      this.extrusion = damp(this.extrusion, 0, 10, dt);
    }

    // Whether a whorl is finished is checked here rather than only when a
    // petal runs its full sweep, because a child who lifts their finger part
    // way through the last petal has still made that petal — and would
    // otherwise be left with a finished flower and no way to say so.
    this.checkWhorls(builder);

    this.ctx.world.nailSpin.rotation.y = this.theta;
    this.ctx.audio.setPiping(this.extrusion * 0.9, this.flow - 0.8);
    this.updateRig(dt);

    if (this.settle > 0) {
      this.settle -= dt;
      if (this.settle <= 0) this.ctx.goTo('placing');
    }

    // The first flower gets a nudge if a child hesitates. By the second one the
    // question has changed from "what is this?" to "how big can I make it?", so
    // the prompt stops.
    const wantHint =
      !this.finished &&
      !this.awaitingSize &&
      this.idle > 3.2 &&
      builder.petalCount < 2 &&
      this.ctx.placedFlowers().length === 0;
    this.ctx.overlay.setHint(wantHint ? 'arc' : null);
    // If the child is only hesitating, move the tool a little to show what it
    // is for — but never make the flower for them.
    this.nudge = damp(this.nudge, wantHint ? 1 : 0, 3, dt);
  }

  private rowStillOpen(builder: FlowerBuilder): boolean {
    if (builder.record.size === 'small' && builder.innerComplete()) return false;
    if (builder.innerComplete() && builder.record.size !== 'large') return false;
    if (builder.outerComplete()) return false;
    return true;
  }

  private checkWhorls(builder: FlowerBuilder): void {
    if (this.finished || builder.hasLivePetal()) return;
    if (builder.record.size === 'large' && builder.outerComplete()) {
      this.complete('large');
      return;
    }
    if (builder.record.size !== 'large' && builder.innerComplete()) {
      this.awaitingSize = true;
    }
  }

  private complete(size: 'small' | 'large'): void {
    const builder = this.builder;
    if (!builder || this.finished) return;
    builder.endPetal();
    builder.record.size = size;
    this.finished = true;
    this.awaitingSize = false;
    this.ctx.audio.flowerDone();
    this.ctx.audio.setPiping(0);
    // A short moment for the buttercream to firm up before it is moved.
    this.settle = 1.5;
  }

  /** Keep the bag, the tip and the cream in one consistent piece of geometry. */
  private updateRig(dt: number): void {
    const builder = this.builder;
    const world = this.ctx.world;
    if (!builder) return;

    const live = builder.record.petals[builder.record.petals.length - 1];
    const hasLive = builder.hasLivePetal() && live;
    const row = hasLive ? live.row : builder.nextRow();
    const rec = hasLive ? live : prototypeRecord(Math.min(row, ROWS.length - 1), this.theta, this.colour);
    const prog = hasLive ? builder.livePetalProgress() : 0;
    pipingFrameAt(rec, prog, _frame);

    const rig = world.pipingRig;
    // Idle: the tip stands off the work by a few millimetres, the way a hand
    // waiting to start actually holds it.
    // Once the flower is finished the bag is drawn well clear, so that the
    // hand holding it is not lying across the thing the child just made.
    const standoff = this.finished ? 0.115 : hasLive ? 0 : 0.008 + this.nudge * 0.004 * Math.sin(performance.now() * 0.004);
    rig.position.copy(_frame.pos).addScaledVector(_frame.body, standoff);

    _y.copy(_frame.body);
    _z.copy(_frame.slot);
    _x.crossVectors(_y, _z).normalize();
    _m.makeBasis(_x, _y, _z);
    rig.quaternion.setFromRotationMatrix(_m);

    // A working bag is never perfectly still.
    if (dt > 0) {
      const t = performance.now() * 0.001;
      rig.position.y += Math.sin(t * 9.1) * 0.00016 * this.extrusion;
      rig.rotateZ(Math.sin(t * 6.3) * 0.006 * this.extrusion);
    }
  }
}
