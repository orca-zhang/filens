"""Merge recording clips with their own palettes and lossless frame optimization."""
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageSequence


output = Path(sys.argv[1])
frames = []
durations = []
for source in sys.argv[2:]:
    with Image.open(source) as image:
        for frame in ImageSequence.Iterator(image):
            rgb = frame.convert("RGB")
            paletted = rgb.quantize(colors=256, dither=Image.Dither.NONE)
            # Input clips are already quantized; merging must add no color loss.
            assert ImageChops.difference(rgb, paletted.convert("RGB")).getbbox() is None
            paletted.info.clear()
            frames.append(paletted)
            durations.append(frame.info["duration"])

frames[0].save(
    output, save_all=True, append_images=frames[1:], duration=durations,
    loop=0, optimize=True, disposal=1,
)

# Pillow may combine identical frames. Verify displayed pixels and timing,
# including the boundaries between clips with different palettes.
index = 0
remaining = durations[0]
with Image.open(output) as image:
    for frame in ImageSequence.Iterator(image):
        duration = frame.info["duration"]
        rgb = frame.convert("RGB")
        while duration:
            assert index < len(frames)
            assert ImageChops.difference(rgb, frames[index].convert("RGB")).getbbox() is None
            step = min(duration, remaining)
            duration -= step
            remaining -= step
            if not remaining:
                index += 1
                if index < len(frames):
                    remaining = durations[index]
assert index == len(frames)
print(f"Merged {len(frames)} frames; displayed colors and timing verified: {output}")
