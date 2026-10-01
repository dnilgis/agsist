#!/usr/bin/env python3
"""Patches components/styles.css from a pristine clone. Separate from
patch_index1.py because it targets a different file shared by 10+ pages.

2026-10-01, round 9: a real audit-panel finding, verified by measuring
rendered scrollWidth vs clientWidth, not by reading the CSS and assuming it
was fine. .pc-change was white-space:nowrap inside an overflow:hidden
parent, so a long real change string ("-20 3/4c (-4.0%)") got its trailing
digits silently cut off instead of shown in full. Letting the pill wrap
keeps every digit visible. This touches every page that renders a price
card (corn/soy/wheat/cattle-futures-prices.html, fertilizer.html, the
homepage, index1.html), which is intended -- the bug was sitewide.
"""
import argparse
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

OLD = (
    ".pc-change { display: flex; align-items: center; gap: .5rem; margin-bottom: .1rem; "
    "flex-wrap: nowrap; overflow: hidden; min-height: 1.3em; }\n"
    ".pc-chg-val { font-family: 'JetBrains Mono', monospace; font-size: .98rem; font-weight: 800; "
    "letter-spacing: .01em; white-space: nowrap; padding: .08rem .45rem; border-radius: 6px; }"
)

NEW = (
    ".pc-change { display: flex; align-items: center; gap: .5rem; margin-bottom: .1rem; "
    "flex-wrap: wrap; min-height: 1.3em; }\n"
    "/* 2026-10-01: this was white-space:nowrap inside an overflow:hidden parent, so\n"
    "   a long real change string (\"▼ -20 3/4¢ (-4.0%)\") got its trailing digits\n"
    "   silently cut off rather than shown in full -- caught by measuring rendered\n"
    "   scrollWidth against clientWidth, not by reading the CSS. Letting the pill\n"
    "   wrap keeps every digit visible instead of hiding real data. */\n"
    ".pc-chg-val { font-family: 'JetBrains Mono', monospace; font-size: .98rem; font-weight: 800; "
    "letter-spacing: .01em; white-space: normal; padding: .08rem .45rem; border-radius: 6px; }"
)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=str(REPO.parent / "pristine" / "components" / "styles.css"))
    ap.add_argument("--out", default=str(REPO / "components" / "styles.css"))
    args = ap.parse_args()

    data = Path(args.src).read_text(encoding="utf-8")
    count = data.count(OLD)
    if count != 1:
        raise AssertionError(f"pc-change/pc-chg-val overflow fix: found {count} matches, need exactly 1")
    data = data.replace(OLD, NEW, 1)

    out_path = Path(args.out)
    out_path.write_text(data, encoding="utf-8")
    print(f"wrote {out_path} ({len(data)} bytes)")


if __name__ == "__main__":
    main()
