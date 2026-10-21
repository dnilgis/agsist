#!/usr/bin/env python3
"""One-time: get the YouTube refresh token for the Ag in 60 upload.

Run on your own computer (not in Actions), once:

    python3 scripts/ag60/get_token.py CLIENT_ID CLIENT_SECRET

It opens Google's sign-in page in your browser. Sign in with the account that
owns the YouTube channel and allow the upload. The token prints in this
terminal only; paste it into the GitHub secret YT_REFRESH_TOKEN and close the
window. It is never written to a file.

The OAuth client must be a "Desktop app" client. If the consent screen is
still in Testing, the token stops working after 7 days: set the app to
"In production" first (Google Cloud console, OAuth consent screen).
"""
import http.server
import json
import secrets
import sys
import urllib.parse
import urllib.request
import webbrowser

SCOPES = "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.force-ssl"


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    cid, csec = sys.argv[1], sys.argv[2]
    state = secrets.token_urlsafe(16)
    got = {}

    class H(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            if q.get("state", [""])[0] == state and "code" in q:
                got["code"] = q["code"][0]
                msg = b"Done. You can close this tab and go back to the terminal."
            else:
                msg = b"Something did not match. Run the script again."
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(msg)

        def log_message(self, *a):
            pass

    srv = http.server.HTTPServer(("127.0.0.1", 0), H)
    redirect = f"http://127.0.0.1:{srv.server_address[1]}"
    url = "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode({
        "client_id": cid, "redirect_uri": redirect, "response_type": "code", "scope": SCOPES,
        "access_type": "offline", "prompt": "consent", "state": state})
    print("Opening your browser. If it does not open, paste this link into it:\n" + url)
    webbrowser.open(url)
    while "code" not in got:
        srv.handle_request()
    body = urllib.parse.urlencode({"code": got["code"], "client_id": cid, "client_secret": csec,
                                   "redirect_uri": redirect, "grant_type": "authorization_code"}).encode()
    with urllib.request.urlopen(urllib.request.Request("https://oauth2.googleapis.com/token", body)) as r:
        tok = json.loads(r.read())
    if "refresh_token" not in tok:
        print("No refresh token came back. Remove the app's access at myaccount.google.com/permissions and run again.")
        return 1
    print("\nYT_REFRESH_TOKEN (paste into the GitHub secret, then clear this window):\n" + tok["refresh_token"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
