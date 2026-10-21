#!/usr/bin/env python3
"""Ag in 60: upload the video and its exact captions to YouTube.

    python3 scripts/ag60/upload.py --out DIR [--privacy private|unlisted|public] [--synthetic yes|no] [--dry-run]

Needs three secrets in the environment: YT_CLIENT_ID, YT_CLIENT_SECRET and
YT_REFRESH_TOKEN (an OAuth refresh token for the channel's Google account,
scope https://www.googleapis.com/auth/youtube.upload plus
https://www.googleapis.com/auth/youtube.force-ssl for captions). Without them
it says so and exits 0: the workflow still keeps the MP4 as an artifact.

YouTube Data API v3: videos.insert (resumable upload) then captions.insert
with the script's own captions (DIR/captions.srt), so the captions match the
words exactly instead of YouTube's automatic ones. Until the API project
passes YouTube's audit, every upload it makes stays private (YouTube's rule
for projects created after July 28, 2020); Sig can switch each one to public
by hand in YouTube Studio until then.

Standard library only. Prints the video id and link, never a key.
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

TOKEN_URL = "https://oauth2.googleapis.com/token"
UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status"
CAPTION_URL = "https://www.googleapis.com/upload/youtube/v3/captions?uploadType=multipart&part=snippet"


def request(url, data=None, headers=None, method=None):
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=600) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def access_token():
    body = urllib.parse.urlencode({"client_id": os.environ["YT_CLIENT_ID"], "client_secret": os.environ["YT_CLIENT_SECRET"],
                                   "refresh_token": os.environ["YT_REFRESH_TOKEN"], "grant_type": "refresh_token"}).encode()
    st, _, raw = request(TOKEN_URL, body, {"Content-Type": "application/x-www-form-urlencoded"})
    if st != 200:
        # invalid_grant: the refresh token expired (7 days while the consent screen is in Testing) or was revoked
        err = json.loads(raw or b"{}").get("error", st)
        raise SystemExit(f"upload: token refresh failed ({err}); make a new refresh token (scripts/ag60/upload.py notes)")
    return json.loads(raw)["access_token"]


def video_body(meta, privacy, synthetic):
    status = {"privacyStatus": privacy, "selfDeclaredMadeForKids": bool(meta.get("madeForKids", False)), "embeddable": True}
    if synthetic is not None:
        status["containsSyntheticMedia"] = synthetic
    return {"snippet": {"title": meta["title"], "description": meta["description"], "tags": meta.get("tags", []),
                        "categoryId": meta.get("categoryId", "25"), "defaultLanguage": "en", "defaultAudioLanguage": "en"},
            "status": status}


def upload(path, body, token):
    size = os.path.getsize(path)
    h = {"Authorization": f"Bearer {token}", "Content-Type": "application/json; charset=UTF-8",
         "X-Upload-Content-Type": "video/mp4", "X-Upload-Content-Length": str(size)}
    st, hd, raw = request(UPLOAD_URL, json.dumps(body).encode(), h)
    if st == 400 and "containsSyntheticMedia" in body["status"]:
        body["status"].pop("containsSyntheticMedia")          # an API without the field: retry without it
        print("upload: containsSyntheticMedia not accepted; set the label by hand in YouTube Studio")
        st, hd, raw = request(UPLOAD_URL, json.dumps(body).encode(), h)
    loc = {k.lower(): v for k, v in hd.items()}.get("location")
    if st != 200 or not loc:
        raise SystemExit(f"upload: could not start ({st}) {raw[:300]!r}")
    with open(path, "rb") as f:
        st, _, raw = request(loc, f.read(), {"Authorization": f"Bearer {token}", "Content-Type": "video/mp4"}, "PUT")
    if st not in (200, 201):
        raise SystemExit(f"upload: video failed ({st}) {raw[:300]!r}")
    return json.loads(raw)


def captions(video_id, srt_path, token):
    meta = json.dumps({"snippet": {"videoId": video_id, "language": "en", "name": "English", "isDraft": False}})
    with open(srt_path, "rb") as f:
        srt = f.read()
    b = "ag60" + uuid.uuid4().hex
    body = (f"--{b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{meta}\r\n"
            f"--{b}\r\nContent-Type: application/octet-stream\r\n\r\n").encode() + srt + f"\r\n--{b}--\r\n".encode()
    st, _, raw = request(CAPTION_URL, body, {"Authorization": f"Bearer {token}", "Content-Type": f"multipart/related; boundary={b}"})
    if st not in (200, 201):
        print(f"upload: captions failed ({st}) {raw[:200]!r}; the burned-in captions still show")
        return False
    return True


def main(argv=None):
    ap = argparse.ArgumentParser(description="Ag in 60 upload")
    ap.add_argument("--out", required=True)
    ap.add_argument("--privacy", default="private", choices=["private", "unlisted", "public"])
    ap.add_argument("--synthetic", default="yes", choices=["yes", "no", "unset"])
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args(argv)
    with open(os.path.join(a.out, "metadata.json"), encoding="utf-8") as f:
        meta = json.load(f)
    syn = {"yes": True, "no": False, "unset": None}[a.synthetic]
    body = video_body(meta, a.privacy, syn)
    mp4 = os.path.join(a.out, "ag60.mp4")
    if a.dry_run:
        print(json.dumps(body, ensure_ascii=False, indent=1))
        return 0
    missing = [k for k in ("YT_CLIENT_ID", "YT_CLIENT_SECRET", "YT_REFRESH_TOKEN") if not os.environ.get(k)]
    if missing:
        print(f"upload: skipped, no {', '.join(missing)} (the MP4 is in the run's artifact)")
        return 0
    if not os.path.exists(mp4):
        raise SystemExit("upload: no ag60.mp4")
    token = access_token()
    v = upload(mp4, body, token)
    vid = v.get("id")
    print(f"upload: https://youtu.be/{vid} privacy {v.get('status', {}).get('privacyStatus')}")
    srt = os.path.join(a.out, "captions.srt")
    if vid and os.path.exists(srt):
        captions(vid, srt, token)
    with open(os.path.join(a.out, "youtube.json"), "w", encoding="utf-8") as f:
        json.dump({"id": vid, "status": v.get("status", {})}, f, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
