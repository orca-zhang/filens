"""Original compressed streams and containers; runtime decoding stays in WASM.

Requires Python 3, zstd, and macOS hdiutil (ISO specimen creation only).
"""
import bz2
import io
import lzma
from pathlib import Path
import shutil
import struct
import subprocess
import tarfile
import tempfile
import zlib

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'apps/demo/public/samples/archives'
OUT.mkdir(parents=True, exist_ok=True)
README = b'# Filens archive study\n\nOriginal color and shape artwork, packaged for local read-only preview.\n'
FILES = {
    'README.md': README,
    'page-2.jpeg': (ROOT / 'apps/demo/public/samples/graphics/color-archive.jpeg').read_bytes(),
    'page-10.svg': (ROOT / 'apps/demo/public/samples/graphics/shape-study.svg').read_bytes(),
}


def tar(files):
    result = io.BytesIO()
    with tarfile.open(fileobj=result, mode='w', format=tarfile.PAX_FORMAT) as archive:
        for name, data in files.items():
            entry = tarfile.TarInfo(name)
            entry.size, entry.mtime, entry.mode = len(data), 1735689600, 0o644
            archive.addfile(entry, io.BytesIO(data))
    return result.getvalue()


def zstd(data):
    # stdin deliberately produces a stream without a declared unpacked size.
    return subprocess.run(['zstd', '-q', '-c'], input=data, check=True, capture_output=True).stdout


def ar(files):
    result = bytearray(b'!<arch>\n')
    for name, data in files.items():
        header = f'{name + "/":<16}{1735689600:<12}{0:<6}{0:<6}{"100644":<8}{len(data):<10}`\n'
        assert len(header) == 60
        result.extend(header.encode('ascii') + data + (b'\n' if len(data) % 2 else b''))
    return bytes(result)


def cpio(files):
    result = bytearray()
    for inode, (name, data) in enumerate([*files.items(), ('TRAILER!!!', b'')], 1):
        encoded = name.encode() + b'\0'
        values = [inode, 0o100644, 0, 0, 1, 1735689600, len(data), 0, 0, 0, 0, len(encoded), 0]
        result.extend(('070701' + ''.join(f'{v:08x}' for v in values)).encode() + encoded)
        result.extend(b'\0' * (-len(result) % 4))
        result.extend(data)
        result.extend(b'\0' * (-len(result) % 4))
    result.extend(b'\0' * (-len(result) % 512))
    return bytes(result)


def cab(files):
    # A genuine MSZIP single-folder Microsoft Cabinet with multiple CFDATA
    # blocks and dictionary continuation. Checksums are explicitly absent.
    entries, payload = bytearray(), bytearray()
    for name, data in files.items():
        entries.extend(struct.pack('<IIHHHH', len(data), len(payload), 0, 0x5A21, 0, 0x20))
        entries.extend(name.encode() + b'\0')
        payload.extend(data)
    blocks = [payload[i:i + 32768] for i in range(0, len(payload), 32768)]
    offset = 36 + 8 + len(entries)
    packed = []
    dictionary = b''
    for block in blocks:
        encoder = zlib.compressobj(9, zlib.DEFLATED, -15, zdict=dictionary) if dictionary else zlib.compressobj(9, zlib.DEFLATED, -15)
        compressed = b'CK' + encoder.compress(block) + encoder.flush()
        packed.append(struct.pack('<IHH', 0, len(compressed), len(block)) + compressed)
        dictionary = bytes(block[-32768:])
    cabinet_size = offset + sum(map(len, packed))
    header = struct.pack('<4sIIIIIBBHHHHH', b'MSCF', 0, cabinet_size, 0, 44, 0, 3, 1, 1, len(files), 0, 0, 0)
    return header + struct.pack('<IHH', offset, len(blocks), 1) + entries + b''.join(packed)


compressors = {
    'bz2': bz2.compress,
    'xz': lzma.compress,
    'lzma': lambda data: lzma.compress(data, format=lzma.FORMAT_ALONE),
    'zst': zstd,
    'zstd': zstd,
}
for extension, compress in compressors.items():
    (OUT / f'archive-readme.md.{extension}').write_bytes(compress(README))
payload = tar(FILES)
for extension, codec in [('tbz', 'bz2'), ('tbz2', 'bz2'), ('txz', 'xz'), ('tlz', 'lzma')]:
    (OUT / f'color-study.{extension}').write_bytes(compressors[codec](payload))
(OUT / 'color-study.ar').write_bytes(ar(FILES))
(OUT / 'color-study.cpio').write_bytes(cpio(FILES))
(OUT / 'color-study.cab').write_bytes(cab(FILES))
control = b'Package: filens-color-study\nVersion: 1.0.0\nArchitecture: all\nMaintainer: Filens\nDescription: Original read-only archive specimen\n'
(OUT / 'color-study.deb').write_bytes(ar({
    'debian-binary': b'2.0\n',
    'control.tar.xz': lzma.compress(tar({'control': control})),
    'data.tar.zst': zstd(payload),
}))
with tempfile.TemporaryDirectory(prefix='filens-iso-sample-') as work:
    tree = Path(work) / 'artwork'
    tree.mkdir()
    for name, data in FILES.items():
        (tree / name).write_bytes(data)
    image = Path(work) / 'color-study.iso'
    subprocess.run(['hdiutil', 'makehybrid', '-iso', '-joliet', '-default-volume-name',
                    'FILENS_ART', '-o', str(image), str(tree)], check=True, capture_output=True)
    shutil.copyfile(image, OUT / 'color-study.iso')
print('Generated 14 original compressed-stream and container samples.')
