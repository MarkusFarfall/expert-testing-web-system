// Isolated preview: static build + synthetic API. No production requests.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createFixture} from './fixtures.mjs';
const root=path.resolve('out'), fixture=createFixture();
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.ttf':'font/ttf','.webmanifest':'application/manifest+json','.txt':'text/plain'};
http.createServer(async(req,res)=>{
 try {
  const url=new URL(req.url,'http://preview.invalid');
  if(url.pathname.startsWith('/test-api/')){
   let text='';for await(const chunk of req){text+=chunk;if(text.length>1e6)throw Error('body too large');}
   const data=await fixture(url.pathname.slice('/test-api/'.length)+url.search,req.method,text?JSON.parse(text):{});
   res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));return;
  }
  let name=path.resolve(root,'.'+decodeURIComponent(url.pathname));
  if(!name.startsWith(root+path.sep)&&name!==root){res.writeHead(403);res.end();return;}
  let stat=await fs.stat(name).catch(()=>null);
  if(stat?.isDirectory())name=path.join(name,'index.html');
  let data=await fs.readFile(name);
  if(name.endsWith('.html'))data=Buffer.from(data.toString().replace('</body>','<div style="position:fixed;bottom:8px;right:8px;max-width:calc(100vw - 16px);z-index:100;background:#183b58;color:white;padding:7px 12px;border-radius:6px;font:11px Arial;pointer-events:none">Тестовый стенд · данные вымышлены</div></body>'));
  res.writeHead(200,{'Content-Type':types[path.extname(name)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);
 } catch {res.writeHead(404,{'Content-Type':'text/plain'});res.end('Not found');}
}).listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('Isolated KTPP preview; synthetic data only; port '+(process.env.PORT||3000)));
