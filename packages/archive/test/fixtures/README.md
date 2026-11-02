The two TAR fixtures were written by Python's standard-library `tarfile`, independently of the reader and test helpers. They exercise UTF-8 names longer than the USTAR name field using POSIX PAX and GNU long-name records.

Regenerate from the repository root:

```python
import io, tarfile
from pathlib import Path

folder = Path('packages/archive/test/fixtures')
long_name = '目录/' + 'long-file-name-' * 12 + '预览.txt'
for format, label in [(tarfile.PAX_FORMAT, 'pax'), (tarfile.GNU_FORMAT, 'gnu')]:
    with tarfile.open(folder / f'{label}-long-path.tar', 'w', format=format) as archive:
        for name, text, modified in [
            (long_name, 'Long path preview: 中文内容\n', 1700000000.125),
            ('next.txt', 'Next entry\n', 1700000001),
        ]:
            data = text.encode()
            entry = tarfile.TarInfo(name)
            entry.size, entry.mtime = len(data), modified
            archive.addfile(entry, io.BytesIO(data))
```

## RAR password fixtures

RAR 4/5 fixtures are decoded from libarchive's `libarchive/test/test_read_format_rar{4,5}_*.rar.uu`, at commit `348e5a2e27503f5bf114e298e2bd9ddcd59ab48e`:
https://github.com/libarchive/libarchive/tree/348e5a2e27503f5bf114e298e2bd9ddcd59ab48e/libarchive/test

Their accompanying BSD license is reproduced in `LICENSE.libarchive.txt`.

Each archive contains a.txt, b.txt, c.txt and d.txt; their content is `This is from X.txt`. Solid archives and archives with encrypted filenames use `password` for every file. Other archives leave a.txt and c.txt unencrypted, use `password` for b.txt and `password2` for d.txt.

`multivolume/` contains the RAR 4 `test_rar_multivolume_single_file.part{1,2,3}.rar` and RAR 5 solid `test_read_format_rar5_multiarchive_solid.part{01,02,03,04}.rar` fixtures, decoded from the same libarchive commit. Copyright notices for their accompanying tests are reproduced in `multivolume/LICENSE.libarchive.txt`.

`multivolume/classic.z01` and `classic.zip` are independent Info-ZIP fixtures: create `binary.dat` with 70,000 bytes (`byte[i] = i % 256`), then run `zip -0 -s 64k classic.zip binary.dat`. They exercise ZIP disk-relative offsets rather than byte-split ZIP streams.
