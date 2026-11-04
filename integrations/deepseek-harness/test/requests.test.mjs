import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeRequest, renderResult } from '../src/requests.js';
const render = (response, options, limit=100000) => renderResult({exit_code:0,response},limit,options)[0].text;

test('compact read preserves UTF-8 text, origins and warnings without a second text copy', () => {
  const text='原文🙂\nOCR “42”\t|>\n';
  const end=Buffer.byteLength('原文🙂\n');
  const response={ok:false,op:'read',source:{path:'a.pptx'},content:{text,rendered:text,complete:false,truncated:false,warnings:['Image skipped'],document:{blocks:[
    {id:'b1',startByte:0,endByte:end,startLine:1,endLine:1,source:'text',confidence:null,slide:2,shape:'3'},
    {id:'b2',startByte:end,endByte:Buffer.byteLength(text),startLine:2,endLine:2,source:'ocr',confidence:0.94,confidenceKind:'detection',slide:2,shape:'4'},
  ]},mediaScope:'whole-package',media:[{name:'a.png',width:960,height:900,sha256:'abc',usedBy:[{slide:2,shape:'4'}]}]}};
  const before=structuredClone(response);
  const output=render(response);
  const lines=output.split('\n');const index=lines.findIndex(v=>v.startsWith('blocks ('));
  const columns=lines[index+1].split('\t');
  const blocks=lines.slice(index+2,index+4).map(line=>Object.fromEntries(line.split('\t').map((v,i)=>[columns[i],JSON.parse(v)])));
  assert.equal(blocks.map(b=>b.text).join(''),text);assert.equal(blocks[1].source,'ocr');assert.equal(blocks[1].confidence,0.94);assert.equal(blocks[1].confidenceKind,'detection');assert.equal(blocks[1].slide,2);assert.equal(blocks[1].shape,'4');
  assert.match(output,/complete=false/);assert.match(output,/Image skipped/);assert.match(output,/mediaScope="whole-package"/);assert.match(output,/960/);assert.match(output,/usedBy/);
  assert.deepEqual(response,before);
  assert.deepEqual(JSON.parse(render(response,{full:true})),{exit_code:0,response});
});

test('compact search drops duplicate display text and keeps file warnings and provenance', () => {
  const evidence='UNIQUE_EVIDENCE';
  const response={ok:true,op:'search',search:{complete:false,semantic:false,scope:{extensions:['pdf','pptx'],includeHidden:false,maxDepth:8},scan:{truncated:false,errorCount:1,errors:[{message:'Denied source'}],execution:{workers:4},cache:{enabled:false,errors:0}},results:[{path:'a.pdf',sourceComplete:false,warnings:['OCR dropped'],excerpts:[{text:evidence,blocks:[{source:'ocr',page:2,confidence:0.9}]}]}]},content:{text:evidence,rendered:evidence,complete:false,truncated:false,warnings:[]}};
  const output=render(response);
  assert.equal(output.split(evidence).length-1,1);assert.match(output,/OCR dropped/);assert.match(output,/sourceComplete/);assert.match(output,/"page":2/);
  assert.match(output,/"extensionCount":2/);assert.match(output,/"includeHidden":false/);assert.match(output,/Denied source/);assert.match(output,/"semantic":false/);assert.doesNotMatch(output,/workers|extensions/);
  assert.ok(Buffer.byteLength(output)<Buffer.byteLength(JSON.stringify({exit_code:0,response},null,2)));
});

test('capacity uses short signatures and grouped targets without inventing routes', () => {
  const response={ok:true,op:'capabilities',capacity:{operations:[{name:'read',parameters:{required:['input'],optional:['ocr']}}],conversionPairs:[{sourceFormat:'pptx',targetFormat:'pptx'},{sourceFormat:'pptx',targetFormat:'odp'}]}};
  assert.match(render(response),/read\(input,ocr\?\)/);assert.match(render(response),/pptx>odp/);assert.doesNotMatch(render(response),/pptx>odp,pptx|pdf/);
  assert.match(render({ok:true,capacity:{conversionPairs:[{sourceFormat:'docx',targetFormat:'docx'}]}}),/conversionPairs=\[\]/);
  assert.match(render({ok:true,capacity:{operations:[],formats:[],conversionPairs:[]}}),/operations=\[\][\s\S]*formats=\[\][\s\S]*conversionPairs=\[\]/);
  const request=makeRequest('capabilities',{op:'read',query:'ocr',from:'pptx',detail:'full'},{});
  assert.equal(request.forOp,'read');assert.equal(request.query,'ocr');assert.equal(request.sourceFormat,'pptx');assert.equal(request.detail,undefined);
  const pairs=render({ok:true,capacity:{conversionPairs:[{sourceFormat:'png',targetFormat:'jpg'},{sourceFormat:'docx',targetFormat:'rtf'},{sourceFormat:'docx',targetFormat:'doc'}]}});
  assert.match(pairs,/docx>doc,rtf;png>jpg/);
  assert.equal(makeRequest('capabilities',{query:'?>pdf'},{}).query,'?>pdf');
});

test('critical warnings precede truncation and errors retain actual supported targets', () => {
  const output=render({ok:false,error:{code:'unsupported_format',supportedTargets:['odp'],reason:'No declared pair'},content:{text:'x'.repeat(10000),complete:false,truncated:false,warnings:['CRITICAL OCR OMISSION']}},undefined,400);
  assert.match(output,/CRITICAL OCR OMISSION/);assert.match(output,/supportedTargets/);assert.match(output,/Truncated/);
});

test('small default result budgets can be expanded explicitly', () => {
  const config={maxBytes:131072,ocr:true};
  assert.equal(makeRequest('search',{path:'.',query:'evidence'},config).maxResults,5);
  assert.equal(makeRequest('duplicates',{path:'.'},config).maxResults,20);
  assert.equal(makeRequest('excerpt',{path:'a.txt'},config).summaryChars,2000);
  assert.equal(makeRequest('search',{path:'.',query:'evidence',max_results:40},config).maxResults,40);
  assert.equal(makeRequest('excerpt',{path:'a.txt',max_chars:8000},config).summaryChars,8000);
});

test('Office path defaults avoid decorative OCR while scans and explicit OCR remain available', () => {
  const config={maxBytes:131072,ocr:true};
  for (const operation of ['read','excerpt','search']) {
    for (const path of ['deck.pptx','DECK.PPTM','archive.zip!/notes.docx','table.xlsx']) {
      const args={path,query:'evidence'};
      assert.equal(makeRequest(operation,args,config).ocr,'never');
      assert.equal(makeRequest(operation,{...args,ocr:'auto'},config).ocr,'auto');
      assert.equal(makeRequest(operation,{...args,ocr:'always'},config).ocr,'always');
      assert.equal(makeRequest(operation,{...args,ocr:'auto'},{...config,ocr:false}).ocr,'never');
    }
  }
  for (const path of ['scan.pdf','scan.png','./documents']) assert.equal(makeRequest('read',{path},config).ocr,'auto');
});
