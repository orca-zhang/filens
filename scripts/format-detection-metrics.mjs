// Label agreement and container evidence are separate; precise wrong subtypes
// must never become "correct" merely because they share an outer container.
export const canonical = value => ({ jpeg: 'jpg', tif: 'tiff', htm: 'html', stp: 'step', mpeg: 'mpg', bzip2: 'bz2', zstd: 'zst', midi: 'mid', xslt: 'xsl', xht: 'xhtml', xhtm: 'xhtml', jsonlines: 'jsonl', ldjson: 'jsonl', ndjson: 'jsonl' })[value] ?? value;
const groups = [
  ['doc', 'dot', 'wps', 'wpt', 'wbk'], ['xls', 'xlt', 'et', 'ett', 'xla', 'xlk'], ['ppt', 'pps', 'pot', 'dps', 'dpt'], ['msg', 'oft'],
  ['ogg', 'oga', 'opus', 'ogv', 'spx'], ['mp4', 'm4v', 'f4v', '360v', 'insv', 'lrv', 'lrf'], ['heic', 'heif'],
  ['html', 'shtml', 'xhtml'], ['ps', 'eps', 'ai'], ['pdf', 'ai'],
  ['gz', 'tgz', 'svgz'], ['bz2', 'tbz', 'tbz2'], ['xz', 'txz'], ['zst', 'tzst'], ['z', 'taz'],
  ['ar', 'deb'], ['rar', 'cbr'], ['7z', 'cb7'], ['tar', 'cbt'], ['wim', 'esd', 'swm'], ['lzh', 'lha'],
  ['exe', 'dll', 'mui', 'mun'], ['ttml', 'dfxp'], ['asf', 'wmv', 'wma'], ['mid', 'kar'], ['h5', 'hdf5'],
];
const containers = {
  zip: ['zip', 'zipx', 'docx', 'dotx', 'docm', 'dotm', 'xlsx', 'xlsm', 'xltx', 'xltm', 'xlam', 'xlsb', 'pptx', 'ppsx', 'potx', 'pptm', 'ppsm', 'potm', 'odt', 'ott', 'ods', 'ots', 'odp', 'otp', 'odg', 'otg', 'odm', 'oth', 'epub', 'cbz', 'apk', 'ipa', 'jar', 'war', 'ear', 'xpi', 'key', 'pages', 'numbers', '3mf', 'kmz', 'sxw', 'stw', 'sxg', 'sxc', 'stc', 'sxi', 'sti', 'sxd', 'std', 'xps', 'oxps', 'docxf'],
  cfb: ['cfb', 'doc', 'dot', 'wps', 'wpt', 'wbk', 'xls', 'xlt', 'et', 'ett', 'xla', 'xlk', 'ppt', 'pps', 'pot', 'dps', 'dpt', 'msg', 'oft', 'docx', 'xlsx', 'pptx'],
  tiff: ['tiff', 'dng', 'nef', 'nrw', 'arw', 'pef', 'cr2', 'rw2', '3fr', 'erf', 'iiq', 'kdc', 'mef', 'mos', 'rwl', 'sr2', 'srf', 'srw'],
  ebml: ['mkv', 'webm'], ogg: ['ogg', 'oga', 'ogv', 'opus', 'spx'],
  isobmff: ['avif', 'heic', 'heif', 'cr3', 'mov', 'mp4', 'm4v', 'm4a', 'm4b', 'm4p', 'f4v', 'f4a', 'f4b', 'f4p', 'mj2', '3gp', '3g2'],
};
export function outcome(label, detection) {
  const expected = canonical(label), predicted = canonical(detection.format);
  if (predicted === expected) return 'exact';
  if (predicted) {
    // PNM and .sh are broad suffixes; content may establish a more specific member.
    if (expected === 'pnm' && ['pbm', 'pgm', 'ppm'].includes(predicted)) return 'family';
    if (expected === 'sh' && ['bash', 'zsh'].includes(predicted)) return 'family';
    if (groups.some(group => group.includes(expected) && group.includes(predicted))) return 'family';
    if (predicted === 'json' && ['gltf', 'ipynb', 'avsc'].includes(expected)) return 'family';
    if (predicted === 'xml' && ['fb2', 'fodt', 'fods', 'fodp', 'fodg', 'atom', 'rss', 'kml', 'gpx', 'plist', 'pom', 'wsdl', 'xsd', 'xsl', 'csproj', 'fsproj', 'vbproj', 'props', 'targets', 'ttml', 'dfxp'].includes(expected)) return 'family';
    if (expected === 'cfb' && detection.container === 'cfb') return 'family';
    return 'disagreement';
  }
  if (containers[detection.container]?.includes(expected)) return 'container';
  if (detection.container === 'zip' && /^z\d{2}$/.test(expected)) return 'container';
  if (detection.container === 'jpeg2000' && ['jp2', 'jpx', 'jpm', 'mj2'].includes(expected)) return 'container';
  return detection.container ? 'disagreement' : 'unresolved';
}
export function metrics(rows, field) {
  const counts = { exact: 0, family: 0, container: 0, unresolved: 0, disagreement: 0 };
  for (const row of rows) counts[outcome(row.label, row[field])]++;
  return { files: rows.length, ...counts, exactLabelAgreement: rows.length ? counts.exact / rows.length : null,
    formatsIdentified: new Set(rows.map(row => row[field].format).filter(Boolean)).size };
}
