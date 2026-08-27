// Hydro Powerhouse end-to-end verification.
//
// Usage:
//   node tools/verify.mjs
//   node tools/verify.mjs 480 800 --destination train
//   node tools/verify.mjs --width 834 --height 1194 --destination city \
//     --base-url http://localhost:8341/index.html --out shots/portrait
//
// Environment:
//   PLAYWRIGHT_CHROMIUM_PATH=/absolute/path/to/chromium
//   HYDRO_BASE_URL=http://localhost:8341/index.html

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright-core';

const DESTINATIONS = ['lighthouse', 'train', 'city'];
const EXPECTED_PHASES = [
  'chooseDestination',
  'runner',
  'stator',
  'fluids',
  'casing',
  'gate',
  'generation',
  'complete',
];
const MAX_CALLS = 560;
const MAX_TRIANGLES = 1_400_000;
const MIN_FPS = 30;
const MAX_P95_MS = 40;
const MAX_SOFTWARE_P95_MS = 55;
const MAX_DPR = 1.5;
const SAFE_INSET = 8;
const MIN_HIT_SIZE = 44;

function parseArgs(argv) {
  const flags = new Map();
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const equalAt = arg.indexOf('=');
    if (equalAt >= 0) {
      flags.set(arg.slice(2, equalAt), arg.slice(equalAt + 1));
      continue;
    }
    const name = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags.set(name, next);
      i++;
    } else {
      flags.set(name, true);
    }
  }

  const width = Number(flags.get('width') ?? positional[0] ?? 1280);
  const height = Number(flags.get('height') ?? positional[1] ?? 800);
  const positionalThird = positional[2];
  const normalizedThird = normalizeDestination(positionalThird);
  const positionalDestination = DESTINATIONS.includes(normalizedThird) ? normalizedThird : undefined;
  const destination = normalizeDestination(String(
    flags.get('destination') ?? flags.get('dest') ?? positionalDestination ?? 'lighthouse',
  ));
  const positionalOut = positionalThird && !positionalDestination ? positionalThird : positional[3];
  const baseUrl = String(
    flags.get('base-url')
      ?? flags.get('url')
      ?? process.env.HYDRO_BASE_URL
      ?? 'http://localhost:8341/index.html',
  );
  const outDir = path.resolve(String(
    flags.get('out')
      ?? flags.get('outdir')
      ?? positionalOut
      ?? `verify-${width}x${height}-${destination}`,
  ));

  if (!Number.isInteger(width) || width < 320 || width > 4096) {
    throw new Error(`Invalid viewport width: ${width}`);
  }
  if (!Number.isInteger(height) || height < 320 || height > 4096) {
    throw new Error(`Invalid viewport height: ${height}`);
  }
  if (!DESTINATIONS.includes(destination)) {
    throw new Error(`Invalid destination ${JSON.stringify(destination)}; use ${DESTINATIONS.join(', ')}`);
  }
  let parsedUrl;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    throw new Error(`Invalid base URL: ${baseUrl}`);
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error(`Base URL must use http(s): ${baseUrl}`);
  }
  return { width, height, destination, baseUrl: parsedUrl.href, outDir };
}

function normalizeDestination(value) {
  const destination = String(value ?? '').trim().toLowerCase();
  if (['town', 'ferris', 'ferriswheel', 'ferris-wheel'].includes(destination)) return 'city';
  return destination;
}

function locateChromium() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_PATH,
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    '/opt/pw-browsers/chromium-1200/chrome-linux/chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ].filter(Boolean);
  try {
    candidates.push(chromium.executablePath());
  } catch {
    // playwright-core may not know a bundled browser; the explicit list remains authoritative.
  }
  const found = [...new Set(candidates)].find((candidate) => fs.existsSync(candidate));
  if (found) return found;
  throw new Error(
    'No Chromium executable found. Set PLAYWRIGHT_CHROMIUM_PATH to a valid executable. '
      + `Checked:\n${[...new Set(candidates)].map((item) => `  - ${item}`).join('\n')}`,
  );
}

class VerifyError extends Error {
  constructor(message, details = undefined) {
    super(details === undefined ? message : `${message}: ${safeStringify(details)}`);
    this.name = 'VerifyError';
    this.details = details;
  }
}

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function check(condition, message, details = undefined) {
  if (!condition) throw new VerifyError(message, details);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function firstNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '' || typeof value === 'boolean') continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function firstBoolean(...values) {
  for (const value of values) {
    if (typeof value === 'boolean') return value;
  }
  return null;
}

function runnerStats(state) {
  const source = state?.runner || {};
  return {
    manualPlaced: firstNumber(source.manualPlaced, source.manual, state?.runnerManualPlaced),
    installed: firstNumber(source.installed, source.placed, source.count, state?.runnerInstalled),
    total: firstNumber(source.total, state?.runnerTotal),
    capacity: firstNumber(source.capacity, state?.runnerCapacity),
  };
}

function statorStats(state) {
  const source = state?.stator || {};
  return {
    manualPlaced: firstNumber(source.manualPlaced, source.manual, state?.statorManualPlaced),
    installed: firstNumber(source.installed, source.placed, source.count, state?.statorInstalled),
    total: firstNumber(source.total, state?.statorTotal),
    capacity: firstNumber(source.capacity, state?.statorCapacity),
  };
}

function fluidStats(state) {
  const source = state?.fluids || {};
  return {
    oilConnected: firstBoolean(source.oilConnected, state?.oilConnected),
    coolantConnected: firstBoolean(
      source.coolantConnected,
      source.coolingWaterConnected,
      source.waterConnected,
      state?.coolantConnected,
    ),
    oilLevel: firstNumber(source.oilLevel, source.lubricantLevel),
    coolantFlow: firstNumber(source.coolantFlow, source.waterFlow, source.coolingFlow),
    bubbles: firstNumber(source.bubbles, source.bubblesRemaining, source.bubbleCount),
  };
}

function casingStats(state) {
  const source = state?.casing || {};
  return {
    installed: firstBoolean(source.installed, source.complete, state?.casingInstalled),
    alignment: firstNumber(source.alignment, source.alignmentProgress),
  };
}

function gateOpening(state) {
  return firstNumber(state?.gate?.opening, state?.gate?.open, state?.gateOpening);
}

function turbineSpeed(state) {
  return firstNumber(
    state?.turbine?.speed,
    state?.turbine?.normalizedSpeed,
    state?.turbineSpeed,
    state?.generation?.turbineSpeed,
  );
}

function generationActive(state) {
  return firstBoolean(state?.generation?.active, state?.generating, state?.generationActive);
}

function transmissionReached(state) {
  return firstBoolean(
    state?.generation?.transmissionReached,
    state?.generation?.delivered,
    state?.generation?.pulseReached,
    state?.transmissionReached,
    state?.powerDelivered,
  );
}

function arrivedDestination(state) {
  return state?.generation?.arrivedDestination
    ?? state?.generation?.destination
    ?? state?.arrivedDestination
    ?? null;
}

function isComplete(state) {
  return state?.phase === 'complete'
    || firstBoolean(state?.complete, state?.final?.complete, state?.finalSceneComplete) === true;
}

function replayVisible(state) {
  return firstBoolean(state?.replayVisible, state?.final?.replayVisible);
}

function effectMap(state) {
  return state?.destinationEffects ?? state?.destinations ?? state?.generation?.destinationEffects ?? null;
}

function effectFor(state, destination) {
  const effects = effectMap(state);
  if (!effects || typeof effects !== 'object') return null;
  if (effects[destination]) return effects[destination];
  if (destination === 'city') return effects.town ?? effects.ferrisWheel ?? null;
  return null;
}

function effectEnergized(effect) {
  if (!effect) return null;
  return firstBoolean(effect.energized, effect.active, effect.powered, effect.lit);
}

function effectIntensity(effect) {
  if (!effect) return null;
  return firstNumber(effect.intensity, effect.brightness, effect.power, effect.level);
}

function effectMotion(effect) {
  if (!effect) return null;
  return firstNumber(effect.motion, effect.motionSpeed, effect.speed, effect.activity);
}

function normalizeRect(rect) {
  if (!rect || typeof rect !== 'object') return null;
  const x = firstNumber(rect.x, rect.left);
  const y = firstNumber(rect.y, rect.top);
  const width = firstNumber(rect.width, rect.right != null && x != null ? rect.right - x : null);
  const height = firstNumber(rect.height, rect.bottom != null && y != null ? rect.bottom - y : null);
  if ([x, y, width, height].some((value) => value === null)) return null;
  return { x, y, width, height };
}

function normalizeTarget(raw, index = 0) {
  check(raw && typeof raw === 'object', 'targets() returned a non-object entry', raw);
  const start = raw.start ?? raw.source ?? raw.from ?? {};
  const end = raw.end ?? raw.drop ?? raw.to ?? {};
  const x = firstNumber(raw.x, raw.startX, start.x);
  const y = firstNumber(raw.y, raw.startY, start.y);
  const dropX = firstNumber(raw.dropX, raw.endX, raw.targetX, end.x);
  const dropY = firstNumber(raw.dropY, raw.endY, raw.targetY, end.y);
  const action = String(
    raw.action
      ?? raw.kind
      ?? raw.gesture
      ?? (raw.drag ? 'drag' : raw.hold ? 'hold' : 'tap'),
  ).toLowerCase();
  const id = String(raw.id ?? raw.name ?? raw.role ?? `target-${index}`);
  return {
    raw,
    id,
    phase: raw.phase == null ? null : String(raw.phase),
    action,
    x,
    y,
    dropX,
    dropY,
    rect: normalizeRect(raw.rect ?? raw.bounds ?? raw.hitRect),
    dropRect: normalizeRect(raw.dropRect ?? raw.targetRect),
    holdMs: firstNumber(raw.holdMs, raw.durationMs),
    direction: raw.direction ?? null,
    destination: raw.destination ?? raw.value ?? null,
    enabled: raw.enabled !== false,
  };
}

function normalizedTargets(state) {
  return (Array.isArray(state?.targets) ? state.targets : []).map(normalizeTarget);
}

function targetDescription(target) {
  return {
    id: target.id,
    action: target.action,
    x: target.x,
    y: target.y,
    dropX: target.dropX,
    dropY: target.dropY,
    rect: target.rect,
    dropRect: target.dropRect,
    direction: target.direction,
    destination: target.destination,
  };
}

function idText(target) {
  return `${target.id} ${target.raw.role ?? ''} ${target.raw.type ?? ''}`.toLowerCase();
}

function assertCapacities(state) {
  for (const [name, stats] of [['runner', runnerStats(state)], ['stator', statorStats(state)]]) {
    if (stats.total === null) continue;
    check(stats.total >= 0, `${name} total is negative`, stats);
    check(stats.capacity !== null, `${name} capacity is missing`, stats);
    check(stats.capacity >= Math.ceil(stats.total * 1.2),
      `${name} capacity does not provide 20% headroom`, stats);
    if (stats.manualPlaced !== null) {
      check(stats.manualPlaced >= 0 && stats.manualPlaced <= stats.total
        && stats.manualPlaced <= stats.capacity,
        `${name} manual placement exceeded capacity`, stats);
    }
    if (stats.installed !== null) {
      check(stats.installed >= 0 && stats.installed <= stats.total
        && stats.installed <= stats.capacity,
        `${name} installed count exceeded capacity`, stats);
    }
    if (stats.manualPlaced !== null && stats.installed !== null) {
      check(stats.manualPlaced <= stats.installed,
        `${name} manual count exceeds installed count`, stats);
    }
  }
}

function assertValidationContracts(state) {
  const validation = state?.validation;
  check(validation && typeof validation === 'object', 'validation debug information is missing');
  check(Array.isArray(validation.layoutIssues), 'validation.layoutIssues must be an array', validation);
  check(Array.isArray(validation.assemblyIssues), 'validation.assemblyIssues must be an array', validation);
  check(Array.isArray(validation.worldIssues), 'validation.worldIssues must be an array', validation);
  check(validation.layoutIssues.length === 0, 'plant layout validation reported issues', validation.layoutIssues);
  check(validation.assemblyIssues.length === 0,
    'radial assembly validation reported issues', validation.assemblyIssues);
  check(validation.worldIssues.length === 0,
    'rendered-world spatial validation reported issues', validation.worldIssues);

  const layoutIssues = state?.layout?.validationIssues;
  check(Array.isArray(layoutIssues), 'layout.validationIssues must be an array', state?.layout);
  check(layoutIssues.length === 0, 'layout summary reported issues', layoutIssues);

  report.validation = {
    layoutIssues: [...validation.layoutIssues],
    assemblyIssues: [...validation.assemblyIssues],
    worldIssues: [...validation.worldIssues],
    layoutSummaryIssues: [...layoutIssues],
  };
}

function assertPointInFrame(point, label) {
  check(point && point.visible === true && point.inFrame === true,
    `${label} is not inside the authored camera frame`, point);
}

function assertCausalComposition(state, label) {
  const composition = state?.composition;
  check(composition?.landmarks, `${label} composition landmarks are missing`, composition);
  const { reservoir, turbine, generator, grid } = composition.landmarks;
  [
    ['reservoir', reservoir],
    ['turbine', turbine],
    ['generator', generator],
    ['grid', grid],
  ].forEach(([name, point]) => assertPointInFrame(point, `${label} ${name}`));
  if (composition.orientation === 'portrait') {
    check(reservoir.y + 24 < turbine.y,
      `${label} portrait reservoir is not above the turbine`, composition.landmarks);
    check(turbine.y + 8 < generator.y,
      `${label} portrait generator is not below the turbine`, composition.landmarks);
    check(generator.y + 24 < grid.y,
      `${label} portrait destination is not below the generator`, composition.landmarks);
  } else {
    check(reservoir.x + 40 < turbine.x,
      `${label} landscape reservoir is not left of the turbine`, composition.landmarks);
    check(turbine.x + 40 < grid.x,
      `${label} landscape destination is not right of the turbine`, composition.landmarks);
  }
}

function assertCasingComposition(state) {
  const points = state?.composition?.actionLandmarks;
  check(points, 'casing composition action landmarks are missing', state?.composition);
  for (const name of ['craneBridge', 'casingLoad', 'casingTarget']) {
    assertPointInFrame(points[name], `casing ${name}`);
  }
  check(points.craneBridge.y + 12 < points.casingLoad.y,
    'crane bridge is not visibly above its suspended load', points);
}

function assertFluidComposition(state, label, { requireCooling = true } = {}) {
  const points = state?.composition?.actionLandmarks;
  check(points, `${label} action landmarks are missing`, state?.composition);
  assertPointInFrame(points.oilGlass, `${label} oil site glass`);
  if (requireCooling) assertPointInFrame(points.coolingTube, `${label} cooling tube`);
}

function assertEffectsExclusive(state, selected, { requireMotion = true } = {}) {
  const effects = effectMap(state);
  check(effects && typeof effects === 'object', 'destinationEffects API is missing', effects);
  for (const destination of DESTINATIONS) {
    const effect = effectFor(state, destination);
    check(effect, `destination effect entry is missing for ${destination}`, effects);
    const energized = effectEnergized(effect);
    const intensity = effectIntensity(effect);
    const motion = effectMotion(effect);
    check(energized !== null, `${destination} energized flag is missing`, effect);
    check(intensity !== null, `${destination} intensity is missing`, effect);
    check(motion !== null, `${destination} motion value is missing`, effect);
    if (destination === selected) {
      check(energized === true, `${destination} was selected but is not energized`, effect);
      check(intensity > 0.05, `${destination} has no visible intensity`, effect);
      if (requireMotion) check(motion > 0, `${destination} has no final activity`, effect);
    } else {
      check(energized === false, `${destination} was not selected but is energized`, effect);
      check(Math.abs(intensity) <= 0.01, `${destination} was not selected but is lit`, effect);
      check(Math.abs(motion) <= 0.01, `${destination} was not selected but is moving`, effect);
    }
  }
}

function assertDestinationStageOrder(effect, destination, { complete = false } = {}) {
  const stages = effect?.stages;
  check(stages && typeof stages === 'object', `${destination} staged reward API is missing`, effect);
  const ordered = destination === 'lighthouse'
    ? [stages.lamp, stages.beam]
    : destination === 'train'
      ? [stages.station, stages.track, stages.vehicle]
      : [stages.firstHouse, stages.bridge, stages.wheel];
  check(ordered.every(Number.isFinite), `${destination} staged reward values are incomplete`, stages);
  for (let index = 1; index < ordered.length; index++) {
    check(ordered[index - 1] + .03 >= ordered[index],
      `${destination} reward stages activated out of order`, stages);
  }
  if (complete) {
    check(ordered.every((value) => value >= .92),
      `${destination} reward stages did not all finish`, stages);
    if (destination === 'city') {
      check(Number(stages.houses) >= .92, 'not all city homes finished lighting', stages);
    }
  }
  return ordered;
}

const config = parseArgs(process.argv.slice(2));
fs.mkdirSync(config.outDir, { recursive: true });

const report = {
  config: {
    ...config,
    outDir: config.outDir,
    thresholds: {
      calls: MAX_CALLS,
      triangles: MAX_TRIANGLES,
      fps: MIN_FPS,
      p95Ms: MAX_P95_MS,
      softwareP95Ms: MAX_SOFTWARE_P95_MS,
      dpr: MAX_DPR,
    },
  },
  startedAt: new Date().toISOString(),
  pass: false,
  phases: [],
  screenshots: [],
  checkpoints: [],
  rotation: null,
  audioAria: null,
  gateCausality: null,
  finalModulation: null,
  coolantBubbles: null,
  validation: null,
  camera: { maxLandscapeFov: 0, maxPortraitFov: 0, samples: 0 },
  rendererPeak: {
    calls: 0,
    triangles: 0,
    geometries: null,
    textures: null,
    drawingBufferWidth: null,
    drawingBufferHeight: null,
  },
  performance: null,
  consoleErrors: [],
  pageErrors: [],
  failedRequests: [],
  badResponses: [],
  externalRequests: [],
  error: null,
};

let browser;
let context;
let page;
let cdp;
let screenshotIndex = 0;
let lastState = null;

function recordPhase(phase) {
  if (!phase || report.phases.at(-1) === phase) return;
  report.phases.push(phase);
}

function updateRendererPeak(renderer) {
  if (!renderer) return;
  if (Number.isFinite(renderer.calls)) {
    report.rendererPeak.calls = Math.max(report.rendererPeak.calls, renderer.calls);
  }
  if (Number.isFinite(renderer.triangles)) {
    report.rendererPeak.triangles = Math.max(report.rendererPeak.triangles, renderer.triangles);
  }
  for (const key of ['geometries', 'textures', 'drawingBufferWidth', 'drawingBufferHeight']) {
    if (Number.isFinite(renderer[key])) {
      report.rendererPeak[key] = Math.max(report.rendererPeak[key] ?? 0, renderer[key]);
    }
  }
}

function validateCameraIfExposed(state) {
  const fov = firstNumber(state?.camera?.fov, state?.camera?.fieldOfView);
  if (fov === null) return;
  const portrait = state.viewport.visualHeight > state.viewport.visualWidth;
  const limit = portrait ? 56 : 52;
  check(fov <= limit + 0.1, `camera FOV exceeds the ${portrait ? 'portrait' : 'landscape'} budget`, {
    fov,
    limit,
    phase: state.phase,
    viewport: state.viewport,
  });
  const key = portrait ? 'maxPortraitFov' : 'maxLandscapeFov';
  report.camera[key] = Math.max(report.camera[key], fov);
  report.camera.samples++;

  const declared = typeof state.layout === 'string'
    ? state.layout
    : state.layout?.orientation ?? state.camera?.orientation ?? null;
  if (declared) {
    check(String(declared).toLowerCase() === (portrait ? 'portrait' : 'landscape'),
      'camera/layout orientation does not match the viewport', {
        declared,
        expected: portrait ? 'portrait' : 'landscape',
        phase: state.phase,
      });
  }
}

async function readState() {
  const state = await page.evaluate(() => {
    const hydro = window.__hydro;
    if (!hydro) return null;
    const clone = (value) => {
      if (value === undefined) return null;
      try {
        return JSON.parse(JSON.stringify(value));
      } catch {
        return null;
      }
    };
    let targets = [];
    try {
      targets = typeof hydro.targets === 'function' ? clone(hydro.targets()) : [];
    } catch (error) {
      targets = [{ __targetError: String(error) }];
    }
    const renderer = hydro.renderer;
    const rendererInfo = renderer ? {
      calls: renderer.info?.render?.calls ?? renderer.render?.calls ?? renderer.calls ?? null,
      triangles: renderer.info?.render?.triangles ?? renderer.render?.triangles ?? renderer.triangles ?? null,
      points: renderer.info?.render?.points ?? renderer.render?.points ?? renderer.points ?? null,
      lines: renderer.info?.render?.lines ?? renderer.render?.lines ?? renderer.lines ?? null,
      geometries: renderer.info?.memory?.geometries
        ?? renderer.memory?.geometries
        ?? renderer.geometries
        ?? null,
      textures: renderer.info?.memory?.textures
        ?? renderer.memory?.textures
        ?? renderer.textures
        ?? null,
      pixelRatio: typeof renderer.getPixelRatio === 'function'
        ? renderer.getPixelRatio()
        : renderer.pixelRatio ?? renderer.dpr ?? null,
      isWebGL2: renderer.capabilities?.isWebGL2
        ?? renderer.isWebGL2
        ?? renderer.webgl2
        ?? (Number(renderer.webglVersion) >= 2 ? true : null),
      drawingBufferWidth: renderer.domElement?.width
        ?? renderer.drawingBuffer?.width
        ?? renderer.drawingBufferWidth
        ?? null,
      drawingBufferHeight: renderer.domElement?.height
        ?? renderer.drawingBuffer?.height
        ?? renderer.drawingBufferHeight
        ?? null,
      canvasClientWidth: renderer.domElement?.clientWidth ?? renderer.canvasClientWidth ?? null,
      canvasClientHeight: renderer.domElement?.clientHeight ?? renderer.canvasClientHeight ?? null,
      backend: renderer.backend ?? null,
      rendererLabel: renderer.rendererLabel ?? null,
    } : null;
    return {
      phase: hydro.phase ?? null,
      busy: Boolean(hydro.busy),
      targets,
      selectedDestination: hydro.selectedDestination ?? hydro.destination ?? null,
      runner: clone(hydro.runner),
      stator: clone(hydro.stator),
      fluids: clone(hydro.fluids),
      casing: clone(hydro.casing),
      gate: clone(hydro.gate),
      turbine: clone(hydro.turbine),
      generation: clone(hydro.generation),
      destinationEffects: clone(hydro.destinationEffects ?? hydro.destinations),
      final: clone(hydro.final),
      complete: hydro.complete ?? hydro.finalSceneComplete ?? null,
      replayVisible: hydro.replayVisible ?? hydro.final?.replayVisible ?? null,
      audio: clone(hydro.audio),
      renderer: rendererInfo,
      camera: clone(hydro.camera),
      layout: clone(hydro.layout),
      validation: clone(hydro.validation),
      composition: clone(hydro.composition),
      diagnostics: clone(hydro.diagnostics),
      runnerManualPlaced: hydro.runnerManualPlaced ?? null,
      runnerInstalled: hydro.runnerInstalled ?? null,
      runnerTotal: hydro.runnerTotal ?? null,
      runnerCapacity: hydro.runnerCapacity ?? null,
      statorManualPlaced: hydro.statorManualPlaced ?? null,
      statorInstalled: hydro.statorInstalled ?? null,
      statorTotal: hydro.statorTotal ?? null,
      statorCapacity: hydro.statorCapacity ?? null,
      oilConnected: hydro.oilConnected ?? null,
      coolantConnected: hydro.coolantConnected ?? null,
      casingInstalled: hydro.casingInstalled ?? null,
      gateOpening: hydro.gateOpening ?? null,
      turbineSpeed: hydro.turbineSpeed ?? null,
      generating: hydro.generating ?? hydro.generationActive ?? null,
      transmissionReached: hydro.transmissionReached ?? hydro.powerDelivered ?? null,
      arrivedDestination: hydro.arrivedDestination ?? null,
      finalSceneComplete: hydro.finalSceneComplete ?? null,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        visualWidth: window.visualViewport?.width ?? window.innerWidth,
        visualHeight: window.visualViewport?.height ?? window.innerHeight,
      },
    };
  });
  if (state?.targets?.some((target) => target?.__targetError)) {
    throw new VerifyError('window.__hydro.targets() threw', state.targets);
  }
  if (state) {
    lastState = state;
    recordPhase(state.phase);
    updateRendererPeak(state.renderer);
    assertCapacities(state);
    validateCameraIfExposed(state);
  }
  return state;
}

function stateSummary(state) {
  if (!state) return null;
  return {
    phase: state.phase,
    busy: state.busy,
    selectedDestination: state.selectedDestination,
    runner: runnerStats(state),
    stator: statorStats(state),
    fluids: fluidStats(state),
    casing: casingStats(state),
    gateOpening: gateOpening(state),
    turbineSpeed: turbineSpeed(state),
    generationActive: generationActive(state),
    transmissionReached: transmissionReached(state),
    arrivedDestination: arrivedDestination(state),
    complete: isComplete(state),
    replayVisible: replayVisible(state),
    targetIds: normalizedTargets(state).map((target) => target.id),
    validation: state.validation,
    layoutValidationIssues: state.layout?.validationIssues ?? null,
    diagnostics: state.diagnostics,
    renderer: state.renderer,
    viewport: state.viewport,
  };
}

function checkpoint(label, state) {
  report.checkpoints.push({ label, atMs: Date.now() - startedAt, ...stateSummary(state) });
}

async function waitForState(predicate, label, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let state = null;
  let predicateError = null;
  while (Date.now() < deadline) {
    try {
      state = await readState();
    } catch (error) {
      const message = String(error?.message || error);
      if (/execution context was destroyed|navigation|frame was detached/i.test(message)) {
        await delay(100);
        continue;
      }
      throw error;
    }
    try {
      if (state && predicate(state)) return state;
      predicateError = null;
    } catch (error) {
      predicateError = error;
    }
    await delay(80);
  }
  throw new VerifyError(`Timed out waiting for ${label}`, {
    timeoutMs,
    predicateError: predicateError ? String(predicateError) : null,
    lastState: stateSummary(state),
  });
}

async function waitReadyPhase(phase, timeoutMs = 20_000) {
  return waitForState(
    (state) => state.phase === phase && state.busy === false,
    `ready phase ${phase}`,
    timeoutMs,
  );
}

function validatePoint(x, y, viewport, label) {
  check(Number.isFinite(x) && Number.isFinite(y), `${label} has invalid coordinates`, { x, y });
  check(
    x >= SAFE_INSET && x <= viewport.visualWidth - SAFE_INSET
      && y >= SAFE_INSET && y <= viewport.visualHeight - SAFE_INSET,
    `${label} is outside the safe viewport`, { x, y, viewport },
  );
}

function validateRect(rect, viewport, label, { requireHitSize = false } = {}) {
  check(rect.width > 0 && rect.height > 0, `${label} has an invalid rectangle`, rect);
  check(
    rect.x >= SAFE_INSET
      && rect.y >= SAFE_INSET
      && rect.x + rect.width <= viewport.visualWidth - SAFE_INSET
      && rect.y + rect.height <= viewport.visualHeight - SAFE_INSET,
    `${label} rectangle is clipped`, { rect, viewport },
  );
  if (requireHitSize) {
    check(
      rect.width >= MIN_HIT_SIZE && rect.height >= MIN_HIT_SIZE,
      `${label} hit area is smaller than ${MIN_HIT_SIZE}px`, rect,
    );
  }
}

function validateTargets(state, { requireTargets = true } = {}) {
  const targets = normalizedTargets(state).filter((target) => target.enabled);
  if (requireTargets) check(targets.length > 0, `No actionable targets in phase ${state.phase}`);
  for (const target of targets) {
    check(['tap', 'drag', 'hold'].includes(target.action), 'Unknown target action', targetDescription(target));
    validatePoint(target.x, target.y, state.viewport, `${target.id} start`);
    if (target.rect) validateRect(target.rect, state.viewport, `${target.id} start`, { requireHitSize: true });
    if (target.action === 'drag') {
      validatePoint(target.dropX, target.dropY, state.viewport, `${target.id} end`);
      if (target.dropRect) validateRect(target.dropRect, state.viewport, `${target.id} end`);
    }
  }
  return targets;
}

function findTarget(state, predicate, label) {
  const targets = validateTargets(state).filter((target) => target.enabled);
  const target = targets.find(predicate);
  check(target, `No target found for ${label}`, targets.map(targetDescription));
  return target;
}

async function touchEvent(type, x, y) {
  const ended = type === 'touchEnd' || type === 'touchCancel';
  const touchPoints = ended ? [] : [{
    x,
    y,
    id: 0,
    radiusX: 9,
    radiusY: 9,
    force: 1,
  }];
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
}

async function touchTap(x, y, durationMs = 90) {
  await touchEvent('touchStart', x, y);
  try {
    await delay(durationMs);
  } finally {
    await touchEvent('touchEnd', x, y);
  }
}

async function touchDrag(x, y, dropX, dropY, { steps = 14, stepMs = 34 } = {}) {
  await touchEvent('touchStart', x, y);
  try {
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const eased = t * t * (3 - 2 * t);
      await touchEvent(
        'touchMove',
        x + (dropX - x) * eased,
        y + (dropY - y) * eased,
      );
      await delay(stepMs);
    }
    await delay(70);
  } finally {
    await touchEvent('touchEnd', dropX, dropY);
  }
}

async function touchHold(x, y, holdMs) {
  await touchEvent('touchStart', x, y);
  try {
    await delay(holdMs);
  } finally {
    await touchEvent('touchEnd', x, y);
  }
}

async function performTarget(target, options = {}) {
  if (target.action === 'tap') {
    await touchTap(target.x, target.y, options.tapMs ?? 90);
    return;
  }
  if (target.action === 'drag') {
    await touchDrag(target.x, target.y, target.dropX, target.dropY, options);
    return;
  }
  if (target.action === 'hold') {
    await touchHold(target.x, target.y, options.holdMs ?? target.holdMs ?? 650);
    return;
  }
  throw new VerifyError('Unsupported target action', targetDescription(target));
}

async function tapLocator(locator, label) {
  await locator.waitFor({ state: 'visible', timeout: 10_000 });
  const box = await locator.boundingBox();
  check(box, `${label} has no bounding box`);
  const viewport = (await readState())?.viewport ?? {
    visualWidth: config.width,
    visualHeight: config.height,
  };
  validateRect(box, viewport, label, { requireHitSize: true });
  await touchTap(box.x + box.width / 2, box.y + box.height / 2);
}

async function screenshot(tag) {
  screenshotIndex++;
  const safeTag = tag.replace(/[^a-zA-Z0-9_-]+/g, '-');
  const filename = `${String(screenshotIndex).padStart(2, '0')}-${safeTag}.png`;
  const fullPath = path.join(config.outDir, filename);
  await page.screenshot({ path: fullPath, animations: 'allow' });
  report.screenshots.push(filename);
  return fullPath;
}

async function assertAudioToggle() {
  const toggle = page.locator('#audio-toggle');
  const before = await readState();
  check(before?.audio && typeof before.audio.muted === 'boolean', 'audio.muted API is missing', before?.audio);
  const beforePressed = await toggle.getAttribute('aria-pressed');
  const beforeLabel = await toggle.getAttribute('aria-label');
  check(beforePressed === String(before.audio.muted), 'initial audio aria-pressed is out of sync', {
    muted: before.audio.muted,
    pressed: beforePressed,
  });
  check(beforeLabel === (before.audio.muted ? 'おとを だす' : 'おとを けす'),
    'initial audio aria-label is out of sync', { muted: before.audio.muted, label: beforeLabel });

  await tapLocator(toggle, 'audio toggle');
  const toggled = await waitForState(
    (state) => state.audio?.muted === !before.audio.muted,
    'audio mute state to toggle',
    5_000,
  );
  const toggledPressed = await toggle.getAttribute('aria-pressed');
  const toggledLabel = await toggle.getAttribute('aria-label');
  check(toggledPressed === String(toggled.audio.muted), 'toggled audio aria-pressed is out of sync', {
    muted: toggled.audio.muted,
    pressed: toggledPressed,
  });
  check(toggledLabel === (toggled.audio.muted ? 'おとを だす' : 'おとを けす'),
    'toggled audio aria-label is out of sync', { muted: toggled.audio.muted, label: toggledLabel });

  await tapLocator(toggle, 'audio toggle');
  const restored = await waitForState(
    (state) => state.audio?.muted === before.audio.muted,
    'audio mute state to restore',
    5_000,
  );
  const restoredPressed = await toggle.getAttribute('aria-pressed');
  const restoredLabel = await toggle.getAttribute('aria-label');
  check(restoredPressed === String(restored.audio.muted), 'restored audio aria-pressed is out of sync');
  check(restoredLabel === (restored.audio.muted ? 'おとを だす' : 'おとを けす'),
    'restored audio aria-label is out of sync');

  report.audioAria = {
    before: { muted: before.audio.muted, pressed: beforePressed, label: beforeLabel },
    toggled: { muted: toggled.audio.muted, pressed: toggledPressed, label: toggledLabel },
    restored: { muted: restored.audio.muted, pressed: restoredPressed, label: restoredLabel },
  };
}

async function placeRepeated({
  phase,
  kind,
  stats,
  targetPredicate,
  minManual,
  maxManual,
  nextPhase,
  peakTag = null,
}) {
  let state = await waitReadyPhase(phase);
  await screenshot(`${phase}-start`);
  let operations = 0;
  while (state.phase === phase) {
    check(operations < maxManual, `${phase} required too many repeated manual actions`, {
      operations,
      stats: stats(state),
    });
    const before = stats(state);
    check(before.manualPlaced !== null && before.installed !== null && before.total !== null,
      `${phase} count API is incomplete`, before);
    const target = findTarget(
      state,
      (candidate) => candidate.action === 'drag' && targetPredicate(candidate),
      `${phase} drag`,
    );
    await performTarget(target);
    operations++;
    state = await waitForState((candidate) => {
      const after = stats(candidate);
      return candidate.phase !== phase
        || (after.manualPlaced !== null && after.manualPlaced > before.manualPlaced);
    }, `${phase} placement ${operations}`, 12_000);
    if (state.phase === phase) {
      const after = stats(state);
      // The child finishes the final manual placement before the helper's
      // deterministic completion animation. Input intentionally stays locked
      // during that payoff, so do not require another ready target here.
      if (after.manualPlaced >= minManual) {
        state = await waitForState(
          (candidate) => {
            const assisted = stats(candidate);
            return candidate.phase !== phase
              || (assisted.installed !== null
                && assisted.total !== null
                && assisted.installed === assisted.total);
          },
          `${phase} assisted assembly peak`,
          20_000,
        );
        if (peakTag) {
          const peak = stats(state);
          check(state.phase === phase && peak.installed === peak.total,
            `${phase} transitioned before its assembled peak could be captured`, {
              phase: state.phase,
              stats: peak,
            });
          if (kind === 'runner') {
            state = await waitForState(
              (candidate) => candidate.phase === 'runner'
                && Number(candidate.runner?.previewAngularSpeed) > .5,
              'assembled runner preview rotation to begin',
              8_000,
            );
            const beforeAngle = Number(state.runner?.rotationAngle);
            await delay(280);
            const moving = await readState();
            const afterAngle = Number(moving.runner?.rotationAngle);
            check(Number.isFinite(beforeAngle) && Number.isFinite(afterAngle)
              && Math.abs(afterAngle - beforeAngle) > .08,
            'assembled runner did not visibly rotate during its payoff', {
              beforeAngle,
              afterAngle,
              angularSpeed: moving.runner?.previewAngularSpeed,
            });
            report.runnerPreview = {
              beforeAngle,
              afterAngle,
              angularSpeed: moving.runner?.previewAngularSpeed,
            };
            state = moving;
          }
          checkpoint(peakTag, state);
          await screenshot(peakTag);
        }
        if (state.phase === phase) {
          state = await waitForState(
            (candidate) => candidate.phase !== phase,
            `${phase} transition after assisted assembly`,
            20_000,
          );
        }
        break;
      }
      state = await waitReadyPhase(phase, 12_000);
    }
  }
  state = await waitForState(
    (candidate) => candidate.phase === nextPhase && candidate.busy === false,
    `${phase} completion and ${nextPhase} readiness`,
    25_000,
  );
  const final = stats(state);
  check(final.manualPlaced >= minManual && final.manualPlaced <= maxManual,
    `${phase} manual count is outside the child-friendly contract`, final);
  check(final.installed === final.total, `${phase} deterministic auto-completion is incomplete`, final);
  checkpoint(`${phase}-complete`, state);
  await screenshot(`${phase}-complete`);
  return state;
}

async function rotateAndPreserve(state) {
  const before = {
    selectedDestination: state.selectedDestination,
    phase: state.phase,
    runner: runnerStats(state),
    stator: statorStats(state),
    fluids: fluidStats(state),
    casing: casingStats(state),
    gateOpening: gateOpening(state),
  };
  const rotated = config.width === config.height
    ? { width: Math.max(320, config.width - 100), height: config.height + 100 }
    : { width: config.height, height: config.width };
  await page.setViewportSize(rotated);
  await delay(300);
  const afterRotate = await waitForState(
    (candidate) => candidate.phase === before.phase && candidate.busy === false,
    'rotation to preserve current phase',
    12_000,
  );
  validateTargets(afterRotate);
  check(afterRotate.selectedDestination === before.selectedDestination,
    'destination changed after orientation rotation', { before, after: stateSummary(afterRotate) });
  check(safeStringify(runnerStats(afterRotate)) === safeStringify(before.runner),
    'runner state changed after orientation rotation', { before: before.runner, after: runnerStats(afterRotate) });
  check(safeStringify(statorStats(afterRotate)) === safeStringify(before.stator),
    'stator state changed after orientation rotation', { before: before.stator, after: statorStats(afterRotate) });
  await screenshot('runner-rotated');

  await page.setViewportSize({ width: config.width, height: config.height });
  await delay(300);
  const restored = await waitForState(
    (candidate) => candidate.phase === before.phase && candidate.busy === false,
    'rotation back to preserve current phase',
    12_000,
  );
  validateTargets(restored);
  check(restored.selectedDestination === before.selectedDestination,
    'destination changed after rotating back', { before, after: stateSummary(restored) });
  check(safeStringify(runnerStats(restored)) === safeStringify(before.runner),
    'runner state changed after rotating back', { before: before.runner, after: runnerStats(restored) });
  check(safeStringify(statorStats(restored)) === safeStringify(before.stator),
    'stator state changed after rotating back', { before: before.stator, after: statorStats(restored) });
  report.rotation = {
    from: { width: config.width, height: config.height },
    to: rotated,
    before,
    afterRotate: stateSummary(afterRotate),
    restored: stateSummary(restored),
  };
  return restored;
}

async function holdGateWithSamples(target, holdMs) {
  check(target.action === 'hold', 'gate opening target must use hold interaction', targetDescription(target));
  const samples = [];
  await touchEvent('touchStart', target.x, target.y);
  const deadline = Date.now() + holdMs;
  try {
    while (Date.now() < deadline) {
      await delay(Math.min(140, Math.max(20, deadline - Date.now())));
      const state = await readState();
      samples.push({
        atMs: Date.now() - startedAt,
        phase: state?.phase,
        opening: gateOpening(state),
        speed: turbineSpeed(state),
      });
    }
  } finally {
    await touchEvent('touchEnd', target.x, target.y);
  }
  return samples;
}

function assertMonotonic(values, label, tolerance = 0.015) {
  for (let i = 1; i < values.length; i++) {
    check(values[i] + tolerance >= values[i - 1], `${label} moved backwards`, values);
  }
}

async function measurePerformance() {
  return page.evaluate((durationMs) => new Promise((resolve) => {
    const hydro = window.__hydro;
    const frameTimes = [];
    let previous = null;
    let started = null;
    let last = null;
    let peakCalls = 0;
    let peakTriangles = 0;
    function percentile(sorted, fraction) {
      if (!sorted.length) return null;
      const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction));
      return sorted[index];
    }
    function frame(now) {
      if (started === null) started = now;
      if (previous !== null) frameTimes.push(now - previous);
      previous = now;
      last = now;
      const renderer = hydro?.renderer;
      const render = renderer?.info?.render ?? renderer?.render;
      peakCalls = Math.max(peakCalls, render?.calls ?? renderer?.calls ?? 0);
      peakTriangles = Math.max(peakTriangles, render?.triangles ?? renderer?.triangles ?? 0);
      if (now - started < durationMs) {
        requestAnimationFrame(frame);
        return;
      }
      const sorted = [...frameTimes].sort((a, b) => a - b);
      const elapsed = Math.max(1, last - started);
      resolve({
        durationMs: elapsed,
        frames: frameTimes.length,
        fps: frameTimes.length * 1000 / elapsed,
        p50: percentile(sorted, 0.50),
        p95: percentile(sorted, 0.95),
        p99: percentile(sorted, 0.99),
        max: sorted.at(-1) ?? null,
        longFramesOver40ms: frameTimes.filter((time) => time > 40).length,
        longFramesOver50ms: frameTimes.filter((time) => time > 50).length,
        peakCalls,
        peakTriangles,
      });
    }
    requestAnimationFrame(frame);
  }), 5_000);
}

function assertPhaseOrder() {
  let cursor = -1;
  for (const expected of EXPECTED_PHASES) {
    const found = report.phases.indexOf(expected, cursor + 1);
    check(found >= 0, `Required phase was not observed: ${expected}`, report.phases);
    cursor = found;
  }
}

function assertRenderer(state) {
  const renderer = state?.renderer;
  check(renderer, 'renderer debug information is missing');
  check(renderer.isWebGL2 === true, 'WebGL2 is not active', renderer);
  check(renderer.pixelRatio !== null && renderer.pixelRatio <= MAX_DPR + 0.001,
    `device pixel ratio exceeds ${MAX_DPR}`, renderer);

  for (const key of ['geometries', 'textures']) {
    if (renderer[key] !== null && renderer[key] !== undefined) {
      check(Number.isInteger(renderer[key]) && renderer[key] >= 0,
        `renderer ${key} count is invalid`, renderer);
    }
  }

  const bufferLimits = {
    drawingBufferWidth: Math.ceil(state.viewport.width * MAX_DPR) + 2,
    drawingBufferHeight: Math.ceil(state.viewport.height * MAX_DPR) + 2,
  };
  for (const key of ['drawingBufferWidth', 'drawingBufferHeight']) {
    if (renderer[key] !== null && renderer[key] !== undefined) {
      check(Number.isFinite(renderer[key]) && renderer[key] > 0,
        `${key} is invalid`, renderer);
      check(renderer[key] <= bufferLimits[key], `${key} exceeds the DPR/viewport budget`, {
        renderer,
        viewport: state.viewport,
        limit: bufferLimits[key],
      });
    }
  }
  if (renderer.canvasClientWidth > 0 && renderer.drawingBufferWidth > 0) {
    check(renderer.drawingBufferWidth / renderer.canvasClientWidth <= MAX_DPR + 0.02,
      'drawing buffer width exceeds DPR budget', renderer);
  }
  if (renderer.canvasClientHeight > 0 && renderer.drawingBufferHeight > 0) {
    check(renderer.drawingBufferHeight / renderer.canvasClientHeight <= MAX_DPR + 0.02,
      'drawing buffer height exceeds DPR budget', renderer);
  }
}

const startedAt = Date.now();

async function run() {
  const executablePath = locateChromium();
  report.config.chromium = executablePath;
  browser = await chromium.launch({
    executablePath,
    headless: true,
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--disable-dev-shm-usage',
    ],
  });
  context = await browser.newContext({
    viewport: { width: config.width, height: config.height },
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: false,
    reducedMotion: 'no-preference',
  });

  const allowedOrigin = new URL(config.baseUrl).origin;
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    let allowed = false;
    try {
      const parsed = new URL(url);
      allowed = parsed.origin === allowedOrigin || ['data:', 'blob:'].includes(parsed.protocol);
    } catch {
      allowed = false;
    }
    if (!allowed) {
      report.externalRequests.push(url);
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });

  page = await context.newPage();
  cdp = await context.newCDPSession(page);
  page.on('console', (message) => {
    if (message.type() === 'error') report.consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => report.pageErrors.push(String(error)));
  page.on('requestfailed', (request) => {
    report.failedRequests.push({
      url: request.url(),
      error: request.failure()?.errorText ?? 'unknown',
    });
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      report.badResponses.push({ url: response.url(), status: response.status() });
    }
  });

  await page.goto(config.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  let state = await waitForState((candidate) => candidate.phase === 'chooseDestination',
    'window.__hydro and chooseDestination', 30_000);
  state = await waitReadyPhase('chooseDestination', 30_000);
  assertRenderer(state);
  assertValidationContracts(state);
  validateTargets(state);
  checkpoint('initial', state);
  await screenshot('choose-destination');
  const replayAtStart = page.locator('#replay');
  check(await replayAtStart.getAttribute('aria-hidden') === 'true',
    'replay must be hidden before completion');
  await assertAudioToggle();

  state = await waitReadyPhase('chooseDestination');
  const destinationTarget = findTarget(state, (target) => {
    const destination = normalizeDestination(target.destination);
    return target.action === 'tap'
      && (destination === config.destination
        || idText(target).includes(config.destination)
        || (config.destination === 'city' && /(town|ferris)/.test(idText(target))));
  }, `destination ${config.destination}`);
  await performTarget(destinationTarget);
  state = await waitForState(
    (candidate) => normalizeDestination(candidate.selectedDestination) === config.destination
      && candidate.phase === 'runner'
      && candidate.busy === false,
    `destination ${config.destination} selection`,
    20_000,
  );
  checkpoint('destination-selected', state);

  // Place one runner blade, rotate the viewport in the middle of real progress, then continue.
  let beforeRunner = runnerStats(state);
  check(beforeRunner.manualPlaced !== null && beforeRunner.installed !== null && beforeRunner.total !== null,
    'runner count API is incomplete', beforeRunner);
  const firstRunnerTarget = findTarget(
    state,
    (target) => target.action === 'drag'
      && /(runner|blade|turbine)/.test(idText(target)),
    'first runner blade drag',
  );
  await performTarget(firstRunnerTarget);
  state = await waitForState((candidate) => {
    const after = runnerStats(candidate);
    return candidate.phase === 'runner'
      && after.manualPlaced !== null
      && after.manualPlaced > beforeRunner.manualPlaced;
  }, 'first runner blade placement', 12_000);
  state = await waitReadyPhase('runner', 12_000);
  check(runnerStats(state).manualPlaced === beforeRunner.manualPlaced + 1,
    'first runner action did not install exactly one manual blade', {
      before: beforeRunner,
      after: runnerStats(state),
    });
  state = await rotateAndPreserve(state);

  state = await placeRepeated({
    phase: 'runner',
    kind: 'runner',
    stats: runnerStats,
    targetPredicate: (target) => /(runner|blade|turbine)/.test(idText(target)),
    minManual: 3,
    maxManual: 4,
    nextPhase: 'stator',
    peakTag: 'runner-mid-peak',
  });
  const runnerFinal = runnerStats(state);
  check(runnerFinal.total >= 6 && runnerFinal.total <= 12,
    'runner total must be between 6 and 12 blades', runnerFinal);
  check(Number(state.runner?.previewAngularSpeed) === 0,
    'runner preview rotation did not stop before the stator phase', state.runner);

  state = await placeRepeated({
    phase: 'stator',
    kind: 'stator',
    stats: statorStats,
    targetPredicate: (target) => /(stator|coil|copper)/.test(idText(target)),
    minManual: 3,
    maxManual: 4,
    nextPhase: 'fluids',
  });

  state = await waitReadyPhase('fluids');
  await screenshot('fluids-start');
  const initialFluids = fluidStats(state);
  check(initialFluids.oilConnected === false && initialFluids.coolantConnected === false,
    'fluid connections should begin disconnected', initialFluids);
  const oilTarget = findTarget(
    state,
    (target) => target.action === 'drag' && /(oil|lubric)/.test(idText(target)),
    'oil hose drag',
  );
  await performTarget(oilTarget);
  state = await waitForState((candidate) => fluidStats(candidate).oilConnected === true,
    'oil hose connection', 12_000);
  const oilConnected = fluidStats(state);
  if (initialFluids.oilLevel !== null && oilConnected.oilLevel !== null) {
    state = await waitForState((candidate) => {
      const level = fluidStats(candidate).oilLevel;
      return level !== null
        && level > initialFluids.oilLevel + 0.15
        && candidate.camera?.shot === 'fluidsMacro'
        && Number(candidate.diagnostics?.cameraBusy) === 0;
    }, 'site-glass oil level to rise', 10_000);
  }
  assertFluidComposition(state, 'oil macro', { requireCooling: false });
  await screenshot('fluids-oil-macro');
  state = await waitReadyPhase('fluids', 12_000);
  await screenshot('fluids-oil-connected');

  const coolantTarget = findTarget(
    state,
    (target) => target.action === 'drag' && /(cool|water|blue)/.test(idText(target)),
    'coolant hose drag',
  );
  await performTarget(coolantTarget);
  state = await waitForState((candidate) => fluidStats(candidate).coolantConnected === true,
    'coolant hose connection', 12_000);
  const bothConnected = fluidStats(state);
  check(bothConnected.oilConnected === true && bothConnected.coolantConnected === true,
    'both fluid hoses are not connected', bothConnected);
  if (bothConnected.coolantFlow !== null) {
    state = await waitForState((candidate) => {
      const flow = fluidStats(candidate).coolantFlow;
      return flow !== null && flow > 0.05;
    }, 'coolant flow to become visible', 10_000);
  }
  state = await waitForState((candidate) => {
    const bubbles = fluidStats(candidate).bubbles;
    return bubbles !== null && bubbles > 0;
  }, 'coolant bubbles to appear', 5_000);
  const bubbleSamples = [{
    atMs: Date.now() - startedAt,
    phase: state.phase,
    count: fluidStats(state).bubbles,
  }];
  state = await waitForState((candidate) => {
    const bubbles = fluidStats(candidate).bubbles;
    const last = bubbleSamples.at(-1)?.count;
    if (Number.isFinite(bubbles) && bubbles !== last) {
      bubbleSamples.push({
        atMs: Date.now() - startedAt,
        phase: candidate.phase,
        count: bubbles,
      });
    }
    return bubbles === 0;
  }, 'coolant bubbles to clear', 10_000);
  check(bubbleSamples[0].count > 0 && bubbleSamples.at(-1).count === 0,
    'coolant bubbles did not decrease from visible to clear', bubbleSamples);
  for (let i = 1; i < bubbleSamples.length; i++) {
    check(bubbleSamples[i].count <= bubbleSamples[i - 1].count,
      'coolant bubble count increased while clearing', bubbleSamples);
  }
  check(bubbleSamples.some((sample) => sample.count < bubbleSamples[0].count),
    'coolant bubble count never decreased', bubbleSamples);
  report.coolantBubbles = { samples: bubbleSamples };
  assertFluidComposition(state, 'connected fluids');
  checkpoint('fluids-connected', state);
  await screenshot('fluids-connected');
  state = await waitReadyPhase('casing', 25_000);

  const casingTarget = findTarget(
    state,
    (target) => target.action === 'drag' && /(casing|crane|shell|cover)/.test(idText(target)),
    'casing crane alignment',
  );
  assertCasingComposition(state);
  await screenshot('casing-start');
  await performTarget(casingTarget, { steps: 18, stepMs: 42 });
  state = await waitForState(
    (candidate) => casingStats(candidate).installed === true && candidate.phase === 'gate',
    'casing installation',
    25_000,
  );
  state = await waitReadyPhase('gate', 20_000);
  check(casingStats(state).installed === true, 'casing state was lost on gate phase', casingStats(state));
  assertValidationContracts(state);
  assertCausalComposition(state, 'gate');
  checkpoint('casing-installed', state);
  await screenshot('casing-installed');

  const gateBefore = gateOpening(state);
  const speedBefore = turbineSpeed(state);
  check(gateBefore !== null && speedBefore !== null, 'gate/turbine causality API is incomplete', {
    gateBefore,
    speedBefore,
  });
  let gateTarget = findTarget(
    state,
    (target) => target.action === 'hold' && /(gate|lever|handle|open)/.test(idText(target)),
    'water gate hold',
  );
  const shortSamples = await holdGateWithSamples(gateTarget, 560);
  check(shortSamples.length >= 2, 'water gate hold produced too few samples', shortSamples);
  const openingSamples = shortSamples.map((sample) => sample.opening).filter(Number.isFinite);
  check(openingSamples.length >= 2, 'water gate opening was not observable during hold', shortSamples);
  assertMonotonic(openingSamples, 'water gate opening');
  const justReleased = await readState();
  const openingAtRelease = gateOpening(justReleased);
  check(openingAtRelease > gateBefore + 0.02, 'holding the gate did not increase opening', {
    before: gateBefore,
    samples: shortSamples,
    release: openingAtRelease,
  });
  check(justReleased.phase === 'gate', 'a short gate hold incorrectly launched the finale', stateSummary(justReleased));
  await delay(550);
  const afterRelease = await readState();
  check(Math.abs(gateOpening(afterRelease) - openingAtRelease) <= 0.025,
    'gate opening continued increasing after touch release', {
      atRelease: openingAtRelease,
      afterRelease: gateOpening(afterRelease),
    });
  report.gateCausality = {
    before: { opening: gateBefore, speed: speedBefore },
    samples: shortSamples,
    atRelease: { opening: openingAtRelease, speed: turbineSpeed(justReleased) },
    afterRelease: { opening: gateOpening(afterRelease), speed: turbineSpeed(afterRelease) },
  };
  await screenshot('gate-partly-open');

  state = afterRelease;
  let gateHolds = 0;
  while (state.phase === 'gate') {
    check(gateHolds < 10, 'water gate did not reach generation after repeated holds', stateSummary(state));
    state = await waitReadyPhase('gate', 12_000);
    gateTarget = findTarget(
      state,
      (target) => target.action === 'hold' && /(gate|lever|handle|open)/.test(idText(target)),
      'water gate continuation hold',
    );
    const beforeOpening = gateOpening(state);
    await holdGateWithSamples(gateTarget, 720);
    gateHolds++;
    state = await readState();
    check(gateOpening(state) > beforeOpening + 0.01 || state.phase !== 'gate',
      'a continued gate hold made no progress', { beforeOpening, after: stateSummary(state) });
    await delay(100);
    state = await readState();
  }
  state = await waitForState((candidate) => {
    const progress = firstNumber(candidate.generation?.transmissionProgress);
    return candidate.phase === 'generation'
      && candidate.camera?.shot === 'generation'
      && Number(candidate.diagnostics?.cameraBusy) === 0
      && progress !== null && progress > .12 && progress < .98;
  }, 'generation transmission camera', 15_000);
  check(turbineSpeed(state) > speedBefore + 0.05,
    'turbine speed did not rise with gate opening', { before: speedBefore, after: turbineSpeed(state) });
  validateTargets(state, { requireTargets: false });
  checkpoint('generation', state);
  await screenshot('generation-transmission');

  state = await waitForState((candidate) => {
    const effect = effectFor(candidate, config.destination);
    const sequence = firstNumber(effect?.sequence);
    return sequence !== null && sequence > .06 && sequence < .82;
  }, `${config.destination} staged reward to begin`, 15_000);
  const earlyEffect = effectFor(state, config.destination);
  assertDestinationStageOrder(earlyEffect, config.destination);
  report.destinationSequence = {
    earlySequence: firstNumber(earlyEffect?.sequence),
    earlyStages: { ...(earlyEffect?.stages || {}) },
  };
  state = await waitForState(
    (candidate) => transmissionReached(candidate) === true
      && candidate.phase === 'complete'
      && candidate.busy === false
      && replayVisible(candidate) === true,
    'power transmission and complete phase',
    30_000,
  );
  check(isComplete(state), 'complete flag is false in complete phase', stateSummary(state));
  check(replayVisible(state) === true, 'replay is not visible at completion', stateSummary(state));
  validateTargets(state);
  if (arrivedDestination(state) !== null) {
    check(normalizeDestination(arrivedDestination(state)) === config.destination,
      'power arrived at the wrong destination', {
        selected: config.destination,
        arrived: arrivedDestination(state),
      });
  }
  assertEffectsExclusive(state, config.destination);
  assertDestinationStageOrder(effectFor(state, config.destination), config.destination, { complete: true });
  assertValidationContracts(state);
  assertCausalComposition(state, 'complete');
  report.destinationSequence.finalStages = { ...(effectFor(state, config.destination)?.stages || {}) };
  checkpoint('complete-high', state);
  await screenshot('complete-high-power');

  const high = {
    opening: gateOpening(state),
    speed: turbineSpeed(state),
    intensity: effectIntensity(effectFor(state, config.destination)),
  };
  check(high.opening !== null && high.speed !== null && high.intensity !== null,
    'final modulation API is incomplete', high);
  const decreaseTarget = findTarget(
    state,
    (target) => /(gate|lever|handle)/.test(idText(target))
      && (/(close|down|decrease|lower)/.test(idText(target))
        || Number(target.direction) < 0
        || String(target.direction).toLowerCase() === 'decrease'),
    'final gate decrease',
  );
  await performTarget(decreaseTarget, { holdMs: 950, steps: 14, stepMs: 36 });
  state = await waitForState(
    (candidate) => {
      const opening = gateOpening(candidate);
      return candidate.phase === 'complete' && opening !== null && opening < high.opening - 0.10;
    },
    'final gate opening to decrease',
    12_000,
  );
  state = await waitForState((candidate) => {
    const speed = turbineSpeed(candidate);
    const intensity = effectIntensity(effectFor(candidate, config.destination));
    return candidate.phase === 'complete'
      && speed !== null
      && intensity !== null
      && speed < high.speed * 0.92
      && intensity < high.intensity - 0.05;
  }, 'final speed and brightness to weaken', 15_000);
  const low = {
    opening: gateOpening(state),
    speed: turbineSpeed(state),
    intensity: effectIntensity(effectFor(state, config.destination)),
  };
  assertEffectsExclusive(state, config.destination, { requireMotion: low.speed > 0.02 });
  await screenshot('complete-low-power');

  const increaseTarget = findTarget(
    state,
    (target) => /(gate|lever|handle)/.test(idText(target))
      && (/(open|up|increase|raise)/.test(idText(target))
        || Number(target.direction) > 0
        || String(target.direction).toLowerCase() === 'increase'),
    'final gate increase',
  );
  await performTarget(increaseTarget, { holdMs: 950, steps: 14, stepMs: 36 });
  state = await waitForState((candidate) => {
    const opening = gateOpening(candidate);
    const speed = turbineSpeed(candidate);
    const intensity = effectIntensity(effectFor(candidate, config.destination));
    return candidate.phase === 'complete'
      && opening !== null
      && speed !== null
      && intensity !== null
      && opening > low.opening + 0.10
      && speed > low.speed + Math.max(0.03, high.speed * 0.05)
      && intensity > low.intensity + 0.05;
  }, 'final gate, speed, and brightness to rise again', 18_000);
  const reopened = {
    opening: gateOpening(state),
    speed: turbineSpeed(state),
    intensity: effectIntensity(effectFor(state, config.destination)),
  };
  assertEffectsExclusive(state, config.destination);
  report.finalModulation = { high, low, reopened };
  checkpoint('complete-reopened', state);
  await screenshot('complete-reopened');

  report.performance = await measurePerformance();
  report.rendererPeak.calls = Math.max(report.rendererPeak.calls, report.performance.peakCalls);
  report.rendererPeak.triangles = Math.max(
    report.rendererPeak.triangles,
    report.performance.peakTriangles,
  );
  check(report.performance.fps >= MIN_FPS, `5s performance fell below ${MIN_FPS} fps`, report.performance);
  const softwareBackend = state.renderer?.backend === 'software-webgl2'
    || /swiftshader|llvmpipe|software/i.test(state.renderer?.rendererLabel || '');
  const p95Limit = softwareBackend ? MAX_SOFTWARE_P95_MS : MAX_P95_MS;
  report.performance.backend = softwareBackend ? 'software-webgl2' : 'hardware-webgl2';
  report.performance.p95Limit = p95Limit;
  check(report.performance.p95 <= p95Limit,
    `5s p95 frame time exceeded ${p95Limit}ms`, report.performance);

  const replay = page.locator('#replay');
  await replay.waitFor({ state: 'visible', timeout: 10_000 });
  const replayLabel = await replay.getAttribute('aria-label');
  check(typeof replayLabel === 'string' && replayLabel.trim().length > 0,
    'replay aria-label is missing', replayLabel);
  check(await replay.getAttribute('aria-hidden') === 'false',
    'replay aria-hidden is not synchronized at completion');
  await tapLocator(replay, 'replay');
  state = await waitForState(
    (candidate) => candidate.phase === 'chooseDestination' && candidate.busy === false,
    'replay reset to chooseDestination',
    25_000,
  );
  const resetRunner = runnerStats(state);
  const resetStator = statorStats(state);
  const resetFluids = fluidStats(state);
  const resetCasing = casingStats(state);
  check(state.selectedDestination == null, 'destination was not reset by replay', state.selectedDestination);
  check(resetRunner.manualPlaced === 0 && resetRunner.installed === 0,
    'runner was not reset by replay', resetRunner);
  check(resetStator.manualPlaced === 0 && resetStator.installed === 0,
    'stator was not reset by replay', resetStator);
  check(resetFluids.oilConnected === false && resetFluids.coolantConnected === false,
    'fluid connections were not reset by replay', resetFluids);
  check(resetCasing.installed === false, 'casing was not reset by replay', resetCasing);
  check(gateOpening(state) !== null && gateOpening(state) <= 0.01,
    'gate opening was not reset by replay', gateOpening(state));
  check(generationActive(state) === false, 'generation remained active after replay', state.generation);
  check(transmissionReached(state) === false, 'transmission remained reached after replay', state.generation);
  check(isComplete(state) === false, 'complete state remained after replay', stateSummary(state));
  check(replayVisible(state) === false, 'replay remained visible after reset', stateSummary(state));
  const resetEffects = effectMap(state);
  if (resetEffects) {
    for (const destination of DESTINATIONS) {
      const effect = effectFor(state, destination);
      check(effectEnergized(effect) === false, `${destination} remained energized after replay`, effect);
      check(Math.abs(effectIntensity(effect) ?? 0) <= 0.01,
        `${destination} remained lit after replay`, effect);
      check(Math.abs(effectMotion(effect) ?? 0) <= 0.01,
        `${destination} remained moving after replay`, effect);
    }
  }
  validateTargets(state);
  checkpoint('replay-reset', state);
  await screenshot('replay-reset');

  assertPhaseOrder();
  assertRenderer(state);
  check(report.rendererPeak.calls <= MAX_CALLS,
    `draw calls exceeded ${MAX_CALLS}`, report.rendererPeak);
  check(report.rendererPeak.triangles <= MAX_TRIANGLES,
    `triangle count exceeded ${MAX_TRIANGLES}`, report.rendererPeak);
  check(report.consoleErrors.length === 0, 'console errors were emitted', report.consoleErrors);
  check(report.pageErrors.length === 0, 'page errors were emitted', report.pageErrors);
  check(report.failedRequests.length === 0, 'network requests failed', report.failedRequests);
  check(report.badResponses.length === 0, 'HTTP error responses were received', report.badResponses);
  check(report.externalRequests.length === 0,
    'external/offline-incompatible requests were attempted', report.externalRequests);
}

try {
  await run();
  report.pass = true;
} catch (error) {
  report.error = {
    name: error?.name ?? 'Error',
    message: error?.message ?? String(error),
    stack: error?.stack ?? null,
    details: error?.details ?? null,
    lastState: stateSummary(lastState),
  };
  if (page) {
    try {
      await screenshot('FAIL');
    } catch {
      // Preserve the original failure when the page is already unavailable.
    }
  }
} finally {
  report.finishedAt = new Date().toISOString();
  report.durationMs = Date.now() - startedAt;
  if (browser) await browser.close();
  fs.writeFileSync(path.join(config.outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
}

if (!report.pass) {
  console.error('FAIL', report.error?.message ?? 'unknown verification error');
  console.error(`Report: ${path.join(config.outDir, 'report.json')}`);
  process.exit(1);
}

console.log('PASS');
console.log(`Phases: ${report.phases.join(' -> ')}`);
console.log(`Renderer peak: ${safeStringify(report.rendererPeak)}`);
console.log(`Performance: ${safeStringify(report.performance)}`);
console.log(`Report: ${path.join(config.outDir, 'report.json')}`);
