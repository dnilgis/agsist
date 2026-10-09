#!/usr/bin/env python3
"""
site_voice_lint.py -- AI tells in the words a visitor reads on agsist.com.

voice_lint.py guards the Daily. This guards everything else: the pages, the
shared components, the generated page families, the email scripts and the
subscriber worker. It reuses voice_lint's TELLS list and adds the tells that
show up in site copy rather than in a market note ("seamless", "powerful",
"at your fingertips", "Whether you're X or Y", "Let's", emoji, "!", a heading
asked as a question, "Fast. Free. Local." slogans).

What it reads:
  *.html, components/*.html   text nodes, alt / aria-label / title /
                              placeholder attributes, meta description and
                              og/twitter text, JSON-LD FAQ questions/answers
  components/*.js, workers/subs-worker.js, the email scripts
                              string literals that look like prose (3+ words)
  generated families          one page per family (cash-bids, basis, rent,
                              yield, farmland-atlas, hail, hail-map) unless
                              --all-generated is given; the generator is the
                              thing to fix, so one sample shows the words
It skips daily/ and the changelog entries (dated published records) and data/.

    python3 scripts/site_voice_lint.py              list hits, exit 0
    python3 scripts/site_voice_lint.py --check      exit 1 when any hit
    python3 scripts/site_voice_lint.py --counts     counts by tell only
    python3 scripts/site_voice_lint.py --selftest
    python3 scripts/site_voice_lint.py FILE ...     only these files
    python3 scripts/site_voice_lint.py --all-generated   every generated page

CI: .github/workflows/preship.yml runs --selftest and --check on every page
push as a warning step (continue-on-error), so a tell shows in the run log
without blocking anything.

Reads files only. Writes nothing.
"""
import glob
import html
import json
import os
import re
import sys
from html.parser import HTMLParser

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import voice_lint  # noqa: E402

# voice_lint's slang list is about market notes; everything else carries over.
# Its dash rule is replaced: an en dash in a range ("March–May", "V4 – V6",
# "1–4 hours") is ordinary punctuation; an em dash, a "--" or a spaced en
# dash inside a sentence is the tell.
BASE = [(c, rx) for c, rx in voice_lint.TELLS if c not in ("slang", "dash")]
DASH = re.compile(r"\u2014|\s--\s|(?<=[a-z,]{3}) \u2013 (?=[a-z]{2})")

W = r"(?:'|’)"
SITE_TELLS = [
    ("leverage", re.compile(r"\bleverag(?:e|es|ed|ing)\b", re.I)),
    ("empower", re.compile(r"\bempower(?:s|ed|ing|ment)?\b", re.I)),
    ("unlock", re.compile(r"\bunlock(?:s|ed|ing)?\b", re.I)),
    ("elevate", re.compile(r"\belevat(?:e|es|ing)\b", re.I)),
    ("streamline", re.compile(r"\bstreamlin(?:e|es|ed|ing)\b", re.I)),
    ("cutting-edge", re.compile(r"\bcutting[- ]edge\b|\bstate[- ]of[- ]the[- ]art\b", re.I)),
    ("comprehensive", re.compile(r"\bcomprehensive(?:ly)?\b", re.I)),
    ("holistic", re.compile(r"\bholistic\b", re.I)),
    ("journey", re.compile(r"\bjourneys?\b", re.I)),
    ("realm", re.compile(r"\brealms?\b", re.I)),
    ("harness", re.compile(r"\bharness(?:es|ed|ing)?\b", re.I)),
    ("crucial", re.compile(r"\bcrucial\b", re.I)),
    ("additionally", re.compile(r"\badditionally\b", re.I)),
    ("designed-to", re.compile(r"\b(?:is|are|was|were|it(?:'|’)s)?\s*(?:specifically\s+)?designed\s+(?:to|for)\b", re.I)),
    ("built-for", re.compile(r"\bbuilt (?:for|by) (?:farmers|producers|growers|ag)\b", re.I)),
    ("one-stop", re.compile(r"\bone[- ]stop\b", re.I)),
    ("fingertips", re.compile(r"\bat your fingertips\b", re.I)),
    ("stay-ahead", re.compile(r"\bstay(?:s|ing)? ahead\b", re.I)),
    ("informed-decisions", re.compile(r"\b(?:make|making|makes)\s+(?:more\s+|better\s+|smarter\s+)?informed\b|\binformed decisions?\b", re.I)),
    ("actionable", re.compile(r"\bactionable\b", re.I)),
    ("data-driven", re.compile(r"\bdata[- ]driven\b", re.I)),
    ("powerful", re.compile(r"\bpowerful(?:ly)?\b", re.I)),
    ("intuitive", re.compile(r"\bintuitive(?:ly)?\b", re.I)),
    ("effortless", re.compile(r"\beffortless(?:ly)?\b", re.I)),
    ("dive-in", re.compile(r"\bdive (?:in|into|deeper)\b", re.I)),
    ("lets", re.compile(rf"\blet{W}s\b", re.I)),
    ("whether-youre", re.compile(rf"\bwhether you{W}?re\b", re.I)),
    ("important-to", re.compile(r"\b(?:it(?:'|’)s|it is)\s+important\s+to\s+(?:remember|note|understand|keep in mind)\b", re.I)),
    ("simply-easily", re.compile(r"\b(?:simply|easily)\b", re.I)),
    ("insights", re.compile(r"\binsights?\b", re.I)),
    ("ever-changing", re.compile(r"\bever[- ](?:changing|evolving)\b", re.I)),
    ("next-level", re.compile(r"\bnext[- ]level\b|\btake (?:it|your \w+) to the next\b", re.I)),
    ("exclamation", re.compile(r"[A-Za-z0-9)][!](?=\s|$|<|\")")),
    ("market-intelligence", re.compile(r"\bmarket[- ]intelligence\b|\bintelligence platform\b|\b\w+ Intelligence \u00b7", re.I)),
    ("big-picture", re.compile(r"\b(?:the )?(?:full|complete|whole|bigger) (?:picture|story)\b", re.I)),
    ("instantly", re.compile(r"\binstantly\b|\bin seconds\b", re.I)),
    ("sets-the-tone", re.compile(r"\bsets? the (?:tone|stage)\b", re.I)),
    ("everything-you-need", re.compile(r"\beverything (?:a|an|you) ?\w* needs?\b", re.I)),
    ("know-before", re.compile(r"\bKnow Before You\b|\bKnow before you\b")),
    # "Moisture: The Double-Edged Sword", "Spray Records: Your Legal Shield"
    ("colon-cliche", re.compile(r"^[^:]{3,45}:\s+(?:The|A|An|Your)\s+[A-Z][A-Za-z-]+(?:\s+[A-Z][A-Za-z-]+)*$")),
    # pictographs; plain marks used as table symbols (check, cross, star,
    # pencil, arrows) are not emoji
    ("emoji", re.compile("[\U0001F300-\U0001FAFF\U0001F000-\U0001F2FF\u2600-\u2604\u2606-\u26FF\u2B50\u2705\u274C\u2728]")),
    ("slogan", re.compile(r"(?:^|(?<=[\s>]))(?:[A-Z][a-z'’]+(?: [a-z'’]+)?\.\s+){2,}[A-Z][a-z'’]+(?: [a-z'’]+)?\.(?=\s|$)")),
]
TELLS = [("dash", DASH)] + BASE + SITE_TELLS

# A few words are tells in prose but ordinary in a name or a fixed term.
ALLOW = [
    re.compile(r"\belevat(?:e|ed|ion)\s+(?:grain|bins?|leg)\b", re.I),  # grain elevator gear
    re.compile(r"\bcomprehensive\s+(?:conservation|plan)\b", re.I),  # NRCS program names
    re.compile(r"\bInsightful\b"),
    re.compile(r"\bin today(?:'|\u2019)s (?:price|prices|file|data|briefing|report|bids)\b", re.I),
    re.compile(r"\b(?:ZC|ZS|ZW|ZM|ZL|LE|GF|HE)\d!|Bulletins Live!"),     # TradingView symbols, EPA product name
]

# ── text extraction ─────────────────────────────────────────────────────────

_ATTRS = ("alt", "aria-label", "title", "placeholder", "aria-description")
_META_NAMES = {"description", "og:description", "og:title", "twitter:description",
               "twitter:title", "og:image:alt", "twitter:image:alt"}
_HEADINGS = {"h1", "h2", "h3"}
# Page headings that are the question the page answers, the words a farmer
# types into a search box, not a rhetorical setup. Anything else asked in an
# h1-h3 outside a FAQ is reported.
QUESTION_OK = {
    "Do crop ratings actually predict yield?",
    "Do pod counts predict soybean yield?",
    "National Hail Map: did it hail at your place?",
    "When does your price get set?",
    "Who owns the ground?",
    "How much of your crop can you safely pre-sell?",
    "Is It Safe to SprayRight Now?",
    "Is It Safe to Spray Right Now?",
    "What's priced in?",
}


class _Text(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out = []          # [(loc, text)]
        self._skip = 0
        self._ld = False
        self._ld_buf = []
        self._head = None
        self._head_buf = []
        self._faq = 0
        self._stack = []
        self._js = False
        self.js = []           # inline script bodies, scanned as code

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in ("style", "template") or (tag == "script" and a.get("type") != "application/ld+json"):
            self._skip += 1
            if tag == "script" and not a.get("src") and a.get("type") in (None, "", "module", "text/javascript"):
                self._js = True
            return
        if tag == "script":
            self._ld = True
            self._ld_buf = []
            return
        if tag == "title":
            self._head, self._head_buf = "title", []
        if tag == "meta":
            n = (a.get("name") or a.get("property") or "").lower()
            if n in _META_NAMES and a.get("content"):
                self.out.append((f"meta[{n}]", a["content"]))
            return
        for k in _ATTRS:
            v = a.get(k)
            if v and tag not in ("html", "link", "iframe") and len(v.split()) >= 2:
                self.out.append((f"{tag}[{k}]", v))
        cls = (a.get("class") or "") + " " + (a.get("id") or "")
        faq = "faq" in cls.lower() or tag in ("summary", "details")
        self._stack.append((tag, faq))
        if faq:
            self._faq += 1
        if tag in _HEADINGS and self._head is None:
            self._head, self._head_buf = tag, []

    def handle_endtag(self, tag):
        if tag in ("style", "template") or (tag == "script" and not self._ld):
            self._skip = max(0, self._skip - 1)
            self._js = False
            return
        if tag == "script" and self._ld:
            self._ld = False
            self._jsonld("".join(self._ld_buf))
            return
        if self._head == tag:
            t = re.sub(r"\s+", " ", "".join(self._head_buf)).strip()
            if t:
                self.out.append((tag if tag != "title" else "title", t))
                if tag in _HEADINGS and t.endswith("?") and not self._faq and t not in QUESTION_OK:
                    self.out.append((f"{tag}:question", t))
            self._head = None
        while self._stack:
            t, faq = self._stack.pop()
            if faq:
                self._faq -= 1
            if t == tag:
                break

    def handle_data(self, data):
        if self._ld:
            self._ld_buf.append(data)
            return
        if self._skip:
            if self._js:
                self.js.append(data)
            return
        if self._head:
            self._head_buf.append(data)
            if self._head != "title":
                return
            return
        t = re.sub(r"\s+", " ", data).strip()
        if t and re.search(r"[A-Za-z]", t):
            self.out.append(("text", t))

    def _jsonld(self, raw):
        try:
            d = json.loads(raw)
        except Exception:
            return

        def walk(x):
            if isinstance(x, dict):
                ty = x.get("@type")
                if ty in ("Question", "Answer"):
                    for k in ("name", "text"):
                        if isinstance(x.get(k), str):
                            self.out.append((f"ld:{ty}", html.unescape(re.sub(r"<[^>]+>", " ", x[k]))))
                elif isinstance(x.get("description"), str):
                    self.out.append(("ld:description", x["description"]))
                for v in x.values():
                    walk(v)
            elif isinstance(x, list):
                for v in x:
                    walk(v)
        walk(d)


def html_texts(src):
    p = _Text()
    try:
        p.feed(src)
    except Exception:
        pass
    # text that inline scripts write into the page
    return p.out + [("js", t) for _, t in code_texts("\n".join(p.js))]


_STR = re.compile(r"""(?<![\w\\])(?:"((?:[^"\\\n]|\\.){12,})"|'((?:[^'\\\n]|\\.){12,})'|`((?:[^`\\]|\\.){12,})`)""")


_LOGCALL = re.compile(r"\b(?:print|console\.(?:log|warn|error|info|debug)|logging\.\w+|_?log|"
                      r"sys\.exit|raise \w+|[A-Z]\w*(?:Error|Exception))\s*\(")


def _blank(src, a, b):
    """src with [a, b) replaced by spaces, newlines kept so line numbers hold."""
    return src[:a] + re.sub(r"[^\n]", " ", src[a:b]) + src[b:]


def _strip_operator_text(src):
    """Comments and log/error calls are for the operator, not the visitor."""
    src = re.sub(r"/\*.*?\*/", lambda m: re.sub(r"[^\n]", " ", m.group(0)), src, flags=re.S)
    src = re.sub(r'(?m)^\s*(?://|#).*$|(?<=[;{}),])\s*//[^\n"\'`]*$', "", src)
    pos = 0
    while True:
        m = _LOGCALL.search(src, pos)
        if not m:
            return src
        depth, i, q = 0, m.end() - 1, None
        while i < len(src):
            c = src[i]
            if q:
                if c == "\\":
                    i += 2
                    continue
                if c == q:
                    q = None
            elif c in "'\"`":
                q = c
            elif c == "(":
                depth += 1
            elif c == ")":
                depth -= 1
                if depth == 0:
                    break
            i += 1
        src = _blank(src, m.start(), min(i + 1, len(src)))
        pos = m.start() + 1


def code_texts(src):
    """Prose-looking string literals from JS or Python source."""
    out = []
    body = _strip_operator_text(src)
    for m in _STR.finditer(body):
        s = m.group(1) or m.group(2) or m.group(3) or ""
        s = re.sub(r"\$\{[^}]*\}|\{[^}]*\}", "X", s)
        s = re.sub(r"<[^>]*>?|^[^<]*>", " ", s)
        s = html.unescape(s.replace("\\n", " ").replace("\\'", "'").replace('\\"', '"'))
        if len(re.findall(r"[A-Za-z]{2,}", s)) < 3 or not re.search(r"[a-z] [a-z]", s):
            continue
        if re.search(r"^[\w.-]+\.(?:json|js|css|html|py)$|https?://\S+$", s.strip()):
            continue
        out.append(("str", s.strip()))
    return out


def hits_in(texts):
    """[(code, loc, snippet)] for a list of (loc, text)."""
    hits = []
    for loc, text in texts:
        if loc.endswith(":question"):
            hits.append(("question-heading", loc.split(":")[0], text))
            continue
        for code, rx in TELLS:
            if code == "slogan" and loc == "title":
                continue
            for m in rx.finditer(text):
                around = text[max(0, m.start() - 30):m.end() + 30]
                if any(a.search(around) for a in ALLOW):
                    continue
                hits.append((code, loc, voice_lint._snip(text, m.start(), m.end())))
        for t in voice_lint._triple_adjectives(text):
            hits.append(("triple-adjective", loc, t))
    return hits


# ── which files ─────────────────────────────────────────────────────────────

FAMILIES = ["cash-bids", "basis", "rent", "yield", "farmland-atlas", "hail", "hail-map", "embed"]
CODE = ["components/*.js", "workers/subs-worker.js", "scripts/brief_email.py",
        "scripts/send_*.py", "scripts/check_alerts.py", "scripts/sponsor_apply.py",
        "field-scout.js", "embed.js"]


def default_files(all_generated=False):
    files = sorted(glob.glob(os.path.join(ROOT, "*.html")))
    files += sorted(glob.glob(os.path.join(ROOT, "components", "*.html")))
    for fam in FAMILIES:
        found = sorted(glob.glob(os.path.join(ROOT, fam, "**", "*.html"), recursive=True))
        if all_generated:
            files += found
        else:
            # one index page and one leaf page per family
            idx = [f for f in found if os.path.basename(f) == "index.html"]
            leaf = [f for f in found if f not in idx]
            files += idx[:1] + leaf[:1] + ([idx[-1]] if len(idx) > 1 else [])
    for pat in CODE:
        files += sorted(glob.glob(os.path.join(ROOT, pat)))
    seen, out = set(), []
    for f in files:
        if f not in seen:
            seen.add(f)
            out.append(f)
    return out


def lint_file(path):
    try:
        src = open(path, encoding="utf-8").read()
    except Exception:
        return []
    # the changelog entries are a dated record baked from data/changelog.json;
    # like the Daily archive, they are left as published
    src = re.sub(r"<!-- CHANGELOG:entries -->.*?<!-- /CHANGELOG:entries -->", "", src, flags=re.S)
    texts = html_texts(src) if path.endswith(".html") else code_texts(src)
    return hits_in(texts)


# ── selftest ────────────────────────────────────────────────────────────────

_FAIL = [
    "Leverage real-time data to make informed decisions.",
    "Your one-stop shop for grain markets.",
    "All the data at your fingertips.",
    "Whether you're a grower or a buyer, we have you covered.",
    "Let's dive in.",
    "A powerful, intuitive tool.",
    "Seamlessly track basis.",
    "Fast. Free. Local.",
    "Sign up today!",
    "Corn \U0001F33D bids",
    "Our comprehensive guide.",
    "Simply enter your ZIP.",
    "Moisture: The Double-Edged Sword",
    "Free US agricultural market intelligence.",
    "Get the whole story on any field",
    "Dicamba Application Rules: Know Before You Spray",
    "Corn held \u2014 barely.",
]
_PASS = [
    "I build it nights and weekends because I think this data ought to be easier to get to.",
    "I read every message myself.",
    "I fix things fast when I know about them.",
    "Corn closed at $4.12, up 3 cents.",
    "Enter your ZIP to see bids near you.",
    "Data from USDA NASS, updated weekly.",
    "U.S. corn exports rose 12%.",
    "Not in today\u2019s price file",
    "Spring (March\u2013May) often sees stronger basis.",
    "Spray Records",
    "View CBOT:ZC1! on TradingView",
]


def _selftest():
    fails = []
    for s in _FAIL:
        if not hits_in([("text", s)]):
            fails.append(f"missed: {s!r}")
    for s in _PASS:
        h = hits_in([("text", s)])
        if h:
            fails.append(f"false hit: {s!r} {h}")
    t = html_texts('<h2>Why does basis matter?</h2><div class="faq"><h3>What is basis?</h3></div>'
                   '<meta name="description" content="A robust tool"><img alt="Seamless map view">'
                   '<script type="application/ld+json">{"@type":"FAQPage","mainEntity":[{"@type":"Question",'
                   '"name":"Q?","acceptedAnswer":{"@type":"Answer","text":"Let us delve in."}}]}</script>')
    codes = sorted({c for c, _, _ in hits_in(t)})
    if codes != ["delve", "question-heading", "robust", "ai-filler"] and \
            set(codes) != {"delve", "question-heading", "robust", "ai-filler"}:
        fails.append(f"html extraction: {codes}")
    if [x for x in hits_in(t) if x[0] == "question-heading" and "What is basis" in x[2]]:
        fails.append("FAQ question heading flagged")
    c = code_texts('el.textContent = "Unlock powerful insights today";\n// "a robust comment here"\n')
    if len(c) != 1 or not hits_in(c):
        fails.append(f"code extraction: {c}")
    for f in fails:
        print("  FAIL", f)
    print(f"site_voice_lint selftest: {len(fails)} failure(s)")
    return 1 if fails else 0


def main(argv):
    if "--selftest" in argv:
        return _selftest()
    args = [a for a in argv[1:] if not a.startswith("--")]
    files = [os.path.abspath(a) for a in args] if args else default_files("--all-generated" in argv)
    by_code, total = {}, 0
    for f in files:
        hs = lint_file(f)
        total += len(hs)
        rel = os.path.relpath(f, ROOT)
        for code, loc, s in hs:
            by_code[code] = by_code.get(code, 0) + 1
            if "--counts" not in argv:
                print(f"  [WARN] {code} {rel} {loc}: {s}")
    for code in sorted(by_code, key=lambda c: (-by_code[c], c)):
        print(f"  {by_code[code]:5d}  {code}")
    print(f"site_voice_lint: {total} tell(s) in {len(files)} file(s)")
    if "--check" in argv and total:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
