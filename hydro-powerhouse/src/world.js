import * as THREE from 'three';

const TAU = Math.PI * 2;

function canvasTexture(width, height, draw, { repeat = [1, 1], srgb = true } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  draw(context, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(...repeat);
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function brushedTexture() {
  return canvasTexture(256, 64, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, '#79858a');
    grad.addColorStop(.22, '#d5dce0');
    grad.addColorStop(.5, '#7f8b90');
    grad.addColorStop(.78, '#e2e6e8');
    grad.addColorStop(1, '#68767b');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 2) {
      const a = .025 + ((y * 17) % 9) / 280;
      g.fillStyle = `rgba(255,255,255,${a})`;
      g.fillRect(0, y, w, 1);
    }
  }, { repeat: [3, 1] });
}

function waterTexture() {
  return canvasTexture(128, 512, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, '#146d8e');
    grad.addColorStop(.25, '#65dbff');
    grad.addColorStop(.52, '#198bb2');
    grad.addColorStop(.74, '#b6f4ff');
    grad.addColorStop(1, '#0d5a7d');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(225,250,255,.45)';
    g.lineWidth = 5;
    for (let y = -30; y < h + 30; y += 52) {
      g.beginPath();
      for (let x = 0; x <= w; x += 12) {
        const py = y + Math.sin(x * .13 + y * .02) * 7;
        if (x === 0) g.moveTo(x, py); else g.lineTo(x, py);
      }
      g.stroke();
    }
  }, { repeat: [1.5, 2.5] });
}

function glowTexture() {
  return canvasTexture(128, 128, (g, w, h) => {
    const r = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(.16, 'rgba(155,235,255,.92)');
    r.addColorStop(.52, 'rgba(50,188,255,.28)');
    r.addColorStop(1, 'rgba(20,120,220,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, w, h);
  });
}

function addMesh(parent, geometry, material, position, rotation = null, scale = null) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  if (rotation) mesh.rotation.set(...rotation);
  if (scale) mesh.scale.set(...scale);
  parent.add(mesh);
  return mesh;
}

function addInstances(parent, geometry, material, transforms) {
  const mesh = new THREE.InstancedMesh(geometry, material, transforms.length);
  const dummy = new THREE.Object3D();
  transforms.forEach((transform, index) => {
    dummy.position.fromArray(transform.position || [0, 0, 0]);
    dummy.rotation.set(...(transform.rotation || [0, 0, 0]));
    dummy.scale.fromArray(transform.scale || [1, 1, 1]);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  parent.add(mesh);
  return mesh;
}

function addOutlineCylinder(parent, radius, depth, material, position, rotation = [Math.PI / 2, 0, 0], segments = 48) {
  return addMesh(parent, new THREE.CylinderGeometry(radius, radius, depth, segments), material, position, rotation);
}

function makePerson(materials) {
  const root = new THREE.Group();
  const boots = new THREE.MeshStandardMaterial({ color: 0x18242a, roughness: .85 });
  addMesh(root, new THREE.CapsuleGeometry(.16, .56, 4, 8), materials.suit, [0, .7, 0]);
  const head = addMesh(root, new THREE.SphereGeometry(.19, 16, 12), materials.skin, [0, 1.38, 0]);
  addMesh(root, new THREE.SphereGeometry(.205, 16, 8, 0, TAU, 0, Math.PI / 2), materials.helmet, [0, 1.43, 0]);
  const armGeo = new THREE.CapsuleGeometry(.055, .48, 3, 8);
  addMesh(root, armGeo, materials.suit, [-.23, .86, 0], [0, 0, -.2]);
  addMesh(root, armGeo, materials.suit, [.23, .86, 0], [0, 0, .2]);
  addMesh(root, new THREE.CapsuleGeometry(.07, .5, 3, 8), boots, [-.11, .23, 0]);
  addMesh(root, new THREE.CapsuleGeometry(.07, .5, 3, 8), boots, [.11, .23, 0]);
  root.userData.head = head;
  root.userData.baseY = 0;
  return root;
}

function makeRobot(materials) {
  const root = new THREE.Group();
  const body = addMesh(root, new THREE.CapsuleGeometry(.28, .45, 5, 12), materials.robot, [0, .56, 0]);
  const face = addMesh(root, new THREE.BoxGeometry(.44, .22, .06), materials.robotDark, [0, .82, .24]);
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xbdf7ff, emissive: 0x4bdcff, emissiveIntensity: 2.4 });
  const eyeGeo = new THREE.SphereGeometry(.038, 10, 8);
  addMesh(root, eyeGeo, eyeMat, [-.1, .83, .276]);
  addMesh(root, eyeGeo, eyeMat, [.1, .83, .276]);
  const wheelGeo = new THREE.CylinderGeometry(.13, .13, .12, 16);
  addMesh(root, wheelGeo, materials.robotDark, [-.24, .18, 0], [0, 0, Math.PI / 2]);
  addMesh(root, wheelGeo, materials.robotDark, [.24, .18, 0], [0, 0, Math.PI / 2]);
  const antenna = addMesh(root, new THREE.CylinderGeometry(.018, .018, .28, 8), materials.copper, [0, 1.16, 0]);
  addMesh(root, new THREE.SphereGeometry(.055, 10, 8), eyeMat, [0, 1.32, 0]);
  root.userData.body = body;
  root.userData.face = face;
  root.userData.antenna = antenna;
  root.userData.baseY = 0;
  return root;
}

function makeLighthouse(materials, small = false) {
  const root = new THREE.Group();
  const scale = small ? .72 : 1;
  const tower = addMesh(root, new THREE.CylinderGeometry(.3, .46, 2.2, 16), materials.concreteLight, [0, 1.1, 0]);
  addMesh(root, new THREE.CylinderGeometry(.4, .4, .16, 18), materials.steelDark, [0, 2.22, 0]);
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x8ac9d3, emissive: 0xffd875, emissiveIntensity: .04, roughness: .2 });
  const lamp = addMesh(root, new THREE.CylinderGeometry(.28, .28, .36, 18), lampMat, [0, 2.45, 0]);
  addMesh(root, new THREE.ConeGeometry(.46, .42, 18), materials.roof, [0, 2.84, 0]);
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xffe9a2, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const beam = addMesh(root, new THREE.ConeGeometry(.58, 4.8, 24, 1, true), beamMat, [2.4, 2.48, 0], [0, 0, -Math.PI / 2]);
  const light = new THREE.PointLight(0xffd875, 0, 6, 2);
  light.position.set(0, 2.48, 0);
  root.add(light);
  root.scale.setScalar(scale);
  return {
    root,
    effect: { lamp, beam, light, kind: 'lighthouse', motion: 0, sequence: 0 },
  };
}

function makeTrain(materials, small = false) {
  const root = new THREE.Group();
  const scale = small ? .76 : 1;
  const railMat = new THREE.MeshStandardMaterial({
    color: 0x40545b,
    emissive: 0x86dfff,
    emissiveIntensity: 0,
    metalness: .62,
    roughness: .38,
  });
  addMesh(root, new THREE.BoxGeometry(5.2, .05, .07), railMat, [0, .12, -.34]);
  addMesh(root, new THREE.BoxGeometry(5.2, .05, .07), railMat, [0, .12, .34]);
  const sleeperGeo = new THREE.BoxGeometry(.08, .05, .85);
  addInstances(root, sleeperGeo, materials.wood,
    Array.from({ length: 15 }, (_, index) => ({ position: [-2.45 + index * .35, .08, 0] })));
  const stationMat = new THREE.MeshStandardMaterial({ color: 0x36515a, emissive: 0xffc45b, emissiveIntensity: 0, roughness: .65 });
  addMesh(root, new THREE.BoxGeometry(1.35, .8, 1.25), materials.concreteLight, [1.15, .5, -.92]);
  const stationLamp = addMesh(root, new THREE.BoxGeometry(.82, .18, .05), stationMat, [1.15, .67, -.285]);
  const train = new THREE.Group();
  addMesh(train, new THREE.BoxGeometry(1.45, .58, .72), materials.train, [0, .54, 0]);
  addMesh(train, new THREE.BoxGeometry(.72, .28, .74), materials.trainLight, [.25, .95, 0]);
  const windowMat = new THREE.MeshStandardMaterial({ color: 0x7398a2, emissive: 0xffd77a, emissiveIntensity: 0, roughness: .18 });
  addInstances(train, new THREE.BoxGeometry(.25, .18, .02), windowMat,
    [-.42, .02, .46].map((x) => ({ position: [x, .95, .38] })));
  const wheelGeo = new THREE.CylinderGeometry(.15, .15, .08, 14);
  addInstances(train, wheelGeo, materials.steelDark,
    [-.46, .46].flatMap((x) => [-.38, .38].map((z) => ({
      position: [x, .26, z], rotation: [Math.PI / 2, 0, 0],
    }))));
  train.position.x = -2;
  root.add(train);
  root.scale.setScalar(scale);
  return {
    root,
    effect: {
      train, windowMat, stationMat, stationLamp, railMat,
      kind: 'train', motion: 0, sequence: 0,
    },
  };
}

function makeCity(materials, small = false) {
  const root = new THREE.Group();
  const scale = small ? .65 : 1;
  const windowMaterials = [];
  const heights = [1.0, 1.5, .85, 1.25, .72, 1.7, 1.1];
  const buildingTransforms = [[], []];
  heights.forEach((height, index) => {
    const x = -2.25 + index * .68;
    buildingTransforms[index % 2].push({
      position: [x, height / 2, .15 + (index % 3) * .16],
      scale: [1, height, 1],
    });
    const wm = new THREE.MeshStandardMaterial({ color: 0x375460, emissive: 0xffc95f, emissiveIntensity: 0, roughness: .25 });
    windowMaterials.push(wm);
    const rows = [];
    for (let y = .24; y < height - .12; y += .28) rows.push({
      position: [x, y, .53 + (index % 3) * .16],
    });
    addInstances(root, new THREE.BoxGeometry(.3, .11, .025), wm, rows);
  });
  addInstances(root, new THREE.BoxGeometry(.54, 1, .72), materials.cityA, buildingTransforms[0]);
  addInstances(root, new THREE.BoxGeometry(.54, 1, .72), materials.cityB, buildingTransforms[1]);
  const wheel = new THREE.Group();
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x758d94, emissive: 0x6bdcff, emissiveIntensity: 0, metalness: .55, roughness: .35 });
  addMesh(wheel, new THREE.TorusGeometry(1.02, .055, 8, 40), wheelMat, [0, 0, 0]);
  const spokeGeo = new THREE.CylinderGeometry(.025, .025, 2.0, 7);
  addInstances(wheel, spokeGeo, wheelMat,
    Array.from({ length: 8 }, (_, index) => ({ rotation: [0, 0, index * Math.PI / 4] })));
  const gondolaGeo = new THREE.SphereGeometry(.09, 8, 6);
  const gondolaTransforms = [];
  for (let i = 0; i < 10; i++) {
    const a = i / 10 * TAU;
    gondolaTransforms.push({ position: [Math.cos(a) * 1.03, Math.sin(a) * 1.03, 0] });
  }
  const gondolas = addInstances(wheel, gondolaGeo, materials.cityLight, gondolaTransforms);
  wheel.position.set(1.25, 1.08, .1);
  root.add(wheel);
  const bridgeMat = new THREE.MeshStandardMaterial({
    color: 0x536d75,
    emissive: 0x6bdcff,
    emissiveIntensity: 0,
    metalness: .42,
    roughness: .48,
  });
  addInstances(root, new THREE.BoxGeometry(1, 1, 1), bridgeMat, [
    { position: [-.05, .34, .86], scale: [1.7, .13, .46] },
    { position: [-.72, .22, .86], scale: [.13, .68, .22] },
    { position: [.62, .22, .86], scale: [.13, .68, .22] },
  ]);
  root.scale.setScalar(scale);
  return {
    root,
    effect: {
      wheel, wheelMat, windowMaterials, gondolas, bridgeMat,
      kind: 'city', motion: 0, sequence: 0,
    },
  };
}

function makeDestination(kind, materials, small = false) {
  if (kind === 'lighthouse') return makeLighthouse(materials, small);
  if (kind === 'train') return makeTrain(materials, small);
  return makeCity(materials, small);
}

function curveTube(points, radius, material, segments = 48) {
  const curve = new THREE.CatmullRomCurve3(points);
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, segments, radius, 10, false), material);
  mesh.userData.curve = curve;
  return mesh;
}

function makeHose(parent, kind, start, restingEnd, material) {
  const holder = new THREE.Group();
  parent.add(holder);
  const nozzleMat = new THREE.MeshStandardMaterial({ color: kind === 'oil' ? 0xc9852e : 0x388db5, metalness: .68, roughness: .28 });
  const state = {
    kind,
    start: start.clone(),
    end: restingEnd.clone(),
    restingEnd: restingEnd.clone(),
    radius: .09,
    connected: false,
    holder,
    curve: null,
    mesh: null,
    nozzle: addOutlineCylinder(holder, .14, .32, nozzleMat, restingEnd.toArray(), [Math.PI / 2, 0, 0], 18),
  };
  function rebuild(end) {
    state.end.copy(end);
    const middle = start.clone().lerp(end, .5);
    middle.y = Math.min(start.y, end.y) - .65;
    const curve = new THREE.QuadraticBezierCurve3(start, middle, end);
    state.curve = curve;
    if (state.mesh) {
      state.mesh.geometry.dispose();
      holder.remove(state.mesh);
    }
    state.mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, state.radius, 9, false), material);
    state.mesh.castShadow = true;
    holder.add(state.mesh);
    state.nozzle.position.copy(end);
    const tangent = curve.getTangent(1).normalize();
    state.nozzle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
  }
  state.rebuild = rebuild;
  rebuild(restingEnd);
  return state;
}

export function buildHydroWorld(scene, renderer, layout = null) {
  const glowTex = glowTexture();
  const brushed = brushedTexture();
  const waterTex = waterTexture();
  waterTex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy?.() || 1);
  brushed.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy?.() || 1);

  const materials = {
    concrete: new THREE.MeshStandardMaterial({ color: 0x263840, roughness: .9 }),
    concreteLight: new THREE.MeshStandardMaterial({ color: 0xa7b4b4, roughness: .78 }),
    steel: new THREE.MeshStandardMaterial({ map: brushed, color: 0xc0c9cc, metalness: .82, roughness: .31 }),
    steelDark: new THREE.MeshStandardMaterial({ color: 0x34474e, metalness: .7, roughness: .36 }),
    wetSteel: new THREE.MeshStandardMaterial({ map: brushed, color: 0x8098a0, metalness: .78, roughness: .18 }),
    copper: new THREE.MeshStandardMaterial({ color: 0xd47a2d, metalness: .72, roughness: .29, emissive: 0x8f350d, emissiveIntensity: .06 }),
    copperDark: new THREE.MeshStandardMaterial({ color: 0x67331f, metalness: .38, roughness: .62 }),
    insulation: new THREE.MeshStandardMaterial({ color: 0x17282d, roughness: .68 }),
    oil: new THREE.MeshStandardMaterial({ color: 0xe4a12c, emissive: 0x8a4c08, emissiveIntensity: .12, transparent: true, opacity: .78, roughness: .18 }),
    coolant: new THREE.MeshStandardMaterial({ color: 0x2fbee8, emissive: 0x0c718f, emissiveIntensity: .34, transparent: true, opacity: .76, roughness: .14 }),
    water: new THREE.MeshStandardMaterial({ map: waterTex, color: 0x55c8e7, emissive: 0x0c6686, emissiveIntensity: .34, transparent: true, opacity: .54, roughness: .12, metalness: .02, side: THREE.DoubleSide }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0xb8ecf4, transparent: true, opacity: .27, roughness: .08, metalness: .05, depthWrite: false }),
    safety: new THREE.MeshStandardMaterial({ color: 0xe6a536, roughness: .58 }),
    red: new THREE.MeshStandardMaterial({ color: 0xa33d35, roughness: .55 }),
    green: new THREE.MeshStandardMaterial({ color: 0x5fae86, roughness: .55 }),
    roof: new THREE.MeshStandardMaterial({ color: 0x9d3d32, roughness: .62 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x563d2f, roughness: .86 }),
    train: new THREE.MeshStandardMaterial({ color: 0x3d7b91, roughness: .44, metalness: .22 }),
    trainLight: new THREE.MeshStandardMaterial({ color: 0xd8e5e5, roughness: .48 }),
    cityA: new THREE.MeshStandardMaterial({ color: 0x435b67, roughness: .76 }),
    cityB: new THREE.MeshStandardMaterial({ color: 0x6d6670, roughness: .76 }),
    cityLight: new THREE.MeshStandardMaterial({ color: 0xffd36c, emissive: 0xffb12d, emissiveIntensity: .12, roughness: .42 }),
    skin: new THREE.MeshStandardMaterial({ color: 0xd6a47f, roughness: .75 }),
    helmet: new THREE.MeshStandardMaterial({ color: 0xf4c64f, roughness: .44 }),
    suit: new THREE.MeshStandardMaterial({ color: 0x2c7084, roughness: .68 }),
    robot: new THREE.MeshStandardMaterial({ color: 0xc4d0d1, metalness: .42, roughness: .4 }),
    robotDark: new THREE.MeshStandardMaterial({ color: 0x223941, metalness: .55, roughness: .42 }),
  };

  scene.background = new THREE.Color(0x071923);
  scene.fog = new THREE.FogExp2(0x071923, .025);
  const hemi = new THREE.HemisphereLight(0xb7e9ff, 0x15252c, 1.12);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xd6f1ff, 2.2);
  key.position.set(-5, 10, 8);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -10;
  key.shadow.camera.right = 10;
  key.shadow.camera.top = 10;
  key.shadow.camera.bottom = -4;
  scene.add(key);
  const amber = new THREE.PointLight(0xffb552, .55, 14, 2);
  amber.position.set(2.8, 4.7, 2.5);
  scene.add(amber);

  const root = new THREE.Group();
  scene.add(root);

  const floor = addMesh(root, new THREE.PlaneGeometry(24, 18), materials.concrete, [0, -.03, 0], [-Math.PI / 2, 0, 0]);
  floor.receiveShadow = true;
  const wall = addMesh(root, new THREE.PlaneGeometry(24, 11), new THREE.MeshStandardMaterial({ color: 0x172a32, roughness: .92 }), [0, 5.2, -5.5]);
  wall.receiveShadow = true;
  addInstances(root, new THREE.BoxGeometry(.18, 9.4, .25), materials.steelDark,
    Array.from({ length: 9 }, (_, index) => ({ position: [-10 + index * 2.5, 4.4, -5.25] })));
  const gantryGeo = new THREE.BoxGeometry(20, .22, .28);
  addMesh(root, gantryGeo, materials.safety, [0, 7.6, -1.3]);
  addMesh(root, gantryGeo, materials.steelDark, [0, 7.25, -4.8]);

  const reservoir = new THREE.Group();
  reservoir.position.set(-6.1, 4.8, -1.5);
  root.add(reservoir);
  addMesh(reservoir, new THREE.BoxGeometry(4.3, 3.0, 3.6), materials.concreteLight, [0, 0, 0]);
  const reservoirWater = addMesh(reservoir, new THREE.PlaneGeometry(3.7, 3.0, 1, 1), materials.water, [0, .55, 1.82], [0, 0, 0]);
  addMesh(reservoir, new THREE.BoxGeometry(4.6, .22, 4.0), materials.concrete, [0, 1.62, 0]);
  const spill = addMesh(reservoir, new THREE.PlaneGeometry(2.0, 2.4), materials.water, [1.25, -.2, 1.84], [0, 0, 0]);
  spill.material = materials.water.clone();
  spill.material.opacity = .15;

  const penstockPoints = [
    new THREE.Vector3(-4.8, 4.7, -1.45),
    new THREE.Vector3(-3.9, 4.2, -1.2),
    new THREE.Vector3(-2.8, 3.5, -.7),
    new THREE.Vector3(-1.35, 2.7, -.2),
  ];
  // A semi-transparent inspection penstock lets the child see that the water
  // really travels from the reservoir to the runner.  It remains metallic,
  // but no longer hides the lightweight staged flow meshes inside it.
  const penstockMaterial = materials.wetSteel.clone();
  penstockMaterial.transparent = true;
  penstockMaterial.opacity = .68;
  penstockMaterial.depthWrite = false;
  const penstock = curveTube(penstockPoints, .62, penstockMaterial, 52);
  penstock.castShadow = true;
  penstock.renderOrder = 2;
  root.add(penstock);

  // Flow thickness changes in three inexpensive geometry stages.  We never
  // scale the Object3D, because that would move both ends away from the pipe.
  const waterFlowTexture = waterTex.clone();
  waterFlowTexture.needsUpdate = true;
  waterFlowTexture.wrapS = waterFlowTexture.wrapT = THREE.RepeatWrapping;
  waterFlowTexture.repeat.set(1.4, 3.2);
  const waterStream = new THREE.Group();
  waterStream.name = 'penstock-visible-water-flow';
  const waterStreamStages = [
    { radius: .18, start: .01, end: .38 },
    { radius: .32, start: .30, end: .72 },
    { radius: .47, start: .64, end: 1.01 },
  ].map((stage, index) => {
    const material = materials.water.clone();
    material.map = waterFlowTexture;
    material.opacity = 0;
    material.depthWrite = false;
    material.emissiveIntensity = .22 + index * .05;
    const mesh = curveTube(penstockPoints, stage.radius, material, 52);
    mesh.name = `penstock-water-stage-${index + 1}`;
    mesh.visible = false;
    mesh.renderOrder = 3;
    waterStream.add(mesh);
    return { ...stage, mesh, material };
  });
  waterStream.visible = false;
  root.add(waterStream);

  const gateAssembly = new THREE.Group();
  gateAssembly.position.set(-4.6, 4.7, .25);
  root.add(gateAssembly);
  addMesh(gateAssembly, new THREE.BoxGeometry(1.2, 1.8, .4), materials.steelDark, [0, 0, 0]);
  const gatePanel = addMesh(gateAssembly, new THREE.BoxGeometry(.88, 1.42, .16), materials.steel, [0, 0, .29]);
  const gateLeverPivot = new THREE.Group();
  gateLeverPivot.position.set(.78, .15, .35);
  gateAssembly.add(gateLeverPivot);
  addMesh(gateLeverPivot, new THREE.CylinderGeometry(.11, .11, 1.22, 14), materials.safety, [0, .58, 0], [0, 0, -.22]);
  const gateHandle = addMesh(gateLeverPivot, new THREE.SphereGeometry(.29, 16, 12), materials.red, [.13, 1.16, 0]);
  gateLeverPivot.rotation.z = .92;

  const machine = new THREE.Group();
  machine.position.set(0, 2.55, 0);
  root.add(machine);
  const generatorPresentationRoot = new THREE.Group();
  generatorPresentationRoot.name = 'generator-presentation-root';
  machine.add(generatorPresentationRoot);
  const pedestal = addMesh(root, new THREE.BoxGeometry(5.6, 1.0, 4.1), materials.concreteLight, [0, .47, 0]);
  pedestal.receiveShadow = true;
  const shaftRotor = new THREE.Group();
  shaftRotor.name = 'shaft-rotor';
  machine.add(shaftRotor);
  const shaft = addOutlineCylinder(shaftRotor, .38, 5.0, materials.steel, [0, 0, -.35], [Math.PI / 2, 0, 0]);
  shaft.castShadow = true;
  // A bright radial witness mark makes rotation readable even though the
  // cylindrical shaft itself is rotationally symmetrical.
  const shaftMarker = addMesh(
    shaftRotor,
    new THREE.BoxGeometry(.12, .58, .075),
    materials.safety,
    [0, .27, 2.18],
    [0, 0, -.12],
  );
  shaftMarker.name = 'shaft-rotation-witness-mark';
  const runnerMount = new THREE.Group();
  runnerMount.position.z = 1.22;
  machine.add(runnerMount);
  const runnerHub = addOutlineCylinder(runnerMount, .72, .62, materials.steelDark, [0, 0, 0], [Math.PI / 2, 0, 0]);
  const runnerCap = addOutlineCylinder(runnerMount, .42, .7, materials.steel, [0, 0, .02], [Math.PI / 2, 0, 0]);
  const statorMount = new THREE.Group();
  statorMount.position.z = -.62;
  generatorPresentationRoot.add(statorMount);
  const statorBack = addMesh(statorMount, new THREE.TorusGeometry(2.18, .27, 16, 56), materials.steelDark, [0, 0, 0]);
  const generatorShell = addOutlineCylinder(generatorPresentationRoot, 2.46, 2.25, materials.steelDark, [0, 0, -1.3], [Math.PI / 2, 0, 0], 56);
  generatorShell.material = materials.steelDark.clone();
  generatorShell.material.transparent = true;
  generatorShell.material.opacity = .28;
  generatorShell.material.depthWrite = false;
  generatorShell.visible = false;
  const portraitCoupling = addMesh(
    machine,
    new THREE.CylinderGeometry(.22, .22, 1.55, 18),
    materials.steel,
    [0, -.62, -.35],
  );
  portraitCoupling.name = 'portrait-generator-coupling';
  portraitCoupling.visible = false;
  const coilHaloMat = new THREE.SpriteMaterial({ map: glowTex, color: 0xff9b35, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const coilHalo = new THREE.Sprite(coilHaloMat);
  coilHalo.position.set(0, 0, -.12);
  coilHalo.scale.set(5.4, 5.4, 1);
  statorMount.add(coilHalo);

  const volute = new THREE.Group();
  volute.position.copy(machine.position);
  root.add(volute);
  const voluteBody = addMesh(volute, new THREE.TorusGeometry(1.85, .38, 18, 56, TAU * .83), materials.wetSteel, [0, 0, 1.18], [0, 0, .38]);
  voluteBody.visible = true;
  const casingTarget = new THREE.Group();
  casingTarget.position.copy(machine.position);
  casingTarget.position.z = 1.5;
  root.add(casingTarget);
  const targetRingMat = new THREE.MeshBasicMaterial({ color: 0x7be7ff, transparent: true, opacity: .12, wireframe: true });
  const targetRing = addMesh(casingTarget, new THREE.TorusGeometry(1.95, .22, 10, 48), targetRingMat, [0, 0, 0]);
  targetRing.visible = false;

  const crane = new THREE.Group();
  root.add(crane);
  const craneBridge = addMesh(crane, new THREE.BoxGeometry(11, .28, .35), materials.safety, [0, 8.0, .8]);
  addMesh(crane, new THREE.BoxGeometry(.7, .45, .75), materials.steelDark, [2.8, 7.7, .8]);
  const craneTrolley = new THREE.Group();
  craneTrolley.position.set(2.8, 7.45, .8);
  crane.add(craneTrolley);
  const craneRope = addMesh(craneTrolley, new THREE.CylinderGeometry(.025, .025, 3.0, 8), materials.steelDark, [0, -1.5, 0]);
  const hook = addMesh(craneTrolley, new THREE.TorusGeometry(.17, .055, 8, 18, Math.PI * 1.5), materials.safety, [0, -3.05, 0], [0, 0, .5]);
  const hangingCasing = new THREE.Group();
  hangingCasing.position.set(4.3, 6.45, .8);
  root.add(hangingCasing);
  const casingLiftMaterial = new THREE.MeshStandardMaterial({
    color: 0x527986,
    metalness: .7,
    roughness: .38,
  });
  const casingOuter = addMesh(hangingCasing, new THREE.TorusGeometry(1.78, .22, 14, 56), casingLiftMaterial, [0, 0, 0]);
  casingOuter.castShadow = true;
  const casingSpiral = addMesh(hangingCasing, new THREE.TorusGeometry(1.5, .14, 10, 48, TAU * .78), materials.steelDark, [0, 0, .18], [0, 0, .45]);
  hangingCasing.visible = false;

  const fluidGroup = new THREE.Group();
  root.add(fluidGroup);
  const oilStation = new THREE.Group();
  oilStation.position.set(-3.9, .25, 2.4);
  fluidGroup.add(oilStation);
  addMesh(oilStation, new THREE.CylinderGeometry(.58, .68, 1.55, 20), materials.steelDark, [0, .78, 0]);
  addMesh(oilStation, new THREE.CylinderGeometry(.5, .5, .12, 20), materials.safety, [0, 1.6, 0]);
  const oilGlass = new THREE.Group();
  oilGlass.position.set(-2.0, 1.55, 1.75);
  fluidGroup.add(oilGlass);
  addMesh(oilGlass, new THREE.CylinderGeometry(.34, .34, 1.62, 24, 1, true), materials.glass, [0, 0, 0]);
  const oilLevel = addMesh(oilGlass, new THREE.CylinderGeometry(.27, .27, 1.34, 20), materials.oil, [0, -.66, 0]);
  oilLevel.scale.y = .04;
  const coolantStation = new THREE.Group();
  coolantStation.position.set(3.9, .25, 2.4);
  fluidGroup.add(coolantStation);
  addMesh(coolantStation, new THREE.CylinderGeometry(.6, .67, 1.35, 20), materials.steelDark, [0, .68, 0]);
  const coolingTube = curveTube([
    new THREE.Vector3(2.1, 1.6, 1.68),
    new THREE.Vector3(2.55, 2.0, 1.4),
    new THREE.Vector3(2.1, 2.6, .55),
  ], .24, materials.glass, 28);
  fluidGroup.add(coolingTube);
  const coolantCore = curveTube([
    new THREE.Vector3(2.1, 1.6, 1.68),
    new THREE.Vector3(2.55, 2.0, 1.4),
    new THREE.Vector3(2.1, 2.6, .55),
  ], .145, materials.coolant, 28);
  coolantCore.visible = false;
  fluidGroup.add(coolantCore);
  const bubbleMat = new THREE.SpriteMaterial({ map: glowTex, color: 0xc9f7ff, transparent: true, opacity: .72, depthWrite: false });
  const bubbles = [];
  for (let i = 0; i < 10; i++) {
    const sprite = new THREE.Sprite(bubbleMat.clone());
    sprite.scale.setScalar(.18 + (i % 3) * .035);
    sprite.visible = false;
    fluidGroup.add(sprite);
    bubbles.push(sprite);
  }
  const oilPort = new THREE.Vector3(-1.1, 2.05, 1.65);
  const coolantPort = new THREE.Vector3(1.1, 2.05, 1.65);
  addOutlineCylinder(root, .2, .28, materials.oil, oilPort.toArray(), [Math.PI / 2, 0, 0], 18);
  addOutlineCylinder(root, .2, .28, materials.coolant, coolantPort.toArray(), [Math.PI / 2, 0, 0], 18);
  const oilHose = makeHose(fluidGroup, 'oil', new THREE.Vector3(-3.9, 1.2, 2.4), new THREE.Vector3(-2.75, .9, 2.5), new THREE.MeshStandardMaterial({ color: 0xaa6c22, roughness: .57 }));
  const coolantHose = makeHose(fluidGroup, 'coolant', new THREE.Vector3(3.9, 1.1, 2.4), new THREE.Vector3(2.75, .9, 2.5), new THREE.MeshStandardMaterial({ color: 0x237ca2, roughness: .5 }));

  const technician = makePerson(materials);
  technician.position.set(3.78, 0, 4.18);
  technician.rotation.y = -.75;
  root.add(technician);
  const robot = makeRobot(materials);
  robot.position.set(-2.82, 0, 4.08);
  robot.rotation.y = .75;
  root.add(robot);

  const pickStage = new THREE.Group();
  pickStage.position.set(0, .1, 3.2);
  root.add(pickStage);
  const pickKinds = ['lighthouse', 'train', 'city'];
  const destinationPickGroups = {};
  pickKinds.forEach((kind, index) => {
    const item = makeDestination(kind, materials, true);
    item.root.scale.setScalar(kind === 'lighthouse' ? .82 : kind === 'train' ? .62 : .58);
    item.root.position.set((index - 1) * 3.45, .45, 0);
    const plinth = addMesh(item.root, new THREE.CylinderGeometry(1.22, 1.3, .28, 28), materials.concreteLight, [0, -.18, 0]);
    plinth.receiveShadow = true;
    pickStage.add(item.root);
    destinationPickGroups[kind] = { ...item, plinth };
  });

  const destinationStage = new THREE.Group();
  destinationStage.position.set(7.25, .12, -1.1);
  root.add(destinationStage);
  const destinations = {};
  pickKinds.forEach((kind) => {
    const item = makeDestination(kind, materials, false);
    item.root.visible = false;
    destinationStage.add(item.root);
    destinations[kind] = item;
  });
  addMesh(destinationStage, new THREE.CylinderGeometry(3.2, 3.5, .24, 36), materials.concreteLight, [0, -.13, 0]);

  const transmissionGroup = new THREE.Group();
  root.add(transmissionGroup);
  const poleGeo = new THREE.CylinderGeometry(.06, .09, 3.1, 9);
  const crossGeo = new THREE.BoxGeometry(1.05, .07, .08);
  const polePositions = [[3.0, 1.55, -1.8], [4.7, 1.55, -1.7], [6.15, 1.55, -1.35]];
  addInstances(transmissionGroup, poleGeo, materials.steelDark,
    polePositions.map(([x, y, z]) => ({ position: [x, y, z] })));
  addInstances(transmissionGroup, crossGeo, materials.steelDark,
    polePositions.map(([x, y, z]) => ({ position: [x, y + 1.15, z] })));
  const powerPath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(1.85, 3.0, -1.0),
    new THREE.Vector3(3.0, 2.75, -1.8),
    new THREE.Vector3(4.7, 2.72, -1.7),
    new THREE.Vector3(6.15, 2.7, -1.35),
    new THREE.Vector3(7.25, 2.25, -1.1),
  ]);
  const lineMat = new THREE.MeshStandardMaterial({
    color: 0x5e7076,
    emissive: 0xffd96a,
    emissiveIntensity: 0,
    metalness: .62,
    roughness: .34,
  });
  const powerLine = new THREE.Mesh(new THREE.TubeGeometry(powerPath, 52, .04, 6, false), lineMat);
  transmissionGroup.add(powerLine);
  const powerPulseCount = 14;
  const powerPulsePositions = new Float32Array(powerPulseCount * 3);
  const powerPulseGeometry = new THREE.BufferGeometry();
  powerPulseGeometry.setAttribute('position', new THREE.BufferAttribute(powerPulsePositions, 3));
  const pulseMat = new THREE.PointsMaterial({
    map: glowTex,
    color: 0xffdf72,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    size: .5,
    sizeAttenuation: true,
  });
  const powerPulses = new THREE.Points(powerPulseGeometry, pulseMat);
  powerPulses.visible = false;
  powerPulses.frustumCulled = false;
  transmissionGroup.add(powerPulses);

  const splashGeo = new THREE.SphereGeometry(.045, 7, 5);
  const splashMesh = new THREE.InstancedMesh(splashGeo, materials.coolant, 48);
  splashMesh.count = 0;
  splashMesh.frustumCulled = false;
  root.add(splashMesh);
  const splashState = Array.from({ length: 48 }, (_, index) => ({
    phase: index / 48,
    radius: .45 + (index % 7) * .065,
    speed: .35 + (index % 5) * .07,
  }));
  const scratchMatrix = new THREE.Matrix4();
  const scratchPosition = new THREE.Vector3();
  const scratchScale = new THREE.Vector3();
  const scratchQuaternion = new THREE.Quaternion();

  const state = {
    selectedDestination: null,
    phase: 'chooseDestination',
    gate: 0,
    speed: 0,
    power: 0,
    oilLevel: 0,
    coolantFlow: 0,
    bubblesRemaining: 0,
    transmission: 0,
    complete: false,
    casingInstalled: false,
    shaftSpeed: 0,
    orientation: 'landscape',
  };

  function applyPresentationLayout() {
    const stacked = state.orientation === 'portrait'
      && ['gate', 'generation', 'complete'].includes(state.phase);
    generatorPresentationRoot.position.y = stacked ? -1.25 : 0;
    portraitCoupling.visible = stacked;
  }

  function setOrientation(orientation) {
    state.orientation = orientation === 'portrait' ? 'portrait' : 'landscape';
    const pickSpacing = state.orientation === 'portrait' ? 2.75 : 3.45;
    pickKinds.forEach((kind, index) => {
      destinationPickGroups[kind].root.position.x = (index - 1) * pickSpacing;
    });
    applyPresentationLayout();
  }

  // Runtime spatial truth.  PLANT_LAYOUT supplies identifiers and required
  // clearances, while these sources measure the Object3D instances that are
  // actually rendered.  No authored world position is replaced here.
  const spatialSources = [
    { id: 'turbine', category: 'equipment', objects: () => [runnerMount] },
    { id: 'casing', category: 'equipment', objects: () => [volute] },
    { id: 'generator', category: 'equipment', objects: () => [statorMount, generatorShell] },
    { id: 'shaft', category: 'equipment', objects: () => [shaftRotor] },
    // The site glass is an intentional generator-mounted connection, not a
    // floor station obstacle, so it is measured with the fluid path instead.
    { id: 'oil-station', category: 'fluidStation', objects: () => [oilStation] },
    { id: 'coolant-station', category: 'fluidStation', objects: () => [coolantStation] },
    { id: 'gate-control', category: 'supportZone', objects: () => [gateAssembly] },
    { id: 'adult-technician', category: 'actor', objects: () => [technician] },
    { id: 'maintenance-robot', category: 'actor', objects: () => [robot] },
    {
      id: `${layout?.crane?.id || 'overhead-casing-crane'}-bridge`,
      category: 'craneBridge',
      objects: () => [craneBridge],
    },
  ];
  const craneTrace = [];
  let craneTraceSequence = 0;
  let lastCraneTraceCenter = null;

  const roundedArray = (vector) => vector.toArray().map((value) => +value.toFixed(4));

  function measureSpatialObjects(id, category, objects) {
    const bounds = new THREE.Box3().makeEmpty();
    for (const object of objects) {
      if (!object) continue;
      object.updateWorldMatrix(true, true);
      const objectBounds = new THREE.Box3().setFromObject(object, true);
      if (!objectBounds.isEmpty()) bounds.union(objectBounds);
    }
    if (bounds.isEmpty()) return null;
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    return {
      id,
      category,
      bounds: { min: roundedArray(bounds.min), max: roundedArray(bounds.max) },
      center: roundedArray(center),
      size: roundedArray(size),
      source: 'object3d-box3',
    };
  }

  function recordCraneLoadSample() {
    const measured = measureSpatialObjects('crane-load', 'craneLoad', [hangingCasing]);
    if (!measured) return;
    const center = new THREE.Vector3().fromArray(measured.center);
    if (lastCraneTraceCenter && lastCraneTraceCenter.distanceToSquared(center) < .03 * .03) return;
    lastCraneTraceCenter = center;
    // Keep the first pose and the newest poses if an unusually long pointer
    // gesture exceeds the cap.  The cap makes the debug API predictably small.
    if (craneTrace.length >= 256) craneTrace.splice(1, 1);
    craneTrace.push({
      sequence: craneTraceSequence++,
      // Once horizontally centred, every following sample belongs to the
      // intended lowering envelope around the runner and shaft.
      installation: hangingCasing.position.y < 6.44
        || Math.abs(hangingCasing.position.x - machine.position.x) < .45,
      bounds: measured.bounds,
      center: measured.center,
      size: measured.size,
      source: measured.source,
    });
  }

  function measureHose(id, hose, sourceStationId, targetEquipmentId) {
    if (!hose.curve) return null;
    hose.holder.updateWorldMatrix(true, false);
    const points = hose.curve.getPoints(24).map((point) => roundedArray(
      point.clone().applyMatrix4(hose.holder.matrixWorld),
    ));
    return {
      id,
      kind: hose.kind,
      radius: hose.radius,
      sourceStationId,
      targetEquipmentId,
      connected: hose.connected,
      points,
      source: 'rendered-quadratic-curve',
    };
  }

  function spatialSnapshot() {
    root.updateWorldMatrix(true, true);
    const volumes = spatialSources
      .map((source) => measureSpatialObjects(source.id, source.category, source.objects()))
      .filter(Boolean);
    const hoses = [
      measureHose('oil-hose', oilHose, 'oil-station', 'generator'),
      measureHose('coolant-hose', coolantHose, 'coolant-station', 'generator'),
    ].filter(Boolean);
    return {
      version: 1,
      coordinateSpace: 'world-metres',
      volumes,
      hoses,
      craneSamples: craneTrace.map((sample) => ({
        ...sample,
        bounds: { min: [...sample.bounds.min], max: [...sample.bounds.max] },
        center: [...sample.center],
        size: [...sample.size],
      })),
    };
  }

  function setDestination(kind) {
    state.selectedDestination = kind;
    for (const [name, item] of Object.entries(destinationPickGroups)) {
      item.root.scale.setScalar(name === kind ? 1.08 : .82);
      item.plinth.material = name === kind ? materials.safety : materials.concreteLight;
    }
    for (const [name, item] of Object.entries(destinations)) item.root.visible = name === kind;
  }

  function setPhase(phase) {
    state.phase = phase;
    applyPresentationLayout();
    pickStage.visible = phase === 'chooseDestination';
    technician.visible = !['chooseDestination', 'generation', 'complete'].includes(phase);
    robot.visible = !['chooseDestination', 'generation', 'complete'].includes(phase);
    fluidGroup.visible = ['fluids', 'casing', 'gate'].includes(phase);
    crane.visible = phase === 'casing';
    hangingCasing.visible = phase === 'casing' && !state.casingInstalled;
    targetRing.visible = phase === 'casing' && !state.casingInstalled;
    generatorShell.visible = state.casingInstalled || ['gate', 'generation', 'complete'].includes(phase);
    transmissionGroup.visible = ['gate', 'generation', 'complete'].includes(phase);
    destinationStage.visible = ['generation', 'complete'].includes(phase);
    reservoir.visible = ['gate', 'generation', 'complete'].includes(phase);
    gateAssembly.visible = ['gate', 'generation', 'complete'].includes(phase);
    penstock.visible = ['gate', 'generation', 'complete'].includes(phase);
    waterStream.visible = ['gate', 'generation', 'complete'].includes(phase) && state.gate > .015;
    volute.visible = ['gate', 'generation', 'complete'].includes(phase);
  }

  function setCasingPosition(x, y = hangingCasing.position.y, z = hangingCasing.position.z) {
    hangingCasing.position.x = x;
    hangingCasing.position.y = y;
    hangingCasing.position.z = z;
    craneTrolley.position.x = x;
    craneTrolley.position.z = z;
    craneRope.scale.y = Math.max(.3, (7.45 - y) / 3);
    craneRope.position.y = -(7.45 - y) / 2;
    hook.position.y = -(7.45 - y) - .05;
    recordCraneLoadSample();
  }

  function installCasing() {
    state.casingInstalled = true;
    hangingCasing.position.set(machine.position.x, machine.position.y, 1.5);
    targetRing.visible = false;
    generatorShell.visible = true;
    recordCraneLoadSample();
  }

  function moveHose(kind, end) {
    const hose = kind === 'oil' ? oilHose : coolantHose;
    hose.rebuild(end);
  }

  function connectHose(kind) {
    const hose = kind === 'oil' ? oilHose : coolantHose;
    hose.connected = true;
    hose.rebuild(kind === 'oil' ? oilPort : coolantPort);
  }

  function setDynamicState(next) {
    Object.assign(state, next);
  }

  function setShaftSpeed(radiansPerSecond) {
    const value = Number(radiansPerSecond);
    state.shaftSpeed = Number.isFinite(value) ? value : 0;
    return state.shaftSpeed;
  }

  function updateDestinationEffect(dt, intensity) {
    for (const [kind, item] of Object.entries(destinations)) {
      const selected = kind === state.selectedDestination;
      const value = selected ? intensity : 0;
      const effect = item.effect;
      effect.sequence = value > .03
        ? Math.min(1, (Number(effect.sequence) || 0) + dt * .62)
        : 0;
      const sequence = effect.sequence;
      effect.phase = Number.isFinite(effect.phase) ? effect.phase : 0;
      if (kind === 'lighthouse') {
        const lampStage = THREE.MathUtils.smoothstep(sequence, 0, .32);
        const beamStage = THREE.MathUtils.smoothstep(sequence, .22, .72);
        effect.lamp.material.emissiveIntensity = .04 + value * lampStage * 4.2;
        effect.beam.material.opacity = value * beamStage * .42;
        effect.motion += (value * beamStage - effect.motion) * (1 - Math.exp(-dt * 3.2));
        effect.phase = (effect.phase + dt * .68 * effect.motion) % TAU;
        effect.beam.rotation.y = effect.phase;
        effect.light.intensity = value * lampStage * 24;
        effect.stages = { lamp: lampStage, beam: beamStage };
      } else if (kind === 'train') {
        const stationStage = THREE.MathUtils.smoothstep(sequence, 0, .3);
        const trackStage = THREE.MathUtils.smoothstep(sequence, .22, .58);
        const trainStage = THREE.MathUtils.smoothstep(sequence, .5, .92);
        effect.windowMat.emissiveIntensity = value * trainStage * 3.2;
        effect.stationMat.emissiveIntensity = value * stationStage * 2.7;
        effect.railMat.emissiveIntensity = value * trackStage * 2.1;
        effect.motion += (value * trainStage - effect.motion) * (1 - Math.exp(-dt * 3.2));
        effect.phase = (effect.phase + dt * .62 * effect.motion) % 4.2;
        effect.train.position.x = -2 + effect.phase;
        effect.stages = { station: stationStage, track: trackStage, vehicle: trainStage };
      } else {
        const houseStages = effect.windowMaterials.map((material, index) => {
          const begin = index * .07;
          const stage = THREE.MathUtils.smoothstep(sequence, begin, begin + .24);
          material.emissiveIntensity = value * stage * (1.8 + (index % 3) * .45);
          return stage;
        });
        const bridgeStage = THREE.MathUtils.smoothstep(sequence, .42, .72);
        const wheelStage = THREE.MathUtils.smoothstep(sequence, .66, 1);
        effect.bridgeMat.emissiveIntensity = value * bridgeStage * 2.2;
        effect.wheelMat.emissiveIntensity = value * wheelStage * 2.8;
        effect.motion += (value * wheelStage - effect.motion) * (1 - Math.exp(-dt * 3.2));
        effect.phase = (effect.phase + dt * .42 * effect.motion) % TAU;
        effect.wheel.rotation.z = -effect.phase;
        effect.stages = {
          firstHouse: houseStages[0],
          houses: Math.min(...houseStages),
          bridge: bridgeStage,
          wheel: wheelStage,
        };
      }
    }
  }

  function update(dt, time, next = {}) {
    Object.assign(state, next);
    waterTex.offset.y = (waterTex.offset.y - dt * (.08 + state.gate * .8)) % 1;
    waterFlowTexture.offset.y = (waterFlowTexture.offset.y - dt * (.34 + state.gate * 1.55)) % 1;
    reservoirWater.position.y = .55 + Math.sin(time * 1.25) * .035;
    spill.material.opacity = .12 + state.gate * .5;
    waterStream.visible = state.gate > .012 && ['gate', 'generation', 'complete'].includes(state.phase);
    waterStreamStages.forEach((stage, index) => {
      const gateWindow = THREE.MathUtils.smoothstep(state.gate, stage.start, stage.end);
      const nextStage = waterStreamStages[index + 1];
      const handoff = nextStage
        ? 1 - THREE.MathUtils.smoothstep(state.gate, nextStage.start, nextStage.start + .11)
        : 1;
      const amount = gateWindow * handoff;
      stage.mesh.visible = waterStream.visible && amount > .015;
      stage.material.opacity = stage.mesh.visible ? .2 + amount * .52 : 0;
    });
    if (state.shaftSpeed !== 0) {
      shaftRotor.rotation.z = (shaftRotor.rotation.z + state.shaftSpeed * dt) % TAU;
    }
    gateLeverPivot.rotation.z = .92 - state.gate * 1.55;
    gatePanel.position.y = state.gate * .62;
    coilHalo.material.opacity = state.power * .48;
    coilHalo.scale.setScalar(4.8 + state.power * .9);
    materials.copper.emissiveIntensity = .06 + state.power * 1.65;
    amber.intensity = .55 + state.power * 8;
    lineMat.emissiveIntensity = state.transmission * (.25 + state.power * 1.65);
    if (state.speed > .04 && state.casingInstalled) {
      const vibration = Math.sin(time * 32) * .006 * state.speed;
      generatorShell.position.x = vibration;
      generatorShell.position.y = -vibration * .5;
      voluteBody.position.x = vibration * .8;
    } else {
      generatorShell.position.set(0, 0, -1.3);
      voluteBody.position.x = 0;
    }
    oilLevel.scale.y = Math.max(.04, state.oilLevel);
    oilLevel.position.y = -.56 + .56 * state.oilLevel;
    coolantCore.visible = state.coolantFlow > .01;
    coolantCore.material.opacity = .22 + state.coolantFlow * .58;
    const visibleBubbleCount = THREE.MathUtils.clamp(
      Math.ceil(Number(state.bubblesRemaining) || 0),
      0,
      bubbles.length,
    );
    bubbles.forEach((bubble, index) => {
      bubble.visible = state.coolantFlow > .08 && index < visibleBubbleCount;
      if (!bubble.visible) return;
      const u = (time * (.12 + index * .003) + index / bubbles.length) % 1;
      const point = coolingTube.userData.curve.getPoint(u);
      bubble.position.copy(point);
      bubble.material.opacity = Math.max(0, (1 - u) * .78) * state.coolantFlow;
    });
    const activeSplashes = Math.floor(48 * state.gate);
    splashMesh.count = activeSplashes;
    for (let i = 0; i < activeSplashes; i++) {
      const item = splashState[i];
      const p = (time * item.speed + item.phase) % 1;
      scratchPosition.set(-1.25 + p * 1.2, 2.4 + Math.sin(p * Math.PI) * item.radius, .9 + ((i % 5) - 2) * .08);
      scratchScale.setScalar(.5 + (1 - p) * .8);
      scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale);
      splashMesh.setMatrixAt(i, scratchMatrix);
    }
    if (activeSplashes) splashMesh.instanceMatrix.needsUpdate = true;
    let anyPowerPulse = false;
    for (let index = 0; index < powerPulseCount; index++) {
      const progress = state.transmission > 0
        ? ((time * (.24 + state.power * .35) + index / powerPulseCount) % 1)
        : 0;
      const visible = state.transmission > .02 && progress <= Math.max(.06, state.transmission);
      const offset = index * 3;
      if (visible) {
        const point = powerPath.getPoint(progress);
        powerPulsePositions[offset] = point.x;
        powerPulsePositions[offset + 1] = point.y;
        powerPulsePositions[offset + 2] = point.z;
        anyPowerPulse = true;
      } else {
        powerPulsePositions[offset] = 0;
        powerPulsePositions[offset + 1] = -100;
        powerPulsePositions[offset + 2] = 0;
      }
    }
    powerPulses.visible = anyPowerPulse;
    pulseMat.opacity = anyPowerPulse ? .25 + state.power * .72 : 0;
    powerPulseGeometry.attributes.position.needsUpdate = true;
    updateDestinationEffect(dt, state.complete || state.transmission >= .99 ? state.power : 0);
    technician.userData.head.rotation.y = Math.sin(time * .45) * .08;
    robot.position.y = robot.userData.baseY + Math.sin(time * 2.4) * .025;
    robot.userData.antenna.rotation.z = Math.sin(time * 3) * .12;
  }

  function destinationStats() {
    const result = {};
    for (const kind of pickKinds) {
      const effect = destinations[kind].effect;
      const energized = kind === state.selectedDestination && (state.complete || state.transmission >= .99) && state.power > .03;
      result[kind] = {
        energized,
        intensity: energized ? +state.power.toFixed(3) : 0,
        motion: energized ? +effect.motion.toFixed(3) : 0,
        sequence: energized ? +(effect.sequence || 0).toFixed(3) : 0,
        stages: energized ? { ...(effect.stages || {}) } : {},
      };
    }
    return result;
  }

  setPhase('chooseDestination');
  recordCraneLoadSample();

  return {
    root,
    materials,
    glowTexture: glowTex,
    waterTexture: waterTex,
    machine,
    runnerMount,
    runnerHub,
    runnerCap,
    statorMount,
    generatorPresentationRoot,
    portraitCoupling,
    shaft,
    shaftRotor,
    shaftMarker,
    coilHalo,
    generatorShell,
    reservoir,
    gateAssembly,
    gateHandle,
    gateLeverPivot,
    penstock,
    waterStream,
    crane,
    craneBridge,
    craneTrolley,
    craneRope,
    hook,
    hangingCasing,
    casingTarget,
    targetRing,
    oilHose,
    coolantHose,
    oilPort,
    coolantPort,
    oilGlass,
    oilLevel,
    coolingTube,
    coolantCore,
    bubbles,
    technician,
    robot,
    pickStage,
    destinationPickGroups,
    destinationStage,
    destinations,
    transmissionGroup,
    powerPath,
    powerPulses,
    splashMesh,
    keyLight: key,
    ambientLight: hemi,
    state,
    setDestination,
    setOrientation,
    setPhase,
    setCasingPosition,
    installCasing,
    moveHose,
    connectHose,
    setDynamicState,
    setShaftSpeed,
    update,
    destinationStats,
    spatialSnapshot,
    stats() {
      let meshes = 0;
      let instanced = 0;
      let transparent = 0;
      let shadowCasters = 0;
      root.traverse((object) => {
        if (!object.isMesh) return;
        meshes += 1;
        if (object.isInstancedMesh) instanced += 1;
        if (object.castShadow) shadowCasters += 1;
        const mats = Array.isArray(object.material) ? object.material : [object.material];
        if (mats.some((material) => material?.transparent)) transparent += 1;
      });
      return { meshes, instanced, transparent, shadowCasters, splashCapacity: 48, powerPulseCapacity: 14 };
    },
  };
}
