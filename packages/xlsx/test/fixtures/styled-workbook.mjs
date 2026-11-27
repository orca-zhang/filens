import JSZip from 'jszip';

export async function createMergeBorderWorkbook({ includeTail = true } = {}) {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', '<workbook><sheets><sheet name="Merge borders" sheetId="1" r:id="sheet"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="sheet" Target="worksheets/sheet.xml"/></Relationships>');
  const edge = (side, style, rgb) => `<${side} style="${style}"><color rgb="FF${rgb}"/></${side}>`;
  const blue = '1847C7', green = '127E22', red = 'CF1A1A';
  const borders = ['', edge('top', 'thick', red) + edge('left', 'thick', red),
    edge('bottom', 'double', blue) + edge('right', 'medium', green), edge('top', 'thick', blue),
    edge('left', 'thick', green), edge('bottom', 'thick', red), edge('right', 'thick', red), edge('top', 'thick', 'E78B12')];
  zip.file('xl/styles.xml', '<styleSheet><borders>' + borders.map(border => `<border>${border}</border>`).join('')
    + '</borders><cellXfs>' + borders.map((_, index) => `<xf borderId="${index}"/>`).join('') + '</cellXfs>'
    + `<dxfs><dxf><border><bottom style="none"/>${edge('right', 'thick', '8139BB')}</border></dxf></dxfs></styleSheet>`);
  const cell = (ref, style, text) => `<c r="${ref}" s="${style}"${text ? ` t="str"><v>${text}</v></c>` : '/>'}`;
  const row = (index, ...cells) => `<row r="${index}">${cells.join('')}</row>`;
  zip.file('xl/worksheets/sheet.xml', '<worksheet><sheetFormatPr defaultColWidth="12" defaultRowHeight="22.5" customHeight="1"/>'
    + '<cols><col min="2" max="2" width="18"/><col min="4" max="4" hidden="1"/></cols><sheetData>'
    + row(1, cell('A1', 1, 'Uniform'), '<c r="E1" s="1"><v>1</v></c>')
    + row(3, cell('C3', 2), cell('G3', 2))
    + row(5, cell('A5', 1, 'Segmented'), cell('B5', 3), cell('C5', 3), cell('D5', 7), cell('AT5', 3))
    + row(8, cell('A8', 4)) + row(50, cell('J50', 7)) + row(110, cell('BA110', 6)) + row(150, cell('A150', 4))
    + row(204, cell('A204', 5), cell('AO204', 5), cell('BA204', 2))
    + (includeTail ? row(1048575, cell('XFB1048575', 1, 'Tail')) + row(1048576, cell('XFD1048576', 2)) : '')
    + '</sheetData><mergeCells><mergeCell ref="A1:C3"/><mergeCell ref="E1:G3"/><mergeCell ref="A5:BA204"/>'
    + (includeTail ? '<mergeCell ref="XFB1048575:XFD1048576"/>' : '') + '</mergeCells>'
    + '<conditionalFormatting sqref="E1"><cfRule type="cellIs" operator="equal" priority="1" dxfId="0"><formula>1</formula></cfRule></conditionalFormatting>'
    + '</worksheet>');
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function createDiagonalBorderWorkbook() {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', '<workbook><sheets><sheet name="Diagonal borders" sheetId="1" r:id="sheet"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="sheet" Target="worksheets/sheet.xml"/></Relationships>');
  const red = '<diagonal style="thick"><color rgb="FFB91C1C"/></diagonal>';
  const green = '<diagonal style="mediumDashed"><color indexed="17"/></diagonal>';
  zip.file('xl/styles.xml', '<styleSheet><fills><fill/><fill><patternFill patternType="solid">'
    + '<fgColor rgb="FFFFF7DE"/></patternFill></fill></fills><borders><border/>'
    + `<border diagonalDown="true"><right style="thin"/>${red}</border>`
    + '<border diagonalUp="1"><diagonal style="double"><color theme="4"/></diagonal></border>'
    + `<border diagonalUp="1" diagonalDown="1">${green}</border><border>${red}</border></borders>`
    + '<cellStyleXfs><xf borderId="1"/></cellStyleXfs><cellXfs><xf borderId="0"/><xf borderId="1"/>'
    + '<xf borderId="2" fillId="1"/><xf borderId="3"/><xf borderId="4"/>'
    + '<xf xfId="0" applyBorder="0" borderId="0"/></cellXfs>'
    + `<dxfs><dxf><border diagonalUp="1">${green}</border></dxf><dxf><border><diagonal style="none"/></border></dxf></dxfs>`
    + '</styleSheet>');
  zip.file('xl/worksheets/sheet.xml', '<worksheet><sheetFormatPr defaultColWidth="10" defaultRowHeight="24" customHeight="1"/>'
    + '<sheetData><row r="1" ht="33" customHeight="1"><c r="A1" s="1" t="str"><v>Label</v></c>'
    + '<c r="B1" s="2"/><c r="C1" s="3"/><c r="D1" s="4"/><c r="E1" s="5"/></row>'
    + '<row r="2"><c r="B2" s="1"><v>21</v></c><c r="C2" s="1"><v>22</v></c></row>'
    + '<row r="10"><c r="A10" s="1" t="str"><v>Diagonal merge</v></c></row>'
    + '<row r="1048576"><c r="XFD1048576" s="2"><v>42</v></c></row></sheetData>'
    + '<mergeCells><mergeCell ref="A10:BA209"/></mergeCells>'
    + '<conditionalFormatting sqref="B2"><cfRule type="cellIs" operator="equal" priority="1" dxfId="0"><formula>21</formula></cfRule></conditionalFormatting>'
    + '<conditionalFormatting sqref="C2"><cfRule type="cellIs" operator="equal" priority="2" dxfId="1"><formula>22</formula></cfRule></conditionalFormatting>'
    + '</worksheet>');
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function createStyledWorkbookFixture(general = false) {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', '<workbook><sheets><sheet name="Styled" sheetId="1" r:id="sheet"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="sheet" Target="worksheets/sheet.xml"/></Relationships>');
  zip.file('xl/theme/theme1.xml', '<a:theme><a:themeElements><a:clrScheme>'
    + '<a:dk1><a:sysClr val="windowText" lastClr="191919"/></a:dk1><a:accent1><a:srgbClr val="336699"/></a:accent1>'
    + '</a:clrScheme></a:themeElements></a:theme>');
  zip.file('xl/styles.xml', '<styleSheet>'
    + '<fonts><font><name val="Arial"/></font>'
    + '<font><name val="Courier New"/><sz val="12"/><i/><b/><u val="double"/><strike/><color theme="4" tint="-0.5"/></font>'
    + '<font><name val="Georgia"/><color indexed="1"/></font></fonts>'
    + '<fills><fill><patternFill patternType="none"/></fill>'
    + '<fill><patternFill patternType="solid"><fgColor rgb="00FDE68A"/><bgColor rgb="FF000000"/></patternFill></fill>'
    + '<fill><patternFill patternType="solid"><fgColor theme="4" tint="0.5"/></patternFill></fill>'
    + '<fill><gradientFill degree="90"><stop position="1"><color theme="1"/></stop><stop position="0"><color indexed="8"/></stop></gradientFill></fill>'
    + '<fill><patternFill patternType="lightGrid"><fgColor rgb="FF114477"/><bgColor indexed="9"/></patternFill></fill></fills>'
    + '<borders><border/><border><top style="thin"><color rgb="FFB91C1C"/></top>'
    + '<right style="mediumDashed"><color indexed="12"/></right><bottom style="double"><color theme="4"/></bottom><left style="dotted"/></border></borders>'
    + '<cellStyleXfs><xf fontId="0"/><xf fontId="1" fillId="1" borderId="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf></cellStyleXfs>'
    + '<cellXfs><xf fontId="0"/><xf fillId="1" fontId="0"><alignment horizontal="right" vertical="bottom" indent="1"/></xf>'
    + '<xf fillId="2" fontId="2"/><xf xfId="1" fontId="0" fillId="0" borderId="0" applyFont="0" applyFill="0" applyBorder="false" applyAlignment="0"><alignment horizontal="right"/></xf>'
    + '<xf fillId="3"/><xf fillId="4"/><xf xfId="1" fillId="3"><alignment horizontal="center" vertical="center"/></xf></cellXfs>'
    + '<colors><indexedColors><rgbColor rgb="FF000000"/><rgbColor rgb="FF0D332C"/></indexedColors></colors>'
    + '</styleSheet>');
  zip.file('xl/sharedStrings.xml', '<sst><si><t>Six short words should wrap into multiple lines even under narrow column constraints</t></si>'
    + '<si><t>Centered merged text</t></si></sst>');
  zip.file('xl/worksheets/sheet.xml', '<worksheet><sheetFormatPr defaultColWidth="12"/><cols>'
    + '<col min="1" max="1" width="8"/><col min="2" max="4" style="2" width="12"/><col min="4" max="5" style="4" width="12"/>'
    + '<col min="48" max="64" style="2" width="16"/></cols><sheetData>' + (general ? '<!-- general -->' : '')
    + '<row r="1"><c r="A1" s="3" t="s"><v>0</v></c><c r="C1" s="0"/><c r="D1" s="5"/><c r="E1" s="4"><v>4</v></c></row>'
    + '<row r="2" s="1" customFormat="1"><c r="B2" s="2"><v>7</v></c><c r="C2"/><c r="D2" s="3"><v>42</v></c></row>'
    + '<row r="90" s="3" customFormat="1"/><row r="500"><c r="A500" s="6" t="s"><v>1</v></c></row>'
    + '<row r="2000"><c r="BL2000"><v>15</v></c></row></sheetData>'
    + '<mergeCells><mergeCell ref="B90:AB130"/><mergeCell ref="A500:BL1700"/></mergeCells></worksheet>');
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
