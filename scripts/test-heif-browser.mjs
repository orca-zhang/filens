// Verify the built HEIF Blob worker and lazy WASM assets in a real browser.
// Build converter-client first. Optional private-image paths stay in env vars.
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture=path.join(root,'packages/converter-client/test/fixtures/heif');
const input=process.env.FILENS_EDITED_APPLE_HEIF ?? path.join(fixture,'chroma10-444.heic');
const reference=process.env.FILENS_EDITED_APPLE_RGBA ?? path.join(fixture,'chroma10-444.rgba');
if (!!process.env.FILENS_EDITED_APPLE_HEIF !== !!process.env.FILENS_EDITED_APPLE_RGBA) throw Error('Provide both FILENS_EDITED_APPLE_HEIF and FILENS_EDITED_APPLE_RGBA');
const checkAlpha=!!process.env.FILENS_ALPHA_PNG && !!process.env.FILENS_ALPHA_PNG_RGBA;
if (!!process.env.FILENS_ALPHA_PNG !== !!process.env.FILENS_ALPHA_PNG_RGBA) throw Error('Provide both FILENS_ALPHA_PNG and FILENS_ALPHA_PNG_RGBA');
const files=new Map([['/input.heic',input],['/reference.rgba',reference],['/alpha.png',process.env.FILENS_ALPHA_PNG],['/alpha.rgba',process.env.FILENS_ALPHA_PNG_RGBA]]);
const names=await readdir(path.join(root,'packages/converter-client/dist'));
const runtime=names.find(n=>/^media-runtime-.*\.js$/.test(n));
if(!runtime) throw Error('Build @filens/converter-client before running this check');
const requests=[];
const server=createServer(async(req,res)=>{
 try {
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
  if(pathname==='/'){res.setHeader('Content-Type','text/html');res.end('<script type="importmap">{"imports":{"fflate":"/node_modules/fflate/esm/browser.js"}}</script>');return;}
  let file=files.get(pathname);
  if(!file){file=path.resolve(root,'.'+pathname);if(!file.startsWith(root+path.sep))throw Error('outside test root');}
  const data=await readFile(file);
  res.setHeader('Content-Type',file.endsWith('.wasm')?'application/wasm':file.endsWith('.js')?'text/javascript':'application/octet-stream');
  if(file.endsWith('.wasm'))requests.push(path.basename(file));
  res.end(data);
 }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage();
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`http://127.0.0.1:${server.address().port}/`);
 const metrics=await page.evaluate(async({runtime,checkAlpha})=>{
  const {convertMedia}=await import('/packages/converter-client/dist/'+runtime);
  const bytes=new Uint8Array(await(await fetch('/input.heic')).arrayBuffer());
  const result=await convertMedia(bytes,'heic');
  const bitmap=await createImageBitmap(new Blob([result.source],{type:'image/png'}));
  const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d');
  ctx.drawImage(bitmap,0,0);const actual=ctx.getImageData(0,0,bitmap.width,bitmap.height).data;
  const expected=new Uint8Array(await(await fetch('/reference.rgba')).arrayBuffer());
  if(actual.length!==expected.length)throw Error('RGBA reference size does not match browser output');
  let error=0;for(let i=0;i<expected.length;i++)error+=Math.abs(actual[i]-expected[i]);
  const heic={width:bitmap.width,height:bitmap.height,rgbaMAE:error/expected.length};
  if(!checkAlpha)return {heic,png:null};
  const alphaImage=await createImageBitmap(await(await fetch('/alpha.png')).blob());
  const alphaCanvas=new OffscreenCanvas(alphaImage.width,alphaImage.height),alphaCtx=alphaCanvas.getContext('2d');
  alphaCtx.fillStyle='white';alphaCtx.fillRect(0,0,alphaImage.width,alphaImage.height);alphaCtx.drawImage(alphaImage,0,0);
  const composited=alphaCtx.getImageData(0,0,alphaImage.width,alphaImage.height).data;
  const alphaRef=new Uint8Array(await(await fetch('/alpha.rgba')).arrayBuffer());
  let alphaError=0,maximum=0;
  for(let i=0;i<alphaRef.length;i+=4)for(let c=0;c<3;c++){
   const want=Math.floor((alphaRef[i+c]*alphaRef[i+3]+255*(255-alphaRef[i+3])+127)/255);
   const delta=Math.abs(composited[i+c]-want);alphaError+=delta;maximum=Math.max(maximum,delta);
  }
  return {heic,png:{width:alphaImage.width,height:alphaImage.height,whiteRGBMAE:alphaError/(alphaRef.length/4*3),maximum}};
 },{runtime,checkAlpha});
 if(metrics.heic.rgbaMAE>=2||(metrics.png && metrics.png.maximum>1)||errors.length||requests.length!==2||!requests.includes('converter-image.wasm')||!requests.includes('libheif.wasm'))throw Error(JSON.stringify({metrics,errors,requests}));
 console.log(JSON.stringify({metrics,errors,requests},null,2));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
