import JSZip from 'jszip';

export async function createFrozenPanesWorkbook({ frozen = true } = {}) {
  const zip = new JSZip();
  const directions = ['LTR', 'RTL'];
  zip.file('xl/workbook.xml', '<workbook><sheets>' + directions.map((name, i) =>
    `<sheet name="${name}" sheetId="${i + 1}" r:id="s${i + 1}"/>`).join('') + '</sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships>' + directions.map((_, i) =>
    `<Relationship Id="s${i + 1}" Target="worksheets/s${i + 1}.xml"/>`).join('') + '</Relationships>');
  zip.file('xl/styles.xml', '<styleSheet><fills><fill/><fill><patternFill patternType="solid"><fgColor rgb="FFDCFCE7"/></patternFill></fill></fills>'
    + '<cellXfs><xf/><xf fillId="1" applyFill="1"/><xf><alignment horizontal="centerContinuous"/></xf></cellXfs></styleSheet>');
  const cell = (ref, text, style = '') => `<c r="${ref}" t="inlineStr"${style}><is><t>${text}</t></is></c>`;
  for (const [i, direction] of directions.entries()) {
    const originRow = !frozen && i ? 1048510 : 65;
    const origin = `AD${originRow}`;
    const position = frozen
      ? `><pane state="${i ? 'frozenSplit' : 'frozen'}" xSplit="3" ySplit="3" topLeftCell="${origin}" activePane="bottomRight"/>`
      : ` topLeftCell="${origin}">`;
    zip.file(`xl/worksheets/s${i + 1}.xml`, `<worksheet><sheetViews><sheetView workbookViewId="0" rightToLeft="${Number(i > 0)}"${position}
      </sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/>
      <cols><col min="1" max="1" width="15"/><col min="2" max="2" hidden="1"/><col min="3" max="3" width="12"/></cols>
      <sheetData><row r="1" ht="28" customHeight="1">${cell('A1', `${direction} summary`)}${cell('C1', 'Frozen C')}${cell('AD1', 'Top AD')}</row>
      <row r="2" hidden="1">${cell('A2', 'Hidden row')}</row>
      <row r="3">${cell('C3', 'Across panes', ' s="1"')}</row>
      <row r="4">${cell('A4', 'After split')}</row>
      <row r="6">${cell('C6', 'Spans both panes', ' s="2"')}<c r="D6" s="2"/><c r="E6" s="2"/></row>
      <row r="${originRow}">${cell(`A${originRow}`, 'Side 65')}${cell(origin, 'Saved origin')}</row>
      <row r="1048576">${cell('A1048576', 'Final side')}${cell('XFD1048576', 'Final cell')}</row></sheetData>
      <mergeCells count="1"><mergeCell ref="C3:E5"/></mergeCells></worksheet>`);
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
