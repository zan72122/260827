// Three small gifts waiting by the open sack. Tapping one sends it arcing
// into the stocking; the shape (box / ball / candy cane) drives the bulge.
import * as THREE from 'three';
import { easeIn, easeOut } from './util';

export type GiftKind = 'box' | 'ball' | 'cane';

export interface Gift {
  kind: GiftKind;
  group: THREE.Group;
  hit: THREE.Mesh;      // oversized invisible tap target
  home: THREE.Vector3;
  state: 'idle' | 'flying' | 'done';
  flyT: number;
  from: THREE.Vector3;
  bob: number;
}

export function buildGifts(seed: number): Gift[] {
  const gifts: Gift[] = [];

  const mkHit = (r: number) => new THREE.Mesh(
    new THREE.SphereGeometry(r, 8, 6),
    new THREE.MeshBasicMaterial({ visible: false })
  );

  // wrapped box
  {
    const g = new THREE.Group();
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.13, 0.14),
      new THREE.MeshStandardMaterial({ color: 0x3a72b0, roughness: 0.55 })
    );
    box.castShadow = true;
    g.add(box);
    const ribMat = new THREE.MeshStandardMaterial({ color: 0xd8c25a, roughness: 0.45 });
    const rib1 = new THREE.Mesh(new THREE.BoxGeometry(0.165, 0.135, 0.03), ribMat);
    g.add(rib1);
    const rib2 = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.135, 0.145), ribMat);
    g.add(rib2);
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), ribMat);
    knot.position.y = 0.075;
    g.add(knot);
    const hit = mkHit(0.24);
    g.add(hit);
    gifts.push({ kind: 'box', group: g, hit, home: new THREE.Vector3(), state: 'idle', flyT: 0, from: new THREE.Vector3(), bob: 0 });
  }

  // ball
  {
    const g = new THREE.Group();
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.085, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0xc04848, roughness: 0.35 })
    );
    ball.castShadow = true;
    g.add(ball);
    const stripe = new THREE.Mesh(
      new THREE.TorusGeometry(0.085, 0.012, 8, 20),
      new THREE.MeshStandardMaterial({ color: 0xe8e0d0, roughness: 0.4 })
    );
    stripe.rotation.x = Math.PI / 2.4;
    g.add(stripe);
    const hit = mkHit(0.22);
    g.add(hit);
    gifts.push({ kind: 'ball', group: g, hit, home: new THREE.Vector3(), state: 'idle', flyT: 0, from: new THREE.Vector3(), bob: 1.3 });
  }

  // candy cane
  {
    const g = new THREE.Group();
    const caneMat = new THREE.MeshStandardMaterial({ color: 0xe8e2da, roughness: 0.45 });
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.2, 10), caneMat);
    stick.castShadow = true;
    g.add(stick);
    const hook = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.02, 8, 14, Math.PI), caneMat);
    hook.position.y = 0.1;
    g.add(hook);
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0xb02828, roughness: 0.45 });
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Mesh(new THREE.TorusGeometry(0.021, 0.008, 6, 10), stripeMat);
      s.rotation.x = Math.PI / 2;
      s.position.y = -0.08 + i * 0.05;
      g.add(s);
    }
    const hit = mkHit(0.22);
    g.add(hit);
    gifts.push({ kind: 'cane', group: g, hit, home: new THREE.Vector3(), state: 'idle', flyT: 0, from: new THREE.Vector3(), bob: 2.6 });
  }

  return gifts;
}

// Arc a gift from its home to the stocking mouth; returns true when it lands.
export function updateGiftFlight(gift: Gift, dt: number, target: THREE.Vector3): boolean {
  if (gift.state !== 'flying') return false;
  gift.flyT += dt / 0.75;
  const t = Math.min(1, gift.flyT);
  const p = gift.group.position;
  p.x = gift.from.x + (target.x - gift.from.x) * t;
  p.z = gift.from.z + (target.z - gift.from.z) * t;
  const lift = Math.sin(t * Math.PI) * 0.5;
  p.y = gift.from.y + (target.y - gift.from.y) * easeIn(t) + lift;
  gift.group.rotation.x += dt * 6;
  gift.group.rotation.z += dt * 3;
  const shrink = t > 0.75 ? 1 - easeOut((t - 0.75) / 0.25) * 0.9 : 1;
  gift.group.scale.setScalar(shrink);
  if (t >= 1) {
    gift.state = 'done';
    gift.group.visible = false;
    return true;
  }
  return false;
}
