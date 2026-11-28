import JSZip from 'jszip';

export async function createBestFitWorkbook(rtl = false) {
  const zip = new JSZip();
  const names = ['Best Fit', 'Formula View'];
  zip.file('xl/workbook.xml', '<workbook><sheets>' + names.map((name, index) =>
    `<sheet name="${name}" sheetId="${index + 1}" r:id="s${index + 1}"/>`).join('') + '</sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships>' + names.map((_, index) =>
    `<Relationship Id="s${index + 1}" Target="worksheets/s${index + 1}.xml"/>`).join('') + '</Relationships>');
  zip.file('xl/styles.xml', '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="&quot;€&quot;#,##0.00_)"/></numFmts>'
    + '<fonts><font><sz val="11"/></font></fonts><cellXfs><xf fontId="0"/><xf fontId="0" numFmtId="164" applyNumberFormat="1"/>'
    + '<xf fontId="0" applyAlignment="1"><alignment shrinkToFit="1"/></xf>'
    + '<xf fontId="0" applyAlignment="1"><alignment wrapText="1"/></xf></cellXfs></styleSheet>');

  const column = (from, bestFit = true) =>
    `<col min="${from}" max="${from}" width="6" customWidth="1"${bestFit ? ' bestFit="true"' : ''}/>`;
  const number = (ref, value, format = 1) => `<c r="${ref}" s="${format}"><v>${value}</v></c>`;
  const formula = (ref, value) => `<c r="${ref}" s="1"><f>${value}</f></c>`;
  const long = 9876543210123.5;
  zip.file('xl/worksheets/s1.xml', `<worksheet><sheetViews><sheetView rightToLeft="${Number(rtl)}">`
    + (rtl ? '<pane xSplit="1" state="frozen" topLeftCell="B1"/>' : '') + '</sheetView></sheetViews>'
    + '<sheetFormatPr defaultRowHeight="15" defaultColWidth="14"/><cols>'
    + [column(1), column(2, false), column(2), column(3), column(4), column(5), column(7), column(9), column(23), column(16384)].join('')
    + '</cols><sheetData>'
    + '<row r="1">' + number('A1', long) + number('B1', long)
    + formula('C1', 'IF(DAY(TODAY())=2,9876543210123.5,2)')
    + '<c r="D1" t="inlineStr"><is><t>98765432101234567890123</t></is></c>'
    + number('E1', 123456789, 2)
    + '</row><row r="2"><c r="C2" s="3" t="inlineStr"><is><t>Columns grow and wrapped text uses the new width.</t></is></c>'
    + number('G2', long) + number('I2', long) + '</row>'
    + '<row r="1048576">' + number('W1048576', long) + number('XFD1048576', long, 0)
    + '</row></sheetData><mergeCells><mergeCell ref="G2:H2"/></mergeCells>'
    + '<conditionalFormatting sqref="I2"><cfRule type="dataBar" priority="1"><dataBar showValue="0">'
    + '<cfvo type="min"/><cfvo type="max"/><color rgb="FF4472C4"/></dataBar></cfRule></conditionalFormatting></worksheet>');
  zip.file('xl/worksheets/s2.xml', '<worksheet><sheetViews><sheetView showFormulas="1"/></sheetViews>'
    + '<cols>' + column(1) + '</cols><sheetData><row r="1">' + number('A1', long)
    + formula('B1', 'A1*2') + '</row></sheetData></worksheet>');
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
