#!/usr/bin/env python3
"""
subscribers.py -- the AGSIST Daily list, as records, from the subs worker.

    fetch(base, token)  ->  (records, how)

records: [{"email", "zip", "src", "ts", "reports"}], one per address, in the
order the worker listed them. how: "json" (worker v5.4+, zips and the
report-day opt-in are known) or "plain" (an older worker: addresses only,
every zip None and every reports True -- the v5.4 default).

THE WORKER IS REDEPLOYED BY HAND, SO BOTH ANSWERS MUST WORK. A worker older
than v5.4 ignores `format=json` and answers the plain list with a 200, so a
body that does not parse as a JSON array is read as the plain list. A 4xx on
the JSON request (a route that refuses the parameter) asks again without it.
A 5xx or a network failure is not a list and is raised, as before.
"""
import json
import re
import urllib.error
import urllib.parse
import urllib.request

UA = {"User-Agent": "AGSIST-automation/1.0 (+https://agsist.com; sig@farmers1st.com)"}
ZIP_RE = re.compile(r"^\d{5}$")


def parse_plain(raw):
    out, seen = [], set()
    for r in re.split(r"[,\n]", raw or ""):
        e = r.strip()
        if e and "@" in e and e.lower() not in seen:
            seen.add(e.lower())
            out.append({"email": e, "zip": None, "src": "", "ts": None, "reports": True})
    return out


def parse_json(arr):
    out, seen = [], set()
    for r in arr:
        if not isinstance(r, dict):
            continue
        e = str(r.get("email") or "").strip()
        if not e or "@" not in e or e.lower() in seen:
            continue
        seen.add(e.lower())
        z = str(r.get("zip") or "").strip()
        out.append({"email": e, "zip": z if ZIP_RE.match(z) else None,
                    "src": str(r.get("src") or ""), "ts": r.get("ts"),
                    "reports": r.get("reports") is not False})
    return out


def _get(u):
    with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=30) as r:
        return r.read().decode("utf-8")


def fetch(base, token):
    root = base.rstrip("/") + "/list?token=" + urllib.parse.quote(token)
    try:
        body = _get(root + "&format=json")
    except urllib.error.HTTPError as ex:
        if 400 <= ex.code < 500:
            print("list: format=json refused (HTTP %d); using the plain list" % ex.code)
            return parse_plain(_get(root)), "plain"
        raise
    try:
        arr = json.loads(body)
    except ValueError:
        arr = None
    if isinstance(arr, list):
        return parse_json(arr), "json"
    print("list: the worker answered without JSON (older than v5.4); using the plain list")
    return parse_plain(body), "plain"
