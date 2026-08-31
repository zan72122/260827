import * as THREE from 'three';

export type QualityTier = 'high' | 'medium' | 'low';

/** キャンバスに描いた内容をテクスチャにする（ラベル紙、天板の質感など）。 */
export function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, aniso = 4): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d')!;
  draw(ctx);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

/** 作業台の天板（エポキシ樹脂天板を想定した細かい粒状の質感）。 */
export function benchTopTexture(): THREE.CanvasTexture {
  return canvasTexture(512, 512, (ctx) => {
    ctx.fillStyle = '#565c60';
    ctx.fillRect(0, 0, 512, 512);
    const img = ctx.getImageData(0, 0, 512, 512);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 26;
      img.data[i] += n;
      img.data[i + 1] += n;
      img.data[i + 2] += n * 1.1;
    }
    ctx.putImageData(img, 0, 0);
  });
}

/** ステンレスの加工方向（ヘアライン）を表す粗さマップ。 */
export function brushedRoughness(): THREE.CanvasTexture {
  const t = canvasTexture(256, 256, (ctx) => {
    ctx.fillStyle = '#6a6a6a';
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2600; i++) {
      const y = Math.random() * 256;
      ctx.strokeStyle = `rgba(${Math.random() < 0.5 ? 40 : 190},${Math.random() < 0.5 ? 40 : 190},${Math.random() < 0.5 ? 40 : 190},0.10)`;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(256, y + (Math.random() - 0.5) * 2);
      ctx.stroke();
    }
  });
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export interface MaterialSet {
  glass: THREE.MeshPhysicalMaterial;
  glassThin: THREE.MeshPhysicalMaterial;
  steel: THREE.MeshStandardMaterial;
  steelDark: THREE.MeshStandardMaterial;
  bench: THREE.MeshStandardMaterial;
  wall: THREE.MeshStandardMaterial;
  labelPaper: THREE.MeshStandardMaterial;
  frosted: THREE.MeshStandardMaterial;
  plastic: THREE.MeshStandardMaterial;
  dispose(): void;
}

export function createMaterials(tier: QualityTier): MaterialSet {
  const useTransmission = tier === 'high';
  const rough = brushedRoughness();
  rough.repeat.set(3, 1);

  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xeff5f4,
    metalness: 0,
    roughness: 0.04,
    ior: 1.52,
    reflectivity: 0.62,
    envMapIntensity: 1.5,
    transparent: !useTransmission,
    opacity: useTransmission ? 1 : 0.17,
    transmission: useTransmission ? 0.94 : 0,
    thickness: useTransmission ? 6 : 0,
    side: THREE.FrontSide,
    depthWrite: useTransmission,
  });

  // カバーガラス・スライド用の薄いガラス。厚い樹脂のように膨らませない。
  const glassThin = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: 0,
    roughness: 0.03,
    ior: 1.52,
    transparent: true,
    opacity: useTransmission ? 0.45 : 0.34,
    transmission: 0,
    envMapIntensity: 1.8,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const steel = new THREE.MeshStandardMaterial({
    color: 0xc9ccd0,
    metalness: 1,
    roughness: 0.34,
    roughnessMap: rough,
    envMapIntensity: 1.1,
  });

  const steelDark = new THREE.MeshStandardMaterial({ color: 0x8d9095, metalness: 1, roughness: 0.48, envMapIntensity: 0.9 });

  const bench = new THREE.MeshStandardMaterial({ map: benchTopTexture(), color: 0x767c80, roughness: 0.74, metalness: 0 });
  (bench.map as THREE.Texture).wrapS = (bench.map as THREE.Texture).wrapT = THREE.RepeatWrapping;
  (bench.map as THREE.Texture).repeat.set(6, 3);

  const wall = new THREE.MeshStandardMaterial({ color: 0x969ea3, roughness: 0.94, metalness: 0 });
  const labelPaper = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0 });
  const frosted = new THREE.MeshStandardMaterial({ color: 0xf2f3f0, roughness: 0.75, metalness: 0 });
  const plastic = new THREE.MeshStandardMaterial({ color: 0xdfe2e4, roughness: 0.45, metalness: 0 });

  return {
    glass,
    glassThin,
    steel,
    steelDark,
    bench,
    wall,
    labelPaper,
    frosted,
    plastic,
    dispose() {
      for (const m of [glass, glassThin, steel, steelDark, bench, wall, labelPaper, frosted, plastic]) m.dispose();
      rough.dispose();
      (bench.map as THREE.Texture | null)?.dispose();
    },
  };
}

/** 液体の材質。無色試薬は着色しない（ラベルと位置で見分ける）。 */
export function liquidMaterial(tint: [number, number, number] | null, absorb: number): THREE.MeshPhysicalMaterial {
  const colored = tint !== null && absorb > 0;
  const color = colored ? new THREE.Color(tint[0], tint[1], tint[2]).convertSRGBToLinear() : new THREE.Color(0xffffff);
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.03,
    metalness: 0,
    ior: 1.36,
    transparent: true,
    // 無色の試薬はほぼ透明。発光させない。
    opacity: colored ? Math.min(0.94, 0.5 + absorb * 0.7) : 0.16,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}
