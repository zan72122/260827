import { describe, it, expect } from 'vitest';
import { PointerRouter, type Touch } from '../src/core/input';

/**
 * A stand-in for the canvas. Only what the router touches: listeners, a
 * rectangle, and pointer capture, which is recorded so the test can check the
 * gesture really is captured rather than left to bubble.
 */
class StubEl {
  private handlers: Record<string, ((e: never) => void)[]> = {};
  captured: number[] = [];
  released: number[] = [];
  addEventListener(type: string, fn: (e: never) => void): void {
    (this.handlers[type] ??= []).push(fn);
  }
  removeEventListener(type: string, fn: (e: never) => void): void {
    this.handlers[type] = (this.handlers[type] ?? []).filter((f) => f !== fn);
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 400, height: 800 };
  }
  setPointerCapture(id: number): void {
    this.captured.push(id);
  }
  releasePointerCapture(id: number): void {
    this.released.push(id);
  }
  fire(type: string, e: Record<string, unknown>): void {
    for (const fn of this.handlers[type] ?? []) {
      fn({ preventDefault() {}, ...e } as never);
    }
  }
}

function makeRouter() {
  const el = new StubEl();
  let now = 0;
  const r = new PointerRouter(() => now);
  const log: string[] = [];
  const moves: Touch[] = [];
  r.onDown = () => log.push('down');
  r.onMove = (t) => {
    log.push('move');
    moves.push(t);
  };
  r.onUp = () => log.push('up');
  r.onCancel = () => log.push('cancel');
  r.attach(el as unknown as HTMLElement);
  return { el, r, log, moves, tick: (d: number) => (now += d) };
}

describe('one finger at a time', () => {
  it('captures the pointer it takes', () => {
    const { el, r } = makeRouter();
    el.fire('pointerdown', { pointerId: 4, clientX: 10, clientY: 10 });
    expect(el.captured).toEqual([4]);
    expect(r.active).toBe(true);
    el.fire('pointerup', { pointerId: 4, clientX: 10, clientY: 10 });
    expect(el.released).toEqual([4]);
    expect(r.active).toBe(false);
  });

  it('ignores a second finger instead of fighting it', () => {
    const { el, log, moves } = makeRouter();
    el.fire('pointerdown', { pointerId: 1, clientX: 100, clientY: 100 });
    el.fire('pointerdown', { pointerId: 2, clientX: 300, clientY: 300 });
    expect(log).toEqual(['down']);

    // the second finger's movement must not reach the doll
    el.fire('pointermove', { pointerId: 2, clientX: 320, clientY: 320 });
    expect(moves.length).toBe(0);

    // the first one still has control
    el.fire('pointermove', { pointerId: 1, clientX: 130, clientY: 90 });
    expect(moves.length).toBe(1);
    expect(moves[0]!.dx).toBe(30);
    expect(moves[0]!.dy).toBe(-10);

    // and letting the second one go changes nothing
    el.fire('pointerup', { pointerId: 2, clientX: 320, clientY: 320 });
    expect(log).toEqual(['down', 'move']);
    el.fire('pointerup', { pointerId: 1, clientX: 130, clientY: 90 });
    expect(log).toEqual(['down', 'move', 'up']);
  });

  it('treats a cancelled gesture as a quiet let-go, not a release', () => {
    const { el, log } = makeRouter();
    el.fire('pointerdown', { pointerId: 7, clientX: 50, clientY: 50 });
    el.fire('pointermove', { pointerId: 7, clientX: 80, clientY: 50 });
    el.fire('pointercancel', { pointerId: 7 });
    expect(log).toEqual(['down', 'move', 'cancel']);
    // and a stray move afterwards is not picked up
    el.fire('pointermove', { pointerId: 7, clientX: 120, clientY: 50 });
    expect(log).toEqual(['down', 'move', 'cancel']);
  });

  it('lets go when losing capture, e.g. the tab going away', () => {
    const { el, log } = makeRouter();
    el.fire('pointerdown', { pointerId: 3, clientX: 10, clientY: 10 });
    el.fire('lostpointercapture', { pointerId: 3 });
    expect(log).toEqual(['down', 'cancel']);
  });

  it('can be aborted from outside, without an impulse', () => {
    const { el, r, log } = makeRouter();
    el.fire('pointerdown', { pointerId: 9, clientX: 10, clientY: 10 });
    r.abort();
    expect(log).toEqual(['down', 'cancel']);
    expect(r.active).toBe(false);
  });

  it('keeps following a drag that wanders outside the canvas', () => {
    const { el, moves } = makeRouter();
    el.fire('pointerdown', { pointerId: 1, clientX: 200, clientY: 400 });
    el.fire('pointermove', { pointerId: 1, clientX: -80, clientY: 950 });
    expect(moves.length).toBe(1);
    expect(moves[0]!.nx).toBeLessThan(-1);
    expect(moves[0]!.ny).toBeLessThan(-1);
    expect(moves[0]!.travel).toBeGreaterThan(400);
  });

  it('reports how long the touch lasted, from the injected clock', () => {
    const { el, moves, tick } = makeRouter();
    el.fire('pointerdown', { pointerId: 1, clientX: 10, clientY: 10 });
    tick(0.42);
    el.fire('pointermove', { pointerId: 1, clientX: 12, clientY: 10 });
    expect(moves[0]!.age).toBeCloseTo(0.42, 6);
  });
});
