// Worker-safe ZIP access without viewer initialization or CSS imports.
export { openZipArchive } from './parser/zip';
export { openUnencryptedZipArchive } from './parser/zip-reader';
export type { ZipEntry, ZipArchiveOptions } from './parser/zip';
