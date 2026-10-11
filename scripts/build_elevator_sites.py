#!/usr/bin/env python3
"""
build_elevator_sites.py - bakes the elevator website offer into
elevator-websites.html from the files that own each number.

  data/elevator-sites.json   setup_usd, monthly_usd, terms, live (the one
                             place the offer is priced; Sig edits this)
  data/elevator-counts.json  bids.elevators, bids.towns (the network's
                             current count, written by build_cash_bid_pages.py)

What it writes, all inside elevator-websites.html:
  every <span data-es="KEY">...</span>  setup, monthly, terms, live, elev, towns
  the meta, og: and twitter: descriptions
  the JSON-LD block <script type="application/ld+json" id="es-ld">: WebPage,
    BreadcrumbList, Service with its two Offers, and FAQPage built from the
    page's own <details class="es-faq-i"> questions, so the two cannot drift.

The page also re-reads both JSON files on load, so a price edit shows to
readers before this runs; .github/workflows/elevator-sites.yml runs it on the
push that changes data/elevator-sites.json.

    python3 scripts/build_elevator_sites.py            write
    python3 scripts/build_elevator_sites.py --check    exit 1 if the page is stale
    python3 scripts/build_elevator_sites.py --selftest offline checks, writes nothing

Stdlib only.
"""
import html
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = "elevator-websites.html"
OFFER = "data/elevator-sites.json"
COUNTS = "data/elevator-counts.json"
URL = "https://agsist.com/elevator-websites"

SPAN_RE = re.compile(r'(<span data-es="([a-z]+)">)([^<]*)(</span>)')
LD_RE = re.compile(r'(<script type="application/ld\+json" id="es-ld">).*?(</script>)', re.S)
FAQ_RE = re.compile(r'<details class="es-faq-i">\s*<summary>(.*?)</summary>\s*<div class="es-faq-a">(.*?)</div>\s*</details>', re.S)


def usd(n):
    return "$" + format(int(n), ",")


def plain(s):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", s))).strip()


def values(offer, counts):
    for k in ("setup_usd", "monthly_usd"):
        if not isinstance(offer.get(k), (int, float)) or offer[k] <= 0:
            raise ValueError("%s: %s must be a positive number" % (OFFER, k))
    for k in ("terms", "live"):
        if not isinstance(offer.get(k), str) or not offer[k].strip():
            raise ValueError("%s: %s must be text" % (OFFER, k))
    v = {"setup": usd(offer["setup_usd"]), "monthly": usd(offer["monthly_usd"]),
         "terms": offer["terms"].strip(), "live": offer["live"].strip()}
    b = (counts or {}).get("bids") or {}
    if isinstance(b.get("elevators"), int) and isinstance(b.get("towns"), int) and b["elevators"] > 0:
        v["elev"], v["towns"] = format(b["elevators"], ","), format(b["towns"], ",")
    return v


def description(v):
    return ("A website for your elevator or co-op on your own domain, with your cash bids, hours and contacts. "
            "%s setup, then %s a month. %s" % (v["setup"], v["monthly"], v["terms"]))


def jsonld(v, offer, faqs):
    return {"@context": "https://schema.org", "@graph": [
        {"@type": "WebPage", "@id": URL + "#webpage", "url": URL, "name": "Elevator websites with your cash bids",
         "description": description(v), "isPartOf": {"@id": "https://agsist.com/#website"}},
        {"@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://agsist.com/"},
            {"@type": "ListItem", "position": 2, "name": "For elevators", "item": "https://agsist.com/elevators"},
            {"@type": "ListItem", "position": 3, "name": "Elevator websites", "item": URL}]},
        {"@type": "Service", "name": "Elevator website with a cash bid board",
         "serviceType": "Website hosting for grain elevators",
         "description": "A hosted website for a grain elevator or co-op on its own domain: posted cash bids and basis, "
                        "delivery hours, contacts, directions and an email bid alert sign-up. Bids are also listed on "
                        "AGSIST's cash bids pages. Live futures quotes are not included.",
         "provider": {"@type": "Person", "name": "Sigurd Lindquist", "jobTitle": "Certified Crop Adviser",
                      "telephone": "+1-715-797-2428", "email": "sig@farmers1st.com", "url": "https://agsist.com/about"},
         "areaServed": {"@type": "Country", "name": "United States"},
         "offers": [
             {"@type": "Offer", "name": "Setup", "url": URL + "#price", "priceCurrency": "USD",
              "price": str(int(offer["setup_usd"]))},
             {"@type": "Offer", "name": "Monthly hosting and bid board", "url": URL + "#price", "priceCurrency": "USD",
              "price": str(int(offer["monthly_usd"])),
              "priceSpecification": {"@type": "UnitPriceSpecification", "price": str(int(offer["monthly_usd"])),
                                     "priceCurrency": "USD", "unitText": "MONTH"}}]},
        {"@type": "FAQPage", "mainEntity": [
            {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in faqs]}]}


def render(page, offer, counts):
    v = values(offer, counts)
    faqs = [(plain(q), plain(a)) for q, a in FAQ_RE.findall(page)]
    if not faqs:
        raise ValueError("%s: no FAQ found" % PAGE)
    missing = {"setup", "monthly", "terms", "live", "elev", "towns"} - {m.group(2) for m in SPAN_RE.finditer(page)}
    if missing:
        raise ValueError("%s: no data-es span for %s" % (PAGE, ", ".join(sorted(missing))))
    out = SPAN_RE.sub(lambda m: m.group(1) + html.escape(v.get(m.group(2), plain(m.group(3))), quote=False) + m.group(4), page)
    d = html.escape(description(v), quote=True)
    for pat in (r'(<meta name="description" content=")[^"]*(">)',
                r'(<meta property="og:description" content=")[^"]*(">)',
                r'(<meta name="twitter:description" content=")[^"]*(">)'):
        rx = re.compile(pat)
        if not rx.search(out):
            raise ValueError("%s: missing tag %s" % (PAGE, pat))
        out = rx.sub(lambda m: m.group(1) + d + m.group(2), out, count=1)
    if not LD_RE.search(out):
        raise ValueError("%s: no es-ld JSON-LD block" % PAGE)
    ld = json.dumps(jsonld(v, offer, faqs), ensure_ascii=False).replace("</", "<\\/")
    out = LD_RE.sub(lambda m: m.group(1) + ld + m.group(2), out, count=1)
    return out


def load(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return f.read()


def main():
    if "--selftest" in sys.argv:
        return selftest()
    page = load(PAGE)
    offer = json.loads(load(OFFER))
    try:
        counts = json.loads(load(COUNTS))
    except (OSError, ValueError):
        counts = None
    out = render(page, offer, counts)
    if "--check" in sys.argv:
        if out != page:
            print("%s is stale; run python3 scripts/build_elevator_sites.py" % PAGE)
            return 1
        print("%s is current" % PAGE)
        return 0
    if out != page:
        with open(os.path.join(ROOT, PAGE), "w", encoding="utf-8") as f:
            f.write(out)
        print("wrote %s" % PAGE)
    else:
        print("%s unchanged" % PAGE)
    return 0


def selftest():
    fails = []

    def ck(name, ok, detail=""):
        print(("  ok   " if ok else "  FAIL ") + name + ("" if ok else "  -- %s" % (detail,)))
        if not ok:
            fails.append(name)

    page = ('<meta name="description" content="old"><meta property="og:description" content="old">'
            '<meta name="twitter:description" content="old"><script type="application/ld+json" id="es-ld">{}</script>'
            '<span data-es="setup">$1</span> <span data-es="monthly">$2</span> <span data-es="terms">x</span> '
            '<span data-es="live">y</span> <span data-es="elev">9</span> <span data-es="towns">8</span> '
            '<span data-es="setup">$1</span>'
            '<details class="es-faq-i">\n<summary>Own domain?</summary>\n<div class="es-faq-a">Yes, it&rsquo;s <a href="#">yours</a>.</div>\n</details>')
    offer = {"setup_usd": 1250, "monthly_usd": 99, "terms": "Month-to-month.", "live": "within a week"}
    counts = {"bids": {"elevators": 1785, "towns": 1406}}
    out = render(page, offer, counts)
    ck("prices baked in every span", out.count('<span data-es="setup">$1,250</span>') == 2 and '<span data-es="monthly">$99</span>' in out, out)
    ck("counts baked", '<span data-es="elev">1,785</span>' in out and '<span data-es="towns">1,406</span>' in out)
    ck("meta descriptions carry the price", len(re.findall(r'description" content="[^"]*\$1,250 setup, then \$99 a month\.', out)) == 3, out)
    ld = json.loads(LD_RE.search(out).group(0).split(">", 1)[1].rsplit("<", 1)[0])
    g = {x["@type"]: x for x in ld["@graph"]}
    ck("Service offers match the file", [o["price"] for o in g["Service"]["offers"]] == ["1250", "99"]
       and g["Service"]["offers"][1]["priceSpecification"]["unitText"] == "MONTH")
    ck("FAQ JSON-LD comes from the page", g["FAQPage"]["mainEntity"][0]["name"] == "Own domain?"
       and g["FAQPage"]["mainEntity"][0]["acceptedAnswer"]["text"] == "Yes, it’s yours.", g["FAQPage"])
    ck("idempotent", render(out, offer, counts) == out)
    ck("no counts file: counts left as written", '<span data-es="elev">9</span>' in render(page, offer, None))
    for bad, why in (({"monthly_usd": 0}, "zero price"), ({"setup_usd": "750"}, "price as text"), ({"terms": ""}, "empty terms")):
        try:
            render(page, dict(offer, **bad), counts)
            ck("refuses " + why, False)
        except ValueError:
            ck("refuses " + why, True)
    try:
        render(page.replace('data-es="towns"', 'data-es="x"'), offer, counts)
        ck("refuses a page missing a span", False)
    except ValueError:
        ck("refuses a page missing a span", True)
    real = render(load(PAGE), json.loads(load(OFFER)), json.loads(load(COUNTS)))
    ck("the real page renders", 'id="es-ld">{"@context"' in real)
    print()
    if fails:
        print("%d FAILED" % len(fails))
        return 1
    print("build_elevator_sites: all checks pass")
    return 0


if __name__ == "__main__":
    sys.exit(main())
