import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

/**
 * End-to-end operation of the whole build chain, driven through the same
 * control callbacks the touch console uses.
 *
 * Headless animation frames are throttled hard on a software renderer, so the
 * suite advances the simulation itself in fixed slices instead of waiting them
 * out. Every rate limit, transition and completion rule exercised below is the
 * shipping one.
 */

interface GameState {
  phase: string;
  raiseFraction: number;
  seatT: number;
  clamped: number;
  leanAngle: number;
  guyTensions: number[];
  plumbRound: number;
  strapsReleased: number;
  bundle: number;
  canopyRadius: number;
  harnessPayOut: number;
  harnessHoist: number;
  starProgress: number;
  starSeated: number;
  lighting: string;
  treeBrightness: number;
  lampCount: number;
  foliageInstances: number;
  timeOfDay: number;
  portrait: boolean;
  shot: string;
  treeTipY: number;
  tier: string;
}

declare global {
  interface Window {
    __tree: {
      state: () => GameState;
      hold: (id: string, on: boolean) => boolean;
      drag: (id: string, amount: number) => boolean;
      press: (id: string) => boolean;
      setTimeScale: (v: number) => void;
      hasControl: (id: string) => boolean;
      tick: (seconds: number) => void;
    };
  }
}

const SHOTS = 'test-results/shots';
mkdirSync(SHOTS, { recursive: true });

const state = (page: Page): Promise<GameState> => page.evaluate(() => window.__tree.state());
const tick = (page: Page, seconds: number) => page.evaluate((s) => window.__tree.tick(s), seconds);
const drag = (page: Page, id: string, amount: number) =>
  page.evaluate(([i, a]) => window.__tree.drag(i as string, a as number), [id, amount] as const);
const hold = (page: Page, id: string, on: boolean) =>
  page.evaluate(([i, o]) => window.__tree.hold(i as string, o as boolean), [id, on] as const);
const press = (page: Page, id: string) => page.evaluate((i) => window.__tree.press(i), id);
const hasControl = (page: Page, id: string) => page.evaluate((i) => window.__tree.hasControl(i), id);

const boot = async (page: Page): Promise<void> => {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__tree, null, { timeout: 30_000 });
};

/** Advance simulated time until `predicate` holds, running `onTick` each slice. */
const until = async (
  page: Page,
  predicate: (s: GameState) => boolean,
  simSeconds: number,
  onTick?: (s: GameState) => Promise<void>,
  slice = 0.2,
): Promise<GameState> => {
  let last = await state(page);
  for (let t = 0; t < simSeconds; t += slice) {
    if (predicate(last)) return last;
    await onTick?.(last);
    await tick(page, slice);
    last = await state(page);
  }
  expect(predicate(last), `timed out; last state ${JSON.stringify(last)}`).toBeTruthy();
  return last;
};

/** Wind whichever guy leg is slackest — the same read the player gets visually. */
const trimGuys = async (page: Page, s: GameState): Promise<void> => {
  let slack = 0;
  for (let i = 1; i < s.guyTensions.length; i++) {
    if (s.guyTensions[i] < s.guyTensions[slack]) slack = i;
  }
  await drag(page, `drum${slack}`, -0.06);
};

test('the whole chain runs from the trailer to the switch-on', async ({ page }, info) => {
  const shot = (name: string) =>
    page.screenshot({ path: `${SHOTS}/${info.project.name}-${name}.png` });

  await boot(page);

  // --- the load on the trailer is not yet a tree ---------------------------
  const arrival = await state(page);
  expect(arrival.phase).toBe('arrival');
  expect(arrival.bundle).toBeGreaterThan(0.9);
  expect(arrival.foliageInstances).toBeGreaterThan(2000);
  // Strapped and lying down, the crown is a narrow wrapped column.
  const bundledRadius = arrival.canopyRadius;
  expect(bundledRadius).toBeLessThan(2.6);
  await shot('01-arrival');

  await tick(page, 4);
  expect(await hasControl(page, 'begin')).toBe(true);
  await press(page, 'begin');

  // --- rigging: two slings onto the stem -----------------------------------
  await until(page, (s) => s.phase !== 'rigging', 40, async () => {
    await drag(page, 'hook', 0.12);
  });
  await shot('02-rigging');

  // --- raising: one continuous shot, monotonic, never cut -------------------
  expect((await state(page)).phase).toBe('raising');
  await hold(page, 'hoist', true);
  let previous = 0;
  let midShot = false;
  const raised = await until(page, (s) => s.phase !== 'raising', 60, async (s) => {
    expect(s.shot).toBe('raising');
    expect(s.raiseFraction).toBeGreaterThanOrEqual(previous - 1e-6);
    previous = s.raiseFraction;
    if (!midShot && s.raiseFraction > 0.45) {
      midShot = true;
      await shot('03-raising');
    }
  });
  expect(raised.phase).toBe('seating');
  expect(previous).toBeGreaterThan(0.95);
  await shot('04-upright');

  // --- seating into the steel socket ---------------------------------------
  const seated = await until(page, (s) => s.phase === 'plumbing', 40);
  await hold(page, 'hoist', false);
  expect(seated.seatT).toBeGreaterThan(0.98);
  expect(seated.clamped).toBeGreaterThan(0.99);
  await shot('05-seated');

  // --- plumbing: three rounds, the last two unguided ------------------------
  const leanAtStart = (await state(page)).leanAngle;
  expect(leanAtStart).toBeGreaterThan(0.005);
  const roundsSeen = new Set<number>();
  await until(page, (s) => s.phase !== 'plumbing', 180, async (s) => {
    roundsSeen.add(s.plumbRound);
    await trimGuys(page, s);
  });
  expect(Array.from(roundsSeen).sort()).toEqual([0, 1, 2]);
  await shot('06-plumb');

  // --- branch release: the crown has to actually get bigger -----------------
  const beforeRelease = (await state(page)).canopyRadius;
  await until(page, (s) => s.phase !== 'release', 60, async () => {
    await drag(page, 'strap', 1.2);
  });
  const afterRelease = await state(page);
  expect(afterRelease.strapsReleased).toBe(4);
  expect(afterRelease.bundle).toBeLessThan(0.12);
  expect(afterRelease.canopyRadius).toBeGreaterThan(beforeRelease * 1.5);
  await shot('07-released');

  // --- light harness: fetched only at this step ----------------------------
  await expect
    .poll(() => hasControl(page, 'reel'), { timeout: 30_000 })
    .toBe(true);
  await until(page, (s) => s.harnessPayOut >= 0.999, 40, async () => {
    await drag(page, 'reel', 0.25);
  });
  await hold(page, 'winch', true);
  await until(page, (s) => s.phase === 'star', 40);
  await hold(page, 'winch', false);
  const harness = await state(page);
  expect(harness.lampCount).toBeGreaterThan(400);
  await shot('08-harness');

  // --- star hoist -----------------------------------------------------------
  await hold(page, 'hoist', true);
  let starShot = false;
  await until(page, (s) => s.phase === 'test', 60, async (s) => {
    if (!starShot && s.starProgress > 0.45) {
      starShot = true;
      await shot('09-star');
    }
  });
  await hold(page, 'hoist', false);
  const star = await state(page);
  expect(star.starProgress).toBeGreaterThan(0.99);
  expect(star.starSeated).toBeGreaterThan(0.9);
  expect(star.treeTipY).toBeGreaterThan(15);

  // --- sector test finds the dark sector ------------------------------------
  await press(page, 'test');
  await until(page, (s) => s.lighting === 'stalled', 20);
  expect(await hasControl(page, 'plug')).toBe(true);
  await shot('10-sector-fault');
  await until(page, (s) => s.lighting !== 'stalled', 20, async () => {
    await drag(page, 'plug', 0.7);
  });
  await until(page, (s) => s.phase === 'ceremony', 30);

  // --- ceremony: three lamps, then the enable handle -------------------------
  await until(page, () => false, 5, undefined, 0.5).catch(() => undefined);
  expect(await hasControl(page, 'enable')).toBe(true);
  const beforeLight = await state(page);
  expect(beforeLight.treeBrightness).toBeLessThan(0.05);
  // Night arrived on its own, with no skybox swap.
  expect(beforeLight.timeOfDay).toBeGreaterThan(0.7);

  await press(page, 'enable');
  // The switch-on climbs from the base rather than flashing on.
  await tick(page, 0.2);
  const early = await state(page);
  expect(early.treeBrightness).toBeLessThan(0.85);
  await until(page, (s) => s.treeBrightness > 0.9, 10, undefined, 0.1);
  await until(page, (s) => s.phase === 'finale', 10, undefined, 0.1);
  await tick(page, 1);
  await page.waitForTimeout(400);
  await shot('11-lit');

  // --- replay ---------------------------------------------------------------
  expect(await hasControl(page, 'replay')).toBe(true);
  await press(page, 'replay');
  const replay = await state(page);
  expect(replay.phase).toBe('arrival');
  expect(replay.bundle).toBeGreaterThan(0.5);
  expect(replay.lighting).toBe('dark');
});

test('the console adapts to the screen shape', async ({ page }) => {
  await boot(page);
  const s = await state(page);
  const viewport = page.viewportSize();
  expect(s.portrait).toBe((viewport?.height ?? 0) >= (viewport?.width ?? 0));
  await expect(page.locator('[data-testid="hint"]')).toBeVisible();
});
