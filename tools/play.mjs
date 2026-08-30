import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join, normalize } from 'path';
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
const root=process.cwd();
const server=createServer(async(req,res)=>{try{let p=decodeURIComponent(req.url.split('?')[0]);if(p==='/')p='/index.html';const f=join(root,normalize(p));const b=await readFile(f);res.writeHead(200,{'Content-Type':MIME[extname(f)]||'application/octet-stream'});res.end(b);}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(8099,r));
const browser=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});
page.on('pageerror',e=>console.log('PAGEERR',e.message));
page.on('console',m=>{ if(m.type()==='error') console.log('CONSOLE',m.text()); });
await page.goto('http://localhost:8099/index.html?tier=low&fixeddt=1&res=0.5');

const st = () => page.evaluate(() => {
  const g = window.__game;
  return { phase: g.director.phase, t: +g.director.t.toFixed(2), ...Object.fromEntries(
    ['heat','bulge','bulgeTarget','silver','tint','spin','cut'].map(k => [k, +(g.piece.state[k]||0).toFixed(3)])) };
});
const log = async (tag) => console.log(tag.padEnd(14), JSON.stringify(await st()));

let gestures = {};
function count(k){ gestures[k]=(gestures[k]||0)+1; }
async function dragX(times) {
  for (let i = 0; i < times; i++) {
    const y = 700, x0 = 90, x1 = 300;
    await page.mouse.move(x0, y); await page.mouse.down();
    for (let s = 1; s <= 6; s++) { await page.mouse.move(x0 + (x1 - x0) * s / 6, y); await page.waitForTimeout(16); }
    await page.mouse.up(); await page.waitForTimeout(60);
  }
}
async function swipeUp(times) {
  for (let i = 0; i < times; i++) {
    const x = 195, y0 = 720, y1 = 480;
    await page.mouse.move(x, y0); await page.mouse.down();
    for (let s = 1; s <= 6; s++) { await page.mouse.move(x, y0 + (y1 - y0) * s / 6); await page.waitForTimeout(16); }
    await page.mouse.up(); await page.waitForTimeout(120);
  }
}

await page.waitForTimeout(1500); await log('boot');

// A bot that plays like a child would: it looks at what the game is showing
// and makes the gesture the hint is asking for.
const shots = { spin: 'p1-spin', macro: 'p2-macro', blow: 'p3-blow', silver: 'p4-silver', colour: 'p5-colour', finish: 'p6-finish', again: 'p7-again' };
const seen = new Set();
const t0 = Date.now();
let last = '';
while (Date.now() - t0 < 420000) {
  const s = await st();
  if (s.phase !== last) { last = s.phase; await log('-> ' + s.phase); }
  if (!seen.has(s.phase) && shots[s.phase]) {
    seen.add(s.phase);
    await page.screenshot({ path: `tools/shots/${shots[s.phase]}.png` });
  }
  if (s.phase === 'spin' || s.phase === 'silver') { count(s.phase); await dragX(1); }
  else if (s.phase === 'blow') { count('blow'); await swipeUp(1); }
  else if (s.phase === 'colour') { await page.mouse.move(195, 700); await page.mouse.down(); await page.waitForTimeout(120); await page.mouse.up(); await page.waitForTimeout(300); }
  else await page.waitForTimeout(250);
  if (s.phase === 'again' && seen.has('again')) {
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'tools/shots/p8-run2.png' });
    await log('run2'); console.log('GESTURES', JSON.stringify(gestures));
    break;
  }
}
await browser.close(); server.close();
