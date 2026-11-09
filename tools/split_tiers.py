"""Split a 3+2 "upgrade stages" sheet into <name>-1..5.png, keeping the stages' relative sizes.

usage: python3 -I tools/split_tiers.py SHEET.png OUT_DIR NAME [--max-side 520] [--start 1] [--sizes 220,250,...]
All five stages are scaled by one shared factor (so the biggest stage fits --max-side),
which keeps a Lv. 1 building visibly smaller than its Lv. 5 version.
"""
import sys, os
import numpy as np
from PIL import Image


def cut_positions(proj, n, lo, hi):
    out = [lo]
    for k in range(1, n):
        ideal = lo + (hi - lo) * k / n
        w = (hi - lo) / n * 0.42
        a, b = max(lo, int(ideal - w)), min(hi, int(ideal + w))
        seg = proj[a:b]
        idx = np.flatnonzero(seg <= seg.min() + 1e-6)
        out.append(int(a + idx[np.argmin(np.abs(a + idx - ideal))]))
    out.append(hi)
    return out


def extent(proj):
    nz = np.flatnonzero(proj > 0)
    return int(nz[0]), int(nz[-1]) + 1


def main():
    sheet, out_dir, name = sys.argv[1:4]
    opts = dict(zip(sys.argv[4::2], sys.argv[5::2]))
    max_side = int(opts.get('--max-side', 520))
    start = int(opts.get('--start', 1))
    sizes_opt = [int(v) for v in opts['--sizes'].split(',')] if '--sizes' in opts else None
    im = Image.open(sheet).convert('RGBA')
    mask = np.array(im)[:, :, 3] > 40
    rows = mask.sum(1).astype(float)
    top, bot = extent(rows)
    rcuts = cut_positions(rows, 2, top, bot)
    crops = []
    for r, ncol in enumerate((3, 2)):
        y0, y1 = rcuts[r], rcuts[r + 1]
        cols = mask[y0:y1].sum(0).astype(float)
        left, right = extent(cols)
        ccuts = cut_positions(cols, ncol, left, right)
        for c in range(ncol):
            cell = im.crop((ccuts[c], y0, ccuts[c + 1], y1))
            a = np.array(cell)[:, :, 3]
            ys, xs = np.nonzero(a > 8)
            crops.append(cell.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)))
    k = min(1.0, max_side / max(max(c.size) for c in crops))
    os.makedirs(out_dir, exist_ok=True)
    sizes = []
    for i, c in enumerate(crops):
        kk = sizes_opt[i] / max(c.size) if sizes_opt else k   # explicit per-level size keeps growth steady across sheets
        c = c.resize((max(1, round(c.width * kk)), max(1, round(c.height * kk))), Image.LANCZOS)
        c.save(os.path.join(out_dir, f'{name}-{start + i}.png'))
        sizes.append(c.size)
    print(name, sizes)


main()
