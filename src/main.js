import { Game } from './game.js';
import { render } from './render.js';
import { clearSpriteCache } from './sprites.js';
import { clearVesselCache } from './ui.js';
import { clearThumbs } from './render.js';

const canvas = document.getElementById('stage');
const game = new Game(canvas);
window.__game = game;                     // 検証用の入口
game.onScale = () => { clearSpriteCache(); clearVesselCache(); clearThumbs(); };

let last = performance.now();
function frame(now) {
  // 最初の rAF の時刻は performance.now() より前になることがあるので、負の dt を弾く
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
  last = now;
  game.update(dt);
  render(game);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 画面の向きやサイズが変わったら組み直す(iPhone/iPad の縦横両対応)
let resizeTimer = 0;
function scheduleResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    clearSpriteCache(); clearThumbs(); clearVesselCache();
    game.resize();
  }, 90);
}
window.addEventListener('resize', scheduleResize);
window.addEventListener('orientationchange', scheduleResize);
if (window.visualViewport) window.visualViewport.addEventListener('resize', scheduleResize);

// ---- 入力は一本指のみ。最初に触れた指だけを追いかける。----
let activeId = null;
function pos(e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
canvas.addEventListener('pointerdown', (e) => {
  if (activeId !== null) return;
  activeId = e.pointerId;
  canvas.setPointerCapture(e.pointerId);
  const p = pos(e);
  game.pointerDown(p.x, p.y);
  e.preventDefault();
}, { passive: false });

canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId !== activeId) return;
  const p = pos(e);
  game.pointerMove(p.x, p.y);
  e.preventDefault();
}, { passive: false });

function endPointer(e) {
  if (e.pointerId !== activeId) return;
  activeId = null;
  const p = pos(e);
  game.pointerUp(p.x, p.y);
  e.preventDefault();
}
canvas.addEventListener('pointerup', endPointer, { passive: false });
canvas.addEventListener('pointercancel', endPointer, { passive: false });

// ピンチや二本指のスクロール、ダブルタップ拡大を止める
['gesturestart', 'gesturechange', 'gestureend'].forEach((n) =>
  document.addEventListener(n, (e) => e.preventDefault(), { passive: false }));
document.addEventListener('touchmove', (e) => {
  if (e.touches.length > 1) e.preventDefault();
}, { passive: false });
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
document.addEventListener('contextmenu', (e) => e.preventDefault());
