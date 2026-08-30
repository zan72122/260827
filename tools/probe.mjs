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
page.on('pageerror',e=>console.log('ERR',e.message));
await page.goto('http://localhost:8099/index.html');
await page.waitForTimeout(3000);
const steps=JSON.parse(process.argv[2]);
for(const s of steps){
  await page.evaluate((s)=>{ const g=window.__game; if(s.phase)g.director.setPhase(s.phase); if(s.state)Object.assign(g.piece.state,s.state); if(s.settle)g.rig.t=1; if(s.js)eval(s.js); }, s);
  await page.waitForTimeout(s.wait??1200);
  await page.screenshot({path:`tools/shots/${s.name}.png`});
}
await browser.close(); server.close();
