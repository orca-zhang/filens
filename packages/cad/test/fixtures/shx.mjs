const ascii = text => [...new TextEncoder().encode(text)];
const word = value => [value & 255, value >> 8 & 255];

export function createShxFixture(type, glyphs, metadata, ranges = []) {
  const signature = ascii(`AutoCAD-86 ${type}\r\n\x1a`);
  const programs = [[0, [0, ...metadata]], ...glyphs.map(([id, program]) => [id, [0, ...program]])];
  const index = programs.flatMap(([id, record]) => [...word(id), ...word(record.length)]);
  const contents = programs.flatMap(([, record]) => record);
  if (type.startsWith('shapes')) {
    return Uint8Array.from([...signature, 0, 0, ...word(programs.at(-1)[0]), ...word(programs.length), ...index, ...contents, ...ascii('EOF')]);
  }
  if (type.startsWith('unifont')) {
    return Uint8Array.from([...signature, ...word(programs.length), ...programs.flatMap(([_id, record], i) => [...index.slice(i * 4, i * 4 + 4), ...record])]);
  }
  const header = [...signature, ...word(8), ...word(programs.length), ...word(ranges.length), ...ranges.flatMap(range => range.flatMap(word))];
  let offset = header.length + programs.length * 8;
  return Uint8Array.from([...header, ...programs.flatMap(([id, record]) => {
    const entry = [...word(id), ...word(record.length), ...word(offset), ...word(offset >>> 16)];
    offset += record.length;
    return entry;
  }), ...contents]);
}

const letter = [0x44, 0x40, 0x4c, 2, 0x60, 0];
export const testShxFont = createShxFixture('shapes 1.1',
  [...' 0123456789/ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-'].map(character =>
    [character.charCodeAt(0), character === ' ' ? [2, 0x50, 0] : letter]), [4, 1, 2, 0]);

export function createShxDxf({ labels = ['AA'], primary = 'fonts\\stroke.shx', secondary = '', codepage = 'ANSI_932', legacy = false, hidden = false, vertical = false } = {}) {
  return [
    0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, legacy ? 'AC1015' : 'AC1032', 9, '$DWGCODEPAGE', 3, codepage, 0, 'ENDSEC',
    0, 'SECTION', 2, 'TABLES', 0, 'TABLE', 2, 'STYLE',
    0, 'STYLE', 2, 'Standard', 70, vertical ? 4 : 0, 3, primary, 4, secondary, 0, 'ENDTAB',
    0, 'TABLE', 2, 'LAYER', 0, 'LAYER', 2, 'LABELS', 70, 0, 62, hidden ? -7 : 7, 0, 'ENDTAB', 0, 'ENDSEC',
    0, 'SECTION', 2, 'ENTITIES',
    ...labels.flatMap((value, index) => [0, 'TEXT', 8, 'LABELS', 10, 0, 20, index * 10, 40, 4, 41, 2, 50, 90, 1, value]),
    0, 'ENDSEC', 0, 'EOF', ''
  ].join('\n');
}
