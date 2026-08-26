import { Game } from './game.js';

function supportsWebGL2() {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch { return false; }
}

if (supportsWebGL2()) {
  const game = new Game(document.getElementById('app'));
  game.start();
  window.__test = game.testApi();
} else {
  const el = document.createElement('div');
  el.style.cssText = 'color:#cfd8de;font:20px system-ui;display:flex;align-items:center;justify-content:center;height:100%';
  el.textContent = '⛸️';
  document.getElementById('app').appendChild(el);
}
