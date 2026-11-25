import JSZip from 'jszip';

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
