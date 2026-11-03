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
  const request = { operation, format: 'json' };
  if (operation === 'capabilities') return request;
  request.input = text(args.path, 'path', 32768);
  request.maxBytes = positiveInteger(args.max_bytes, config.maxBytes, config.maxBytes, 'max_bytes');
  if (operation === 'read') request.layout = args.layout ?? false;
  if (operation === 'search') {
    request.query = text(args.query, 'query');
    request.maxResults = positiveInteger(args.max_results, 10, 100, 'max_results');
    request.maxFiles = positiveInteger(args.max_files, 1000, 10000, 'max_files');
    request.maxDepth = positiveInteger(args.max_depth, 8, 32, 'max_depth');
    request.includeHidden = args.include_hidden ?? false;
    request.cache = false;
  }
  if (operation === 'summarize') {
    request.query = args.query === undefined ? '' : text(args.query, 'query');
    request.summaryChars = positiveInteger(args.max_chars, 4000, 32000, 'max_chars');
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

export function renderResult(value, limit) {
  const json = JSON.stringify(value, null, 2);
  return [{ type: 'text', text: json.length <= limit ? json
    : `${json.slice(0, limit)}\n[Display truncated at ${limit} characters. The canonical tool value retains the full response. Request fewer bytes/results to read a smaller response.]` }];
}
