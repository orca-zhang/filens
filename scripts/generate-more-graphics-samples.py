"""Extend the original artwork to real image formats. Requires Pillow, ImageMagick, cjxl and heif-enc."""
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "apps/demo/public/samples/graphics"


def run(args):
    result = subprocess.run([str(value) for value in args], capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(f"{args[0]} failed: {result.stderr[-2000:]}")


image = Image.open(OUT / "field-notes.tiff").convert("RGB").resize((900, 600))
image.save(OUT / "color-archive.dib", format="DIB")
image.save(OUT / "color-archive.pcx", format="PCX")
image.quantize(colors=64).save(OUT / "indexed-archive.pcx", format="PCX")
image.save(OUT / "color-archive.jpeg", format="JPEG", quality=90)

# Write a small uncompressed scanline OpenEXR directly. Some ImageMagick builds
# silently retain PNG encoding when the EXR delegate is unavailable.
def attribute(name, kind, value):
    return name.encode() + b"\0" + kind.encode() + b"\0" + struct.pack("<I", len(value)) + value


width, height = image.size
channels = b"".join(name + b"\0" + struct.pack("<iB3xii", 1, 0, 1, 1) for name in [b"B", b"G", b"R"]) + b"\0"
window = struct.pack("<iiii", 0, 0, width - 1, height - 1)
header = struct.pack("<II", 20000630, 2)
header += attribute("channels", "chlist", channels)
header += attribute("compression", "compression", b"\0")
header += attribute("dataWindow", "box2i", window) + attribute("displayWindow", "box2i", window)
header += attribute("lineOrder", "lineOrder", b"\0")
header += attribute("pixelAspectRatio", "float", struct.pack("<f", 1))
header += attribute("screenWindowCenter", "v2f", struct.pack("<ff", 0, 0))
header += attribute("screenWindowWidth", "float", struct.pack("<f", 1)) + b"\0"
linear = [struct.pack("<e", v / 255 / 12.92 if v / 255 <= 0.04045 else ((v / 255 + 0.055) / 1.055) ** 2.4) for v in range(256)]
rgb = image.tobytes()
row_bytes = width * 6
first_row = len(header) + height * 8
offsets = b"".join(struct.pack("<Q", first_row + y * (row_bytes + 8)) for y in range(height))
with (OUT / "linear-light.exr").open("wb") as output:
    output.write(header + offsets)
    for y in range(height):
        output.write(struct.pack("<iI", y, row_bytes))
        row = rgb[y * width * 3:(y + 1) * width * 3]
        for channel in [2, 1, 0]:
            output.write(b"".join(linear[value] for value in row[channel::3]))

cursor = Image.new("RGBA", (64, 64))
draw = ImageDraw.Draw(cursor)
draw.polygon([(8, 5), (8, 53), (22, 42), (32, 61), (43, 55), (33, 37), (52, 36)], fill="#e9ba64", outline="#203f35", width=3)
with tempfile.TemporaryDirectory(prefix="filens-graphics-") as work:
    work = Path(work)
    cursor.save(work / "cursor.png")
    payload = (work / "cursor.png").read_bytes()
    header = struct.pack("<HHH", 0, 2, 1)
    entry = struct.pack("<BBBBHHII", 64, 64, 0, 0, 8, 5, len(payload), 22)
    (OUT / "studio-pointer.cur").write_bytes(header + entry + payload)
    cursor.save(work / "cursor.ico", format="ICO", sizes=[(64, 64)], bitmap_format="bmp")
    legacy = bytearray((work / "cursor.ico").read_bytes())
    legacy[2:4] = b"\x02\x00"
    legacy[10:14] = struct.pack("<HH", 8, 5)
    (OUT / "studio-pointer-bmp.cur").write_bytes(legacy)
    image.save(work / "artwork.png")
    run(["magick", work / "artwork.png", OUT / "color-archive.qoi"])
    run(["magick", work / "artwork.png", OUT / "color-archive.ff"])
    run(["cjxl", work / "artwork.png", OUT / "color-archive.jxl", "-d", "0", "-e", "5"])
    run(["heif-enc", "-L", "-o", OUT / "color-archive.heic", work / "artwork.png"])
    shutil.copyfile(OUT / "color-archive.heic", OUT / "color-archive.heif")

(OUT / "shape-study.svg").write_text('''<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600" viewBox="0 0 900 600">
<rect width="900" height="600" fill="#f3efe5"/><rect width="900" height="18" fill="#dc6b45"/>
<g font-family="Arial,sans-serif" fill="#203f35"><text x="48" y="72" font-size="18">FILENS / VECTOR STUDIES</text><text x="48" y="140" font-size="48">A language of shapes</text></g>
<circle cx="180" cy="330" r="110" fill="#203f35"/><path d="M340 440 460 220 580 440Z" fill="#dc6b45"/><rect x="640" y="220" width="210" height="220" rx="32" fill="#e9ba64"/>
<text x="48" y="550" font-family="Arial,sans-serif" font-size="18" fill="#526252">SVG / TEXT, PATHS &amp; INFINITE SCALE</text></svg>''')
print("Generated 13 additional original image samples")
