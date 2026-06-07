#!/usr/bin/env python3
"""
AGSIST Grower Pulse - weekly rotation + static page generator.

Run by GitHub Actions every Monday, or manually:
  python scripts/rotate_poll.py               # rotate if it's a new week, then render the page
  python scripts/rotate_poll.py --render-only # just regenerate grower-pulse.html from current data

What "rotate" does, in order:
  1. If the queue is empty -> do nothing but re-render (keeps the current question running).
  2. Otherwise: read the finishing week's FINAL tally from the Worker, append it to the
     archive (with results + total), then promote the next queued question to "current".
  3. Write data/poll.json + data/poll-queue.json, then regenerate grower-pulse.html.

Safety:
  - Never archives the current week unless there is a replacement queued (no orphan state).
  - If the Worker tally can't be fetched, it ABORTS (exit 2) rather than writing a zeroed
    archive entry - no data loss.
  - Idempotent: if it already rotated this week, it only re-renders the page.
"""
import json, os, sys, datetime, html, urllib.request, urllib.parse, urllib.error

REPO       = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
POLL_PATH  = os.path.join(REPO, "data", "poll.json")
QUEUE_PATH = os.path.join(REPO, "data", "poll-queue.json")
PAGE_PATH  = os.path.join(REPO, "grower-pulse.html")
SITEMAP_PATH = os.path.join(REPO, "sitemap.xml")
WORKER     = "https://agsist-poll.dnilgis.workers.dev"
CANONICAL  = "https://agsist.com/grower-pulse"
MONTHS     = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]


def load(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default


def save(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2, ensure_ascii=False)
        f.write("\n")


def this_monday():
    t = datetime.date.today()
    return t - datetime.timedelta(days=t.weekday())


def week_label(iso):
    try:
        d = datetime.date.fromisoformat(iso)
    except Exception:
        d = this_monday()
    return "Week of %s %d" % (MONTHS[d.month - 1], d.day)


def fetch_tally(poll_id):
    url = "%s/?id=%s" % (WORKER, urllib.parse.quote(poll_id))
    req = urllib.request.Request(url, headers={"User-Agent": "agsist-rotate"})
    with urllib.request.urlopen(req, timeout=20) as r:
        data = json.load(r)
    return data.get("tally", {}) or {}


def finalize(current):
    """Snapshot the finishing week's final results from the Worker."""
    n = len(current.get("options", []))
    tally = fetch_tally(current["id"])
    results = [int(tally.get(str(i), 0)) for i in range(n)]
    return {
        "id": current["id"],
        "week": current["week"],
        "question": current["question"],
        "options": current["options"],
        "results": results,
        "total": sum(results),
    }


def rotate(poll, queue, monday_iso):
    current  = poll.get("current")
    upcoming = queue.get("upcoming", [])

    if current and current.get("week") == monday_iso:
        return poll, queue, "noop: already rotated for this week"
    if not upcoming:
        return poll, queue, "noop: queue empty - keeping current question another week"

    if current:
        poll.setdefault("archive", []).insert(0, finalize(current))  # may raise -> caller aborts

    nxt = upcoming.pop(0)
    iso = datetime.date.fromisoformat(monday_iso).isocalendar()
    new_id = nxt.get("id") or "%d-w%02d-%s" % (iso[0], iso[1], nxt["key"])
    poll["current"] = {
        "id": new_id,
        "week": monday_iso,
        "question": nxt["question"],
        "options": nxt["options"],
    }
    queue["upcoming"] = upcoming
    return poll, queue, "rotated -> %s" % new_id


# ---------- static page rendering ----------

def esc(s):
    return html.escape("" if s is None else str(s))


def _bars(opts, results, total):
    maxv = max(results) if results else 0
    rows = []
    for i, opt in enumerate(opts):
        v = results[i] if i < len(results) else 0
        p = round(v * 100 / total) if total else 0
        win = " win" if (v == maxv and total > 0) else ""
        rows.append(
            '<div class="gp-row%s"><div class="gp-fill" style="width:%d%%"></div>'
            '<span class="gp-lbl">%s</span><span class="gp-pct">%d%%</span></div>'
            % (win, p, esc(opt), p)
        )
    return "\n".join(rows)


PAGE_CSS = """
  .gp-wrap{max-width:760px;margin:0 auto;padding:1.5rem 1rem 3rem}
  .gp-h1{font-family:'Oswald',sans-serif;font-weight:700;font-size:1.7rem;line-height:1.15;color:var(--text);margin:.2rem 0 .5rem;text-wrap:balance}
  .gp-intro{font-size:.95rem;color:var(--text-dim);line-height:1.6;margin:0 0 1.4rem}
  .gp-current{background:var(--surface);border:1px solid var(--border-g);border-radius:10px;padding:1.1rem 1.15rem;margin-bottom:1.6rem}
  .gp-kicker{font-family:'Oswald',sans-serif;font-weight:700;font-size:.7rem;letter-spacing:.08em;text-transform:uppercase;color:var(--gold)}
  .gp-week{font-family:'JetBrains Mono',monospace;font-size:.62rem;color:var(--text-muted);margin-left:.5rem}
  .gp-q{font-family:'Oswald',sans-serif;font-weight:600;font-size:1.18rem;color:var(--text);margin:.4rem 0 .8rem;text-wrap:balance}
  .gp-vote-cta{display:inline-block;background:var(--green);color:#0a1a0a;font-family:'Oswald',sans-serif;font-weight:700;font-size:.82rem;letter-spacing:.03em;text-transform:uppercase;padding:.6rem 1rem;border-radius:6px;text-decoration:none}
  .gp-vote-cta:hover{filter:brightness(1.08)}
  .gp-sec-h{font-family:'Oswald',sans-serif;font-weight:700;font-size:1.05rem;letter-spacing:.04em;text-transform:uppercase;color:var(--text);border-bottom:1px solid var(--border);padding-bottom:.4rem;margin:1.8rem 0 1rem}
  .gp-item{padding:1rem 0;border-top:1px solid var(--border)}
  .gp-item:first-child{border-top:none}
  .gp-item-q{font-family:'Oswald',sans-serif;font-weight:600;font-size:1.02rem;color:var(--text);margin-bottom:.1rem;text-wrap:balance}
  .gp-item-week{font-family:'JetBrains Mono',monospace;font-size:.62rem;color:var(--text-muted);margin-bottom:.55rem}
  .gp-bars{display:flex;flex-direction:column;gap:.35rem}
  .gp-row{position:relative;display:flex;align-items:center;justify-content:space-between;padding:.4rem .7rem;background:var(--surface2);border:1px solid var(--border);border-radius:6px;overflow:hidden;min-height:34px}
  .gp-row .gp-fill{position:absolute;inset:0 auto 0 0;background:rgba(255,255,255,.05)}
  .gp-row.win .gp-fill{background:color-mix(in srgb,var(--gold) 18%,transparent)}
  .gp-row.win{border-color:var(--border-g)}
  .gp-lbl{position:relative;font-family:'Inter',sans-serif;font-size:.86rem;color:var(--text-dim)}
  .gp-pct{position:relative;font-family:'JetBrains Mono',monospace;font-weight:700;font-size:.86rem;color:var(--text)}
  .gp-empty{color:var(--text-muted);font-style:italic;padding:.5rem 0}
  .gp-method{margin-top:2rem;font-size:.8rem;color:var(--text-muted);line-height:1.6;border-top:1px solid var(--border);padding-top:1rem}
  .gp-method strong{color:var(--text-dim)}
"""


def render_page(poll):
    current = poll.get("current") or {}
    archive = poll.get("archive", []) or []

    cur_opts = "".join(
        '<li>%s</li>' % esc(o) for o in current.get("options", [])
    )
    current_block = (
        '<div class="gp-current">'
        '<div><span class="gp-kicker">&#x1F33E; This Week\'s Question</span>'
        '<span class="gp-week">%s</span></div>'
        '<h2 class="gp-q">%s</h2>'
        '<ul style="margin:.2rem 0 1rem;padding-left:1.1rem;color:var(--text-dim);font-size:.92rem;line-height:1.7">%s</ul>'
        '<a class="gp-vote-cta" href="/#daily-poll">Cast your vote on the dashboard &rarr;</a>'
        '</div>'
    ) % (esc(week_label(current.get("week"))), esc(current.get("question")), cur_opts)

    if archive:
        items = []
        for wk in archive:
            opts = wk.get("options", [])
            res  = wk.get("results", [])
            total = wk.get("total", sum(res) if res else 0)
            resp = ("%s responses" % format(total, ",")) if total else "no responses"
            items.append(
                '<div class="gp-item">'
                '<div class="gp-item-q">%s</div>'
                '<div class="gp-item-week">%s &middot; %s</div>'
                '<div class="gp-bars">%s</div>'
                '</div>'
                % (esc(wk.get("question")), esc(week_label(wk.get("week"))), esc(resp),
                   _bars(opts, res, total))
            )
        archive_block = "\n".join(items)
    else:
        archive_block = '<p class="gp-empty">Past weeks will appear here as each question closes.</p>'

    ld = {
        "@context": "https://schema.org",
        "@type": "Dataset",
        "name": "AGSIST Grower Pulse - Weekly U.S. Farmer Sentiment",
        "description": "A weekly one-question sentiment poll of U.S. crop, livestock, and dairy producers run by AGSIST. Each week growers report their read on current conditions; aggregate results are published as first-party agricultural sentiment data.",
        "url": CANONICAL,
        "creator": {"@type": "Organization", "name": "AGSIST", "url": "https://agsist.com"},
        "isAccessibleForFree": True,
        "measurementTechnique": "Self-reported single-question web poll; one response per device per week",
        "variableMeasured": "U.S. grower sentiment",
        "distribution": {"@type": "DataDownload", "encodingFormat": "application/json",
                          "contentUrl": "https://agsist.com/data/poll.json"},
    }

    html_out = (
        '<!DOCTYPE html>\n<html lang="en" data-theme="dark">\n<head>\n'
        '<meta charset="UTF-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">\n'
        '<meta name="theme-color" content="#111a0a">\n'
        '<script async src="https://www.googletagmanager.com/gtag/js?id=G-6KXCTD5Z9H"></script>\n'
        '<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag(\'js\',new Date());gtag(\'config\',\'G-6KXCTD5Z9H\');</script>\n'
        '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
        '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
        '<link rel="stylesheet" href="/components/styles.css?v=12">\n'
        '<link rel="icon" type="image/x-icon" href="/img/favicon.ico">\n'
        '<link rel="manifest" href="/manifest.json">\n'
        '<title>Grower Pulse - Weekly U.S. Farmer Sentiment Poll | AGSIST</title>\n'
        '<meta name="description" content="Weekly one-question sentiment poll of U.S. farmers - crop conditions, marketing, input costs, and more. See current and past results from working producers nationwide. Free from AGSIST.">\n'
        '<meta name="author" content="Sigurd Lindquist">\n'
        '<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large">\n'
        '<link rel="canonical" href="' + CANONICAL + '">\n'
        '<meta property="og:type" content="website">\n'
        '<meta property="og:site_name" content="AGSIST">\n'
        '<meta property="og:title" content="Grower Pulse - Weekly U.S. Farmer Sentiment | AGSIST">\n'
        '<meta property="og:description" content="What U.S. farmers are saying this week - and every week. One-tap sentiment poll with public results.">\n'
        '<meta property="og:url" content="' + CANONICAL + '">\n'
        '<meta property="og:image" content="https://agsist.com/img/og/agsist.jpg">\n'
        '<script type="application/ld+json">' + json.dumps(ld, ensure_ascii=False) + '</script>\n'
        '<style>' + PAGE_CSS + '</style>\n'
        '</head>\n<body>\n'
        '<a href="#main" class="skip">Skip to content</a>\n'
        '<div id="site-header"></div>\n'
        '<main id="main" class="main" role="main">\n'
        '<div class="gp-wrap">\n'
        '<h1 class="gp-h1">AGSIST Grower Pulse</h1>\n'
        '<p class="gp-intro">Every week I ask working U.S. farmers one quick question and publish what they say. '
        'It\'s a running read on grower sentiment - crop conditions, marketing, input costs, and the mood of the season - '
        'straight from producers across the country, at no charge.</p>\n'
        + current_block + '\n'
        '<h2 class="gp-sec-h">Past Weeks</h2>\n'
        + archive_block + '\n'
        '<div class="gp-method">'
        '<strong>How this works:</strong> One question per week, one response per device, results shown only after a small '
        'baseline of responses so early numbers aren\'t mistaken for a representative read. Responses are voluntary and '
        'self-reported. New question every Monday. Built and published by Sigurd Lindquist '
        '(<a href="mailto:sig@farmers1st.com" style="color:var(--gold)">sig@farmers1st.com</a>).'
        '</div>\n'
        '</div>\n</main>\n'
        '<div id="site-footer"></div>\n'
        '<script src="/components/loader.js" defer></script>\n'
        '</body>\n</html>\n'
    )

    with open(PAGE_PATH, "w", encoding="utf-8") as f:
        f.write(html_out)
    return html_out


def bump_sitemap():
    """Refresh the <lastmod> on the /grower-pulse sitemap entry (the page changes weekly)."""
    if not os.path.exists(SITEMAP_PATH):
        return False
    import re
    s = open(SITEMAP_PATH, encoding="utf-8").read()
    today = datetime.date.today().isoformat()
    pat = re.compile(r"(<loc>https://agsist\.com/grower-pulse</loc><lastmod>)\d{4}-\d{2}-\d{2}(</lastmod>)")
    new, n = pat.subn(r"\g<1>" + today + r"\g<2>", s)
    if n:
        with open(SITEMAP_PATH, "w", encoding="utf-8") as f:
            f.write(new)
    return bool(n)


def main():
    render_only = "--render-only" in sys.argv
    poll  = load(POLL_PATH, {"current": None, "archive": []})
    queue = load(QUEUE_PATH, {"upcoming": []})

    if render_only:
        render_page(poll)
        bump_sitemap()
        print("rendered page only")
        return

    monday_iso = this_monday().isoformat()
    poll, queue, status = rotate(poll, queue, monday_iso)
    print("rotation:", status)

    if status.startswith("rotated"):
        save(POLL_PATH, poll)
        save(QUEUE_PATH, queue)
    render_page(poll)
    if bump_sitemap():
        print("sitemap lastmod bumped")
    print("page regenerated ->", PAGE_PATH)


if __name__ == "__main__":
    main()
