/** Physical layout of the bench. All values in metres. Design values. */
import { LAMB_HEIGHT, R_INNER, R_OUTER, polygonCentroid, lambProfile } from './profile'

export const BENCH_TOP = 0
/** Top face of the jig plate: the ring's hooves rest here. */
export const JIG_TOP = 0.030
export const RING_TOP = JIG_TOP + LAMB_HEIGHT
/** The receiving table is flush with the jig so the wedge can slide across. */
export const TRAY_TOP = JIG_TOP

const c = polygonCentroid(lambProfile())
/** Radius of the wedge's area centroid — the axis it is turned about. */
export const PIVOT_R = c.x
export const PIVOT_Y = c.y

/** How far the wedge slides radially out of the ring, onto the table. */
export const SLIDE_MAX = 0.132
/** Beyond this the wedge is completely outside the ring's outer radius. */
export const SLIDE_CLEAR = R_OUTER - R_INNER + 0.004
/** Turning is only unlocked once the wedge is well clear of the ring, with
 *  room for its own turning circle. */
export const SLIDE_TURN_UNLOCK = 0.128

/** Saw: distance from the carriage centre to the blade's cutting edge. */
export const SAW_LEAD = 0.135
export const SAW_RAIL_Y = 0.176
/** The rail is offset sideways so it never hides the cut line, and the
 *  child's finger is never over the wood that is opening. */
export const SAW_RAIL_SIDE = 0.088
export const SAW_RAIL_R0 = 0.205
export const SAW_RAIL_R1 = 0.545
export const SAW_CARRIAGE_START = R_OUTER + 0.014 + SAW_LEAD
export const SAW_CARRIAGE_END = R_INNER - 0.012 + SAW_LEAD
/** Where the saw is drawn back to once the wedge is parted, so the bench is
 *  clear for taking it out. */
export const SAW_CARRIAGE_PARK = 0.470
/** The blade clears the top of the ring and runs a little into the jig's
 *  relief slot, so it really does pass right through the wood. */
export const BLADE_TOP = JIG_TOP + LAMB_HEIGHT + 0.016
export const BLADE_BOTTOM = JIG_TOP - 0.005
export const HANDLE_Y = SAW_RAIL_Y + 0.046

export const TRAY_R0 = R_OUTER + 0.012
export const TRAY_R1 = R_OUTER + 0.236
export const TRAY_HALF_DEG = 16
