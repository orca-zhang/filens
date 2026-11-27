import JSZip from 'jszip';

const maxRow = 1048576;
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const cell = (ref, value, type = 'n') => `<c r="${ref}" t="${type}"><v>${escape(value)}</v></c>`;
const formula = (ref, value, cache = '') => `<c r="${ref}"><f>${escape(value)}</f>${cache}</c>`;
const row = (index, ...cells) => `<row r="${index}">${cells.join('')}</row>`;
const worksheet = (rows, tail = '') =>
  `<worksheet><sheetFormatPr defaultColWidth="18"/><sheetData>${rows.join('')}</sheetData>${tail}</worksheet>`;
const columns = names => `<tableColumns count="${names.length}">${names.map((name, index) =>
  `<tableColumn id="${index + 1}" name="${escape(name)}"/>`).join('')}</tableColumns>`;
const relationship = (id, kind, target, extra = '') =>
  `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${kind}" Target="${target}"${extra}/>`;
const tablePart = id => `<tableParts><tablePart r:id="${id}"/></tableParts>`;

export async function createStructuredReferenceWorkbook({ streamed = false, invalid = false, worksheetFilter = false } = {}) {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', `<workbook><sheets><sheet name="Summary" sheetId="1" r:id="s1"/>
    <sheet name="Team's Ledger" sheetId="2" r:id="s2"/><sheet name="Filtered" sheetId="3" r:id="s3"/>
    </sheets><definedNames><definedName name="Revenue">Sales[Gross]</definedName></definedNames></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships>' + [
    relationship('s1', 'worksheet', 'worksheets/summary.xml'),
    relationship('s2', 'worksheet', 'worksheets/ledger.xml'),
    relationship('s3', 'worksheet', 'worksheets/filtered.xml')
  ].join('') + '</Relationships>');
  zip.file('xl/styles.xml', '<styleSheet><cellXfs><xf numFmtId="0"/></cellXfs></styleSheet>');
  zip.file('xl/worksheets/summary.xml', worksheet([
    row(1, formula('A1', 'SUM(Revenue)'), formula('B1', 'SUBTOTAL(109,Sales[Gross])'),
      formula('C1', 'SUBTOTAL(9,FilteredRows[Value])'), formula('D1', 'Sales[[#Headers],[Qty]]'),
      formula('E1', 'Sales[[#Totals],[Gross]]'), formula('F1', 'SUM(Sales[[#Headers],[#Data],[Qty]:[Price]])'),
      formula('G1', "SUM(Sales['#Paid '[net']])"), formula('H1', 'COUNTA(Sales[Line\nBreak])'),
      formula('I1', 'SUM(Sales[[#Headers],[#Totals],[Gross]])')),
    row(2, formula('A2', 'TEXTJOIN("|",TRUE,Sales[Label])'), formula('B2', 'INDEX(Sales[Gross],1)'),
      formula('C2', 'IFERROR(Sales[@Price],"out")'), formula('D2', 'SUM(Sales)'),
      formula('E2', 'INDIRECT("Sales[[#Headers],[Label]]")'), formula('F2', "_xlfn.FORMULATEXT('Team''s Ledger'!G4)"),
      formula('G2', 'IFERROR(Sales[Unknown],"bad")'), formula('H2', 'COUNTA(FilteredRows[[#Totals],[Value]])'),
      formula('I2', 'SUM(Sales[Gross])', '<v>999</v>')),
    row(maxRow, formula('XFD1048576', 'SUM(Revenue)+Sales[[#Totals],[Gross]]'))
  ]));
  const extraRows = streamed ? Array.from({ length: 10500 }, (_, i) => row(i + 20, cell('K' + (i + 20), '1234567890'))) : [];
  zip.file('xl/worksheets/ledger.xml', worksheet([
    row(2, ...['Label', 'Qty', 'Price', 'Gross', '#Paid [net]', 'Line\nBreak'].map((label, i) => cell(String.fromCharCode(68 + i) + '2', label, 'str'))),
    row(3, cell('D3', 'North', 'str'), cell('E3', 2), cell('F3', 5),
      '<c r="G3"><f t="shared" si="0" ref="G3:G4">[@Qty]*[@Price]</f></c>',
      cell('H3', 1), cell('I3', 'first', 'str')),
    row(4, cell('D4', 'Quiet', 'str'), cell('E4', 3), cell('F4', 4), '<c r="G4"><f t="shared" si="0"/></c>')
      .replace('<row ', '<row hidden="1" '),
    row(5, cell('D5', 'West', 'str'), cell('E5', 4), cell('F5', 2), formula('G5', '[Qty]*[Price]')),
    ...extraRows,
    row(maxRow - 1, cell('D1048575', 'Last', 'str'), cell('E1048575', 2), cell('F1048575', 7),
      formula('G1048575', 'Sales[[#This Row],[Qty]]*Sales[[#This Row],[Price]]'),
      cell('H1048575', 2), cell('I1048575', 'last', 'str')),
    row(maxRow, formula('G1048576', 'SUBTOTAL(109,Sales[Gross])'))
  ], tablePart('lookup')));
  zip.file('xl/worksheets/_rels/ledger.xml.rels', '<Relationships>' + relationship('lookup', 'table', '../tables/sales.xml') + '</Relationships>');
  zip.file('xl/tables/sales.xml', `<table name="Sales" displayName="Sales" ref="D2:I${maxRow}" totalsRowCount="1">
    ${columns(['Label', 'Qty', 'Price', 'Gross', '#Paid [net]', 'Line_x000a_Break'])}</table>`);
  const autoFilter = '<autoFilter ref="A1:B4"><filterColumn colId="0"><filters><filter val="show"/></filters></filterColumn></autoFilter>';
  zip.file('xl/worksheets/filtered.xml', worksheet([
    row(1, cell('A1', 'Flag', 'str'), cell('B1', 'Value', 'str')),
    row(2, cell('A2', 'show', 'str'), cell('B2', 2)),
    row(3, cell('A3', 'hide', 'str'), cell('B3', 100)).replace('<row ', '<row hidden="1" '),
    row(4, cell('A4', 'show', 'str'), cell('B4', 3))
  ], (worksheetFilter ? autoFilter : '') + tablePart('filter')));
  zip.file('xl/worksheets/_rels/filtered.xml.rels', '<Relationships>' + (invalid
    ? relationship('filter', 'table', 'https://example.invalid/table.xml', ' TargetMode="External"')
    : relationship('filter', 'table', '/xl/catalog/filter.xml')) + '</Relationships>');
  zip.file('xl/catalog/filter.xml', `<table name="FilteredRows" displayName="FilteredRows" ref="A1:B4" totalsRowShown="0">
    ${worksheetFilter ? '' : autoFilter}
    ${columns(['Flag', 'Value'])}</table>`);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
