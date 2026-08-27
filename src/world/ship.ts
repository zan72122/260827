import * as THREE from 'three';
import { makeCableMaterial, makeHazardTexture, makeWetDeckMaterial } from './materials';

// Procedural cable-laying ship. Local frame: +X = forward (bow), origin at the
// waterline, deck at y = DECK_Y. Every machine sits on the real cable path:
// tank -> overhead guide -> tensioner -> stern sheave -> overboard chute.
export const DECK_Y = 1.6;
const BOW = 13, STERN = -13;

interface CoilRing {
  radius: number;
  y: number;
}

export class Ship {
  readonly group = new THREE.Group();
  /** Local overboarding point where the catenary attaches (just aft of the chute). */
  readonly overboardLocal = new THREE.Vector3(STERN - 0.9, 0.35, 0);
  /** Camera anchor points (local) used by the opening deck tour. */
  readonly camPoints = {
    tankTop: new THREE.Vector3(-1, DECK_Y + 2.3, 0),
    tensioner: new THREE.Vector3(-6.6, DECK_Y + 1.35, 0),
    sheave: new THREE.Vector3(STERN + 0.7, DECK_Y + 2.2, 0),
    chute: new THREE.Vector3(STERN - 0.6, 1.0, 0)
  };

  private coilMeshes: THREE.Mesh[] = [];
  private coilRings: CoilRing[] = [];
  private tensionWheels: THREE.Mesh[] = [];
  private sheave!: THREE.Group;
  private laySpeed = 0;

  constructor(env: THREE.Texture) {
    this.buildHull(env);
    this.buildSuperstructure(env);
    this.buildTank(env);
    this.buildTensioner();
    this.buildSternGear(env);
    this.buildSafety();
    this.buildWorkers();
    this.buildDeckCable();
  }

  private outlinePoints(inset: number): THREE.Vector2[] {
    // Deck plan outline (x fwd, y = beam-z). Rounded stern, pointed bow.
    const B = 3.8 - inset;
    const pts: THREE.Vector2[] = [];
    const stern = STERN + inset, bow = BOW - inset;
    // starboard side stern -> bow
    for (let a = 0; a <= 6; a++) {
      const th = Math.PI / 2 + (a / 6) * (Math.PI / 2);
      pts.push(new THREE.Vector2(stern + 1.6 + 1.6 * Math.cos(th), B * Math.sin(th)));
    }
    pts.push(new THREE.Vector2(stern + 4, B));
    pts.push(new THREE.Vector2(bow - 7, B));
    pts.push(new THREE.Vector2(bow - 2.5, B * 0.6));
    pts.push(new THREE.Vector2(bow, 0));
    // port side back
    const mirror = pts.slice(0, -1).reverse().map((p) => new THREE.Vector2(p.x, -p.y));
    return pts.concat(mirror);
  }

  private buildHull(env: THREE.Texture): void {
    const shape = new THREE.Shape(this.outlinePoints(0));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 4.2, bevelEnabled: false });
    geo.rotateX(Math.PI / 2);
    geo.translate(0, DECK_Y, 0);
    const deckMat = makeWetDeckMaterial();
    deckMat.envMap = env;
    const hullMat = new THREE.MeshStandardMaterial({
      color: 0x9e2f2a, roughness: 0.5, metalness: 0.3, envMap: env, envMapIntensity: 0.8
    });
    const hull = new THREE.Mesh(geo, [deckMat, hullMat]);
    this.group.add(hull);

    // Black boot-top stripe at the waterline.
    const stripeShape = new THREE.Shape(this.outlinePoints(-0.06));
    const stripe = new THREE.ExtrudeGeometry(stripeShape, { depth: 0.9, bevelEnabled: false });
    stripe.rotateX(Math.PI / 2);
    stripe.translate(0, 0.55, 0);
    this.group.add(new THREE.Mesh(stripe, new THREE.MeshStandardMaterial({
      color: 0x14161a, roughness: 0.6, metalness: 0.2
    })));

    // Bulwark: thin wall around the deck edge.
    const outer = new THREE.Shape(this.outlinePoints(0));
    outer.holes.push(new THREE.Path(this.outlinePoints(0.28).reverse()));
    const bw = new THREE.ExtrudeGeometry(outer, { depth: 1.05, bevelEnabled: false });
    bw.rotateX(Math.PI / 2);
    bw.translate(0, DECK_Y + 1.05, 0);
    this.group.add(new THREE.Mesh(bw, new THREE.MeshStandardMaterial({
      color: 0xb8bcbe, roughness: 0.5, metalness: 0.35, envMap: env, envMapIntensity: 0.7
    })));
  }

  private buildSuperstructure(env: THREE.Texture): void {
    const white = new THREE.MeshStandardMaterial({
      color: 0xe8e9ea, roughness: 0.45, metalness: 0.2, envMap: env, envMapIntensity: 0.7
    });
    const block = new THREE.Mesh(new THREE.BoxGeometry(5.4, 3.2, 6.4), white);
    block.position.set(8.2, DECK_Y + 1.6, 0);
    this.group.add(block);

    const bridge = new THREE.Mesh(new THREE.BoxGeometry(4.6, 2.2, 7.2), white);
    bridge.position.set(8.0, DECK_Y + 4.3, 0);
    this.group.add(bridge);

    // Dark bridge window band, wrapped on 3 sides.
    const winMat = new THREE.MeshStandardMaterial({
      color: 0x1a2c38, roughness: 0.1, metalness: 0.6, envMap: env, envMapIntensity: 1.4
    });
    const winF = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.9, 6.9), winMat);
    winF.position.set(5.75, DECK_Y + 4.75, 0);
    this.group.add(winF);
    for (const s of [-1, 1]) {
      const winS = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.9, 0.12), winMat);
      winS.position.set(8.0, DECK_Y + 4.75, s * 3.62);
      this.group.add(winS);
    }

    // Funnel + mast.
    const funnel = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.85, 2.6, 12), new THREE.MeshStandardMaterial({
      color: 0xc7cdd1, roughness: 0.5, metalness: 0.3
    }));
    funnel.position.set(10.6, DECK_Y + 6.2, 0);
    this.group.add(funnel);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 3.4, 8), white);
    mast.position.set(6.2, DECK_Y + 7.1, 0);
    this.group.add(mast);
  }

  private buildTank(env: THREE.Texture): void {
    const tankMat = new THREE.MeshStandardMaterial({
      color: 0xd8d3c4, roughness: 0.6, metalness: 0.25, envMap: env, envMapIntensity: 0.6,
      side: THREE.DoubleSide
    });
    // Tank wall rises above deck so its round shape reads from every angle.
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(3.1, 3.1, 1.7, 28, 1, true), tankMat);
    wall.position.set(-1, DECK_Y + 0.85, 0);
    this.group.add(wall);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(3.1, 0.09, 8, 28), tankMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(-1, DECK_Y + 1.7, 0);
    this.group.add(rim);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(3.05, 28), new THREE.MeshStandardMaterial({
      color: 0x6d675b, roughness: 0.9
    }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(-1, DECK_Y + 0.06, 0);
    this.group.add(floor);

    // Coiled cable: concentric torus rings (cable-diameter true to the rest
    // of the game), 3 visible layers x 4 radii. Pay-out order is top layer
    // outside-in, then the layer below.
    const radii = [2.72, 2.1, 1.48, 0.86];
    const layers = [1.45, 0.85, 0.3];
    for (const y of layers) {
      for (const r of radii) this.coilRings.push({ radius: r, y });
    }
    const cableMat = makeCableMaterial();
    const geoByRadius = new Map<number, THREE.TorusGeometry>();
    for (const ring of this.coilRings) {
      let geo = geoByRadius.get(ring.radius);
      if (!geo) {
        geo = new THREE.TorusGeometry(ring.radius, 0.28, 8, 40);
        geoByRadius.set(ring.radius, geo);
      }
      const mesh = new THREE.Mesh(geo, cableMat);
      mesh.rotation.x = Math.PI / 2;
      mesh.position.set(-1, DECK_Y + ring.y, 0);
      this.group.add(mesh);
      this.coilMeshes.push(mesh);
    }
  }

  private buildTensioner(): void {
    // Linear cable engine: yellow frame, paired rubber wheels gripping the cable.
    const frameMat = new THREE.MeshStandardMaterial({ color: 0xd9a520, roughness: 0.55, metalness: 0.3 });
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x232323, roughness: 0.85 });
    const g = new THREE.Group();
    g.position.set(-6.6, DECK_Y, 0);

    const base = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.35, 1.7), frameMat);
    base.position.y = 0.18;
    g.add(base);
    for (const s of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.28, 0.22), frameMat);
      rail.position.set(0, 2.15, s * 0.75);
      g.add(rail);
      const legA = new THREE.Mesh(new THREE.BoxGeometry(0.24, 2.0, 0.22), frameMat);
      legA.position.set(-2.15, 1.15, s * 0.75);
      g.add(legA);
      const legB = legA.clone();
      legB.position.x = 2.15;
      g.add(legB);
    }
    const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.6, 16);
    wheelGeo.rotateX(Math.PI / 2);
    for (let i = 0; i < 4; i++) {
      const x = -1.6 + i * 1.06;
      for (const dy of [-0.52, 0.52]) {
        const w = new THREE.Mesh(wheelGeo, wheelMat);
        w.position.set(x, 1.35 + dy, 0);
        g.add(w);
        this.tensionWheels.push(w);
      }
    }
    this.group.add(g);
  }

  private buildSternGear(env: THREE.Texture): void {
    const steel = new THREE.MeshStandardMaterial({
      color: 0x8f979c, roughness: 0.4, metalness: 0.7, envMap: env, envMapIntensity: 1.0
    });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0xd9a520, roughness: 0.55, metalness: 0.3 });

    // A-frame gantry over the stern.
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.35, 4.6, 0.35), frameMat);
      leg.position.set(STERN + 1.4, DECK_Y + 2.1, s * 1.8);
      leg.rotation.z = -0.18;
      this.group.add(leg);
    }
    const cross = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 3.9), frameMat);
    cross.position.set(STERN + 1.0, DECK_Y + 4.3, 0);
    this.group.add(cross);

    // Big stern sheave: rim + spokes + hub, axis transverse.
    this.sheave = new THREE.Group();
    this.sheave.position.set(STERN + 0.7, DECK_Y + 2.2, 0);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.18, 10, 30), steel);
    this.sheave.add(rim);
    for (let i = 0; i < 6; i++) {
      const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.7, 6), steel);
      spoke.rotation.z = (i / 6) * Math.PI;
      this.sheave.add(spoke);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.5, 12), steel);
    hub.rotation.x = Math.PI / 2;
    this.sheave.add(hub);
    this.group.add(this.sheave);

    // Overboarding chute rolling down the stern.
    const chute = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 2.4, 10, 1, true, Math.PI, Math.PI), steel);
    chute.rotation.z = 1.15;
    chute.position.set(STERN - 0.35, DECK_Y - 0.5, 0);
    this.group.add(chute);
  }

  private buildSafety(): void {
    // Hazard stripe skirting around the work area + stanchion rails aft.
    const hazTex = makeHazardTexture();
    hazTex.repeat.set(6, 1);
    const haz = new THREE.MeshBasicMaterial({ map: hazTex });
    for (const s of [-1, 1]) {
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(12.5, 0.3), haz);
      strip.rotation.x = -Math.PI / 2;
      strip.position.set(-6.2, DECK_Y + 0.02, s * 2.35);
      this.group.add(strip);
    }
    const postMat = new THREE.MeshStandardMaterial({ color: 0xdadada, roughness: 0.5, metalness: 0.4 });
    const postGeo = new THREE.CylinderGeometry(0.045, 0.045, 1.0, 6);
    const posts = new THREE.InstancedMesh(postGeo, postMat, 24);
    const m = new THREE.Matrix4();
    let idx = 0;
    for (const s of [-1, 1]) {
      for (let i = 0; i < 12; i++) {
        m.setPosition(-12 + i * 1.05, DECK_Y + 0.5, s * 2.6);
        posts.setMatrixAt(idx++, m);
      }
    }
    this.group.add(posts);
    for (const s of [-1, 1]) {
      for (const ry of [0.55, 0.95]) {
        const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 11.6, 6), postMat);
        rail.rotation.z = Math.PI / 2;
        rail.position.set(-6.3, DECK_Y + ry, s * 2.6);
        this.group.add(rail);
      }
    }
    // Life rings on the superstructure rail.
    const ringMat = new THREE.MeshStandardMaterial({ color: 0xe86a1c, roughness: 0.6 });
    for (const s of [-1, 1]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.09, 8, 16), ringMat);
      ring.position.set(5.6, DECK_Y + 2.2, s * 3.15);
      this.group.add(ring);
    }
  }

  private buildWorkers(): void {
    // Adult crew in hi-vis, standing in safe positions - never touching the
    // running machinery. (No child characters on deck.)
    const mkWorker = (skin: number) => {
      const g = new THREE.Group();
      const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.19, 0.8, 8),
        new THREE.MeshStandardMaterial({ color: 0x27354a, roughness: 0.8 }));
      legs.position.y = 0.4;
      g.add(legs);
      const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.17, 0.62, 8),
        new THREE.MeshStandardMaterial({ color: 0xe8641c, roughness: 0.7 }));
      torso.position.y = 1.1;
      g.add(torso);
      for (const s of [-1, 1]) {
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.55, 6),
          new THREE.MeshStandardMaterial({ color: 0xe8641c, roughness: 0.7 }));
        arm.position.set(0, 1.12, s * 0.26);
        arm.rotation.x = s * 0.15;
        g.add(arm);
      }
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8),
        new THREE.MeshStandardMaterial({ color: skin, roughness: 0.7 }));
      head.position.y = 1.56;
      g.add(head);
      const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4 }));
      helmet.position.y = 1.58;
      g.add(helmet);
      return g;
    };
    // Operator at the control console beside the tank (behind the rail).
    const console1 = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.1, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x39424a, roughness: 0.5, metalness: 0.4 }));
    console1.position.set(-3.6, DECK_Y + 0.55, 3.0);
    this.group.add(console1);
    const w1 = mkWorker(0xb98a68);
    w1.position.set(-3.6, DECK_Y, 3.65);
    w1.rotation.y = Math.PI;
    this.group.add(w1);
    // Spotter aft, safely behind the stanchion rail.
    const w2 = mkWorker(0x8a5f45);
    w2.position.set(-10.5, DECK_Y, 3.1);
    w2.rotation.y = -Math.PI / 2 - 0.5;
    this.group.add(w2);
    // Officer on the bridge wing.
    const w3 = mkWorker(0xd9a88a);
    w3.position.set(6.0, DECK_Y + 3.2, -3.2);
    w3.rotation.y = Math.PI / 2;
    this.group.add(w3);
  }

  private buildDeckCable(): void {
    // The cable's visible journey across the deck:
    // coil top -> overhead guide -> tensioner (horizontal run) -> stern sheave
    // (over the top) -> down the chute to the overboard point.
    const p = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const pts = [
      p(-1, DECK_Y + 1.45, 0.95),
      p(-1.4, DECK_Y + 2.6, 0.4),
      p(-2.0, DECK_Y + 3.4, 0),
      p(-3.4, DECK_Y + 2.4, 0),
      p(-4.9, DECK_Y + 1.35, 0),
      p(-6.6, DECK_Y + 1.35, 0),
      p(-8.3, DECK_Y + 1.35, 0),
      p(-10.6, DECK_Y + 1.7, 0),
      // wrap over the sheave (center x=STERN+0.7=-12.3, y=DECK_Y+2.2, r=1.45)
      p(-12.3 + 1.45 * Math.cos(1.9), DECK_Y + 2.2 + 1.45 * Math.sin(1.9), 0),
      p(-12.3, DECK_Y + 2.2 + 1.45, 0),
      p(-12.3 + 1.45 * Math.cos(2.9) - 0.4, DECK_Y + 2.2 + 1.45 * Math.sin(2.9), 0),
      p(-13.5, DECK_Y + 0.6, 0),
      this.overboardLocal.clone()
    ];
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.2);
    const tube = new THREE.TubeGeometry(curve, 72, 0.28, 8, false);
    this.group.add(new THREE.Mesh(tube, makeCableMaterial()));
  }

  /** 0..1 - how much cable is left in the tank. */
  setCoilFraction(f: number): void {
    f = THREE.MathUtils.clamp(f, 0, 1);
    const total = this.coilMeshes.length;
    const visible = Math.max(1, Math.round(f * total));
    for (let i = 0; i < total; i++) {
      // Ring 0 pays out first (top layer outermost).
      this.coilMeshes[i].visible = i >= total - visible;
    }
  }

  setLaySpeed(v: number): void {
    this.laySpeed = v;
  }

  update(dt: number): void {
    if (this.laySpeed > 0.01) {
      const w = this.laySpeed * 1.9;
      for (const wheel of this.tensionWheels) wheel.rotation.z -= w * dt;
      this.sheave.rotation.z -= (this.laySpeed / 1.45) * dt;
    }
  }
}
