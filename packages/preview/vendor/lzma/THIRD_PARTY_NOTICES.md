# Third-party notices

The WebAssembly module contains the unchanged C LZMA and LZMA2 decoders by
Igor Pavlov from the official LZMA SDK / 7-Zip 26.05 source tree. These files
are explicitly placed in the public domain. See upstream.json for immutable
source revision and individual SHA-256 hashes, and licenses/LZMA-SDK.txt.

The JavaScript bridge and package tooling are MIT licensed. The generated
Emscripten runtime, musl allocator and compiler runtime retain their respective
licenses in licenses/. No encoder, archive parser, command-line program or
filesystem is included in the runtime package.
