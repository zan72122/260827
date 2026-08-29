import type { Page } from '@playwright/test';

export interface Snapshot {
  phase: string;
  half: number;
  fold: number;
  dry: number;
  released: number;
  net: number;
  run: number;
  variant: string;
  gateHalf: number;
}

declare global {
  interface Window {
    __ctg: {
      phase(): string;
      run(): number;
      variant(): string;
      tier(): string;
      counts(): { wood: number; tufts: number };
      halfWidth(): number;
      gateHalfWidth(): number;
      foldAverage(): number;
      dryReserve(): number;
      released(): number;
      netCover(): number;
      anchor(name: string): { x: number; y: number };
    };
  }
}

export async function boot(page: Page, query = 'q=low&speed=6'): Promise<void> {
  await page.goto(`/?${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.__ctg !== 'undefined');
  await page.waitForTimeout(2500);
}

export function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => ({
    phase: window.__ctg.phase(),
    half: window.__ctg.halfWidth(),
    fold: window.__ctg.foldAverage(),
    dry: window.__ctg.dryReserve(),
    released: window.__ctg.released(),
    net: window.__ctg.netCover(),
    run: window.__ctg.run(),
    variant: window.__ctg.variant(),
    gateHalf: window.__ctg.gateHalfWidth(),
  }));
}

export function anchor(page: Page, name: string): Promise<{ x: number; y: number }> {
  return page.evaluate((n) => window.__ctg.anchor(n), name);
}

export async function waitForPhase(page: Page, want: string | string[], timeoutMs = 120_000): Promise<Snapshot> {
  const list = Array.isArray(want) ? want : [want];
  const start = Date.now();
  for (;;) {
    const s = await snapshot(page);
    if (list.includes(s.phase)) return s;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`stuck in "${s.phase}" waiting for ${list.join('/')}`);
    }
    await page.waitForTimeout(200);
  }
}

export async function swipe(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 12,
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(
      from.x + ((to.x - from.x) * i) / steps,
      from.y + ((to.y - from.y) * i) / steps,
    );
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
}

/** One finger, held on the safety lever. */
export async function holdLever(page: Page, ms: number): Promise<void> {
  const p = await anchor(page, 'lever');
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await page.waitForTimeout(150);
    await page.mouse.move(p.x, p.y);
  }
  await page.mouse.up();
}

/** Big swipe to the right, wherever the tree currently is. */
export async function pushRight(page: Page): Promise<void> {
  const size = page.viewportSize()!;
  const a = await anchor(page, 'tree');
  const x0 = Math.min(Math.max(a.x, 40), size.width - 40);
  const y0 = Math.min(Math.max(a.y, 60), size.height - 80);
  await swipe(page, { x: x0, y: y0 }, { x: Math.min(size.width - 20, x0 + size.width * 0.5), y: y0 + 24 });
}

/** Crank the feed rollers until the tree is through the cone. */
export async function feedThrough(page: Page, maxStrokes = 90): Promise<void> {
  const size = page.viewportSize()!;
  for (let i = 0; i < maxStrokes; i++) {
    const r = await anchor(page, 'rollers');
    const x = Math.min(Math.max(r.x, 40), size.width - 40);
    const span = Math.min(size.height * 0.34, 260);
    const mid = Math.min(Math.max(r.y, span / 2 + 30), size.height - span / 2 - 30);
    await swipe(page, { x, y: mid - span / 2 }, { x, y: mid + span / 2 }, 8);
    if ((await snapshot(page)).phase !== 'bale') return;
  }
}

/** Long downward pulls on the net end until every rank is free. */
export async function pullNet(page: Page, maxPulls = 60): Promise<void> {
  const size = page.viewportSize()!;
  for (let i = 0; i < maxPulls; i++) {
    const t = await anchor(page, 'tail');
    const y0 = Math.min(Math.max(t.y, 90), size.height * 0.55);
    await swipe(
      page,
      { x: size.width * 0.5, y: y0 },
      { x: size.width * 0.5, y: size.height - 24 },
      10,
    );
    if ((await snapshot(page)).phase !== 'release') return;
  }
}
