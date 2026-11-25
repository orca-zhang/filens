import JSZip from 'jszip';

const escapeXml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const cfvo = (type, value, exclusive = false) => `<cfvo type="${type}" val="${escapeXml(value)}"${exclusive ? ' gte="0"' : ''}/>`;
const rule = (range, priority, contents, attributes = '') => `<conditionalFormatting sqref="${range}"><cfRule type="iconSet" priority="${priority}"><iconSet${attributes}>${contents.join('')}</iconSet></cfRule></conditionalFormatting>`;
const n = (ref, value, attrs = '') => `<c r="${ref}"${attrs}><v>${value}</v></c>`;
const row = (index, ...cells) => `<row r="${index}">${cells.join('')}</row>`;
const sheet = (rows, metadata, general = false) => '<worksheet><sheetFormatPr defaultColWidth="13"/>'
  + `<sheetData>${general ? '<!-- general XML path -->' : ''}${rows.join('')}</sheetData>${metadata}</worksheet>`;

export async function createConditionalIconWorkbook(forceGeneral = false) {
  const zip = new JSZip();
  const names = ['Icon Rules', 'Plain Values', 'Input'];
  zip.file('xl/workbook.xml', '<workbook><sheets>' + names.map((name, i) => `<sheet name="${name}" sheetId="${i + 1}" r:id="s${i + 1}"/>`).join('')
    + '</sheets><definedNames><definedName name="Limit">Input!$A$1</definedName></definedNames></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships>' + names.map((_, i) => `<Relationship Id="s${i + 1}" Target="worksheets/s${i + 1}.xml"/>`).join('') + '</Relationships>');
  zip.file('xl/styles.xml', '<styleSheet><cellXfs><xf/><xf><alignment vertical="center" horizontal="center"/></xf></cellXfs></styleSheet>');

  const x14threshold = (type, value, exclusive = false) => `<v:cfvo type="${type}"${exclusive ? ' gte="false"' : ''}><m:f>${escapeXml(value)}</m:f></v:cfvo>`;
  const custom = (set, id) => `<v:cfIcon iconSet="${set}" iconId="${id}"/>`;
  const extensionRule = (range, priority, definition, attrs = '', formula = '') =>
    `<v:conditionalFormatting xmlns:m="http://schemas.microsoft.com/office/excel/2006/main"><v:cfRule type="iconSet" priority="${priority}"${attrs}>${formula}`
    + `${definition}</v:cfRule><m:sqref>${range}</m:sqref></v:conditionalFormatting>`;
  const extension = '<extLst><ext uri="{78C0D931-6437-407d-A8EE-F0AAD7539E65}" xmlns:v="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"><v:conditionalFormattings>'
    + extensionRule('C1:C5', 3, '<v:iconSet iconSet="4Rating" custom="1" reverse="1" showValue="0">'
      + '<v:cfvo type="min"/>' + x14threshold('num', 10) + x14threshold('num', 20) + x14threshold('num', 30)
      + custom('NoIcons', 0) + custom('3Stars', 1) + custom('5Boxes', 4) + custom('3Triangles', 2) + '</v:iconSet>',
      ' activePresent="1"', '<m:f>$D1&gt;0</m:f>')
    + extensionRule('E1:E3', 4, '<v:iconSet iconSet="3Stars">' + '<v:cfvo type="min"/>' + x14threshold('percent', 50, true)
      + x14threshold('max', 0) + '</v:iconSet>')
    + extensionRule('F1', 5, '<v:iconSet iconSet="3Arrows" custom="1"><v:cfvo type="min"/>' + x14threshold('num', 1)
      + x14threshold('num', 2) + custom('3Arrows', 0) + custom('NoIcons', 1) + custom('3Arrows', 2) + '</v:iconSet>')
    + '</v:conditionalFormattings></ext></extLst>';

  zip.file('xl/worksheets/s1.xml', sheet([
    row(1, n('A1', 0), n('B1', 0), n('C1', 5), n('D1', 1), n('E1', -10), n('F1', 2)),
    row(2, n('A2', 10), n('B2', 20), n('C2', 10), n('D2', 1), n('E2', 0)),
    row(3, n('A3', 40), n('B3', 60), n('C3', 20), n('D3', 1), n('E3', 10)),
    row(4, n('A4', 50), n('B4', 61), n('C4', 40), n('D4', 0)),
    row(5, n('A5', 100), n('B5', 100), n('C5', 40), n('D5', 1)),
    row(6, n('A6', 75)),
    row(7, '<c r="A7" t="inlineStr"><is><t>99</t></is></c>'),
    row(8, n('A8', '#N/A', ' t="e"')),
    row(500, n('F500', 42, ' s="1"')),
    row(1048576, '<c r="A1048576"><f>Input!A1+30</f></c>', n('XFD1048576', 120))
  ], '<mergeCells><mergeCell ref="F500:BL1600"/></mergeCells>' + [
    rule('A1:A8 A2 A1048576', 1, [cfvo('percent', 0), cfvo('percentile', 50, true), cfvo('formula', 'Limit')]),
    rule('B1:B5 XFD1048576', 2, [cfvo('formula', 'UNKNOWN()'), cfvo('num', 20), cfvo('num', 40), cfvo('num', 60, true), cfvo('num', 80)],
      ' iconSet="5ArrowsGray" showValue="0" reverse="1"'),
    rule('F500', 6, [cfvo('min', 0), cfvo('num', 20), cfvo('num', 40)], ' iconSet="3Flags"'),
    rule('B5', 7, [cfvo('min', 0), cfvo('num', 1), cfvo('num', 2)], ' iconSet="invalid"'),
    rule('C1:C5', 8, [cfvo('min', 0), cfvo('num', 20), cfvo('num', 30)], ' iconSet="3Flags"')
  ].join('') + extension));
  zip.file('xl/worksheets/s2.xml', sheet([row(1, n('A1', -1)), row(2, n('A2', 60))],
    rule('A1:A1048576', 1, [cfvo('percent', 0), cfvo('percent', 25), cfvo('percent', 50), cfvo('percent', 75)], ' iconSet="4RedToBlack"'), forceGeneral));
  zip.file('xl/worksheets/s3.xml', sheet([row(1, n('A1', 90))], ''));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
