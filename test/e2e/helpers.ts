import type { Page } from '@playwright/test';

/** ページ側が公開する読み取り専用 API（状態を書き換える手段は無い）。 */
export interface TestApi {
  grab: () => { x: number; y: number } | null;
  level: () => number;
  rackY: () => number;
  station: () => string;
  jar: () => string | null;
  jarOrder: () => string[];
  phase: () => string;
  mountPhase: () => string;
  dips: () => number;
  seconds: () => number;
  modelSec: () => number;
  opSec: () => number;
  accel: () => number;
  generation: () => number;
  volumeUl: () => number;
  coverAngle: () => number;
  logLength: () => number;
  fieldMeans: () => Record<string, number>;
}

declare global {
  interface Window {
    __he: TestApi;
  }
}

export function read<K extends keyof TestApi>(page: Page, key: K): Promise<ReturnType<TestApi[K]>> {
  return page.evaluate((k) => (window.__he[k as keyof TestApi] as () => unknown)(), key) as Promise<
    ReturnType<TestApi[K]>
  >;
}

async function grabPoint(page: Page): Promise<{ x: number; y: number }> {
  const g = await page.evaluate(() => window.__he.grab());
  if (!g) throw new Error('ラックの掴み位置が取得できません');
  return { x: g.x, y: g.y + 60 };
}

/** 実際のポインタ経路でラックを上下に動かす。内部状態は書き換えない。 */
export async function dragRack(page: Page, dyPx: number, steps = 8): Promise<void> {
  const p = await grabPoint(page);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) await page.mouse.move(p.x, p.y + (dyPx * i) / steps);
  await page.mouse.up();
}

export async function submerge(page: Page): Promise<void> {
  for (let i = 0; i < 10; i++) {
    if ((await read(page, 'level')) >= 1.05) return;
    await dragRack(page, 260, 6);
  }
  throw new Error('切片を液面下に入れられませんでした');
}

export async function lift(page: Page, toTransport = false): Promise<void> {
  for (let i = 0; i < 10; i++) {
    if (toTransport ? (await read(page, 'rackY')) >= 90 : (await read(page, 'level')) <= -0.02) return;
    await dragRack(page, -260, 6);
  }
  throw new Error('ラックを引き上げられませんでした');
}

/** 有効なディップを n 回行う（実際に往復させる）。 */
export async function doDips(page: Page, n: number): Promise<void> {
  const start = await read(page, 'dips');
  for (let i = 0; i < n * 2 + 8; i++) {
    if ((await read(page, 'dips')) >= start + n) return;
    await submerge(page);
    await lift(page);
  }
  throw new Error(`ディップ ${n} 回に届きませんでした`);
}

/** 静置浸漬。教材内モデル時間がその槽で target 秒進むまで沈めたまま待つ。 */
export async function soak(page: Page, targetSec: number, timeoutMs = 180_000): Promise<void> {
  await submerge(page);
  const t0 = await read(page, 'seconds');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await read(page, 'seconds')) - t0 >= targetSec) break;
    await page.waitForTimeout(250);
  }
  await lift(page);
}

/** 液切り（槽の上で保持して液膜を薄くする）。 */
export async function drain(page: Page, ms = 1500): Promise<void> {
  await page.waitForTimeout(ms);
}

/** 横ドラッグで隣の槽へ移す。 */
export async function moveToJar(page: Page, id: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const cur = await read(page, 'jar');
    if (cur === id) return;
    const order = await read(page, 'jarOrder');
    const from = order.indexOf(cur ?? '');
    const to = order.indexOf(id);
    if (to < 0) throw new Error(`槽 ${id} は現在のステーションにありません`);
    const dir = to > from ? 1 : -1;
    await lift(page, true);
    const p = await grabPoint(page);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    for (let k = 1; k <= 6; k++) await page.mouse.move(p.x + (dir * 110 * k) / 6, p.y);
    await page.mouse.up();
    await page.waitForTimeout(750);
  }
  throw new Error(`槽 ${id} へ移動できませんでした`);
}

const STATION_ORDER = ['deparaffin', 'hydration', 'wash', 'nuclear', 'counter', 'dehydrate', 'clearing', 'mount'];

export async function gotoStation(page: Page, id: string): Promise<void> {
  for (let i = 0; i < 14; i++) {
    const cur = await read(page, 'station');
    if (cur === id) return;
    const from = STATION_ORDER.indexOf(cur);
    const to = STATION_ORDER.indexOf(id);
    await page.click(to > from ? '#nav-next' : '#nav-prev');
    await page.waitForTimeout(1400);
  }
  throw new Error(`ステーション ${id} へ移動できませんでした`);
}

/** 水道水を 3 回交換して洗う（同じ水に出し入れするだけでは交換にしない）。 */
export async function tapWashThreeChanges(page: Page, dipsPerChange = 4): Promise<void> {
  await gotoStation(page, 'wash');
  await moveToJar(page, 'TAP');
  for (let i = 0; i < 3; i++) {
    await refreshWater(page);
    await doDips(page, dipsPerChange);
  }
  await lift(page, true);
}

/** 水道水槽・蒸留水槽の水を新しくする。 */
export async function refreshWater(page: Page): Promise<void> {
  await lift(page, true);
  await page.click('#btn-refresh');
  await page.waitForTimeout(120);
}
