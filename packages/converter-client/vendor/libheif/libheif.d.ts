export default function createHeif(options: {
  wasmBinary: Uint8Array;
  locateFile?: (name: string) => string;
}): Promise<import('../../src/heif-decoder').HeifModule>;
