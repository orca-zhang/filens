// End-to-end document correctness and discovery checks against the real shared WASM.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';
const root=fileURLToPath(new URL('../',import.meta.url));
const binary=process.env.FILENS_AGENT_BINARY||path.join(root,'dist/filens');
const work=await mkdtemp(path.join(os.tmpdir(),'filens-inspection-'));
let checks=0;
function run(args,expected=0,input='') {
  const r=spawnSync(binary,args,{cwd:work,input,encoding:'utf8',timeout:120000,maxBuffer:16<<20});
  assert.equal(r.error,undefined,r.error?.message);assert.equal(r.status,expected,r.stderr+'\n'+r.stdout);return JSON.parse(r.stdout);
}
const textShape=(id,text)=>`<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/><p:nvPr>${id==='42'?'<p:ph type="title"/>':''}</p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:rPr sz="2400"/><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`;
const slide=content=>strToU8(`<p:sld xmlns:p="p" xmlns:a="a" xmlns:r="r"><p:cSld><p:spTree>${content}</p:spTree></p:cSld></p:sld>`);
try {
  const scan=await readFile(path.join(root,'converter/rapidocr/testdata/scan-transparent.png'));
  const file=path.join(work,'ordered.pptx');
  await writeFile(file,zipSync({
    'ppt/presentation.xml':strToU8('<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId r:id="nine"/><p:sldId r:id="two"/><p:sldId r:id="blank"/></p:sldIdLst></p:presentation>'),
    'ppt/_rels/presentation.xml.rels':strToU8('<Relationships><Relationship Id="two" Target="slides/slide2.xml"/><Relationship Id="nine" Target="slides/slide9.xml"/><Relationship Id="blank" Target="slides/slide3.xml"/></Relationships>'),
    'ppt/slides/slide9.xml':slide(textShape('7','FIRST NATIVE')+'<p:pic><p:nvPicPr><p:cNvPr id="8"/></p:nvPicPr><a:blip r:embed="scan"/></p:pic>'+textShape('9','AFTER IMAGE')),
    'ppt/slides/_rels/slide9.xml.rels':strToU8('<Relationships><Relationship Id="scan" Target="../media/scan.png"/></Relationships>'),
    'ppt/slides/slide2.xml':slide(textShape('42','SECOND NATIVE')),
    'ppt/slides/slide3.xml':slide(''),
    'ppt/media/scan.png':scan,'ppt/media/unused.png':scan,
  }));
  const cap=run(['capacity','--json']);assert.ok(Buffer.byteLength(JSON.stringify(cap))<8000);assert.ok(cap.capacity.operations.every(v=>v.parameters));checks++;
  const targets=run(['capacity','--from','pptx','--section','conversionPairs','--json']).capacity;
  assert.deepEqual(targets,{conversionPairs:[]},'same-format pptx normalization is omitted from conversion discovery');checks++;
  assert.deepEqual(run(['capacity','--from','pptx','--to','pdf','--fields','conversionPairs','--json']).capacity.conversionPairs,[]);checks++;
  assert.equal(run(['capacity','--section','invented','--json'],2).error.code,'invalid_request');checks++;
  const selected=run(['read',file,'--slides','3,2,2','--ocr','never','--json']).content;
  assert.equal(selected.text,'SECOND NATIVE\n');assert.deepEqual(selected.pages.map(v=>v.index),[2,3]);
  assert.ok(selected.document.blocks.every(b=>b.source==='text'&&b.slide===2&&b.page===2&&b.shape==='42'&&b.sourcePart==='ppt/slides/slide2.xml'&&b.confidence===null));checks++;
  assert.ok(selected.document.blocks.every(b=>b.shapeName==='Text 42'&&b.placeholder==='title'&&b.maxExplicitFontSizePt===24));checks++;
  assert.equal(selected.media.length,2);const media=selected.media.find(v=>v.name.endsWith('/scan.png'));
  assert.equal(media.width,scan.readUInt32BE(16));assert.equal(media.height,scan.readUInt32BE(20));assert.equal(media.bytes,scan.length);assert.match(media.sha256,/^[a-f0-9]{64}$/);assert.equal(media.referenced,true);assert.equal(media.usedBy[0].slide,1);assert.equal(media.usedBy[0].shape,'8');assert.equal(selected.media.find(v=>v.name.endsWith('/unused.png')).referenced,false);checks++;
  const without=run(['read',file,'--slides','2','--no-media','--json']).content;assert.equal(without.media,undefined);checks++;
  for(const range of ['0','4','2-1','1,,2']) assert.equal(run(['read',file,'--slides',range,'--json'],2).error.code,'invalid_request');checks++;
  assert.equal(run(['read',file,'--pages','1','--json'],2).error.code,'invalid_request');checks++;
  const skipped=run(['--json','-'],0,JSON.stringify({op:'read',input:file,slides:'1',ocr:'never'})).content;
  assert.match(skipped.text,/FIRST NATIVE[\s\S]*AFTER IMAGE/);assert.doesNotMatch(skipped.text,/FILENS2026/);assert.ok(skipped.warnings.length);assert.equal(skipped.complete,true);assert.equal(skipped.textScope,'native-text');assert.equal(skipped.ocr.results[0].status,'skipped');checks++;
  assert.ok(skipped.document.blocks.filter(b=>b.shape).every(b=>b.placeholder==='none'&&b.maxExplicitFontSizePt===24));checks++;
  const recognized=run(['read',file,'--slides','1','--json']).content;
  assert.match(recognized.text,/FIRST NATIVE[\s\S]*FILENS2026[\s\S]*AFTER IMAGE/);
  const ocr=recognized.document.blocks.filter(b=>b.source==='ocr');assert.ok(ocr.length>0);assert.ok(ocr.every(b=>b.slide===1&&b.shape==='8'&&b.media==='ppt/media/scan.png'&&b.confidence>=0.8&&b.confidenceKind==='detection'));assert.ok(recognized.warnings.some(v=>v.includes('recognition accuracy')));checks++;
  const dropped=run(['read',file,'--slides','1','--ocr-min-confidence','1','--json'],3).content;
  assert.doesNotMatch(dropped.text,/FILENS2026/);assert.ok(dropped.warnings.some(v=>v.includes('Discarded')&&v.includes('slide=1')&&v.includes('media=ppt/media/scan.png')));assert.ok(dropped.ocr.results.some(v=>v.status==='partial'&&v.slide===1&&v.shape==='8'&&v.droppedLines>0));checks++;
  const short=path.join(work,'short.txt');const original='A universe of light.\nCHASE THE LIGHT.\nFOLLOW the light.\n';await writeFile(short,original);
  const full=run(['excerpt',short,'--json']);assert.equal(full.op,'excerpt');assert.equal(full.content.text,run(['read',short,'--json']).content.text);assert.equal(full.content.summary.retainedRatio,1);assert.equal(full.content.summary.method,'full-text-within-budget');checks++;
  const tiny=run(['excerpt',short,'--query','universe','--summary-chars','3','--json']).content;assert.equal(tiny.text,'');assert.ok(tiny.warnings.length);checks++;
  const excerpt=run(['excerpt',file,'--slides','1','--query','FILENS2026','--summary-ratio','1','--json']).content;
  assert.ok(excerpt.document.blocks.some(b=>b.source==='ocr'&&b.shape==='8'));const bytes=Buffer.from(excerpt.text);for(const b of excerpt.document.blocks)assert.ok(b.endByte<=bytes.length);checks++;
  const unsupported=run(['convert',file,'--output',path.join(work,'out.pdf'),'--json'],2).error;
  assert.deepEqual(unsupported.supportedTargets,[...new Set(targets.conversionPairs.map(v=>v.targetFormat))].sort());assert.ok(!unsupported.supportedTargets.includes('pdf'));assert.ok(unsupported.reason);checks++;
  const pdf=path.join(root,'converter/rapidocr/testdata/scan.pdf');
  const page=run(['read',pdf,'--pages','2','--json']).content;assert.match(page.text,/BRIGHT2027/);assert.doesNotMatch(page.text,/FILENS2026/);assert.ok(page.document.blocks.every(b=>b.page===2&&b.source==='ocr'));assert.deepEqual(page.pages.map(v=>v.index),[2]);checks++;
  const never=run(['read',pdf,'--pages','2','--ocr','never','--json'],0).content;assert.equal(never.text,'');assert.ok(never.warnings.some(v=>v.includes('Page 2')));checks++;
  const search=run(['search',work,'--query','FILENS2026','--json']).search;
  const result=search.results.find(v=>v.path.endsWith('ordered.pptx'));assert.ok(result);assert.ok(result.warnings.length);assert.ok(result.excerpts.some(e=>e.blocks.some(b=>b.source==='ocr'&&b.slide===1)));checks++;
  console.log(`${checks} document inspection groups passed: compact/filtered discovery, actual slide order, provenance, OCR policy/threshold, media inventory, excerpt integrity, conversion alternatives and PDF page selection.`);
} finally {await rm(work,{recursive:true,force:true});}
