"""Generate original raster demo assets. Requires Pillow; run from the repository root."""
from pathlib import Path
import math
import struct
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "apps/demo/public/samples/graphics"
OUT.mkdir(parents=True, exist_ok=True)


def font(size):
    for path in ["/System/Library/Fonts/Supplemental/Arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default(size=size)


def poster(title, subtitle, page=1):
    image = Image.new("RGB", (1200, 800), "#f3efe5")
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 1200, 24), fill="#dc6b45")
    draw.text((64, 64), "FILENS / FIELD NOTES", font=font(22), fill="#526252")
    draw.text((64, 130), title, font=font(64), fill="#203f35")
    draw.text((68, 218), subtitle, font=font(24), fill="#526252")
    for i, color in enumerate(["#203f35", "#dc6b45", "#e9ba64", "#97b4a0"]):
        x = 64 + i * 274
        draw.rounded_rectangle((x, 300, x + 250, 604), radius=18, fill=color)
        if i % 2 == 0:
            draw.ellipse((x + 30, 342, x + 218, 530), outline="#f3efe5", width=4)
            draw.line((x + 124, 320, x + 124, 575), fill="#f3efe5", width=3)
        else:
            draw.polygon([(x + 20, 540), (x + 125, 340), (x + 230, 540)], outline="#f3efe5", width=4)
        draw.text((x + 20, 560), f"0{i + 1} / STUDY", font=font(18), fill="#f3efe5")
    draw.line((64, 660, 1136, 660), fill="#97b4a0", width=2)
    draw.text((64, 696), "ARCHIVE IN COLOR / SHAPES, TEXTURES & LIGHT", font=font(20), fill="#203f35")
    draw.text((1050, 696), f"{page:02}", font=font(24), fill="#203f35")
    return image


color = poster("The color archive", "Lossless scan / two-page TIFF document")
second = poster("Beyond the first page", "Second TIFF page / preview currently shows page one", 2)
color.save(OUT / "field-notes.tiff", compression="tiff_adobe_deflate", save_all=True, append_images=[second])
gray = Image.new("I;16", (768, 512))
gray.putdata([int(65535 * (x / 767) ** 2) for y in range(512) for x in range(768)])
gray.save(OUT / "tonal-ramp-16bit.tif", compression="tiff_lzw")
rgba = poster("Texture in motion", "TGA / RGBA texture with transparent corners").convert("RGBA")
alpha = Image.new("L", rgba.size)
ImageDraw.Draw(alpha).rounded_rectangle((0, 0, 1199, 799), radius=72, fill=255)
rgba.putalpha(alpha)
rgba.save(OUT / "texture-study.tga", compression="tga_rle")
small = poster("Portable color", "PNM / portable pixmap").resize((900, 600))
small.save(OUT / "portable-color.pnm", format="PPM")
small.convert("L").save(OUT / "portable-gray.pgm")
small.convert("1").save(OUT / "portable-ink.pbm")
poster("Surface atlas", "DDS / DXT1 compressed texture").resize((1024, 512)).save(OUT / "surface-atlas.dds", pixel_format="DXT1")

# Radiance RGBE with uncompressed scanlines, including values above SDR white.
width, height = 256, 128
with (OUT / "studio-light.hdr").open("wb") as stream:
    stream.write(f"#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y {height} +X {width}\n".encode())
    for y in range(height):
        for x in range(width):
            glow = 5 * math.exp(-((x - 185) ** 2 + (y - 42) ** 2) / 280)
            values = (0.07 + x / width + glow, 0.12 + y / height + glow * 0.75, 0.3 + glow * 0.35)
            mantissa, exponent = math.frexp(max(values))
            scale = mantissa * 256 / max(values)
            stream.write(struct.pack("4B", *(min(255, int(v * scale)) for v in values), exponent + 128))

print(f"Generated 8 original graphics samples in {OUT.relative_to(ROOT)}")
