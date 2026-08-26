// A small skater who waits at the far end and finally glides along the
// freshly resurfaced band the child made.

import * as THREE from 'three';
import { makeBlobShadow } from './vehicle.js';

export class Skater {
  constructor() {
    const g = new THREE.Group();
    this.group = g;
    this.mode = 'wait';
    this.waveT = 0;
    this.skateS = 0;
    this.path = null;
    this.x = 3; this.z = -14; this.heading = 0.6;

    const jacket = new THREE.MeshStandardMaterial({ color: 0xd45a5a, roughness: 0.85 });
    const pants = new THREE.MeshStandardMaterial({ color: 0x3d5a80, roughness: 0.9 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xe8c39e, roughness: 0.7 });
    const hat = new THREE.MeshStandardMaterial({ color: 0xe0b64a, roughness: 0.9 });

    this.body = new THREE.Group();
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.26, 4, 10), jacket);
    torso.position.y = 0.62;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 12, 10), skin);
    head.position.y = 0.94;
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8, 0, Math.PI * 2, 0, 1.5), hat);
    cap.position.y = 0.97;
    const pom = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshStandardMaterial({ color: 0xf3ede0 }));
    pom.position.y = 1.09;
    const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.035, 8, 14), hat);
    scarf.rotation.x = Math.PI / 2;
    scarf.position.y = 0.82;
    this.body.add(torso, head, cap, pom, scarf);

    this.armL = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.26, 3, 8), jacket);
    this.armL.position.set(-0.19, 0.66, 0);
    this.armR = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.26, 3, 8), jacket);
    this.armR.position.set(0.19, 0.66, 0);
    this.body.add(this.armL, this.armR);

    this.legL = new THREE.Group();
    this.legR = new THREE.Group();
    for (const [legGroup, sx] of [[this.legL, -1], [this.legR, 1]]) {
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.3, 3, 8), pants);
      leg.position.y = -0.18;
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.2), new THREE.MeshStandardMaterial({ color: 0xf3ede0, roughness: 0.7 }));
      boot.position.set(0, -0.36, 0.03);
      const runner = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.035, 0.24), new THREE.MeshStandardMaterial({ color: 0xb9c0c6, metalness: 0.9, roughness: 0.25 }));
      runner.position.set(0, -0.42, 0.03);
      legGroup.add(leg, boot, runner);
      legGroup.position.set(sx * 0.08, 0.44, 0);
      this.body.add(legGroup);
    }

    g.add(this.body);
    const shadow = makeBlobShadow(0.7, 0.9);
    shadow.position.y = 0.015;
    g.add(shadow);
    this.sync();
  }

  setWaiting(x, z, heading) {
    this.x = x; this.z = z; this.heading = heading;
    this.mode = 'wait';
    this.sync();
  }

  startSkating(path) {
    // skate the band from its end (near the skater) back along it
    this.path = path;
    this.skateS = 0;
    this.mode = 'skate';
    const p = path.pointAt(path.total);
    this.x = p.x; this.z = p.z;
  }

  update(dt, t) {
    if (this.mode === 'wait') {
      this.body.position.y = Math.sin(t * 2.2) * 0.02;
      this.waveT += dt;
      // waves now and then
      const cyc = this.waveT % 4;
      if (cyc < 1.2) {
        this.armR.rotation.z = -2.4 + Math.sin(cyc * 12) * 0.35;
        this.armR.position.set(0.24, 0.78, 0);
      } else {
        this.armR.rotation.z = 0;
        this.armR.position.set(0.19, 0.66, 0);
      }
      this.armL.rotation.z = 0.15;
      this.legL.rotation.x = 0; this.legR.rotation.x = 0;
      this.body.rotation.z = 0;
    } else if (this.mode === 'skate' && this.path) {
      const speed = 3.6;
      this.skateS = Math.min(this.path.total, this.skateS + speed * dt);
      const s = this.path.total - this.skateS;      // reversed
      const p = this.path.pointAt(s);
      const p2 = this.path.pointAt(Math.max(0, s - 0.6));
      // gentle carve within the band
      const dirx = p2.x - p.x, dirz = p2.z - p.z;
      const dl = Math.hypot(dirx, dirz) || 1;
      const nx = -dirz / dl, nz = dirx / dl;
      const sway = Math.sin(this.skateS * 1.9) * 0.35;
      this.x = p.x + nx * sway;
      this.z = p.z + nz * sway;
      this.heading = Math.atan2(p2.x - p.x, p2.z - p.z);
      const push = Math.sin(this.skateS * 1.9);
      this.body.rotation.z = push * 0.16;
      this.legL.rotation.x = Math.max(0, push) * 0.7;
      this.legR.rotation.x = Math.max(0, -push) * 0.7;
      this.armL.rotation.z = 0.5 + push * 0.3;
      this.armR.rotation.z = -0.5 + push * 0.3;
      this.armL.rotation.x = push * 0.4;
      this.armR.rotation.x = -push * 0.4;
      this.body.position.y = Math.abs(Math.cos(this.skateS * 1.9)) * 0.03;
      if (this.skateS >= this.path.total) {
        this.mode = 'finish';
        this.finishT = 0;
      }
    } else if (this.mode === 'finish') {
      this.finishT = (this.finishT ?? 0) + dt;
      // little happy spin with arms up
      this.armL.rotation.set(0, 0, 2.6);
      this.armR.rotation.set(0, 0, -2.6);
      this.heading += dt * 2.2 * Math.max(0, 1 - this.finishT * 0.7);
      this.body.position.y = Math.abs(Math.sin(this.finishT * 6)) * 0.05 * Math.max(0, 1.5 - this.finishT);
      this.legL.rotation.x = 0; this.legR.rotation.x = 0;
      this.body.rotation.z = 0;
    }
    this.sync();
  }

  sync() {
    this.group.position.set(this.x, 0, this.z);
    this.group.rotation.y = this.heading;
  }

  get donePlaying() { return this.mode === 'finish' && (this.finishT ?? 0) > 2.2; }
}
