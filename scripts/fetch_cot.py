#!/usr/bin/env python3
"""
fetch_cot.py — CFTC Commitments of Traders (Disaggregated Futures-Only) fetcher
Writes:
  data/cot.json         — current week summary (homepage widget)
  data/cot-history.json — last 52 weeks per commodity (chart page)

Runs Saturdays via GitHub Actions after Friday 3:30 PM ET CFTC release.
"""

import csv
import io
import json
import os
import sys
import zipfile
from datetime import datetime, timedelta
import urllib.request

OUT_FILE     = "data/cot.json"
HISTORY_FILE = "data/cot-history.json"
CFTC_URL     = "https://www.cftc.gov/files/dea/history/fut_disagg_txt_{year}.zip"
COMMODITIES  = ["corn", "beans", "wheat"]


def fetch_zip(year: int) -> str | None:
    url = CFTC_URL.format(year=year)
    print(f"  Fetching {url}", flush=True)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "AGSIST/1.0"})
        with urllib.request.urlopen(req, timeout=45) as resp:
            raw = resp.read()
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            inner = next((n for n in z.namelist() if n.lower().endswith(".txt")), z.namelist()[0])
            print(f"    Inner file: {inner}", flush=True)
            return z.open(inner).read().decode("utf-8", errors="replace")
    except Exception as e:
        print(f"  Error fetching {year}: {e}", flush=True)
        return None


def match_commodity(market: str) -> str | None:
    m = market.lower()
    if "corn - chicago board of trade" in m:
        return "corn"
    if "soybeans - chicago board of trade" in m:
        return "beans"
    if "wheat" in m and "chicago" in m:
        return "wheat"
    return None


def parse_date(s: str) -> datetime | None:
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m-%d-%Y"):
        try:
            return datetime.strptime(s.strip(), fmt)
        except ValueError:
            pass
    return None


def parse_rows(csv_text: str) -> list[dict]:
    reader = csv.DictReader(io.StringIO(csv_text))
    all_rows = list(reader)

    if all_rows:
        print(f"  Columns (first 10): {list(all_rows[0].keys())[:10]}", flush=True)
        wheat_names = sorted({
            r.get("Market_and_Exchange_Names", "").strip()
            for r in all_rows
            if "wheat" in r.get("Market_and_Exchange_Names", "").lower()
        })
        for wn in wheat_names:
            print(f"  WHEAT found: '{wn}'", flush=True)
        if not wheat_names:
            print("  No wheat markets in this file", flush=True)

    rows = []
    for row in all_rows:
        market = row.get("Market_and_Exchange_Names", "").strip()
        key = match_commodity(market)
        if key is None:
            continue
        try:
            long_pos  = int(row.get("M_Money_Positions_Long_All",  0) or 0)
            short_pos = int(row.get("M_Money_Positions_Short_All", 0) or 0)
            net = long_pos - short_pos
            date_str = row.get("Report_Date_as_YYYY-MM-DD", "").strip()
            if not date_str:
                raw = row.get("As_of_Date_In_Form_YYMMDD", "").strip()
                if len(raw) == 6:
                    date_str = f"20{raw[:2]}-{raw[2:4]}-{raw[4:]}"
            dt = parse_date(date_str)
            if dt is None:
                continue
            rows.append({"commodity": key, "date": date_str, "dt": dt,
                         "net": net, "long": long_pos, "short": short_pos})
        except (ValueError, KeyError, TypeError) as e:
            print(f"  Parse error ({key}): {e}", flush=True)
    return rows


def fmt_k(n: int) -> str:
    if n is None:
        return "--"
    sign = "+" if n >= 0 else "-"
    abs_n = abs(n)
    return f"{sign}{abs_n/1000:.1f}k" if abs_n >= 1000 else f"{sign}{abs_n}"


def main():
    os.makedirs("data", exist_ok=True)

    current_year = datetime.now().year
    all_rows: list[dict] = []

    for year in [current_year - 1, current_year]:
        text = fetch_zip(year)
        if text:
            parsed = parse_rows(text)
            print(f"  Parsed {len(parsed)} rows from {year}", flush=True)
            all_rows.extend(parsed)

    if not all_rows:
        print("ERROR: No rows fetched — aborting.")
        sys.exit(1)

    all_rows.sort(key=lambda r: r["dt"])
    latest_dt  = max(r["dt"] for r in all_rows)
    cutoff_52w = latest_dt - timedelta(weeks=53)
    print(f"\nLatest report date: {latest_dt.strftime('%Y-%m-%d')}", flush=True)

    # ── cot.json — current-week summary ─────────────────────────────────────
    summary: dict = {
        "updated":     datetime.now().strftime("%Y-%m-%d"),
        "report_date": latest_dt.strftime("%B %d, %Y"),
    }

    for key in COMMODITIES:
        comm = [r for r in all_rows if r["commodity"] == key]
        if not comm:
            print(f"  WARNING: No rows for {key}")
            continue
        latest = max(comm, key=lambda r: r["dt"])
        prior_list = [r for r in comm if r["dt"] < latest["dt"]]
        prior = max(prior_list, key=lambda r: r["dt"]) if prior_list else None
        rng = [r for r in comm if r["dt"] >= cutoff_52w] or comm
        nets = [r["net"] for r in rng]
        summary[key] = {
            "net":   latest["net"],
            "prev":  prior["net"] if prior else None,
            "long":  latest["long"],
            "short": latest["short"],
            "min52": min(nets),
            "max52": max(nets),
        }
        chg = (latest["net"] - prior["net"]) if prior else 0
        print(f"  {key:6s}: net={fmt_k(latest['net']):>8s} chg={fmt_k(chg):>8s} | "
              f"52w [{fmt_k(min(nets))} → {fmt_k(max(nets))}]", flush=True)

    with open(OUT_FILE, "w") as f:
        json.dump(summary, f, indent=2)
    print(f"Written {OUT_FILE}")

    # ── cot-history.json — 52 weeks for chart ───────────────────────────────
    history: dict[str, list] = {k: [] for k in COMMODITIES}
    for key in COMMODITIES:
        comm = [r for r in all_rows if r["commodity"] == key and r["dt"] >= cutoff_52w]
        seen: set[str] = set()
        for r in comm:
            if r["date"] not in seen:
                seen.add(r["date"])
                history[key].append({"date": r["date"], "net": r["net"],
                                     "long": r["long"], "short": r["short"]})

    with open(HISTORY_FILE, "w") as f:
        json.dump({"updated": datetime.now().strftime("%Y-%m-%d"), "history": history},
                  f, separators=(",", ":"))
    print(f"Written {HISTORY_FILE}")

    if not any(k in summary for k in COMMODITIES):
        sys.exit(1)


if __name__ == "__main__":
    main()
