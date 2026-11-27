import type { OrderedXmlNode, XmlNode } from './xml';

// OpenXML normally contains quoted attributes, the five XML entities, and
// ordinary elements. Tokenize that subset without constructing tag paths or
// copying opening tags character by character. Other XML uses the full parser.
const token = /([^<]+)|<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?xml\s+([^?]*)\?>|<\/([^\s/>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/gy;
const attribute = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const entity = /&(amp|lt|gt|quot|apos|#38|#x26|#60|#x3C|#62|#x3E|#34|#x22|#39|#x27);/g;
const characterReference = /&(amp|lt|gt|quot|apos|#x[0-9a-fA-F]+|#\d+);/g;
// Match the full parser's entity policy, including its five numeric aliases.
const entities: Record<string, string> = {
  amp: '&', '#38': '&', '#x26': '&', lt: '<', '#60': '<', '#x3C': '<',
  gt: '>', '#62': '>', '#x3E': '>', quot: '"', '#34': '"', '#x22': '"',
  apos: "'", '#39': "'", '#x27': "'"
};

interface ElementFrame {
  tag: string;
  children: OrderedXmlNode;
  text: string;
}

export function parseOpenXml(source: string, decodeCharacterReferences = false): OrderedXmlNode | null {
  if (!source.startsWith('<')) return null;
  const xml = source.replace(/\r\n?/g, '\n');
  const root: ElementFrame = { tag: '', children: [], text: '' };
  const stack = [root];
  token.lastIndex = 0;
  let position = 0;
  try {
    while (position < xml.length) {
      const match = token.exec(xml);
      if (!match || match.index !== position) return null;
      position = token.lastIndex;
      const current = stack[stack.length - 1];
      if (match[1] !== undefined) {
        // The full parser ignores text outside the document element.
        if (stack.length > 1) current.text += match[1];
      } else if (match[2] !== undefined) {
        flushText(current, decodeCharacterReferences);
        current.children.push({ '#text': match[2] });
      } else if (match[3] !== undefined) {
        flushText(current, decodeCharacterReferences);
        const declaration: XmlNode = { '?xml': [{ '#text': '' }] };
        declaration[':@'] = parseAttributes(match[3], decodeCharacterReferences);
        current.children.push(declaration);
      } else if (match[4] !== undefined) {
        if (stack.length === 1 || current.tag !== match[4]) return null;
        flushText(current, decodeCharacterReferences);
        stack.pop();
      } else if (match[5] !== undefined) {
        const tag = match[5];
        if (tag === ':@' || tag === '#text' || tag in Object.prototype || tag === 'prototype') return null;
        flushText(current, decodeCharacterReferences);
        const children: OrderedXmlNode = [];
        const node: XmlNode = {};
        setProperty(node, tag, children);
        if (match[6].trim()) node[':@'] = parseAttributes(match[6], decodeCharacterReferences);
        current.children.push(node);
        if (!match[7]) {
          if (stack.length > 101) return null;
          stack.push({ tag, children, text: '' });
        }
      }
      // Comments leave pending text intact, as in the full ordered parser.
    }
    return stack.length === 1 ? root.children : null;
  } catch {
    // Unfamiliar syntax retains the full parser's existing error handling.
    return null;
  }
}

function flushText(frame: ElementFrame, decodeCharacterReferences: boolean): void {
  if (frame.text) {
    frame.children.push({ '#text': decodeEntities(frame.text, decodeCharacterReferences) });
    frame.text = '';
  }
}

function parseAttributes(source: string, decodeCharacterReferences: boolean): XmlNode {
  const attributes: XmlNode = {};
  attribute.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = attribute.exec(source))) {
    if (match[1] in Object.prototype || match[1] === 'prototype') throw new Error('Reserved XML attribute');
    setProperty(attributes, match[1], decodeEntities(match[2] ?? match[3], decodeCharacterReferences));
  }
  return attributes;
}

function decodeEntities(text: string, decodeCharacterReferences: boolean): string {
  if (!text.includes('&')) return text;
  if (!decodeCharacterReferences) return text.replace(entity, (_, name: string) => entities[name]);
  return text.replace(characterReference, (reference, name: string) => {
    if (entities[name]) return entities[name];
    const hex = name[1] === 'x';
    const point = Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
    return point === 9 || point === 10 || point === 13 || (point >= 0x20 && point <= 0xd7ff)
      || (point >= 0xe000 && point <= 0xfffd) || (point >= 0x10000 && point <= 0x10ffff)
      ? String.fromCodePoint(point) : reference;
  });
}

function setProperty(target: XmlNode, key: string, value: unknown): void {
  if (key === '__proto__') Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
  else target[key] = value;
}
