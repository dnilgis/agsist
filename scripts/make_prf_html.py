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

COV = "".join(f'<button type="button" data-cov="{c}" aria-pressed="false">{c}%</button>' for c in (70, 75, 80, 85, 90))

HTML = f"""<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="theme-color" content="#0a0c0d">
  <link rel="preload" href="/components/styles.css?v=23" as="style">
  <link rel="stylesheet" href="/components/styles.css?v=23">
  <link rel="stylesheet" href="/components/prf.css?v=1">
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
  <meta property="og:title"        content="PRF rainfall insurance: what your grid would have paid, every year on record">
  <meta property="og:description" content="">
  <meta property="og:url"          content="https://agsist.com/prf">
  <meta property="og:image"        content="https://agsist.com/img/og/agsist.jpg">
  <meta name="twitter:card"        content="summary_large_image">
  <meta name="twitter:site"        content="@agsist">
  <meta name="twitter:title"       content="PRF rainfall insurance: what your grid would have paid, every year on record">
  <meta name="twitter:description" content="">
  <meta name="twitter:image"       content="https://agsist.com/img/og/agsist.jpg">
  {BOOT}
  <!-- prf:jsonld --><!-- /prf:jsonld -->
</head>
<body>
  <a href="#main" class="skip">Skip to content</a>
  <div id="site-header"></div>
  <main id="main" class="main" tabindex="-1">
  <div class="prf" data-prf data-src="/data/prf/">
    <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a> &rsaquo; <a href="/tools">Tools</a> &rsaquo; <span aria-current="page">PRF rainfall insurance</span></nav>
    <p class="page-kicker">Crop year {mk("crop_year")} &middot; sign-up closes {mk("sales_long")}</p>
    <h1>PRF rainfall insurance: what your grid would have paid, every year since {mk("y0")}</h1>
    <p class="prf-lede">Pick your grid, your acres and your months. See the premium, USDA&rsquo;s share of it, and what the policy would have paid in each of the {mk("nyears")} years from {mk("y0")} to {mk("y1")}, at this year&rsquo;s rates. It covers all {mk("grids")} grids, across {mk("counties")} counties in {mk("states")} states.</p>
    <p class="prf-byline">By <a href="/about">Sigurd Lindquist</a>, a Certified Crop Adviser (CCA). {mk("built")}. {mk("check")}</p>

    <p class="prf-status" id="prf-status" role="status">Loading the rain record&hellip;</p>
    <noscript><p class="prf-status is-bad">The calculator needs JavaScript. The dates, the rules and the method below do not.</p></noscript>

    <div id="prf-app" hidden>
      <form class="prf-find" id="prf-find" autocomplete="off">
        <label for="prf-q">ZIP, town, or latitude and longitude
          <input id="prf-q" type="text" inputmode="text" enterkeyhint="search" placeholder="54728, or 45.31, -91.65"></label>
        <button type="submit" class="prf-btn prf-btn-go">Find the grid</button>
        <button type="button" class="prf-btn" id="prf-loc">Use my location</button>
      </form>
      <p class="prf-find-msg" id="prf-find-msg" role="status" aria-live="polite"></p>
      <details class="prf-browse"><summary>Or pick by state and county</summary>
        <div class="prf-browse-g">
          <select id="prf-b-st" aria-label="State"></select>
          <select id="prf-b-co" aria-label="County" disabled><option value="">Pick a state first</option></select>
        </div>
        <div class="prf-b-grids" id="prf-b-grids"></div>
      </details>
      <p class="prf-start" id="prf-start">No grid picked yet. <button type="button" class="prf-link" id="prf-eg">Open an example: grid 30454, Barron County, Wisconsin</button></p>
      <button type="button" class="prf-live" id="prf-bar" data-jump="prf-answer-h" hidden></button>

      <div class="prf-tool" id="prf-tool" hidden>
        <div class="prf-pane">
          <section class="prf-block prf-o1" aria-labelledby="prf-where-h">
            <h3 id="prf-where-h">Your grid</h3>
            <div class="prf-where">
              <div class="prf-map" id="prf-map"></div>
              <p class="prf-where-t" id="prf-where-t"></p>
            </div>
            <div class="prf-co-wrap" id="prf-co-wrap" hidden>
              <label for="prf-co">County the land is in. This grid touches <span id="prf-co-n"></span>, and each has its own values.</label>
              <select id="prf-co"></select>
            </div>
          </section>

          <section class="prf-block prf-o3" aria-labelledby="prf-setup-h">
            <div class="prf-tabs" id="prf-tabs" hidden>
              <button type="button" id="prf-tab-a" aria-pressed="true">Setup A</button>
              <button type="button" id="prf-tab-b" aria-pressed="false">Setup B</button>
              <button type="button" class="prf-link" id="prf-dropb">Remove B</button>
            </div>
            <h3 id="prf-setup-h">Your policy</h3>
            <div class="prf-fields">
              <div class="prf-f prf-f-wide"><label for="prf-use">Use of the land</label><select id="prf-use"></select></div>
              <div class="prf-f"><label for="prf-acres">Acres to insure</label><input id="prf-acres" type="number" inputmode="numeric" min="1" step="1" value="100"></div>
              <div class="prf-f"><label for="prf-share">Your share, %</label><input id="prf-share" type="number" inputmode="numeric" min="1" max="100" step="1" value="100"></div>
              <div class="prf-f prf-f-wide"><span class="prf-lab" id="prf-cov-l">Coverage level</span>
                <div class="prf-cov" id="prf-cov" role="group" aria-labelledby="prf-cov-l">{COV}</div>
                <p class="prf-hint">It pays when the index for a month pair lands below this number.</p></div>
              <div class="prf-f prf-f-wide"><label for="prf-pf-n">Productivity factor, 60 to 150</label>
                <div class="prf-pf"><input id="prf-pf" type="range" min="60" max="150" step="1" value="100" aria-label="Productivity factor"><input id="prf-pf-n" type="number" inputmode="numeric" min="60" max="150" step="1" value="100"></div>
                <p class="prf-hint">Scales the county&rsquo;s dollar value per acre. 100 is the county value. Protection and premium move together.</p></div>
            </div>
          </section>

          <section class="prf-block prf-o4" aria-labelledby="prf-iv-h">
            <h3 id="prf-iv-h">Months to insure</h3>
            <table class="prf-iv">
              <thead><tr><th scope="col">Two-month interval</th><th scope="col">Share of value</th></tr></thead>
              <tbody id="prf-iv-body"></tbody>
            </table>
            <div class="prf-iv-foot">
              <span class="prf-iv-total" id="prf-iv-total" role="status" aria-live="polite"></span>
              <button type="button" class="prf-link" id="prf-even">Split evenly</button>
              <button type="button" class="prf-link" id="prf-clear">Clear</button>
            </div>
            <p class="prf-hint">At least two intervals. No month twice. Where the county offers them, the page starts on April to May and June to July as an example, not a recommendation.</p>
            <button type="button" class="prf-btn prf-addb" id="prf-addb">Compare with a second setup</button>
          </section>
        </div>

        <div class="prf-pane">
          <section class="prf-block prf-o2" aria-labelledby="prf-answer-h">
            <h3 id="prf-answer-h">What the record says</h3>
            <p class="prf-printonly" id="prf-printsum"></p>
            <div class="prf-answer" id="prf-answer" role="status" aria-live="polite"></div>
            <div class="prf-acts" id="prf-acts" hidden>
              <button type="button" class="prf-btn" id="prf-share-b">Copy a link to this</button>
              <button type="button" class="prf-btn" id="prf-print">Print</button>
              <button type="button" class="prf-btn" id="prf-csv">Download every year (CSV)</button>
            </div>
          </section>

          <section class="prf-block prf-o5">
            <figure class="prf-fig" id="prf-chart-fig" hidden>
              <figcaption>What it would have paid, year by year</figcaption>
              <div class="prf-chart" id="prf-chart"></div>
              <p class="prf-read" id="prf-read" aria-live="off"></p>
              <div class="prf-legend" id="prf-legend"></div>
            </figure>
            <div id="prf-cmp-wrap" hidden><h3 style="margin-top:1.1rem">Setup A against setup B</h3><div id="prf-cmp"></div></div>
          </section>

          <div class="prf-o6">
          <details class="prf-d" id="prf-years-d"><summary>Every year, in numbers</summary><div id="prf-years"></div></details>
          <details class="prf-d" id="prf-rec-d"><summary>Each two-month interval on its own</summary><div><div id="prf-rec"></div>
            <p class="prf-fine">The months that paid back the most per dollar are often not the months your grass grows. A study of two Nebraska sites found PRF lowered income risk when the growing-season months were insured, and that some months raised it (<a href="https://doi.org/10.1108/AFR-10-2017-0097" rel="noopener">Westerhold and others, 2018</a>).</p></div></details>
          <details class="prf-d" id="prf-nb-d"><summary>The grids next door, same policy</summary><div id="prf-nb"></div></details>
          </div>
        </div>
      </div>
    </div>

    <div class="prf-prose">
    <h2 id="dates">PRF sign-up and billing dates for {mk("crop_year")}</h2>
    <p>PRF has one deadline a year. For the {mk("crop_year")} crop year it is {mk("sales_long")}. Miss {mk("sales_short")} and the next chance is a year later.</p>
    <ul class="prf-dates">
      <li><span class="d">{mk("sales_long")}</span><span>Sign-up closes. New policies, and changes to coverage level, months or acres on an existing one, are due at your agent.</span></li>
      <li><span class="d">{mk("acreage_long")}</span><span>Acreage report due. Without one there is no coverage for the year.</span></li>
      <li><span class="d">Jan 1 to Dec 31</span><span>The coverage year. Each two-month interval you insure stands on its own.</span></li>
      <li><span class="d">{mk("billing_long")}</span><span>Premium billing date. The policy says you are billed no earlier than this, and that premium you owe is taken out of any payment due you.</span></li>
    </ul>
    <p>A payment, when one is owed, is issued &ldquo;not later than 60 days following the date RMA publishes the final grid index&rdquo; for that interval (Rainfall Index Basic Provisions, section 8(d)). For 2026, RMA published the March to April index on July 7. The dates above are read from USDA&rsquo;s {mk("crop_year")} actuarial files.</p>

    <h2 id="cost">What PRF costs, and USDA&rsquo;s share</h2>
    <p>USDA pays part of every PRF premium: {mk("subsidy_sentence")}. You pay the rest.</p>
    <table class="prf-sub-t"><thead><tr><th scope="col">Coverage level</th><th scope="col">USDA pays</th><th scope="col">You pay</th></tr></thead><tbody>{mk("subsidy_rows")}</tbody></table>
    <p>The premium rate is different for every grid, every interval and every coverage level. The calculator above uses the rate for yours. It leaves out the policy&rsquo;s administrative fee, which is charged per crop and county.</p>

    <h2 id="new" data-prf-written-for="2027">New for 2027</h2>
    <ul>
      <li><b>A new rain record.</b> The index now comes from NOAA&rsquo;s National Centers for Environmental Information, in place of the Climate Prediction Center data used through 2026 (<a href="https://www.rma.usda.gov/news-events/news/2026/washington-dc/usda-risk-management-agency-upgrades-rainfall-data-source" rel="noopener">USDA RMA, April 30, 2026</a>). The record starts in {mk("y0")}, not 1948, and each interval is measured against its {mk("y0")} to {mk("y1")} average (<a href="https://www.rma.usda.gov/sites/default/files/2026-06/Rainfall%20Indexa%20Data%202027%20and%20Beyond%20Rainfall%20Index%20Processing.pdf" rel="noopener">RMA&rsquo;s processing note</a>). The grids did not move. Every past year on this page is the figure from that new record.</li>
      <li><b>January to February is capped at 25%.</b> In USDA&rsquo;s 2027 files, 3,067 of the 3,070 counties with PRF limit that interval to 25% of a policy&rsquo;s value. The other intervals allow 50%, 60% or 70%, by county. The calculator applies your county&rsquo;s limits.</li>
      <li><b>Grazing land needs livestock on it.</b> The 2027 Crop Provisions, section 4(j): &ldquo;For the intended use of grazing, you must have an insurable interest in enough livestock grazing the acres that would equate to at least 25% of the stocking rate for the insured acres.&rdquo; RMA&rsquo;s question-and-answer sheet on the rule says: &ldquo;Failure means no indemnity is due and full premium is owed.&rdquo; Records are asked for on request, not filed. Hay ground is not under this rule. This page does not work out head counts; your agent does, from the FSA National Crop Table or your state or federal lease (<a href="https://www.rma.usda.gov/sites/default/files/2026-10/Pasture%20Rangeland%20Forage%20Stocking%20Rate%20FAQs.pdf" rel="noopener">RMA stocking rate questions</a>).</li>
    </ul>

    <h2 id="prf-not">What PRF does not do</h2>
    <blockquote>&ldquo;This policy does not directly measure, capture, or utilize any actual crop production, including any of your actual crop production. For example, it is possible for you to receive an indemnity payment without suffering a loss of actual crop production. However, you may experience a loss of crop production and not receive an indemnity payment.&rdquo;<cite>USDA RMA, Rainfall Index Basic Provisions (27.1-RI), section 13</cite></blockquote>
    <ul>
      <li>It pays on one thing: rain in your grid over two months, against that grid&rsquo;s long-run average. Not on hay yield, cattle weights, heat, hail or a drought declaration.</li>
      <li>The grid is a quarter of a degree on each side. The rain figure is worked out for the whole grid from weather stations. Your own gauge does not count, and a neighbor a mile away can be in a different grid.</li>
      <li>Rain and grass do not move together as closely as the policy assumes. On three university ranches in Kansas and Nebraska, swapping the grid figure for rain measured at the site would have cut the mismatch by only 5% to 9% (<a href="https://doi.org/10.22004/ag.econ.281319" rel="noopener">Yu and others, 2019</a>). On California rangeland, the chance of a forage loss in an insured interval with no payment was put at 31% to 46% (<a href="https://doi.org/10.1111/ajae.12282" rel="noopener">Keller and Saitone, 2022</a>).</li>
      <li>Six states have a native sod rule this page does not apply: in Iowa, Minnesota, Montana, Nebraska, North Dakota and South Dakota, recently broken native sod gets less protection and less subsidy (Crop Provisions, section 4(g)).</li>
    </ul>

    <h2 id="method">How this page figures it</h2>
    <p>Nothing here is modelled or estimated. The inputs are USDA&rsquo;s own, copied unchanged: premium rates, county base values, interval limits, subsidy rates and dates from the {mk("crop_year")} Actuarial Data Master, and each grid&rsquo;s index history from the service behind RMA&rsquo;s PRF tool. The arithmetic is the policy&rsquo;s.</p>
    <pre class="prf-math">protection per acre  = county base value x coverage level x productivity factor
interval protection  = protection per acre x acres x your share x share of value in the interval
interval premium     = interval protection x premium rate
you pay              = interval premium - USDA's share
payment              = interval protection x (coverage level x 100 - index) / (coverage level x 100)
                       when the index is below the coverage level, else nothing</pre>
    <p>Dollars are rounded the way RMA&rsquo;s tool rounds them: protection per acre to the cent, everything else to the dollar. {mk("check")}</p>
    <p>What the history is: this year&rsquo;s rates, this year&rsquo;s county values and this year&rsquo;s rain record, run over each past year. RMA&rsquo;s tool does the same, one year at a time. It is not a record of what PRF paid. Rates, values and the data source were different then, and the averages each year is measured against move every crop year.</p>
    <p>What it leaves out: Hawaii, which has its own program and grids. The administrative fee. The native sod rule. Any year USDA has not finished publishing is listed and kept out of every total.</p>
    <p>I own a licensed crop insurance agency. This page sells nothing, takes no contact details and sends no one to it. Any crop insurance agent can write PRF: <a href="https://www.rma.usda.gov/tools-reports/agent-locator" rel="noopener">USDA&rsquo;s agent locator</a>. For the official grid for your land, use <a href="https://public-rma.fpac.usda.gov/apps/PRF" rel="noopener">USDA&rsquo;s grid locator</a>. Your policy and your agent&rsquo;s quote are what count.</p>

    <h2 id="faq">Questions ranchers and hay growers ask</h2>
    <div class="prf-faq">
    <!--prf:faq-->
    <details><summary>What is PRF insurance?</summary><p>Pasture, Rangeland, Forage is a federal crop insurance policy for grazing land and hay ground. It pays when rain in your grid, over a two-month interval you chose, comes in below a share of that grid&rsquo;s long-run average. You pick the coverage level, from 70% to 90%, and how to spread the policy across the intervals. USDA pays part of the premium.</p></details>
    <details><summary>When is the PRF deadline for {mk("crop_year")}?</summary><p>Sign-up closes {mk("sales_long")}. The acreage report is due {mk("acreage_long")}. The premium is billed {mk("billing_long")}.</p></details>
    <details><summary>How much does PRF cost per acre?</summary><p>It depends on the grid, the months, the coverage level and the county&rsquo;s value for grazing or hay, so there is no one number. USDA pays {mk("subsidy_sentence")}. Enter your grid and acres above to see your share of the premium in dollars and per acre, billed {mk("billing_short")} of the crop year.</p></details>
    <details><summary>Which months should I insure?</summary><p>The policy needs at least two intervals, no month used twice, each between your county&rsquo;s minimum and maximum. Past that it is your call, and no record can make it for you. The calculator shows how each interval did over {mk("nyears")} years at your grid. Months that paid back the most are often winter months when little grows. RMA&rsquo;s handbook puts it this way: choosing intervals &ldquo;when precipitation is not needed for the insured crop or when precipitation does not normally occur is not an effective use&rdquo; of the policy.</p></details>
    <details><summary>Is PRF drought insurance?</summary><p>No. It pays on a rain index for a grid, two months at a time. A dry summer after a wet spring, a drought declaration, heat or a short hay crop do not trigger it. Only the index does, and only for the months you insured.</p></details>
    <details><summary>How big is a PRF grid, and which one am I in?</summary><p>A grid is a quarter of a degree of latitude by a quarter of a degree of longitude: about 17 miles north to south, and 11 to 16 miles east to west, narrower the farther north you are. There are {mk("grids")} of them with PRF offers in {mk("states")} states. Type a ZIP or coordinates above to see yours. Your agent sets the official grid from a point on your land.</p></details>
    <details><summary>Why are these numbers different from what PRF paid in past years?</summary><p>Because they are not a payment history. Every year is run at {mk("crop_year")} rates and county values, on the rain record USDA publishes for {mk("crop_year")}, which starts in {mk("y0")}. Policies through 2026 were paid on a different data source, with the rates of their own year. RMA&rsquo;s own tool works the same way.</p></details>
    <details><summary>Do I need livestock to insure grazing land?</summary><p>Yes. Starting with the 2027 crop year, land insured for grazing needs livestock you have an interest in, grazing those acres, equal to at least 25% of the stocking rate. Fall short and no payment is due while the full premium is still owed. Hay ground is not under the rule. Your agent works out the number with you.</p></details>
    <details><summary>Why did my neighbor get a PRF payment when I did not?</summary><p>Three usual reasons: they are in a different grid, they insured different months, or they chose a higher coverage level. Each interval pays on its own, so one dry pair of months can pay a neighbor who insured it and miss you if you did not.</p></details>
    <details><summary>When would I be paid?</summary><p>Not later than 60 days after RMA publishes the final index for the interval. For 2026, RMA published the March to April index on July 7. Premium you owe is taken out of a payment first.</p></details>
    <!--/prf:faq-->
    </div>

    <nav class="prf-links" aria-label="Related tools">
      <a href="/farmland-atlas">Farmland Atlas</a>
      <a href="/drought-monitor">Drought Monitor</a>
      <a href="/cash-rent">Cash rent by county</a>
      <a href="/cattle-futures-prices">Cattle futures</a>
      <a href="/arc-plc">ARC or PLC</a>
    </nav>
    </div>
  </div>
  </main>
  <div id="site-footer"></div>
  <script src="/components/loader.js?v=18" defer></script>
  <script src="/components/prf-math.js?v=1" defer></script>
  <script src="/components/prf.js?v=1" defer></script>
</body>
</html>
"""
(REPO / "prf.html").write_text(HTML, encoding="utf-8")
print("prf.html written", len(HTML))
