/**
 * physicalSlideScene.ts — PhysicalSlideScene.
 *
 * Real hardware at real millimetres: a 75 x 25 x 1.0 mm slide with a 22 mm no. 1.5
 * coverslip and a frosted writing end, held by the spring clip of a mechanical stage
 * with vernier scales, under a four-position revolving nosepiece whose objectives
 * carry ISO 8578 magnification rings, lit from below through a substage condenser.
 *
 * Working distances are the objectives' own, so the 40x really does come down to
 * within about half a millimetre of the coverslip. That closing gap is the tension
 * just before the picture becomes a circle.
 */

import * as THREE from 'three';
import { COVERSLIP, HERO_SLIDE, SLIDE, TISSUE_ROT_RAD, TISSUE_POS_MM, TISSUE_PIVOT_Y } from '../micro/specimen';
import { OBJECTIVES } from '../micro/optics';

/** World frame: x along the slide, z across it, y up. The optical axis is x=z=0. */
export const STAGE_TOP_Y = 0;
export const SLIDE_TOP_Y = STAGE_TOP_Y + SLIDE.thicknessMM;
export const COVERSLIP_TOP_Y = SLIDE_TOP_Y + COVERSLIP.thicknessMM;

/** Slide-frame (x, y) millimetres to world position on the slide surface. */
export function slideToWorld(x: number, y: number, height = SLIDE_TOP_Y): THREE.Vector3 {
  return new THREE.Vector3(x, height, -y);
}

const METAL = 0x2b2f34;
const METAL_LIGHT = 0x51565d;

/**
 * The specimen on the glass is drawn with a plain pass-through shader rather than a
 * MeshBasicMaterial. The pyramid renders into linear-storage targets, and the built-in
 * material would apply an output colour-space conversion on the way out, washing the
 * H&E pink out to pastel and disagreeing with the microscope view of the same tissue.
 */
function specimenMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: null }, opacity: { value: 1 } },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D map;
      uniform float opacity;
      varying vec2 vUv;
      void main() {
        vec4 c = texture2D(map, vUv);
        if (c.a < 0.004) discard;
        gl_FragColor = vec4(c.rgb, c.a * opacity);
      }
    `,
    transparent: true,
    depthWrite: false,
  });
}

/** Köhler illumination seen from above: a bright pool that falls off at the aperture. */
function lampTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,252,242,1)');
  grad.addColorStop(0.62, 'rgba(255,246,226,0.96)');
  grad.addColorStop(0.86, 'rgba(255,238,206,0.62)');
  grad.addColorStop(1, 'rgba(255,232,196,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function labelTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f2efe6';
  g.fillRect(0, 0, 512, 256);
  // Frosted glass is speckled, and the ink bleeds a little into it.
  for (let i = 0; i < 5200; i++) {
    g.fillStyle = `rgba(${210 + Math.random() * 40},${208 + Math.random() * 40},${200 + Math.random() * 40},0.5)`;
    g.fillRect(Math.random() * 512, Math.random() * 256, 2, 2);
  }
  g.strokeStyle = 'rgba(140,140,146,0.35)';
  g.lineWidth = 3;
  g.strokeRect(10, 10, 492, 236);
  g.fillStyle = '#2b3a52';
  g.font = '600 54px ui-monospace, Menlo, monospace';
  g.fillText('S-26-0827', 34, 88);
  g.font = '44px ui-monospace, Menlo, monospace';
  g.fillText('SKIN  SCALP', 34, 152);
  g.fillText('H & E', 34, 214);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function verniersTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#c9ccd1';
  g.fillRect(0, 0, 1024, 64);
  g.strokeStyle = '#1d2024';
  // Ticks only. Engraved numerals on a stage scale are a couple of millimetres tall
  // and unreadable at any camera angle this game uses; drawing them just produced
  // garbled glyphs, which reads as a bug rather than as hardware.
  for (let i = 0; i <= 120; i++) {
    const x = (i / 120) * 1024;
    const major = i % 10 === 0;
    const mid = i % 5 === 0;
    g.lineWidth = major ? 3 : mid ? 2 : 1.2;
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, major ? 44 : mid ? 30 : 20);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A believable objective barrel: knurled body stepping down to a small front lens. */
function objectiveProfile(len: number, frontDia: number): THREE.Vector2[] {
  const rBody = 8.0;
  const rNose = Math.max(frontDia * 0.5 + 1.2, 2.6);
  return [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(rNose * 0.55, 0),
    new THREE.Vector2(rNose * 0.62, len * 0.035),
    new THREE.Vector2(rNose, len * 0.12),
    new THREE.Vector2(rBody * 0.78, len * 0.34),
    new THREE.Vector2(rBody, len * 0.44),
    new THREE.Vector2(rBody, len * 0.86),
    new THREE.Vector2(rBody * 0.92, len * 0.9),
    new THREE.Vector2(rBody * 0.92, len),
    new THREE.Vector2(0, len),
  ];
}

export interface ObjectiveNode {
  group: THREE.Group;
  index: number;
  /** Distance from the turret's own axis. */
  radius: number;
}

export class PhysicalSlideScene {
  readonly root = new THREE.Group();
  readonly slideGroup = new THREE.Group();
  readonly turret = new THREE.Group();
  readonly objectives: ObjectiveNode[] = [];
  private specimenMesh!: THREE.Mesh;
  private detailMesh!: THREE.Mesh;
  private detailPivot!: THREE.Group;
  private activeIndex = 0;
  private lamp!: THREE.PointLight;
  private lampDisc!: THREE.Mesh;
  private readonly disposables: Array<{ dispose(): void }> = [];

  constructor(private readonly rich: boolean) {
    this.buildBench();
    this.buildStage();
    this.buildSlide();
    this.buildOptics();
    this.buildLighting();
  }

  /** The pyramid's coarsest level doubles as the specimen texture on the glass. */
  setSpecimenTexture(tex: THREE.Texture): void {
    const m = this.specimenMesh.material as THREE.ShaderMaterial;
    m.uniforms.map.value = tex;
    this.specimenMesh.visible = true;
  }

  /** Places the sharp detail patch of the section on the glass. */
  setDetailPatch(tex: THREE.Texture | null, centreX: number, centreY: number, halfMM: number): void {
    if (!tex) {
      this.detailMesh.visible = false;
      return;
    }
    (this.detailMesh.material as THREE.ShaderMaterial).uniforms.map.value = tex;
    const cosR = Math.cos(TISSUE_ROT_RAD);
    const sinR = Math.sin(TISSUE_ROT_RAD);
    const dy = centreY - TISSUE_PIVOT_Y;
    const sx = TISSUE_POS_MM.x + (centreX * cosR + dy * sinR);
    const sy = TISSUE_POS_MM.y - (-centreX * sinR + dy * cosR);
    this.detailPivot.position.set(sx, SLIDE.thicknessMM + 0.006, -sy);
    this.detailMesh.scale.set(halfMM * 2, halfMM * 2, 1);
    this.detailMesh.visible = true;
  }

  /** Fades the objective the camera is about to fly through. */
  setActiveObjectiveOpacity(alpha: number): void {
    const node = this.objectives[this.activeIndex];
    if (!node) return;
    node.group.visible = alpha > 0.02;
    node.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const mat = mesh.material as (THREE.Material & { opacity: number }) | undefined;
      if (mat) mat.opacity = alpha;
    });
  }

  /**
   * Drives the mechanical stage. `travel` runs 1 -> 0 as the target point is walked
   * under the objective; `lift` is the fine-focus rise as the objective closes in.
   */
  setStage(travel: number, nudgeX: number, nudgeZ: number, lift: number): void {
    const startX = -9.2;
    const startZ = 4.4;
    this.slideGroup.position.set(
      -HERO_SLIDE.x + startX * travel + nudgeX,
      lift,
      HERO_SLIDE.y + startZ * travel + nudgeZ,
    );
  }

  /**
   * Seats an objective on the optical axis. `blend` walks the turret between the
   * previous position and the new one so the change reads as a mechanical rotation.
   */
  setObjective(index: number, blend: number, previous: number): void {
    const step = (2 * Math.PI) / OBJECTIVES.length;
    const from = -previous * step;
    const to = -index * step;
    this.turret.rotation.y = from + (to - from) * blend;

    this.activeIndex = index;
    for (const node of this.objectives) {
      if (node.index === index) continue;
      node.group.visible = true;
      node.group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        const mat = mesh.material as (THREE.Material & { opacity: number }) | undefined;
        if (mat) mat.opacity = 1;
      });
    }
  }

  /** How far the nosepiece has been racked down toward the coverslip. */
  setFocusHeight(objectiveIndex: number, approach: number): void {
    const obj = OBJECTIVES[Math.max(0, Math.min(objectiveIndex, OBJECTIVES.length - 1))];
    // Parked high before the objective engages, then down to its working distance.
    const parked = 34.0;
    const engaged = COVERSLIP_TOP_Y + obj.workingDistanceMM;
    const y = parked + (engaged - parked) * approach;
    this.turret.position.y = y + obj.barrelLengthMM;
  }

  /** World height of the front lens of the objective now on the optical axis. */
  frontLensHeight(objectiveIndex: number, approach: number): number {
    const obj = OBJECTIVES[Math.max(0, Math.min(objectiveIndex, OBJECTIVES.length - 1))];
    const parked = 34.0;
    const engaged = COVERSLIP_TOP_Y + obj.workingDistanceMM;
    return parked + (engaged - parked) * approach;
  }

  setLamp(intensity: number): void {
    this.lamp.intensity = intensity * 260;
    (this.lampDisc.material as THREE.MeshBasicMaterial).opacity = intensity;
  }

  /** Hide the objective once the camera has passed its front lens. */
  setObjectiveVisible(visible: boolean): void {
    this.turret.visible = visible;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
  }

  // ------------------------------------------------------------------ construction

  private buildBench(): void {
    const bench = new THREE.Mesh(
      new THREE.BoxGeometry(520, 8, 420),
      new THREE.MeshStandardMaterial({ color: 0x2a2e35, roughness: 0.92, metalness: 0.05 }),
    );
    bench.position.set(0, -62, -40);
    this.root.add(bench);

    // The arm and the base of the stand, well behind the specimen.
    const arm = new THREE.Mesh(
      new THREE.CylinderGeometry(17, 21, 150, 20),
      new THREE.MeshStandardMaterial({ color: METAL, roughness: 0.42, metalness: 0.72 }),
    );
    arm.position.set(0, 12, -104);
    arm.rotation.x = -0.06;
    this.root.add(arm);
  }

  private buildStage(): void {
    const plateMat = new THREE.MeshStandardMaterial({
      color: METAL,
      roughness: 0.34,
      metalness: 0.78,
    });
    // A mechanical stage plate with a central aperture for the condenser light.
    const shape = new THREE.Shape();
    shape.moveTo(-78, -62);
    shape.lineTo(78, -62);
    shape.lineTo(78, 62);
    shape.lineTo(-78, 62);
    shape.closePath();
    const hole = new THREE.Path();
    hole.absarc(0, 0, 15.5, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    const plate = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 5, bevelEnabled: false }), plateMat);
    plate.rotation.x = Math.PI / 2;
    plate.position.y = STAGE_TOP_Y;
    this.root.add(plate);

    // Spring clip that actually holds a slide down at its label end.
    const clipMat = new THREE.MeshStandardMaterial({ color: METAL_LIGHT, roughness: 0.3, metalness: 0.85 });
    const clipArm = new THREE.Mesh(new THREE.BoxGeometry(30, 2.2, 4), clipMat);
    clipArm.position.set(-44, SLIDE.thicknessMM + 1.1, 13.8);
    this.root.add(clipArm);
    const clipFinger = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.0, 9), clipMat);
    clipFinger.position.set(-31, SLIDE.thicknessMM + 1.1, 10.2);
    this.root.add(clipFinger);
    const clipPost = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.2, 9, 14), clipMat);
    clipPost.position.set(-58, 3, 14);
    this.root.add(clipPost);

    // The slide rests against a fixed ledge on the far side.
    const ledge = new THREE.Mesh(new THREE.BoxGeometry(120, 3.4, 3), plateMat);
    ledge.position.set(-8, 1.7, -14.6);
    this.root.add(ledge);

    if (this.rich) {
      const vt = verniersTexture();
      this.disposables.push(vt);
      const scaleMat = new THREE.MeshBasicMaterial({ map: vt });
      const xScale = new THREE.Mesh(new THREE.PlaneGeometry(120, 7), scaleMat);
      xScale.rotation.x = -Math.PI / 2;
      xScale.position.set(-4, STAGE_TOP_Y + 0.06, 34);
      this.root.add(xScale);
      const yScale = new THREE.Mesh(new THREE.PlaneGeometry(70, 7), scaleMat);
      yScale.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
      yScale.position.set(62, STAGE_TOP_Y + 0.06, 4);
      this.root.add(yScale);
    }
  }

  private buildSlide(): void {
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0xdfe9e6,
      roughness: 0.06,
      metalness: 0,
      transparent: true,
      opacity: 0.12,
      transmission: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(SLIDE.lengthMM, SLIDE.thicknessMM, SLIDE.widthMM),
      glassMat,
    );
    glass.position.set(0, SLIDE.thicknessMM / 2, 0);
    this.slideGroup.add(glass);

    // Ground edges catch the light: that bright rim is how you read glass on a stage.
    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(SLIDE.lengthMM, SLIDE.thicknessMM, SLIDE.widthMM)),
      new THREE.LineBasicMaterial({ color: 0xd8eef0, transparent: true, opacity: 0.55 }),
    );
    edge.position.copy(glass.position);
    this.slideGroup.add(edge);

    // Frosted writing end with the accession label.
    const lt = labelTexture();
    this.disposables.push(lt);
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(SLIDE.frostedLengthMM, SLIDE.widthMM - 0.6),
      new THREE.MeshStandardMaterial({ map: lt, roughness: 0.86, metalness: 0 }),
    );
    label.rotation.x = -Math.PI / 2;
    label.position.set(-SLIDE.lengthMM / 2 + SLIDE.frostedLengthMM / 2, SLIDE.thicknessMM + 0.006, 0);
    this.slideGroup.add(label);

    // The specimen itself, drawn from the coarsest pyramid level.
    const cover = 18.0;
    this.specimenMesh = new THREE.Mesh(new THREE.PlaneGeometry(cover, cover), specimenMaterial());
    this.specimenMesh.rotation.x = -Math.PI / 2;
    // Level 0 is centred on TISSUE (0, 2.75); place that point on the glass.
    const c = { x: 0, y: 2.75 };
    const cosR = Math.cos(TISSUE_ROT_RAD);
    const sinR = Math.sin(TISSUE_ROT_RAD);
    const dy = c.y - TISSUE_PIVOT_Y;
    const sx = TISSUE_POS_MM.x + (c.x * cosR + dy * sinR);
    const sy = TISSUE_POS_MM.y - (-c.x * sinR + dy * cosR);
    this.specimenMesh.position.set(0, 0, 0);
    this.specimenMesh.visible = false;
    // The section is mounted a few degrees off square. Rotating a pivot about world
    // up keeps that honest; folding it into the plane's own Euler angles shears it.
    const pivot = new THREE.Group();
    pivot.rotation.y = TISSUE_ROT_RAD;
    pivot.add(this.specimenMesh);
    pivot.position.set(sx, SLIDE.thicknessMM + 0.004, -sy);
    this.slideGroup.add(pivot);

    // A sharper patch of the same section, at whatever pyramid level the dive is
    // currently using, so the specimen the camera flies toward is the same picture
    // at the same resolution that the microscope view is about to show.
    this.detailMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), specimenMaterial());
    this.detailMesh.rotation.x = -Math.PI / 2;
    this.detailMesh.visible = false;
    this.detailPivot = new THREE.Group();
    this.detailPivot.rotation.y = TISSUE_ROT_RAD;
    this.detailPivot.add(this.detailMesh);
    this.slideGroup.add(this.detailPivot);

    // The region of interest, ringed in marker on the underside of the glass. This is
    // the small circular mark the dive is aimed at, and it is how pathologists really
    // flag a spot for a colleague.
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(3.12, 3.30, 72),
      new THREE.MeshBasicMaterial({
        color: 0x14161f,
        transparent: true,
        opacity: 0.62,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(HERO_SLIDE.x, 0.02, -HERO_SLIDE.y);
    this.slideGroup.add(ring);

    const coverslip = new THREE.Mesh(
      new THREE.BoxGeometry(COVERSLIP.sizeMM, COVERSLIP.thicknessMM, COVERSLIP.sizeMM),
      new THREE.MeshPhysicalMaterial({
        color: 0xe6f2f0,
        roughness: 0.02,
        metalness: 0,
        transparent: true,
        opacity: 0.13,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    coverslip.position.set(
      COVERSLIP.centreMM.x,
      SLIDE.thicknessMM + COVERSLIP.thicknessMM / 2,
      -COVERSLIP.centreMM.y,
    );
    this.slideGroup.add(coverslip);
    const coverEdge = new THREE.LineSegments(
      new THREE.EdgesGeometry(
        new THREE.BoxGeometry(COVERSLIP.sizeMM, COVERSLIP.thicknessMM, COVERSLIP.sizeMM),
      ),
      new THREE.LineBasicMaterial({ color: 0xeafcff, transparent: true, opacity: 0.5 }),
    );
    coverEdge.position.copy(coverslip.position);
    this.slideGroup.add(coverEdge);

    this.root.add(this.slideGroup);
  }

  private buildOptics(): void {
    const turretDisc = new THREE.Mesh(
      new THREE.CylinderGeometry(30, 30, 11, 40),
      new THREE.MeshStandardMaterial({ color: METAL, roughness: 0.3, metalness: 0.85 }),
    );
    turretDisc.position.y = 5.5;
    this.turret.add(turretDisc);

    const radius = 19.5;
    OBJECTIVES.forEach((obj, i) => {
      const group = new THREE.Group();
      const angle = (i / OBJECTIVES.length) * Math.PI * 2;
      group.position.set(Math.sin(angle) * radius, 0, Math.cos(angle) * radius);

      const barrel = new THREE.Mesh(
        new THREE.LatheGeometry(objectiveProfile(obj.barrelLengthMM, obj.frontDiaMM), 30),
        new THREE.MeshStandardMaterial({
          color: 0x1b1e22,
          roughness: 0.32,
          metalness: 0.8,
          transparent: true,
        }),
      );
      barrel.position.y = -obj.barrelLengthMM;
      group.add(barrel);

      // ISO 8578 magnification ring: red 4x, yellow 10x, green 20x, light blue 40x.
      const ring = new THREE.Mesh(
        new THREE.CylinderGeometry(4.3, 4.3, 2.6, 28),
        new THREE.MeshStandardMaterial({
          color: obj.ringColor,
          roughness: 0.42,
          metalness: 0.25,
          transparent: true,
        }),
      );
      ring.position.y = -obj.barrelLengthMM + obj.barrelLengthMM * 0.20;
      group.add(ring);

      const lens = new THREE.Mesh(
        new THREE.SphereGeometry(obj.frontDiaMM * 0.5, 20, 12, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45),
        new THREE.MeshPhysicalMaterial({
          color: 0xbfe4ea,
          roughness: 0.03,
          metalness: 0.1,
          transparent: true,
          opacity: 0.55,
        }),
      );
      lens.position.y = -obj.barrelLengthMM + obj.frontDiaMM * 0.24;
      group.add(lens);

      this.turret.add(group);
      this.objectives.push({ group, index: i, radius });
    });

    this.turret.position.set(0, 60, 0);
    this.root.add(this.turret);

    // Substage condenser, under the stage aperture.
    const condenser = new THREE.Mesh(
      new THREE.CylinderGeometry(13, 9.5, 16, 26),
      new THREE.MeshStandardMaterial({ color: METAL, roughness: 0.35, metalness: 0.8 }),
    );
    condenser.position.y = -14;
    this.root.add(condenser);

    const lt = lampTexture();
    this.disposables.push(lt);
    this.lampDisc = new THREE.Mesh(
      new THREE.CircleGeometry(13.5, 48),
      new THREE.MeshBasicMaterial({
        map: lt,
        transparent: true,
        opacity: 1,
        depthWrite: false,
      }),
    );
    this.lampDisc.rotation.x = -Math.PI / 2;
    this.lampDisc.position.y = -5.2;
    this.root.add(this.lampDisc);
  }

  private buildLighting(): void {
    this.root.add(new THREE.AmbientLight(0x9aabbd, 1.15));
    const key = new THREE.DirectionalLight(0xfff3e2, 2.4);
    key.position.set(-70, 120, 90);
    this.root.add(key);
    const fill = new THREE.DirectionalLight(0x9fb8d8, 1.0);
    fill.position.set(90, 45, -70);
    this.root.add(fill);
    // Transmitted brightfield illumination, coming up through the specimen.
    this.lamp = new THREE.PointLight(0xffe9c8, 260, 190, 2);
    this.lamp.position.set(0, -7, 0);
    this.root.add(this.lamp);
  }
}
