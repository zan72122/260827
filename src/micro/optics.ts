/**
 * optics.ts — the microscope's real optical behaviour.
 *
 * Field of view, resolution and depth of field are computed from the objectives'
 * actual specifications rather than picked to look nice, because the whole point of
 * the dive is that the magnification is honest.
 */

export interface Objective {
  id: string;
  /** Magnification, e.g. 4 for a 4x. */
  mag: number;
  /** Numerical aperture. */
  na: number;
  /** Working distance in mm — how close the front lens gets to the coverslip. */
  workingDistanceMM: number;
  /** Barrel length in mm (parfocal distance is 45 mm for DIN objectives). */
  barrelLengthMM: number;
  /** Front lens diameter in mm. */
  frontDiaMM: number;
  /** ISO 8578 magnification colour ring. */
  ringColor: number;
  ringLabel: string;
}

/** 550 nm green — the middle of the visual band, used for all optical maths. */
export const LAMBDA_MM = 0.00055;

/**
 * Eyepiece field number. FN 22 is the standard modern clinical value and gives the
 * familiar 5.5 / 2.2 / 1.1 / 0.55 mm field diameters at 4x / 10x / 20x / 40x.
 */
export const FIELD_NUMBER = 22.0;

/**
 * ISO 8578 magnification colour code: red 4x, yellow 10x, green 16-20x,
 * light blue 40-50x. These are the standard rings, not invented colours.
 */
export const OBJECTIVES: Objective[] = [
  {
    id: '4x',
    mag: 4,
    na: 0.1,
    workingDistanceMM: 18.5,
    barrelLengthMM: 30.5,
    frontDiaMM: 4.2,
    ringColor: 0xb4212a,
    ringLabel: 'red',
  },
  {
    id: '10x',
    mag: 10,
    na: 0.25,
    workingDistanceMM: 10.6,
    barrelLengthMM: 36.0,
    frontDiaMM: 3.4,
    ringColor: 0xd8b12a,
    ringLabel: 'yellow',
  },
  {
    id: '20x',
    mag: 20,
    na: 0.4,
    workingDistanceMM: 1.2,
    barrelLengthMM: 41.0,
    frontDiaMM: 2.6,
    ringColor: 0x2f8f4e,
    ringLabel: 'green',
  },
  {
    id: '40x',
    mag: 40,
    na: 0.65,
    workingDistanceMM: 0.6,
    barrelLengthMM: 43.5,
    frontDiaMM: 1.9,
    ringColor: 0x7fbede,
    ringLabel: 'light blue',
  },
];

export const OBJECTIVE_BY_ID = Object.fromEntries(OBJECTIVES.map((o) => [o.id, o]));

/** Field diameter at the specimen = field number / magnification. */
export function fieldOfViewMM(mag: number): number {
  return FIELD_NUMBER / mag;
}

/** Abbe/Rayleigh lateral resolution limit, mm. */
export function resolutionMM(na: number): number {
  return (0.61 * LAMBDA_MM) / na;
}

/**
 * Berek total depth of field, mm:  d = lambda*n/NA^2 + n*e/(M*NA)
 * with n = 1 (dry objectives) and e = 6 um for the detector/eye resolving element.
 */
export function depthOfFieldMM(mag: number, na: number): number {
  const n = 1.0;
  const e = 0.006;
  return (LAMBDA_MM * n) / (na * na) + (n * e) / (mag * na);
}

/**
 * The final frame is a 40x field through a 2x Optovar-style intermediate magnifier,
 * which is real hardware on clinical stands. It magnifies without adding resolution,
 * so the last stage is honestly diffraction-limited rather than newly detailed.
 */
export const FINAL_RELAY = 2.0;
export const FINAL_FIELD_MM = fieldOfViewMM(40) / FINAL_RELAY;
