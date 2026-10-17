import sys
from PIL import Image
for f in sys.argv[1:]:
    im=Image.open(f).convert('RGB'); w,h=im.size
    im.resize((1520,round(1520*h/w)),Image.LANCZOS).save(f.replace('-sheet.png','-preview.png').replace('.png','-preview.png') if '-sheet' not in f else f.replace('-sheet.png','-preview.png'))
