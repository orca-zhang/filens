import { createDefaultPreviewRoutes, type FormatDefinition } from '@filens/core/preview-runtime';

export const ARCHIVE_FORMAT_ROUTES: FormatDefinition[] = [
  {
    extensions: ['bz2', 'bzip2', 'tbz', 'tbz2'], family: 'archive', driverId: 'archive', targetFormat: 'bz2',
    contentTypes: ['application/x-bzip2', 'application/x-bzip-compressed-tar']
  },
  {
    extensions: ['xz', 'txz'], family: 'archive', driverId: 'archive', targetFormat: 'xz',
    contentTypes: ['application/x-xz', 'application/x-xz-compressed-tar']
  },
  {
    extensions: ['lzma', 'tlz'], family: 'archive', driverId: 'archive', targetFormat: 'lzma',
    contentTypes: ['application/x-lzma', 'application/x-lzma-compressed-tar']
  },
  {
    extensions: ['zst', 'zstd', 'tzst'], family: 'archive', driverId: 'archive', targetFormat: 'zstd',
    contentTypes: ['application/zstd']
  },
  {
    extensions: ['lzma86'], family: 'archive', driverId: 'archive', targetFormat: 'lzma86',
    contentTypes: ['application/x-lzma86']
  },
  {
    extensions: ['z', 'taz'], family: 'archive', driverId: 'archive', targetFormat: 'z',
    contentTypes: ['application/x-compress']
  },
  {
    extensions: ['lha', 'lzh'], family: 'archive', driverId: 'archive', targetFormat: 'lzh',
    contentTypes: ['application/x-lha', 'application/x-lzh-compressed']
  },
  {
    extensions: ['rpm'], family: 'archive', driverId: 'archive', targetFormat: 'rpm',
    contentTypes: ['application/x-rpm']
  },
  {
    extensions: ['xar'], family: 'archive', driverId: 'archive', targetFormat: 'xar',
    contentTypes: ['application/x-xar']
  },
  {
    extensions: ['wim', 'esd'], family: 'archive', driverId: 'archive', targetFormat: 'wim',
    contentTypes: ['application/x-ms-wim']
  },
  {
    extensions: ['udf'], family: 'archive', driverId: 'archive', targetFormat: 'udf',
    contentTypes: ['application/x-udf-image']
  },
  {
    extensions: ['ar'], family: 'archive', driverId: 'archive', targetFormat: 'ar',
    contentTypes: ['application/x-archive']
  },
  {
    extensions: ['deb'], family: 'archive', driverId: 'archive', targetFormat: 'ar',
    contentTypes: ['application/vnd.debian.binary-package', 'application/x-deb']
  },
  {
    extensions: ['cpio'], family: 'archive', driverId: 'archive', targetFormat: 'cpio',
    contentTypes: ['application/x-cpio']
  },
  {
    extensions: ['cab'], family: 'archive', driverId: 'archive', targetFormat: 'cab',
    contentTypes: ['application/vnd.ms-cab-compressed']
  },
  {
    extensions: ['iso'], family: 'archive', driverId: 'archive', targetFormat: 'iso',
    contentTypes: ['application/x-iso9660-image']
  },
  {
    extensions: ['rar', 'cbr'], family: 'archive', driverId: 'archive', targetFormat: 'rar',
    contentTypes: ['application/vnd.rar', 'application/x-rar-compressed', 'application/vnd.comicbook-rar', 'application/x-cbr']
  },
  {
    extensions: ['7z', 'cb7'], family: 'archive', driverId: 'archive', targetFormat: '7z',
    contentTypes: ['application/x-7z-compressed', 'application/x-cb7']
  },
  {
    extensions: ['zipx'], family: 'archive', driverId: 'archive', targetFormat: 'zipx',
    contentTypes: ['application/x-zipx']
  },
  {
    extensions: ['xpi'], family: 'archive', driverId: 'archive', targetFormat: 'zip',
    contentTypes: ['application/x-xpinstall']
  },
  {
    extensions: ['crx'], family: 'archive', driverId: 'archive', targetFormat: 'zip',
    contentTypes: ['application/x-chrome-extension']
  },
  {
    extensions: ['zip', 'jar', 'war', 'ear'],
    family: 'archive',
    driverId: 'archive',
    targetFormat: 'zip',
    contentTypes: ['application/zip', 'application/x-zip-compressed', 'application/java-archive']
  },
  {
    extensions: ['apk'], family: 'archive', driverId: 'archive', targetFormat: 'zip',
    contentTypes: ['application/vnd.android.package-archive']
  },
  {
    extensions: ['ipa'], family: 'archive', driverId: 'archive', targetFormat: 'zip',
    contentTypes: ['application/x-ios-app']
  },
  {
    extensions: ['tar', 'cbt'],
    family: 'archive',
    driverId: 'archive',
    targetFormat: 'tar',
    contentTypes: ['application/x-tar', 'application/x-cbt']
  },
  {
    extensions: ['tgz', 'gz'],
    family: 'archive',
    driverId: 'archive',
    targetFormat: 'gz',
    contentTypes: ['application/gzip', 'application/x-gzip']
  }
];

export function createArchivePreviewRoutes(baseRoutes = createDefaultPreviewRoutes()): FormatDefinition[] {
  const archiveFormats = new Set(ARCHIVE_FORMAT_ROUTES.flatMap((route) => route.extensions));
  return [
    ...ARCHIVE_FORMAT_ROUTES,
    ...baseRoutes.filter((route) => !route.extensions.some((extension) => archiveFormats.has(extension)))
  ];
}

export function createArchiveCategoryPreviewRoutes(baseRoutes: FormatDefinition[] = []): FormatDefinition[] {
  return createArchivePreviewRoutes(baseRoutes);
}
