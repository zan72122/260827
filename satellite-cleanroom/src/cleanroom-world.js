import * as THREE from 'three';

const box = (w, h, d, material) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
};

function addEdges(mesh, color = 0x7d9299, opacity = .44) {
  const lines = new THREE.LineSegments(
    new THREE.EdgesGeometry(mesh.geometry, 20),
    new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }),
  );
  mesh.add(lines);
  return mesh;
}

function makeWheel(material) {
  const wheel = new THREE.Mesh(new THREE.CylinderGeometry(.13, .13, .08, 16), material);
  wheel.rotation.z = Math.PI / 2;
  return wheel;
}

export class CleanroomWorld {
  constructor(scene, materials, glowTexture) {
    this.scene = scene;
    this.materials = materials;
    this.root = new THREE.Group();
    this.root.name = 'Cleanroom';
    scene.add(this.root);
    this.phase = 'chooseMission';
    this.airProgress = 0;
    this.testProgress = 0;
    this.outerDoorClosed = false;
    this.innerDoorOpen = false;
    this.transferDoorOpen = false;
    this._airLines = [];
    this._dust = [];
    this._buildRoom();
    this._buildAirlock(glowTexture);
    this._buildEquipment(glowTexture);
    this._buildLighting();
  }

  _buildRoom() {
    const m = this.materials;
    const floor = box(14, .18, 18, m.floor); floor.position.set(0, -.1, 0); this.root.add(floor);
    const rear = box(14, 6.2, .18, m.wall); rear.position.set(0, 3.1, -9); this.root.add(rear);
    const left = box(.18, 6.2, 18, m.wall); left.position.set(-7, 3.1, 0); this.root.add(left);
    const right = box(.18, 6.2, 18, m.wall); right.position.set(7, 3.1, 0); this.root.add(right);

    // Blue coved skirting and floor seams make the room read as a clean technical volume.
    const skirtingMat = new THREE.MeshStandardMaterial({ color: 0x8fb9c8, roughness: .62 });
    for (const [w, d, x, z] of [[13.8,.08,0,-8.86],[.08,17.7,-6.86,0],[.08,17.7,6.86,0]]) {
      const rail = box(w, .12, d, skirtingMat); rail.position.set(x, .06, z); this.root.add(rail);
    }
    const seamMat = new THREE.MeshBasicMaterial({ color: 0xb5cbcf, transparent: true, opacity: .46 });
    for (let x = -6; x <= 6; x += 2) {
      const seam = box(.012, .006, 17.4, seamMat); seam.position.set(x, .005, 0); seam.castShadow = false; this.root.add(seam);
    }

    // Ceiling HEPA/light panels, deliberately broad and cool rather than chandelier-like.
    const panelMat = new THREE.MeshStandardMaterial({ color: 0xf9ffff, emissive: 0xd9f4ff, emissiveIntensity: .72, roughness: .52 });
    const frameMat = m.aluminiumDark;
    for (const x of [-4.6, -2.3, 0, 2.3, 4.6]) {
      for (const z of [-6.7, -3.4, 0, 3.4, 6.7]) {
        const frame = box(1.72, .07, 1.32, frameMat); frame.position.set(x, 6.05, z); frame.castShadow = false; this.root.add(frame);
        const panel = box(1.55, .035, 1.15, panelMat); panel.position.set(x, 6.005, z); panel.castShadow = false; this.root.add(panel);
      }
    }

    // Observation windows.
    const windowFrame = box(5.3, 2.3, .12, m.aluminiumDark); windowFrame.position.set(-6.92, 3.1, -1.6); windowFrame.rotation.y = Math.PI / 2; this.root.add(windowFrame);
    const glass = box(4.8, 1.85, .04, m.glass); glass.position.set(-6.84, 3.1, -1.6); glass.rotation.y = Math.PI / 2; glass.castShadow = false; this.root.add(glass);

    // Rear transfer door with two panels.
    this.transferLeft = addEdges(box(2.45, 4.7, .28, m.aluminium), 0x6a878f);
    this.transferRight = addEdges(box(2.45, 4.7, .28, m.aluminium), 0x6a878f);
    this.transferLeft.position.set(-1.24, 2.35, -8.78); this.transferRight.position.set(1.24, 2.35, -8.78);
    this.root.add(this.transferLeft, this.transferRight);
    for (const x of [-1.66,-.82,.82,1.66]) {
      const brace = box(.06, 4.3, .12, m.rail); brace.position.set(x, 2.35, -8.6); this.root.add(brace);
    }
  }

  _buildAirlock(glowTexture) {
    const m = this.materials;
    this.airlock = new THREE.Group(); this.airlock.name = 'Airlock'; this.airlock.position.z = 10.7; this.root.add(this.airlock);
    const floor = box(6, .16, 4, m.floor); floor.position.y = -.04; this.airlock.add(floor);
    const stagingFloor = box(6, .16, 3.7, m.floor); stagingFloor.position.set(0,-.04,3.82); this.airlock.add(stagingFloor);
    const ceiling = box(6, .12, 4, m.wall); ceiling.position.y = 4.7; this.airlock.add(ceiling);
    for (const x of [-3,3]) { const side = box(.14, 4.8, 4, m.wall); side.position.set(x, 2.4, 0); this.airlock.add(side); }

    this.outerDoor = new THREE.Group(); this.outerDoor.position.z = 2; this.airlock.add(this.outerDoor);
    this.innerDoor = new THREE.Group(); this.innerDoor.position.z = -2; this.airlock.add(this.innerDoor);
    this.outerDoorPanels = this._doorPair(this.outerDoor);
    this.innerDoorPanels = this._doorPair(this.innerDoor);

    // Large airflow button and clean-state lamp.
    const console = addEdges(box(1.05, 1.22, .38, m.aluminium), 0x668692);
    console.position.set(2.52, 1.15, .4); this.airlock.add(console);
    this.airButton = new THREE.Mesh(new THREE.CylinderGeometry(.33, .33, .14, 24), m.cyanGlow);
    this.airButton.rotation.x = Math.PI / 2; this.airButton.position.set(2.52, 1.28, .17); this.airButton.castShadow = true; this.airlock.add(this.airButton);
    this.cleanLamp = new THREE.Mesh(new THREE.SphereGeometry(.16, 16, 10), m.greenGlow.clone());
    this.cleanLamp.material.emissiveIntensity = .12; this.cleanLamp.position.set(2.52, 1.88, .13); this.airlock.add(this.cleanLamp);

    const lineMat = new THREE.SpriteMaterial({ map: glowTexture, color: 0x7cdcff, transparent: true, opacity: .0, depthWrite: false, blending: THREE.AdditiveBlending });
    for (let i = 0; i < 14; i++) {
      const line = new THREE.Sprite(lineMat.clone());
      line.position.set(-2.35 + (i % 7) * .77, 4.25 - Math.floor(i / 7) * .34, -1.45 + (i % 3) * 1.36);
      line.scale.set(.09, .9, 1); line.material.rotation = Math.PI / 2;
      this.airlock.add(line); this._airLines.push(line);
    }

    const dustGeo = new THREE.IcosahedronGeometry(.025, 0);
    const dustMat = new THREE.MeshStandardMaterial({ color: 0xc8bca0, roughness: 1, transparent: true, opacity: .55 });
    for (let i = 0; i < 22; i++) {
      const d = new THREE.Mesh(dustGeo, dustMat.clone());
      const sx = ((i * 37) % 100) / 100;
      const sy = ((i * 61) % 100) / 100;
      d.position.set(-2.35 + sx * 4.7, .25 + sy * 3.75, -1.65 + (((i * 83) % 100) / 100) * 3.3);
      d.userData.base = d.position.clone(); d.userData.phase = i * .79;
      this.airlock.add(d); this._dust.push(d);
    }
  }

  _doorPair(parent) {
    const left = addEdges(box(2.95, 4.7, .16, this.materials.aluminium), 0x77939b);
    const right = addEdges(box(2.95, 4.7, .16, this.materials.aluminium), 0x77939b);
    left.position.set(-1.5, 2.35, 0); right.position.set(1.5, 2.35, 0); parent.add(left, right);
    const glassL = box(.5, 1.3, .03, this.materials.glass); glassL.position.set(.72,.25,-.1); left.add(glassL);
    const glassR = glassL.clone(); glassR.position.x = -.72; right.add(glassR);
    return [left, right];
  }

  _buildEquipment(glowTexture) {
    const m = this.materials;
    this.cart = new THREE.Group(); this.cart.name = 'PartsCart'; this.cart.position.set(-4.8, .62, 7.7); this.root.add(this.cart);
    const cartDeck = addEdges(box(2.4, .18, 1.55, m.aluminium), 0x5c7d88); this.cart.add(cartDeck);
    for (const x of [-.94,.94]) for (const z of [-.56,.56]) { const w = makeWheel(m.blackRadiator); w.position.set(x,-.48,z); this.cart.add(w); }
    const handle = new THREE.Group();
    const hp = box(.08, 1.25, .08, m.rail); hp.position.set(-1.04,.62,.62); handle.add(hp);
    const hp2 = hp.clone(); hp2.position.z = -.62; handle.add(hp2);
    const bar = box(.08,.08,1.32,m.rail); bar.position.set(-1.04,1.21,0); handle.add(bar); this.cart.add(handle);
    this.cartAnchor = new THREE.Object3D(); this.cartAnchor.position.set(0,.55,0); this.cart.add(this.cartAnchor);

    // Integration stand.
    this.integrationStand = new THREE.Group(); this.integrationStand.position.set(0,0,-1); this.root.add(this.integrationStand);
    const base = addEdges(new THREE.Mesh(new THREE.CylinderGeometry(1.35,1.55,.32,28),m.aluminiumDark),0x2d444d); base.position.y=.16; base.receiveShadow=true; this.integrationStand.add(base);
    for (let i=0;i<4;i++) { const leg=box(.16,1.3,.16,m.rail); const a=i*Math.PI/2; leg.position.set(Math.cos(a)*.78,.82,Math.sin(a)*.78); leg.rotation.z=Math.cos(a)*-.2; leg.rotation.x=Math.sin(a)*.2; this.integrationStand.add(leg); }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(.89,.11,10,32),m.aluminiumDark); ring.rotation.x=Math.PI/2; ring.position.y=1.46; ring.castShadow=true; this.integrationStand.add(ring);
    this.standAnchor = new THREE.Object3D(); this.standAnchor.position.y=2.45; this.integrationStand.add(this.standAnchor);

    // Overhead bridge crane and hook.
    this.crane = new THREE.Group(); this.root.add(this.crane);
    const railA=box(11.4,.16,.22,m.rail); railA.position.set(0,5.58,-2.35); this.crane.add(railA);
    const railB=railA.clone(); railB.position.z=.35; this.crane.add(railB);
    const bridge=box(.28,.22,3,m.aluminiumDark); bridge.position.set(-3.9,5.5,-1); this.crane.add(bridge); this.craneBridge=bridge;
    this.trolley=addEdges(box(.75,.3,.62,m.aluminiumDark),0x324a52); this.trolley.position.set(-3.9,5.24,-1); this.crane.add(this.trolley);
    this.hookLine=new THREE.Mesh(new THREE.CylinderGeometry(.025,.025,2.15,8),m.aluminiumDark); this.hookLine.position.set(-3.9,4.02,-1); this.crane.add(this.hookLine);
    this.hook=new THREE.Mesh(new THREE.TorusGeometry(.17,.045,8,16,Math.PI*1.45),m.rail); this.hook.position.set(-3.9,2.92,-1); this.hook.rotation.z=.25; this.crane.add(this.hook);
    this.hookAnchor=new THREE.Object3D(); this.hookAnchor.position.set(-3.9,2.75,-1); this.crane.add(this.hookAnchor);

    // Mission/payload carts remain at left-side work lane.
    this.payloadRack = new THREE.Group(); this.payloadRack.position.set(-5.2,.6,-1.1); this.root.add(this.payloadRack);
    const rack=addEdges(box(2.25,1.1,3.4,m.aluminium),0x66808b); rack.position.y=.55; this.payloadRack.add(rack);
    for(let i=0;i<4;i++){const shelf=box(2.1,.06,.7,m.rail);shelf.position.set(0,1.18,-1.15+i*.77);this.payloadRack.add(shelf);}

    // Test stand and three large reassuring lamps.
    this.testStand = new THREE.Group(); this.testStand.position.set(4.45,0,-5.25); this.root.add(this.testStand);
    const testBase=addEdges(new THREE.Mesh(new THREE.CylinderGeometry(1.48,1.62,.5,28),m.aluminiumDark),0x334b53);testBase.position.y=.25;this.testStand.add(testBase);
    const testRing=new THREE.Mesh(new THREE.TorusGeometry(1.06,.12,10,32),m.rail);testRing.rotation.x=Math.PI/2;testRing.position.y=.58;this.testStand.add(testRing);
    this.testAnchor=new THREE.Object3D();this.testAnchor.position.y=1.73;this.testStand.add(this.testAnchor);
    this.testButton=new THREE.Mesh(new THREE.CylinderGeometry(.38,.38,.16,24),m.amberGlow);this.testButton.position.set(-1.45,1.1,.4);this.testButton.rotation.z=Math.PI/2;this.testStand.add(this.testButton);
    this.testLamps=[];
    for(let i=0;i<3;i++){const lamp=new THREE.Mesh(new THREE.SphereGeometry(.17,16,10),m.greenGlow.clone());lamp.material.emissiveIntensity=.08;lamp.position.set(-1.48,1.75+i*.5,.38);this.testStand.add(lamp);this.testLamps.push(lamp);}

    // Minimal control console.
    this.consoleGroup=new THREE.Group();this.consoleGroup.position.set(5.4,0,1.9);this.root.add(this.consoleGroup);
    const body=addEdges(box(1.45,1.1,.74,m.aluminium),0x66808b);body.position.y=.55;this.consoleGroup.add(body);
    const screen=box(1.08,.56,.05,m.blackRadiator);screen.position.set(0,1.05,-.39);screen.rotation.x=-.3;this.consoleGroup.add(screen);
    for(let i=0;i<4;i++){const dot=new THREE.Sprite(new THREE.SpriteMaterial({map:glowTexture,color:i===0?0x62d8ff:0x69e68d,transparent:true,opacity:.7,depthWrite:false}));dot.position.set(-.39+i*.26,1.05,-.43);dot.scale.set(.12,.12,1);this.consoleGroup.add(dot);}
  }

  _buildLighting() {
    this.scene.background = new THREE.Color(0xdce9ed);
    this.scene.fog = new THREE.Fog(0xdce9ed, 22, 54);
    const ambient = new THREE.AmbientLight(0xf4fdff, .68); this.scene.add(ambient);
    const hemi = new THREE.HemisphereLight(0xf5fdff, 0x72898d, 2.25); this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 3.25); key.position.set(-5,11,7); key.castShadow=true;
    key.shadow.mapSize.set(1024,1024); key.shadow.camera.left=-10; key.shadow.camera.right=10; key.shadow.camera.top=10; key.shadow.camera.bottom=-10; key.shadow.camera.near=.5; key.shadow.camera.far=28; key.shadow.bias=-.00035;
    this.scene.add(key); this.keyLight=key;
    const fill = new THREE.DirectionalLight(0xbcecff, 1.15); fill.position.set(7,6,1); this.scene.add(fill);
  }

  setPhase(phase) { this.phase = phase; }

  setAirShower(progress) {
    this.airProgress = THREE.MathUtils.clamp(progress, 0, 1);
    if (this.airProgress >= 1) { this.cleanLamp.material.emissiveIntensity = 1.55; }
  }

  setOuterDoorClosed(closed) { this.outerDoorClosed = closed; }
  setInnerDoorOpen(open) { this.innerDoorOpen = open; }
  setTransferDoorOpen(open) { this.transferDoorOpen = open; }
  setTestProgress(progress) { this.testProgress = THREE.MathUtils.clamp(progress,0,1); }

  setCrane(x, hookY) {
    const cx = THREE.MathUtils.clamp(x,-3.9,0);
    this.craneBridge.position.x=cx;this.trolley.position.x=cx;this.hookLine.position.x=cx;this.hook.position.x=cx;this.hookAnchor.position.x=cx;
    if (hookY !== undefined) {
      const y=THREE.MathUtils.clamp(hookY,2.15,3.85);
      const top=5.08;const len=top-y;
      this.hookLine.scale.y=len/2.15;this.hookLine.position.y=top-len/2;
      this.hook.position.y=y+.17;this.hookAnchor.position.y=y;
    }
  }

  update(dt,time) {
    const outerOpen = this.outerDoorClosed ? 0 : 1;
    const innerOpen = this.innerDoorOpen ? 1 : 0;
    this.outerDoorPanels[0].position.x=THREE.MathUtils.lerp(-2.95,-1.5,outerOpen);
    this.outerDoorPanels[1].position.x=THREE.MathUtils.lerp(2.95,1.5,outerOpen);
    this.innerDoorPanels[0].position.x=THREE.MathUtils.lerp(-1.5,-2.95,innerOpen);
    this.innerDoorPanels[1].position.x=THREE.MathUtils.lerp(1.5,2.95,innerOpen);
    const transfer = this.transferDoorOpen ? 1 : 0;
    this.transferLeft.position.x=THREE.MathUtils.lerp(-1.24,-3.75,transfer);
    this.transferRight.position.x=THREE.MathUtils.lerp(1.24,3.75,transfer);

    const air = this.airProgress;
    this.airButton.scale.setScalar(1 + Math.sin(time*8)*.045*air);
    this._airLines.forEach((line,i)=>{
      line.material.opacity = air > 0 && air < 1 ? .22 + .35*Math.sin(time*6+i*.7)**2 : .0;
      line.position.y = 4.2 - ((time*(1.3+i%3*.2)+i*.37)%3.8);
    });
    this._dust.forEach((d,i)=>{
      if (air<=0){d.position.lerp(d.userData.base,.08);d.material.opacity=.5;return;}
      const p=Math.min(1,air*1.25);
      d.position.x=d.userData.base.x+Math.sin(time*3+d.userData.phase)*.06;
      d.position.y=d.userData.base.y+p*4.8+Math.sin(time*5+i)*.08;
      d.position.z=d.userData.base.z-Math.sin(p*Math.PI)*.4;
      d.material.opacity=Math.max(0,.55-p*.65);
    });

    if (this.phase==='test' && this.testProgress>0 && this.testProgress<1) {
      this.testStand.position.x=4.45+Math.sin(time*24)*.018;
      this.testStand.position.z=-5.25+Math.cos(time*20)*.012;
    } else { this.testStand.position.x=THREE.MathUtils.lerp(this.testStand.position.x,4.45,.18);this.testStand.position.z=THREE.MathUtils.lerp(this.testStand.position.z,-5.25,.18); }
    this.testLamps.forEach((lamp,i)=>{lamp.material.emissiveIntensity=this.testProgress>=(i+1)/3?1.55:.08;});
  }

  get stats() {
    return {
      cleanroomVisible:this.root.visible,
      outerDoorClosed:this.outerDoorClosed,
      innerDoorOpen:this.innerDoorOpen,
      transferDoorOpen:this.transferDoorOpen,
      airProgress:this.airProgress,
      testProgress:this.testProgress,
      equipment:{airlock:1,crane:1,integrationStand:1,payloadRack:1,testStand:1,transferDoor:1,console:1},
      dustParticles:this._dust.length,
      airflowLines:this._airLines.length,
    };
  }
}
