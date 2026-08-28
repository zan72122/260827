import { App } from './core/app';
import { Game } from './game';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const app = new App(canvas);
const game = new Game(app);

// Handy for driving the game from a browser-automation harness.
(window as unknown as { game: Game; app: App }).game = game;
(window as unknown as { game: Game; app: App }).app = app;

void game.start().then(() => {
  document.getElementById('boot')?.classList.add('gone');
  setTimeout(() => document.getElementById('boot')?.remove(), 900);
});
