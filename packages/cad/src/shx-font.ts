export const MAX_SHX_BYTES = 8 * 1024 * 1024;

type Point = { x: number; y: number };
type Bounds = { minX: number; minY: number; maxX: number; maxY: number };
type Stroke = { start: Point; end: Point; radii?: Point; sweep?: number };

export interface ShxWorkBudget {
  instructions: number;
  strokes: number;
}

export interface ShxFont {
  above: number;
  below: number;
  bigFont: boolean;
  unicode: boolean;
  encoding?: string;
  glyph(character: string, budget: ShxWorkBudget): Glyph | undefined;
}

interface Glyph {
  advance: number;
  strokes: Stroke[];
  bounds: Bounds;
}

export interface ShxTextPath {
  path: string;
  bounds: Bounds;
}

const DIRECTIONS_X = [1, 1, 1, 0.5, 0, -0.5, -1, -1, -1, -1, -1, -0.5, 0, 0.5, 1, 1];
const DIRECTIONS_Y = [0, 0.5, 1, 1, 1, 1, 1, 0.5, 0, -0.5, -1, -1, -1, -1, -1, -0.5];
const OCTANT = Math.PI / 4;
const TURN = 2 * Math.PI;
const ORIGIN = { x: 0, y: 0 };

function invalid(): never { throw new Error('Invalid SHX font or glyph program.'); }

export function parseShxFont(bytes: Uint8Array, encoding?: string): ShxFont {
  if (!bytes.length || bytes.length > MAX_SHX_BYTES) invalid();
  const header = new TextDecoder().decode(bytes.subarray(0, 25));
  const shapes = /^AutoCAD-86 shapes 1\.[01]\r\n\x1a/.test(header);
  const unifont = header === 'AutoCAD-86 unifont 1.0\r\n\x1a';
  const bigFont = header === 'AutoCAD-86 bigfont 1.0\r\n\x1a';
  if (!shapes && !unifont && !bigFont) throw new Error('Unsupported SHX file type.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const records = new Map<number, Uint8Array>();
  const leadBytes: Array<[number, number]> = [];
  let offset = shapes ? 24 : 25;
  const word = () => { const value = view.getUint16(offset, true); offset += 2; return value; };
  const record = (id: number, size: number, start: number) => {
    if (!size || start > bytes.length - size || records.has(id)) invalid();
    const nameEnd = bytes.subarray(start, start + Math.min(size, 1024)).indexOf(0);
    if (nameEnd < 0) invalid();
    records.set(id, bytes.subarray(start + nameEnd + 1, start + size));
  };
  if (shapes) {
    const first = word(), last = word(), count = word();
    let start = offset + count * 4;
    for (let index = 0; index < count; index++) {
      const id = word(), size = word();
      if ((index === 0 && id !== first) || (index === count - 1 && id !== last)) invalid();
      record(id, size, start);
      start += size;
    }
    if (bytes[start] !== 69 || bytes[start + 1] !== 79 || bytes[start + 2] !== 70) invalid();
  } else if (unifont) {
    const count = word();
    for (let index = 0; index < count; index++) {
      const id = word(), size = word();
      record(id, size, offset);
      offset += size;
    }
    if (offset !== bytes.length) invalid();
  } else {
    const size = word(), count = word(), ranges = word();
    if (size !== 8 || ranges > 256) invalid();
    for (let index = 0; index < ranges; index++) {
      const first = word(), last = word();
      if (first > last || last > 255) invalid();
      leadBytes.push([first, last]);
    }
    const dataStart = offset + count * size;
    if (dataStart > bytes.length) invalid();
    for (let index = 0; index < count; index++) {
      const id = word(), length = word(), start = view.getUint32(offset, true);
      offset += 4;
      if (!length) continue;
      if (start < dataStart) invalid();
      record(id, length, start);
    }
  }
  const metadata = records.get(0);
  if (!metadata || metadata.length < (unifont ? 6 : 3) || !metadata[0]) invalid();
  const [above, below, mode, characterEncoding, , terminator] = metadata;
  const primitiveWidth = bigFont && metadata.length >= 5 ? metadata[3] : 0;
  if (mode !== 0 && mode !== 2) throw new Error('Unsupported SHX font writing mode.');
  if (unifont && (characterEncoding !== 0 || terminator !== 0)) {
    throw new Error('Unsupported SHX Unicode font encoding.');
  }
  records.delete(0);

  const byCharacter = new Map<string, number>();
  if (!unifont && encoding) {
    const decoder = new TextDecoder(encoding, { fatal: true });
    for (const id of records.keys()) {
      if (id > 255 && (!bigFont || !leadBytes.some(([first, last]) => id >> 8 >= first && id >> 8 <= last))) continue;
      try {
        const bytes = id > 255 ? Uint8Array.of(id >> 8, id & 255) : Uint8Array.of(id);
        const character = decoder.decode(bytes);
        if ([...character].length === 1 && !byCharacter.has(character)) byCharacter.set(character, id);
      } catch { /* The font can also contain internal subshapes. */ }
    }
  }
  const cache = new Map<number, Glyph | undefined>();
  const readGlyph = (id: number, budget: ShxWorkBudget) => {
    if (!cache.has(id) && records.has(id) && budget.instructions > 0) {
      let glyph: Glyph | undefined;
      try { glyph = decodeGlyph(id, records, unifont, bigFont, primitiveWidth, above, budget); }
      catch { /* Other glyphs can still be used when a program is invalid. */ }
      cache.set(id, glyph);
    }
    return cache.get(id);
  };
  return {
    above, below, bigFont, unicode: unifont, encoding,
    glyph(character, budget) {
      const code = character.codePointAt(0)!;
      if (code === 32 && !bigFont && !records.has(32)) {
        return { advance: readGlyph(65, budget)?.advance || above / 2, strokes: [], bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0 } };
      }
      if (unifont) return readGlyph(code, budget) ?? (code === 0x2300 || code === 0xd8 ? readGlyph(0x2205, budget) : undefined);
      const symbol = code === 0xb0 ? 256 : code === 0xb1 ? 257 : code === 0x2300 || code === 0xd8 ? 258 : undefined;
      if (!bigFont && symbol && records.has(symbol)) return readGlyph(symbol, budget);
      const id = byCharacter.get(character) ?? (code < 128 ? code : undefined);
      return id === undefined ? undefined : readGlyph(id, budget);
    }
  };
}

function decodeGlyph(
  id: number, records: Map<number, Uint8Array>, unifont: boolean, bigFont: boolean,
  primitiveWidth: number, primitiveHeight: number, budget: ShxWorkBudget
): Glyph {
  let point = ORIGIN, scale = 1, penDown = true, steps = 0;
  let origin = ORIGIN, scaleX = 1, scaleY = 1, stack: Point[] = [];
  const strokes: Stroke[] = [];
  const bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const checkPoint = ({ x, y }: Point) => {
    if (!Number.isFinite(x + y) || Math.max(Math.abs(x), Math.abs(y)) > 1e6) invalid();
  };
  const include = (p: Point) => {
    checkPoint(p);
    bounds.minX = Math.min(bounds.minX, p.x);
    bounds.minY = Math.min(bounds.minY, p.y);
    bounds.maxX = Math.max(bounds.maxX, p.x);
    bounds.maxY = Math.max(bounds.maxY, p.y);
  };
  const placed = (p: Point): Point => ({ x: origin.x + p.x * scaleX, y: origin.y + p.y * scaleY });
  const drawTo = (end: Point, radius?: number, sweep?: number) => {
    checkPoint(end);
    if (penDown) {
      const start = placed(point), target = placed(end);
      include(start);
      include(target);
      strokes.push({ start, end: target, radii: radius === undefined ? undefined : { x: radius * scaleX, y: radius * scaleY }, sweep });
    }
    point = end;
  };
  const arc = (center: Point, radius: number, start: number, sweep: number, end?: Point) => {
    if (!(radius > 0 && radius * Math.max(1, scaleX, scaleY) <= 1e6) || Math.abs(sweep) > TURN + 1e-9) invalid();
    if (!sweep) return;
    const at = (angle: number): Point => ({ x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) });
    if (penDown) {
      for (let quadrant = 0; quadrant < 4; quadrant++) {
        const angle = quadrant * Math.PI / 2;
        const delta = ((Math.sign(sweep) * (angle - start)) % TURN + TURN) % TURN;
        if (delta <= Math.abs(sweep)) include(placed(at(angle)));
      }
    }
    if (Math.abs(sweep) >= TURN - 1e-9) {
      const finish = end ?? point;
      drawTo(at(start + sweep / 2), radius, sweep / 2);
      drawTo(finish, radius, sweep / 2);
    } else {
      drawTo(end ?? at(start + sweep), radius, sweep);
    }
  };
  const displacement = (x: number, y: number, bulge = 0) => {
    const dx = x * scale, dy = y * scale;
    const end = { x: point.x + dx, y: point.y + dy };
    if (!bulge || !penDown || (!dx && !dy)) {
      drawTo(end);
      return;
    }
    const b = bulge / 127;
    const offset = (1 - b * b) / (4 * b);
    const center = { x: point.x + dx / 2 - dy * offset, y: point.y + dy / 2 + dx * offset };
    arc(center, Math.hypot(dx, dy) * (1 + b * b) / (4 * Math.abs(b)),
      Math.atan2(point.y - center.y, point.x - center.x), 4 * Math.atan(b), end);
  };

  const run = (glyphId: number, depth: number) => {
    const program = records.get(glyphId);
    if (!program || depth > 16) invalid();
    let cursor = 0, skip = false;
    const byte = () => {
      if (cursor >= program.length || ++steps > 8192 || --budget.instructions < 0) invalid();
      return program[cursor++];
    };
    const signed = () => (byte() << 24) >> 24;
    for (;;) {
      const command = byte();
      if (!command) return;
      const execute: boolean = !skip;
      skip = false;
      if (command > 15) {
        if (execute) displacement(DIRECTIONS_X[command & 15] * (command >> 4), DIRECTIONS_Y[command & 15] * (command >> 4));
        continue;
      }
      switch (command) {
        case 1: case 2:
          if (execute) penDown = command === 1;
          break;
        case 3: case 4: {
          const factor = byte();
          if (execute) {
            scale = command === 3 ? scale / factor : scale * factor;
            if (!(scale >= 1e-9 && scale <= 1e6)) invalid();
          }
          break;
        }
        case 5:
          if (execute) {
            if (stack.length >= 32) invalid();
            stack.push(point);
          }
          break;
        case 6:
          if (execute) point = stack.pop() ?? invalid();
          break;
        case 7: {
          const first = byte();
          const subshape = unifont ? first * 256 + byte() : first;
          if (bigFont && subshape === 0) {
            const primitive = byte() * 256 + byte();
            const x = signed(), y = signed(), width = byte(), height = byte();
            if (!execute) break;
            if (!primitiveWidth || !width || !height) invalid();
            const previous = { point, scale, penDown, stack, origin, scaleX, scaleY };
            origin = placed({ x: point.x + x * scale, y: point.y + y * scale });
            scaleX *= width * scale / primitiveWidth;
            scaleY *= height * scale / primitiveHeight;
            point = ORIGIN;
            scale = 1;
            stack = [];
            run(primitive, depth + 1);
            ({ point, scale, penDown, stack, origin, scaleX, scaleY } = previous);
          } else if (execute) run(subshape, depth + 1);
          break;
        }
        case 8: case 9: case 12: case 13: {
          const repeated = command === 9 || command === 13;
          do {
            const x = signed(), y = signed();
            if (repeated && !x && !y) break;
            const bulge = command >= 12 ? signed() : 0;
            if (execute) displacement(x, y, bulge);
          } while (repeated);
          break;
        }
        case 10: case 11: {
          const fractional = command === 11;
          const startOffset = fractional ? byte() / 256 : 0;
          const endOffset = fractional ? (byte() || 256) / 256 : 1;
          const radius = (fractional ? byte() * 256 + byte() : byte()) * scale;
          const spec = byte();
          if (execute) {
            const direction = spec & 128 ? -1 : 1;
            const startOctant = (spec >> 4) & 7;
            const span = (spec & 15) || 8;
            const start = (startOctant + startOffset * direction) * OCTANT;
            const sweep = (span - 1 + endOffset - startOffset) * direction * OCTANT;
            arc({ x: point.x - radius * Math.cos(start), y: point.y - radius * Math.sin(start) }, radius, start, sweep);
          }
          break;
        }
        case 14: skip = execute; break;
        default: if (execute) invalid();
      }
    }
  };

  run(id, 0);
  return { strokes, bounds, advance: point.x };
}

export function layoutShxText(
  lines: string[], font: ShxFont | undefined, bigFont: ShxFont | undefined, height: number,
  horizontal: 'left' | 'center' | 'right', vertical: 'baseline' | 'bottom' | 'middle' | 'top',
  budget: ShxWorkBudget
): (ShxTextPath & { fonts: Set<ShxFont> }) | undefined {
  const commands: string[] = [];
  const fonts = new Set<ShxFont>();
  const below = font ? font.below / font.above : bigFont ? bigFont.below / bigFont.above : 0;
  const lineHeight = height * Math.max(1.2, 1 + below);
  const descent = height * below + (lines.length - 1) * lineHeight;
  const baseline = vertical === 'top' ? height : vertical === 'middle' ? (height - descent) / 2 : vertical === 'bottom' ? -descent : 0;
  const bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const number = (value: number) => String(+value.toPrecision(11));
  let count = 0;
  for (const [index, line] of lines.entries()) {
    const glyphs: Array<{ x: number; scale: number; glyph: Glyph }> = [];
    let advance = 0;
    for (const character of line) {
      if (++count > 4096) return undefined;
      const preferred = font?.unicode || !bigFont || character.codePointAt(0)! < 128 ? font : bigFont;
      const alternate = preferred === font ? bigFont : font;
      let active = preferred, glyph = active?.glyph(character, budget);
      if (!glyph) { active = alternate; glyph = active?.glyph(character, budget); }
      if (!active || !glyph) return undefined;
      fonts.add(active);
      if ((budget.strokes -= Math.max(glyph.strokes.length, 1)) < 0) return undefined;
      const scale = height / active.above;
      glyphs.push({ x: advance, scale, glyph });
      advance += glyph.advance * scale;
    }
    const xOffset = horizontal === 'right' ? -advance : horizontal === 'center' ? -advance / 2 : 0;
    const y = baseline + index * lineHeight;
    for (const { x: origin, scale, glyph } of glyphs) {
      const x = origin + xOffset;
      const format = (point: Point) => `${number(x + point.x * scale)} ${number(y - point.y * scale)}`;
      let end: Point | undefined;
      for (const stroke of glyph.strokes) {
        if (!end || stroke.start.x !== end.x || stroke.start.y !== end.y) commands.push(`M${format(stroke.start)}`);
        if (stroke.radii && stroke.sweep) {
          commands.push(`A${number(stroke.radii.x * scale)} ${number(stroke.radii.y * scale)} 0 ${Math.abs(stroke.sweep) > Math.PI ? 1 : 0} ${stroke.sweep < 0 ? 1 : 0} ${format(stroke.end)}`);
        } else {
          commands.push(`L${format(stroke.end)}`);
        }
        end = stroke.end;
      }
      bounds.minX = Math.min(bounds.minX, x + glyph.bounds.minX * scale, x + glyph.advance * scale);
      bounds.maxX = Math.max(bounds.maxX, x + glyph.bounds.maxX * scale, x + glyph.advance * scale);
      bounds.minY = Math.min(bounds.minY, y - glyph.bounds.maxY * scale);
      bounds.maxY = Math.max(bounds.maxY, y - glyph.bounds.minY * scale);
    }
  }
  return { path: commands.join(''), bounds, fonts };
}
