// The world: one continuous vertical space — sky/roof, chimney flue (shown in
// cutaway section during the descent), and the fireplace room below. Single
// scene so the camera can travel the whole signature action without a cut.
import * as THREE from 'three';
import { Rng, makeRng, rr, lerp, clamp01 } from './util';
import {
  brickTexture, snowTexture, woodTexture, wallpaperTexture, rugTexture
} from './textures';

// ---- authored layout constants ----
export const LAYOUT = {
  ridgeY: 4.9,
  eaveY: 3.05,
  eaveX: 2.9,
  chimneyX: 1.35,
  chimneyZ: -1.62,
  chimneyTopY: 5.02,
  innerHalf: 0.31,          // flue half width (opening 0.62 — Santa is ~0.9 wide)
  shaftBottomY: 1.0,        // where the flue opens into the firebox
  fireboxFloorY: 0.03,
  roomCeilY: 2.75,
  standX: 2.1,              // where Santa stands beside the chimney on the roof
  standZ: -1.62,
  sledX: -0.6,              // parked on the west slope, clear of the chimney shot
  sledZ: 1.1,
  stockingX: 0.78,
  stockingTopY: 1.22,
  stockingZ: -1.06,
  bagRestX: 1.95,
  bagRestZ: -1.05
};

export function roofY(x: number): number {
  return LAYOUT.ridgeY - ((LAYOUT.ridgeY - LAYOUT.eaveY) / LAYOUT.eaveX) * Math.abs(x);
}

export interface HouseVariation {
  seed: number;
  brickHue: number;
  brickSat: number;
  brickLight: number;
  wallHue: number;
  stockingHue: number;
  innerHalf: number;
  moonAz: number;
}

export function makeVariation(seed: number): HouseVariation {
  const rng = makeRng(seed);
  return {
    seed,
    brickHue: rr(rng, 4, 26),
    brickSat: rr(rng, 26, 44),
    brickLight: rr(rng, 34, 48),
    wallHue: [36, 148, 210, 16][Math.floor(rng() * 4)],
    stockingHue: [0, 352, 145, 214][Math.floor(rng() * 4)],
    innerHalf: rr(rng, 0.29, 0.33),
    moonAz: rr(rng, -0.7, 0.35)
  };
}

export class World {
  group = new THREE.Group();
  variation: HouseVariation;

  // materials that fade to reveal the flue cross-section
  private frontFadeMats: THREE.Material[] = [];
  private houseFadeMats: THREE.Material[] = [];
  private frontFade = 1;
  private houseFade = 1;

  moonLight!: THREE.DirectionalLight;
  hemi!: THREE.HemisphereLight;
  fireLight!: THREE.PointLight;
  roomFill!: THREE.PointLight;
  descentLamp!: THREE.PointLight;

  private emberMats: THREE.MeshStandardMaterial[] = [];
  private flames: THREE.Mesh[] = [];
  private snowPoints!: THREE.Points;
  private snowVel: number[] = [];
  private time = 0;

  // soot trail painting (persists across replays & rotation)
  private trailCanvas: HTMLCanvasElement;
  private trailCtx: CanvasRenderingContext2D;
  private trailTex!: THREE.CanvasTexture;
  private trailRng: Rng = makeRng(Date.now() % 100000 + 7);

  sledTrackL!: THREE.Mesh;
  sledTrackR!: THREE.Mesh;
  hintMotes!: THREE.Points;
  private hintMoteT = 99;

  constructor(seed: number) {
    this.variation = makeVariation(seed);
    this.trailCanvas = document.createElement('canvas');
    this.trailCanvas.width = 384;
    this.trailCanvas.height = 1280;
    this.trailCtx = this.trailCanvas.getContext('2d')!;
    LAYOUT.innerHalf = this.variation.innerHalf;
    this.build();
  }

  // ------------------------------------------------------------------
  private build(): void {
    const v = this.variation;
    const rng = makeRng(v.seed + 500);
    const g = this.group;

    // ===== sky =====
    const skyCanvas = document.createElement('canvas');
    skyCanvas.width = 16;
    skyCanvas.height = 256;
    const sctx = skyCanvas.getContext('2d')!;
    const grad = sctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#04060f');
    grad.addColorStop(0.42, '#0a1226');
    grad.addColorStop(0.75, '#16223f');
    grad.addColorStop(1, '#233252');
    sctx.fillStyle = grad;
    sctx.fillRect(0, 0, 16, 256);
    const skyTex = new THREE.CanvasTexture(skyCanvas);
    skyTex.colorSpace = THREE.SRGBColorSpace;
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(70, 24, 18),
      new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false })
    );
    sky.position.y = 6;
    g.add(sky);

    // stars — restrained
    {
      const n = 240;
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const a = rng() * Math.PI * 2;
        const el = rng() * 1.15 + 0.12;
        const r = 66;
        pos[i * 3] = Math.cos(a) * Math.cos(el) * r;
        pos[i * 3 + 1] = Math.sin(el) * r + 4;
        pos[i * 3 + 2] = Math.sin(a) * Math.cos(el) * r;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const stars = new THREE.Points(geo, new THREE.PointsMaterial({
        color: 0xcfd9ef, size: 0.16, sizeAttenuation: true, fog: false,
        transparent: true, opacity: 0.85, depthWrite: false
      }));
      g.add(stars);
    }

    // moon + soft halo
    // moon kept to the south-west so cast shadows fall away from the camera
    const moonDir = new THREE.Vector3(-0.5 + Math.sin(v.moonAz) * 0.2, 0.85, 0.7 + Math.cos(v.moonAz) * 0.15).normalize();
    {
      const mpos = moonDir.clone().multiplyScalar(60).add(new THREE.Vector3(0, 6, 0));
      const moon = new THREE.Mesh(
        new THREE.CircleGeometry(2.6, 28),
        new THREE.MeshBasicMaterial({ color: 0xf2ecda, fog: false })
      );
      moon.position.copy(mpos);
      moon.lookAt(0, 4, 0);
      g.add(moon);
      const haloC = document.createElement('canvas');
      haloC.width = haloC.height = 128;
      const hctx = haloC.getContext('2d')!;
      const hg = hctx.createRadialGradient(64, 64, 6, 64, 64, 64);
      hg.addColorStop(0, 'rgba(235, 232, 210, 0.55)');
      hg.addColorStop(0.35, 'rgba(200, 205, 225, 0.16)');
      hg.addColorStop(1, 'rgba(200, 205, 225, 0)');
      hctx.fillStyle = hg;
      hctx.fillRect(0, 0, 128, 128);
      const haloTex = new THREE.CanvasTexture(haloC);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: haloTex, transparent: true, fog: false, depthWrite: false
      }));
      halo.scale.setScalar(15);
      halo.position.copy(mpos);
      g.add(halo);
    }

    // ===== lights =====
    this.moonLight = new THREE.DirectionalLight(0xa8bce4, 1.9);
    this.moonLight.position.copy(moonDir.clone().multiplyScalar(18).add(new THREE.Vector3(1, 2, 0)));
    this.moonLight.target.position.set(1, 3, -1);
    this.moonLight.castShadow = true;
    this.moonLight.shadow.mapSize.set(1024, 1024);
    const sc = this.moonLight.shadow.camera;
    sc.left = -7; sc.right = 7; sc.top = 8; sc.bottom = -6; sc.near = 2; sc.far = 40;
    this.moonLight.shadow.bias = -0.002;
    this.moonLight.shadow.radius = 4;
    g.add(this.moonLight, this.moonLight.target);

    this.hemi = new THREE.HemisphereLight(0x39476b, 0x10141f, 0.85);
    g.add(this.hemi);

    this.fireLight = new THREE.PointLight(0xff8a30, 0, 8, 1.9);
    this.fireLight.position.set(LAYOUT.chimneyX, 0.55, LAYOUT.chimneyZ + 0.2);
    g.add(this.fireLight);

    this.roomFill = new THREE.PointLight(0xffb46a, 0, 7, 1.6);
    this.roomFill.position.set(0.7, 1.7, 0.3);
    g.add(this.roomFill);

    // travelling flue lamp: reads Santa + brick while he is inside the shaft
    // (justified as sky light from the mouth blending into fire glow below)
    this.descentLamp = new THREE.PointLight(0xc8d8ff, 0, 4.6, 1.4);
    this.descentLamp.position.set(LAYOUT.chimneyX, 4, LAYOUT.chimneyZ + 0.6);
    g.add(this.descentLamp);

    // ===== ground / distance =====
    const snowTex = snowTexture(v.seed + 1);
    snowTex.repeat.set(10, 10);
    const groundMat = new THREE.MeshStandardMaterial({ map: snowTex, roughness: 0.94 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120, 24, 24), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    // gentle drifts
    {
      const pos = ground.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i);
        if (Math.abs(x) > 4 || Math.abs(y) > 4) {
          pos.setZ(i, (Math.sin(x * 0.4) + Math.cos(y * 0.33)) * 0.25 * rng());
        }
      }
      ground.geometry.computeVertexNormals();
    }
    g.add(ground);

    // neighbour houses: dark masses with a few warm windows, separated by
    // haze/fog rather than blur
    for (let i = 0; i < 5; i++) {
      const hx = rr(rng, -30, 30);
      const hz = rr(rng, -38, -14) * (rng() > 0.7 ? -1 : 1);
      if (Math.abs(hx) < 8 && Math.abs(hz) < 10) continue;
      const hw = rr(rng, 4, 7), hd = rr(rng, 4, 6), hh = rr(rng, 2.5, 4);
      const house = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(hw, hh, hd),
        new THREE.MeshStandardMaterial({ color: 0x1b2233, roughness: 0.95 })
      );
      body.position.y = hh / 2;
      house.add(body);
      const roof = new THREE.Mesh(
        new THREE.ConeGeometry(Math.max(hw, hd) * 0.72, rr(rng, 1.4, 2.2), 4),
        new THREE.MeshStandardMaterial({ color: 0xb8c4d8, roughness: 0.95 })
      );
      roof.rotation.y = Math.PI / 4;
      roof.position.y = hh + 0.7;
      house.add(roof);
      const nw = 1 + Math.floor(rng() * 3);
      for (let w = 0; w < nw; w++) {
        const win = new THREE.Mesh(
          new THREE.PlaneGeometry(0.5, 0.7),
          new THREE.MeshBasicMaterial({ color: 0xffb45e })
        );
        win.position.set(rr(rng, -hw / 3, hw / 3), rr(rng, 0.8, hh - 0.6), hd / 2 + 0.01);
        house.add(win);
      }
      house.position.set(hx, 0, hz);
      house.rotation.y = rr(rng, -0.4, 0.4);
      g.add(house);
    }
    // scattered conifers
    for (let i = 0; i < 10; i++) {
      const tx = rr(rng, -34, 34), tz = rr(rng, -34, 34);
      if (Math.abs(tx) < 6 && Math.abs(tz) < 6) continue;
      const th = rr(rng, 2, 5);
      const tree = new THREE.Mesh(
        new THREE.ConeGeometry(th * 0.32, th, 7),
        new THREE.MeshStandardMaterial({ color: 0x152218, roughness: 1 })
      );
      tree.position.set(tx, th / 2, tz);
      g.add(tree);
    }

    // ===== the house =====
    this.buildHouse(rng);
    this.buildRoof(rng);
    this.buildChimney(rng);
    this.buildRoom(rng);

    // ===== falling snow (restrained) =====
    {
      const n = 200;
      const pos = new Float32Array(n * 3);
      this.snowVel = [];
      for (let i = 0; i < n; i++) {
        pos[i * 3] = rr(rng, -9, 9);
        pos[i * 3 + 1] = rr(rng, 0, 12);
        pos[i * 3 + 2] = rr(rng, -9, 9);
        this.snowVel.push(rr(rng, 0.25, 0.6));
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.snowPoints = new THREE.Points(geo, new THREE.PointsMaterial({
        color: 0xdde6f5, size: 0.045, transparent: true, opacity: 0.75, depthWrite: false
      }));
      g.add(this.snowPoints);
    }

    // hint motes: a few snowflakes that drift down INTO the flue mouth
    {
      const n = 6;
      const pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        pos[i * 3] = LAYOUT.chimneyX + rr(rng, -0.16, 0.16);
        pos[i * 3 + 1] = LAYOUT.chimneyTopY + 0.5 + i * 0.14;
        pos[i * 3 + 2] = LAYOUT.chimneyZ + rr(rng, -0.16, 0.16);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.hintMotes = new THREE.Points(geo, new THREE.PointsMaterial({
        color: 0xe8eefb, size: 0.06, transparent: true, opacity: 0, depthWrite: false
      }));
      g.add(this.hintMotes);
    }
  }

  // ------------------------------------------------------------------
  private buildHouse(rng: Rng): void {
    const g = this.group;
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x5a5a52, roughness: 0.92 });
    const wallFrontMat = new THREE.MeshStandardMaterial({ color: 0x5a5a52, roughness: 0.92, transparent: true });
    this.houseFadeMats.push(wallFrontMat);

    // side walls (x = ±2.6), from ground to eaves
    for (const s of [1, -1]) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(0.24, 3.05, 4.4), wallMat);
      w.position.set(2.6 * s, 3.05 / 2, 0);
      w.castShadow = w.receiveShadow = true;
      g.add(w);
    }
    // back gable wall (z=-2.2): full pentagon — box + triangle
    const backMat = wallMat;
    {
      const w = new THREE.Mesh(new THREE.BoxGeometry(5.44, 3.05, 0.24), backMat);
      w.position.set(0, 3.05 / 2, -2.2);
      g.add(w);
      const tri = this.gableTriangle(backMat);
      tri.position.set(0, 0, -2.2);
      g.add(tri);
    }
    // front gable wall (z=+2.2): fades away when the camera dives inside
    {
      const w = new THREE.Mesh(new THREE.BoxGeometry(5.44, 3.05, 0.24), wallFrontMat);
      w.position.set(0, 3.05 / 2, 2.2);
      w.castShadow = true;
      g.add(w);
      const triMat = new THREE.MeshStandardMaterial({ color: 0x5a5a52, roughness: 0.92, transparent: true });
      this.houseFadeMats.push(triMat);
      const tri = this.gableTriangle(triMat);
      tri.position.set(0, 0, 2.2);
      g.add(tri);
      // two warm windows on the front wall
      for (const wx of [-1.5, 0.6]) {
        const winMat = new THREE.MeshBasicMaterial({ color: 0xffb45e, transparent: true });
        this.houseFadeMats.push(winMat);
        const win = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.75), winMat);
        win.position.set(wx, 1.5, 2.33);
        g.add(win);
        const frameMat = new THREE.MeshStandardMaterial({ color: 0x2c241c, roughness: 0.8, transparent: true });
        this.houseFadeMats.push(frameMat);
        const frame = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.88, 0.05), frameMat);
        frame.position.set(wx, 1.5, 2.31);
        g.add(frame);
      }
    }
  }

  private gableTriangle(mat: THREE.Material): THREE.Mesh {
    const shape = new THREE.Shape();
    shape.moveTo(-2.72, 3.05);
    shape.lineTo(2.72, 3.05);
    shape.lineTo(0, LAYOUT.ridgeY);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.24, bevelEnabled: false });
    const m = new THREE.Mesh(geo, mat);
    m.position.z = -0.12;
    return m;
  }

  // ------------------------------------------------------------------
  private buildRoof(rng: Rng): void {
    const g = this.group;
    const v = this.variation;
    const snowTex = snowTexture(v.seed + 2);
    snowTex.repeat.set(2.2, 3);
    const snowMat = new THREE.MeshStandardMaterial({ map: snowTex, roughness: 0.93, transparent: true });
    const shingleMat = new THREE.MeshStandardMaterial({ color: 0x2e2a28, roughness: 0.9, transparent: true });
    // the roof melts away with the dollhouse cutaway during the descent
    this.houseFadeMats.push(snowMat, shingleMat);

    const slopeLen = Math.hypot(LAYOUT.eaveX, LAYOUT.ridgeY - LAYOUT.eaveY) + 0.4;
    const angle = Math.atan2(LAYOUT.ridgeY - LAYOUT.eaveY, LAYOUT.eaveX);
    for (const s of [1, -1]) {
      const slope = new THREE.Group();
      // roof deck (dark underside visible at eaves)
      const deck = new THREE.Mesh(new THREE.BoxGeometry(slopeLen, 0.1, 4.8), shingleMat);
      deck.castShadow = deck.receiveShadow = true;
      slope.add(deck);
      // snow layer with soft irregular surface
      const snowGeo = new THREE.BoxGeometry(slopeLen, 0.14, 4.8, 18, 1, 14);
      const pos = snowGeo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        if (pos.getY(i) > 0) {
          pos.setY(i, pos.getY(i) + (rng() - 0.3) * 0.05);
        }
      }
      snowGeo.computeVertexNormals();
      const snow = new THREE.Mesh(snowGeo, snowMat);
      snow.position.y = 0.12;
      snow.receiveShadow = true;
      snow.castShadow = true;
      slope.add(snow);
      // snow lip at the eave
      const lip = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 4.7, 8), snowMat);
      lip.rotation.x = Math.PI / 2;
      lip.position.set(slopeLen / 2 - 0.03, 0.1, 0);
      slope.add(lip);

      slope.rotation.z = -angle * s;
      const midX = (LAYOUT.eaveX / 2) * s;
      slope.position.set(midX, (LAYOUT.ridgeY + LAYOUT.eaveY) / 2 + 0.02, 0);
      g.add(slope);
    }
    // ridge snow cap
    const ridge = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 4.75, 10), snowMat);
    ridge.rotation.x = Math.PI / 2;
    ridge.scale.y = 0.7;
    ridge.position.set(0, LAYOUT.ridgeY + 0.13, 0);
    g.add(ridge);

    // sled runner tracks (revealed during landing)
    const trackMat = new THREE.MeshStandardMaterial({ color: 0x9fb0cc, roughness: 0.85 });
    const mkTrack = () => {
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.05, 2.6), trackMat);
      t.visible = false;
      g.add(t);
      return t;
    };
    this.sledTrackL = mkTrack();
    this.sledTrackR = mkTrack();
    for (const [track, dx] of [[this.sledTrackL, -0.3], [this.sledTrackR, 0.3]] as const) {
      track.position.set(LAYOUT.sledX + dx, roofY(LAYOUT.sledX + dx) + 0.22, LAYOUT.sledZ + 0.7);
      track.rotation.z = -angle; // east slope tilts down toward +x
    }
  }

  // ------------------------------------------------------------------
  private buildChimney(rng: Rng): void {
    const g = this.group;
    const v = this.variation;
    const cx = LAYOUT.chimneyX, cz = LAYOUT.chimneyZ;
    const inner = LAYOUT.innerHalf;
    const wallT = 0.24;
    const outer = inner + wallT;
    const topY = LAYOUT.chimneyTopY;
    const baseY = roofY(cx + outer) - 0.4; // exterior sinks into the roof

    const brickTex = brickTexture({
      hue: v.brickHue, sat: v.brickSat, light: v.brickLight,
      sootTop: 0.35, sootBottom: 0.05, seed: v.seed + 10
    });
    brickTex.repeat.set(1.1, 1.6);
    const brickMat = new THREE.MeshStandardMaterial({ map: brickTex, roughness: 0.9 });
    const brickFrontMat = new THREE.MeshStandardMaterial({ map: brickTex, roughness: 0.9, transparent: true });
    this.frontFadeMats.push(brickFrontMat);

    const h = topY - baseY;
    const midY = baseY + h / 2;
    // four exterior walls above the roof (front one fades)
    const mk = (w: number, d: number, x: number, z: number, mat: THREE.Material) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, midY, z);
      m.castShadow = m.receiveShadow = true;
      g.add(m);
      return m;
    };
    mk(wallT, outer * 2, cx - inner - wallT / 2, cz, brickMat);            // west
    mk(wallT, outer * 2, cx + inner + wallT / 2, cz, brickMat);            // east
    mk(inner * 2, wallT, cx, cz - inner - wallT / 2, brickMat);            // north/back
    mk(inner * 2, wallT, cx, cz + inner + wallT / 2, brickFrontMat);       // south/front — fades

    // crown: ring of 4 slabs with a real opening
    const crownMat = new THREE.MeshStandardMaterial({ color: 0x6e675e, roughness: 0.75 });
    const crownH = 0.09, crownOut = outer + 0.05;
    const crownY = topY + crownH / 2;
    const crown = [
      [crownOut * 2, crownOut - inner, cx, cz - (inner + (crownOut - inner) / 2)],
      [crownOut * 2, crownOut - inner, cx, cz + (inner + (crownOut - inner) / 2)],
      [crownOut - inner, inner * 2, cx - (inner + (crownOut - inner) / 2), cz],
      [crownOut - inner, inner * 2, cx + (inner + (crownOut - inner) / 2), cz]
    ];
    for (const [w, d, x, z] of crown) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, crownH, d), crownMat);
      m.position.set(x, crownY, z);
      m.castShadow = m.receiveShadow = true;
      g.add(m);
    }
    // snow lumps on the crown (asymmetric, wind-blown to one side)
    const snowMat = new THREE.MeshStandardMaterial({ map: snowTexture(v.seed + 3), roughness: 0.95 });
    for (let i = 0; i < 7; i++) {
      const lump = new THREE.Mesh(new THREE.SphereGeometry(rr(rng, 0.05, 0.11), 8, 6), snowMat);
      const a = rr(rng, -0.6, Math.PI + 0.6);
      lump.position.set(
        cx + Math.cos(a) * (inner + 0.16),
        topY + crownH + 0.01,
        cz - Math.abs(Math.sin(a)) * (inner + 0.14) + 0.08
      );
      lump.scale.y = 0.45;
      lump.castShadow = true;
      g.add(lump);
    }

    // ===== flue interior (visible in cutaway) =====
    const shaftTop = topY;
    const shaftBottom = LAYOUT.shaftBottomY;
    const shaftH = shaftTop - shaftBottom;
    const shaftMid = shaftBottom + shaftH / 2;

    // paintable back wall: base sooty bricks drawn once, smudges at runtime
    this.paintTrailBase();
    this.trailTex = new THREE.CanvasTexture(this.trailCanvas);
    this.trailTex.colorSpace = THREE.SRGBColorSpace;
    const backMat = new THREE.MeshStandardMaterial({ map: this.trailTex, roughness: 0.94 });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(inner * 2, shaftH), backMat);
    back.position.set(cx, shaftMid, cz - inner + 0.005);
    g.add(back);

    const innerBrick = brickTexture({
      hue: v.brickHue, sat: v.brickSat * 0.7, light: v.brickLight * 0.78,
      sootTop: 0.45, sootBottom: 0.6, seed: v.seed + 11
    });
    innerBrick.repeat.set(0.5, 3.2);
    const innerMat = new THREE.MeshStandardMaterial({ map: innerBrick, roughness: 0.94 });
    const west = new THREE.Mesh(new THREE.PlaneGeometry(inner * 2, shaftH), innerMat);
    west.rotation.y = Math.PI / 2;
    west.position.set(cx - inner + 0.005, shaftMid, cz);
    g.add(west);
    const east = new THREE.Mesh(new THREE.PlaneGeometry(inner * 2, shaftH), innerMat);
    east.rotation.y = -Math.PI / 2;
    east.position.set(cx + inner - 0.005, shaftMid, cz);
    g.add(east);

    // cross-section rims at the cut plane: rough mortar faces, one per side,
    // so the "ant farm" read is explicit below the roofline
    const cutMat = new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 0.96 });
    const sectionTop = roofY(cx) + 0.1;
    const secH = sectionTop - shaftBottom;
    for (const sx of [-1, 1]) {
      const rim = new THREE.Mesh(new THREE.BoxGeometry(wallT, secH, 0.06), cutMat);
      rim.position.set(cx + (inner + wallT / 2) * sx, shaftBottom + secH / 2, cz + inner + 0.03);
      g.add(rim);
    }

    // below-roof flue walls (attic depth): dark bricks, sides only
    const atticMat = innerMat;
    for (const sx of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(wallT, secH, inner * 2 + wallT), atticMat);
      wall.position.set(cx + (inner + wallT / 2) * sx, shaftBottom + secH / 2, cz - wallT / 2 + 0.02);
      wall.castShadow = true;
      g.add(wall);
    }
    const backWall = new THREE.Mesh(new THREE.BoxGeometry((inner + wallT) * 2, secH, wallT), atticMat);
    backWall.position.set(cx, shaftBottom + secH / 2, cz - inner - wallT / 2);
    g.add(backWall);
  }

  // ------------------------------------------------------------------
  private buildRoom(rng: Rng): void {
    const g = this.group;
    const v = this.variation;
    const cx = LAYOUT.chimneyX, cz = LAYOUT.chimneyZ;

    // floor
    const woodTex = woodTexture(v.seed + 4);
    woodTex.repeat.set(3, 3);
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(5.2, 0.08, 4.4),
      new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.7 })
    );
    floor.position.set(0, -0.02, 0);
    floor.receiveShadow = true;
    g.add(floor);

    // ceiling (fades with the dollhouse cutaway so the flue camera passes it)
    const ceilMat = new THREE.MeshStandardMaterial({ color: 0xcdc4b2, roughness: 0.95, transparent: true });
    this.houseFadeMats.push(ceilMat);
    const ceil = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.1, 4.4), ceilMat);
    ceil.position.set(0, LAYOUT.roomCeilY + 0.05, 0);
    g.add(ceil);

    // wallpapered interior back wall
    const wpTex = wallpaperTexture(v.seed + 5, v.wallHue);
    wpTex.repeat.set(2.4, 1.3);
    const wp = new THREE.Mesh(
      new THREE.PlaneGeometry(5.2, LAYOUT.roomCeilY),
      new THREE.MeshStandardMaterial({ map: wpTex, roughness: 0.95 })
    );
    wp.position.set(0, LAYOUT.roomCeilY / 2, -2.06);
    wp.receiveShadow = true;
    g.add(wp);
    // interior side walls
    const sideWp = new THREE.MeshStandardMaterial({ map: wpTex, roughness: 0.95 });
    for (const s of [1, -1]) {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(4.4, LAYOUT.roomCeilY), sideWp);
      wall.rotation.y = (Math.PI / 2) * s;
      wall.position.set(-2.45 * s, LAYOUT.roomCeilY / 2, 0);
      wall.receiveShadow = true;
      g.add(wall);
    }

    // window on the back wall with cold moonlight glow
    {
      const frame = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 1.2, 0.08),
        new THREE.MeshStandardMaterial({ color: 0x342a20, roughness: 0.8 })
      );
      frame.position.set(-1.1, 1.6, -2.04);
      g.add(frame);
      const glass = new THREE.Mesh(
        new THREE.PlaneGeometry(0.74, 1.04),
        new THREE.MeshBasicMaterial({ color: 0x8fa8d8 })
      );
      glass.position.set(-1.1, 1.6, -1.96);
      g.add(glass);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.04, 0.03), frame.material);
      bar.position.set(-1.1, 1.6, -1.98);
      g.add(bar);
      const bar2 = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.05, 0.03), frame.material);
      bar2.position.set(-1.1, 1.6, -1.98);
      g.add(bar2);
    }

    // ===== chimney breast + firebox =====
    const brickTexRoom = brickTexture({
      hue: v.brickHue, sat: v.brickSat, light: v.brickLight * 0.92,
      sootTop: 0.25, sootBottom: 0.1, seed: v.seed + 12
    });
    brickTexRoom.repeat.set(1.4, 1.8);
    const breastMat = new THREE.MeshStandardMaterial({ map: brickTexRoom, roughness: 0.9 });
    const breastFrontMat = new THREE.MeshStandardMaterial({ map: brickTexRoom, roughness: 0.9, transparent: true });
    this.frontFadeMats.push(breastFrontMat);

    const bw = 1.55;              // breast width
    const bx = cx;                // centered on the flue
    const bFrontZ = cz + 0.5;     // breast sticks out into the room
    const openW = 0.96, openH = 0.98;

    // side pillars beside the firebox opening (front face)
    for (const s of [1, -1]) {
      const pw = (bw - openW) / 2;
      const p = new THREE.Mesh(new THREE.BoxGeometry(pw, openH, bFrontZ - (cz - 0.45)), breastMat);
      p.position.set(bx + (openW / 2 + pw / 2) * s, openH / 2, (bFrontZ + cz - 0.45) / 2);
      p.castShadow = p.receiveShadow = true;
      g.add(p);
    }
    // lintel above the opening → up to the ceiling (front slab fades in cutaway)
    const lintelH = LAYOUT.roomCeilY - openH;
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(bw, lintelH, 0.22), breastFrontMat);
    lintel.position.set(bx, openH + lintelH / 2, bFrontZ - 0.11);
    lintel.castShadow = true;
    g.add(lintel);
    // breast body around the flue (the flue itself stays open — Santa passes
    // through it and the cutaway camera must see him)
    const inner = LAYOUT.innerHalf;
    const bodyDepth = bFrontZ - 0.24 - (cz - 0.45);
    for (const s of [1, -1]) {
      const colW = bw / 2 - inner;
      const col = new THREE.Mesh(new THREE.BoxGeometry(colW, lintelH, bodyDepth), breastMat);
      col.position.set(bx + (inner + colW / 2) * s, openH + lintelH / 2, (bFrontZ - 0.24 + cz - 0.45) / 2);
      g.add(col);
    }
    const backSlab = new THREE.Mesh(new THREE.BoxGeometry(inner * 2, lintelH, 0.14), breastMat);
    backSlab.position.set(bx, openH + lintelH / 2, cz - 0.38);
    g.add(backSlab);

    // firebox cavity: sooty interior
    const fbMat = new THREE.MeshStandardMaterial({ color: 0x18120e, roughness: 0.98 });
    const fbBack = new THREE.Mesh(new THREE.PlaneGeometry(openW, openH), fbMat);
    fbBack.position.set(bx, openH / 2, cz - 0.42);
    g.add(fbBack);
    for (const s of [1, -1]) {
      const side = new THREE.Mesh(new THREE.PlaneGeometry(bFrontZ - (cz - 0.45), openH), fbMat);
      side.rotation.y = (Math.PI / 2) * s;
      side.position.set(bx - (openW / 2) * s, openH / 2, (bFrontZ + cz - 0.45) / 2);
      g.add(side);
    }
    // firebox ceiling (the flue throat): a ring, not a lid — the flue is open
    const throatF = new THREE.Mesh(new THREE.BoxGeometry(openW, 0.06, Math.max(0.05, bFrontZ - (cz + inner))), fbMat);
    throatF.position.set(bx, openH + 0.03, (bFrontZ + cz + inner) / 2);
    g.add(throatF);
    const throatB = new THREE.Mesh(new THREE.BoxGeometry(openW, 0.06, 0.16), fbMat);
    throatB.position.set(bx, openH + 0.03, cz - 0.37);
    g.add(throatB);
    for (const s of [1, -1]) {
      const throatS = new THREE.Mesh(new THREE.BoxGeometry((openW - inner * 2) / 2, 0.06, bFrontZ - (cz - 0.45)), fbMat);
      throatS.position.set(bx + (inner + (openW / 2 - inner) / 2) * s, openH + 0.03, (bFrontZ + cz - 0.45) / 2);
      g.add(throatS);
    }
    // firebox floor
    const fbFloor = new THREE.Mesh(
      new THREE.BoxGeometry(openW, 0.06, bFrontZ - (cz - 0.45)),
      new THREE.MeshStandardMaterial({ color: 0x241c16, roughness: 0.95 })
    );
    fbFloor.position.set(bx, 0.03, (bFrontZ + cz - 0.45) / 2);
    fbFloor.receiveShadow = true;
    g.add(fbFloor);

    // hearth stone slab
    const hearth = new THREE.Mesh(
      new THREE.BoxGeometry(bw + 0.4, 0.07, 0.7),
      new THREE.MeshStandardMaterial({ color: 0x54504a, roughness: 0.85 })
    );
    hearth.position.set(bx, 0.055, bFrontZ + 0.35);
    hearth.receiveShadow = true;
    g.add(hearth);

    // mantel shelf
    const mantel = new THREE.Mesh(
      new THREE.BoxGeometry(bw + 0.24, 0.09, 0.34),
      new THREE.MeshStandardMaterial({ map: woodTexture(v.seed + 6, 18), roughness: 0.6 })
    );
    mantel.position.set(bx, LAYOUT.stockingTopY + 0.09, bFrontZ - 0.02);
    mantel.castShadow = mantel.receiveShadow = true;
    g.add(mantel);
    // small candle + clock on the mantel (purposeful set dressing)
    {
      const candle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.035, 0.14, 10),
        new THREE.MeshStandardMaterial({ color: 0xd8cfb8, roughness: 0.7 })
      );
      candle.position.set(bx - 0.55, LAYOUT.stockingTopY + 0.2, bFrontZ - 0.06);
      g.add(candle);
      const clock = new THREE.Mesh(
        new THREE.CylinderGeometry(0.09, 0.09, 0.05, 16),
        new THREE.MeshStandardMaterial({ color: 0x4a3826, roughness: 0.6 })
      );
      clock.rotation.x = Math.PI / 2;
      clock.position.set(bx + 0.42, LAYOUT.stockingTopY + 0.24, bFrontZ - 0.12);
      g.add(clock);
      const face = new THREE.Mesh(
        new THREE.CircleGeometry(0.068, 16),
        new THREE.MeshStandardMaterial({ color: 0xa89d84, roughness: 0.7 })
      );
      face.position.set(bx + 0.42, LAYOUT.stockingTopY + 0.24, bFrontZ - 0.09);
      g.add(face);
    }

    // embers + charred logs (kept low & to the back so Santa lands clear)
    const logMat = new THREE.MeshStandardMaterial({ color: 0x1d1410, roughness: 0.95 });
    for (let i = 0; i < 3; i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.5, 8), logMat);
      log.rotation.z = Math.PI / 2;
      log.rotation.y = rr(rng, -0.5, 0.5);
      log.position.set(bx + rr(rng, -0.12, 0.12), 0.08 + i * 0.05, cz - 0.28 + rr(rng, -0.05, 0.05));
      g.add(log);
    }
    for (let i = 0; i < 6; i++) {
      const em = new THREE.MeshStandardMaterial({
        color: 0x30201a, emissive: 0xff5a1a, emissiveIntensity: 0.8, roughness: 0.9
      });
      this.emberMats.push(em);
      const ember = new THREE.Mesh(new THREE.SphereGeometry(rr(rng, 0.025, 0.05), 8, 6), em);
      ember.position.set(bx + rr(rng, -0.2, 0.2), 0.07, cz - 0.26 + rr(rng, -0.08, 0.08));
      g.add(ember);
    }
    // two small flame cards (additive, flickering)
    const flameC = document.createElement('canvas');
    flameC.width = 32; flameC.height = 64;
    const fctx = flameC.getContext('2d')!;
    const fg = fctx.createLinearGradient(0, 64, 0, 0);
    fg.addColorStop(0, 'rgba(255, 140, 30, 0.9)');
    fg.addColorStop(0.55, 'rgba(255, 90, 20, 0.5)');
    fg.addColorStop(1, 'rgba(255, 60, 10, 0)');
    fctx.fillStyle = fg;
    fctx.beginPath();
    fctx.ellipse(16, 40, 10, 24, 0, 0, Math.PI * 2);
    fctx.fill();
    const flameTex = new THREE.CanvasTexture(flameC);
    for (let i = 0; i < 2; i++) {
      const fl = new THREE.Mesh(
        new THREE.PlaneGeometry(0.14, 0.26),
        new THREE.MeshBasicMaterial({
          map: flameTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
        })
      );
      fl.position.set(bx + (i - 0.5) * 0.16, 0.2, cz - 0.24);
      this.flames.push(fl);
      g.add(fl);
    }

    // ===== furnishing =====
    const rug = new THREE.Mesh(
      new THREE.CircleGeometry(0.95, 26),
      new THREE.MeshStandardMaterial({ map: rugTexture(v.seed + 7, (v.wallHue + 140) % 360), roughness: 0.95 })
    );
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(bx - 0.3, 0.025, bFrontZ + 1.15);
    rug.receiveShadow = true;
    g.add(rug);

    // armchair
    {
      const mat = new THREE.MeshStandardMaterial({ color: 0x2e4434, roughness: 0.9 });
      const chair = new THREE.Group();
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.3, 0.6), mat);
      seat.position.y = 0.28;
      chair.add(seat);
      const backC = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.55, 0.16), mat);
      backC.position.set(0, 0.62, -0.24);
      backC.rotation.x = -0.12;
      chair.add(backC);
      for (const s of [1, -1]) {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.32, 0.56), mat);
        arm.position.set(0.31 * s, 0.48, 0);
        chair.add(arm);
      }
      const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.46), new THREE.MeshStandardMaterial({ color: 0x63443a, roughness: 0.95 }));
      cushion.position.set(0, 0.42, 0.03);
      chair.add(cushion);
      chair.position.set(-0.85, 0, -0.7);
      chair.rotation.y = 0.7;
      chair.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
      g.add(chair);
    }

    // little tree in the corner with a few ornaments
    {
      const tree = new THREE.Group();
      const treeMat = new THREE.MeshStandardMaterial({ color: 0x1c3322, roughness: 0.95 });
      for (let i = 0; i < 3; i++) {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.42 - i * 0.11, 0.5, 9), treeMat);
        cone.position.y = 0.45 + i * 0.32;
        cone.castShadow = true;
        tree.add(cone);
      }
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.3, 8), new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.9 }));
      trunk.position.y = 0.15;
      tree.add(trunk);
      const ballCols = [0xb03434, 0xc8a03c, 0x3a6ea8];
      for (let i = 0; i < 6; i++) {
        const ball = new THREE.Mesh(
          new THREE.SphereGeometry(0.035, 10, 8),
          new THREE.MeshStandardMaterial({ color: ballCols[i % 3], roughness: 0.3, metalness: 0.2 })
        );
        const a = rr(rng, 0, Math.PI * 2);
        const layer = Math.floor(rng() * 3);
        const r = (0.4 - layer * 0.11) * 0.82;
        ball.position.set(Math.cos(a) * r, 0.38 + layer * 0.32, Math.sin(a) * r);
        tree.add(ball);
      }
      tree.position.set(-1.95, 0, -1.55);
      g.add(tree);
    }

    // stool with cookies + mug beside the hearth
    {
      const stool = new THREE.Mesh(
        new THREE.CylinderGeometry(0.17, 0.19, 0.3, 12),
        new THREE.MeshStandardMaterial({ map: woodTexture(v.seed + 8, 30), roughness: 0.7 })
      );
      stool.position.set(bx - 1.05, 0.15, bFrontZ + 0.5);
      stool.castShadow = true;
      g.add(stool);
      const plate = new THREE.Mesh(
        new THREE.CylinderGeometry(0.11, 0.09, 0.02, 14),
        new THREE.MeshStandardMaterial({ color: 0xdcd6c8, roughness: 0.4 })
      );
      plate.position.set(bx - 1.05, 0.31, bFrontZ + 0.5);
      g.add(plate);
      for (let i = 0; i < 2; i++) {
        const cookie = new THREE.Mesh(
          new THREE.CylinderGeometry(0.035, 0.035, 0.014, 10),
          new THREE.MeshStandardMaterial({ color: 0xa2703c, roughness: 0.9 })
        );
        cookie.position.set(bx - 1.05 + (i - 0.5) * 0.07, 0.33, bFrontZ + 0.5 + (i - 0.5) * 0.03);
        g.add(cookie);
      }
      const mug = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.03, 0.08, 10),
        new THREE.MeshStandardMaterial({ color: 0x7c3030, roughness: 0.5 })
      );
      mug.position.set(bx - 0.92, 0.35, bFrontZ + 0.44);
      g.add(mug);
    }
  }

  // ------------------------------------------------------------------
  // soot trail: base coat drawn once; runtime smudges accumulate per run
  private paintTrailBase(): void {
    const ctx = this.trailCtx;
    const w = this.trailCanvas.width, h = this.trailCanvas.height;
    const rng = makeRng(this.variation.seed + 77);
    ctx.fillStyle = '#4c3a30';
    ctx.fillRect(0, 0, w, h);
    // dark brick coursing
    const rows = 30, bh = h / rows, bw = bh * 2.1;
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * bw * 0.5;
      for (let c = -1; c < w / bw + 1; c++) {
        const l = 22 + rng() * 12;
        ctx.fillStyle = `hsl(${14 + rng() * 10}, ${18 + rng() * 12}%, ${l}%)`;
        ctx.fillRect(c * bw + off + 2, r * bh + 2, bw - 4, bh - 4);
      }
    }
    // ambient soot wash, heavier at bottom
    const gr = ctx.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, 'rgba(10,8,6,0.25)');
    gr.addColorStop(1, 'rgba(8,6,5,0.55)');
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, w, h);
  }

  // v: 0 (flue top) → 1 (flue bottom); x01: lateral position 0..1; speed 0..1
  paintSoot(v: number, x01: number, speed: number): void {
    const ctx = this.trailCtx;
    const w = this.trailCanvas.width, h = this.trailCanvas.height;
    const rng = this.trailRng;
    const y = v * h;
    const x = x01 * w * 0.72 + w * 0.14 + (rng() - 0.5) * 26;
    const rad = 9 + speed * 22 + rng() * 12;
    const alpha = 0.05 + speed * 0.1 + rng() * 0.05;
    const grd = ctx.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, `rgba(12, 9, 7, ${alpha})`);
    grd.addColorStop(1, 'rgba(12, 9, 7, 0)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.ellipse(x, y, rad, rad * (1.6 + speed), 0, 0, Math.PI * 2);
    ctx.fill();
    // occasional scrape streak
    if (rng() < 0.3) {
      ctx.strokeStyle = `rgba(8, 6, 5, ${alpha * 0.9})`;
      ctx.lineWidth = 1.5 + rng() * 2;
      ctx.beginPath();
      ctx.moveTo(x + (rng() - 0.5) * 14, y - rad);
      ctx.lineTo(x + (rng() - 0.5) * 14, y + rad * (1.5 + speed * 2));
      ctx.stroke();
    }
    this.trailTex.needsUpdate = true;
  }

  // ------------------------------------------------------------------
  setFrontFade(target: number): void {
    this.frontFade = target;
  }

  setHouseFade(target: number): void {
    this.houseFade = target;
  }

  // fireIntensity 0..1 — ramped by the game as the camera nears the hearth
  fireLevel = 0.85;

  showHintMotes(): void {
    this.hintMoteT = 0;
  }

  showSledTracks(reveal: number): void {
    for (const t of [this.sledTrackL, this.sledTrackR]) {
      t.visible = reveal > 0.02;
      t.scale.z = Math.max(0.02, reveal);
      const half = 1.3;
      t.position.z = LAYOUT.sledZ + 0.7 + half * (1 - reveal);
    }
  }

  update(dt: number, camY: number): void {
    this.time += dt;
    const t = this.time;

    // fade the cutaway materials smoothly
    for (const m of this.frontFadeMats) {
      const mat = m as THREE.MeshStandardMaterial;
      mat.opacity = lerp(mat.opacity ?? 1, this.frontFade, Math.min(1, dt * 4));
      mat.depthWrite = mat.opacity > 0.5;
    }
    for (const m of this.houseFadeMats) {
      const mat = m as THREE.MeshStandardMaterial;
      mat.opacity = lerp(mat.opacity ?? 1, this.houseFade, Math.min(1, dt * 4));
      mat.depthWrite = mat.opacity > 0.5;
    }

    // moonlight ↔ firelight continuous blend by camera height:
    // blue on the roof, orange near the hearth, mixing inside the flue
    const warm = clamp01((3.4 - camY) / 2.6); // 0 above y=3.4 → 1 below y=0.8
    const flick = 0.85 + Math.sin(t * 9.2) * 0.06 + Math.sin(t * 23.7) * 0.05;
    this.fireLight.intensity = (0.35 + warm * 3.3) * flick * this.fireLevel;
    this.roomFill.intensity = warm * 1.7 * this.fireLevel;
    this.moonLight.intensity = lerp(1.9, 0.55, warm);
    this.hemi.intensity = lerp(0.85, 0.45, warm);
    // flue lamp shifts cold sky-light → warm fire-light with depth
    {
      const lampWarm = clamp01((3.6 - this.descentLamp.position.y) / 2.8);
      this.descentLamp.color.setRGB(
        lerp(0.78, 1.0, lampWarm),
        lerp(0.85, 0.72, lampWarm),
        lerp(1.0, 0.45, lampWarm)
      );
    }

    for (let i = 0; i < this.emberMats.length; i++) {
      this.emberMats[i].emissiveIntensity =
        (0.5 + Math.sin(t * 3.1 + i * 1.7) * 0.3 + Math.sin(t * 7.7 + i) * 0.15) * this.fireLevel;
    }
    for (let i = 0; i < this.flames.length; i++) {
      const fl = this.flames[i];
      fl.scale.y = (0.8 + Math.sin(t * 11 + i * 2.4) * 0.22) * this.fireLevel;
      fl.scale.x = 0.9 + Math.sin(t * 8 + i) * 0.12;
      (fl.material as THREE.MeshBasicMaterial).opacity = 0.55 * this.fireLevel + Math.sin(t * 13 + i) * 0.1;
    }

    // falling snow drift
    {
      const pos = this.snowPoints.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        let y = pos.getY(i) - this.snowVel[i] * dt;
        let x = pos.getX(i) + Math.sin(t * 0.7 + i) * dt * 0.18;
        if (y < 0) { y = 11 + Math.random(); x = -9 + Math.random() * 18; }
        pos.setY(i, y);
        pos.setX(i, x);
      }
      pos.needsUpdate = true;
    }

    // hint motes: drift down into the flue mouth, then fade
    if (this.hintMoteT < 3.2) {
      this.hintMoteT += dt;
      const mt = this.hintMoteT;
      const mat = this.hintMotes.material as THREE.PointsMaterial;
      mat.opacity = mt < 0.4 ? mt / 0.4 : mt > 2.4 ? Math.max(0, 1 - (mt - 2.4) / 0.8) : 1;
      const pos = this.hintMotes.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        let y = pos.getY(i) - dt * 0.55;
        if (y < LAYOUT.chimneyTopY - 0.5) y = LAYOUT.chimneyTopY + 0.6;
        pos.setY(i, y);
      }
      pos.needsUpdate = true;
    } else {
      (this.hintMotes.material as THREE.PointsMaterial).opacity = 0;
    }
  }
}
