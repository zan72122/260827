import './style.css';
import { Engine } from './core/engine';
import { Hud } from './ui/hud';
import { Game } from './game/game';
import * as THREE from 'three';

import { Tweener } from './core/tween';

const speed = Number(new URLSearchParams(location.search).get('fast'));
if (Number.isFinite(speed) && speed > 0) Tweener.speed = speed;

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const engine = new Engine(canvas);
const hud = new Hud(document.getElementById('hud')!);
const game = new Game(engine, hud);
const scene = new URLSearchParams(location.search).get('scene');
if (scene) game.devJump(scene);
const litParam = Number(new URLSearchParams(location.search).get('progress'));
if (scene === 'finale' && Number.isFinite(litParam)) {
  window.setTimeout(() => game.devFinaleProgress(litParam), 900);
}

engine.start();

// plain timers, not rAF: a suspended frame loop must never leave the splash up
window.setTimeout(() => {
  const boot = document.getElementById('boot');
  if (!boot) return;
  boot.classList.add('hide');
  window.setTimeout(() => boot.remove(), 700);
}, 220);

const w = window as unknown as { __engine: Engine; __game: Game };
w.__engine = engine;
w.__game = game;
(window as unknown as { __THREE: typeof THREE }).__THREE = THREE;
