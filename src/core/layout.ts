/** Physical layout of the bench. All values in metres. Design values. */
import { LAMB_HEIGHT, R_INNER, R_OUTER, polygonCentroid, lambProfile } from './profile'

export const BENCH_TOP = 0
/** Top face of the jig plate: the ring's hooves rest here. */
export const JIG_TOP = 0.030
/** The jig and the receiving table are modelled a fraction of a millimetre
 *  below the wood that rests on them.  Coplanar faces fight in the shadow map
 *  and stripe the bench; 0.7 mm is far below anything the eye resolves. */
export const SUPPORT_TOP = JIG_TOP - 0.0007
export const RING_TOP = JIG_TOP + LAMB_HEIGHT
/** The receiving table is flush with the jig so the wedge can slide across. */
export const TRAY_TOP = SUPPORT_TOP

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
/** Length of the saw plate: the handle sits this far outboard of the
 *  cutting edge, so the child's finger is always well outside the ring. */
export const SAW_LEAD = 0.150
export const SAW_CARRIAGE_START = R_OUTER + 0.020 + SAW_LEAD
export const SAW_CARRIAGE_END = R_INNER - 0.012 + SAW_LEAD
/** Drawn back this far once the wedge is parted, before being set down. */
export const SAW_CARRIAGE_PARK = R_OUTER + 0.055 + SAW_LEAD
/** The blade clears the top of the ring and runs a little into the jig's
 *  relief slot, so it really does pass right through the wood. */
export const BLADE_TOP = JIG_TOP + LAMB_HEIGHT + 0.010
export const BLADE_BOTTOM = JIG_TOP - 0.005
export const HANDLE_Y = JIG_TOP + LAMB_HEIGHT * 0.62

export const TRAY_R0 = R_OUTER + 0.012
export const TRAY_R1 = R_OUTER + 0.236
export const TRAY_HALF_DEG = 16
