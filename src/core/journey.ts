/**
 * journey.ts — JourneyProgress.
 *
 * One number, 0..1, drives everything: where the slide sits on the mechanical stage,
 * which objective is in the light path, how wide the field is, how deep the focus,
 * which pyramid levels are in use, where the camera is and what you hear.
 *
 * The finger sets it directly from displacement. Nothing here is time-driven, so the
 * dive can be crawled, reversed, and re-crossed at any boundary as often as you like.
 */

import { FIELD_NUMBER, OBJECTIVES, Objective, depthOfFieldMM } from '../micro/optics';

export interface FieldKey {
  p: number;
  fieldMM: number;
}

/**
 * The magnification ladder. The plateaus are the objectives' true fields of view at
 * field number 22 (5.50 / 2.20 / 1.10 / 0.55 mm); the tight pairs of keys around
 * p = 0.46, 0.64 and 0.79 are the objective changes, where the field drops fast, the
 * turret clicks and the focus needs a moment to settle — exactly as on a real stand.
 */
export const FIELD_KEYS: FieldKey[] = [
  { p: 0.0, fieldMM: 34.0 },
  { p: 0.08, fieldMM: 20.0 },
  { p: 0.15, fieldMM: 11.0 },
  { p: 0.22, fieldMM: 7.6 },
  { p: 0.28, fieldMM: 5.5 },
  { p: 0.45, fieldMM: 3.05 },
  { p: 0.47, fieldMM: 2.2 },
  { p: 0.63, fieldMM: 1.42 },
  { p: 0.65, fieldMM: 1.1 },
  { p: 0.78, fieldMM: 0.72 },
  { p: 0.8, fieldMM: 0.55 },
  { p: 0.9, fieldMM: 0.42 },
  { p: 1.0, fieldMM: 0.275 },
];

/** Progress at which each objective clicks into the light path. */
export const OBJECTIVE_STOPS = [
  { p: 0.22, id: '4x' },
  { p: 0.46, id: '10x' },
  { p: 0.64, id: '20x' },
  { p: 0.79, id: '40x' },
] as const;

export type Stage =
  | 'slide-overview'
  | 'stage-travel'
  | 'entering-field'
  | 'low-power'
  | 'mid-power'
  | 'high-power'
  | 'cellular';

export interface JourneyState {
  progress: number;
  /** Displayed field width at the specimen, mm. */
  fieldMM: number;
  /** Objective currently in the light path, or null while still above the stage. */
  objective: Objective | null;
  objectiveIndex: number;
  /** 0 before the objective is engaged, 1 once fully seated. */
  objectiveSeat: number;
  /** How open the circular brightfield view is, 0..1. */
  fieldOpen: number;
  /** How much of the frame the 3D hardware still owns, 1..0. */
  macroWeight: number;
  /** Depth of field of the current objective, mm. */
  depthOfFieldMM: number;
  /** Total magnification as it would read on the stand (objective x eyepiece). */
  totalMag: number;
  stage: Stage;
}

function lerpLogField(p: number): number {
  const keys = FIELD_KEYS;
  if (p <= keys[0].p) return keys[0].fieldMM;
  const last = keys[keys.length - 1];
  if (p >= last.p) return last.fieldMM;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (p >= a.p && p <= b.p) {
      const t = (p - a.p) / (b.p - a.p);
      // Interpolating the logarithm keeps the perceived rate of zoom even.
      return Math.exp(Math.log(a.fieldMM) * (1 - t) + Math.log(b.fieldMM) * t);
    }
  }
  return last.fieldMM;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function stageFor(p: number): Stage {
  if (p < 0.02) return 'slide-overview';
  if (p < 0.15) return 'stage-travel';
  if (p < 0.28) return 'entering-field';
  if (p < 0.45) return 'low-power';
  if (p < 0.62) return 'mid-power';
  if (p < 0.8) return 'high-power';
  return 'cellular';
}

export function evaluateJourney(progress: number): JourneyState {
  const p = Math.max(0, Math.min(1, progress));
  const fieldMM = lerpLogField(p);

  let objectiveIndex = -1;
  for (let i = 0; i < OBJECTIVE_STOPS.length; i++) {
    if (p >= OBJECTIVE_STOPS[i].p - 0.02) objectiveIndex = i;
  }
  const objective = objectiveIndex >= 0 ? OBJECTIVES[objectiveIndex] : null;
  const seatFrom = objectiveIndex >= 0 ? OBJECTIVE_STOPS[objectiveIndex].p - 0.02 : 0;
  const objectiveSeat = objective ? smoothstep(seatFrom, seatFrom + 0.035, p) : 0;

  // The circular field opens as the objective closes on the coverslip, and the 3D
  // hardware hands over inside that same circle — no cut, no fade to black.
  const fieldOpen = smoothstep(0.155, 0.29, p);
  const macroWeight = 1 - smoothstep(0.2, 0.305, p);

  const na = objective?.na ?? OBJECTIVES[0].na;
  const mag = objective?.mag ?? FIELD_NUMBER / Math.max(fieldMM, 1e-3);

  return {
    progress: p,
    fieldMM,
    objective,
    objectiveIndex,
    objectiveSeat,
    fieldOpen,
    macroWeight,
    depthOfFieldMM: depthOfFieldMM(objective?.mag ?? 4, na),
    // Eyepieces are 10x; past 40x the intermediate magnifier carries the rest.
    totalMag: (objective ? objective.mag : mag) * 10 * (fieldMM < 0.5 ? 0.55 / fieldMM : 1),
    stage: stageFor(p),
  };
}

/** Progress values worth photographing, used by the debug API and the capture tool. */
export const CAPTURE_POINTS: Array<{ id: string; p: number; label: string }> = [
  { id: 'slide', p: 0.0, label: 'slide on the stage' },
  { id: 'approach', p: 0.14, label: 'just before the objective' },
  { id: 'crossing', p: 0.23, label: 'crossing into the circular field' },
  { id: 'obj4x', p: 0.34, label: '4x' },
  { id: 'rack', p: 0.468, label: 'objective change, focus settling' },
  { id: 'obj10x', p: 0.54, label: '10x' },
  { id: 'obj20x', p: 0.71, label: '20x' },
  { id: 'obj40x', p: 0.86, label: '40x' },
  { id: 'cellular', p: 1.0, label: 'cellular level' },
];
