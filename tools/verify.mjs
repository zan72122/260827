// 実機相当の画面サイズで起動し、素材選択→注入→ふる→観察→保存→比較を実際に通す。
import fs from 'fs';
import { execSync } from 'child_process';

// playwright はローカルにあってもグローバルにあっても使えるようにする
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch (e) {
  const root = execSync('npm root -g').toString().trim();
  ({ chromium } = await import(`file://${root}/playwright/index.mjs`));
}

const BASE = process.env.BASE || 'http://127.0.0.1:8123/index.html';
const OUT = process.env.OUT || new URL('../.verify-shots/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

const DEVICES = {
  'iphone-portrait': { width: 390, height: 844, dpr: 3 },
  'iphone-landscape': { width: 844, height: 390, dpr: 3 },
  'ipad-portrait': { width: 768, height: 1024, dpr: 2 },
  'ipad-landscape': { width: 1024, height: 768, dpr: 2 },
};

const log = [];
const say = (...a) => { const s = a.join(' '); log.push(s); console.log(s); };

async function state(page) { return page.evaluate(() => {
  const g = window.__game;
  return {
    stage: g.stage, compare: g.compare, wide: g.L.wide,
    mat: g.mat && g.mat.id, liq: g.liq && g.liq.id,
    count: g.dome.list.length, cap: g.dome.capacity,
    level: +g.dome.liquidLevel.toFixed(3), lid: +g.lidT.toFixed(2),
    energy: +g.dome.energy.toFixed(3), resting: g.dome.list.filter(p => p.rest).length,
    saved: g.saved.length, fps: Math.round(g.fps),
    bId: g.domeB && g.domeB.mat && g.domeB.mat.id,
  };
}); }

async function screenPos(page, kind, index) {
  return page.evaluate(([kind, index]) => {
    const g = window.__game;
    const L = g.L;
    const it = kind === 'jar' ? L.jars[index] : L.bottles[index];
    const s = g.cam.toScreen(it.x, it.y - it.h * 0.5, innerWidth, innerHeight);
    return { x: s.x, y: s.y };
  }, [kind, index]);
}

// 固定時間で待つと、注ぐ速さの違う液体で取りこぼす。工程が進むのを待つ。
async function waitStage(page, name, ms = 15000) {
  await page.waitForFunction((n) => window.__game.stage === n, name, { timeout: ms });
  await page.waitForTimeout(250);
}

async function hold(page, x, y, ms) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

async function shake(page, cycles = 4) {
  const c = await page.evaluate(() => {
    const g = window.__game;
    const s = g.cam.toScreen(g.L.domeCx, g.L.domeCy, innerWidth, innerHeight);
    return { x: s.x, y: s.y, r: g.L.domeR * g.cam.zoom };
  });
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  for (let i = 0; i < cycles; i++) {
    for (const d of [-1, 1]) {
      for (let s = 0; s < 4; s++) {
        await page.mouse.move(c.x + d * c.r * 0.55 * ((s + 1) / 4), c.y);
        await page.waitForTimeout(16);
      }
    }
  }
  await page.mouse.up();
}

async function run(browser, name, dev) {
  const ctx = await browser.newContext({
    viewport: { width: dev.width, height: dev.height },
    deviceScaleFactor: dev.dpr, isMobile: true, hasTouch: true,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + (e.stack || e.message).split('\n').slice(0,5).join(' | ')));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  say(`\n=== ${name} (${dev.width}x${dev.height} @${dev.dpr}) ===`);
  say('  起動:', JSON.stringify(await state(page)));
  await page.screenshot({ path: `${OUT}/${name}-1-select.png` });

  // 素材を選ぶ(金ラメ = index 2)
  let p = await screenPos(page, 'jar', 2);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(900);
  say('  瓶をタップ:', JSON.stringify(await state(page)));
  await page.screenshot({ path: `${OUT}/${name}-2-pour-particle.png` });

  // 押しつづけて注ぐ
  await hold(page, dev.width * 0.5, dev.height * 0.62, 2600);
  await waitStage(page, 'pick_liquid');
  const s3 = await state(page);
  say('  粒を注いだ:', JSON.stringify(s3));
  await page.screenshot({ path: `${OUT}/${name}-3-pick-liquid.png` });

  // 液体を選ぶ(とろり = index 2)
  p = await screenPos(page, 'bottle', 2);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(900);
  await hold(page, dev.width * 0.5, dev.height * 0.55, 3200);
  await waitStage(page, 'close');
  say('  液体を注いだ:', JSON.stringify(await state(page)));
  await page.screenshot({ path: `${OUT}/${name}-4-close.png` });

  // フタを閉じる
  await page.mouse.click(dev.width * 0.5, dev.height * 0.4);
  await waitStage(page, 'shake');
  say('  フタを閉じた:', JSON.stringify(await state(page)));

  // ふる
  await shake(page, 4);
  await page.waitForTimeout(500);
  say('  ふった直後:', JSON.stringify(await state(page)));
  await page.screenshot({ path: `${OUT}/${name}-5-shake.png` });
  await page.waitForFunction(() => window.__game.stage === 'watch', null, { timeout: 30000 });
  await page.waitForTimeout(2500);
  say('  しずみ中:', JSON.stringify(await state(page)));
  await page.screenshot({ path: `${OUT}/${name}-6-watch.png` });

  // 保存
  const saveBtn = await page.evaluate(() => {
    const b = window.__game.buttons.find(b => b.id === 'save');
    return b ? { x: b.x, y: b.y } : null;
  });
  if (saveBtn) {
    await page.mouse.click(saveBtn.x, saveBtn.y);
    await page.waitForTimeout(800);
  }
  say('  保存:', JSON.stringify(await state(page)));
  await page.screenshot({ path: `${OUT}/${name}-7-saved.png` });

  // 棚をひらく
  const shelfBtn = await page.evaluate(() => {
    const b = window.__game.buttons.find(b => b.id === 'shelf');
    return b ? { x: b.x, y: b.y } : null;
  });
  if (shelfBtn) {
    await page.mouse.click(shelfBtn.x, shelfBtn.y);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/${name}-8-shelf.png` });
    await page.evaluate(() => { window.__game.shelfOpen = false; });
    await page.waitForTimeout(300);
  }

  // 比較モード(横長のみ)
  const wide = (await state(page)).wide;
  if (wide) {
    const cb = await page.evaluate(() => {
      const b = window.__game.buttons.find(b => b.id === 'compare');
      return b ? { x: b.x, y: b.y } : null;
    });
    if (cb) {
      await page.mouse.click(cb.x, cb.y);
      await page.waitForTimeout(1100);
      say('  比較モード:', JSON.stringify(await state(page)));
      await shake(page, 3);
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${OUT}/${name}-9-compare.png` });
      // 右のドームを選んで素材を入れ替える
      await page.evaluate(() => { window.__game.activeSide = 'B'; });
      const sp = await page.evaluate(() => {
        const s = window.__game.compareStrip();
        return { x: s.jars[4].x, y: s.jars[4].y - s.jars[4].h * 0.5 };
      });
      await page.mouse.click(sp.x, sp.y);
      await page.waitForTimeout(1200);
      say('  右を花びらに交換:', JSON.stringify(await state(page)));
      await page.screenshot({ path: `${OUT}/${name}-10-compare-swap.png` });
    }
  }

  // 性能(60フレームの平均)
  const perf = await page.evaluate(async () => {
    const g = window.__game;
    g.dome.shake(1.0, 1);
    const t0 = performance.now();
    let n = 0;
    await new Promise((res) => {
      function step() { n++; if (n < 90) requestAnimationFrame(step); else res(); }
      requestAnimationFrame(step);
    });
    return { fps: Math.round(90000 / (performance.now() - t0)) };
  });
  say('  フレーム率:', JSON.stringify(perf));

  if (errors.length) say('  ★エラー:', JSON.stringify(errors.slice(0, 8)));
  else say('  コンソールエラーなし');
  await ctx.close();
  return errors;
}

const browser = await chromium.launch();
let allErrors = [];
for (const [name, dev] of Object.entries(DEVICES)) {
  const only = process.env.ONLY;
  if (only && !name.includes(only)) continue;
  try {
    allErrors = allErrors.concat(await run(browser, name, dev));
  } catch (e) {
    say(`  ★${name} で失敗: ${e.message}`);
    allErrors.push(`${name}: ${e.message}`);
  }
}
await browser.close();
fs.writeFileSync(`${OUT}/report.txt`, log.join('\n'));
console.log('\n合計エラー:', allErrors.length);
process.exit(allErrors.length ? 1 : 0);
