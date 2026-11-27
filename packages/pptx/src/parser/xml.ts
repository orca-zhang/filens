import type { PptxArchive, PptxArchiveEntry } from './archive';
import type { XMLParser } from 'fast-xml-parser';
import { parseOpenXml } from './ordered-xml';

let orderedParser: Promise<XMLParser> | undefined;
let reviewParser: Promise<XMLParser> | undefined;

export type XmlNode = Record<string, unknown>;
export type OrderedXmlNode = Array<Record<string, unknown>>;

export interface XmlElement {
  name: string;
  namespace?: string;
  bindings: ReadonlyMap<string, string>;
  attributes: XmlNode;
  entries: OrderedXmlNode;
}

export function element(entry: XmlNode, inherited: ReadonlyMap<string, string> = new Map()): XmlElement | undefined {
  const tag = Object.keys(entry).find(key => key !== ':@' && !key.startsWith('?') && Array.isArray(entry[key]));
  if (!tag) return undefined;
  const attributes = (entry[':@'] ?? {}) as XmlNode;
  let bindings = inherited;
  const declarations = Object.entries(attributes).filter(([name, value]) =>
    (name === 'xmlns' || name.startsWith('xmlns:')) && typeof value === 'string');
  if (declarations.length) {
    const extended = new Map(inherited);
    for (const [name, value] of declarations) extended.set(name.slice(6), value as string);
    bindings = extended;
  }
  const colon = tag.indexOf(':');
  return {
    name: tag.slice(colon + 1), namespace: bindings.get(colon < 0 ? '' : tag.slice(0, colon)),
    attributes, bindings, entries: entry[tag] as OrderedXmlNode
  };
}

export function childElements(parent: XmlElement): XmlElement[] {
  return parent.entries.flatMap(entry => {
    const child = element(entry, parent.bindings);
    return child ? [child] : [];
  });
}

export function children(parent: XmlElement, name: string, namespaces = [parent.namespace]): XmlElement[] {
  return childElements(parent).filter(child => child.name === name && namespaces.includes(child.namespace));
}

export function slideRoot(xml: OrderedXmlNode | null): XmlElement | undefined {
  return xml?.map(entry => element(entry)).find(root => root?.name === 'sld' &&
    (root.namespace === 'http://schemas.openxmlformats.org/presentationml/2006/main' ||
      root.namespace === 'http://purl.oclc.org/ooxml/presentationml/main'));
}

// Parse once: the ordered view retains mixed run/field/line-break order, and
// the lookup view groups repeated elements using the fixed options above.
const orderedCache = new WeakMap<PptxArchiveEntry, Promise<OrderedXmlNode>>();
const reviewCache = new WeakMap<PptxArchiveEntry, Promise<OrderedXmlNode>>();
const lookupCache = new WeakMap<PptxArchiveEntry, XmlNode>();

function orderedXml(file: PptxArchiveEntry, decodeCharacterReferences = false): Promise<OrderedXmlNode> {
  const cache = decodeCharacterReferences ? reviewCache : orderedCache;
  let ordered = cache.get(file);
  if (!ordered) {
    ordered = file.async('text').then(content => {
      const simple = parseOpenXml(content, decodeCharacterReferences);
      if (simple) return simple;
      // Ordinary OpenXML needs no general XML engine at startup.
      const fallback = () => import('fast-xml-parser').then(({ XMLParser }) => new XMLParser({
        preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: '',
        parseTagValue: false, trimValues: false, parseAttributeValue: false,
        // The runtime accepts a name map. An empty map enables numeric references only.
        htmlEntities: decodeCharacterReferences ? {} as unknown as boolean : false
      }));
      const parser = decodeCharacterReferences ? (reviewParser ??= fallback()) : (orderedParser ??= fallback());
      return parser.then(parser => parser.parse(content) as OrderedXmlNode);
    });
    cache.set(file, ordered);
  }
  return ordered;
}

export async function parseXmlFile(zip: PptxArchive, path: string): Promise<XmlNode | null> {
  const file = zip.file(path);
  if (!file) {
    return null;
  }

  let lookup = lookupCache.get(file);
  if (!lookup) {
    lookup = groupXmlNodes(await orderedXml(file));
    lookupCache.set(file, lookup);
  }
  return lookup;
}

export async function parseXmlFileOrdered(zip: PptxArchive, path: string, decodeCharacterReferences = false): Promise<OrderedXmlNode | null> {
  const file = zip.file(path);
  if (!file) {
    return null;
  }

  return orderedXml(file, decodeCharacterReferences);
}

function groupXmlNodes(nodes: OrderedXmlNode): XmlNode {
  const result: XmlNode = {};
  let text: unknown;
  for (const node of nodes) {
    let tag: string | undefined;
    for (const key in node) {
      if (key !== ':@' && Object.prototype.hasOwnProperty.call(node, key)) { tag = key; break; }
    }
    if (!tag) continue;
    if (tag === '#text') {
      text = text === undefined ? node[tag] : String(text) + String(node[tag]);
      continue;
    }
    if (!Array.isArray(node[tag])) continue;
    const children = groupXmlNodes(node[tag] as OrderedXmlNode);
    const attributes = node[':@'] as XmlNode | undefined;
    let value: unknown = children;
    if (attributes) {
      for (const key in attributes) {
        if (Object.prototype.hasOwnProperty.call(attributes, key)) defineXmlProperty(children, key, attributes[key]);
      }
    } else {
      let count = 0;
      for (const key in children) {
        if (Object.prototype.hasOwnProperty.call(children, key) && ++count === 2) break;
      }
      if (count === 0) value = '';
      else if (count === 1 && children['#text'] !== undefined) value = children['#text'];
    }
    if (Object.prototype.hasOwnProperty.call(result, tag) && result[tag] !== undefined) {
      const existing = result[tag];
      if (Array.isArray(existing)) existing.push(value);
      else defineXmlProperty(result, tag, [existing, value]);
    } else defineXmlProperty(result, tag, value);
  }
  if (text !== undefined && (typeof text !== 'string' || text.length)) result['#text'] = text;
  return result;
}

function defineXmlProperty(target: XmlNode, key: string, value: unknown): void {
  if (key === '__proto__') Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
  else target[key] = value;
}
