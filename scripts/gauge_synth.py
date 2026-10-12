#!/usr/bin/env python3
"""Synthetic test photos for the /gauge-lab reader.

Renders the strip from data/gauge-strip.json with a 10:1 tube in front of it
and the water at a known level, then makes it look like a phone photo:
perspective, slight rotation, uneven light, a color cast, blur, noise and JPEG.
The last ten cases ("stress") are deliberately bad: weak magnification, wide
glare across the stripe, a small strip, heavy blur and noise.

The water model is our own guess at what a Schellbach stripe does: the stripe
is magnified 2-3x below the water, and narrows to a point at the surface from
both sides (two arrowheads meeting tip to tip). A thin dark meniscus band sits
just above the line. Real tubes need checking against this.

    python3 scripts/gauge_synth.py OUT_DIR [--seed 7]

Writes OUT_DIR/case_NN.jpg (for the browser), case_NN.ppm (the same decoded
JPEG pixels, for node) and truth.json. scripts/gauge_eval.mjs scores them.
Needs Pillow and numpy. Writes nothing inside the repo.
"""
import json
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPEC = json.load(open(os.path.join(ROOT, "data", "gauge-strip.json")))
BLUE = (0.12, 0.44, 0.82)
GL = [0.0]


def render_strip(spec, level, rng, ppi=150, ss=2, stress=False):
    """RGB float array of the strip with the tube and water drawn in."""
    P = ppi * ss
    W = int(round(spec["width"] * P))
    H = int(round((spec["y_max"] - spec["y_min"]) * P))
    xs = (np.arange(W) + 0.5) / P
    ys = spec["y_max"] - (np.arange(H) + 0.5) / P
    X, Y = np.meshgrid(xs, ys)
    img = np.ones((H, W, 3)) * np.array([0.97, 0.965, 0.95])

    # ticks
    lx0, lx1 = spec["ticks"]["left"]
    rx0, rx1 = spec["ticks"]["right"]
    for t in range(0, 101):
        y = t * spec["scale"]["minor"]
        ln = 0.6 if t % 10 == 0 else (0.3 if t % 5 == 0 else 0.15)
        th = 0.02 if t % 10 == 0 else 0.012
        r0 = int(round((spec["y_max"] - y - th / 2) * P))
        r1 = int(round((spec["y_max"] - y + th / 2) * P))
        img[r0:r1, int(round((lx1 - ln) * P)):int(round(lx1 * P))] = 0.05
        img[r0:r1, int(round(rx0 * P)):int(round((rx0 + ln) * P))] = 0.05

    # markers
    m = spec["markers"]
    for k in ("tl", "tr", "bl", "br"):
        cx, cy = m[k]
        sq = (np.abs(X - cx) <= m["size"] / 2) & (np.abs(Y - cy) <= m["size"] / 2)
        hole = (np.abs(X - cx) <= m["hole"] / 2) & (np.abs(Y - cy) <= m["hole"] / 2)
        img[sq & ~hole] = 0.04

    # tube, water, stripe
    tx0, tx1 = spec["tube"]["x0"], spec["tube"]["x1"]
    tube = (X >= tx0) & (X <= tx1) & (Y >= -0.25)
    inner = (X >= tx0 + 0.06) & (X <= tx1 - 0.06) & (Y >= -0.2)
    sx, base = spec["stripe"]["x"], spec["stripe"]["width"]
    mag = rng.uniform(1.5, 3.0) if not stress else rng.uniform(1.15, 1.5)
    hu, hl = rng.uniform(0.06, 0.12), rng.uniform(0.08, 0.16)
    L = level
    half = np.full(Y.shape, base / 2)
    if L > 0:
        wide = base * mag / 2
        a = (Y >= L) & (Y < L + hu)
        half[a] = base / 2 * (Y[a] - L) / hu
        b = (Y < L) & (Y >= L - hl)
        half[b] = wide * (L - Y[b]) / hl
        half[Y < L - hl] = wide
    stripe = (np.abs(X - sx) <= half) & (Y >= spec["scale"]["zero_y"] - 0.25) & (Y <= spec["y_max"])
    img[stripe] = BLUE
    if L > 0:
        water = inner & (Y < L)
        img[water] *= np.array([0.92, 0.96, 0.99])
        men = inner & (Y >= L) & (Y < L + 0.035) & ~stripe
        img[men] *= 0.72
    walls = tube & ~inner
    img[walls] *= 0.78
    # a vertical highlight on the tube; one time in three it lies across the stripe edge
    gx = sx + rng.choice([-1, 1]) * rng.uniform(0.02, 0.08) if rng.uniform() < (0.33 if not stress else 0.7) else rng.uniform(0.9, 1.15)
    gw = rng.uniform(0.015, 0.04) if not stress else rng.uniform(0.03, 0.07)
    glare = tube & (np.abs(X - gx) < gw)
    img[glare] = img[glare] * 0.3 + 0.7

    GL[0] = gx
    out = Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8))
    d = ImageDraw.Draw(out)
    try:
        font = ImageFont.load_default(size=int(0.13 * P))
    except TypeError:
        font = ImageFont.load_default()
    for t in range(10, 101, 10):
        y = t * spec["scale"]["minor"]
        row = (spec["y_max"] - y) * P
        d.text((0.1 * P, row - 0.18 * P), "%.2f" % (t / 100), fill=(20, 20, 20), font=font)
    out = out.resize((W // ss, H // ss), Image.LANCZOS)
    return out


def persp_coeffs(dst, src):
    """PIL PERSPECTIVE coefficients mapping output (dst) to input (src)."""
    A, b = [], []
    for (x, y), (u, v) in zip(dst, src):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.append(u)
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y]); b.append(v)
    return np.linalg.solve(np.array(A, float), np.array(b, float)).tolist()


def photo(strip, rng, kind, size=(1200, 1600)):
    Wp, Hp = size
    sw, sh = strip.size
    p = {}
    if kind == "small":
        frac = rng.uniform(0.42, 0.5)
    elif kind == "sideways":
        frac = rng.uniform(0.55, 0.65)
    elif kind == "stress":
        frac = rng.uniform(0.4, 0.6)
    else:
        frac = rng.uniform(0.62, 0.9)
    th = math.radians(rng.uniform(-8, 8))
    keystone = rng.uniform(0.75, 1.15) if kind != "steep" else 0.68
    hh = frac * Hp
    hw = hh * sw / sh
    cx = Wp / 2 + rng.uniform(-90, 90)
    cy = Hp / 2 + rng.uniform(-50, 50)
    if kind == "cropped":
        cy += Hp * 0.22
    corners = [(-hw / 2 * keystone, -hh / 2), (hw / 2 * keystone, -hh / 2), (hw / 2, hh / 2), (-hw / 2, hh / 2)]
    dst = []
    for (x, y) in corners:
        x += rng.uniform(-0.012, 0.012) * hh
        y += rng.uniform(-0.012, 0.012) * hh
        xr = x * math.cos(th) - y * math.sin(th)
        yr = x * math.sin(th) + y * math.cos(th)
        dst.append((cx + xr, cy + yr))
    if kind == "sideways":
        dst = [(cx + (y - cy), cy - (x - cx)) for (x, y) in dst]
    src = [(0, 0), (sw, 0), (sw, sh), (0, sh)]
    co = persp_coeffs(dst, src)
    warped = strip.convert("RGBA").transform(size, Image.PERSPECTIVE, co, Image.BICUBIC)

    # background: low-frequency mottled surface
    small = rng.uniform(0, 1, (12, 9, 3))
    bgcol = np.array(rng.choice([[0.45, 0.36, 0.26], [0.55, 0.55, 0.52], [0.3, 0.33, 0.28], [0.62, 0.5, 0.36]]))
    bg = Image.fromarray((np.clip(bgcol + (small - 0.5) * 0.2, 0, 1) * 255).astype(np.uint8)).resize(size, Image.BICUBIC)
    bg.paste(warped, (0, 0), warped)
    a = np.asarray(bg).astype(float) / 255

    # light: gradient, brightness, color cast
    ang = rng.uniform(0, 2 * math.pi)
    yy, xx = np.mgrid[0:Hp, 0:Wp]
    t = ((xx - Wp / 2) * math.cos(ang) + (yy - Hp / 2) * math.sin(ang)) / (Hp / 2)
    span = rng.uniform(0.1, 0.5)
    bright = rng.uniform(0.6, 1.2) if kind != "dark" else 0.38
    cast = rng.uniform(-0.08, 0.12)
    g = bright * (1 + span * t)[..., None]
    a = a * g * np.array([1 + cast, 1, 1 - cast])
    img = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8))
    blur = {"blurry": 3.2, "stress": rng.uniform(2.0, 3.5)}.get(kind, rng.uniform(0.3, 2.2))
    img = img.filter(ImageFilter.GaussianBlur(blur))
    a = np.asarray(img).astype(float)
    noise = rng.uniform(2, 10) if kind != "stress" else rng.uniform(10, 16)
    a = a + rng.normal(0, noise, a.shape)
    img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    p.update(frac=round(frac, 3), rot_deg=round(math.degrees(th), 2), keystone=round(keystone, 3),
             bright=round(bright, 2), cast=round(cast, 3), blur=round(blur, 2), noise=round(noise, 1))
    return img, p


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    out = sys.argv[1]
    seed = int(sys.argv[sys.argv.index("--seed") + 1]) if "--seed" in sys.argv else 7
    os.makedirs(out, exist_ok=True)
    rng = np.random.default_rng(seed)
    kinds = ["normal"] * 24 + ["small", "steep", "dark", "blurry", "cropped", "sideways"] + ["stress"] * 10
    fixed = {0: 0.0, 1: 0.05, 2: 0.42, 3: 0.97, 4: 0.01, 5: 0.5}
    truth = []
    for i, kind in enumerate(kinds):
        rain = fixed.get(i, round(float(rng.uniform(0.02, 0.98)), 2))
        strip = render_strip(SPEC, rain * SPEC["ratio"], rng, stress=(kind == "stress"))
        img, p = photo(strip, rng, kind)
        q = int(rng.uniform(50, 92))
        name = "case_%02d" % i
        jp = os.path.join(out, name + ".jpg")
        img.save(jp, quality=q)
        back = Image.open(jp).convert("RGB")
        with open(os.path.join(out, name + ".ppm"), "wb") as f:
            f.write(b"P6\n%d %d\n255\n" % back.size)
            f.write(back.tobytes())
        p["jpeg_q"] = q
        p["glare_x"] = round(float(GL[0]), 3)
        truth.append({"name": name, "rain": rain, "kind": kind,
                      "expect": "fail" if kind in ("cropped", "sideways") else "read", "params": p})
    json.dump(truth, open(os.path.join(out, "truth.json"), "w"), indent=1)
    print("wrote %d cases to %s" % (len(truth), out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
