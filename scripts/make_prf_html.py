#!/usr/bin/env python3
"""Build prf.html's first draft. Boilerplate scripts (theme, analytics guard)
are lifted byte for byte from store-or-sell.html so they cannot drift by
retyping. After this: scripts/inject_static_nav.py, then scripts/stamp_prf.py."""
import re, sys, pathlib
REPO = pathlib.Path(sys.argv[1])
model = (REPO / "store-or-sell.html").read_text(encoding="utf-8")
m = re.search(r"<script>/\* agsist-theme-early.*?</script><script>/\* agsist-ga-guard.*?</script>\s*<script>window\.dataLayer.*?</script>", model, flags=re.S)
assert m, "boilerplate scripts not found in store-or-sell.html"
BOOT = m.group(0)

def mk(k, v=""):
    return f"<!--prf:{k}-->{v}<!--/prf:{k}-->"

COV = "".join(f'<button type="button" class="chip" data-cov="{c}" aria-pressed="false">{c}%</button>' for c in (70, 75, 80, 85, 90))

WIN = "".join(f'<button type="button" class="chip" data-win="{w}" aria-pressed="false">{w}</button>' for w in (0, 30, 20, 10))

HTML = f"""<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="theme-color" content="#0a0c0d">
  <link rel="preload" href="/components/styles.css?v=24" as="style">
  <link rel="stylesheet" href="/components/styles.css?v=24">
  <link rel="stylesheet" href="/components/prf.css?v=7">
  <link rel="icon" type="image/x-icon"            href="/img/favicon.ico">
  <link rel="icon" type="image/png" sizes="32x32" href="/img/favicon-32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="/img/favicon-16.png">
  <link rel="apple-touch-icon"                    href="/img/apple-touch-icon.png">
  <link rel="manifest"                            href="/manifest.json">
  <title>PRF Insurance Calculator | AGSIST</title>
  <meta name="description" content="">
  <meta name="author" content="Sigurd Lindquist">
  <meta name="robots"      content="index, follow, max-snippet:-1, max-image-preview:large">
  <link rel="canonical"    href="https://agsist.com/prf">
  <meta property="og:type"         content="website">
  <meta property="og:site_name"    content="AGSIST">
  <meta property="og:locale"       content="en_US">
  <meta property="og:title"        content="">
  <meta property="og:description" content="">
  <meta property="og:url"          content="https://agsist.com/prf">
  <meta property="og:image"        content="https://agsist.com/img/og/prf.jpg">
  <meta property="og:image:width"  content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt"    content="">
  <meta name="twitter:card"        content="summary_large_image">
  <meta name="twitter:site"        content="@agsist">
  <meta name="twitter:title"       content="">
  <meta name="twitter:description" content="">
  <meta name="twitter:image"       content="https://agsist.com/img/og/prf.jpg">
  {BOOT}
  <!-- prf:jsonld --><!-- /prf:jsonld -->
</head>
<body>
  <a href="#main" class="skip">Skip to content</a>
  <div id="site-header"></div>
  <main id="main" class="main" tabindex="-1">
  <div class="prf" data-prf data-src="/data/prf/" data-lr-mid="" data-lr-lo="" data-lr-hi="">
    <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a> &rsaquo; <a href="/tools">Tools</a> &rsaquo; <span aria-current="page">PRF insurance calculator</span></nav>
    <p class="page-kicker">Crop year {mk("crop_year")} &middot; sign-up deadline {mk("sales_long")}</p>
    <h1>PRF insurance calculator: what your grid would have paid, every year since {mk("y0")}</h1>
    <p class="prf-lede">Pasture, Rangeland, Forage (PRF) is USDA&rsquo;s rainfall-index insurance for grazing land and hay ground. Find your grid to see the {mk("crop_year")} premium, USDA&rsquo;s share of it, and what the policy would have paid in each of the {mk("nyears")} years from {mk("y0")} to {mk("y1")}. Free, no sign-up, all {mk("grids")} grids in {mk("states")} states.</p>

    <aside class="prf-spon-band prf-spon-offer" aria-label="For businesses"><span class="prf-spon-tag">For businesses</span> <span class="prf-spon-t">Sponsor PRF in your states.<span class="prf-spon-x"> One business per state, on the state page and every county page in it.</span> Price on request.</span> <a href="/prf-sponsor" data-prf-offer data-out="prf-sponsor">See your block and ask &rarr;</a></aside>
    <p class="prf-status" id="prf-status" role="status"></p>
    <noscript><p class="prf-status is-bad">The calculator needs JavaScript. The dates, the rules, the worked example and the method below do not.</p></noscript>

    <div id="prf-app" hidden>
      <section class="prf-card prf-step-find" aria-labelledby="prf-find-h">
        <h2 class="prf-step-h" id="prf-find-h"><span class="prf-n" aria-hidden="true">1</span>Find your grid</h2>
        <form class="prf-find" id="prf-find" autocomplete="off" role="search" aria-labelledby="prf-find-h">
          <label class="prf-find-l" for="prf-q">ZIP, town and state, coordinates, or grid ID</label>
          <div class="prf-find-row">
            <input id="prf-q" type="text" inputmode="text" enterkeyhint="search" placeholder="54728, or Chetek WI" aria-describedby="prf-find-msg">
            <button type="submit" class="btn btn-primary prf-btn-go"><span>Find<span class="prf-find-x"> the grid</span></span></button>
          </div>
        </form>
        <div class="prf-find-alt">
          <button type="button" class="prf-alt" id="prf-loc">Use my location</button>
          <details class="prf-browse"><summary class="prf-alt">Pick by state and county</summary>
            <div class="prf-browse-g">
              <div class="field"><label for="prf-b-st">State</label><select id="prf-b-st"></select></div>
              <div class="field"><label for="prf-b-co">County</label><select id="prf-b-co" disabled><option value="">Pick a state first</option></select></div>
            </div>
            <div class="prf-b-grids" id="prf-b-grids"></div>
          </details>
          <span class="prf-start" id="prf-start"><button type="button" class="prf-alt" id="prf-eg">Open an example: grid 30454, Barron County, Wisconsin</button></span>
        </div>
        <p class="prf-find-msg" id="prf-find-msg" role="status" aria-live="polite"></p>
      </section>
      <button type="button" class="prf-live" id="prf-bar" data-jump="prf-answer-h" hidden></button>
      <p class="prf-sr" id="prf-say" aria-live="polite" aria-atomic="true"></p>

      <div class="prf-tool" id="prf-tool" hidden>
        <div class="prf-pane prf-pane-l">
          <section class="prf-card prf-block prf-o1" aria-labelledby="prf-where-h">
            <h2 class="prf-grid-h" id="prf-where-h">Your grid</h2>
            <div class="prf-where">
              <div class="prf-map" id="prf-map"></div>
              <p class="prf-where-t" id="prf-where-t"></p>
            </div>
            <div class="prf-co-wrap field" id="prf-co-wrap" hidden>
              <label for="prf-co">County the land is in</label>
              <select id="prf-co" aria-describedby="prf-co-why prf-co-how"></select>
              <p class="prf-hint"><span id="prf-co-why">This grid touches <span id="prf-co-n"></span> counties, and each has its own dollar values and limits.</span> <span id="prf-co-how"></span></p>
            </div>
            <details class="prf-about"><summary>Grid edges, size and the official map</summary><p class="prf-fine" id="prf-where-f"></p></details>
            <div class="prf-notice" data-prf-notice hidden></div>
          </section>

          <section class="prf-card prf-block prf-o3" id="prf-setup" aria-labelledby="prf-setup-h">
            <h2 class="prf-step-h"><span class="prf-n" aria-hidden="true">2</span><span id="prf-setup-h">Describe your pasture</span></h2>
            <button type="button" class="prf-setup-sum" id="prf-setup-sum" aria-expanded="false" aria-controls="prf-setup-body"><span class="prf-setup-sum-t" id="prf-setup-sum-t"></span><span class="prf-setup-sum-a">Change</span></button>
            <div class="prf-setup-body" id="prf-setup-body">
            <div class="prf-tabs" id="prf-tabs" role="group" aria-label="Which setup the controls change" hidden>
              <button type="button" class="chip" id="prf-tab-a" aria-pressed="true">Setup A</button>
              <button type="button" class="chip" id="prf-tab-b" aria-pressed="false">Setup B</button>
              <button type="button" class="prf-link" id="prf-dropb">Remove setup B</button>
            </div>
            <p class="prf-hint prf-both" id="prf-both" hidden>Use of the land, acres and share are the same for both setups. Coverage, productivity factor and months are set for each.</p>
            <div class="prf-fields">
              <div class="prf-f prf-f-wide field"><label for="prf-use">Use of the land</label><select id="prf-use" aria-describedby="prf-use-note"></select><p class="prf-hint" id="prf-use-note"></p></div>
              <div class="prf-f field"><label for="prf-acres">Acres to insure</label><input id="prf-acres" type="number" inputmode="numeric" min="1" step="1" value="100"></div>
              <div class="prf-f field"><label for="prf-share">Your share, %</label><input id="prf-share" type="number" inputmode="numeric" min="1" max="100" step="1" value="100" aria-describedby="prf-share-hint"></div>
              <p class="prf-hint prf-f-wide prf-share-hint" id="prf-share-hint">Share of the hay or livestock: 100 unless a landlord or partner takes part.</p>
              <fieldset class="prf-f prf-f-wide"><legend class="prf-lab">Coverage level</legend>
                <div class="prf-cov" id="prf-cov">{COV}</div>
                <p class="prf-hint">It pays when two months of precipitation in the grid come in under this percent of normal. 90% pays soonest and costs most.</p></fieldset>
            </div>

            <div class="prf-ivwrap prf-o4">
              <div class="prf-iv-head"><h3 id="prf-iv-h">Months to insure</h3><span class="prf-iv-total" id="prf-iv-total" role="status" aria-live="polite"></span></div>
              <table class="prf-iv" aria-labelledby="prf-iv-h">
                <thead><tr><th scope="col">Months</th><th scope="col">% of the policy</th></tr></thead>
                <tbody id="prf-iv-body"></tbody>
              </table>
              <div class="prf-iv-foot">
                <button type="button" class="prf-link" id="prf-even">Split evenly</button>
                <button type="button" class="prf-link" id="prf-clear">Clear</button>
              </div>
              <p class="prf-hint">At least two pairs of months, no month in two pairs, and the parts add to 100%. The page opens on April to May and June to July as an example, not a recommendation. Insure the months when a dry spell costs you grass or hay.</p>
            </div>

            <section class="prf-outlook" id="prf-outlook" aria-labelledby="prf-outlook-h" hidden>
              <h3 id="prf-outlook-h">Long-range outlook</h3>
              <div class="prf-outlook-body" id="prf-outlook-body"></div>
            </section>

            <section class="prf-now" id="prf-now" aria-labelledby="prf-now-h" hidden>
              <h3 id="prf-now-h">This interval so far, <span data-pn-grid></span></h3>
              <p class="pn-sub">Where the grid stands in the pairs of months still open, before RMA&rsquo;s final index. Preliminary.</p>
              <div data-pn-body></div>
            </section>

            <details class="prf-more" id="prf-more">
              <summary><span>Productivity factor</span> <span class="prf-more-v" id="prf-pf-sum"></span></summary>
              <fieldset class="prf-f"><legend class="prf-sr">Productivity factor, 60 to 150</legend>
                <div class="prf-pf"><input id="prf-pf" type="range" min="60" max="150" step="1" value="100" aria-label="Productivity factor, slider"><label class="prf-sr" for="prf-pf-n">Productivity factor, 60 to 150</label><input id="prf-pf-n" type="number" inputmode="numeric" min="60" max="150" step="1" value="100" aria-describedby="prf-pf-hint"></div>
                <p class="prf-hint" id="prf-pf-hint"></p></fieldset>
            </details>
            <button type="button" class="btn btn-secondary prf-addb" id="prf-addb">Compare with a second setup</button>
            </div>
          </section>
        </div>

        <div class="prf-pane prf-pane-r">
          <section class="prf-card prf-block prf-o2" aria-labelledby="prf-answer-h">
            <h2 class="prf-step-h"><span class="prf-n" aria-hidden="true">3</span><span id="prf-answer-h">What it costs and what it would have paid</span></h2>
            <p class="prf-policy" id="prf-printsum"></p>
            <div class="prf-answer" id="prf-answer"></div>
            <fieldset class="prf-win"><legend class="prf-lab">Years counted</legend><div class="prf-win-b">{WIN}</div></fieldset>
            <figure class="prf-fig" id="prf-chart-fig" hidden>
              <figcaption id="prf-chart-cap">What it would have paid, year by year</figcaption>
              <div class="prf-chart" id="prf-chart"></div>
              <div class="prf-legend" id="prf-legend"></div>
              <div class="prf-readrow"><button type="button" class="prf-step" data-yr="-1" aria-label="Year before">&lsaquo;</button><p class="prf-read" id="prf-read" aria-live="polite"></p><button type="button" class="prf-step" data-yr="1" aria-label="Year after">&rsaquo;</button></div>
            </figure>
            <div class="prf-acts" id="prf-acts" hidden>
              <button type="button" class="btn btn-secondary" id="prf-share-b">Copy a link to this</button>
              <button type="button" class="btn btn-secondary" id="prf-print">Print</button>
              <button type="button" class="btn btn-secondary" id="prf-csv">Download every year (CSV)</button>
            </div>
            <div class="prf-notes" id="prf-notes"></div>
            <div class="prf-yrs-p" id="prf-yrs-p"></div>
          </section>

          <aside class="prf-spon" id="prf-spon" hidden></aside>
          <section class="prf-block prf-o5" id="prf-cmp-wrap" aria-labelledby="prf-cmp-h" hidden><h3 id="prf-cmp-h">Setup A against setup B</h3><div id="prf-cmp"></div></section>

          <section class="prf-o6" aria-labelledby="prf-det-h">
          <h2 class="prf-step-h"><span class="prf-n" aria-hidden="true">4</span><span id="prf-det-h">The details</span></h2>
          <details class="prf-d" id="prf-years-d"><summary><span class="prf-d-t">Every year, in numbers<span class="prf-d-x">What it would have paid each year, interval by interval</span></span></summary><div id="prf-years"></div></details>
          <section id="prf-optimize" class="prf-block" aria-labelledby="prf-opt-h"><h2 id="prf-opt-h">What the numbers would pick</h2><p class="po-note">This is what the history and current outlook point to, not advice. RMA rates already price most of this in.</p><div data-opt-body></div></section>
          <details class="prf-d" id="prf-pol-d"><summary><span class="prf-d-t">The policy, interval by interval<span class="prf-d-x">Protection, premium and USDA&rsquo;s share on each line, as an insurer lists them</span></span></summary><div id="prf-pol"></div></details>
          <details class="prf-d" id="prf-rec-d"><summary><span class="prf-d-t">Each pair of months on its own<span class="prf-d-x">Normal precipitation, the trigger and how often each interval paid</span></span></summary><div><div id="prf-rec"></div>
            <p class="prf-fine">RMA&rsquo;s handbook: choosing intervals &ldquo;when precipitation is not needed for the insured crop or when precipitation does not normally occur is not an effective use&rdquo; of the policy. A study of two Nebraska sites found PRF lowered income risk when growing-season months were insured, and that winter months raised it (<a href="https://doi.org/10.1108/AFR-10-2017-0097" rel="noopener">Westerhold and others, 2018</a>).</p></div></details>
          <details class="prf-d" id="prf-lad-d"><summary><span class="prf-d-t">The five coverage levels side by side<span class="prf-d-x">The same acres and months at 70% to 90%</span></span></summary><div id="prf-lad"></div></details>
          <details class="prf-d" id="prf-idx-d"><summary><span class="prf-d-t">The grid&rsquo;s index, all eleven intervals, every year<span class="prf-d-x">Precipitation as a percent of normal, with a CSV</span></span></summary><div id="prf-idx"></div></details>
          <details class="prf-d" id="prf-nb-d"><summary><span class="prf-d-t">The grids next door, same policy<span class="prf-d-x">The eight grids around this one, north up</span></span></summary><div id="prf-nb"></div></details>
          </section>
    <p class="prf-printfoot">Crop year {mk("crop_year")}. Sales closing date {mk("sales_long")}; acreage report due {mk("acreage_long")}; premium billed no earlier than {mk("billing_long")}. USDA&rsquo;s share of the premium needs form AD-1026 on file with the Farm Service Agency by the billing date. Grazing acres need livestock you have an interest in, equal to at least 25% of the stocking rate (2027 Crop Provisions, section 4(j)). The native sod rule and the administrative fee are not included. PRF pays on a precipitation index for the grid, not on your production (Basic Provisions, section 13). Every year is priced at {mk("crop_year")} rates on USDA&rsquo;s {mk("crop_year")} record: it is not what PRF paid then, and not a forecast. Your insurer&rsquo;s quote is what counts. agsist.com/prf</p>
        </div>
      </div>

    </div>

    <p class="prf-byline">By <a href="/about">Sigurd Lindquist</a>, CCA, who owns a licensed crop insurance agency. This page sells nothing and sends no one to any agent; its one email box sends your grid&rsquo;s final index when USDA posts it. {mk("built")}. {mk("check")}</p>

    <div class="prf-prose">
    <h2 id="example">What PRF costs: a worked example</h2>
    {mk("example")}

    <h2 id="dates">PRF sign-up and billing dates for {mk("crop_year")}</h2>
    <ul class="prf-dates">
      <li><span class="d">{mk("sales_long")}</span><span>Sales closing date. New policies, and changes to coverage level, months, acres or productivity factor on an existing one, are due at your agent.</span></li>
      <li><span class="d">{mk("acreage_long")}</span><span>Acreage report due, with any lease signed and in hand. Without a report there is no coverage for the year.</span></li>
      <li><span class="d">Jan 1 to Dec 31</span><span>The coverage year. Each pair of months you insure stands on its own.</span></li>
      <li><span class="d">{mk("billing_long")}</span><span>Premium billing date. The premium is earned when the acreage is reported and billed no earlier than this. Premium you owe is taken out of any payment due you, even one paid before this date.</span></li>
    </ul>
    <p>A PRF policy is continuous. If you are already insured and change nothing, it renews on its own with the same elections. Premium still unpaid on the termination date, Dec 1, ends your eligibility.</p>
    <p>A payment, when one is owed, is issued &ldquo;not later than 60 days following the date RMA publishes the final grid index&rdquo; for that interval (Rainfall Index Basic Provisions, section 8(d)). No claim is filed. The dates above are read from USDA&rsquo;s {mk("crop_year")} actuarial files.</p>

    <h2 id="cost">USDA&rsquo;s share of the premium</h2>
    <p>USDA pays {mk("subsidy_sentence")}. You pay the rest, plus an administrative fee per crop and county that this page leaves out.</p>
    <table class="prf-sub-t"><caption class="prf-sr">USDA&rsquo;s share of the premium by coverage level</caption><thead><tr><th scope="col">Coverage level</th><th scope="col">USDA pays</th><th scope="col">You pay</th></tr></thead><tbody>{mk("subsidy_rows")}</tbody></table>
    <p>The share is not automatic. It needs form AD-1026 on file with the Farm Service Agency by the premium billing date (Basic Provisions, section 11(h)). Beginning and veteran farmers and ranchers get a larger share. In six states, native sod broken in recent years gets 50 points less (see below). The premium rate itself is different for every grid, every interval and every coverage level.</p>

    <details class="prf-fold" id="payback-d"><summary><h2 id="payback">How payouts compare with the premium</h2><span class="prf-fold-x">$1 of full premium would have paid back a middle ${mk("lr_mid")}, about the same on every grid and month. Open for the table by month.</span></summary>
    <p>On the full premium, no grid, month or coverage level stands out. Run every rate USDA publishes for {mk("crop_year")} over {mk("y0")} to {mk("y1")}, and $1 of full premium would have paid back a middle <b>${mk("lr_mid")}</b>. Nine in ten of the {mk("lr_n")} grid, interval and coverage combinations fall between ${mk("lr_lo")} and ${mk("lr_hi")}.</p>
    <p>You do not pay the full premium: USDA pays 51% to 59% of it, if you qualify. Any average over the record is made of a few big years and many small or empty ones, and it says nothing about next year.</p>
    <p>The months with the highest rates bring the most dollars of USDA&rsquo;s share per $100 of protection. On {mk("dry_two")} grids, the interval that comes out furthest ahead of your share is one of the grid&rsquo;s two driest. That is why winter and fall months look good on a payback table. It is not a sign they cover the grass you grow.</p>
    <table class="prf-sub-t prf-iv-t"><caption>Each pair of months across the country, at 90% coverage: the middle grid among those USDA rates for that pair.</caption>
      <thead><tr><th scope="col">Months</th><th scope="col">Normal precipitation</th><th scope="col">Premium per $100</th><th scope="col">Years under 90% of normal, of {mk("nyears")}</th><th scope="col">Grids rated</th></tr></thead>
      <tbody>{mk("iv_rows")}</tbody></table>
    </details>

    <details class="prf-fold" id="new-d"><summary><h2 id="new" data-prf-written-for="2027">New for 2027</h2><span class="prf-fold-x">A new precipitation record, a 25% cap on January to February, and livestock required on grazing acres. Open for the details and RMA&rsquo;s wording.</span></summary>
    <ul>
      <li><b>A new precipitation record.</b> The index now comes from NOAA&rsquo;s National Centers for Environmental Information (NCEI), in place of the Climate Prediction Center (CPC) data used through 2026 (<a href="https://www.rma.usda.gov/news-events/news/2026/washington-dc/usda-risk-management-agency-upgrades-rainfall-data-source" rel="noopener">USDA RMA, April 30, 2026</a>). The record starts in {mk("y0")}, not 1948, and each interval is measured against its {mk("y0")} to {mk("y1")} average (<a href="https://www.rma.usda.gov/sites/default/files/2026-06/Rainfall%20Indexa%20Data%202027%20and%20Beyond%20Rainfall%20Index%20Processing.pdf" rel="noopener">RMA&rsquo;s processing note</a>). The grids did not move. Every past year on this page is the figure from that new record.</li>
      <li><b>January to February is capped at 25%.</b> In USDA&rsquo;s {mk("crop_year")} files, {mk("jf_capped")} of the {mk("counties")} counties with PRF limit that interval to 25% of a policy&rsquo;s value. Every interval needs at least 10%, and the others allow up to 50%, 60% or 70%, by county. The calculator applies your county&rsquo;s limits.</li>
      <li><b>Grazing land needs livestock on it.</b> The 2027 Crop Provisions, section 4(j): &ldquo;For the intended use of grazing, you must have an insurable interest in enough livestock grazing the acres that would equate to at least 25% of the stocking rate for the insured acres.&rdquo; RMA&rsquo;s question-and-answer sheet on the rule says: &ldquo;Failure means no indemnity is due and full premium is owed.&rdquo; The livestock can graze the acres at any time in the crop year. Records are asked for on request, not filed, and kept three years. Only natural causes excuse a shortfall. Hay ground is not under this rule. The producer works out the number with the agent, from the FSA National Crop Table or a state or federal lease (<a href="https://www.rma.usda.gov/sites/default/files/2026-10/Pasture%20Rangeland%20Forage%20Stocking%20Rate%20FAQs.pdf" rel="noopener">RMA stocking rate questions</a>).</li>
    </ul>
    </details>

    <h2 id="before">Before you sign</h2>
    <ul>
      <li>You need an insurable interest: you own or lease the ground, and for grazing, the livestock. A lease must be signed and in by the acreage reporting date.</li>
      <li>PRF covers perennial grass, pasture and hay. Forage planted every year is a separate policy, Annual Forage.</li>
      <li>Land in the Conservation Reserve Program or another USDA program that bars haying and grazing, ground with no record of your share, and an allotment with zero authorized use cannot be insured.</li>
      <li>Each acre goes in one grid. You pick a point inside the acres and the grid and county follow from it. Land that lies across a grid line can go in either grid or be split.</li>
      <li>You do not have to insure every acre.</li>
      <li>One coverage level and one productivity factor per county, use and practice. The same acre cannot be insured for both grazing and haying.</li>
      <li>A third party may not pay your premium in return for part of the payment. RMA is investigating such deals.</li>
    </ul>

    <h2 id="prf-not">What PRF does not do</h2>
    <blockquote>&ldquo;This policy does not directly measure, capture, or utilize any actual crop production, including any of your actual crop production. For example, it is possible for you to receive an indemnity payment without suffering a loss of actual crop production. However, you may experience a loss of crop production and not receive an indemnity payment.&rdquo;<cite>USDA RMA, Rainfall Index Basic Provisions (27.1-RI), section 13</cite></blockquote>
    <ul>
      <li>It pays on one thing: precipitation in your grid over two months, against that grid&rsquo;s long-run average. Not on hay yield, cattle weights, heat, hail or a drought declaration.</li>
      <li>The grid is a quarter of a degree on each side. The figure is worked out for the whole grid from weather stations. Your own gauge does not count, and a neighbor a mile away can be in a different grid.</li>
      <li>Precipitation and grass do not move in step. On three university ranches in Kansas and Nebraska, swapping the grid figure for precipitation measured at the site would have cut the mismatch by only 5% to 9% (<a href="https://doi.org/10.22004/ag.econ.281319" rel="noopener">Yu and others, 2019</a>). On California rangeland, insuring one interval, a forage loss went unpaid 31% to 46% of the time (<a href="https://doi.org/10.1111/ajae.12282" rel="noopener">Keller and Saitone, 2022</a>).</li>
      <li>Native sod: in Iowa, Minnesota, Montana, Nebraska, North Dakota and South Dakota, native sod broken in recent years gets 65% of the protection and 50 points less of USDA&rsquo;s share (Crop Provisions, section 4(g)). The calculator does not apply this. It shows a note in those states.</li>
    </ul>

    <h2 id="method">How this page figures it</h2>
    <p>The inputs are USDA&rsquo;s own, copied unchanged: premium rates, county base values, interval limits, subsidy rates and dates from the {mk("crop_year")} Actuarial Data Master, and each grid&rsquo;s index history from the service behind RMA&rsquo;s PRF tool. The arithmetic is the policy&rsquo;s:</p>
    <pre class="prf-math" tabindex="0" aria-label="The arithmetic">protection per acre  = county base value x coverage level
                       x productivity factor
interval protection  = protection per acre x acres x share
                       x part of the policy in the interval
interval premium     = interval protection x premium rate
you pay              = interval premium - USDA's share
payment              = interval protection
                       x (coverage x 100 - index) / (coverage x 100)
                       when the index is under coverage x 100</pre>
    <p>Dollars are rounded the way RMA&rsquo;s own calculator rounds them: protection per acre to the cent, each line to the dollar. An insurer&rsquo;s figure can differ by a dollar or two. {mk("check")}</p>
    <p>What the history is: this year&rsquo;s rates, this year&rsquo;s county values and this year&rsquo;s precipitation record, run over each past year. RMA&rsquo;s own calculator does the same. It is not a record of what PRF paid. Rates, values and the data source were different then, and the average each year is measured against moves every crop year.</p>
    <p>Which county a point is in comes from the Census Bureau&rsquo;s county lines. Within about a mile of a county line the page asks instead of guessing, because the county sets the dollars. {mk("multi_grids")} of the {mk("grids")} grids lie across more than one county.</p>
    <p>What it leaves out: Hawaii, which has its own program and grids. The administrative fee. The native sod rule. Any year USDA has not finished publishing is listed and kept out of every total.</p>
    <p>A ZIP or town you type is sent to a free place-lookup service (Open-Meteo) to find it on the map. The page counts visits and which grids are opened with Google Analytics, unless your browser asks not to be tracked. Nothing you type is stored anywhere but your own browser. Any crop insurance agent can write PRF: <a href="https://www.rma.usda.gov/tools-reports/agent-locator" rel="noopener" data-out="agent-locator">USDA&rsquo;s agent locator</a>. For the official grid for your land, use <a href="https://public-rma.fpac.usda.gov/apps/PRF" rel="noopener" data-out="rma-tool">USDA&rsquo;s grid locator</a>. Your policy and your agent&rsquo;s quote are what count.</p>

    <h2 id="faq">Questions ranchers and hay growers ask</h2>
    <div class="prf-faq">
    <!--prf:faq-->
    <details><summary>What is PRF insurance?</summary><p>Pasture, Rangeland, Forage (PRF) is a federal crop insurance policy for grazing land and hay ground. It pays when precipitation in your grid, over a two-month interval you chose, comes in under a set share of that grid&rsquo;s long-run average. You pick the coverage level, from 70% to 90%, and how to spread the policy across the intervals. USDA pays {mk("subsidy_sentence")} of the premium.</p></details>
    <details><summary>When is the PRF deadline for {mk("crop_year")}?</summary><p>The sales closing date is {mk("sales_long")}. The acreage report is due {mk("acreage_long")}. The premium is billed no earlier than {mk("billing_long")}.</p></details>
    <details><summary>How much does PRF cost per acre?</summary><p>It depends on the grid, the months, the coverage level and the county&rsquo;s value for grazing or hay. {mk("ex_line")} Enter your grid and acres above for your own figure.</p></details>
    <details><summary>Is PRF insurance worth it?</summary><p>On the full premium, the record treats every grid, month and coverage level about the same: over {mk("y0")} to {mk("y1")} at {mk("crop_year")} rates, $1 of premium would have paid back a middle ${mk("lr_mid")}. USDA pays 51% to 59% of the premium if you qualify. Payments come in a few dry years, with many years of nothing between. It is worth more to someone whose grass or hay follows precipitation in the months insured.</p></details>
    <details><summary>What are the PRF intervals?</summary><p>Eleven two-month intervals: January to February, February to March, March to April, April to May, May to June, June to July, July to August, August to September, September to October, October to November and November to December. You insure at least two, no month in two of them, each with at least 10% of the policy. January to February is capped at 25% in {mk("jf_capped")} counties.</p></details>
    <details><summary>Which months should I insure?</summary><p>The policy needs at least two intervals, no month used twice, each between your county&rsquo;s minimum and maximum. Past that it is your call, and no record can make it for you. RMA&rsquo;s handbook puts it this way: choosing intervals &ldquo;when precipitation is not needed for the insured crop or when precipitation does not normally occur is not an effective use&rdquo; of the policy. The calculator shows each interval&rsquo;s normal precipitation in inches.</p></details>
    <details><summary>Is PRF drought insurance?</summary><p>No. It pays on a precipitation index for a grid, two months at a time. A dry summer after a wet spring, a drought declaration, heat or a short hay crop do not trigger it. Only the index does, and only for the months you insured.</p></details>
    <details><summary>How big is a PRF grid, and which one am I in?</summary><p>A grid is a quarter of a degree of latitude by a quarter of a degree of longitude: about 17 miles north to south, and 11 to 16 miles east to west, narrower the farther north. There are {mk("grids")} of them with PRF offers in {mk("states")} states. Type a ZIP, a town or coordinates above to see yours. On a policy, the grid follows from a point you pick inside the acres you insure.</p></details>
    <details><summary>Why are these numbers different from what PRF paid in past years?</summary><p>Because they are not a payment history. Every year is run at {mk("crop_year")} rates and county values, on the precipitation record USDA publishes for {mk("crop_year")}, which starts in {mk("y0")}. Policies through 2026 were paid on a different data source, with the rates of their own year. RMA&rsquo;s own calculator works the same way.</p></details>
    <details><summary>Do I need livestock to insure grazing land?</summary><p>Yes. Starting with the 2027 crop year, land insured for grazing needs livestock you have an interest in, grazing those acres at some time in the year, equal to at least 25% of the stocking rate. Fall short, for any reason but a natural cause, and no payment is due while the full premium is still owed. Hay ground is not under the rule.</p></details>
    <details><summary>Why did my neighbor get a PRF payment when I did not?</summary><p>Three usual reasons: they are in a different grid, they insured different months, or they chose a higher coverage level. Each interval pays on its own, so one dry pair of months can pay a neighbor who insured it and miss you if you did not.</p></details>
    <details><summary>When would I be paid?</summary><p>Not later than 60 days after RMA publishes the final index for the interval, with no claim to file. Premium you owe is taken out of a payment first.</p></details>
    <!--/prf:faq-->
    </div>

    <h2 id="states">PRF by state</h2>
    <p>Counties and grids with PRF offers for {mk("crop_year")}, by state. A grid on a state line counts in both. Each state has its own page with every county&rsquo;s values, and each county its own page with its grids and their record. New to PRF? <a href="/prf/how-prf-works">How PRF works, in plain words</a>.</p>
    <ul class="prf-states">{mk("state_list")}</ul>

    <nav class="prf-links" aria-label="Related tools">
      <a href="/lrp">LRP: price insurance for cattle and hogs</a>
      <a href="/drought-monitor">Drought Monitor</a>
      <a href="/hail-map">Hail map</a>
      <a href="/farmland-atlas">Farmland Atlas</a>
      <a href="/rent/">Cash rent by county</a>
      <a href="/cattle-futures-prices">Cattle futures</a>
      <a href="/harvest-price-tracker">Harvest price tracker</a>
      <a href="/arc-plc">ARC or PLC</a>
    </nav>
    </div>
  </div>
  </main>
  <div id="site-footer"></div>
  <script src="/components/loader.js?v=19" defer></script>
  <script src="/components/prf-sponsor.js?v=3" defer></script>
  <script src="/components/prf-math.js?v=2" defer></script>
  <script src="/components/prf.js?v=6" defer></script>
  <script src="/components/prf-outlook.js?v=2" defer></script>
  <script src="/components/prf-now.js?v=1" defer></script>
  <script src="/components/prf-notice.js?v=1" defer></script>
  <script src="/components/prf-optimize.js?v=4" defer></script>
  <script src="/components/prf-optimize-ui.js?v=6" defer></script>
</body>
</html>
"""
(REPO / "prf.html").write_text(HTML, encoding="utf-8")
print("prf.html written", len(HTML))
