import JSZip from 'jszip';

const categories = ['Jan', 'Feb', 'Mar', 'Apr'];
const categoryCache = `<c:cat><c:strLit><c:ptCount val="4"/>${categories.map((label, index) =>
  `<c:pt idx="${index}"><c:v>${label}</c:v></c:pt>`
).join('')}</c:strLit></c:cat>`;

function series(index: number, name: string, values: Array<number | null>, style = '', afterValues = '', categoriesXml = categoryCache): string {
  return `<c:ser><c:idx val="${index}"/><c:order val="${index}"/><c:tx><c:strRef>
    <c:f>Sheet1!$A$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${name}</c:v></c:pt></c:strCache>
    </c:strRef></c:tx>${style}${categoriesXml}<c:val><c:numLit><c:formatCode>General</c:formatCode><c:ptCount val="${Math.max(4, values.length)}"/>
    ${values.map((value, point) => value == null ? '' : `<c:pt idx="${point}"><c:v>${value}</c:v></c:pt>`).join('')}
    </c:numLit></c:val>${afterValues}</c:ser>`;
}

function dateCache(dates: Array<number | null>, code = 'yyyy-mm-dd'): string {
  return `<c:cat><c:numLit><c:formatCode>${code}</c:formatCode><c:ptCount val="${dates.length}"/>
    ${dates.map((date, index) => date == null ? '' : `<c:pt idx="${index}"><c:v>${date}</c:v></c:pt>`).join('')}
  </c:numLit></c:cat>`;
}

export function buildDateChartFixture(
  base: Uint8Array, kind: 'line' | 'area' | 'column' | 'bar', unit: 'days' | 'months' | 'years' = 'days'
): Promise<Uint8Array> {
  const calendar = kind === 'line' ? [15, 0, 7, null, 2] : kind === 'area' ? [0, 10, 3, 7]
    : unit === 'months' ? [2, 47, 70, 95] : [2, 400, 800];
  const data = kind === 'line' ? [4, 2, 7, 10000, 3] : kind === 'area' ? [0, 10, null, 7] : [1, 2, 3, 4].slice(0, calendar.length);
  const tag = kind === 'column' || kind === 'bar' ? 'bar' : kind;
  const bars = tag === 'bar';
  const marker = '<c:marker><c:symbol val="circle"/></c:marker>';
  const plot = `<c:${tag}Chart>${bars ? `<c:barDir val="${kind === 'column' ? 'col' : 'bar'}"/>` : ''}
    <c:grouping val="${bars ? 'clustered' : 'standard'}"/>
    ${series(0, 'Schedule', data, kind === 'line' ? marker : '', '', dateCache(calendar))}
    <c:axId val="11"/><c:axId val="12"/></c:${tag}Chart>
    <c:dateAx><c:axId val="11"/>
      <c:scaling>${kind === 'line' ? '<c:orientation val="maxMin"/><c:max val="10"/><c:min val="0"/>' : ''}</c:scaling>
      <c:axPos val="${kind === 'bar' ? 'l' : 'b'}"/><c:majorGridlines/>
      ${kind === 'line' ? '<c:minorGridlines><c:spPr><a:ln><a:solidFill><a:srgbClr val="A1B2C3"/></a:solidFill></a:ln></c:spPr></c:minorGridlines>' : ''}
      <c:numFmt formatCode="${unit === 'months' ? 'mmm yyyy' : unit === 'years' ? 'yyyy' : 'General'}" sourceLinked="${unit === 'days' ? '1' : '0'}"/>
      <c:majorTickMark val="out"/><c:tickLblPos val="low"/><c:crossAx val="12"/>
      ${kind === 'line' ? '<c:crossesAt val="4"/>' : '<c:crosses val="autoZero"/>'}
      <c:baseTimeUnit val="${unit}"/><c:majorUnit val="${kind === 'line' ? 5 : 1}"/>
      <c:majorTimeUnit val="${unit}"/>${kind === 'line' ? '<c:minorUnit val="1"/><c:minorTimeUnit val="days"/>' : ''}
    </c:dateAx>
    <c:valAx><c:axId val="12"/><c:scaling/><c:axPos val="${kind === 'bar' ? 'b' : 'l'}"/><c:crossAx val="11"/>
      <c:crossBetween val="${bars ? 'between' : 'midCat'}"/><c:majorUnit val="2"/></c:valAx>`;
  return writeChartPart(base, `<c:date1904 val="1"/><c:chart><c:plotArea>${plot}</c:plotArea>
    <c:dispBlanksAs val="${kind === 'area' ? 'span' : 'gap'}"/></c:chart>`);
}

export async function buildSecondaryDateChartFixture(base: Uint8Array): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(await buildCombinedChartFixture(base, true));
  const path = 'ppt/charts/chart1.xml';
  const chart = await zip.file(path)!.async('text');
  zip.file(path, chart.replace(categoryCache, dateCache([61, 59, 60, 51]))
    .replace(/<c:catAx><c:axId val="21"\/>[\s\S]*?<\/c:catAx>/,
      '<c:dateAx><c:axId val="21"/><c:scaling/><c:delete val="1"/><c:axPos val="t"/><c:crossAx val="22"/></c:dateAx>'));
  return zip.generateAsync({ type: 'uint8array' });
}

export async function buildCachedChartFixture(
  base: Uint8Array,
  kind: 'line' | 'doughnut',
  blanks: 'gap' | 'zero' | 'span' = 'gap'
): Promise<Uint8Array> {
  const plot = kind === 'line'
    ? `<c:lineChart><c:grouping val="standard"/>
      ${series(0, 'Revenue', [3, null, -2, 5], `<c:spPr><a:ln w="19050">
        <a:solidFill><a:srgbClr val="2855AA"/></a:solidFill><a:prstDash val="dash"/>
      </a:ln></c:spPr><c:marker><c:symbol val="diamond"/><c:size val="9"/><c:spPr>
        <a:solidFill><a:srgbClr val="FF0000"><a:alpha val="50000"/></a:srgbClr></a:solidFill>
      </c:spPr></c:marker>`)}
      ${series(1, 'Costs', [2, 4, 0, 1], `<c:spPr><a:ln><a:noFill/></a:ln></c:spPr>
        <c:marker><c:symbol val="square"/><c:spPr><a:noFill/>
          <a:ln><a:solidFill><a:srgbClr val="008800"/></a:solidFill></a:ln>
        </c:spPr></c:marker>`)}
      <c:axId val="11"/><c:axId val="12"/>
    </c:lineChart>
    <c:catAx><c:axId val="11"/><c:scaling><c:orientation val="maxMin"/></c:scaling><c:axPos val="b"/><c:crossAx val="12"/></c:catAx>
    <c:valAx><c:axId val="12"/><c:scaling><c:max val="6"/><c:min val="-4"/></c:scaling><c:axPos val="l"/>
      <c:numFmt formatCode="0.0" sourceLinked="0"/><c:crossAx val="11"/><c:majorUnit val="2"/>
    </c:valAx>`
    : `<c:doughnutChart><c:varyColors val="1"/>
      ${series(1, 'Outer', [3, 1, null, 0], `<c:dPt><c:idx val="1"/><c:spPr>
        <a:solidFill><a:srgbClr val="00FF00"><a:alpha val="50000"/></a:srgbClr></a:solidFill>
      </c:spPr></c:dPt>`)}
      ${series(0, 'Inner', [5, null, 0, 0])}
      <c:firstSliceAng val="90"/><c:holeSize val="60"/>
    </c:doughnutChart>`;
  return replaceCachedChart(base, plot, blanks);
}

export function buildStackedLineChartFixture(
  base: Uint8Array,
  grouping: 'stacked' | 'percentStacked',
  blanks: 'gap' | 'zero' | 'span'
): Promise<Uint8Array> {
  const circle = '<c:marker><c:symbol val="circle"/></c:marker>';
  const axisCrossing = '<c:crossAx val="11"/>';
  const percentAxis = grouping === 'percentStacked'
    ? `<c:numFmt formatCode="0.0%" sourceLinked="0"/>${axisCrossing}<c:majorUnit val="0.25"/>`
    : axisCrossing;
  const plot = `<c:lineChart><c:grouping val="${grouping}"/>
    ${series(0, 'Revenue', [3, null, -2, 5], circle, '<c:smooth val="1"/>')}
    ${series(1, 'Costs', [2, 4, 1, 1], circle, '<c:smooth val="0"/>')}
    <c:smooth val="1"/><c:axId val="11"/><c:axId val="12"/>
    </c:lineChart>
    <c:catAx><c:axId val="11"/><c:scaling><c:orientation val="maxMin"/></c:scaling><c:axPos val="b"/><c:crossAx val="12"/></c:catAx>
    <c:valAx><c:axId val="12"/><c:scaling/><c:axPos val="l"/>${percentAxis}</c:valAx>`;
  return replaceCachedChart(base, plot, blanks);
}

function areaPlot(grouping: 'standard' | 'stacked' | 'percentStacked', upperIndex = 1): string {
  const gradient = `<c:spPr><a:gradFill><a:gsLst>
    <a:gs pos="0"><a:srgbClr val="2855AA"/></a:gs>
    <a:gs pos="100000"><a:srgbClr val="68BFFF"><a:alpha val="50000"/></a:srgbClr></a:gs>
    </a:gsLst><a:lin ang="5400000" scaled="1"/></a:gradFill>
    <a:ln w="19050"><a:solidFill><a:srgbClr val="123456"/></a:solidFill><a:prstDash val="dash"/></a:ln></c:spPr>`;
  const orange = `<c:spPr><a:solidFill><a:srgbClr val="FF8800"><a:alpha val="60000"/></a:srgbClr></a:solidFill>
    <a:ln><a:noFill/></a:ln></c:spPr>`;
  return `<c:areaChart><c:grouping val="${grouping}"/>
    ${series(upperIndex, 'Changes', [2, 6, 2, 2], orange)}
    ${series(0, 'Base', [4, 2, null, -4], gradient)}
    <c:axId val="11"/><c:axId val="12"/></c:areaChart>`;
}

export function buildAreaChartFixture(
  base: Uint8Array, grouping: 'standard' | 'stacked' | 'percentStacked',
  blanks: 'gap' | 'zero' | 'span' = 'gap', crossBetween: 'between' | 'midCat' = 'midCat'
): Promise<Uint8Array> {
  const valueAxis = grouping === 'percentStacked'
    ? '<c:numFmt formatCode="0.0%" sourceLinked="0"/><c:crossAx val="11"/>'
    : '<c:crossAx val="11"/>';
  const plot = `${areaPlot(grouping)}
    <c:catAx><c:axId val="11"/><c:scaling><c:orientation val="maxMin"/></c:scaling><c:axPos val="b"/><c:crossAx val="12"/></c:catAx>
    <c:valAx><c:axId val="12"/><c:scaling/><c:axPos val="l"/><c:majorGridlines/>
      ${valueAxis}<c:crossBetween val="${crossBetween}"/>
    </c:valAx>`;
  return replaceCachedChart(base, plot, blanks, 'b');
}

export function buildAreaCombinationFixture(base: Uint8Array): Promise<Uint8Array> {
  const plot = `${areaPlot('stacked', 2)}
    <c:barChart><c:barDir val="col"/><c:grouping val="clustered"/>${series(1, 'Budget', [3, 5, 3, -2])}
      <c:gapWidth val="125"/><c:axId val="11"/><c:axId val="12"/></c:barChart>
    <c:lineChart><c:grouping val="standard"/>${series(3, 'Margin', [0.25, 0.5, 0.75, 1], '<c:marker><c:symbol val="circle"/></c:marker>')}
      <c:axId val="11"/><c:axId val="22"/></c:lineChart>
    <c:catAx><c:axId val="11"/><c:scaling/><c:axPos val="b"/><c:crossAx val="12"/></c:catAx>
    <c:valAx><c:axId val="12"/><c:scaling><c:max val="6"/><c:min val="-4"/></c:scaling><c:axPos val="l"/>
      <c:majorGridlines/><c:crossAx val="11"/><c:crossBetween val="between"/><c:majorUnit val="2"/></c:valAx>
    <c:valAx><c:axId val="22"/><c:scaling><c:max val="1"/><c:min val="0"/></c:scaling><c:axPos val="r"/>
      <c:numFmt formatCode="0%" sourceLinked="0"/><c:crossAx val="11"/><c:crossBetween val="between"/><c:majorUnit val="0.25"/></c:valAx>`;
  return replaceCachedChart(base, plot, 'span', 'b');
}

function xySeries(
  index: number, name: string, x: Array<number | null>, y: Array<number | null>, properties = '', sizes?: Array<number | null>
): string {
  const cache = (values: Array<number | null>) => `<c:formatCode>General</c:formatCode><c:ptCount val="${values.length}"/>
    ${values.map((value, index) => value == null ? '' : `<c:pt idx="${index}"><c:v>${value}</c:v></c:pt>`).join('')}`;
  return `<c:ser><c:idx val="${index}"/><c:order val="${index}"/><c:tx><c:v>${name}</c:v></c:tx>${properties}
      <c:xVal><c:numRef><c:f>Sheet1!A1:A${x.length}</c:f><c:numCache>${cache(x)}</c:numCache></c:numRef></c:xVal>
      <c:yVal><c:numLit>${cache(y)}</c:numLit></c:yVal>${sizes ? `<c:bubbleSize><c:numRef>
        <c:f>Sheet1!C1:C${sizes.length}</c:f><c:numCache>${cache(sizes)}</c:numCache></c:numRef></c:bubbleSize>` : ''}</c:ser>`;
}

export function buildScatterChartFixture(
  base: Uint8Array, blanks: 'gap' | 'zero' | 'span' = 'gap', style: 'smoothMarker' | 'marker' = 'smoothMarker'
): Promise<Uint8Array> {
  const title = (text: string, font: string) => `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p>
    <a:r><a:rPr sz="850"><a:latin typeface="${font}"/></a:rPr><a:t>${text}</a:t></a:r>
    </a:p></c:rich></c:tx></c:title>`;
  const measuredStyle = style === 'marker' ? '' : `<c:spPr><a:ln w="19050"><a:solidFill><a:srgbClr val="2855AA"/></a:solidFill>
    <a:prstDash val="dash"/></a:ln></c:spPr>`;
  const plot = `<c:scatterChart><c:scatterStyle val="${style}"/>
    ${xySeries(1, 'Reference', [5, 45, 60], [4, 10, 17], `<c:spPr><a:ln><a:noFill/></a:ln></c:spPr>
      <c:marker><c:symbol val="square"/><c:spPr><a:noFill/><a:ln><a:solidFill><a:srgbClr val="008800"/></a:solidFill></a:ln></c:spPr></c:marker>`)}
    ${xySeries(0, 'Measured', [10, 24, 24, 30, 14, 40, null], [2, 6, 10, null, 8, 16, 3], `${measuredStyle}
      <c:marker><c:symbol val="diamond"/><c:size val="8"/><c:spPr>
      <a:solidFill><a:srgbClr val="FF0000"><a:alpha val="50000"/></a:srgbClr></a:solidFill>
      </c:spPr></c:marker>`)}
    <c:axId val="11"/><c:axId val="12"/></c:scatterChart>
    <c:valAx><c:axId val="12"/><c:scaling><c:max val="20"/><c:min val="-10"/></c:scaling><c:axPos val="l"/>
      <c:majorGridlines/>${title('Response', 'Arial')}
      <c:numFmt formatCode="0.00" sourceLinked="0"/><c:tickLblPos val="high"/><c:majorTickMark val="in"/>
      <c:crossAx val="11"/><c:crossesAt val="5"/><c:majorUnit val="5"/>
    </c:valAx>
    <c:valAx><c:axId val="11"/><c:scaling><c:orientation val="maxMin"/><c:max val="50"/><c:min val="0"/></c:scaling><c:axPos val="b"/>
      <c:majorGridlines><c:spPr><a:ln><a:solidFill><a:srgbClr val="AABBCC"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>
      ${title('Distance', 'Courier New')}<c:numFmt formatCode="0.0" sourceLinked="0"/>
      <c:tickLblPos val="low"/><c:majorTickMark val="cross"/><c:crossAx val="12"/><c:crossesAt val="20"/><c:majorUnit val="10"/>
    </c:valAx>`;
  return replaceCachedChart(base, plot, blanks);
}

export function buildLogScatterFixture(base: Uint8Array, logY = true, automatic = false): Promise<Uint8Array> {
  const plot = `<c:scatterChart><c:scatterStyle val="lineMarker"/>
    ${xySeries(0, 'Signal', [1, 10, 100, 0, 1000, 20, -10, 30, 100, 9999, 200], [2, 4, 8, 9, 16, 0, 32, -2, null, 64, 32])}
    <c:axId val="11"/><c:axId val="12"/></c:scatterChart>
    <c:valAx><c:axId val="11"/><c:scaling><c:logBase val="10"/><c:orientation val="maxMin"/>
      ${automatic ? '' : '<c:max val="1000"/><c:min val="1"/>'}</c:scaling><c:axPos val="b"/>
      <c:majorGridlines/><c:minorGridlines><c:spPr><a:ln w="9525"><a:solidFill><a:srgbClr val="334455"/></a:solidFill>
        <a:prstDash val="dot"/></a:ln></c:spPr></c:minorGridlines>
      <c:numFmt formatCode="0.0E+00" sourceLinked="0"/><c:majorTickMark val="out"/><c:minorTickMark val="in"/>
      <c:tickLblPos val="low"/><c:crossAx val="12"/><c:crossesAt val="10"/></c:valAx>
    <c:valAx><c:axId val="12"/><c:scaling>${logY ? '<c:logBase val="2"/>' : ''}
      ${automatic ? '' : `<c:max val="64"/><c:min val="${logY ? 2 : -16}"/>`}</c:scaling><c:axPos val="l"/>
      <c:majorGridlines/><c:minorGridlines/><c:numFmt formatCode="0" sourceLinked="0"/>
      <c:majorTickMark val="out"/><c:tickLblPos val="low"/><c:crossAx val="11"/><c:crossesAt val="4"/>
      ${logY ? '' : '<c:majorUnit val="16"/>'}</c:valAx>`;
  return replaceCachedChart(base, plot, 'zero');
}

export function buildBubbleChartFixture(base: Uint8Array, options = '', automatic = false): Promise<Uint8Array> {
  const measured = `<c:spPr><a:solidFill><a:srgbClr val="2855AA"><a:alpha val="60000"/></a:srgbClr></a:solidFill>
    <a:ln w="19050"><a:solidFill><a:srgbClr val="123456"/></a:solidFill><a:prstDash val="dash"/></a:ln></c:spPr>
    <c:dPt><c:idx val="1"/><c:spPr><a:solidFill><a:srgbClr val="FF0000"><a:alpha val="50000"/></a:srgbClr></a:solidFill>
      <a:ln><a:noFill/></a:ln></c:spPr></c:dPt>
    <c:dPt><c:idx val="2"/><c:spPr><a:ln><a:solidFill><a:srgbClr val="FF8800"/></a:solidFill></a:ln></c:spPr></c:dPt>
    <c:dPt><c:idx val="9"/><c:spPr><a:noFill/></c:spPr></c:dPt>`;
  const plot = `<c:bubbleChart>
    ${xySeries(1, 'Reference', [4, 40], [-4, 23], '', [16, 4])}
    ${xySeries(0, 'Measured', [2, 10, 20, 30, null, 50, 60, 200, 0, 100], [5, 10, 15, 20, 25, null, 12, 20, 23, 16],
      measured, [4, 16, -9, null, 81, 144, 0, 1, 225, 9])}
    ${options}<c:axId val="11"/><c:axId val="12"/></c:bubbleChart>
    <c:valAx><c:axId val="12"/><c:scaling>${automatic ? '' : '<c:max val="30"/><c:min val="-10"/>'}</c:scaling>
      <c:axPos val="l"/><c:majorGridlines/><c:crossAx val="11"/><c:crossesAt val="5"/><c:majorUnit val="10"/></c:valAx>
    <c:valAx><c:axId val="11"/><c:scaling><c:logBase val="10"/><c:orientation val="maxMin"/>
      ${automatic ? '' : '<c:max val="100"/><c:min val="1"/>'}</c:scaling><c:axPos val="b"/>
      <c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:rPr><a:latin typeface="Courier New"/></a:rPr>
        <a:t>Distance</a:t></a:r></a:p></c:rich></c:tx></c:title>
      <c:tickLblPos val="low"/><c:crossAx val="12"/><c:crossesAt val="10"/></c:valAx>`;
  return replaceCachedChart(base, plot, 'gap', 'b');
}

export function buildCombinedChartFixture(base: Uint8Array, secondary: boolean): Promise<Uint8Array> {
  const primaryCategory = 11;
  const primaryValue = 12;
  const lineCategory = secondary ? 21 : primaryCategory;
  const lineValue = secondary ? 22 : primaryValue;
  const axes = (category: number, value: number) => `<c:axId val="${category}"/><c:axId val="${value}"/>`;
  const reverse = '<c:scaling><c:orientation val="maxMin"/></c:scaling>';
  const secondaryAxes = secondary ? `
    <c:catAx><c:axId val="${lineCategory}"/>${reverse}<c:delete val="1"/><c:axPos val="t"/><c:crossAx val="${lineValue}"/></c:catAx>
    <c:valAx><c:axId val="${lineValue}"/><c:scaling><c:max val="1"/><c:min val="0"/></c:scaling><c:axPos val="r"/>
      <c:numFmt formatCode="0%" sourceLinked="0"/><c:crossAx val="${lineCategory}"/><c:majorUnit val="0.25"/>
    </c:valAx>` : '';
  const primaryBounds = secondary ? '<c:max val="100"/><c:min val="-20"/>' : '';
  const plot = `<c:lineChart><c:grouping val="standard"/>
    ${series(0, 'Margin', secondary ? [0.5, null, 0.75, 0.25] : [95, null, 175, 25], `<c:spPr><a:ln>
      <a:solidFill><a:srgbClr val="007A52"/></a:solidFill></a:ln></c:spPr><c:marker><c:symbol val="circle"/></c:marker>`)}
    ${axes(lineCategory, lineValue)}</c:lineChart>
    <c:barChart><c:barDir val="col"/><c:grouping val="stacked"/>
      ${series(1, 'Products', [40, 25, 60, 10])}${series(2, 'Services', [10, 5, -10, 5])}
      <c:gapWidth val="80"/>${axes(primaryCategory, primaryValue)}
    </c:barChart>
    ${secondaryAxes}
    <c:catAx><c:axId val="${primaryCategory}"/>${reverse}<c:axPos val="b"/><c:crossAx val="${primaryValue}"/></c:catAx>
    <c:valAx><c:axId val="${primaryValue}"/><c:scaling>${primaryBounds}</c:scaling><c:axPos val="l"/>
      <c:crossAx val="${primaryCategory}"/>${secondary ? '<c:majorUnit val="20"/>' : ''}
    </c:valAx>`;
  return replaceCachedChart(base, plot, 'span');
}

export function buildChartFontFixture(base: Uint8Array): Promise<Uint8Array> {
  const textProperties = (run: string) => `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr>${run}</a:pPr></a:p></c:txPr>`;
  const title = `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p>
    <a:r><a:t xml:space="preserve">Net </a:t></a:r>
    <a:fld id="{BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB}"><a:rPr b="false" i="true"><a:latin typeface="Filens Chart Accent"/></a:rPr><a:t>margin</a:t></a:fld>
    <a:r><a:t xml:space="preserve"> report</a:t></a:r><a:br/><a:r><a:t>Quarterly view</a:t></a:r>
    <a:endParaRPr><a:latin typeface="Filens Unused End Font"/></a:endParaRPr>
    </a:p></c:rich></c:tx>
    ${textProperties('<a:defRPr b="true" sz="1200"><a:latin typeface="Filens Chart Caption"/></a:defRPr>')}</c:title>`;
  const bar = `<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/>
    ${series(0, 'Products', [2, 3, 4, 5], `<c:dLbls>${textProperties('<a:defRPr i="true"/>')}</c:dLbls>`)}
    ${series(1, 'Services', [1, 2, 3, 4], `<c:dLbls>${textProperties('<a:defRPr><a:latin typeface="Filens Hidden Labels"/></a:defRPr>')}<c:showVal val="0"/></c:dLbls>`)}
    <c:dLbls><c:numFmt formatCode="0.0" sourceLinked="0"/>
      ${textProperties('<a:defRPr sz="750"><a:latin typeface="Filens Chart Labels"/></a:defRPr>')}
      <c:dLblPos val="outEnd"/><c:showVal val="1"/>
    </c:dLbls><c:axId val="11"/><c:axId val="12"/>
    </c:barChart>`;
  const axes = `<c:catAx><c:axId val="11"/><c:scaling/><c:axPos val="b"/>
      ${textProperties('<a:defRPr b="true"/>')}<c:crossAx val="12"/>
    </c:catAx>
    <c:valAx><c:axId val="12"/><c:scaling/><c:axPos val="l"/>
      ${textProperties('<a:defRPr><a:latin typeface="Filens Chart Axis"/></a:defRPr>')}<c:crossAx val="11"/>
    </c:valAx>`;
  const legend = `<c:legend><c:legendPos val="r"/>
    ${textProperties('<a:defRPr sz="750" i="true"><a:latin typeface="Filens Chart Legend"/></a:defRPr>')}</c:legend>`;
  const chartStyle = `<c:txPr><a:bodyPr/><a:lstStyle><a:defPPr><a:defRPr sz="900">
    <a:latin typeface="Filens Chart Base"/></a:defRPr></a:defPPr></a:lstStyle><a:p/></c:txPr>`;
  return writeChartPart(base, `<c:chart>${title}<c:plotArea>${bar}${axes}</c:plotArea>${legend}</c:chart>${chartStyle}`);
}

export async function buildChartAxisTitleFixture(
  base: Uint8Array, type: 'combo' | 'bar' = 'combo', overlay = false
): Promise<Uint8Array> {
  const seed = type === 'combo' ? await buildCombinedChartFixture(base, true) : await buildChartFontFixture(base);
  const zip = await JSZip.loadAsync(seed);
  const path = 'ppt/charts/chart1.xml';
  const xml = await zip.file(path)!.async('text');
  const titled = (tx: string, family: string, body = '', overlays = false) =>
    `<c:title><c:tx>${tx}</c:tx>${overlays ? '<c:overlay val="1"/>' : ''}<c:txPr>
      <a:bodyPr ${body}/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900" b="1"><a:latin typeface="${family}"/></a:defRPr></a:pPr></a:p>
    </c:txPr></c:title>`;
  const rich = (runs: string) => `<c:rich><a:bodyPr/><a:lstStyle/><a:p>${runs}</a:p></c:rich>`;
  const category = titled(rich(`
    <a:r><a:t xml:space="preserve">Fiscal </a:t></a:r>
    <a:fld id="{CCCCCCCC-CCCC-4CCC-8CCC-CCCCCCCCCCCC}"><a:rPr lang="zh-CN"><a:ea typeface="Filens Axis Han"/></a:rPr><a:t>年度</a:t></a:fld>
    <a:r><a:t xml:space="preserve"> trends</a:t></a:r><a:br/><a:r><a:t>Q1–Q4</a:t></a:r>
  `), 'Filens Axis Category');
  const primary = titled(rich('<a:r><a:t>Revenue (USD)</a:t></a:r>'), 'Filens Axis Revenue');
  const secondary = titled('<c:strRef><c:f>Sheet1!$B$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Margin %</c:v></c:pt></c:strCache></c:strRef>',
    'Filens Axis Margin', 'rot="1200000" vert="horz"', overlay);
  const source = type === 'bar' ? xml.replace('<c:barDir val="col"/>', '<c:barDir val="bar"/>') : xml;
  zip.file(path, source.replace(/<c:(catAx|valAx)>[\s\S]*?<\/c:\1>/g, (axis, tag: string) => {
    if (tag === 'catAx') {
      return axis.replace('<c:axPos val="b"/>', `<c:axPos val="${type === 'bar' ? 'l' : 'b'}"/>${category}`);
    }
    return axis.replace('<c:axPos val="l"/>', `<c:axPos val="${type === 'bar' ? 'b' : 'l'}"/>${primary}`)
      .replace('<c:axPos val="r"/>', `<c:axPos val="r"/>${secondary}`);
  }));
  return zip.generateAsync({ type: 'uint8array' });
}

export async function buildManualChartTitleFixture(base: Uint8Array): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(await buildChartAxisTitleFixture(base, 'bar'));
  const path = 'ppt/charts/chart1.xml';
  const chart = await zip.file(path)!.async('text');
  const layout = (children: string) => `<c:layout><c:manualLayout>${children}</c:manualLayout></c:layout>`;
  const main = layout('<c:xMode val="edge"/><c:yMode val="edge"/><c:x val="0.24"/><c:y val="0.36"/>') + '<c:overlay val="true"/>';
  const category = layout('<c:xMode val="factor"/><c:yMode val="edge"/><c:x val="0.28"/><c:y val="0.29"/>');
  const primary = layout('<c:xMode val="edge"/><c:x val="1.4"/><c:y val="-0.16"/>');
  const placements = [main, category, primary];
  let index = 0;
  zip.file(path, chart.replace(/(<c:title><c:tx>[\s\S]*?<\/c:tx>)/g, (_, title: string) => `${title}${placements[index++]}`));
  return zip.generateAsync({ type: 'uint8array' });
}

export async function buildVerticalChartTitleFixture(base: Uint8Array): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(await buildChartAxisTitleFixture(base));
  const path = 'ppt/charts/chart1.xml';
  const chart = await zip.file(path)!.async('text');
  const main = `<c:title><c:tx><c:rich><a:bodyPr vert="eaVert"/><a:lstStyle/><a:p>
    <a:r><a:t>春A期</a:t></a:r><a:br/><a:r><a:t>第二季主要產品出貨與收入</a:t></a:r>
  </a:p></c:rich></c:tx></c:title>`;
  zip.file(path, chart
    .replace('<c:chart>', `<c:chart>${main}`)
    .replace('Fiscal ', 'Cafe\u0301 ')
    .replace('<a:t xml:space="preserve"> trends</a:t>', '<a:t>𠀀</a:t>')
    .replace(/<a:bodyPr \/>(<a:lstStyle\/><a:p><a:pPr><a:defRPr sz="900" b="1"><a:latin typeface="Filens Axis Category")/,
      '<a:bodyPr vert="wordArtVert"/>$1')
    .replace('<c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Revenue (USD)</a:t></a:r>',
      '<c:rich><a:bodyPr vert="wordArtVertRtl" rot="900000"/><a:lstStyle/><a:p><a:r><a:t>2026</a:t></a:r><a:br/><a:r><a:t>USD</a:t></a:r>')
    .replace('rot="1200000" vert="horz"', 'vert="mongolianVert"')
    .replace('Margin %', 'ᠮᠣᠩᠭᠣᠯ\nᠪᠢᠴᠢᠭ'));
  return zip.generateAsync({ type: 'uint8array' });
}

export async function buildMixedChartLabelFixture(base: Uint8Array): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(await buildChartAxisTitleFixture(base, 'bar'));
  const chartPath = 'ppt/charts/chart1.xml';
  const chart = await zip.file(chartPath)!.async('text');
  zip.file(chartPath, chart
    .replaceAll('<c:v>Jan</c:v>', '<c:v>Q1 季節 العَرَبِيَّة</c:v>')
    .replaceAll('<c:v>Feb</c:v>', '<c:v>東京・計画</c:v>')
    .replaceAll('<c:v>Mar</c:v>', '<c:v>Cafe\u0301 𠀀</c:v>')
    .replaceAll('<c:v>Apr</c:v>', '<c:v>العربية</c:v>')
    .replace('<c:v>Products</c:v>', '<c:v>Products 日本語 العربية</c:v>')
    .replace('<a:defRPr sz="900">\n    <a:latin typeface="Filens Chart Base"/></a:defRPr>',
      '<a:defRPr sz="900" lang="en-US" altLang="ja-JP"><a:latin typeface="Filens Label Latin"/><a:ea typeface="+mn-ea"/><a:cs typeface="Filens Label Arabic"/></a:defRPr>')
    .replace('<a:defRPr b="true"/>', '<a:defRPr b="true"><a:cs typeface="Filens Tick Arabic"/></a:defRPr>')
    .replace('<a:latin typeface="Filens Chart Axis"/>', '<a:latin typeface="Filens Chart Axis"/><a:ea typeface="Filens Unused Numeric Han"/>'));
  const themePath = 'ppt/theme/theme1.xml';
  const theme = await zip.file(themePath)!.async('text');
  zip.file(themePath, theme.replace(/<a:minorFont>[\s\S]*?<\/a:minorFont>/, minor => minor
    .replace(/<a:font script="Jpan" typeface="[^"]*"\s*\/>/, '<a:font script="Jpan" typeface="Filens Theme Japanese"/>')));
  return zip.generateAsync({ type: 'uint8array' });
}

function replaceCachedChart(base: Uint8Array, plot: string, blanks: string, legend = 'r'): Promise<Uint8Array> {
  return writeChartPart(base, `<c:chart><c:plotArea>${plot}</c:plotArea><c:legend><c:legendPos val="${legend}"/></c:legend><c:dispBlanksAs val="${blanks}"/></c:chart>`);
}

async function writeChartPart(base: Uint8Array, content: string): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(base);
  zip.file('ppt/charts/chart1.xml', `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
    ${content}</c:chartSpace>`);
  return zip.generateAsync({ type: 'uint8array' });
}

export function buildChartAnimationDataFixture(base: Uint8Array, kind: 'column' | 'line'): Promise<Uint8Array> {
  const first = series(40, 'Observed', [3, 5, 7, 8]).replace('<c:order val="40"/>', '<c:order val="0"/>');
  const second = series(17, 'Target', [2, 6, 4, 1]).replace('<c:order val="17"/>', '<c:order val="1"/>');
  const plot = kind === 'column'
    ? `<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/>${first}${second}
       <c:dLbls><c:showVal val="1"/></c:dLbls><c:axId val="11"/><c:axId val="12"/></c:barChart>`
    : `<c:lineChart><c:grouping val="standard"/>${second}${first}
       <c:marker val="1"/><c:axId val="11"/><c:axId val="12"/></c:lineChart>`;
  return replaceCachedChart(base, `${plot}
    <c:catAx><c:axId val="11"/><c:scaling><c:orientation val="maxMin"/></c:scaling><c:axPos val="b"/><c:crossAx val="12"/></c:catAx>
    <c:valAx><c:axId val="12"/><c:scaling/><c:axPos val="l"/><c:majorGridlines/><c:crossAx val="11"/></c:valAx>`,
  'gap', 'b');
}
