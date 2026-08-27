import * as THREE from 'three';
import { Sack } from './sack';
import { Santa } from './santa';
import { woodTexture, wallTexture, windowTexture, kraftTexture, wrapPaperTexture, starSpriteTexture } from './textures';
import { mulberry32 } from './util';

/**
 * The North-Pole wrapping room. Deliberately grounded and real:
 * a workbench that could exist, shelves that touch the floor,
 * paper / string / tags with obvious purpose. No gears, no neon.
 * Depth is separated by light: warm pool near the bench & sack,
 * cool dim night at the window, dark quiet walls behind.
 */
export class OutsideScene {
  scene = new THREE.Scene();
  sack = new Sack();
  santa = new Santa();
  /** where a new present is placed for the child */
  presentSpot = new THREE.Vector3(-0.42, 0, 0.9);
  breeze: THREE.Points;
  private breezeVel: Float32Array;
  private breezeAge: Float32Array;
  time = 0;
  /** stardust streamline: flies from the present to the mouth as a wordless hint */
  private hintPts: THREE.Points;
  private hintT = -1;
  private hintFrom = new THREE.Vector3();
  /** soft contact shadow under the present */
  contactShadow: THREE.Mesh;

  constructor() {
    this.scene.background = new THREE.Color(0x171017);
    this.scene.fog = new THREE.Fog(0x171017, 9, 18);

    // ---------- room shell
    const floorMat = new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.85 });
    floorMat.map!.repeat.set(4, 4);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const wallMat = new THREE.MeshStandardMaterial({ map: wallTexture(), roughness: 0.95, color: 0x9a8a7a });
    wallMat.map!.repeat.set(3, 1.6);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(20, 6), wallMat);
    back.position.set(0, 3, -3.6);
    back.receiveShadow = true;
    this.scene.add(back);
    const side = new THREE.Mesh(new THREE.PlaneGeometry(16, 6), wallMat.clone());
    side.rotation.y = Math.PI / 2;
    side.position.set(-4.6, 3, 0);
    side.receiveShadow = true;
    this.scene.add(side);

    // ---------- window with the polar night outside
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 0.7 });
    const win = new THREE.Group();
    const pane = new THREE.Mesh(
      new THREE.PlaneGeometry(1.3, 1.7),
      new THREE.MeshBasicMaterial({ map: windowTexture() })
    );
    win.add(pane);
    const mkBar = (w: number, h: number, x: number, y: number) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.08), frameMat);
      b.position.set(x, y, 0.04);
      win.add(b);
    };
    mkBar(1.46, 0.09, 0, 0.87); mkBar(1.46, 0.09, 0, -0.87);
    mkBar(0.09, 1.82, -0.7, 0); mkBar(0.09, 1.82, 0.7, 0);
    mkBar(0.05, 1.7, 0, 0); mkBar(1.3, 0.05, 0, 0.3);
    win.position.set(-0.9, 2.15, -3.55);
    this.scene.add(win);

    // ---------- workbench (real table structure)
    const woodMat = new THREE.MeshStandardMaterial({ map: woodTexture('#6b4527', '#4c2f18'), roughness: 0.75 });
    const bench = new THREE.Group();
    const top = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.1, 1.1), woodMat);
    top.position.y = 0.92;
    top.castShadow = true; top.receiveShadow = true;
    bench.add(top);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.9, 0.09), woodMat);
      leg.position.set(sx * 1.18, 0.45, sz * 0.45);
      leg.castShadow = true;
      bench.add(leg);
    }
    const rail = new THREE.Mesh(new THREE.BoxGeometry(2.36, 0.07, 0.05), woodMat);
    rail.position.set(0, 0.25, -0.45);
    bench.add(rail);
    bench.position.set(-2.5, 0, -1.9);
    bench.rotation.y = 0.28;
    this.scene.add(bench);

    // bench props: paper rolls, an unrolled sheet, string spool, tags, scissors
    const rollColors: Array<'horse' | 'plush' | 'wheel'> = ['horse', 'plush', 'wheel'];
    rollColors.forEach((k, i) => {
      const roll = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.06, 0.85, 12),
        new THREE.MeshStandardMaterial({ map: wrapPaperTexture(k), roughness: 0.6 })
      );
      roll.rotation.z = Math.PI / 2;
      roll.rotation.y = 0.28;
      roll.position.set(-0.5 + i * 0.35, 1.03, -0.25 + i * 0.1);
      roll.castShadow = true;
      bench.add(roll);
    });
    const sheet = new THREE.Mesh(
      new THREE.PlaneGeometry(0.8, 0.6),
      new THREE.MeshStandardMaterial({ map: wrapPaperTexture('horse'), roughness: 0.6, side: THREE.DoubleSide })
    );
    sheet.rotation.x = -Math.PI / 2;
    sheet.rotation.z = 0.2;
    sheet.position.set(0.6, 0.98, 0.1);
    bench.add(sheet);
    const kraft = new THREE.MeshStandardMaterial({ map: kraftTexture(), roughness: 0.9 });
    const spool = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.12, 12), kraft);
    spool.position.set(1.0, 1.03, -0.3);
    spool.castShadow = true;
    bench.add(spool);
    for (let i = 0; i < 3; i++) {
      const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.08), kraft);
      tag.rotation.x = -Math.PI / 2;
      tag.rotation.z = i * 0.5;
      tag.position.set(-1.0 + i * 0.02, 0.976 + i * 0.003, 0.25);
      bench.add(tag);
    }
    const scissorMat = new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.3, metalness: 0.8 });
    for (const s of [-1, 1]) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.008, 0.03), scissorMat);
      blade.rotation.y = s * 0.2 + 0.6;
      blade.position.set(0.15, 0.985, 0.35);
      bench.add(blade);
    }

    // ---------- shelf on the back wall (feet on the floor)
    const shelf = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const board = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.06, 0.42), woodMat);
      board.position.y = 0.5 + i * 0.62;
      board.castShadow = true; board.receiveShadow = true;
      shelf.add(board);
    }
    for (const s of [-1, 1]) {
      const upright = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.85, 0.42), woodMat);
      upright.position.set(s * 0.95, 0.925, 0);
      upright.castShadow = true;
      shelf.add(upright);
    }
    // small finished presents waiting on the shelf
    const rand = mulberry32(11);
    for (let i = 0; i < 7; i++) {
      const k = rollColors[i % 3];
      const w = 0.16 + rand() * 0.14;
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(w, 0.12 + rand() * 0.16, 0.16),
        new THREE.MeshStandardMaterial({ map: wrapPaperTexture(k), roughness: 0.6 })
      );
      const level = i < 4 ? 0 : 1;
      box.position.set(-0.7 + (i % 4) * 0.45 + rand() * 0.06, 0.56 + level * 0.62 + box.geometry.parameters.height / 2 - 0.03, rand() * 0.1);
      box.rotation.y = rand() * 0.5;
      box.castShadow = true;
      shelf.add(box);
    }
    shelf.position.set(2.9, 0, -3.3);
    this.scene.add(shelf);

    // ---------- sack + santa
    // the sack slumps very slightly toward the room, so the dark mouth
    // opening is visible from the low 3/4 camera
    this.sack.group.position.set(0.78, 0, -0.42);
    this.sack.group.rotation.x = 0.16;
    this.sack.group.rotation.z = -0.05;
    this.scene.add(this.sack.group);
    // santa stands behind-left of the sack, leaning over it to part the mouth
    this.santa.group.position.set(0.22, 0, -1.55);
    this.santa.group.rotation.y = 0.38;
    this.scene.add(this.santa.group);

    // ---------- lighting: warm key pool, cool night fill, dark rear
    const key = new THREE.DirectionalLight(0xffd9a8, 2.6);
    key.position.set(2.2, 4.5, 3.2);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -4; key.shadow.camera.right = 4;
    key.shadow.camera.top = 4; key.shadow.camera.bottom = -4;
    key.shadow.camera.far = 12;
    key.shadow.bias = -0.002;
    this.scene.add(key);
    const lamp = new THREE.PointLight(0xffc987, 18, 8, 2);
    lamp.position.set(-2.3, 2.6, -1.4);
    this.scene.add(lamp);
    const coolFill = new THREE.DirectionalLight(0x7f9cc8, 0.5);
    coolFill.position.set(-4, 2.5, -2);
    this.scene.add(coolFill);
    this.scene.add(new THREE.HemisphereLight(0x5a4b40, 0x241812, 0.85));

    // ---------- faint breath of air drifting OUT of the sack mouth
    const N = 42;
    const pos = new Float32Array(N * 3);
    this.breezeVel = new Float32Array(N * 3);
    this.breezeAge = new Float32Array(N);
    for (let i = 0; i < N; i++) this.breezeAge[i] = Math.random() * 3;
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.breeze = new THREE.Points(bg, new THREE.PointsMaterial({
      color: 0xffe6c0, size: 0.075, transparent: true, opacity: 0.55,
      map: starSpriteTexture(), alphaTest: 0.01,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    }));
    this.breeze.frustumCulled = false;
    this.scene.add(this.breeze);

    // hint streamline points
    const HN = 18;
    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(HN * 3), 3));
    this.hintPts = new THREE.Points(hg, new THREE.PointsMaterial({
      color: 0xffe9b8, size: 0.09, transparent: true, opacity: 0,
      map: starSpriteTexture(), alphaTest: 0.01,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    }));
    this.hintPts.frustumCulled = false;
    this.scene.add(this.hintPts);

    // contact shadow blob (keeps the present grounded)
    const shCanvas = document.createElement('canvas');
    shCanvas.width = shCanvas.height = 128;
    const shg = shCanvas.getContext('2d')!;
    const shGrad = shg.createRadialGradient(64, 64, 6, 64, 64, 62);
    shGrad.addColorStop(0, 'rgba(0,0,0,0.42)');
    shGrad.addColorStop(1, 'rgba(0,0,0,0)');
    shg.fillStyle = shGrad;
    shg.fillRect(0, 0, 128, 128);
    const shTex = new THREE.CanvasTexture(shCanvas);
    this.contactShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 1.1),
      new THREE.MeshBasicMaterial({ map: shTex, transparent: true, depthWrite: false })
    );
    this.contactShadow.rotation.x = -Math.PI / 2;
    this.contactShadow.position.y = 0.012;
    this.scene.add(this.contactShadow);
  }

  /** play the stardust hint from `from` to the mouth (wordless invitation) */
  playHint(from: THREE.Vector3) {
    this.hintFrom.copy(from).add(new THREE.Vector3(0, 0.9, 0));
    this.hintT = 0;
  }
  get hintPlaying() { return this.hintT >= 0; }

  /** camera composition, low 3/4 so mouth vs present size difference reads at once */
  applyCamera(cam: THREE.PerspectiveCamera, portrait: boolean) {
    if (portrait) {
      cam.fov = 58;
      cam.position.set(-0.1, 2.0, 4.9);
      cam.lookAt(0.05, 0.85, -0.35);
    } else {
      cam.fov = 45;
      cam.position.set(-0.35, 1.75, 4.5);
      cam.lookAt(0.1, 0.8, -0.35);
    }
    cam.updateProjectionMatrix();
  }

  update(dt: number, breezeStrength: number) {
    this.time += dt;
    this.sack.update(dt, this.time);
    this.santa.update(dt);
    // breeze particles: born at the mouth, drift out toward the present spot
    const mouth = new THREE.Vector3();
    this.sack.mouthWorld(mouth);
    const pos = this.breeze.geometry.attributes.position as THREE.BufferAttribute;
    const towards = new THREE.Vector3().subVectors(this.presentSpot, mouth).normalize();
    for (let i = 0; i < pos.count; i++) {
      this.breezeAge[i] += dt;
      if (this.breezeAge[i] > 2.6) {
        this.breezeAge[i] = 0;
        pos.setXYZ(i,
          mouth.x + (Math.random() - 0.5) * 0.3,
          mouth.y + Math.random() * 0.05,
          mouth.z + (Math.random() - 0.5) * 0.3);
        this.breezeVel[i * 3] = towards.x * (0.25 + Math.random() * 0.2) + (Math.random() - 0.5) * 0.12;
        this.breezeVel[i * 3 + 1] = 0.1 + Math.random() * 0.12;
        this.breezeVel[i * 3 + 2] = towards.z * (0.25 + Math.random() * 0.2) + (Math.random() - 0.5) * 0.12;
      }
      pos.setXYZ(i,
        pos.getX(i) + this.breezeVel[i * 3] * dt,
        pos.getY(i) + this.breezeVel[i * 3 + 1] * dt * 0.4,
        pos.getZ(i) + this.breezeVel[i * 3 + 2] * dt);
    }
    pos.needsUpdate = true;
    (this.breeze.material as THREE.PointsMaterial).opacity = 0.15 + breezeStrength * 0.45;

    // hint streamline: staggered sparks arc from the present into the mouth
    if (this.hintT >= 0) {
      this.hintT += dt / 2.4;
      const hp = this.hintPts.geometry.attributes.position as THREE.BufferAttribute;
      const mid = this.hintFrom.clone().lerp(mouth, 0.5);
      mid.y = Math.max(this.hintFrom.y, mouth.y) + 0.85;
      for (let i = 0; i < hp.count; i++) {
        const t = ((this.hintT * 2 - i * 0.045) % 1 + 1) % 1;
        const a = this.hintFrom.clone().lerp(mid, t);
        const bpt = mid.clone().lerp(mouth, t);
        a.lerp(bpt, t);
        hp.setXYZ(i, a.x, a.y, a.z);
      }
      hp.needsUpdate = true;
      const fade = Math.min(1, this.hintT * 6) * Math.min(1, (1 - this.hintT) * 4);
      (this.hintPts.material as THREE.PointsMaterial).opacity = Math.max(0, fade * 0.95);
      if (this.hintT >= 1) this.hintT = -1;
    }
  }
}
