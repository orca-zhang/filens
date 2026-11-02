// Only transport and lifecycle live here; the shared frontend owns all parsing.
let preview;
const requestId = new URL(location.href).searchParams.get('requestId');
function post(type, error) {
  const message = JSON.stringify({ type, requestId, ...(error ? { error: {
    code: typeof error.code === 'string' ? error.code : 'preview_failed',
    message: error.message || String(error)
  } } : {}) });
  if (window.webkit?.messageHandlers?.filens) window.webkit.messageHandlers.filens.postMessage(message);
  else window.filensNative?.postMessage(message);
}
function fail(error) {
  const element = document.querySelector('#error');
  element.hidden = false;
  element.textContent = error.message || String(error);
  post('error', error);
}
window.addEventListener('pagehide', () => { preview?.destroy(); preview = undefined; }, { once: true });
try {
  if (!requestId) throw new Error('Missing preview request ID');
  if (!window.WebAssembly || !window.Worker) throw new Error('This WebView needs WebAssembly and Web Worker support');
  const response = await fetch('./source.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('Cannot open preview source');
  const source = await response.json();
  if (source.requestId !== requestId) throw new Error('Preview session has expired');
  // Keep document URLs within this session, even if host metadata is malformed.
  const url = new URL(source.url, location.href);
  if (url.origin !== location.origin || !url.pathname.startsWith(new URL('.', location.href).pathname)) {
    throw new Error('Invalid preview source URL');
  }
  const { createPreview } = await import('./filens.js');
  preview = createPreview('#preview', {
    src: url.href, name: source.name, locale: source.locale, toolbar: source.toolbar !== false,
    onRendered: () => post('rendered'), onError: fail
  });
} catch (error) { fail(error); }
