// Exercise the published browser artifact from an isolated consumer directory.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { npmInvocation } from './agent-platforms.mjs';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const splitOnly = process.argv.includes('--split-only');
const packageDirectory = path.join(root, splitOnly ? 'dist/preview-split-npm' : 'dist/preview-npm');
const release = JSON.parse(await readFile(path.join(packageDirectory,'release.json'),'utf8'));
const registry = process.argv.includes('--registry');
const work = await mkdtemp(path.join(os.tmpdir(),splitOnly ? 'filens-preview-split-npm-' : 'filens-preview-npm-'));
const env = {...process.env, npm_config_registry:'https://registry.npmjs.org/',
  npm_config_userconfig:path.join(work,'.npmrc'),npm_config_offline:registry?'false':'true',
  ...(registry ? {npm_config_cache:path.join(work,'npm-cache')} : {})};
function run(command, args, options = {}) {
  const result = spawnSync(command,args,{cwd:work,env,encoding:'utf8',stdio:'inherit',timeout:180000,...options});
  assert.equal(result.error,undefined,result.error?.message);
  assert.equal(result.status,0,`${command} exited with ${result.status}`);
}
try {
  const npm = npmInvocation(['install','--ignore-scripts','--no-audit','--no-fund','--prefix',work,
    registry ? `${release.name}@${release.version}` : path.join(packageDirectory,release.file),
    ...(registry ? ['--registry=https://registry.npmjs.org/'] : ['--offline'])]);
  run(npm.command,npm.args);
  const installed = path.join(work,'node_modules',release.name);
  const metadata = JSON.parse(await readFile(path.join(installed,'package.json'),'utf8'));
  assert.equal(metadata.version,release.version);
  assert.equal(metadata.license,'MIT');
  assert.deepEqual(metadata.dependencies ?? {},{});
  assert.match(await readFile(path.join(installed,'LICENSE'),'utf8'),/^MIT License/);
  const modes = splitOnly ? ['split'] : ['split','all-in-one'];
  for (const mode of modes) {
    await readFile(path.join(installed,'dist',mode,'index.html'));
    await readFile(path.join(installed,'dist',mode,'THIRD-PARTY-NOTICES.txt'));
  }
  const consumer = splitOnly ? `
import { createPreview, type BrowserPreview } from 'filens-preview-split';
const viewer: BrowserPreview = createPreview('#preview', {
  src: new File(['test'], 'test.txt'), onError: error => console.error(error.message)
});
viewer.update({src: new Uint8Array([65]), name:'updated.txt'});
viewer.destroy();
` : `
import { createPreview, type BrowserPreview } from 'filens-preview';
import { createPreview as single } from 'filens-preview/all-in-one';
const viewer: BrowserPreview = createPreview('#preview', {
  src: new File(['test'], 'test.txt'), onError: error => console.error(error.message)
});
viewer.update({src: new Uint8Array([65]), name:'updated.txt'});
viewer.destroy();
single(document.body, {src: {source: new Blob(['test']), name:'sample.txt'}}).destroy();
`;
  await writeFile(path.join(work,'consumer.mts'), consumer);
  await writeFile(path.join(work,'tsconfig.json'), JSON.stringify({compilerOptions:{
    target:'ES2022',module:'NodeNext',moduleResolution:'NodeNext',strict:true,noEmit:true,
    lib:['ES2022','DOM'],types:[]
  },files:['consumer.mts']}));
  run(process.execPath,[path.join(root,'node_modules/typescript/bin/tsc'),'--project',path.join(work,'tsconfig.json')]);
  if (!process.argv.includes('--skip-cli-preview')) {
    run(process.execPath,[path.join(root,'scripts/test-preview.mjs')],{cwd:root,
      env:{...env,FILENS_PREVIEW_TEST_DIR:path.join(installed,'dist'),FILENS_PREVIEW_TEST_REPORT:path.join(work,'preview-validation.json')}});
  }
  run(process.execPath,[path.join(root,'scripts/test-media-preview.mjs')],{cwd:root,
    env:{...env,FILENS_PREVIEW_TEST_DIR:path.join(installed,'dist'),FILENS_PREVIEW_TEST_MODES:modes.join(',')}});
  // npm users also re-bundle the ESM exports. Check workers and WASM URLs after
  // a production Vite build, rather than relying only on direct static hosting.
  const browser = await chromium.launch({headless:true});
  try {
    const entries = splitOnly ? ['filens-preview-split'] : ['filens-preview','filens-preview/all-in-one'];
    for (const entry of entries) {
      await writeFile(path.join(work,'index.html'), '<html><style>html,body,#preview{height:100%;margin:0}</style><input id="file" type="file"><div id="preview"></div><script type="module" src="/main.js"></script></html>');
      await writeFile(path.join(work,'main.js'), `
import {createPreview} from '${entry}';
let viewer;
document.querySelector('#file').onchange = event => {
  const file = event.target.files[0];
  document.body.dataset.state='loading';
  viewer?.destroy();
  viewer=createPreview('#preview',{src:file,name:file.name,
    onRendered:()=>{document.body.dataset.state='ready'},
    onError:error=>{document.body.dataset.state='error';document.body.dataset.error=error.message}});
};`);
      run(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'build','--logLevel','error']);
      const dist = path.join(work,'dist');
      const server = createServer(async (request,response) => {
        try {
          const file = path.resolve(dist, '.' + new URL(request.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));
          assert.ok(file.startsWith(dist+path.sep));
          assert.ok((await stat(file)).isFile());
          const type = file.endsWith('.html')?'text/html':/\.m?js$/.test(file)?'text/javascript':file.endsWith('.wasm')?'application/wasm':'application/octet-stream';
          response.writeHead(200,{'Content-Type':type});response.end(await readFile(file));
        } catch { response.writeHead(404);response.end(); }
      });
      await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror',error=>errors.push(error.message));
      page.on('response',response=>{if(response.status()>=400)errors.push(`${response.status()} ${response.url()}`);});
      const origin = `http://127.0.0.1:${server.address().port}`;
      await page.route('**/*',route=>{
        const url=route.request().url();
        if(url.startsWith(origin)||/^(blob:|data:)/.test(url)) return route.continue();
        errors.push(`External dependency: ${url}`); return route.abort();
      });
      try {
        await page.goto(`${origin}/`);
        for (const file of ['apps/demo/public/samples/filens-cosmic-atlas.pdf','apps/demo/public/samples/a.pages',
          'apps/demo/public/samples/raw/pentax-k-r.dng','packages/model3d/test/fixtures/occt/cube.stp',
          'apps/demo/public/samples/live-photo/apple-iphone-15-live-photo.HEIC',
          'packages/archive/test/fixtures/rar5-encrypted-filenames.rar']) {
          await page.locator('#file').setInputFiles(path.join(root,file));
          if (file.endsWith('.rar')) {
            const password = page.locator('input[type=password]');
            await password.fill('password'); await password.press('Enter');
            await page.locator('tr.archivev-row').filter({hasText:'c.txt'}).click();
            await page.locator('.archivev-entry-preview').filter({hasText:'This is from c.txt'}).waitFor();
          }
          await page.waitForFunction(()=>['ready','error'].includes(document.body.dataset.state),null,{timeout:30000});
          const result = await page.evaluate(()=>({state:document.body.dataset.state,error:document.body.dataset.error}));
          assert.equal(result.state,'ready',`${entry}: ${file}: ${result.error}`);
          assert.deepEqual(errors,[],`${entry}: ${file}`);
        }
        console.log(`${entry}: PDF/iWork/RAW/STEP/HEIF/RAR rendered after production Vite bundling.`);
      } finally {await page.close();await new Promise(resolve=>server.close(resolve));}
    }
  } finally {await browser.close();}
  const browserReport = process.argv.includes('--skip-cli-preview') ? {observations:[]} : JSON.parse(await readFile(path.join(work,'preview-validation.json'),'utf8'));
  const checks = ['Standalone installation without runtime dependencies','MIT license and third-party notices',
    splitOnly ? 'TypeScript NodeNext consumer import of the split-only export' : 'TypeScript consumer imports of split and all-in-one exports',
    'Native audio, HEIF decoding and unsupported codec handling',
    `${modes.length * 6} PDF/iWork/RAW/STEP/HEIF/RAR previews after production Vite bundling`,
    'No external requests during installed-package browser tests'];
  if (!process.argv.includes('--skip-cli-preview')) checks.push(`${browserReport.observations.length} direct installed-runtime browser previews`,
    'CLI loopback HTTP restrictions');
  const report = {observedAt:new Date().toISOString(),name:release.name,version:release.version,
    source:registry?'public registry with fresh npm cache':'offline npm tarball',platform:`${process.platform}-${process.arch}`,
    passed:true,checks,mediaBrowser:process.env.FILENS_MEDIA_TEST_BROWSER || 'chromium'};
  await writeFile(process.env.FILENS_PREVIEW_NPM_TEST_REPORT || path.join(root,splitOnly?'docs/preview-split-npm-validation.json':'docs/preview-npm-validation.json'),JSON.stringify(report,null,2)+'\n');
  console.log(`${release.name}@${release.version}: isolated installation, NodeNext types and ${splitOnly?'split':'both'} browser build${splitOnly?'':'s'} passed.`);
} finally { await rm(work,{recursive:true,force:true}); }
