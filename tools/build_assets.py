"""Optimise generated art for the web build.

Reads   assets/sprites/<group>/*.png and assets/raw/bg/*.png
Writes  assets/web/<group>/<name>.webp  (sprites: specks removed, resized; backgrounds: resized,
        mine floors turned into seamless mirrored strips)
usage:  python3 -I tools/build_assets.py   (run from the project root)
"""
import os, glob
import numpy as np
from PIL import Image, ImageOps

ROOT = os.getcwd()
OUT = os.path.join(ROOT, 'assets', 'web')
SPRITE_SIZE = {'chikn': 360, 'res': 128, 'factory': 360, 'machine': 340, 'prop': 260, 'monster': 320, 'ui': 112, 'farm': 260}
SPRITE_SCALE = {'tier': 0.5}  # groups scaled by one shared factor, so building stages keep their relative size


def remove_specks(im):
    """Drop tiny detached alpha islands (stray pixels left by the generator)."""
    a = np.array(im)[:, :, 3]
    mask = a > 24
    h, w = mask.shape
    lab = np.zeros((h, w), np.int32)
    sizes = [0]
    n = 0
    for y, x in zip(*np.nonzero(mask)):
        if lab[y, x]:
            continue
        n += 1
        stack = [(y, x)]
        lab[y, x] = n
        cnt = 0
        while stack:
            cy, cx = stack.pop()
            cnt += 1
            for ny, nx in ((cy - 1, cx), (cy + 1, cx), (cy, cx - 1), (cy, cx + 1)):
                if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not lab[ny, nx]:
                    lab[ny, nx] = n
                    stack.append((ny, nx))
        sizes.append(cnt)
    limit = max(24, (max(h, w) / 55) ** 2)
    small = [i for i in range(1, n + 1) if sizes[i] < limit]
    if small:
        arr = np.array(im)
        arr[np.isin(lab, small), 3] = 0
        # also clear faint halo pixels that were attached only to removed specks
        im = Image.fromarray(arr)
    bbox = im.getbbox()
    return im.crop(bbox) if bbox else im


def save(im, path, q=82):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path, 'WEBP', quality=q, method=6, alpha_quality=90)
    return os.path.getsize(path)


total = 0
for group, size in SPRITE_SIZE.items():
    for f in sorted(glob.glob(os.path.join(ROOT, 'assets', 'sprites', group, '*.png'))):
        im = remove_specks(Image.open(f).convert('RGBA'))
        im.thumbnail((size, size), Image.LANCZOS)
        total += save(im, os.path.join(OUT, group, os.path.basename(f)[:-4] + '.webp'))
for group, k in SPRITE_SCALE.items():
    for f in sorted(glob.glob(os.path.join(ROOT, 'assets', 'sprites', group, '*.png'))):
        im = remove_specks(Image.open(f).convert('RGBA'))
        im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
        total += save(im, os.path.join(OUT, group, os.path.basename(f)[:-4] + '.webp'))
logo = Image.open(os.path.join(ROOT, 'assets', 'sprites', 'logo.png')).convert('RGBA')
logo.thumbnail((560, 560), Image.LANCZOS)
total += save(logo, os.path.join(OUT, 'ui', 'logo.webp'), 85)

BG = os.path.join(ROOT, 'assets', 'raw', 'bg')
for f in sorted(glob.glob(os.path.join(BG, 'floor-*.png'))):
    im = Image.open(f).convert('RGB')
    h = 300
    im = im.resize((round(im.width * h / im.height), h), Image.LANCZOS)
    strip = Image.new('RGB', (im.width * 2, h))
    strip.paste(im, (0, 0))
    strip.paste(ImageOps.mirror(im), (im.width, 0))  # mirrored copy -> seamless when repeated
    total += save(strip, os.path.join(OUT, 'bg', os.path.basename(f)[:-4] + '.webp'), 76)
for name, width in (('surface', 1700), ('map', 1400), ('arena', 1400), ('hall', 1400), ('farm', 1700)):
    im = Image.open(os.path.join(BG, name + '.png')).convert('RGB')
    im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    total += save(im, os.path.join(OUT, 'bg', name + '.webp'), 78)

files = glob.glob(os.path.join(OUT, '**', '*.webp'), recursive=True)
print(f'{len(files)} web assets, {total / 1024:.0f} KB total')
