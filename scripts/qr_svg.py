#!/usr/bin/env python3
"""
qr_svg.py -- a small QR code encoder (byte mode, error correction level M,
versions 1 to 10) that writes an inline SVG. Stdlib only, so the ARC/PLC
counter sheets carry their QR code in the page: no outside QR service, and
the code is the same on every build.

Follows ISO/IEC 18004 the way Project Nayuki's reference encoder does
(Reed-Solomon over GF(256) with 0x11D, block interleaving, the eight masks
with the standard penalty score). Checked in build_arc_plc.py --selftest
against a known QR symbol, and decoded from a printed counter sheet in the
Playwright check.

    from qr_svg import qr_matrix, qr_svg
    qr_svg("https://agsist.com/arc-plc/wisconsin/chippewa-county")
"""

# level M: error correction codewords per block, and number of blocks, by version (index 0 unused)
ECC_PER_BLOCK = [None, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26]
NUM_BLOCKS = [None, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5]
FORMAT_M = 0   # format-information bits for level M


def _gf_mul(x, y):
    z = 0
    for i in reversed(range(8)):
        z = (z << 1) ^ ((z >> 7) * 0x11D)
        z ^= ((y >> i) & 1) * x
    return z


def _rs_divisor(degree):
    result = [0] * (degree - 1) + [1]
    root = 1
    for _ in range(degree):
        for j in range(degree):
            result[j] = _gf_mul(result[j], root)
            if j + 1 < degree:
                result[j] ^= result[j + 1]
        root = _gf_mul(root, 0x02)
    return result


def _rs_remainder(data, divisor):
    result = [0] * len(divisor)
    for b in data:
        factor = b ^ result.pop(0)
        result.append(0)
        for i, coef in enumerate(divisor):
            result[i] ^= _gf_mul(coef, factor)
    return result


def _raw_modules(ver):
    result = (16 * ver + 128) * ver + 64
    if ver >= 2:
        na = ver // 7 + 2
        result -= (25 * na - 10) * na - 55
        if ver >= 7:
            result -= 36
    return result


def _data_codewords(ver):
    return _raw_modules(ver) // 8 - ECC_PER_BLOCK[ver] * NUM_BLOCKS[ver]


def _align_positions(ver):
    if ver == 1:
        return []
    size = ver * 4 + 17
    na = ver // 7 + 2
    step = (ver * 4 + na * 2 + 1) // (na * 2 - 2) * 2
    return list(reversed([size - 7 - i * step for i in range(na - 1)] + [6]))


def _encode_data(data, ver):
    bits = []

    def put(val, n):
        for i in reversed(range(n)):
            bits.append((val >> i) & 1)
    put(0b0100, 4)
    put(len(data), 8 if ver <= 9 else 16)
    for b in data:
        put(b, 8)
    cap = _data_codewords(ver) * 8
    put(0, min(4, cap - len(bits)))
    put(0, (-len(bits)) % 8)
    pad = 0xEC
    while len(bits) < cap:
        put(pad, 8)
        pad ^= 0xEC ^ 0x11
    return [int("".join(map(str, bits[i:i + 8])), 2) for i in range(0, len(bits), 8)]


def _interleave(data, ver):
    nb, el = NUM_BLOCKS[ver], ECC_PER_BLOCK[ver]
    raw = _raw_modules(ver) // 8
    nshort = nb - raw % nb
    shortlen = raw // nb
    div = _rs_divisor(el)
    blocks, k = [], 0
    for i in range(nb):
        dat = data[k:k + shortlen - el + (0 if i < nshort else 1)]
        k += len(dat)
        ecc = _rs_remainder(dat, div)
        if i < nshort:
            dat = dat + [0]
        blocks.append(dat + ecc)
    out = []
    for i in range(len(blocks[0])):
        for j, blk in enumerate(blocks):
            if i != shortlen - el or j >= nshort:
                out.append(blk[i])
    return out


def _penalty(m):
    """Standard penalty score (rules 1 to 4)."""
    n = len(m)
    p = 0
    for lines in (m, [list(c) for c in zip(*m)]):
        for row in lines:
            run, prev = 0, None
            for v in row:
                if v == prev:
                    run += 1
                    if run == 5:
                        p += 3
                    elif run > 5:
                        p += 1
                else:
                    run, prev = 1, v
            s = "".join("1" if v else "0" for v in row)
            for pat in ("10111010000", "00001011101"):
                i = s.find(pat)
                while i >= 0:
                    p += 40
                    i = s.find(pat, i + 1)
    for y in range(n - 1):
        for x in range(n - 1):
            if m[y][x] == m[y][x + 1] == m[y + 1][x] == m[y + 1][x + 1]:
                p += 3
    dark = sum(sum(1 for v in row if v) for row in m)
    total = n * n
    k = (abs(dark * 20 - total * 10) + total - 1) // total - 1
    return p + max(0, k) * 10


MASKS = [
    lambda x, y: (x + y) % 2 == 0,
    lambda x, y: y % 2 == 0,
    lambda x, y: x % 3 == 0,
    lambda x, y: (x + y) % 3 == 0,
    lambda x, y: (x // 3 + y // 2) % 2 == 0,
    lambda x, y: x * y % 2 + x * y % 3 == 0,
    lambda x, y: (x * y % 2 + x * y % 3) % 2 == 0,
    lambda x, y: ((x + y) % 2 + x * y % 3) % 2 == 0,
]


def qr_matrix(text, mask=None):
    """-> (rows of booleans, True = dark), no quiet zone. mask: force one of the 8 masks."""
    data = text.encode("utf-8")
    ver = next((v for v in range(1, 11) if len(data) + (2 if v <= 9 else 3) <= _data_codewords(v)), None)
    if ver is None:
        raise ValueError("text too long for a version 10 QR code at level M")
    size = ver * 4 + 17
    mod = [[False] * size for _ in range(size)]
    fn = [[False] * size for _ in range(size)]

    def setf(x, y, dark):
        mod[y][x] = dark
        fn[y][x] = True
    for i in range(size):
        setf(6, i, i % 2 == 0)
        setf(i, 6, i % 2 == 0)
    for cx, cy in ((3, 3), (size - 4, 3), (3, size - 4)):
        for dy in range(-4, 5):
            for dx in range(-4, 5):
                x, y = cx + dx, cy + dy
                if 0 <= x < size and 0 <= y < size:
                    setf(x, y, max(abs(dx), abs(dy)) not in (2, 4))
    al = _align_positions(ver)
    na = len(al)
    for i in range(na):
        for j in range(na):
            if (i == 0 and j == 0) or (i == 0 and j == na - 1) or (i == na - 1 and j == 0):
                continue
            for dy in range(-2, 3):
                for dx in range(-2, 3):
                    setf(al[i] + dx, al[j] + dy, max(abs(dx), abs(dy)) != 1)

    def draw_format(msk):
        d = FORMAT_M << 3 | msk
        rem = d
        for _ in range(10):
            rem = (rem << 1) ^ ((rem >> 9) * 0x537)
        bits = (d << 10 | rem) ^ 0x5412
        b = [(bits >> i) & 1 == 1 for i in range(15)]
        for i in range(6):
            setf(8, i, b[i])
        setf(8, 7, b[6])
        setf(8, 8, b[7])
        setf(7, 8, b[8])
        for i in range(9, 15):
            setf(14 - i, 8, b[i])
        for i in range(8):
            setf(size - 1 - i, 8, b[i])
        for i in range(8, 15):
            setf(8, size - 15 + i, b[i])
        setf(8, size - 8, True)
    draw_format(0)
    if ver >= 7:
        rem = ver
        for _ in range(12):
            rem = (rem << 1) ^ ((rem >> 11) * 0x1F25)
        bits = ver << 12 | rem
        for i in range(18):
            bt = (bits >> i) & 1 == 1
            a, b_ = size - 11 + i % 3, i // 3
            setf(a, b_, bt)
            setf(b_, a, bt)
    cw = _interleave(_encode_data(data, ver), ver)
    i = 0
    right = size - 1
    while right >= 1:
        if right == 6:
            right = 5
        for vert in range(size):
            for j in range(2):
                x = right - j
                upward = ((right + 1) & 2) == 0
                y = size - 1 - vert if upward else vert
                if not fn[y][x] and i < len(cw) * 8:
                    mod[y][x] = (cw[i >> 3] >> (7 - (i & 7))) & 1 == 1
                    i += 1
        right -= 2
    base = [row[:] for row in mod]
    best = None
    for msk in (range(8) if mask is None else [mask]):
        m = [row[:] for row in base]
        for y in range(size):
            for x in range(size):
                if not fn[y][x] and MASKS[msk](x, y):
                    m[y][x] = not m[y][x]
        mod[:] = m
        draw_format(msk)
        sc = _penalty(mod)
        if best is None or sc < best[0]:
            best = (sc, [row[:] for row in mod])
    return best[1]


def qr_svg(text, label="QR code"):
    """Inline SVG, black on white, 4-module quiet zone, one path."""
    m = qr_matrix(text)
    n = len(m) + 8
    d = "".join(f"M{x + 4},{y + 4}h1v1h-1z" for y, row in enumerate(m) for x, v in enumerate(row) if v)
    return (f'<svg class="qr" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {n} {n}" role="img" aria-label="{label}" '
            f'shape-rendering="crispEdges"><rect width="{n}" height="{n}" fill="#fff"/><path fill="#000" d="{d}"/></svg>')
