import * as THREE from 'three';
import { Rng } from '../core/rng';
import { makeCanvas, canvasTexture } from './Textures';
import { ValueNoise } from '../core/noise';
import type { Materials } from './Materials';
import { makeBowl } from './Props';

/**
 * The room behind the work. Depth comes from overlap, true sizes, shadow and
 * parallax rather than haze or a heavy blur: this is an indoor kitchen, so the
 * air is clear and the far wall is simply further away and less lit.
 *
 * Loaded after the first frames are on screen so the cake is interactive first.
 */
export function buildKitchen(materials: Materials): THREE.Group {
  const room = new THREE.Group();
  const rng = new Rng(0x4711);

  /* ---- floor ---- */
  const floorTex = tileTexture();
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(9, 9),
    new THREE.MeshStandardMaterial({
      map: floorTex,
      roughness: 0.72,
      metalness: 0,
      color: 0xbfb8ae,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.92;
  floor.receiveShadow = false;
  room.add(floor);

  /* ---- bench the cake stands on ---- */
  const bench = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.055, 0.92), materials.woodTiled(7, 3.4));
  bench.position.set(0, -0.0975, 0.06);
  bench.receiveShadow = true;
  room.add(bench);
  const benchBody = new THREE.Mesh(
    new THREE.BoxGeometry(1.86, 0.79, 0.86),
    new THREE.MeshStandardMaterial({ color: 0xd9d5cd, roughness: 0.55, metalness: 0.15 }),
  );
  benchBody.position.set(0, -0.52, 0.06);
  room.add(benchBody);

  /* ---- the room encloses the bench, so the reveal has depth from every
     knife direction rather than only from the front ---- */
  const plaster = new THREE.MeshStandardMaterial({
    color: 0xe4e0d8,
    roughness: 0.95,
    metalness: 0,
  });
  const walls: [number, number, number, number][] = [
    [0, -2.35, 0, 9],
    [0, 2.9, Math.PI, 9],
    [-3.1, 0, Math.PI / 2, 6],
    [3.1, 0, -Math.PI / 2, 6],
  ];
  for (const [x, z, ry, width] of walls) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(width, 3.4), plaster);
    w.position.set(x, 0.78, z);
    w.rotation.y = ry;
    room.add(w);
  }

  /* ---- back wall and window ---- */
  const window = new THREE.Mesh(
    new THREE.PlaneGeometry(1.7, 1.28),
    new THREE.MeshBasicMaterial({ map: daylightTexture(), toneMapped: true }),
  );
  window.position.set(-1.12, 0.86, -2.33);
  room.add(window);
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(1.82, 1.4, 0.05),
    new THREE.MeshStandardMaterial({ color: 0xf2efe9, roughness: 0.7, metalness: 0 }),
  );
  frame.position.set(-1.12, 0.86, -2.4);
  room.add(frame);
  const mullion = new THREE.Mesh(
    new THREE.BoxGeometry(0.022, 1.28, 0.03),
    new THREE.MeshStandardMaterial({ color: 0xf7f5f1, roughness: 0.6 }),
  );
  mullion.position.set(-1.12, 0.86, -2.32);
  room.add(mullion);

  /* ---- speed rack with trays ---- */
  const rack = new THREE.Group();
  const post = new THREE.MeshStandardMaterial({ color: 0xa9adb0, roughness: 0.45, metalness: 0.85 });
  for (const [x, z] of [
    [-0.28, -0.22],
    [0.28, -0.22],
    [-0.28, 0.22],
    [0.28, 0.22],
  ]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 1.62, 10), post);
    p.position.set(x, 0.0, z);
    rack.add(p);
  }
  for (let i = 0; i < 7; i++) {
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.008, 0.46), post);
    shelf.position.y = -0.72 + i * 0.23;
    rack.add(shelf);
    if (i % 2 === 0) {
      const tray = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.014, 0.36),
        new THREE.MeshStandardMaterial({ color: 0xbcc0c2, roughness: 0.4, metalness: 0.9 }),
      );
      tray.position.set(rng.jitter(0.02), -0.705 + i * 0.23, rng.jitter(0.02));
      rack.add(tray);
    }
  }
  rack.position.set(1.45, -0.1, -1.55);
  rack.rotation.y = -0.22;
  room.add(rack);

  // A second rack behind the bench keeps the far side of the room occupied.
  const rack2 = rack.clone();
  rack2.position.set(0.62, -0.1, 1.9);
  rack2.rotation.y = 0.42;
  room.add(rack2);

  /* ---- refrigerated case ---- */
  const caseGroup = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.15, 1.05, 0.62),
    new THREE.MeshStandardMaterial({ color: 0xc8ccce, roughness: 0.32, metalness: 0.8 }),
  );
  body.position.y = -0.4;
  caseGroup.add(body);
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 0.62, 0.58),
    new THREE.MeshPhysicalMaterial({
      color: 0xdfe8ea,
      roughness: 0.06,
      metalness: 0,
      transmission: 0.86,
      thickness: 0.02,
      transparent: true,
      opacity: 0.5,
    }),
  );
  glass.position.y = 0.38;
  caseGroup.add(glass);
  for (let i = 0; i < 3; i++) {
    const shelf = new THREE.Mesh(
      new THREE.BoxGeometry(1.0, 0.01, 0.5),
      new THREE.MeshStandardMaterial({ color: 0xd7dbdd, roughness: 0.3, metalness: 0.6 }),
    );
    shelf.position.set(0, 0.16 + i * 0.22, 0);
    caseGroup.add(shelf);
  }
  caseGroup.position.set(-1.7, -0.1, -1.25);
  caseGroup.rotation.y = 0.3;
  room.add(caseGroup);

  /* ---- second work bench further back ---- */
  const steelTop = new THREE.MeshStandardMaterial({
    color: 0xc9ccce,
    roughness: 0.38,
    metalness: 0.7,
  });
  const bench2 = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.05, 0.7), steelTop);
  bench2.position.set(0.35, -0.13, -1.75);
  room.add(bench2);
  const bench2Body = new THREE.Mesh(
    new THREE.BoxGeometry(1.46, 0.74, 0.66),
    new THREE.MeshStandardMaterial({ color: 0xd2d5d6, roughness: 0.5, metalness: 0.3 }),
  );
  bench2Body.position.set(0.35, -0.525, -1.75);
  room.add(bench2Body);
  const bowl = makeBowl(materials);
  bowl.scale.setScalar(0.85);
  bowl.position.set(0.1, -0.105, -1.72);
  room.add(bowl);

  /* ---- a shelf of trays on the right ---- */
  const shelfUnit = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(1.3, 0.03, 0.34),
      new THREE.MeshStandardMaterial({ color: 0xdad5cc, roughness: 0.7 }),
    );
    board.position.y = 0.34 + i * 0.36;
    shelfUnit.add(board);
  }
  shelfUnit.position.set(2.1, 0, 0.6);
  shelfUnit.rotation.y = -Math.PI / 2.2;
  room.add(shelfUnit);

  /* ---- a bowl on the near bench, just inside the frame ---- */
  const nearBowl = makeBowl(materials);
  nearBowl.scale.setScalar(0.62);
  nearBowl.position.set(-0.32, -0.07, 0.2);
  room.add(nearBowl);

  return room;
}

function tileTexture(): THREE.Texture {
  const size = 512;
  const { canvas, ctx } = makeCanvas(size);
  const noise = new ValueNoise(0x7113, 64);
  ctx.fillStyle = '#c9c3b9';
  ctx.fillRect(0, 0, size, size);
  const img = ctx.getImageData(0, 0, size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4;
      const n = noise.fbm(x / size, y / size, 18, 3);
      const grout = x % 128 < 4 || y % 128 < 4 ? -26 : 0;
      const v = (n - 0.5) * 22 + grout;
      img.data[o] += v;
      img.data[o + 1] += v;
      img.data[o + 2] += v;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = canvasTexture(canvas);
  tex.repeat.set(6, 6);
  return tex;
}

/** What is outside the window: bright, cool, and softly out of focus. */
function daylightTexture(): THREE.Texture {
  const size = 256;
  const { canvas, ctx } = makeCanvas(size);
  const g = ctx.createLinearGradient(0, 0, 0, size);
  g.addColorStop(0, '#e8f0f6');
  g.addColorStop(0.55, '#dde7ee');
  g.addColorStop(0.72, '#cbd6cf');
  g.addColorStop(1, '#b9c4bd');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const noise = new ValueNoise(0x991, 64);
  const img = ctx.getImageData(0, 0, size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4;
      const n = noise.fbm(x / size, y / size, 5, 3);
      const v = (n - 0.5) * 24;
      img.data[o] += v * 0.6;
      img.data[o + 1] += v * 0.7;
      img.data[o + 2] += v * 0.5;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvasTexture(canvas);
}
