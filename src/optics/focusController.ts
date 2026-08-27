/**
 * focusController.ts — FocusController + ObjectiveTransitionController.
 *
 * Two mechanical facts drive both of these. Changing objective on a real stand means
 * turning the nosepiece until it clicks, then touching the fine focus, because even
 * parfocal objectives need a nudge. And a specimen you are hunting for gets walked
 * about under the lens, which is the hint this game gives instead of an arrow.
 */

import { OBJECTIVES } from '../micro/optics';

export class FocusController {
  /** Current focal plane offset from the middle of the section, mm. */
  offsetMM = 0;
  private rackAmp = 0;
  private rackT = 0;
  private rackDur = 0.28;
  private nudgeT = -1;
  private nudgeDur = 1.15;
  private reduced = false;

  constructor(reducedMotion: boolean) {
    this.reduced = reducedMotion;
  }

  /**
   * A short excursion and return, the size of the depth of field of whichever
   * objective just arrived. At 4x this is invisible; at 40x it is a real swim.
   */
  rack(objectiveIndex: number): void {
    const obj = OBJECTIVES[Math.max(0, Math.min(objectiveIndex, OBJECTIVES.length - 1))];
    // Racking by a few depths of field is what a hand on the fine focus actually does.
    const dof = 0.00055 / (obj.na * obj.na);
    this.rackAmp = dof * (this.reduced ? 1.4 : 2.6);
    this.rackT = 0;
  }

  /** The idle hint: the stage lifts the specimen a touch toward the lens, then backs off. */
  nudge(): void {
    this.nudgeT = 0;
  }

  get nudging(): boolean {
    return this.nudgeT >= 0 && this.nudgeT < this.nudgeDur;
  }

  /** How far the stage has been lifted by the idle hint, in mm of world travel. */
  nudgeLift(): number {
    if (!this.nudging) return 0;
    const t = this.nudgeT / this.nudgeDur;
    return Math.sin(t * Math.PI) * (this.reduced ? 0.35 : 0.8);
  }

  update(dt: number): void {
    if (this.rackT < this.rackDur) {
      this.rackT += dt;
      const t = Math.min(this.rackT / this.rackDur, 1);
      // Out and back, easing to a stop the way a knob does.
      this.offsetMM = this.rackAmp * Math.sin(t * Math.PI) * (1 - t * 0.35);
    } else {
      this.offsetMM *= Math.exp(-dt / 0.12);
    }
    if (this.nudgeT >= 0 && this.nudgeT < this.nudgeDur) this.nudgeT += dt;
  }

  /** Lateral softening produced by the current defocus, mm. Geometric, not stylistic. */
  blurMM(na: number): number {
    return Math.abs(this.offsetMM) * na;
  }
}

export interface TransitionState {
  /** 0..1 as the turret rotates from the previous objective to the current one. */
  blend: number;
  previousIndex: number;
  /** Brief mechanical unsteadiness right after the click. */
  grit: number;
  /** Set for exactly one frame when the turret clicks home. */
  clicked: boolean;
}

export class ObjectiveTransitionController {
  private current = -1;
  private previous = -1;
  private t = 1;
  private readonly duration = 0.34;
  private clickedThisFrame = false;

  constructor(private readonly onClick: (index: number) => void, private readonly focus: FocusController) {}

  update(objectiveIndex: number, dt: number): TransitionState {
    this.clickedThisFrame = false;
    if (objectiveIndex !== this.current) {
      this.previous = this.current < 0 ? objectiveIndex : this.current;
      this.current = objectiveIndex;
      this.t = 0;
      if (objectiveIndex >= 0 && this.previous !== objectiveIndex) {
        this.clickedThisFrame = true;
        this.onClick(objectiveIndex);
        this.focus.rack(objectiveIndex);
      }
    }
    if (this.t < 1) this.t = Math.min(1, this.t + dt / this.duration);
    const e = this.t * this.t * (3 - 2 * this.t);
    return {
      blend: e,
      previousIndex: this.previous < 0 ? Math.max(objectiveIndex, 0) : this.previous,
      grit: Math.max(0, 1 - this.t * 2.2),
      clicked: this.clickedThisFrame,
    };
  }
}
