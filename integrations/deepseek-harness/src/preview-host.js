import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { runtime } from './runtime-manifest.js';

export const name = 'filens-preview';
export const inject = ['webServer'];

const types = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8' };

/** Only built, enumerated runtime resources are exposed. This route never accepts document paths. */
export function runtimeResource(request) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
  if (!pathname.startsWith(runtime.basePath)) return new Response(null, { status: 404 });
  const file = pathname.slice(runtime.basePath.length);
  if (!Object.hasOwn(runtime.files, file)) return new Response(null, { status: 404 });
  const entry = runtime.files[file];
  const headers = {
    'Content-Type': types[file.slice(file.lastIndexOf('.'))] ?? 'application/octet-stream',
    'Content-Length': String(entry.bytes),
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    // The published iWork Emscripten glue uses Function(), so its isolated
    // viewer needs unsafe-eval as well as WASM. External code/network is denied.
    'Content-Security-Policy': "default-src 'none'; script-src 'self' blob: 'unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data: blob:; connect-src 'self' data: blob:; frame-src 'self' data: blob:; base-uri 'none'; form-action 'none'",
  };
  if (request.method === 'HEAD') return new Response(null, { headers });
  const stream = createReadStream(fileURLToPath(new URL(`./runtime/${file}`, import.meta.url)));
  const abort = () => stream.destroy();
  request.signal.addEventListener('abort', abort, { once: true });
  stream.once('close', () => request.signal.removeEventListener('abort', abort));
  if (request.signal.aborted) stream.destroy();
  return new Response(Readable.toWeb(stream), { headers });
}

export function apply(ctx) {
  // rc.5 and alpha.3 share this Node handler contract; only alpha.3 also has
  // the newer resource handler contract.
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: runtime.basePath.slice(0, -1), async handler(req, res) {
    const controller = new AbortController();
    const close = () => { if (!res.writableFinished) controller.abort(); };
    res.once('close', close);
    try {
      const response = runtimeResource(new Request(new URL(req.url, ctx.webServer.getOrigin()), { method: req.method, signal: controller.signal }));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) await pipeline(Readable.fromWeb(response.body), res);
      else res.end();
    } finally { res.removeListener('close', close); }
  } }));
  ctx.on('webserver/index-inject', table => {
    table.push({ kind: 'global', name: '__FILENS_DSH_PREVIEW_ORIGIN__', value: ctx.webServer.getOrigin() });
  });
}
