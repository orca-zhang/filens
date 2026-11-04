/** Translate tool arguments into the existing CLI protocol; no format parsing lives here. */
export function positiveInteger(value, fallback, maximum, name) {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1 || result > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}`);
  }
  return result;
}

function text(value, name, maximum = 4096) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || Buffer.byteLength(value) > maximum) {
    throw new Error(`${name} must be a non-empty string of at most ${maximum} UTF-8 bytes without NUL`);
  }
  return value;
}

export function makeRequest(operation, args, config) {
  const request = { op: operation, format: 'json' };
  if (operation === 'capabilities') {
    if (args.from !== undefined) request.sourceFormat = text(args.from, 'from', 32);
    if (args.to !== undefined) request.targetFormat = text(args.to, 'to', 32);
    if (args.section !== undefined) request.section = text(args.section, 'section');
    if (args.fields !== undefined) request.fields = text(args.fields, 'fields');
    if (args.op !== undefined) request.forOp = text(args.op, 'op', 64);
    if (args.query !== undefined) request.query = text(args.query, 'query');
    request.full = args.full ?? false;
    return request;
  }
  if (['read', 'search', 'excerpt'].includes(operation)) {
    // Select a default policy from the path hint; all file inspection stays in WASM.
    const office = /\.(?:pptx|pptm|ppsx|ppsm|potx|potm|docx|docm|dotx|dotm|xlsx|xlsm|xltx|xltm)$/i.test(args.path ?? '');
    const defaultOcr = office || (operation === 'read' && args.images === true) ? 'never' : 'auto';
    request.ocr = !config.ocr || args.ocr === false ? 'never' : args.ocr === true ? 'auto' : args.ocr ?? defaultOcr;
    if (!['auto','never','always'].includes(request.ocr)) throw new Error('ocr must be auto, never or always');
    if (args.ocr_min_confidence !== undefined) {
      if (typeof args.ocr_min_confidence !== 'number' || !Number.isFinite(args.ocr_min_confidence) || args.ocr_min_confidence < 0 || args.ocr_min_confidence > 1) throw new Error('ocr_min_confidence must be between 0 and 1');
      request.ocrMinConfidence = args.ocr_min_confidence;
    }
  }
  if (operation === 'read') {
    if (args.images !== undefined && typeof args.images !== 'boolean') throw new Error('images must be boolean');
    request.images = args.images ?? false;
    if (args.max_images !== undefined || args.image_names !== undefined) {
      if (!request.images) throw new Error('max_images/image_names require images=true');
    }
    if (request.images) request.maxImages = positiveInteger(args.max_images, 4, 16, 'max_images');
    if (args.image_names !== undefined) {
      if (!Array.isArray(args.image_names) || args.image_names.length > 16) throw new Error('image_names accepts at most 16 names');
      request.imageNames = args.image_names.map(v => text(v, 'image_names'));
    }
  }
  if (['read','excerpt'].includes(operation)) {
    if (args.slides !== undefined) request.slides=text(args.slides,'slides');
    if (args.pages !== undefined) request.pages=text(args.pages,'pages');
    if (args.media !== undefined) request.media=args.media;
  }
  request.input = text(args.path, 'path', 32768);
  request.maxBytes = positiveInteger(args.max_bytes, config.maxBytes, config.maxBytes, 'max_bytes');
  if (operation === 'read') request.layout = args.layout ?? false;
  if (['search','duplicates','similar-images'].includes(operation)) {
    if (operation === 'search') request.query = text(args.query, 'query');
    request.maxResults = positiveInteger(args.max_results, operation === 'search' ? 5 : 20, operation === 'search' ? 100 : 1000, 'max_results');
    request.maxFiles = positiveInteger(args.max_files, 1000, 10000, 'max_files');
    request.maxDepth = positiveInteger(args.max_depth, 8, 32, 'max_depth');
    request.includeHidden = args.include_hidden ?? false;
    if (operation === 'search') request.cache = false;
    if (operation === 'similar-images' && args.threshold !== undefined) {
      if (!Number.isInteger(args.threshold) || args.threshold < 0 || args.threshold > 24) throw new Error('threshold must be an integer between 0 and 24');
      request.threshold = args.threshold;
    }
  }
  if (operation === 'excerpt') {
    request.query = args.query === undefined ? '' : text(args.query, 'query');
    request.summaryRatio = 1;
    request.summaryChars = positiveInteger(args.max_chars, 2000, 20000, 'max_chars');
  }
  if (operation === 'convert') {
    request.output = text(args.output, 'output', 32768);
    if (args.target !== undefined) request.targetFormat = text(args.target, 'target', 32);
  }
  return request;
}

/** Every argv item is quoted independently; document paths and queries go over stdin. */
export function shellQuote(value) {
  if (typeof value !== 'string' || !value || value.includes('\0')) throw new Error('Invalid executable argument');
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function parseResult(run) {
  if (run.aborted) throw new DOMException('FiLens tool call cancelled', 'AbortError');
  if (run.timedOut) throw new Error(`FiLens exceeded the ${run.timeoutMs} ms execution deadline`);
  if (run.sandbox?.denied || run.sandbox?.runnerFailed) {
    throw new Error(`FiLens execution refused by the ${run.sandbox.mode} sandbox: ${run.stderr.text}`);
  }
  if (run.stdout.truncated) throw new Error('FiLens JSON exceeded the output limit; request fewer bytes or results');
  let response;
  try { response = JSON.parse(run.stdout.text); }
  catch { throw new Error(`FiLens returned invalid JSON (exit ${run.exitCode}): ${run.stderr.text.slice(0, 2000)}`); }
  if (!response || typeof response !== 'object' || Array.isArray(response) || typeof response.ok !== 'boolean') {
    throw new Error('FiLens returned an invalid response envelope');
  }
  if (![0, 1, 2, 3].includes(run.exitCode)) throw new Error(`FiLens process exited unexpectedly: ${run.exitCode}`);
  return { exit_code: run.exitCode, response };
}

/** Compact model projection; canonical JSON is unchanged and available via detail=full. */
export function renderResult(value, limit, { full = false, sections = false } = {}) {
  const result = full ? JSON.stringify(value) : compactResult(value, sections);
  const blocks = [{ type: 'text', text: result.length <= limit ? result
    : `${result.slice(0, limit)}\n[Truncated at ${limit} characters; canonical JSON retains all data. Narrow the query or request less content.]` }];
  for (const image of value.response.content?.images ?? []) {
    if (!image.attachment) continue;
    blocks.push({ type: 'text', text: `image=${JSON.stringify({ name: image.name, usedBy: image.usedBy, sourceSha256: image.sourceSha256 })}` });
    blocks.push({ type: 'image', attachment: image.attachment });
  }
  return blocks;
}

function table(name, rows) {
  if (!rows.length) return `${name}=[]`;
  const columns = [...new Set(rows.flatMap(row => Object.keys(row)))].filter(key => rows.some(row => row[key] !== undefined && row[key] !== null));
  // JSON cells keep tabs/newlines, delimiters and document text unambiguous.
  return `${name}\n${columns.join('\t')}\n${rows.map(row => columns.map(key => JSON.stringify(row[key] ?? null)).join('\t')).join('\n')}`;
}

function capacityText(capacity, sections) {
  const lines = [];
  for (const [key, data] of Object.entries(capacity)) {
    if (!sections && ['description', 'outputFormats'].includes(key)) continue;
    if (key === 'operations' && Array.isArray(data)) {
      if (!data.length) lines.push('operations=[]');
      for (const op of data) {
        const args = [...(op.parameters?.required ?? []), ...(op.parameters?.optional ?? []).map(v => `${v}?`)];
        lines.push(`${op.name}(${args.join(',')})${op.aliases?.length ? ` aliases=${op.aliases.join(',')}` : ''}`);
      }
    } else if (key === 'conversionPairs' && Array.isArray(data)) {
      const sources = new Map();
      for (const pair of data) {
        if (pair.sourceFormat === pair.targetFormat) continue;
        if (!sources.has(pair.sourceFormat)) sources.set(pair.sourceFormat, new Set());
        sources.get(pair.sourceFormat).add(pair.targetFormat);
      }
      if (!sources.size) lines.push('conversionPairs=[]');
      else lines.push([...sources].sort(([a], [b]) => a.localeCompare(b)).map(([source, targets]) => `${source}>${[...targets].sort().join(',')}`).join(';'));
    } else if (key === 'formats' && Array.isArray(data)) lines.push(table('formats', data));
    else if (!sections && key === 'ocr') lines.push(`ocr=${JSON.stringify(Object.fromEntries(['enabled','available','error'].filter(k => data[k] !== undefined).map(k => [k,data[k]])))}`);
    else if (!sections && key === 'execution') lines.push(`workspace=${data.workspace} diskSpill=${data.diskSpill}`);
    else if (!sections && key === 'details') lines.push('more: op/query/from/to/section; detail=full');
    else if (data && Object.keys(data).length === 1 && typeof data.count === 'number') lines.push(`${key}=${data.count}`);
    else lines.push(`${key}=${JSON.stringify(data)}`);
  }
  return lines.join('\n');
}

function compactMetadata(value) {
  if (Array.isArray(value)) return value.map(compactMetadata);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).flatMap(([key, child]) => {
    const data = compactMetadata(child);
    if (key !== 'confidence' && (data === null || data === undefined || (Array.isArray(data) && !data.length) || (data && typeof data === 'object' && !Object.keys(data).length))) return [];
    return [[key, data]];
  }));
}

function searchMetadata(metadata) {
  const { version, chunks, ...result } = metadata;
  if (result.scope?.extensions) {
    const { extensions, ...scope } = result.scope;
    result.scope = { ...scope, extensionCount: extensions.length };
  }
  if (result.scan) {
    const { backend, discoveryMs, execution, cache, textBytes, ...scan } = result.scan;
    // Preserve cache failures if a future runtime starts reporting them.
    if (cache?.errors || cache?.enabled) scan.cache = cache;
    result.scan = scan;
  }
  return compactMetadata(result);
}

function compactResult(value, sections) {
  const r = value.response, c = r.content;
  const lines = [`ok=${r.ok} exit=${value.exit_code}${r.op ? ` op=${r.op}` : ''}`];
  if (typeof c?.complete === 'boolean') lines.push(`complete=${c.complete} truncated=${c.truncated}${c.textScope ? ` textScope=${c.textScope}` : ''}`);
  if (r.error) lines.push(`error=${JSON.stringify(r.error)}`);
  // Diagnostics precede large text/media tables so display limits cannot hide them.
  const warnings = [...new Set([...(r.warnings ?? []), ...(c?.warnings ?? []), ...(c?.layout?.warnings ?? [])])];
  lines.push(`warnings=${JSON.stringify(warnings)}`);
  if (r.source) lines.push(`source=${JSON.stringify(r.source)}`);
  if (r.capacity) lines.push(capacityText(r.capacity, sections));
  if (r.search || r.similarity) {
    // Their content.text/rendered repeats the same results for other serializers.
    for (const key of ['search', 'similarity']) if (r[key]) {
      const { results, groups, ...metadata } = r[key];
      lines.push(`${key}=${JSON.stringify(key === 'search' ? searchMetadata(metadata) : compactMetadata(metadata))}`);
      if (results) lines.push(table('results', results.map(compactMetadata)));
      if (groups) lines.push(table('groups', groups.map(compactMetadata)));
    }
  } else if (c) {
    if (c.ocr) {
      const { note, results = [], ...ocr } = c.ocr;
      lines.push(`ocr=${JSON.stringify({ ...ocr, ...(results.length ? { counts: results.reduce((counts, v) => { counts[v.status] = (counts[v.status] ?? 0) + 1; return counts; }, {}) } : {}) })}`);
      const issues = results.filter(v => v.status === 'partial' || v.status === 'failed');
      if (issues.length) lines.push(table('ocrResults', issues));
    }
    if (c.imagesInfo) lines.push(`images=${JSON.stringify(c.imagesInfo)}`);
    for (const image of c.images ?? []) if (image.status === 'failed') lines.push(`imageError=${JSON.stringify(image)}`);
    if (c.summary) lines.push(`summary=${JSON.stringify(c.summary)}`);
    if (c.document?.blocks?.length) {
      const text = Buffer.from(c.text ?? '');
      lines.push(table('blocks (bytes/lines refer to content.text)', c.document.blocks.map(block => {
        const { startByte, endByte, startLine, endLine, ...origin } = block;
        return { ...origin, bytes: `${startByte}:${endByte}`, lines: `${startLine}:${endLine}`, text: text.subarray(startByte, endByte).toString() };
      })));
    } else if (typeof c.text === 'string') lines.push(`text=${JSON.stringify(c.text)}`);
    if (c.pages?.length) lines.push(table('pages', c.pages));
    if (c.media) { lines.push(`mediaScope=${JSON.stringify(c.mediaScope)}`); lines.push(table('media', c.media)); }
    if (c.layout) lines.push(`layout=${JSON.stringify(c.layout)}`);
  }
  for (const key of ['output','conversion']) if (r[key]) lines.push(`${key}=${JSON.stringify(r[key])}`);
  return lines.join('\n');
}
