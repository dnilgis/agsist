# Board seat brief template (fill <...>, save the filled copy in the scratchpad)

AGSIST (agsist.com, repo /home/user/agsist, static GitHub Pages, free, built by one person: Sig Lindquist, CCA, Chetek WI).
READ ONLY. Do not edit, commit or push anything in the repo.

What to look at (read enough to know what really exists, not just names):
- field-scout.html + components/field-scout*.js: click any field, get soils, crop history, layers, land sales, comp report.
- farmland-atlas.html + data/atlas/ + farmland-atlas/ pages: county land values, rents, sales, stories.
- here.html + components/place.js: one entry point, everything about a place (ZIP, town, county).
- data/layers.json (51 public layers registry), data/ids/ (permanent elevator and parcel IDs).
- data/ folder overall: cash bids/basis (1,400+ elevators), rain/snow per county back decades, drought, PRF, ARC/PLC, crop progress, conditions, COT, cattle, dairy, land sales (IL, WI, IN deeds), cash rent, custom rates.
- .claude/notes/HANDOFF.md and .claude/notes/STANDING-DECISIONS.md (Sig's rules: honest numbers only, no buyer/seller names on indexed pages, free first, 1 GB site limit, 150 KB per generated page).

Sig's question: "What would you vision as a forward-facing consumer product? What do people need to know that they didn't know they needed to know? I want to explore correlations between datasets and potential changes in the agricultural landscape. My vision is blurry; push it over the edge."

Write your answer to the file path you are given, in plain English, short sentences, no em dashes. Sections:
1. What you see (2-4 lines: the real asset here, in your view).
2. The vision: one forward-facing consumer product, described as what a person sees and does in the first 30 seconds.
3. Five things people don't know they need to know. Each: the insight, who it matters to, which datasets join to produce it (name files in data/ or a named free public source), and whether we can build it now.
4. Five correlations worth testing. Each: dataset A x dataset B, the hypothesis, how to test it honestly (unit, years, geography, what would prove it wrong).
5. Landscape shifts you'd track (3-5): what is changing in agriculture that this data could show first.
6. What to cut or stop doing.
7. The one bet you'd make in the next 30 days.
Be concrete and grounded in what is actually in the repo. Mark anything unverified as a hypothesis. Under 1,200 words.

Fill before use: <your seat and lens>, <output path>, <branches not on main that matter>, <Sig's question, verbatim>.
Evidence rules: load the honest-numbers and could-this-evidence-differ skills if you have the Skill tool. One-line
versions: state the sample beside every number; withhold rather than hedge; count every test you ran; no look-ahead;
before believing evidence ask "what else would produce exactly this?". End with "What I checked and found correct".
