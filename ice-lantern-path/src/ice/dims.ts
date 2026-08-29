/**
 * Every dimension of the two moulds and of the ice that forms between them,
 * in metres, measured from the outer mould's base (y = 0 sits on the bench).
 * Derived from a nested-bucket ice lantern: outer pail ~32 cm across, inner
 * pail held 3 cm off the floor by three spacers so the lantern gets a solid
 * load bearing base.
 */
export const D = {
  /** outer mould */
  outerR: 0.178,
  outerRIn: 0.16,
  outerH: 0.29,
  outerFloor: 0.022,

  /** inner mould */
  innerR: 0.0965,
  innerRIn: 0.084,
  innerH: 0.235,
  innerFloor: 0.012,

  /** three spacers that both carry and centre the inner mould */
  spacerH: 0.03,
  spacerFin: 0.058,
  spacerR: 0.074,

  /** water / ice */
  waterTop: 0.232,
  get iceBottom() {
    return this.outerFloor;
  },
  get iceBaseThickness() {
    return this.spacerH;
  },
  get cavityFloor() {
    return this.outerFloor + this.spacerH;
  },
  get waterSurfaceY() {
    return this.outerFloor + this.waterTop;
  },
  /** finished lantern (relative to its own base) */
  get lanternH() {
    return this.waterTop;
  },
  get lanternR() {
    return this.outerRIn - 0.001;
  },
  get lanternCavityR() {
    return this.innerR + 0.001;
  },
};

export const BENCH_Y = 0.78;
