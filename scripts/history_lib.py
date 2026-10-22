#!/usr/bin/env python3
"""history_lib.py -- shared pieces for the history collectors (Sig, Oct 21:
"start the collection jobs" for the insight machine).

The collectors (scripts/backfill_*.py, scripts/history_append.py) write raw
history to history/<source>/ in the runner and save it to the PRIVATE raw
branch with scripts/push_raw.sh. Never to main: /history/ is in .gitignore and
no page reads it.

What is here:
  Fetcher        polite GET: one request at a time per fetcher with a minimum
                 gap, retries with backoff on 429, 5xx and network errors
                 (Retry-After honoured), 404 handed back, never raised.
  Manifest       history/<source>/manifest.json: one entry per chunk (a year,
                 a state-year, a dataset-year) with rows, first and last date,
                 the source URL, when it was fetched and whether it is
                 complete. A complete chunk is skipped on the next run, so a
                 backfill cut off by the 6 h job limit picks up where it
                 stopped when dispatched again.
  csv_gz         deterministic gzip CSV (mtime 0): the same rows give the same
                 bytes, so a rerun is "no change" on raw.
  Budget         stop starting new chunks after N minutes.
  Saver          every N minutes, save what is done so far to raw
                 (push_raw.sh), so a killed job loses at most N minutes.

    python3 scripts/history_lib.py --selftest
"""
import csv
import gzip
import io
import json
import os
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
UA = "AGSIST history collector (+https://agsist.com/data-sources; sig@agsist.com)"
SCHEMA = "agsist-history-manifest/1"


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class FetchError(RuntimeError):
    pass


class Fetcher:
    """Polite GET. `opener` (tests) is a function url -> (status, bytes, headers)."""

    def __init__(self, min_gap=1.0, retries=4, timeout=120, headers=None, opener=None, sleep=time.sleep,
                 backoff=(10, 30, 90, 240), ok=(200, 404)):
        self.ok = tuple(ok)
        self.min_gap, self.retries, self.timeout = min_gap, retries, timeout
        self.headers = dict({"User-Agent": UA, "Accept": "*/*"}, **(headers or {}))
        self.opener, self.sleep, self.backoff = opener, sleep, backoff
        self._last = 0.0
        self._lock = threading.Lock()
        self.calls = 0

    def _open(self, url):
        if self.opener:
            return self.opener(url)
        req = urllib.request.Request(url, headers=self.headers)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                return r.status, r.read(), dict(r.headers)
        except urllib.error.HTTPError as e:
            try:
                body = e.read()
            except Exception:  # noqa: BLE001
                body = b""
            return e.code, body, dict(e.headers or {})

    def get(self, url):
        """-> (status, body). 200 and 404 (or the `ok` list) come back; anything else is retried,
        then FetchError. The gap between calls is at least min_gap seconds."""
        last = None
        for attempt in range(self.retries + 1):
            with self._lock:
                wait = self._last + self.min_gap - time.monotonic()
                if wait > 0:
                    self.sleep(wait)
                self._last = time.monotonic()
                self.calls += 1
            try:
                status, body, headers = self._open(url)
            except Exception as e:  # noqa: BLE001  network: retried
                status, body, headers, last = None, b"", {}, f"{type(e).__name__}: {e}"
            if status in self.ok:
                return status, body
            if status is not None:
                last = f"HTTP {status}"
                if status in (400, 401, 403) and attempt >= 1:
                    break                      # a refusal does not get better by asking four times
            if attempt < self.retries:
                pause = self.backoff[min(attempt, len(self.backoff) - 1)]
                ra = (headers or {}).get("Retry-After") or (headers or {}).get("retry-after")
                if ra and str(ra).isdigit():
                    pause = max(pause, min(int(ra), 600))
                self.sleep(pause)
        raise FetchError(f"{url.split('?')[0]}: {last}")


class Manifest:
    """history/<source>/manifest.json. Chunks are keyed by a short id ("2019",
    "IA/2019", "grain_basis/2019")."""

    def __init__(self, path, source, url, note=""):
        self.path = path
        self.doc = {"schema": SCHEMA, "source": source, "url": url, "note": note, "chunks": {}}
        if os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                old = json.load(f)
            if old.get("schema") == SCHEMA:
                self.doc["chunks"] = old.get("chunks") or {}
                for k in ("started",):
                    if old.get(k):
                        self.doc[k] = old[k]
        self.doc.setdefault("started", now_iso())

    def done(self, chunk):
        c = self.doc["chunks"].get(chunk)
        return bool(c and c.get("complete"))

    def record(self, chunk, rows, first, last, url, complete, **extra):
        e = {"rows": rows, "first": first, "last": last, "url": url, "fetched": now_iso(), "complete": bool(complete)}
        e.update({k: v for k, v in extra.items() if v is not None})
        self.doc["chunks"][chunk] = e

    def totals(self):
        ch = self.doc["chunks"].values()
        firsts = [c["first"] for c in ch if c.get("first")]
        lasts = [c["last"] for c in ch if c.get("last")]
        return {"chunks": len(self.doc["chunks"]), "complete": sum(1 for c in ch if c.get("complete")),
                "rows": sum(int(c.get("rows") or 0) for c in ch),
                "first": min(firsts) if firsts else None, "last": max(lasts) if lasts else None}

    def save(self):
        self.doc["updated"] = now_iso()
        self.doc["totals"] = self.totals()
        os.makedirs(os.path.dirname(self.path) or ".", exist_ok=True)
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self.doc, f, indent=1, sort_keys=True)
            f.write("\n")
        os.replace(tmp, self.path)


def csv_gz_bytes(header, rows):
    s = io.StringIO()
    w = csv.writer(s, lineterminator="\n")
    w.writerow(header)
    for r in rows:
        w.writerow(["" if v is None else v for v in r])
    buf = io.BytesIO()
    with gzip.GzipFile(filename="", mode="wb", fileobj=buf, compresslevel=9, mtime=0) as g:
        g.write(s.getvalue().encode("utf-8"))
    return buf.getvalue()


def write_csv_gz(path, header, rows):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    data = csv_gz_bytes(header, rows)
    with open(path, "wb") as f:
        f.write(data)
    return len(data)


def read_csv_gz(path):
    with gzip.open(path, "rt", encoding="utf-8", newline="") as f:
        r = csv.reader(f)
        head = next(r, None)
        return head, list(r)


class Budget:
    def __init__(self, minutes, clock=time.monotonic):
        self.clock, self.t0, self.limit = clock, clock(), (minutes or 0) * 60

    def left(self):
        return self.limit <= 0 or self.clock() - self.t0 < self.limit


class Saver:
    """Saves history/<source> to raw every `every_min` minutes while a backfill
    runs (HISTORY_PUSH=1 in the workflow; off everywhere else, tests included)."""

    def __init__(self, folder, label, every_min=30, clock=time.monotonic, run=None):
        self.folder, self.label, self.every = folder, label, (every_min or 0) * 60
        self.clock, self.last = clock, clock()
        self.on = os.environ.get("HISTORY_PUSH") == "1"
        self.run = run or (lambda: subprocess.call(["bash", os.path.join(ROOT, "scripts", "push_raw.sh"), self.label, self.folder], cwd=ROOT))
        self.pushes = 0

    def tick(self, manifest, force=False):
        if not self.on:
            return False
        if not force and (self.every <= 0 or self.clock() - self.last < self.every):
            return False
        manifest.save()
        self.run()
        self.pushes += 1
        self.last = self.clock()
        return True


def selftest():
    import tempfile
    fails = []

    def ck(name, ok, detail=""):
        print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  {detail}"))
        if not ok:
            fails.append(name)

    # Fetcher: retries a 503 and a network error, honours Retry-After, gives 404 back, gives up on 403
    seq = {"u1": [(503, b"", {"Retry-After": "5"}), (None, None, None), (200, b"ok", {})], "u2": [(404, b"nf", {})],
           "u3": [(403, b"no", {})] * 9}
    slept = []

    def opener(url):
        r = seq[url].pop(0)
        if r[0] is None:
            raise OSError("reset")
        return r
    f = Fetcher(min_gap=0, opener=opener, sleep=slept.append)
    ck("retry then 200", f.get("u1") == (200, b"ok"))
    ck("Retry-After honoured over the shorter backoff", slept[:1] == [10] and len(slept) == 2, slept)
    ck("404 handed back", f.get("u2") == (404, b"nf"))
    try:
        f.get("u3")
        ck("403 raises", False)
    except FetchError as e:
        ck("403 raises after two asks", "HTTP 403" in str(e) and len(seq["u3"]) == 7, (str(e), len(seq["u3"])))
    # min gap
    clock = [0.0]
    g = Fetcher(min_gap=2, opener=lambda u: (200, b"", {}), sleep=lambda s: slept.append(("gap", round(s, 1))))
    g.get("a"); g.get("b")
    ck("min gap between calls", any(isinstance(x, tuple) for x in slept))
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, "m", "manifest.json")
        m = Manifest(p, "test", "https://example.test")
        m.record("2019", 10, "2019-01-01", "2019-12-31", "https://example.test?y=2019", True)
        m.record("2020", 3, "2020-01-07", "2020-02-01", "https://example.test?y=2020", False)
        m.save()
        m2 = Manifest(p, "test", "https://example.test")
        ck("manifest round trip, complete chunk skipped", m2.done("2019") and not m2.done("2020") and not m2.done("2021"))
        t = m2.totals()
        ck("totals", t == {"chunks": 2, "complete": 1, "rows": 13, "first": "2019-01-01", "last": "2020-02-01"}, t)
        a = os.path.join(d, "a.csv.gz")
        write_csv_gz(a, ["x", "y"], [[1, None], ["b,c", 2]])
        ck("csv gz round trip", read_csv_gz(a) == (["x", "y"], [["1", ""], ["b,c", "2"]]))
        ck("deterministic bytes", csv_gz_bytes(["x"], [[1]]) == csv_gz_bytes(["x"], [[1]]))
        tick = [0]
        b = Budget(1, clock=lambda: tick[0])
        ck("budget open", b.left())
        tick[0] = 61
        ck("budget closed", not b.left())
        ck("budget 0 = no limit", Budget(0).left())
        ran = []
        os.environ.pop("HISTORY_PUSH", None)
        s = Saver("history/x", "x", every_min=1, clock=lambda: tick[0], run=lambda: ran.append(1))
        ck("saver off without HISTORY_PUSH", not s.tick(m2, force=True) and not ran)
        os.environ["HISTORY_PUSH"] = "1"
        try:
            s = Saver("history/x", "x", every_min=1, clock=lambda: tick[0], run=lambda: ran.append(1))
            ck("saver waits for its interval", not s.tick(m2))
            tick[0] += 61
            ck("saver pushes after it", s.tick(m2) and ran == [1])
            ck("saver force", s.tick(m2, force=True) and ran == [1, 1])
        finally:
            os.environ.pop("HISTORY_PUSH", None)
    print(f"history_lib selftest: {len(fails)} failure(s)")
    return 1 if fails else 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(selftest())
    print(__doc__)
