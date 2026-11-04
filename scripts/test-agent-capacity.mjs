// Real CLI/WASM discovery conditions and compact transports, with no document parsing.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const binary=process.env.FILENS_AGENT_BINARY||path.join(root,'dist',process.platform==='win32'?'filens.exe':'filens');
let checks=0;
function run(args, expected=0, input='') {
 const r=spawnSync(binary,args,{input,encoding:'utf8',maxBuffer:16<<20,timeout:120000});
 assert.equal(r.error,undefined,r.error?.message);assert.equal(r.status,expected,r.stderr+'\n'+r.stdout);checks++;return r.stdout;
}
const json=(args,expected,input)=>JSON.parse(run([...args,'--json'],expected,input));
const read=json(['capacity','--op','read']).capacity;
assert.deepEqual(Object.keys(read),['operations']);assert.deepEqual(read.operations.map(v=>v.name),['read']);
assert.equal(json(['capacity','--op','prune']).capacity.operations[0].name,'summarize');
const native=run(['capacity','--op','read']);assert.match(native,/^read\(input,/);assert.ok(Buffer.byteLength(native)<200);
const ocr=json(['capacity','--query','OCR','--section','formats']).capacity.formats;assert.ok(ocr.length);assert.ok(ocr.every(v=>v.ocr===true));
const multi=json(['capacity','--query','pptx pdf']).capacity;assert.deepEqual(multi.operations,[]);assert.deepEqual(multi.formats,[]);assert.deepEqual(multi.conversionPairs,[]);
const readPptx=json(['capacity','--query','pptx read']).capacity;
assert.deepEqual(readPptx.operations.map(v=>v.name),['read']);
assert.deepEqual(readPptx.formats.map(v=>v.format),['pptx']);
assert.deepEqual(readPptx,json(['capacity','--from','pptx','--op','read']).capacity);
assert.deepEqual(json(['capacity','--query','READ .PPTX']).capacity,readPptx);
const filtered=json(['capacity','--op','convert','--from','pptx','--to','pdf']).capacity;assert.equal(filtered.operations.length,1);assert.equal(filtered.operations[0].name,'convert');assert.ok(filtered.formats.every(v=>v.format==='pptx'));assert.deepEqual(filtered.conversionPairs,[]);
assert.equal(json(['capacity','--op','invented'],2).error.code,'invalid_request');
const stdin=json(['-'],0,JSON.stringify({op:'capabilities',forOp:'read',query:'ocr'}));assert.equal(stdin.capacity.operations[0].name,'read');
assert.equal(stdin.op,'capabilities');assert.equal(Object.hasOwn(stdin,'operation'),false);
assert.equal(json(['-'],2,JSON.stringify({operation:'capacity'})).error.code,'invalid_request');
assert.equal(json(['-'],2,JSON.stringify({op:'capacity',forOperation:'read'})).error.code,'invalid_request');
const tsv=run(['capacity','--from','ppt','--section','conversionPairs','--format','tsv']);assert.match(tsv,/^section\tkey\tvalue\n/);for(const row of tsv.trim().split('\n').slice(1)){const fields=row.split('\t');assert.equal(fields.length,3);assert.equal(fields[0],'conversionPairs');assert.equal(fields[1],'ppt');assert.ok(fields[2].includes('pptx'));}
const csv=run(['capacity','--op','read','--format','csv']);assert.match(csv,/^section,key,value\n"operations","read","\(input,/);
const full=json(['capacity','--op','read','--full']).capacity;assert.ok(full.operations[0].description);assert.ok(full.requestSchema);assert.ok(full.formats.length>1);
assert.ok(full.examples.length > 0);
for (const example of full.examples) assert.ok(!example.includes('"operation"'), 'capacity examples must use op');
const allPairs=json(['capacity','--section','conversionPairs']).capacity.conversionPairs;
assert.ok(allPairs.length>0 && allPairs.every(p=>p.sourceFormat!==p.targetFormat));
assert.equal(json(['capacity']).capacity.conversionPairs.count,allPairs.length);
assert.deepEqual(json(['capacity','docx>docx']).capacity,{conversionPairs:[]});
const pdf=json(['capacity','?>pdf','--section','formats,conversionPairs']).capacity;
assert.deepEqual(pdf.conversionPairs.map(pair=>pair.sourceFormat).sort(),['ai','eps','ps']);
const flat=run(['capacity','--section','conversionPairs']).trim();
assert.equal(flat.split('\n').length,1);
const decoded=flat.split(';').flatMap(group=>{const [sourceFormat,targets]=group.split('>');return targets.split(',').map(targetFormat=>`${sourceFormat}>${targetFormat}`)});
assert.deepEqual(decoded.sort(),[...new Set(allPairs.map(p=>`${p.sourceFormat}>${p.targetFormat}`))].sort());
for (const [query,from,to] of [['docx>?','docx',''],['?>pdf','','pdf'],['DOCX > PDF','docx','pdf'],['?>?','','']]) {
 const expected=allPairs.filter(p=>(!from||p.sourceFormat===from)&&(!to||p.targetFormat===to));
 const actual=json(['capacity',query]).capacity;
 assert.deepEqual(actual,{conversionPairs:expected},query);
 assert.deepEqual(json(['capacity','--query',query]).capacity,actual);
 assert.deepEqual(json(['-'],0,JSON.stringify({op:'capacity',query})).capacity,actual);
}
assert.deepEqual(json(['capacity','pptx>pdf']).capacity,{conversionPairs:[]});
assert.equal(json(['capacity','docx>pdf','--from','pptx'],2).error.code,'invalid_request');
console.log(`${checks} capability checks passed: composable conditions, exact/alias operations, case-insensitive AND keywords, no matches, stdin, compact text and real TSV/CSV rows.`);
