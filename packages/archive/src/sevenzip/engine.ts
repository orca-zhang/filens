/** The small Emscripten surface used by the read-only frontend engine. */
export interface SevenZipModuleOptions {
  locateFile?(url: string, directory: string): string;
  stdin?(): number;
  stdout?(value: number): void;
  stderr?(value: number): void;
  print?(message: string): void;
  printErr?(message: string): void;
  wasmBinary?: ArrayBuffer;
  instantiateWasm?(imports: WebAssembly.Imports, receive: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void): WebAssembly.Exports;
}

export interface SevenZipModule {
  FS: {
    mkdir(path: string): unknown;
    writeFile(path: string, data: Uint8Array): void;
  };
  callMain(args: string[]): void;
}

export type SevenZipModuleFactory = (options?: SevenZipModuleOptions) => Promise<SevenZipModule>;
