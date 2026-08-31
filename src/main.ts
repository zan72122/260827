import { Game } from './app';

const host = document.getElementById('stage')!;
const boot = document.getElementById('boot');

function start() {
  try {
    const game = new Game(host);
    (window as unknown as { game: Game }).game = game;
    (window as unknown as { gameDebug: unknown }).gameDebug = game.debug;
    boot?.classList.add('gone');
    window.setTimeout(() => boot?.remove(), 700);
  } catch (err) {
    if (boot) {
      boot.textContent = 'この端末では 3D を表示できませんでした';
      boot.classList.remove('gone');
    }
    console.error(err);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
