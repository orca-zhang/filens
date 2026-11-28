import JSZip from 'jszip';

const row = (index, ...cells) => `<row r="${index}">${cells.join('')}</row>`;
const cell = (ref, value, type = 'n') => `<c r="${ref}" t="${type}"><v>${value}</v></c>`;
const formula = (ref, expression, cached) =>
  `<c r="${ref}"><f>${expression.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</f>${cached === undefined ? '' : `<v>${cached}</v>`}</c>`;
const sheet = (...rows) => `<worksheet><sheetData>${rows.join('')}</sheetData></worksheet>`;

export async function createAggregateWorkbook() {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', `<workbook><sheets><sheet name="Summary" sheetId="1" r:id="s1"/>
    <sheet name="Ledger" sheetId="2" r:id="s2"/></sheets><definedNames>
    <definedName name="Revenue">Ledger!$A:$A</definedName></definedNames></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<Relationships><Relationship Id="s1" Target="worksheets/summary.xml"/>
    <Relationship Id="s2" Target="worksheets/ledger.xml"/></Relationships>`);
  zip.file('xl/worksheets/summary.xml', sheet(
    row(1, formula('A1', '_xlfn.AGGREGATE(9,3,Revenue)'), formula('B1', '_xlfn.AGGREGATE(12,3,Revenue)'),
      formula('C1', '_xlfn.AGGREGATE(14,7,Revenue,2)'), formula('D1', '_xlfn.AGGREGATE(4,6,Revenue)'),
      formula('E1', '_xlfn.AGGREGATE(9,4,Revenue)'), formula('F1', '_xlfn.AGGREGATE(9,4,Missing!A1)', 997)),
    row(2, formula('B2', '_xlfn.AGGREGATE(2,6,Ledger!E:XFD+0)')),
    row(1048576, formula('XFD1048576', '_xlfn.AGGREGATE(14,6,Ledger!XFD:XFD+0,1)'))));
  zip.file('xl/worksheets/ledger.xml', sheet(
    row(1, cell('A1', 10)),
    '<row r="2" hidden="1">' + cell('A2', 40) + '</row>',
    row(3, cell('A3', '#DIV/0!', 'e')),
    row(4, formula('A4', '_xlfn.AGGREGATE(9,6,A1)')),
    row(5, formula('A5', 'SUBTOTAL(9,A1)')),
    row(1048576, formula('A1048576', '3+4'), cell('XFD1048576', 20))));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function createStatisticalFormulaWorkbook() {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', `<workbook><sheets><sheet name="Summary" sheetId="1" r:id="s1"/>
    <sheet name="Data" sheetId="2" r:id="s2"/></sheets><definedNames>
    <definedName name="Strength">Data!$A:$A</definedName></definedNames></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<Relationships><Relationship Id="s1" Target="worksheets/summary.xml"/>
    <Relationship Id="s2" Target="worksheets/data.xml"/></Relationships>`);
  zip.file('xl/worksheets/summary.xml', sheet(
    row(1, formula('A1', 'ROUND(_xlfn.STDEV.S(Strength),8)'), formula('B1', 'ROUND(_xlfn.STDEV.P(Strength),8)'),
      formula('C1', 'ROUND(_xlfn.VAR.S(Strength),8)'), formula('D1', 'ROUND(_xlfn.VAR.P(Strength),8)'), formula('E1', 'MEDIAN(Strength)')),
    row(2, formula('A2', 'VARA(Data!B:B)'), formula('B2', 'VARPA(Data!B:B)'), formula('C2', 'MEDIAN(Data!B:B)'),
      formula('D2', '_xlfn.VAR.P(IF(ISNUMBER(Data!A:XFD),6,2))'), formula('E2', 'MEDIAN(Strength)', 997)),
    row(1048576, formula('XFD1048576', 'ROUND(STDEV(Strength),8)+MEDIAN(IF(ISNUMBER(Data!A:XFD),6,2))'))));
  const strength = [1345, 1301, 1368, 1322, 1310, 1370, 1318, 1350, 1303, 1299];
  const mixed = [cell('B1', 3), cell('B2', 1, 'b'), cell('B3', '9', 'str')];
  zip.file('xl/worksheets/data.xml', sheet(...strength.map((number, index) => row(index + 1, cell(`A${index + 1}`, number), mixed[index] ?? ''))));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function createPercentileWorkbook() {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', `<workbook><sheets><sheet name="Summary" sheetId="1" r:id="s1"/>
    <sheet name="Data" sheetId="2" r:id="s2"/></sheets><definedNames>
    <definedName name="Readings">Data!$A:$A</definedName></definedNames></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<Relationships><Relationship Id="s1" Target="worksheets/summary.xml"/>
    <Relationship Id="s2" Target="worksheets/data.xml"/></Relationships>`);
  zip.file('xl/worksheets/summary.xml', sheet(
    row(1, formula('A1', '_xlfn.PERCENTILE.INC(Readings,0.3)'), formula('B1', '_xlfn.PERCENTILE.EXC(Readings,0.3)'),
      formula('C1', 'QUARTILE(Readings,3)'), formula('D1', '_xlfn.QUARTILE.EXC(Readings,1)')),
    row(2, formula('A2', 'PERCENTILE(Readings,1)'), formula('B2', '_xlfn.QUARTILE.INC(Readings,2.8)'),
      formula('C2', '_xlfn.PERCENTILE.EXC(Readings,0.1)'), formula('D2', '_xlfn.QUARTILE.INC(Readings,3)', 997)),
    row(1048576, '<c r="XFA1048576"><f t="array" ref="XFA1048576:XFD1048576">'
      + '_xlfn.PERCENTILE.INC(IF(ISNUMBER(Data!A:XFD),Data!A:XFD,2),{0,0.25,0.75,1})</f></c>')));
  zip.file('xl/worksheets/data.xml', sheet(row(1, cell('A1', 1)), row(2, cell('A2', 3)), row(3, cell('A3', 2)),
    row(4, cell('A4', '100', 'str')), row(5, cell('A5', 1, 'b')), row(1048576, cell('A1048576', 4))));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function createFrequencyWorkbook() {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', `<workbook><sheets><sheet name="Histogram" sheetId="1" r:id="s1"/>
    <sheet name="Data" sheetId="2" r:id="s2"/></sheets><definedNames>
    <definedName name="Readings">Data!$A:$A</definedName><definedName name="Bounds">Data!$B:$B</definedName>
    </definedNames></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<Relationships><Relationship Id="s1" Target="worksheets/histogram.xml"/>
    <Relationship Id="s2" Target="worksheets/data.xml"/></Relationships>`);
  zip.file('xl/worksheets/histogram.xml', sheet(
    row(1, '<c r="A1"><f t="array" ref="A1:A5">FREQUENCY(Readings,Bounds)</f></c>',
      formula('B1', 'SUM(A1:A5)'),
      '<c r="XFD1"><f t="array" ref="XFD1:XFD1048576">FREQUENCY(Readings,SEQUENCE(1048575,1,3,0))</f></c>'),
    row(2, formula('B2', 'INDEX(FREQUENCY(IF(ISNUMBER(Data!A:XFD),6,2),{2;6}),1)')),
    row(3, formula('B3', 'SUM(XFD:XFD)')),
    row(4, formula('B4', 'FREQUENCY(Missing!A1,{2})', 997))));
  zip.file('xl/worksheets/data.xml', sheet(
    row(1, cell('A1', 1), cell('B1', 5)),
    row(2, cell('A2', 3), cell('B2', 3)),
    row(3, cell('A3', 3), cell('B3', 3)),
    row(4, cell('A4', '3', 'str'), cell('B4', '2', 'str')),
    row(5, cell('A5', 1, 'b')),
    row(6, cell('B6', 1)),
    row(1048576, cell('A1048576', 9))));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function createRankingWorkbook() {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', `<workbook><sheets><sheet name="Summary" sheetId="1" r:id="s1"/>
    <sheet name="Data" sheetId="2" r:id="s2"/></sheets><definedNames>
    <definedName name="Scores">Data!$A:$A</definedName></definedNames></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<Relationships><Relationship Id="s1" Target="worksheets/summary.xml"/>
    <Relationship Id="s2" Target="worksheets/data.xml"/></Relationships>`);
  zip.file('xl/worksheets/summary.xml', sheet(
    row(1, formula('A1', 'RANK(9,Scores)'), formula('B1', '_xlfn.RANK.AVG(9,Scores)'),
      formula('C1', '_xlfn.RANK.EQ(3,Scores,1)'), formula('D1', '_xlfn.PERCENTRANK.INC(Scores,7)')),
    row(2, formula('A2', 'PERCENTRANK(Scores,9)'), formula('B2', '_xlfn.PERCENTRANK.EXC(Scores,9)'),
      formula('C2', 'RANK(3,(Data!A1,Data!A3,Data!A1048576))'), formula('D2', 'RANK(7,Scores)'),
      formula('E2', 'RANK(9,Scores)', 997)),
    row(3, formula('A3', '_xlfn.PERCENTRANK.EXC(IF(ISNUMBER(Data!A:XFD),6,2),6,8)')),
    row(1048576, '<c r="XFA1048576"><f t="array" ref="XFA1048576:XFD1048576">'
      + '_xlfn.RANK.AVG({2,4,6,6},IF(ISNUMBER(Data!A:XFD),6,2),1)</f></c>')));
  zip.file('xl/worksheets/data.xml', sheet(row(1, cell('A1', 9)), row(2, cell('A2', 9)), row(3, cell('A3', 5)),
    row(4, cell('A4', '20', 'str')), row(5, cell('A5', 1, 'b')), row(1048576, cell('A1048576', 3))));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function createLinearRegressionWorkbook() {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', `<workbook><sheets><sheet name="Forecast" sheetId="1" r:id="s1"/>
    <sheet name="Training" sheetId="2" r:id="s2"/></sheets><definedNames>
    <definedName name="TrainingX">Training!$A:$A</definedName>
    <definedName name="TrainingY">Training!$XFD:$XFD</definedName></definedNames></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<Relationships><Relationship Id="s1" Target="worksheets/forecast.xml"/>
    <Relationship Id="s2" Target="worksheets/training.xml"/></Relationships>`);
  zip.file('xl/styles.xml', '<styleSheet><dxfs><dxf><fill><patternFill patternType="solid">'
    + '<fgColor rgb="FFDCFCE7"/></patternFill></fill></dxf></dxfs></styleSheet>');
  zip.file('xl/worksheets/forecast.xml', sheet(
    row(1, formula('A1', 'SLOPE(TrainingY,TrainingX)'), formula('B1', 'INTERCEPT(TrainingY,TrainingX)'),
      formula('C1', '_xlfn.FORECAST.LINEAR(8,TrainingY,TrainingX)'), formula('D1', 'ROUND(RSQ(TrainingX,TrainingY),12)'),
      formula('E1', 'ROUND(COVAR(TrainingX,TrainingY),8)'), formula('F1', '_xlfn.COVARIANCE.S(TrainingX,TrainingY)')),
    row(2, formula('A2', 'FORECAST(8,Missing!A1,TrainingX)', 997),
      formula('B2', 'FORECAST(12,IF(ISNUMBER(Training!A:XFD),7,3),IF(ISNUMBER(Training!A:XFD),5,1))')),
    row(1048576, '<c r="XFB1048576"><f t="array" ref="XFB1048576:XFD1048576">'
      + '_xlfn.FORECAST.LINEAR({0,9,50},TrainingY,TrainingX)</f></c>')).replace('</worksheet>',
    '<conditionalFormatting sqref="XFD1048576"><cfRule type="expression" priority="1" dxfId="0">'
    + '<formula>XFD1048576=102</formula></cfRule></conditionalFormatting></worksheet>'));
  zip.file('xl/worksheets/training.xml', sheet(
    row(1, cell('A1', 1), cell('XFD1', 4)),
    row(2, cell('A2', 2), cell('XFD2', '99', 'str')),
    row(3, cell('A3', 0), cell('XFD3', 2)),
    row(100000, cell('XFD100000', 3)),
    row(1048576, cell('A1048576', 5), cell('XFD1048576', 12))));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
