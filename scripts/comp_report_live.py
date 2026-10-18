"""Open the live /comp-report on a GitHub runner and say whether the subject's owner,
soil and crop history came back (the sandbox cannot reach the parcel maps or the
Field Scout worker). Dispatch only: land-data.yml task=comp-live.

Prints one ::notice:: line per test field and section: filled / empty and the
section's note. Owner names are public record but stay out of the log: the line
says only whether an owner was named.

  python scripts/comp_report_live.py            (needs playwright)
  python scripts/comp_report_live.py --selftest
"""
import json
import re
import sys

BASE = "https://agsist.com/comp-report"
# Field Scout share encoding: lat,lng~lat,lng~...  Barron Co. WI and Story Co. IA (about 40 ac each,
# the same squares scripts/probe_field_layers.py uses) and a Champaign Co. IL square.
FIELDS = {
    "WI Barron": [(45.3100, -91.6550), (45.3100, -91.6499), (45.3136, -91.6499), (45.3136, -91.6550)],
    "IA Story": [(42.0600, -93.5000), (42.0600, -93.4952), (42.0636, -93.4952), (42.0636, -93.5000)],
    "IL Champaign": [(40.1500, -88.3500), (40.1500, -88.3450), (40.1536, -88.3450), (40.1536, -88.3500)],
}
SECTIONS = ["cr-subject", "cr-soil", "cr-cdl"]
WAITING = re.compile(r"reading|loading|looking", re.I)


def url_for(pts):
    return BASE + "?f=" + "~".join("%.5f,%.5f" % p for p in pts) + "&r=25&from=any&amin=any"


def verdict(sec, text):
    """(filled, short note) for one section's visible text. Never returns a name."""
    t = " ".join((text or "").split())
    if not t or WAITING.search(t[:40]):
        return False, "still reading after the wait"
    if sec == "cr-subject":
        named = bool(re.search(r"\bOwner\b", t))
        why = re.search(r"(No owner is named\.|[^.]*parcel map[^.]*\.)", t)
        return named, ("owner named" if named else (why.group(1)[:140] if why else "no owner line"))
    if sec == "cr-soil":
        m = re.search(r"\d+/100 NCCPI(, CSR2 [\d.]+)?", t)
        return bool(m), (m.group(0) if m else t[:140])
    m = re.findall(r"\b(20\d\d)\b", t)
    return len(m) >= 3, ("%d years, newest %s" % (len(m), max(m)) if m else t[:140])


def run():
    from playwright.sync_api import sync_playwright
    bad = 0
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page()
        for name, pts in FIELDS.items():
            pg.goto(url_for(pts), wait_until="domcontentloaded", timeout=60000)
            for sec in SECTIONS:
                text = ""
                for _ in range(45):
                    text = pg.inner_text("#" + sec) if pg.query_selector("#" + sec) else ""
                    if text.strip() and not WAITING.search(text.strip()[:40]):
                        break
                    pg.wait_for_timeout(1000)
                ok, why = verdict(sec, text)
                bad += 0 if ok else 1
                print("::notice title=comp-live %s %s::%s: %s" % (name, sec, "filled" if ok else "EMPTY", why))
        b.close()
    print(json.dumps({"empty_sections": bad}))


def selftest():
    assert verdict("cr-soil", "62/100 NCCPI, CSR2 81.2 Soil Acres")[1] == "62/100 NCCPI, CSR2 81.2"
    assert verdict("cr-soil", "reading")[0] is False
    ok, why = verdict("cr-subject", "County Barron Owner JANE DOE Acres 40")
    assert ok and why == "owner named" and "JANE" not in why
    assert verdict("cr-subject", "The parcel map did not answer. No owner is named.")[1] == "The parcel map did not answer."
    assert verdict("cr-cdl", "2025 Corn 2024 Soybeans 2023 Corn")[1] == "3 years, newest 2025"
    assert url_for([(1, 2), (3, 4), (5, 6)]).endswith("f=1.00000,2.00000~3.00000,4.00000~5.00000,6.00000&r=25&from=any&amin=any")
    print("selftest ok")


if __name__ == "__main__":
    selftest() if "--selftest" in sys.argv else run()
