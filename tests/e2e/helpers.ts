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
  heldPiecePos(): { x: number; y: number } | null;
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

/**
 * Fit the piece that is being offered, using real pointer input.
 *
 * The finger aims by eye, the way a player does: carry the piece towards the
 * groove, look at where the piece actually is, and correct.  That matters
 * because a piece is held wherever it was grabbed, so the offset between the
 * finger and the part of the piece that has to reach the groove is not the same
 * for a small board and for the whole tree.
 */
export async function fitCurrentPiece(page: Page) {
  const pick = await page.evaluate(() => window.game.pickTarget());
  const joint = await page.evaluate(() => window.game.jointTargets());
  if (!pick || !joint) throw new Error('nothing to fit');
  const LIFT = 42; // the piece rides above the finger

  await page.mouse.move(pick.x, pick.y);
  await page.mouse.down();
  await ff(page, 0.1);

  let fx = pick.x;
  let fy = pick.y;
  const moveTo = async (x: number, y: number, steps: number, settle: number) => {
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      await page.mouse.move(fx + (x - fx) * t, fy + (y - fy) * t);
      await ff(page, settle);
    }
    fx = x;
    fy = y;
  };

  await moveTo(joint.entry.x, joint.entry.y + LIFT, 8, 0.06);
  await ff(page, 0.3);

  // correct by eye until the piece itself is at the mouth of the joint
  for (let pass = 0; pass < 5; pass++) {
    if ((await page.evaluate(() => window.game.assembly.mode)) === 'guided') break;
    const held = await page.evaluate(() => window.game.heldPiecePos());
    if (!held) break;
    const dx = joint.entry.x - held.x;
    const dy = joint.entry.y - held.y;
    if (Math.hypot(dx, dy) < 12) break;
    await moveTo(fx + dx, fy + dy, 4, 0.06);
    await ff(page, 0.25);
  }
  const captured = await page.evaluate(() => window.game.assembly.mode);

  // then push it home along the groove
  await moveTo(fx + (joint.seated.x - joint.entry.x), fy + (joint.seated.y - joint.entry.y), 8, 0.08);
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
  const steps = Math.max(20, Math.round(turns * 24)); // 15 degrees a step is plenty
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
