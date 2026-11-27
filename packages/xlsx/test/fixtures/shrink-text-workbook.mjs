import JSZip from 'jszip';

export const longLabel = 'Long workbook label for a narrow column';
export const mergedLabel = 'Wide merged label with fixed source alignment. '.repeat(8).trimEnd();

const text = (ref, value, style = 1) => `<c r="${ref}" s="${style}" t="inlineStr"><is><t>${value}</t></is></c>`;
const row = (ref, ...cells) => `<row r="${ref}">${cells.join('')}</row>`;

export async function createShrinkTextWorkbook(forceGeneral = false) {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', '<workbook><sheets><sheet name="Fit" sheetId="1" r:id="s1"/>'
    + '<sheet name="Formulas" sheetId="2" r:id="s2"/><sheet name="Stored" sheetId="3" r:id="s3"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="s1" Target="worksheets/s1.xml"/>'
    + '<Relationship Id="s2" Target="worksheets/s2.xml"/><Relationship Id="s3" Target="worksheets/s3.xml"/></Relationships>');
  zip.file('xl/sharedStrings.xml', `<sst><si><t>${longLabel}</t></si></sst>`);
  zip.file('xl/styles.xml', '<styleSheet><fonts><font><sz val="11"/><u val="double"/></font></fonts>'
    + '<numFmts><numFmt numFmtId="164" formatCode="&quot;USD &quot;#,##0.00"/></numFmts>'
    + '<cellStyleXfs><xf/><xf><alignment shrinkToFit="1" horizontal="center"/></xf></cellStyleXfs>'
    + '<cellXfs><xf/><xf><alignment shrinkToFit="1" horizontal="right"/></xf>'
    + '<xf><alignment shrinkToFit="true" horizontal="right" indent="1"/></xf>'
    + '<xf numFmtId="164"><alignment shrinkToFit="1" horizontal="right"/></xf>'
    + '<xf><alignment shrinkToFit="1" wrapText="1"/></xf>'
    + '<xf xfId="1" applyAlignment="0"><alignment shrinkToFit="0"/></xf>'
    + '<xf xfId="1" applyAlignment="1"><alignment shrinkToFit="false"/></xf>'
    + '<xf><alignment shrinkToFit="1" horizontal="right" vertical="center"/></xf>'
    + '</cellXfs></styleSheet>');
  const layout = '<sheetFormatPr defaultRowHeight="15" defaultColWidth="12"/>'
    + '<cols><col min="1" max="1" width="12"/><col min="8" max="53" width="3"/></cols>';
  zip.file('xl/worksheets/s1.xml', `<worksheet>${layout}<sheetData>${forceGeneral ? '<!-- general parser -->' : ''}`
    + row(1, '<c r="A1" s="2" t="s"><v>0</v></c>', '<c r="B1" s="3"><v>12345.67</v></c>',
      text('C1', 'Fits'), text('D1', longLabel, 4), '<c r="E1" s="1" t="inlineStr"><is>'
      + '<r><t xml:space="preserve">Before </t></r><r><rPr><sz val="24"/><color rgb="FF993366"/></rPr><t>Rich label</t></r></is></c>',
      '<c r="F1" s="3"><v>1234.56</v></c>')
    + `<row r="2" ht="18" customHeight="1">${text('A2', longLabel)}${text('B2', 'Line one&#10;Line two')}</row>`
    + row(3, '<c r="A3" s="5" t="s"><v>0</v></c>', '<c r="B3" s="6" t="s"><v>0</v></c>')
    + row(4, text('H4', mergedLabel, 7))
    + row(1048576, '<c r="XFD1048576" s="1"><f>A1&amp;" at the end"</f></c>')
    + '</sheetData><mergeCells><mergeCell ref="H4:BA5"/></mergeCells>'
    + '<conditionalFormatting sqref="F1"><cfRule type="iconSet" priority="1">'
    + '<iconSet><cfvo type="num" val="0"/><cfvo type="num" val="10"/><cfvo type="num" val="20"/></iconSet>'
    + '</cfRule></conditionalFormatting></worksheet>');
  zip.file('xl/worksheets/s2.xml', '<worksheet><sheetViews><sheetView showFormulas="1"/></sheetViews>'
    + `<sheetData>${row(1, '<c r="A1" s="1"><f>"An expression shown in formula view"</f></c>')}</sheetData></worksheet>`);
  zip.file('xl/worksheets/s3.xml', `<worksheet>${layout}<sheetData>${forceGeneral ? '<!-- general parser -->' : ''}`
    + row(1, '<c r="A1" s="5" t="s"><v>0</v></c>', '<c r="B1" s="3"><v>12345.67</v></c>') + '</sheetData></worksheet>');
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
