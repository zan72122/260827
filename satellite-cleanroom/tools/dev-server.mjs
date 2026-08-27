import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
const value=(name,fallback)=>{const equal=args.find(v=>v.startsWith(`${name}=`));if(equal)return equal.slice(name.length+1);const i=args.indexOf(name);return i>=0&&args[i+1]?args[i+1]:fallback;};
const host=value('--host','0.0.0.0');
const port=Number(value('--port',process.env.PORT||'4173'));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'};

const server=http.createServer(async(req,res)=>{
  try{
    const requestPath=decodeURIComponent(new URL(req.url,'http://local').pathname);
    const requested=requestPath==='/'?'/index.html':requestPath;
    const file=path.resolve(root,`.${requested}`);
    if(file!==root&&!file.startsWith(`${root}${path.sep}`)){res.writeHead(403);res.end('Forbidden');return;}
    const data=await fs.readFile(file);
    res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream','cache-control':'no-store'});res.end(data);
  }catch(error){res.writeHead(error?.code==='ENOENT'?404:500);res.end(error?.code==='ENOENT'?'Not found':'Server error');}
});
server.listen(port,host,()=>console.log(`satellite-cleanroom ready on ${host}:${port}`));
