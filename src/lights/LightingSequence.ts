import { Group, PointLight, Vector3 } from 'three';
import type { QualityProfile } from '../core/AdaptiveQuality';
import { LightHarness, SECTOR_COUNT } from './LightHarness';
import type { StarHoist } from './StarHoist';
import { clamp, damp } from '../core/math';

export type LightingState = 'dark' | 'testing' | 'stalled' | 'tested' | 'ceremony' | 'lit';

/**
 * Sector test and the switch-on.
 *
 * Two things matter here and they pull in opposite directions: the test has to
 * find a real fault (so the light must visibly stop at one sector), and the
 * ceremony must not be a flashbulb (so the tree comes up from the base to the
 * leader over about a second, with the star last). Both run off the same
 * per-sector glow values, and the plaza is re-lit by five light proxies, one
 * per sector, never by one light per lamp.
 */
export class LightingSequence {
  readonly group = new Group();
  state: LightingState = 'dark';
  faultSector = 2;

  private readonly proxies: PointLight[] = [];
  private readonly starLight: PointLight;
  private readonly glow = new Float32Array(SECTOR_COUNT);
  private readonly targetGlow = new Float32Array(SECTOR_COUNT);
  private readonly tmp = new Vector3();
  private testTimer = -1;
  private ceremonyTimer = -1;
  private starGlow = 0;
  private starTarget = 0;
  private testRun = 0;

  /** Seconds for the switch-on to travel from the base to the leader. */
  readonly rampDuration = 1.15;

  constructor(
    private readonly harness: LightHarness,
    private readonly star: StarHoist,
    profile: QualityProfile,
  ) {
    const proxyCount = Math.min(SECTOR_COUNT, profile.lightProxies);
    for (let i = 0; i < proxyCount; i++) {
      const light = new PointLight(0xffcf96, 0, 34, 1.7);
      light.castShadow = false;
      this.group.add(light);
      this.proxies.push(light);
    }
    this.starLight = new PointLight(0xfff0cf, 0, 40, 1.8);
    this.group.add(this.starLight);
  }

  /** Run the pre-ceremony sector test from the base upwards. */
  beginTest(): void {
    this.testRun++;
    this.testTimer = 0;
    this.state = 'testing';
    if (this.testRun === 1) {
      // First run: the fault is a connector that was never fully mated.
      this.harness.unmate(this.faultSector);
    }
  }

  /** The player pushed the big weatherproof connector home. */
  repairFault(): void {
    this.harness.mate(this.faultSector);
    if (this.state === 'stalled') this.beginTest();
  }

  get testReachedTop(): boolean {
    return this.state === 'tested';
  }

  /** Ceremony switch-on: base to leader, then the star. */
  illuminate(): void {
    this.ceremonyTimer = 0;
    this.state = 'ceremony';
  }

  get isLit(): boolean {
    return this.state === 'lit';
  }

  reset(): void {
    this.state = 'dark';
    this.testTimer = -1;
    this.ceremonyTimer = -1;
    this.testRun = 0;
    this.starTarget = 0;
    for (let i = 0; i < SECTOR_COUNT; i++) this.targetGlow[i] = 0;
  }

  update(dt: number): void {
    if (this.testTimer >= 0) this.stepTest(dt);
    if (this.ceremonyTimer >= 0) this.stepCeremony(dt);

    for (let i = 0; i < SECTOR_COUNT; i++) {
      this.glow[i] = damp(this.glow[i], this.targetGlow[i], 9, dt);
      this.harness.setSectorGlow(i, this.glow[i]);
    }
    this.starGlow = damp(this.starGlow, this.starTarget, 6, dt);
    this.star.setGlow(this.starGlow);

    // Sector light proxies: one per band, driven by that band's glow. This is
    // what puts light back onto the paving, the crane and the crowd.
    for (let i = 0; i < this.proxies.length; i++) {
      const light = this.proxies[i];
      const sector = Math.round((i / Math.max(1, this.proxies.length - 1)) * (SECTOR_COUNT - 1));
      const glow = this.glow[sector] * (this.harness.isMated(sector) ? 1 : 0);
      light.intensity = glow * 62;
      if (glow > 0.01) this.harness.sectorProxy(sector, this.tmp), light.position.copy(this.tmp);
    }
    this.starLight.intensity = this.starGlow * 90;
    this.star.starWorld(this.tmp);
    this.starLight.position.copy(this.tmp);
  }

  private stepTest(dt: number): void {
    this.testTimer += dt;
    const step = 0.42;
    const reached = Math.floor(this.testTimer / step);
    let stalled = false;
    for (let i = 0; i < SECTOR_COUNT; i++) {
      const on = i <= reached;
      const powered = this.harness.isMated(i);
      // A test lamp is a dim proving light, not the show.
      this.targetGlow[i] = on && powered ? 0.28 : 0;
      if (on && !powered) stalled = true;
    }
    if (stalled) {
      this.state = 'stalled';
      this.testTimer = -1;
      return;
    }
    if (reached >= SECTOR_COUNT + 1) {
      this.testTimer = -1;
      this.state = 'tested';
      for (let i = 0; i < SECTOR_COUNT; i++) this.targetGlow[i] = 0;
    }
  }

  private stepCeremony(dt: number): void {
    this.ceremonyTimer += dt;
    const perSector = this.rampDuration / SECTOR_COUNT;
    for (let i = 0; i < SECTOR_COUNT; i++) {
      const start = i * perSector;
      this.targetGlow[i] = this.ceremonyTimer >= start ? 1 : 0;
    }
    if (this.ceremonyTimer >= this.rampDuration + 0.25) this.starTarget = 1;
    if (this.ceremonyTimer >= this.rampDuration + 1.0) {
      this.ceremonyTimer = -1;
      this.state = 'lit';
    }
  }

  /** Internal timers and per-sector glow, for the test harness read-out. */
  debug(): { testTimer: number; ceremonyTimer: number; glow: number[]; target: number[] } {
    return {
      testTimer: this.testTimer,
      ceremonyTimer: this.ceremonyTimer,
      glow: Array.from(this.glow),
      target: Array.from(this.targetGlow),
    };
  }

  /** 0..1 overall brightness of the tree, for grading the plaza. */
  get treeBrightness(): number {
    let sum = 0;
    for (let i = 0; i < SECTOR_COUNT; i++) sum += this.glow[i];
    return clamp(sum / SECTOR_COUNT, 0, 1);
  }
}
