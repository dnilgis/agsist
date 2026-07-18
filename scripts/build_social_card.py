#!/usr/bin/env python3
"""build_social_card.py — render the day's briefing as a shareable PNG.

Reads  : data/daily.json  (headline, one_number, meta.market_mood, date)
         data/scorecard.json  (played_out / didnt — the public record)
Writes : data/social/card-YYYY-MM-DD.png   (dated, permanent)
         data/social/card-latest.png       (stable URL for og:image later)

Runs AFTER GATE 2 in daily.yml, so a card is only ever rendered from a
briefing that passed every gate. If the briefing was blocked, no card.

Design: approved mockup 2026-07-18 (Sig). 1200x675 layout rendered at 2x
(2400x1350) for retina. Terminal-dark palette lifted from the site:
bg #0a0c0d, panel #101415, text #e6ebe9, muted #8a948f, gold #d4a23f,
green #5fc28a, red #e0685f. DejaVu Sans / DejaVu Sans Mono — present on
GitHub ubuntu runners (fonts-dejavu-core) and close cousins of the site's
Inter / JetBrains Mono pairing.

Deliberately dependency-light: Pillow only. No browser, no webfonts, no
network. A social card must never be the reason the briefing fails to
publish — so main() traps everything and exits 0 with a loud message;
daily.yml treats it as best-effort (continue-on-error as belt+braces).

Failure honesty: if the scorecard can't be read, the footer says so rather
than inventing a record. Same doctrine as everything else here: no number
appears unless it was measured.
"""
import json
import os
import sys
from datetime import datetime, timezone

# ---------------------------------------------------------------- palette
BG      = (10, 12, 13)      # #0a0c0d
PANEL   = (16, 20, 21)      # #101415
BORDER  = (26, 31, 32)      # #1a1f20
TEXT    = (230, 235, 233)   # #e6ebe9
MUTED   = (138, 148, 143)   # #8a948f
GOLD    = (212, 162, 63)    # #d4a23f
GREEN   = (95, 194, 138)    # #5fc28a
RED     = (224, 104, 95)    # #e0685f

MOOD_COLOR = {"BULLISH": GREEN, "BEARISH": RED, "MIXED": GOLD,
              "CAUTIOUS": GOLD, "VOLATILE": RED}

# 2x canvas — all pixel values below are already doubled from the 1200x675 comp.
W, H = 2400, 1350
MARGIN = 112                      # 56px @1x

FONT_DIRS = (
    "/usr/share/fonts/truetype/dejavu",          # ubuntu runner + most distros
    "/usr/share/fonts/dejavu",                    # some minimal images
    os.path.join(os.path.dirname(__file__), "fonts"),  # last-resort repo bundle
)


def _font(name, size):
    from PIL import ImageFont
    for d in FONT_DIRS:
        p = os.path.join(d, name)
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    raise FileNotFoundError(
        "%s not found — install fonts-dejavu-core (apt) or add scripts/fonts/" % name)


def _wrap(draw, text, font, max_w):
    """Greedy word-wrap to max_w pixels; returns list of lines."""
    lines, cur = [], ""
    for word in text.split():
        trial = (cur + " " + word).strip()
        if draw.textlength(trial, font=font) <= max_w or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines


def _tracked(draw, xy, text, font, fill, tracking):
    """Draw text with letter-spacing (Pillow has none natively)."""
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=font, fill=fill)
        x += draw.textlength(ch, font=font) + tracking
    return x - tracking  # right edge


def build(daily_path="data/daily.json", scorecard_path="data/scorecard.json",
          out_dir="data/social"):
    from PIL import Image, ImageDraw

    daily = json.load(open(daily_path, encoding="utf-8"))
    headline = (daily.get("headline") or "").strip() or "AGSIST DAILY BRIEFING"
    one = daily.get("one_number") or {}
    num_val = str(one.get("value", "")).strip()
    num_unit = str(one.get("unit", "")).strip()
    date_str = (daily.get("date") or datetime.now(timezone.utc).strftime("%A, %B %d, %Y")).upper()
    mood = str(((daily.get("meta") or {}).get("market_mood")) or "").upper().strip()

    # Public record. Absent/broken scorecard -> honest fallback, never invented.
    score_line = "WE GRADE OUR OWN CALLS — DAILY, IN PUBLIC. NO MEMORY-HOLING."
    score_bold = None
    try:
        sc = json.load(open(scorecard_path, encoding="utf-8"))
        judged = int(sc["played_out"]) + int(sc["didnt"])
        if judged > 0:
            score_line = "WE GRADE OUR OWN CALLS — "
            score_bold = "%d of %d" % (int(sc["played_out"]), judged)
    except Exception:
        pass

    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    # gold top rule
    d.rectangle([0, 0, W, 12], fill=GOLD)

    mono_b_52 = _font("DejaVuSansMono-Bold.ttf", 52)
    mono_40   = _font("DejaVuSansMono.ttf", 40)
    mono_34   = _font("DejaVuSansMono.ttf", 34)
    mono_32   = _font("DejaVuSansMono-Bold.ttf", 32)
    mono_b152 = _font("DejaVuSansMono-Bold.ttf", 152)
    sans_46   = _font("DejaVuSans.ttf", 46)
    sans_38   = _font("DejaVuSans.ttf", 38)
    sans_b38  = _font("DejaVuSans-Bold.ttf", 38)
    sans_42   = _font("DejaVuSans.ttf", 42)

    # ---- top bar: brand left, date + mood chip right
    top_y = 80
    _tracked(d, (MARGIN, top_y), "AGSIST DAILY", mono_b_52, GOLD, 12)

    right = W - MARGIN
    if mood:
        chip_font = mono_32
        chip_w = d.textlength(" ".join(mood), font=chip_font) + 56  # approx tracked width
        chip_h = 66
        cx0 = right - chip_w
        cy0 = top_y - 6
        col = MOOD_COLOR.get(mood, MUTED)
        d.rounded_rectangle([cx0, cy0, right, cy0 + chip_h], radius=8,
                            outline=col, width=3)
        _tracked(d, (cx0 + 28, cy0 + 16), mood, chip_font, col, 8)
        right = cx0 - 36
    date_track = 4
    date_w = sum(d.textlength(c, font=mono_40) + date_track for c in date_str) - date_track
    _tracked(d, (right - date_w, top_y + 8), date_str, mono_40, MUTED, date_track)

    # ---- headline: uppercase, up to 3 lines, shrink-to-fit
    head = headline.upper()
    max_w = W - 2 * MARGIN
    size = 128
    while size >= 72:
        f = _font("DejaVuSans-Bold.ttf", size)
        lines = _wrap(d, head, f, max_w)
        if len(lines) <= (2 if size > 96 else 3):
            break
        size -= 8
    hy = 220
    for ln in lines:
        d.text((MARGIN, hy), ln, font=f, fill=TEXT)
        hy += int(size * 1.12)

    # ---- THE NUMBER panel (height fits its content — unit never kisses the edge)
    py0 = max(hy + 70, 560)
    vf = mono_b152
    if d.textlength(num_val, font=vf) > (W - 2 * MARGIN - 140):
        vf = _font("DejaVuSansMono-Bold.ttf", 110)
    v_h = 152 if vf is mono_b152 else 110
    unit_lines = _wrap(d, num_unit, sans_46, W - 2 * MARGIN - 160)[:2]
    ph = 96 + v_h + 40 + 58 * len(unit_lines) + 48

    d.rectangle([MARGIN, py0, W - MARGIN, py0 + ph], fill=PANEL)
    d.rectangle([MARGIN, py0, W - MARGIN, py0 + ph], outline=BORDER, width=2)
    d.rectangle([MARGIN, py0, MARGIN + 8, py0 + ph], fill=GOLD)

    ix = MARGIN + 68
    _tracked(d, (ix, py0 + 44), "THE NUMBER", mono_32, GOLD, 14)
    d.text((ix - 8, py0 + 96), num_val, font=vf, fill=TEXT)
    uy = py0 + 96 + v_h + 40
    for ln in unit_lines:
        d.text((ix, uy), ln, font=sans_46, fill=MUTED)
        uy += 58

    # ---- footer: flowing mixed-weight text, wrapped clear of the site mark
    fy = H - 170
    d.line([0, fy, W, fy], fill=BORDER, width=2)

    site = "agsist.com · FREE"
    site_w = d.textlength(site, font=sans_42)

    if score_bold:
        segs = [(score_line, sans_38, MUTED), (score_bold, sans_b38, TEXT),
                (" played out, judged daily in public. No memory-holing.",
                 sans_38, MUTED)]
    else:
        segs = [(score_line, sans_38, MUTED)]

    # word-level flow across segments, max 2 lines, never under the site mark
    flow_max = W - 2 * MARGIN - site_w - 100
    words = []
    for text, font, color in segs:
        parts = text.split(" ")
        for i, p in enumerate(parts):
            if p == "":
                continue
            words.append((p, font, color))
    x, ty, line = MARGIN, fy + 34, 0
    space = d.textlength(" ", font=sans_38)
    for wtext, font, color in words:
        wlen = d.textlength(wtext, font=font)
        if x + wlen > MARGIN + flow_max and line == 0:
            x, ty, line = MARGIN, ty + 52, 1
        d.text((x, ty), wtext, font=font, fill=color)
        x += wlen + space

    d.text((W - MARGIN - site_w, fy + 56), site, font=sans_42, fill=GOLD)

    # ---- write outputs
    os.makedirs(out_dir, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    dated = os.path.join(out_dir, "card-%s.png" % stamp)
    latest = os.path.join(out_dir, "card-latest.png")
    img.save(dated, optimize=True)
    img.save(latest, optimize=True)
    print("[social-card] wrote %s and card-latest.png (%dx%d)" % (dated, W, H))
    return dated


def main():
    try:
        build()
        return 0
    except Exception as e:  # never block the briefing over a promo image
        print("[social-card] SKIPPED — %s: %s" % (type(e).__name__, e), file=sys.stderr)
        return 0


if __name__ == "__main__":
    sys.exit(main())
