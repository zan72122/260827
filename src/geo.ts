import * as THREE from 'three';

// ---------------------------------------------------------------------------
// 断面の連なりから滑らかな胴体・首・頭部を作るロフト。
// 断面はローカル Z 軸に沿って並び、各断面は XY 平面上の楕円。
// UV: u = 断面一周 (0=上/背 → 0.5=下/腹 → 1=上), v = 軸方向 0..1
// ---------------------------------------------------------------------------
export interface LoftSection {
  z: number;        // 軸方向位置
  y?: number;       // 断面中心の上下オフセット（背線・腹線の造形）
  x?: number;       // 左右オフセット
  rx: number;       // 半幅
  ry: number;       // 半高
  /** 断面下部の膨らみ係数（胸の深さ・喉の垂れ）1=楕円 */
  bottomBulge?: number;
}

export function loft(sections: LoftSection[], radial = 16, capStart = true, capEnd = true): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const n = sections.length;
  for (let i = 0; i < n; i++) {
    const s = sections[i];
    const cy = s.y ?? 0;
    const cx = s.x ?? 0;
    const bb = s.bottomBulge ?? 1;
    for (let j = 0; j <= radial; j++) {
      const t = j / radial;
      const a = t * Math.PI * 2 + Math.PI / 2; // t=0 で上端から開始
      let px = Math.cos(a) * s.rx;
      let py = Math.sin(a) * s.ry;
      if (py < 0) py *= bb; // 下側の膨らみ
      pos.push(cx + px, cy + py, s.z);
      uv.push(t, i / (n - 1));
    }
  }
  const ring = radial + 1;
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * ring + j;
      const b = a + ring;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  // 端のキャップ（中心点ファン）
  const addCap = (i: number, flip: boolean) => {
    const s = sections[i];
    const centerIndex = pos.length / 3;
    pos.push(s.x ?? 0, s.y ?? 0, s.z);
    uv.push(0.5, i === 0 ? 0 : 1);
    for (let j = 0; j < radial; j++) {
      const a = i * ring + j;
      const b = i * ring + j + 1;
      if (flip) idx.push(centerIndex, b, a);
      else idx.push(centerIndex, a, b);
    }
  };
  // キャップの向きは断面の並び方向（z の増減）で決める
  const ascending = sections[0].z < sections[n - 1].z;
  if (capStart) addCap(0, ascending);
  if (capEnd) addCap(n - 1, !ascending);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------
// 半径がテーパーするチューブ（枝角・そりランナー用）
// ---------------------------------------------------------------------------
export function taperedTube(
  points: THREE.Vector3[],
  r0: number,
  r1: number,
  radial = 7,
  tubular = 16,
  capEnd = true
): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points);
  const frames = curve.computeFrenetFrames(tubular, false);
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const P = new THREE.Vector3();
  for (let i = 0; i <= tubular; i++) {
    const t = i / tubular;
    curve.getPointAt(t, P);
    const r = r0 + (r1 - r0) * t;
    const N = frames.normals[i], B = frames.binormals[i];
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const x = Math.cos(a), y = Math.sin(a);
      pos.push(
        P.x + (x * N.x + y * B.x) * r,
        P.y + (x * N.y + y * B.y) * r,
        P.z + (x * N.z + y * B.z) * r
      );
      uv.push(j / radial, t);
    }
  }
  const ring = radial + 1;
  for (let i = 0; i < tubular; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * ring + j;
      const b = a + ring;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  if (capEnd) {
    const tipIndex = pos.length / 3;
    const tip = curve.getPointAt(1);
    pos.push(tip.x, tip.y, tip.z);
    uv.push(0.5, 1);
    const base = tubular * ring;
    for (let j = 0; j < radial; j++) idx.push(tipIndex, base + j, base + j + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** 帯状メッシュ（胸当て・そり跡・雪の帯用）: 中心線+幅から生成 */
export function ribbon(
  points: { p: THREE.Vector3; w: number; n?: THREE.Vector3 }[],
  up = new THREE.Vector3(0, 1, 0)
): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const tangent = new THREE.Vector3();
  const side = new THREE.Vector3();
  for (let i = 0; i < points.length; i++) {
    const cur = points[i];
    const prev = points[Math.max(0, i - 1)].p;
    const next = points[Math.min(points.length - 1, i + 1)].p;
    tangent.subVectors(next, prev).normalize();
    const upv = cur.n ?? up;
    side.crossVectors(upv, tangent).normalize();
    const half = cur.w / 2;
    pos.push(cur.p.x - side.x * half, cur.p.y - side.y * half, cur.p.z - side.z * half);
    pos.push(cur.p.x + side.x * half, cur.p.y + side.y * half, cur.p.z + side.z * half);
    const v = i / (points.length - 1);
    uv.push(0, v, 1, v);
  }
  for (let i = 0; i < points.length - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 2, a + 1, a + 2, a + 3, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
