import JSZip from 'jszip';

const cfvo = (type, value) => `<cfvo type="${type}"${value === undefined ? '' : ` val="${value}"`}/>`;
const color = (rgb, name = 'color') => `<${name} rgb="FF${rgb}"/>`;
const rule = (range, type, priority, body) => `<conditionalFormatting sqref="${range}"><cfRule type="${type}" priority="${priority}">${body}</cfRule></conditionalFormatting>`;
const scale = (range, priority, values, colors) => rule(range, 'colorScale', priority, `<colorScale>${values.join('')}${colors.join('')}</colorScale>`);
const bar = (range, priority, attrs, values, rgb, extension = '') => rule(range, 'dataBar', priority,
  `<dataBar${attrs}>${values.join('')}${color(rgb)}</dataBar>${extension}`);
const n = (ref, value, attrs = '') => `<c r="${ref}"${attrs}><v>${value}</v></c>`;
const row = (index, ...cells) => `<row r="${index}">${cells.join('')}</row>`;
const sheet = (rows, metadata, general = false) => '<worksheet><sheetFormatPr defaultColWidth="13"/>'
  + `<sheetData>${general ? '<!-- general XML path -->' : ''}${rows.join('')}</sheetData>${metadata}</worksheet>`;

export async function createConditionalVisualWorkbook(forceGeneral = false) {
  const zip = new JSZip();
  const names = ['Visual Rules', 'Plain Values', 'Input'];
  zip.file('xl/workbook.xml', '<workbook><sheets>' + names.map((name, i) => `<sheet name="${name}" sheetId="${i + 1}" r:id="s${i + 1}"/>`).join('')
    + '</sheets><definedNames><definedName name="Upper">Input!$B$1</definedName></definedNames></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships>' + names.map((_, i) => `<Relationship Id="s${i + 1}" Target="worksheets/s${i + 1}.xml"/>`).join('') + '</Relationships>');
  zip.file('xl/theme/theme1.xml', '<a:theme><a:themeElements><a:clrScheme><a:accent1><a:srgbClr val="008866"/></a:accent1></a:clrScheme></a:themeElements></a:theme>');
  zip.file('xl/styles.xml', '<styleSheet><fills><fill/><fill><patternFill patternType="solid"><fgColor rgb="FFFFFF99"/></patternFill></fill></fills>'
    + '<cellXfs><xf/><xf fillId="1"/></cellXfs></styleSheet>');

  const linkId = '{11111111-1111-4111-8111-111111111111}';
  const mergeLinkId = '{22222222-2222-4222-8222-222222222222}';
  const bounds = [cfvo('min'), cfvo('max')];
  const linkedBar = id => `<extLst><ext uri="{B025F937-C7B1-47D3-B67F-A62EFF666E3E}"><x14:id>${id}</x14:id></ext></extLst>`;
  const extensions = '<extLst><ext uri="{78C0D931-6437-407d-A8EE-F0AAD7539E65}" xmlns:v="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main">'
    + `<v:conditionalFormattings><v:conditionalFormatting xmlns:m="http://schemas.microsoft.com/office/excel/2006/main"><v:cfRule type="dataBar" id="${linkId.toLowerCase()}">`
    + '<v:dataBar minLength="0" maxLength="100" border="1" gradient="0" negativeBarBorderColorSameAsPositive="0">'
    + '<v:cfvo type="autoMin"/><v:cfvo type="autoMax"/><v:borderColor theme="4"/>' + color('AA1122', 'v:negativeFillColor')
    + color('660011', 'v:negativeBorderColor') + color('334455', 'v:axisColor') + '</v:dataBar></v:cfRule><m:sqref>C1:C5</m:sqref></v:conditionalFormatting>'
    + `<v:conditionalFormatting xmlns:m="http://schemas.microsoft.com/office/excel/2006/main"><v:cfRule type="dataBar" id="${linkId}" priority="4">`
    + '<v:dataBar minLength="0" maxLength="100" axisPosition="middle" direction="rightToLeft" negativeBarColorSameAsPositive="1">'
    + '<v:cfvo type="num"><m:f>-8</m:f></v:cfvo><v:cfvo type="formula"><m:f>Upper-2</m:f></v:cfvo>'
    + color('4466BB', 'v:fillColor') + color('111111', 'v:axisColor') + '</v:dataBar></v:cfRule><m:sqref>D1:D3</m:sqref></v:conditionalFormatting>'
    + `<v:conditionalFormatting xmlns:m="http://schemas.microsoft.com/office/excel/2006/main"><v:cfRule type="dataBar" id="${mergeLinkId}">`
    + '<v:dataBar minLength="0" maxLength="100" axisPosition="none"><v:cfvo type="num" value="1"/><v:cfvo type="formula" value="Upper"/>'
    + '</v:dataBar></v:cfRule><m:sqref>H500 XFC1048576</m:sqref></v:conditionalFormatting></v:conditionalFormattings></ext></extLst>';

  zip.file('xl/worksheets/s1.xml', sheet([
    row(1, n('A1', 0), n('B1', 0), n('C1', -20, ' s="1"'), n('D1', -4), n('E1', 0), n('F1', 0), n('G1', 0)),
    row(2, n('A2', 10), n('B2', 25), n('C2', -10, ' s="1"'), n('D2', 2), n('E2', 5), n('F2', 25)),
    row(3, n('A3', 20), n('B3', 50), n('C3', 0), n('D3', 8), n('E3', 10), n('F3', 50)),
    row(4, n('A4', 90), n('B4', 100), n('C4', 10), n('F4', 100)),
    row(5, '<c r="A5" t="inlineStr"><is><t>40</t></is></c>', n('C5', 60)),
    row(6, n('A6', 1, ' t="b"')),
    row(7, n('A7', '#N/A', ' t="e"')),
    row(8, '<c r="A8"><f>UNSUPPORTED()</f></c>'),
    row(500, n('H500', 8)),
    row(1048576, '<c r="A1048576"><f>Input!A1+5</f></c>', n('XFC1048576', 8), n('XFD1048576', 100))
  ], '<mergeCells><mergeCell ref="H500:BL1600"/></mergeCells>' + [
    scale('A1:A8 A2 A1048576', 1, [cfvo('min'), cfvo('percentile', 50), cfvo('max')], [color('000000'), color('FF0000'), color('FFFFFF')]),
    bar('B1:B4 XFD1048576', 2, ' minLength="20" maxLength="80" showValue="0"', bounds, '0066CC'),
    bar('C1:C5', 3, '', bounds, '008866', linkedBar(linkId)),
    scale('E1:E3', 5, [cfvo('num', 0), cfvo('formula', 'Upper')], [color('000000'), '<color theme="4"/>']),
    scale('F1:F4', 6, [cfvo('percent', 25), cfvo('percent', 75)], [color('000000'), color('FFFFFF')]),
    scale('G1', 7, [cfvo('min'), cfvo('max')], [color('000000'), color('FFFFFF')]),
    bar('H500 XFC1048576', 8, '', [cfvo('num', 1), cfvo('num', 10)], '22AA66', linkedBar(mergeLinkId)),
    scale('D1', 9, [cfvo('percentile', 125), cfvo('max')], [color('000000'), color('FFFFFF')])
  ].join('') + extensions).replace('<worksheet>', '<worksheet xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main">'));
  zip.file('xl/worksheets/s2.xml', sheet([row(1, n('A1', 4)), row(2, n('A2', 20))],
    scale('A1:A1048576', 1, bounds, [color('112233'), color('ABCDEF')]), forceGeneral));
  zip.file('xl/worksheets/s3.xml', sheet([row(1, n('A1', 95), n('B1', 10))], ''));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
