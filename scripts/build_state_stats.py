#!/usr/bin/env python3
"""
AGSIST — build data/state-stats.json from USDA NASS Quick Stats.

National per-state corn / soybean / winter-wheat acreage, yield, and production
for the latest final crop year. Output feeds the Fast Facts "State-Level
Production Data" tab (read as data.stateStats).

Requires env NASS_API_KEY (free: https://quickstats.nass.usda.gov/api).
Stdlib only. Run with --selftest to validate parsing/conversion offline.
"""
import os, sys, json, time, datetime, urllib.request, urllib.parse

API = "https://quickstats.nass.usda.gov/api/api_GET/"

# field -> NASS short_desc (uniquely identifies the series)
SERIES = {
    "corn_yield":            "CORN, GRAIN - YIELD, MEASURED IN BU / ACRE",
    "corn_prod":             "CORN, GRAIN - PRODUCTION, MEASURED IN BU",
    "corn_acres_planted":    "CORN - ACRES PLANTED",
    "corn_acres_harvested":  "CORN, GRAIN - ACRES HARVESTED",
    "bean_yield":            "SOYBEANS - YIELD, MEASURED IN BU / ACRE",
    "bean_prod":             "SOYBEANS - PRODUCTION, MEASURED IN BU",
    "bean_acres_planted":    "SOYBEANS - ACRES PLANTED",
    "bean_acres_harvested":  "SOYBEANS - ACRES HARVESTED",
    "wheat_yield":           "WHEAT, WINTER - YIELD, MEASURED IN BU / ACRE",
    "wheat_prod":            "WHEAT, WINTER - PRODUCTION, MEASURED IN BU",
}
# field -> (divisor, round_digits) for display units used by the page
CONV = {
    "corn_yield": (1, 1), "corn_prod": (1e6, 0),
    "corn_acres_planted": (1e6, 1), "corn_acres_harvested": (1e6, 1),
    "bean_yield": (1, 1), "bean_prod": (1e6, 0),
    "bean_acres_planted": (1e6, 1), "bean_acres_harvested": (1e6, 1),
    "wheat_yield": (1, 1), "wheat_prod": (1e6, 0),
}
STATE_NAMES = {
 "AL":"Alabama","AK":"Alaska","AZ":"Arizona","AR":"Arkansas","CA":"California","CO":"Colorado",
 "CT":"Connecticut","DE":"Delaware","FL":"Florida","GA":"Georgia","HI":"Hawaii","ID":"Idaho",
 "IL":"Illinois","IN":"Indiana","IA":"Iowa","KS":"Kansas","KY":"Kentucky","LA":"Louisiana",
 "ME":"Maine","MD":"Maryland","MA":"Massachusetts","MI":"Michigan","MN":"Minnesota","MS":"Mississippi",
 "MO":"Missouri","MT":"Montana","NE":"Nebraska","NV":"Nevada","NH":"New Hampshire","NJ":"New Jersey",
 "NM":"New Mexico","NY":"New York","NC":"North Carolina","ND":"North Dakota","OH":"Ohio","OK":"Oklahoma",
 "OR":"Oregon","PA":"Pennsylvania","RI":"Rhode Island","SC":"South Carolina","SD":"South Dakota",
 "TN":"Tennessee","TX":"Texas","UT":"Utah","VT":"Vermont","VA":"Virginia","WA":"Washington",
 "WV":"West Virginia","WI":"Wisconsin","WY":"Wyoming",
}

def parse_val(v):
    """NASS values are comma-formatted strings; suppressed flags ((D),(NA),(Z),(X)) -> None."""
    if v is None:
        return None
    v = str(v).strip().replace(",", "")
    if not v or v[0] == "(":
        return None
    try:
        return float(v)
    except ValueError:
        return None

def convert(field, raw):
    if raw is None:
        return None
    div, dig = CONV[field]
    val = raw / div
    val = round(val, dig)
    return int(val) if dig == 0 else val

def fetch_series(key, short_desc, year_ge, _opener=None):
    params = {
        "key": key, "short_desc": short_desc, "agg_level_desc": "STATE",
        "source_desc": "SURVEY", "format": "JSON", "year__GE": str(year_ge),
    }
    # NOTE (2026-08-15): deliberately UNFILTERED on reference_period_desc.
    # In-season AUG/SEP/OCT/NOV FORECAST rows are wanted — they are the most
    # useful number a farmer can see in August — but they must be LABELLED as
    # forecasts, which is what pick_row/assemble below now do. Filtering them
    # out would show a year-old crop; publishing them unlabelled is what this
    # file did until today. Neither is acceptable.
    url = API + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "AGSIST/1.0 (+https://agsist.com)"})
    opener = _opener or urllib.request.urlopen
    last = None
    for attempt in range(4):
        try:
            with opener(req, timeout=60) as r:
                return json.load(r).get("data", [])
        except Exception as e:               # noqa: BLE001 - network/JSON, retry
            last = e
            time.sleep(2 * (attempt + 1))
    print("  ! series failed after retries:", short_desc, "->", last, file=sys.stderr)
    return []

def anchor_year(rows):
    ys = [int(r["year"]) for r in rows if str(r.get("year", "")).isdigit()]
    return max(ys) if ys else None


MONTHS = {"JAN": "January", "FEB": "February", "MAR": "March", "APR": "April",
          "MAY": "May", "JUN": "June", "JUL": "July", "AUG": "August",
          "SEP": "September", "OCT": "October", "NOV": "November", "DEC": "December"}


def is_forecast(ref):
    return "FORECAST" in (ref or "").upper()


def status_label(year, ref):
    """The honest description of one NASS row.

    2026-08-15 INCIDENT: this used to be the unconditional string
    "<year> crop year \u00b7 USDA NASS final". On 2026-08-15 the monthly run
    picked up the Aug 12 Crop Production release and published the 2026
    AUGUST FORECAST -- a crop still standing in the field -- as
    "2026 crop year \u00b7 USDA NASS final", with Iowa corn at 216.0 bu/ac.
    The register predicted this on 2026-08-08 and it shipped anyway.
    """
    ref = (ref or "").upper()
    if is_forecast(ref):
        mon = next((MONTHS[m] for m in MONTHS if m in ref), None)
        return f"{year} crop \u00b7 USDA NASS {mon} forecast" if mon else \
               f"{year} crop \u00b7 USDA NASS in-season forecast"
    return f"{year} crop year \u00b7 USDA NASS final"


def rows_by_state(rows):
    """{state: {year: {reference_period: value}}} — every vintage kept.

    The first cut of this collapsed each state-year to ONE value with a
    "final beats forecast" rule. That rule is right for choosing which vintage
    to publish, but applying it per FIELD is what let a record mix vintages:
    corn yield resolved to the August forecast while corn acres resolved to
    the June Acreage row, and the two did not reconcile. Keep everything here;
    `assemble` picks one vintage for the whole record.
    """
    out = {}
    for r in rows:
        sa = r.get("state_alpha")
        yr = str(r.get("year", ""))
        if not sa or sa == "US" or not yr.isdigit():
            continue
        val = parse_val(r.get("Value"))
        if val is None:
            continue
        ref = r.get("reference_period_desc") or ""
        out.setdefault(sa, {}).setdefault(int(yr), {})[ref] = val
    return out


def pick_vintage(cells):
    """Given {reference_period: value} for one state-year, the vintage to
    publish: a real final if USDA has published one, else the newest
    in-season forecast."""
    if not cells:
        return None
    finals = [r for r in cells if not is_forecast(r)]
    if finals:
        return sorted(finals)[0]
    order = ["NOV", "OCT", "SEP", "AUG", "JUL", "JUN"]
    for mon in order:
        for r in cells:
            if mon in r.upper():
                return r
    return sorted(cells)[0]


def field_map(rows, year):
    """Back-compat shim: values only, for one year (published vintage)."""
    out = {}
    for sa, yrs in rows_by_state(rows).items():
        if year in yrs:
            ref = pick_vintage(yrs[year])
            if ref is not None:
                out[sa] = yrs[year][ref]
    return out


def assemble(raw_by_field, year, by_state=None):
    """Assemble one record per state at the newest year that state actually has.

    Anchoring every state to a single global year is what made 9 states vanish
    on 2026-08-15: the August forecast only covers principal states, so AZ, CA,
    FL, MT, NM, OR, UT, WV and WY silently dropped off the page. Each state now
    carries its own newest row and its own honest label.
    """
    if by_state is None:                  # legacy call path (values only)
        states = set()
        for f in ("corn_yield", "corn_prod", "bean_yield", "bean_prod"):
            states |= set(raw_by_field.get(f, {}).keys())
        stats = {}
        for sa in sorted(states):
            # legacy path keeps no reference periods, so it cannot know whether
            # this is a final -- say so rather than asserting "final" the way
            # the pre-2026-08-15 code did. build() never takes this path.
            rec = {"name": STATE_NAMES.get(sa, sa),
                   "meta": f"{year} crop year \u00b7 USDA NASS"}
            has = False
            for field in SERIES:
                val = convert(field, raw_by_field.get(field, {}).get(sa))
                rec[field] = val
                if val is not None:
                    has = True
            if has:
                stats[sa] = rec
        return stats

    anchors = ("corn_yield", "bean_yield", "corn_prod", "bean_prod")
    states = set()
    for f in anchors:
        states |= set(by_state.get(f, {}).keys())
    stats = {}
    incoherent = []
    for sa in sorted(states):
        # the newest year this state has an anchor value for
        yrs = [max(by_state[f][sa]) for f in anchors
               if sa in by_state.get(f, {}) and by_state[f][sa]]
        if not yrs:
            continue
        yr = max(yrs)
        # ── SAME-VINTAGE RESOLUTION (2026-08-15, second pass) ─────────────
        # Labelling the record was not enough. NASS returns several reference
        # periods for one state-year -- an August yield FORECAST alongside
        # June Acreage rows -- and taking each field independently built
        # records that do not reconcile: on 2026-08-15 the shipped file had
        # Wisconsin corn at 184 bu/ac with a production and acreage implying
        # 196.6, and 8 of the 12 big states were incoherent beyond rounding.
        # The July file (2025 finals, one vintage) was 0 for 13. So: pick the
        # vintage the YIELD came from and take every field from that same
        # vintage. A field with no row in that vintage stays null -- an honest
        # gap beats a number borrowed from a different survey.
        ref = None
        for f in ("corn_yield", "bean_yield", "corn_prod", "bean_prod"):
            cells = by_state.get(f, {}).get(sa, {}).get(yr)
            if cells:
                ref = pick_vintage(cells)
                break
        rec = {"name": STATE_NAMES.get(sa, sa), "meta": status_label(yr, ref),
               "year": yr, "forecast": bool(is_forecast(ref))}
        has = False
        for field in SERIES:
            cells = by_state.get(field, {}).get(sa, {}).get(yr) or {}
            # same-vintage only: a missing field is an honest gap, never a
            # number borrowed from a different survey
            val = convert(field, cells[ref]) if ref in cells else None
            rec[field] = val
            if val is not None:
                has = True
        if not has:
            continue
        # ── coherence assertion: production / harvested acres == yield ────
        for crop in ("corn", "bean"):
            y = rec.get(f"{crop}_yield")
            pr = rec.get(f"{crop}_prod")
            h = rec.get(f"{crop}_acres_harvested")
            if not (y and pr and h) or h < 2.0:
                continue                  # <2M acres: rounding swamps the check
            lo, hi = (pr - 0.5) / (h + 0.05), (pr + 0.5) / (h - 0.05)
            if not (lo <= y <= hi):
                incoherent.append(f"{sa} {crop}: yield {y} vs prod/acres {pr / h:.1f}")
        stats[sa] = rec
    if incoherent:
        print("  ! INCOHERENT state records (production/acres disagree with yield "
              "beyond rounding) — a vintage is still mixed:", file=sys.stderr)
        for line in incoherent:
            print("      " + line, file=sys.stderr)
        raise ValueError(f"{len(incoherent)} state records do not reconcile; "
                         "refusing to publish a table that contradicts itself")
    return stats

def build(key, out_path):
    this_year = datetime.date.today().year
    year_ge = this_year - 3
    raw_rows = {f: fetch_series(key, sd, year_ge) for f, sd in SERIES.items()}
    yr = anchor_year(raw_rows["corn_yield"]) or anchor_year(raw_rows["bean_yield"])
    if not yr:
        print("No usable NASS data returned; leaving existing file untouched.", file=sys.stderr)
        return 1
    by_state = {f: rows_by_state(rows) for f, rows in raw_rows.items()}
    stats = assemble(None, yr, by_state=by_state)
    n_fc = sum(1 for r in stats.values() if r.get("forecast"))
    payload = {
        "updated": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "year": yr, "source": "USDA NASS Quick Stats",
        "stateStats": stats,
    }
    with open(out_path, "w") as fh:
        json.dump(payload, fh, separators=(",", ":"))
    print(f"[state-stats] year={yr} | states={len(stats)} | "
          f"forecast-labelled={n_fc} | final={len(stats) - n_fc} -> wrote {out_path}")
    return 0

# ---- offline self-test (no network) -------------------------------------
def selftest():
    assert parse_val("2,620,000,000") == 2620000000.0
    assert parse_val("(D)") is None and parse_val("(NA)") is None and parse_val("") is None
    assert convert("corn_prod", 2620000000.0) == 2620          # BU -> M bu (int)
    assert convert("corn_acres_planted", 12900000.0) == 12.9   # AC -> M ac
    assert convert("corn_yield", 211.0) == 211.0               # bu/ac passthrough
    assert convert("bean_prod", None) is None
    mock = {
        "corn_yield":  [{"state_alpha":"IA","year":"2025","Value":"211"},
                        {"state_alpha":"US","year":"2025","Value":"186.5"},
                        {"state_alpha":"IA","year":"2023","Value":"201"}],
        "corn_prod":   [{"state_alpha":"IA","year":"2025","Value":"2,620,000,000"}],
        "bean_yield":  [{"state_alpha":"IA","year":"2025","Value":"60"}],
        "bean_prod":   [{"state_alpha":"IA","year":"2025","Value":"598,000,000"}],
        "wheat_yield": [{"state_alpha":"KS","year":"2025","Value":"50"}],
    }
    for f in SERIES:
        mock.setdefault(f, [])
    yr = anchor_year(mock["corn_yield"]); assert yr == 2025, yr
    raw = {f: field_map(rows, yr) for f, rows in mock.items()}
    assert "US" not in raw["corn_yield"] and raw["corn_yield"]["IA"] == 211.0
    stats = assemble(raw, yr)
    assert stats["IA"]["corn_yield"] == 211.0
    assert stats["IA"]["corn_prod"] == 2620
    assert stats["IA"]["bean_prod"] == 598
    assert stats["IA"]["name"] == "Iowa" and "2025" in stats["IA"]["meta"]
    assert "final" not in stats["IA"]["meta"], "legacy path must not assert 'final'"
    assert "KS" not in stats  # KS had only wheat, no corn/bean anchor -> excluded

    # ---- 2026-08-15 REGRESSION: the in-season forecast ------------------
    # Reproduces exactly what shipped: the Aug 12 Crop Production release adds
    # 2026 AUG FORECAST rows for principal states only. Before the fix this
    # published "2026 crop year - USDA NASS final" and dropped every state the
    # forecast does not cover.
    fc = {
        "corn_yield": [
            {"state_alpha": "IA", "year": "2025", "Value": "219",
             "reference_period_desc": "YEAR"},
            {"state_alpha": "IA", "year": "2026", "Value": "216",
             "reference_period_desc": "YEAR - AUG FORECAST"},
            # AZ is NOT in the August forecast - it must survive on its final
            {"state_alpha": "AZ", "year": "2025", "Value": "205",
             "reference_period_desc": "YEAR"},
        ],
        "corn_prod": [
            {"state_alpha": "IA", "year": "2026", "Value": "2,765,000,000",
             "reference_period_desc": "YEAR - AUG FORECAST"},
            {"state_alpha": "AZ", "year": "2025", "Value": "9,000,000",
             "reference_period_desc": "YEAR"},
        ],
    }
    for f in SERIES:
        fc.setdefault(f, [])
    bs = {f: rows_by_state(rows) for f, rows in fc.items()}
    st = assemble(None, 2026, by_state=bs)

    assert st["IA"]["corn_yield"] == 216.0, st["IA"]
    assert st["IA"]["forecast"] is True, st["IA"]
    assert "forecast" in st["IA"]["meta"] and "August" in st["IA"]["meta"], st["IA"]["meta"]
    assert "final" not in st["IA"]["meta"], st["IA"]["meta"]
    # the nine dropped states: AZ keeps its 2025 final, labelled as its own year
    assert "AZ" in st, "a state absent from the forecast vanished from the file"
    assert st["AZ"]["corn_yield"] == 205.0 and st["AZ"]["year"] == 2025, st["AZ"]
    assert st["AZ"]["forecast"] is False and "final" in st["AZ"]["meta"], st["AZ"]["meta"]

    # a FINAL must beat a FORECAST for the same state-year in either order
    for order in (0, 1):
        pair = [{"state_alpha": "NE", "year": "2026", "Value": "190",
                 "reference_period_desc": "YEAR"},
                {"state_alpha": "NE", "year": "2026", "Value": "111",
                 "reference_period_desc": "YEAR - AUG FORECAST"}]
        if order:
            pair.reverse()
        cells = rows_by_state(pair)["NE"][2026]
        assert len(cells) == 2, f"a vintage was dropped: {cells}"
        assert cells[pick_vintage(cells)] == 190.0, \
            f"forecast beat a final (order={order}): {cells}"
    # in-season, with no final on the books, the newest forecast wins
    only_fc = {"YEAR - AUG FORECAST": 216.0, "YEAR - JUL FORECAST": 181.0}
    assert only_fc[pick_vintage(only_fc)] == 216.0

    assert is_forecast("YEAR - SEP FORECAST") and not is_forecast("YEAR")
    assert status_label(2026, "YEAR") == "2026 crop year \u00b7 USDA NASS final"

    # ---- same-vintage resolution + coherence gate -----------------------
    # The real 2026-08-15 shape: the August forecast carries yield AND
    # production, while acres also exist as a separate June Acreage row for
    # the same year. Taking each field independently produced Wisconsin at
    # 184 bu/ac over a production/acreage implying 196.6.
    mixed = {
        "corn_yield": [{"state_alpha": "WI", "year": "2026", "Value": "184",
                        "reference_period_desc": "YEAR - AUG FORECAST"}],
        "corn_prod":  [{"state_alpha": "WI", "year": "2026", "Value": "570,000,000",
                        "reference_period_desc": "YEAR - AUG FORECAST"}],
        # the wrong-vintage acreage that made the record contradict itself
        "corn_acres_harvested": [
            {"state_alpha": "WI", "year": "2026", "Value": "2,900,000",
             "reference_period_desc": "YEAR"},
            {"state_alpha": "WI", "year": "2026", "Value": "3,100,000",
             "reference_period_desc": "YEAR - AUG FORECAST"},
        ],
    }
    for f in SERIES:
        mixed.setdefault(f, [])
    bs2 = {f: rows_by_state(rows) for f, rows in mixed.items()}
    st2 = assemble(None, 2026, by_state=bs2)
    assert st2["WI"]["corn_acres_harvested"] == 3.1, st2["WI"]   # forecast vintage, not June
    assert st2["WI"]["corn_yield"] == 184.0
    # 570 / 3.1 = 183.9 -> reconciles with 184, so the gate stays quiet
    assert "WI" in st2

    # a genuinely incoherent record must REFUSE to publish, not ship quietly
    broken = {k: list(v) for k, v in mixed.items()}
    broken["corn_acres_harvested"] = [
        {"state_alpha": "WI", "year": "2026", "Value": "2,900,000",
         "reference_period_desc": "YEAR - AUG FORECAST"}]
    bs3 = {f: rows_by_state(rows) for f, rows in broken.items()}
    import contextlib, io
    with contextlib.redirect_stderr(io.StringIO()):   # the refusal is expected here
        try:
            assemble(None, 2026, by_state=bs3)
            raise AssertionError("coherence gate did not fire on a self-contradicting record")
        except ValueError as e:
            assert "reconcile" in str(e), e

    # a field with no row in the anchor's vintage stays an honest gap
    gap = {"corn_yield": [{"state_alpha": "NE", "year": "2026", "Value": "183",
                           "reference_period_desc": "YEAR - AUG FORECAST"}],
           "corn_acres_planted": [{"state_alpha": "NE", "year": "2026", "Value": "10,500,000",
                                   "reference_period_desc": "YEAR"}]}
    for f in SERIES:
        gap.setdefault(f, [])
    st4 = assemble(None, 2026, by_state={f: rows_by_state(r) for f, r in gap.items()})
    assert st4["NE"]["corn_yield"] == 183.0
    assert st4["NE"]["corn_acres_planted"] is None, "borrowed a number from another vintage"

    print("selftest OK:", json.dumps(stats["IA"], separators=(",", ":")))
    print("  forecast label:", st["IA"]["meta"])
    print("  non-forecast state kept:", st["AZ"]["meta"])
    return 0

if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(selftest())
    api_key = os.environ.get("NASS_API_KEY", "").strip()
    if not api_key:
        print("ERROR: NASS_API_KEY not set.", file=sys.stderr); sys.exit(2)
    sys.exit(build(api_key, os.environ.get("OUT", "data/state-stats.json")))
