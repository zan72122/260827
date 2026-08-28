/**
 * Shared dimensions for the globe assembly, in assembly-local metres with the
 * sphere centre at the origin and +Y "town up" (the finished, display posture).
 * During filling the whole assembly is rolled 180 deg so the mouth faces up.
 */
export const R_OUT = 0.5
export const GLASS_THICKNESS = 0.022
export const R_IN = R_OUT - GLASS_THICKNESS

/** Plane of the sphere's opening. Everything below it is the plug assembly. */
export const MOUTH_Y = -0.3
export const MOUTH_R = Math.sqrt(R_IN * R_IN - MOUTH_Y * MOUTH_Y)

export const PLATE_THICKNESS = 0.03
/** Top face of the plug = the town's ground. */
export const GROUND_Y = MOUTH_Y + PLATE_THICKNESS
/** Radius the player may place miniatures within. */
export const PLOT_R = 0.3

/** Fill level 1.0 stops here, leaving a readable air pocket under the crown. */
export const LIQUID_TOP = R_IN * 0.9
export const LIQUID_BOTTOM = -R_IN
/** Fill fraction whose waterline sits exactly at the open mouth's rim. */
export const FILL_TO_BRIM = (-MOUTH_Y - LIQUID_BOTTOM) / (LIQUID_TOP - LIQUID_BOTTOM)
/** Fill once the plug is seated: the trapped air becomes the bubble. */
export const FILL_SEALED = 0.965

/** World positions of the two rests the globe lives on. */
export const CRADLE_CENTER_Y = 0.56
export const PEDESTAL_TOP_Y = 0.17
/** Sphere-centre height once the globe is seated on the pedestal. */
export const MOUNTED_CENTER_Y = PEDESTAL_TOP_Y - MOUTH_Y
/** Sphere-centre height while the bare plug lies on the bench in step 1. */
export const BENCH_CENTER_Y = 0.02 - MOUTH_Y

/** Keeps a miniature's bounding capsule clear of the glass. */
export function fitsInside(radius: number, topY: number, margin = 0.035): boolean {
  return Math.hypot(radius, topY) <= R_IN - margin
}
