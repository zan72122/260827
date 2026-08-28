import { createRenderSystem } from './core/renderer';
import { Game } from './game/Game';

async function boot(): Promise<void> {
  const app = document.getElementById('app')!;
  const overlay = document.getElementById('overlay')!;
  const bootScreen = document.getElementById('boot')!;
  const bootBtn = document.getElementById('bootBtn') as HTMLButtonElement;

  const render = await createRenderSystem(app);
  const game = new Game(overlay, render);

  let running = false;
  const loop = (now: number) => {
    game.frame(now);
    requestAnimationFrame(loop);
  };

  const start = async () => {
    if (running) return;
    running = true;
    bootScreen.classList.add('hidden');
    window.setTimeout(() => bootScreen.remove(), 800);
    await game.startAudio();
  };
  bootBtn.addEventListener('click', start);
  bootBtn.addEventListener('pointerup', start);

  // draw immediately so the yard is on screen behind the start button
  requestAnimationFrame(loop);

  let resizeTimer = 0;
  const onResize = () => {
    window.clearTimeout(resizeTimer);
    // iOS reports stale dimensions during rotation; settle first, keep all state
    resizeTimer = window.setTimeout(() => game.resize(), 60);
    game.resize();
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  window.visualViewport?.addEventListener('resize', onResize);

  const w = window as unknown as { __treeGameReady?: boolean; __treeGameStart?: () => void };
  w.__treeGameStart = () => void start();
  w.__treeGameReady = true;
}

void boot();
