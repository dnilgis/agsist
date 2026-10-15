# Head to head: agsist.com/cash-lease

Checked Oct 15, 2026, from the read-only checkout. I rendered cash-lease.html at 390x844 and 1280x800, picked Tennessee, Iowa and Wisconsin in the state box, filled the rent line, and printed the form to PDF. No sideways scroll and no JS errors (the only console error is the blocked analytics host). About 360 KB loaded.

**What I could not see:** I could not open any competitor host (DNS refusal from the sandbox). Competitor cells and every legal fact checked below come from search-result text and are marked *.

## Numbers checked by hand
- **Rent total:** 160 ac x $250 = $40,000. The page shows $40,000. 79.5 ac x $312.50 = $24,843.75. The page shows $24,844. Both right.
- **State deadlines (the numbers that matter on this page):**
  - Iowa September 1 (Iowa Code 562.6): matches every source I found.* One source adds that the rule does not cover tenancies under 40 acres.* The page does not mention that exception (low).
  - Illinois 4 months (735 ILCS 5/9-206), Nebraska Sept 1 from Moudry v. Parkos, South Dakota Sept 1 for oral leases, Kansas 30 days before March 1, Ohio Sept 1 (ORC 5301.71), Missouri 60 days, Indiana 3 months: all match the search results.*
  - Minnesota "about 3 months": matches Minn. Stat. 504B.135 as quoted (the shorter of the rent interval or three months).*
  - **Tennessee is off by a day, on the unsafe side (medium).** The page says "written notice by around JULY 1". Tennessee Farm Bureau, summarizing Smith v. Holt (1945), says notice must come at least six months before the lease ends, "i.e., June 30 for leases expiring on Dec. 31".* A landlord who reads "around July 1" and mails on July 1 is late, and the lease runs another year. Fix: "by June 30 for a Dec 31 lease (six months, from court rulings, not a statute)". Verify at the primary source first.
  - Kentucky "about 6 months, certified mail" and Pennsylvania "15 days": I found no farm-specific source for either. The Pennsylvania search results disagree with each other.* Both are already marked "commonly cited, verify", which is honest. A citation, or "no farm statute found", would be better.
- **"One-page cash lease":** in Chromium on Letter paper it prints on 2 pages. The print view shows only the lease, which is good. The "one-page" claim is low severity.

## Scores (1-5)

| Page | First screen | Current | Accurate/sourced | Local | Clear | Depth | Phone | Trust | Speed | Unique | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **AGSIST /cash-lease** | 3 | 3 | 3 | 4 | 5 | 3 | 4 | 3 | 4 | 4 | **36** |
| AgLease101.org (NCFMEC bulletins and fillable PDF leases)* | 2 | 2 | 5 | 2 | 3 | 5 | 2 | 5 | 3 | 4 | 33 |
| ISU Ag Decision Maker leasing section (Iowa forms, termination notice)* | 2 | 3 | 5 | 3 | 3 | 5 | 2 | 5 | 3 | 3 | 34 |
| National Agricultural Law Center, "Agricultural Leases: An Overview"* | 2 | 3 | 5 | 1 | 3 | 4 | 3 | 5 | 4 | 2 | 32 |
| Peoples Company, "Farmland leasing termination deadlines by state" (land broker)* | 3 | 3 | 3 | 4 | 4 | 2 | 4 | 3 | 3 | 3 | 32 |
| PlatoForms / DocHub generic fillable farm lease PDFs* | 3 | 2 | 2 | 1 | 3 | 2 | 3 | 2 | 2 | 1 | 21 |

\* from search snippets only; not opened.

AI answer engines: not checked from here. Wikipedia has no farm-lease form page I found.

## Where we win
- **It is a form you fill in on a phone, and it changes with your state.** Pick a state and you get that state's notice rule, labeled "set by law" or "commonly cited, verify". AgLease101 and ISU offer fillable PDFs; none I found shows a state's deadline next to the form.
- **Lease types explained by who carries the risk.** Five cards (cash, flex on price, flex on price x yield, crop share, custom farming) read faster than a 31-page bulletin.
- **Nothing is sent anywhere.** Entries stay in the browser, and there is no sign-up or paywall like DocHub or pdfFiller.

## Where a competitor beats us, and how
- **Flex and crop-share forms (AgLease101).** NCFMEC has fixed and flexible cash lease forms and worked flex examples.* Our flex cards explain the idea but give no flex form or formula box.
- **Legal review and citations (ISU, NALC, AgLease101).** Their forms are written or reviewed by extension lawyers.* Ours says plainly that it is not attorney-reviewed, which is honest. But 14 of 22 state notes carry no statute or case citation.
- **Iowa termination notice form (ISU).** ISU points to the Iowa State Bar Association notice form.* We have no notice-of-termination page, and that is the paper a farmer needs in August.

## Five changes, ranked by impact
1. **Fix Tennessee and cite every state note (S).** Tennessee should read "June 30 for a Dec 31 lease (six months, Smith v. Holt)". Add the statute or case to each "firm" note. Where none is found (KY, PA, MS, LA, NY), say "no farm statute found; put the deadline in the lease". Re-date the review line.
2. **Add a one-page notice of termination (S).** Same state picker, the date it must be served by, and how to serve it (certified mail, in hand). It belongs on this page as a second print view.
3. **Add a flex rider (M).** It is an optional section 4b with a base rent and a bonus formula, plus one worked example at two prices. Load it on demand so the page stays small.
4. **Visible byline and review date under the H1 (S).** Write "Sigurd Lindquist, Certified Crop Adviser (CCA). State rules reviewed <date>."
5. **Fix "one-page" (S).** Either tighten the print CSS so it fits one Letter sheet, or say "two-page".

## Verdict
Best on the internet today? **Close.** It is the plainest free farm lease you can fill in on a phone, and the only one I found that puts your state's notice rule next to the form. But extension forms beat it on legal review, citations and flex or share options. The Tennessee note is a day late on the unsafe side and must be fixed first.
