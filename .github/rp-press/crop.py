# crop.py <sheet.jpg> <out-1600.png> <out-1200x630.png> [y0 at 1600 scale]
import sys
from PIL import Image
src, big, soc = sys.argv[1:4]
y0 = int(sys.argv[4]) if len(sys.argv) > 4 else 40
im = Image.open(src).convert("RGB")
assert im.size == (5700, 3900), im.size
art = im.crop((375, 300, 375 + 4950, 300 + 3300))      # the 16.5 x 11 in art box on the 13 x 19 sheet (SHEET in rain-print.js)
w = art.resize((1600, round(1600 * 3300 / 4950)), Image.LANCZOS)
w.save(big, optimize=True)
h = round(1600 * 630 / 1200)                              # 840
art.crop((0, round(y0 * 4950 / 1600), 4950, round((y0 + h) * 4950 / 1600))).resize((1200, 630), Image.LANCZOS).save(soc, optimize=True)
print(big, w.size, soc)
