import * as THREE from 'three';
import { CAKE_RADIUS, CAKE_TOP } from '../scene/CakeSurfaceContact';
import type { CakeSurfaceContact } from '../scene/CakeSurfaceContact';
import { clamp, smoothstep } from '../util/math';

function softDisc(): THREE.Texture {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, 'rgba(255,250,238,1)');
  grd.addColorStop(0.45, 'rgba(255,248,232,0.45)');
  grd.addColorStop(1, 'rgba(255,246,228,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * No arrows, no hand icons, no blinking. When the child hesitates the world
 * itself nudges: a bead of cream swells at the tip, the bag is pressed a
 * little, daylight finds an empty part of the cake, and a finished star settles
 * and springs back.
 */
export class Hints {
  readonly group = new THREE.Group();
  private patch: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private bead: THREE.Mesh<THREE.SphereGeometry, THREE.MeshPhysicalMaterial>;
  private idle = 0;
  private cycle = 0;
  private patchX = 0;
  private patchZ = 0;

  /** 0..1 — how hard the invisible hand should squeeze as a hint */
  bagPulse = 0;
  /** 0..1 — vertical squash applied to the newest decoration */
  settlePulse = 0;

  constructor(private contact: CakeSurfaceContact) {
    const tex = softDisc();
    this.patch = new THREE.Mesh(
      new THREE.PlaneGeometry(0.05, 0.05),
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 0,
        toneMapped: true,
      }),
    );
    this.patch.rotation.x = -Math.PI / 2;
    this.patch.renderOrder = 2;
    this.group.add(this.patch);

    this.bead = new THREE.Mesh(
      new THREE.SphereGeometry(0.0042, 14, 10),
      new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(0.965, 0.945, 0.912),
        roughness: 0.5,
        metalness: 0,
        sheen: 0.5,
        sheenRoughness: 0.85,
      }),
    );
    this.bead.scale.setScalar(0.001);
    this.bead.visible = false;
    this.group.add(this.bead);
  }

  notifyActivity(): void {
    this.idle = 0;
    this.cycle = 0;
  }

  private pickEmptySpot(): void {
    let bestX = 0;
    let bestZ = 0;
    let best = Infinity;
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 * 3.1;
      const r = CAKE_RADIUS * (0.18 + 0.62 * ((i * 7) % 11) / 11);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const occ = this.contact.creamHeight(x, z);
      if (occ < best) {
        best = occ;
        bestX = x;
        bestZ = z;
      }
    }
    this.patchX = bestX;
    this.patchZ = bestZ;
  }

  update(dt: number, piping: boolean, tip: THREE.Vector3, axis: THREE.Vector3): void {
    if (piping) {
      this.idle = 0;
      this.cycle = 0;
    } else {
      this.idle += dt;
    }

    const armed = this.idle > 5.0;
    if (armed) {
      this.cycle += dt;
      if (this.cycle > 7.5) {
        this.cycle = 0;
        this.pickEmptySpot();
      }
    }

    // 1) a bead of cream gathers at the opening
    const beadT = armed ? smoothstep(0.2, 1.1, this.cycle) * (1 - smoothstep(1.9, 3.0, this.cycle)) : 0;
    this.bead.visible = beadT > 0.01;
    if (this.bead.visible) {
      const s = 0.35 + 0.65 * beadT;
      this.bead.scale.set(s, s * 0.82, s);
      this.bead.position.copy(tip).addScaledVector(axis, -0.0018 + 0.0012 * beadT);
    }

    // 2) the bag is pressed, just enough to see
    this.bagPulse = armed ? beadT * 0.28 : 0;

    // 3) daylight finds a free part of the top
    const lightT = armed
      ? smoothstep(2.6, 3.8, this.cycle) * (1 - smoothstep(5.4, 6.8, this.cycle))
      : 0;
    this.patch.material.opacity = lightT * 0.17;
    this.patch.visible = lightT > 0.01;
    if (this.patch.visible) {
      this.patch.position.set(this.patchX, CAKE_TOP + 0.0016, this.patchZ);
      const s = 1 + 0.12 * Math.sin(this.cycle * 1.6);
      this.patch.scale.set(s, s, 1);
    }

    // 4) something already piped settles and springs back
    this.settlePulse = armed
      ? clamp(Math.sin(clamp((this.cycle - 4.6) / 1.5, 0, 1) * Math.PI), 0, 1) * 0.045
      : 0;
  }
}
