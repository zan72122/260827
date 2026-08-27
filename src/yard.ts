import * as THREE from 'three';
import { fenceTexture, gravelTexture, muralTexture, skyTexture } from './textures';

/**
 * The decommissioned demolition training yard: gravel ground, perimeter
 * safety fencing, stored material, and — behind the test wall — what was
 * always there: an old plastered facade with a faded mural and the steel
 * frame of the former workshop, lit by the sun.
 */
export function buildYard(scene: THREE.Scene): void {
  scene.background = skyTexture();
  scene.fog = new THREE.Fog(0xc3ccd2, 26, 78);

  // lights
  const hemi = new THREE.HemisphereLight(0xbdd0e4, 0x8a7f6c, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.2);
  sun.position.set(-10, 16, -13);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -14;
  sun.shadow.camera.right = 14;
  sun.shadow.camera.top = 16;
  sun.shadow.camera.bottom = -4;
  sun.shadow.camera.near = 2;
  sun.shadow.camera.far = 60;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  // warm bounce from behind the wall so the mural reads through fresh holes
  const reveal = new THREE.PointLight(0xffe2b0, 12, 12, 2);
  reveal.position.set(0, 3.2, 2.2);
  scene.add(reveal);

  // ground
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(60, 40),
    new THREE.MeshStandardMaterial({ map: gravelTexture(), roughness: 1.0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // crushed-stone apron right in front of the wall (near-field detail)
  const apronTex = gravelTexture();
  apronTex.repeat.set(2.5, 1.2);
  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 6),
    new THREE.MeshStandardMaterial({ map: apronTex, roughness: 1.0, color: 0xb0a898 })
  );
  apron.rotation.x = -Math.PI / 2;
  apron.position.set(0, 0.012, -1.4);
  apron.receiveShadow = true;
  scene.add(apron);
  // scattered larger stones near the wall
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x8d867a, roughness: 1 });
  const stoneGeo = new THREE.DodecahedronGeometry(0.09, 0);
  const stones = new THREE.InstancedMesh(stoneGeo, stoneMat, 80);
  const d = new THREE.Object3D();
  for (let i = 0; i < 80; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 2 + Math.random() * 9;
    d.position.set(Math.cos(a) * r, 0.03, Math.sin(a) * r - 2);
    d.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    d.scale.setScalar(0.5 + Math.random() * 1.6);
    d.updateMatrix();
    stones.setMatrixAt(i, d.matrix);
  }
  stones.receiveShadow = true;
  scene.add(stones);

  // ===== behind the wall: revealed space =====
  const behind = new THREE.Group();
  // old facade with faded mural
  const mural = new THREE.Mesh(
    new THREE.PlaneGeometry(11, 6.8),
    new THREE.MeshStandardMaterial({ map: muralTexture(), roughness: 0.95 })
  );
  mural.position.set(0, 3.4, 3.4);
  mural.rotation.y = Math.PI;
  behind.add(mural);
  // steel frame of the former workshop standing before the facade
  const beamMat = new THREE.MeshStandardMaterial({ color: 0x6e4f3a, roughness: 0.7, metalness: 0.4 });
  for (const x of [-3.4, -0.8, 1.9, 4.1]) {
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.16, 5.6, 0.22), beamMat);
    col.position.set(x, 2.8, 2.4);
    col.castShadow = true;
    behind.add(col);
  }
  const header = new THREE.Mesh(new THREE.BoxGeometry(9.4, 0.22, 0.22), beamMat);
  header.position.set(0.3, 5.1, 2.4);
  behind.add(header);
  // sunlit floor strip behind the wall
  const lightStrip = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 2.6),
    new THREE.MeshStandardMaterial({ color: 0xcdbd9e, roughness: 1 })
  );
  lightStrip.rotation.x = -Math.PI / 2;
  lightStrip.position.set(0, 0.02, 2.0);
  behind.add(lightStrip);
  scene.add(behind);

  // ===== perimeter =====
  const fenceTex = fenceTexture();
  const fenceMat = new THREE.MeshStandardMaterial({
    map: fenceTex,
    transparent: true,
    alphaTest: 0.3,
    side: THREE.DoubleSide,
    roughness: 0.6,
    metalness: 0.5,
  });
  const postMat = new THREE.MeshStandardMaterial({ color: 0x5f6165, roughness: 0.6, metalness: 0.5 });
  const addFenceRun = (x0: number, z0: number, x1: number, z1: number): void => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(len, 2.0), fenceMat);
    panel.position.set((x0 + x1) / 2, 1.0, (z0 + z1) / 2);
    panel.rotation.y = Math.atan2(x1 - x0, z1 - z0) + Math.PI / 2;
    scene.add(panel);
    const n = Math.max(2, Math.round(len / 2.4));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 2.15, 6), postMat);
      post.position.set(x0 + (x1 - x0) * t, 1.05, z0 + (z1 - z0) * t);
      scene.add(post);
    }
  };
  // fence ring around the working area (open corridor kept clear of the swing)
  addFenceRun(-16, -18, 16, -18);
  addFenceRun(16, -18, 16, 10);
  addFenceRun(16, 10, -16, 10);
  addFenceRun(-16, 10, -16, -18);

  // supervising worker OUTSIDE the fence line, watching from a distance
  const worker = new THREE.Group();
  const vest = new THREE.MeshStandardMaterial({ color: 0xd8641e, roughness: 0.9 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.78, 8), vest);
  body.position.y = 1.0;
  worker.add(body);
  const legs = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.17, 0.62, 8),
    new THREE.MeshStandardMaterial({ color: 0x33383e, roughness: 0.95 })
  );
  legs.position.y = 0.31;
  worker.add(legs);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0xc9a183, roughness: 0.8 })
  );
  head.position.y = 1.52;
  worker.add(head);
  const hat = new THREE.Mesh(
    new THREE.SphereGeometry(0.135, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5 })
  );
  hat.position.y = 1.56;
  worker.add(hat);
  worker.position.set(-17.2, 0, -6);
  worker.castShadow = true;
  scene.add(worker);

  // ===== stored material / mid-ground silhouettes =====
  const palletMat = new THREE.MeshStandardMaterial({ color: 0x8a6c48, roughness: 1 });
  const slabMat = new THREE.MeshStandardMaterial({ color: 0x97948c, roughness: 1 });
  for (let i = 0; i < 3; i++) {
    const stack = new THREE.Group();
    for (let k = 0; k < 3 + (i % 2); k++) {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.22, 1.1), k % 2 ? slabMat : palletMat);
      slab.position.y = 0.15 + k * 0.24;
      slab.rotation.y = (Math.random() - 0.5) * 0.12;
      slab.castShadow = true;
      stack.add(slab);
    }
    stack.position.set(9 + i * 2.4, 0, -10 + i * 3.6);
    scene.add(stack);
  }
  // spare wrecking ball resting on a timber cradle (storage)
  const spare = new THREE.Mesh(
    new THREE.SphereGeometry(0.6, 18, 14),
    new THREE.MeshStandardMaterial({ color: 0x47464a, roughness: 0.6, metalness: 0.6 })
  );
  spare.position.set(-11.5, 0.68, -12.5);
  spare.castShadow = true;
  scene.add(spare);
  const cradle = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.18, 0.9), palletMat);
  cradle.position.set(-11.5, 0.09, -12.5);
  scene.add(cradle);

  // low water-filled barriers marking the corridor edge
  const barrierMat = new THREE.MeshStandardMaterial({ color: 0xb8483a, roughness: 0.85 });
  const barrierMatW = new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: 0.85 });
  for (let i = 0; i < 5; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.6, 0.42), i % 2 ? barrierMat : barrierMatW);
    b.position.set(-8.5 + i * 0.2, 0.3, -12.5 + i * 1.9);
    b.rotation.y = 0.35;
    b.castShadow = true;
    scene.add(b);
  }
}
