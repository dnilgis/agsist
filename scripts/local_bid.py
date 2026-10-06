#!/usr/bin/env python3
"""
local_bid.py -- the top posted corn and soybean bid near a ZIP, for email.

THE SAME ANSWER THE HOMEPAGE HERO GIVES, OR NONE AT ALL.

The hero band on agsist.com reads one summary per crop from
components/bids-homepage.js (topEntry / topPick), built from the elevator
network that components/bids-network.js reads from dnilgis.github.io/bids.
This file is a line-for-line port of that path, so the "Near Chetek, WI: top
corn bid ..." line at the top of AGSIST Daily says what the reader would see
on the homepage at the same minute:

    bids-network.js   zipCoord / snapshot / rowFor   (50 mi, nearest 40 places,
                                                      USD only, places with `now`)
    bids-homepage.js  fromNetwork        closed delivery windows dropped
                      loadAllBids        inScope + plausible (licensed feed off)
                      groupByElevator    one elevator per facility|branch|city
                      mergeOnePin        one board at one pin under many towns
                      topPick/topEntry   fresh pool first, nearest delivery
                                         month, highest cash, higherOlder
                      tokenMonth / rowMonthKey / rowExpired
                      qParts / qCents / ctShort   quarter cents, "Oct 1"

THE LICENSED FEED IS NOT HERE. The homepage also asks a Barchart proxy that
only answers agsist.com in a browser. The email reads the elevator network
only, which is what the hero shows whenever that feed is off or slow, and is
cross-checked against the JS with it off (scripts/daily-local-bid-checks.mjs).

NOTHING IS INVENTED. No coordinate for the ZIP, or the bids files could not be
read: status says so and the caller prints nothing local. Nothing within 50 mi
for a crop: that crop is None and the line says "No posted corn bid within
50 mi". The reader's town comes from the bids repo's own ZIP table
(geocodes/zip-towns.json, built from the same `zipcodes` package as the ZIP
centroids); with no row there the place is printed as "ZIP 54728", the same
fallback the homepage uses.

WHERE THE FILES COME FROM. BIDS_BASE, default https://dnilgis.github.io/bids/.
A local directory laid out like that site (data/merged-index.json,
data/zips/54.json, geocodes/zip-towns.json) works too, for tests.

    python3 scripts/local_bid.py --zip 54728            the email line
    python3 scripts/local_bid.py --zip 54728 --json     the hero-shaped entries
    python3 scripts/local_bid.py --selftest
"""
import json
import math
import os
import re
import sys
import urllib.request
from datetime import date, datetime, timedelta, timezone

try:
    from zoneinfo import ZoneInfo
    CT = ZoneInfo("America/Chicago")
except Exception:                       # pragma: no cover - no tzdata
    CT = None

DEFAULT_BASE = "https://dnilgis.github.io/bids/"
UA = {"User-Agent": "AGSIST-automation/1.0 (+https://agsist.com; sig@farmers1st.com)"}

# bids-network.js / bids-homepage.js constants
RADIUS_MI = 50              # bids-homepage.js BIDS_RADIUS_MI, fromNetwork radiusMi: 50
MAX_PLACES = 40             # bids-network.js MAX_PLACES
MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
NOT_PER_BUSHEL = re.compile(r"\b(meal|hulls?|pellets?|oil|flour|ddg|distillers|gluten|canola|peas?)\b", re.I)
SPECIAL_GRADE = re.compile(r"non[- ]?gmo|organic|\bwhite\b|\bfeed\b|durum|\bsww\b|spring|\bhrs\b|\bdns\b|dark northern|mgex", re.I)
PPU_BAND = {"corn": (2, 12), "soybeans": (6, 32), "wheat": (3, 20), "sorghum": (2, 6), "oats": (1, 8)}
PER_CWT = re.compile(r"\bcwt\b|hundredweight", re.I)
US_STATES = ("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV "
             "NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY").split()
COMM_ORDER = ["corn", "soybeans", "wheat", "sorghum", "oats", "other"]
NC_WIN = {"corn": (9, 12), "soybeans": (9, 12), "sorghum": (9, 12), "wheat": (6, 9), "oats": (6, 9)}
CY_START = {"wheat": 6, "oats": 6, "barley": 6}
LEGAL = {"llc", "lc", "inc", "incorporated", "co", "corp", "corporation", "ltd", "limited", "lp", "llp", "company"}
FOLD = {"bros": "brother", "brothers": "brother", "brother": "brother", "st": "saint", "mt": "mount", "ft": "fort",
        "farmers": "farmer", "assn": "association", "assoc": "association", "elev": "elevator", "elevators": "elevator"}


# ── JS arithmetic, exactly ────────────────────────────────────────────────
def js_round(x):
    """Math.round: half rounds toward +infinity, not to even."""
    return math.floor(x + 0.5)


def js_str(v):
    """String(v) for what a row can hold."""
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        if v != v:
            return "NaN"
        if v.is_integer() and abs(v) < 1e21:
            return str(int(v))
        return repr(v)
    return str(v)


def is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


# ── clocks (Central time, like the page) ──────────────────────────────────
def now_ct(now=None):
    n = now or datetime.now(timezone.utc)
    return n.astimezone(CT) if CT else n


def ct_today(now=None):
    return now_ct(now).strftime("%Y-%m-%d")


def this_month(now=None):
    return ct_today(now)[:7]


def parse_iso(iso):
    """new Date(iso) for the ISO stamps the bids repo writes. None if unreadable."""
    if not iso or not isinstance(iso, str):
        return None
    s = iso.strip()
    if s.endswith("Z") or s.endswith("z"):
        s = s[:-1] + "+00:00"
    try:
        d = datetime.fromisoformat(s)
    except ValueError:
        return None
    if d.tzinfo is None:          # the browser would read this as its own local time; the bids repo never writes one
        return None
    return d


def ct_date(iso):
    d = parse_iso(iso)
    return d.astimezone(CT).strftime("%Y-%m-%d") if (d and CT) else ""


def ct_short(iso):
    """bids-homepage.js ctShort: "Oct 1", Central time."""
    d = parse_iso(iso)
    if not d:
        return ""
    d = d.astimezone(CT) if CT else d
    return MON[d.month - 1] + " " + str(d.day)


def _shift(ds, n):
    return (date.fromisoformat(ds) + timedelta(days=n)).isoformat()


def _weekend(ds):
    return date.fromisoformat(ds).weekday() >= 5


def prev_weekday(ds):
    x = _shift(ds, -1)
    while _weekend(x):
        x = _shift(x, -1)
    return x


def stale_since(iso, now=None):
    pd = ct_date(iso)
    if not pd:
        return ""
    cut = prev_weekday(ct_today(now))
    return pd if pd < cut else ""


# ── formatting (qParts / qCashText / qCents) ──────────────────────────────
def q_cash_text(dollars):
    if not is_num(dollars):
        return "—"
    c = js_round(float(dollars) * 400) / 4
    w = math.floor(c + 1e-9)
    f = js_round((c - w) * 4)
    if f == 4:
        w += 1
        f = 0
    return "$%.2f" % (w / 100) + (" " + ["", "1/4", "1/2", "3/4"][f] if f else "")


def q_cents(cents):
    a = abs(float(cents))
    q = js_round(a * 4) / 4
    w = math.floor(q + 1e-9)
    f = js_round((q - w) * 4)
    if not w and not f:
        return "even"
    return (("−" if cents < 0 else "+") + (str(w) if (w or not f) else "")
            + (" " if (w and f) else "") + (["", "1/4", "1/2", "3/4"][f] if f else "") + "¢")


# ── data ──────────────────────────────────────────────────────────────────
class BidsData:
    """The three files the homepage reads, from the site or a local mirror.
    Every read is cached; a failed read is remembered as failed (None)."""

    def __init__(self, base=None):
        self.base = (base or os.environ.get("BIDS_BASE") or DEFAULT_BASE).strip()
        self._c = {}

    def _get(self, rel):
        if rel in self._c:
            return self._c[rel]
        j = None
        try:
            if re.match(r"^https?://", self.base):
                u = self.base.rstrip("/") + "/" + rel
                with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=30) as r:
                    j = json.loads(r.read().decode("utf-8"))
            else:
                with open(os.path.join(self.base, rel), encoding="utf-8") as fh:
                    j = json.load(fh)
        except Exception as ex:
            print("bids file %s unreadable (%s)" % (rel, type(ex).__name__), file=sys.stderr)
            j = None
        self._c[rel] = j
        return j

    def index(self):
        return self._get("data/merged-index.json")

    def zip_coord(self, z):
        """bids-network.js zipCoord/readZip. (lat, lon), None (no such ZIP),
        or False (the shard could not be read)."""
        z = str(z or "").strip()[:5]
        if not re.match(r"^\d{5}$", z):
            return None
        tbl = self._get("data/zips/" + z[:2] + ".json")
        if tbl is None:
            return False
        p = tbl.get(z) if isinstance(tbl, dict) else None
        if not isinstance(p, list) or len(p) < 2:
            return None
        try:
            lat, lon = float(p[0]), float(p[1])
        except (TypeError, ValueError):
            return None
        if not (math.isfinite(lat) and math.isfinite(lon)) or (lat == 0 and lon == 0):
            return None
        return lat, lon

    def zip_town(self, z):
        """"Chetek, WI" from the bids repo's ZIP table, or None."""
        t = self._get("geocodes/zip-towns.json")
        row = ((t or {}).get("zips") or {}).get(str(z)) if isinstance(t, dict) else None
        if isinstance(row, list) and len(row) >= 2 and row[0] and row[1]:
            return "%s, %s" % (str(row[0]).strip(), str(row[1]).strip())
        return None


def miles(lat1, lon1, lat2, lon2):
    R, d = 3958.8, math.pi / 180
    a = (math.sin((lat2 - lat1) * d / 2) * math.sin((lat2 - lat1) * d / 2)
         + math.cos(lat1 * d) * math.cos(lat2 * d)
         * math.sin((lon2 - lon1) * d / 2) * math.sin((lon2 - lon1) * d / 2))
    return R * 2 * math.asin(math.sqrt(a))


# ── bids-network.js snapshot + rowFor ─────────────────────────────────────
def snapshot(idx, lat, lon, radius=RADIUS_MI):
    places = (idx or {}).get("places") if isinstance(idx, dict) else None
    if not places:
        return None
    near = []
    for p in places:
        if not (is_num(p.get("lat")) and is_num(p.get("lon"))):
            continue
        if (p.get("currency") or "USD") != "USD":
            continue
        if not p.get("now"):
            continue
        dd = miles(lat, lon, p["lat"], p["lon"])
        if dd > radius:
            continue
        near.append((p, dd))
    if not near:
        return None
    near.sort(key=lambda x: x[1])          # stable, like Array.prototype.sort
    near = near[:MAX_PLACES]
    bids = []
    for q, dist in near:
        for crop, n in q["now"].items():
            if not n or n.get("cash") is None:
                continue
            bids.append({
                "facility": q.get("operator") or "", "branch": q.get("branch") or None,
                "city": q.get("city") or "", "town": q.get("town") or "", "state": q.get("state") or "",
                "lat": q.get("lat"), "lon": q.get("lon"),
                "commodity": n.get("commodity") or crop, "crop": crop,
                "cashPrice": n.get("cash"), "basis": n.get("basis"), "basisCents": n.get("basisCents"),
                "checkedAt": q.get("checkedAt") or q.get("pricedAt") or None,
                "pricedAt": q.get("pricedAt") or None, "place": q.get("place") or None,
                "delivery": n.get("delivery") or "", "period": n.get("period") or "",
                "distance": None if dist is None else js_round(dist * 10) / 10,
            })
    return bids or None


# ── bids-homepage.js ──────────────────────────────────────────────────────
def not_per_bushel(b):
    return bool(NOT_PER_BUSHEL.search(str(b.get("commodity") or "")))


def wheat_class(b):
    t = str(b.get("commodity") or "")
    if re.search(r"\bhrw\b|hrww|hard red winter|\bkc wheat", t, re.I):
        return "HRW"
    if re.search(r"\bsrw\b|soft red", t, re.I):
        return "SRW"
    if re.search(r"\bhrs\b|hard red spring|spring wheat|\bdns\b|dark northern", t, re.I):
        return "HRS"
    if re.search(r"soft white|\bsww\b|white wheat", t, re.I):
        return "SWW"
    if re.search(r"durum", t, re.I):
        return "Durum"
    return ""


def is_special_grade(b):
    if b.get("category") == "wheat" and wheat_class(b) == "HRS":
        return False
    return bool(SPECIAL_GRADE.search(str(b.get("commodity") or "")))


def classify_commodity(name):
    n = (name or "").lower()
    if NOT_PER_BUSHEL.search(n):
        return "other"
    if re.search(r"sorghum|\bmilo\b", n):
        return "sorghum"
    if re.search(r"\boats?\b", n):
        return "oats"
    if "corn" in n:
        return "corn"
    if "soy" in n or "bean" in n:
        return "soybeans"
    if "wheat" in n or "hrw" in n or "srw" in n or "hrs" in n:
        return "wheat"
    return "other"


def ppu(raw):
    if raw is None:
        return None
    return raw / 100 if raw > 30 else raw


def plausible(b):
    band = PPU_BAND.get(b.get("category"))
    if not band:
        return True
    if PER_CWT.search(str(b.get("commodity") or "")):
        return False
    p = ppu(b.get("cashPrice"))
    return p is not None and band[0] <= p <= band[1]


def in_scope(b):
    st = str(b.get("state") or "").strip().upper()
    if st and st not in US_STATES:
        return False
    if b.get("currency") and str(b["currency"]).upper() != "USD":
        return False
    return True


def period_label(p):
    m = re.match(r"^(\d{4})-(\d{2})(?:/(\d{4})-(\d{2}))?", p or "")
    if not m or not (1 <= int(m.group(2)) <= 12):
        return ""
    if m.group(3) and (m.group(3) != m.group(1) or m.group(4) != m.group(2)) and 1 <= int(m.group(4)) <= 12:
        return (MON[int(m.group(2)) - 1] + ("" if m.group(3) == m.group(1) else " " + m.group(1))
                + "–" + MON[int(m.group(4)) - 1] + " " + m.group(3))
    return MON[int(m.group(2)) - 1] + " " + m.group(1)


def from_network(snap_bids, now=None):
    nw = this_month(now)
    rows = []
    for r in snap_bids:
        p_end = str(r.get("period") or "").split("/")[-1]
        if re.match(r"^\d{4}-\d{2}", p_end) and p_end[:7] < nw:
            continue
        crop = r.get("crop") or ""
        if not_per_bushel(r):
            cat = "other"
        elif re.match(r"^(corn|soybeans|wheat|sorghum|oats)$", crop):
            cat = crop
        else:
            cat = classify_commodity(r.get("commodity"))
        bc = r.get("basisCents")
        rows.append({
            "facility": r.get("facility") or "", "branch": r.get("branch") or "",
            "city": r.get("city") or "", "town": r.get("town") or "", "state": r.get("state") or "",
            "distance": r.get("distance"), "commodity": r.get("commodity") or "",
            "cashPrice": r.get("cashPrice"),
            "basis": bc / 100 if is_num(bc) else r.get("basis"),
            "deliveryMonth": period_label(r.get("period")) or r.get("delivery") or "",
            "checkedAt": r.get("checkedAt"), "pricedAt": r.get("pricedAt"),
            "netCrop": crop, "place": r.get("place") or "",
            "deliveryStart": r.get("period") or "", "deliveryEnd": "",
            "category": cat, "source": "network", "currency": "",
            "lat": r.get("lat") if is_num(r.get("lat")) else None,
            "lon": r.get("lon") if is_num(r.get("lon")) else None,
        })
    return rows


def token_month(r, now=None):
    p = str(r.get("deliveryStart") or "").strip().lower()
    nw = this_month(now)
    tok = p == "spot" or bool(re.match(r"^(newcrop|oldcrop)-\d{4}$", p))
    de = re.match(r"^(\d{4}-\d{2})-\d{2}$", str(r.get("deliveryEnd") or "").strip()) if tok else None
    if de:
        return {"key": de.group(1)} if de.group(1) >= nw else {"key": "", "expired": True}
    if p == "spot":
        return {"key": nw}
    nc = re.match(r"^newcrop-(\d{4})$", p)
    if nc:
        w = NC_WIN.get(r.get("category")) or NC_WIN.get(r.get("netCrop"))
        if not w:
            return {"key": ""}
        s, e = "%s-%02d" % (nc.group(1), w[0]), "%s-%02d" % (nc.group(1), w[1])
        if nw < s:
            return {"key": s}
        if nw <= e:
            return {"key": nw}
        return {"key": "", "expired": True}
    oc = re.match(r"^oldcrop-(\d{4})$", p)
    if oc:
        a = CY_START.get(r.get("category")) or CY_START.get(r.get("netCrop")) or 9
        y = int(oc.group(1))
        cs = "%d-%02d" % (y, a)
        ce = "%d-12" % y if a == 1 else "%d-%02d" % (y + 1, a - 1)
        if nw < cs:
            return {"key": cs}
        if nw <= ce:
            return {"key": nw}
        return {"key": "", "expired": True}
    return None


def row_expired(r, now=None):
    t = token_month(r, now)
    return bool(t and t.get("expired"))


def row_month_key(r, now=None):
    tk = token_month(r, now)
    if tk:
        return tk["key"]
    mm = re.match(r"^([A-Za-z]{3})[A-Za-z]*\s*'?(\d{2}|\d{4})$", str(r.get("deliveryMonth") or "").strip())
    i = [x.lower() for x in MON].index(mm.group(1).lower()) if (mm and mm.group(1).lower() in [x.lower() for x in MON]) else -1
    if i >= 0:
        return ("20" + mm.group(2) if len(mm.group(2)) == 2 else mm.group(2)) + "-%02d" % (i + 1)
    m = re.match(r"^(\d{4})-(\d{2})(?:/(\d{4})-(\d{2}))?", str(r.get("deliveryStart") or ""))
    if not m:
        return ""
    st, nw = m.group(1) + "-" + m.group(2), this_month(now)
    if m.group(3) and st < nw and (m.group(3) + "-" + m.group(4)) >= nw:
        return nw
    return st


def month_short(k, now=None):
    m = re.match(r"^(\d{4})-(\d{2})$", k or "")
    if not m:
        return ""
    return MON[int(m.group(2)) - 1] + ("" if m.group(1) == ct_today(now)[:4] else " '" + m.group(1)[2:])


def norm_operator(name):
    t = re.sub(r"[^a-z0-9]+", " ", str(name or "").lower())
    t = t.replace("co op", "coop").replace("co operative", "cooperative")
    t = [x for x in t.split(" ") if x]
    while t and t[-1] in LEGAL:
        t.pop()
    t = ["coop" if x in ("cooperative", "coops") else x for x in t]
    t = [FOLD.get(x, x) for x in t]
    t = [x[:-1] if (len(x) > 3 and x[-1] == "s") else x for x in t]
    return "".join(t)


def plain(x):
    return re.sub(r"[^a-z0-9]", "", str(x or "").lower())


def group_by_elevator(bids):
    m, order = {}, []
    for b in bids:
        key = (b.get("facility") or "") + "||" + (b.get("branch") or "") + "||" + (b.get("city") or "") + "||" + ("n" if b.get("source") == "network" else "l")
        if key not in m:
            m[key] = {"facility": b.get("facility"), "branch": b.get("branch"), "city": b.get("city"),
                      "town": b.get("town") or "", "state": b.get("state"), "distance": b.get("distance"),
                      "fromNetwork": False,
                      "lat": b["lat"] if is_num(b.get("lat")) else None,
                      "lon": b["lon"] if is_num(b.get("lon")) else None,
                      "pricedAt": b.get("pricedAt") or None, "checkedAt": b.get("checkedAt") or None,
                      "commodities": {}}
            order.append(key)
        e = m[key]
        if b.get("pricedAt") and (not e["pricedAt"] or b["pricedAt"] > e["pricedAt"]):
            e["pricedAt"] = b["pricedAt"]
        if b.get("checkedAt") and (not e["checkedAt"] or b["checkedAt"] > e["checkedAt"]):
            e["checkedAt"] = b["checkedAt"]
        if b.get("source") == "network":
            e["fromNetwork"] = True
        e["commodities"].setdefault(b.get("category") or "other", []).append(b)
    return [m[k] for k in order]


def _row_id(c, b):
    return "|".join([c, str(b.get("deliveryStart") or b.get("deliveryMonth") or ""),
                     js_str(b.get("cashPrice")), js_str(b.get("basis")), str(b.get("commodity") or "")])


def merge_one_pin(elevs):
    seen, out = {}, []
    for e in elevs:
        if not e.get("fromNetwork") or not is_num(e.get("lat")) or not is_num(e.get("lon")):
            out.append(e)
            continue
        k = norm_operator(e.get("facility")) + "@" + ("%.4f" % e["lat"]) + "," + ("%.4f" % e["lon"]) + "|" + plain(e.get("state"))
        mm = seen.get(k)
        if not mm:
            seen[k] = e
            out.append(e)
            continue
        if e.get("pricedAt") and (not mm.get("pricedAt") or e["pricedAt"] > mm["pricedAt"]):
            mm["pricedAt"] = e["pricedAt"]
        if e.get("checkedAt") and (not mm.get("checkedAt") or e["checkedAt"] > mm["checkedAt"]):
            mm["checkedAt"] = e["checkedAt"]
        for c in COMM_ORDER:
            for b in e["commodities"].get(c) or []:
                lst = mm["commodities"].setdefault(c, [])
                rid = _row_id(c, b)
                if not any(_row_id(c, x) == rid for x in lst):
                    lst.append(b)
    return out


def freshness(e, now=None):
    o = {"stale": False, "ageUnknown": True}
    if e.get("fromNetwork"):
        if not parse_iso(e.get("pricedAt")):
            return o
        o["ageUnknown"] = False
        o["stale"] = bool(stale_since(e.get("pricedAt"), now))
    return o


def basis_cents(b):
    if b is None:
        return None
    return b * 100 if abs(b) < 5 else b


def top_pick(elevators, cat, now=None):
    now_key = this_month(now)
    fresh, old = [], []
    for e in elevators:
        fr = freshness(e, now)
        for b in e["commodities"].get(cat) or []:
            if not_per_bushel(b) or is_special_grade(b) or ppu(b.get("cashPrice")) is None or row_expired(b, now):
                continue
            (old if fr["stale"] else fresh).append({"e": e, "b": b, "stale": fr["stale"], "fr": fr})

    def narrow(lst):
        keyed = [x for x in lst if row_month_key(x["b"], now) and row_month_key(x["b"], now) >= now_key]
        if not keyed:
            return lst
        mk = min(row_month_key(x["b"], now) for x in keyed)
        return [x for x in keyed if row_month_key(x["b"], now) == mk]

    def highest(lst):
        best = None
        for x in lst:
            if best is None or ppu(x["b"]["cashPrice"]) > ppu(best["b"]["cashPrice"]):
                best = x
        return best

    src = fresh if fresh else old
    if not src:
        return None
    best = highest(narrow(src))
    higher_older = None
    if fresh and old:
        mk = row_month_key(best["b"], now)
        hi = highest([x for x in old if row_month_key(x["b"], now) == mk])
        if hi and ppu(hi["b"]["cashPrice"]) > ppu(best["b"]["cashPrice"]):
            higher_older = hi
    return {"best": best, "higherOlder": higher_older}


def town_of(x):
    return str((x.get("town") or x.get("city")) or "")


def top_entry(elevators, cat, now=None):
    tp = top_pick(elevators, cat, now)
    if not tp:
        return None
    best = tp["best"]
    b, e = best["b"], best["e"]
    pp, bc = ppu(b["cashPrice"]), basis_cents(b.get("basis"))
    ho = tp["higherOlder"]
    t = town_of(e)
    return {
        "cash": js_round(pp * 10000) / 10000,
        "basis": None if bc is None else js_round(bc * 100) / 10000,
        "name": e.get("facility") or "",
        "town": t + (", " if (t and e.get("state")) else "") + (e.get("state") or ""),
        "mi": None if e.get("distance") is None else js_round(e["distance"] * 10) / 10,
        "posted": str(e["pricedAt"]) if (e.get("fromNetwork") and e.get("pricedAt")) else None,
        "stale": best["stale"],
        "month": month_short(row_month_key(b, now), now) or None,
        "higherOlder": ({"cash": js_round(ppu(ho["b"]["cashPrice"]) * 10000) / 10000,
                         "posted": str(ho["e"]["pricedAt"]) if (ho["e"].get("fromNetwork") and ho["e"].get("pricedAt")) else None}
                        if ho else None),
        "ageUnknown": bool(best["fr"]["ageUnknown"]),
    }


def top_for_zip(data, z, now=None):
    """The hero's summary for one ZIP: {status, zip, place, radiusMi, corn,
    soybeans, wheat}. status: ok | none (read fine, nothing within 50 mi) |
    nozip (no centroid for this ZIP) | failed (a file could not be read)."""
    z = str(z or "").strip()
    out = {"status": "ok", "zip": z, "place": None, "radiusMi": RADIUS_MI,
           "corn": None, "soybeans": None, "wheat": None}
    c = data.zip_coord(z)
    if c is False:
        out["status"] = "failed"
        return out
    if c is None:
        out["status"] = "nozip"
        return out
    idx = data.index()
    if not idx or not isinstance(idx, dict) or not idx.get("places"):
        out["status"] = "failed"
        return out
    out["place"] = data.zip_town(z) or ("ZIP " + z)
    snap = snapshot(idx, c[0], c[1])
    rows = [b for b in from_network(snap or [], now)
            if (b.get("cashPrice") is not None or b.get("basis") is not None) and in_scope(b) and plausible(b)]
    if not rows:
        out["status"] = "none"
        return out
    elevators = merge_one_pin(group_by_elevator(rows))
    elevators.sort(key=lambda e: 999 if e.get("distance") is None else e["distance"])
    for crop in ("corn", "soybeans", "wheat"):
        out[crop] = top_entry(elevators, crop, now)
    return out


# ── the email line ────────────────────────────────────────────────────────
def _crop_bit(x, word, first):
    head = ("top %s bid " % word) if first else (word + " ")
    bit = head + q_cash_text(x["cash"])
    who = [s for s in (x.get("name"), (("%d mi" % js_round(x["mi"])) if is_num(x.get("mi")) else "")) if s]
    if who:
        bit += " (" + ", ".join(who) + ")"
    return bit


def _crop_detail(x, word):
    parts = []
    if x.get("month"):
        parts.append(x["month"] + " delivery")
    if is_num(x.get("basis")):
        parts.append(q_cents(x["basis"] * 100) + " basis")
    if x.get("town"):
        parts.append(x["town"])
    if x.get("stale"):
        d = ct_short(x.get("posted"))
        parts.append("posted " + d if d else "older posting")
    elif x.get("ageUnknown"):
        parts.append("posting time unknown")
    s = word.capitalize() + ": " + ", ".join(parts) + "."
    ho = x.get("higherOlder")
    if ho and is_num(ho.get("cash")):
        d = ct_short(ho.get("posted"))
        s += " An older posting bids " + q_cash_text(ho["cash"]) + (" (" + d + ")" if d else "") + "."
    return s


def email_lines(top):
    """The opening line and its detail lines, or None when nothing local can
    honestly be said (no centroid, files unreadable)."""
    if not top or top.get("status") not in ("ok", "none"):
        return None
    place, r = top.get("place") or ("ZIP " + str(top.get("zip"))), top.get("radiusMi") or RADIUS_MI
    corn, soy = top.get("corn"), top.get("soybeans")
    bits = []
    if corn:
        bits.append(_crop_bit(corn, "corn", True))
    else:
        bits.append("No posted corn bid within %d mi" % r)
    if soy:
        bits.append(_crop_bit(soy, "soybeans", not corn))
    else:
        bits.append("no posted soybean bid within %d mi" % r if corn else "nor soybeans")
    head = "Near %s: %s." % (place, ", ".join(bits))
    detail = [_crop_detail(corn, "corn") if corn else None, _crop_detail(soy, "soybeans") if soy else None]
    return {"head": head, "detail": [d for d in detail if d], "place": place, "status": top["status"]}


def _selftest():
    fails = []

    def eq(a, b, m):
        if a != b:
            fails.append("%s: got %r wanted %r" % (m, a, b))
    eq(q_cash_text(4.3775), "$4.37 3/4", "quarter cents up")
    eq(q_cash_text(4.38), "$4.38", "whole cent")
    eq(q_cash_text(4.0025), "$4.00 1/4", "quarter")
    eq(q_cash_text(4.99875), "$5.00", "rounds to the next dollar")
    eq(q_cents(-62.5), "−62 1/2¢", "basis half")
    eq(q_cents(-0.5), "−1/2¢", "basis under a cent")
    eq(q_cents(0.1), "even", "flat")
    eq(q_cents(15), "+15¢", "positive")
    eq(js_round(-2.5), -2, "Math.round(-2.5)")
    eq(js_str(4.0), "4", "String(4)")
    eq(js_str(4.715), "4.715", "String(4.715)")
    eq(period_label("2026-08/2026-11"), "Aug–Nov 2026", "window label")
    eq(period_label("2026-12/2027-01"), "Dec 2026–Jan 2027", "cross-year label")
    eq(period_label("2026-10"), "Oct 2026", "month label")
    oct6 = datetime(2026, 10, 6, 18, 0, tzinfo=timezone.utc)
    eq(row_month_key({"deliveryMonth": "Aug–Nov 2026", "deliveryStart": "2026-08/2026-11"}, oct6), "2026-10", "open window is this month")
    eq(row_month_key({"deliveryMonth": "Nov 2026", "deliveryStart": "2026-11"}, oct6), "2026-11", "label month")
    eq(token_month({"deliveryStart": "newcrop-2026", "category": "corn"}, oct6), {"key": "2026-10"}, "newcrop inside")
    eq(token_month({"deliveryStart": "newcrop-2027", "category": "corn"}, oct6), {"key": "2027-09"}, "newcrop before")
    eq(row_expired({"deliveryStart": "newcrop-2026", "category": "wheat"}, oct6), True, "wheat newcrop after Sep")
    eq(token_month({"deliveryStart": "oldcrop-2026", "category": "wheat"}, oct6), {"key": "2026-10"}, "oldcrop wheat in crop year")
    eq(row_expired({"deliveryStart": "oldcrop-2025", "category": "corn"}, oct6), True, "2025 corn past Aug 2026")
    eq(month_short("2027-01", oct6), "Jan '27", "next-year month")
    eq(stale_since("2026-10-01T18:00:21.759Z", oct6), "2026-10-01", "Oct 1 stale on Oct 6")
    eq(stale_since("2026-10-05T18:00:00Z", oct6), "", "Monday fresh on Tuesday")
    sat = datetime(2026, 10, 10, 15, 0, tzinfo=timezone.utc)
    eq(stale_since("2026-10-09T15:00:00Z", sat), "", "Friday fresh on Saturday")
    eq(stale_since("2026-10-08T15:00:00Z", sat), "2026-10-08", "Thursday stale on Saturday")
    eq(ct_short("2026-10-01T03:00:00Z"), "Sep 30", "Central-time day, not UTC")
    eq(norm_operator("Farmers Co-op Elevator Co."), "farmercoopelevator", "operator fold")
    eq(email_lines({"status": "nozip", "zip": "00000"}), None, "no centroid: nothing printed")
    none = email_lines({"status": "none", "zip": "59715", "place": "Bozeman, MT", "radiusMi": 50})
    eq(none["head"], "Near Bozeman, MT: No posted corn bid within 50 mi, nor soybeans.", "nothing within 50 mi")
    if fails:
        for f in fails:
            print("FAIL", f)
        return 1
    print("local_bid selftest ok")
    return 0


def main(argv):
    if "--selftest" in argv:
        return _selftest()
    z = argv[argv.index("--zip") + 1] if "--zip" in argv else ""
    top = top_for_zip(BidsData(), z)
    if "--json" in argv:
        print(json.dumps(top, sort_keys=True))
        return 0
    lines = email_lines(top)
    print("status: " + top["status"])
    if lines:
        print(lines["head"])
        for d in lines["detail"]:
            print("  " + d)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
