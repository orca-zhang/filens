// Worker-safe ZIP access without viewer initialization or CSS imports.
export { openZipArchive, openUnencryptedZipArchive } from './parser/zip';
export type { ZipEntry, ZipArchiveOptions, ZipBlobSource } from './parser/zip';
export { PreviewPasswordError, previewPasswordErrorCode, type PreviewPasswordErrorCode } from './preview/password';
