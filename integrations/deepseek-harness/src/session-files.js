// Session metadata only. Document bytes are read lazily by the shared viewer.
const basename = path => path.replace(/\\/g, '/').split('/').at(-1);
const textOf = content => (Array.isArray(content) ? content : []).filter(block => block.type === 'text').map(block => block.text).join('\n');
const keyOf = (kind, id) => `${kind.length}:${kind}${id}`;

// Match recognizable artifacts, not whole temporary directories: generated
// documents in /tmp and macOS T directories can be the user's actual results.
export function isTemporaryFile(entry) {
  const path = (entry.path ?? entry.name ?? entry.file?.name ?? '').replace(/\\/g, '/');
  const name = basename(path);
  return /^(?:~\$|\._|\.~lock\.)|^(?:\.DS_Store|Thumbs\.db|desktop\.ini)$|(?:\.(?:tmp|temp|swp|swo|swx|bak|orig|rej)|~)$/i.test(name)
    || /(?:^|\/)(?:__MACOSX|\.Trash(?:es)?|\$RECYCLE\.BIN)(?:\/|$)/i.test(path);
}

export function sessionTitle(session, records = []) {
  const title = session.projections?.values?.title;
  const events = records.map(record => record.event ?? record).sort((a, b) => a.seq - b.seq);
  const logged = events.filter(event => event.type === 'session/title').at(-1)?.data?.title;
  const prompt = events.find(event => event.type === 'user/message' && event.data?.source?.kind === 'user');
  return [typeof title === 'string' ? title : title?.title, logged, session.title, textOf(prompt?.data?.content)]
    .find(value => typeof value === 'string' && value.trim())?.replace(/\s+/g, ' ').trim() || '未命名会话';
}

export function shortSessionTitle(title) {
  const characters = Array.from(title);
  return characters.length > 12 ? characters.slice(0, 12).join('') + '…' : title;
}

export function resolveFilePath(value, cwd = '') {
  if (typeof value !== 'string' || !value.trim() || /[\r\n\0]/.test(value)) return null;
  let path = value.trim();
  if (path.startsWith('file://')) {
    try { path = decodeURIComponent(new URL(path).pathname); } catch { return null; }
  } else if (/^[a-z][\w+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path)) return null;
  if (/[?#]/.test(path) || /^~(?:[^/\\]*[/\\]|$)/.test(path)) return null;
  path = path.replace(/\\/g, '/');
  if (!path.startsWith('/') && !/^[a-z]:\//i.test(path)) {
    if (!cwd) return null;
    path = `${cwd.replace(/\\/g, '/')}/${path}`;
  }
  const prefix = path.startsWith('/') ? '/' : '';
  const parts = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (parts.length) parts.pop(); }
    else parts.push(part);
  }
  return prefix + parts.join('/');
}

export function extractSessionFiles(records, session, extensions) {
  const supported = new Set(extensions);
  const files = new Map();
  let question = null;
  const events = records.map(record => record.event ?? record).sort((a, b) => a.seq - b.seq);
  const title = sessionTitle(session, events);
  for (const event of events) {
    const data = event.data;
    if (!data || !Number.isSafeInteger(event.seq)) continue;
    const kind = event.type === 'user/message' && data.source?.kind === 'user' ? 'question'
      : event.type === 'assistant/message' ? 'answer' : /^tool\/(call|result)$/.test(event.type) ? 'tool' : null;
    if (!kind) continue;
    const content = data.content ?? data.message?.content;
    const text = textOf(content);
    const nodeKey = kind === 'question' ? keyOf('input-message', data.id)
      : kind === 'answer' ? keyOf('assistant-step', `${data.turn}:${data.step}`)
      : keyOf('tool-call', data.callId ?? data.message?.source?.callId);
    const origin = { sessionId: session.sessionId, sessionTitle: title, seq: event.seq, time: event.time,
      kind, nodeKey, turn: data.turn, excerpt: text.replace(/\s+/g, ' ').slice(0, 180) };
    if (kind === 'question') question = { ...origin };
    else if (question) origin.question = question;
    function add(descriptor) {
      const id = descriptor.attachment ? `attachment:${descriptor.attachment.attachmentId}` : `path:${descriptor.path}`;
      let entry = files.get(id);
      if (!entry) files.set(id, entry = { id, ...descriptor, origins: [] });
      if (!entry.origins.some(source => source.seq === origin.seq)) entry.origins.push(origin);
    }
    function addPath(value) {
      const path = resolveFilePath(value, session.cwd);
      if (path && /^\.[\w-]+$/.test(basename(path)) && !/^\.(env|gitignore|gitattributes|gitmodules|editorconfig|npmrc|yarnrc|dockerignore)$/.test(basename(path))) return;
      if (path && supported.has(basename(path).split('.').at(-1)?.toLowerCase())) add({ name: basename(path), path });
    }
    for (const block of Array.isArray(content) ? content : []) {
      if ((block.type === 'image' || block.type === 'file') && typeof block.attachment?.attachmentId === 'string') {
        const attachment = block.attachment;
        const extension = attachment.mediaType?.split('/').at(-1)?.replace('jpeg', 'jpg') || 'bin';
        add({ name: attachment.name || `image-${attachment.attachmentId.slice(0, 8)}.${extension}`, size: attachment.bytes,
          attachment, attachmentKind: block.type });
      }
    }
    // Explicit links, inline file references and absolute paths. Prose alone
    // cannot prove a file exists; unreadable references remain visible as such.
    for (const match of text.matchAll(/\[[^\]\n]*\]\(<?([^\n)>]+)>?\)/g)) {
      const target = match[1].replace(/\s+["'][\s\S]*$/, '');
      try { addPath(decodeURIComponent(target.replace(/\\([ ()])/g, '$1'))); } catch { /* Invalid URL encoding is not a file reference. */ }
    }
    for (const match of text.matchAll(/`([^`\n]+)`/g)) addPath(match[1]);
    for (const match of text.matchAll(/(?:^|[\s("'])(\/(?:[^\s<>"'`),;]+)|[a-z]:[\\/][^\s<>"'`),;]+)/gim)) addPath(match[1].replace(/[.，。；]$/, ''));
    function visit(value, key = '', depth = 0) {
      if (depth > 12 || value == null) return;
      if (typeof value === 'string' && /^(path|file_path|filePath|filename|output|input|source|destination|target|cwd)$/.test(key)) addPath(value);
      else if (Array.isArray(value)) for (const item of value) visit(item, key, depth + 1);
      else if (typeof value === 'object') for (const [name, item] of Object.entries(value)) visit(item, name, depth + 1);
    }
    if (kind === 'tool') {
      visit(data);
      for (const value of [data.arguments, ...((Array.isArray(content) ? content : []).filter(block => block.type === 'text').map(block => block.text))]) {
        if (typeof value !== 'string') continue;
        try { visit(JSON.parse(value)); } catch { /* Tool output need not be JSON. */ }
      }
    }
  }
  return [...files.values()];
}

export function mergeSessionFiles(collections) {
  const merged = new Map();
  for (const entry of collections.flat()) {
    const previous = merged.get(entry.id);
    if (previous) {
      for (const origin of entry.origins) if (!previous.origins.some(source => source.sessionId === origin.sessionId && source.seq === origin.seq)) previous.origins.push(origin);
    } else merged.set(entry.id, { ...entry, origins: [...entry.origins] });
  }
  return [...merged.values()];
}

export function remoteValue(result) {
  if (!result.ok) throw new Error(result.error?.message || result.message || 'DSH request failed');
  return result.value;
}

export async function collectSessionFiles(remote, extensions, signal, progress) {
  const sessions = remoteValue(await remote.session.list({}, signal)).items;
  const collections = [], errors = [];
  let done = 0;
  progress({ done, total: sessions.length, errors: [], files: [] });
  for (const session of sessions) {
    signal.throwIfAborted();
    try {
      const records = [];
      let beforeSeq, throughSeq, page;
      // rc.5 requires a fixed cut for page(); follow's opening snapshot
      // provides that cut without retaining a live history subscription.
      const opening = new AbortController();
      try {
        for await (const frame of remote.session.follow({ address: { kind: 'session', sessionId: session.sessionId }, maxMessages: 500 }, AbortSignal.any([signal, opening.signal]))) {
          if (frame.type !== 'snapshot') continue;
          page = frame;
          throughSeq = frame.cursor;
          break;
        }
      } finally { opening.abort(); }
      if (!page) throw new Error('DSH did not return a history snapshot');
      do {
        records.push(...page.records);
        const seqs = page.records.map(record => (record.event ?? record).seq);
        if (!page.hasMore) break;
        const next = Math.min(...seqs);
        if (!Number.isSafeInteger(next) || (beforeSeq !== undefined && next >= beforeSeq)) throw new Error('History cursor did not advance');
        beforeSeq = next;
        page = remoteValue(await remote.session.page({ address: { kind: 'session', sessionId: session.sessionId }, maxMessages: 500, beforeSeq, throughSeq }, signal));
      } while (true);
      collections.push(extractSessionFiles(records, session, extensions));
    } catch (error) {
      signal.throwIfAborted();
      errors.push({ sessionId: session.sessionId, title: sessionTitle(session), message: error.message });
    }
    progress({ done: ++done, total: sessions.length, errors: [...errors], files: mergeSessionFiles(collections) });
  }
}
