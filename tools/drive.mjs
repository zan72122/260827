// ゲーム全体を実際のポインタ操作で通しプレイする検証ドライバ。
//   node tools/drive.mjs <w> <h> <outdir>
// 各段階のスクリーンショット・状態・性能・リーク指標を出力する。
import { chromium } from 'playwright';
import fs from 'node:fs';

const [w = '390', h = '844', outdir = '/tmp/drive'] = process.argv.slice(2);
fs.mkdirSync(outdir, { recursive: true });

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({
  viewport: { width: +w, height: +h },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true
});
page.on('pageerror', (e) => console.log('PAGE EXCEPTION:', e.message));
await page.goto('http://localhost:4173/');

const state = () => page.evaluate(() => window.__game.state());
const perf = () => page.evaluate(() => window.__game.perf());
const pos = (name) => page.evaluate((n) => window.__game.screenPos(n), name);
const shot = async (name) => {
  await page.screenshot({ path: `${outdir}/${name}.png` });
  console.log(`--- ${name}`, JSON.stringify(await state()));
};
const waitPhase = async (phase, timeoutMs = 30000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const s = await state();
    if (s.phase === phase) return s;
    await page.waitForTimeout(300);
  }
  throw new Error(`timeout waiting for phase ${phase}: ${JSON.stringify(await state())}`);
};

// ドラッグ（ポインタ操作）
async function drag(from, to, steps = 14, holdMs = 60) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.waitForTimeout(holdMs);
  for (let i = 1; i <= steps; i++) {
    const x = from.x + (to.x - from.x) * (i / steps);
    const y = from.y + (to.y - from.y) * (i / steps);
    await page.mouse.move(x, y);
    await page.waitForTimeout(28);
  }
  await page.waitForTimeout(holdMs);
  await page.mouse.up();
}

// マーカーが画面内に入り、位置が安定する（カメラ遷移終了）まで待つ
async function waitVisible(name, timeoutMs = 16000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeoutMs) {
    const p = await pos(name);
    if (p && p.x > 12 && p.x < +w - 12 && p.y > 12 && p.y < +h - 12) {
      if (last && Math.hypot(p.x - last.x, p.y - last.y) < 12) return p;
      last = p;
    } else {
      last = null;
    }
    await page.waitForTimeout(350);
  }
  console.log(`   [waitVisible ${name}] TIMEOUT last=${JSON.stringify(last)}`);
  return last ?? (await pos(name));
}

// 目標マーカーを毎ステップ再サンプリングして追従するドラッグ
// （実際の子どもは目で見て指を補正するので、その代わり）
async function dragByName(a, b, pad = { x: 0, y: 0 }) {
  const pa = await waitVisible(a);
  if (!pa) throw new Error(`no marker ${a}`);
  // 画面外なら触らない（実際の子どもも見えない物は触れない）
  if (pa.x < 4 || pa.x > +w - 4 || pa.y < 4 || pa.y > +h - 4) {
    console.log(`   [drag ${a}] SKIP offscreen ${JSON.stringify(pa)}`);
    return;
  }
  await page.mouse.move(pa.x, pa.y);
  await page.mouse.down();
  await page.waitForTimeout(80);
  let cur = { ...pa };
  for (let i = 0; i < 26; i++) {
    const pb = await pos(b);
    if (!pb) break;
    const target = { x: pb.x + pad.x, y: pb.y + pad.y };
    const dx = target.x - cur.x, dy = target.y - cur.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 4) break;
    const step = Math.min(dist, 60);
    cur = { x: cur.x + (dx / dist) * step, y: cur.y + (dy / dist) * step };
    await page.mouse.move(cur.x, cur.y);
    await page.waitForTimeout(50);
  }
  await page.waitForTimeout(80);
  await page.mouse.up();
  const st = await state();
  console.log(`   [drag ${a} -> ${b}] picked=${st.lastPick} from=(${pa.x | 0},${pa.y | 0}) cur=(${cur.x | 0},${cur.y | 0})`);
}

// --- 1. イントロ（歩いてもそりが動かない） -----------------------------------
await page.waitForTimeout(2500);
await shot('01_intro_start');
await page.waitForTimeout(4500);
await shot('02_intro_after_step');

// --- 2. 最初の接続: 線の端 → そり側の受け金具 --------------------------------
await dragByName('trace0', 'leader0');
await page.waitForTimeout(500);
let s = await state();
console.log('after connect attempt:', JSON.stringify(s));
if (s.hooks[0] < 0) {
  // 位置が動的なので一度リトライ
  await dragByName('trace0', 'leader0');
  await page.waitForTimeout(500);
  s = await state();
}
if (s.hooks[0] < 0) throw new Error('first connect failed');
await shot('03_first_connected');
// 歩いて張ってそりが動くシーケンスを見届ける
await page.waitForTimeout(4500);
await shot('04_first_pull_done');
await waitPhase('outfit');
await page.waitForTimeout(3500); // 2頭が歩いてくる
await shot('05_outfit_start');

// 空いているそり側リーダーの名前
const freeLeaderName = async () => {
  const hooks = (await state()).hooks;
  const i = [0, 1, 2].find((k) => !hooks.includes(k));
  return `leader${i}`;
};

// --- 3. ユキ(1): ブラシで雪払い → 首輪 → 牽引線 ------------------------------
// ブラシを持ってユキの体を毛並みに沿って(前→後ろ)なでる×3
await waitVisible('brush');
await waitVisible('deer1');
for (let k = 0; k < 5; k++) {
  const brush = await pos('brush');
  const neck = await pos('neck1');
  const deer = await pos('deer1');
  // 首側から尻の先へ（毛並みに沿って）なでる
  await page.mouse.move(brush.x, brush.y);
  await page.mouse.down();
  await page.waitForTimeout(80);
  await page.mouse.move(neck.x, neck.y, { steps: 6 });
  await page.waitForTimeout(140);
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    await page.mouse.move(
      neck.x + (deer.x - neck.x) * t * 1.9,
      neck.y + (deer.y - neck.y) * t * 1.9);
    await page.waitForTimeout(30);
  }
  await page.mouse.up();
  console.log('   [brush stroke] picked=' + (await state()).lastPick + ' snow=' + JSON.stringify((await state()).snow));
  await page.waitForTimeout(200);
}
s = await state();
console.log('snow after brush:', JSON.stringify(s.snow));
await shot('06_brushed');

// 首輪を柵からユキの首へ
await dragByName('collar1', 'neck1');
await page.waitForTimeout(2600);
s = await state();
console.log('collar state:', JSON.stringify(s.wear));
if (s.wear[1] !== 'fitted') {
  await dragByName('collar1', 'neck1');
  await page.waitForTimeout(2600);
  s = await state();
}
await shot('07_collar_fitted');

// 鈴（小）をユキの首輪の吊り輪へ
await dragByName('bell0', 'loop1a');
await page.waitForTimeout(700);
if ((await state()).bells[0] === 'rack') {
  await page.waitForTimeout(3000);
  await dragByName('bell0', 'loop1a');
  await page.waitForTimeout(700);
}
console.log('bells:', JSON.stringify((await state()).bells));
await shot('08_bell_on_yuki');

// ユキの牽引線を接続
await dragByName('trace1', await freeLeaderName());
await page.waitForTimeout(2500);
s = await state();
if (s.hooks[1] < 0) {
  await dragByName('trace1', await freeLeaderName());
  await page.waitForTimeout(2500);
  s = await state();
}
await shot('09_yuki_connected');

// --- 4. クリ(2): 胸当て → バックル → 鈴 → 牽引線 -----------------------------
await dragByName('harness2', 'chest2');
await page.waitForTimeout(2600);
s = await state();
console.log('harness state:', JSON.stringify(s.wear));
if (s.wear[2] !== 'fitted') {
  await dragByName('harness2', 'chest2');
  await page.waitForTimeout(2600);
}
await shot('10_harness_fitted');

// バックル（革端 → 金具）
await dragByName('strap2', 'buckle2');
await page.waitForTimeout(700);
s = await state();
console.log('buckled:', s.buckled);
if (!s.buckled) {
  await dragByName('strap2', 'buckle2');
  await page.waitForTimeout(700);
  s = await state();
}
await shot('11_buckled');

// 鈴（大）をクリへ
await dragByName('bell2', 'loop2a');
await page.waitForTimeout(700);
await shot('12_bell_on_kuri');

// 牽引線
await dragByName('trace2', await freeLeaderName());
await page.waitForTimeout(2500);
s = await state();
if (s.hooks[2] < 0) {
  await dragByName('trace2', await freeLeaderName());
  await page.waitForTimeout(2500);
  s = await state();
}
console.log('hooks:', JSON.stringify(s.hooks));
await shot('13_all_connected');

// --- 5. 出発準備 → 連鎖 → 走行 -----------------------------------------------
await waitPhase('run', 30000);
await shot('14_launch_chain');

// スワイプで加速（上向きフリック連打 + 保険のデバッグ入力）
for (let i = 0; i < 10; i++) {
  await drag({ x: +w / 2, y: +h * 0.75 }, { x: +w / 2, y: +h * 0.25 }, 5, 10);
  await page.evaluate(() => window.__game.swipeImpulse(0.2));
  await page.waitForTimeout(150);
}
await page.waitForTimeout(1500);
s = await state();
console.log('run state:', JSON.stringify(s));
await shot('15_running_fast');

// 浮くまで維持
const t0 = Date.now();
while (Date.now() - t0 < 20000) {
  s = await state();
  if (s.floatH > 0.55) break;
  await page.evaluate(() => window.__game.swipeImpulse(0.25));
  await page.waitForTimeout(400);
}
console.log('float state:', JSON.stringify(await state()));
await shot('16_float');

// 入力をやめて着地 → 自由モードへ
await waitPhase('outfit', 60000);
await shot('17_free_mode');
const perfAfterFirst = await perf();
console.log('PERF after 1st cycle:', JSON.stringify(perfAfterFirst));

// --- 6. リプレイ: すぐ同じ接続行為を繰り返せるか ------------------------------
for (const t of ['trace0', 'trace1', 'trace2']) {
  await dragByName(t, await freeLeaderName());
  await page.waitForTimeout(2200);
  s = await state();
  console.log('replay hook', t, JSON.stringify(s.hooks));
}
if ((await state()).hooks.some((x) => x < 0)) {
  console.log('RETRY replay connects');
  for (const t of ['trace0', 'trace1', 'trace2']) {
    if ((await state()).hooks[+t[5]] < 0) {
      await dragByName(t, await freeLeaderName());
      await page.waitForTimeout(2200);
    }
  }
}
await shot('18_replay_connected');
await waitPhase('run', 30000);
{
  const t1 = Date.now();
  while (Date.now() - t1 < 25000) {
    const st = await state();
    if (st.floatH > 0.55) break;
    await page.evaluate(() => window.__game.swipeImpulse(0.3));
    await page.waitForTimeout(400);
  }
}
await waitPhase('outfit', 90000);
await shot('19_replay_done');
const perfAfterSecond = await perf();
console.log('PERF after 2nd cycle:', JSON.stringify(perfAfterSecond));
console.log('LEAK CHECK geometries:', perfAfterFirst.geometries, '->', perfAfterSecond.geometries,
  '| textures:', perfAfterFirst.textures, '->', perfAfterSecond.textures,
  '| programs:', perfAfterFirst.programs, '->', perfAfterSecond.programs);

await browser.close();
console.log('DRIVE COMPLETE');
