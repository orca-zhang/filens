import JSZip from 'jszip';

export async function createRichTextWorkbook() {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', '<workbook><sheets><sheet name="Shared" sheetId="1" r:id="shared"/>'
    + '<sheet name="Inline" sheetId="2" r:id="inline"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="shared" Target="worksheets/shared.xml"/>'
    + '<Relationship Id="inline" Target="worksheets/inline.xml"/>'
    + '<Relationship Id="strings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="strings.xml"/></Relationships>');
  zip.file('xl/theme/theme1.xml', '<a:theme><a:themeElements><a:fontScheme><a:minorFont><a:latin typeface="Schedule Face"/>'
    + '</a:minorFont></a:fontScheme><a:clrScheme><a:accent1><a:srgbClr val="336699"/></a:accent1></a:clrScheme></a:themeElements></a:theme>');
  zip.file('xl/styles.xml', '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="0;0;0;&quot;[&quot;@&quot;]&quot;"/></numFmts>'
    + '<fonts><font><name val="Arial"/><b/><i/><u/><strike/><color rgb="FF432169"/></font></fonts>'
    + '<cellXfs><xf fontId="0"/><xf fontId="0" numFmtId="164"/><xf fontId="0"><alignment horizontal="center" vertical="center"/></xf></cellXfs>'
    + '<colors><indexedColors><rgbColor rgb="FF008844"/></indexedColors></colors></styleSheet>');
  zip.file('xl/strings.xml', '<sst><si><r><t xml:space="preserve">  Before </t></r>'
    + '<r><rPr><rFont val="Saved Face"/><scheme val="minor"/><sz val="30"/><b val="false"/><i val="0"/>'
    + '<u val="none"/><strike val="0"/><color theme="4" tint="-0.5"/></rPr><t>&lt;b&gt;中文&lt;/b&gt;</t></r>'
    + '<r><rPr><u val="double"/><vertAlign val="superscript"/><sz val="9"/></rPr><t>²</t></r>'
    + '<rPh sb="0" eb="2"><t>phonetic</t></rPh></si>'
    + '<si><r><t>Unformatted </t></r><r><t>text</t></r></si></sst>');
  zip.file('xl/worksheets/shared.xml', '<worksheet><sheetFormatPr defaultColWidth="18"/><sheetData>'
    + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s" s="1"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>'
    + '<row r="500"><c r="A500" t="s" s="2"><v>0</v></c></row>'
    + '<row r="1048576"><c r="XFD1048576" t="s"><v>0</v></c></row></sheetData>'
    + '<mergeCells><mergeCell ref="A500:BL1600"/></mergeCells></worksheet>');
  zip.file('xl/worksheets/inline.xml', '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c>'
    + '<c r="B1" t="inlineStr"><is><r><t>inline</t></r><r><rPr><b val="1"/><color indexed="0"/><vertAlign val="subscript"/></rPr><t> 2</t></r></is></c>'
    + '<c r="C1"><f>LEN(Shared!A1)</f></c></row></sheetData></worksheet>');
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
