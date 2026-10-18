#!/usr/bin/env python3
"""Turn a phone photo of a framed Rain Print into web images.

One command per photo:

    python3 scripts/process_photo.py PHOTO.jpg NAME [--rectify] [--crop x0,y0,x1,y1] [--quad x,y,x,y,x,y,x,y]

It finds the black frame, crops to it plus a little wall, evens out the white
balance from the paper, sets a gentle exposure, strips all metadata (EXIF, GPS)
and writes img/photos/NAME-<w>.webp and .jpg at up to 1600 px and 800 px wide.
It prints the <picture> markup to paste into a page.

--rectify  squares up an angled shot: the paper window is mapped to a flat
           19:13 rectangle (a plane-to-plane warp; nothing on the print is
           redrawn or retouched).
--crop     a box in the source photo's pixels, when the automatic crop is not
           what you want (for example to keep a picture above it on the wall).
--quad     the paper window's corners (top-left, top-right, bottom-right,
           bottom-left) in source pixels, if the automatic find misses.

What it never does: paint over the print, remove glare, or touch any word or
number on it. Only whole-image color, exposure and geometry change.
"""
import argparse
import io
import os
import sys

import numpy as np
from PIL import Image, ImageOps
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "img", "photos")
WIDTHS = (1600, 800)
MAX_BYTES_LG = 250_000
PAPER_RATIO = 18.6 / 12.6  # visible paper inside a 13 x 19 frame's rabbet


def lum(a):
    return 0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]


def find_frame(a):
    """Largest dark, low-color blob = the black frame. Returns (frame mask, paper mask)."""
    l = lum(a)
    sat = a.max(axis=2) - a.min(axis=2)
    dark = (l < 70) & (sat < 40)
    dark = ndimage.binary_opening(dark, iterations=2)
    lab, n = ndimage.label(dark)
    if n == 0:
        sys.exit("no dark frame found; pass --crop and/or --quad")
    sizes = ndimage.sum(dark, lab, range(1, n + 1))
    frame = lab == (int(np.argmax(sizes)) + 1)
    filled = ndimage.binary_fill_holes(frame)
    inner = filled & ~frame
    lab2, n2 = ndimage.label(inner)
    if n2 == 0:
        sys.exit("frame has no paper window; pass --quad")
    sizes2 = ndimage.sum(inner, lab2, range(1, n2 + 1))
    paper = ndimage.binary_fill_holes(lab2 == (int(np.argmax(sizes2)) + 1))
    if paper.sum() < 0.05 * a.shape[0] * a.shape[1]:
        sys.exit("paper window too small; pass --quad")
    return frame, paper


def corners(mask):
    ys, xs = np.nonzero(mask)
    s, d = xs + ys, xs - ys
    tl = (xs[s.argmin()], ys[s.argmin()])
    br = (xs[s.argmax()], ys[s.argmax()])
    tr = (xs[d.argmax()], ys[d.argmax()])
    bl = (xs[d.argmin()], ys[d.argmin()])
    return np.array([tl, tr, br, bl], dtype=float)


def homography(src, dst):
    """3x3 H with dst ~ H @ src."""
    A = []
    for (x, y), (u, v) in zip(src, dst):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y, -u])
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y, -v])
    _, _, vt = np.linalg.svd(np.array(A))
    H = vt[-1].reshape(3, 3)
    return H / H[2, 2]


def rectify(img, quad, margin):
    q = quad
    w_px = (np.linalg.norm(q[1] - q[0]) + np.linalg.norm(q[2] - q[3])) / 2
    h_px = (np.linalg.norm(q[3] - q[0]) + np.linalg.norm(q[2] - q[1])) / 2
    pw = int(round(max(w_px, h_px * PAPER_RATIO)))  # never shrink the long side
    ph = int(round(pw / PAPER_RATIO))
    mx, my = int(pw * margin), int(ph * margin * PAPER_RATIO)
    W, H = pw + 2 * mx, ph + 2 * my
    dst = np.array([[mx, my], [mx + pw, my], [mx + pw, my + ph], [mx, my + ph]], float)
    Hinv = homography(dst, q)  # output -> input, what PIL wants
    coeffs = (Hinv.flatten() / Hinv[2, 2])[:8]
    out = img.transform((W, H), Image.PERSPECTIVE, tuple(coeffs), Image.BICUBIC)
    # paper mask in output space, for color reference
    pm = np.zeros((H, W), bool)
    pm[my:my + ph, mx:mx + pw] = True
    # Trim any edge the source photo did not cover (no black wedges).
    cov = np.asarray(Image.new("L", img.size, 255).transform(
        (W, H), Image.PERSPECTIVE, tuple(coeffs), Image.NEAREST)) > 0
    x0, y0, x1, y1 = 0, 0, W, H
    while True:
        c = cov[y0:y1, x0:x1]
        if c.all():
            break
        bad = {"t": (~c[0]).sum(), "b": (~c[-1]).sum(), "l": (~c[:, 0]).sum(), "r": (~c[:, -1]).sum()}
        side = max(bad, key=bad.get)
        if side == "t": y0 += 1
        elif side == "b": y1 -= 1
        elif side == "l": x0 += 1
        else: x1 -= 1
    return out.crop((x0, y0, x1, y1)), pm[y0:y1, x0:x1]


def tone(img, paper_mask):
    a = np.asarray(img).astype(np.float32)
    p = a[paper_mask]
    pl = lum(p)
    lo, hi = np.percentile(pl, [60, 97])  # paper, not ink, not the brightest glare
    ref = p[(pl >= lo) & (pl <= hi)].mean(axis=0)
    # White balance: move the paper 85% of the way to neutral; keeps a little warmth.
    gray = ref.mean()
    gain = 1 + 0.85 * (gray / ref - 1)
    a = a * gain
    # Exposure: paper lands near 238, deep blacks near 10. Gentle, whole image.
    l = lum(a)
    black = np.percentile(l, 0.5)
    paper_l = lum((ref * gain)[None, :])[0]
    scale = (238 - 10) / max(paper_l - black, 1)
    a = (a - black) * scale + 10
    # Mild S-curve for contrast.
    x = np.clip(a / 255, 0, 1)
    x = x + 0.25 * x * (1 - x) * (2 * x - 1)
    return Image.fromarray(np.clip(x * 255, 0, 255).astype(np.uint8))


def save(img, path_noext, w):
    if img.width > w:
        img = img.resize((w, round(img.height * w / img.width)), Image.LANCZOS)
    sizes = {}
    for q in (80, 76, 72, 68, 64, 60):
        b = io.BytesIO()
        img.save(b, "WEBP", quality=q, method=6)
        if b.tell() <= MAX_BYTES_LG or q == 60:
            break
    open(path_noext + ".webp", "wb").write(b.getvalue())
    sizes["webp"] = b.tell()
    for q in (82, 78, 74, 70, 66, 62):
        b = io.BytesIO()
        img.save(b, "JPEG", quality=q, optimize=True, progressive=True)
        if b.tell() <= MAX_BYTES_LG or q == 62:
            break
    open(path_noext + ".jpg", "wb").write(b.getvalue())
    sizes["jpg"] = b.tell()
    return img.size, sizes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("name")
    ap.add_argument("--rectify", action="store_true")
    ap.add_argument("--crop")
    ap.add_argument("--quad")
    ap.add_argument("--margin", type=float, default=0.14)
    args = ap.parse_args()

    img = ImageOps.exif_transpose(Image.open(args.src)).convert("RGB")  # new image, no metadata
    img = Image.frombytes("RGB", img.size, img.tobytes())
    a = np.asarray(img)

    if args.quad:
        v = [float(t) for t in args.quad.split(",")]
        quad = np.array(v, float).reshape(4, 2)
        paper = None
    else:
        frame, paper = find_frame(a)
        quad = corners(paper)

    if args.rectify:
        img, pmask = rectify(img, quad, args.margin)
    else:
        if args.crop:
            x0, y0, x1, y1 = [int(t) for t in args.crop.split(",")]
        else:
            fx = corners(ndimage.binary_fill_holes(frame)) if paper is not None else quad
            x0, y0 = fx.min(axis=0)
            x1, y1 = fx.max(axis=0)
            pad = int(args.margin * 0.5 * (x1 - x0))
            x0, y0 = max(0, int(x0) - pad), max(0, int(y0) - pad)
            x1, y1 = min(img.width, int(x1) + pad), min(img.height, int(y1) + pad)
        if paper is None:
            paper = np.zeros(a.shape[:2], bool)
            qx0, qy0 = quad.min(axis=0).astype(int)
            qx1, qy1 = quad.max(axis=0).astype(int)
            paper[qy0:qy1, qx0:qx1] = True
        img = img.crop((x0, y0, x1, y1))
        pmask = paper[y0:y1, x0:x1]

    img = tone(img, pmask)
    os.makedirs(OUT_DIR, exist_ok=True)
    out = {}
    for w in WIDTHS:
        (rw, rh), sizes = save(img, os.path.join(OUT_DIR, f"{args.name}-{w}"), w)
        out[w] = (rw, rh)
        print(f"img/photos/{args.name}-{w}: {rw}x{rh} webp {sizes['webp']//1000} KB, jpg {sizes['jpg']//1000} KB")
    (lw, lh), (sw, _) = out[WIDTHS[0]], out[WIDTHS[1]]
    n = args.name
    print("\nMarkup:")
    print(f'<picture><source type="image/webp" srcset="/img/photos/{n}-800.webp {sw}w, /img/photos/{n}-1600.webp {lw}w" '
          f'sizes="(max-width: 700px) 100vw, 600px"><img src="/img/photos/{n}-800.jpg" '
          f'srcset="/img/photos/{n}-800.jpg {sw}w, /img/photos/{n}-1600.jpg {lw}w" sizes="(max-width: 700px) 100vw, 600px" '
          f'width="{lw}" height="{lh}" loading="lazy" decoding="async" alt="WRITE A TRUE ALT"></picture>')


if __name__ == "__main__":
    main()
