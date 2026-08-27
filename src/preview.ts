/**
 * preview.ts — development-only contact sheet of the tissue model.
 *
 * Renders the SAME model at every magnification of the dive side by side so the
 * landmark, the stain and the emergence of detail can be checked against reference
 * histology by eye. Not part of the shipped game.
 */

import * as THREE from 'three';
import { createTissueMaterial } from './micro/tissueMaterial';
import { HERO_TISSUE, follicleAxisPoint } from './micro/specimen';
import { OBJECTIVES, resolutionMM, FINAL_FIELD_MM } from './micro/optics';

const params = new URLSearchParams(location.search);
const SET = params.get('set') ?? 'all';
const TILE = Number(params.get('tile') ?? (SET === 'all' ? 420 : 840));
const COLS = Number(params.get('cols') ?? (SET === 'all' ? 4 : 2));

interface Tile {
  label: string;
  centre: [number, number];
  fieldMM: number;
  na: number;
  focusZ: number;
}

const o4 = OBJECTIVES[0];
const o10 = OBJECTIVES[1];
const o20 = OBJECTIVES[2];
const o40 = OBJECTIVES[3];
const hero: [number, number] = [HERO_TISSUE.x, HERO_TISSUE.y];
const bulb = follicleAxisPoint(3.10);

const tiles: Tile[] = [
  { label: 'slide scan 13.2mm', centre: [0, 2.6], fieldMM: 13.2, na: 0.1, focusZ: 0 },
  { label: '4x  5.50mm', centre: hero, fieldMM: 5.5, na: o4.na, focusZ: 0 },
  { label: '10x 2.20mm', centre: hero, fieldMM: 2.2, na: o10.na, focusZ: 0 },
  { label: '20x 1.10mm', centre: hero, fieldMM: 1.1, na: o20.na, focusZ: 0 },
  { label: '40x 0.55mm', centre: hero, fieldMM: 0.55, na: o40.na, focusZ: 0 },
  { label: `final ${FINAL_FIELD_MM.toFixed(3)}mm`, centre: hero, fieldMM: FINAL_FIELD_MM, na: o40.na, focusZ: 0 },
  { label: 'infundibulum 1.1mm', centre: [0.06, 0.22], fieldMM: 1.1, na: o20.na, focusZ: 0 },
  { label: 'seb gland 0.55mm', centre: [-0.22, 0.56], fieldMM: 0.55, na: o40.na, focusZ: 0 },
  { label: 'epidermis 40x', centre: [-0.75, 0.02], fieldMM: 0.55, na: o40.na, focusZ: 0 },
  { label: 'epidermis 10x', centre: [-0.9, 0.25], fieldMM: 2.2, na: o10.na, focusZ: 0 },
  { label: 'hair bulb 10x', centre: [bulb.x, bulb.y], fieldMM: 2.2, na: o10.na, focusZ: 0 },
  { label: 'hair bulb 40x', centre: [bulb.x, bulb.y], fieldMM: 0.55, na: o40.na, focusZ: 0 },
  { label: 'eccrine 20x', centre: [-1.95, 3.78], fieldMM: 1.1, na: o20.na, focusZ: 0 },
  { label: 'fat 20x', centre: [0.5, 5.6], fieldMM: 1.1, na: o20.na, focusZ: 0 },
  { label: 'section edge 10x', centre: [4.3, 2.0], fieldMM: 2.2, na: o10.na, focusZ: 0 },
  { label: '40x focus +2um', centre: hero, fieldMM: 0.55, na: o40.na, focusZ: 0.002 },
];

const focusTiles: Tile[] = [
  { label: 'ISTHMUS 40x centred on hero', centre: hero, fieldMM: 0.55, na: o40.na, focusZ: 0 },
  { label: 'BULB 40x', centre: [bulb.x, bulb.y + 0.24], fieldMM: 0.9, na: o40.na, focusZ: 0 },
  { label: 'SEB GLAND 40x', centre: [-0.205, 0.505], fieldMM: 0.42, na: o40.na, focusZ: 0 },
  { label: 'EPIDERMIS 40x', centre: [-0.75, 0.03], fieldMM: 0.38, na: o40.na, focusZ: 0 },
];

const active = SET === 'focus' ? focusTiles : tiles;
const rows = Math.ceil(active.length / COLS);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(1);
renderer.setSize(COLS * TILE, rows * TILE, false);
canvas.style.width = `${COLS * TILE}px`;
canvas.style.height = `${rows * TILE}px`;
renderer.autoClear = false;
renderer.setScissorTest(true);

const scene = new THREE.Scene();
const camera = new THREE.Camera();
const material = createTissueMaterial(4);
const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
quad.frustumCulled = false;
scene.add(quad);

const labels = document.getElementById('labels') as HTMLDivElement;

active.forEach((tile, i) => {
  const cx = i % COLS;
  const cy = Math.floor(i / COLS);
  const x = cx * TILE;
  const yTop = cy * TILE;
  const yGL = (rows - 1 - cy) * TILE;

  const u = material.uniforms;
  u.uCentre.value.set(tile.centre[0], tile.centre[1]);
  u.uFieldMM.value = tile.fieldMM;
  u.uAspect.value = 1;
  u.uTexelMM.value = tile.fieldMM / TILE;
  u.uOptResMM.value = resolutionMM(tile.na);
  u.uFocusZ.value = tile.focusZ;
  u.uNA.value = tile.na;

  renderer.setViewport(x, yGL, TILE, TILE);
  renderer.setScissor(x, yGL, TILE, TILE);
  renderer.render(scene, camera);

  const el = document.createElement('div');
  el.className = 'lb';
  el.style.left = `${x + 6}px`;
  el.style.top = `${yTop + 6}px`;
  el.textContent = `${tile.label}  ${(tile.fieldMM / TILE * 1000).toFixed(2)}um/px`;
  labels.appendChild(el);
});

(window as unknown as { __previewReady: boolean }).__previewReady = true;
