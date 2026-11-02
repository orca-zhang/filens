import { gunzipSync } from 'fflate';

/** Embedded WASM uses gzip before base64; normal HTTP assets stay unchanged.
 * Native decompression feeds compilation without allocating a decoded string. */
export async function wasmResponse(response: Response): Promise<Response> {
  if (response.headers.get('content-type')?.split(';', 1)[0] !== 'application/wasm+gzip') return response;
  if (typeof DecompressionStream !== 'undefined' && response.body) {
    return new Response(response.body.pipeThrough(new DecompressionStream('gzip')), {
      headers: { 'content-type': 'application/wasm' }
    });
  }
  const bytes = gunzipSync(new Uint8Array(await response.arrayBuffer()));
  return new Response(bytes as Uint8Array<ArrayBuffer>, { headers: { 'content-type': 'application/wasm' } });
}
