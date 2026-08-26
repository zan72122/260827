import * as THREE from 'three';
import { makeSkyMaterial, metalMat } from './materials';
import { clamp01, mulberry32, smooth } from './journey';

// Fractal value noise on CPU for the terrain
function vnoise2(x: number, z: number): number {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const h = (a: number, b: number) => {
    const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  return (
    h(xi, zi) * (1 - u) * (1 - v) + h(xi + 1, zi) * u * (1 - v) +
    h(xi, zi + 1) * (1 - u) * v + h(xi + 1, zi + 1) * u * v
  );
}
function fbm2(x: number, z: number): number {
  let a = 0.5, s = 0;
  for (let k = 0; k < 4; k++) { s += a * vnoise2(x, z); x *= 2.03; z *= 2.03; a *= 0.5; }
  return s;
}

// Everything above the seam: snow, sky, sun, tower, winch sled, cradle, flags.
export class SurfaceRig {
  group = new THREE.Group();
  tiltGroup = new THREE.Group(); // mast tilts over with the drill (Foro-style)
  sun: THREE.DirectionalLight;
  private snowPts: THREE.Points;
  private snowPos: Float32Array;
  private windSpeed = 0;

  constructor(parent: THREE.Object3D) {
    const g = this.group;

    // ---------- sky + light
    const sky = new THREE.Mesh(new THREE.SphereGeometry(800, 24, 16), makeSkyMaterial());
    sky.frustumCulled = false;
    g.add(sky);

    this.sun = new THREE.DirectionalLight(0xfff2dd, 3.2);
    this.sun.position.set(30, 14, -30); // low polar sun -> long shadows
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    const sc = this.sun.shadow.camera;
    sc.left = -9; sc.right = 9; sc.top = 9; sc.bottom = -9; sc.near = 5; sc.far = 90;
    this.sun.target.position.set(0, 0, 0);
    g.add(this.sun, this.sun.target);

    // ---------- snow terrain: radial grid, dense near the hole
    g.add(this.buildTerrain());

    // ---------- tilting tower over the hole
    const hinge = new THREE.Group();
    hinge.position.set(0, 0.5, 0);
    this.tiltGroup = hinge;
    g.add(hinge);
    const mastMat = metalMat({ color: 0xb0b6ba, rough: 0.5, metal: 0.8, frost: 0.35 });
    const boltMat = metalMat({ color: 0x33393e, rough: 0.6, metal: 0.7 });
    const mast = new THREE.Group();
    for (const sx of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 5.4, 10), mastMat);
      rail.position.set(sx * 0.16, 2.7, 0);
      mast.add(rail);
    }
    for (let i = 0; i < 6; i++) {
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.34, 8), mastMat);
      bar.rotation.z = Math.PI / 2;
      bar.position.set(0, 0.5 + i * 0.9, 0);
      mast.add(bar);
      for (const sx of [-1, 1]) {
        const bolt = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), boltMat);
        bolt.position.set(sx * 0.16, 0.5 + i * 0.9, 0.03);
        mast.add(bolt);
      }
      if (i < 5) {
        const diag = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.97, 6), mastMat);
        diag.position.set(0, 0.95 + i * 0.9, 0);
        diag.rotation.z = Math.atan2(0.32, 0.9);
        mast.add(diag);
      }
    }
    // sheave wheel at the top
    const sheave = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.03, 8, 24), boltMat);
    sheave.position.set(0, 5.45, 0);
    mast.add(sheave);
    const sheaveHub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.1, 10), mastMat);
    sheaveHub.rotation.x = Math.PI / 2;
    sheaveHub.position.set(0, 5.45, 0);
    mast.add(sheaveHub);
    mast.position.y = -0.5; // hinge back to ground
    hinge.add(mast);

    // tower base frame + feet on compacted snow
    const base = new THREE.Group();
    for (const sz of [-1, 1]) {
      const skid = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.07, 0.1), mastMat);
      skid.position.set(0, 0.1, sz * 0.55);
      base.add(skid);
      for (const sx of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.42, 8), mastMat);
        leg.position.set(sx * 0.62, 0.28, sz * 0.55);
        leg.rotation.x = -sz * 0.35;
        base.add(leg);
      }
    }
    const cross = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 1.15), mastMat);
    cross.position.set(0.6, 0.47, 0);
    base.add(cross);
    g.add(base);

    // ---------- winch sled
    const sled = new THREE.Group();
    sled.position.set(-2.6, 0, 0.4);
    sled.rotation.y = 0.12;
    const sledMat = metalMat({ color: 0x8a4a34, rough: 0.7, metal: 0.3 });
    for (const sz of [-1, 1]) {
      const runner = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.08, 0.12), sledMat);
      runner.position.set(0, 0.09, sz * 0.55);
      sled.add(runner);
    }
    const deck = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.06, 1.2), metalMat({ color: 0x6b6f66, rough: 0.8, metal: 0.2 }));
    deck.position.y = 0.18;
    sled.add(deck);
    // winch drum with coiled cable
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.5, 20), metalMat({ color: 0x445055, rough: 0.5, metal: 0.8 }));
    drum.rotation.x = Math.PI / 2;
    drum.position.set(-0.45, 0.62, 0);
    sled.add(drum);
    for (let i = 0; i < 6; i++) {
      const coil = new THREE.Mesh(new THREE.TorusGeometry(0.27 + (i % 2) * 0.02, 0.02, 6, 24), metalMat({ color: 0x23272b, rough: 0.6, metal: 0.6 }));
      coil.position.set(-0.45, 0.62, -0.2 + i * 0.08);
      sled.add(coil);
    }
    for (const sz of [-1, 1]) {
      const support = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.08), metalMat({ color: 0x5d666c, rough: 0.55, frost: 0.3 }));
      support.position.set(-0.45, 0.4, sz * 0.32);
      sled.add(support);
    }
    const motorBox = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.4, 0.5), metalMat({ color: 0xb8452e, rough: 0.6, metal: 0.4 }));
    motorBox.position.set(0.45, 0.42, 0);
    sled.add(motorBox);
    const crate = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.35), sledMat);
    crate.position.set(0.9, 0.35, -0.3);
    sled.add(crate);
    g.add(sled);

    // cable from winch drum up to the sheave
    const cablePts = [new THREE.Vector3(-2.95, 0.75, 0.35), new THREE.Vector3(-0.6, 3.0, 0.05), new THREE.Vector3(0, 5.4, 0)];
    const cableCurve = new THREE.CatmullRomCurve3(cablePts);
    const winchCable = new THREE.Mesh(new THREE.TubeGeometry(cableCurve, 20, 0.018, 6), metalMat({ color: 0x23272b, rough: 0.6, metal: 0.6 }));
    g.add(winchCable);

    // ---------- core cradle (two trestles + V-tray) right where the exposed
    // core comes to rest after the tower tilts over (x ≈ 0.0 .. 1.1)
    const cradle = new THREE.Group();
    const wood = metalMat({ color: 0xc9a06a, rough: 0.85, metal: 0.05 });
    for (const x of [0.28, 0.95]) {
      for (const sx of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.4, 0.055), wood);
        leg.position.set(x, 0.16, sx * 0.16);
        leg.rotation.x = sx * 0.35;
        cradle.add(leg);
      }
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.045, 0.48), wood);
      bar.position.set(x, 0.33, 0);
      cradle.add(bar);
    }
    for (const s of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.02, 0.15), metalMat({ color: 0xdadfe3, rough: 0.4, metal: 0.6, frost: 0.25 }));
      side.position.set(0.62, 0.35, s * 0.07);
      side.rotation.x = -s * 0.35;
      cradle.add(side);
    }
    g.add(cradle);

    // ---------- flag line + distant tent for scale
    const rnd = mulberry32(11);
    for (let i = 0; i < 6; i++) {
      const d = 6 + i * 5.5;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 1.6, 6), metalMat({ color: 0x7a6f5c, rough: 0.8, metal: 0 }));
      pole.position.set(3.5 + d * 0.35 + rnd() * 1.2, 0.8, -d);
      g.add(pole);
      const flag = new THREE.Mesh(
        new THREE.PlaneGeometry(0.3, 0.2),
        new THREE.MeshStandardMaterial({ color: i % 2 ? 0xc93b2c : 0x222a30, side: THREE.DoubleSide, roughness: 0.9 }),
      );
      flag.position.set(pole.position.x + 0.16, 1.5, -d);
      flag.rotation.y = 0.4 + rnd() * 0.4;
      g.add(flag);
    }
    const tent = new THREE.Mesh(new THREE.SphereGeometry(1.6, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xb8452e, roughness: 0.85 }));
    tent.position.set(-9, 0, -18);
    g.add(tent);

    // ---------- blowing snow particles
    const N = 260;
    this.snowPos = new Float32Array(N * 3);
    const r2 = mulberry32(99);
    for (let i = 0; i < N; i++) {
      this.snowPos[i * 3] = (r2() - 0.5) * 30;
      this.snowPos[i * 3 + 1] = r2() * 3.2 + 0.03;
      this.snowPos[i * 3 + 2] = (r2() - 0.5) * 30;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(this.snowPos, 3));
    this.snowPts = new THREE.Points(sg, new THREE.PointsMaterial({
      color: 0xffffff, size: 0.035, transparent: true, opacity: 0.75, depthWrite: false,
    }));
    g.add(this.snowPts);

    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m !== sky && m !== this.snowPts as unknown) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    parent.add(g);
  }

  private buildTerrain(): THREE.Mesh {
    const RAD = 96, ANG = 96;
    const inner = 0.5, outer = 320;
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const grow = Math.pow(outer / inner, 1 / (RAD - 1));

    // deterministic footprints along the sled->hole path and around the cradle
    const foots: Array<[number, number]> = [];
    const rf = mulberry32(5);
    for (let i = 0; i < 16; i++) {
      const t = i / 15;
      foots.push([-2.4 + t * 2.2 + (i % 2 ? 0.16 : -0.16), 0.5 - t * 0.3 + rf() * 0.1]);
    }
    for (let i = 0; i < 8; i++) foots.push([0.9 + rf() * 1.9, 0.45 + rf() * 0.5]);

    for (let r = 0; r < RAD; r++) {
      const rad = inner * Math.pow(grow, r);
      for (let a = 0; a < ANG; a++) {
        const th = (a / ANG) * Math.PI * 2;
        const x = Math.cos(th) * rad, z = Math.sin(th) * rad;
        // sastrugi: wind-stretched ridges, damped in the trampled work area
        const work = smooth(clamp01((6 - rad) / 5));
        let y = (fbm2(x * 0.09, z * 0.45) - 0.5) * 2 * (0.05 + 0.5 * smooth(clamp01((rad - 4) / 40)));
        y += (fbm2(x * 0.8 + 7, z * 0.8) - 0.5) * 0.05 * (1 - work * 0.8);
        // funnel down into the hole mouth
        const lip = smooth(clamp01((1.6 - rad) / 1.1));
        y -= lip * 0.55;
        y += smooth(clamp01((2.6 - rad) / 1.8)) * 0.06; // slight raised berm of cuttings
        // compacted rings under tower feet
        let dent = 0;
        for (const [fx, fz] of [[0.62, 0.55], [-0.62, 0.55], [0.62, -0.55], [-0.62, -0.55]]) {
          const d = Math.hypot(x - fx, z - fz);
          dent += Math.max(0, 1 - d / 0.28) * 0.05;
        }
        // sled tracks: two grooves heading away
        for (const tz of [-0.18, 0.95]) {
          const d = Math.abs(z - (tz + 0.12 * Math.sin(x * 0.4)));
          if (x < -1.4 && x > -60) dent += Math.max(0, 1 - d / 0.16) * 0.035;
        }
        // footprints
        for (const [fx, fz] of foots) {
          const d = Math.hypot((x - fx) / 0.13, (z - fz) / 0.09);
          dent += Math.max(0, 1 - d) * 0.045;
        }
        y -= dent;
        pos.push(x, y, z);
        // vertex colour: blue in hollows/shade, warm sparkle on crests
        const shade = clamp01(dent * 6 + lip * 0.55 + Math.max(0, -y) * 0.3);
        const cr = 1 - shade * 0.28, cg = 1 - shade * 0.16, cb = 1 - shade * 0.04;
        col.push(cr, cg, cb);
      }
    }
    for (let r = 0; r < RAD - 1; r++) {
      for (let a = 0; a < ANG; a++) {
        const a2 = (a + 1) % ANG;
        const i0 = r * ANG + a, i1 = r * ANG + a2, i2 = (r + 1) * ANG + a, i3 = (r + 1) * ANG + a2;
        idx.push(i0, i1, i2, i1, i3, i2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    // ensure the surface faces the sky regardless of index winding
    const nrm = geo.getAttribute('normal') as THREE.BufferAttribute;
    if (nrm.getY(0) < 0) {
      for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, -nrm.getX(i), -nrm.getY(i), -nrm.getZ(i));
      geo.setIndex(idx.slice().reverse());
    }
    const mat = new THREE.MeshStandardMaterial({
      color: 0xfbfdff, roughness: 0.9, metalness: 0, vertexColors: true,
      side: THREE.DoubleSide, // brief pass-through moment at the breakthrough
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    return mesh;
  }

  update(p: number, time: number, wind: number, reduced: boolean): void {
    // the mast stays upright; only the sonde tips over onto the cradle,
    // keeping the revealed core unobstructed for the camera
    this.windSpeed = wind;
    const dt = 1 / 60;
    const n = this.snowPos.length / 3;
    const sp = reduced ? 0.35 : 1;
    for (let i = 0; i < n; i++) {
      let x = this.snowPos[i * 3] + (1.6 + wind * 4.5) * dt * sp;
      const y = this.snowPos[i * 3 + 1];
      if (x > 15) x = -15;
      this.snowPos[i * 3] = x;
      this.snowPos[i * 3 + 1] = 0.03 + Math.abs(Math.sin(time * (0.5 + (i % 7) * 0.13) + i)) * (0.25 + wind * 3.0) * (y > 1.5 ? 1.6 : 1);
    }
    (this.snowPts.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.snowPts.material as THREE.PointsMaterial).opacity = 0.25 + wind * 0.5;
  }
}
