import * as THREE from 'three';

/**
 * A tiny procedural room used only as a PMREM source, so every PBR surface in
 * the scene sits in one consistent light field. Warm daylight from a window,
 * a cool diffuse ceiling, a muted floor. No coloured neon anywhere.
 */
function panel(
  w: number,
  h: number,
  color: number,
  intensity: number,
): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity) }),
  );
  m.material.side = THREE.DoubleSide;
  m.material.toneMapped = false;
  return m;
}

export function buildEnvironmentScene(): THREE.Scene {
  const s = new THREE.Scene();

  // ceiling — broad diffuse light
  const ceil = panel(12, 12, 0xf3efe6, 1.55);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = 3.4;
  s.add(ceil);

  // window wall (key), slightly warm daylight
  const win = panel(4.6, 3.0, 0xfdf6e6, 5.2);
  win.position.set(-4.4, 1.7, 0.4);
  win.rotation.y = Math.PI / 2;
  s.add(win);

  const winSpill = panel(7, 3.6, 0xe8e4da, 0.62);
  winSpill.position.set(-4.6, 1.6, 0);
  winSpill.rotation.y = Math.PI / 2;
  s.add(winSpill);

  // opposite wall — dim bounce so metal has something to read
  const back = panel(10, 4, 0xcfc7b7, 0.42);
  back.position.set(0, 1.8, -4.2);
  s.add(back);

  const right = panel(10, 4, 0xd4cec2, 0.36);
  right.position.set(4.4, 1.8, 0);
  right.rotation.y = -Math.PI / 2;
  s.add(right);

  const front = panel(10, 4, 0xc9c2b4, 0.3);
  front.position.set(0, 1.8, 4.2);
  s.add(front);

  // stainless bench plane below — bright bounce onto the underside of things
  const floor = panel(9, 9, 0xb9b2a4, 0.34);
  floor.rotation.x = -Math.PI / 2;
  s.add(floor);

  const bench = panel(3.2, 2.2, 0xe4e0d6, 0.9);
  bench.rotation.x = -Math.PI / 2;
  bench.position.y = 0.9;
  s.add(bench);

  // two soft ceiling strips
  for (let i = -1; i <= 1; i += 2) {
    const strip = panel(3.2, 0.42, 0xfffaf0, 3.0);
    strip.rotation.x = Math.PI / 2;
    strip.position.set(0, 3.32, i * 1.5);
    s.add(strip);
  }

  s.background = new THREE.Color(0xd8d2c6);
  return s;
}

export function makeEnvironmentTexture(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const src = buildEnvironmentScene();
  const rt = pmrem.fromScene(src, 0.02, 0.1, 20);
  src.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  });
  pmrem.dispose();
  return rt.texture;
}
