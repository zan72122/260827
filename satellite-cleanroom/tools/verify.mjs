#!/usr/bin/env node

// State-driven end-to-end verification for Satellite Cleanroom.
//
// The game remains a no-build static site. This script serves it, opens Chromium,
// drives only the public one-finger UI described by window.__satellite.targets(),
// and writes screenshots plus a machine-readable report.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(HERE, '..');
const OUTPUT_ROOT = path.resolve(
  process.argv[2] || process.env.VERIFY_OUT || path.join(PROJECT_ROOT, 'verify-artifacts'),
);

const EXPECTED_PHASES = Object.freeze([
  'chooseMission',
  'airlock',
  'airShower',
  'crane',
  'payload',
  'harness',
  'blanket',
  'arrays',
  'test',
  'orbit',
  'mission',
  'complete',
]);

const SCENARIOS = Object.freeze([
  { name: 'desktop-weather', width: 1280, height: 800, mission: 'weather' },
  { name: 'phone-ocean', width: 480, height: 800, mission: 'ocean', orientationTest: true },
  { name: 'ipad-landscape-communication', width: 1180, height: 820, mission: 'communication', pauseTest: true },
  { name: 'ipad-portrait-weather', width: 820, height: 1180, mission: 'weather' },
]);
const SCENARIO_FILTER = String(process.env.VERIFY_SCENARIO || '').trim();
const RUN_SCENARIOS = SCENARIO_FILTER
  ? SCENARIOS.filter((scenario) => scenario.name === SCENARIO_FILTER || scenario.mission === SCENARIO_FILTER)
  : SCENARIOS;
if (!RUN_SCENARIOS.length) throw new Error(`VERIFY_SCENARIO did not match: ${SCENARIO_FILTER}`);

const MISSION_CONTRACTS = Object.freeze({
  weather: {
    aliases: ['weather', 'cloud', 'meteorological', 'meteo'],
    mainInstrumentId: 'cloud-imager',
    instrumentTokens: ['cloud', 'weather', 'imager', 'camera'],
    resultKind: 'weather-clouds',
    resultTokens: ['weather', 'cloud', 'storm', 'rain', 'typhoon'],
    accessoryTokens: ['weather', 'cloud', 'radiometer', 'sensor', 'imager'],
  },
  ocean: {
    aliases: ['ocean', 'sea', 'marine'],
    mainInstrumentId: 'ocean-scanner',
    instrumentTokens: ['ocean', 'sea', 'scanner', 'altimeter'],
    resultKind: 'ocean-currents',
    resultTokens: ['ocean', 'sea', 'current', 'ice', 'color'],
    accessoryTokens: ['ocean', 'sea', 'altimeter', 'scanner', 'sensor'],
  },
  communication: {
    aliases: ['communication', 'communications', 'comms', 'relay', 'link'],
    mainInstrumentId: 'communications-relay',
    instrumentTokens: ['communication', 'communications', 'comms', 'relay', 'radio'],
    resultKind: 'communication-links',
    resultTokens: ['communication', 'communications', 'comms', 'link', 'island', 'ship'],
    accessoryTokens: ['communication', 'communications', 'relay', 'dish', 'antenna', 'radio'],
  },
});

const GLOBAL_TIMEOUT_MS = Number(process.env.VERIFY_SCENARIO_TIMEOUT_MS || 420_000);
const ACTION_TIMEOUT_MS = Number(process.env.VERIFY_ACTION_TIMEOUT_MS || 25_000);
const PERF_DURATION_MS = Number(process.env.VERIFY_PERF_MS || 5_000);
// Chromium is deliberately run through SwiftShader in CI. These gates catch a
// stalled renderer without pretending that software rasterization is a phone GPU.
const MIN_SWIFTSHADER_FPS = Number(process.env.VERIFY_MIN_FPS || 10);
const MAX_SWIFTSHADER_P95_MS = Number(process.env.VERIFY_MAX_P95_MS || 150);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nowIso = () => new Date().toISOString();

function errorText(error) {
  return error instanceof Error ? `${error.name}: ${error.message}\n${error.stack || ''}` : String(error);
}

function safeName(value) {
  return String(value).replace(/[^a-z0-9_.-]+/gi, '-').replace(/^-|-$/g, '') || 'item';
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function numberValue(...values) {
  const value = firstDefined(...values);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function booleanValue(...values) {
  const value = firstDefined(...values);
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === 'true') return true;
  if (value === 0 || value === 'false') return false;
  return undefined;
}

function normalizeText(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value).toLowerCase();
  try { return JSON.stringify(value).toLowerCase(); } catch { return String(value).toLowerCase(); }
}

function normalizeMission(value) {
  const text = normalizeText(value);
  for (const [mission, contract] of Object.entries(MISSION_CONTRACTS)) {
    if (contract.aliases.some((token) => text.includes(token))) return mission;
  }
  return null;
}

function includesToken(value, tokens) {
  const text = normalizeText(value);
  return tokens.some((token) => text.includes(token));
}

async function loadPlaywright() {
  const candidates = ['playwright-core'];
  if (process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES) {
    candidates.push(pathToFileURL(path.join(
      process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,
      'playwright-core',
      'index.js',
    )).href);
  }
  let lastError;
  for (const candidate of candidates) {
    try {
      const module = await import(candidate);
      const chromium = module.chromium || module.default?.chromium;
      if (chromium) return chromium;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Unable to load playwright-core. Install it or set CODEX_PRIMARY_RUNTIME_NODE_MODULES. ${errorText(lastError)}`);
}

function executable(file) {
  if (!file) return false;
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function findExecutableBelow(root, maxDepth = 5) {
  const wanted = new Set([
    'chrome',
    'headless_shell',
    'chromium',
    'chromium-browser',
    'google-chrome',
    'google-chrome-stable',
  ]);
  if (!root || !fs.existsSync(root)) return null;
  const queue = [{ dir: root, depth: 0 }];
  while (queue.length) {
    const { dir, depth } = queue.shift();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if ((entry.isFile() || entry.isSymbolicLink()) && wanted.has(entry.name) && executable(full)) return full;
      if (entry.isDirectory() && depth < maxDepth) queue.push({ dir: full, depth: depth + 1 });
    }
  }
  return null;
}

function discoverChromium(chromium) {
  const direct = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    process.env.CHROMIUM_PATH,
    process.env.CHROME_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  for (const candidate of direct) if (executable(candidate)) return candidate;

  const pathNames = ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable'];
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    for (const name of pathNames) {
      const candidate = path.join(dir, name);
      if (executable(candidate)) return candidate;
    }
  }

  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    '/opt/pw-browsers',
    '/ms-playwright',
    path.join(os.homedir(), '.cache', 'ms-playwright'),
    process.env.CODEX_PRIMARY_RUNTIME_ROOT,
  ];
  for (const root of roots) {
    const found = findExecutableBelow(root, root === process.env.CODEX_PRIMARY_RUNTIME_ROOT ? 7 : 5);
    if (found) return found;
  }

  try {
    const bundled = chromium.executablePath();
    if (executable(bundled)) return bundled;
  } catch {
    // chromium.launch() will give the canonical installation error below.
  }
  return null;
}

const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.wasm': 'application/wasm',
});

async function startStaticServer(root) {
  const server = http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
      let relative = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, '');
      if (!relative || relative.endsWith('/')) relative += 'index.html';
      const file = path.resolve(root, relative);
      if (file !== root && !file.startsWith(`${root}${path.sep}`)) {
        response.writeHead(403).end('Forbidden');
        return;
      }
      const stat = await fsp.stat(file);
      if (!stat.isFile()) throw new Error('Not a file');
      response.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
        'Cross-Origin-Resource-Policy': 'same-origin',
      });
      if (request.method === 'HEAD') response.end();
      else fs.createReadStream(file).pipe(response);
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function readState(page) {
  return page.evaluate(() => {
    const debug = window.__satellite;
    if (!debug) return null;
    const safe = (value) => {
      if (value === undefined) return undefined;
      try { return JSON.parse(JSON.stringify(value)); } catch { return null; }
    };
    const get = (...names) => {
      for (const name of names) {
        try {
          const value = debug[name];
          if (value !== undefined) return typeof value === 'function' ? value.call(debug) : value;
        } catch {
          // A partially initialized getter should not hide the rest of the API.
        }
      }
      return undefined;
    };
    const renderer = get('renderer');
    const info = renderer?.info;
    const context = renderer?.getContext?.();
    const targets = get('targets');
    return safe({
      phase: get('phase'),
      busy: Boolean(get('busy')),
      busyReasons: get('busyReasons'),
      targets: Array.isArray(targets) ? targets : [],
      mission: get('mission', 'selectedMission'),
      airlock: get('airlock', 'airlockState'),
      airShower: get('airShower', 'airshower', 'airShowerState'),
      integration: get('integration', 'satelliteIntegration', 'crane'),
      payload: get('payload', 'payloadState'),
      harness: get('harness', 'cables', 'harnessState'),
      blanket: get('blanket', 'blankets', 'blanketState'),
      arrays: get('arrays', 'solarArrays', 'solarPanels'),
      antenna: get('antenna', 'antennaState'),
      test: get('test', 'testState'),
      orbit: get('orbit', 'orbitState'),
      missionResult: get('missionResult', 'result', 'missionState'),
      complete: get('complete', 'completed'),
      replay: get('replay', 'replayState', 'replayVisible'),
      technicians: get('technicians', 'technicianStats'),
      spatialValidation: get('spatialValidation', 'spatial', 'validation'),
      audio: get('audio', 'audioState'),
      guidance: get('guidance', 'hint'),
      phaseHistory: get('phaseHistory', 'history'),
      planSeed: get('planSeed', 'seed'),
      planHash: get('planHash', 'installationPlanHash'),
      renderer: info ? {
        calls: info.render?.calls,
        triangles: info.render?.triangles,
        points: info.render?.points,
        lines: info.render?.lines,
        geometries: info.memory?.geometries,
        textures: info.memory?.textures,
        resolutionScale: renderer?.userData?.resolutionScale ?? null,
        contextName: context?.constructor?.name || null,
        isWebGL2: typeof WebGL2RenderingContext !== 'undefined' && context instanceof WebGL2RenderingContext,
      } : null,
    });
  });
}

function isComplete(state) {
  return state?.phase === 'complete'
    || booleanValue(state?.complete?.done, state?.complete?.complete, state?.complete) === true;
}

function targetPoint(value) {
  if (Array.isArray(value) && value.length >= 2) return { x: Number(value[0]), y: Number(value[1]) };
  if (value && typeof value === 'object') {
    return {
      x: Number(firstDefined(value.x, value.clientX, value.screenX)),
      y: Number(firstDefined(value.y, value.clientY, value.screenY)),
    };
  }
  return null;
}

function targetPath(target) {
  const points = [];
  const start = targetPoint(target);
  if (start) points.push(start);
  if (Array.isArray(target?.path)) {
    for (const item of target.path) {
      const point = targetPoint(item);
      if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) points.push(point);
    }
  }
  const end = targetPoint({
    x: firstDefined(target?.endX, target?.dropX, target?.toX),
    y: firstDefined(target?.endY, target?.dropY, target?.toY),
  });
  if (end && Number.isFinite(end.x) && Number.isFinite(end.y)) {
    const last = points.at(-1);
    if (!last || Math.hypot(last.x - end.x, last.y - end.y) > 0.5) points.push(end);
  }
  return points;
}

function validateTargets(targets, width, height, phase) {
  assert.ok(Array.isArray(targets), `${phase}: targets() must return an array`);
  for (const [index, target] of targets.entries()) {
    const id = target?.id || target?.key || `${phase}[${index}]`;
    const points = targetPath(target);
    assert.ok(points.length > 0, `${id}: target is missing finite x/y coordinates`);
    const inset = Math.max(2, Math.min(8, numberValue(target.radius, target.hitRadius) || 2));
    for (const [pointIndex, point] of points.entries()) {
      assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y), `${id}: point ${pointIndex} is not finite`);
      assert.ok(
        point.x >= inset && point.x <= width - inset && point.y >= inset && point.y <= height - inset,
        `${id}: point ${pointIndex} (${point.x.toFixed(1)},${point.y.toFixed(1)}) is outside ${width}x${height}`,
      );
    }
  }
}

function targetIdentity(target, index = 0) {
  return String(firstDefined(target?.id, target?.key, target?.name, target?.role, `${index}`));
}

function normalizeAction(target) {
  const raw = normalizeText(firstDefined(target?.action, target?.gesture, target?.type));
  if (raw.includes('trace') || raw.includes('draw') || raw.includes('cable') || raw.includes('route')) return 'trace';
  if (raw.includes('hold') || raw.includes('longpress') || raw.includes('long-press') || raw === 'press') return 'hold';
  if (raw.includes('swipe') || raw.includes('slide') || raw.includes('pull')) return 'swipe';
  if (raw.includes('drag') || raw.includes('move') || raw.includes('lower')) return 'drag';
  if (target?.holdMs !== undefined) return 'hold';
  if (Array.isArray(target?.path) && target.path.length > 1) return 'trace';
  if (target?.endX !== undefined || target?.dropX !== undefined || target?.drag) return 'drag';
  return 'tap';
}

async function dispatchTouch(cdp, type, point = null) {
  const touchPoints = point ? [{
    x: point.x,
    y: point.y,
    id: 1,
    radiusX: 9,
    radiusY: 9,
    force: type === 'touchEnd' ? 0 : 1,
  }] : [];
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
}

function interpolatePath(points, maxSegment = 34) {
  const output = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1];
    const to = points[i];
    const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / maxSegment));
    for (let step = 1; step <= steps; step++) {
      output.push({
        x: from.x + (to.x - from.x) * step / steps,
        y: from.y + (to.y - from.y) * step / steps,
      });
    }
  }
  return output;
}

async function actOnTarget(cdp, target) {
  const action = normalizeAction(target);
  const points = targetPath(target);
  assert.ok(points.length, `${targetIdentity(target)} has no gesture coordinates`);
  const start = points[0];

  if (action === 'tap') {
    await dispatchTouch(cdp, 'touchStart', start);
    await sleep(75);
    await dispatchTouch(cdp, 'touchEnd');
    await sleep(110);
    return action;
  }

  if (action === 'hold') {
    const holdMs = Math.max(450, Math.min(8_000, numberValue(target.holdMs, target.durationMs) || 1_650));
    await dispatchTouch(cdp, 'touchStart', start);
    const until = Date.now() + holdMs;
    while (Date.now() < until) {
      await sleep(Math.min(240, until - Date.now()));
      if (Date.now() < until) await dispatchTouch(cdp, 'touchMove', start);
    }
    await dispatchTouch(cdp, 'touchEnd');
    await sleep(130);
    return action;
  }

  assert.ok(points.length >= 2, `${targetIdentity(target)}: ${action} requires endX/endY or path`);
  const expanded = interpolatePath(points, action === 'trace' ? 24 : 34);
  await dispatchTouch(cdp, 'touchStart', expanded[0]);
  for (let i = 1; i < expanded.length; i++) {
    await dispatchTouch(cdp, 'touchMove', expanded[i]);
    await sleep(action === 'trace' ? 34 : 28);
  }
  await dispatchTouch(cdp, 'touchEnd');
  await sleep(140);
  return action;
}

function stateFingerprint(state) {
  const targets = (state?.targets || []).map((target, index) => ({
    id: targetIdentity(target, index),
    action: normalizeAction(target),
    enabled: target.enabled !== false,
  }));
  return JSON.stringify({
    phase: state?.phase,
    busy: state?.busy,
    mission: state?.mission,
    airlock: state?.airlock,
    airShower: state?.airShower,
    integration: state?.integration,
    payload: state?.payload,
    harness: state?.harness,
    blanket: state?.blanket,
    arrays: state?.arrays,
    antenna: state?.antenna,
    test: state?.test,
    orbit: state?.orbit,
    missionResult: state?.missionResult,
    complete: state?.complete,
    replay: state?.replay,
    targets,
  });
}

function pruneVolatile(value) {
  if (Array.isArray(value)) return value.map(pruneVolatile);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if (/^(time|elapsed|frame|camera|viewport|screen|renderer|audio|guidance|hint)$/i.test(key)) continue;
    if (/(timestamp|updatedAt|animationTime|pulse|hover)/i.test(key)) continue;
    output[key] = pruneVolatile(child);
  }
  return output;
}

function durableGameplaySnapshot(state) {
  return pruneVolatile({
    phase: state?.phase,
    mission: state?.mission,
    airlock: state?.airlock,
    airShower: state?.airShower,
    integration: state?.integration,
    payload: state?.payload,
    harness: state?.harness,
    blanket: state?.blanket,
    arrays: state?.arrays,
    antenna: state?.antenna,
    test: state?.test,
    orbit: state?.orbit,
    missionResult: state?.missionResult,
    complete: state?.complete,
    planSeed: state?.planSeed,
    planHash: state?.planHash,
  });
}

async function waitForStateChange(page, baseline, timeout = ACTION_TIMEOUT_MS) {
  const fingerprint = stateFingerprint(baseline);
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    await sleep(110);
    const next = await readState(page);
    if (next && stateFingerprint(next) !== fingerprint) return next;
  }
  throw new Error(`Gesture produced no observable state change in ${baseline?.phase}; state=${fingerprint}`);
}

function chooseMissionTarget(targets, mission) {
  const contract = MISSION_CONTRACTS[mission];
  const match = targets.find((target) => contract.aliases.some((token) => normalizeText(target).includes(token)));
  assert.ok(match, `chooseMission: no target identifies ${mission}; target ids=${targets.map(targetIdentity).join(', ')}`);
  return match;
}

function chooseLeastUsedTarget(targets, actionCounts, phase) {
  const enabled = targets.filter((target) => target?.enabled !== false);
  assert.ok(enabled.length, 'No enabled target is available');
  return enabled
    .map((target, index) => ({
      target,
      index,
      count: actionCounts.get(`${phase}:${targetIdentity(target, index)}`) || 0,
    }))
    .sort((a, b) => a.count - b.count || a.index - b.index)[0].target;
}

async function takeScreenshot(page, directory, index, tag) {
  const file = path.join(directory, `${String(index).padStart(2, '0')}-${safeName(tag)}.png`);
  await page.screenshot({ path: file, animations: 'allow' });
  return file;
}

async function testOrientation(page, scenario, scenarioDirectory) {
  const before = await readState(page);
  const durableBefore = durableGameplaySnapshot(before);
  const rotated = { width: scenario.height, height: scenario.width };
  await page.setViewportSize(rotated);
  await page.evaluate(() => window.dispatchEvent(new Event('orientationchange')));
  await sleep(500);
  const after = await readState(page);
  assert.deepEqual(durableGameplaySnapshot(after), durableBefore, 'Gameplay state changed during orientation change');
  validateTargets(after.targets, rotated.width, rotated.height, `${after.phase}:rotated`);
  await page.screenshot({ path: path.join(scenarioDirectory, 'orientation-rotated.png') });

  await page.setViewportSize({ width: scenario.width, height: scenario.height });
  await page.evaluate(() => window.dispatchEvent(new Event('orientationchange')));
  await sleep(500);
  const restored = await readState(page);
  assert.deepEqual(durableGameplaySnapshot(restored), durableBefore, 'Gameplay state changed when orientation was restored');
  validateTargets(restored.targets, scenario.width, scenario.height, `${restored.phase}:restored`);
  return { testedAtPhase: before.phase, rotated, statePreserved: true };
}

async function testPauseResume(page, cdp) {
  const before = await readState(page);
  const durableBefore = durableGameplaySnapshot(before);
  let mode = 'cdp-lifecycle';
  try {
    await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
    await sleep(1_100);
    await cdp.send('Page.setWebLifecycleState', { state: 'active' });
  } catch (error) {
    mode = 'visibility-events-fallback';
    await page.evaluate(() => {
      window.dispatchEvent(new Event('blur'));
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    });
    await sleep(1_100);
    await page.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });
  }
  await page.bringToFront();
  await sleep(350);
  let after = await readState(page);
  assert.deepEqual(durableGameplaySnapshot(after), durableBefore, 'Gameplay state jumped or regressed across pause/resume');
  if (after?.busy) {
    try {
      await page.waitForFunction(() => window.__satellite && !window.__satellite.busy, null, { timeout: 10_000 });
      after = await readState(page);
    } catch {
      throw new Error(`Game did not resume interaction after lifecycle restore: ${JSON.stringify(after?.busyReasons || after)}`);
    }
  }
  assert.ok(after.targets.length > 0, `No interaction target after pause/resume in ${after.phase}`);
  return { testedAtPhase: before.phase, mode, statePreserved: true, interactionRestored: true };
}

function objectNumber(object, ...names) {
  if (!object || typeof object !== 'object') return undefined;
  return numberValue(...names.map((name) => object[name]));
}

function objectBoolean(object, ...names) {
  if (!object || typeof object !== 'object') return undefined;
  return booleanValue(...names.map((name) => object[name]));
}

function assertMetricZero(object, label, matcher, { require = true } = {}) {
  const found = [];
  const walk = (value, prefix = '') => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      const full = prefix ? `${prefix}.${key}` : key;
      if (matcher.test(full)) {
        if (typeof child === 'number') found.push({ key: full, value: child });
        else if (Array.isArray(child)) found.push({ key: full, value: child.length });
        else if (typeof child === 'boolean' && /(free|safe|valid)/i.test(key)) found.push({ key: full, value: child ? 0 : 1 });
      }
      if (child && typeof child === 'object' && !Array.isArray(child)) walk(child, full);
    }
  };
  walk(object);
  if (require) assert.ok(found.length, `${label}: no matching validation metric was exposed`);
  for (const metric of found) assert.equal(metric.value, 0, `${label}: ${metric.key}=${metric.value}`);
  return found;
}

function assertCapacityWithinLimits(object, label) {
  const evidence = [];
  const failures = [];
  const walk = (value, prefix = '') => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      const full = prefix ? `${prefix}.${key}` : key;
      if (/withinLimits/i.test(key) && typeof child === 'boolean') {
        evidence.push(full);
        if (!child) failures.push(`${full}=false`);
      } else if (/headroom|remaining/i.test(key) && typeof child === 'number') {
        evidence.push(full);
        if (child < 0) failures.push(`${full}=${child}`);
      } else if (/(overrun|overflow|capacityExceeded)/i.test(key)) {
        const count = typeof child === 'number' ? child : Array.isArray(child) ? child.length : child === true ? 1 : 0;
        evidence.push(full);
        if (count !== 0) failures.push(`${full}=${count}`);
      }
      if (child && typeof child === 'object') walk(child, full);
    }
  };
  walk(object);
  assert.ok(evidence.length, `${label}: no capacity/headroom metric was exposed`);
  assert.equal(failures.length, 0, `${label}: ${failures.join(', ')}`);
  return evidence;
}

function assertIssuesEmpty(object, label) {
  if (!object || typeof object !== 'object') return;
  for (const [key, value] of Object.entries(object)) {
    if (/issues|errors|violations/i.test(key) && Array.isArray(value)) {
      assert.equal(value.length, 0, `${label}.${key} is not empty: ${JSON.stringify(value)}`);
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      assertIssuesEmpty(value, `${label}.${key}`);
    }
  }
}

function assertMissionPropagation(state, expectedMission) {
  const contract = MISSION_CONTRACTS[expectedMission];
  assert.equal(normalizeMission(state.mission), expectedMission, `Selected mission is not ${expectedMission}`);

  const instrument = firstDefined(
    state.payload?.mainInstrumentId,
    state.payload?.primaryInstrumentId,
    state.payload?.instrumentId,
    state.payload?.mainInstrument,
  );
  assert.ok(instrument !== undefined, 'payload.mainInstrumentId is required for mission propagation verification');
  assert.ok(
    normalizeText(instrument) === contract.mainInstrumentId || includesToken(instrument, contract.instrumentTokens),
    `${expectedMission}: unexpected main instrument ${normalizeText(instrument)}`,
  );

  const resultKind = firstDefined(
    state.missionResult?.kind,
    state.missionResult?.resultKind,
    state.missionResult?.type,
    state.missionResult?.id,
  );
  assert.ok(resultKind !== undefined, 'missionResult.kind is required for mission propagation verification');
  assert.ok(
    normalizeText(resultKind) === contract.resultKind || includesToken(resultKind, contract.resultTokens),
    `${expectedMission}: unexpected result kind ${normalizeText(resultKind)}`,
  );

  const accessory = firstDefined(
    state.antenna?.kind,
    state.antenna?.type,
    state.antenna?.id,
    state.antenna?.geometryKey,
    state.antenna?.deploymentKind,
    state.payload?.missionAccessoryId,
    state.payload?.accessoryId,
  );
  assert.ok(accessory !== undefined, 'antenna.kind or payload.missionAccessoryId is required');
  assert.ok(
    includesToken(accessory, contract.accessoryTokens),
    `${expectedMission}: antenna/sensor does not reflect the selected mission: ${normalizeText(accessory)}`,
  );
}

function assertWorkflowComplete(state, expectedMission) {
  assert.equal(state.phase, 'complete', `Final phase is ${state.phase}, expected complete`);
  assert.equal(booleanValue(state.complete?.done, state.complete?.complete, state.complete), true, 'complete flag is false');
  assertMissionPropagation(state, expectedMission);

  assert.equal(objectBoolean(state.airlock, 'cartInside', 'inside'), true, 'Airlock cart is not inside');
  assert.equal(objectBoolean(state.airlock, 'outerDoorClosed', 'outsideDoorClosed'), true, 'Outer airlock door is not closed');
  assert.equal(objectBoolean(state.airlock, 'innerDoorOpen', 'insideDoorOpen'), true, 'Inner airlock door is not open');
  const showerProgress = objectNumber(state.airShower, 'progress', 'cleanProgress');
  assert.ok(showerProgress !== undefined && showerProgress >= 0.99, `Air shower progress incomplete: ${showerProgress}`);
  assert.equal(objectBoolean(state.airShower, 'clean', 'complete', 'cleanComplete'), true, 'Air shower is not clean/complete');

  assert.equal(objectBoolean(state.integration, 'busIntegrated', 'busOnStand', 'integrated', 'complete'), true, 'Satellite bus is not integrated');
  assert.equal(objectBoolean(state.integration, 'locked', 'standLocked'), true, 'Satellite bus is not locked to its stand');

  const manualPayloads = objectNumber(state.payload, 'manualInstalled', 'manualCount', 'playerInstalled');
  const totalPayloads = objectNumber(state.payload, 'total', 'totalCount', 'planned');
  assert.ok(manualPayloads !== undefined && manualPayloads >= 3, `Expected at least 3 manually installed payload modules, got ${manualPayloads}`);
  assert.ok(totalPayloads !== undefined && totalPayloads >= manualPayloads, `Invalid payload total ${totalPayloads}/${manualPayloads}`);

  const cablesConnected = objectNumber(state.harness, 'connected', 'connectedCount', 'completeCount');
  const cablesTotal = objectNumber(state.harness, 'total', 'totalCount');
  assert.ok(cablesTotal > 0 && cablesConnected === cablesTotal, `Harness incomplete: ${cablesConnected}/${cablesTotal}`);

  const blanketsInstalled = objectNumber(state.blanket, 'installed', 'installedCount', 'completeCount');
  const blanketsTotal = objectNumber(state.blanket, 'total', 'totalCount');
  assert.ok(blanketsTotal >= 2 && blanketsTotal <= 4 && blanketsInstalled === blanketsTotal,
    `Blankets incomplete or outside 2-4 contract: ${blanketsInstalled}/${blanketsTotal}`);

  assert.equal(objectBoolean(state.arrays, 'leftInstalled'), true, 'Left solar array is not installed');
  assert.equal(objectBoolean(state.arrays, 'rightInstalled'), true, 'Right solar array is not installed');
  const leftDeployment = objectNumber(state.arrays, 'leftDeployment', 'leftProgress');
  const rightDeployment = objectNumber(state.arrays, 'rightDeployment', 'rightProgress');
  assert.ok(leftDeployment >= 0.99 && rightDeployment >= 0.99,
    `Solar arrays are not fully deployed: ${leftDeployment}/${rightDeployment}`);
  assert.equal(objectBoolean(state.arrays, 'leftLocked'), true, 'Left solar array is not locked');
  assert.equal(objectBoolean(state.arrays, 'rightLocked'), true, 'Right solar array is not locked');

  assert.equal(objectBoolean(state.antenna, 'installed'), true, 'Antenna is not installed');
  assert.ok(objectNumber(state.antenna, 'deployment', 'progress') >= 0.99, 'Antenna is not fully deployed');
  assert.equal(objectBoolean(state.antenna, 'locked'), true, 'Antenna is not locked');

  const lampsLit = objectNumber(state.test, 'lampsLit', 'lit', 'confirmed');
  const totalLamps = objectNumber(state.test, 'totalLamps', 'lampsTotal', 'total');
  assert.equal(objectBoolean(state.test, 'complete', 'passed'), true, 'Gentle test is incomplete');
  assert.ok(totalLamps >= 3 && lampsLit === totalLamps, `Test lamps incomplete: ${lampsLit}/${totalLamps}`);
  assert.equal(objectBoolean(state.orbit, 'active', 'inOrbit'), true, 'Satellite did not reach orbit');
  assert.equal(objectBoolean(state.missionResult, 'visible', 'resultVisible', 'displayed', 'active'), true, 'Mission result is not visible');

  const replayVisible = booleanValue(state.replay?.visible, state.replay?.replayVisible, state.replay);
  assert.equal(replayVisible, true, 'Replay control is not visible');

  const technicianCount = objectNumber(state.technicians, 'count', 'total', 'planned');
  assert.ok(technicianCount >= 6 && technicianCount <= 10, `Technician count must be 6-10, got ${technicianCount}`);
  const roleText = normalizeText(firstDefined(
    state.technicians?.roles,
    state.technicians?.byRole,
    state.technicians?.roleCounts,
  ));
  for (const role of ['crane', 'mechanical', 'electrical', 'test', 'control']) {
    const aliases = role === 'mechanical' ? ['mechanical', 'mechanic']
      : role === 'electrical' ? ['electrical', 'electric']
        : role === 'control' ? ['control', 'mission'] : [role];
    assert.ok(aliases.some((alias) => roleText.includes(alias)), `Technician role missing: ${role}`);
  }
  const heights = firstDefined(state.technicians?.adultHeightRange, state.technicians?.heightRange);
  if (Array.isArray(heights) && heights.length >= 2) {
    assert.ok(heights[0] >= 1.5 && heights[1] <= 1.9, `Technician adult scale is invalid: ${heights}`);
  } else if (heights && typeof heights === 'object') {
    assert.ok(heights.min >= 1.5 && heights.max <= 1.9,
      `Technician adult scale is invalid: ${JSON.stringify(heights)}`);
  }

  assert.ok(state.spatialValidation && typeof state.spatialValidation === 'object', 'spatialValidation is missing');
  assertIssuesEmpty(state.spatialValidation, 'spatialValidation');
  assertMetricZero(
    { technicians: state.technicians, spatial: state.spatialValidation },
    'collision validation',
    /collision/i,
  );
  assertCapacityWithinLimits(state.spatialValidation, 'capacity validation');

  assert.equal(state.renderer?.isWebGL2, true, `Renderer context is ${state.renderer?.contextName}, not WebGL2`);
  assert.equal(booleanValue(state.audio?.unlocked, state.audio?.started), true, 'WebAudio was not unlocked by touch input');
}

async function samplePerformance(page, durationMs) {
  return page.evaluate((duration) => new Promise((resolve) => {
    const frames = [];
    let previous = performance.now();
    const started = previous;
    function frame(now) {
      frames.push(now - previous);
      previous = now;
      if (now - started < duration) {
        requestAnimationFrame(frame);
        return;
      }
      const sorted = frames.slice(1).sort((a, b) => a - b);
      const renderer = window.__satellite?.renderer;
      const gl = renderer?.getContext?.();
      let unmaskedRenderer = null;
      try {
        const extension = gl?.getExtension?.('WEBGL_debug_renderer_info');
        if (extension) unmaskedRenderer = gl.getParameter(extension.UNMASKED_RENDERER_WEBGL);
      } catch {
        // Debug renderer info is optional.
      }
      resolve({
        durationMs: now - started,
        frames: frames.length,
        fps: frames.length * 1000 / (now - started),
        p50: sorted[Math.floor(sorted.length * 0.50)] || null,
        p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] || null,
        max: sorted.at(-1) || null,
        renderer: unmaskedRenderer,
        renderInfo: renderer?.info ? {
          calls: renderer.info.render?.calls,
          triangles: renderer.info.render?.triangles,
          geometries: renderer.info.memory?.geometries,
          textures: renderer.info.memory?.textures,
          resolutionScale: renderer.userData?.resolutionScale ?? null,
        } : null,
      });
    }
    requestAnimationFrame(frame);
  }), durationMs);
}

async function testMuteUi(page) {
  const toggle = page.locator('#audio-toggle, [data-audio-toggle], button[aria-label*="おと"], button[aria-label*="sound" i]').first();
  assert.ok(await toggle.count(), 'Audio toggle UI is missing');
  const inspect = async () => ({
    state: (await readState(page))?.audio,
    pressed: await toggle.getAttribute('aria-pressed'),
    label: await toggle.getAttribute('aria-label'),
    text: (await toggle.textContent())?.trim() || '',
  });
  const before = await inspect();
  await toggle.click();
  await sleep(180);
  const muted = await inspect();
  assert.equal(booleanValue(muted.state?.muted), true, 'Audio state did not become muted');
  assert.equal(muted.pressed, 'true', 'Mute UI aria-pressed did not become true');
  assert.ok(muted.label, 'Mute UI lost its accessible label');
  assert.ok(muted.text !== before.text || muted.label !== before.label, 'Mute UI did not visibly/accessibly change');
  await toggle.click();
  await sleep(180);
  const restored = await inspect();
  assert.equal(booleanValue(restored.state?.muted), false, 'Audio state did not unmute');
  assert.equal(restored.pressed, 'false', 'Mute UI aria-pressed did not return to false');
  return { before, muted, restored };
}

async function exerciseFreeMode(page, cdp, scenario) {
  const state = await readState(page);
  const targets = state?.targets || [];
  validateTargets(targets, scenario.width, scenario.height, 'complete:free-mode');
  const operations = [
    { name: 'rotate', pattern: /rotate|turn/i },
    { name: 'signal', pattern: /signal|send/i },
    { name: 'earth', pattern: /earth|ground|island|ship|cloud|ocean/i },
    // A single cycle target deliberately performs both fold and redeploy.
    { name: 'fold-redeploy', pattern: /fold|retract|cycle/i },
  ];
  const used = [];
  for (const operation of operations) {
    const fresh = await readState(page);
    const target = (fresh?.targets || []).find((candidate) => operation.pattern.test(targetIdentity(candidate)));
    assert.ok(target, `Complete free mode is missing the ${operation.name} target`);
    const before = stateFingerprint(fresh);
    const action = await actOnTarget(cdp, target);
    let after = await readState(page);
    const changed = stateFingerprint(after) !== before;
    assert.ok(changed, `Free-mode ${operation.name} gesture produced no debug-visible effect`);
    if (operation.name === 'fold-redeploy') {
      try {
        await page.waitForFunction(() => {
          const debug = window.__satellite;
          return debug && !debug.busy
            && debug.arrays?.leftDeployment >= 0.99
            && debug.arrays?.leftLocked === true;
        }, null, { timeout: Math.max(ACTION_TIMEOUT_MS, 90_000) });
      } catch {
        after = await readState(page);
        throw new Error(`Free-mode fold/redeploy did not relock: ${JSON.stringify({
          busy: after?.busy,
          busyReasons: after?.busyReasons,
          arrays: after?.arrays,
          replay: after?.replay,
        })}`);
      }
      after = await readState(page);
    }
    used.push({ name: operation.name, id: targetIdentity(target), action, changed, after: {
      replay: after?.replay,
      signals: after?.missionResult?.signals,
      leftDeployment: after?.arrays?.leftDeployment,
      leftLocked: after?.arrays?.leftLocked,
    } });
  }
  return { exposedTargets: targets.map(targetIdentity), actions: used };
}

async function testReplay(page, cdp, scenario) {
  const before = await readState(page);
  const replay = page.locator('#replay, #replay-button, [data-replay]').first();
  assert.ok(await replay.count(), 'Replay UI is missing');
  await replay.click();
  await page.waitForFunction(() => window.__satellite?.phase === 'chooseMission', null, { timeout: 20_000 });
  await sleep(200);
  const reset = await readState(page);
  assert.equal(reset.phase, 'chooseMission', 'Replay did not reset to chooseMission');
  assert.equal(isComplete(reset), false, 'Complete flag remained set after replay');
  assert.equal(normalizeMission(reset.mission), null, 'Mission did not reset on replay');
  const manual = objectNumber(reset.payload, 'manualInstalled', 'manualCount', 'playerInstalled');
  const cables = objectNumber(reset.harness, 'connected', 'connectedCount');
  const blankets = objectNumber(reset.blanket, 'installed', 'installedCount');
  if (manual !== undefined) assert.equal(manual, 0, 'Payload count did not reset');
  if (cables !== undefined) assert.equal(cables, 0, 'Harness count did not reset');
  if (blankets !== undefined) assert.equal(blankets, 0, 'Blanket count did not reset');
  const geometriesBefore = numberValue(before?.renderer?.geometries);
  const geometriesAfterReset = numberValue(reset?.renderer?.geometries);
  if (geometriesBefore !== undefined && geometriesAfterReset !== undefined) {
    assert.ok(geometriesAfterReset <= geometriesBefore + 2,
      `Replay leaked renderer geometries: ${geometriesBefore} -> ${geometriesAfterReset}`);
  }
  validateTargets(reset.targets, scenario.width, scenario.height, 'replay:chooseMission');
  const missionTarget = chooseMissionTarget(reset.targets, scenario.mission);
  await actOnTarget(cdp, missionTarget);
  const deadline = Date.now() + 10_000;
  let selected = null;
  while (Date.now() < deadline) {
    selected = await readState(page);
    if (normalizeMission(selected?.mission) === scenario.mission) break;
    await sleep(120);
  }
  assert.equal(normalizeMission(selected?.mission), scenario.mission, 'Replay session cannot select a mission');
  return { reset: true, missionSelectable: true, geometriesBefore, geometriesAfterReset };
}

function installErrorCapture(page, baseUrl) {
  const capture = {
    consoleErrors: [],
    pageErrors: [],
    requestFailures: [],
    httpErrors: [],
    externalRequests: [],
  };
  const allowedOrigin = new URL(baseUrl).origin;
  page.on('console', (message) => {
    if (message.type() === 'error') capture.consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => capture.pageErrors.push(String(error)));
  page.on('requestfailed', (request) => {
    capture.requestFailures.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) capture.httpErrors.push(`${response.status()} ${response.url()}`);
  });
  page.on('request', (request) => {
    const url = request.url();
    if (/^(data:|blob:|about:)/.test(url)) return;
    try {
      if (new URL(url).origin !== allowedOrigin) capture.externalRequests.push(url);
    } catch {
      capture.externalRequests.push(url);
    }
  });
  return capture;
}

function assertNoErrors(capture) {
  for (const [kind, entries] of Object.entries(capture)) {
    assert.equal(entries.length, 0, `${kind}: ${entries.join('\n')}`);
  }
}

async function autoplayScenario(browser, baseUrl, scenario) {
  const directory = path.join(OUTPUT_ROOT, scenario.name);
  await fsp.mkdir(directory, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: scenario.width, height: scenario.height },
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: scenario.width < scenario.height,
    locale: 'ja-JP',
    colorScheme: 'light',
    reducedMotion: 'no-preference',
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const errors = installErrorCapture(page, baseUrl);
  const result = {
    ...scenario,
    startedAt: nowIso(),
    screenshots: [],
    actions: [],
    renderPeak: { calls: 0, triangles: 0, geometries: 0, textures: 0 },
    errors,
    pass: false,
  };

  try {
    await page.goto(new URL('index.html', baseUrl).href, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForFunction(() => window.__satellite && window.__satellite.phase !== 'loading', null, { timeout: 30_000 });
    const webgl2 = await page.evaluate(() => {
      const renderer = window.__satellite?.renderer;
      const context = renderer?.getContext?.();
      return {
        contextName: context?.constructor?.name || null,
        isWebGL2: typeof WebGL2RenderingContext !== 'undefined' && context instanceof WebGL2RenderingContext,
      };
    });
    assert.equal(webgl2.isWebGL2, true, `WebGL2 required, got ${webgl2.contextName}`);
    result.webgl = webgl2;

    const phaseShots = new Set();
    const seenPhases = [];
    const actionCounts = new Map();
    let highestPhase = -1;
    let orientationDone = false;
    let pauseDone = false;
    let screenshotIndex = 0;
    const deadline = Date.now() + GLOBAL_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const state = await readState(page);
      assert.ok(state, 'window.__satellite disappeared');
      const phaseIndex = EXPECTED_PHASES.indexOf(state.phase);
      assert.ok(phaseIndex >= 0, `Unknown phase: ${state.phase}`);
      assert.ok(phaseIndex >= highestPhase, `Phase regressed from ${EXPECTED_PHASES[highestPhase]} to ${state.phase}`);
      if (phaseIndex > highestPhase) {
        assert.equal(phaseIndex, highestPhase + 1, `Phase skipped: expected ${EXPECTED_PHASES[highestPhase + 1]}, got ${state.phase}`);
        highestPhase = phaseIndex;
        seenPhases.push(state.phase);
      }

      const render = state.renderer || {};
      for (const key of Object.keys(result.renderPeak)) {
        result.renderPeak[key] = Math.max(result.renderPeak[key], Number(render[key]) || 0);
      }

      validateTargets(state.targets, scenario.width, scenario.height, state.phase);
      if (!state.busy && !phaseShots.has(state.phase)) {
        await sleep(120);
        const still = await readState(page);
        if (still?.phase === state.phase) {
          screenshotIndex += 1;
          result.screenshots.push(await takeScreenshot(page, directory, screenshotIndex, state.phase));
          phaseShots.add(state.phase);
        }
      }

      if (isComplete(state)) break;
      if (state.busy || !state.targets.length) {
        await sleep(110);
        continue;
      }

      if (scenario.orientationTest && !orientationDone && state.phase === 'harness') {
        result.orientation = await testOrientation(page, scenario, directory);
        orientationDone = true;
        continue;
      }
      if (scenario.pauseTest && !pauseDone && state.phase === 'test') {
        result.pauseResume = await testPauseResume(page, cdp);
        pauseDone = true;
        continue;
      }

      const target = state.phase === 'chooseMission'
        ? chooseMissionTarget(state.targets, scenario.mission)
        : chooseLeastUsedTarget(state.targets, actionCounts, state.phase);
      const id = targetIdentity(target, state.targets.indexOf(target));
      const actionKey = `${state.phase}:${id}`;
      const count = (actionCounts.get(actionKey) || 0) + 1;
      assert.ok(count <= 24, `Target ${id} repeated ${count} times without completing ${state.phase}`);
      actionCounts.set(actionKey, count);
      const action = await actOnTarget(cdp, target);
      result.actions.push({ at: Date.now(), phase: state.phase, id, action });
      await waitForStateChange(page, state);
    }

    const finalState = await readState(page);
    assert.ok(Date.now() < deadline, `Scenario exceeded ${GLOBAL_TIMEOUT_MS}ms; last state=${JSON.stringify(finalState)}`);
    assert.deepEqual(seenPhases, EXPECTED_PHASES, `Phase story mismatch: ${seenPhases.join(' -> ')}`);
    if (!phaseShots.has('complete')) {
      screenshotIndex += 1;
      result.screenshots.push(await takeScreenshot(page, directory, screenshotIndex, 'complete'));
      phaseShots.add('complete');
    }
    assert.deepEqual([...phaseShots], EXPECTED_PHASES, `Missing phase screenshots: ${EXPECTED_PHASES.filter((phase) => !phaseShots.has(phase))}`);
    assertWorkflowComplete(finalState, scenario.mission);
    result.finalState = finalState;
    result.freeMode = await exerciseFreeMode(page, cdp, scenario);
    result.muteUi = await testMuteUi(page);
    result.performance = await samplePerformance(page, PERF_DURATION_MS);
    assert.ok(result.performance.fps >= MIN_SWIFTSHADER_FPS,
      `Performance ${result.performance.fps.toFixed(1)}fps < ${MIN_SWIFTSHADER_FPS}fps SwiftShader floor`);
    assert.ok(result.performance.p95 <= MAX_SWIFTSHADER_P95_MS,
      `Performance p95 ${result.performance.p95.toFixed(1)}ms > ${MAX_SWIFTSHADER_P95_MS}ms SwiftShader ceiling`);
    result.replay = await testReplay(page, cdp, scenario);

    if (scenario.orientationTest) assert.ok(orientationDone, 'Orientation test never reached harness');
    if (scenario.pauseTest) assert.ok(pauseDone, 'Pause/resume test never reached test phase');
    assertNoErrors(errors);
    result.pass = true;
    result.completedAt = nowIso();
    return result;
  } catch (error) {
    result.failure = errorText(error);
    try {
      result.failureState = await readState(page);
      result.screenshots.push(await takeScreenshot(page, directory, 99, 'failure'));
    } catch (captureError) {
      result.captureFailure = errorText(captureError);
    }
    return result;
  } finally {
    await context.close();
  }
}

function validateDeterminism(results) {
  const notes = [];
  const weather = results.filter((result) => result.pass && result.mission === 'weather');
  if (weather.length >= 2) {
    const hashes = weather.map((result) => result.finalState?.planHash).filter((value) => value !== undefined && value !== null);
    if (hashes.length === weather.length) {
      assert.ok(hashes.every((value) => value === hashes[0]), `Weather plan hashes differ by viewport: ${hashes.join(', ')}`);
      notes.push(`weather plan hash stable: ${hashes[0]}`);
    } else {
      notes.push('planHash not exposed by every weather run; fixed-seed cross-viewport comparison skipped');
    }
  }
  const byMission = new Map();
  for (const result of results.filter((item) => item.pass)) {
    const hash = result.finalState?.planHash;
    if (hash !== undefined && hash !== null && !byMission.has(result.mission)) byMission.set(result.mission, hash);
  }
  if (byMission.size === 3) {
    assert.equal(new Set(byMission.values()).size, 3, 'Mission-specific plans unexpectedly have identical hashes');
    notes.push('all three mission plan hashes are distinct');
  }
  return notes;
}

async function main() {
  await fsp.mkdir(OUTPUT_ROOT, { recursive: true });
  const report = {
    startedAt: nowIso(),
    projectRoot: PROJECT_ROOT,
    outputRoot: OUTPUT_ROOT,
    expectedPhases: EXPECTED_PHASES,
    thresholds: {
      scenarioTimeoutMs: GLOBAL_TIMEOUT_MS,
      actionTimeoutMs: ACTION_TIMEOUT_MS,
      performanceDurationMs: PERF_DURATION_MS,
      minSwiftShaderFps: MIN_SWIFTSHADER_FPS,
      maxSwiftShaderP95Ms: MAX_SWIFTSHADER_P95_MS,
    },
    scenarios: [],
    pass: false,
  };

  let localServer = null;
  let browser = null;
  try {
    const chromium = await loadPlaywright();
    const executablePath = discoverChromium(chromium);
    report.chromiumExecutable = executablePath || 'playwright-default';
    const configuredBase = process.env.BASE_URL || process.env.SATELLITE_BASE_URL;
    if (configuredBase) report.baseUrl = configuredBase.endsWith('/') ? configuredBase : `${configuredBase}/`;
    else {
      localServer = await startStaticServer(PROJECT_ROOT);
      report.baseUrl = localServer.baseUrl;
    }

    const launchOptions = {
      headless: true,
      args: [
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
      ],
    };
    if (executablePath) launchOptions.executablePath = executablePath;
    browser = await chromium.launch(launchOptions);
    report.browserVersion = await browser.version();

    for (const scenario of RUN_SCENARIOS) {
      const result = await autoplayScenario(browser, report.baseUrl, scenario);
      report.scenarios.push(result);
      const status = result.pass ? 'PASS' : 'FAIL';
      console.log(`${status} ${scenario.name}${result.failure ? `: ${result.failure.split('\n')[0]}` : ''}`);
    }

    try {
      report.determinism = validateDeterminism(report.scenarios);
    } catch (error) {
      report.determinismFailure = errorText(error);
    }
    report.pass = report.scenarios.every((scenario) => scenario.pass) && !report.determinismFailure;
  } catch (error) {
    report.fatal = errorText(error);
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (localServer) await localServer.close().catch(() => {});
    report.completedAt = nowIso();
    await fsp.writeFile(path.join(OUTPUT_ROOT, 'verify-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  }

  if (!report.pass) {
    console.error(`Verification failed. Report: ${path.join(OUTPUT_ROOT, 'verify-report.json')}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: all satellite-cleanroom scenarios. Report: ${path.join(OUTPUT_ROOT, 'verify-report.json')}`);
  }
}

await main();
