import * as THREE from 'three';
import type { Engine } from '../core/engine';
import { initMaterials } from '../mat/materials';
import { Room } from '../world/room';
import { Outside } from '../world/outside';
import { Bench, Lighter, PartsTray } from '../world/bench';
import { Craftsman } from '../world/craftsman';
import { FlameField } from '../fx/flame';
import { DustField } from '../fx/dust';
import { SnowField } from '../fx/snow';
import { Smoker } from '../machines/smoker';
import { Pyramid, PY_CANDLES } from '../machines/pyramid';
import { Chimes, CH_CANDLES } from '../machines/chimes';
import { Interaction } from './interaction';
import { Indicator } from './hints';
import { BENCH_TOP } from '../world/layout';
import { audio } from '../audio/audio';
import { clamp, damp } from '../util/math';

/* Flame slots: one field, one draw call, fixed indices. */
export const F_PY = 0;                 // 0..3  pyramid candles
export const F_CH = F_PY + PY_CANDLES; // 4..7  chime candles
export const F_LIGHTER = F_CH + CH_CANDLES;
const FLAME_COUNT = F_LIGHTER + 1;

/* ------------------------------------------------------------------ *
 * Assembles the whole shop and runs the per-frame systems that are not
 * part of any single mechanism: flames, dust, snow, the heat columns that
 * feed the screen-space shimmer, and the light balance of the room.
 * ------------------------------------------------------------------ */

export class Workshop {
  readonly engine: Engine;
  readonly scene: THREE.Scene;
  readonly room: Room;
  readonly outside: Outside;
  readonly bench: Bench;
  readonly tray: PartsTray;
  readonly lighter: Lighter;
  readonly craftsman: Craftsman;
  readonly smoker: Smoker;
  readonly pyramid: Pyramid;
  readonly chimes: Chimes;
  readonly flames: FlameField;
  readonly dust: DustField;
  readonly snow: SnowField;
  readonly interaction: Interaction;
  readonly indicator: Indicator;

  lighterHeld = false;
  focus = new THREE.Vector3(0, BENCH_TOP + 0.1, 0);
  private evening = 0;
  private lampTarget = 1;
  private tmp = new THREE.Vector3();
  private uv = new THREE.Vector2();
  private uv2 = new THREE.Vector2();
  private lighterBob = 0;

  constructor(engine: Engine) {
    this.engine = engine;
    this.scene = engine.scene;
    const tier = engine.tier;
    initMaterials(engine.renderer);

    this.scene.fog = new THREE.FogExp2(0x2c3648, 0.030);

    this.room = new Room(tier.shadowMapSize, tier.shadows);
    this.scene.add(this.room.group);
    this.outside = new Outside();
    this.scene.add(this.outside.group);
    this.bench = new Bench(tier.shadows);
    this.scene.add(this.bench.group);
    this.tray = new PartsTray(tier.shadows);
    this.scene.add(this.tray.group);
    this.lighter = new Lighter(tier.shadows);
    this.scene.add(this.lighter.group);
    this.craftsman = new Craftsman(tier.shadows);
    this.scene.add(this.craftsman.group);

    this.flames = new FlameField(FLAME_COUNT);
    this.scene.add(this.flames.mesh);

    this.smoker = new Smoker(tier.shadows, tier.smokeCount);
    this.scene.add(this.smoker.group, this.smoker.smoke.mesh);
    this.pyramid = new Pyramid(tier.shadows, F_PY);
    this.scene.add(this.pyramid.group);
    this.chimes = new Chimes(tier.shadows, F_CH);
    this.scene.add(this.chimes.group);

    this.dust = new DustField(tier.dustCount, new THREE.Box3(
      new THREE.Vector3(-1.5, BENCH_TOP - 0.2, -0.7),
      new THREE.Vector3(1.5, BENCH_TOP + 1.1, 0.9),
    ));
    this.scene.add(this.dust.points);
    this.snow = new SnowField(tier.snowCount, this.outside.snowBox);
    this.outside.group.add(this.snow.points);

    this.indicator = new Indicator();
    this.scene.add(this.indicator.mesh);

    this.interaction = new Interaction(engine, this.scene);
    this.interaction.lighterRoot = this.lighter.group;
    this.interaction.lighterHome.copy(this.lighter.home);
    this.interaction.lighterHomeQuat.copy(this.lighter.homeQuat);
    this.interaction.lighterTip = () => this.lighter.tipWorld(new THREE.Vector3());
    this.interaction.onLighterPick = () => {
      if (this.lighterHeld) return;
      this.lighterHeld = true;
      audio.lighterClick();
      // the gas catches a fraction of a second after the piezo click
      let delay = 0.18;
      const catchFire = (dt: number) => {
        delay -= dt;
        if (delay > 0) return;
        this.tickers.delete(catchFire);
        if (this.lighterHeld) { this.flames.setLit(F_LIGHTER, true); audio.igniteWhoosh(); }
      };
      this.tickers.add(catchFire);
    };

    engine.onResizeHook((_w, _h, o) => this.tray.setOrientation(o));
    this.dust.setDpr(engine.dpr);
    this.snow.setDpr(engine.dpr);
  }

  /**
   * Bring the adult's wand into the shot with its tip already near the work,
   * held at the angle a hand would hold it. The child then only has to move
   * it the last few centimetres.
   */
  presentLighter(tipTarget: THREE.Vector3) {
    const g = this.lighter.group;
    // held the way a hand actually holds a wand over a wick: grip above and
    // to the right, nozzle angled down at the work
    const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.35, 0, 2.30, 'XYZ'));
    const fromPos = g.position.clone();
    const fromQ = g.quaternion.clone();
    // where the tip sits relative to the grip once it is held at that angle
    const tipLocal = this.lighter.tip.position.clone().applyQuaternion(quat);
    const toPos = tipTarget.clone().sub(tipLocal);
    let t = 0;
    const step = (dt: number) => {
      t = clamp(t + dt / 0.8, 0, 1);
      const e = t * t * (3 - 2 * t);
      g.position.copy(fromPos).lerp(toPos, e);
      g.quaternion.copy(fromQ).slerp(quat, e);
      if (t >= 1) this.tickers.delete(step);
    };
    this.tickers.add(step);
  }

  dropLighter() {
    this.lighterHeld = false;
    this.flames.setLit(F_LIGHTER, false);
  }

  /** Send the lighter back to where it lives on the bench. */
  stowLighter() {
    this.dropLighter();
    const g = this.lighter.group;
    const fromPos = g.position.clone();
    const fromQ = g.quaternion.clone();
    let t = 0;
    const step = (dt: number) => {
      t = clamp(t + dt / 0.5, 0, 1);
      g.position.copy(fromPos).lerp(this.lighter.home, t * t * (3 - 2 * t));
      g.quaternion.copy(fromQ).slerp(this.lighter.homeQuat, t);
      if (t >= 1) this.tickers.delete(step);
    };
    this.tickers.add(step);
  }

  private tickers = new Set<(dt: number) => void>();
  addTicker(fn: (dt: number) => void) { this.tickers.add(fn); }
  removeTicker(fn: (dt: number) => void) { this.tickers.delete(fn); }

  setEvening(v: number) { this.evening = v; }
  setLamp(v: number) { this.lampTarget = v; }

  litFlameCount() {
    let n = 0;
    for (let i = 0; i < FLAME_COUNT - 1; i++) if (this.flames.isLit(i)) n++;
    return n;
  }

  /** Place every flame on its wick; wicks only move when a part is fitted. */
  syncFlamePositions() {
    for (let i = 0; i < PY_CANDLES; i++)
      this.flames.place(F_PY + i, this.pyramid.flameWorld(i, this.tmp), 0.0105, 0.024);
    for (let i = 0; i < CH_CANDLES; i++)
      this.flames.place(F_CH + i, this.chimes.flameWorld(i, this.tmp), 0.0098, 0.022);
  }

  update(dt: number, time: number) {
    for (const fn of Array.from(this.tickers)) fn(dt);

    if (this.lighterHeld) {
      this.lighterBob += dt;
      // the adult's hand is never perfectly still
      this.lighter.group.position.y += Math.sin(this.lighterBob * 2.4) * 0.00016;
    }
    this.flames.place(F_LIGHTER, this.lighter.tipWorld(this.tmp), 0.0085, 0.021);

    this.interaction.update(dt);
    this.tray.update(dt);
    this.flames.update(dt, time);

    this.smoker.update(dt, time);
    this.pyramid.update(dt, time, this.flames);
    this.chimes.update(dt, time, this.flames);

    this.craftsman.lookAt(this.focus);
    this.craftsman.update(dt, time);

    this.dust.update(dt, time);
    this.snow.update(dt, time);
    this.indicator.update(dt, time);

    audio.setFire(this.litFlameCount() + (this.smoker.lit ? 0.6 : 0));
    audio.update(dt);

    /* ---- heat columns: dust thermals and the screen-space shimmer ---- */
    const comp = this.engine.composite;
    comp.clearHeat();
    let slot = 0;
    const pyLit = this.countLit(F_PY, PY_CANDLES);
    const chLit = this.countLit(F_CH, CH_CANDLES);

    if (pyLit > 0) {
      const p = this.pyramid.thermalWorld(this.tmp);
      this.dust.setThermal(0, p, clamp(pyLit / PY_CANDLES, 0, 1));
      slot = this.pushHeat(comp, slot, p, 0.34 * (pyLit / PY_CANDLES) + 0.2, 0.30);
    } else this.dust.setThermal(0, null, 0);

    if (chLit > 0) {
      const p = this.chimes.thermalWorld(this.tmp);
      this.dust.setThermal(1, p, clamp(chLit / CH_CANDLES, 0, 1));
      slot = this.pushHeat(comp, slot, p, 0.30 * (chLit / CH_CANDLES) + 0.18, 0.22);
    } else this.dust.setThermal(1, null, 0);

    if (this.smoker.lit && !this.smoker.isOpen) {
      const p = this.smoker.mouthWorld(this.tmp);
      this.dust.setThermal(2, p, 0.35);
      slot = this.pushHeat(comp, slot, p, 0.16, 0.10);
    } else if (this.smoker.lit) {
      const p = this.smoker.coneTipWorld(this.tmp);
      this.dust.setThermal(2, p, 0.5);
      slot = this.pushHeat(comp, slot, p, 0.13, 0.12);
    } else this.dust.setThermal(2, null, 0);

    if (this.flames.isLit(F_LIGHTER))
      slot = this.pushHeat(comp, slot, this.lighter.tipWorld(this.tmp), 0.10, 0.14);

    /* ---- room light balance ---- */
    const lamp = damp(this.room.lampValue, this.lampTarget, 1.1, dt);
    this.room.setLampLevel(lamp);
    this.outside.setEvening(this.evening);
    comp.material.uniforms.uVignette.value = 0.62 + (1 - lamp) * 0.28;
    this.engine.renderer.toneMappingExposure = 0.96 + (1 - lamp) * 0.12;
  }

  private countLit(base: number, n: number) {
    let c = 0;
    for (let i = 0; i < n; i++) if (this.flames.isLit(base + i)) c++;
    return c;
  }

  /** Project a heat column into screen space for the shimmer pass. */
  private pushHeat(
    comp: Engine['composite'], slot: number,
    world: THREE.Vector3, heightM: number, strength: number,
  ) {
    if (slot >= 4) return slot;
    this.engine.projectUV(world, this.uv);
    this.engine.projectUV(this.tmp.copy(world).setY(world.y + heightM), this.uv2);
    const radius = Math.abs(this.uv2.y - this.uv.y);
    if (this.uv.x < -0.4 || this.uv.x > 1.4 || radius < 0.002) return slot;
    comp.setHeat(slot, this.uv.x, this.uv.y, radius, strength);
    return slot + 1;
  }
}
