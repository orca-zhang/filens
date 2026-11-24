# Image converter WASM

`dist/converter-image.wasm` is the optional image conversion artifact built by
`npm run build:wasm`. It is loaded only for image conversion routes.

The browser client accepts it through `createWasmConverterClient({ imageWasm })`.
