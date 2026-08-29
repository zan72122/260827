import { App } from './core/App';
import './ui/hud.css';

const canvas = document.getElementById('stage') as HTMLCanvasElement | null;
const hudRoot = document.getElementById('hud');
if (!canvas || !hudRoot) throw new Error('stage missing');

const app = new App(canvas, hudRoot);
app.start();

// Scripted access for the placement/section correspondence harness.
(window as unknown as { redring?: unknown }).redring = app.harness;

const onResize = (): void => app.resize();
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', () => window.setTimeout(onResize, 120));
if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);

// iOS Safari fires a scroll on rubber band even with overflow hidden.
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
