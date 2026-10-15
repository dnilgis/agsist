#!/usr/bin/env python3
"""test_share_images.py: every indexable page has a share image that works.

  * every indexable page (no noindex, not a redirect) has og:image,
    og:image:width/height 1200x630, og:image:alt and a twitter:image equal to
    og:image, and the image exists on the site, is 1200x630 and under 120 KB;
  * every data card in build_share_images.py still reads its data and draws
    (a renamed field in a data file shows up here, not as a quiet fallback);
  * the tag writer's own selftest.

  python3 scripts/test_share_images.py
"""
import io
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_share_images as B  # noqa: E402


def main():
    from PIL import Image
    B.selftest()
    bad = []
    for name, fn in sorted({**B.CARDS, **B.SETS}.items()):
        try:
            data = B.render(fn())
        except Exception as e:
            bad.append(f"card {name}: {e!r}")
            continue
        im = Image.open(io.BytesIO(data))
        if im.size != (1200, 630) or len(data) > B.SC.MAX_BYTES:
            bad.append(f"card {name}: {im.size}, {len(data)} bytes")
        if "—" in repr(fn()["args"]) or "—" in fn()["alt"]:
            bad.append(f"card {name}: em dash on the card")
    problems = B.check(verbose=True)
    for rel, why in problems.items():
        bad.append(f"{rel}: {'; '.join(why)}")
    if bad:
        print(f"FAIL: {len(bad)} problems")
        for b in bad[:60]:
            print("  " + b)
        return 1
    print("share images OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
