// "Frost Runner" — a fictional battery-electric ice resurfacer.
// No real manufacturer's name, silhouette, livery or logo is used.
// Functionally plausible layout:
//   driver seat amidships, water tanks in the rear body module (with filler
//   + level gauge), snow tank up front (dump lid), rear conditioner carrying
//   the shaving blade + horizontal auger + wash-water bar + ice-making water
//   pipe + towel, an external vertical auger chute to the snow tank, and
//   studded ice tires. Battery bay hatch instead of an engine / exhaust.
// Rear-axle bicycle model with realistic wheelbase, steering limits and
// speed shaping — the vehicle chases a steering target on the child's path,
// it is never snapped onto it.

import * as THREE from 'three';
import { VEHICLE_SPEC } from './path.js';

const S = VEHICLE_SPEC;

function smudgeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 128);
  for (let i = 0; i < 14; i++) {
    const x = 30 + Math.random() * 68, y = 30 + Math.random() * 68, r = 12 + Math.random() * 34;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(38,32,26,0.28)');
    gr.addColorStop(1, 'rgba(38,32,26,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
  }
  // drips
  g.fillStyle = 'rgba(40,34,26,0.22)';
  for (let i = 0; i < 6; i++) {
    const x = 20 + Math.random() * 88;
    g.fillRect(x, 40 + Math.random() * 20, 2 + Math.random() * 2, 20 + Math.random() * 40);
  }
  const t = new THREE.CanvasTexture(c);
  return t;
}

function tireTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#232527'; g.fillRect(0, 0, 128, 64);
  g.fillStyle = '#3a3d40';
  for (let x = 0; x < 128; x += 10) {
    for (let y = 6; y < 64; y += 14) {
      g.beginPath();
      g.arc(x + ((y / 14) % 2) * 5, y, 2.2, 0, 7);
      g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 1);
  return t;
}

function blobShadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 8, 64, 64, 62);
  gr.addColorStop(0, 'rgba(8,12,16,0.42)');
  gr.addColorStop(0.7, 'rgba(8,12,16,0.22)');
  gr.addColorStop(1, 'rgba(8,12,16,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

export function makeBlobShadow(w, l) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, l),
    new THREE.MeshBasicMaterial({
      map: blobShadowTexture(), transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2
    })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.015;
  m.renderOrder = 1;
  return m;
}

export class Resurfacer {
  constructor() {
    this.x = 0; this.z = 12.5;
    this.heading = Math.PI;           // facing -z (toward the far end)
    this.speed = 0;
    this.steer = 0;
    this.progress = 0;
    this.path = null;
    this.driving = false;
    this.conditionerT = 0;            // 0 raised, 1 down
    this._condTarget = 0;
    this.snowFill = 0;
    this.lidT = 0;
    this._lidTarget = 0;
    this.stuckTimer = 0;
    this.workIntensity = 0;           // drives sounds/particles

    this._build();
    this.syncTransforms();
  }

  _build() {
    const g = new THREE.Group();
    this.group = g;

    const paint = new THREE.MeshStandardMaterial({ color: 0x4fae9b, roughness: 0.45, metalness: 0.15 });
    const paintDark = new THREE.MeshStandardMaterial({ color: 0x37796d, roughness: 0.5, metalness: 0.15 });
    const cream = new THREE.MeshStandardMaterial({ color: 0xefe9d8, roughness: 0.55 });
    const charcoal = new THREE.MeshStandardMaterial({ color: 0x2e3338, roughness: 0.7, metalness: 0.3 });
    const steel = new THREE.MeshStandardMaterial({ color: 0xc9ced3, roughness: 0.32, metalness: 0.85 });
    const steelDark = new THREE.MeshStandardMaterial({ color: 0x8f969c, roughness: 0.45, metalness: 0.8 });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x1f2224, roughness: 0.9 });
    const smudge = smudgeTexture();

    const addSmudge = (w, h, x, y, z, ry = 0, rx = 0) => {
      const d = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshStandardMaterial({
          map: smudge, transparent: true, depthWrite: false, roughness: 0.9,
          polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
        })
      );
      d.position.set(x, y, z);
      d.rotation.y = ry; d.rotation.x = rx;
      d.renderOrder = 2;
      g.add(d);
      return d;
    };

    // ---- chassis frame + battery bay (electric: no exhaust anywhere)
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.22, 4.1), charcoal);
    frame.position.set(0, 0.36, 1.25);
    g.add(frame);
    const battery = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.3, 1.6), charcoal);
    battery.position.set(0, 0.32, 0.9);
    g.add(battery);

    // ---- rear body module: water tanks inside, shown by filler / gauge / hatches
    const rearBody = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.95, 1.7), paint);
    rearBody.position.set(0, 0.95, -0.05);
    g.add(rearBody);
    const rearTop = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.1, 1.7), paintDark);
    rearTop.position.set(0, 1.47, -0.05);
    g.add(rearTop);
    // water filler neck + cap (ice-making water tank)
    const filler = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.14, 14), steelDark);
    filler.position.set(-0.6, 1.58, -0.45);
    g.add(filler);
    const fillerCap = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.05, 14), steel);
    fillerCap.position.set(-0.6, 1.66, -0.45);
    g.add(fillerCap);
    addSmudge(0.5, 0.4, -0.6, 1.53, -0.44, 0, -Math.PI / 2); // spill stains around filler
    // second filler: wash-water tank
    const filler2 = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.12, 12), steelDark);
    filler2.position.set(0.55, 1.57, -0.45);
    g.add(filler2);
    // sight gauge tube on rear face
    const gauge = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 0.7, 10),
      new THREE.MeshStandardMaterial({ color: 0xbfd8e2, roughness: 0.2, metalness: 0.1 })
    );
    gauge.position.set(0.75, 1.0, -0.92);
    g.add(gauge);
    // battery access hatch (side) + charge port (rear)
    const hatch = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.5, 0.8), paintDark);
    hatch.position.set(-1.01, 0.85, 0.05);
    g.add(hatch);
    addSmudge(0.9, 0.6, -1.03, 0.7, 0.05, Math.PI / 2);
    const port = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.05, 12), charcoal);
    port.rotation.x = Math.PI / 2;
    port.position.set(-0.7, 0.9, -0.93);
    g.add(port);

    // ---- driver station (open cab)
    const platform = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.1, 1.3), paintDark);
    platform.position.set(0, 0.56, 1.45);
    g.add(platform);
    // boarding step + wear
    const step = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.4), charcoal);
    step.position.set(1.1, 0.28, 1.45);
    g.add(step);
    addSmudge(0.6, 0.5, 1.02, 0.56, 1.45, -Math.PI / 2);

    const seatBase = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.14, 0.55), charcoal);
    seatBase.position.set(0, 0.82, 1.1);
    const seatCushion = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.12, 0.52), new THREE.MeshStandardMaterial({ color: 0x59392a, roughness: 0.85 }));
    seatCushion.position.set(0, 0.94, 1.1);
    const seatBack = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.62, 0.12), new THREE.MeshStandardMaterial({ color: 0x59392a, roughness: 0.85 }));
    seatBack.position.set(0, 1.3, 0.86);
    g.add(seatBase, seatCushion, seatBack);

    const console_ = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.3), paintDark);
    console_.position.set(0, 1.05, 1.95);
    g.add(console_);
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.45, 8), charcoal);
    column.rotation.x = 0.6;
    column.position.set(0, 1.3, 1.78);
    g.add(column);
    this.steeringWheel = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.03, 8, 20), charcoal);
    this.steeringWheel.rotation.x = 0.6 + Math.PI / 2;
    this.steeringWheel.position.set(0, 1.45, 1.68);
    g.add(this.steeringWheel);

    // roof on 4 posts
    for (const [px, pz] of [[-0.9, 0.75], [0.9, 0.75], [-0.9, 2.2], [0.9, 2.2]]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.05, 8), steelDark);
      post.position.set(px, 1.55 + 0.52, pz);
      g.add(post);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.09, 1.75), cream);
    roof.position.set(0, 2.15, 1.47);
    g.add(roof);
    const beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.1, 0.12, 10),
      new THREE.MeshStandardMaterial({ color: 0xd9822b, emissive: 0x5a3208, emissiveIntensity: 0.6, roughness: 0.3 })
    );
    beacon.position.set(0.7, 2.25, 1.0);
    g.add(beacon);

    // ---- driver figure (friendly, generic)
    const driver = new THREE.Group();
    const dTorso = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.34, 4, 10), new THREE.MeshStandardMaterial({ color: 0xc9772e, roughness: 0.85 }));
    dTorso.position.set(0, 1.28, 1.05);
    const dHead = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), new THREE.MeshStandardMaterial({ color: 0xe8c39e, roughness: 0.7 }));
    dHead.position.set(0, 1.66, 1.05);
    const dHat = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 8, 0, Math.PI * 2, 0, 1.4), new THREE.MeshStandardMaterial({ color: 0x33506b, roughness: 0.9 }));
    dHat.position.set(0, 1.7, 1.05);
    const dEyeMat = new THREE.MeshStandardMaterial({ color: 0x2a2320, roughness: 0.4 });
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), dEyeMat);
      eye.position.set(sx * 0.05, 1.68, 1.175);
      driver.add(eye);
    }
    driver.add(dTorso, dHead, dHat);
    for (const sx of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.4, 3, 8), new THREE.MeshStandardMaterial({ color: 0xc9772e, roughness: 0.85 }));
      arm.position.set(sx * 0.17, 1.42, 1.33);
      arm.rotation.x = 1.05;
      arm.rotation.z = -sx * 0.25;
      driver.add(arm);
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.38, 3, 8), new THREE.MeshStandardMaterial({ color: 0x3a4652, roughness: 0.9 }));
      leg.position.set(sx * 0.14, 0.85, 1.42);
      leg.rotation.x = 1.2;
      driver.add(leg);
    }
    g.add(driver);

    // ---- snow tank (front) with dump lid + growing snow pile inside
    const tank = new THREE.Group();
    // open-top bin: walls + floor so the collected snow is really inside
    const binFloor = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.08, 1.3), paint);
    binFloor.position.set(0, 0.6, 2.95);
    tank.add(binFloor);
    const binL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.05, 1.3), paint);
    binL.position.set(-0.97, 1.1, 2.95);
    const binR = binL.clone(); binR.position.x = 0.97;
    const binBack = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.05, 0.06), paint);
    binBack.position.set(0, 1.1, 2.33);
    const binFront = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.05, 0.06), paint);
    binFront.position.set(0, 1.1, 3.57);
    const binInner = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.0, 1.2), new THREE.MeshStandardMaterial({ color: 0x2f4640, roughness: 0.9, side: THREE.BackSide }));
    binInner.position.set(0, 1.12, 2.95);
    tank.add(binL, binR, binBack, binFront, binInner);
    const tankFront = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.75, 0.5), paint);
    tankFront.position.set(0, 0.82, 3.55);
    tankFront.rotation.x = 0.5;
    tank.add(tankFront);
    const tankStripe = new THREE.Mesh(new THREE.BoxGeometry(2.02, 0.16, 1.32), cream);
    tankStripe.position.set(0, 1.18, 2.95);
    tank.add(tankStripe);
    this.lid = new THREE.Group();
    const lidPanel = new THREE.Mesh(new THREE.BoxGeometry(1.96, 0.07, 1.28), paintDark);
    lidPanel.position.set(0, 0, -0.62);
    this.lid.add(lidPanel);
    this.lid.position.set(0, 1.66, 3.56);   // hinge at front edge
    tank.add(this.lid);
    this.snowPile = new THREE.Mesh(
      new THREE.SphereGeometry(1.0, 14, 10),
      new THREE.MeshStandardMaterial({ color: 0xf4f8fb, roughness: 0.98 })
    );
    this.snowPile.scale.set(0.92, 0.3, 0.6);
    this.snowPile.position.set(0, 0.75, 2.95);
    tank.add(this.snowPile);
    g.add(tank);
    addSmudge(0.8, 0.5, 0.55, 0.75, 3.62, Math.PI, 0.5); // slush stains where snow tank dumps
    // headlights
    for (const sx of [-1, 1]) {
      const hl = new THREE.Mesh(
        new THREE.CylinderGeometry(0.09, 0.09, 0.06, 12),
        new THREE.MeshStandardMaterial({ color: 0xfffbe8, emissive: 0xfff3c4, emissiveIntensity: 1.1 })
      );
      hl.rotation.x = Math.PI / 2;
      hl.position.set(sx * 0.7, 0.85, 3.78);
      g.add(hl);
    }

    // ---- vertical auger chute: conditioner → snow tank (external, right side)
    const chuteCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.55, 0.35, -1.15),
      new THREE.Vector3(0.95, 0.8, 0.2),
      new THREE.Vector3(0.95, 1.5, 1.6),
      new THREE.Vector3(0.6, 1.75, 2.35)
    ]);
    const chute = new THREE.Mesh(new THREE.TubeGeometry(chuteCurve, 24, 0.13, 10), steelDark);
    g.add(chute);
    this.chute = chute;
    // inspection window band on the chute
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.145, 0.02, 8, 16), steel);
    band.position.copy(chuteCurve.getPoint(0.55));
    band.rotation.x = 1.2;
    g.add(band);
    // chute outlet stub into tank
    const outlet = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.3, 10), steelDark);
    outlet.position.set(0.6, 1.78, 2.5);
    outlet.rotation.x = 1.1;
    g.add(outlet);

    // ---- wheels (studded ice tires, no chains)
    const tireTex = tireTexture();
    const tireMat = new THREE.MeshStandardMaterial({ map: tireTex, color: 0xffffff, roughness: 0.85 });
    const hubMat = new THREE.MeshStandardMaterial({ color: 0xb8bdc2, roughness: 0.4, metalness: 0.7 });
    const mkWheel = () => {
      const w = new THREE.Group();
      const tireGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.26, 22);
      tireGeo.rotateZ(Math.PI / 2);
      const tire = new THREE.Mesh(tireGeo, tireMat);
      const hubGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.27, 14);
      hubGeo.rotateZ(Math.PI / 2);
      const hub = new THREE.Mesh(hubGeo, hubMat);
      w.add(tire, hub);
      return w;
    };
    this.wheels = { fl: mkWheel(), fr: mkWheel(), rl: mkWheel(), rr: mkWheel() };
    this.frontSteerL = new THREE.Group(); this.frontSteerR = new THREE.Group();
    this.frontSteerL.position.set(-0.85, 0.34, S.wheelbase);
    this.frontSteerR.position.set(0.85, 0.34, S.wheelbase);
    this.frontSteerL.add(this.wheels.fl); this.frontSteerR.add(this.wheels.fr);
    this.wheels.rl.position.set(-0.85, 0.34, 0);
    this.wheels.rr.position.set(0.85, 0.34, 0);
    g.add(this.frontSteerL, this.frontSteerR, this.wheels.rl, this.wheels.rr);
    // fenders + powder buildup near wheels
    for (const [px, pz] of [[-0.98, 0], [0.98, 0], [-0.98, S.wheelbase], [0.98, S.wheelbase]]) {
      const fend = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.9), paintDark);
      fend.position.set(px, 0.74, pz);
      g.add(fend);
      const pw = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 8, 6),
        new THREE.MeshStandardMaterial({ color: 0xeef3f6, roughness: 1 })
      );
      pw.scale.set(1.4, 0.4, 1.8);
      pw.position.set(px, 0.12, pz - 0.35);
      g.add(pw);
    }

    // ---- conditioner (rear implement on hitch arms)
    this.conditioner = new THREE.Group();
    this.conditioner.position.set(0, 0.52, -0.7);  // hitch pivot
    g.add(this.conditioner);
    for (const sx of [-0.7, 0.7]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.8), steelDark);
      arm.position.set(sx, 0, -0.35);
      this.conditioner.add(arm);
    }
    // hydraulic-style lift cylinder (visual)
    const lift = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 8), steel);
    lift.rotation.x = 1.1;
    lift.position.set(0, 0.12, -0.35);
    this.conditioner.add(lift);

    const condBox = new THREE.Group();
    condBox.position.set(0, -0.47, -0.72);
    this.conditioner.add(condBox);
    this.condBox = condBox;

    const shell = new THREE.Mesh(new THREE.BoxGeometry(S.conditionerWidth, 0.2, 0.52), steel);
    shell.position.set(0, 0.12, 0);
    condBox.add(shell);
    addSmudgeToGroup(condBox, smudge, 2.0, 0.16, 0, 0.23, 0.01, 0, -Math.PI / 2 + 0.0);
    // shaving blade (dark hardened steel, angled, at the front lip)
    const blade = new THREE.Mesh(new THREE.BoxGeometry(S.conditionerWidth - 0.1, 0.03, 0.2), new THREE.MeshStandardMaterial({ color: 0x50565c, roughness: 0.25, metalness: 0.9 }));
    blade.rotation.x = -0.5;
    blade.position.set(0, 0.02, 0.22);
    condBox.add(blade);
    // horizontal auger, partly visible under the front lip
    const augerTex = (() => {
      const c = document.createElement('canvas');
      c.width = 64; c.height = 32;
      const gg = c.getContext('2d');
      gg.fillStyle = '#9aa0a6'; gg.fillRect(0, 0, 64, 32);
      gg.strokeStyle = '#5c6268'; gg.lineWidth = 5;
      for (let i = -1; i < 5; i++) {
        gg.beginPath();
        gg.moveTo(i * 16, 32); gg.lineTo(i * 16 + 16, 0);
        gg.stroke();
      }
      const t = new THREE.CanvasTexture(c);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(6, 1);
      return t;
    })();
    const augerGeo = new THREE.CylinderGeometry(0.085, 0.085, S.conditionerWidth - 0.15, 12);
    augerGeo.rotateZ(Math.PI / 2);
    this.augerH = new THREE.Mesh(augerGeo, new THREE.MeshStandardMaterial({ map: augerTex, roughness: 0.5, metalness: 0.6 }));
    this.augerH.position.set(0, 0.045, 0.16);
    condBox.add(this.augerH);
    // wash water spray bar with nozzles (in front of towel)
    const sprayBar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, S.conditionerWidth - 0.2, 8), steelDark);
    sprayBar.rotation.z = Math.PI / 2;
    sprayBar.position.set(0, 0.03, -0.1);
    condBox.add(sprayBar);
    for (let i = -4; i <= 4; i++) {
      const nz = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.035, 6), steel);
      nz.position.set(i * 0.22, 0.005, -0.1);
      condBox.add(nz);
    }
    // ice-making water distribution pipe (feeds the towel)
    const feedPipe = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, S.conditionerWidth - 0.2, 8), steel);
    feedPipe.rotation.z = Math.PI / 2;
    feedPipe.position.set(0, 0.08, -0.24);
    condBox.add(feedPipe);
    // towel (spreads the water film flat) — sagging cloth behind everything
    const towel = new THREE.Mesh(
      new THREE.BoxGeometry(S.conditionerWidth, 0.015, 0.34),
      new THREE.MeshStandardMaterial({ color: 0x565b60, roughness: 0.98 })
    );
    towel.rotation.x = 0.22;
    towel.position.set(0, 0.0, -0.36);
    condBox.add(towel);
    this.towel = towel;
    const towelBar = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, S.conditionerWidth, 8), steelDark);
    towelBar.rotation.z = Math.PI / 2;
    towelBar.position.set(0, 0.06, -0.28);
    condBox.add(towelBar);

    // ---- hoses from body to conditioner (wash = blue-gray, ice water = cream insulated)
    const mkHose = (from, to, r, mat) => {
      const mid = from.clone().lerp(to, 0.5); mid.y -= 0.18;
      const curve = new THREE.CatmullRomCurve3([from, mid, to]);
      return new THREE.Mesh(new THREE.TubeGeometry(curve, 12, r, 8), mat);
    };
    const hoseMat1 = new THREE.MeshStandardMaterial({ color: 0x5a6d7a, roughness: 0.8 });
    const hoseMat2 = new THREE.MeshStandardMaterial({ color: 0xd8d2c0, roughness: 0.85 });
    g.add(mkHose(new THREE.Vector3(-0.5, 0.62, -0.9), new THREE.Vector3(-0.4, 0.28, -1.5), 0.035, hoseMat1));
    g.add(mkHose(new THREE.Vector3(0.5, 0.62, -0.9), new THREE.Vector3(0.45, 0.32, -1.6), 0.05, hoseMat2));

    // rubber skirt across the rear of the body
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.25, 0.03), rubber);
    skirt.position.set(0, 0.42, -0.92);
    g.add(skirt);

    // blob shadows (cheap, no shadow maps)
    this.bodyShadow = makeBlobShadow(3.0, 5.4);
    this.bodyShadow.position.set(0, 0.012, 1.3);
    g.add(this.bodyShadow);
    this.condShadow = makeBlobShadow(2.6, 1.6);
    this.condShadow.position.set(0, 0.012, -1.4);
    g.add(this.condShadow);
  }

  // ------------------------------------------------------------ dynamics

  get forward() { return { x: Math.sin(this.heading), z: Math.cos(this.heading) }; }
  get right() { return { x: -Math.cos(this.heading), z: Math.sin(this.heading) }; }

  startDrive(path) {
    this.path = path;
    this.progress = 0;
    this.driving = true;
    this.stuckTimer = 0;
    this._condTarget = 1;
  }

  setConditioner(down) { this._condTarget = down ? 1 : 0; }
  openLid() { this._lidTarget = 1; }
  closeLid() { this._lidTarget = 0; }

  conditionerEdges() {
    const f = this.forward, r = this.right;
    const cx = this.x - f.x * S.conditionerBack, cz = this.z - f.z * S.conditionerBack;
    const hw = S.conditionerWidth / 2;
    return {
      c: { x: cx, z: cz },
      L: { x: cx - r.x * hw, z: cz - r.z * hw },
      R: { x: cx + r.x * hw, z: cz + r.z * hw }
    };
  }

  wheelWorld(sx, lz) {
    const f = this.forward, r = this.right;
    return { x: this.x + r.x * sx + f.x * lz, z: this.z + r.z * sx + f.z * lz };
  }

  update(dt) {
    // conditioner raise/lower
    const cd = this._condTarget - this.conditionerT;
    if (Math.abs(cd) > 0.001) {
      this.conditionerT += Math.sign(cd) * Math.min(Math.abs(cd), dt / 1.1);
    }
    this.conditioner.rotation.x = (1 - this.conditionerT) * 0.38;
    this.condShadow.material.opacity = 0.4 + 0.6 * this.conditionerT;

    const ld = this._lidTarget - this.lidT;
    if (Math.abs(ld) > 0.001) this.lidT += Math.sign(ld) * Math.min(Math.abs(ld), dt / 1.4);
    this.lid.rotation.x = this.lidT * 1.15;

    let done = false;
    if (this.driving && this.path) {
      const path = this.path;
      // steering target: lookahead along the child's stroke (arc-length progress)
      const anchor = path.pointAt(this.progress);
      const distToAnchor = Math.hypot(anchor.x - this.x, anchor.z - this.z);
      const adv = this.speed * dt * (distToAnchor > 5 ? 0.15 : 1);
      this.progress = Math.min(path.total, this.progress + adv);

      const look = 2.6 + this.speed * 0.9;
      const target = path.pointAt(Math.min(path.total, this.progress + look));
      const dx = target.x - this.x, dz = target.z - this.z;
      const f = this.forward, r = this.right;
      const lx = dx * r.x + dz * r.z;
      const lz = dx * f.x + dz * f.z;
      const d2 = Math.max(1.0, dx * dx + dz * dz);
      let steerTarget = 0;
      if (lz > 0.05 || Math.abs(lx) > 0.05) {
        steerTarget = Math.atan(-2 * S.wheelbase * lx / d2);
        if (lz < 0) steerTarget = Math.sign(steerTarget || 1) * S.maxSteer; // target behind → committed turn
      }
      steerTarget = Math.max(-S.maxSteer, Math.min(S.maxSteer, steerTarget));
      const steerRate = 1.5;
      const sd = steerTarget - this.steer;
      this.steer += Math.sign(sd) * Math.min(Math.abs(sd), steerRate * dt);

      // speed: child's swipe speed, softened, slowed in curves — never a drift
      let vTarget = path.speedAt(this.progress);
      vTarget /= (1 + 2.2 * Math.abs(this.steer));
      const remaining = path.total - this.progress;
      if (remaining < 3) vTarget = Math.min(vTarget, 0.4 + remaining * 0.5);
      const accel = vTarget > this.speed ? 0.9 : 1.6;
      const vd = vTarget - this.speed;
      this.speed += Math.sign(vd) * Math.min(Math.abs(vd), accel * dt);

      // rear-axle bicycle integration
      this.x += f.x * this.speed * dt;
      this.z += f.z * this.speed * dt;
      this.heading += (this.speed / S.wheelbase) * Math.tan(this.steer) * dt;

      const distToEnd = Math.hypot(path.pointAt(path.total).x - this.x, path.pointAt(path.total).z - this.z);
      if ((this.progress >= path.total - 0.05 && distToEnd < 2.2)) done = true;
      if (this.progress >= path.total - 0.05) {
        this.stuckTimer += dt;
        if (this.stuckTimer > 5) done = true;
      }
      if (done) {
        this.driving = false;
        this.speed = 0;
        this._condTarget = 0;
      }
    } else {
      this.speed = Math.max(0, this.speed - 2 * dt);
    }

    this.workIntensity = this.conditionerT * Math.min(1, this.speed / 1.2);

    // wheel spin + steering visuals
    const spin = this.speed / 0.34 * dt;
    for (const k of ['fl', 'fr', 'rl', 'rr']) this.wheels[k].rotation.x += spin;
    this.frontSteerL.rotation.y = this.steer;
    this.frontSteerR.rotation.y = this.steer;
    this.steeringWheel.rotation.z = -this.steer * 6;
    // augers + towel turn while working
    this.augerH.rotation.x += this.workIntensity * 14 * dt;
    // chute vibration hints at the vertical auger inside
    this.chute.position.x = this.workIntensity * Math.sin(performance.now() * 0.09) * 0.006;
    this.lid.position.y = 1.66 + this.workIntensity * Math.sin(performance.now() * 0.07) * 0.004;

    this.syncTransforms();
    return done;
  }

  addSnow(amount) {
    this.snowFill = Math.min(1, this.snowFill + amount);
    this.snowPile.scale.y = 0.3 + this.snowFill * 0.55;
    this.snowPile.position.y = 0.68 + this.snowFill * 0.35;
  }

  resetPose(x, z, heading) {
    this.x = x; this.z = z; this.heading = heading;
    this.speed = 0; this.steer = 0; this.progress = 0;
    this.driving = false; this.path = null;
    this.snowFill = 0;
    this.snowPile.scale.y = 0.3;
    this.snowPile.position.y = 0.68;
    this._condTarget = 0; this.conditionerT = 0;
    this._lidTarget = 0; this.lidT = 0;
    this.syncTransforms();
  }

  syncTransforms() {
    this.group.position.set(this.x, 0, this.z);
    this.group.rotation.y = this.heading;
  }
}

function addSmudgeToGroup(group, tex, w, h, x, y, z, ry, rx) {
  const d = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshStandardMaterial({
      map: tex, transparent: true, depthWrite: false, roughness: 0.9,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
    })
  );
  d.position.set(x, y, z);
  d.rotation.y = ry ?? 0; d.rotation.x = rx ?? 0;
  d.renderOrder = 2;
  group.add(d);
}
