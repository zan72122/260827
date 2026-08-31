import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { PaperTree } from './paper/tree';
import { buildStand } from './scene/stand';
import { buildWorkshop } from './scene/workshop';
import { buildLighting } from './lighting';
import { buildTextures, disposeTextures, type Textures } from './textures';
import { OpenControl } from './input';
import { PaperAudio } from './audio';
import { Hint } from './hint';
import { QUALITY, ORDER, detectQuality, type QualityName } from './quality';
import {
  applyFraming,
  establishing,
  frameFor,
  lerpFraming,
  type Framing,
} from './cameraRig';
import { CLASP_ON } from './config';

/** How the closed stack is turned to face the camera. */
/**
 * How the paper is turned on the bench. Chosen so the shut stack reads as a
 * three-quarter view of the cover plus its layered edge, and so the seam where
 * the two covers finally meet comes back round to the front of the tree where
 * the child can see it close.
 */
const TREE_YAW = THREE.MathUtils.degToRad(-37);

const INTRO_SECONDS = 1.5;
const BLACK = new THREE.Color(0, 0, 0);

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(33, 1, 0.02, 6);
  private lastTime = performance.now();

  private textures: Textures;
  private tree: PaperTree;
  private control: OpenControl;
  private audio = new PaperAudio();
  private hint = new Hint();
  private meter = document.getElementById('meter') as HTMLElement;
  private meterBar = this.meter.firstElementChild as HTMLElement;

  private quality: QualityName;
  private lighting!: ReturnType<typeof buildLighting>;
  private workshop!: THREE.Group;
  private stand!: THREE.Group;

  private framing: Framing;
  private introT = 0;
  private introSkipped = false;
  private frameHandle = 0;
  private disposed = false;

  private probe: THREE.WebGLRenderTarget | null = null;
  private grabScratch: THREE.Vector3[] = [];
  private tmp = new THREE.Vector3();
  private sunView = new THREE.Vector3();

  private fpsAccum = 0;
  private fpsFrames = 0;
  fps = 0;
  private wasClasped = false;

  constructor(host: HTMLElement) {
    this.quality = detectQuality();
    const q = QUALITY[this.quality];

    this.renderer = new THREE.WebGLRenderer({
      antialias: q.antialias,
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    host.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x6f6a60);
    // A cheap indoor environment so the steel reads as steel and the paper
    // picks up a little room light instead of going flat black in the cells.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.30;
    pmrem.dispose();

    this.textures = buildTextures(q.textureDetail);
    this.tree = new PaperTree(this.textures);
    this.tree.group.rotation.y = TREE_YAW;
    this.scene.add(this.tree.group);

    this.stand = buildStand(this.textures);
    this.stand.rotation.y = TREE_YAW;
    this.scene.add(this.stand);

    this.buildForQuality();

    this.framing = frameFor(window.innerWidth, window.innerHeight);
    applyFraming(this.camera, establishing(this.framing));

    this.control = new OpenControl(this.renderer.domElement, (x, y) => this.hitTest(x, y));
    this.control.onFirstInput = () => {
      this.introSkipped = true;
      this.hint.kill();
      this.audio.start();
      this.meter.classList.add('on');
    };

    window.addEventListener('resize', this.onResize);
    window.addEventListener('orientationchange', this.onResize);
    document.getElementById('gear')?.addEventListener('click', this.cycleQuality);

    this.onResize();
    this.loop();
  }

  private buildForQuality() {
    const q = QUALITY[this.quality];
    this.renderer.shadowMap.enabled = q.shadows;
    this.lighting = buildLighting(q.shadows, q.shadowSize);
    this.scene.add(this.lighting.group);
    this.workshop = buildWorkshop(this.textures, q.backgroundDetail);
    this.scene.add(this.workshop);
    this.tree.setTranslucency(0.55);
    this.applyShadowFlags(q.shadows);
  }

  private applyShadowFlags(on: boolean) {
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (!on) {
        m.castShadow = false;
      }
    });
    if (on) {
      this.tree.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.castShadow = true;
      });
      this.stand.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.castShadow = true;
      });
    }
  }

  private teardownScenery() {
    this.lighting.sun.shadow.map?.dispose();
    this.lighting.sun.dispose();
    this.lighting.bounce.dispose();
    this.lighting.fill.dispose();
    this.scene.remove(this.lighting.group);
    this.scene.remove(this.workshop);
    (this.workshop.userData.dispose as (() => void) | undefined)?.();
    this.workshop.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry?.dispose?.();
    });
  }

  private cycleQuality = () => {
    const next = ORDER[(ORDER.indexOf(this.quality) + 1) % ORDER.length];
    this.setQuality(next);
  };

  setQuality(name: QualityName) {
    if (name === this.quality) return;
    this.teardownScenery();
    this.quality = name;
    this.buildForQuality();
    this.onResize();
  }

  get qualityName() {
    return this.quality;
  }

  private onResize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const q = QUALITY[this.quality];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // The opening value lives in the controller, so a rotation never loses it.
    this.framing = frameFor(w, h);
    this.control.resize();
    if (this.introSkipped || this.introT >= 1) applyFraming(this.camera, this.framing);
  };

  /**
   * Screen-space hit test. The grab target is generous (about 80 CSS px across
   * at the cardboard edge, and the whole paper body after that) without the
   * paper itself being made any thicker than paper.
   */
  private hitTest(cx: number, cy: number): boolean {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const project = (p: THREE.Vector3) => {
      this.tmp.copy(p).applyMatrix4(this.tree.group.matrixWorld).project(this.camera);
      return {
        x: rect.left + ((this.tmp.x + 1) / 2) * rect.width,
        y: rect.top + ((1 - this.tmp.y) / 2) * rect.height,
        z: this.tmp.z,
      };
    };
    this.tree.group.updateMatrixWorld();

    const handle = this.tree.handlePoint();
    this.tmp.copy(handle).project(this.camera);
    const hx = rect.left + ((this.tmp.x + 1) / 2) * rect.width;
    const hy = rect.top + ((1 - this.tmp.y) / 2) * rect.height;
    if (Math.hypot(cx - hx, cy - hy) < 42) return true;

    this.tree.grabPoints(this.grabScratch);
    for (const p of this.grabScratch) {
      const s = project(p);
      if (s.z > 1) continue;
      if (Math.hypot(cx - s.x, cy - s.y) < 24) return true;
    }
    return false;
  }

  private loop = () => {
    if (this.disposed) return;
    this.frameHandle = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;

    if (!this.introSkipped && this.introT < 1) {
      this.introT = Math.min(1, this.introT + dt / INTRO_SECONDS);
      const e = 1 - Math.pow(1 - this.introT, 3);
      applyFraming(this.camera, lerpFraming(establishing(this.framing), this.framing, e));
    } else if (this.introSkipped && this.introT < 1) {
      this.introT = 1;
      applyFraming(this.camera, this.framing);
    }

    this.control.update(dt);
    this.tree.openness = this.control.open;
    this.tree.update(dt);

    const clasped = this.control.open >= CLASP_ON;
    if (clasped && !this.wasClasped) this.audio.clasp();
    this.wasClasped = clasped;

    this.audio.update(Math.abs(this.control.velocity), this.control.open);

    // keep the paper's back-light term matched to the light that is actually there
    this.sunView
      .copy(this.lighting.sun.position)
      .sub(this.lighting.sun.target.position)
      .normalize()
      .transformDirection(this.camera.matrixWorldInverse);
    this.tree.setSun(this.sunView, this.lighting.sun.color);

    const handle = this.tree.handlePoint();
    this.tmp.copy(handle).project(this.camera);
    const hx = ((this.tmp.x + 1) / 2) * window.innerWidth;
    const hy = ((1 - this.tmp.y) / 2) * window.innerHeight;
    this.hint.update(dt, hx, hy, this.introT >= 1);

    this.meterBar.style.width = `${(this.control.open * 100).toFixed(1)}%`;

    this.renderer.render(this.scene, this.camera);

    this.fpsAccum += dt;
    this.fpsFrames++;
    if (this.fpsAccum >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAccum;
      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }
  };

  // --- hooks used by the automated checks --------------------------------
  get debug() {
    return {
      renderer: this.renderer,
      scene: this.scene,
      camera: this.camera,
      tree: this.tree,
      control: this.control,
      setOpen: (v: number) => {
        this.control.open = Math.min(1, Math.max(0, v));
        this.tree.openness = this.control.open;
      },
      skipIntro: () => {
        this.introSkipped = true;
        this.introT = 1;
        applyFraming(this.camera, this.framing);
      },
      setView: (az: number, el: number, dist: number, ty: number) => {
        applyFraming(this.camera, {
          ...this.framing,
          azimuth: THREE.MathUtils.degToRad(az) + TREE_YAW,
          elevation: THREE.MathUtils.degToRad(el),
          distance: dist,
          targetY: ty,
        });
      },
      resetView: () => applyFraming(this.camera, this.framing),
      framing: () => ({ ...this.framing }),
      hideHint: () => this.hint.kill(),
      showCovers: (b: boolean) => this.tree.setCoversVisible(b),
      /**
       * Renders the paper alone into a small offscreen target and reads it
       * back, so the automated checks measure the shape that is really on
       * screen instead of trusting the number that was pushed in. The bench and
       * the jig are hidden for the read so nothing else counts as tree.
       */
      measure: () => {
        if (!this.probe) this.probe = new THREE.WebGLRenderTarget(180, 360);
        const target = this.probe;
        const prevTarget = this.renderer.getRenderTarget();
        const prevBg = this.scene.background;
        const aspect = this.camera.aspect;
        this.workshop.visible = false;
        this.stand.visible = false;
        this.scene.background = BLACK;
        this.camera.aspect = target.width / target.height;
        this.camera.updateProjectionMatrix();
        this.renderer.setRenderTarget(target);
        this.renderer.render(this.scene, this.camera);

        const w = target.width;
        const h = target.height;
        const px = new Uint8Array(w * h * 4);
        this.renderer.readRenderTargetPixels(target, 0, 0, w, h, px);

        this.renderer.setRenderTarget(prevTarget);
        this.scene.background = prevBg;
        this.workshop.visible = true;
        this.stand.visible = true;
        this.camera.aspect = aspect;
        this.camera.updateProjectionMatrix();

        let lit = 0;
        let minX = w;
        let maxX = -1;
        let minY = h;
        let maxY = -1;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            if (px[i] + px[i + 1] + px[i + 2] > 26) {
              lit++;
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }
        return { w, h, green: lit, width: maxX - minX, height: maxY - minY, minX, maxX };
      },
      listeners: () => this.control.listenerCount,
      info: () => ({
        fps: this.fps,
        open: this.control.open,
        quality: this.quality,
        triangles: this.tree.triangles,
        drawCalls: this.renderer.info.render.calls,
        geometries: this.renderer.info.memory.geometries,
        textures: this.renderer.info.memory.textures,
        programs: this.renderer.info.programs?.length ?? 0,
      }),
    };
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frameHandle);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('orientationchange', this.onResize);
    this.scene.environment?.dispose();
    this.control.dispose();
    this.audio.dispose();
    this.teardownScenery();
    this.tree.dispose();
    disposeTextures(this.textures);
    this.probe?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
