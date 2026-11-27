import JSZip from 'jszip';

export async function createRowHeightWorkbook({ forceGeneral = false, formula = false, fractional = false, tall = false } = {}) {
  const zip = new JSZip(), names = ['Row heights', 'Compact', 'Expressions'];
  zip.file('xl/workbook.xml', '<workbook><sheets>' + names.map((name, i) => `<sheet name="${name}" sheetId="${i + 1}" r:id="s${i + 1}"/>`).join('') + '</sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships>' + names.map((_, i) => `<Relationship Id="s${i + 1}" Target="worksheets/s${i + 1}.xml"/>`).join('') + '</Relationships>');
  zip.file('xl/sharedStrings.xml', '<sst><si><t>Default</t></si><si><t xml:space="preserve">'
    + 'First line&#10;Second line&#10;Third line&#10;Fourth line&#10;Fifth line&#10;Sixth line'
    + '</t></si><si><t>Halfway</t></si>' + (tall ? '<si><t xml:space="preserve">'
      + Array.from({ length: 200 }, (_, i) => `Line ${i + 1}`).join('&#10;') + '</t></si>' : '') + '</sst>');
  zip.file('xl/styles.xml', '<styleSheet><fonts><font><sz val="11"/></font></fonts>'
    + '<cellXfs><xf fontId="0"/><xf fontId="0" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf>'
    + (tall ? '<xf fontId="0" applyAlignment="1"><alignment wrapText="1" horizontal="centerContinuous"/></xf>' : '')
    + '</cellXfs></styleSheet>');
  const prefix = forceGeneral ? '<!-- general parser -->' : '';
  const long = (ref, style = 1) => `<c r="${ref}" s="${style}" t="s"><v>${tall ? 3 : 1}</v></c>`;
  zip.file('xl/worksheets/s1.xml', `<worksheet><sheetFormatPr defaultRowHeight="${fractional ? '15.5' : '15'}" defaultColWidth="14"/><sheetData>` + prefix
    + '<row r="1"><c r="A1" t="s"><v>0</v></c></row>'
    + `<row r="2" ht="6" customHeight="true">${long('A2')}</row>`
    + `<row r="3" ht="30">${long('A3')}</row>`
    + `<row r="4" ht="30" customHeight="1">${long('B4')}</row>`
    + '<row r="5" ht="26.25" customHeight="1"/>'
    + '<row r="6" ht="0" customHeight="1"><c r="A6"><v>1</v></c></row>'
    + '<row r="7" ht="99999" customHeight="false"><c r="A7"><v>7</v></c>'
    + (fractional ? '<c r="XFD7"><f>DAY(TODAY())</f></c>' : '') + '</row>'
    + (fractional ? `<row r="8">${long('A8')}<c r="XFD8" s="1"><f>IF(DAY(TODAY())=1,"short",A3&amp;CHAR(10)&amp;A3)</f></c></row>`
      + '<row r="9"><c r="XFD9" s="1"><f>IF(DAY(TODAY())=1,"short",A3)</f></c></row>' : '')
    + (tall ? `<row r="10">${long('A10')}</row><row r="11">${long('A11', 2)}<c r="B11" s="2"/></row>` : '')
    + '<row r="500001" ht="75" customHeight="1"><c r="A500001" t="s"><v>2</v></c></row>'
    + (tall ? '<row r="1048575"><c r="XFD1048575" s="1"><f>IF(DAY(TODAY())=1,A3,"short")</f></c></row>' : '')
    + '<row r="1048576" ht="33.25" customHeight="1"><c r="XFD1048576">' + (formula ? '<f>A6+70</f>' : '<v>71</v>') + '</c></row>'
    + '</sheetData><mergeCells><mergeCell ref="B4:C4"/>' + (tall ? '<mergeCell ref="A10:B10"/>' : '') + '</mergeCells></worksheet>');
  zip.file('xl/worksheets/s2.xml', '<worksheet><sheetFormatPr defaultRowHeight="3" customHeight="1"/><sheetData>' + prefix
    + '<row r="1"><c r="A1"><v>1</v></c></row>'
    + `<row r="2" customHeight="false">${fractional
      ? '<c r="A2" s="1"><f>IF(DAY(TODAY())=1,\'Row heights\'!A3,"short")</f></c>' : long('A2')}</row>`
    + '<row r="2000"><c r="A2000"><v>2</v></c></row>'
    + '</sheetData></worksheet>');
  zip.file('xl/worksheets/s3.xml', '<worksheet><sheetViews><sheetView showFormulas="1"/></sheetViews>'
    + '<sheetFormatPr defaultColWidth="14"/><cols><col min="2" max="2" width="16" bestFit="1"/></cols><sheetData>'
    + '<row r="1"><c r="A1"><v>7</v></c><c r="B1"><f>A1*2</f><v>14</v></c>'
    + '<c r="C1"><f t="shared" si="0" ref="C1:C2">A1*3</f><v>21</v></c></row>'
    + '<row r="2"><c r="A2"><v>9</v></c><c r="C2"><f t="shared" si="0"/></c></row>'
    + '<row r="1048576"><c r="XFD1048576"><f>IF(A1,A1+1,0)</f></c></row></sheetData>'
    + '<conditionalFormatting sqref="B1"><cfRule type="dataBar" priority="1"><dataBar showValue="0">'
    + '<cfvo type="min"/><cfvo type="max"/><color rgb="FF4472C4"/></dataBar></cfRule></conditionalFormatting></worksheet>');
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
