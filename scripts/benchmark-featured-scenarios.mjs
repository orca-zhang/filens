// Larger parser workloads against named public libraries. This measures parsing,
// not complete previews, application startup, or cross-format rendering fidelity.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import os from 'node:os';
import {performance} from 'node:perf_hooks';
import {pathToFileURL,fileURLToPath} from 'node:url';
import path from 'node:path';
import JSZip from 'jszip';
import {zipSync,unzipSync,strToU8} from 'fflate';
import {openUnencryptedZipArchive} from '../packages/core/dist/zip.js';
import {loadXlsxWorkbook} from '../packages/xlsx/dist/index.js';
import {createColumnStyledWorkbookFixture} from '../packages/xlsx/test/fixtures/workbook.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const directory=path.join(root,'tmp/featured-benchmarks');await mkdir(directory,{recursive:true});
const sheetjsURL='https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs';
const file=path.join(directory,'sheetjs-0.20.3.mjs');
try{await readFile(file);}catch(error){if(error.code!=='ENOENT')throw error;const r=await fetch(sheetjsURL);assert.equal(r.status,200);await writeFile(file,Buffer.from(await r.arrayBuffer()));}
const SheetJS=await import(pathToFileURL(file).href);assert.equal(SheetJS.version,'0.20.3');
const hash=b=>createHash('sha256').update(b).digest('hex');
const median=a=>[...a].sort((x,y)=>x-y)[Math.floor(a.length/2)];
const result={measuredAt:new Date().toISOString(),node:process.version,cpu:os.cpus()[0].model,platform:process.platform,arch:process.arch,warmupRounds:2,measuredRounds:9,order:'Alternating implementations per round; explicit GC outside timing where available',scope:'Synthetic larger workloads. Timings include ZIP indexing/decompression and parsing into each library model; exclude input generation, imports, value validation/hashing, networking and rendering. Common cell values or complete entry text are compared, not full feature/fidelity equivalence. No universal state-of-the-art claim.',baselines:{sheetjs:{version:SheetJS.version,url:sheetjsURL,sha256:hash(await readFile(file))},jszip:{version:JSZip.version}},filens:{core:JSON.parse(await readFile('packages/core/package.json')).version,xlsx:JSON.parse(await readFile('packages/xlsx/package.json')).version,bindings:{coreZip:hash(await readFile('packages/core/dist/zip.js')),xlsx:hash(await readFile('packages/xlsx/dist/index.js'))}},cases:[]};
async function paired(name,description,input,engines,verify){
 const samples={filens:[],baseline:[]};let valueDigest;
 for(let round=0;round<11;round++)for(const engine of round%2?['baseline','filens']:['filens','baseline']){
  globalThis.gc?.();const began=performance.now();const output=await engines[engine](input);const ms=performance.now()-began;
  const digest=await verify(output,engine);valueDigest??=digest;assert.equal(digest,valueDigest,`${name}/${engine} output mismatch`);
  if(round>=2)samples[engine].push(ms);
 }
 const filensMs=median(samples.filens),baselineMs=median(samples.baseline);const row={name,...description,inputBytes:input.length,inputSHA256:hash(input),verifiedValuesSHA256:valueDigest,samplesMs:samples,filensMedianMs:filensMs,baselineMedianMs:baselineMs,speedRatio:baselineMs/filensMs};result.cases.push(row);console.log(name,JSON.stringify({filensMs,baselineMs,speedRatio:row.speedRatio}));
}
for(const rows of [2000,8000]){
 const columns=64;const original=await createColumnStyledWorkbookFixture(rows,columns);const parts=unzipSync(original);
 parts['[Content_Types].xml']=strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>');
 parts['_rels/.rels']=strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
 parts['xl/workbook.xml']=strToU8('<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Column styles" sheetId="1" r:id="sheet"/></sheets></workbook>');
 parts['xl/_rels/workbook.xml.rels']=strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="sheet" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet.xml"/><Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="strings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>');
 const input=zipSync(parts,{level:6,mtime:new Date('2020-01-01T00:00:00Z')});
 await paired(`xlsx-${rows}x${columns}`,{workload:'Complete styled XLSX parse',rows,columns,cells:rows*columns,expandedBytes:Object.values(parts).reduce((s,b)=>s+b.length,0),baseline:'SheetJS CE 0.20.3 default read()'},input,{filens:loadXlsxWorkbook,baseline:bytes=>SheetJS.read(bytes,{type:'array'})},(model,engine)=>{
  let values;if(engine==='filens'){assert.equal(model.sheets.length,1);assert.equal(model.sheets[0].rows.length,rows);values=model.sheets[0].rows.map(r=>r.cells.map(c=>c.value));}else{assert.equal(model.SheetNames.length,1);values=SheetJS.utils.sheet_to_json(model.Sheets[model.SheetNames[0]],{header:1,raw:true}).map(row=>row.map(String));}
  assert.equal(values.length,rows);assert.ok(values.every(row=>row.length===columns));
  for(let row=0;row<rows;row++)for(let col=0;col<columns;col++)assert.equal(values[row][col],col%5===1?(col%2?'Names & notes':'Shared 中文'):String((row+1)*columns+col));
  return hash(JSON.stringify(values));
 });
}
for(const [count,entryBytes]of[[10000,2048],[2500,16384]]){
 const entries={};const texts=[];for(let i=0;i<count;i++){const text=(`<part id="${i}">`+'document resource 中文 '.repeat(Math.ceil(entryBytes/27)))+'</part>';texts.push(text);entries[`parts/part-${String(i).padStart(6,'0')}.xml`]=strToU8(text);}
 const expandedBytes=Object.values(entries).reduce((s,b)=>s+b.length,0);const input=zipSync(entries,{level:6,mtime:new Date('2020-01-01T00:00:00Z')});
 await paired(`zip-${count}-entries`,{workload:'Open new ZIP and read every XML entry',entryCount:count,expandedBytes,baseline:'JSZip 3.10.1 loadAsync() + entry.async(text)'},input,{filens:async bytes=>{const zip=await openUnencryptedZipArchive(bytes);const out=[];for(const e of zip.values())out.push(await e.text());return out;},baseline:async bytes=>{const zip=await JSZip.loadAsync(bytes);const out=[];for(const e of Object.values(zip.files))if(!e.dir)out.push(await e.async('text'));return out;}},out=>{assert.deepEqual(out,texts);return hash(JSON.stringify(out));});
}
const output='benchmarks/frontend/2026-11-05/featured-scenarios.json';await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify(result,null,2)+'\n');console.log('Saved',output);
