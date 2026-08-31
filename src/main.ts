import { App } from './app/App';

/**
 * Entry point. If anything here fails — no WebGL 2, a shader that will not
 * compile, a browser that refuses a canvas — the loader is replaced by
 * something that says so. It never spins forever.
 */

const container = document.getElementById('app');
const boot = document.getElementById('boot');
const bootMsg = document.getElementById('boot-msg');

function fail(message: string): void {
  if (boot) boot.classList.add('failed');
  if (bootMsg) bootMsg.textContent = message;
}

if (!container) {
  fail('画面を用意できませんでした。ページを開きなおしてください。');
} else {
  try {
    const app = new App(container);
    app.start();
    // Give the first frame a moment to appear before uncovering it.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        boot?.classList.add('gone');
        window.setTimeout(() => boot?.remove(), 600);
      }),
    );
    (window as unknown as { __kurukuru?: App }).__kurukuru = app;
  } catch (err) {
    console.error(err);
    fail(
      'このブラウザでは表示できませんでした。\nWebGL 2 に対応したブラウザでお試しください。',
    );
  }
}
