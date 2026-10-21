"""Say numbers the way farm radio does, and keep the screen text exact.

A line of the Ag in 60 script is written once, with the numbers as they
show on screen ("Corn, $4.67¾, up ¾¢."). tokens() splits it into
(show, say) pairs: the captions use `show`, the voice reads `say`
("four sixty-seven and three quarters"). Word counts and caption timing
come from the spoken words, so a long number gets its real share of time.

Standard library only (the tests run it without installing anything).
"""
import re

ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
        "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen",
        "eighteen", "nineteen"]
TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]
FRAC = {"¼": 0.25, "½": 0.5, "¾": 0.75}
FRAC_SAY = {0.25: "a quarter", 0.5: "a half", 0.75: "three quarters"}
FRAC_SHOW = {0.25: "¼", 0.5: "½", 0.75: "¾"}
MONTHS = {"Jan": "January", "Feb": "February", "Mar": "March", "Apr": "April", "May": "May",
          "Jun": "June", "Jul": "July", "Aug": "August", "Sep": "September", "Sept": "September",
          "Oct": "October", "Nov": "November", "Dec": "December"}
ORD = {1: "first", 2: "second", 3: "third", 4: "fourth", 5: "fifth", 6: "sixth", 7: "seventh",
       8: "eighth", 9: "ninth", 10: "tenth", 11: "eleventh", 12: "twelfth", 13: "thirteenth",
       14: "fourteenth", 15: "fifteenth", 16: "sixteenth", 17: "seventeenth", 18: "eighteenth",
       19: "nineteenth", 20: "twentieth", 30: "thirtieth"}
# words the voice should not guess at
SAY_WORD = {"USDA": "U S D A", "USDA's": "U S D A's", "CT": "Central", "WTI": "W T I",
            "III": "three", "agsist.com": "ag sist dot com", "AGSIST": "ag sist", "LNG": "L N G",
            "ARC/PLC": "ARC and PLC", "FSA": "F S A", "WASDE": "wahz-dee", "CME": "C M E",
            "vs": "versus", "bu": "bushels", "bu/acre": "bushels an acre"}


def words(n):
    """Whole number in words: 1464 -> 'one thousand four hundred sixty-four'."""
    n = int(n)
    if n < 0:
        return "minus " + words(-n)
    if n < 20:
        return ONES[n]
    if n < 100:
        return TENS[n // 10] + ("-" + ONES[n % 10] if n % 10 else "")
    if n < 1000:
        return ONES[n // 100] + " hundred" + (" " + words(n % 100) if n % 100 else "")
    if 1100 <= n < 10000 and n % 1000 and n % 100:   # 1,464: "fourteen hundred sixty-four", as people say it
        return words(n // 100) + " hundred " + words(n % 100)
    for size, name in ((10 ** 9, "billion"), (10 ** 6, "million"), (1000, "thousand")):
        if n >= size:
            rest = n % size
            return words(n // size) + " " + name + (" " + words(rest) if rest else "")
    return str(n)


def ordinal(n):
    n = int(n)
    if n in ORD:
        return ORD[n]
    if n < 100 and n % 10:
        return TENS[n // 10] + "-" + ORD[n % 10]
    return words(n) + "th"


def two_digit(n):
    """Cents in a price: 5 -> 'oh five', 67 -> 'sixty-seven'."""
    return "oh " + ONES[n] if n < 10 else words(n)


def split_price(v):
    """4.6775 -> (4, 67, 0.75). Prices are quoted to the quarter cent."""
    q = round(round(v * 400) / 4, 2)          # cents, to the nearest quarter cent
    cents = int(q)
    frac = round(q - cents, 2)
    return cents // 100, cents % 100, frac


def show_price(v):
    d, c, f = split_price(v)
    return f"${d:,}.{c:02d}{FRAC_SHOW.get(f, '')}"


def say_price(v):
    """Farm radio: 4.6775 -> 'four sixty-seven and three quarters', 227.5 -> 'two twenty-seven fifty'."""
    d, c, f = split_price(v)
    if d >= 100 and d % 100:
        dw = ONES[d // 100] + " " + two_digit(d % 100) if d < 1000 else words(d)
    else:
        dw = words(d)
    if d >= 100 and d % 100 == 0 and (c or f):   # $100.71: "one hundred dollars and seventy-one cents"
        return dw + " dollars and " + say_cents((c + f) / 100)
    if c == 0 and not f:
        out = dw + (" dollar" if d == 1 else " dollars")
    else:
        out = dw + " " + two_digit(c)
    if f:
        out += " and " + FRAC_SAY[f]
    return out


def show_cents(ch):
    """A change in dollars shown in cents: 0.0075 -> '¾¢', -0.0925 -> '9¼¢'."""
    q = round(round(abs(ch) * 400) / 4, 2)
    w = int(q)
    f = round(q - w, 2)
    return (str(w) if w else "") + FRAC_SHOW.get(f, "") + "¢" if (w or f) else "0¢"


def say_cents(ch):
    q = round(round(abs(ch) * 400) / 4, 2)
    w = int(q)
    f = round(q - w, 2)
    if not w and not f:
        return "unchanged"
    if not w:
        return FRAC_SAY[f] + " of a cent"
    if not f:
        return words(w) + (" cent" if w == 1 else " cents")
    return words(w) + " and " + FRAC_SAY[f] + " cents"


def say_decimal(s):
    """'2.8' -> 'two point eight'; '181.2' -> 'one hundred eighty-one point two'."""
    s = s.replace(",", "")
    if "." in s:
        a, b = s.split(".", 1)
        return words(int(a or 0)) + " point " + " ".join(ONES[int(ch)] for ch in b)
    return words(int(s))


def say_year(y):
    y = int(y)
    if 2000 <= y <= 2009:
        return words(y)
    return words(y // 100) + " " + two_digit(y % 100)


NUM = r"\d{1,3}(?:,\d{3})+|\d+"
PATTERNS = [
    # $8 billion, $1.2 million
    ("scaled", re.compile(r"\$(\d+(?:\.\d+)?)\s(billion|million|thousand)\b")),
    # $4.67¾, $227.50, $100.71
    ("price", re.compile(r"\$(\d{1,3}(?:,\d{3})*|\d+)\.(\d\d)([¼½¾])?")),
    # $634,974 or $8
    ("dollars", re.compile(r"\$(" + NUM + r")(?![\d.])")),
    # 9¢, 10¾¢, ¾¢
    ("cents", re.compile(r"(\d+)?([¼½¾])?¢")),
    # 2.8%, 44%
    ("pct", re.compile(r"(\d+(?:\.\d+)?)%")),
    # 7:30 a.m.
    ("clock", re.compile(r"(\d{1,2}):(\d\d)\s?(a\.m\.|p\.m\.)")),
    # Oct 22, Oct. 22
    ("date", re.compile(r"\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)\.?\s(\d{1,2})\b(?!,\d|\d)")),
    # 1,464 or 181.2 or 2026
    ("number", re.compile(r"(?<![\w$'])(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+\.\d+|\d+)(?![\w:])")),
]


def _say(kind, m):
    if kind == "scaled":
        return say_decimal(m.group(1)) + " " + m.group(2) + " dollars"
    if kind == "price":
        v = int(m.group(1).replace(",", "")) + int(m.group(2)) / 100 + FRAC.get(m.group(3) or "", 0) / 100
        return say_price(v)
    if kind == "dollars":
        n = int(m.group(1).replace(",", ""))
        return words(n) + (" dollar" if n == 1 else " dollars")
    if kind == "cents":
        w = int(m.group(1)) if m.group(1) else 0
        f = FRAC.get(m.group(2) or "", 0)
        return say_cents((w + f) / 100)
    if kind == "pct":
        return say_decimal(m.group(1)) + " percent"
    if kind == "clock":
        h, mi = int(m.group(1)), int(m.group(2))
        return words(h) + ("" if mi == 0 else " " + two_digit(mi)) + (" a m" if m.group(3).startswith("a") else " p m")
    if kind == "date":
        return MONTHS[m.group(1)] + " " + ordinal(m.group(2))
    if kind == "number":
        s = m.group(1)
        if re.fullmatch(r"(19|20)\d\d", s):
            return say_year(s)
        return say_decimal(s)
    raise ValueError(kind)


def _word(w):
    core = w.strip(".,;:!?\"()")
    lead = w[: len(w) - len(w.lstrip("\"("))]
    tail = w[len(lead) + len(core):]
    if core in SAY_WORD:
        return lead + SAY_WORD[core] + tail
    if core in MONTHS and core != "May":
        return lead + MONTHS[core] + tail
    if re.fullmatch(r"'\d\d", core):          # Dec '26 -> December (the year is on screen)
        return ""
    return w.replace("—", ",").replace("–", " to ")


def tokens(text):
    """Split a script line into [(show, say)] pairs; punctuation rides on its word."""
    spans = []
    for kind, rx in PATTERNS:
        for m in rx.finditer(text):
            if any(not (m.end() <= a or m.start() >= b) for a, b, _, _ in spans):
                continue
            spans.append((m.start(), m.end(), kind, m))
    spans.sort()
    out = []
    pos = 0

    def plain(seg, glue):
        for i, w in enumerate(re.findall(r"\S+", seg)):
            if i == 0 and glue and out and not seg[:1].isspace():
                s, y = out[-1]
                out[-1] = (s + w, y + w)
                continue
            out.append((w, _word(w)))

    for a, b, kind, m in spans:
        plain(text[pos:a], True)
        show = text[a:b]
        say = _say(kind, m)
        if out and a > 0 and not text[a - 1].isspace():
            s, y = out[-1]                        # "($4.67" style glue: keep it one token
            out[-1] = (s + show, (y + " " + say).replace("( ", "("))
        else:
            out.append((show, say))
        pos = b
    plain(text[pos:], True)
    return [(s, y) for s, y in out if s]


def spoken(text):
    return " ".join(y for _, y in tokens(text) if y)


def word_count(text):
    """Spoken words; a spelled-out acronym (U S D A) counts as one word."""
    s = re.sub(r"\b(?:[A-Z] )+[A-Z]\b", "X", spoken(text))
    return len(re.findall(r"[A-Za-z']+(?:-[A-Za-z']+)*", s))
