import * as THREE from 'three';
import { Engine } from './core/engine';
import { CameraRig } from './core/cameraRig';
import { Workshop } from './game/workshop';
import { Director } from './game/director';
import { Hud } from './ui/hud';
import { audio } from './audio/audio';
import { BENCH_TOP } from './world/layout';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const veil = document.getElementById('veil')!;

function fail(message: string) {
  veil.innerHTML =
    `<div style="max-width:22rem;padding:1.5rem;color:#e6cfa8;font-size:15px;line-height:1.7;text-align:center">${message}</div>`;
}

let engine: Engine;
try {
  engine = new Engine(canvas);
} catch {
  fail('この端末では WebGL2 を利用できませんでした。<br>別のブラウザでお試しください。');
  throw new Error('no webgl2');
}

const workshop = new Workshop(engine);
const rig = new CameraRig(engine, {
  name: 'boot',
  target: new THREE.Vector3(0.05, BENCH_TOP + 0.2, -0.05),
  dist: 2.5, yaw: -0.12, pitch: 0.16, fov: 42,
});
const hud = new Hud(engine);
const director = new Director(workshop, rig, hud);

hud.onSound = (muted) => audio.setMuted(muted);
hud.onPip = (i) => director.enterFree(i);

engine.onUpdate((dt, t) => {
  rig.update(dt, t);
  workshop.update(dt, t);
  director.update(dt);
  const idle = (performance.now() - workshop.interaction.lastInputAt) / 1000;
  hud.update(dt, director.hintNow(), idle, workshop.interaction.pointerActive);
});

engine.start();
director.start();

// the first pointer anywhere also starts the audio context (iOS requires it)
const unlock = () => { void audio.unlock(); };
window.addEventListener('pointerdown', unlock, { once: false });

requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    veil.classList.add('gone');
    window.setTimeout(() => veil.remove(), 1400);
  });
});

/* ------------------------------------------------------------------ *
 * Automation hook.  Off unless the page is opened with ?autotest, and it
 * exposes no controls of its own: it reports where the current gesture
 * should happen so a script can perform real pointer input.
 * ------------------------------------------------------------------ */
if (location.search.includes('autotest')) {
  const px = (v: THREE.Vector3) => {
    const p = engine.projectPx(v, new THREE.Vector2());
    return { x: Math.round(p.x), y: Math.round(p.y) };
  };
  (window as unknown as Record<string, unknown>).__CMW = {
    get step() { return director.stepId; },
    get hint() {
      const h = director.hintNow();
      if (!h) return null;
      if (h.kind === 'tap') return { kind: h.kind, at: px(h.at) };
      if (h.kind === 'swipe') return { kind: h.kind, at: px(h.at), dir: h.dir };
      return { kind: h.kind, from: px(h.from), to: px(h.to) };
    },
    get state() {
      const [smoke, py, ch] = director.machinesRunning;
      return {
        step: director.stepId,
        progress: director.progress,
        smoking: smoke, pyramidRunning: py, chimesRunning: ch,
        free: director.free,
        orientation: engine.orientation,
        tier: engine.tier.name,
        fps: Math.round(engine.fps),
        cameraSettled: rig.settled,
        counts: director.counts,
        pyramidPitch: Number(workshop.pyramid.pitch.toFixed(3)),
        pyramidOmega: Number(workshop.pyramid.omega.toFixed(3)),
        chimesOmega: Number(workshop.chimes.omega.toFixed(3)),
        wire: Number(workshop.chimes.wire.toFixed(4)),
        lamp: Number(workshop.room.lampValue.toFixed(3)),
      };
    },
  };
}
