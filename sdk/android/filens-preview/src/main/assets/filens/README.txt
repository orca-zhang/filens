Generated assets go here. Repository build: npm run build:wasm, npm run build:wasm:mobile, then npm run build:sdk:mobile.
For a release SDK ZIP, run node prepare-runtime.mjs at the ZIP root before integration.
Distribute runtime assets, LICENSE and full THIRD-PARTY-NOTICES.txt.br together. JS/WASM and notices use streamed Brotli; strong decompression runs only on the developer computer.
