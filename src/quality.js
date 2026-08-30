/**
 * Device tiering.
 *
 * The baseline target is WebGL2: everything the game needs to read (glass,
 * heat, flame, mirror, glitter) must survive on the "low" tier. WebGPU is
 * never required and is never used as a renderer here — its presence is only
 * read as one hint that the device has a modern GPU stack, and it can only
 * add quality (resolution, shadow size, particle counts).
 */
export function detectQuality() {
  // ?tier=low|mid|high forces a preset (QA on a desktop, or a rescue hatch)
  const forced = new URLSearchParams(location.search).get('tier');
  const dpr = window.devicePixelRatio || 1;
  const mem = navigator.deviceMemory || 4;
  const cores = navigator.hardwareConcurrency || 4;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const webgpuHint = typeof navigator !== 'undefined' && 'gpu' in navigator;

  let score = 0;
  score += cores >= 8 ? 2 : cores >= 6 ? 1 : 0;
  score += mem >= 8 ? 2 : mem >= 4 ? 1 : 0;
  score += coarse ? 0 : 1;
  score += webgpuHint ? 1 : 0; // extra quality only, never a requirement

  let tier = score >= 5 ? 'high' : score >= 3 ? 'mid' : 'low';
  if (forced === 'low' || forced === 'mid' || forced === 'high') tier = forced;

  const presets = {
    low: {
      maxPixelRatio: 1.3, transmissionScale: 0.4, shadows: false, shadowSize: 512,
      lathe: { rings: 40, contour: 84 }, glitter: 90, snow: 90, sparks: 28, flameLayers: 3,
    },
    mid: {
      maxPixelRatio: 1.7, transmissionScale: 0.55, shadows: true, shadowSize: 1024,
      lathe: { rings: 56, contour: 104 }, glitter: 150, snow: 150, sparks: 44, flameLayers: 4,
    },
    high: {
      maxPixelRatio: 2.0, transmissionScale: 0.8, shadows: true, shadowSize: 2048,
      lathe: { rings: 72, contour: 128 }, glitter: 240, snow: 220, sparks: 64, flameLayers: 5,
    },
  };

  return { tier, dpr, coarse, webgpuHint, ...presets[tier] };
}
