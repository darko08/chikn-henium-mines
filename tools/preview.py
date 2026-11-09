"""Lay sprites from a folder side by side on a dark background for a visual check."""
import sys, glob, os
from PIL import Image
src, out = sys.argv[1], sys.argv[2]
h = int(sys.argv[3]) if len(sys.argv) > 3 else 160
fs = sorted(glob.glob(os.path.join(src, '*.png')))
ims = []
for f in fs:
    im = Image.open(f).convert('RGBA')
    ims.append(im.resize((max(1, im.width * h // im.height), h), Image.LANCZOS))
per = 6
rows = [ims[i:i + per] for i in range(0, len(ims), per)]
W = max(sum(i.width + 16 for i in r) for r in rows) + 16
sheet = Image.new('RGBA', (W, len(rows) * (h + 16) + 16), (24, 28, 70, 255))
y = 16
for r in rows:
    x = 16
    for im in r:
        sheet.alpha_composite(im, (x, y)); x += im.width + 16
    y += h + 16
sheet.save(out)
print('preview', out, sheet.size, [os.path.basename(f) for f in fs])
