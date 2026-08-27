import * as THREE from 'three';
import type { Seabed } from './terrain';

// Shore stations + village life on each island. The terrain mesh itself forms
// the island; this module adds the cable landing station (with its status
// lamp - the honest signal that the link is alive), houses and trees.
class Station {
  readonly group = new THREE.Group();
  private lampMat: THREE.MeshStandardMaterial;
  private glow: THREE.Sprite;
  private windows: THREE.MeshStandardMaterial;
  private dish: THREE.Mesh;
  private on = false;
  private t = 0;

  constructor(anchor: THREE.Vector3, facing: number, seabed: Seabed) {
    // Place the station a little up the beach from the cable anchor.
    const sx = anchor.x + facing * -6;
    const sy = seabed.height(sx, anchor.z);
    this.group.position.set(sx, sy, anchor.z);
    this.group.rotation.y = facing > 0 ? 0 : Math.PI;

    const concrete = new THREE.MeshStandardMaterial({ color: 0xcfcbc2, roughness: 0.85 });
    const buildingGeo = new THREE.BoxGeometry(4.2, 2.6, 3.2);
    const building = new THREE.Mesh(buildingGeo, concrete);
    building.position.y = 1.3;
    this.group.add(building);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.25, 3.6),
      new THREE.MeshStandardMaterial({ color: 0x5a6068, roughness: 0.7 }));
    roof.position.y = 2.7;
    this.group.add(roof);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.6, 1.0),
      new THREE.MeshStandardMaterial({ color: 0x39424a, roughness: 0.6 }));
    door.position.set(2.12, 0.8, 0);
    this.group.add(door);

    // Cable conduit from the beach into the building.
    const conduit = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 5.4, 8),
      new THREE.MeshStandardMaterial({ color: 0x8a8f94, roughness: 0.6, metalness: 0.4 }));
    conduit.rotation.z = Math.PI / 2;
    conduit.position.set(3.6, 0.34, 0);
    this.group.add(conduit);

    // Status lamp on a mast - red until the link comes up, then green.
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 2.4, 8), concrete);
    mast.position.set(-1.6, 3.9, 1.2);
    this.group.add(mast);
    this.lampMat = new THREE.MeshStandardMaterial({
      color: 0x661414, emissive: 0xaa1111, emissiveIntensity: 0.9, roughness: 0.4
    });
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), this.lampMat);
    lamp.position.set(-1.6, 5.2, 1.2);
    this.group.add(lamp);
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: Station.glowTexture(), color: 0xff4444, transparent: true, opacity: 0.5,
      depthWrite: false, blending: THREE.AdditiveBlending
    }));
    this.glow.scale.setScalar(1.6);
    this.glow.position.copy(lamp.position);
    this.group.add(this.glow);

    // Satellite dish that the cable replaces - it tilts down once connected.
    this.dish = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2.6),
      new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.5, side: THREE.DoubleSide }));
    this.dish.position.set(-1.4, 3.2, -1.1);
    this.dish.rotation.x = -Math.PI / 3;
    this.group.add(this.dish);

    // Village: a few houses behind the station whose windows light up.
    this.windows = new THREE.MeshStandardMaterial({
      color: 0x223038, emissive: 0x000000, emissiveIntensity: 1, roughness: 0.3
    });
    const houseMat = new THREE.MeshStandardMaterial({ color: 0xd8cdb8, roughness: 0.85 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0xa5533a, roughness: 0.8 });
    for (let i = 0; i < 4; i++) {
      const hx = -5 - i * 2.6, hz = (i % 2 === 0 ? 1 : -1) * (2 + i);
      const hy = seabed.height(this.group.position.x + Math.cos(this.group.rotation.y) * hx,
        this.group.position.z + hz);
      const house = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.4, 1.6), houseMat);
      body.position.y = 0.7;
      house.add(body);
      const hroof = new THREE.Mesh(new THREE.ConeGeometry(1.5, 0.9, 4), roofMat);
      hroof.position.y = 1.85;
      hroof.rotation.y = Math.PI / 4;
      house.add(hroof);
      const win = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.4), this.windows);
      win.position.set(0.91, 0.75, 0);
      win.rotation.y = Math.PI / 2;
      house.add(win);
      house.position.set(hx, Math.max(0.2, hy - this.group.position.y), hz);
      this.group.add(house);
    }

    // Palm-ish trees.
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x7a5b3a, roughness: 0.9 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x3e7a35, roughness: 0.8 });
    for (let i = 0; i < 3; i++) {
      const tx = -4 - i * 3.4, tz = (i % 2 ? -1 : 1) * (4 + i * 1.5);
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 2.6, 6), trunkMat);
      trunk.position.set(tx, 1.4, tz);
      trunk.rotation.z = 0.12;
      this.group.add(trunk);
      const crown = new THREE.Mesh(new THREE.ConeGeometry(1.2, 1.4, 6), leafMat);
      crown.position.set(tx - 0.15, 3.0, tz);
      this.group.add(crown);
    }
  }

  private static glowTex: THREE.Texture | null = null;
  private static glowTexture(): THREE.Texture {
    if (Station.glowTex) return Station.glowTex;
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    Station.glowTex = new THREE.CanvasTexture(c);
    return Station.glowTex;
  }

  /** Link up: lamp goes green, windows warm up, dish stands down. */
  setConnected(v: boolean): void {
    this.on = v;
  }

  update(dt: number): void {
    this.t += dt;
    if (this.on) {
      this.lampMat.color.setHex(0x1a6620);
      this.lampMat.emissive.setHex(0x22cc44);
      (this.glow.material as THREE.SpriteMaterial).color.setHex(0x55ff77);
      const pulse = 0.55 + Math.sin(this.t * 3) * 0.15;
      (this.glow.material as THREE.SpriteMaterial).opacity = pulse;
      this.windows.emissive.setHex(0xffc873);
      this.windows.emissiveIntensity = Math.min(1.4, this.windows.emissiveIntensity + dt * 1.2);
      this.dish.rotation.x = Math.min(this.dish.rotation.x + dt * 0.3, -Math.PI / 6);
    } else {
      const pulse = 0.4 + Math.sin(this.t * 2) * 0.12;
      (this.glow.material as THREE.SpriteMaterial).opacity = pulse;
    }
  }
}

export class Islands {
  readonly group = new THREE.Group();
  readonly stationA: Station;
  readonly stationB: Station;

  constructor(seabed: Seabed) {
    this.stationA = new Station(seabed.anchorA, 1, seabed);
    this.stationB = new Station(seabed.anchorB, -1, seabed);
    this.group.add(this.stationA.group, this.stationB.group);
  }

  setConnected(v: boolean): void {
    this.stationA.setConnected(v);
    this.stationB.setConnected(v);
  }

  update(dt: number): void {
    this.stationA.update(dt);
    this.stationB.update(dt);
  }
}
