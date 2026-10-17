import os
R=os.path.dirname(os.path.abspath(__file__))+'/'
s=open(R+'../components/rain-print-art.js').read()
inj=open(R+'r1v2.js').read()
crop=open(R+'crop.js').read() if os.path.exists(R+'crop.js') else ''
mark='  // ======================================================================= R2'
assert mark in s
s=s.replace(mark, inj+crop+mark,1)
old="svg = J.style === 'r2' ? r2(J) : r1(J);"
assert old in s
s=s.replace(old,"svg = J.style === 'r2' ? r2(J) : (J.v2 ? r1v2(J) : r1(J));")
a="    var small = smallLine(E, ML, 1440, foot);\n\n    // ================= draw, back to front\n    o.push(G0('totals')"
assert a in s
s=s.replace(a, "    if (I.crop && I.crop.foot) I.crop.foot.forEach(function (t) { foot.push(t); });\n"+a,1)
a="    if (small) o.push(small.svg);\n    o.push(qrMark(I.qr, X1, qrBottom));"
assert a in s
s=s.replace(a, '''    if (I.crop) {
      var cxa = xs(I.crop.plant) - 12, cxb = xs(I.crop.harvest) + 12, low = RB - 120;
      barBoxes.forEach(function (bb) { if (bb.x + bb.w > cxa && bb.x < cxb) low = Math.max(low, bb.y + bb.h); });
      if (wetAt && wetAt.b && wetAt.b.x + wetAt.b.w > cxa && wetAt.b.x < cxb) low = Math.max(low, wetAt.b.y + wetAt.b.h);
      o.push(cropStrip(I, E, { xs: xs, base: Math.max(1046, Math.min(1056, low + 30)) }));
    }
'''+a,1)
open(R+'art-v2.js','w').write(s)
print('ok')
