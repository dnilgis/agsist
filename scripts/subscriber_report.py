#!/usr/bin/env python3
"""Email Sig every subscriber, sorted by what they signed up for.

Run by .github/workflows/subscriber-report.yml (manual button only). Reads the
agsist-subs worker's token-gated list routes with LIST_TOKEN, builds one CSV per
list, and mails them to REPORT_TO (else FROM_ADDR, else SMTP_USER).

The repository is public and so are its Actions logs, so this script prints
COUNTS ONLY. No address ever goes to stdout, a file in the repo, or an artifact:
the email is the only place the list goes.

  python3 scripts/subscriber_report.py             build and send
  python3 scripts/subscriber_report.py --selftest  fixtures, no network, no mail
"""
import csv, io, json, os, smtplib, sys, urllib.request
from datetime import datetime, timezone
from email.message import EmailMessage


def env(n, d=None):
    v = os.environ.get(n, "")
    return v if v else d


def get(base, path, token):
    req = urllib.request.Request(f"{base.rstrip('/')}{path}?token={token}" + ("&format=json" if path == "/list" else ""),
                                 headers={"User-Agent": "agsist-subscriber-report"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode())
    except Exception as ex:  # never let a traceback print the URL with the token in it
        print(f"::error::{path} failed: {type(ex).__name__} {getattr(ex, 'code', '')}"); sys.exit(1)


def when(ms):
    try:
        return datetime.fromtimestamp(ms / 1000, timezone.utc).strftime("%Y-%m-%d")
    except Exception:
        return ""


def watch_rows(recs, what):
    """watch / ewatch / pwatch records: {email, w:{id:{...}}, pend:{id:{...}}}."""
    rows = []
    for r in recs:
        for state, group in (("confirmed", r.get("w") or {}), ("waiting to confirm", r.get("pend") or {})):
            for wid, o in group.items():
                o = o if isinstance(o, dict) else {}
                detail = {k: v for k, v in o.items() if k not in ("ts", "label", "m")}
                rows.append({"email": r.get("email", ""), "list": what, "status": state,
                             "item": o.get("label") or wid, "id": wid,
                             "details": "; ".join(f"{k}={v}" for k, v in sorted(detail.items())),
                             "since": when(o.get("ts"))})
    return rows


def build(daily, alerts, county, elev, price):
    lists = {}
    lists["Daily briefing"] = [{"email": s.get("email", ""), "zip": s.get("zip") or "", "source": s.get("src") or "",
                                "report-day emails": "yes" if s.get("reports", True) else "no", "since": when(s.get("ts"))}
                               for s in daily]
    lists["Hail alerts"] = [{"email": a.get("email", ""), "place": a.get("place", ""), "radius mi": a.get("radius_mi", ""),
                             "lat": a.get("lat", ""), "lon": a.get("lon", ""), "since": when(a.get("ts"))} for a in alerts]
    ew = watch_rows(elev, "elevator")
    lists["ZIP-wide price alerts"] = [r for r in ew if r["id"].startswith("ab")]
    lists["Elevator watch"] = [r for r in ew if not r["id"].startswith("ab")]
    lists["Price targets (futures)"] = watch_rows(price, "price")
    lists["County watch"] = watch_rows(county, "county")
    for k in lists:
        lists[k].sort(key=lambda r: (r.get("status", ""), r.get("email", "")))
    return lists


def to_csv(rows):
    if not rows:
        return "none\n"
    b = io.StringIO()
    w = csv.DictWriter(b, fieldnames=list(rows[0].keys()))
    w.writeheader()
    w.writerows(rows)
    return b.getvalue()


def summary(lists):
    emails = set()
    lines = []
    for name, rows in lists.items():
        people = {r["email"] for r in rows}
        emails |= people
        conf = sum(1 for r in rows if r.get("status", "confirmed") == "confirmed")
        extra = f" ({conf} confirmed, {len(rows) - conf} waiting to confirm)" if any("status" in r for r in rows) else ""
        lines.append(f"{name}: {len(people)} people, {len(rows)} sign-ups{extra}")
    lines.append(f"Unique addresses across every list: {len(emails)}")
    return lines


def message(lists, to, from_addr, from_name):
    m = EmailMessage()
    m["To"] = to
    m["From"] = f"{from_name} <{from_addr}>"
    m["Subject"] = "AGSIST subscribers by list, " + datetime.now(timezone.utc).strftime("%b %-d, %Y")
    body = ["Every current subscriber, one attachment per list (open in Excel or Sheets).", ""]
    body += summary(lists)
    body += ["", "Sorted by status, then email. This came from the Subscriber report button on GitHub;",
             "the list is only in this email, never in the public repo or its logs."]
    m.set_content("\n".join(body))
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    for name, rows in lists.items():
        fn = name.lower().replace(" ", "-").replace("(", "").replace(")", "") + f"-{stamp}.csv"
        m.add_attachment(to_csv(rows).encode(), maintype="text", subtype="csv", filename=fn)
    return m


def selftest():
    daily = [{"email": "b@x.com", "zip": "54728", "src": "home", "ts": 1759800000000, "reports": True},
             {"email": "a@x.com", "zip": None, "src": "", "ts": None, "reports": False}]
    alerts = [{"email": "a@x.com", "place": "Thorp, WI", "radius_mi": 10, "lat": 44.96, "lon": -90.8, "ts": 1759800000000}]
    elev = [{"email": "c@x.com", "w": {"9f3a22b1": {"label": "CDR Farms corn", "kind": "cash", "target": 460, "ts": 1, "m": 0},
                                       "ab54728050": {"label": "nearest delivery", "kind": "cash", "target": 430, "ts": 1}},
             "pend": {"1234abcd": {"label": "Eastland", "kind": "any", "ts": 1}}}]
    price = [{"email": "d@x.com", "w": {}, "pend": {"p1": {"label": "Corn Dec ≥ $5", "sym": "corn-dec", "ts": 1}}}]
    county = []
    L = build(daily, alerts, county, elev, price)
    ok = True
    def chk(c, msg):
        nonlocal ok
        print(("ok   " if c else "FAIL ") + msg); ok &= bool(c)
    chk(len(L["Daily briefing"]) == 2 and L["Daily briefing"][0]["email"] == "a@x.com", "daily: both, sorted by email")
    chk(len(L["ZIP-wide price alerts"]) == 1 and len(L["Elevator watch"]) == 2, "ZIP alerts split from elevator watch by the ab id")
    chk([r["status"] for r in L["Elevator watch"]] == ["confirmed", "waiting to confirm"], "confirmed and pending both kept, labeled")
    chk(L["County watch"] == [] and to_csv([]) == "none\n", "an empty list still gets an attachment saying none")
    s = summary(L)
    chk(s[-1] == "Unique addresses across every list: 4", "unique count across lists")
    m = message(L, "me@x.com", "me@x.com", "AGSIST")
    chk(len(list(m.iter_attachments())) == 6, "one CSV per list")
    chk("b@x.com" not in "\n".join(s), "the printed summary carries no address")
    return ok


def main():
    if "--selftest" in sys.argv:
        sys.exit(0 if selftest() else 1)
    base, token = env("LIST_URL", "https://agsist-subs.dnilgis.workers.dev"), env("LIST_TOKEN")
    user, pw = env("SMTP_USER"), env("SMTP_PASS")
    to = env("REPORT_TO") or env("FROM_ADDR") or user
    if not (token and user and pw and to):
        print("::error::LIST_TOKEN, SMTP_USER, SMTP_PASS and a recipient are required"); sys.exit(1)
    lists = build(get(base, "/list", token), get(base, "/alert-list", token), get(base, "/watch-list", token),
                  get(base, "/elevator-watch-list", token), get(base, "/price-watch-list", token))
    for line in summary(lists):
        print(line)
    m = message(lists, to, env("FROM_ADDR") or user, env("FROM_NAME", "AGSIST"))
    with smtplib.SMTP(env("SMTP_HOST", "smtp.gmail.com"), int(env("SMTP_PORT", "587")), timeout=30) as c:
        c.starttls(); c.login(user, pw); c.send_message(m)
    print("sent the report to the owner's address")


if __name__ == "__main__":
    main()
