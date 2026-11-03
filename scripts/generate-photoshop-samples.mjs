// Project-authored SVG design studies for the demo's sample-only PSD gallery.
// No Photoshop parser or runtime conversion is involved. See samples/SOURCES.md.
// Run: node scripts/generate-photoshop-samples.mjs (Playwright Chromium required).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'apps/demo/public/samples/design');
const cache = path.join(os.tmpdir(), 'filens-design-sources');
await mkdir(output, { recursive: true });
await mkdir(cache, { recursive: true });
const photos = {
  skincare: 'photo-1608571423902-eed4a5ad8108',
  coffee: 'photo-1447933601403-0c6688de566e',
  headphones: 'photo-1546435770-a3e426bf472b'
};
const images = {};
for (const [name, id] of Object.entries(photos)) {
  const target = path.join(cache, `${name}.jpg`);
  let bytes;
  try { bytes = await readFile(target); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const response = await fetch(`https://images.unsplash.com/${id}?auto=format&fit=crop&w=1400&q=90`);
    if (!response.ok) throw new Error(`Unable to download ${name}: ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    await writeFile(target, bytes);
  }
  images[name] = `data:image/jpeg;base64,${bytes.toString('base64')}`;
}

const svg = (width, height, label, content, photo) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<title>${label}</title>
<metadata>Project-authored design study. Layout, copy and illustrations: Filens contributors, MIT. ${photo ? `Embedded photography: https://images.unsplash.com/${photos[photo]} ; licensed separately under https://unsplash.com/license . Photography is not relicensed under MIT.` : 'No third-party photography.'} Fictional demo identity and pricing; no brand affiliation or endorsement. See samples/design/SOURCES.md.</metadata>
<style>text{font-family:Arial,Helvetica,sans-serif} .serif{font-family:Georgia,'Times New Roman',serif} .caps{letter-spacing:3px}</style>
${content}</svg>`;
const line = (x1, y1, x2, y2, stroke, opacity = 1) => `<path d="M${x1} ${y1}H${x2}" transform="translate(0 ${y2 - y1})" stroke="${stroke}" opacity="${opacity}"/>`;
const arrow = (x, y, color) => `<path d="M${x} ${y}h40m-13-13 13 13-13 13" fill="none" stroke="${color}" stroke-width="2"/>`;
const barcode = (x, y, color) => `<g fill="${color}">${Array.from({ length: 28 }, (_, i) => `<rect x="${x + i * 4}" y="${y}" width="${i % 3 === 0 ? 3 : 1}" height="30"/>`).join('')}</g>`;

const designs = [
  {
    id: 'still-form',
    photo: 'skincare',
    width: 1600, height: 1100,
    label: 'Still Form — skincare brand campaign',
    content: `
<rect width="1600" height="1100" fill="#f4f0e7"/>
<image href="${images.skincare}" x="720" y="0" width="880" height="1100" preserveAspectRatio="xMidYMid slice"/>
<text x="80" y="91" class="serif" font-size="40" fill="#394b3d">still / form</text>
<text x="80" y="200" class="caps" font-size="13" fill="#7c8476">CONSIDERED CARE. EVERY DAY.</text>
<text x="75" y="360" class="serif" font-size="112" letter-spacing="-5" fill="#2d4032">Less,</text>
<text x="75" y="480" class="serif" font-size="112" font-style="italic" letter-spacing="-5" fill="#2d4032">but better.</text>
<text x="82" y="562" font-size="21" fill="#71766a">A simple ritual. A softer kind of everyday.</text>
<text x="82" y="596" font-size="21" fill="#71766a">Make a little room for yourself.</text>
<rect x="82" y="660" width="360" height="68" rx="34" fill="#344b3c"/>
<text x="115" y="702" font-size="18" fill="#fffdf4">Discover the daily ritual</text>
${arrow(367, 694, '#fffdf4')}
${line(82, 833, 632, 833, '#b5bcac')}
<text x="82" y="884" class="caps" font-size="12" fill="#7f8677">THE DAILY ESSENTIAL</text>
<text x="82" y="931" class="serif" font-size="33" fill="#344b3c">Botanical face oil</text>
<text x="82" y="964" font-size="15" fill="#7f8677">30 ml / A moment of calm</text>
<text x="630" y="932" text-anchor="end" font-size="26" fill="#344b3c">¥268</text>
<text x="82" y="1055" class="caps" font-size="10" fill="#7f8677">STILL FORM / BRAND CAMPAIGN / 01</text>
<rect x="1110" y="860" width="412" height="166" fill="#f7f5ecef"/>
<text x="1148" y="904" class="caps" font-size="11" fill="#69715c">SLOW DOWN. FEEL GOOD.</text>
<text x="1148" y="950" class="serif" font-size="31" fill="#344b3c">A little care,</text>
<text x="1148" y="989" class="serif" font-size="31" font-style="italic" fill="#344b3c">every single day.</text>`
  },
  {
    id: 'pace-store',
    width: 1800, height: 1200,
    label: 'Pace Store — sneaker launch campaign',
    content: `
<rect width="1800" height="1200" fill="#f4f4ed"/>
<rect width="1800" height="980" fill="#18191a"/>
<text x="65" y="75" font-size="38" font-weight="900" font-style="italic" letter-spacing="-2" fill="#fff">PACE / STORE</text>
<text x="1050" y="69" class="caps" font-size="13" fill="#fff">NEW ARRIVALS</text>
<text x="1300" y="69" class="caps" font-size="13" fill="#fff">FOOTWEAR</text>
<text x="1590" y="69" class="caps" font-size="13" fill="#d9f76f">DROP 04</text>
<defs>
<linearGradient id="red" x2="1" y2="1"><stop stop-color="#e83c32"/><stop offset="1" stop-color="#b32624"/></linearGradient>
<linearGradient id="upper" x2="0" y2="1"><stop stop-color="#fcf7e9"/><stop offset=".6" stop-color="#e4dcc6"/><stop offset="1" stop-color="#bcb49e"/></linearGradient>
<linearGradient id="sole" x2="0" y2="1"><stop stop-color="#f5efdd"/><stop offset=".45" stop-color="#d8d1bb"/><stop offset="1" stop-color="#a89d85"/></linearGradient>
<pattern id="mesh" width="12" height="12" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="1.4" fill="#958b75" opacity=".55"/><circle cx="9" cy="9" r="1.4" fill="#958b75" opacity=".55"/></pattern>
<filter id="shoe-shadow" x="-40%" y="-80%" width="200%" height="300%"><feGaussianBlur stdDeviation="24"/></filter>
</defs>
<rect x="670" y="118" width="1130" height="862" fill="url(#red)"/>
<text x="720" y="350" font-size="210" font-weight="900" font-style="italic" letter-spacing="-12" fill="none" stroke="#ffffff30" stroke-width="2">EVERYDAY</text>
<ellipse cx="1240" cy="767" rx="390" ry="46" fill="#582623" opacity=".4" filter="url(#shoe-shadow)"/>
<g transform="translate(768 338) rotate(-15 450 200)">
<path d="M45 310Q80 331 193 326L805 297Q868 299 869 342L858 363Q725 395 474 390L172 380Q54 367 33 343Z" fill="#3e4037"/>
<path d="M42 284Q61 315 190 309L804 284Q868 285 870 325L857 343Q721 376 475 370L169 361Q58 352 36 325Z" fill="url(#sole)" stroke="#8f8773" stroke-width="2"/>
<path d="M48 312Q148 340 338 334L837 313" fill="none" stroke="#fffcf2" stroke-width="7"/>
<path d="M65 288Q72 250 130 235L287 201Q327 176 375 170L482 173Q554 141 602 107L641 58Q661 43 683 65L746 114Q779 133 787 190L817 287Q614 323 385 310L146 309Q81 307 65 288Z" fill="url(#upper)" stroke="#aaa38d" stroke-width="2"/>
<path d="M88 276Q117 249 196 239L327 211Q352 202 378 207L431 300L171 300Q110 300 88 276Z" fill="url(#mesh)"/>
<path d="M77 274Q165 292 270 277L326 302Q193 319 93 300Z" fill="#d1c8b0"/>
<path d="M336 199Q374 167 412 168L488 183 567 292 451 306Z" fill="#b9b19b"/>
<path d="M379 185Q415 164 441 166L503 209 458 231Z" fill="#5d6558"/>
<path d="M602 107Q636 122 646 167L610 194 549 161Z" fill="#5f6e58"/>
<path d="M641 59Q661 44 683 65L746 115Q737 159 700 183L646 167Q632 125 602 107Z" fill="#596951"/>
<path d="M651 77Q673 66 698 86L733 115Q711 133 682 132Z" fill="#323c30"/>
<path d="M769 160Q787 187 794 231L811 282 705 300 676 236Q717 227 735 190Z" fill="#cbbf9c"/>
<path d="M776 200 797 274 745 285 719 235Z" fill="#eb6a3d"/>
<path d="M468 216Q519 192 571 179L628 222 601 282 541 296Z" fill="#f3efde" stroke="#b2aa92" stroke-width="2"/>
<path d="M489 230Q542 215 574 211L603 230 585 271 548 282Z" fill="url(#mesh)"/>
<g stroke="#fefbf2" stroke-width="9" stroke-linecap="round">
<path d="M382 200 461 183M397 223 481 205M411 247 499 228M425 271 518 252"/>
</g>
<g fill="#656854"><circle cx="379" cy="200" r="4"/><circle cx="395" cy="223" r="4"/><circle cx="410" cy="247" r="4"/><circle cx="424" cy="271" r="4"/></g>
<path d="M643 60 651 35 671 45 683 65" fill="none" stroke="#ea683b" stroke-width="12"/>
<path d="M104 318Q214 344 330 332M563 335 795 316" fill="none" stroke="#a19983" stroke-width="2"/>
${[100, 158, 216, 274, 332, 390, 490, 550, 610, 670, 730, 790].map(x => `<path d="M${x} 354v25" stroke="#807861" stroke-width="4"/>`).join('')}
</g>
<text x="65" y="209" class="caps" font-size="13" fill="#d9f76f">FIND YOUR EVERYDAY PACE</text>
<text x="52" y="390" font-size="145" font-weight="900" letter-spacing="-10" fill="#fff">MAKE</text>
<text x="52" y="537" font-size="145" font-weight="900" letter-spacing="-10" fill="#fff">YOUR</text>
<text x="52" y="684" font-size="145" font-weight="900" letter-spacing="-10" fill="#d9f76f">MOVE.</text>
<text x="65" y="759" font-size="20" fill="#aeb0ae">A new day. A fresh pair. Your own direction.</text>
<rect x="65" y="825" width="303" height="73" rx="2" fill="#d9f76f"/>
<text x="94" y="870" font-size="18" font-weight="700" fill="#18191a">SHOP THE DROP</text>
${arrow(292, 861, '#18191a')}
<rect x="1540" y="823" width="205" height="112" fill="#ffffffed"/>
<text x="1560" y="861" class="caps" font-size="11" fill="#8d231d">THE COLOR EDIT</text>
<text x="1560" y="907" font-size="30" font-weight="800" fill="#242424">SAND / SAGE</text>
<text x="65" y="1040" class="caps" font-size="11" fill="#777970">CURATED FOOTWEAR / 001</text>
<text x="65" y="1103" font-size="38" font-weight="700" letter-spacing="-1" fill="#20211e">Everyday trainer</text>
<text x="65" y="1144" font-size="17" fill="#777970">Sand / Sage · Everyday collection</text>
<text x="793" y="1040" class="caps" font-size="11" fill="#777970">SELECT YOUR SIZE</text>
${[38, 39, 40, 41, 42, 43].map((size, i) => `<rect x="${793 + i * 74}" y="1068" width="62" height="57" fill="${size === 41 ? '#20211e' : 'none'}" stroke="#c0c2b8"/><text x="${824 + i * 74}" y="1104" text-anchor="middle" font-size="17" fill="${size === 41 ? '#fff' : '#41443b'}">${size}</text>`).join('')}
<text x="1730" y="1103" text-anchor="end" font-size="48" font-weight="700" fill="#20211e">¥699</text>
<text x="1730" y="1140" text-anchor="end" class="caps" font-size="11" fill="#777970">THE NEW-SEASON EDIT</text>`
  },
  {
    id: 'sunday-roast',
    photo: 'coffee',
    width: 1500, height: 1100,
    label: 'Sunday Roast — coffee brand and packaging campaign',
    content: `
<defs>
<clipPath id="beans"><circle cx="1150" cy="640" r="470"/></clipPath>
<linearGradient id="bag"><stop stop-color="#c99259"/><stop offset=".25" stop-color="#e7b982"/><stop offset=".8" stop-color="#dca16b"/><stop offset="1" stop-color="#ad7545"/></linearGradient>
<filter id="shadow" x="-70%" y="-50%" width="240%" height="220%"><feDropShadow dx="18" dy="30" stdDeviation="24" flood-color="#1a0c00" flood-opacity=".34"/></filter>
</defs>
<rect width="1500" height="1100" fill="#f3e9d8"/>
<image href="${images.coffee}" x="680" y="170" width="940" height="940" clip-path="url(#beans)" preserveAspectRatio="xMidYMid slice"/>
<text x="75" y="83" class="serif" font-size="34" font-weight="700" fill="#542e25">SUNDAY ROAST</text>
<text x="75" y="119" class="caps" font-size="10" fill="#8e7664">GOOD COFFEE. BETTER MORNINGS.</text>
<path d="M1390 49v70m-35-35h70m-60-25 50 50m0-50-50 50" stroke="#542e25" stroke-width="2"/>
<text x="75" y="263" class="caps" font-size="12" fill="#9a5d42">FRESHLY ROASTED / HOUSE BLEND</text>
<text x="66" y="388" class="serif" font-size="101" letter-spacing="-5" fill="#542e25">Good days</text>
<text x="66" y="500" class="serif" font-size="101" letter-spacing="-5" font-style="italic" fill="#542e25">start slow.</text>
<text x="78" y="580" font-size="20" fill="#8b6b57">For the first light, the long conversations,</text>
<text x="78" y="613" font-size="20" fill="#8b6b57">and the mornings that belong to you.</text>
<rect x="78" y="674" width="282" height="67" rx="34" fill="#542e25"/>
<text x="112" y="715" font-size="17" fill="#f7ecda">Find your daily cup</text>
${arrow(286, 707, '#f7ecda')}
<g transform="rotate(-12 1110 650)" filter="url(#shadow)">
<path d="M914 297 1265 297 1304 879Q1306 900 1283 902H899Q882 899 886 879Z" fill="url(#bag)"/>
<path d="M914 297h351l9 45H905Z" fill="#c18a52"/>
<path d="M920 310h341" stroke="#95612e" stroke-width="2" opacity=".6"/>
<rect x="929" y="435" width="323" height="347" fill="#f5ebd8"/>
<text x="1090" y="494" text-anchor="middle" class="caps" font-size="12" fill="#6b4130">TAKE IT SLOW</text>
<text x="1090" y="558" text-anchor="middle" class="serif" font-size="48" font-weight="700" fill="#542e25">SUNDAY</text>
<text x="1090" y="612" text-anchor="middle" class="serif" font-size="48" font-weight="700" fill="#542e25">ROAST</text>
<path d="M1089 641c-50-14-50 59 0 45 50 14 50-59 0-45Zm0 0c25 20-25 25 0 45" fill="none" stroke="#a46843" stroke-width="2"/>
<text x="1090" y="723" text-anchor="middle" class="caps" font-size="14" fill="#6b4130">HOUSE BLEND</text>
<text x="1090" y="752" text-anchor="middle" font-size="12" fill="#a17f65">WHOLE BEAN / 250 g</text>
</g>
${line(78, 829, 650, 829, '#c5ad91')}
<text x="78" y="877" class="caps" font-size="11" fill="#9a7c62">TASTING NOTES</text>
<text x="78" y="916" class="serif" font-size="26" fill="#542e25">Chocolate. Caramel. A little sunshine.</text>
<text x="78" y="1016" font-size="47" class="serif" fill="#542e25">¥89</text>
<text x="177" y="1014" font-size="17" fill="#9a7c62">/ 250 g · Whole bean</text>
${barcode(513, 980, '#88694d')}
<text x="78" y="1066" class="caps" font-size="9" fill="#ad9279">SUNDAY ROAST / BRAND AND PACKAGING STUDY</text>`
  },
  {
    id: 'mono-sound',
    photo: 'headphones',
    width: 1100, height: 1500,
    label: 'Mono Sound — headphone product detail page',
    content: `
<defs><radialGradient id="sound"><stop stop-color="#9b8ac6" stop-opacity=".7"/><stop offset="1" stop-color="#514961" stop-opacity="0"/></radialGradient></defs>
<rect width="1100" height="1500" fill="#fbfbf9"/>
<text x="60" y="73" font-size="27" font-weight="800" letter-spacing="-1" fill="#22252b">mono / sound</text>
<text x="665" y="68" class="caps" font-size="10" fill="#777a80">COLLECTION</text>
<text x="850" y="68" class="caps" font-size="10" fill="#777a80">OUR STORY</text>
${line(60, 105, 1040, 105, '#ddddda')}
<image href="${images.headphones}" x="340" y="140" width="760" height="620" preserveAspectRatio="xMidYMid slice"/>
<rect x="0" y="140" width="340" height="620" fill="#fbfbf9"/>
<text x="60" y="224" class="caps" font-size="11" fill="#85858b">THE EVERYDAY COLLECTION</text>
<text x="55" y="330" font-size="83" font-weight="600" letter-spacing="-5" fill="#23252d">Find</text>
<text x="55" y="425" font-size="83" font-weight="600" letter-spacing="-5" fill="#23252d">your</text>
<text x="55" y="520" class="serif" font-size="88" font-style="italic" letter-spacing="-4" fill="#737280">quiet.</text>
<text x="60" y="588" font-size="17" fill="#86868d">Press play. Tune into yourself.</text>
<text x="60" y="679" font-size="30" fill="#23252d">¥899</text>
<text x="60" y="715" class="caps" font-size="10" fill="#8a8a91">GRAPHITE / EVERYDAY EDITION</text>
${line(60, 780, 1040, 780, '#ddddda')}
<text x="60" y="822" class="caps" font-size="10" fill="#919096">CHOOSE A COLOR</text>
<circle cx="77" cy="859" r="18" fill="#35353b" stroke="#fff" stroke-width="4"/><circle cx="77" cy="859" r="23" fill="none" stroke="#8b8797"/>
<circle cx="136" cy="859" r="18" fill="#d8c9bb"/><circle cx="194" cy="859" r="18" fill="#aa9ebd"/>
<rect x="625" y="810" width="415" height="68" rx="5" fill="#25252c"/>
<text x="658" y="852" font-size="16" fill="#fff">Explore the collection</text>
${arrow(963, 844, '#fff')}
<rect y="938" width="1100" height="562" fill="#25242d"/>
<circle cx="876" cy="1260" r="385" fill="url(#sound)"/>
<text x="60" y="1018" class="caps" font-size="11" fill="#bbb3cd">YOUR OWN LITTLE WORLD</text>
<text x="57" y="1120" class="serif" font-size="76" fill="#f6f2ed">Space for</text>
<text x="57" y="1204" class="serif" font-size="76" font-style="italic" fill="#f6f2ed">every note.</text>
<text x="60" y="1270" font-size="18" fill="#b1aabd">A soundtrack for the way you move.</text>
${Array.from({ length: 39 }, (_, i) => {
      const height = 25 + (Math.sin(i * .55) + 1) * 55 + Math.sin(i * .21) * 35;
      return `<rect x="${600 + i * 10}" y="${1240 - height / 2}" width="3" height="${height}" rx="1.5" fill="#bba9de" opacity="${.4 + i / 80}"/>`;
    }).join('')}
${line(60, 1370, 1040, 1370, '#655c73')}
<text x="60" y="1421" font-size="14" fill="#c8c0d0">Designed for your everyday.</text>
<text x="1040" y="1421" text-anchor="end" class="caps" font-size="10" fill="#a49bb3">MONO / SOUND — PRODUCT PAGE STUDY</text>`
  }
];

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const design of designs) {
    const source = svg(design.width, design.height, design.label, design.content, design.photo);
    await writeFile(path.join(output, `${design.id}.psd.svg`), source);
    const preview = await page.evaluate(async ({ source, width, height }) => {
      const img = new Image();
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = Math.round(320 * height / width);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/webp', .86).split(',')[1];
    }, { source, width: design.width, height: design.height });
    await writeFile(path.join(output, `${design.id}.webp`), Buffer.from(preview, 'base64'));
    console.log(`Prepared ${design.id}`);
  }
} finally { await browser.close(); }
