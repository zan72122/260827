import { Game } from './app';

const boot = document.getElementById('boot')!;
const msg = document.getElementById('boot-msg')!;

function fail(what: string): void {
  boot.classList.remove('gone');
  msg.innerHTML = `<span class="err">${what}</span>`;
}

try {
  const host = document.getElementById('app')!;
  const game = new Game(host);
  game.start();
  // Never sit on a loading screen: the first frame is drawn, so let it show.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => boot.classList.add('gone'));
  });
  (window as unknown as { game: Game }).game = game;
} catch (err) {
  const e = err as Error;
  fail(
    e.message.includes('WebGL')
      ? 'この ブラウザでは WebGL2 が つかえません。<br>Safari / Chrome の さいしんばんで ひらいてください。'
      : `ひらけませんでした<br>${e.message}`,
  );
}
