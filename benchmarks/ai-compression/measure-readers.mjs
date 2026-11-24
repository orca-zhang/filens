import assert from'node:assert/strict';
import{readFile,writeFile}from'node:fs/promises';import{performance}from'node:perf_hooks';
import{createPackedAssetReader}from'../../packages/preview/src/packed-assets.mjs';
import{createLearnedReader,encodeArithmetic,decodeArithmetic}from'./codec.mjs';
const w='dist/ai-compression',meta=JSON.parse(await readFile(`${w}/extracted.json`,'utf8'));
const decoder=(await readFile(`${w}/decoder.wasm`)).toString('base64'),payload=(await readFile(`${w}/payload.lzma`)).toString('base64');
const raw=await readFile(`${w}/assets.bin`),model=await readFile(`${w}/model.cdf`),cdf=new Uint16Array(model.buffer,model.byteOffset,model.length/2);
const report=JSON.parse(await readFile('docs/ai-compression-benchmark.json','utf8')),plans=JSON.parse(await readFile(`${w}/plans.json`,'utf8')),best=plans.find(p=>p.name===report.bestStructural.name);
const encoded=Buffer.from(encodeArithmetic(raw,cdf)).toString('base64'),bestPayload=(await readFile(`${w}/${best.name}.lzma`)).toString('base64');const results={};
for(const[name,factory]of Object.entries({best:()=>{const core=createPackedAssetReader(decoder,bestPayload,best.layout,meta.size,best.crc);return i=>core(best.order.indexOf(i));},baseline:()=>createPackedAssetReader(decoder,payload,meta.layout,meta.size,meta.crc),learned:()=>createLearnedReader(decodeArithmetic,model.toString('base64'),encoded,meta.layout,meta.size,meta.crc)})){
 const samples=[];for(let t=0;t<3;t++){const reader=factory(),start=performance.now();reader(0);samples.push(performance.now()-start);let offset=0;for(let i=0;i<meta.layout.length;i++){const[kind,length]=meta.layout[i];if(t===0){const value=reader(i);const actual=kind===2?Buffer.from(await(await fetch(value)).arrayBuffer()):kind===1?Buffer.from(value,'base64'):Buffer.from(value);assert.deepEqual(actual,raw.subarray(offset,offset+length),`${name} asset ${i}`);}offset+=length;if(kind===2)URL.revokeObjectURL(reader(i));}}results[name]={samplesMs:samples,medianMs:[...samples].sort((a,b)=>a-b)[1]};
}
const r=JSON.parse(await readFile('docs/ai-compression-benchmark.json','utf8'));r.nodeAssetRestoration=results;r.exactValidation={variants:['baseline','best','learned'],assets:meta.layout.length,allBytes:true};await writeFile('docs/ai-compression-benchmark.json',JSON.stringify(r,null,2)+'\n');console.log(results);
