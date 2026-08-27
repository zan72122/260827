// The far shore: a small remote harbour (pier, sheds, jib crane, fuel tank),
// a rocky islet mid-field, and a seal hauled out on a floe. These landmarks
// give the child the whole story without words: ship here -> harbour there.

import * as THREE from 'three';
import { PORT_DOCK, WATER_Y, mulberry32, clamp, lerp } from './const';

function snowRockColors(geo: THREE.BufferGeometry, snowLine = 0.55): void {
  geo.computeVertexNormals();
  const pos = geo.getAttribute('position');
  const nrm = geo.getAttribute('normal');
  const colors = new Float32Array(pos.count * 3);
  const rock = new THREE.Color('#6b6459');
  const rock2 = new THREE.Color('#514c45');
  const snow = new THREE.Color('#eef1f4');
  const c = new THREE.Color();
  const rng = mulberry32(5);
  for (let i = 0; i < pos.count; i++) {
    const up = nrm.getY(i);
    c.copy(rock).lerp(rock2, rng() * 0.7);
    if (up > snowLine) c.lerp(snow, (up - snowLine) / (1 - snowLine) * 0.95);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

function makeRock(radius: number, flatten: number, seed: number): THREE.Mesh {
  const geo = new THREE.IcosahedronGeometry(radius, 2);
  const pos = geo.getAttribute('position');
  const rng = mulberry32(seed);
  const bump = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(2)},${pos.getY(i).toFixed(2)},${pos.getZ(i).toFixed(2)}`;
    if (!bump.has(key)) bump.set(key, 0.72 + rng() * 0.5);
    const s = bump.get(key)!;
    pos.setXYZ(i, pos.getX(i) * s, pos.getY(i) * s * flatten, pos.getZ(i) * s);
  }
  snowRockColors(geo);
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.95, flatShading: true,
    emissive: '#2a3138', emissiveIntensity: 0.55, // lift the shadowed facets in flat arctic light
  });
  return new THREE.Mesh(geo, mat);
}

function gabledShed(w: number, h: number, d: number, wall: string): THREE.Group {
  const g = new THREE.Group();
  const wallMat = new THREE.MeshStandardMaterial({ color: wall, roughness: 0.85 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
  body.position.y = h / 2;
  g.add(body);
  const roofGeo = new THREE.CylinderGeometry(w * 0.62, w * 0.62, d, 3, 1);
  const roof = new THREE.Mesh(roofGeo, new THREE.MeshStandardMaterial({ color: '#e8ecef', roughness: 0.95 }));
  roof.rotation.x = Math.PI / 2;
  roof.rotation.y = Math.PI / 2;
  roof.scale.y = 1.0;
  roof.scale.x = 0.55;
  roof.position.y = h + w * 0.16;
  g.add(roof);
  // one warm window — the "someone is waiting" light
  const win = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.7),
    new THREE.MeshBasicMaterial({ color: '#ffcf7e' }));
  win.position.set(0, h * 0.55, d / 2 + 0.02);
  g.add(win);
  return g;
}

export class Port {
  group = new THREE.Group();
  private craneCol: THREE.Group;
  private jib: THREE.Group;
  private hook: THREE.Mesh;
  private cable: THREE.Mesh;
  private cargo: THREE.Mesh;
  private seal: THREE.Group;
  private smoke: THREE.Sprite[] = [];
  private unloadT = -1;
  unloadDone = false;
  private shipDeckPos = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    const g = this.group;

    // --- shoreline behind the harbour ---------------------------------------
    const shore = new THREE.Group();
    const rng = mulberry32(21);
    for (let i = 0; i < 9; i++) {
      const r = 18 + rng() * 30;
      const rock = makeRock(r, 0.22 + rng() * 0.14, 100 + i);
      const x = -160 + i * 42 + (rng() - 0.5) * 26;
      // keep the water north of the harbour clear — the icebreaker's wide
      // swing to its holding spot passes through there
      const z = x > -140 && x < 85 ? 298 + rng() * 22 : 264 + rng() * 36;
      rock.position.set(x, -2.5, z);
      shore.add(rock);
    }
    // a couple of far hills for depth
    for (let i = 0; i < 4; i++) {
      const hill = makeRock(60 + rng() * 40, 0.16, 200 + i);
      hill.position.set(-220 + i * 150, -6, 380 + rng() * 60);
      shore.add(hill);
    }
    g.add(shore);

    // --- pier ----------------------------------------------------------------
    const dock = new THREE.Group();
    const concrete = new THREE.MeshStandardMaterial({ color: '#8b8d8c', roughness: 0.9 });
    const concreteTop = new THREE.MeshStandardMaterial({ color: '#b9bfc2', roughness: 0.95 });
    const pier = new THREE.Mesh(new THREE.BoxGeometry(12, 3.2, 34), concrete);
    pier.position.set(PORT_DOCK.x + 10.5, 0.4, PORT_DOCK.z + 8);
    dock.add(pier);
    const pierTop = new THREE.Mesh(new THREE.BoxGeometry(12.3, 0.3, 34.3), concreteTop);
    pierTop.position.set(PORT_DOCK.x + 10.5, 2.1, PORT_DOCK.z + 8);
    dock.add(pierTop);
    // wooden fender piles on the berth face
    const wood = new THREE.MeshStandardMaterial({ color: '#4e3f31', roughness: 0.95 });
    for (let i = 0; i < 6; i++) {
      const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 4.2, 8), wood);
      pile.position.set(PORT_DOCK.x + 4.2, 0.4, PORT_DOCK.z - 6 + i * 5.6);
      dock.add(pile);
    }
    g.add(dock);

    // --- low gravel shore pad the buildings stand on ------------------------
    const pad = new THREE.Mesh(new THREE.BoxGeometry(52, 2.8, 34),
      new THREE.MeshStandardMaterial({ color: '#7b7468', roughness: 0.95 }));
    pad.position.set(PORT_DOCK.x + 15, 0.2, PORT_DOCK.z + 28);
    const padSnow = new THREE.Mesh(new THREE.BoxGeometry(52.4, 0.3, 34.4),
      new THREE.MeshStandardMaterial({ color: '#e9edf0', roughness: 0.95 }));
    padSnow.position.set(PORT_DOCK.x + 15, 1.68, PORT_DOCK.z + 28);
    g.add(pad, padSnow);

    // --- sheds + tank on the shore end --------------------------------------
    const shedA = gabledShed(6, 3.4, 8, '#7a3b30');
    shedA.position.set(PORT_DOCK.x + 18, 1.85, PORT_DOCK.z + 26);
    shedA.rotation.y = -0.25;
    const shedB = gabledShed(4.5, 2.8, 6, '#5d6468');
    shedB.position.set(PORT_DOCK.x + 4, 1.85, PORT_DOCK.z + 30);
    shedB.rotation.y = 0.35;
    g.add(shedA, shedB);
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 4, 16),
      new THREE.MeshStandardMaterial({ color: '#98a0a4', roughness: 0.8 }));
    tank.position.set(PORT_DOCK.x + 28, 3.8, PORT_DOCK.z + 24);
    g.add(tank);
    // light pole with a warm lamp, on the pier by the berth
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 7, 8),
      new THREE.MeshStandardMaterial({ color: '#3d4144', roughness: 0.7 }));
    pole.position.set(PORT_DOCK.x + 7, 5.6, PORT_DOCK.z + 8);
    g.add(pole);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8),
      new THREE.MeshBasicMaterial({ color: '#ffd9a0' }));
    lamp.position.set(PORT_DOCK.x + 7, 9.0, PORT_DOCK.z + 8);
    g.add(lamp);
    const glowTex = Port.makeSmokeTexture();
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: '#ffca7a', transparent: true, opacity: 0.45,
      depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    }));
    glow.position.copy(lamp.position);
    glow.scale.setScalar(10);
    g.add(glow);

    // --- little jib crane on the pier ---------------------------------------
    const craneMat = new THREE.MeshStandardMaterial({ color: '#a86a2a', roughness: 0.75 });
    this.craneCol = new THREE.Group();
    const colMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 7, 10), craneMat);
    colMesh.position.y = 3.5;
    this.craneCol.add(colMesh);
    this.jib = new THREE.Group();
    const jibArm = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 9), craneMat);
    jibArm.position.set(0, 0, -4.2);
    this.jib.add(jibArm);
    this.jib.position.y = 6.6;
    this.jib.rotation.x = 0.28; // slight uptilt
    this.craneCol.add(this.jib);
    this.craneCol.position.set(PORT_DOCK.x + 8.5, 2.2, PORT_DOCK.z + 1);
    this.craneCol.rotation.y = Math.PI * 0.9;
    g.add(this.craneCol);

    const cableMat = new THREE.MeshBasicMaterial({ color: '#22201e' });
    this.cable = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1, 6), cableMat);
    this.hook = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4),
      new THREE.MeshStandardMaterial({ color: '#2b2b2b', roughness: 0.6 }));
    this.cargo = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.7, 3.0),
      new THREE.MeshStandardMaterial({ color: '#7a6a4a', roughness: 0.85 }));
    this.cargo.visible = false;
    g.add(this.cable, this.hook, this.cargo);

    // --- islet + seal floe (the obstacles the route bends around) -----------
    const islet = makeRock(17, 0.34, 55);
    islet.position.set(-62, -1.5, 26);
    g.add(islet);
    const islet2 = makeRock(7, 0.4, 56);
    islet2.position.set(-46, -1.2, 38);
    g.add(islet2);

    this.seal = new THREE.Group();
    const sealMat = new THREE.MeshStandardMaterial({ color: '#6b6058', roughness: 0.9 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.55, 1.5, 6, 10), sealMat);
    body.rotation.z = Math.PI / 2;
    body.rotation.y = 0.4;
    body.scale.set(1, 0.8, 1);
    body.position.y = 0.5;
    this.seal.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.38, 10, 8), sealMat);
    head.position.set(1.15, 0.85, 0.45);
    this.seal.add(head);
    const pancake = new THREE.Mesh(new THREE.CylinderGeometry(6.5, 7.2, 1.2, 18),
      new THREE.MeshStandardMaterial({ color: '#e6ebee', roughness: 0.95, flatShading: true }));
    pancake.position.y = 0.15;
    this.seal.add(pancake);
    this.seal.position.set(55, -0.25, -62);
    g.add(this.seal);

    // chimney smoke sprites over shed A
    const smokeTex = Port.makeSmokeTexture();
    for (let i = 0; i < 3; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: smokeTex, color: '#dfe3e6', transparent: true, opacity: 0.3, depthWrite: false,
      }));
      sp.position.set(PORT_DOCK.x + 20, 6 + i * 1.8, PORT_DOCK.z + 24);
      sp.scale.setScalar(1.8 + i * 1.0);
      this.smoke.push(sp);
      g.add(sp);
    }

    scene.add(g);
  }

  private static makeSmokeTexture(): THREE.Texture {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d')!;
    const grd = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    grd.addColorStop(0, 'rgba(255,255,255,0.9)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    return t;
  }

  /** Begin the little unload sequence once the supply ship is berthed. */
  startUnload(shipDeck: THREE.Vector3): void {
    this.unloadT = 0;
    this.unloadDone = false;
    this.shipDeckPos.copy(shipDeck);
    this.cargo.visible = false;
  }

  /** debug: hide groups of port effects to isolate render artifacts */
  debugHide(what: string): void {
    if (what === 'smoke') this.smoke.forEach((s) => (s.visible = false));
    if (what === 'glow') this.group.children.forEach((c) => { if ((c as THREE.Sprite).isSprite && !this.smoke.includes(c as THREE.Sprite)) c.visible = false; });
    if (what === 'cable') { this.cable.visible = false; this.hook.visible = false; }
    if (what === 'crane') this.craneCol.visible = false;
  }

  update(dt: number, time: number): void {
    // idle seal: lifts its head now and then
    const head = this.seal.children[1];
    head.position.y = 0.85 + Math.max(0, Math.sin(time * 0.7)) * 0.25;

    for (let i = 0; i < this.smoke.length; i++) {
      const sp = this.smoke[i];
      sp.position.y += dt * 0.7;
      sp.material.opacity = 0.32 - (sp.position.y - 6) * 0.04;
      if (sp.position.y > 13) sp.position.y = 6;
    }

    if (this.unloadT < 0) {
      // crane rests over the pier; keep cable/hook tucked at the jib tip
      this.placeHookAt(this.jibTip(), 0.8, false);
      return;
    }
    this.unloadT += dt;
    const t = this.unloadT;
    const colPos = new THREE.Vector3();
    this.craneCol.getWorldPosition(colPos);
    const toShip = Math.atan2(this.shipDeckPos.x - colPos.x, this.shipDeckPos.z - colPos.z) + Math.PI;
    const restYaw = Math.PI * 0.9;
    const dockDrop = new THREE.Vector3(PORT_DOCK.x + 10.5, 2.3, PORT_DOCK.z + 4);

    // timeline: swing 0-2.5s, lower 2.5-4.5, hoist 4.5-6.5, swing back 6.5-9, lower 9-10.5, done
    if (t < 2.5) {
      this.craneCol.rotation.y = lerp(restYaw, toShip, this.ease(t / 2.5));
      this.placeHookAt(this.jibTip(), 1.2, false);
    } else if (t < 4.5) {
      const k = this.ease((t - 2.5) / 2);
      const tip = this.jibTip();
      const drop = lerp(1.2, tip.y - (this.shipDeckPos.y + 1.2), k);
      this.placeHookAt(tip, drop, false);
    } else if (t < 6.5) {
      if (!this.cargo.visible) this.cargo.visible = true;
      const k = this.ease((t - 4.5) / 2);
      const tip = this.jibTip();
      const drop = lerp(tip.y - (this.shipDeckPos.y + 1.2), 1.6, k);
      this.placeHookAt(tip, drop, true);
    } else if (t < 9) {
      this.craneCol.rotation.y = lerp(toShip, restYaw - 0.35, this.ease((t - 6.5) / 2.5));
      this.placeHookAt(this.jibTip(), 1.6, true);
    } else if (t < 10.5) {
      const k = this.ease((t - 9) / 1.5);
      const tip = this.jibTip();
      const drop = lerp(1.6, tip.y - dockDrop.y - 0.85, k);
      this.placeHookAt(tip, drop, true);
    } else {
      // set the crate down on the pier
      const tip = this.jibTip();
      this.cargo.position.set(tip.x, dockDrop.y + 0.85, tip.z);
      this.placeHookAt(tip, 1.0, false);
      this.unloadDone = true;
    }
  }

  private ease(k: number): number {
    k = clamp(k, 0, 1);
    return k * k * (3 - 2 * k);
  }

  private jibTip(): THREE.Vector3 {
    const v = new THREE.Vector3(0, 0, -8.2);
    this.jib.localToWorld(v);
    return v;
  }

  private placeHookAt(tip: THREE.Vector3, drop: number, withCargo: boolean): void {
    this.cable.position.set(tip.x, tip.y - drop / 2, tip.z);
    this.cable.scale.y = Math.max(0.1, drop);
    this.hook.position.set(tip.x, tip.y - drop, tip.z);
    if (withCargo) {
      this.cargo.visible = true;
      this.cargo.position.set(tip.x, tip.y - drop - 1.1, tip.z);
    }
  }

  reset(): void {
    this.unloadT = -1;
    this.unloadDone = false;
    this.cargo.visible = false;
    this.craneCol.rotation.y = Math.PI * 0.9;
  }
}
