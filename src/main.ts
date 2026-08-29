import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildTextures } from './materials/textures';
import { createMaterials } from './materials';
import { Game } from './game/game';
import { CAKE, SLOTS } from './cake/design';
import { STATION } from './scene/kitchen';

/** Board-top height of the cakes, matching the turntable build. */
const BUILD_CAKE_Y = 4.65 + CAKE.boardThickness;

const app = document.getElementById('app')!;
const boot = document.getElementById('boot')!;
const bar = boot.querySelector('#bar > i') as HTMLElement;

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: 'high-performance',
  alpha: false,
});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.localClippingEnabled = true;
app.appendChild(renderer.domElement);

// WebGL 2 is the baseline; WebGPU-only effects are never required to play.
const isWebGL2 = renderer.capabilities.isWebGL2;

let maxDpr = Math.min(window.devicePixelRatio || 1, isWebGL2 ? 2 : 1.5);
let dpr = Math.min(maxDpr, 1.75);

function size() {
  const w = app.clientWidth;
  const h = app.clientHeight;
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  return { w, h };
}

async function start() {
  const tex = await buildTextures((done, total) => {
    bar.style.width = `${Math.round((done / total) * 88)}%`;
  });
  const mats = createMaterials(tex, CAKE.radius);

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  bar.style.width = '96%';

  const { w, h } = size();
  const game = new Game(mats, renderer.domElement, w / h, env);
  game.rig.setAspect(w / h);

  const onResize = () => {
    maxDpr = Math.min(window.devicePixelRatio || 1, isWebGL2 ? 2 : 1.5);
    const s = size();
    game.rig.setAspect(s.w / s.h);
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => setTimeout(onResize, 220));

  // Warm the shader cache before the first frame is shown.
  renderer.compile(game.scene, game.rig.camera);
  bar.style.width = '100%';
  boot.classList.add('gone');
  setTimeout(() => boot.remove(), 700);

  if (import.meta.env.MODE !== 'production') {
    const project = (v: THREE.Vector3) => {
      const p = v.clone().project(game.rig.camera);
      return { x: ((p.x + 1) / 2) * app.clientWidth, y: ((-p.y + 1) / 2) * app.clientHeight };
    };
    (window as unknown as Record<string, unknown>).__scene = game.scene;
    (window as unknown as Record<string, unknown>).__game = game;
    (window as unknown as Record<string, unknown>).__renderer = renderer;
    (window as unknown as Record<string, unknown>).__probe = () => ({
      ...game.snapshot,
      tray: game.trayAnchors.map((v) => project(v)),
      slots: SLOTS.map((sl) =>
        project(new THREE.Vector3(
          STATION.build.x + Math.cos(sl.angle) * sl.radius,
          BUILD_CAKE_Y + CAKE.filling.y0 + CAKE.skim,
          STATION.build.z + Math.sin(sl.angle) * sl.radius
        ))
      ),
      rim: [0, 1, 2, 3, 4, 5, 6, 7].map((i) =>
        project(new THREE.Vector3(
          STATION.build.x + Math.cos((i / 8) * Math.PI * 2) * (CAKE.radius - 1),
          BUILD_CAKE_Y + CAKE.topCoat.y1,
          STATION.build.z + Math.sin((i / 8) * Math.PI * 2) * (CAKE.radius - 1)
        ))
      ),
      lid: project(new THREE.Vector3(STATION.build.x - 7.5, BUILD_CAKE_Y + CAKE.sponge2.y0 + 4.6, 8.5)),
      centre: project(new THREE.Vector3(STATION.build.x, BUILD_CAKE_Y + CAKE.topCoat.y1, STATION.build.z)),
      cutFrom: project(new THREE.Vector3(
        STATION.build.x + Math.cos(game.aimDirection) * (CAKE.radius + 1.5),
        BUILD_CAKE_Y + CAKE.topCoat.y1,
        STATION.build.z + Math.sin(game.aimDirection) * (CAKE.radius + 1.5)
      )),
    });
  }

  let last = performance.now();
  let acc = 0;
  let frames = 0;

  const loop = () => {
    requestAnimationFrame(loop);
    const now = performance.now();
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;

    const s = { w: app.clientWidth, h: app.clientHeight };
    game.update(dt, s.w, s.h);
    renderer.render(game.scene, game.rig.camera);

    // Dynamic resolution: keep the frame budget rather than the pixel count.
    acc += performance.now() - now;
    if (++frames >= 30) {
      const avg = acc / frames;
      acc = 0;
      frames = 0;
      if (avg > 20 && dpr > 1) {
        dpr = Math.max(1, dpr - 0.25);
        size();
      } else if (avg < 11 && dpr < maxDpr) {
        dpr = Math.min(maxDpr, dpr + 0.25);
        size();
      }
    }
  };
  loop();
}

void start().catch((err) => {
  boot.innerHTML = `<h1>よみこみに しっぱい</h1><p>${String(err)}</p>`;
});
