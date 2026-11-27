import { emuToPx, throwIfAborted, type SlideComment, type SlideCommentAnchor, type SlideCommentAuthor, type SlideCommentMessage,
  type SlideCommentReaction, type SlideCommentTask, type SlideCommentTaskEvent } from '@filens/core/presentation-support';
import type { PptxArchive } from './archive';
import { childElements, children, element, parseXmlFileOrdered, type OrderedXmlNode, type XmlElement, type XmlNode } from './xml';

const officeRelationships = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const strictRelationships = 'http://purl.oclc.org/ooxml/officeDocument/relationships';
const modernRelationships = 'http://schemas.microsoft.com/office/2018/10/relationships';
const modernNamespace = 'http://schemas.microsoft.com/office/powerpoint/2018/8/main';
const reactionNamespace = 'http://schemas.microsoft.com/office/powerpoint/2022/03/main';
const taskNamespace = 'http://schemas.microsoft.com/office/powerpoint/2022/08/main';
const legacyNamespaces = [
  'http://schemas.openxmlformats.org/presentationml/2006/main',
  'http://purl.oclc.org/ooxml/presentationml/main'
];
const drawingNamespaces = [
  'http://schemas.openxmlformats.org/drawingml/2006/main',
  'http://purl.oclc.org/ooxml/drawingml/main'
];
const threadingNamespace = 'http://schemas.microsoft.com/office/powerpoint/2012/main';
const drawingMonikers = 'http://schemas.microsoft.com/office/drawing/2013/main/command';
const slideMonikers = 'http://schemas.microsoft.com/office/powerpoint/2013/main/command';
const drawingMonikerNames = new Set(['spMk', 'grpSpMk', 'picMk', 'cxnSpMk', 'graphicFrameMk', 'inkMk']);

type ReviewFormat = 'legacy' | 'modern';
type Relationship = { id: string; type: string; target: string };

export function createSlideCommentReader(zip: PptxArchive, presentationRels: Relationship[], signal?: AbortSignal) {
  const authors = new Map<ReviewFormat, Promise<Map<string, SlideCommentAuthor>>>();
  const getAuthors = (format: ReviewFormat, warnings: string[]) => {
    let cached = authors.get(format);
    if (!cached) {
      const type = format === 'modern' ? 'authors' : 'commentAuthors';
      const relation = presentationRels.find(rel => relationshipFormat(rel.type, type) === format);
      cached = relation ? parseXmlFileOrdered(zip, relation.target, format === 'modern').then(entries => {
        const root = reviewPart(entries, format, 'authorLst', 'cmAuthorLst');
        if (!root) throw new Error('Invalid comment author part');
        const map = new Map<string, SlideCommentAuthor>();
        for (const element of children(root, format === 'modern' ? 'author' : 'cmAuthor')) {
          const original = string(element.attributes.id);
          const id = format === 'legacy' ? unsigned(original) : original;
          if (id) map.set(id.toLowerCase(), {
            id, name: string(element.attributes.name), initials: string(element.attributes.initials)
          });
        }
        return map;
      }).catch(error => {
        propagateAbort(signal, error);
        warnings.push(`Unable to read ${format} PowerPoint comment authors.`);
        return new Map();
      }) : Promise.resolve(new Map());
      authors.set(format, cached);
    }
    return cached;
  };

  return async (
    slideRels: Relationship[], slideXml: OrderedXmlNode | null, slidePath: string, warnings: string[]
  ): Promise<SlideComment[]> => {
    const commentRels = slideRels.flatMap(rel => {
      const format = relationshipFormat(rel.type, 'comments');
      return format ? [{ ...rel, format }] : [];
    });
    if (commentRels.length === 0) return [];
    const modernIds = commentRelationshipIds(slideXml);
    const parts = new Set<string>();
    const groups = await Promise.all(commentRels.map(async ({ id, target, format }) => {
      if ((format === 'modern' && modernIds.size && !modernIds.has(id)) || parts.has(target)) return [];
      parts.add(target);
      try {
        const root = reviewPart(await parseXmlFileOrdered(zip, target, format === 'modern'), format, 'cmLst', 'cmLst');
        if (!root) throw new Error('Invalid comment part');
        const comments = children(root, 'cm');
        if (!comments.length) return [];
        const byId = await getAuthors(format, warnings);
        return format === 'modern' ? modernComments(comments, byId, target) : legacyComments(comments, byId, target);
      } catch (error) {
        propagateAbort(signal, error);
        warnings.push(`Unable to read ${format} PowerPoint comments for ${slidePath}.`);
        return [];
      }
    }));
    return groups.flat();
  };
}

function relationshipFormat(type: string, name: 'comments' | 'authors' | 'commentAuthors'): ReviewFormat | undefined {
  if (name !== 'commentAuthors' && type === `${modernRelationships}/${name}`) return 'modern';
  if (name !== 'authors' && [officeRelationships, strictRelationships].some(base => type === `${base}/${name}`)) return 'legacy';
}

function propagateAbort(signal: AbortSignal | undefined, error: unknown): void {
  throwIfAborted(signal);
  if (error instanceof Error && error.name === 'AbortError') throw error;
}

function reviewPart(entries: OrderedXmlNode | null, format: ReviewFormat, modernRoot: string, legacyRoot: string) {
  for (const entry of entries ?? []) {
    const root = element(entry);
    if (format === 'modern' ? root?.name === modernRoot && root.namespace === modernNamespace
      : root?.name === legacyRoot && legacyNamespaces.some(namespace => namespace === root.namespace)) return root;
  }
}

function commentRelationshipIds(slide: OrderedXmlNode | null): Set<string> {
  const ids = new Set<string>();
  const root = reviewPart(slide, 'legacy', 'sld', 'sld');
  if (!root) return ids;
  const pending = children(root, 'extLst');
  while (pending.length) {
    const current = pending.pop()!;
    if (current.namespace === modernNamespace && current.name === 'commentRel') {
      for (const [attribute, value] of Object.entries(current.attributes)) {
        const colon = attribute.indexOf(':');
        const namespace = current.bindings.get(attribute.slice(0, colon));
        const id = string(value);
        if (colon >= 0 && attribute.slice(colon + 1) === 'id' && id
          && (namespace === officeRelationships || namespace === strictRelationships)) ids.add(id);
      }
    } else {
      for (const child of childElements(current)) pending.push(child);
    }
  }
  return ids;
}

function plainText(element: XmlElement): string {
  return element.entries.map(entry => typeof entry['#text'] === 'string' ? entry['#text'] : '').join('');
}

function commentText(parent: XmlElement): string {
  const body = children(parent, 'txBody')[0];
  if (!body) return '';
  return children(body, 'p', drawingNamespaces).map(paragraph => childElements(paragraph).map(run => {
    if (!drawingNamespaces.some(namespace => namespace === run.namespace)) return '';
    if (run.name === 'br') return '\n';
    return run.name === 'r' || run.name === 'fld' ? children(run, 't').map(plainText).join('') : '';
  }).join('')).join('\n');
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() || undefined : undefined;
}

function unsigned(value: unknown): string | undefined {
  const text = string(value);
  return text && /^\+?\d+$/.test(text) && Number(text) <= 0xffff_ffff ? String(Number(text)) : undefined;
}

function author(id: string | undefined, byId: Map<string, SlideCommentAuthor>): SlideCommentAuthor | undefined {
  return id ? byId.get(id.toLowerCase()) ?? { id } : undefined;
}

function timestamp(value: unknown, bias?: unknown): string | undefined {
  const source = string(value);
  if (!source || !/^\d{4,}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)?$/.test(source)) return undefined;
  const zoned = /(?:Z|[+-]\d\d:\d\d)$/.test(source);
  const time = Date.parse(zoned ? source : source + 'Z');
  if (!Number.isFinite(time)) return undefined;
  const offset = Number(string(bias));
  return !zoned && Number.isInteger(offset) && Math.abs(offset) <= 1440
    ? new Date(time + offset * 60_000).toISOString() : source;
}

function position(comment: XmlElement, format: ReviewFormat): { x: number; y: number } | undefined {
  const point = children(comment, 'pos')[0]?.attributes;
  const x = Number(string(point?.x)), y = Number(string(point?.y));
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  // PowerPoint uses eighths of a point for legacy comments and EMUs for modern ones.
  return format === 'legacy' ? { x: x / 6, y: y / 6 } : { x: emuToPx(x), y: emuToPx(y) };
}

function percentage(value: unknown): number | undefined {
  const text = string(value);
  if (text === undefined) return undefined;
  const percent = Number(text.replace(/%$/, '')) / (text.endsWith('%') ? 1 : 1000);
  return percent >= 0 && percent <= 100 ? percent : undefined;
}

function modernReactions(extensions: XmlElement[], byId: Map<string, SlideCommentAuthor>): SlideCommentReaction[] {
  const groups = new Map<string, SlideCommentReaction>();
  for (const extension of extensions) {
    if (extension.name !== 'reactions' || extension.namespace !== reactionNamespace) continue;
    for (const reaction of children(extension, 'rxn')) {
      const type = string(reaction.attributes.type);
      if (!type) continue;
      for (const instance of children(reaction, 'instance')) {
        const reactor = author(string(instance.attributes.authorId), byId);
        if (!reactor) continue;
        let group = groups.get(type);
        if (!group) groups.set(type, group = { type, instances: [] });
        group.instances.push({ author: reactor, created: timestamp(instance.attributes.time) });
      }
    }
  }
  return [...groups.values()];
}

function taskEvent(event: XmlElement, byId: Map<string, SlideCommentAuthor>): SlideCommentTaskEvent | undefined {
  const id = string(event.attributes.id);
  if (!id) return undefined;
  const elements = childElements(event).filter(child => child.namespace === taskNamespace);
  const attribution = elements.find(child => child.name === 'atrbtn');
  const anchor = elements.find(child => child.name === 'anchr');
  const base = { id, created: timestamp(event.attributes.time), author: author(string(attribution?.attributes.authorId), byId),
    commentId: anchor && string(children(anchor, 'comment')[0]?.attributes.id) };
  const change = elements.find(child => !['atrbtn', 'anchr', 'extLst'].includes(child.name));
  const attrs = change?.attributes ?? {};
  switch (change?.name) {
    case 'add': return { ...base, kind: 'created' };
    case 'asgn': return { ...base, kind: 'assigned', assignee: author(string(attrs.authorId), byId) };
    case 'title': return { ...base, kind: 'title', title: typeof attrs.val === 'string' ? attrs.val : undefined };
    case 'date': return { ...base, kind: 'schedule', startDate: timestamp(attrs.stDt), dueDate: timestamp(attrs.endDt) };
    case 'pcntCmplt': return { ...base, kind: 'progress', complete: percentage(attrs.val) };
    case 'unasgnAll': return { ...base, kind: 'unassigned' };
    case 'undo': return { ...base, kind: 'undo', eventId: string(attrs.id) };
    default: return { ...base, kind: 'unknown' };
  }
}

function modernTask(attrs: XmlNode, extensions: XmlElement[], byId: Map<string, SlideCommentAuthor>): SlideCommentTask | undefined {
  const title = string(attrs.title);
  const assignedTo = string(attrs.assignedTo)?.split(/\s+/).map(id => author(id, byId)!);
  const startDate = timestamp(attrs.startDate);
  const dueDate = timestamp(attrs.dueDate);
  const complete = percentage(attrs.complete);
  const history: SlideCommentTaskEvent[] = [];
  for (const extension of extensions) {
    if (extension.name !== 'taskDetails' || extension.namespace !== taskNamespace) continue;
    for (const list of children(extension, 'history')) {
      for (const element of children(list, 'event')) {
        const event = taskEvent(element, byId);
        if (event) history.push(event);
      }
    }
  }
  if (title || assignedTo || startDate || dueDate || complete !== undefined || history.length) {
    return { title, assignedTo, startDate, dueDate, complete, ...(history.length ? { history } : {}) };
  }
}

function modernComments(comments: XmlElement[], byId: Map<string, SlideCommentAuthor>, part: string): SlideComment[] {
  const message = (element: XmlElement, fallback: string): SlideCommentMessage => {
    const attrs = element.attributes;
    const status = attrs.status === 'closed' || attrs.status === 'resolved' ? attrs.status : 'active';
    const extensions = children(element, 'extLst', [modernNamespace, ...legacyNamespaces])
      .flatMap(list => children(list, 'ext', legacyNamespaces)).flatMap(childElements);
    const reactions = modernReactions(extensions, byId);
    const task = modernTask(attrs, extensions, byId);
    return {
      id: string(attrs.id) ?? fallback, text: commentText(element), status,
      author: author(string(attrs.authorId), byId), created: timestamp(attrs.created),
      ...(reactions.length ? { reactions } : {}), ...(task ? { task } : {})
    };
  };
  const hasContent = (message: SlideCommentMessage) => message.text.trim() || message.reactions?.length || message.task;
  return comments.flatMap((comment, index) => {
    const note = message(comment, `${part}#${index}`);
    const elements = childElements(comment);
    const replyList = elements.find(child => child.name === 'replyLst' && child.namespace === modernNamespace);
    const replies = replyList ? children(replyList, 'reply').map((reply, i) => ({
      ...message(reply, `${note.id}#${i}`), replyTo: note.id
    })).filter(hasContent) : [];
    if (!hasContent(note) && !replies.length) return [];

    const positionOnFirstAnchor = position(comment, 'modern');
    const lists = (name: string, namespace: string) => elements.filter(child => child.name === name && child.namespace === namespace);
    const monikers = [...lists('txMkLst', drawingMonikers), ...lists('deMkLst', drawingMonikers), ...lists('sldMkLst', slideMonikers)];
    const [first, ...additionalAnchors] = monikers.map(parseCommentAnchor);
    return [{
      ...note, anchor: { ...(first ?? { kind: 'unknown' }), position: positionOnFirstAnchor },
      ...(additionalAnchors.length ? { additionalAnchors } : {}),
      ...(replies.length ? { replies } : {})
    }];
  });
}

function parseCommentAnchor(monikers: XmlElement): SlideCommentAnchor {
  const anchor: SlideCommentAnchor = { kind: monikers.name === 'txMkLst' ? 'text' : monikers.name === 'deMkLst' ? 'shape' : 'slide' };
  // A group path precedes the final drawing moniker in the same list.
  const entries = childElements(monikers);
  for (const [kind, tag] of [['slide', 'sldMk'], ['master', 'sldMasterMk'], ['layout', 'sldLayoutMk']] as const) {
    const attrs = entries.find(child => child.name === tag && child.namespace === slideMonikers)?.attributes;
    if (attrs) anchor[kind] = { id: unsigned(attrs.sldId), creationId: unsigned(attrs.cId) };
  }
  const drawing = entries.filter(child => child.namespace === drawingMonikers && drawingMonikerNames.has(child.name)).at(-1);
  const drawingId = unsigned(drawing?.attributes.id), creationId = string(drawing?.attributes.creationId)?.toLowerCase();
  if (drawingId || creationId) anchor.drawing = { id: drawingId, creationId };
  const range = anchor.kind === 'text' ? entries.find(child => child.name === 'txMk' && child.namespace === drawingMonikers) : undefined;
  const offset = unsigned(range?.attributes.cp);
  const length = range?.attributes.len === undefined ? '0' : unsigned(range.attributes.len);
  if (range && offset !== undefined && length !== undefined) {
    const context = children(range, 'context')[0]?.attributes;
    const contextLength = unsigned(context?.len), contextHash = unsigned(context?.hash);
    anchor.textRange = {
      offset: Number(offset), length: Number(length),
      ...(contextLength && contextLength !== '0' ? { contextLength: Number(contextLength) } : {}),
      ...(contextHash !== undefined ? { contextHash: Number(contextHash) } : {})
    };
  }
  return anchor;
}

function legacyIdentifier(attrs: XmlNode | undefined): string | undefined {
  const id = unsigned(attrs?.authorId), index = unsigned(attrs?.idx);
  return id !== undefined && index !== undefined ? `${id}:${index}` : undefined;
}

function legacyComments(comments: XmlElement[], authors: Map<string, SlideCommentAuthor>, part: string): SlideComment[] {
  const messages = comments.flatMap((comment, index): SlideComment[] => {
    const text = children(comment, 'text').map(plainText).join('');
    if (!text.trim()) return [];
    const extensions = children(comment, 'extLst')[0];
    const threading = extensions && children(extensions, 'ext').flatMap(ext => children(ext, 'threadingInfo', [threadingNamespace]))[0];
    const parent = threading && children(threading, 'parentCm')[0];
    return [{
      id: legacyIdentifier(comment.attributes) ?? `${part}#${index}`, text,
      author: author(unsigned(comment.attributes.authorId), authors),
      created: timestamp(comment.attributes.dt, threading?.attributes.timeZoneBias),
      replyTo: legacyIdentifier(parent?.attributes), anchor: { kind: 'slide', position: position(comment, 'legacy') }
    }];
  });
  const byId = new Map(messages.map(message => [message.id, message]));
  const roots = new Map<SlideComment, SlideComment | null>();
  const rootOf = (message: SlideComment): SlideComment => {
    const seen = new Set<SlideComment>();
    let current = message;
    while (!roots.has(current)) {
      if (seen.has(current)) {
        roots.set(current, null);
        break;
      }
      const parent = current.replyTo && byId.get(current.replyTo);
      if (!parent) {
        roots.set(current, current);
        break;
      }
      seen.add(current);
      current = parent;
    }
    const root = roots.get(current) ?? null;
    for (const child of seen) roots.set(child, root);
    return root ?? message;
  };

  const threads: SlideComment[] = [];
  for (const message of messages) {
    const root = rootOf(message);
    if (root === message) threads.push(message);
    else {
      const { anchor: _anchor, ...reply } = message;
      (root.replies ??= []).push(reply);
    }
  }
  return threads;
}
