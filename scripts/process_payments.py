#!/usr/bin/env python3
"""process_payments.py — FSA payment files (browser-downloaded xlsx) →
/payments page data. Like AFIDA: fsa.usda.gov tarpits datacenter IPs, so
Sig downloads the ~11 state-range files in his browser once a year and this
runs LOCALLY (workspace), never in CI.

Schema validated on the real FY2025 WV-WY file (2026-07-19):
  1 header row, 16 cols: State FSA Code/Name, County FSA Code/Name,
  Formatted Payee Name, addr fields, Disbursement Amount, Payment Date,
  Accounting Program Code/Description/Year.
  FSA state+county codes match FIPS (spot-checked: Barbour WV = 54001).
  Ranges are alphabetical by STATE NAME (WV-WY = WVa, Wisconsin, Wyoming).

DESIGN DECISION (farmer-first, the ANTI-EWG): we AGGREGATE. No searchable
name database — EWG already runs the shame list. Output is county/program/
size-distribution truth: who the safety net actually catches.

Outputs:
  data/payments/national.json  totals, program table, payee-size histogram,
                               per-state summaries, medians
  data/payments/county.json    {fips: {t(otal), n_payees, pmts, med(ian
                               payee total), top:[[program, $]x3]}}

Usage: python scripts/process_payments.py <dir-with-xlsx-files>
       (reads every .xlsx in the dir; dedupes nothing across files — FSA
        ranges don't overlap; a payee farming in two states appears in each
        state's counties, which is correct for county aggregation)
--selftest builds from a synthetic frame.
"""
import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone

COLS = ["State FSA Code", "State FSA Name", "County FSA Code", "County FSA Name",
        "Formatted Payee Name", "Disbursement Amount", "Payment Date",
        "Accounting Program Description", "Accounting Program Year"]
BUCKETS = [(0, 1000), (1000, 5000), (5000, 25000), (25000, 100000),
           (100000, 500000), (500000, float("inf"))]
BUCKET_LABELS = ["under $1k", "$1k-$5k", "$5k-$25k", "$25k-$100k",
                 "$100k-$500k", "over $500k"]


def load_frames(path):
    import pandas as pd
    frames = []
    files = sorted(f for f in os.listdir(path) if f.lower().endswith(".xlsx"))
    if not files:
        raise SystemExit(f"FATAL: no .xlsx files in {path}")
    for f in files:
        df = pd.read_excel(os.path.join(path, f), engine="openpyxl")
        df.columns = [str(c).strip() for c in df.columns]
        missing = [c for c in COLS if c not in df.columns]
        if missing:
            raise SystemExit(f"FATAL: {f} missing columns {missing} — schema changed, stop and re-validate")
        print(f"  {f}: {len(df):,} rows, states: {sorted(df['State FSA Name'].unique())}")
        frames.append(df[COLS])
    return pd.concat(frames, ignore_index=True)


def shape(df):
    df = df.dropna(subset=["Disbursement Amount", "State FSA Code", "County FSA Code"])
    df = df[df["Disbursement Amount"] > 0]
    df["fips"] = (df["State FSA Code"].astype(int).astype(str).str.zfill(2)
                  + df["County FSA Code"].astype(int).astype(str).str.zfill(3))
    total = float(df["Disbursement Amount"].sum())

    # payee totals (within state — payee key includes state to avoid
    # cross-state name collisions counting as one person)
    df["payee_key"] = df["State FSA Code"].astype(str) + "|" + df["Formatted Payee Name"].astype(str)
    payee_tot = df.groupby("payee_key")["Disbursement Amount"].sum()
    hist = []
    for lo, hi in BUCKETS:
        sel = payee_tot[(payee_tot >= lo) & (payee_tot < hi)]
        hist.append({"n": int(len(sel)), "dollars": round(float(sel.sum()))})

    programs = (df.groupby("Accounting Program Description")["Disbursement Amount"]
                .agg(["sum", "count"]).sort_values("sum", ascending=False))
    prog_table = [{"p": name, "t": round(float(r["sum"])), "n": int(r["count"])}
                  for name, r in programs.iterrows()]

    states = {}
    for st, g in df.groupby("State FSA Name"):
        pt = g.groupby("payee_key")["Disbursement Amount"].sum()
        states[st] = {"t": round(float(g["Disbursement Amount"].sum())),
                      "payees": int(len(pt)), "pmts": int(len(g)),
                      "med": round(float(pt.median()))}

    counties = {}
    for fips, g in df.groupby("fips"):
        pt = g.groupby("payee_key")["Disbursement Amount"].sum()
        top = (g.groupby("Accounting Program Description")["Disbursement Amount"]
               .sum().sort_values(ascending=False).head(3))
        counties[fips] = {"n": str(g["County FSA Name"].iloc[0]),
                          "st": str(g["State FSA Name"].iloc[0]),
                          "t": round(float(g["Disbursement Amount"].sum())),
                          "payees": int(len(pt)), "pmts": int(len(g)),
                          "med": round(float(pt.median())),
                          "top": [[p[:40], round(float(v))] for p, v in top.items()]}

    national = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "USDA FSA payment files (FOIA reading room), FY2025 disbursements",
        "note": ("Aggregates only, by design. Disbursements made during the fiscal "
                 "year; program years reach back where old programs paid late. "
                 "Payee counts are per-state (one operation in two states counts "
                 "in each). No negative/zero rows included."),
        "total": round(total),
        "payees": int(len(payee_tot)),
        "pmts": int(len(df)),
        "median_payee_total": round(float(payee_tot.median())),
        "share_top10pct": round(100 * float(payee_tot[payee_tot >= payee_tot.quantile(0.9)].sum()) / total, 1),
        "buckets": [{"label": l, **h} for l, h in zip(BUCKET_LABELS, hist)],
        "programs": prog_table,
        "states": states,
    }
    return national, counties


def selftest():
    import pandas as pd
    rows = []
    for i in range(50):
        rows.append({"State FSA Code": 54, "State FSA Name": "West Virginia",
                     "County FSA Code": 1, "County FSA Name": "Barbour",
                     "Formatted Payee Name": f"PAYEE {i%20}",
                     "Disbursement Amount": 100.0 * (i + 1),
                     "Payment Date": "2025-06-01",
                     "Accounting Program Description": "TEST PROGRAM" if i % 2 else "OTHER PROGRAM",
                     "Accounting Program Year": 2024})
    rows.append(dict(rows[0], **{"Disbursement Amount": -50.0}))   # negative: dropped
    df = pd.DataFrame(rows)
    national, counties = shape(df)
    assert "54001" in counties, "fips join broken"
    assert national["pmts"] == 50, national["pmts"]          # negative row dropped
    assert national["payees"] == 20
    assert len(national["buckets"]) == 6
    assert counties["54001"]["top"][0][0] in ("TEST PROGRAM", "OTHER PROGRAM")
    assert sum(b["n"] for b in national["buckets"]) == 20
    print("SELFTEST OK — fips join, negative drop, payee rollup, buckets, county top-programs")


def main():
    if "--selftest" in sys.argv:
        return selftest()
    path = sys.argv[1] if len(sys.argv) > 1 else "fsa_downloads"
    df = load_frames(path)
    national, counties = shape(df)
    os.makedirs("data/payments", exist_ok=True)
    json.dump(national, open("data/payments/national.json", "w"), separators=(",", ":"))
    json.dump({"generated": national["generated"], "counties": counties},
              open("data/payments/county.json", "w"), separators=(",", ":"))
    print(f"wrote data/payments: ${national['total']/1e9:.2f}B, "
          f"{national['payees']:,} payees, {len(counties)} counties, "
          f"{len(national['programs'])} programs, median payee ${national['median_payee_total']:,}")


if __name__ == "__main__":
    main()
