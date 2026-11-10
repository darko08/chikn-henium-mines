"""App icons for Core Hopper: a tiny planet with its belt, a glowing core cut-away and a little rocket.
usage: python3 tools/icons.py  (writes assets/icon-192.png, icon-512.png, icon-maskable.png)"""
import math, os
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.join(os.path.dirname(__file__), '..')
os.makedirs(os.path.join(ROOT, 'assets'), exist_ok=True)


def icon(size, pad):
    S = size * 4  # draw big, then scale down for smooth edges
    im = Image.new('RGBA', (S, S), (11, 14, 38, 255))
    d = ImageDraw.Draw(im)
    for i in range(60):  # stars
        x, y = (math.sin(i * 91.7) * 0.5 + 0.5) * S, (math.sin(i * 37.3 + 1) * 0.5 + 0.5) * S
        r = S * 0.004 * (1 + i % 3)
        d.ellipse([x - r, y - r, x + r, y + r], fill=(255, 255, 255, 120 + (i % 4) * 30))
    c = S / 2
    rp = S * (0.27 - pad * 0.25)
    glow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([c - rp * 1.45, c - rp * 1.45, c + rp * 1.45, c + rp * 1.45], fill=(255, 154, 90, 90))
    im.alpha_composite(glow.filter(ImageFilter.GaussianBlur(S * 0.04)))
    d = ImageDraw.Draw(im)
    for k in range(30, 0, -1):  # planet with a soft gradient
        f = k / 30
        col = (int(90 + 70 * (1 - f)), int(55 + 40 * (1 - f)), int(42 + 25 * (1 - f)), 255)
        r = rp * f
        off = rp * 0.25 * (1 - f)
        d.ellipse([c - r - off, c - r - off, c + r - off, c + r - off], fill=col)
    # cut-away wedge with layers and the core
    for r, col in ((rp, (176, 112, 79)), (rp * 0.7, (201, 90, 51)), (rp * 0.42, (93, 47, 128))):
        d.pieslice([c - r, c - r, c + r, c + r], 245, 295, fill=col + (255,))
    core = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(core).ellipse([c - rp * 0.22, c - rp * 0.22, c + rp * 0.22, c + rp * 0.22], fill=(255, 230, 140, 255))
    im.alpha_composite(core.filter(ImageFilter.GaussianBlur(S * 0.012)))
    d = ImageDraw.Draw(im)
    d.ellipse([c - rp * 0.12, c - rp * 0.12, c + rp * 0.12, c + rp * 0.12], fill=(255, 255, 255, 255))
    # the belt
    rb = rp * 1.17
    d.ellipse([c - rb, c - rb, c + rb, c + rb], outline=(39, 43, 71, 255), width=int(rp * 0.13))
    for i in range(12):  # items on the belt
        a = i / 12 * math.tau + 0.2
        x, y = c + math.cos(a) * rb, c + math.sin(a) * rb
        rr = rp * 0.06
        d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=[(255, 216, 77), (98, 242, 255), (232, 131, 74), (179, 194, 224)][i % 4] + (255,))
    # a little rocket top right
    rx, ry, h = c + rp * 1.05, c - rp * 1.05, rp * 0.75
    d.polygon([(rx, ry - h * 0.55), (rx + h * 0.22, ry), (rx + h * 0.16, ry + h * 0.38), (rx - h * 0.16, ry + h * 0.38), (rx - h * 0.22, ry)], fill=(240, 244, 255, 255))
    d.polygon([(rx - h * 0.16, ry + h * 0.2), (rx - h * 0.34, ry + h * 0.48), (rx - h * 0.12, ry + h * 0.4)], fill=(255, 122, 69, 255))
    d.polygon([(rx + h * 0.16, ry + h * 0.2), (rx + h * 0.34, ry + h * 0.48), (rx + h * 0.12, ry + h * 0.4)], fill=(255, 122, 69, 255))
    d.ellipse([rx - h * 0.08, ry - h * 0.12, rx + h * 0.08, ry + h * 0.04], fill=(78, 109, 179, 255))
    d.polygon([(rx - h * 0.1, ry + h * 0.4), (rx + h * 0.1, ry + h * 0.4), (rx, ry + h * 0.7)], fill=(255, 216, 77, 255))
    return im.resize((size, size), Image.LANCZOS)


icon(192, 0).save(os.path.join(ROOT, 'assets/icon-192.png'))
icon(512, 0).save(os.path.join(ROOT, 'assets/icon-512.png'))
icon(512, 0.25).save(os.path.join(ROOT, 'assets/icon-maskable.png'))
print('icons written')
