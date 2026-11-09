"""Split a transparent grid sprite sheet into individual trimmed sprites.

usage: python3 -I split_sheet.py SHEET.png OUT_DIR name1,name2,... --grid 5,5 [--max-side 480] [--alpha 40]

--grid lists how many objects each row holds (top to bottom). Row and column cuts are placed
at the emptiest line near the ideal grid position, so objects that almost touch still split
cleanly and detached bits (sparkles, bubbles) stay with their cell.
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
    args = sys.argv[1:]
    sheet, out_dir, names = args[0], args[1], args[2].split(',')
    opts = dict(zip(args[3::2], args[4::2]))
    grid = [int(v) for v in opts['--grid'].split(',')]
    max_side = int(opts.get('--max-side', 480))
    thr = int(opts.get('--alpha', 40))
    im = Image.open(sheet).convert('RGBA')
    alpha = np.array(im)[:, :, 3]
    mask = alpha > thr
    rows_proj = mask.sum(1).astype(float)
    top, bot = extent(rows_proj)
    rcuts = cut_positions(rows_proj, len(grid), top, bot)
    os.makedirs(out_dir, exist_ok=True)
    i = 0
    for r, ncol in enumerate(grid):
        y0, y1 = rcuts[r], rcuts[r + 1]
        band = mask[y0:y1]
        cols_proj = band.sum(0).astype(float)
        left, right = extent(cols_proj)
        ccuts = cut_positions(cols_proj, ncol, left, right)
        for c in range(ncol):
            if i >= len(names):
                break
            x0, x1 = ccuts[c], ccuts[c + 1]
            cell = im.crop((x0, y0, x1, y1))
            a = np.array(cell)[:, :, 3]
            ys, xs = np.nonzero(a > 8)
            if len(ys):
                cell = cell.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
            cell.thumbnail((max_side, max_side), Image.LANCZOS)
            cell.save(os.path.join(out_dir, names[i] + '.png'))
            print(f'  {names[i]:16s} {cell.size}  cell x{x0}-{x1} y{y0}-{y1}')
            i += 1
    if i != len(names):
        print(f'WARNING: grid has {i} cells for {len(names)} names')


main()
