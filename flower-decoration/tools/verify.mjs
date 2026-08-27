// E2E検証：フェーズ変化をポーリングしながら順に操作し、各段階のスクリーンショットを撮る。
// ヘッドレスGPUではゲーム内時間が実時間より遅いことがあるため、固定待ちではなく状態駆動で進める。
// 使い方: node verify.mjs [width] [height] [outdir]
import { chromium } from 'playwright-core';
import fs from 'fs';

const W = parseInt(process.argv[2] || '1280');
const H = parseInt(process.argv[3] || '800');
const OUT = process.argv[4] || `shots-${W}x${H}`;
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
const expectedStory = [
  'reveal',
  'guests-entering',
  'all-seated',
  'couple-entrance',
  'couple-arrived',
  'service',
  'toast',
  'applause',
  'chat',
  'camera-tour',
  'complete',
];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto('http://localhost:8321/index.html');
await page.waitForTimeout(2000);

const st = () => page.evaluate(() => window.__flower ? {
  phase: window.__flower.phase, busy: window.__flower.busy, targets: window.__flower.targets(),
  party: window.__flower.party,
} : null);

const seen = new Set();
let shotIdx = 0;
let tapCount = 0;
async function shotOnce(tag) {
  if (seen.has(tag)) return;
  seen.add(tag);
  shotIdx++;
  await page.screenshot({ path: `${OUT}/${String(shotIdx).padStart(2, '0')}-${tag}.png` });
  console.log('shot', tag);
}

const t0 = Date.now();
const LIMIT = 620000;
let revealShot = false;
while (Date.now() - t0 < LIMIT) {
  const s = await st();
  if (!s) { await page.waitForTimeout(400); continue; }
  if (s.phase === 'party') {
    await shotOnce('party');
    break;
  }
  if (s.phase === 'fill') {
    if (!seen.has('fill-1')) {
      await page.waitForTimeout(2000);
      await shotOnce('fill-1');
    }
    await page.waitForTimeout(600);
    continue;
  }
  if (s.phase === 'reveal') {
    if (!revealShot) {
      await page.waitForTimeout(9000);
      await shotOnce('reveal-mid');
      revealShot = true;
    }
    await page.waitForTimeout(800);
    continue;
  }
  if (s.busy || !s.targets.length) { await page.waitForTimeout(350); continue; }
  await shotOnce(s.phase);
  const onScreen = s.targets.filter((t) => t.x > 8 && t.x < W - 8 && t.y > 8 && t.y < H - 8);
  if (!onScreen.length) { console.log('WARN: no on-screen targets', JSON.stringify(s.targets)); break; }
  const t = onScreen[tapCount++ % onScreen.length];
  // targets() の要素には星ボタン用に next:true が混ざることがあるが、
  // 星ボタンも通常ターゲットと同様に {x,y} をタップするだけでよいのでロジック変更は不要。
  if (t.drag && t.dropX !== undefined) {
    await page.mouse.move(t.x, t.y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(t.x + (t.dropX - t.x) * i / 8, t.y + (t.dropY - t.y) * i / 8);
      await page.waitForTimeout(50);
    }
    await page.mouse.up();
  } else {
    await page.mouse.click(t.x, t.y);
  }
  await page.waitForTimeout(500);
}

// パーティーの後半（花びら・開花が進んだ状態）
await page.waitForTimeout(6000);
await shotOnce('party-late');
// ゲスト入場・着席が進んだ状態
await page.waitForTimeout(16000);
await shotOnce('party-guests');
// パーティー中のタップ（花びらバースト）
await page.mouse.click(W / 2, H / 2);
await page.waitForTimeout(1500);
await shotOnce('party-tap');

let completionError = null;
try {
  await page.waitForFunction(() => (
    window.__flower?.party?.complete === true
    && window.__flower.party.replayVisible === true
    && window.__flower.party.completionCardVisible === true
    && window.__flower.party.narrativeState === 'complete'
    && window.__flower.party.petalsActive === false
    && window.__flower.party.petalsRemaining === 0
  ), null, { timeout: 45000 });
  await shotOnce('party-complete');
} catch (error) {
  completionError = String(error);
}

const s = await st();
const info = await page.evaluate(() => {
  const r = window.__flower.renderer.info;
  return { calls: r.render.calls, triangles: r.render.triangles };
});
const decor = await page.evaluate(() => window.__flower.decor);
const interior = await page.evaluate(() => window.__flower.interior);
const party = await page.evaluate(() => window.__flower.party);
const audio = await page.evaluate(() => window.__flower.audio);
const performance = await page.evaluate(() => new Promise((resolve) => {
  let frames = 0;
  const started = performance.now();
  let previous = started;
  const frameTimes = [];
  function count(now) {
    frames++;
    frameTimes.push(now - previous);
    previous = now;
    if (now - started >= 5000) {
      frameTimes.sort((a, b) => a - b);
      resolve({
        fps: frames * 1000 / (now - started),
        p95: frameTimes[Math.floor(frameTimes.length * 0.95)],
      });
    }
    else requestAnimationFrame(count);
  }
  requestAnimationFrame(count);
}));
const audioToggle = page.locator('#audio-toggle');
await audioToggle.click();
await page.waitForTimeout(180);
const muteUi = await page.evaluate(() => ({
  muted: window.__flower.audio.muted,
  pressed: document.getElementById('audio-toggle')?.getAttribute('aria-pressed'),
  label: document.getElementById('audio-toggle')?.getAttribute('aria-label'),
}));
await audioToggle.click();
console.log('final phase:', s && s.phase);
console.log('render info:', JSON.stringify(info));
console.log('garden decor:', JSON.stringify(decor));
console.log('palace interior:', JSON.stringify(interior));
console.log('wedding party:', JSON.stringify(party));
console.log('wedding audio:', JSON.stringify(audio));
console.log('mute UI:', JSON.stringify(muteUi));
console.log('party performance (5s):', JSON.stringify(performance));
console.log('console errors:', errors.length ? errors : 'none');
await browser.close();
if (!s || s.phase !== 'party') { console.log('FAIL: did not reach party'); process.exit(1); }
if (completionError) { console.log('FAIL: party camera tour did not complete', completionError); process.exit(1); }
if (errors.length) { console.log('FAIL: console errors'); process.exit(1); }
if (!decor.complete || decor.validationIssues.length) { console.log('FAIL: garden reveal incomplete'); process.exit(1); }
if (decor.capacity.heads.remaining < 0 || decor.fillers.remaining < 0) { console.log('FAIL: garden capacity exceeded'); process.exit(1); }
const floralEntries = decor.heroPlanned
  + (decor.fillers.byKind.hydrangea || 0)
  + (decor.fillers.byKind.baby || 0)
  + (decor.fillers.byKind.leaf || 0);
const floralReduction = 1 - floralEntries / 691;
if (floralEntries !== 432 || floralReduction < 0.30 || floralReduction > 0.40) {
  console.log('FAIL: P1 floral reduction contract failed', floralEntries, floralReduction); process.exit(1);
}
if (decor.fillers.clusters.count !== 18
  || Object.keys(decor.fillers.clusters.byType).length !== 4
  || decor.fillers.supportDetail.vessels !== 18
  || decor.fillers.supportDetail.foam !== 18
  || decor.fillers.stems < 54) {
  console.log('FAIL: P1 floral construction contract failed', JSON.stringify(decor.fillers)); process.exit(1);
}
const bloomPalette = {
  primary: (decor.fillers.palette.primary || 0) + decor.heroPlanned,
  neutral: decor.fillers.palette.neutral || 0,
  accent: decor.fillers.palette.accent || 0,
};
const paletteTotal = Object.values(bloomPalette).reduce((sum, count) => sum + count, 0);
for (const [role, target] of Object.entries({ primary: 0.70, neutral: 0.20, accent: 0.10 })) {
  if (Math.abs(bloomPalette[role] / paletteTotal - target) > 0.01) {
    console.log('FAIL: P1 floral palette contract failed', JSON.stringify(bloomPalette)); process.exit(1);
  }
}
if (!interior.complete || interior.characters.visibleRoles !== 4) { console.log('FAIL: palace interior incomplete'); process.exit(1); }
if (interior.architecture.windowOpenings !== 6
  || interior.architecture.counts.windowOpenings !== 6
  || interior.architecture.counts.chandeliers !== 3
  || interior.architecture.chandelierUnified !== true
  || interior.architecture.realLights !== 7
  || interior.architecture.parquetAtlasCells !== 88) {
  console.log('FAIL: P1 architectural-lighting contract failed', JSON.stringify(interior.architecture)); process.exit(1);
}
if (interior.tablescape.guestTables !== 6 || interior.tablescape.guestChairs !== 46
  || interior.tablescape.headChairs !== 2 || interior.tablescape.guestSettings !== 48
  || interior.tablescape.headSettings !== 2
  || interior.tablescape.capacities.chairs !== 48
  || interior.tablescape.capacities.settings !== 50) {
  console.log('FAIL: 50-place formal tablescape contract failed'); process.exit(1);
}
if (interior.tablescape.functionalSettings !== 50
  || interior.tablescape.functionalVignettes !== 5
  || Object.keys(interior.tablescape.vignetteFunctions).length !== 5
  || interior.tablescape.vignetteUsers.total !== 5
  || Object.keys(interior.tablescape.vignetteUsers.assignments).length !== 5
  || interior.tablescape.materialClassCount !== 11
  || interior.tablescape.bevelledFurniture !== true
  || interior.tablescape.fabricFoldLayers < 2
  || interior.tablescape.tableFloralMechanics.compotes !== 6
  || interior.tablescape.tableFloralMechanics.foam !== 6
  || interior.tablescape.tableFloralMechanics.stems !== 36
  || interior.tablescape.contactShadows < 60) {
  console.log('FAIL: P1 functional tablescape/material contract failed', JSON.stringify(interior.tablescape)); process.exit(1);
}
if (!party.complete || !party.replayVisible || !party.completionCardVisible) {
  console.log('FAIL: party completion card/replay missing'); process.exit(1);
}
if (party.narrativeState !== 'complete'
  || JSON.stringify(party.story) !== JSON.stringify(expectedStory)) {
  console.log('FAIL: wedding-party story is incomplete or out of order', JSON.stringify(party.story));
  process.exit(1);
}
if (!Array.isArray(party.storyEvents)
  || JSON.stringify(party.storyEvents.map(({ step }) => step)) !== JSON.stringify(expectedStory)
  || party.storyEvents.some((event, index, events) => (
    typeof event.at !== 'number' || event.at < 0 || (index > 0 && event.at < events[index - 1].at)
  ))) {
  console.log('FAIL: timestamped wedding-party story is invalid', JSON.stringify(party.storyEvents));
  process.exit(1);
}
if (!(party.elapsed > 0 && party.elapsed <= 45)) {
  console.log('FAIL: wedding-party story exceeded 45 seconds', party.elapsed); process.exit(1);
}
if (party.petalsActive !== false || party.petalsRemaining !== 0) {
  console.log('FAIL: one-shot petal rain did not settle'); process.exit(1);
}
if (party.guests.planned !== 48 || party.guests.seated !== 48 || party.guests.chatting !== 48) {
  console.log('FAIL: 48-guest party did not reach the chat state'); process.exit(1);
}
if (party.guests.adults !== 42 || party.guests.children !== 6 || party.guests.elderly !== 6
  || party.guests.wheelchairUsers !== 2
  || party.guests.adultHeightRange[0] < 1.5 || party.guests.adultHeightRange[1] > 1.8) {
  console.log('FAIL: guest demographics or adult scale is incorrect', JSON.stringify(party.guests));
  process.exit(1);
}
if (party.characters.phase !== 'chat' || party.characters.collisionSafe !== true
  || party.characters.serviceCompleted !== true
  || party.characters.serviceCollisionSafe !== true) {
  console.log('FAIL: celebration characters did not complete safely'); process.exit(1);
}
if (party.layout.guestTables !== 6 || party.layout.guestSeats !== 48
  || party.layout.accessibilitySeats !== 2 || party.layout.validationIssues.length) {
  console.log('FAIL: P0 party layout contract failed'); process.exit(1);
}
if (!audio.unlocked || audio.mode !== 'party'
  || !audio.buses.music || !audio.buses.effects || !audio.buses.ambience
  || !audio.hallReverb || !audio.spatialSources.piano || !audio.spatialSources.bar
  || !audio.ambienceActive
  || audio.eventCounts.footsteps < 1 || audio.eventCounts.cloth < 1
  || audio.eventCounts.tableware < 1 || audio.eventCounts.service < 1) {
  console.log('FAIL: P1 layered/spatial audio contract failed', JSON.stringify(audio)); process.exit(1);
}
if (muteUi.muted !== true || muteUi.pressed !== 'true' || muteUi.label !== 'おとを だす') {
  console.log('FAIL: mute control did not update state and accessibility', JSON.stringify(muteUi)); process.exit(1);
}
if (info.calls > 560 || info.triangles > 1_400_000) { console.log('FAIL: render budget exceeded'); process.exit(1); }
if (performance.fps < 30 || performance.p95 > 40) { console.log('FAIL: party performance below target'); process.exit(1); }
console.log('PASS');
