// Author Chinese recording fixtures from the project's English showcase files.
// This only replaces authored sample text; previewing still uses the real renderer.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const samples = new URL('../apps/demo/public/samples/', import.meta.url);
const translations = {
  'FIELD NOTES / THE NIGHT ISSUE': '观测笔记 · 极夜特刊',
  'Chasing the light': '追寻极光',
  'A field guide to the edge of night.': '在夜色边缘，记录每一次发现。',
  'Photograph: Carsten / CC BY 2.0. Cropped and color-graded in pale blue.': '摄影：Carsten · CC BY 2.0；照片经裁剪及浅蓝色调处理。',
  'Trip overview': '行程概览',
  'Past the last village, the horizon opens into a quiet world of snow, sea and stars. Follow a fictional three-night expedition in search of a different perspective.': '越过最后一座村庄，雪原、海面与星空铺展在眼前。这份手册记录了一段虚构的三夜极光之旅，邀请你换个角度观察世界。',
  '03 NIGHTS': '三夜行程',
  '66° NORTH': '北纬 66°',
  '01 SHARED SKY': '同一片星空',
  'A slower journey': '放慢脚步',
  'Fictional polar route': '虚构的极地路线',
  'A little more wonder': '发现更多惊喜',
  'All places, groups, dates, and figures in this guide are fictional.': '本手册中的地点、团体、日期与数据均为虚构，仅用于公开示例。',
  '01 / PLAN THE NIGHT': '01 / 夜间观测计划',
  'Route and activities': '路线与活动',
  NIGHT: '夜晚', LOCATION: '地点', MOMENT: '时段', DETAIL: '安排',
  'Lyra fjord': '天琴峡湾', 'Blue hour': '蓝调时刻', 'Scout the shoreline': '勘察海岸线',
  'Northlight ridge': '北光山脊', 'After dark': '入夜之后', 'Watch the horizon': '守望地平线',
  'Orion camp': '猎户营地', 'Before dawn': '黎明之前', 'Keep a field journal': '记录观测笔记',
  'Packing checklist': '行装清单',
  'Warm layers · insulated boots · a headlamp with a red-light mode · spare batteries · a tripod · a reusable flask.': '保暖衣物 · 防寒靴 · 带红光模式的头灯 · 备用电池 · 三脚架 · 保温水壶。',
  'Make room for the unexpected.': '为意外的发现留一点时间',
  'Arrive before dark, let your eyes adjust and give the sky time. The itinerary is a story for this public sample, not a live weather forecast or a real expedition plan.': '天黑前抵达，让双眼适应夜色，耐心等待天空的变化。行程仅为公开示例中的故事，并非实时天气预报或真实探险计划。',
  '02 / LOOK BEYOND': '02 / 看见更远的世界',
  'A universe of detail': '细节中的宇宙',
  'The Cosmic Cliffs, NGC 3324. Image: NASA, ESA, CSA, STScI.': '宇宙悬崖，NGC 3324。图像：NASA、ESA、CSA、STScI。',
  'The sky is only the beginning.': '天空只是起点',
  'Webb’s infrared view reveals the sculpted edge of a star-forming region in the Carina Nebula. Photography brings the distant into view; a good document gives every detail room to breathe.': '韦布望远镜的红外图像，揭示了船底座星云中恒星形成区域的边缘。摄影让遥远的景象触手可及，而好的文档为每一个细节留出空间。',
  'END OF FIELD GUIDE / FILENS PUBLIC SAMPLE': '观测手册完 · FiLens 公开示例',
  Observatory: '观测站', 'Night log': '观测日志', 'Exposure planner': '曝光计划',
  'AURORA LAB': '极光观测室', 'NIGHT / 03': '第 03 夜', OBSERVATORY: '观测站总览',
  'PUBLIC SAMPLE': '公开示例', '6 stations': '6 座观测站', 'FICTIONAL DATA': '虚构观测数据',
  STATION: '观测站', LATITUDE: '纬度', SKY: '天气', 'Kp INDEX': 'Kp 指数',
  ACTIVITY: '活动趋势', 'SCORE / 100': '评分 / 100', 'BEST WINDOW': '最佳时段', FORMATION: '形态',
  'Lyra Fjord': '天琴峡湾', 'Orion Camp': '猎户营地', 'Vega Ridge': '织女山脊',
  'Polaris Bay': '北极星湾', 'Altair Point': '牵牛岬角', 'Nova Station': '新星站',
  CLEAR: '晴朗', 'THIN CLOUD': '薄云', 'BLUE ARC': '蓝色弧带', CORONA: '冕状极光',
  CURTAIN: '帘状极光', RAYS: '放射光束', 'LOW ARC': '低空弧带', FOLD: '褶皱光带',
  'SKY WATCH': '天空观测', STATUS: '状态', 'ALL SYSTEMS GO': '全部设备就绪', 'NEXT / 00:45': '下次 / 00:45',
  METRIC: '指标', VALUE: '数值', UNIT: '单位', 'Observation time': '观测时长', minutes: '分钟',
  'Exposure count': '曝光数量', frames: '帧', 'Battery reserve': '剩余电量', percent: '百分比',
  'Cloud cover': '云量', 'Data captured': '采集数据', NOTE: '说明',
  'Invented stations and observations. Not a live forecast.': '观测站与数据均为虚构，不作为实时预报。',
  'TIME / UTC': '时间 / UTC', 'EXPOSURE / s': '曝光 / 秒', FRAMES: '帧数', 'TOTAL / s': '合计 / 秒',
  NOTES: '备注', 'PEAK ARC': '弧带峰值', TRACKING: '持续跟踪', 'EXPOSURE PLAN': '曝光计划',
  'LENS / mm': '焦距 / 毫米', APERTURE: '光圈', 'SHUTTER / s': '快门 / 秒',
  'Wide horizon': '广角地平线', 'Curtain detail': '极光帘细节', 'Star field': '星野',
  'TOTAL TIME': '总时长', seconds: '秒', SCENARIO: '场景', 'EXPECTED RESULT': '预期效果',
  'Fast movement': '快速变化', 'Shorter exposure': '缩短曝光', 'Faint structure': '微弱结构',
  'Higher sensitivity': '提高感光度', 'Steady sky': '稳定天空', 'Longer exposure': '延长曝光',
  'Fictional planning data': '虚构的计划数据',
};
const escapeXml = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const preserved = new Set(['GB', 'ISO', 'f/1.8', 'f/2.0', 'f/2.8', 'f/4.0']);
const translate = value => {
  if (Object.hasOwn(translations, value)) return escapeXml(translations[value]);
  if (/^[\d.]+° N$/.test(value)) return value.replace(/^([\d.]+)° N$/, '北纬 $1°');
  assert.ok(!/[a-z]/i.test(value) || preserved.has(value), `Untranslated sample text: ${value}`);
  return value;
};

for (const [stem, extension] of [['filens-aurora-guide', 'docx'], ['filens-observatory', 'xlsx']]) {
  const original = await JSZip.loadAsync(await readFile(new URL(`${stem}.${extension}`, samples)));
  const localized = await JSZip.loadAsync(await readFile(new URL(`${stem}.${extension}`, samples)));
  let changed = 0;
  for (const entry of Object.values(localized.files)) {
    if (!/^(word\/document|xl\/worksheets\/sheet\d+|xl\/workbook)\.xml$/.test(entry.name)) continue;
    let content = await entry.async('string');
    content = content.replace(/(<(?:w:)?t\b[^>]*>)([^<]*)(<\/(?:w:)?t>)/g, (_, open, value, close) => {
      const translated = translate(value);
      if (translated !== value) changed++;
      return open + translated + close;
    });
    if (entry.name === 'xl/workbook.xml') content = content.replace(/name="([^"]+)"/g, (_, name) => `name="${translate(name)}"`);
    localized.file(entry.name, content, { date: entry.date });
  }
  if (extension === 'docx') {
    const entry = localized.file('word/styles.xml');
    localized.file(entry.name, (await entry.async('string')).replaceAll('w:hAnsi="Arial"', 'w:hAnsi="Arial" w:eastAsia="PingFang SC"'), { date: entry.date });
  }
  assert.ok(changed > 30);
  // Text edits must preserve native formulas, images and relationships.
  for (const entry of Object.values(original.files).filter(file => !file.dir)) {
    const before = await entry.async('nodebuffer');
    const after = await localized.file(entry.name).async('nodebuffer');
    if (entry.name.endsWith('.xml')) assert.deepEqual(after.toString().match(/<f\b[^>]*>[\s\S]*?<\/f>/g), before.toString().match(/<f\b[^>]*>[\s\S]*?<\/f>/g));
    else assert.deepEqual(after, before);
  }
  const target = new URL(`${stem}.zh-CN.${extension}`, samples);
  await writeFile(target, await localized.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  console.log(`Authored ${fileURLToPath(target)} (${changed} translated text runs)`);
}
