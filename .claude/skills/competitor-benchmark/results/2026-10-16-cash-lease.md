# Head to head: agsist.com/cash-lease

Checked Oct 16, 2026. I served the read-only checkout locally and rendered cash-lease.html at 390x844 and 1280x800, full page and first screen. I filled acres and rent three ways, picked TN, IL, PA, TX and CO, and printed to Letter PDF. There was no sideways scroll at either width and no page JS errors. The only console error was the blocked analytics host. The page loaded about 410 KB.

Competitors were scored only from the copies GitHub Actions saved on the references branch (fetched Oct 16, 2026, 16:19 UTC).

## What changed since Oct 15
- **Tennessee fixed.** It now reads "by JUNE 30 for a lease that ends December 31 ... Smith v. Holt, 1945 ... not a statute". That was the Oct 15 medium bug.
- **Kentucky and Pennsylvania reworded.** Both now say "No farm statute found ... put the deadline in the lease".
- **Iowa note.** It now carries the 562.6 exceptions: animal feeding operations under 40 acres, and a tenant in default.
- **Byline added under the H1.** "By Sigurd Lindquist, Certified Crop Adviser (CCA) · state notice rules rechecked Oct 15, 2026."
- **Page count fixed.** The "one-page" claim is now "two-page", and the Letter PDF prints on 2 pages.

## Numbers checked by hand
- **Rent totals:**
  - 160 ac x $250 = $40,000. The page shows 40,000, split 20,000 / 20,000. Right.
  - 80.5 ac x $312.50 = $25,156.25. The page shows 25,156, split 12,578 / 12,578. Right to the dollar.
  - 33 ac x $255.50 = $8,431.50. The page shows 8,432, split 4,216 / 4,216. It rounds 50 cents up, which is fine for a lease (low; no fix needed).
- **Illinois rule.** "4 months before the end of the lease year (for a Feb-end lease year, late October)" agrees with the worked example in the saved Peoples Company copy: "if the lease expires February 28th, 2023, termination notice must be delivered on or before October 28th, 2022".
- **Tennessee rule.** The six-month rule agrees with the saved NALC copy: "proper notification for a year-to-year lease under the common law is six months before the lease is set to expire".
- **Indiana (3 months, end of November for a Feb-end term) and Nebraska (6 months, in practice Sept 1 for a March 1 year):** the date arithmetic is consistent.

## Scores (1-5)

| Page | First screen | Current | Accurate/sourced | Local | Clear | Depth | Phone | Trust | Speed | Unique | Total | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST /cash-lease** | 3 | 4 | 4 | 4 | 5 | 3 | 4 | 4 | 4 | 4 | **39** | Rendered Oct 16 at 390/1280; form and print tested |
| NALC "Agricultural Leases: An Overview" | 2 | 2 | 4 | 1 | 3 | 4 | 3 | 5 | 3 | 3 | 30 | fetched Oct 16 |
| Peoples Company, termination deadlines by state (land broker) | 2 | 2 | 2 | 3 | 3 | 2 | 2 | 2 | 2 | 2 | 22 | fetched Oct 16 (state data is a JPG map) |
| AgLease101.org (NCFMEC), home page | 2 | ? | ? | ? | 3 | ? | ? | 5 | 4 | ? | partial (14 on 4 cells) | fetched Oct 16; home page only, the document library was not fetched |
| ISU Ag Decision Maker | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | ? | not readable (HTTP 403 direct, 429 Wayback) |

Notes on the cells:
- **NALC:**
  - The copy has no date. It is a long essay with no state-by-state rules. It covers wind, solar, oil and gas, hunting and grazing leases.
  - It explains the common-law six-month notice and the statute of frauds (leases over one year in writing).
  - No sales agenda.
- **Peoples Company:**
  - Dated August 19, 2022.
  - The per-state deadlines are inside images ("2022 Lease Termination Graphic.jpg" and a "DOWNLOAD Lease Termination Map"), so they cannot be searched or read as text, and they are hard to use on a phone.
  - No sources are cited.
  - The post ends with a land-management sales pitch ("contact Peoples Company ... call 515-222-1347").
- **AgLease101:** the saved home page says only "Fixed & Flexible, Crop Share, Pasture… Which arrangement fits best for you? Visit Document Library". It is maintained by the North Central Farm Management Extension Committee and hosted at the University of Minnesota. The forms themselves were not in the saved copy, so I did not score them.

## Where we win
- **Your state's notice rule appears next to a lease you fill in on a phone.** None of the readable copies does that. NALC has no state rules at all. Peoples puts them in a 2022 image with a sales pitch.
- **Every state note has an honesty tier.** Notes are labeled "set by law" or "commonly cited, confirm". Where nothing is documented, the note says so plainly ("No farm statute found ... put the deadline in the lease").
- **It is dated and signed.** The byline is visible, with a recheck date of Oct 15, 2026. NALC is undated, and Peoples is four years old.
- **Nothing leaves the browser.** There is no sign-up and no sales contact.

## Where they beat us, and how
- **Lease options (AgLease101).** The home page offers forms for "Fixed & Flexible, Crop Share, Pasture". We explain flex and crop share in cards, but we have only one form, fixed cash rent.
- **Breadth of lease law (NALC).** NALC covers more than we do: the statute of frauds (leases over a year must be written), how a tenancy for years differs from a periodic tenancy, and what wind, solar and hunting leases look like. Our FAQ answers "Is a handshake lease legally binding?" but has nothing on energy or hunting leases.
- **How to deliver notice (Peoples).** Peoples says: "Many states require termination notices to be delivered either in person or via certified mail, be in writing, and an owner/operator signature." We give the deadline but no notice form to send.

## Bugs found
- **Low: no state name for 28 of 50 states.** A state with no rule card shows its abbreviation instead of its name. Picking CO shows "CO, no widely-cited farm deadline". The dropdown lists those states the same way.
- **Low: few state notes carry a source.** Only 6 of the 22 state notes cite a statute or case: IA, NE, SD, AR, OH and TN. IL, KS, IN, MN and the rest carry no source, even where the tier says "set by law".
- **No calculation errors.**

## Five changes, ranked
1. **A notice-of-termination print view on the same page.**
   - What: reuse the state picker; fill in the date notice must be served by and how to serve it (certified mail or in hand, signed). One shared view, not a page per state.
   - Effort: S to M.
   - Why: that is the paper a farmer needs before the September 1 or late-October deadlines, and no readable competitor offers it free.
   - Honesty risk: low, if every date is labeled with its tier and "not legal advice".
2. **Cite the remaining notes, and show full names for all 50 states.**
   - What: add the statute or case to IL, KS, IN, MN, MO and WI, and use full state names everywhere.
   - Effort: S.
   - Why: "Set by law" with no law named is the weakest spot against NALC and the extension sites.
   - Honesty risk: medium. Verify each at the primary statute before printing it.
3. **An optional flex rider (section 4b), loaded on demand.**
   - What: a base rent plus a bonus formula, with one worked example at two prices.
   - Effort: M.
   - Why: AgLease101 offers flexible forms and we do not. Keep it in a data/script file that renders only when the reader opens it (page budget).
   - Honesty risk: low. It is arithmetic.
4. **A "Fill in the lease" jump link under the lede.**
   - Effort: S.
   - Why: on a phone the form starts several screens down, below five lease-type cards. The first screen promises a form but does not show it.
   - Honesty risk: none.
5. **A short "other leases" FAQ.**
   - What: answer in our own words what the statute of frauds means for a multi-year farm lease, and that wind, solar and hunting leases need their own agreement. Link NALC for depth.
   - Effort: S.
   - Why: it closes NALC's breadth gap without bulk.
   - Honesty risk: low.

## Verdict
Best on the internet today? **Close.** Among the copies I could read, it is the only free lease that is fillable, works on a phone, is dated, and puts your state's rule beside the form. The Tennessee error is fixed. Two things keep it from yes: it has no termination-notice form and no flex form, and most "set by law" notes still name no law. ISU's forms could not be read (403), so I could not compare against the strongest extension source.

**Total: 39, up 3 from 36 on Oct 15.** The gains are current (+1, recheck date), accurate (+1, TN fixed) and trust (+1, byline). Oct 15 competitor totals came from search snippets, so the competitor columns are not comparable between runs.
