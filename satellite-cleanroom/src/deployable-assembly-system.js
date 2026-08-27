// Mechanical solar-array and antenna assemblies for the satellite bus.
//
// The public model uses only mechanical deployment vocabulary. A caller drives
// each mechanism with a normalized 0..1 value; the system maps that
// value onto explicit root-hinge, accordion-hinge, final-settle and lock stages.

import * as THREE from 'three';

const SIDES = Object.freeze(['left', 'right']);
const PANEL_SECTIONS = 3;
const CELL_COLUMNS = 5;
const CELL_ROWS = 4;
const CELLS_PER_PANEL = CELL_COLUMNS * CELL_ROWS;
const TAU = Math.PI * 2;
// A small launch-latch cant keeps the folded navy face legible in the test and
// orbit-wide cameras without changing the deployed sweep footprint.
const FOLDED_ROOT_ANGLE = THREE.MathUtils.degToRad(76);

const MISSION_ALIASES = Object.freeze({
  weather: 'weather', cloud: 'weather', clouds: 'weather', meteorology: 'weather',
  ocean: 'ocean', sea: 'ocean', marine: 'ocean',
  communication: 'communication', communications: 'communication', comms: 'communication',
});

const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

function smoothRange(value, start, end) {
  if (end <= start) return value >= end ? 1 : 0;
  const t = clamp01((value - start) / (end - start));
  return t * t * (3 - 2 * t);
}

function normalizeMission(value) {
  const key = String(value || 'weather').trim().toLowerCase();
  return MISSION_ALIASES[key] || 'weather';
}

function vectorFrom(value, fallback) {
  if (value?.isVector3) return value.clone();
  if (Array.isArray(value) && value.length >= 3 && value.slice(0, 3).every(Number.isFinite)) {
    return new THREE.Vector3(value[0], value[1], value[2]);
  }
  return new THREE.Vector3(...fallback);
}

function resolveMaterial(source, names, factory, owned) {
  for (const name of names) {
    if (source?.[name]?.isMaterial) return source[name];
  }
  const material = factory();
  owned.add(material);
  return material;
}

function makeParabolicDishGeometry(radius, depth, radialSegments = 32, rings = 7) {
  // LatheGeometry makes a true shallow paraboloid rather than a flattened disc.
  // The surface is open at the rim and faces +Y in its local coordinates.
  const profile = [];
  for (let ring = 0; ring <= rings; ring += 1) {
    const r = radius * ring / rings;
    const y = depth * (r / radius) ** 2;
    profile.push(new THREE.Vector2(r, y));
  }
  const geometry = new THREE.LatheGeometry(profile, radialSegments);
  geometry.computeVertexNormals();
  return geometry;
}

function cylinderBetween(from, to, radius, material) {
  const direction = to.clone().sub(from);
  const length = Math.max(0.001, direction.length());
  const geometry = new THREE.CylinderGeometry(radius, radius, length, 8);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(from).add(to).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return mesh;
}

function stageFor(progress) {
  if (progress <= 0.0001) return 'folded';
  if (progress < 0.30) return 'stage1';
  if (progress < 0.66) return 'stage2';
  if (progress < 0.91) return 'full';
  if (progress < 0.999) return 'locking';
  return 'locked';
}

/**
 * Procedural, three-section solar arrays and a mission-specific antenna.
 *
 * @param {THREE.Object3D} parent scene/group that owns the satellite hardware
 * @param {object} options
 * @param {'weather'|'ocean'|'communication'} options.mission
 * @param {object} options.materials optional shared Three.js materials
 * @param {boolean|object} options.installed initial install visibility
 */
export class DeployableAssemblySystem {
  constructor(parent, {
    mission = 'weather',
    materials = {},
    installed = false,
    busHalfWidth = 1.18,
    panelWidth = 0.92,
    panelHeight = 1.24,
    panelThickness = 0.045,
    arrayY = 0,
    antennaPosition = [0, 1.42, 0],
  } = {}) {
    if (!parent?.isObject3D || typeof parent.add !== 'function') {
      throw new TypeError('DeployableAssemblySystem requires a THREE.Object3D parent');
    }

    this.parent = parent;
    this.mission = normalizeMission(mission);
    this._ownedMaterials = new Set();
    this._disposed = false;
    this.dimensions = Object.freeze({
      busHalfWidth,
      panelWidth,
      panelHeight,
      panelThickness,
      sections: PANEL_SECTIONS,
    });
    this.antennaPosition = vectorFrom(antennaPosition, [0, 1.42, 0]);

    this.materials = Object.freeze({
      cell: resolveMaterial(materials, ['solarCell', 'cell'], () => new THREE.MeshPhysicalMaterial({
        color: 0x07162f,
        roughness: 0.2,
        metalness: 0.64,
        clearcoat: 0.22,
        clearcoatRoughness: 0.16,
      }), this._ownedMaterials),
      frame: resolveMaterial(materials, ['solarFrame', 'frame', 'structuralMetal'], () => new THREE.MeshStandardMaterial({
        color: 0xadb7bf, roughness: 0.34, metalness: 0.72,
      }), this._ownedMaterials),
      back: resolveMaterial(materials, ['arrayBack', 'blackRadiator', 'radiator'], () => new THREE.MeshStandardMaterial({
        color: 0x111820, roughness: 0.72, metalness: 0.28,
      }), this._ownedMaterials),
      hinge: resolveMaterial(materials, ['hinge', 'rail', 'aluminiumDark', 'structuralMetal', 'frame'], () => new THREE.MeshStandardMaterial({
        color: 0x6f7d88, roughness: 0.3, metalness: 0.82,
      }), this._ownedMaterials),
      lock: resolveMaterial(materials, ['lock', 'cyanGlow', 'electronicsGlow', 'glow'], () => new THREE.MeshStandardMaterial({
        color: 0xb9d9e7,
        roughness: 0.24,
        metalness: 0.52,
        emissive: 0x4da9cf,
        emissiveIntensity: 0.5,
      }), this._ownedMaterials),
      antennaWhite: resolveMaterial(materials, ['antennaWhite', 'aluminium', 'whitePaint', 'paintedAluminium'], () => new THREE.MeshPhysicalMaterial({
        color: 0xe6ecef, roughness: 0.38, metalness: 0.24, clearcoat: 0.08,
        side: THREE.DoubleSide,
      }), this._ownedMaterials),
      antennaDark: resolveMaterial(materials, ['antennaDark', 'blackRadiator', 'radiator'], () => new THREE.MeshStandardMaterial({
        color: 0x17212a, roughness: 0.66, metalness: 0.3,
      }), this._ownedMaterials),
      antennaAccent: resolveMaterial(materials, ['antennaAccent', 'cyanGlow', 'electronicsGlow', 'glow'], () => new THREE.MeshStandardMaterial({
        color: 0x81cde5,
        emissive: 0x248db4,
        emissiveIntensity: 0.72,
        roughness: 0.32,
        metalness: 0.2,
      }), this._ownedMaterials),
    });

    this.root = new THREE.Group();
    this.root.name = 'deployable-assembly-system';
    parent.add(this.root);

    this.arrayRoot = new THREE.Group();
    this.arrayRoot.name = 'solar-array-assemblies';
    this.root.add(this.arrayRoot);

    this._arrays = {
      left: this._buildArray('left', -1, arrayY),
      right: this._buildArray('right', 1, arrayY),
    };

    this.antennaRoot = new THREE.Group();
    this.antennaRoot.name = 'mission-antenna-root';
    this.antennaRoot.position.copy(this.antennaPosition);
    this.root.add(this.antennaRoot);
    this._antenna = null;
    this._buildAntenna();

    const initial = typeof installed === 'object' && installed !== null
      ? installed
      : { left: !!installed, right: !!installed, antenna: !!installed };
    this.setInstalled('left', !!initial.left);
    this.setInstalled('right', !!initial.right);
    this.setInstalled('antenna', !!initial.antenna);
    this.setDeployment('left', 0);
    this.setDeployment('right', 0);
    this.setAntennaDeployment(0);
  }

  _buildArray(name, direction, arrayY) {
    const { busHalfWidth, panelWidth, panelHeight, panelThickness } = this.dimensions;
    const root = new THREE.Group();
    root.name = `${name}-solar-array`;
    root.position.set(direction * (busHalfWidth + 0.035), arrayY, 0);
    this.arrayRoot.add(root);

    const pivots = [];
    const panels = [];
    const locks = [];
    let parentPivot = root;

    for (let section = 0; section < PANEL_SECTIONS; section += 1) {
      const pivot = new THREE.Group();
      pivot.name = `${name}-array-hinge-${section + 1}`;
      if (section > 0) pivot.position.x = direction * panelWidth;
      parentPivot.add(pivot);

      const hinge = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045, 0.045, panelHeight * 1.035, 12),
        this.materials.hinge,
      );
      hinge.name = `${name}-hinge-bar-${section + 1}`;
      hinge.castShadow = section === 0;
      pivot.add(hinge);

      const hingeCapGeometry = new THREE.CylinderGeometry(0.062, 0.062, 0.028, 12);
      for (const y of [-panelHeight * 0.52, panelHeight * 0.52]) {
        const cap = new THREE.Mesh(hingeCapGeometry, this.materials.frame);
        cap.position.y = y;
        pivot.add(cap);
      }

      const panel = this._buildPanel(name, section, direction);
      panel.position.x = direction * panelWidth * 0.5;
      panel.userData.stackOffset = section * panelThickness * 1.5;
      pivot.add(panel);

      const lock = new THREE.Mesh(
        new THREE.BoxGeometry(0.11, 0.16, 0.055),
        this.materials.lock,
      );
      lock.name = `${name}-array-lock-${section + 1}`;
      lock.position.set(
        direction * (panelWidth - 0.095),
        panelHeight * 0.34,
        panelThickness * 0.86,
      );
      lock.visible = false;
      pivot.add(lock);

      pivots.push(pivot);
      panels.push(panel);
      locks.push(lock);
      parentPivot = pivot;
    }

    return {
      name,
      direction,
      root,
      pivots,
      panels,
      locks,
      installed: false,
      progress: 0,
      stage: 'folded',
      locked: false,
      hingeAngles: [0, 0, 0],
    };
  }

  _buildPanel(sideName, section, direction) {
    const { panelWidth, panelHeight, panelThickness } = this.dimensions;
    const body = new THREE.Group();
    body.name = `${sideName}-solar-panel-${section + 1}`;

    const back = new THREE.Mesh(
      new THREE.BoxGeometry(panelWidth, panelHeight, panelThickness),
      this.materials.back,
    );
    back.name = `${sideName}-solar-backsheet-${section + 1}`;
    back.castShadow = section === 0;
    back.receiveShadow = true;
    body.add(back);

    const frameGeometry = new THREE.BoxGeometry(1, 1, 1);
    const frameDepth = panelThickness * 1.28;
    const rail = 0.045;
    const frameTransforms = [
      { position: [0, panelHeight / 2 - rail / 2, panelThickness * 0.2], scale: [panelWidth, rail, frameDepth] },
      { position: [0, -panelHeight / 2 + rail / 2, panelThickness * 0.2], scale: [panelWidth, rail, frameDepth] },
      { position: [-panelWidth / 2 + rail / 2, 0, panelThickness * 0.2], scale: [rail, panelHeight, frameDepth] },
      { position: [panelWidth / 2 - rail / 2, 0, panelThickness * 0.2], scale: [rail, panelHeight, frameDepth] },
      { position: [0, 0, panelThickness * 0.2], scale: [rail * 0.72, panelHeight - rail * 2, frameDepth] },
    ];
    const frame = new THREE.InstancedMesh(frameGeometry, this.materials.frame, frameTransforms.length);
    frame.name = `${sideName}-panel-frame-${section + 1}`;
    const frameDummy = new THREE.Object3D();
    frameTransforms.forEach((transform, index) => {
      frameDummy.position.set(...transform.position);
      frameDummy.scale.set(...transform.scale);
      frameDummy.updateMatrix();
      frame.setMatrixAt(index, frameDummy.matrix);
    });
    frame.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    body.add(frame);

    const cellGapX = 0.018;
    const cellGapY = 0.018;
    const usableWidth = panelWidth - rail * 2.5;
    const usableHeight = panelHeight - rail * 2.5;
    const cellWidth = usableWidth / CELL_COLUMNS - cellGapX;
    const cellHeight = usableHeight / CELL_ROWS - cellGapY;
    const cellGeometry = new THREE.BoxGeometry(cellWidth, cellHeight, 0.012);
    const cells = new THREE.InstancedMesh(cellGeometry, this.materials.cell, CELLS_PER_PANEL);
    cells.name = `${sideName}-solar-cells-${section + 1}`;
    const cellDummy = new THREE.Object3D();
    let cellIndex = 0;
    for (let row = 0; row < CELL_ROWS; row += 1) {
      for (let column = 0; column < CELL_COLUMNS; column += 1) {
        cellDummy.position.set(
          -usableWidth / 2 + (column + 0.5) * usableWidth / CELL_COLUMNS,
          -usableHeight / 2 + (row + 0.5) * usableHeight / CELL_ROWS,
          panelThickness / 2 + 0.008,
        );
        // Mirroring the order keeps the busbar rhythm coherent on both wings.
        cellDummy.rotation.set(0, direction < 0 ? Math.PI : 0, 0);
        cellDummy.scale.set(1, 1, 1);
        cellDummy.updateMatrix();
        cells.setMatrixAt(cellIndex++, cellDummy.matrix);
      }
    }
    cells.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    cells.castShadow = false;
    cells.receiveShadow = false;
    body.add(cells);

    body.userData.cellCount = CELLS_PER_PANEL;
    return body;
  }

  _buildAntenna() {
    if (this._antenna?.assembly) {
      const old = this._antenna.assembly;
      this.antennaRoot.remove(old);
      old.traverse((object) => object.geometry?.dispose?.());
    }

    const assembly = new THREE.Group();
    assembly.name = `${this.mission}-antenna-assembly`;
    this.antennaRoot.add(assembly);

    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.23, 0.27, 0.16, 16),
      this.materials.hinge,
    );
    base.position.y = 0.08;
    assembly.add(base);

    const baseRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.205, 0.025, 8, 20),
      this.materials.lock,
    );
    baseRing.rotation.x = Math.PI / 2;
    baseRing.position.y = 0.16;
    assembly.add(baseRing);

    const boomPivot = new THREE.Group();
    boomPivot.name = 'antenna-boom-hinge';
    boomPivot.position.y = 0.16;
    assembly.add(boomPivot);

    const boomLength = 0.58;
    const boomGeometry = new THREE.CylinderGeometry(0.035, 0.045, 1, 10);
    boomGeometry.translate(0, 0.5, 0);
    const boom = new THREE.Mesh(boomGeometry, this.materials.hinge);
    boom.name = 'antenna-telescoping-boom';
    boomPivot.add(boom);

    const headAnchor = new THREE.Group();
    headAnchor.name = 'antenna-head-anchor';
    boomPivot.add(headAnchor);
    const missionHead = this._makeMissionAntennaHead();
    headAnchor.add(missionHead.group);

    this._antenna = {
      assembly,
      boomPivot,
      boom,
      boomLength,
      headAnchor,
      missionHead,
      lockRing: baseRing,
      installed: this._antenna?.installed || false,
      progress: 0,
      stage: 'folded',
      locked: false,
    };
    assembly.visible = this._antenna.installed;
  }

  _makeMissionAntennaHead() {
    if (this.mission === 'ocean') return this._makeOceanAntenna();
    if (this.mission === 'communication') return this._makeCommunicationAntenna();
    return this._makeWeatherAntenna();
  }

  _makeWeatherAntenna() {
    const group = new THREE.Group();
    group.name = 'weather-gimballed-antenna';

    const gimbal = new THREE.Mesh(
      new THREE.TorusGeometry(0.23, 0.025, 8, 24),
      this.materials.hinge,
    );
    gimbal.rotation.x = Math.PI / 2;
    group.add(gimbal);

    const dish = new THREE.Mesh(
      makeParabolicDishGeometry(0.28, 0.075, 28, 6),
      this.materials.antennaWhite,
    );
    dish.name = 'weather-small-dish';
    group.add(dish);

    const aperture = new THREE.Mesh(
      new THREE.CylinderGeometry(0.058, 0.072, 0.12, 12),
      this.materials.antennaAccent,
    );
    aperture.position.y = 0.14;
    group.add(aperture);

    return {
      kind: 'gimballed-weather-dish',
      group,
      setUnfold(progress) {
        const p = clamp01(progress);
        group.rotation.z = (1 - p) * 0.42;
        group.scale.setScalar(0.72 + p * 0.28);
      },
    };
  }

  _makeOceanAntenna() {
    const group = new THREE.Group();
    group.name = 'ocean-planar-radiometer';

    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(0.72, 0.055, 0.36),
      this.materials.antennaWhite,
    );
    frame.name = 'ocean-sensor-frame';
    group.add(frame);

    const face = new THREE.Mesh(
      new THREE.BoxGeometry(0.62, 0.018, 0.27),
      this.materials.antennaDark,
    );
    face.position.y = 0.038;
    group.add(face);

    const stripeGeometry = new THREE.BoxGeometry(0.012, 0.012, 0.245);
    for (let index = -2; index <= 2; index += 1) {
      const stripe = new THREE.Mesh(stripeGeometry, this.materials.antennaAccent);
      stripe.position.set(index * 0.105, 0.052, 0);
      group.add(stripe);
    }

    return {
      kind: 'planar-ocean-radiometer',
      group,
      setUnfold(progress) {
        const p = clamp01(progress);
        group.rotation.z = (1 - p) * Math.PI * 0.48;
        group.scale.set(0.28 + p * 0.72, 1, 0.7 + p * 0.3);
      },
    };
  }

  _makeCommunicationAntenna() {
    const group = new THREE.Group();
    group.name = 'communication-ribbed-dish';

    const dishRadius = 0.55;
    const dish = new THREE.Mesh(
      makeParabolicDishGeometry(dishRadius, 0.16, 36, 8),
      this.materials.antennaWhite,
    );
    dish.name = 'communication-large-dish';
    group.add(dish);

    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(dishRadius, 0.018, 7, 36),
      this.materials.hinge,
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.16;
    group.add(rim);

    for (let index = 0; index < 8; index += 1) {
      const angle = index / 8 * TAU;
      const end = new THREE.Vector3(
        Math.cos(angle) * dishRadius * 0.96,
        0.15,
        Math.sin(angle) * dishRadius * 0.96,
      );
      const rib = cylinderBetween(new THREE.Vector3(0, 0.01, 0), end, 0.009, this.materials.hinge);
      group.add(rib);
    }

    const feedBoom = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.024, 0.34, 8),
      this.materials.hinge,
    );
    feedBoom.position.y = 0.17;
    group.add(feedBoom);
    const feed = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 12, 8),
      this.materials.antennaAccent,
    );
    feed.position.y = 0.35;
    group.add(feed);

    return {
      kind: 'ribbed-communication-dish',
      group,
      setUnfold(progress) {
        const p = clamp01(progress);
        const radial = 0.18 + p * 0.82;
        group.scale.set(radial, 0.55 + p * 0.45, radial);
        group.rotation.z = (1 - p) * 0.3;
      },
    };
  }

  /** Show/hide hardware when the player attaches it to the satellite. */
  setInstalled(part, value = true) {
    const installed = !!value;
    if (part === 'all') {
      SIDES.forEach((side) => this.setInstalled(side, installed));
      this.setInstalled('antenna', installed);
      return this.stats;
    }
    if (part === 'arrays' || part === 'both') {
      SIDES.forEach((side) => this.setInstalled(side, installed));
      return this.stats;
    }
    if (SIDES.includes(part)) {
      const assembly = this._arrays[part];
      assembly.installed = installed;
      assembly.root.visible = installed;
      this._applyArrayDeployment(assembly, assembly.progress);
      return this.stats;
    }
    if (part === 'antenna') {
      this._antenna.installed = installed;
      this._antenna.assembly.visible = installed;
      return this.stats;
    }
    throw new RangeError(`Unknown deployable part: ${part}`);
  }

  install(part) { return this.setInstalled(part, true); }

  setVisible(value) {
    this.root.visible = !!value;
    return this.stats;
  }

  /**
   * Map 0..1 input onto root swing, two accordion hinges, straightening and lock.
   * `side` may be left/right/both/arrays/antenna.
   */
  setDeployment(side, value) {
    if (side === 'antenna') return this.setAntennaDeployment(value);
    if (side === 'both' || side === 'arrays') {
      SIDES.forEach((name) => this._applyArrayDeployment(this._arrays[name], value));
      return this.stats;
    }
    if (!SIDES.includes(side)) throw new RangeError(`Unknown solar-array side: ${side}`);
    this._applyArrayDeployment(this._arrays[side], value);
    return this.stats;
  }

  _applyArrayDeployment(assembly, value) {
    const progress = clamp01(value);
    const rootSwing = smoothRange(progress, 0.015, 0.28);
    const secondUnfold = smoothRange(progress, 0.25, 0.62);
    const thirdUnfold = smoothRange(progress, 0.58, 0.90);
    const straightening = smoothRange(progress, 0.87, 0.955);
    const lockProgress = smoothRange(progress, 0.92, 1);
    const direction = assembly.direction;

    // The final small settle is mechanical: it removes the last two degrees
    // only after every panel has reached its nominal line.
    const residual = (1 - straightening) * THREE.MathUtils.degToRad(2.2);
    const angles = [
      -direction * (FOLDED_ROOT_ANGLE * (1 - rootSwing) + residual),
      direction * (Math.PI * (1 - secondUnfold) + residual * 0.65),
      direction * (Math.PI * (1 - thirdUnfold) - residual * 0.45),
    ];
    assembly.pivots.forEach((pivot, index) => {
      pivot.rotation.y = angles[index];
      const localUnfold = index === 0 ? rootSwing : index === 1 ? secondUnfold : thirdUnfold;
      assembly.panels[index].position.z = assembly.panels[index].userData.stackOffset * (1 - localUnfold);
      const lock = assembly.locks[index];
      // The compact latch remains visible during launch stow, then grows and
      // rotates into the conspicuous on-orbit deployment lock.
      lock.visible = assembly.installed;
      lock.rotation.z = direction * (1 - lockProgress) * 0.7;
      lock.scale.set(0.72 + lockProgress * 0.28, 0.22 + lockProgress * 0.78, 0.72 + lockProgress * 0.28);
    });

    assembly.progress = progress;
    assembly.stage = stageFor(progress);
    assembly.locked = progress >= 0.999;
    assembly.hingeAngles = angles;
  }

  setAntennaDeployment(value) {
    const progress = clamp01(value);
    const lift = smoothRange(progress, 0.02, 0.47);
    const unfold = smoothRange(progress, 0.38, 0.84);
    const straightening = smoothRange(progress, 0.80, 0.94);
    const lockProgress = smoothRange(progress, 0.88, 1);
    const antenna = this._antenna;

    antenna.boomPivot.rotation.x = -(1 - lift) * Math.PI / 2 - (1 - straightening) * 0.025;
    const extension = 0.34 + lift * 0.66;
    antenna.boom.scale.set(1, antenna.boomLength * extension, 1);
    antenna.headAnchor.position.y = antenna.boomLength * extension;
    antenna.missionHead.setUnfold(unfold);
    antenna.lockRing.visible = lockProgress > 0.01;
    antenna.lockRing.scale.setScalar(0.7 + lockProgress * 0.3);
    antenna.lockRing.rotation.y = (1 - lockProgress) * Math.PI * 0.35;

    antenna.progress = progress;
    antenna.stage = stageFor(progress);
    antenna.locked = progress >= 0.999;
    return this.stats;
  }

  setMission(value) {
    const next = normalizeMission(value);
    if (next === this.mission) return this.stats;
    const installed = this._antenna.installed;
    const progress = this._antenna.progress;
    this.mission = next;
    this._buildAntenna();
    this.setInstalled('antenna', installed);
    this.setAntennaDeployment(progress);
    return this.stats;
  }

  /** Return every mechanism to its carried, uninstalled state for replay. */
  reset() {
    this.root.visible = true;
    this.setDeployment('left', 0);
    this.setDeployment('right', 0);
    this.setAntennaDeployment(0);
    this.setInstalled('all', false);
    return this.stats;
  }

  get stats() {
    const arrays = {};
    for (const side of SIDES) {
      const assembly = this._arrays[side];
      arrays[side] = Object.freeze({
        installed: assembly.installed,
        visible: assembly.root.visible && this.root.visible,
        progress: +assembly.progress.toFixed(4),
        stage: assembly.stage,
        locked: assembly.locked,
        sections: PANEL_SECTIONS,
        hingeAngles: assembly.hingeAngles.map((angle) => +angle.toFixed(4)),
        cellInstances: PANEL_SECTIONS * CELLS_PER_PANEL,
      });
    }
    return Object.freeze({
      mission: this.mission,
      visible: this.root.visible,
      installed: Object.freeze({
        left: this._arrays.left.installed,
        right: this._arrays.right.installed,
        antenna: this._antenna.installed,
      }),
      arrays: Object.freeze(arrays),
      antenna: Object.freeze({
        installed: this._antenna.installed,
        visible: this._antenna.assembly.visible && this.root.visible,
        kind: this._antenna.missionHead.kind,
        progress: +this._antenna.progress.toFixed(4),
        stage: this._antenna.stage,
        locked: this._antenna.locked,
      }),
      cellInstances: SIDES.length * PANEL_SECTIONS * CELLS_PER_PANEL,
      cellInstancedMeshes: SIDES.length * PANEL_SECTIONS,
      complete: this._arrays.left.locked && this._arrays.right.locked && this._antenna.locked,
    });
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this.root.traverse((object) => object.geometry?.dispose?.());
    for (const material of this._ownedMaterials) material.dispose();
    this.parent.remove(this.root);
    this.root.clear();
  }
}

export const DEPLOYABLE_ASSEMBLY_SPEC = Object.freeze({
  sectionsPerArray: PANEL_SECTIONS,
  cellColumns: CELL_COLUMNS,
  cellRows: CELL_ROWS,
  cellsPerPanel: CELLS_PER_PANEL,
  stages: Object.freeze(['folded', 'stage1', 'stage2', 'full', 'locking', 'locked']),
});
