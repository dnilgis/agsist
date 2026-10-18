#!/usr/bin/env python3
"""share_cards.py: draws the site's share images (og:image), 1200 x 630 JPG.

Two looks, picked by Sig on 2026-10-15:

  A, the answer card: paper background, the real logo, the page's answer big
     (a number, or the title when a page has no single number), one line of
     context, an optional short table from the page's own data, and a green
     footer with the date and the page's address.
  C, picture from the data: the top of the card is a chart drawn from the
     page's data (a line, bars, a strip or a state tile map), and the answer
     sits in a green band under it with the logo.

Pillow only, no browser: these run inside the data workflows. Fonts are the
site's own (fonts/inter-var.woff2, fonts/jetbrains-mono-var.woff2), the logo
is img/logo-agsist-*.svg rendered once to scripts/cardfonts/logo-*.png.
Everything is drawn at 2x and scaled down, so text stays sharp when Messages
shrinks the card to about 260 points wide. No text on a card is smaller than
22 px at 1200 wide.

This file only draws. What goes on a card, and where the numbers come from,
is in scripts/build_share_images.py (and build_social_card.py and
build_prf_card.py for the daily and PRF cards).
"""
import io
import os

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = 2                      # drawing scale; cards are saved at 1200 x 630
W, H = 1200, 630
MAX_BYTES = 120 * 1024

PAPER = (246, 244, 238)
INK = (22, 26, 24)
GREEN = (22, 48, 31)       # the logo's green
GREEN2 = (46, 90, 60)
SAGE = (91, 138, 99)
GOLD = (138, 101, 20)      # site gold on light backgrounds
GOLD2 = (185, 138, 42)
GOLD_LT = (231, 196, 109)  # gold on the green band
CREAM = (246, 244, 238)
MUTED = (93, 101, 95)
BODY = (59, 66, 62)
RULE = (221, 219, 211)
GREY = (154, 163, 156)
RED = (166, 63, 40)
UP = (39, 107, 67)

FONT_FILES = {
    "inter": os.path.join(ROOT, "fonts", "inter-var.woff2"),
    "mono": os.path.join(ROOT, "fonts", "jetbrains-mono-var.woff2"),
}
LOGO_FILES = {
    "light": os.path.join(ROOT, "scripts", "cardfonts", "logo-onlight.png"),
    "dark": os.path.join(ROOT, "scripts", "cardfonts", "logo-ondark.png"),
}
_fonts = {}
_logos = {}


def font(family, size, weight=400):
    """family 'inter' or 'mono'; size in 1x pixels."""
    key = (family, size, weight)
    if key not in _fonts:
        f = ImageFont.truetype(FONT_FILES[family], int(round(size * S)))
        try:
            f.set_variation_by_axes([weight])
        except Exception:
            pass
        _fonts[key] = f
    return _fonts[key]


def logo(kind, height):
    key = (kind, height)
    if key not in _logos:
        im = Image.open(LOGO_FILES[kind]).convert("RGBA")
        im = im.crop(im.getbbox())
        w = round(im.width * height * S / im.height)
        _logos[key] = im.resize((w, int(height * S)), Image.LANCZOS)
    return _logos[key]


# ------------------------------------------------------------------ text tools

class Canvas:
    def __init__(self, bg=PAPER):
        self.im = Image.new("RGB", (W * S, H * S), bg)
        self.d = ImageDraw.Draw(self.im)

    def width(self, text, f, track=0):
        if not text:
            return 0
        w = self.d.textlength(text, font=f) / S
        return w + track * max(0, len(text) - 1)

    def text(self, x, y, text, f, fill, anchor="ls", track=0):
        """x, y in 1x pixels. anchor as Pillow's ('ls' = left, baseline)."""
        if not track:
            self.d.text((x * S, y * S), text, font=f, fill=fill, anchor=anchor)
            return
        if anchor[0] == "r":
            x -= self.width(text, f, track)
        a = "l" + anchor[1]
        for ch in text:
            self.d.text((x * S, y * S), ch, font=f, fill=fill, anchor=a)
            x += self.d.textlength(ch, font=f) / S + track

    def rect(self, x0, y0, x1, y1, fill, r=0):
        box = [x0 * S, y0 * S, x1 * S - 1, y1 * S - 1]
        if r:
            self.d.rounded_rectangle(box, radius=r * S, fill=fill)
        else:
            self.d.rectangle(box, fill=fill)

    def line(self, pts, fill, w):
        self.d.line([(x * S, y * S) for x, y in pts], fill=fill, width=int(w * S), joint="curve")

    def paste_logo(self, kind, x, y, height, anchor="lt"):
        lg = logo(kind, height)
        px = int(x * S) - (lg.width if anchor[0] == "r" else 0)
        py = int(y * S) - (lg.height if anchor[1] == "b" else 0)
        self.im.paste(lg, (px, py), lg)

    def wrap(self, text, f, maxw):
        words, lines, cur = text.split(), [], ""
        for w in words:
            t = (cur + " " + w).strip()
            if cur and self.width(t, f) > maxw:
                lines.append(cur)
                cur = w
            else:
                cur = t
        if cur:
            lines.append(cur)
        return lines

    def fit(self, text, family, weight, sizes, maxw, maxlines):
        """Largest size in sizes whose wrap fits maxlines; returns (font, size, lines)."""
        for sz in sizes:
            f = font(family, sz, weight)
            lines = self.wrap(text, f, maxw)
            if len(lines) <= maxlines and all(self.width(l, f) <= maxw for l in lines):
                return f, sz, lines
        f = font(family, sizes[-1], weight)
        return f, sizes[-1], self.wrap(text, f, maxw)[:maxlines]

    def rich(self, x, y, segs, f, maxw, maxlines, lh):
        """segs: [(text, color)]. Word-wraps across segments. Returns lines used."""
        words = []
        for t, c in segs:
            for w in t.split():
                words.append([w, c, True])
        lines, cur, curw = [], [], 0
        sp = self.width(" ", f)
        for w, c, glue in words:
            ww = self.width(w, f)
            add = ww + (sp if cur and glue else 0)
            if cur and curw + add > maxw:
                lines.append(cur)
                cur, curw = [], 0
                add = ww
            cur.append((w, c, glue and bool(cur)))
            curw += add
        if cur:
            lines.append(cur)
        if len(lines) > maxlines:
            return None
        for i, ln in enumerate(lines):
            cx = x
            for w, c, glue in ln:
                if glue:
                    cx += sp
                self.text(cx, y + i * lh, w, f, c)
                cx += self.width(w, f)
        return len(lines)

    def jpg(self):
        small = self.im.resize((W, H), Image.LANCZOS)
        return encode(small)


def encode(im):
    """Deterministic JPG under MAX_BYTES."""
    for q, sub in ((90, 0), (88, 0), (85, 0), (82, 0), (80, 2), (76, 2), (72, 2), (66, 2)):
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=q, optimize=True, progressive=True, subsampling=sub)
        if buf.tell() <= MAX_BYTES:
            return buf.getvalue()
    raise ValueError("card does not fit under %d bytes" % MAX_BYTES)


# ------------------------------------------------------------------ card A

def card_a(kicker, path, foot, big=None, unit=None, ctx=None, title=None,
           table=None, table_title=None, spark=None, spark_label=None):
    """The answer card.

    big     the answer as a short string ("$18.75", "54%"); or
    title   a headline when the page has no single answer number.
    unit    one bold line under the big number (what the number is).
    ctx     one plain line of context.
    table   [(label, value, unit_or_None)] shown on the right, up to 5 rows;
            value None prints unit_or_None as a quiet word ("not yet").
    spark   optional list of numbers drawn as a small line under the answer.
    foot    left footer text (the date the numbers are from).
    """
    c = Canvas(PAPER)
    PAD = 64
    c.paste_logo("light", PAD, 52, 60)
    c.text(W - PAD, 92, kicker.upper(), font("mono", 22, 700), GOLD, anchor="rs", track=3)
    top, bottom = 160, 548
    has_right = bool(table)
    lw = 540 if has_right else W - 2 * PAD
    if has_right:
        c.rect(640, top, 642, bottom - 40, RULE)
        _table(c, 684, top, W - PAD, table, table_title)

    for scale in (1.0, 0.92, 0.85, 0.78, 0.7):
        blocks = []
        if big:
            fb, sz, lines = c.fit(big, "inter", 800, [int(s * scale) for s in (136, 124, 112, 100, 88)], lw, 1)
            blocks.append(("big", fb, lines, int(sz * 0.96), GOLD))
        if title:
            ft, sz, lines = c.fit(title, "inter", 800, [int(s * scale) for s in ((84, 76, 68, 60, 54) if not has_right else (68, 62, 56, 50, 46))], lw, 3)
            blocks.append(("title", ft, lines, int(sz * 1.08), GREEN))
        if spark:
            blocks.append(("spark", None, None, int(110 * scale), None))
        if unit:
            fu, sz, lines = c.fit(unit, "inter", 700, [int(s * scale) for s in (36, 33, 30)], lw, 3)
            blocks.append(("unit", fu, lines, int(sz * 1.18), GREEN))
        if ctx:
            fc, sz, lines = c.fit(ctx, "inter", 400, [int(s * scale) for s in ((32, 30, 28) if not has_right else (29, 28, 26))], lw, 3)
            blocks.append(("ctx", fc, lines, int(sz * 1.32), BODY))
        total = 0
        for kind, f, lines, lh, col in blocks:
            total += lh * (len(lines) if lines else 1) + 16
        if total <= bottom - top:
            break

    y = top + max(0, (bottom - top - total) / 2 - 10)
    for kind, f, lines, lh, col in blocks:
        if kind == "spark":
            _spark(c, PAD, y + 8, lw, lh - 24, spark)
            if spark_label:
                c.text(PAD, y + lh + 2, spark_label, font("inter", 22, 400), MUTED)
                y += 28
            y += lh + 16
            continue
        asc = f.getmetrics()[0] / S
        for i, ln in enumerate(lines):
            c.text(PAD, y + asc + i * lh, ln, f, col)
        y += lh * len(lines) + 16

    c.rect(0, 566, W, H, GREEN)
    for sz in (26, 24, 22):
        ff, fp = font("inter", sz, 400), font("inter", sz, 700)
        if c.width(foot, ff) + c.width("agsist.com" + path, fp) + 40 <= W - 2 * PAD:
            break
    c.text(PAD, 607, foot, ff, CREAM)
    c.text(W - PAD, 607, "agsist.com" + path, fp, GOLD_LT, anchor="rs")
    return c.jpg()


def _table(c, x0, top, x1, rows, title):
    y = top + 18
    if title:
        c.text(x0, y, title.upper(), font("inter", 22, 700), MUTED, track=1.5)
        y += 22
    n = min(len(rows), 5)
    rh = 64 if n <= 4 else 58
    fl = font("inter", 30, 400)
    fv = font("mono", 30, 700)
    fu = font("inter", 26, 400)
    fq = font("inter", 28, 500)
    uw = max([c.width(u, fu) for _, v, u in rows[:n] if v is not None and u] or [0])
    vx = x1 - (uw + 10 if uw else 0)
    for i, (lab, val, u) in enumerate(rows[:n]):
        base = y + rh * (i + 1) - 20
        if val is None:
            c.text(x1, base, u or "", fq, MUTED, anchor="rs")
            room = x1 - x0 - c.width(u or "", fq) - 16
        else:
            c.text(vx, base, val, fv, INK, anchor="rs")
            if u:
                c.text(vx + 10, base, u, fu, MUTED)
            room = vx - x0 - c.width(val, fv) - 16
        f = fl
        for sz in (30, 28, 26, 24):
            f = font("inter", sz, 400)
            if c.width(lab, f) <= room:
                break
        c.text(x0, base, lab, f, INK)
        c.rect(x0, y + rh * (i + 1), x1, y + rh * (i + 1) + 1, RULE)


def _spark(c, x, y, w, h, vals, stroke=GREEN, sw=4):
    lo, hi = min(vals), max(vals)
    span = (hi - lo) or 1
    pts = [(x + i * w / (len(vals) - 1), y + h - (v - lo) / span * (h - 8) - 4) for i, v in enumerate(vals)]
    poly = pts + [(x + w, y + h), (x, y + h)]
    c.d.polygon([(px * S, py * S) for px, py in poly], fill=(239, 228, 205))
    c.line(pts, stroke, sw)
    ex, ey = pts[-1]
    r = sw * 1.7
    c.d.ellipse([(ex - r) * S, (ey - r) * S, (ex + r) * S, (ey + r) * S], fill=GOLD)


# ------------------------------------------------------------------ card C

def card_c(head, meta, caption, pic):
    """Picture from the data.

    head     [(text, highlight_bool)] for the band headline.
    meta     one quiet line under it (date, source, address).
    caption  what the picture is, top left.
    pic      (kind, dict) drawn in the top 430 px: 'line', 'hbars', 'strip',
             'tiles', 'yearbars' or 'number'.
    """
    c = Canvas(PAPER)
    c.rect(0, 430, W, H, GREEN)
    if caption:
        c.text(60, 50, caption.upper(), font("mono", 20, 700), GOLD, track=2.4)
    kind, p = pic
    {"line": _pic_line, "hbars": _pic_hbars, "strip": _pic_strip, "tiles": _pic_tiles,
     "yearbars": _pic_yearbars, "number": _pic_number}[kind](c, p)
    segs = [(t, GOLD_LT if hi else CREAM) for t, hi in head]
    for sz in (52, 48, 44, 40, 36):
        f = font("inter", sz, 800)
        n = c.rich(60, 430 + 30 + sz * 0.95, segs, f, 900, 2, sz * 1.08) if _rich_fits(c, segs, f, 900, 2) else None
        if n:
            break
    fm = font("inter", 22, 400)
    while c.width(meta, fm) > 860 and "  ·  " in meta:
        meta = meta.rsplit("  ·  ", 1)[0]
    c.text(60, 604, meta, fm, (205, 211, 204))
    c.paste_logo("dark", W - 58, 598, 60, anchor="rb")
    return c.jpg()


def _rich_fits(c, segs, f, maxw, maxlines):
    probe = Canvas.__new__(Canvas)
    probe.im, probe.d = c.im, c.d
    words = " ".join(t for t, _ in segs).split()
    lines, cur = 0, ""
    for w in words:
        t = (cur + " " + w).strip()
        if cur and c.width(t, f) > maxw:
            lines += 1
            cur = w
        else:
            cur = t
    return lines + (1 if cur else 0) <= maxlines


def _pic_line(c, p):
    """p: values, big, big_label, start_label, end_label, low_label?, high_label?"""
    vals = p["values"]
    x, y, w, h = 60, 150, 1080, 236
    if p.get("big"):
        c.text(W - 60, 104, p["big"], font("inter", 76, 800), GOLD, anchor="rs")
        c.text(W - 60, 138, p["big_label"], font("inter", 23, 400), MUTED, anchor="rs")
    _spark(c, x, y, w, h, vals, sw=6)
    fl = font("inter", 22, 400)
    c.text(x, 418, p.get("start_label", ""), fl, MUTED)
    c.text(x + w, 418, p.get("end_label", ""), fl, MUTED, anchor="rs")
    lo, hi = min(vals), max(vals)


def _pic_hbars(c, p):
    rows = p["rows"]                      # [(label, value, shown, highlight)]
    mx = max(v for _, v, _, _ in rows)
    y = 82
    rh = min(66, 330 // len(rows))
    fl, fv = font("inter", 28, 600), font("mono", 30, 700)
    for lab, v, shown, hl in rows:
        bw = v / mx * 600
        c.text(60, y + rh / 2 + 10, lab, fl, INK)
        c.rect(400, y + 12, 400 + bw, y + rh - 12, GOLD if hl else GREEN2, r=2)
        c.text(400 + bw + 14, y + rh / 2 + 11, shown, fv, INK)
        y += rh


def _pic_strip(c, p):
    segs = p["segments"]                  # [(label, value, color)]
    total = sum(v for _, v, _ in segs)
    x, y0, y1 = 60, 84, 254
    for i, (lab, v, col) in enumerate(segs):
        w = v / total * 1080
        c.rect(x, y0, x + w - (3 if i < len(segs) - 1 else 0), y1, col)
        if i == 0:
            c.text(x + 28, y0 + 46, lab, font("inter", 30, 700), CREAM)
            c.text(x + 28, y0 + 118, p["first_big"], font("inter", 64, 800), CREAM)
            c.text(x + 28, y0 + 154, p["first_small"], font("inter", 24, 400), (220, 228, 220))
        x += w
    if p.get("note"):
        c.text(60, 300, p["note"][0], font("inter", 26, 700), INK)
        c.text(60 + c.width(p["note"][0] + " ", font("inter", 26, 700)), 300, p["note"][1], font("inter", 26, 400), INK)
    if p.get("note2"):
        for i, ln in enumerate(c.wrap(p["note2"], font("inter", 24, 400), 740)[:3]):
            c.text(60, 340 + i * 32, ln, font("inter", 24, 400), BODY)
    ly = 290
    c.text(870, ly, p["legend_title"], font("inter", 23, 700), INK)
    for i, (num, lab) in enumerate(p["legend"]):
        yy = ly + 34 * (i + 1)
        c.text(870, yy, num, font("mono", 23, 700), INK)
        c.text(870 + c.width(num + " ", font("mono", 23, 700)), yy, lab, font("inter", 23, 400), INK)


TILE_GRID = {
    "AK": (0, 0), "ME": (10, 0), "WI": (5, 1), "VT": (9, 1), "NH": (10, 1),
    "WA": (0, 2), "ID": (1, 2), "MT": (2, 2), "ND": (3, 2), "MN": (4, 2), "IL": (5, 2), "MI": (6, 2),
    "NY": (8, 2), "MA": (9, 2),
    "OR": (0, 3), "NV": (1, 3), "WY": (2, 3), "SD": (3, 3), "IA": (4, 3), "IN": (5, 3), "OH": (6, 3),
    "PA": (7, 3), "NJ": (8, 3), "CT": (9, 3), "RI": (10, 3),
    "CA": (0, 4), "UT": (1, 4), "CO": (2, 4), "NE": (3, 4), "MO": (4, 4), "KY": (5, 4), "WV": (6, 4),
    "VA": (7, 4), "MD": (8, 4), "DE": (9, 4),
    "AZ": (1, 5), "NM": (2, 5), "KS": (3, 5), "AR": (4, 5), "TN": (5, 5), "NC": (6, 5), "SC": (7, 5),
    "OK": (3, 6), "LA": (4, 6), "MS": (5, 6), "AL": (6, 6), "GA": (7, 6),
    "HI": (0, 7), "TX": (3, 7), "FL": (8, 7),
}


def _pic_tiles(c, p):
    """p: counts {ST: n}, big, lines [str], tile scale max."""
    counts = p["counts"]
    mx = max(counts.values()) if counts else 1
    tile, gap, ox, oy = 46, 4, 560, 22
    a, b = GOLD_LT, GREEN
    for st, (col, row) in TILE_GRID.items():
        n = counts.get(st, 0)
        if n <= 0:
            bg, fg = (228, 226, 218), GREY
        else:
            t = min(1.0, (n / mx) ** 0.5)
            bg = tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))
            fg = CREAM if t > 0.45 else GREEN
        x0, y0 = ox + col * (tile + gap), oy + row * (tile + gap)
        c.rect(x0, y0, x0 + tile, y0 + tile, bg, r=3)
        c.text(x0 + tile / 2, y0 + tile / 2 + 1, st, font("inter", 16, 700), fg, anchor="mm")
    c.text(60, 196, p["big"], font("inter", 128, 800), GREEN)
    for i, ln in enumerate(p["lines"]):
        c.text(62, 252 + i * 38, ln, font("inter", 28, 400), INK)


def _pic_yearbars(c, p):
    """p: years [int], values [float], line (float or None), line_label, first, last"""
    vals = p["values"]
    x, y, w, h = 60, 128, 1080, 252
    mx = max(vals + [p.get("line") or 0]) or 1
    n = len(vals)
    bw = w / n
    for i, v in enumerate(vals):
        bh = v / mx * h
        if bh < 1:
            continue
        c.rect(x + i * bw + 1, y + h - bh, x + (i + 1) * bw - 2, y + h, GREEN2)
    c.rect(x, y + h, x + w, y + h + 2, GREY)
    if p.get("line"):
        ly = y + h - p["line"] / mx * h
        xx = x
        while xx < x + w:
            c.rect(xx, ly - 1, min(xx + 14, x + w), ly + 2, INK)
            xx += 24
        c.text(x + w, ly - 10, p["line_label"], font("inter", 22, 600), INK, anchor="rs")
    c.text(x, 418, str(p["first"]), font("inter", 22, 400), MUTED)
    c.text(x + w, 418, str(p["last"]), font("inter", 22, 400), MUTED, anchor="rs")
    if p.get("legend"):
        c.text(60, 86, p["legend"], font("inter", 23, 400), BODY)


def _pic_number(c, p):
    """The daily card: p: big, unit, table [(label, value, change, up_bool_or_None)], table_title."""
    lw = 600
    f, sz, lines = c.fit(p["big"], "inter", 800, [120, 108, 96, 84, 72, 60], lw, 1)
    c.text(60, 100 + sz * 0.95, lines[0], f, GOLD)
    fu, szu, ul = c.fit(p.get("unit") or "", "inter", 600, [32, 30, 28, 26], lw, 3)
    for i, ln in enumerate(ul):
        c.text(60, 100 + sz * 0.95 + 44 + i * szu * 1.2, ln, fu, INK)
    rows = p.get("table") or []
    if rows:
        x0, x1 = 720, W - 60
        c.rect(684, 90, 686, 400, RULE)
        c.text(x0, 104, p.get("table_title", "").upper(), font("inter", 22, 700), MUTED, track=1.5)
        for i, (lab, val, chg, up) in enumerate(rows[:4]):
            base = 104 + 70 * (i + 1) - 10
            c.text(x1, base, chg or "", font("mono", 23, 700), UP if up else (RED if up is False else MUTED), anchor="rs")
            vx = x1 - 104
            fv = font("mono", 27, 700)
            c.text(vx, base, val, fv, INK, anchor="rs")
            room = vx - c.width(val, fv) - 14 - x0
            for sz in (28, 26, 24, 22):
                fl = font("inter", sz, 500)
                if c.width(lab, fl) <= room:
                    break
            c.text(x0, base, lab, fl, INK)
            c.rect(x0, base + 22, x1, base + 23, RULE)


# ------------------------------------------------------------------ product cards

from PIL import ImageFilter  # noqa: E402

WALL_TOP = (238, 233, 223)
WALL_BOT = (224, 216, 202)


def _wall(c, x0=0, y0=0, x1=W, y1=H):
    """A soft warm wall: a top-to-bottom wash, drawn into the canvas."""
    h = int((y1 - y0) * S)
    for i in range(h):
        t = i / max(1, h - 1)
        col = tuple(round(WALL_TOP[k] + (WALL_BOT[k] - WALL_TOP[k]) * t) for k in range(3))
        c.d.line([(x0 * S, y0 * S + i), (x1 * S - 1, y0 * S + i)], fill=col)


def _framed(art, outer_w, frame=13, mat=0):
    """The print in a black frame (optionally matted), as RGBA, at drawing scale."""
    fw, mw = frame * S, mat * S
    iw = int(outer_w * S - 2 * fw - 2 * mw)
    ih = round(iw * art.height / art.width)
    out = Image.new("RGB", (iw + 2 * fw + 2 * mw, ih + 2 * fw + 2 * mw), (20, 20, 20))
    d = ImageDraw.Draw(out)
    # a hint of light on the frame's top and left edges
    d.rectangle([0, 0, out.width - 1, S * 2], fill=(52, 52, 52))
    d.rectangle([0, 0, S * 2, out.height - 1], fill=(40, 40, 40))
    if mw:
        d.rectangle([fw, fw, out.width - fw - 1, out.height - fw - 1], fill=(251, 250, 247))
    out.paste(art.resize((iw, ih), Image.LANCZOS), (fw + mw, fw + mw))
    # the glass's inner shadow along the top
    sh = Image.new("L", (iw, 3 * S), 0)
    for i in range(3 * S):
        ImageDraw.Draw(sh).line([(0, i), (iw, i)], fill=int(60 * (1 - i / (3 * S))))
    out.paste((0, 0, 0), (fw + mw, fw + mw, fw + mw + iw, fw + mw + 3 * S), sh)
    return out


def _paste_shadowed(c, im, x, y, blur=14, dy=10, alpha=95):
    """Paste im (drawing scale) at x, y (1x px) with a soft drop shadow."""
    pad = blur * 3 * S
    sh = Image.new("L", (im.width + 2 * pad, im.height + 2 * pad), 0)
    ImageDraw.Draw(sh).rectangle([pad, pad, pad + im.width, pad + im.height], fill=alpha)
    sh = sh.filter(ImageFilter.GaussianBlur(blur * S))
    px, py = int(x * S), int(y * S)
    c.im.paste((40, 30, 20), (px - pad, py - pad + dy * S), sh)
    c.im.paste(im, (px, py))


def card_print(art_path, head, sub, note, path, layout="side", photo=False):
    """A framed product picture on a warm wall, with a short selling band.

    art_path  the flat print (scripts/cardart/*.jpg), drawn by the product's own engine,
              or with photo=True a photo of a real framed print (img/photos/*.jpg),
              placed as it is with no frame drawn around it ('side' layout only)
    head      the selling line; sub, the price line; note, the small example label.
    layout    'side' (print left, words right), 'band' (print above a green
              band) or 'big' (print as large as it goes, words in a strip).
    """
    art = Image.open(art_path).convert("RGB")
    c = Canvas(PAPER)
    if layout == "side":
        _wall(c)
        if photo:
            fw = 728 * S
            fr = art.resize((fw, round(fw * art.height / art.width)), Image.LANCZOS)
        else:
            fr = _framed(art, 728, frame=14, mat=0)
        y = (H - 40 - fr.height / S) / 2
        _paste_shadowed(c, fr, 36, y)
        c.text(40, y + fr.height / S + 34, note, font("inter", 22, 500), MUTED)
        x0, maxw = 806, W - 806 - 40
        c.paste_logo("light", x0, 56, 54)
        fh, sz, lines = c.fit(head, "inter", 800, [58, 54, 50, 46, 42], maxw, 4)
        yy = 200 + sz
        for ln in lines:
            c.text(x0, yy, ln, fh, GREEN)
            yy += sz * 1.1
        c.text(x0, yy + 40, sub, font("inter", 40, 800), GOLD)
        c.text(x0, H - 46, "agsist.com" + path, font("inter", 24, 700), GREEN2)
    elif layout == "band":
        _wall(c, 0, 0, W, 452)
        fr = _framed(art, 600, frame=12)
        x = (W - fr.width / S) / 2
        _paste_shadowed(c, fr, x, 30, blur=12, dy=8)
        c.text(W - 40, 438, note, font("inter", 20, 500), MUTED, anchor="rs")
        c.rect(0, 452, W, H, GREEN)
        fh = font("inter", 46, 800)
        c.text(60, 520, head, fh, CREAM)
        c.text(60, 582, sub, font("inter", 34, 700), GOLD_LT)
        c.paste_logo("dark", W - 58, 590, 58, anchor="rb")
    else:  # big
        _wall(c)
        fr = _framed(art, 760, frame=15)
        _paste_shadowed(c, fr, 30, 40)
        fy = 40 + fr.height / S
        c.text(34, fy + 34, note, font("inter", 22, 500), MUTED)
        x0, maxw = 830, W - 830 - 40
        c.paste_logo("light", x0, 48, 50)
        fh, sz, lines = c.fit(head, "inter", 800, [50, 46, 42, 40, 38], maxw, 5)
        yy = 190 + sz
        for ln in lines:
            c.text(x0, yy, ln, fh, GREEN)
            yy += sz * 1.12
        c.text(x0, yy + 34, sub, font("inter", 34, 800), GOLD)
        c.text(x0, H - 46, "agsist.com" + path, font("inter", 23, 700), GREEN2)
    return c.jpg()


def card_photo(photo_path, head, sub, path, focus=0.5, zoom=1.0):
    """A product photo or render filling the left of the card, the answer on the right."""
    ph = Image.open(photo_path).convert("RGB")
    c = Canvas(PAPER)
    pw = 470
    tw, th = pw * S, H * S
    sc = max(tw / ph.width, th / ph.height) * zoom
    im = ph.resize((round(ph.width * sc), round(ph.height * sc)), Image.LANCZOS)
    left = int((im.width - tw) * focus)
    top = int((im.height - th) * 0.5)
    c.im.paste(im.crop((left, top, left + tw, top + th)), (0, 0))
    x0, maxw = pw + 64, W - pw - 64 - 60
    c.paste_logo("light", x0, 56, 58)
    fh, sz, lines = c.fit(head, "inter", 800, [64, 60, 56, 52, 48], maxw, 4)
    yy = 214 + sz
    for ln in lines:
        c.text(x0, yy, ln, fh, GREEN)
        yy += sz * 1.08
    fs = font("inter", 32, 700)
    for i, ln in enumerate(c.wrap(sub, fs, maxw)[:2]):
        c.text(x0, yy + 36 + i * 42, ln, fs, GOLD)
    c.rect(pw, 566, W, H, GREEN)
    c.text(W - 60, 607, "agsist.com" + path, font("inter", 24, 700), GOLD_LT, anchor="rs")
    return c.jpg()


# ------------------------------------------------------------------ rain maps

RAIN_STOPS = [(50, (122, 74, 30)), (75, (196, 150, 90)), (100, (250, 247, 236)),
              (125, (126, 166, 200)), (150, (37, 86, 140))]
NO_DATA = (236, 234, 228)
HATCH = (196, 194, 186)


def rain_color(pct):
    """Percent of a usual year to a fill: brown dry, sand usual, blue wet;
    None (no station, or no usual to compare) is hatched by draw_map."""
    if pct is None:
        return None
    p = max(RAIN_STOPS[0][0], min(RAIN_STOPS[-1][0], pct))
    for (a, ca), (b, cb) in zip(RAIN_STOPS, RAIN_STOPS[1:]):
        if p <= b:
            t = (p - a) / (b - a)
            return tuple(round(ca[i] + (cb[i] - ca[i]) * t) for i in range(3))
    return RAIN_STOPS[-1][1]


def _rings(geom, shift_east=False):
    polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
    out = []
    for poly in polys:
        ring = poly[0]
        if shift_east:
            ring = [(x - 360 if x > 0 else x, y) for x, y in ring]
        out.append(ring)
    return out


def albers(lat1, lat2, lat0, lon0):
    """An Albers equal-area projection (unit sphere) as a function (lon, lat) -> (x, y), y down."""
    import math
    r = math.radians
    n = (math.sin(r(lat1)) + math.sin(r(lat2))) / 2
    C = math.cos(r(lat1)) ** 2 + 2 * n * math.sin(r(lat1))
    rho0 = math.sqrt(C - 2 * n * math.sin(r(lat0))) / n

    def f(lon, lat):
        rho = math.sqrt(max(0.0, C - 2 * n * math.sin(r(lat)))) / n
        th = n * r(lon - lon0)
        return rho * math.sin(th), -(rho0 - rho * math.cos(th))
    return f


def fit_rings(items, box, proj):
    """items: [(rings in lon/lat, payload)]; box (x0, y0, x1, y1) in 1x px.
    Returns ([(rings in px, payload)], (x0, y0, x1, y1) actually used)."""
    pr = [([[proj(x, y) for x, y in ring] for ring in rings], pl) for rings, pl in items]
    xs = [p[0] for rings, _ in pr for ring in rings for p in ring]
    ys = [p[1] for rings, _ in pr for ring in rings for p in ring]
    minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)
    bx0, by0, bx1, by1 = box
    k = min((bx1 - bx0) / (maxx - minx), (by1 - by0) / (maxy - miny))
    ox = bx0 + ((bx1 - bx0) - (maxx - minx) * k) / 2
    oy = by0 + ((by1 - by0) - (maxy - miny) * k) / 2
    out = [([[(ox + (x - minx) * k, oy + (y - miny) * k) for x, y in ring] for ring in rings], pl) for rings, pl in pr]
    return out, (ox, oy, ox + (maxx - minx) * k, oy + (maxy - miny) * k)


def _poly_area(ring):
    a = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        a += x1 * y2 - x2 * y1
    return abs(a) / 2


def _hatch(w, h):
    """Grey with fine diagonal lines: a county with no number to shade."""
    im = Image.new("RGB", (w, h), NO_DATA)
    d = ImageDraw.Draw(im)
    step = 5 * S
    for k in range(-h, w, step):
        d.line([(k, h), (k + h, 0)], fill=HATCH, width=max(1, S))
    return im


def draw_map(c, shapes, outlines=(), edge=PAPER, edge_w=0.7, outline=(70, 74, 70), outline_w=1.6):
    """shapes: [(rings px, fill)]; drawn biggest first so a county inside
    another (an independent city) lands on top. fill None is hatched (no
    number). outlines: [rings px]."""
    flat = [(ring, fill) for rings, fill in shapes for ring in rings if len(ring) > 2]
    flat.sort(key=lambda rf: -_poly_area(rf[0]))
    mask = None
    for ring, fill in flat:
        pts = [(x * S, y * S) for x, y in ring]
        if fill is None:
            if mask is None:
                mask = Image.new("L", c.im.size, 0)
                md = ImageDraw.Draw(mask)
            md.polygon(pts, fill=255)
        else:
            if mask is not None:
                md.polygon(pts, fill=0)
            c.d.polygon(pts, fill=fill)
    if mask is not None:
        c.im.paste(_hatch(*c.im.size), (0, 0), mask)
    if edge_w:
        for ring, fill in flat:
            pts = [(x * S, y * S) for x, y in ring]
            c.d.line(pts + pts[:1], fill=edge, width=max(1, int(edge_w * S)))
    for rings in outlines:
        for ring in rings:
            pts = [(x * S, y * S) for x, y in ring]
            c.d.line(pts + pts[:1], fill=outline, width=max(1, int(outline_w * S)), joint="curve")


def _legend_ramp(c, x, y, w, h=16):
    lo, hi = RAIN_STOPS[0][0], RAIN_STOPS[-1][0]
    ww = w - 70
    for i in range(int(ww * S)):
        p = lo + (hi - lo) * i / (ww * S - 1)
        c.d.line([(x * S + i, y * S), (x * S + i, (y + h) * S - 1)], fill=rain_color(p))
    f = font("inter", 20, 500)
    for p, lab, a in ((lo, "50%", "ls"), (100, "usual", "ms"), (hi, "150%", "rs")):
        xx = x + (p - lo) / (hi - lo) * ww
        c.rect(xx - 1, y + h, xx + 1, y + h + 6, INK)
        c.text(xx, y + h + 28, lab, f, BODY, anchor=a)
    hx = x + ww + 22
    c.im.paste(_hatch(int(48 * S), int(h * S)), (int(hx * S), int(y * S)))
    c.text(hx + 24, y + h + 28, "none", f, BODY, anchor="ms")


def card_rain_map(head, meta, caption, big, big_label, line, shapes, outlines=(), edge_w=0.7,
                  box=(500, 34, 1150, 410), insets=()):
    """C-style card: the left third says the number, the map fills the right,
    the question sits in the green band.

    head        [(text, highlight)] for the band.
    big         the headline number ("112%") or None; big_label, up to 2 lines under it.
    line        one more short line (a count), or None.
    shapes      [(rings px, fill)] already fitted to box (fit_rings).
    insets      extra [(shapes, outlines)] drawn the same way (Alaska, Hawaii).
    """
    c = Canvas(PAPER)
    c.rect(0, 430, W, H, GREEN)
    c.text(60, 58, caption.upper(), font("mono", 20, 700), GOLD, track=2.2)
    draw_map(c, shapes, outlines, edge_w=edge_w)
    for sh, ol in insets:
        draw_map(c, sh, ol, edge_w=edge_w)
    fl, fb = font("inter", 26, 500), font("inter", 26, 700)
    y = 82
    if big:
        c.text(56, y + 96, big, font("inter", 100, 800), GREEN)
        y += 100
        for ln in c.wrap(big_label, fl, 410)[:2]:
            y += 34
            c.text(60, y, ln, fl, INK)
    if line:
        y += 14
        for ln in c.wrap(line, fb, 410)[:2]:
            y += 36
            c.text(60, y, ln, fb, INK)
    _legend_ramp(c, 60, max(y + 26, 330), 380)
    segs = [(t, GOLD_LT if hi else CREAM) for t, hi in head]
    # one line when it fits left of the logo, else two
    for sz, maxw, n in ((56, 910, 1), (52, 910, 1), (48, 910, 1), (52, 900, 2), (48, 900, 2), (44, 900, 2), (40, 900, 2)):
        f = font("inter", sz, 800)
        if _rich_fits(c, segs, f, maxw, n):
            y0 = 430 + (52 if n == 1 else 30) + sz * 0.95
            c.rich(60, y0, segs, f, maxw, n, sz * 1.08)
            break
    fm = font("inter", 22, 400)
    while c.width(meta, fm) > 860 and "  ·  " in meta:
        meta = meta.rsplit("  ·  ", 1)[0]
    c.text(60, 604, meta, fm, (205, 211, 204))
    c.paste_logo("dark", W - 58, 598, 60, anchor="rb")
    return c.jpg()
