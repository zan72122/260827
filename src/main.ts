import { Game } from './game/game';

const container = document.getElementById('app')!;

function webgl2Available(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

if (!webgl2Available()) {
  // WebGL2 is the floor for this game; show a friendly icon-only notice.
  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;height:100%;color:#cfe0ea;font-size:48px">
      &#9888;
    </div>`;
} else {
  const game = new Game(container);
  // Verification / debugging hook (no external communication involved).
  (window as unknown as { __seacable: unknown }).__seacable = {
    game,
    getState: () => game.getState(),
    worldToScreen: (x: number, z: number) => game.worldToScreen(x, z),
    setTimeScale: (k: number) => game.setTimeScale(k),
    resetFrameProbe: () => game.resetFrameProbe()
  };
}
