import { expect, test } from '@playwright/test';
import { boot, dbg, ff, fitCurrentPiece, windByHand } from './helpers';

test.describe('木を組んで、歌うツリーを巻く', () => {
  test('a board goes into its groove and stays there', async ({ page }) => {
    await boot(page);
    const before = await dbg(page);
    const { captured } = await fitCurrentPiece(page);
    expect(captured).toBe('guided'); // the groove took it before it was pushed home
    const after = await dbg(page);
    expect(after.seated).toBe(before.seated + 1);
    expect(after.remaining).toBe(before.remaining - 1);

    // it is exactly on its seat, not floating near it, and its shoulder is on
    // the trunk face rather than somewhere close by
    const fit = await page.evaluate(() => window.game.seatError());
    expect(fit.id).not.toBeNull();
    expect(fit.positionErrorMM).toBeLessThan(0.001);
    expect(fit.shoulderRadiusMM).toBeCloseTo(fit.trunkFaceRadiusMM, 6);
  });

  test('a board is never sucked through the trunk from the far side', async ({ page }) => {
    await boot(page);
    const pick = (await page.evaluate(() => window.game.pickTarget()))!;
    const joint = (await page.evaluate(() => window.game.jointTargets()))!;
    // mirror the entry point through the seat: that is the far side of the trunk
    const far = {
      x: joint.seated.x * 2 - joint.entry.x,
      y: joint.seated.y * 2 - joint.entry.y,
    };
    await page.mouse.move(pick.x, pick.y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) {
      const t = i / 10;
      await page.mouse.move(pick.x + (far.x - pick.x) * t, pick.y + (far.y + 42 - pick.y) * t);
      await ff(page, 0.06);
    }
    await ff(page, 0.5);
    expect(await page.evaluate(() => window.game.assembly.mode)).toBe('carrying');
    await page.mouse.up();
    await ff(page, 0.6);
    const s = await dbg(page);
    expect(s.remaining).toBe(5); // still waiting to be fitted
  });

  test('winding, holding and letting go run in one continuous state', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      window.game.finishAssemblyInstantly();
      window.game.fastForward(2);
    });

    await windByHand(page, 1.2, { release: false });
    const held = await page.evaluate(() => ({
      state: window.game.mech.state,
      turns: window.game.mech.turns,
      yaw: window.game.mech.shaftYaw,
    }));
    expect(held.state).toBe('winding');
    expect(held.turns).toBeGreaterThan(0.8);
    // winding turns the tree clockwise seen from above, which is decreasing yaw
    expect(held.yaw).toBeLessThan(-4);

    await page.mouse.up();
    await ff(page, 0.4);
    const playing = await page.evaluate(() => ({
      state: window.game.mech.state,
      speed: window.game.mech.angularSpeed,
      yaw: window.game.mech.shaftYaw,
    }));
    expect(playing.state).toBe('playing');
    expect(playing.speed).toBeGreaterThan(0.5);
    expect(playing.yaw).toBeGreaterThan(held.yaw); // it turns back the other way
  });

  test('more winding buys more time, not more speed', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      window.game.finishAssemblyInstantly();
      window.game.fastForward(2);
    });

    const measure = async (turns: number) => {
      await page.evaluate(() => {
        window.game.mech.turns = 0;
        window.game.mech.state = 'idle';
      });
      await windByHand(page, turns);
      await ff(page, 0.6); // past the governor's spin-up
      return page.evaluate(() => ({
        speed: window.game.mech.angularSpeed,
        left: window.game.mech.turns,
      }));
    };

    const small = await measure(0.6);
    const big = await measure(2.6);
    expect(big.left / small.left).toBeGreaterThan(2.5);
    expect(Math.abs(big.speed - small.speed) / big.speed).toBeLessThan(0.03);
  });

  test('it can be wound again at once, without waiting for the tune', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      window.game.finishAssemblyInstantly();
      window.game.fastForward(2);
    });
    await windByHand(page, 1);
    await ff(page, 1.2);
    const mid = await page.evaluate(() => window.game.mech.turns);
    await windByHand(page, 1);
    const after = await page.evaluate(() => ({
      turns: window.game.mech.turns,
      state: window.game.mech.state,
    }));
    expect(after.turns).toBeGreaterThan(mid + 0.7); // the stored wind was kept
    expect(after.state).toBe('playing');
  });

  test('a cancelled touch lets go rather than jamming', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      window.game.finishAssemblyInstantly();
      window.game.fastForward(2);
    });
    await windByHand(page, 1.4, { release: false });
    expect(await page.evaluate(() => window.game.mech.state)).toBe('winding');

    await page.evaluate(() => {
      const c = document.getElementById('view')!;
      c.dispatchEvent(
        new PointerEvent('pointercancel', { pointerId: 1, bubbles: true, cancelable: true }),
      );
    });
    await ff(page, 0.5);
    const s = await page.evaluate(() => window.game.mech.state);
    expect(s).toBe('playing');

    // and the next touch is accepted straight away
    await windByHand(page, 0.5);
    expect(await page.evaluate(() => window.game.mech.turns)).toBeGreaterThan(0.3);
  });

  test('a second finger cannot disturb the wind in progress', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      window.game.finishAssemblyInstantly();
      window.game.fastForward(2);
    });
    await windByHand(page, 1, { release: false });
    const before = await page.evaluate(() => window.game.mech.turns);
    await page.evaluate(() => {
      const c = document.getElementById('view')!;
      for (const type of ['pointerdown', 'pointermove', 'pointerup']) {
        c.dispatchEvent(
          new PointerEvent(type, { pointerId: 99, clientX: 10, clientY: 10, bubbles: true }),
        );
      }
    });
    await ff(page, 0.2);
    expect(await page.evaluate(() => window.game.mech.turns)).toBeCloseTo(before, 5);
    expect(await page.evaluate(() => window.game.mech.state)).toBe('winding');
    await page.mouse.up();
  });

  test('the pot stays put while the tree turns', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      window.game.finishAssemblyInstantly();
      window.game.fastForward(2);
    });
    const potBefore = await page.evaluate(() => window.game.potWorldPosition());
    await windByHand(page, 2);
    await ff(page, 3);
    const potAfter = await page.evaluate(() => window.game.potWorldPosition());
    expect(potAfter).toEqual(potBefore);
    expect(await page.evaluate(() => window.game.mech.shaftYaw)).not.toBe(0);
  });

  test('turning the screen re-composes the view but not the tree', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      window.game.finishAssemblyInstantly();
      window.game.fastForward(2);
    });
    const vp = page.viewportSize()!;
    const before = await page.evaluate(() => window.game.treeMetrics());

    await page.setViewportSize({ width: vp.height, height: vp.width });
    await ff(page, 2);
    const after = await page.evaluate(() => window.game.treeMetrics());
    expect(after.heightMM).toBeCloseTo(before.heightMM, 5);
    expect(after.spanMM).toBeCloseTo(before.spanMM, 3);
    expect(after.boardThicknessMM).toBe(5);

    // and it is still playable at the new shape
    const s = await dbg(page);
    expect(s.gripPx).toBeGreaterThanOrEqual(64);
    await windByHand(page, 1);
    await ff(page, 0.5);
    expect(await page.evaluate(() => window.game.mech.state)).toBe('playing');
  });

  test('the grip and the pieces are big enough for small fingers', async ({ page }) => {
    await boot(page);
    const capsule = await page.evaluate(() => {
      const c = (
        window.game.assembly as unknown as {
          hitCapsule(): { a: { x: number; y: number }; b: { x: number; y: number }; r: number };
        }
      ).hitCapsule();
      return { r: c.r, len: Math.hypot(c.b.x - c.a.x, c.b.y - c.a.y) };
    });
    expect(capsule.r * 2).toBeGreaterThanOrEqual(48);
    expect(capsule.len).toBeGreaterThan(40);

    await page.evaluate(() => {
      window.game.finishAssemblyInstantly();
      window.game.fastForward(2);
    });
    const s = await dbg(page);
    expect(s.gripPx * 2).toBeGreaterThanOrEqual(64);
  });

  test('stays inside its drawing budget', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      window.game.finishAssemblyInstantly();
      window.game.fastForward(2);
    });
    const s = await dbg(page);
    expect(s.triangles).toBeLessThan(180_000);
    expect(s.drawCalls).toBeLessThanOrEqual(110);
    expect(s.dpr).toBeLessThanOrEqual(1.5);
  });

  test('the whole run works end to end: four joints, the pot, then the music', async ({ page }) => {
    await boot(page);
    for (let i = 0; i < 4; i++) {
      await fitCurrentPiece(page);
      await ff(page, 1.6); // let the camera settle between pieces
    }
    let s = await dbg(page);
    expect(s.seated).toBe(17); // sixteen leaf boards and the star
    expect(s.phase).toBe('mount');

    await fitCurrentPiece(page); // the tree onto the pot
    await ff(page, 2);
    s = await dbg(page);
    expect(s.remaining).toBe(0);
    expect(s.phase).toBe('finished');

    await windByHand(page, 1.5);
    await ff(page, 1);
    expect(await page.evaluate(() => window.game.mech.state)).toBe('playing');
  });
});

test.describe('sound follows the movement', () => {
  test('teeth are plucked only while the drum is turning', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      window.game.finishAssemblyInstantly();
      window.game.fastForward(2);
    });
    const quiet = (await dbg(page)).notes;
    await ff(page, 3);
    // nothing is wound, so nothing sounds: there is no background music here
    expect((await dbg(page)).notes).toBe(quiet);

    await windByHand(page, 2);
    await ff(page, 6);
    const playing = await dbg(page);
    expect(playing.notes).toBeGreaterThan(10);
    expect(playing.audio).not.toBe('not-created'); // the first touch opened it

    // and once it has run down, it goes quiet again
    await ff(page, 30);
    const stopped = await dbg(page);
    expect(stopped.mech).toBe('idle');
    const after = stopped.notes;
    await ff(page, 4);
    expect((await dbg(page)).notes).toBe(after);
  });

  test('a long tab-away does not fire a burst of notes on return', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      window.game.finishAssemblyInstantly();
      window.game.fastForward(2);
    });
    await windByHand(page, 3);
    await ff(page, 0.5);
    const before = await dbg(page);
    // one frame carrying an hour of wall time is clamped to a single step
    await page.evaluate(() => window.game.frame(3600, 3600));
    const after = await dbg(page);
    expect(after.notes - before.notes).toBeLessThan(4);
    expect(after.turns).toBeGreaterThan(before.turns - 0.2);
  });
});

test.describe('nothing gets left in mid-air', () => {
  test('a board let go halfway goes back to the tray', async ({ page }) => {
    await boot(page);
    const pick = (await page.evaluate(() => window.game.pickTarget()))!;
    const joint = (await page.evaluate(() => window.game.jointTargets()))!;
    await page.mouse.move(pick.x, pick.y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) {
      const t = (i / 6) * 0.5;
      await page.mouse.move(pick.x + (joint.entry.x - pick.x) * t, pick.y + (joint.entry.y - pick.y) * t);
      await ff(page, 0.06);
    }
    await page.mouse.up();
    await ff(page, 1);
    expect(await page.evaluate(() => window.game.assembly.mode)).toBe('idle');
    const back = await page.evaluate(() => window.game.pickTarget());
    expect(Math.hypot(back!.x - pick.x, back!.y - pick.y)).toBeLessThan(2);
  });

  test('the tree let go on the way to the pot goes back to the jig', async ({ page }) => {
    await boot(page);
    for (let i = 0; i < 4; i++) {
      await fitCurrentPiece(page);
      await ff(page, 1.6);
    }
    const home = await page.evaluate(() => window.game.tree.group.position.toArray());
    const pick = (await page.evaluate(() => window.game.pickTarget()))!;
    await page.mouse.move(pick.x, pick.y);
    await page.mouse.down();
    await ff(page, 0.3);
    await page.mouse.move(pick.x + 30, pick.y - 60);
    await ff(page, 0.3);
    await page.mouse.up();
    await ff(page, 1.2);
    const after = await page.evaluate(() => window.game.tree.group.position.toArray());
    expect(after[0]).toBeCloseTo(home[0], 5);
    expect(after[1]).toBeCloseTo(home[1], 5);
    expect(after[2]).toBeCloseTo(home[2], 5);
    // and it can still be picked up and mounted afterwards
    await fitCurrentPiece(page);
    await ff(page, 2);
    expect((await dbg(page)).remaining).toBe(0);
  });
});
