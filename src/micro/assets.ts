import { plateFromPhotomicrograph, proceduralColonSchematic, SCHEMATIC_PROVENANCE, type BasePlate, type PlateProvenance } from './basePlate';

export interface TissueManifest {
  image: string;
  title: string;
  author: string;
  license: string;
  licenseUrl: string;
  descriptionPage: string;
  fileUrl: string;
  modifications: string;
  attributionText: string;
  shareAlikeNote: string;
  sha256?: string;
}

const PLATE_W = 900;
const PLATE_H = 675;

export interface LoadedPlate {
  plate: BasePlate;
  /** 実写画像の取得に失敗した場合の理由（成功時は null）。 */
  fallbackReason: string | null;
}

/**
 * 顕微鏡像の基礎版を読み込む。
 * public/assets/tissue/manifest.json と実写画像があればそれを使い、
 * 無ければ構造模式図で代替する。**代替したことは必ず呼び出し側へ返す。**
 */
export async function loadBasePlate(baseUrl = 'assets/tissue/'): Promise<LoadedPlate> {
  try {
    const res = await fetch(`${baseUrl}manifest.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`manifest.json が見つかりません (HTTP ${res.status})`);
    const man = (await res.json()) as TissueManifest;
    const img = await loadImage(`${baseUrl}${man.image}`);
    const data = drawToImageData(img, PLATE_W, PLATE_H);
    const prov: PlateProvenance = {
      kind: 'photomicrograph',
      title: man.title,
      credit: man.author,
      license: man.license,
      licenseUrl: man.licenseUrl,
      sourceUrl: man.descriptionPage,
      modifications: man.modifications,
      isRealPhoto: true,
      note: man.attributionText,
    };
    return { plate: plateFromPhotomicrograph(data.data, data.width, data.height, prov), fallbackReason: null };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      plate: proceduralColonSchematic(PLATE_W, PLATE_H, 'colon'),
      fallbackReason: `${SCHEMATIC_PROVENANCE.note}（詳細: ${reason}）`,
    };
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`画像を読み込めません: ${url}`));
    img.src = url;
  });
}

/** 中央付近を 4:3 で切り出し、表示解像度へ縮小する。 */
function drawToImageData(img: HTMLImageElement, w: number, h: number): ImageData {
  const targetAspect = w / h;
  const sa = img.naturalWidth / img.naturalHeight;
  let sw = img.naturalWidth;
  let sh = img.naturalHeight;
  if (sa > targetAspect) sw = Math.round(sh * targetAspect);
  else sh = Math.round(sw / targetAspect);
  const sx = Math.round((img.naturalWidth - sw) / 2);
  const sy = Math.round((img.naturalHeight - sh) / 2);
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}
