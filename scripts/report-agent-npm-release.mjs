// Measure real npm artifacts and keep the npm packaging README sizes reproducible.
import assert from 'node:assert/strict';
import { copyFile, readFile, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertReleaseArchive, assertReleaseDirectory, privacyIssues } from './agent-release-privacy.mjs';
import { executableName, platformPackageName, npmInvocation, supportedPlatforms } from './agent-platforms.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'dist/npm');
const release=JSON.parse(await readFile(path.join(output,'release.json')));
assert.ok(supportedPlatforms.every(platform=>release.targets.includes(platform)),
  'Build all supported targets with npm run package:agent:npm before synchronizing release sizes');
let accepted=new Map();
try{
  const receipt=JSON.parse(await readFile(path.join(output,`publication-state-${release.version}.json`)));
  accepted=new Map(receipt.accepted.map(p=>[p.name,p.integrity]));
}catch(error){if(error.code!=='ENOENT')throw error;}
const mib=n=>(n/1048576).toFixed(2);
async function sizes(){
  const packages=new Map(release.packages.map(p=>[p.name,p]));
  const rows=[];
  for(const platform of release.targets){
    const core=packages.get(platformPackageName('cli',platform)),ocr=packages.get(platformPackageName('ocr',platform));
    const lite=packages.get('filens-cli-lite'),full=packages.get('filens-cli');
    rows.push({platform,binaryBytes:(await stat(path.join(output,core.name,executableName(platform)))).size,
      lite:{installedBytes:core.unpackedBytes+lite.unpackedBytes,downloadBytes:core.bytes+lite.bytes},
      full:{installedBytes:core.unpackedBytes+ocr.unpackedBytes+full.unpackedBytes,downloadBytes:core.bytes+ocr.bytes+full.bytes}});
  }
  return rows;
}
function block(text,id,body,anchor){
  const start=`<!-- ${id}:start -->`,end=`<!-- ${id}:end -->`;
  if(text.includes(start))return text.slice(0,text.indexOf(start))+start+'\n'+body+'\n'+end+text.slice(text.indexOf(end)+end.length);
  assert.ok(text.includes(anchor),`missing ${id} insertion anchor`);
  return text.replace(anchor,anchor+'\n\n'+start+'\n'+body+'\n'+end);
}
async function update(){
  const rows=await sizes(),mac=rows.find(r=>r.platform==='darwin-arm64');assert.ok(mac);
  const table='| Platform | CLI executable | Lite installed / download | Full installed / download |\n| --- | ---: | ---: | ---: |\n'+rows.map(r=>`| ${r.platform} | ${mib(r.binaryBytes)} MiB | ${mib(r.lite.installedBytes)} / ${mib(r.lite.downloadBytes)} MiB | ${mib(r.full.installedBytes)} / ${mib(r.full.downloadBytes)} MiB |`).join('\n');
  const body=`**v${release.version} · MIT · CLI executable ${mib(mac.binaryBytes)} MiB · Lite ${mib(mac.lite.installedBytes)} MiB · Full ${mib(mac.full.installedBytes)} MiB** (macOS arm64; Lite/Full installed sizes; Full includes OCR models).\n\n${table}\n\nTotals add the launcher and selected platform packages from npm pack. Node.js, npm caches, filesystem overhead and the optional frontend preview package are excluded. Bundled dependencies retain their own licenses; see THIRD-PARTY-NOTICES.md in the platform packages.`;
  const readme=path.join(root,'packaging/npm/README.md');
  const next=block(await readFile(readme,'utf8'),'agent-cli-size:npm',body,'# filens Agent CLI')
    .replace(/(filens-(?:cli|ocr)[\w-]*)-\d+\.\d+\.\d+\.tgz/g,`$1-${release.version}.tgz`);
  await writeFile(readme,next);
  return {rows,readme:next};
}
async function repack(readme){
  for(let i=0;i<release.packages.length;i++){
    const pkg=release.packages[i],directory=path.join(output,pkg.name);
    if(pkg.name==='filens-preview')continue; // Keeps its own frontend README and types.
    if(accepted.has(pkg.name)){
      // A later launcher adjustment can change rounded totals in the common
      // README. Accepted component tarballs keep their original snapshot;
      // entry packages and this release report carry the final measurements.
      const bytes=await readFile(path.join(output,pkg.file));
      assert.equal(`sha512-${createHash('sha512').update(bytes).digest('base64')}`,accepted.get(pkg.name),`Accepted tarball changed: ${pkg.name}`);
      continue;
    }
    await writeFile(path.join(directory,'README.md'),readme);
    await copyFile(path.join(root,'LICENSE'),path.join(directory,'LICENSE'));
    const metadata=JSON.parse(await readFile(path.join(directory,'package.json')));
    assert.equal(metadata.license,'MIT');
    await assertReleaseDirectory(directory);
    const npm=npmInvocation(['pack','--json','--ignore-scripts','--pack-destination',output]);
    const r=spawnSync(npm.command,npm.args,{cwd:directory,encoding:'utf8',maxBuffer:8<<20});
    assert.equal(r.status,0,r.stderr);const packed=JSON.parse(r.stdout)[0];
    assert.ok(packed.files.some(f=>f.path==='LICENSE'));
    assertReleaseArchive(path.join(output,packed.filename));
    release.packages[i]={name:packed.name,version:packed.version,file:packed.filename,bytes:packed.size,unpackedBytes:packed.unpackedSize,
      sha256:createHash('sha256').update(await readFile(path.join(output,packed.filename))).digest('hex')};
  }
  await writeFile(path.join(output,'release.json'),JSON.stringify(release,null,2)+'\n');
}
let state=await update();
if(process.argv.includes('--repack')){
  let stable=false;
  for(let pass=0;pass<4;pass++){
    const before=state.readme;await repack(before);state=await update();
    if(before===state.readme){stable=true;break;}
  }
  assert.ok(stable,'README sizes did not stabilize; do not publish');
}
const report={observedAt:new Date().toISOString(),version:release.version,license:'MIT',
  scope:'Actual npm pack artifacts; sum launcher and current platform packages. Full includes OCR runtime and models. Excludes Node.js, npm caches, filesystem overhead and optional frontend assets. CLI executable and frontend package are separately measured.',
  sourceState:'Locally built release artifacts. Registry publication is recorded separately.',
  componentReadmes:'Accepted component archives retain their original README snapshot; final totals include the current launcher and are recorded here.',
  targets:state.rows,preview:release.packages.find(p=>p.name==='filens-preview')??null,
  packages:release.packages,binaryCompression:release.binaryCompression,sizeLimits:release.sizeLimits};
const data=Buffer.from(JSON.stringify(report,null,2)+'\n');assert.deepEqual(privacyIssues(data),[]);
await writeFile(path.join(root,'docs/agent-cli-npm-release.json'),data);
console.log(JSON.stringify({version:release.version,license:'MIT',targets:state.rows},null,2));
