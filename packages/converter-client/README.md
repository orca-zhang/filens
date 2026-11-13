# @filens/converter-client

Optional WASM, HTTP and mock conversion adapters for Filens. See the [project documentation](https://github.com/orca-zhang/filens) for conversion and preview APIs.

## CAD and raster engines

The browser bundle loads DWG and raster engines separately. Custom hosts can use
the same modules without downloading image decoders when opening a DWG:

```ts
import { createWasmConverterClient } from '@filens/converter-client';

const converter = createWasmConverterClient({
  wasm: '/wasm/converter-core.wasm',
  cadWasm: '/wasm/converter-cad.wasm',
  graphicsWasm: '/wasm/converter-raster.wasm'
});
```

DWG previews use the `cad-json` drawing model directly; explicit `dwg` → `dxf`
conversion is also supported. Existing hosts may continue supplying the combined
`converter-graphics.wasm` as `graphicsWasm` without `cadWasm`. The all-in-one bundle
uses a shared combined core and includes the CAD reader in its main JavaScript.

## Search with optional SIMD128

Build the shared production text core in both variants with `npm run build:search:wasm`.
Host `wasm/converter-core/dist/converter-text.wasm` and `converter-text-simd.wasm`,
then provide both URLs to the public runner:

```ts
import { createWasmCoreRunner } from '@filens/converter-client';

const runSearch = createWasmCoreRunner({
  wasm: '/wasm/converter-text.wasm',
  simdWasm: '/wasm/converter-text-simd.wasm',
  imports: {
    filens_text: {
      host_call: () => { throw new Error('search-text does not request extraction capabilities'); }
    }
  }
});
```

Invoke `search-text` with the usual corpus JSON and WASI arguments; a complete
example and schema are in the [SIMD search report](../../docs/batch-matching-round9-performance.zh-CN.md).
The runner loads SIMD when supported and uses scalar when SIMD is unsupported or
its asset fails to load or compile. Execution errors propagate without repeating
the operation. Each call owns its WASI files and instance; module loading is cached.
The text core's extraction capability import is unused by `search-text`.

`search-simd` accelerates ASCII normalization and word-boundary scanning. Unicode
normalization, term weights and scoring order are shared with scalar. Native CLI
search enables the same feature by default, using SSE2 on x86-64 and NEON on AArch64.
Its interpreter's bundled text WASM remains the portable variant.

## Content detection with optional SIMD128

The `@filens/converter-client/format-detector` entry provides standalone content detection using the shared Rust/WASM core. Its JavaScript and WASM files load separately from the conversion entry.

```ts
import { createAutoFormatDetector } from '@filens/converter-client/format-detector';

const detector = await createAutoFormatDetector();
const result = detector.detect(new Uint8Array(await file.arrayBuffer()));
console.log(result.format, result.container, result.evidence);
```

The factory checks SIMD128 support before loading either variant. On supported runtimes it loads only SIMD; otherwise it loads scalar. SIMD download, compilation or initialization failures also fall back to scalar. Errors during detection propagate to the caller. Providing only `scalar` skips feature detection. Loaders may return bytes or a precompiled `WebAssembly.Module`.

`detector.implementation` reports `scalar` or `simd128`; `memoryBytes` reports the current WASM memory size. Reuse one detector for sequential synchronous calls. Format evidence is a routing hint rather than validation of an entire file.

The package includes both WASM variants as separate files. Importing the entry does not download them; calling the factory downloads the selected variant. The package's build prepares both artifacts automatically.

For custom hosting, provide lazy loaders:

```ts
const loadWasm = (url: string) => async () => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`WASM download failed: ${response.status}`);
  return response.arrayBuffer();
};

const detector = await createAutoFormatDetector({
  scalar: loadWasm('/wasm/converter-detect-scalar.wasm'),
  simd: loadWasm('/wasm/converter-detect-simd.wasm')
});
```

From the Filens repository, build standalone assets with:

```sh
node scripts/build-format-detector.mjs --output public/wasm
```

Deploy the generated scalar/SIMD artifacts and notices at the URLs passed to the loaders. The build manifest records features, source hashes and artifact hashes. The default converter builds remain portable; optional detection does not change preview routing automatically.
