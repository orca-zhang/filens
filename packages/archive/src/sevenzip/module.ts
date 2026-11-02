const modules = new Map<string, Promise<WebAssembly.Module>>();

/** Cache code only. Each operation still owns its worker, FS and linear memory. */
export function loadArchiveModule(url: string): Promise<WebAssembly.Module> {
  const cached = modules.get(url);
  if (cached) return cached;
  const loading = fetch(url).then(async response => {
    if (!response.ok) throw new Error(`Unable to load the archive engine (${response.status}).`);
    const mime = response.headers.get('content-type')?.split(';', 1)[0];
    return typeof WebAssembly.compileStreaming === 'function' && mime === 'application/wasm'
      ? WebAssembly.compileStreaming(response)
      : WebAssembly.compile(await response.arrayBuffer());
  });
  modules.set(url, loading);
  void loading.catch(() => { if (modules.get(url) === loading) modules.delete(url); });
  return loading;
}
