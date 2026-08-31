import { Game, type Quality } from './game';
import { ROW_COUNT, WORK_ROW_INDEX } from './config';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const hint = document.getElementById('hint') as HTMLDivElement;
const pegs = document.getElementById('pegs') as HTMLDivElement;
const again = document.getElementById('again') as HTMLButtonElement;
const fpsEl = document.getElementById('fps') as HTMLDivElement;

for (let i = 0; i < ROW_COUNT[WORK_ROW_INDEX]; i++) pegs.appendChild(document.createElement('i'));
const pegEls = [...pegs.children] as HTMLElement[];

const params = new URLSearchParams(location.search);
const forceLow = params.get('q') === 'low';
const showFps = params.has('fps');
const noAdapt = params.has('noadapt');
if (showFps) fpsEl.classList.add('on');

const dprCap = forceLow ? 1 : 2;
const quality: Quality = forceLow
  ? { level: 'low', nt: 88, tex: 512, pixelRatio: Math.min(window.devicePixelRatio, 1) }
  : { level: 'high', nt: 132, tex: 1024, pixelRatio: Math.min(window.devicePixelRatio, dprCap) };

const game = new Game(canvas, quality);

/* ---- layout ------------------------------------------------------- */
let curDpr = Math.min(window.devicePixelRatio, dprCap);
let pendingResize = true;
function layout() {
  // measure the canvas itself: on iOS the URL bar makes window.innerHeight lie
  const w = Math.max(1, Math.round(canvas.clientWidth));
  const h = Math.max(1, Math.round(canvas.clientHeight));
  game.resize(w, h, curDpr);
  pendingResize = false;
}
const markResize = () => { pendingResize = true; };
window.addEventListener('resize', markResize);
window.addEventListener('orientationchange', markResize);
window.visualViewport?.addEventListener('resize', markResize);
if ('ResizeObserver' in window) new ResizeObserver(markResize).observe(canvas);
layout();

/* ---- one finger --------------------------------------------------- */
canvas.addEventListener('pointerdown', (e) => {
  if (game.onPointerDown(e.pointerId, e.clientX, e.clientY)) {
    // capture can legitimately fail if the pointer is already gone
    try { canvas.setPointerCapture(e.pointerId); } catch { /* keep the grab */ }
    e.preventDefault();
  }
}, { passive: false });

canvas.addEventListener('pointermove', (e) => {
  game.onPointerMove(e.pointerId, e.clientX, e.clientY);
}, { passive: true });

const release = (e: PointerEvent) => {
  game.onPointerUp(e.pointerId);
  if (canvas.hasPointerCapture?.(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
canvas.addEventListener('lostpointercapture', (e) => game.onPointerUp(e.pointerId));
// the finger leaving the window must not leave the tool stuck to it
window.addEventListener('blur', () => game.onPointerUp(-1));
document.addEventListener('visibilitychange', () => { if (document.hidden) game.onPointerUp(-1); });
// never let the page itself move under the work
for (const t of ['touchstart', 'touchmove', 'gesturestart'] as const) {
  document.addEventListener(t, (e) => e.preventDefault(), { passive: false });
}
document.addEventListener('contextmenu', (e) => e.preventDefault());

again.addEventListener('click', () => { game.reset(); });

/* ---- adaptive quality --------------------------------------------
 * Resolution first, then shadows. Only ever downwards, and only after a
 * sustained shortfall, so it cannot oscillate while the child is cutting.
 */
let slowFor = 0;
let steps = 0;
function adapt(dt: number) {
  if (steps >= 3 || forceLow || noAdapt) return;
  const fast = dt < 1 / 45;
  slowFor = fast ? 0 : slowFor + dt;
  if (slowFor < 1.5) return;
  slowFor = 0; steps++;
  if (curDpr > 1.0) { curDpr = Math.max(1.0, curDpr * 0.72); pendingResize = true; }
  else if (curDpr > 0.75) { curDpr = 0.75; pendingResize = true; }
  else { game.renderer.shadowMap.enabled = false; steps = 3; }
}

/* ---- loop --------------------------------------------------------- */
let doneShown = false;
function frame() {
  if (pendingResize) layout();
  adapt(game.update());

  const s = game.branchesDone;
  for (let i = 0; i < pegEls.length; i++) pegEls[i].classList.toggle('on', i < s);

  const wantHint = game.phase === 'work' && (!game.interacted || game.idle > 6);
  hint.classList.toggle('on', wantHint);
  if (wantHint) {
    const [x, y] = game.anchorPx;
    hint.style.transform = `translate(${x}px, ${y}px)`;
  }

  const isDone = game.phase === 'done';
  if (isDone !== doneShown) { doneShown = isDone; again.classList.toggle('on', isDone); }

  if (showFps) fpsEl.textContent = `${game.fps.toFixed(0)} fps  ${game.stats.triangles} tri  ${game.stats.calls} calls`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/* ---- verification hooks (not used by the game itself) -------------- */
declare global { interface Window { __spanbaum?: unknown } }
window.__spanbaum = {
  game,
  stats: () => game.stats,
  ready: true,
  debugCamera: (az: number, h: number, tilt: number) => game.debugCamera(az, h, tilt),
  restoreCamera: () => game.restoreCamera(),
  cutAz: () => game.cutAz,
  focus: (az: number, d: number, e?: number) => game.debugFocus(az, d, e),
  show: (o: Record<string, boolean>) => game.show(o),
  hold: (on: boolean) => game.hold(on),
  probe: () => game.probe(),
  cutCost: (n?: number) => game.measureCutCost(n),
  trenchDepths: () => game.trenchDepths(),
  reset: () => game.reset(),
};
