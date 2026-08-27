// Path-following ship controller.
//
// The hull follows the processed route with yaw inertia (no snap turns),
// a mild bank into turns, a slow heave, and — for the icebreaker — a
// "bite" cycle while breaking: bow rides up on the ice edge, the weight
// comes down, cracks radiate, plates tip aside, dark water opens astern.

import * as THREE from 'three';
import { Route, sampleRoute, PoseSample } from './path';
import { IceField } from './ice';
import { Floes } from './floes';
import { WATER_Y, CHANNEL_HALF, MIN_TURN_RADIUS, clamp, damp, wrapAngle } from './const';

const BITE_PERIOD = 1.35;

export class ShipController {
  s = 0;
  speed = 0;
  heading: number;
  pos = new THREE.Vector3();
  private roll = 0;
  private pitch = 0;
  private biteT = 0;
  private lastCarveS = 0;
  private lastCrackS = 0;
  private lastBrashS = 0;
  private crackedAhead = false;
  finished = false;
  /** true while the bow is actually breaking ice (drives camera + effects) */
  breaking = false;
  private bowFoam: THREE.Sprite;

  constructor(
    public model: THREE.Group,
    private routePts: { x: number; z: number }[],
    private routeHeadings: number[],
    private routeStep: number,
    private totalLen: number,
    public maxSpeed: number,
    private shipLength: number,
    startHeading: number,
    private breaker: boolean,
    private ice: IceField | null,
    private floes: Floes | null,
    scene: THREE.Scene,
    /** arc length after which the run is the auto-extension (sails brisker) */
    private autoAfter = Infinity,
  ) {
    this.heading = startHeading;
    const p0 = routePts[0];
    this.pos.set(p0.x, WATER_Y, p0.z);
    this.apply(0);

    const foamTex = ShipController.makeFoamTexture();
    this.bowFoam = new THREE.Sprite(new THREE.SpriteMaterial({
      map: foamTex, color: '#eef4f6', transparent: true, opacity: 0, depthWrite: false,
    }));
    this.bowFoam.scale.set(this.shipLength * 0.34, this.shipLength * 0.13, 1);
    scene.add(this.bowFoam);
  }

  private static foamTexture: THREE.Texture | null = null;
  private static makeFoamTexture(): THREE.Texture {
    if (this.foamTexture) return this.foamTexture;
    const c = document.createElement('canvas');
    c.width = 128; c.height = 64;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(64, 40, 4, 64, 40, 56);
    g.addColorStop(0, 'rgba(255,255,255,0.85)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 64);
    this.foamTexture = new THREE.CanvasTexture(c);
    return this.foamTexture;
  }

  get progress(): number { return this.s / this.totalLen; }

  bowPos(): { x: number; z: number } {
    return {
      x: this.pos.x + Math.sin(this.heading) * this.shipLength * 0.46,
      z: this.pos.z + Math.cos(this.heading) * this.shipLength * 0.46,
    };
  }

  update(dt: number, time: number, speedFactor: number): void {
    if (this.finished) { this.bowFoam.material.opacity = 0; return; }

    const pose = sampleRoute(this.routePts, this.routeHeadings, this.routeStep, this.s);

    // --- speed: heavy acceleration, slower in tight turns, bite surge -------
    const turnSlow = 1 - clamp(Math.abs(pose.curvature) * MIN_TURN_RADIUS, 0, 1) * 0.3;
    const endBrake = clamp((this.totalLen - this.s) / 40, 0.15, 1);
    let target = this.maxSpeed * speedFactor * turnSlow * endBrake;
    if (this.s > this.autoAfter) target *= 1.3; // the auto leg hurries a little
    if (this.breaker && this.breaking) {
      // ride-up / crush surge: speed dips as the bow climbs, recovers on the break
      const ph = (this.biteT % BITE_PERIOD) / BITE_PERIOD;
      target *= 0.86 + 0.14 * Math.cos(ph * Math.PI * 2);
    }
    this.speed = damp(this.speed, target, 0.55, dt);
    this.s = Math.min(this.s + this.speed * dt, this.totalLen);

    // --- pose with yaw inertia ----------------------------------------------
    const desired = pose.heading;
    const maxYawRate = (this.speed / MIN_TURN_RADIUS) * 1.6 + 0.05;
    const err = wrapAngle(desired - this.heading);
    this.heading += clamp(err * 3.0 * dt, -maxYawRate * dt, maxYawRate * dt);

    this.pos.x = pose.x;
    this.pos.z = pose.z;

    // --- icebreaking behaviour ----------------------------------------------
    let biteHeave = 0;
    if (this.breaker && this.ice && this.floes) {
      const bow = this.bowPos();
      const probe = {
        x: bow.x + Math.sin(this.heading) * 6,
        z: bow.z + Math.cos(this.heading) * 6,
      };
      this.breaking = this.s < this.totalLen - 4 && !this.ice.isCarvedAt(probe.x, probe.z);

      if (this.breaking) {
        this.biteT += dt;
        const ph = (this.biteT % BITE_PERIOD) / BITE_PERIOD;
        // bow rises onto the edge, then the weight drops through
        biteHeave = Math.sin(ph * Math.PI) * 0.22;
        this.pitch = damp(this.pitch, Math.sin(ph * Math.PI) * 0.022, 6, dt);

        // cracks radiate a little AHEAD of the bow near the top of the bite
        if (ph > 0.35 && !this.crackedAhead) {
          this.crackedAhead = true;
          const ax = bow.x + Math.sin(this.heading) * 7;
          const az = bow.z + Math.cos(this.heading) * 7;
          this.ice.paintCracks(ax, az, this.heading, 10);
          this.ice.wetRing(ax, az, CHANNEL_HALF * 0.8);
        }
        if (ph < 0.35) this.crackedAhead = false;
      } else {
        this.pitch = damp(this.pitch, 0, 3, dt);
      }

      // open water follows the hull (a touch behind the bow so the crack ->
      // break -> open-lane order is visible)
      if (this.s - this.lastCarveS > 1.1) {
        this.lastCarveS = this.s;
        const cx = this.pos.x + Math.sin(this.heading) * this.shipLength * 0.3;
        const cz = this.pos.z + Math.cos(this.heading) * this.shipLength * 0.3;
        this.ice.carveCircle(cx, cz, CHANNEL_HALF * (0.94 + Math.random() * 0.12));
      }
      if (this.breaking && this.s - this.lastCrackS > 2.6) {
        this.lastCrackS = this.s;
        this.floes.spawnAtBow(bow.x, bow.z, this.heading, -1);
        this.floes.spawnAtBow(bow.x, bow.z, this.heading, 1);
        if (Math.random() < 0.6) this.floes.spawnAtBow(bow.x, bow.z, this.heading, Math.random() < 0.5 ? -1 : 1);
      }
      if (this.s - this.lastBrashS > 5) {
        this.lastBrashS = this.s;
        const sx = this.pos.x - Math.sin(this.heading) * this.shipLength * 0.55;
        const sz = this.pos.z - Math.cos(this.heading) * this.shipLength * 0.55;
        this.floes.scatterBrash(sx, sz, CHANNEL_HALF);
      }
    }

    // --- bank + heave --------------------------------------------------------
    const yawRate = err !== 0 ? clamp(err * 3.0, -1, 1) * maxYawRate : 0;
    const bank = clamp(-yawRate * this.speed * 0.010, -0.035, 0.035);
    this.roll = damp(this.roll, bank, 2.5, dt);
    const heave = Math.sin(time * 0.9 + (this.breaker ? 0 : 2)) * 0.05
      + Math.sin(time * 1.7 + 1) * 0.02 + biteHeave;

    this.apply(heave);

    // bow foam, proportional to speed, only in open water at the bow
    const bow = this.bowPos();
    this.bowFoam.position.set(bow.x, WATER_Y + 0.25, bow.z);
    const foamTarget = this.breaking ? 0.15 : clamp(this.speed / this.maxSpeed, 0, 1) * 0.5;
    this.bowFoam.material.opacity = damp(this.bowFoam.material.opacity, foamTarget, 3, dt);

    if (this.s >= this.totalLen - 0.5) {
      this.finished = true;
      this.breaking = false;
    }
  }

  private apply(heave: number): void {
    this.model.position.set(this.pos.x, WATER_Y + heave, this.pos.z);
    this.model.rotation.set(0, 0, 0);
    this.model.rotateY(this.heading);
    this.model.rotateX(-this.pitch);
    this.model.rotateZ(this.roll);
  }

  /** Jump the ship back to the start of its route. */
  resetTo(routePts: { x: number; z: number }[], routeHeadings: number[], totalLen: number, startHeading: number): void {
    this.routePts = routePts;
    this.routeHeadings = routeHeadings;
    this.totalLen = totalLen;
    this.s = 0;
    this.speed = 0;
    this.heading = startHeading;
    this.roll = 0; this.pitch = 0; this.biteT = 0;
    this.lastCarveS = 0; this.lastCrackS = 0; this.lastBrashS = 0;
    this.finished = false;
    this.breaking = false;
    const p0 = routePts[0];
    this.pos.set(p0.x, WATER_Y, p0.z);
    this.apply(0);
  }
}
