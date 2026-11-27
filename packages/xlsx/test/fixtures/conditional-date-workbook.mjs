import JSZip from 'jszip';

const periods = ['yesterday', 'today', 'tomorrow', 'last7Days', 'lastWeek', 'thisWeek', 'nextWeek', 'lastMonth', 'thisMonth', 'nextMonth'];
const dates = [
  '2023-11-30T23:59', '2023-12-01T00:00', '2023-12-23T23:59', '2023-12-24T00:00', '2023-12-25T12:00',
  '2023-12-26T00:00', '2023-12-30T23:59', '2023-12-31T23:59', '2024-01-01T00:00', '2024-01-01T15:30',
  '2024-01-02T00:00', '2024-01-06T23:59', '2024-01-07T00:00', '2024-01-13T23:59', '2024-01-14T00:00',
  '2024-01-31T23:59', '2024-02-01T00:00', '2024-02-29T23:59', '2024-03-01T00:00'
];

export async function createConditionalDateWorkbook(date1904 = false) {
  const zip = new JSZip();
  const serial = date => Date.parse(date + 'Z') / 86_400_000 + (date1904 ? 24107 : 25569);
  const cells = dates.map((date, i) => i === 9 ? ['d', `<v>${date}</v>`] : ['n', `<v>${serial(date)}</v>`]);
  cells.push(['str', `<v>${serial(dates[8])}</v>`], ['b', '<v>1</v>'], ['n', '<f>""</f>'],
    ['e', '<v>#N/A</v>'], ['n', `<f>${serial(dates[8])}+0.5</f>`]);
  const columns = 'ABCDEFGHIJ'.split('');
  const rows = cells.map(([type, body], index) => {
    const row = index + 1;
    return `<row r="${row}">${columns.map(column => `<c r="${column}${row}" t="${type}">${body}</c>`).join('')}</row>`;
  });
  const rules = columns.map((column, index) => `<conditionalFormatting sqref="${column}1:${column}25">`
    + `<cfRule type="timePeriod" timePeriod="${periods[index]}" dxfId="0" priority="${index + 1}">`
    + `<formula>FLOOR(${column}1,1)=TODAY()</formula></cfRule></conditionalFormatting>`);
  zip.file('xl/workbook.xml', `<workbook><workbookPr date1904="${Number(date1904)}"/><sheets>`
    + '<sheet name="Calendar" sheetId="1" r:id="s1"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="s1" Target="worksheets/s1.xml"/></Relationships>');
  zip.file('xl/styles.xml', '<styleSheet><dxfs><dxf><fill><patternFill><bgColor rgb="FFDCFCE7"/></patternFill>'
    + '</fill></dxf></dxfs></styleSheet>');
  zip.file('xl/worksheets/s1.xml', `<worksheet><sheetData>${rows.join('')}</sheetData>${rules.join('')}</worksheet>`);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
