import './style.css';
import { Game } from './game/game';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const overlay = document.getElementById('overlay') as HTMLElement;

const game = new Game(canvas, overlay);

let last = performance.now();
let started = false;

// Automated verification runs on a software renderer that cannot keep up with
// real time; `?speed=` advances the simulation in stable sub-steps instead.
const speed = Math.min(
  8,
  Math.max(1, Number.parseFloat(new URLSearchParams(location.search).get('speed') ?? '1') || 1),
);
const MAX_STEP = 1 / 30;

function frame(now: number): void {
  const frameMs = now - last;
  last = now;
  const dt = Math.min(0.05, frameMs / 1000);
  let remaining = dt * speed;
  while (remaining > 1e-4) {
    const step = Math.min(remaining, MAX_STEP);
    game.update(step);
    remaining -= step;
  }
  game.stage.render();
  game.stage.govern(frameMs);
  if (!started) {
    started = true;
    game.bootDone();
  }
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

// iOS suspends the audio graph when the app goes to the background.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) game.stage.render();
});
