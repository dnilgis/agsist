/* components/cb-house.js -- RETIRED 2026-10-11 (Sig: "tone it down").

   This used to put a house ask ("Watch your elevators", "Sponsor this spot")
   into the UNSOLD sponsor slot on /cash-bids and the cash-bid town pages. The
   rule now is that an unsold slot shows nothing: the /cash-bids ribbon stays
   hidden (components/styles.css) until components/loader.js marks it sold,
   and the footer strip stays hidden until data/supporters.json has an active
   supporter. The email sign-up on those pages is unchanged.

   The file stays, empty of behaviour, because town pages built before this
   change still load it; scripts/build_cash_bid_pages.py no longer adds it, so
   it can be deleted once every town page has been rebuilt. */
