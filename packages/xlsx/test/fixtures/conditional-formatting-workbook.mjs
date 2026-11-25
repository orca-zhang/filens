import JSZip from 'jszip';

const escapeXml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const rule = (type, priority, style, formulas = [], attrs = '') => `<cfRule type="${type}" priority="${priority}"`
  + (style === undefined ? '' : ` dxfId="${style}"`) + attrs + '>'
  + formulas.map(formula => `<formula>${escapeXml(formula)}</formula>`).join('') + '</cfRule>';
const compare = (operator, priority, style, formulas, attrs = '') => rule('cellIs', priority, style, formulas, ` operator="${operator}"${attrs}`);
const area = (sqref, ...rules) => `<conditionalFormatting sqref="${sqref}">${rules.join('')}</conditionalFormatting>`;
const row = (index, ...cells) => `<row r="${index}">${cells.join('')}</row>`;
const n = (ref, value, style = 0) => `<c r="${ref}"${style ? ` s="${style}"` : ''}><v>${value}</v></c>`;
const t = (ref, value) => `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
const f = (ref, formula, style = 0, type = '') => `<c r="${ref}"${style ? ` s="${style}"` : ''}${type}>`
  + `<f>${escapeXml(formula)}</f></c>`;
const worksheet = (rows, metadata = '', general = false) => `<worksheet><sheetFormatPr defaultColWidth="13"/><sheetData>${general ? '<!-- general -->' : ''}`
  + rows.join('') + `</sheetData>${metadata}</worksheet>`;

export async function createConditionalFormattingWorkbook(forceGeneral = false) {
  const zip = new JSZip();
  const sheets = ['Formats', 'Numeric', 'Input'];
  zip.file('xl/workbook.xml', '<workbook><sheets>' + sheets.map((name, i) => `<sheet name="${name}" sheetId="${i + 1}" r:id="s${i + 1}"/>`).join('')
    + '</sheets><definedNames><definedName name="Limit">10</definedName></definedNames></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships>' + sheets.map((_, i) => `<Relationship Id="s${i + 1}" Target="worksheets/s${i + 1}.xml"/>`).join('') + '</Relationships>');
  zip.file('xl/theme/theme1.xml', '<a:theme><a:themeElements><a:clrScheme><a:accent1><a:srgbClr val="336699"/></a:accent1></a:clrScheme></a:themeElements></a:theme>');
  const bg = rgb => `<fill><patternFill><bgColor rgb="FF${rgb}"/></patternFill></fill>`;
  zip.file('xl/styles.xml', '<styleSheet><fonts><font><name val="Arial"/></font><font><name val="Arial"/><i/><b/><u/><strike/></font></fonts>'
    + '<fills><fill/><fill><patternFill patternType="solid"><fgColor rgb="FFBFD7EA"/></patternFill></fill></fills>'
    + '<borders><border/><border><left style="thin"><color rgb="FF64748B"/></left></border></borders>'
    + '<cellXfs><xf fontId="0"/><xf fontId="0" numFmtId="4"/><xf fontId="1" fillId="1" borderId="1" numFmtId="10"/></cellXfs><dxfs>'
    + `<dxf><font><color rgb="FF9C0006"/></font>${bg('FFCDD2')}</dxf>`
    + `<dxf><font><i/></font>${bg('DCFCE7')}<border><bottom style="thick"><color indexed="10"/></bottom></border><numFmt numFmtId="164" formatCode="0.00"/></dxf>`
    + '<dxf><font><b/><color theme="4"/></font></dxf>'
    + `<dxf>${bg('F1F5F9')}</dxf><dxf>${bg('FED7AA')}</dxf><dxf>${bg('FDE68A')}</dxf>`
    + '<dxf><font><i val="0"/><b val="false"/><u val="none"/><strike val="0"/></font><fill><patternFill patternType="none"/></fill><numFmt numFmtId="0"/></dxf>'
    + '</dxfs></styleSheet>');
  zip.file('xl/worksheets/s1.xml', worksheet([
    row(1, n('A1', 12, 2), n('B1', 3), t('C1', 'prefix ERR code? suffix'), n('E1', 2),
      '<c r="F1" t="inlineStr"><is><r><rPr><i/><color rgb="FFFF0000"/></rPr><t>Rich sample</t></r></is></c>', n('XFD1', 10)),
    row(2, n('A2', -5), n('B2', 3), t('C2', 'err code.'), t('D2', '   '), f('E2', 'UNSUPPORTED()')),
    row(3, n('A3', 7), n('B3', 3), t('C3', 'prefix:value!'), f('D3', '""', 0, ' t="str"'), '<c r="E3" t="e"><v>#N/A</v></c>'),
    row(4, t('A4', '12'), t('C4', 'other')),
    row(5, n('A5', 4, 2)),
    row(500, n('A500', 12)),
    row(1048576, n('A1048576', 25), f('XFD1048576', 'Input!A1+2', 1))
  ], '<mergeCells><mergeCell ref="A500:BL1600"/></mergeCells>' + [
    area('A1:A5 XFD1048576', compare('between', 4, 1, [15, 5])),
    area('A1:A5 XFD1048576', compare('greaterThanOrEqual', 3, 0, [10])),
    area('A1:A3', compare('notBetween', 10, 4, [0, 99]), compare('lessThan', 1, undefined, [0], ' stopIfTrue="true"')),
    area('B1:B3 E1:F3 XFD1048576', rule('expression', 5, 2, ['AND($A1>=Limit,B$1>0)'])),
    area('A5', compare('equal', 19, 6, [4], ' stopIfTrue="1"')),
    area('C1:C3', rule('containsText', 6, 5, [], ' text="err*~?"')),
    area('C2', rule('notContainsText', 7, 3, [], ' text="err*?~?"')),
    area('C3', rule('beginsWith', 8, 2, [], ' text="PREFIX"'), rule('endsWith', 9, 4, [], ' text="!"')),
    area('C3:C4', rule('notContainsBlanks', 11, 0)),
    area('D1:D3', rule('containsBlanks', 12, 3)), area('E2:E3', rule('containsErrors', 13, 4)),
    area('E2:E3', rule('notContainsErrors', 14, 3)),
    area('F1', rule('expression', 2, 6, ['TRUE'])),
    area('A500', rule('expression', 15, 0, ['A500>10'])),
    area('B3', rule('colorScale', 16)), area('B3', compare('equal', 17, 999, [3])), area('XFE1', compare('equal', 18, 0, [1]))
  ].join('')));
  zip.file('xl/worksheets/s2.xml', worksheet([row(1, n('A1', 5)), row(2, n('A2', 1))],
    area('A1:A1048576', compare('greaterThan', 1, 0, [3]))
    + '<extLst><ext uri="example">' + area('A2', compare('greaterThan', 1, 0, [0])) + '</ext></extLst>', forceGeneral));
  zip.file('xl/worksheets/s3.xml', worksheet([row(1, n('A1', 20))]));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
