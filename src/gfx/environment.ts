import * as THREE from 'three';

/**
 * A tiny hand-built room used only as a reflection probe. Metal needs something
 * to reflect: an overcast window on one side, a warm work lamp on the other, and
 * dark timber everywhere else. No HDR file is downloaded.
 */
export function buildEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const s = new THREE.Scene();

  const box = new THREE.Mesh(
    new THREE.BoxGeometry(12, 7, 12),
    new THREE.MeshBasicMaterial({ color: 0x191510, side: THREE.BackSide })
  );
  s.add(box);

  // floor bounce
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 12),
    new THREE.MeshBasicMaterial({ color: 0x3d3125 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -3.4;
  s.add(floor);

  // overcast window: broad, cool, soft-edged
  const winMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const win = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 4.4), winMat);
  win.position.set(-5.9, 1.1, 0.4);
  win.rotation.y = Math.PI / 2;
  s.add(win);
  const winGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(7.6, 5.4),
    new THREE.MeshBasicMaterial({ color: 0x9fb2c4, transparent: true, opacity: 0.75 })
  );
  winGlow.position.set(-5.85, 1.0, 0.4);
  winGlow.rotation.y = Math.PI / 2;
  s.add(winGlow);

  // warm articulated work lamp
  const lamp = new THREE.Mesh(
    new THREE.CircleGeometry(1.15, 20),
    new THREE.MeshBasicMaterial({ color: 0xffe6bc })
  );
  lamp.position.set(2.4, 3.2, 1.6);
  lamp.lookAt(0, 0, 0);
  s.add(lamp);

  // ceiling: faint cool sky bounce so upward-facing metal is not black
  const ceil = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 12),
    new THREE.MeshBasicMaterial({ color: 0x585f68 })
  );
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = 3.5;
  s.add(ceil);

  // a bright horizon band, like the run of windows along a workshop wall: this
  // is what puts a highlight along every cut edge and around the shell
  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(5.4, 5.4, 1.5, 24, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x6f7883, side: THREE.BackSide })
  );
  band.position.y = 0.75;
  s.add(band);

  // a couple of dark racks so reflections have structure instead of flat gradient
  for (let i = 0; i < 5; i++) {
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 2.4, 8),
      new THREE.MeshBasicMaterial({ color: i % 2 ? 0x18140f : 0x3a2f24 })
    );
    bar.position.set(5.6, -0.6 + i * 0.9, 0);
    s.add(bar);
  }

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const rt = pmrem.fromScene(s, 0.04);
  pmrem.dispose();
  s.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    if (m.material) (m.material as THREE.Material).dispose();
  });
  return rt.texture;
}
