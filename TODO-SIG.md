# Sig's to-dos

The morning report email lists every open item below. To check one off, edit
this file on GitHub and change `- [ ]` to `- [x]` (or delete the line). To add
one, add a new `- [ ]` line. This file is public (it is in the site repo), so keep
names and anything private out of it.

- [ ] Test Stripe with a $19 purchase and refund it
- [ ] Stripe read-only key: Stripe -> Developers -> API keys -> Create restricted key ("agsist orders"), Checkout Sessions Read and Charges Read, everything else None; copy it (rk_live_...). Then Cloudflare -> Workers & Pages -> agsist-api -> Settings -> Variables and Secrets -> Add -> type Secret, name STRIPE_READ_KEY, paste, Deploy. That one place feeds the paid marks in the morning email, the Today page and the buyer email. No Actions secret needed.
- [ ] Take a photo of a framed print on a wall, plus a close-up of the paper
- [ ] Tap the two Rain Print example years on the live site
- [ ] Send the Rain Print gift-guide pitches by Oct 31 (the list is in your email)
- [ ] Ship one framed test print a few states away and write down the real cost (target under $45)
- [ ] Forward the first morning bid email from the new elevator
- [ ] Set up the bids Gmail and app password, then add the BIDS_IMAP_USER and BIDS_IMAP_PASSWORD secrets in dnilgis/bids
- [ ] Join Something Special from Wisconsin
- [ ] This week: find more co-ops and retailers that post fertilizer prices on their websites (WI, IA, MN, IL first) and send the links; each one is a line in scripts/coop_fert_sources.json
- [ ] Land sale data: call the Minnesota, Florida and South Dakota revenue departments for their sale files; email Wisconsin DOR (permission only). Call sheet and drafts are in the private notes.
- [ ] Rain Print before Christmas: measure the mat window, scan the QR on a test print with two phones, check the Stripe product names say 13 x 19, note when the first framed order went out vs the Dec 9 cutoff, photo of a framed print with the mat
- [x] Barchart worker and BARCHART_API_KEY deleted (Nov 4)
- [ ] Answer the five site panel calls (barge, Atlas as county home, hog page, PRF county fold Nov 15, town titles)
