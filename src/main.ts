import { Game } from './game/Game';

/**
 * Boot. The plaza is built once, then the loop runs; there is no menu to read
 * and no settings to choose, because the intended player is four years old.
 */
const canvas = document.getElementById('stage') as HTMLCanvasElement;
const hudRoot = document.getElementById('hud') as HTMLElement;
const boot = document.getElementById('boot') as HTMLElement;

const game = new Game(canvas, hudRoot);

let running = true;
const loop = (): void => {
  if (running) game.frame();
  requestAnimationFrame(loop);
};
requestAnimationFrame(loop);

window.addEventListener('resize', () => game.resize());
window.addEventListener('orientationchange', () => setTimeout(() => game.resize(), 120));
document.addEventListener('visibilitychange', () => {
  running = !document.hidden;
});
// Keep a stray two-finger gesture from scrolling the page under the console.
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

requestAnimationFrame(() => {
  boot.classList.add('gone');
  setTimeout(() => boot.remove(), 600);
});

interface TestApi {
  state: () => ReturnType<Game['getState']>;
  hold: (id: string, on: boolean) => boolean;
  drag: (id: string, amount: number) => boolean;
  press: (id: string) => boolean;
  setTimeScale: (v: number) => void;
  hasControl: (id: string) => boolean;
  tick: (seconds: number) => void;
}

const api: TestApi = {
  state: () => game.getState(),
  hold: (id, on) => game.hud.simulate(id, on ? 'hold-on' : 'hold-off'),
  drag: (id, amount) => game.hud.simulate(id, 'drag', amount),
  press: (id) => game.hud.simulate(id, 'press'),
  setTimeScale: (v) => {
    game.timeScale = v;
  },
  hasControl: (id) => game.hud.hasControl(id),
  tick: (seconds) => game.advance(seconds),
};

(window as unknown as { __tree: TestApi }).__tree = api;
