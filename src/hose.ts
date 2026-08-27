import * as THREE from 'three';
import { DynamicTube } from './tube';
import { makeCanvasTexture, clamp, lerp } from './util';

/**
 * The supply line (hydrant → pump inlet, static) and the attack hose
 * (pump discharge → nozzle, animated). The attack hose deploys during the
 * intro (paying out toward the truck, coupling mating onto the discharge
 * outlet), pressurizes (radius swell + slack pulled out), and afterwards
 * follows the crew's nozzle with a handful of spline control points — no
 * full softbody, just a low-cost spline tube.
 */

const SEGS = 56;

function hoseTexture(): THREE.CanvasTexture {
  // neutral base so the material color tints it (attack red-brown, supply yellow)
  return makeCanvasTexture(128, (ctx, s) => {
    ctx.fillStyle = '#b9b6b2';
    ctx.fillRect(0, 0, s, s);
    // woven jacket: fine diagonal criss-cross
    for (let i = -s; i < s * 2; i += 6) {
      ctx.strokeStyle = 'rgba(255,235,220,0.10)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + s, s); ctx.stroke();
      ctx.strokeStyle = 'rgba(30,10,5,0.14)';
      ctx.beginPath(); ctx.moveTo(i + 3, 0); ctx.lineTo(i + 3 - s, s); ctx.stroke();
    }
  }, { repeat: [10, 2] });
}

export class HoseRig {
  readonly group = new THREE.Group();
  /** attack hose end that mates with the pump outlet */
  readonly coupling: THREE.Group;
  /** 0..1 how much of the attack hose has been pulled off the truck */
  deployT = 0;
  /** 0..1 water pressure fill */
  pressureT = 0;

  private attackTube: DynamicTube;
  private curve = new THREE.CatmullRomCurve3([], false, 'catmullrom', 0.35);
  private pts: THREE.Vector3[] = [];
  private radii: number[] = [];
  private outlet: THREE.Vector3;
  private slackPath: THREE.Vector3[];
  private tautPath: THREE.Vector3[];
  private mixedPath: THREE.Vector3[];
  private nozzleAnchor = new THREE.Vector3();
  private backupHand = new THREE.Vector3();
  private dirty = true;

  constructor(outlet: THREE.Vector3, hydrant: THREE.Vector3, inlet: THREE.Vector3, crew: THREE.Vector3) {
    this.outlet = outlet.clone();
    const tex = hoseTexture();
    const hoseMat = new THREE.MeshStandardMaterial({ map: tex, color: 0xa4553f, roughness: 0.82, metalness: 0.05 });

    this.attackTube = new DynamicTube(SEGS, 9);
    const attackMesh = new THREE.Mesh(this.attackTube.geometry, hoseMat);
    attackMesh.castShadow = true;
    attackMesh.frustumCulled = false;
    this.group.add(attackMesh);

    // supply line: hydrant → pump inlet, laid with gentle sag, pre-connected
    const supplyMat = new THREE.MeshStandardMaterial({ color: 0xc7b24a, map: tex, roughness: 0.85 });
    const supplyCurve = new THREE.CatmullRomCurve3([
      hydrant.clone().add(new THREE.Vector3(0, 0.4, 0)),
      hydrant.clone().lerp(inlet, 0.3).setY(0.09),
      hydrant.clone().lerp(inlet, 0.7).setY(0.09),
      inlet.clone(),
    ]);
    const supply = new THREE.Mesh(new THREE.TubeGeometry(supplyCurve, 24, 0.075, 10), supplyMat);
    supply.castShadow = true;
    this.group.add(supply);

    // brass couplings on the supply ends
    const brass = new THREE.MeshStandardMaterial({ color: 0xb08d3f, metalness: 0.9, roughness: 0.35 });
    for (const [p, target] of [[hydrant.clone().add(new THREE.Vector3(0, 0.4, 0)), hydrant.clone().add(new THREE.Vector3(0, 0.4, 1))], [inlet, inlet.clone().add(new THREE.Vector3(0, 1, 0))]] as [THREE.Vector3, THREE.Vector3][]) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.14, 14), brass);
      c.position.copy(p);
      c.lookAt(target);
      c.rotateX(Math.PI / 2);
      this.group.add(c);
    }

    // animated attack-hose coupling (mates to the outlet in the intro)
    this.coupling = new THREE.Group();
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.16, 14), brass);
    barrel.rotation.x = Math.PI / 2;
    this.coupling.add(barrel);
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 14), brass);
    collar.rotation.x = Math.PI / 2;
    collar.position.z = 0.05;
    this.coupling.add(collar);
    // lugs
    for (let i = 0; i < 2; i++) {
      const lug = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.05), brass);
      lug.position.set(i === 0 ? 0.1 : -0.1, 0, 0.05);
      this.coupling.add(lug);
    }
    this.group.add(this.coupling);

    // attack hose path: outlet → flaked run on the ground → backup hand → nozzle
    const mix = (a: THREE.Vector3, b: THREE.Vector3, t: number, dx: number, y: number, dz: number) =>
      new THREE.Vector3(a.x + (b.x - a.x) * t + dx, y, a.z + (b.z - a.z) * t + dz);
    this.slackPath = [
      outlet.clone(),
      mix(outlet, crew, 0.12, 0.15, 0.1, -0.5),
      mix(outlet, crew, 0.35, 0.7, 0.07, -1.1),
      mix(outlet, crew, 0.62, -0.4, 0.07, -1.5),
      mix(outlet, crew, 0.88, -0.35, 0.07, -1.7),
      new THREE.Vector3(crew.x - 0.5, 0.1, crew.z - 1.15),
      new THREE.Vector3(crew.x - 0.4, 0.55, crew.z - 0.6), // backup firefighter's hands
      new THREE.Vector3(crew.x - 0.05, 0.9, crew.z - 0.1),
      new THREE.Vector3(crew.x + 0.12, 1.16, crew.z + 0.5), // nozzle anchor
    ];
    // pressurized: the slack bows get pulled out into gentler bends
    this.tautPath = this.slackPath.map((p) => p.clone());
    this.tautPath[1] = mix(outlet, crew, 0.15, 0.05, 0.11, -0.3);
    this.tautPath[2] = mix(outlet, crew, 0.38, 0.35, 0.09, -0.7);
    this.tautPath[3] = mix(outlet, crew, 0.64, -0.2, 0.09, -1.0);
    this.tautPath[4] = mix(outlet, crew, 0.88, -0.2, 0.09, -1.3);
    this.mixedPath = this.slackPath.map((p) => p.clone());

    for (let i = 0; i <= SEGS; i++) {
      this.pts.push(new THREE.Vector3());
      this.radii.push(0.05);
    }
    this.nozzleAnchor.copy(this.slackPath[this.slackPath.length - 1]);
    this.backupHand.copy(this.slackPath[6]);
  }

  /** last control point follows the nozzle butt */
  setNozzleAnchor(p: THREE.Vector3): void {
    if (this.nozzleAnchor.distanceToSquared(p) > 1e-6) {
      this.nozzleAnchor.copy(p);
      this.dirty = true;
    }
  }

  setDeploy(t: number): void {
    if (this.deployT !== t) { this.deployT = t; this.dirty = true; }
  }

  setPressure(t: number): void {
    if (this.pressureT !== t) { this.pressureT = t; this.dirty = true; }
  }

  update(time: number): void {
    // breathing of the pressurized hose (very subtle) forces periodic refresh
    const breathe = this.pressureT > 0.5 ? 1 + Math.sin(time * 7) * 0.012 : 1;
    if (!this.dirty && this.pressureT < 0.5) return;

    for (let i = 0; i < this.mixedPath.length; i++) {
      this.mixedPath[i].lerpVectors(this.slackPath[i], this.tautPath[i], this.pressureT);
    }
    this.mixedPath[this.mixedPath.length - 1].copy(this.nozzleAnchor);
    // penultimate point trails a bit under the nozzle for a natural bend
    this.mixedPath[this.mixedPath.length - 2].set(
      this.nozzleAnchor.x * 0.6, Math.max(0.5, this.nozzleAnchor.y - 0.35), this.nozzleAnchor.z - 0.55,
    );
    this.curve.points = this.mixedPath;

    // deployT grows the visible portion from the nozzle end toward the truck
    const u0 = (1 - this.deployT) * 0.999;
    for (let i = 0; i <= SEGS; i++) {
      const u = u0 + (1 - u0) * (i / SEGS);
      this.curve.getPointAt(clamp(u, 0, 1), this.pts[i]);
      const r = lerp(0.042, 0.062, this.pressureT) * breathe;
      this.radii[i] = r;
      // the spline may undershoot between ground control points
      this.pts[i].y = Math.max(this.pts[i].y, r + 0.005);
    }
    this.attackTube.update(this.pts, this.radii);

    // coupling rides the free end until it's mated to the outlet
    if (this.deployT < 1) {
      this.coupling.position.copy(this.pts[0]);
      this.coupling.lookAt(this.pts[2]);
    } else {
      this.coupling.position.copy(this.outlet);
      this.coupling.lookAt(this.pts[3]);
    }
    this.dirty = false;
  }
}
