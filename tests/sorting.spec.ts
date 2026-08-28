import { expect, test, type Page } from '@playwright/test';

type State = {
  round: number;
  step: string;
  oneCondition: boolean;
  swipePending: boolean;
  letters: number;
  filedTotal: number;
  activeDestination: string | null;
  activeDispatch: string | null;
  postmarked: boolean;
  pressPhase: string;
  bays: {
    id: string;
    destination: string;
    dispatch: string | null;
    filed: number;
    load: number;
    closed: boolean;
    sealed: boolean;
    windowOpen: boolean;
  }[];
  lamps: string[];
  doorOpen: number;
};

const state = (page: Page) => page.evaluate(() => window.__santa!.state() as unknown) as Promise<State>;
const point = (page: Page, id: string) => page.evaluate((i) => window.__santa!.point(i), id);

async function waitStep(page: Page, pred: (s: State) => boolean, message: string, timeout = 60_000) {
  await expect
    .poll(async () => (pred(await state(page)) ? 'ok' : JSON.stringify((await state(page)).step)), {
      timeout,
      message,
      intervals: [120],
    })
    .toBe('ok');
}

async function drag(page: Page, from: { x: number; y: number }, dx: number, dy: number, steps = 14) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + (dx * i) / steps, from.y + (dy * i) / steps);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
}

/** Wait until a touch target is actually inside the viewport, then hand back its point. */
async function pointOnScreen(page: Page, id: string, label = id, timeout = 20_000) {
  const vp = page.viewportSize()!;
  const t0 = Date.now();
  let last: { x: number; y: number } | null = null;
  for (;;) {
    last = await point(page, id);
    if (last && last.x > 6 && last.y > 6 && last.x < vp.width - 6 && last.y < vp.height - 6) {
      return last;
    }
    if (Date.now() - t0 > timeout) {
      throw new Error(`${label} never came on screen (last: ${JSON.stringify(last)})`);
    }
    await page.waitForTimeout(150);
  }
}

/**
 * A shot may still be gliding when a drag starts, so re-aim and try again.
 * A child waits for the camera to settle; the test has to be told to.
 */
async function retryDrag(
  page: Page,
  id: string,
  dx: number,
  dy: number,
  done: (s: State) => boolean,
  label = id,
) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const p = await pointOnScreen(page, id, label);
    await drag(page, p, dx, dy, 16);
    for (let i = 0; i < 14; i++) {
      if (done(await state(page))) return;
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(500);
  }
  throw new Error(`could not work ${label}`);
}

/** Carry the letter to a chute that may still be sliding as the camera settles. */
async function dragToBay(page: Page, bayId: string, steps = 16) {
  await pointOnScreen(page, `bay:${bayId}`, `chute ${bayId}`);
  const from = await pointOnScreen(page, 'envelope', 'letter');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    const to = (await point(page, `bay:${bayId}`))!;
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
    await page.waitForTimeout(20);
  }
  await page.mouse.up();
}

async function boot(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    // page errors and thrown exceptions matter; a missing sub-resource is not one
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__santa));
  await page.locator('#tapstart').click();
  await page.waitForFunction(() => window.__santa!.started());
  return errors;
}

/** Open the incoming bag: one sideways pull on the clasp. */
async function openIncomingBag(page: Page) {
  await waitStep(page, (s) => s.step === 'bagClasp', 'bag should ride in and stop');
  await page.waitForTimeout(900);
  await retryDrag(page, 'clasp', 160, 0, (s) => s.step !== 'bagClasp', 'bag clasp');
}

/** Face the letter up, cancel it under the press, and wait for the gate. */
async function postmarkNextLetter(page: Page) {
  await waitStep(page, (s) => s.step === 'flip' && s.swipePending, 'letter should wait face down');
  await page.waitForTimeout(900);
  await retryDrag(page, 'envelope', 160, 0, (s) => !s.swipePending, 'swipe to face up');

  await waitStep(page, (s) => s.step === 'press' && s.pressPhase === 'ready', 'press should wake');
  await page.waitForTimeout(900);
  await retryDrag(page, 'lever', 0, 240, (s) => s.postmarked, 'postmark lever');
  await waitStep(page, (s) => s.step === 'carry', 'safety gate should release the letter');
  // let the overhead shot settle before anything is carried across it
  await page.waitForTimeout(1400);
}

/** Carry the letter to a chute; returns after it has landed in the bag. */
async function sortActiveLetter(page: Page, opts: { tryWrongFirst?: boolean } = {}) {
  const before = (await state(page)).filedTotal;

  if (opts.tryWrongFirst) {
    const wrongId = await page.evaluate(() => window.__santa!.wrongBay());
    if (wrongId) {
      {
        await dragToBay(page, wrongId);
        // no punishment: the letter is still in hand and nothing was filed
        const s = await state(page);
        expect(s.filedTotal, 'a wrong drop must not file the letter').toBe(before);
        expect(s.bays.find((b) => b.id === wrongId)!.windowOpen, 'wrong window stays shut').toBe(false);
        await waitStep(page, (x) => x.step === 'carry', 'letter returns to the hand-off');
        await page.waitForTimeout(800);
      }
    }
  }

  const targetId = await page.evaluate(() => window.__santa!.targetBay());
  expect(targetId, 'every letter has a home').not.toBeNull();

  for (let attempt = 0; attempt < 3; attempt++) {
    await dragToBay(page, targetId!);
    for (let i = 0; i < 24; i++) {
      if ((await state(page)).filedTotal === before + 1) return targetId!;
      await page.waitForTimeout(200);
    }
    await page.waitForTimeout(600);
  }

  await waitStep(page, (s) => s.filedTotal === before + 1, 'letter should ride the chute into its bag');
  return targetId!;
}

/** Close the bag that is currently framed, then send it out or shelve it. */
async function closeAndSendBag(page: Page) {
  await waitStep(page, (s) => s.step === 'closeBag', 'a full bag should come up to be closed');

  for (let round = 0; round < 6; round++) {
    const s = await state(page);
    if (s.step === 'closeBag') {
      await page.waitForTimeout(1400);
      await retryDrag(page, 'cord', 0, 175, (x) => x.step !== 'closeBag', 'draw cord');
    } else if (s.step === 'dispatch') {
      await page.waitForTimeout(1400);
      await retryDrag(page, 'chain', 0, 175, (x) => x.step !== 'dispatch', 'dock chain');
    } else {
      return;
    }
  }
  throw new Error('bag never left the building');
}

test.describe('サンタ郵便中央局', () => {
  test('one letter travels from the incoming bag to the world map', async ({ page }) => {
    const errors = await boot(page);

    await openIncomingBag(page);
    await postmarkNextLetter(page);

    const before = await state(page);
    expect(before.activeDestination).toBe('lighthouse');
    expect(before.postmarked, 'the letter carries its cancellation').toBe(true);

    const bayId = await sortActiveLetter(page);
    expect(bayId).toContain('lighthouse');

    const filed = await state(page);
    const bay = filed.bays.find((b) => b.id === bayId)!;
    expect(bay.filed).toBe(1);
    expect(bay.load, 'the canvas bag takes the weight').toBeGreaterThan(0.3);

    await closeAndSendBag(page);

    await waitStep(page, (s) => s.doorOpen > 0.8, 'the loading door opens onto the snow');
    await waitStep(page, (s) => s.lamps.includes('lighthouse'), 'the map lamp lights on arrival', 90_000);

    const end = await state(page);
    expect(end.bays.find((b) => b.id === bayId)!.sealed).toBe(true);
    expect(errors, 'no runtime errors').toEqual([]);
  });

  test('round two sorts three letters by picture, and a wrong chute is not punished', async ({ page }) => {
    const errors = await boot(page);

    await openIncomingBag(page);
    await postmarkNextLetter(page);
    await sortActiveLetter(page);
    await closeAndSendBag(page);
    await waitStep(page, (s) => s.round === 2 && s.step === 'bagClasp', 'round two starts on its own', 120_000);

    expect((await state(page)).letters).toBe(3);
    expect((await state(page)).bays.length).toBe(3);

    await openIncomingBag(page);
    for (let i = 0; i < 3; i++) {
      await postmarkNextLetter(page);
      await sortActiveLetter(page, { tryWrongFirst: i === 0 });
    }

    const s = await state(page);
    expect(s.filedTotal).toBe(3);
    expect(new Set(s.bays.filter((b) => b.filed > 0).map((b) => b.destination)).size).toBe(3);
    expect(errors, 'no runtime errors').toEqual([]);
  });

  test('round three splits one destination by dispatch time, and the switch relaxes it', async ({ page }) => {
    const errors = await boot(page);
    await waitStep(page, (s) => s.step === 'bagArriving', 'first round is live');
    await page.evaluate(() => window.__santa!.startRound(3));
    await waitStep(page, (s) => s.round === 3 && s.step === 'bagClasp', 'round three arrives');

    const opening = await state(page);
    expect(opening.letters).toBe(5);
    expect(opening.bays.map((b) => b.id).sort()).toEqual([
      'forest:christmas',
      'forest:today',
      'lighthouse:any',
      'mountain:any',
    ]);

    await openIncomingBag(page);

    // letter one: forest, day mail
    await postmarkNextLetter(page);
    let s = await state(page);
    expect(s.activeDestination).toBe('forest');
    expect(await page.evaluate(() => window.__santa!.targetBay())).toBe(`forest:${s.activeDispatch}`);
    await sortActiveLetter(page);

    // letter two: same forest, kept until Christmas - the day chute must refuse it
    await postmarkNextLetter(page);
    s = await state(page);
    expect(s.activeDestination).toBe('forest');
    expect(s.activeDispatch).toBe('christmas');
    expect(await page.evaluate(() => window.__santa!.targetBay())).toBe('forest:christmas');

    const filedBefore = s.filedTotal;
    await dragToBay(page, 'forest:today');
    let after = await state(page);
    expect(after.filedTotal, 'the day chute keeps its window shut').toBe(filedBefore);
    expect(after.bays.find((b) => b.id === 'forest:today')!.windowOpen).toBe(false);
    await waitStep(page, (x) => x.step === 'carry', 'letter comes back to the hand');
    await page.waitForTimeout(900);

    // the switch drops back to a single condition: either forest bag will do
    await page.evaluate(() => window.__santa!.setOneCondition(true));
    expect(await page.evaluate(() => window.__santa!.targetBay())).toBe('forest:today');
    await dragToBay(page, 'forest:today');
    await waitStep(page, (x) => x.filedTotal === filedBefore + 1, 'one-condition mode accepts it');

    after = await state(page);
    expect(after.oneCondition).toBe(true);
    expect(errors, 'no runtime errors').toEqual([]);
  });

  test('turning the device keeps the letter, its cancellation and its chute', async ({ page }, testInfo) => {
    const errors = await boot(page);
    await openIncomingBag(page);
    await postmarkNextLetter(page);

    const before = await state(page);
    const size = page.viewportSize()!;
    await page.setViewportSize({ width: size.height, height: size.width });
    await page.waitForTimeout(700);

    const after = await state(page);
    expect(after.activeDestination).toBe(before.activeDestination);
    expect(after.activeDispatch).toBe(before.activeDispatch);
    expect(after.postmarked).toBe(true);
    expect(after.step).toBe('carry');

    // both the letter and every chute symbol stay reachable in the new orientation
    const env = await point(page, 'envelope');
    expect(env).not.toBeNull();
    expect(env!.x).toBeGreaterThan(0);
    expect(env!.x).toBeLessThan(size.height);
    for (const bay of after.bays) {
      const p = await point(page, `bay:${bay.id}`);
      expect(p, `${bay.id} on screen`).not.toBeNull();
      expect(p!.x).toBeGreaterThan(0);
      expect(p!.x).toBeLessThan(size.height);
      expect(p!.y).toBeGreaterThan(0);
      expect(p!.y).toBeLessThan(size.width);
    }

    await sortActiveLetter(page);
    expect((await state(page)).filedTotal).toBe(1);
    expect(errors, 'no runtime errors').toEqual([]);
    testInfo.annotations.push({ type: 'orientation', description: 'rotated mid-run' });
  });
});
