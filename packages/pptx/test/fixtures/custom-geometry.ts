import JSZip from 'jszip';

export async function buildCustomGeometryCommandOrderFixture(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`
  );
  zip.file(
    'ppt/presentation.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldMasterIdLst>
    <p:sldMasterId id="2147483648" r:id="rId1"/>
  </p:sldMasterIdLst>
  <p:sldIdLst>
    <p:sldId id="256" r:id="rId2"/>
  </p:sldIdLst>
  <p:sldSz cx="9144000" cy="5143500"/>
</p:presentation>`
  );
  zip.file(
    'ppt/_rels/presentation.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
</Relationships>`
  );
  zip.file(
    'ppt/slideMasters/slideMaster1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    </p:spTree>
  </p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst>
    <p:sldLayoutId id="2147483649" r:id="rId1"/>
  </p:sldLayoutIdLst>
</p:sldMaster>`
  );
  zip.file(
    'ppt/slideMasters/_rels/slideMaster1.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`
  );
  zip.file(
    'ppt/slideLayouts/slideLayout1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" preserve="1">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    </p:spTree>
  </p:cSld>
</p:sldLayout>`
  );
  zip.file(
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`
  );
  zip.file(
    'ppt/theme/theme1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Fixture Theme">
  <a:themeElements>
    <a:clrScheme name="Fixture Colors">
      <a:dk1><a:srgbClr val="122033"/></a:dk1>
      <a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="20324A"/></a:dk2>
      <a:lt2><a:srgbClr val="F6F8FB"/></a:lt2>
      <a:accent1><a:srgbClr val="2F6BFF"/></a:accent1>
      <a:accent2><a:srgbClr val="FF7A59"/></a:accent2>
      <a:accent3><a:srgbClr val="2ABF88"/></a:accent3>
      <a:accent4><a:srgbClr val="FFB020"/></a:accent4>
      <a:accent5><a:srgbClr val="8A63D2"/></a:accent5>
      <a:accent6><a:srgbClr val="25A7C5"/></a:accent6>
      <a:hlink><a:srgbClr val="2F6BFF"/></a:hlink>
      <a:folHlink><a:srgbClr val="8A63D2"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="Fixture Fonts">
      <a:majorFont><a:latin typeface="Aptos"/></a:majorFont>
      <a:minorFont><a:latin typeface="Calibri"/></a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="Fixture Format">
      <a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
      <a:lnStyleLst><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
      <a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>
      <a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
    </a:fmtScheme>
  </a:themeElements>
</a:theme>`
  );
  zip.file(
    'ppt/slides/slide1.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="2" name="Ordered Freeform"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm><a:off x="914400" y="914400"/><a:ext cx="3657600" cy="1828800"/></a:xfrm>
          <a:custGeom>
            <a:avLst/>
            <a:pathLst>
              <a:path w="100000" h="100000">
                <a:moveTo><a:pt x="10000" y="10000"/></a:moveTo>
                <a:cubicBezTo>
                  <a:pt x="20000" y="0"/>
                  <a:pt x="40000" y="0"/>
                  <a:pt x="50000" y="10000"/>
                </a:cubicBezTo>
                <a:lnTo><a:pt x="80000" y="20000"/></a:lnTo>
                <a:quadBezTo>
                  <a:pt x="90000" y="50000"/>
                  <a:pt x="60000" y="90000"/>
                </a:quadBezTo>
                <a:close/>
              </a:path>
            </a:pathLst>
          </a:custGeom>
          <a:solidFill><a:schemeClr val="accent3"/></a:solidFill>
          <a:ln><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:ln>
        </p:spPr>
      </p:sp>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`
  );
  zip.file(
    'ppt/slides/_rels/slide1.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`
  );

  return new Uint8Array(await zip.generateAsync({ type: 'uint8array' }));
}

export async function buildCustomGeometryTextRectangleFixture(): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(await buildCustomGeometryCommandOrderFixture());
  const file = 'ppt/slides/slide1.xml';
  const slide = await zip.file(file)!.async('text');
  const source = slide.match(/<p:sp>[\s\S]*?<\/p:sp>/)![0];
  const shape = (id: number, name: string, anchor: string, geometry: string) => source
    .replace('id="2" name="Ordered Freeform"', `id="${id}" name="${name}"`)
    .replace('<a:avLst/>', geometry)
    .replace('</p:sp>', `<p:txBody><a:bodyPr anchor="${anchor}" lIns="0" rIns="0" tIns="0" bIns="0"/><a:lstStyle/>
      <a:p><a:r><a:rPr sz="1200"><a:latin typeface="Arial"/></a:rPr><a:t>${name}</a:t></a:r></a:p>
    </p:txBody></p:sp>`);
  const guideChain = Array.from({ length: 512 }, (_, index) =>
    `<a:gd name="edge${index}" fmla="val ${index === 511 ? 'b' : `edge${index + 1}`}"/>`).join('');
  const group = `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="6" name="Scaled group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
    <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="7315200" cy="914400"/>
      <a:chOff x="0" y="0"/><a:chExt cx="3657600" cy="1828800"/></a:xfrm></p:grpSpPr>
    ${shape(2, 'Grouped guide rectangle', 'ctr', `<a:avLst><a:gd name="adj" fmla="val 228600"/></a:avLst>
      <a:gdLst><a:gd name="inset" fmla="+- wd8 adj 0"/><a:gd name="edge" fmla="+- w 0 wd4"/>${guideChain}</a:gdLst>
      <a:rect l="inset" t="hd4" r="edge" b="edge0"/>`)}
    </p:grpSp>`;
  const extended = shape(3, 'Extended literal rectangle', 'b', '<a:rect l="-190500" t="95250" r="3810000" b="2019300"/>')
    .replace('<p:cNvSpPr/>', '<p:cNvSpPr txBox="1"/>');
  const cyclic = shape(4, 'Cyclic rectangle guide', 't', `<a:gdLst><a:gd name="bad" fmla="val other"/>
    <a:gd name="other" fmla="val bad"/></a:gdLst><a:rect l="bad" t="t" r="r" b="b"/>`);
  const reversed = shape(5, 'Reversed rectangle', 't', '<a:rect l="r" t="t" r="l" b="b"/>');
  const placeholder = (markup: string) => markup.replace('<p:nvPr/>', '<p:nvPr><p:ph type="body" idx="9"/></p:nvPr>');
  const layoutFile = 'ppt/slideLayouts/slideLayout1.xml';
  const layout = await zip.file(layoutFile)!.async('text');
  const layoutShape = placeholder(shape(7, 'Layout placeholder', 't', '<a:rect l="114300" t="t" r="wd2" b="b"/>'));
  zip.file(layoutFile, layout.replace('</p:spTree>', layoutShape + '</p:spTree>'));
  const resized = placeholder(shape(8, 'Resized placeholder', 't', ''))
    .replace(/<a:custGeom>[\s\S]*?<\/a:custGeom>/, '')
    .replace('cx="3657600"', 'cx="1828800"');
  zip.file(file, slide.replace(source, group + extended + cyclic + reversed + resized));
  return zip.generateAsync({ type: 'uint8array' });
}

export async function buildGuidedCustomPathFixture(): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(await buildCustomGeometryCommandOrderFixture());
  const file = 'ppt/slides/slide1.xml';
  const slide = await zip.file(file)!.async('text');
  const source = slide.match(/<p:sp>[\s\S]*?<\/p:sp>/)![0];
  const shape = (id: number, name: string, geometry: string) => source
    .replace('id="2" name="Ordered Freeform"', `id="${id}" name="${name}"`)
    .replace(/<a:custGeom>[\s\S]*?<\/a:custGeom>/, `<a:custGeom>${geometry}</a:custGeom>`);
  const guided = shape(2, 'Guided ellipse', `
    <a:avLst><a:gd name="adj" fmla="val 30"/></a:avLst>
    <a:gdLst><a:gd name="radius" fmla="*/ w adj 120"/><a:gd name="reverse" fmla="+- 0 0 cd2"/>
      <a:gd name="bad" fmla="val cycle"/><a:gd name="cycle" fmla="val bad"/></a:gdLst>
    <a:pathLst>
      <a:path w="120" h="80">
        <a:moveTo><a:pt x="hc" y="vc"/></a:moveTo>
        <a:arcTo wR="radius" hR="hd4" stAng="cd8" swAng="cd8"/>
        <a:lnTo><a:pt x="r" y="b"/></a:lnTo><a:close/>
        <a:arcTo wR="radius" hR="hd4" stAng="0" swAng="+21600000"/>
        <a:moveTo><a:pt x="10" y="10"/></a:moveTo>
        <a:lnTo><a:pt x="bad" y="10"/></a:lnTo><a:close/>
        <a:moveTo><a:pt x="0" y="vc"/></a:moveTo>
        <a:arcTo wR="radius" hR="hd4" stAng="cd2" swAng="reverse"/><a:close/>
        <a:lnTo><a:pt x="unknownAfterClose" y="10"/></a:lnTo>
      </a:path>
      <a:path fill="none" stroke="0">
        <a:moveTo><a:pt x="wd4" y="hd2"/></a:moveTo>
        <a:quadBezTo><a:pt x="hc" y="t"/><a:pt x="r" y="b"/></a:quadBezTo>
      </a:path>
    </a:pathLst>`);
  const invalid = shape(3, 'Invalid path', `<a:pathLst><a:path w="120" h="80">
    <a:moveTo><a:pt x="0" y="0"/></a:moveTo>
    <a:arcTo wR="unknownGuide" hR="10" stAng="0" swAng="cd4"/>
  </a:path></a:pathLst>`);
  zip.file(file, slide.replace(source, guided + invalid));
  return zip.generateAsync({ type: 'uint8array' });
}
