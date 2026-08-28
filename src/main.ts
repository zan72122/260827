import { Game } from './game/game';

const container = document.getElementById('app')!;
const game = new Game(container);

// a faint film grain, cheap and outside the render loop
const grain = document.getElementById('grain');
if (grain) {
  const c = document.createElement('canvas');
  c.width = c.height = 180;
  const g = c.getContext('2d')!;
  const img = g.createImageData(180, 180);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 128 + (Math.random() - 0.5) * 190;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  grain.style.setProperty('--grain', `url(${c.toDataURL('image/png')})`);
}

let last = performance.now();
let grainTick = 0;
function frame(now: number) {
  const t0 = performance.now();
  const dt = Math.min((now - last) / 1000, 1 / 20);
  last = now;
  try {
    game.update(dt);
    game.render();
  } catch (err) {
    // never let one bad frame end the session for a child who cannot restart it
    console.error(err);
  }
  game.renderStage.reportFrame(performance.now() - t0);
  if (grain && ++grainTick % 3 === 0) {
    grain.style.transform =
      `translate(${(Math.random() * 40 - 20).toFixed(1)}px, ${(Math.random() * 40 - 20).toFixed(1)}px)`;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// hold the boot screen until the first real frame is on the glass
requestAnimationFrame(() =>
  requestAnimationFrame(() => document.getElementById('boot')?.classList.add('hide'))
);
