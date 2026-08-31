import * as THREE from 'three';
import { repeated, type Textures } from '../textures';

/**
 * A small paper-craft workshop, built from real geometry: the near edge of the
 * bench and its clamp up front, the tree in the middle, stock paper and a
 * shelf behind. The three depths are told apart by occlusion, by size, by
 * light and by contrast - not by a blurred photograph.
 */
export function buildWorkshop(tex: Textures, detail: number): THREE.Group {
  const g = new THREE.Group();
  const track: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T) => (track.push(x), x);

  const wood = keep(
    new THREE.MeshStandardMaterial({
      color: 0x9c7c57,
      roughness: 0.88,
      metalness: 0,
      map: keep(repeated(tex.wood, 7, 4)),
      roughnessMap: keep(repeated(tex.woodRough, 7, 4)),
      normalMap: keep(repeated(tex.woodNormal, 7, 4)),
      normalScale: new THREE.Vector2(0.22, 0.22),
    })
  );
  const woodDark = keep(
    new THREE.MeshStandardMaterial({
      color: 0x6b5133,
      roughness: 0.78,
      map: keep(repeated(tex.wood, 5, 2)),
      roughnessMap: keep(repeated(tex.woodRough, 5, 2)),
    })
  );
  const plaster = keep(new THREE.MeshStandardMaterial({ color: 0x9a9488, roughness: 0.98 }));
  const steel = keep(
    new THREE.MeshStandardMaterial({ color: 0x83878c, roughness: 0.38, metalness: 0.88 })
  );
  const paperGreen = keep(
    new THREE.MeshStandardMaterial({
      color: 0x537d47,
      roughness: 0.95,
      normalMap: tex.paperNormal,
      normalScale: new THREE.Vector2(0.3, 0.3),
    })
  );
  const paperWhite = keep(
    new THREE.MeshStandardMaterial({
      color: 0xd7d0c0,
      roughness: 0.93,
      normalMap: tex.cardNormal,
      normalScale: new THREE.Vector2(0.35, 0.35),
    })
  );
  const kraft = keep(new THREE.MeshStandardMaterial({ color: 0xb28f61, roughness: 0.92 }));

  const box = (
    w: number,
    h: number,
    d: number,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    ry = 0
  ) => {
    const geo = keep(new THREE.BoxGeometry(w, h, d));
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };

  // --- bench ------------------------------------------------------------
  const top = box(3.2, 0.03, 1.9, wood, 0.0, -0.015, -0.75);
  top.castShadow = false;
  box(3.2, 0.08, 0.026, woodDark, 0.0, -0.070, 0.187); // front apron, foreground
  box(0.07, 0.62, 0.07, woodDark, -0.72, -0.34, 0.13);
  box(0.07, 0.62, 0.07, woodDark, 0.72, -0.34, 0.13);

  // localised wear: only where hands and tools actually land
  const wearTex = keep(radialAlpha());
  const wearMat = keep(
    new THREE.MeshStandardMaterial({
      map: wearTex,
      transparent: true,
      opacity: 0.3,
      color: 0x4b3a2a,
      roughness: 0.45,
      metalness: 0,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    })
  );
  const wearGeo = keep(new THREE.PlaneGeometry(1, 1));
  const wear = (x: number, z: number, w: number, d: number, o: number) => {
    const m = new THREE.Mesh(wearGeo, wearMat.clone());
    (m.material as THREE.MeshStandardMaterial).opacity = o;
    keep(m.material as THREE.MeshStandardMaterial);
    m.rotation.x = -Math.PI / 2;
    m.scale.set(w, d, 1);
    m.position.set(x, 0.0006, z);
    g.add(m);
  };
  wear(0.0, 0.145, 0.85, 0.14, 0.30);   // where hands rest at the front edge
  wear(0.0, 0.0, 0.34, 0.30, 0.20);    // under the jig

  // --- foreground: bench clamp holding a scrap of card -------------------
  const clampG = new THREE.Group();
  clampG.position.set(-0.15, 0, 0.155);
  clampG.rotation.y = 0.22;
  const cbox = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(keep(new THREE.BoxGeometry(w, h, d)), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    clampG.add(mesh);
  };
  cbox(0.022, 0.012, 0.10, steel, 0, 0.006, 0);
  cbox(0.022, 0.062, 0.011, steel, 0, -0.025, -0.046);
  cbox(0.026, 0.010, 0.026, steel, 0, -0.052, -0.028);
  const screw = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.0035, 0.0035, 0.05, 10)), steel);
  screw.position.set(0, -0.03, -0.028);
  screw.castShadow = true;
  clampG.add(screw);
  const knob = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.0075, 0.0075, 0.006, 12)), steel);
  knob.position.set(0, -0.058, -0.028);
  knob.rotation.z = Math.PI / 2;
  clampG.add(knob);
  cbox(0.075, 0.0012, 0.055, paperWhite, 0.001, 0.0135, 0.006);
  g.add(clampG);

  // --- mid ground: stock on the bench ------------------------------------
  const stack = (x: number, z: number, n: number, mat: THREE.Material, w: number, d: number, ry: number) => {
    for (let i = 0; i < n; i++) {
      box(w, 0.0016, d, mat, x + (Math.random() - 0.5) * 0.003, 0.0009 + i * 0.0017, z + (Math.random() - 0.5) * 0.003, ry + (Math.random() - 0.5) * 0.016);
    }
  };
  stack(-0.20, 0.055, detail > 0 ? 9 : 4, paperGreen, 0.15, 0.20, -0.22);
  stack(0.205, 0.045, detail > 0 ? 7 : 3, paperWhite, 0.13, 0.175, 0.16);

  // bone folder + steel rule
  const folder = new THREE.Mesh(keep(new THREE.BoxGeometry(0.014, 0.0035, 0.115)), paperWhite);
  folder.position.set(0.13, 0.0018, 0.135);
  folder.rotation.y = -0.5;
  folder.castShadow = true;
  g.add(folder);
  box(0.026, 0.0018, 0.30, steel, -0.30, 0.001, 0.02, 0.30);

  // --- background: wall and shelf ----------------------------------------
  const wall = new THREE.Mesh(keep(new THREE.PlaneGeometry(11.0, 5.0)), plaster);
  wall.position.set(0, 1.20, -1.45);
  wall.receiveShadow = true;
  g.add(wall);

  if (detail > 0) {
    // wall shelf: further away, larger, and read mostly by silhouette
    box(2.30, 0.026, 0.30, woodDark, 0.05, 0.33, -1.29);
    box(2.30, 0.026, 0.30, woodDark, 0.05, 0.70, -1.29);
    box(0.03, 0.82, 0.30, woodDark, -1.09, 0.50, -1.29);
    box(0.03, 0.82, 0.30, woodDark, 1.19, 0.50, -1.29);

    // stock paper and honeycomb blanks on the shelf
    box(0.30, 0.15, 0.22, paperGreen, -0.62, 0.418, -1.29, 0.05);
    box(0.26, 0.10, 0.21, paperWhite, -0.26, 0.393, -1.30, -0.08);
    box(0.20, 0.21, 0.06, kraft, 0.14, 0.448, -1.26, 0.02);
    box(0.16, 0.26, 0.05, kraft, 0.37, 0.473, -1.27, -0.05);
    box(0.34, 0.09, 0.23, kraft, 0.78, 0.388, -1.29, 0.03);
    box(0.27, 0.14, 0.20, paperWhite, -0.53, 0.783, -1.29, -0.03);
    box(0.22, 0.19, 0.19, paperGreen, 0.03, 0.808, -1.30, 0.06);
    box(0.32, 0.08, 0.21, kraft, 0.60, 0.753, -1.29, 0.0);

    for (let i = 0; i < 3; i++) {
      const roll = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.042, 0.042, 0.40, 14)), kraft);
      roll.position.set(0.92 + i * 0.094, 0.545, -1.31 + i * 0.014);
      roll.castShadow = true;
      roll.receiveShadow = true;
      g.add(roll);
    }
    const jar = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.05, 0.047, 0.13, 16)), paperWhite);
    jar.position.set(-0.90, 0.408, -1.28);
    jar.castShadow = true;
    g.add(jar);
    for (let i = 0; i < 4; i++) {
      const t = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.0035, 0.0035, 0.22, 6)), steel);
      t.position.set(-0.905 + (i - 1.5) * 0.017, 0.518, -1.275 + (i % 2) * 0.012);
      t.rotation.z = (i - 1.5) * 0.06;
      g.add(t);
    }
  }

  g.userData.dispose = () => {
    for (const d of track) d.dispose();
    track.length = 0;
  };
  return g;
}

function radialAlpha(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const grd = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  return t;
}
