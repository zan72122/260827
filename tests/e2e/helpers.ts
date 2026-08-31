import type { Page } from '@playwright/test';

/** The game object the page exposes for testing. */
export interface GameHandle {
  debug(): {
    phase: string;
    mech: string;
    turns: number;
    charge: number;
    seated: number;
    remaining: number;
    fps: number;
    triangles: number;
    drawCalls: number;
    dpr: number;
    gripPx: number;
    portrait: boolean;
    notes: number;
    muted: boolean;
    audio: string;
  };
  fastForward(seconds: number): void;
  frame(dt: number, raw?: number, render?: boolean): void;
  notesPlayed: number;
  finishAssemblyInstantly(): void;
  pickTarget(): { x: number; y: number } | null;
  jointTargets(): { entry: { x: number; y: number }; seated: { x: number; y: number } } | null;
  gripTarget(): { x: number; y: number; r: number };
  treeMetrics(): { heightMM: number; spanMM: number; boardThicknessMM: number };
  seatError(): {
    id: string | null;
    positionErrorMM: number;
    shoulderRadiusMM: number;
    trunkFaceRadiusMM: number;
  };
  potWorldPosition(): number[];
  assembly: { mode: string; remaining: number; hitCapsule(): unknown };
  tree: { group: { position: { toArray(): number[] } } };
  mech: { turns: number; state: string; angularSpeed: number; shaftYaw: number };
}

declare global {
  interface Window {
    game: GameHandle;
  }
}

export async function boot(page: Page) {
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.game, null, { timeout: 30_000 });
  await page.evaluate(() => window.game.fastForward(3.5));
}

export const ff = (page: Page, s: number) => page.evaluate((n) => window.game.fastForward(n), s);
export const dbg = (page: Page) => page.evaluate(() => window.game.debug());

/** Fit the piece that is being offered, using real pointer input. */
export async function fitCurrentPiece(page: Page) {
  const pick = await page.evaluate(() => window.game.pickTarget());
  const joint = await page.evaluate(() => window.game.jointTargets());
  if (!pick || !joint) throw new Error('nothing to fit');
  const LIFT = 42; // the piece rides above the finger

  await page.mouse.move(pick.x, pick.y);
  await page.mouse.down();
  await ff(page, 0.1);
  for (let i = 1; i <= 8; i++) {
    const t = i / 8;
    await page.mouse.move(
      pick.x + (joint.entry.x - pick.x) * t,
      pick.y + (joint.entry.y + LIFT - pick.y) * t,
    );
    await ff(page, 0.06);
  }
  await ff(page, 0.35);
  const captured = await page.evaluate(() => window.game.assembly.mode);
  for (let i = 1; i <= 8; i++) {
    const t = i / 8;
    await page.mouse.move(
      joint.entry.x + (joint.seated.x - joint.entry.x) * t,
      joint.entry.y + LIFT + (joint.seated.y - joint.entry.y) * t,
    );
    await ff(page, 0.08);
  }
  await ff(page, 0.4);
  await page.mouse.up();
  await ff(page, 0.6);
  return { captured };
}

/** Turn the tree by hand: one continuous circular drag around the grip. */
export async function windByHand(page: Page, turns: number, opts: { release?: boolean } = {}) {
  const grip = await page.evaluate(() => window.game.gripTarget());
  const vp = page.viewportSize()!;
  const radius = Math.max(40, Math.min(grip.r * 0.8, Math.min(vp.width, vp.height) * 0.28));
  const steps = Math.max(24, Math.round(turns * 48));
  await page.mouse.move(grip.x + radius, grip.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    const a = (i / steps) * turns * Math.PI * 2; // clockwise on screen
    await page.mouse.move(grip.x + Math.cos(a) * radius, grip.y + Math.sin(a) * radius);
  }
  if (opts.release !== false) {
    await page.mouse.up();
    await ff(page, 0.2);
  }
  return grip;
}
