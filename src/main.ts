import { App } from './core/App';

const stage = document.getElementById('stage');
const boot = document.getElementById('boot');

function fail(msg: string): void {
  if (boot) {
    boot.textContent = msg;
    boot.classList.remove('gone');
  }
}

try {
  if (!stage) throw new Error('stage missing');
  const app = new App(stage);
  app.start();
  window.setTimeout(() => boot?.classList.add('gone'), 260);
} catch (err) {
  fail('この端末では表示できません');
  throw err;
}
