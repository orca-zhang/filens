/// <reference types="vite/client" />

declare module 'libheif-js/libheif-wasm/libheif.js' {
  export default function createHeif(options: { wasmBinary: Uint8Array }): Promise<import('./heif-decoder').HeifModule>;
}
