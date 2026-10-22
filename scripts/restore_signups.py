"""One-time: add the signups kept during the Oct 21-22 worker block straight
to their lists, as Sig asked (no confirm email). Reads
private/pending-signups.jsonl from dnilgis/feedbag (branch private-data),
posts each to the worker's own routes, and prints counts only.

Daily and notice records go through /subscribe and /notice, which add at once.
An elevator alert is asked with /elevator-watch-subscribe and then confirmed
with the same signed link the confirm email would carry, so no email is sent.
"""
import base64, hashlib, hmac, json, os, sys, urllib.parse, urllib.request

UA = {"User-Agent": "AGSIST-automation/1.0 (+https://agsist.com)"}
# The public signup routes take posts only from the site (publicGate checks Origin).
SITE = {"Origin": "https://agsist.com"}


def post(url, body=None):
    data = json.dumps(body).encode() if body is not None else b""
    req = urllib.request.Request(url, data=data, method="POST",
                                 headers=dict(UA, **SITE, **({"Content-Type": "application/json"} if body is not None else {})))
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as ex:
        return ex.code, ex.read().decode("utf-8", "replace")


def hmac16(msg, secret):
    return hmac.new(secret.encode(), msg.lower().encode(), hashlib.sha256).hexdigest()[:16]


def main():
    base = urllib.parse.urlsplit(os.environ["LIST_URL"].strip())
    base = "%s://%s" % (base.scheme, base.netloc)
    secret = os.environ["UNSUB_SECRET"]
    req = urllib.request.Request(
        "https://api.github.com/repos/dnilgis/feedbag/contents/private/pending-signups.jsonl?ref=private-data",
        headers=dict(UA, Authorization="Bearer " + os.environ["PRIVATE_REPO_TOKEN"], Accept="application/vnd.github.raw"))
    rows = [json.loads(l) for l in urllib.request.urlopen(req, timeout=30).read().decode().splitlines() if l.strip()]
    done = {"daily": 0, "notice": 0, "elevator alert": 0}
    bad = 0
    for r in rows:
        e = str(r.get("email", "")).strip().lower()
        d = r.get("details") or {}
        lst = r.get("list", "")
        if lst == "AGSIST Daily":
            body = {"email": e, "source": r.get("source") or "signup-fallback", "reports": bool(d.get("reports"))}
            if r.get("zip"):
                body["zip"] = r["zip"]
            code, txt = post(base + "/subscribe", body)
            ok = code == 200 and '"ok":true' in txt
            kind = "daily"
        elif lst.startswith("notice"):
            code, txt = post(base + "/notice", {"email": e, "topic": r["topic"], "source": "signup-fallback", "daily": False})
            ok = code == 200 and '"ok":true' in txt
            kind = "notice"
        elif lst == "elevator alert":
            wid = d["wid"].lower()
            code, txt = post(base + "/elevator-watch-subscribe", {"email": e, "wid": wid, "label": d["label"]})
            ok = code == 200 and '"ok":true' in txt
            if ok:
                q = urllib.parse.urlencode({"e": e, "w": wid, "t": hmac16(e + "|ec|" + wid, secret)})
                code, txt = post(base + "/elevator-watch-confirm?" + q)
                ok = code == 200 and "You are watching" in txt
            kind = "elevator alert"
        else:
            ok, kind = False, None
        if ok:
            done[kind] += 1
        else:
            bad += 1
            print("not added: one %s record (HTTP %s)" % (lst or "unknown", code if kind else "-"))
    print("added: %s; not added: %d" % (", ".join("%s %d" % kv for kv in done.items()), bad))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
