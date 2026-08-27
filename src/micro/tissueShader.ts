/**
 * tissueShader.ts — ONE parametric model of a normal skin section, in H&E.
 *
 * This is the single original source from which every magnification level is
 * generated. There is no set of separately-authored 4x / 10x / 40x pictures to
 * cross-fade between: each pyramid level is this same function, evaluated over the
 * same millimetre coordinates, band-limited to that level's texel size and to the
 * objective's diffraction limit. That is what makes new detail genuinely appear as
 * you dive instead of a low-resolution image being stretched.
 *
 * Anatomy modelled (all normal, nothing pathological):
 *   stratum corneum / granulosum / spinosum / basale with rete ridges,
 *   papillary and reticular dermis (collagen bundles, fibroblasts),
 *   one terminal hair follicle: infundibulum, isthmus, inferior segment, bulb,
 *     hair shaft with cortex + medulla, inner and outer root sheath,
 *     glassy membrane, fibrous root sheath,
 *   sebaceous lobules and duct, arrector pili muscle,
 *   eccrine sweat gland coils and ducts, small dermal vessels,
 *   subcutaneous adipose tissue.
 */

import { FOLLICLE, HERO_TISSUE, SECTION_THICKNESS_MM, TISSUE_EXTENT } from './specimen';

/** Numeric constants shared with the TypeScript side, injected as #defines. */
export function tissueDefines(): string {
  return [
    `#define FOL_TILT ${FOLLICLE.tiltRad.toFixed(6)}`,
    `#define FOL_CURVE ${FOLLICLE.curve.toFixed(6)}`,
    `#define FOL_LEN ${FOLLICLE.lengthMM.toFixed(6)}`,
    `#define FOL_SHAFT_R ${FOLLICLE.shaftRadiusMM.toFixed(6)}`,
    `#define FOL_SEB_S ${FOLLICLE.sebaceousDuctS.toFixed(6)}`,
    `#define FOL_BULGE_S ${FOLLICLE.bulgeS.toFixed(6)}`,
    `#define SECTION_H ${SECTION_THICKNESS_MM.toFixed(6)}`,
    `#define TIS_XMIN ${TISSUE_EXTENT.xMin.toFixed(4)}`,
    `#define TIS_XMAX ${TISSUE_EXTENT.xMax.toFixed(4)}`,
    `#define TIS_YMIN ${TISSUE_EXTENT.yMin.toFixed(4)}`,
    `#define TIS_YMAX ${TISSUE_EXTENT.yMax.toFixed(4)}`,
    `#define HERO_X ${HERO_TISSUE.x.toFixed(6)}`,
    `#define HERO_Y ${HERO_TISSUE.y.toFixed(6)}`,
  ].join('\n');
}

export const TISSUE_NOISE_GLSL = /* glsl */ `
// ---------------------------------------------------------------- hashing
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
vec3 hash32(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yzz) * p3.zyx);
}

// ---------------------------------------------------------------- noise
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm3(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) {
    v += a * vnoise(p);
    p = p * 2.03 + vec2(11.7, 5.3);
    a *= 0.5;
  }
  return v;
}

float fbm5(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * vnoise(p);
    p = p * 2.07 + vec2(4.1, 9.3);
    a *= 0.5;
  }
  return v;
}

// ---------------------------------------------------------------- band limiting
/**
 * Coverage of a shape given a signed distance (mm, negative inside) and an edge
 * half-width w (mm). w carries BOTH the texel size of the level being generated and
 * the objective's diffraction limit, so anything finer than the optics can resolve
 * dissolves into a smooth tone instead of being invented as crisp detail.
 */
float cov(float d, float w) {
  return 1.0 - smoothstep(-w, w, d);
}

/** How much of a feature of size sz (mm) survives at an effective resolution w. */
float legible(float sz, float w) {
  return smoothstep(0.35, 1.4, sz / max(w, 1e-6));
}

float sdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

float sdSegmentT(vec2 p, vec2 a, vec2 b, out float t) {
  vec2 pa = p - a, ba = b - a;
  t = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * t);
}
`;

export const TISSUE_GEOMETRY_GLSL = /* glsl */ `
// ================================================================ H&E palette
// Hematoxylin stains nuclei blue-purple; eosin stains cytoplasm, collagen and
// keratin shades of pink. Nothing here glows, and nothing is neon.
const vec3 C_GLASS      = vec3(0.976, 0.972, 0.974);
const vec3 C_EOSIN_PALE = vec3(0.972, 0.922, 0.926);
const vec3 C_EOSIN_MID  = vec3(0.918, 0.729, 0.749);
const vec3 C_EOSIN_DEEP = vec3(0.831, 0.541, 0.588);
const vec3 C_MUSCLE     = vec3(0.855, 0.494, 0.510);
const vec3 C_KERATIN    = vec3(0.965, 0.878, 0.843);
const vec3 C_KERATIN_D  = vec3(0.914, 0.769, 0.702);
const vec3 C_CYTO_EPI   = vec3(0.941, 0.843, 0.871);
const vec3 C_CYTO_PALE  = vec3(0.965, 0.937, 0.949);
const vec3 C_HEMA       = vec3(0.302, 0.216, 0.475);
const vec3 C_HEMA_PALE  = vec3(0.545, 0.494, 0.686);
const vec3 C_HAIR       = vec3(0.431, 0.318, 0.212);
const vec3 C_HAIR_DARK  = vec3(0.220, 0.157, 0.106);
const vec3 C_IRS        = vec3(0.878, 0.463, 0.478);
const vec3 C_RBC        = vec3(0.882, 0.494, 0.404);
const vec3 C_SEBUM      = vec3(0.980, 0.965, 0.969);
const vec3 C_MELANIN    = vec3(0.420, 0.318, 0.227);

// ================================================================ epidermis geometry
/** Height of the skin surface (top of stratum corneum) at position x, in mm. */
float surfaceY(float x) {
  return -0.028
       + 0.052 * (fbm3(vec2(x * 0.55, 3.1)) - 0.5)
       + 0.016 * (vnoise(vec2(x * 4.3, 8.7)) - 0.5);
}

/** Full epidermal thickness at x, in mm. Rete ridges make it undulate. */
float epiThickness(float x) {
  float warp = 0.9 * fbm3(vec2(x * 1.7, 21.5));
  float rete = 0.5 + 0.5 * cos(x * (6.2831853 / 0.335) + warp * 3.6);
  rete = pow(rete, 1.55);
  float irregular = 0.010 * (vnoise(vec2(x * 3.1, 44.0)) - 0.5);
  return 0.050 + 0.068 * rete + irregular;
}

/** Stratum corneum thickness at x, in mm (non-acral skin: ~15-22 um). */
float corneumThickness(float x) {
  return 0.0165 + 0.0055 * (fbm3(vec2(x * 2.6, 61.0)) - 0.4);
}

// ================================================================ follicle geometry
vec2 folAxisDir() { return vec2(sin(FOL_TILT), cos(FOL_TILT)); }
vec2 folAxisNrm() { return vec2(cos(FOL_TILT), -sin(FOL_TILT)); }

vec2 folPoint(float s) {
  return folAxisDir() * s + folAxisNrm() * (FOL_CURVE * s * s);
}

/**
 * Follicular coordinates: s = arc position down the axis (mm), r = signed radial
 * offset (mm). Two Newton-ish refinements are plenty for so gentle a curve.
 */
void follicleCoords(vec2 t, out float s, out float r) {
  vec2 d = folAxisDir();
  vec2 n = folAxisNrm();
  s = dot(t, d);
  for (int i = 0; i < 2; i++) {
    vec2 p = folPoint(s);
    vec2 tng = normalize(d + n * (2.0 * FOL_CURVE * s));
    s += dot(t - p, tng);
  }
  vec2 p = folPoint(s);
  vec2 tng = normalize(d + n * (2.0 * FOL_CURVE * s));
  vec2 nrm = vec2(-tng.y, tng.x);
  r = dot(t - p, nrm);
}

/** Outer radius of the follicular epithelium at axial position s, in mm. */
float folOuterR(float s) {
  // Infundibulum funnels out toward the ostium, isthmus is narrow, bulb swells.
  float infund = 0.180 * exp(-s / 0.22);
  float body = 0.104 + 0.024 * smoothstep(1.0, 2.6, s);
  float bs = (s - (FOL_LEN - 0.30)) / 0.34;
  float bulb = 0.085 * exp(-bs * bs);
  float wobble = 0.006 * (fbm3(vec2(s * 9.0, 3.7)) - 0.5);
  return max(body, infund * 0.62 + body * 0.55) + bulb + wobble;
}

/** Radius of the hair shaft at s (it thins toward the tip of the bulb). */
float folShaftR(float s) {
  float taper = smoothstep(FOL_LEN - 0.05, FOL_LEN - 0.85, s);
  float wobble = 1.0 + 0.06 * (fbm3(vec2(s * 14.0, 19.0)) - 0.5);
  return FOL_SHAFT_R * taper * wobble;
}

// ================================================================ section outline
/** Signed distance to the edge of the tissue ribbon; ragged, as a real section is. */
float sectionSDF(vec2 t) {
  float rag = 0.045 * (fbm5(vec2(t.x * 2.4, t.y * 2.4)) - 0.5);
  float tear = 0.16 * (fbm3(vec2(t.y * 1.3, 91.0)) - 0.5) + 0.05 * (vnoise(vec2(t.y * 7.0, 3.0)) - 0.5);
  float dx = max(TIS_XMIN + tear - t.x, t.x - (TIS_XMAX + tear));
  // The top edge IS the skin surface: above it there is only mounting medium.
  float top = surfaceY(t.x) - t.y;
  // The deep (subcutis) edge is torn where the block was trimmed.
  float deepRag = 0.22 * (fbm3(vec2(t.x * 1.5, 77.0)) - 0.5);
  float dy = max(top, t.y - (TIS_YMAX + deepRag));
  return max(dx, dy) + rag * step(0.004, abs(top));
}
`;

export const TISSUE_NUCLEI_GLSL = /* glsl */ `
// ================================================================ nuclei engine
/**
 * A nuclear population, described in a WARPED coordinate space so that the grid
 * follows the anatomy: rows parallel to the basal lamina in epidermis, concentric
 * rings around the follicle, and so on. One population is active per fragment,
 * selected by whichever compartment owns that point.
 */
struct Nuc {
  vec2 uv;        // warped coordinates, mm
  float spacing;  // mm between neighbouring nuclei in warped space
  float radius;   // semi-minor axis, mm
  float elong;    // long/short axis ratio
  float ang;      // orientation in warped space, radians
  float angJit;   // how much that orientation scatters
  float density;  // fraction of grid cells that carry a nucleus
  float tone;     // hematoxylin uptake, 0..1
  float mask;     // coverage of the owning compartment
  float seed;     // decorrelates populations that share warped coordinates
};

Nuc nucNone() {
  return Nuc(vec2(0.0), 1.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
}

/** Adopt a nuclear population if its compartment owns more of this fragment. */
void claim(inout Nuc dst, Nuc src, float coverage) {
  if (coverage > dst.mask) {
    src.mask = coverage;
    dst = src;
  }
}

/**
 * Paints the active nuclear population. Returns premultiplied-free (rgb, alpha).
 *
 * Below the resolution limit the loop is skipped entirely and the population can
 * only darken the tissue as an averaged tone — which is exactly what happens down a
 * real 4x objective, where you read nuclear DENSITY but cannot count nuclei.
 */
vec4 paintNuclei(Nuc n, float w, float focusZ, float na, float stainH) {
  if (n.mask <= 0.004 || n.density <= 0.001 || n.radius <= 0.0) return vec4(0.0);

  float perCell = 3.14159265 * n.radius * n.radius * n.elong * n.density;
  float meanCover = clamp(perCell / (n.spacing * n.spacing), 0.0, 0.92);
  vec3 meanCol = mix(C_HEMA_PALE, C_HEMA, n.tone * 0.85);

  float lg = legible(n.radius * 2.0, w);
  vec4 unresolved = vec4(meanCol, meanCover * n.mask * n.tone * stainH);
  if (lg < 0.015) return unresolved;

  vec2 gi = floor(n.uv / n.spacing);
  float bestA = 0.0;
  vec3 bestC = meanCol;

  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 cell = gi + vec2(float(i), float(j));
      vec3 h = hash32(cell + vec2(n.seed, n.seed * 1.7));
      if (h.z > n.density) continue;

      vec2 jit = (hash22(cell * 1.37 + vec2(n.seed + 4.1)) - 0.5) * 0.78;
      vec2 c = (cell + 0.5 + jit) * n.spacing;

      // No two nuclei are the same size, shape or angle.
      // Nuclei in one compartment still differ markedly in size and shape.
      float rs = n.radius * (0.68 + 0.68 * h.x * h.x);
      float el = max(1.0, n.elong * (0.74 + 0.52 * h.y));
      float a = n.ang + (h.x - 0.5) * n.angJit;
      vec2 u = vec2(cos(a), sin(a));
      vec2 v = vec2(-u.y, u.x);
      vec2 q = n.uv - c;
      vec2 qe = vec2(dot(q, u) / el, dot(q, v));
      float k = length(qe);
      float d = (k - rs) / sqrt(el);

      // Nuclei are 6-8 um spheres cut by a 4 um section: each sits at its own depth,
      // so at high NA some are crisp and their neighbours are soft.
      float z = (hash11(dot(cell, vec2(12.79, 7.31)) + n.seed) - 0.5) * SECTION_H * 1.7;
      float wz = w + abs(z - focusZ) * na * 0.85;

      float a1 = cov(d, wz);
      if (a1 <= bestA) continue;
      // Neighbours that overlap should merge rather than one simply winning.
      bestA = max(bestA * 0.35, a1);

      // Chromatin: never a flat purple disc.
      float fine = legible(rs * 0.30, w);
      // Some nuclei are open and vesicular, others coarsely clumped: that spread is
      // most of what stops a field of nuclei looking like stamped clones.
      float clump = 0.35 + 1.15 * hash11(dot(cell, vec2(3.1, 7.7)) + n.seed);
      float chrom = fbm3(n.uv * (1.0 / max(rs * mix(0.62, 0.26, clamp(clump, 0.0, 1.0)), 1e-5))
                         + cell * 13.0);
      float dens = n.tone * (0.44 + 0.92 * chrom * clump) * (0.72 + 0.56 * h.y);
      vec3 cc = mix(C_HEMA_PALE, C_HEMA, clamp(dens, 0.0, 1.0));
      cc = mix(meanCol, cc, fine);

      // Nuclear membrane reads as a slightly denser rim.
      float rim = smoothstep(-1.0, -0.18, d / max(rs, 1e-5));
      cc = mix(cc, C_HEMA * 0.86, rim * 0.42 * fine);

      // A nucleolus in the occasional nucleus, only once it is truly resolvable.
      if (h.y > 0.62) {
        vec2 no = (hash22(cell * 5.1 + 2.7) - 0.5) * rs * 0.7;
        float dn = length(q - no) - rs * 0.20;
        cc = mix(cc, C_HEMA * 0.72, cov(dn, wz) * 0.55 * legible(rs * 0.20, w));
      }
      bestC = cc;
    }
  }

  vec4 resolved = vec4(bestC, bestA * n.mask * stainH);
  return mix(unresolved, resolved, lg);
}
`;

export const TISSUE_STRUCTURES_GLSL = /* glsl */ `
// ================================================================ compositing utils
void over(inout vec3 col, vec3 c, float a) { col = mix(col, c, clamp(a, 0.0, 1.0)); }

/** Collapse a texture toward its mean once its features fall under the resolution. */
vec3 bandMix(vec3 detailCol, vec3 meanCol, float featureMM, float w) {
  return mix(meanCol, detailCol, legible(featureMM, w));
}

/** Jittered-cell tessellation used for cell borders, fat and gland tubules. */
void voronoi(vec2 p, float sp, float seed, out float edge, out vec2 cellId, out float rnd) {
  vec2 gi = floor(p / sp);
  float d1 = 1e9, d2 = 1e9;
  vec2 best = vec2(0.0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 cell = gi + vec2(float(i), float(j));
      vec2 jit = hash22(cell + vec2(seed, seed * 2.3));
      vec2 c = (cell + 0.18 + 0.64 * jit) * sp;
      float d = length(p - c);
      if (d < d1) { d2 = d1; d1 = d; best = cell; }
      else if (d < d2) { d2 = d; }
    }
  }
  edge = (d2 - d1) * 0.5;
  cellId = best;
  rnd = hash12(best + vec2(seed * 3.1));
}

// ================================================================ dermal collagen
vec3 collagen(vec2 t, float ang, float coarse, float w, float stainE, out float bundle) {
  vec2 u = vec2(cos(ang), sin(ang));
  vec2 v = vec2(-u.y, u.x);
  vec2 p = vec2(dot(t, u), dot(t, v));

  // Reticular dermis is a WEAVE: bundles running with the surface, crossed by others
  // cut obliquely. One anisotropic noise alone reads as marble, which it is not.
  float bw = mix(0.0058, 0.0168, coarse);            // bundle width, mm
  // A deliberately FLAT spectrum. An ordinary fbm is dominated by its lowest octave
  // and turns the dermis into marble or into long brush strokes; real collagen has a
  // narrow band of bundle widths and bundles only a few hundred microns long.
  vec2 q1 = vec2(p.x / (bw * 3.2), p.y / bw);
  float f1 = 0.42 * vnoise(q1) + 0.34 * vnoise(q1 * 2.13 + 5.0) + 0.24 * vnoise(q1 * 4.31 + 9.0);
  vec2 q2 = vec2(p.y / (bw * 2.6), p.x / (bw * 1.05));
  float f2 = 0.58 * vnoise(q2 + 17.0) + 0.42 * vnoise(q2 * 2.27 + 23.0);
  float weave = mix(f1, max(f1, f2 * 0.96), 0.42 + 0.30 * coarse);
  bundle = smoothstep(0.385, 0.635, weave);

  // Fibrillar streaking inside each bundle, and the pale clefts between them.
  // Individual fibrils inside each bundle. These are 1-3 um across, so they exist
  // only in the levels whose texels are finer than that — which is exactly why the
  // dermis stops being a smooth wash somewhere around the 20x objective.
  float fine = vnoise(vec2(p.x / (bw * 0.55), p.y / (bw * 0.22))) - 0.5;
  float fibril = vnoise(vec2(p.x / (bw * 0.115), p.y / (bw * 0.052))) - 0.5;
  float fibril2 = vnoise(vec2(p.x / (bw * 0.052), p.y / (bw * 0.026)) + 61.0) - 0.5;
  float dens = clamp(
      bundle
      + 0.24 * fine
      + 0.30 * fibril * legible(bw * 0.11, w)
      + 0.18 * fibril2 * legible(bw * 0.05, w), 0.0, 1.0);

  // Contrast is deliberately modest: dermis is a soft pink field, not a marble slab.
  float amp = mix(0.62, 0.88, coarse);
  vec3 deep = mix(C_EOSIN_MID, C_EOSIN_DEEP, coarse * 0.80);
  vec3 detail = mix(C_EOSIN_PALE, deep, clamp(dens * amp + 0.16, 0.0, 1.0) * stainE);
  vec3 mean = mix(C_EOSIN_PALE, deep, (0.42 * amp + 0.16) * stainE);
  return bandMix(detail, mean, bw, w);
}

// ================================================================ subcutaneous fat
void paintFat(vec2 t, float depth, float w, float stainE, inout vec3 col, inout Nuc nuc) {
  float aFat = smoothstep(0.0, 0.34, depth);
  if (aFat <= 0.003) return;
  float edge; vec2 cid; float rnd;
  // Warping the lattice keeps the adipocytes irregular rather than a tiled honeycomb.
  vec2 tw = t + 0.020 * vec2(fbm3(t * 5.0), fbm3(t * 5.0 + 9.0)) - 0.010;
  voronoi(tw, 0.082, 17.0, edge, cid, rnd);
  float septum = cov(edge - 0.0034 * (0.6 + 0.9 * rnd), max(w, 0.0006));

  // Fibrous septa divide the fat into lobules and carry the vessels.
  float lob = fbm3(t * 1.6 + 33.0);
  float band = cov(abs(lob - 0.5) - 0.030, max(w, 0.0025));

  // Adipocytes are pale, but never brighter than the bare glass beside the section:
  // at low power the subcutis has to read as cream, not as a hole in the slide.
  vec3 lipid = mix(C_SEBUM, C_EOSIN_PALE, 0.55);
  vec3 c = mix(lipid, C_EOSIN_MID, septum * 0.80 * stainE);
  c = mix(c, mix(C_EOSIN_MID, C_EOSIN_DEEP, 0.35), band * 0.55 * stainE);
  c = bandMix(c, mix(lipid, C_EOSIN_MID, 0.30), 0.0068, w);
  over(col, c, aFat);
  Nuc n = nucNone();
  // A single flattened nucleus pushed to the rim of each fat cell.
  n.uv = t; n.spacing = 0.082; n.radius = 0.0024; n.elong = 3.4;
  n.ang = 0.4; n.angJit = 3.0; n.density = 0.42; n.tone = 0.80; n.seed = 31.0;
  claim(nuc, n, aFat * 0.9);
}

// ================================================================ eccrine sweat gland
void paintEccrine(vec2 t, vec2 centre, float R, float w, float focusZ, float na,
                  float stainE, inout vec3 col, inout Nuc nuc) {
  vec2 d = t - centre;
  float rr = length(d);
  if (rr > R * 1.7) return;
  float lobe = R * (1.0 + 0.28 * (fbm3(d * 6.0 + 3.0) - 0.5));
  float aCoil = cov(rr - lobe, max(w, 0.006));
  if (aCoil <= 0.003) return;

  // The coil is a ball of tubule cross-sections, secretory and ductal.
  float sp = 0.044;
  vec2 gi = floor(t / sp);
  float bestOuter = 0.0, bestLumen = 0.0, isDuct = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 cell = gi + vec2(float(i), float(j));
      vec3 h = hash32(cell + vec2(53.0, 11.0));
      if (h.z > 0.82) continue;
      vec2 c = (cell + 0.5 + (hash22(cell * 2.1) - 0.5) * 0.7) * sp;
      float ro = 0.0165 + 0.0075 * h.x;
      float rl = ro * (0.30 + 0.26 * h.y);
      float dd = length(t - c);
      float ao = cov(dd - ro, max(w, 0.0008));
      if (ao > bestOuter) {
        bestOuter = ao;
        bestLumen = cov(dd - rl, max(w, 0.0008));
        isDuct = step(0.72, h.y);
      }
    }
  }
  float aTub = bestOuter * aCoil;
  // Secretory coils are pale pink with a cuboidal lining; ducts are darker and denser.
  vec3 wall = mix(mix(C_CYTO_PALE, C_EOSIN_MID, 0.42 * stainE),
                  mix(C_CYTO_EPI, C_EOSIN_DEEP, 0.38 * stainE), isDuct);
  over(col, wall, aTub);
  over(col, C_EOSIN_PALE, bestLumen * aCoil * 0.85);
  Nuc n = nucNone();
  n.uv = t; n.spacing = 0.0118; n.radius = 0.0032; n.elong = 1.2;
  n.ang = 0.0; n.angJit = 3.14; n.density = 0.88;
  n.tone = mix(0.66, 0.84, isDuct); n.seed = 61.0;
  claim(nuc, n, aTub * (1.0 - bestLumen * 0.9));
}

// ================================================================ small dermal vessel
void paintVessel(vec2 t, vec2 a, vec2 b, float rl, float wallT, float rbcFill,
                 float w, float focusZ, float na, float stainE,
                 inout vec3 col, inout Nuc nuc) {
  float tt;
  float d = sdSegmentT(t, a, b, tt);
  float ro = rl + wallT;
  if (d > ro * 2.2) return;
  float wob = 1.0 + 0.16 * (vnoise(vec2(tt * 26.0, 4.0)) - 0.5);
  float aWall = cov(d - ro * wob, max(w, 0.0006));
  float aLum = cov(d - rl * wob, max(w, 0.0006));
  vec2 dir = normalize(b - a);
  over(col, mix(C_EOSIN_PALE, C_EOSIN_MID, 0.62 * stainE), aWall);
  over(col, mix(C_CYTO_PALE, C_EOSIN_PALE, 0.5), aLum * 0.75);
  // A few red cells in the lumen. Anucleate, eosinophilic, biconcave discs.
  if (aLum > 0.02 && rbcFill > 0.0) {
    vec2 lp = vec2(tt * length(b - a), d);
    float sp = 0.0092;
    vec2 gi = floor(lp / sp);
    float best = 0.0;
    for (int i = -1; i <= 1; i++) {
      vec2 cell = gi + vec2(float(i), 0.0);
      vec3 h = hash32(cell + vec2(7.7, 2.2));
      if (h.z > rbcFill) continue;
      vec2 c = (cell + 0.5 + (hash22(cell * 3.3) - 0.5) * 0.6) * sp;
      float dd = length(lp - c);
      float rr2 = 0.0033 * (0.80 + 0.40 * h.x);
      float a1 = cov(dd - rr2, max(w, 0.0005));
      // Central pallor: a red cell is a biconcave disc, pale through the middle.
      a1 *= 1.0 - 0.45 * cov(dd - rr2 * 0.45, max(w, 0.0005)) * legible(rr2, w);
      best = max(best, a1);
    }
    // Packed red cells read as a single eosinophilic column, not as beads.
    vec3 rbc = mix(C_RBC, C_EOSIN_DEEP, 0.35);
    over(col, rbc, best * aLum * 0.80);
  }
  Nuc n = nucNone();
  // Endothelium: flat nuclei bulging into the lumen, aligned with the vessel.
  n.uv = t; n.spacing = 0.0135; n.radius = 0.0021; n.elong = 3.0;
  n.ang = atan(dir.y, dir.x); n.angJit = 0.5; n.density = 0.75;
  n.tone = 0.82; n.seed = 83.0;
  claim(nuc, n, aWall * (1.0 - aLum) * 0.95);
}

// ================================================================ arrector pili muscle
void paintArrector(vec2 t, vec2 a, vec2 b, float halfW, float w, float stainE,
                   inout vec3 col, inout Nuc nuc) {
  float tt;
  float d = sdSegmentT(t, a, b, tt);
  if (d > halfW * 3.0) return;
  float taper = halfW * (0.72 + 0.55 * sin(3.1416 * tt));
  float a1 = cov(d - taper, max(w, 0.0008));
  if (a1 <= 0.003) return;
  vec2 dir = normalize(b - a);
  // Smooth muscle: brighter, more uniform eosin than collagen, with fine fibrillarity.
  float fib = vnoise(vec2(dot(t, dir) * 320.0, d * 900.0));
  vec3 c = mix(C_MUSCLE, C_EOSIN_DEEP, 0.28 + 0.30 * fib);
  c = bandMix(c, C_MUSCLE, 0.004, w);
  over(col, c, a1);
  Nuc n = nucNone();
  // Cigar-shaped, blunt-ended nuclei running with the fibre bundle.
  n.uv = t; n.spacing = 0.0215; n.radius = 0.0022; n.elong = 4.2;
  n.ang = atan(dir.y, dir.x); n.angJit = 0.35; n.density = 0.62;
  n.tone = 0.80; n.seed = 97.0;
  claim(nuc, n, a1);
}

// ================================================================ sebaceous gland
void paintSebaceous(vec2 t, vec2 centre, float R, float seed, float w, float stainE,
                    inout vec3 col, inout Nuc nuc) {
  vec2 d = t - centre;
  float rr = length(d);
  if (rr > R * 1.9) return;
  float ang = atan(d.y, d.x);
  // Several shallow lobules rather than one rounded triangle.
  float lobed = R * (1.0
      + 0.13 * sin(ang * 5.0 + seed)
      + 0.08 * sin(ang * 3.0 - seed * 1.7)
      + 0.14 * (fbm3(d * 11.0 + seed) - 0.5));
  float aLob = cov(rr - lobed, max(w, 0.0035));
  if (aLob <= 0.003) return;
  float rn = rr / max(lobed, 1e-5);

  // Maturing sebocytes: large, pale, multivacuolated; biggest at the centre.
  float edge; vec2 cid; float rnd;
  // Constant spacing: varying it with radius shreds the lattice into contour rings.
  const float cellSp = 0.0265;
  voronoi(t + seed, cellSp, 23.0 + seed, edge, cid, rnd);
  float border = cov(edge - 0.0018, max(w, 0.0005));

  // Lipid vacuoles give the cytoplasm its foamy, soap-bubble look.
  float vs = 0.0062;
  vec2 vgi = floor(t / vs);
  float vac = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 cell = vgi + vec2(float(i), float(j));
      vec3 h = hash32(cell + vec2(seed + 31.0, 5.0));
      if (h.z > 0.72) continue;
      vec2 c = (cell + 0.5 + (hash22(cell * 1.7 + seed) - 0.5) * 0.7) * vs;
      vac = max(vac, cov(length(t - c) - 0.00185 * (0.55 + 0.85 * h.x), max(w, 0.0005)));
    }
  }

  // Cells at the centre are the most distended with lipid; the periphery is denser.
  float mature = smoothstep(0.98, 0.30, rn);
  vec3 sebo = mix(C_CYTO_PALE, C_SEBUM, 0.25 + 0.50 * rnd * mature);
  sebo = mix(sebo, C_EOSIN_PALE, (1.0 - vac) * mix(0.70, 0.42, mature));
  sebo = mix(sebo, C_SEBUM, vac * 0.55 * legible(0.0037, w));
  sebo = mix(sebo, mix(C_EOSIN_MID, C_HEMA_PALE, 0.20), border * 0.62);
  sebo = bandMix(sebo, mix(C_SEBUM, C_EOSIN_PALE, 0.42), cellSp * 0.40, w);

  // Peripheral germinative cells: small, dark, a single layer around the lobule.
  float aBasal = smoothstep(0.82, 0.97, rn);
  vec3 basalC = mix(C_CYTO_EPI, C_EOSIN_MID, 0.42 * stainE);
  over(col, mix(sebo, basalC, aBasal), aLob);

  Nuc nSeb = nucNone();
  // One small central nucleus per big pale cell — the signature of a sebocyte.
  nSeb.uv = t + seed; nSeb.spacing = cellSp; nSeb.radius = 0.0037; nSeb.elong = 1.08;
  nSeb.ang = 0.0; nSeb.angJit = 3.14; nSeb.density = 0.95; nSeb.tone = 0.88; nSeb.seed = 41.0 + seed;
  claim(nuc, nSeb, aLob * (1.0 - aBasal));

  Nuc nBas = nucNone();
  nBas.uv = vec2(ang * R, rr); nBas.spacing = 0.0102; nBas.radius = 0.0029; nBas.elong = 1.5;
  nBas.ang = 1.5708; nBas.angJit = 0.7; nBas.density = 0.92; nBas.tone = 0.92; nBas.seed = 43.0 + seed;
  claim(nuc, nBas, aLob * aBasal);
}

/** The sebaceous duct: squamous-lined, opening into the follicular infundibulum. */
void paintSebDuct(vec2 t, vec2 a, vec2 b, float w, float stainE,
                  inout vec3 col, inout Nuc nuc) {
  float tt;
  float d = sdSegmentT(t, a, b, tt);
  if (d > 0.045) return;
  float ro = 0.026 * (1.0 + 0.18 * (vnoise(vec2(tt * 12.0, 3.0)) - 0.5));
  float aD = cov(d - ro, max(w, 0.0008));
  if (aD <= 0.003) return;
  float aLum = cov(d - ro * 0.42, max(w, 0.0006));
  over(col, mix(C_CYTO_EPI, C_EOSIN_PALE, 0.35), aD);
  over(col, mix(C_KERATIN, C_SEBUM, 0.45), aLum * 0.9);
  vec2 dir = normalize(b - a);
  Nuc n = nucNone();
  n.uv = vec2(tt * length(b - a), d); n.spacing = 0.0120; n.radius = 0.0030; n.elong = 1.6;
  n.ang = 0.0; n.angJit = 0.8; n.density = 0.88; n.tone = 0.80; n.seed = 47.0;
  claim(nuc, n, aD * (1.0 - aLum));
}
`;

export const TISSUE_EPIDERMIS_GLSL = /* glsl */ `
// ================================================================ epidermis
void paintEpidermis(vec2 t, float w, float focusZ, float na, float stainE,
                    inout vec3 col, inout Nuc nuc) {
  float sy = surfaceY(t.x);
  float dep = t.y - sy;
  float th = epiThickness(t.x);
  if (dep < -0.05 || dep > th + 0.05) return;

  float cor = corneumThickness(t.x);
  float aEpi = cov(max(-dep, dep - th), max(w, 0.0008));
  if (aEpi <= 0.003) return;

  float wCorn = cov(dep - cor, max(w, 0.0008));
  float granTop = cor;
  float granBot = cor + 0.0115;
  float wGran = cov(max(granTop - dep, dep - granBot), max(w, 0.0007));
  float basalTop = th - 0.0125;
  float wBasal = cov(max(basalTop - dep, dep - th), max(w, 0.0007));
  float wSpin = clamp(1.0 - wCorn - wGran - wBasal, 0.0, 1.0);

  // --- stratum corneum: anucleate, basket-weave laminae, slightly detached ---
  float lamPhase = dep / 0.0034 + 1.6 * fbm3(vec2(t.x * 22.0, 2.0));
  float lam = 0.5 + 0.5 * sin(lamPhase * 6.2831853);
  float weave2 = 0.5 + 0.5 * sin(t.x * 780.0 + lamPhase * 2.1);
  vec3 cCorn = mix(C_KERATIN, C_KERATIN_D, 0.22 + 0.50 * lam + 0.12 * weave2);
  cCorn = bandMix(cCorn, mix(C_KERATIN, C_KERATIN_D, 0.5), 0.0034, w);
  // Fine clefts between the laminae read as the classic basket weave.
  float cleft = cov(abs(fract(lamPhase) - 0.5) - 0.13, max(w, 0.0004));
  cCorn = mix(cCorn, mix(C_KERATIN, C_GLASS, 0.62), cleft * 0.50 * legible(0.0012, w));

  // --- granular layer: keratohyalin granules, coarse and deeply basophilic ---
  vec3 cGran = mix(C_CYTO_EPI, C_EOSIN_MID, 0.22 * stainE);
  float gsp = 0.0042;
  vec2 ggi = floor(t / gsp);
  float gr = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 cell = ggi + vec2(float(i), float(j));
      vec3 h = hash32(cell + vec2(3.9, 8.2));
      if (h.z > 0.55) continue;
      vec2 c = (cell + 0.5 + (hash22(cell * 1.9) - 0.5) * 0.8) * gsp;
      gr = max(gr, cov(length(t - c) - 0.00075 * (0.7 + 0.7 * h.x), max(w, 0.0004)));
    }
  }
  cGran = mix(cGran, C_HEMA * 0.95, gr * 0.75 * legible(0.0015, w));

  // --- spinous layer: polygonal keratinocytes with visible intercellular bridges ---
  float edge; vec2 cid; float rnd;
  voronoi(t, 0.0135, 5.0, edge, cid, rnd);
  float border = cov(edge - 0.0011, max(w, 0.0004));
  vec3 cSpin = mix(C_CYTO_EPI, C_EOSIN_PALE, 0.35 + 0.25 * rnd);
  cSpin = mix(cSpin, mix(C_EOSIN_MID, C_CYTO_EPI, 0.5), border * 0.55);
  cSpin = bandMix(cSpin, C_CYTO_EPI, 0.0135, w);

  // --- basal layer: more basophilic cytoplasm, fine supranuclear melanin caps ---
  vec3 cBasal = mix(C_CYTO_EPI, C_HEMA_PALE, 0.22 * stainE);
  float mel = fbm3(t * 900.0);
  cBasal = mix(cBasal, C_MELANIN, smoothstep(0.62, 0.86, mel) * 0.30 * legible(0.0010, w));

  vec3 c = cCorn * wCorn + cGran * wGran + cSpin * wSpin + cBasal * wBasal;
  over(col, c, aEpi);

  // Nuclei live in a warped band that follows the rete ridges rather than the surface.
  float vNorm = (dep - cor) / max(th - cor, 1e-4) * 0.070;
  vec2 uv = vec2(t.x, vNorm);

  Nuc nSpin = nucNone();
  nSpin.uv = uv; nSpin.spacing = 0.0132; nSpin.radius = 0.0034; nSpin.elong = 1.25;
  nSpin.ang = 0.3; nSpin.angJit = 3.14; nSpin.density = 0.88; nSpin.tone = 0.70; nSpin.seed = 11.0;
  claim(nuc, nSpin, aEpi * wSpin);

  Nuc nGran = nucNone();
  nGran.uv = uv; nGran.spacing = 0.0150; nGran.radius = 0.0027; nGran.elong = 2.6;
  nGran.ang = 0.0; nGran.angJit = 0.35; nGran.density = 0.70; nGran.tone = 0.78; nGran.seed = 13.0;
  claim(nuc, nGran, aEpi * wGran);

  Nuc nBas = nucNone();
  // Palisaded: oval nuclei standing perpendicular to the basement membrane.
  nBas.uv = uv; nBas.spacing = 0.0104; nBas.radius = 0.0033; nBas.elong = 1.95;
  nBas.ang = 1.5708; nBas.angJit = 0.45; nBas.density = 0.95; nBas.tone = 0.94; nBas.seed = 17.0;
  claim(nuc, nBas, aEpi * wBasal);

  // Stratum corneum has no nuclei at all — that absence is itself a landmark.
  Nuc nNone = nucNone();
  claim(nuc, nNone, aEpi * wCorn * 1.02);
}
`;

export const TISSUE_FOLLICLE_GLSL = /* glsl */ `
// ================================================================ hair follicle
/**
 * The hero anchor. Painted last of the epithelial structures so its concentric
 * layers stay crisp: fibrous root sheath, glassy membrane, outer root sheath,
 * inner root sheath, and the pigmented hair shaft at the centre.
 */
void paintFollicle(vec2 t, float s, float r, float w, float focusZ, float na,
                   float stainE, float stainH, inout vec3 col, inout Nuc nuc) {
  float ro = folOuterR(s);
  float ar = abs(r);
  if (s < -0.10 || s > FOL_LEN + 0.25 || ar > ro + 0.06) return;

  vec2 tng = normalize(folAxisDir() + folAxisNrm() * (2.0 * FOL_CURVE * s));
  float sSoft = max(w, 0.0006);

  // Round the deep end so the bulb finishes as a dome rather than a cut-off box.
  float overrun = max(s - (FOL_LEN - 0.06), 0.0);
  ar = length(vec2(overrun, r));
  float aRun = cov(-(s + 0.02), sSoft * 4.0);

  // ---- fibrous (connective tissue) root sheath, just outside the epithelium ----
  float aSheath = cov(ar - (ro + 0.019), max(w, 0.0009)) * aRun;
  if (aSheath > 0.003) {
    float ring = 0.5 + 0.5 * sin(ar / 0.0042 * 6.2831853 + 2.0 * fbm3(vec2(s * 30.0, 1.0)));
    vec3 c = mix(C_EOSIN_PALE, C_EOSIN_DEEP, (0.35 + 0.42 * ring) * stainE);
    c = bandMix(c, mix(C_EOSIN_PALE, C_EOSIN_DEEP, 0.55 * stainE), 0.0042, w);
    over(col, c, aSheath * cov(-(ar - ro - 0.0005), max(w, 0.0009)));
    Nuc n = nucNone();
    n.uv = vec2(s, ar); n.spacing = 0.0165; n.radius = 0.0021; n.elong = 3.6;
    n.ang = 0.0; n.angJit = 0.3; n.density = 0.72; n.tone = 0.80; n.seed = 71.0;
    claim(nuc, n, aSheath * cov(-(ar - ro - 0.0005), max(w, 0.0009)) * 0.98);
  }

  float aEpith = cov(ar - ro, max(w, 0.0008)) * aRun;
  if (aEpith <= 0.003) return;

  bool infundibulum = s < FOL_SEB_S;
  float infundW = 1.0 - smoothstep(FOL_SEB_S - 0.09, FOL_SEB_S + 0.09, s);
  float bulbW = smoothstep(FOL_LEN - 0.62, FOL_LEN - 0.20, s);

  float shaftR = folShaftR(s) * (1.0 - bulbW * 0.85);
  float irsT = 0.0195 * (1.0 - infundW) * (1.0 - bulbW * 0.5);
  // Several cells thick, which is what lets the 40x frame resolve rows of nuclei.
  float orsT = mix(0.030, 0.044, smoothstep(0.6, 2.4, s));

  // Layer boundaries measured inward from the outer surface of the epithelium.
  // Measured outward from the shaft, so the layers always meet: shaft -> cuticle ->
  // inner root sheath -> outer root sheath -> glassy membrane -> fibrous sheath.
  float rGlassy = ro - 0.0035;
  float rIRS = shaftR * 1.04;
  float rORS = min(rGlassy - 0.010, rIRS + irsT);

  // ---- glassy (vitreous) membrane: a thin pale eosinophilic band, PAS-bright ----
  float aGlassy = cov(max(rGlassy - ar, ar - ro), max(w, 0.0005)) * (1.0 - infundW * 0.7);
  over(col, mix(C_EOSIN_PALE, C_CYTO_PALE, 0.5), aGlassy * 0.9);

  // ---- outer root sheath: pale, glycogen-rich, distinct cell borders ----
  float aORS = cov(max(rORS - ar, ar - rGlassy), max(w, 0.0006));
  if (aORS > 0.003) {
    float edge; vec2 cid; float rnd;
    voronoi(vec2(s, r) * vec2(1.0, 1.0), 0.0145, 29.0, edge, cid, rnd);
    float border = cov(edge - 0.0016, max(w, 0.0004));
    // Glycogen-rich clear cells: very pale cytoplasm with crisp cell outlines.
    vec3 c = mix(C_CYTO_PALE, C_CYTO_EPI, 0.22 + 0.38 * rnd);
    c = mix(c, mix(C_EOSIN_MID, C_HEMA_PALE, 0.30), border * 0.42);
    c = bandMix(c, mix(C_CYTO_PALE, C_CYTO_EPI, 0.35), 0.0145, w);
    over(col, c, aORS);
    Nuc n = nucNone();
    // Rows follow the follicle wall: this is what makes the 40x frame readable.
    n.uv = vec2(s, r); n.spacing = 0.0132; n.radius = 0.0031; n.elong = 1.45;
    n.ang = 0.0; n.angJit = 1.3; n.density = 0.88; n.tone = 0.56; n.seed = 73.0;
    claim(nuc, n, aORS);
  }

  // ---- inner root sheath: vividly eosinophilic trichohyalin, largely anucleate ----
  float aIRS = cov(max(rIRS - ar, ar - rORS), max(w, 0.0005)) * (1.0 - infundW);
  if (aIRS > 0.003) {
    // Trichohyalin granules make the inner root sheath coarsely mottled.
    float gran = 0.55 * vnoise(vec2(s, r) * 290.0) + 0.45 * vnoise(vec2(s, r) * 680.0 + 4.0);
    vec3 c = mix(mix(C_IRS, C_EOSIN_PALE, 0.42), C_EOSIN_DEEP, 0.10 + 0.62 * gran);
    c = bandMix(c, mix(C_IRS, C_EOSIN_MID, 0.55), 0.0034, w);
    over(col, c, aIRS);
    Nuc n = nucNone();
    n.uv = vec2(s, r); n.spacing = 0.0115; n.radius = 0.0024; n.elong = 1.7;
    n.ang = 0.0; n.angJit = 0.9; n.density = 0.42; n.tone = 0.55; n.seed = 79.0;
    claim(nuc, n, aIRS);
  }

  // ---- infundibulum: lined by ordinary epidermis, keratin flakes in the lumen ----
  if (infundW > 0.004) {
    float depth = ro - ar;                    // depth into the wall from the lumen
    float wallT = ro - max(shaftR, 0.012);
    float u = clamp(depth / max(wallT, 1e-4), 0.0, 1.0);
    float aKer = cov(ar - (shaftR + 0.030 * (1.0 - u)), max(w, 0.0008));
    float flake = 0.5 + 0.5 * sin(ar / 0.0040 * 6.2831853 + 2.5 * fbm3(vec2(s * 40.0, 6.0)));
    vec3 cKer = mix(C_KERATIN, C_KERATIN_D, 0.25 + 0.45 * flake);
    vec3 cWall = mix(C_CYTO_EPI, C_EOSIN_PALE, 0.4);
    float lumen = cov(ar - (shaftR + 0.026), max(w, 0.0008));
    over(col, mix(cWall, cKer, lumen), aEpith * infundW);
    Nuc n = nucNone();
    n.uv = vec2(s, r * 3.0); n.spacing = 0.0135; n.radius = 0.0033; n.elong = 1.35;
    n.ang = 1.5708; n.angJit = 1.4; n.density = 0.86; n.tone = 0.76; n.seed = 89.0;
    claim(nuc, n, aEpith * infundW * (1.0 - lumen) * 0.99);
    Nuc nk = nucNone();
    claim(nuc, nk, aEpith * infundW * lumen * 1.01);
  }

  // ---- hair bulb: matrix cells and dermal papilla ----
  if (bulbW > 0.004) {
    float aMatrix = cov(ar - (ro - 0.010), max(w, 0.0008)) * bulbW;
    vec3 c = mix(C_CYTO_EPI, C_HEMA_PALE, 0.30 * stainH);
    over(col, c, aMatrix);
    Nuc n = nucNone();
    // Densely packed, deeply basophilic — the most cellular thing in the section.
    n.uv = vec2(s, r); n.spacing = 0.0102; n.radius = 0.0033; n.elong = 1.45;
    n.ang = 0.3; n.angJit = 3.14; n.density = 0.94; n.tone = 0.90; n.seed = 101.0;
    claim(nuc, n, aMatrix);

    vec2 papC = folPoint(FOL_LEN - 0.030);
    float dp = length(t - papC) - 0.068 * (1.0 + 0.10 * (fbm3(t * 22.0) - 0.5));
    float aPap = cov(dp, max(w, 0.0012)) * bulbW;
    vec3 cp = mix(C_EOSIN_PALE, C_EOSIN_MID, 0.55 * stainE);
    over(col, cp, aPap);
    Nuc np = nucNone();
    np.uv = t; np.spacing = 0.0140; np.radius = 0.0022; np.elong = 2.6;
    np.ang = 0.7; np.angJit = 2.0; np.density = 0.70; np.tone = 0.80; np.seed = 103.0;
    claim(nuc, np, aPap);

    // Melanin from the matrix melanocytes, sitting above the papilla.
    float mel = smoothstep(0.55, 0.85, fbm3(t * 1400.0));
    over(col, C_MELANIN, mel * aMatrix * 0.35 * legible(0.0008, w));
  }

  // ---- hair shaft: cortex plus a discontinuous medulla ----
  float aShaft = cov(ar - shaftR, max(w, 0.0005)) * (1.0 - bulbW * 0.92);
  if (aShaft > 0.003) {
    // Longitudinal melanin striae in the cortex; the shaft is never a flat brown bar.
    float striae = 0.6 * vnoise(vec2(s * 190.0, r * 900.0)) + 0.4 * vnoise(vec2(s * 420.0, r * 2100.0));
    float pig = 0.5 * vnoise(vec2(s, r) * 210.0) + 0.5 * vnoise(vec2(s, r) * 540.0 + 3.0);
    vec3 c = mix(C_HAIR, C_HAIR_DARK, 0.12 + 0.80 * pig);
    c = mix(c, C_HAIR_DARK * 0.78, smoothstep(0.45, 0.85, striae) * 0.55);
    c = mix(c, mix(C_HAIR, C_KERATIN_D, 0.55), smoothstep(0.55, 0.18, striae) * 0.30);
    c = bandMix(c, mix(C_HAIR, C_HAIR_DARK, 0.52), 0.0030, w);
    // The medulla is a discontinuous core of loosely packed cells, often air-filled
    // and therefore darker than the cortex around it.
    float med = cov(ar - shaftR * (0.20 + 0.09 * vnoise(vec2(s * 26.0, 2.0))), max(w, 0.0005));
    med *= smoothstep(0.40, 0.62, vnoise(vec2(s * 14.0, 0.5)));
    float medGrain = vnoise(vec2(s * 700.0, r * 900.0));
    c = mix(c, mix(C_HAIR_DARK * 0.72, C_KERATIN_D, 0.22 + 0.45 * medGrain), med * 0.72);

    // Cuticle: overlapping keratin scales, a thin bright rim with a stepped edge.
    float scale = 0.5 + 0.5 * sin(s * 240.0 + 1.6 * vnoise(vec2(s * 90.0, 5.0)));
    float cut = smoothstep(shaftR * 0.80, shaftR * 0.99, ar);
    c = mix(c, mix(C_KERATIN_D, C_HAIR, 0.30 + 0.34 * scale),
            cut * 0.55 * legible(0.0022, w));
    over(col, c, aShaft);
    Nuc n = nucNone();
    claim(nuc, n, aShaft * 1.05);   // fully keratinised: no nuclei
  }
}
`;

export const TISSUE_MAIN_GLSL = /* glsl */ `
// ================================================================ small oblique follicles
/** Neighbouring follicles cut across their axis — context, not competition. */
void paintMiniFollicle(vec2 t, vec2 c, float R, float ang, float seed,
                       float w, float stainE, inout vec3 col, inout Nuc nuc) {
  vec2 d = t - c;
  if (dot(d, d) > R * R * 4.0) return;
  vec2 u = vec2(cos(ang), sin(ang));
  vec2 v = vec2(-u.y, u.x);
  vec2 q = vec2(dot(d, u) / 1.45, dot(d, v));
  float rr = length(q) * (1.0 + 0.10 * (fbm3(d * 12.0 + seed) - 0.5));

  float aSheath = cov(rr - R * 1.22, max(w, 0.0010));
  over(col, mix(C_EOSIN_PALE, C_EOSIN_DEEP, 0.5 * stainE), aSheath * cov(-(rr - R), max(w, 0.0010)));

  float aOut = cov(rr - R, max(w, 0.0008));
  if (aOut <= 0.003) return;
  float aIRS = cov(rr - R * 0.55, max(w, 0.0006));
  float aShaft = cov(rr - R * 0.30, max(w, 0.0005));

  vec3 cOrs = mix(C_CYTO_PALE, C_CYTO_EPI, 0.42);
  over(col, cOrs, aOut);
  over(col, mix(C_IRS, C_EOSIN_DEEP, 0.35), aIRS);
  over(col, mix(C_HAIR, C_HAIR_DARK, 0.6), aShaft);

  Nuc n = nucNone();
  n.uv = vec2(atan(q.y, q.x) * R, rr);
  n.spacing = 0.0125; n.radius = 0.0033; n.elong = 1.4;
  n.ang = 1.5708; n.angJit = 1.0; n.density = 0.9; n.tone = 0.66; n.seed = 107.0 + seed;
  claim(nuc, n, aOut * (1.0 - aIRS));
  Nuc nk = nucNone();
  claim(nuc, nk, aShaft * 1.05);
}

// ================================================================ MAIN
/**
 * The complete section at a point.
 *   t        TISSUE-frame millimetres
 *   texel    size of one output texel in mm  (the level being generated)
 *   optRes   objective resolution limit in mm (0.61 * lambda / NA)
 *   focusZ   focal plane within the section, mm (0 = mid-section)
 *   na       numerical aperture, drives how fast out-of-plane detail softens
 */
vec3 heTissue(vec2 t, float texel, float optRes, float focusZ, float na) {
  // The effective resolution is whichever is worse: the texel grid or the optics.
  float w = max(texel * 0.58, optRes * 0.42);

  // Real slides are unevenly stained; a flat, perfectly uniform tint looks fake.
  float stainE = 0.86 + 0.30 * fbm3(t * 0.42 + vec2(9.2, 6.4));
  float stainH = 0.88 + 0.26 * fbm3(t * 0.55 + vec2(3.7, 1.1));

  vec3 col = C_GLASS;
  Nuc nuc = nucNone();

  float dSec = sectionSDF(t);
  float aSec = cov(dSec, max(w, 0.0035));
  if (aSec <= 0.002) {
    // Bare glass and mounting medium: not pure white, faintly uneven.
    float sheen = 0.012 * (fbm3(t * 0.9 + 40.0) - 0.5);
    return C_GLASS + vec3(sheen * 0.6, sheen, sheen * 1.1);
  }

  float s, r;
  follicleCoords(t, s, r);

  // ---------- dermal ground substance ----------
  float basalY = surfaceY(t.x) + epiThickness(t.x);
  float ddep = t.y - basalY;
  float coarse = smoothstep(0.06, 0.90, ddep);
  // Adventitial (perifollicular and periglandular) dermis stays fine and cellular.
  float perifol = exp(-max(abs(r) - folOuterR(s), 0.0) / 0.075)
                * smoothstep(-0.30, 0.05, s) * (1.0 - smoothstep(FOL_LEN - 0.10, FOL_LEN + 0.45, s));
  coarse *= 1.0 - 0.72 * perifol;

  // Two scales of orientation. One alone develops saddle points that read as wood
  // knots; the finer term keeps the weave locally coherent but globally irregular.
  float ang = 0.085 * (fbm3(t * 0.75) - 0.5) * 6.2831853
            + 0.055 * (fbm3(t * 3.30 + 51.0) - 0.5) * 6.2831853;
  vec2 tanF = normalize(folAxisDir() + folAxisNrm() * (2.0 * FOL_CURVE * s));
  ang = mix(ang, atan(tanF.y, tanF.x), perifol * 0.45);
  float bundle;
  col = collagen(t, ang, coarse, w, stainE, bundle);

  Nuc nFib = nucNone();
  // Fibroblasts: sparse, spindled, lying along the collagen.
  nFib.uv = t;
  // Papillary dermis is distinctly more cellular than reticular. At 4x these are
  // sub-pixel and read only as a speckle in the pink; by 10x they are spindles.
  nFib.spacing = mix(0.038, 0.066, coarse);
  nFib.radius = 0.0024; nFib.elong = 3.4;
  nFib.ang = ang; nFib.angJit = 0.9;
  nFib.density = mix(0.76, 0.54, coarse); nFib.tone = 0.82; nFib.seed = 3.0;
  claim(nuc, nFib, 0.55);

  // ---------- deep structures, painted outward from the subcutis ----------
  float fatTop = 5.05 + 0.42 * (fbm3(vec2(t.x * 0.85, 13.0)) - 0.45);
  paintFat(t, t.y - fatTop, w, stainE, col, nuc);
  paintEccrine(t, vec2(-1.95, 3.78), 0.40, w, focusZ, na, stainE, col, nuc);
  paintEccrine(t, vec2(2.35, 4.16), 0.33, w, focusZ, na, stainE, col, nuc);

  // Superficial and deep vascular plexus, plus the perifollicular landmark venule.
  paintVessel(t, vec2(-1.70, 0.44), vec2(-0.42, 0.50), 0.0105, 0.0065, 0.55, w, focusZ, na, stainE, col, nuc);
  paintVessel(t, vec2(0.92, 0.41), vec2(2.30, 0.49), 0.0090, 0.0060, 0.40, w, focusZ, na, stainE, col, nuc);
  paintVessel(t, vec2(0.452, 1.276), vec2(0.504, 1.422), 0.0128, 0.0080, 0.72, w, focusZ, na, stainE, col, nuc);
  paintVessel(t, vec2(-2.60, 3.30), vec2(-0.30, 3.52), 0.0165, 0.0090, 0.62, w, focusZ, na, stainE, col, nuc);
  paintVessel(t, vec2(1.10, 3.44), vec2(3.40, 3.20), 0.0150, 0.0085, 0.50, w, focusZ, na, stainE, col, nuc);
  paintVessel(t, vec2(-0.62, 1.66), vec2(-1.42, 2.34), 0.0072, 0.0050, 0.35, w, focusZ, na, stainE, col, nuc);

  paintArrector(t, vec2(0.18, 1.22), vec2(-1.05, 0.62), 0.030, w, stainE, col, nuc);

  paintMiniFollicle(t, vec2(-2.24, 1.86), 0.062, 0.5, 2.0, w, stainE, col, nuc);
  paintMiniFollicle(t, vec2(2.62, 1.48), 0.054, -0.9, 5.0, w, stainE, col, nuc);

  paintEpidermis(t, w, focusZ, na, stainE, col, nuc);

  paintSebaceous(t, vec2(-0.205, 0.505), 0.128, 0.0, w, stainE, col, nuc);
  paintSebaceous(t, vec2(-0.315, 0.760), 0.104, 1.7, w, stainE, col, nuc);
  paintSebaceous(t, vec2(0.395, 0.452), 0.085, 3.3, w, stainE, col, nuc);
  paintSebDuct(t, vec2(-0.150, 0.520), vec2(0.108, 0.542), w, stainE, col, nuc);

  paintFollicle(t, s, r, w, focusZ, na, stainE, stainH, col, nuc);

  // ---------- one nuclear pass, using whichever compartment owns this point ----------
  vec4 np = paintNuclei(nuc, w, focusZ, na, stainH);
  over(col, np.rgb, np.a);

  // ---------- section artefacts: present, but only just ----------
  // A shallow fold where the ribbon did not flatten perfectly.
  float foldWave = 0.16 * (fbm3(vec2(t.x * 1.1, 3.0)) - 0.5) + 0.05 * (vnoise(vec2(t.x * 5.0, 8.0)) - 0.5);
  float fd = (dot(t, vec2(0.42, 0.91)) - 2.55 + foldWave) / (0.040 + 0.030 * vnoise(vec2(t.x * 2.0, 1.0)));
  float fold = exp(-fd * fd) * smoothstep(-1.2, 0.6, t.x) * (1.0 - smoothstep(2.2, 4.0, t.x));
  col = mix(col, col * 0.93, fold * 0.42);
  // Faint knife chatter, perpendicular to the cutting direction.
  float chatter = 0.5 + 0.5 * sin(dot(t, vec2(0.995, 0.10)) * 210.0);
  col *= 1.0 - 0.014 * chatter * legible(0.0075, w);
  // Slight thickness variation across the ribbon.
  col *= 1.0 - 0.045 * (fbm3(t * 0.32 + 71.0) - 0.5);

  // Feathered edge where the section meets bare glass.
  float sheen = 0.012 * (fbm3(t * 0.9 + 40.0) - 0.5);
  vec3 glass = C_GLASS + vec3(sheen * 0.6, sheen, sheen * 1.1);
  return mix(glass, col, aSec);
}
`;

export const TISSUE_COVERAGE_GLSL = /* glsl */ `
/** Coverage of the section itself, so the 3D slide can show bare glass around it. */
float heTissueCoverage(vec2 t, float texel) {
  return cov(sectionSDF(t), max(texel * 0.58, 0.0035));
}
`;

/** The whole model, ready to append to a fragment shader. */
export const TISSUE_MODEL_GLSL =
  TISSUE_NOISE_GLSL +
  TISSUE_GEOMETRY_GLSL +
  TISSUE_NUCLEI_GLSL +
  TISSUE_STRUCTURES_GLSL +
  TISSUE_EPIDERMIS_GLSL +
  TISSUE_FOLLICLE_GLSL +
  TISSUE_MAIN_GLSL +
  TISSUE_COVERAGE_GLSL;
