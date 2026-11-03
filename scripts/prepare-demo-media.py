"""Prepare the varied image/video demo samples (Pillow and FFmpeg required).

Run: python3 scripts/prepare-demo-media.py
Originals are cached outside the repository. Credits are in samples/SOURCES.md.
These are build-time fixtures; application conversion stays in the WASM core.
"""

from pathlib import Path
from shutil import copyfile
import struct
import subprocess
import tempfile
from urllib.request import Request, urlopen

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'apps/demo/public/samples/media'
CACHE = Path(tempfile.gettempdir()) / 'filens-media-sources'
OUTPUT.mkdir(parents=True, exist_ok=True)
CACHE.mkdir(parents=True, exist_ok=True)

COMMONS = 'https://upload.wikimedia.org/wikipedia/commons/'
SOURCES = {
    'bridge.jpg': COMMONS + 'thumb/f/fd/Golden_Gate_Bridge_from_Battery_Spencer.jpg/1280px-Golden_Gate_Bridge_from_Battery_Spencer.jpg',
    'butterfly.jpg': COMMONS + 'thumb/6/65/Blue_morpho_butterfly.jpg/960px-Blue_morpho_butterfly.jpg',
    'veggies.jpg': COMMONS + 'thumb/3/31/Veggies.jpg/1280px-Veggies.jpg',
    'wave.jpg': COMMONS + 'thumb/0/0a/The_Great_Wave_off_Kanagawa.jpg/1280px-The_Great_Wave_off_Kanagawa.jpg',
    'ball.png': COMMONS + '1/14/Animated_PNG_example_bouncing_beach_ball.png?download=1',
    'compass.png': 'https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Compass/3D/compass_3d.png',
    'fluent-emoji-license.txt': 'https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/LICENSE',
    'bunny.mp4': 'https://media.w3.org/2010/05/bunny/trailer.mp4',
    'sintel.mp4': 'https://download.blender.org/durian/trailer/sintel_trailer-480p.mp4',
    'waterfall.webm': COMMONS + 'transcoded/f/f7/Waterfall_in_Huascar%C3%A1n_National_Park_-_Peru.webm/Waterfall_in_Huascar%C3%A1n_National_Park_-_Peru.webm.240p.vp9.webm?download=1',
    'ocean-greece.ogv': COMMONS + 'c/c0/Water_Waves_Greece.ogv?download=1',
    'jellyfish.webm': COMMONS + 'transcoded/2/29/Jellyfish_in_the_Aquarium_Genoa.ogg/Jellyfish_in_the_Aquarium_Genoa.ogg.240p.vp9.webm?download=1',
    'train.mov': COMMONS + 'transcoded/f/f6/Steam_locomotive_parade_in_Shcherbinka.webm/Steam_locomotive_parade_in_Shcherbinka.webm.360p.mpeg4.mov',
    'city.mov': COMMONS + 'transcoded/f/f4/Traffic_control_in_Mexico_City.ogv/Traffic_control_in_Mexico_City.ogv.360p.mpeg4.mov',
    'clouds.mov': COMMONS + 'transcoded/3/38/Timelapse_clouds.ogv/Timelapse_clouds.ogv.360p.mpeg4.mov',
    'bird.mov': COMMONS + 'transcoded/4/43/Cute_Colorful_Bird_on_Walking_on_Ledge.webm/Cute_Colorful_Bird_on_Walking_on_Ledge.webm.360p.mpeg4.mov',
}


def download(name):
    target = CACHE / name
    if not target.exists():
        request = Request(SOURCES[name], headers={'User-Agent': 'filens-demo-assets/1.0'})
        with urlopen(request, timeout=90) as response:
            data = response.read()
        target.write_bytes(data)
    return target


def ffmpeg(*args):
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
                    *map(str, args)], check=True)


def photo(source, size):
    image = Image.open(download(source)).convert('RGB')
    return ImageOps.contain(image, size, Image.Resampling.LANCZOS)


photo('bridge.jpg', (1200, 900)).save(
    OUTPUT / 'golden-gate.webp', quality=86)
photo('butterfly.jpg', (960, 960)).save(
    OUTPUT / 'blue-morpho.avif', quality=82)
photo('veggies.jpg', (256, 256)).save(
    OUTPUT / 'vegetable-market.ppm')
photo('wave.jpg', (720, 500)).save(OUTPUT / 'great-wave.bmp')
# Keep all 20 frames and the original transparency of the public-domain APNG.
copyfile(download('ball.png'), OUTPUT / 'bouncing-ball.apng')
Image.open(ROOT / 'apps/demo/public/brand/filens-icon-512.png').save(
    OUTPUT / 'filens.ico', sizes=[(32, 32), (64, 64), (128, 128), (256, 256)])
# An ICNS with a real PNG icon chunk exercises the embedded-icon preview path.
icon = download('compass.png').read_bytes()
chunk = b'ic08' + struct.pack('>I', len(icon) + 8) + icon
(OUTPUT / 'compass.icns').write_bytes(b'icns' + struct.pack('>I', len(chunk) + 8) + chunk)
copyfile(download('fluent-emoji-license.txt'), OUTPUT / 'FLUENT-EMOJI-LICENSE.txt')

H264 = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '25', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart']
# Every format has its own subject. Portrait sources keep their aspect ratio.
# Legacy codecs have a browser-compatible derivative of the SAME excerpt.
CLIPS = [
    ('waterfall.webm', 'waterfall.webm', 0, 8, 'webm', False),
    ('bunny.mp4', 'big-buck-bunny.mov', 9, 6, 'h264', False),
    ('sintel.mp4', 'sintel-dragon.m4v', 25, 7, 'h264', False),
    ('ocean-greece.ogv', 'ocean-waves.ogv', 0, 8, 'copy', True),
    ('jellyfish.webm', 'jellyfish.mkv', 0, 8, 'mkv', False),
    ('train.mov', 'steam-train.avi', 8, 8, 'avi', True),
    ('city.mov', 'city-traffic.mpeg', 0, 8, 'mpeg', True),
    ('clouds.mov', 'cloud-timelapse.mpg', 0, 8, 'mpeg', True),
    ('bird.mov', 'colorful-bird.3gp', 0, 8, 'h264', True),
]
for source, name, start, duration, codec, preview in CLIPS:
    original = download(source)
    inputs = ['-ss', start, '-i', original, '-t', duration, '-map', '0:v:0', '-map', '0:a:0?']
    normalized = ['-vf', "scale=w='min(640,iw)':h='min(360,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2", '-r', '25']
    if codec == 'copy':
        encoding = ['-c', 'copy']
    elif codec == 'webm':
        encoding = normalized + ['-c:v', 'libvpx-vp9', '-crf', '34', '-b:v', '0', '-c:a', 'libopus', '-b:a', '48k']
    elif codec == 'avi':
        encoding = normalized + ['-c:v', 'mpeg4', '-q:v', '6', '-c:a', 'libmp3lame', '-b:a', '64k']
    elif codec == 'mpeg':
        encoding = normalized + ['-c:v', 'mpeg1video', '-q:v', '6', '-c:a', 'mp2', '-b:a', '128k']
    elif codec == 'mkv':
        encoding = normalized + H264[:-2]
    else:
        encoding = normalized + H264
    ffmpeg(*inputs, *encoding, OUTPUT / name)
    if preview:
        ffmpeg(*inputs, *normalized, *H264, OUTPUT / f'{Path(name).stem}.preview.mp4')
    print(f'Prepared {name}')

print(f'Prepared demo media in {OUTPUT}')
