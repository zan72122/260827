import * as THREE from 'three';
import { makeStainless } from '../render/MetalMaterial';
import { makeRng } from '../util/math';

/**
 * Foreground bench, turntable, and a readable pastry kitchen behind it.
 * Background objects keep their silhouettes — they are simply low poly and
 * never cast shadows. No coloured rim light anywhere.
 */
export function buildKitchen(): { group: THREE.Group; turntable: THREE.Group; windowDir: THREE.Vector3 } {
  const group = new THREE.Group();
  const rng = makeRng(7);

  // ---- bench --------------------------------------------------------------
  const benchTop = new THREE.Mesh(
    new THREE.BoxGeometry(1.9, 0.026, 1.5),
    new THREE.MeshPhysicalMaterial({
      color: 0xd9d4c8,
      roughness: 0.44,
      metalness: 0.0,
      clearcoat: 0.24,
      clearcoatRoughness: 0.5,
    }),
  );
  benchTop.position.set(0, -0.013, 0.30);
  benchTop.receiveShadow = true;
  group.add(benchTop);

  const apron = new THREE.Mesh(
    new THREE.BoxGeometry(1.9, 0.09, 1.5),
    new THREE.MeshStandardMaterial({ color: 0xa9a396, roughness: 0.7 }),
  );
  apron.position.set(0, -0.072, 0.30);
  group.add(apron);

  // ---- turntable ----------------------------------------------------------
  const turntable = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({
    color: 0xb4b8bb,
    metalness: 0.92,
    roughness: 0.36,
  });
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.107, 0.105, 0.007, 96), steel);
  plate.position.y = -0.003;
  plate.receiveShadow = true;
  plate.castShadow = true;
  turntable.add(plate);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(0.1055, 0.0022, 10, 96), steel);
  lip.rotation.x = Math.PI / 2;
  lip.position.y = -0.0042;
  turntable.add(lip);
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.030, 0.048, 26), steel);
  column.position.y = -0.031;
  turntable.add(column);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.070, 0.011, 34), steel);
  foot.position.y = -0.0605;
  foot.receiveShadow = true;
  turntable.add(foot);
  turntable.position.y = -0.0;
  group.add(turntable);

  // soft contact darkening under the turntable
  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(0.135, 40),
    new THREE.MeshBasicMaterial({
      color: 0x6d6455,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
    }),
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = -0.0655;
  blob.renderOrder = -1;
  group.add(blob);

  // ---- mid ground: a few working props ------------------------------------
  const bowlMat = makeStainless({ roughness: 0.42, color: 0xc2c6c9, drawn: 0.3 });
  bowlMat.metalness = 0.82;
  const bowl = (r: number, x: number, z: number, tilt: number) => {
    const g = new THREE.SphereGeometry(r, 26, 16, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5);
    const m = new THREE.Mesh(g, bowlMat);
    m.position.set(x, r * 0.94, z);
    m.rotation.z = tilt;
    group.add(m);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r * 0.995, r * 0.03, 8, 40), bowlMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.copy(m.position);
    rim.rotation.z = tilt;
    group.add(rim);
  };
  bowl(0.092, -0.315, 0.315, 0.0);
  bowl(0.058, 0.375, 0.430, 0.05);

  // a small wire shelf standing on the bench: reads as a kitchen at any angle
  const shelfMat = makeStainless({ roughness: 0.44, color: 0xa9aeb1, drawn: 0.2 });
  const benchShelf = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const sh = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.006, 0.15), shelfMat);
    sh.position.set(0, 0.055 + i * 0.105, 0);
    benchShelf.add(sh);
    if (i < 2) {
      const tray = new THREE.Mesh(
        new THREE.BoxGeometry(0.26, 0.012, 0.11),
        new THREE.MeshStandardMaterial({ color: 0xb9b5a8, roughness: 0.62 }),
      );
      tray.position.set(0, 0.064 + i * 0.105, 0);
      benchShelf.add(tray);
    }
  }
  for (const sx of [-0.16, 0.16]) {
    for (const sz of [-0.065, 0.065]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.0042, 0.0042, 0.28, 6), shelfMat);
      post.position.set(sx, 0.14, sz);
      benchShelf.add(post);
    }
  }
  benchShelf.position.set(0.56, 0, 0.60);
  group.add(benchShelf);

  const board = new THREE.Mesh(
    new THREE.BoxGeometry(0.20, 0.012, 0.14),
    new THREE.MeshStandardMaterial({ color: 0xa87d52, roughness: 0.72 }),
  );
  board.position.set(-0.185, 0.006, 0.275);
  board.receiveShadow = true;
  group.add(board);

  // a scraper resting on the board
  const scraper = new THREE.Mesh(
    new THREE.BoxGeometry(0.085, 0.0016, 0.062),
    new THREE.MeshStandardMaterial({ color: 0xdad6cc, roughness: 0.35, metalness: 0.05 }),
  );
  scraper.position.set(-0.17, 0.013, 0.268);
  scraper.rotation.set(0, 0.5, 0.06);
  group.add(scraper);

  // ---- background: a kitchen you can read, never blurred out ---------------
  const back = new THREE.Group();

  const facing = (mesh: THREE.Mesh, x: number, y: number, z: number) => {
    mesh.position.set(x, y, z);
    mesh.rotation.y = Math.PI;
    back.add(mesh);
    return mesh;
  };

  facing(
    new THREE.Mesh(
      new THREE.PlaneGeometry(5.0, 2.8),
      new THREE.MeshStandardMaterial({ color: 0xcfc9bb, roughness: 0.95 }),
    ),
    0, 0.34, 1.16,
  );
  facing(
    new THREE.Mesh(
      new THREE.PlaneGeometry(5.0, 0.62),
      new THREE.MeshStandardMaterial({ color: 0xdcd9d1, roughness: 0.5, metalness: 0.02 }),
    ),
    0, -0.10, 1.145,
  );

  // window: bright daylight, warm, not blown out
  facing(
    new THREE.Mesh(
      new THREE.PlaneGeometry(0.82, 1.02),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0.925, 0.915, 0.868) }),
    ),
    -0.80, 0.40, 1.135,
  );
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x8d8578, roughness: 0.7 });
  for (const [w, h, x, y] of [
    [0.90, 0.04, -0.80, -0.12],
    [0.90, 0.04, -0.80, 0.92],
    [0.04, 1.10, -1.23, 0.40],
    [0.04, 1.10, -0.37, 0.40],
    [0.026, 1.02, -0.80, 0.40],
  ] as [number, number, number, number][]) {
    facing(new THREE.Mesh(new THREE.PlaneGeometry(w, h), frameMat), x, y, 1.13);
  }

  // wire rack with trays
  const rackMat = makeStainless({ roughness: 0.44, color: 0x9ba0a3, drawn: 0.2 });
  const rack = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.012, 0.34), rackMat);
    shelf.position.set(0, 0.20 + i * 0.30, 0);
    rack.add(shelf);
    if (i < 3) {
      const tray = new THREE.Mesh(
        new THREE.BoxGeometry(0.62, 0.02, 0.26),
        new THREE.MeshStandardMaterial({ color: 0xb6b2a6, roughness: 0.6 }),
      );
      tray.position.set((rng() - 0.5) * 0.1, 0.218 + i * 0.30, (rng() - 0.5) * 0.05);
      rack.add(tray);
    }
  }
  for (const sx of [-0.41, 0.41]) {
    for (const sz of [-0.15, 0.15]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 1.32, 8), rackMat);
      post.position.set(sx, 0.66, sz);
      rack.add(post);
    }
  }
  rack.position.set(0.86, -0.9, 0.94);
  back.add(rack);

  // refrigerated case
  const caseBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.82, 1.30, 0.46),
    makeStainless({ roughness: 0.48, color: 0xa5aaad, drawn: 0.2 }),
  );
  caseBody.position.set(-0.60, -0.34, 1.00);
  back.add(caseBody);
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(0.78, 1.02),
    new THREE.MeshPhysicalMaterial({
      color: 0xbcc4c4,
      roughness: 0.1,
      metalness: 0,
      transparent: true,
      opacity: 0.32,
      clearcoat: 1,
      side: THREE.DoubleSide,
    }),
  );
  glass.position.set(-0.60, -0.18, 0.768);
  back.add(glass);

  back.traverse((o) => {
    o.castShadow = false;
    o.receiveShadow = false;
  });
  group.add(back);

  // floor
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(9, 9),
    new THREE.MeshStandardMaterial({ color: 0xb2ab9d, roughness: 0.9 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, -0.92, 0.9);
  group.add(floor);

  return { group, turntable, windowDir: new THREE.Vector3(-0.80, 0.78, 1.13).normalize() };
}
