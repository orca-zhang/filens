export function i32(value: number): number[];
export function i64(value: number | bigint): number[];
export function get32(pointer: number): number[];
export function set32(pointer: number, value: number | number[]): number[];
export function call(name: string, args: Array<number | bigint | number[]>, storeAt?: number): number[];
export function open(pointer: number, name: string, fdPointer?: number, flags?: number, append?: number, errnoPointer?: number): number[];
export function iov(pointer: number, length: number, at?: number): number[];
export function write(fdPointer?: number, count?: number, iovs?: number, writtenAt?: number): number[];
export function repeat(count: number, commands: number[][]): number[];
export function createWasiProgram(options?: {
  commands?: number[][];
  data?: Array<[number, string | Uint8Array | number[]]>;
  pages?: number;
}): Uint8Array<ArrayBuffer>;
export function createWasiWriteFixture(totalBytes: number, blockBytes: number): {
  pattern: Uint8Array<ArrayBuffer>;
  wasm: Uint8Array<ArrayBuffer>;
};
