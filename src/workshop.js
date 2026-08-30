import * as THREE from 'three';
import { woodTexture, plasterTexture, blobShadowTexture } from './env.js';

/**
 * The winter workshop, built so the three depth planes never merge:
 *   foreground  - bench top, tools, the burner and the tube
 *   midground   - the artisan's hands and the hanging stand
 *   background  - the shelf of ornaments and the cold window
 * All measurements are metres (bench top at 0.92 m).
 */

export const ANCHOR = {
  pieceOrigin: new THREE.Vector3(0.02, 1.28, 0.00),   // the closed tip of the tube
  pieceTilt: { z: 0.85, x: -0.12 },
  nozzle: new THREE.Vector3(-0.030, 1.152, 0.00),
  heatSpot: new THREE.Vector3(0.030, 1.262, 0.00),
  hook: new THREE.Vector3(-0.30, 1.46, -0.28),
  benchTop: 0.92,
};

const std = (p) => new THREE.MeshStandardMaterial(p);

export function buildWorkshop(scene, env, quality) {
  const root = new THREE.Group();
  scene.add(root);
  const shadows = quality.shadows;

  // ---------------------------------------------------------------- textures
  const wood = woodTexture(false); wood.repeat.set(2.2, 1.1);
  const darkWood = woodTexture(true); darkWood.repeat.set(3, 2);
  const plaster = plasterTexture(); plaster.repeat.set(5, 4);

  const woodMat = std({ map: wood, roughness: 0.74, metalness: 0.0, envMap: env, envMapIntensity: 0.35 });
  const darkWoodMat = std({ map: darkWood, roughness: 0.8, metalness: 0.0, envMap: env, envMapIntensity: 0.25 });
  const wallMat = std({ map: plaster, color: 0x9d968a, roughness: 0.95, metalness: 0.0, envMap: env, envMapIntensity: 0.6 });
  const brass = std({ color: 0xb08d4d, metalness: 1.0, roughness: 0.34, envMap: env, envMapIntensity: 1.0 });
  const steel = std({ color: 0x9aa1a8, metalness: 1.0, roughness: 0.26, envMap: env, envMapIntensity: 1.1 });
  const iron = std({ color: 0x35383d, metalness: 0.85, roughness: 0.55, envMap: env, envMapIntensity: 0.5 });

  // ------------------------------------------------------------------- room
  const floorWood = woodTexture(true); floorWood.repeat.set(6, 6);
  const floorMat = std({ map: floorWood, color: 0x6b6157, roughness: 0.92, metalness: 0.0, envMap: env, envMapIntensity: 0.25 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = shadows;
  root.add(floor);

  const backWall = new THREE.Mesh(new THREE.PlaneGeometry(6, 3.2), wallMat);
  backWall.position.set(0, 1.6, -2.2);
  backWall.receiveShadow = shadows;
  root.add(backWall);

  const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 3.2), wallMat);
  leftWall.position.set(-2.4, 1.6, -0.2);
  leftWall.rotation.y = Math.PI / 2;
  root.add(leftWall);

  const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 3.2), wallMat);
  rightWall.position.set(2.4, 1.6, -0.2);
  rightWall.rotation.y = -Math.PI / 2;
  root.add(rightWall);

  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), std({ color: 0x33302c, roughness: 1 }));
  ceiling.position.y = 2.8; ceiling.rotation.x = Math.PI / 2;
  root.add(ceiling);

  // ----------------------------------------------------------- cold window
  const winGroup = new THREE.Group();
  winGroup.position.set(-0.86, 1.60, -2.12);
  root.add(winGroup);

  // the winter outside: a cold vertical gradient, snow drifting in front of it
  const skyCan = document.createElement('canvas');
  skyCan.width = 8; skyCan.height = 64;
  const sg = skyCan.getContext('2d');
  const sgrad = sg.createLinearGradient(0, 0, 0, 64);
  sgrad.addColorStop(0.0, '#cfe2f2');
  sgrad.addColorStop(0.55, '#e7f0f8');
  sgrad.addColorStop(1.0, '#f6fbff');
  sg.fillStyle = sgrad; sg.fillRect(0, 0, 8, 64);
  const skyTex = new THREE.CanvasTexture(skyCan);
  skyTex.colorSpace = THREE.SRGBColorSpace;

  const outside = new THREE.Mesh(
    new THREE.PlaneGeometry(1.02, 1.22),
    new THREE.MeshBasicMaterial({ map: skyTex })
  );
  outside.position.z = -0.062;
  winGroup.add(outside);

  // the pane itself: a faint, cold sheet of glass over the snow
  const pane = new THREE.Mesh(
    new THREE.PlaneGeometry(0.95, 1.15),
    new THREE.MeshBasicMaterial({ color: 0xbdd6ea, transparent: true, opacity: 0.22 })
  );
  pane.position.z = 0.010;
  winGroup.add(pane);

  const frameMat = std({ map: darkWood, color: 0xbaa88c, roughness: 0.78, envMap: env, envMapIntensity: 0.35 });
  const bar = (w, h, x, y, z = 0.015) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.045), frameMat);
    m.position.set(x, y, z);
    winGroup.add(m);
    return m;
  };
  bar(1.10, 0.075, 0, 0.60); bar(1.10, 0.075, 0, -0.60);
  bar(0.075, 1.28, -0.52, 0); bar(0.075, 1.28, 0.52, 0);
  bar(0.038, 1.20, 0, 0);  bar(0.95, 0.038, 0, 0.12);
  const sill = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.06, 0.16), frameMat);
  sill.position.set(0, -0.64, 0.06);
  winGroup.add(sill);

  // a soft shaft of cold light on the floor, no heavy volumetrics
  const shaft = new THREE.Mesh(
    new THREE.PlaneGeometry(1.5, 2.4),
    new THREE.MeshBasicMaterial({
      color: 0x9fc4e0, transparent: true, opacity: 0.07,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })
  );
  shaft.rotation.x = -Math.PI / 2;
  shaft.position.set(-0.66, 0.012, -1.1);
  root.add(shaft);

  // ------------------------------------------------------------------ bench
  const benchTop = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.072, 0.82), woodMat);
  benchTop.position.set(0.05, ANCHOR.benchTop - 0.036, -0.28);
  benchTop.castShadow = shadows; benchTop.receiveShadow = shadows;
  root.add(benchTop);

  const apron = new THREE.Mesh(new THREE.BoxGeometry(2.24, 0.11, 0.06), darkWoodMat);
  apron.position.set(0.05, ANCHOR.benchTop - 0.13, 0.09);
  root.add(apron);

  for (const [lx, lz] of [[-1.0, -0.62], [1.1, -0.62], [-1.0, 0.05], [1.1, 0.05]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.885, 0.09), darkWoodMat);
    leg.position.set(0.05 + lx, 0.44, -0.28 + lz);
    leg.castShadow = shadows;
    root.add(leg);
  }

  // ----------------------------------------------------------- bench burner
  const burner = new THREE.Group();
  root.add(burner);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.072, 0.035, 24), iron);
  base.position.set(-0.235, ANCHOR.benchTop + 0.017, -0.01);
  base.castShadow = shadows;
  burner.add(base);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.032, 0.10, 20), brass);
  body.position.set(-0.235, ANCHOR.benchTop + 0.08, -0.01);
  burner.add(body);
  const valve = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.006, 8, 18), brass);
  valve.position.set(-0.198, ANCHOR.benchTop + 0.05, -0.01);
  valve.rotation.y = Math.PI / 2;
  burner.add(valve);
  // angled nozzle aimed at the glass
  const nozzleDir = new THREE.Vector3().subVectors(ANCHOR.heatSpot, ANCHOR.nozzle).normalize();
  const nozzleLen = 0.20;
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.0095, 0.016, nozzleLen, 16), brass);
  const nq = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), nozzleDir);
  nozzle.quaternion.copy(nq);
  nozzle.position.copy(ANCHOR.nozzle).addScaledVector(nozzleDir, -nozzleLen * 0.5);
  burner.add(nozzle);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.0092, 0.0022, 6, 16), steel);
  collar.quaternion.copy(nq); collar.rotateX(Math.PI / 2);
  collar.position.copy(ANCHOR.nozzle).addScaledVector(nozzleDir, -0.006);
  burner.add(collar);
  const hose = new THREE.Mesh(new THREE.TorusGeometry(0.10, 0.010, 8, 24, Math.PI * 0.9), iron);
  hose.position.set(-0.29, ANCHOR.benchTop + 0.02, -0.11);
  hose.rotation.set(Math.PI / 2, 0, 0.6);
  burner.add(hose);

  // ------------------------------------------------- stock tubing and tools
  const stock = new THREE.Group();
  root.add(stock);
  const stockMat = new THREE.MeshPhysicalMaterial({
    color: 0xdfeee9, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.55,
    envMap: env, envMapIntensity: 1.4, transmission: 0, ior: 1.5,
  });
  for (let i = 0; i < 4; i++) {
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.46, 12, 1, true), stockMat);
    rod.rotation.z = Math.PI / 2;
    rod.rotation.y = -0.06 + i * 0.035;
    rod.position.set(0.55 + i * 0.012, ANCHOR.benchTop + 0.007, -0.10 - i * 0.028);
    stock.add(rod);
  }
  const tray = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.022, 0.16), iron);
  tray.position.set(0.62, ANCHOR.benchTop + 0.011, -0.34);
  root.add(tray);

  // tweezers used to take the finished ball off the tube
  const tweezers = new THREE.Group();
  for (const s of [-1, 1]) {
    const armGeo = new THREE.BoxGeometry(0.006, 0.115, 0.0035);
    const arm = new THREE.Mesh(armGeo, steel);
    arm.position.set(s * 0.006, 0.058, 0);
    arm.rotation.z = -s * 0.10;
    tweezers.add(arm);
  }
  tweezers.visible = false;
  root.add(tweezers);

  // dropper of silvering solution
  const dropper = new THREE.Group();
  const dropTube = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0035, 0.075, 14), new THREE.MeshPhysicalMaterial({
    color: 0xdfeee9, roughness: 0.07, metalness: 0, transparent: true, opacity: 0.5, envMap: env, envMapIntensity: 1.4,
  }));
  dropTube.position.y = 0.037;
  const bulbTop = new THREE.Mesh(new THREE.SphereGeometry(0.011, 16, 12), std({ color: 0x2c2a2e, roughness: 0.85 }));
  bulbTop.position.y = 0.083;
  const liquid = new THREE.Mesh(new THREE.CylinderGeometry(0.0034, 0.0026, 0.042, 12), std({
    color: 0xd8dee6, metalness: 0.9, roughness: 0.2, envMap: env, envMapIntensity: 1.2,
  }));
  liquid.position.y = 0.03;
  dropper.add(dropTube, bulbTop, liquid);
  dropper.visible = false;
  root.add(dropper);

  // lacquer pot: where the colour comes from
  const pot = new THREE.Group();
  const potBody = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.031, 0.05, 20), steel);
  const potInk = new THREE.Mesh(new THREE.CylinderGeometry(0.031, 0.031, 0.004, 20), std({
    color: 0xb02b30, roughness: 0.3, metalness: 0.1, envMap: env, envMapIntensity: 0.8,
  }));
  potInk.position.y = 0.022;
  pot.add(potBody, potInk);
  pot.position.set(0.30, ANCHOR.benchTop + 0.025, -0.02);
  root.add(pot);

  // ------------------------------------------------------- hanging stand
  const stand = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.008, 0.60, 12), iron);
  post.position.set(ANCHOR.hook.x - 0.10, ANCHOR.benchTop + 0.30, ANCHOR.hook.z);
  const armH = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.52, 10), iron);
  armH.rotation.z = Math.PI / 2;
  armH.position.set(ANCHOR.hook.x + 0.14, ANCHOR.benchTop + 0.60, ANCHOR.hook.z);
  const hookWire = new THREE.Mesh(new THREE.CylinderGeometry(0.0016, 0.0016, 0.055, 8), iron);
  hookWire.position.copy(ANCHOR.hook).add(new THREE.Vector3(0, 0.072, 0));
  const hookCurl = new THREE.Mesh(new THREE.TorusGeometry(0.016, 0.0026, 8, 22, Math.PI * 1.5), iron);
  hookCurl.position.copy(ANCHOR.hook).add(new THREE.Vector3(0, 0.030, 0));
  hookCurl.rotation.set(Math.PI / 2, 0, 0);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.016, 18), iron);
  foot.position.set(ANCHOR.hook.x - 0.10, ANCHOR.benchTop + 0.008, ANCHOR.hook.z);
  stand.add(post, armH, hookWire, hookCurl, foot);
  root.add(stand);

  // --------------------------------------------------- shelf of ornaments
  const shelfMat = darkWoodMat;
  const shelves = new THREE.Group();
  root.add(shelves);
  const ornaments = [];
  const ornGeo = ornamentGeometry();
  const clearOrn = new THREE.MeshPhysicalMaterial({
    color: 0xe6f2ee, roughness: 0.05, metalness: 0.0, transparent: true, opacity: 0.30,
    envMap: env, envMapIntensity: 1.7, clearcoat: 1, clearcoatRoughness: 0.05,
  });
  const palette = [0xb0272d, 0x1f6b4d, 0xc79a3a, 0x2b5d80, 0x8e2f6e];

  for (let row = 0; row < 2; row++) {
    const y = 1.30 + row * 0.48;
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.20, 0.035, 0.24), shelfMat);
    board.position.set(0.28, y, -2.05);
    board.castShadow = shadows; board.receiveShadow = shadows;
    shelves.add(board);
    const bracketL = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.075, 0.14), darkWoodMat);
    bracketL.position.set(-0.24, y - 0.06, -2.06);
    const bracketR = bracketL.clone(); bracketR.position.x = 0.80;
    shelves.add(bracketL, bracketR);

    const n = 5;
    for (let i = 0; i < n; i++) {
      const finished = (i + row) % 3 !== 0;
      const m = finished
        ? std({
            color: palette[(i + row * 2) % palette.length], metalness: 1.0,
            roughness: 0.14 + Math.random() * 0.1, envMap: env, envMapIntensity: 1.35,
          })
        : clearOrn;
      const o = new THREE.Mesh(ornGeo, m);
      const s = 0.85 + Math.random() * 0.3;
      o.scale.setScalar(s);
      o.position.set(-0.19 + i * 0.235 + (Math.random() - 0.5) * 0.02, y + 0.0175 + 0.043 * s, -2.03 + (Math.random() - 0.5) * 0.05);
      o.rotation.y = Math.random() * 3.14;
      o.castShadow = shadows;
      shelves.add(o);
      ornaments.push(o);
    }
  }

  // -------------------------------------------------- cheap contact shadows
  const blobTex = blobShadowTexture();
  const blobMat = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: 0.55 });
  for (const [x, z, s] of [[-0.17, 0.0, 0.20], [0.62, -0.30, 0.34], [0.30, -0.02, 0.12], [ANCHOR.hook.x - 0.10, ANCHOR.hook.z, 0.16]]) {
    const b = new THREE.Mesh(new THREE.PlaneGeometry(s, s), blobMat);
    b.rotation.x = -Math.PI / 2;
    b.position.set(x, ANCHOR.benchTop + 0.002, z);
    root.add(b);
  }

  // ------------------------------------------------------------- lighting
  const hemi = new THREE.HemisphereLight(0x9dc0dc, 0x3a2416, 1.15);
  scene.add(hemi);

  const winLight = new THREE.DirectionalLight(0xc4dcf2, 2.6);
  winLight.position.set(-1.35, 2.05, -1.9);
  winLight.target.position.set(0.1, 1.15, -0.1);
  scene.add(winLight.target);
  if (shadows) {
    winLight.castShadow = true;
    winLight.shadow.mapSize.set(quality.shadowSize, quality.shadowSize);
    winLight.shadow.camera.near = 0.5;
    winLight.shadow.camera.far = 6;
    winLight.shadow.camera.left = -1.6;
    winLight.shadow.camera.right = 1.6;
    winLight.shadow.camera.top = 1.6;
    winLight.shadow.camera.bottom = -1.6;
    winLight.shadow.bias = -0.0012;
    winLight.shadow.normalBias = 0.012;
  }
  scene.add(winLight);

  // switched on only for the last beat, so the finished ornament reads as a
  // finished object and not as one more thing on a dark bench
  const heroLight = new THREE.PointLight(0xffd6a8, 0.0, 1.6, 1.6);
  heroLight.position.set(ANCHOR.hook.x + 0.16, ANCHOR.hook.y + 0.16, ANCHOR.hook.z + 0.34);
  scene.add(heroLight);

  const lamp = new THREE.PointLight(0xffc98f, 6.5, 5.0, 2);
  lamp.position.set(0.55, 2.15, 0.35);
  scene.add(lamp);

  const rim = new THREE.DirectionalLight(0x9ec6e8, 0.9);
  rim.position.set(1.6, 1.5, -1.4);
  scene.add(rim);

  // a low bounce so the back wall never goes to pure black
  const bounce = new THREE.DirectionalLight(0xd9c3a4, 0.55);
  bounce.position.set(0.4, 1.0, 1.8);
  scene.add(bounce);

  // the far wall is deliberately kept a few stops brighter than the bench:
  // hot glass only reads as glass when there is something behind it
  const wallFill = new THREE.DirectionalLight(0xbfd2e2, 1.5);
  wallFill.position.set(-0.2, 1.9, 1.4);
  wallFill.target.position.set(0.0, 1.5, -2.2);
  scene.add(wallFill.target);
  scene.add(wallFill);

  scene.fog = new THREE.FogExp2(0x22252b, 0.055);

  return { root, tweezers, dropper, pot, stand, hookCurl, ornaments, winLight, lamp, heroLight, pane, shaft };
}

/** Profile of a classic ornament: ball, thin neck, metal cap. */
export function ornamentGeometry() {
  const pts = [];
  const R = 0.040;
  for (let i = 0; i <= 22; i++) {
    const a = Math.PI * (0.06 + 0.88 * (i / 22));       // from the bottom pole up
    pts.push(new THREE.Vector2(Math.sin(a) * R, -Math.cos(a) * R));
  }
  pts.push(new THREE.Vector2(0.0072, R * 0.99));
  pts.push(new THREE.Vector2(0.0072, R * 1.22));
  pts.push(new THREE.Vector2(0.0001, R * 1.22));
  const geo = new THREE.LatheGeometry(pts, 24);
  geo.computeVertexNormals();
  geo.translate(0, R, 0);
  return geo;
}

/**
 * The artisan's hands, in the midground: the near hand rolls the tube between
 * thumb and fingers, exactly the gesture the child is being asked to copy.
 */
export function buildHands(env, quality) {
  const skin = new THREE.MeshStandardMaterial({
    color: 0xc08361, roughness: 0.68, metalness: 0.0, envMap: env, envMapIntensity: 0.3,
  });
  const wool = new THREE.MeshStandardMaterial({ color: 0x4a4640, roughness: 0.95 });

  /** dir: +1 the hand reaches in from +X, -1 from -X. */
  function hand(dir) {
    const g = new THREE.Group();

    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.041, 0.34, 16), wool);
    sleeve.rotation.z = Math.PI / 2;
    sleeve.position.x = dir * 0.28;
    g.add(sleeve);

    const wrist = new THREE.Mesh(new THREE.CapsuleGeometry(0.030, 0.05, 6, 14), skin);
    wrist.rotation.z = Math.PI / 2;
    wrist.position.x = dir * 0.095;
    g.add(wrist);

    const palm = new THREE.Mesh(new THREE.SphereGeometry(0.036, 20, 14), skin);
    palm.scale.set(1.0, 0.86, 0.52);
    palm.position.set(dir * 0.055, -0.004, 0);
    g.add(palm);

    // index + middle finger reach over the tube, thumb comes up under it
    const fingers = new THREE.Group();
    for (let i = 0; i < 2; i++) {
      const f = new THREE.Group();
      const prox = new THREE.Mesh(new THREE.CapsuleGeometry(0.0092, 0.030, 5, 12), skin);
      prox.rotation.z = dir * Math.PI / 2;
      prox.position.set(dir * -0.016, 0.006, 0);
      const dist = new THREE.Mesh(new THREE.CapsuleGeometry(0.0082, 0.024, 5, 12), skin);
      dist.rotation.z = dir * (Math.PI / 2 - 0.75);
      dist.position.set(dir * -0.034, -0.006, 0);
      f.add(prox, dist);
      f.position.set(dir * 0.036, 0.010 - i * 0.001, (i === 0 ? 0.016 : -0.007));
      fingers.add(f);
    }
    g.add(fingers);

    const thumb = new THREE.Group();
    const th1 = new THREE.Mesh(new THREE.CapsuleGeometry(0.0105, 0.026, 5, 12), skin);
    th1.rotation.set(0, 0, dir * (Math.PI / 2 - 0.35));
    th1.position.set(dir * 0.014, -0.020, 0.020);
    const th2 = new THREE.Mesh(new THREE.CapsuleGeometry(0.0092, 0.020, 5, 12), skin);
    th2.rotation.set(0, 0, dir * (Math.PI / 2 - 0.15));
    th2.position.set(dir * -0.010, -0.014, 0.024);
    thumb.add(th1, th2);
    g.add(thumb);

    // curled ring + little finger, kept low so they never cross the glass
    for (let i = 0; i < 2; i++) {
      const c = new THREE.Mesh(new THREE.CapsuleGeometry(0.0088, 0.020, 5, 10), skin);
      c.rotation.z = dir * (Math.PI / 2 - 1.1);
      c.position.set(dir * 0.030, -0.026 - i * 0.004, -0.020 - i * 0.016);
      g.add(c);
    }

    g.userData = { fingers, thumb };
    return g;
  }

  const group = new THREE.Group();
  const near = hand(1);      // rolls the tube
  near.position.y = -0.305;
  const far = hand(1);       // steadies the far end
  far.position.y = -0.455;
  far.rotation.y = 0.45;
  far.scale.setScalar(0.96);
  group.add(near, far);

  return {
    group, near, far,
    /** roll = accumulated spin in radians */
    update(roll, present) {
      const s = Math.sin(roll * 0.9);
      near.userData.fingers.position.y = 0.010 + s * 0.006;
      near.userData.thumb.position.y = -s * 0.006;
      near.userData.fingers.position.z = s * 0.003;
      group.visible = present;
    },
  };
}
