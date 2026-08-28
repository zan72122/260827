import './style.css';
import { Game } from './game';

const canvas = document.getElementById('view') as HTMLCanvasElement;
const title = document.getElementById('title') as HTMLElement;

const hint = document.createElement('div');
hint.className = 'hint';
hint.innerHTML = '<span class="hint__ring"></span>';
document.getElementById('app')!.appendChild(hint);

const game = new Game(canvas);
game.attachHint(hint);
game.begin();
game.start();

const startPlay = () => {
  title.classList.add('title--hidden');
  game.play();
  removeEventListener('pointerdown', startPlay);
};
addEventListener('pointerdown', startPlay, { once: false });

// keep the reveal check pass able to drive the same inputs the finger drives
(window as unknown as { __game: Game }).__game = game;
