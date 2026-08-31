import './style.css';
import { Game } from './app';

const canvas = document.getElementById('view') as HTMLCanvasElement;
const hudRoot = document.getElementById('hud-root') as HTMLDivElement;

function unsupported(message: string) {
  const div = document.createElement('div');
  div.id = 'fallback';
  div.textContent = message;
  document.getElementById('stage')!.appendChild(div);
}

// probe on a throwaway canvas: asking this one for a context first would fix
// its attributes and lose the antialiasing the renderer asks for
const probe = document.createElement('canvas').getContext('webgl2');
if (!probe) {
  unsupported('この端末のブラウザでは WebGL2 が使えないため、ツリーを表示できません。');
} else {
  const game = new Game(canvas, hudRoot);
  game.start();
  // handy in the browser console and used by the operation tests
  (window as unknown as { game: Game }).game = game;
}
