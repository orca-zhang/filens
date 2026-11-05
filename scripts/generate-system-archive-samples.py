"""Original system/package archive specimens. Native tools create fixtures only.

Requires compress, xar, hdiutil, zstd, LHa and wimlib-imagex. Override the last
two with FILENS_LHA_BIN and FILENS_WIMLIB_BIN. The application uses frontend WASM.
"""
import bz2
import hashlib
import io
import json
import lzma
import os
from pathlib import Path
import shutil
import struct
import subprocess
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'apps/demo/public/samples/archives'
OUT.mkdir(parents=True, exist_ok=True)
README = '# Filens field notes\n\nOriginal seasonal color study · 季节色谱.\nFour palettes, one year, packaged for local read-only preview.\n'.encode()
COLORS = ['#81b29a', '#f2cc8f', '#e07a5f', '#6c8ead']
panels = []
for i, (season, color) in enumerate(zip(['SPRING', 'SUMMER', 'AUTUMN', 'WINTER'], COLORS)):
    x = 42 + i * 214
    panels.append(f'''<g transform="translate({x} 138)"><rect width="196" height="302" rx="22" fill="{color}"/>
<circle cx="98" cy="102" r="62" fill="#fff" opacity=".24"/>
<path d="M98 192V70M98 148C40 148 48 94 98 100M98 126C158 126 150 72 98 78" fill="none" stroke="#243d3a" stroke-width="8" stroke-linecap="round"/>
<text x="24" y="260" fill="#243d3a" font-family="sans-serif" font-size="17" letter-spacing="3">{season}</text></g>''')
ARTWORK = ('''<svg xmlns="http://www.w3.org/2000/svg" width="900" height="540" viewBox="0 0 900 540">
<rect width="900" height="540" fill="#f5f1e8"/><text x="42" y="58" font-family="sans-serif" font-size="12" letter-spacing="5" fill="#51726b">FILENS / FIELD NOTES 01</text>
<text x="42" y="110" font-family="sans-serif" font-size="38" fill="#243d3a">A year in four colors</text>
''' + ''.join(panels) + '''<path d="M42 478H858" stroke="#243d3a" opacity=".3"/><text x="42" y="510" font-family="sans-serif" font-size="14" fill="#51726b">Original seasonal color study · 2026</text></svg>''').encode()
FILES = {'README.md': README, 'seasons.svg': ARTWORK,
         'palette.json': (json.dumps(dict(zip(['spring', 'summer', 'autumn', 'winter'], COLORS)), indent=2) + '\n').encode()}
STAMP = 1735689600


def run(args, data=None, cwd=None):
    result = subprocess.run(args, input=data, cwd=cwd, capture_output=True)
    if result.returncode:
        raise RuntimeError(f'{args[0]} failed: {result.stderr.decode(errors="replace")}\n{result.stdout.decode(errors="replace")}')
    return result.stdout


def tar(files):
    result = io.BytesIO()
    with tarfile.open(fileobj=result, mode='w', format=tarfile.PAX_FORMAT) as archive:
        for name, data in files.items():
            entry = tarfile.TarInfo(name)
            entry.size, entry.mtime, entry.mode = len(data), STAMP, 0o644
            archive.addfile(entry, io.BytesIO(data))
    return result.getvalue()


def cpio(files):
    result = bytearray()
    for inode, (name, data) in enumerate([*files.items(), ('TRAILER!!!', b'')], 1):
        encoded = name.encode() + b'\0'
        values = [inode, 0o100644, 0, 0, 1, STAMP, len(data), 0, 0, 0, 0, len(encoded), 0]
        result.extend(('070701' + ''.join(f'{v:08x}' for v in values)).encode() + encoded)
        result.extend(b'\0' * (-len(result) % 4))
        result.extend(data)
        result.extend(b'\0' * (-len(result) % 4))
    result.extend(b'\0' * (-len(result) % 512))
    return bytes(result)


def rpm_header(fields):
    indexes, store = bytearray(), bytearray()
    for tag, kind, value in sorted(fields):
        if kind in (3, 4):
            width, code = (2, 'H') if kind == 3 else (4, 'I')
            store.extend(b'\0' * (-len(store) % width))
            count, data = len(value), struct.pack('>' + code * len(value), *value)
        elif kind == 7:
            count, data = len(value), value
        else:
            values = [value] if kind == 6 else value
            count, data = len(values), b''.join(v.encode() + b'\0' for v in values)
        indexes.extend(struct.pack('>IIII', tag, kind, len(store), count))
        store.extend(data)
    return b'\x8e\xad\xe8\x01' + b'\0' * 4 + struct.pack('>II', len(fields), len(store)) + indexes + store


def rpm(compressor):
    payload = cpio(FILES)
    packed = run(['zstd', '-q', '-c'], payload) if compressor == 'zstd' else lzma.compress(payload)
    names = list(FILES)
    header = rpm_header([
        (1000, 6, 'filens-field-notes'), (1001, 6, '1.0'), (1002, 6, '1'),
        (1004, 9, ['Filens seasonal color study']), (1005, 9, ['Original read-only archive specimen.']),
        (1006, 4, [STAMP]), (1009, 4, [sum(map(len, FILES.values()))]), (1014, 6, 'MIT'),
        (1016, 9, ['Documentation']), (1021, 6, 'linux'), (1022, 6, 'noarch'),
        (1028, 4, [len(FILES[n]) for n in names]), (1030, 3, [0o100644] * 3),
        (1034, 4, [STAMP] * 3), (1035, 8, [hashlib.sha256(FILES[n]).hexdigest() for n in names]),
        (1036, 8, [''] * 3), (1037, 4, [0] * 3), (1039, 8, ['root'] * 3), (1040, 8, ['root'] * 3),
        (1116, 4, [0] * 3), (1117, 8, names), (1118, 8, ['./']),
        (1124, 6, 'cpio'), (1125, 6, compressor), (1126, 6, '9'), (5011, 4, [8]),
        (5092, 8, [hashlib.sha256(packed).hexdigest()]), (5093, 4, [8])
    ])
    signature = rpm_header([(1000, 4, [len(header) + len(packed)]),
                            (1004, 7, hashlib.md5(header + packed).digest())])
    lead = struct.pack('>4sBBHH66sHH16s', b'\xed\xab\xee\xdb', 3, 0, 0, 0,
                       b'filens-field-notes-1.0-1', 1, 5, b'\0' * 16)
    return lead + signature + b'\0' * (-len(signature) % 8) + header + packed


(OUT / 'field-notes.md.Z').write_bytes(run(['compress', '-c', '-f'], README))
(OUT / 'field-notes.taz').write_bytes(run(['compress', '-c', '-f'], tar(FILES)))
(OUT / 'field-notes.tzst').write_bytes(run(['zstd', '-q', '-c'], tar(FILES)))
(OUT / 'field-notes.md.bzip2').write_bytes(bz2.compress(README))
dictionary = 1 << 20
encoded = lzma.compress(README, format=lzma.FORMAT_RAW,
                        filters=[{'id': lzma.FILTER_X86}, {'id': lzma.FILTER_LZMA1, 'dict_size': dictionary, 'lc': 3, 'lp': 0, 'pb': 2}])
(OUT / 'field-notes.md.lzma86').write_bytes(b'\x01\x5d' + struct.pack('<IQ', dictionary, len(README)) + encoded)
for codec in ['zstd', 'xz']:
    (OUT / f'field-notes-{codec}.rpm').write_bytes(rpm(codec))

with tempfile.TemporaryDirectory(prefix='filens-system-samples-') as work:
    tree = Path(work) / 'field-notes'
    tree.mkdir()
    for name, data in FILES.items():
        target = tree / name
        target.write_bytes(data)
        os.utime(target, (STAMP, STAMP))
    lha = os.environ.get('FILENS_LHA_BIN', 'lha')
    for extension, method in [('lha', 'ao5'), ('lzh', 'ao6')]:
        archive = Path(work) / f'field-notes.{extension}'
        run([lha, method, str(archive), *FILES], cwd=tree)
        shutil.copyfile(archive, OUT / archive.name)
    for name, codec in [('field-notes.xar', 'gzip'), ('field-notes-bzip2.xar', 'bzip2')]:
        run(['xar', '-cf', str(OUT / name), f'--compression={codec}', *FILES], cwd=tree)
    wimlib = os.environ.get('FILENS_WIMLIB_BIN', 'wimlib-imagex')
    for name, options in [('field-notes.wim', ['--compress=LZX']), ('field-notes.esd', ['--compress=LZMS', '--solid'])]:
        image = Path(work) / name
        run([wimlib, 'capture', str(tree), str(image), 'Filens field notes', '--no-acls', *options])
        shutil.copyfile(image, OUT / name)
        if name.endswith('.wim'):
            second = Path(work) / 'second-image'
            second.mkdir()
            for filename, data in FILES.items():
                (second / filename).write_bytes(data + (b'\nSecond image: winter edition.\n' if filename == 'README.md' else b''))
            run([wimlib, 'append', str(second), str(image), 'Winter edition', '--no-acls'])
            shutil.copyfile(image, OUT / 'field-notes-multi.wim')
    image = Path(work) / 'field-notes.iso'
    run(['hdiutil', 'makehybrid', '-udf', '-default-volume-name', 'FILENS_FIELD_NOTES', '-o', str(image), str(tree)])
    shutil.copyfile(image, OUT / 'field-notes.udf')
print('Generated 15 original system/package archive specimens across 12 new extensions.')
