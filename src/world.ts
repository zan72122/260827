import * as THREE from 'three';
import { makeCanvasTexture, mulberry32 } from './util';
import { WetMask, makeWettable } from './wetmask';

/**
 * The training ground: concrete pad (wettable, with asymmetric scorch
 * staining near the burn positions), pumper truck with pump panel and
 * hose bed, hydrant, drill tower, safety fence and cones, sky dome + fog.
 * Three depth layers — near gear, mid burn targets, far truck/tower/sky —
 * separated by silhouette, light and haze rather than blur.
 */

export interface WorldRefs {
  group: THREE.Group;
  pumpOutlet: THREE.Vector3;
  pumpInlet: THREE.Vector3;
  hydrantTop: THREE.Vector3;
  valveWheel: THREE.Object3D;
  truckFocus: THREE.Vector3;
  hydrantFocus: THREE.Vector3;
  /** outward normal of the pump panel (side the couplings face) */
  panelNormal: THREE.Vector3;
}

export function buildWorld(
  scene: THREE.Scene,
  wet: WetMask,
  firePositions: { x: number; z: number }[],
): WorldRefs {
  const group = new THREE.Group();
  scene.add(group);

  scene.fog = new THREE.Fog(0xc3d2da, 34, 95);

  // ---- lights
  const hemi = new THREE.HemisphereLight(0xbcd6ea, 0x6d6a60, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
  sun.position.set(-14, 20, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -14;
  sun.shadow.camera.right = 14;
  sun.shadow.camera.top = 20;
  sun.shadow.camera.bottom = -10;
  sun.shadow.camera.near = 4;
  sun.shadow.camera.far = 50;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  sun.target.position.set(0, 0, 6);
  scene.add(sun.target);

  // ---- sky dome
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(90, 24, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {},
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main(){
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        void main(){
          float h = clamp(vDir.y, 0.0, 1.0);
          vec3 horizon = vec3(0.83, 0.87, 0.89);
          vec3 zenith = vec3(0.42, 0.62, 0.81);
          vec3 col = mix(horizon, zenith, pow(h, 0.65));
          // soft sun glow, matching the key light direction
          float sunAmt = pow(max(0.0, dot(vDir, normalize(vec3(-0.55, 0.62, 0.16)))), 18.0);
          col += vec3(1.0, 0.92, 0.75) * sunAmt * 0.5;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    }),
  );
  sky.frustumCulled = false;
  group.add(sky);

  // ---- ground: concrete training pad with painted marks + scorch stains
  const rand = mulberry32(20260826);
  const padTex = makeCanvasTexture(1024, (ctx, s) => {
    // world x[-22,22] z[-8,28] maps to the texture
    const wx = (x: number) => ((x + 22) / 44) * s;
    const wz = (z: number) => ((z + 8) / 36) * s;
    ctx.fillStyle = '#96999b';
    ctx.fillRect(0, 0, s, s);
    // per-tile tone shifts + expansion joints
    const tile = s / 8;
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        const v = 140 + rand() * 22;
        ctx.fillStyle = `rgba(${v},${v + 2},${v + 3},0.35)`;
        ctx.fillRect(i * tile, j * tile, tile, tile);
      }
    }
    ctx.strokeStyle = 'rgba(60,60,62,0.5)';
    ctx.lineWidth = 2;
    for (let i = 1; i < 8; i++) {
      ctx.beginPath(); ctx.moveTo(i * tile, 0); ctx.lineTo(i * tile, s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * tile); ctx.lineTo(s, i * tile); ctx.stroke();
    }
    // speckle
    for (let i = 0; i < 5200; i++) {
      const v = 90 + rand() * 120;
      ctx.fillStyle = `rgba(${v},${v},${v},${0.05 + rand() * 0.1})`;
      ctx.fillRect(rand() * s, rand() * s, 1.6, 1.6);
    }
    // old water/oil stains
    for (let i = 0; i < 14; i++) {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 20 + rand() * 60);
      g.addColorStop(0, `rgba(60,58,55,${0.06 + rand() * 0.1})`);
      g.addColorStop(1, 'rgba(60,58,55,0)');
      ctx.save();
      ctx.translate(rand() * s, rand() * s);
      ctx.scale(1, 0.5 + rand());
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, 80, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    // asymmetric scorch smudges around each burn position
    for (const f of firePositions) {
      for (let k = 0; k < 9; k++) {
        const ang = rand() * Math.PI * 2;
        const rr = 6 + rand() * 34;
        const px = wx(f.x) + Math.cos(ang) * rr * 0.7;
        const pz = wz(f.z) + Math.sin(ang) * rr;
        const rad = 18 + rand() * 34;
        const g = ctx.createRadialGradient(px, pz, 0, px, pz, rad);
        g.addColorStop(0, `rgba(16,13,10,${0.35 + rand() * 0.3})`);
        g.addColorStop(1, 'rgba(16,13,10,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(px, pz, rad + 6, 0, Math.PI * 2); ctx.fill();
      }
    }
    // painted safety line behind which the crew works
    ctx.strokeStyle = 'rgba(214,180,60,0.7)';
    ctx.lineWidth = 7;
    ctx.setLineDash([26, 18]);
    ctx.beginPath();
    ctx.moveTo(wx(-9), wz(2.6));
    ctx.lineTo(wx(9), wz(2.6));
    ctx.stroke();
    ctx.setLineDash([]);
  });
  const padMat = new THREE.MeshStandardMaterial({ map: padTex, roughness: 0.94, metalness: 0.0 });
  makeWettable(padMat, wet, 0.55);
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(44, 36), padMat);
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(0, 0, 10);
  pad.receiveShadow = true;
  group.add(pad);

  // dirt apron beyond the pad
  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(220, 220),
    new THREE.MeshStandardMaterial({ color: 0x7d7a6a, roughness: 1 }),
  );
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = -0.03;
  group.add(apron);

  // ---- pumper truck
  const truck = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: 0xa31f22, metalness: 0.3, roughness: 0.38 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x2b2e30, metalness: 0.5, roughness: 0.6 });
  const alu = new THREE.MeshStandardMaterial({ color: 0xb9bec2, metalness: 0.85, roughness: 0.32 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x39444c, metalness: 0.2, roughness: 0.12 });

  // chassis + body: cab forward, equipment body with roll-up shutters behind
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.35, 6.8), darkMetal);
  chassis.position.y = 0.62;
  truck.add(chassis);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.15, 1.5, 1.9), paint);
  cab.position.set(0, 1.55, -2.35);
  cab.castShadow = true;
  truck.add(cab);
  const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.6, 0.06), glass);
  windshield.position.set(0, 1.85, -3.31);
  windshield.rotation.x = -0.16;
  truck.add(windshield);
  for (const sx of [-1, 1]) {
    const sideGlass = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.55, 0.8), glass);
    sideGlass.position.set(sx * 1.06, 1.85, -2.45);
    truck.add(sideGlass);
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.28, 0.16), darkMetal);
    mirror.position.set(sx * 1.22, 1.95, -3.2);
    truck.add(mirror);
  }
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.65, 4.0), paint);
  body.position.set(0, 1.72, 0.6);
  body.castShadow = true;
  truck.add(body);

  // roll-up shutter texture on the sides
  const shutterTex = makeCanvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#c3c8cc';
    ctx.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 12) {
      ctx.fillStyle = 'rgba(70,76,80,0.55)';
      ctx.fillRect(0, y, s, 2.5);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(0, y + 3, s, 1.5);
    }
  });
  const shutterMat = new THREE.MeshStandardMaterial({ map: shutterTex, metalness: 0.7, roughness: 0.4 });
  for (const sx of [-1, 1]) {
    for (const zc of [-0.35, 1.55]) {
      const shutter = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.3, 1.55), shutterMat);
      shutter.position.set(sx * 1.13, 1.78, zc);
      truck.add(shutter);
    }
  }

  // pump panel (rear right side, faces the play area): gauges, valve, outlets
  const panel = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.15, 1.0), alu);
  panel.position.set(1.14, 1.35, 2.32);
  truck.add(panel);
  const gaugeMat = new THREE.MeshStandardMaterial({ color: 0xe8e6dd, roughness: 0.4 });
  for (let i = 0; i < 3; i++) {
    const gauge = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.05, 14), gaugeMat);
    gauge.rotation.z = Math.PI / 2;
    gauge.position.set(1.2, 1.72, 2.0 + i * 0.32);
    truck.add(gauge);
  }
  // discharge outlet (attack hose mates here) + inlet (supply hose)
  const brass = new THREE.MeshStandardMaterial({ color: 0xb08d3f, metalness: 0.9, roughness: 0.35 });
  const outletMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.22, 14), brass);
  outletMesh.rotation.z = Math.PI / 2;
  outletMesh.position.set(1.24, 1.05, 2.5);
  truck.add(outletMesh);
  const inletMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.24, 14), brass);
  inletMesh.rotation.z = Math.PI / 2;
  inletMesh.position.set(1.24, 0.78, 1.9);
  truck.add(inletMesh);
  // valve wheel (animated during the intro)
  const valveWheel = new THREE.Group();
  const wheelRim = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.02, 8, 18), paint);
  valveWheel.add(wheelRim);
  for (let i = 0; i < 3; i++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.018, 0.018), paint);
    spoke.rotation.z = (i / 3) * Math.PI;
    valveWheel.add(spoke);
  }
  valveWheel.rotation.y = Math.PI / 2;
  valveWheel.position.set(1.26, 1.35, 2.5);
  truck.add(valveWheel);

  // hose bed on top rear with flaked hose
  const bedMat = new THREE.MeshStandardMaterial({ color: 0x8a4437, roughness: 0.85 });
  for (let i = 0; i < 4; i++) {
    const fold = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.1, 0.5), bedMat);
    fold.position.set(0, 2.62 + (i % 2) * 0.1, 1.4 + (i * 0.28) % 0.9);
    truck.add(fold);
  }
  // ladder rack
  for (const sy of [0, 0.14]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 3.6), alu);
    rail.position.set(-0.6, 2.72 + sy, 0.5);
    truck.add(rail);
  }
  for (let i = 0; i < 8; i++) {
    const rung = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.05), alu);
    rung.position.set(-0.6, 2.79, -1.1 + i * 0.45);
    truck.add(rung);
  }
  // light bar (static, not flashing during play)
  const lightBar = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 0.3), new THREE.MeshStandardMaterial({
    color: 0xb02020, roughness: 0.3, emissive: 0x550808, emissiveIntensity: 0.6,
  }));
  lightBar.position.set(0, 2.42, -2.9);
  truck.add(lightBar);
  // bumper
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.28, 0.25), alu);
  bumper.position.set(0, 0.55, -3.4);
  truck.add(bumper);
  // rear: roll-up shutter + reflective chevron marking + step
  const rearShutter = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.25, 0.05), shutterMat);
  rearShutter.position.set(0, 1.85, 2.61);
  truck.add(rearShutter);
  const chevronTex = makeCanvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#c8342a';
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = '#e8d84a';
    ctx.lineWidth = 26;
    for (let x = -s; x < s * 2; x += 80) {
      ctx.beginPath();
      ctx.moveTo(x, s);
      ctx.lineTo(x + s / 2, 0);
      ctx.stroke();
    }
  });
  const chevron = new THREE.Mesh(
    new THREE.BoxGeometry(2.1, 0.42, 0.04),
    new THREE.MeshStandardMaterial({ map: chevronTex, roughness: 0.5 }),
  );
  chevron.position.set(0, 0.98, 2.62);
  truck.add(chevron);
  const rearStep = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.06, 0.4), alu);
  rearStep.position.set(0, 0.62, 2.75);
  truck.add(rearStep);

  // wheels: heavy tires under mudguards
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.92 });
  const hubMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a4, metalness: 0.8, roughness: 0.35 });
  for (const zc of [-2.2, 1.6]) {
    for (const sx of [-1, 1]) {
      const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 0.34, 20), tireMat);
      tire.rotation.z = Math.PI / 2;
      tire.position.set(sx * 0.92, 0.52, zc);
      tire.castShadow = true;
      truck.add(tire);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.36, 14), hubMat);
      hub.rotation.z = Math.PI / 2;
      hub.position.set(sx * 0.92, 0.52, zc);
      truck.add(hub);
      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.1, 1.3), paint);
      guard.position.set(sx * 0.95, 1.12, zc);
      truck.add(guard);
    }
  }

  // parked at the left of the pad, pump panel facing the working area, so it
  // stays part of the far layer during play (portrait and landscape)
  truck.position.set(-6.3, 0, 6.2);
  truck.rotation.y = 2.15;
  group.add(truck);

  truck.updateWorldMatrix(true, true);
  const truckWorld = (v: THREE.Vector3) => truck.localToWorld(v.clone());
  const pumpOutlet = truckWorld(new THREE.Vector3(1.35, 1.05, 2.5));
  const panelNormal = truckWorld(new THREE.Vector3(2.35, 1.05, 2.5)).sub(pumpOutlet).normalize();
  const pumpInlet = truckWorld(new THREE.Vector3(1.35, 0.78, 1.9));
  const truckFocus = truckWorld(new THREE.Vector3(0, 1.4, 0));
  const valveWorldPos = truckWorld(new THREE.Vector3(1.26, 1.35, 2.5));

  // ---- hydrant
  const hydrant = new THREE.Group();
  const hydMat = new THREE.MeshStandardMaterial({ color: 0xb8341e, metalness: 0.25, roughness: 0.5 });
  const hydBody = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.19, 0.75, 14), hydMat);
  hydBody.position.y = 0.38;
  hydBody.castShadow = true;
  hydrant.add(hydBody);
  const hydDome = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), hydMat);
  hydDome.position.y = 0.75;
  hydrant.add(hydDome);
  for (let i = 0; i < 2; i++) {
    const flange = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.045, 14), hydMat);
    flange.position.y = 0.2 + i * 0.42;
    hydrant.add(flange);
  }
  const hydCapMat = new THREE.MeshStandardMaterial({ color: 0x7a6a20, metalness: 0.8, roughness: 0.4 });
  for (const a of [0, Math.PI]) {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.1, 10), hydCapMat);
    cap.rotation.z = Math.PI / 2;
    cap.rotation.y = a;
    cap.position.set(Math.cos(a) * 0.2, 0.5, Math.sin(a) * 0.2);
    hydrant.add(cap);
  }
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.12, 8), hydCapMat);
  stem.position.y = 0.93;
  hydrant.add(stem);
  hydrant.position.set(-3.6, 0, 1.6);
  group.add(hydrant);
  const hydrantTop = new THREE.Vector3(-3.6, 0.15, 1.6);
  const hydrantFocus = new THREE.Vector3(-3.6, 0.6, 1.6);

  // ---- drill tower (far background)
  const towerMat = new THREE.MeshStandardMaterial({ color: 0x8f8d88, roughness: 0.95 });
  const openMat = new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 1 });
  const tower = new THREE.Group();
  const towerBody = new THREE.Mesh(new THREE.BoxGeometry(4.4, 12, 4), towerMat);
  towerBody.position.y = 6;
  tower.add(towerBody);
  for (let f = 0; f < 4; f++) {
    for (const sx of [-1.1, 1.1]) {
      const opening = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.25, 0.1), openMat);
      opening.position.set(sx, 2 + f * 2.7, -2.01);
      tower.add(opening);
    }
    const rail = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.06, 0.06), darkMetal);
    rail.position.set(0, 2.9 + f * 2.7, -2.1);
    tower.add(rail);
  }
  const roofRail = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.5, 4.1), darkMetal);
  roofRail.position.y = 12.2;
  tower.add(roofRail);
  tower.position.set(-7, 0, 30);
  tower.rotation.y = 0.15; // openings + rails face the camera
  group.add(tower);

  // low equipment shed on the other side
  const shed = new THREE.Mesh(new THREE.BoxGeometry(7, 3.2, 4), new THREE.MeshStandardMaterial({ color: 0x9aa39f, roughness: 0.9 }));
  shed.position.set(9.5, 1.6, 27);
  group.add(shed);
  const shedRoof = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.25, 4.4), darkMetal);
  shedRoof.position.set(9.5, 3.3, 27);
  group.add(shedRoof);

  // ---- safety fence around the pad
  const fencePostMat = new THREE.MeshStandardMaterial({ color: 0x6f7579, metalness: 0.6, roughness: 0.55 });
  const fence = new THREE.Group();
  const postGeo = new THREE.CylinderGeometry(0.04, 0.04, 1.15, 6);
  const addFenceRun = (x0: number, z0: number, x1: number, z1: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(2, Math.round(len / 2.4));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const post = new THREE.Mesh(postGeo, fencePostMat);
      post.position.set(x0 + (x1 - x0) * t, 0.57, z0 + (z1 - z0) * t);
      fence.add(post);
    }
    for (const y of [0.5, 0.95]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.045, 0.045), fencePostMat);
      rail.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
      rail.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
      fence.add(rail);
    }
  };
  addFenceRun(-13, 21, 13, 21);
  addFenceRun(-13, -5, -13, 21);
  addFenceRun(13, -5, 13, 21);
  group.add(fence);

  // traffic cones marking the working lane
  const coneMat = new THREE.MeshStandardMaterial({ color: 0xd2571e, roughness: 0.6 });
  const coneBandMat = new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.5 });
  for (const [cx, cz] of [[-6.9, 2.0], [5.6, 4.2], [-7.4, 12], [6.8, 11.5]]) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.5, 12), coneMat);
    cone.position.set(cx, 0.25, cz);
    cone.castShadow = true;
    group.add(cone);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.14, 0.09, 12), coneBandMat);
    band.position.set(cx, 0.28, cz);
    group.add(band);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.03, 0.34), coneMat);
    base.position.set(cx, 0.015, cz);
    group.add(base);
  }

  return {
    group,
    pumpOutlet,
    pumpInlet,
    hydrantTop,
    valveWheel,
    truckFocus,
    hydrantFocus: valveWorldPos.clone().lerp(hydrantFocus, 0.35),
    panelNormal,
  };
}
