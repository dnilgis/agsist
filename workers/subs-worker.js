/**
 * UNSUB_SECRET MUST BE SET on this Worker in Cloudflare (Settings -> Variables
 *   and Secrets), the same value the Actions jobs sign links with. Check it:
 *   GET /count?token=... answers "secret": true or false (never the value).
 *   Without it, confirm links answer 503; unsubscribe links still work, unchecked.
 * Deploys from GitHub: Cloudflare Workers Builds runs wrangler.subs.toml on
 *   every push to main that touches this file. No more pasting into the dashboard.
 * v5.40 (2026-10-20): GIFT CARDS GO OUT BY EMAIL (Sig: "the gift card option
 *   should provide explanation as to what the receiver is getting and how to
 *   redeem easily"; no more card links sent by hand). POST /rp-gift/issue
 *   (Bearer LIST_TOKEN, as before) also takes {order_key, to, message}: the
 *   paid record of a this-year gift (rpo:..., ref GIFT-...) gets its card,
 *   locked to the record's design (a GIFT-RPS-<id> is looked up in rps:),
 *   product from the record, order_ref the Stripe session id, ships January,
 *   status redeemed with prepaid true (the address was given at Stripe
 *   checkout, so the receiver has nothing to fill in). The record keeps
 *   gift_card {code, no, last4, key, at, session}; a second call answers the
 *   same card (already: true), so one card per paid order. Refused for an
 *   unpaid record (409), a record that is not a gift (409) or a design that
 *   can't be read (409). POST /rp-order/gift-mailed {key} marks the buyer's
 *   gift card email sent, once, like /rp-order/mailed (409 before the card).
 *   /rp-order/list adds gift_card {no, last4, at} (never the code) and
 *   gift_mailed. /rp-gift/check and /rp-gift/card add prepaid (also true for a
 *   card Sig issued as already redeemed); /rp-gift/redeem answers a prepaid
 *   card 409 "This gift is already paid for and on its way. There is nothing
 *   to fill in." Every other route answers as before. No new secret.
 * v5.39 (2026-10-20): MONTHLY BACKUP. New route GET /export (Bearer
 *   LIST_TOKEN only; 403 otherwise, and 403 whenever ?token= is in the
 *   address, so the token never sits in a URL). Read-only: every key in the
 *   SUBS namespace with its value, metadata and expiration where present, one
 *   page at a time: {ok, keys: [{name, value | value_b64, metadata?,
 *   expiration?}], count, cursor, done}. Pass ?cursor= from the last answer
 *   until done is true. A value that is not UTF-8 text (a logo PNG) comes as
 *   value_b64. ?limit= 1..900 keys a page (default 500), so one call stays
 *   under 1,000 KV operations; values are read 50 at a time and a page stops
 *   early past 8 MB of values (the cursor then resumes inside the KV page).
 *   no-store, never cached. scripts/backup/backup-agsist.ps1 reads it once a
 *   month to Sig's SSD. No new binding and no new secret; every other route
 *   answers as before.
 * v5.38 (2026-10-20): THE DIGITAL FILES GO OUT ON APPROVAL (Sig). POST
 *   /rp-order/delivered {key, how} (Bearer LIST_TOKEN only): the files email
 *   for an approved, paid digital file went out (scripts/rp_buyer_email.py,
 *   how "email"), or the files were too big to attach and Sig sends them
 *   (how "hand"). Kept as delivered {at, session, how}, never the address it
 *   went to; once per record (again: already). Refused for a print (409 "not
 *   a digital file") or a record not approved (409). /rp-order/list adds
 *   delivered. No new secret, binding or variable.
 * v5.37 (2026-10-20): THE PROOF IS THE EMAIL (Sig). POST /rp-order/approve {k, t}
 *   (public, publicGate, RATE): k is the record key, t = hmac16("rp-approve|" + k)
 *   with UNSUB_SECRET; a right pair on a paid record sets approved {at} once
 *   (again: already, same time) and starts the email job for Sig's "approved"
 *   alert. Wrong or missing t: 403. /rp-order/list adds approved, approve_t,
 *   approved_alerted and approval_overdue (proof mailed 3 business days ago,
 *   Mon to Fri, no answer; never approved for the buyer). POST
 *   /rp-order/approved-alerted {key} marks Sig's approval alert. No new secret.
 * v5.36 (2026-10-20), part 2: ORDER ALERTS. POST /rp-order/stripe is Stripe's webhook
 *   (checkout.session.completed when paid, checkout.session.async_payment_succeeded),
 *   checked with the new secret STRIPE_WEBHOOK_SECRET (Stripe-Signature, HMAC
 *   SHA-256, 5 minutes' tolerance; 400 otherwise). It marks the press paid
 *   (paid.via "webhook"), hands a print its serial, keeps a paid session with
 *   no press as its own record (no_press), once per session (rpo-ev:<id>),
 *   and starts .github/workflows/rp-buyer-email.yml when GH_DISPATCH_TOKEN is
 *   set (RP_BUYER_EMAIL_LIVE = "1" lets the buyer email reach buyers; else a
 *   dry run). POST /rp-order/alerted {key} marks Sig's alert sent, like
 *   /rp-order/mailed. The poll in /rp-order/list stays as the backup.
 *   New optional secrets STRIPE_WEBHOOK_SECRET, GH_DISPATCH_TOKEN; variable
 *   RP_BUYER_EMAIL_LIVE. Every other route answers as before.
 * v5.36 (2026-10-20): RAIN PRINT ORDER RECORDS. A $19 Stripe payment showed
 *   no design (Stripe keeps client_reference_id on the Checkout Session, not
 *   on the payment page). New routes only; every other route answers as before.
 *   POST /rp-order (public, publicGate, RATE["/rp-order"]): one record per press
 *     of Pay on /rain-print, sent before the page opens Stripe: {ref (the same
 *     client_reference_id Stripe gets: a design code, GIFT-<code>, RPS-<id> or
 *     GIFT-RPS-<id>), product, price shown, design_url, place, year, style,
 *     name, markers, dedication, gift}. rpo:<ts>:<rand>, kept 120 days. Never an
 *     email, a buyer name or an address: unknown fields are dropped.
 *   GET /rp-order/list?days=N (Bearer LIST_TOKEN only; default 14, at most 120):
 *     the records, newest first. With the optional secret STRIPE_READ_KEY (a
 *     restricted key, read on Checkout Sessions), each record a completed,
 *     paid Checkout Session's client_reference_id matches is marked paid
 *     (amount, time, session id; never the customer); the rest say "pay
 *     pressed". A paid print or framed print gets the next serial (rpo-serial
 *     counter, never 0; 0 is Sig's test print; with no counter stored the first is
 *     No. 0002, as No. 0001 is his wife's print) and keeps it. fulfill_url is
 *     the design link with maker=1 (and serial=N for a print).
 *   POST /rp-order/mailed {key} (Bearer LIST_TOKEN only): the buyer's email
 *     for this paid record went out (scripts/rp_buyer_email.py); kept as
 *     mailed {at, session}, never the address. A second call changes nothing,
 *     so each paid session gets one email.
 *   GET /rp-order/buyer?key= (Bearer LIST_TOKEN only): for the buyer email,
 *     the paid record's session read from Stripe now: {livemode, email}.
 *     Nothing stored. The one place the read key lives is this worker.
 *   POST /rp-order/serial {last} (Bearer LIST_TOKEN only): the last serial
 *     already used, so the next one handed out is last + 1.
 *   New optional secret STRIPE_READ_KEY; no new binding.
 * v5.35 (2026-10-20): BUSINESS LISTS OF 100 WITH ADDRESSES. kind
 *   rain-print-business takes towns up to 20,000 characters (was 8,000), so
 *   100 ship-to-each customers with mailing addresses fit; POST /form takes a
 *   body up to 48 KB (was 16 KB). Every field cap of every other kind is
 *   unchanged. No new route, binding or secret.
 * v5.34 (2026-10-20): A BOARD SIG PASTES BY HAND. New routes only; every
 *   existing route answers exactly as before. No new binding and no new secret.
 *   NEW Cooperative's site puts a Cloudflare bot check in front of the bids
 *   reader, which does not try to get past it. Sig opens their public bid page
 *   in his own browser and pastes it into elev-admin.html; the page reads the
 *   table and sends the rows as printed.
 *   POST /elev/admin/paste  Bearer LIST_TOKEN {site, locations: [{name, rows:
 *     [{commodity, delivery, cash, basis, future, change}]}]}: every cell is
 *     checked against the shape the site prints ("10/1/2026 - 10/31/2026",
 *     "$4.26", "-35", "461-4", "-5-4"); nothing is stored unless all pass and
 *     there is at least one row. Stored as paste:<site> = {site, name, page,
 *     source, pastedAt (this Worker's clock when it was saved, the price's
 *     "as of"), locations, rows}. 256 KB at most.
 *   GET /elev/paste/<site>: that record, public (the elevator's own posted
 *     numbers, nothing private), max-age 60. dnilgis/bids reads it.
 *   GET /elev/paste-status: {site: {pastedAt, rows, locations}} for each site.
 *   Sites: PASTE_SITES (newcoop only for now).
 *   GET /sponsor-apps answers with CORS for agsist.com (elev-today.html lists
 *   the open applications by company and tier); same token, same body.
 * v5.33 (2026-10-20): GA GATE. New route GET /ga-ok answers {"ok":true} or
 *   {"ok":false}: false when Cloudflare puts the request on a cloud, hosting
 *   or data center network (request.cf.asn in CLOUD_ASNS, or a hosting word
 *   in request.cf.asOrganization). components/ga-gate.js loads Google
 *   Analytics only on true (Sig, Oct 20: readers anywhere count, data centers
 *   do not). Nothing is logged or stored, no IP is read. Private, max-age
 *   3600; CORS for agsist.com only. Every other route answers as before.
 *   No new binding and no new secret.
 * v5.32 (2026-10-20): RENT NOTICE, EVERY YEAR. POST /notice with a rent:<st>
 *   topic this address already had mailed (sent set) starts it over: {ts:
 *   now, src}, no sent. scripts/send_rent_notice.py reads it unchanged (the
 *   first release after ts). The page remembers rent:<st>:<year> and asks
 *   again the next year. Every other route and topic answers as before.
 * v5.31 (2026-10-19): the Daily sponsor tier id is "daily" (Sig: never the old
 *   name). POST /sponsor-apply takes tier page|supporter|daily; every other
 *   route answers exactly as before. No new binding and no new secret.
 * v5.30 (2026-10-18): THE HAY BOARD (agsist.com/haymow). New routes only;
 *   every existing route answers exactly as before. No new binding and no new
 *   secret. Readers post hay or forage for sale or wanted; buyers and sellers
 *   call each other. AGSIST takes no cut and ranks nothing by payment.
 *   hay:<id> = {id, kind sale|wanted, zip, place, lat, lng (ZIP centroid, 2
 *     decimals; from the bids ZIP table, then Open-Meteo, when the page sends
 *     none), product, cutting, bale, count, price, unit bale|ton, weight,
 *     rfv, rfq, cp, delivery no|yes|miles, note (300), name (60), phone,
 *     email, ts, updated, exp, status live|held|hidden, why_hidden, reports
 *     [{who (IP hmac), why, ts}], n, hn, kh}, stored with a KV expiration at
 *     exp (30 days). kh = hmac16("hay|" + key); the key is never stored.
 *   POST /hay/post    publicGate, 4 KB, honeypot, RATE 3 an hour, 10 a day
 *     per address, 300 for everyone. Tags stripped; a link, or a phone or
 *     email in the note or name, is refused. Repeated text or all caps is
 *     stored as held (not shown) until Sig clears it. -> {id, key, status, exp}
 *   POST /hay/mine, /hay/edit, /hay/renew, /hay/delete {id, key, ...}: the
 *     poster's own post. edit checks every field again; renew adds 30 days,
 *     at most 60 days ahead.
 *   GET  /hay/feed?lat&lng&mi&kind  live posts WITHOUT phone or email
 *     (has_phone, has_email instead), nearest first with mi when lat/lng are
 *     given, else newest first. public, max-age=60.
 *   POST /hay/contact {id}  the name, phone and email of one live post (RATE
 *     20 an hour, 60 a day per address), so contacts are never in the feed.
 *   POST /hay/report {id, why}  one report per address; 3 from different
 *     addresses hide the post until Sig clears it.
 *   GET  /hay/admin/list[?new=1], POST /hay/admin/hide {id},
 *     /hay/admin/clear {id}, /hay/admin/mark {ids}: Bearer LIST_TOKEN only.
 *     scripts/form_digest.py mails Sig the new and newly hidden posts (public
 *     text only) and marks them.
 * v5.29 (2026-10-17): PRF GRID INDEX NOTICE. /notice takes one more topic,
 *   prf:<grid id> (an email each time USDA RMA posts a final PRF index for a
 *   pair of months on that grid, from /prf and the PRF county pages). The id
 *   is a whole number, no leading zero, 6196 to 34941, on RMA's quarter-degree
 *   lattice over the 48 states (row 20 to 116, column 21 to 251 of 300).
 *   This topic recurs, so it keeps two more fields:
 *     after  "YYYY-II" (II = 01 Jan-Feb .. 11 Nov-Dec), the newest final
 *            interval the page showed when the reader asked; optional, kept
 *            from the first ask only;
 *     iv     the newest interval mailed (or skipped as already out),
 *            written by POST /notice-mark {email, topic, interval, quiet?}.
 *            A prf topic needs interval there; iv never moves back. quiet:true
 *            records iv without setting sent (nothing was mailed).
 *   /notice-list returns after and iv on the rows that have them.
 *   scripts/send_prf_notice.py mails it from prf.yml. Every other topic and
 *   route answers exactly as before. No new binding and no new secret.
 * v5.28 (2026-10-17): RAIN YEAR NOTICE. /notice takes one more topic,
 *   rainyear:<YYYY>:<county FIPS> (one email in January with that county's
 *   full-year rain, from the county rain pages, /rain/<state>/<county>). The
 *   year must be this year (or last year during January); the FIPS is 5
 *   digits with a real state code. /notice-mark and /notice-unsubscribe take
 *   any year. scripts/send_rain_year.py mails it from county-rain.yml.
 *   Every other topic and route answers exactly as before. No new binding
 *   and no new secret.
 * v5.27 (2026-10-17): RAIN PRINT OPTIONS IN SHORT LINKS. POST /rp-short takes a design
 *   code whose key field carries the units-and-language letter (A to H, 2026-10-16)
 *   and the 2026-10-17 options after a ~ (crop and its two days, plant drawings,
 *   a usual year, history, frost, hottest and coldest, the temperature band); both
 *   were refused before, so those designs had no short link. Every other route
 *   answers as before.
 * v5.26 (2026-10-15): RAIN PRINT GIFT CARDS. POST /rp-gift/redeem compares a
 *   locked card's design with the design the buyer sends after expanding an
 *   RPS-<id> reference (a design past 300 letters goes as its short id) from
 *   its rps:<id> record; before, every long design was refused as "not the
 *   giver's design". The order also takes the logo from that full code.
 *   order_ref (issue) takes underscores and up to 80 characters, so a Stripe
 *   id (pi_..., cs_...) fits. Every other route answers as before.
 * v5.25 (2026-10-14): /rp-short allows 200 new ids an hour and 600 a day per
 *   address (was 60 and 200); the daily total for everyone stays 600.
 * v5.24 (2026-10-14): THREE SMALL FIXES (panel 3). Every route answers as
 *   before except:
 *   - a public POST over the day's cap for EVERYONE answers 429 with
 *     error "busy today" (the per-address caps keep the old body), so a page
 *     can say "lots of people today" instead of "from here";
 *   - /notice topic rain-gauge asked again takes the new ZIP and note when
 *     given (the first ts and src stay);
 *   - POST /rp-logo refuses a PNG with text chunks (tEXt, zTXt, iTXt) or more
 *     than 64 KB of chunks other than IHDR, PLTE, IDAT and IEND (an ICC
 *     profile still fits): 400 "not a plain PNG".
 *   No new binding and no new secret.
 * v5.23 (2026-10-14): RAIN PRINT LOGOS. New routes, one new optional field on
 *   two form kinds, and a longer key field in a design code; every existing
 *   route answers exactly as before. No new binding and no new secret: the
 *   logos live in the SUBS KV (a value may be up to 25 MiB; these are 2 MB at
 *   most).
 *   POST /rp-logo  body = the PNG bytes the page made (components/rp-logo.js
 *     reads the buyer's PNG, JPG, WebP or SVG in the browser, trims it, caps
 *     the longest side at 1600 px and draws it out as a PNG; an SVG is never
 *     sent or stored, only its pixels). Origin agsist.com or www and
 *     Content-Type image/png (403 / 415 otherwise), 2 MB at most (413). The
 *     bytes must be a whole PNG: the signature, an IHDR of 1 to 1600 px each
 *     way, every chunk inside the body, an IDAT and IEND last (400
 *     otherwise). RATE["/rp-logo"]: 10 an hour, 20 a day per address, 100 for
 *     everyone a day. Answers {ok:true, id, w, h}. The id is 12 random
 *     characters of lowercase Crockford base32 (0-9 a-z without i l o u, 60
 *     bits from crypto.getRandomValues), so nobody can guess another buyer's.
 *     Stored as rpl:<id> = the bytes, metadata {w, h, ts}, for 400 days.
 *   GET  /rp-logo/<id>  the PNG (image/png, nosniff, a sandbox CSP, public,
 *     a year, immutable; CORS for agsist.com so the page can read it into a
 *     canvas), or 404. Uppercase and the look-alikes (I L -> 1, O -> 0) read
 *     as the id. The same per-isolate brake as /rp-short/<id>: 30 unknown ids
 *     an hour per address, then 429.
 *   An order keeps its logo for good: kind rain-print-order and
 *   rain-print-business take logo (the id, optional), rain-print-order also
 *   reads it from its design code (and so does a gift card redeem), and a
 *   stored order, quote or locked gift card rewrites rpl:<id> without its
 *   expiry. The forms digest prints "Logo: <link>".
 *   /rp-short and the gift card lock take a v2 design code whose key field is
 *   5 letters, or 18 with a logo: "LPCSX" + i (one ink color) or c (its own
 *   colors) + the 12-character id.
 * v5.22 (2026-10-13): PRF STATE SPONSOR INQUIRIES. One new form kind on
 *   POST /form; every existing route answers exactly as before. No new
 *   binding and no new secret.
 *   kind prf-sponsor (agsist.com/prf-sponsor) takes business (120), name
 *     (80), email, phone (optional; at least 10 digits when given, 30),
 *     states (the PRF state codes asked about, at least one, as an array or
 *     "IA, NE"; known PRF states only, each once, stored A to Z as "IA, NE"),
 *     line (the one line they tried in the preview, 120, optional), website
 *     (320, optional, http(s) only), message (1000, keeps line breaks,
 *     optional) and page. Same publicGate, 16 KB cap, rate limits, honeypot,
 *     year-long storage and digest as the other kinds; /count forms gains
 *     prf-sponsor. Nothing is published from an inquiry and no price is
 *     sent: Sig replies, and a sale is a line in data/prf-sponsors.json.
 * v5.21 (2026-10-13): AN ELEVATOR ASKS TO POST ITS OWN BIDS. One new form
 *   kind on POST /form and two new admin routes; every existing route answers
 *   exactly as before. No new binding and no new secret.
 *   kind elevator-listing (agsist.com/list-your-elevator) takes elevator
 *     (120), town (80), state, zip (5 digits), name (80), role (80), phone (at
 *     least 10 digits, 30), email, crops (corn, soybeans, wheat, sorghum,
 *     oats, other; at least one, stored as "corn, soybeans"), how (email |
 *     phone | not-sure), note (600, keeps line breaks, optional), dir_id (the
 *     bids network directory id the link came from, known:... or reg:...,
 *     200, optional) and page. Same origin check, 16 KB cap, rate limits,
 *     honeypot, year-long storage and digest as the other kinds; /count forms
 *     gains elevator-listing. Nothing is published from a request: Sig calls
 *     the elevator, then makes the listing on elev-admin.html.
 *   GET  /elev/admin/requests  Bearer LIST_TOKEN: every elevator-listing post
 *     with its key and status (pending | created | dismissed), newest first.
 *   POST /elev/admin/request   Bearer LIST_TOKEN {key, status, id?}: marks
 *     one request; id (the listing made from it) only with created. The
 *     record keeps its one-year expiry.
 * v5.20 (2026-10-13): THE ELEVATOR PORTAL. New routes only; every existing
 *   route answers exactly as before. No new binding and no new secret. An
 *   elevator keeps its own listing from a private phone link
 *   https://agsist.com/post?k=<key> (post.html, components/elev-post.js);
 *   Sig adds elevators from elev-admin.html.
 *   elev:<id> = {id, name, town, state, zip, lat, lon, active, contact
 *     {name, phone}, email (private, never in the feed), hours {text,
 *     harvest}, closed_until, note (140 at most), bids [{crop, period, start,
 *     end, futures, basis}] (12 rows at most), bids_updated_at,
 *     info_updated_at, created_at}.
 *   elevkey:<hmac16(UNSUB_SECRET, "elev|" + key)> = id, with {id} as list()
 *     metadata. The key (24 random base32 characters) is never stored.
 *   POST /elev/admin/create, /elev/admin/rekey, /elev/admin/active and
 *     GET /elev/admin/list take "Authorization: Bearer LIST_TOKEN" only.
 *     create refuses an id that exists; rekey makes a new link and the old
 *     one stops working at once.
 *   POST /elev/me {k} and POST /elev/save {k, bids?, hours?, contact?, note?,
 *     closed_today?, no_change?} go through publicGate and rateLimit. save
 *     checks every field before it stores anything; unknown fields are
 *     ignored. bids_updated_at moves when the bids change or on no_change;
 *     info_updated_at when hours, contact, note or closed change.
 *   GET /elev/feed: every listing that is on, minus email, public max-age=60.
 * v5.19 (2026-10-13): GET /where, for the Rain Print page's first print.
 *   Answers with the town Cloudflare already puts on the request (req.cf:
 *   country, region, regionCode, city, latitude, longitude), so the page can
 *   draw the reader's own area with no location prompt. Nothing is stored or
 *   logged, no KV is touched, Cache-Control: private, no-store. Only the
 *   agsist.com origins get CORS. Outside the US, or with no city, it answers
 *   {ok:false} and the page draws its usual sample. Every other route answers
 *   exactly as before. No new binding and no new secret.
 * v5.18 (2026-10-13): RAIN GAUGE WAITING LIST. /notice takes one more topic,
 *   "rain-gauge" (updates on the rain gauge Sig is designing, from
 *   /rain-gauge). With that topic only, an optional 5-digit zip and an
 *   optional one-line note (what the reader wants the gauge to do, control
 *   characters stripped, 280 characters at most) are kept on the topic:
 *   note:<email>.t["rain-gauge"] = {ts, src, zip?, note?}. /notice-list
 *   (token only) returns zip and note on rows that have them. Every other
 *   topic and route answers exactly as before; /count's notices {topic: n}
 *   counts it. scripts/send_notice.py has no template for it, so nothing
 *   is mailed. No new binding and no new secret.
 * v5.17 (2026-10-13): RAIN PRINT BUSINESS MINIMUM 5. kind rain-print-business
 *   takes quantity 5 to 500 (was 10 to 500), Sig's decision; nothing else
 *   changes. 4 and under still answer "invalid quantity".
 * v5.16 (2026-10-13): RAIN PRINT GIFT CARDS. New routes only; every existing
 *   route answers exactly as before. No new binding and no new secret: the
 *   records live in the SUBS KV, signed with UNSUB_SECRET, and Sig's routes
 *   take LIST_TOKEN. A card is only issued after the giver has paid.
 *   Code: RP-XXXX-XXXX-XXXX, 11 random Crockford base32 characters (0-9 A-Z
 *     without I L O U, from crypto.getRandomValues) and a mod-37 check
 *     character (a draw needing one of the 5 symbols past V is thrown away, so
 *     the card shows letters and digits only). Typed any case, spaces and
 *     dashes ignored, I L read as 1, O as 0. No expiry.
 *   Stored as rpg:<hmac16("rp-gift|" + CODE)> (never the code itself) =
 *     {v, kind open|locked, product, status issued|pending|redeemed|void,
 *     issued_ts, no, last4, order_ref, giver {name, email}, to, from_line,
 *     message (240), lock null|{design_code, edit none|name}, ships
 *     now|january, redeemed_ts, redeem_key, form_key, void_reason, void_ts,
 *     replaces, replaced_by}. Indexes rpg-ref:<order_ref> and
 *     rpg-by:<hmac16("rp-gift-by|" + email)> list record keys; rpg-n counts
 *     cards for "No. 0007".
 *   POST /rp-gift/issue   Sig only: "Authorization: Bearer <LIST_TOKEN>"
 *     (?token= is refused on these routes). JSON {product, order_ref, kind,
 *     giver {name, email}, to, from_line, message, lock {design_code, edit},
 *     ships, already_redeemed}. Answers {code, card_url, no, last4, key};
 *     card_url = https://agsist.com/rp-gift?c=CODE&k=hmac16("rp-gift-card|"
 *     + CODE). A locked card for this year or later ships "january" unless
 *     ships is given.
 *   POST /rp-gift/void    Sig only. {code | key, reason, force, reissue}.
 *     A used card needs force:true. reissue:true issues a new code with the
 *     same giver, words and order (lost codes) and answers its card_url.
 *   GET  /rp-gift/find?order_ref= | ?email=   Sig only. The cards on file
 *     (last4, status, dates), never a code.
 *   GET  /rp-gift/card?c=&k=   the printable card's fields, message included;
 *     404 without the right k. no-store.
 *   POST /rp-gift/check {code}   public: publicGate, 1 KB, RATE 20 an hour,
 *     60 a day, 1000 for everyone a day, and 10 unknown codes an hour per
 *     address per isolate (then 429 for every code). Answers kind, product,
 *     to, from_line, lock, ships, status, redeemed_on; never the giver's email
 *     or message.
 *   POST /rp-gift/redeem   public: publicGate, 8 KB, RATE 5 / 10 / 100, the
 *     same miss cap. {code, choice, name, email, address, notes, design_url,
 *     design_code}, checked by the rain-print-order rules. A locked card takes
 *     only its design (edit "name": the name line may differ). Single use:
 *     status pending with a fresh redeem_key, read back, then a normal
 *     form:rain-print-order post with gift_card "RP-...-X2F4 (No. 7)",
 *     gift_card_paid, gift_card_order, gift_card_from (gift_card_upgrade when
 *     the choice is above what was paid; gift_january for a January card),
 *     so the hourly digest mails Sig, then status redeemed. Each redeem also
 *     writes rpg-used:<record id>:<ts>:<key>; a second one sets
 *     gift_card_twice "yes" on the order. 409 when used
 *     ("This card was used on Dec 28, 2026."), 410 when void. KV has no
 *     compare-and-swap: two redeems at different edges inside about a minute
 *     could both pass; the digest flags the same card twice and Sig honours
 *     the first. A redeem that dies while pending frees the card after 2 min.
 * v5.15 (2026-10-13): /rp-short also takes a v2 Rain Print design code
 *   ("2|place|station|year|LPCSX|name[|day|label]...[|dedication]": the style
 *   and two switches in a fifth key letter, an optional dedication last). v1
 *   codes are checked exactly as before. Nothing else changed.
 * v5.14 (2026-10-13): RAIN PRINT SHORT LINKS. New routes only; every existing
 *   route answers exactly as before. The print's QR used to carry
 *   agsist.com/rain-print?d=<design code> (QR version 6 to 10); it can now
 *   carry HTTPS://AGSIST.COM/R?<id>, a 5-character id (26 bytes in byte mode,
 *   exactly what version 2 holds at level M: 25 x 25 modules). /R (R.html,
 *   r.html) looks the id up here and opens /rain-print?d=<code>.
 *   POST /rp-short  JSON {code}. A public POST: publicGate (Origin agsist.com
 *     or www, Content-Type application/json) and RATE["/rp-short"] (60 new
 *     ids per address an hour, 200 a day, 600 for everyone a day; a repeat of
 *     a known code is not counted and writes nothing). code is a plain Rain
 *     Print design code, checked against the v1 rules of decodeCode in
 *     components/rain-print.js (base64url, 8 to 400 characters; a GIFT- code
 *     is refused). Only a design code is stored, never a URL: /R always builds
 *     /rain-print?d=<code> itself. Body at most 1 KB. Answers {ok:true, id}.
 *     The id is the first 5 characters of Crockford base32 (0-9 A-Z without
 *     I L O U) of SHA-256(code); if that id already holds a different code it
 *     grows to 6, 7, then 8 characters (409 past 8). Stored as rps:<id> =
 *     code, no expiry. Idempotent: the same code always gets the same id.
 *   GET  /rp-short/<id>  {ok:true, code} (Cache-Control public, a week,
 *     immutable), or 404 (not cached). Only rps:<id> keys for a well-formed id
 *     are ever read. Lowercase and the Crockford look-alikes (I L -> 1, O -> 0)
 *     are read as the id. CORS for agsist.com. Per isolate, 30 unknown ids
 *     an hour per address, then 429 (walking the 33.5 million 5-letter ids).
 *   No new binding and no new secret (rps: keys live in the SUBS KV).
 * v5.13 (2026-10-13): HARDENING. Every existing route answers as before for a
 *   real AGSIST page and for the jobs. No new binding and no new secret.
 *   - Public POSTs (/subscribe, /notice, /alert-subscribe, /watch-subscribe,
 *     /elevator-watch-subscribe, /price-watch-subscribe, /sponsor-apply,
 *     /form) need Origin https://agsist.com or www and Content-Type
 *     application/json (403 / 415 otherwise), so another site cannot post
 *     through its visitors' browsers. /subscribe still takes a form body from
 *     an AGSIST page (daily.html's no-script form, cached older pages).
 *   - One rate limit for all of them (RATE): per client IP (IPv6 by /64, kept
 *     only as an HMAC) an hour and a day, and a daily total per route that
 *     guards the Gmail sending cap. One KV key per accepted post under
 *     rlq:<route>:<day>:, counted with one list(); the hourly number is also
 *     held exactly inside each isolate. 429 when over. /form keeps its v5.8
 *     counter (8 an hour) as well.
 *   - /list?format=json and /count read the daily list from KV key metadata
 *     (written with every sub: record from now on) with get() only for older
 *     records. &limit= / &cursor= give one page and X-Next-Cursor; without
 *     them the answer is byte-for-byte what it was.
 *   - /sponsor-apply counts open applications from sapp-by:<email>, not by
 *     reading every application; the logo's bytes must be PNG, JPEG or WebP.
 *     Tier and decision lookups ignore Object.prototype names.
 *   - Label, place, company and contact lose CR, LF and control characters.
 *   - Every token check is constant-time; the token may also come as
 *     "Authorization: Bearer <token>" (?token= still works).
 *   - No fallback secret: without UNSUB_SECRET a signed link or an IP hash is
 *     refused with a 503 and a logged reason, never made with a constant.
 *   - The HTML pages send CSP default-src 'none' (inline styles, form-action
 *     'self', frame-ancestors 'none'), nosniff, X-Frame-Options DENY,
 *     Referrer-Policy no-referrer and Cache-Control no-store.
 *   - /form kind sponsor-feedback: an Approval needs k = hmac16("sponsor-portal|"
 *     + r) for its portal link r (sponsor-report.html?r=<slug>-<token>&k=...),
 *     or it is refused (400) and the page falls back to its written email.
 *     Other requests are kept with verified yes/no and r. The Subject is
 *     built here. Make k for a link with:
 *       python3 -c "import hmac,hashlib,sys;print(hmac.new(sys.argv[1].encode(),('sponsor-portal|'+sys.argv[2]).lower().encode(),hashlib.sha256).hexdigest()[:16])" "$UNSUB_SECRET" apex-c1c1e09865171cd1
 * v5.12 (2026-10-12): RAIN PRINT BUSINESS QUOTES AND GIFT NOTES. One new form
 *   kind on POST /form and one new optional field on rain-print-order; every
 *   existing route answers exactly as before. kind rain-print-business (the
 *   "For businesses" form on rain-print.html) takes business (120), name (80),
 *   email, phone (30, optional), quantity (whole number 10 to 500; fewer than
 *   10 order the regular way), product (print | framed | digital | not-sure),
 *   towns (8000, keeps line breaks), ship (one | each | not-sure), note_all
 *   (300, keeps line breaks, optional: the note card for every print shipped
 *   to each customer), notes (2000, optional) and page. Same origin check,
 *   16 KB cap, rate limit (shared with every other kind), year-long storage
 *   and digest; /count forms gains rain-print-business.
 *   rain-print-order gains gift (flag): an ordinary order given as a gift,
 *   with a note card in the box. The gift_ fields are now kept when gift OR
 *   gift_january is set, under the same rules; an order with neither flag
 *   still drops them, exactly as before. No new binding and no new secret.
 * v5.11 (2026-10-11): ONE-TIME NOTICES. New routes only, plus one line in
 *   POST /unsubscribe; every other route answers exactly as before.
 *   POST /notice  JSON {email, topic, source, daily?, zip?, reports?, _gotcha}.
 *     topic = rent:<state> (one email when NASS puts out that state's next
 *     county cash rents) | arcplc:<YYYY-MM-DD> (one reminder a week before
 *     that ARC/PLC signup deadline; the date must be ahead, within 400 days).
 *     Stored under note:<email> = {ts, t:{topic:{ts, src, sent?}}}, apart from
 *     the daily list: a notice alone never puts anyone on AGSIST Daily or on
 *     /list. daily:true (the page's "Also send the morning briefing" box)
 *     also writes sub:<email> exactly as /subscribe does, zip and reports
 *     included. Answers {ok:true, topic, daily}. At most 20 topics an address.
 *   GET/POST /notice-unsubscribe?e=&t=[&topic=]  same HMAC as /unsubscribe;
 *     GET asks, POST removes every notice, or the one topic.
 *   GET  /notice-list?token=[&topic=rent:wi | rent: | arcplc:][&unsent=1]
 *     [{email, topic, ts, src, sent}] for the job that mails a notice.
 *   POST /notice-mark?token=  {email, topic}: records the notice as sent (v5.29: a prf
 *     topic also takes interval and quiet; see v5.29).
 *   GET  /count gains notice (addresses) and notices {topic: n}.
 *   POST /unsubscribe (the daily) also removes note:<email>, so its "No more
 *   emails" stays true. No new binding and no new secret.
 * v5.10 (2026-10-11): RAIN PRINT PRODUCTS AND GIFTS. kind rain-print-order's
 *   choice is now digital | print12x18 | framed12x18 (Sig prints and frames
 *   12 x 18 himself; the 18 x 24 poster, print18x24, is no longer accepted).
 *   address is required for the print and the framed print. It also takes a
 *   gift order: this year's print, ordered now and made after January 1 once
 *   NOAA's December numbers are in. New optional fields: gift_january (true,
 *   stored as "yes"; absent on an ordinary order), gift_to (who it is for, 80),
 *   gift_deliver (buyer | recipient), gift_email (the recipient's address for
 *   a digital file sent straight to them) and gift_message (the card message,
 *   240, keeps line breaks). The gift_ fields are dropped unless gift_january
 *   is set. design_code may start with GIFT-. Every other route and field
 *   answers exactly as before. No new binding and no new secret.
 * v5.9 (2026-10-11): RAIN PRINT ORDERS. One new form kind on POST /form;
 *   every route answers exactly as before. kind rain-print-order (rain-print.html)
 *   takes name, email, choice (digital | print12x18 | print18x24), address
 *   (required for either poster, dropped for the digital file), notes,
 *   design_url (must be https://agsist.com/rain-print?...), design_code
 *   (A-Z a-z 0-9 - _) and page. Same origin check, 16 KB cap, rate limit,
 *   year-long storage and digest as the other kinds; /count forms gains
 *   rain-print-order. No new binding and no new secret.
 * v5.8 (2026-10-11): SITE FORMS MOVE OFF FORMSPREE. New routes only; every
 *   existing route answers exactly as before. Three forms used to post to
 *   Formspree: the elevator claim form (elevators.html), the approval and
 *   requests box on sponsor proofs (sponsor-report.html) and the Parcel Report
 *   waitlist (farmland-atlas.html). They now post here first. A page that
 *   gets 403/404/405/5xx or no answer from this route sends to Formspree
 *   instead (components/form-post.js), so the pages work the same before this
 *   is deployed.
 *   POST /form  JSON {kind, ...fields, _gotcha}. kind = claim |
 *     sponsor-feedback | atlas-feedback; each has its own field list, lengths
 *     and required fields (FORM_KINDS). Unknown fields are dropped. Body at
 *     most 16 KB. Origin must be agsist.com. At most 8 posts per IP an hour
 *     across all three (the IP is kept only as an HMAC, for two hours).
 *     Stored under form:<kind>:<ms>:<rand> for a year. Nothing is sent from
 *     here; scripts/form_digest.py mails Sig.
 *   GET  /form-list?token=[&kind=][&new=1]  the stored posts, newest last.
 *   POST /form-mark?token=  {keys:[...]} the digest job marks posts it mailed.
 *   GET  /count gains forms:{claim, sponsor-feedback, atlas-feedback}: counts.
 *   No new binding and no new secret.
 */
/**
 * v5.7 (2026-10-09): the confirm/unsubscribe pages carry a viewport meta, so
 *   they read at full size on a phone. No route, field or token changes.
 */
/**
 * v5.6 (2026-10-07): ONE SENTENCE. The confirm page for a ZIP-wide cash alert
 *   (an ordinary kind=cash elevator alert whose ewid is "ab" + ZIP + 3-digit
 *   miles, sent by components/cb-alerts.js and mailed by
 *   scripts/send_zip_alert.py) says it re-arms, instead of "the alert clears
 *   itself". No route, field, key or validation changes: v5.3 already stores
 *   these records, so the alert works before this is deployed.
 */
/**
 * v5.5 (2026-10-07): SELF-SERVE SPONSOR SIGN-UP. New routes only; every
 *   existing route answers exactly as before. The sponsor-apply page posts an
 *   application; nothing goes public until Sig approves it.
 *   POST /sponsor-apply  JSON {tier: page|supporter|daily, slot, company,
 *     contact, email, phone, headline, body, url, logo (data:image/png|jpeg|
 *     webp;base64, <= 250 KB decoded), terms:true}. Stored pending under
 *     sapp:<id>, the logo apart under sapp-logo:<id>. At most 3 open
 *     applications per address. Nothing is sent from here.
 *   GET/POST /sponsor-confirm?i=&t=   the applicant's double opt-in; GET shows a
 *     button and changes nothing, POST confirms. 14 days, like the watches.
 *   GET/POST /sponsor-decide?i=&d=&t=  Sig's links: d = approve | decline | end.
 *     The token is HMAC(id|sd|d), so only the email Sig receives can act.
 *   GET  /sponsor-apps?token=          every application, no logo bytes, for
 *     scripts/sponsor_apply.py.
 *   GET  /sponsor-logo?token=&i=       one application's logo data URL.
 *   POST /sponsor-mark?token=          the job records a mail sent, a go-live
 *     (status live + start), an invoice reminder, or a take-down (ended).
 *   No new binding and no new secret.
 */
/**
 * v5.4 (2026-10-06): ZIP AND REPORT-DAY OPT-IN ON THE DAILY LIST. Every
 *   existing route answers exactly as before; only these change or are new.
 *   POST /subscribe (JSON or form) takes three optional fields beside email:
 *     zip      5 digits. Anything else is dropped, never rejected: the reader
 *              is still subscribed, just without a ZIP.
 *     reports  boolean (also "true"/"false", "1"/"0", "on"/"off" from a form),
 *              default true. Opts into the report-day "USDA vs the trade" email.
 *     source   as before, up to 60 chars (hero, bid-row, watch-optin,
 *              page:<slug>, bar, footer, email-forward, signup-band).
 *   A re-subscribe MERGES: the original `ts` is kept; zip, reports and src are
 *   updated only when the new request carries them. The record under
 *   sub:<email> becomes {ts, src, zip?, reports}. Records written by v5.3 and
 *   earlier ({ts, src}) read as reports:true with no zip.
 *   GET /list?token=&format=json   [{email, zip, src, ts, reports}] for
 *     scripts/send_daily.py and scripts/send_report_day.py. Without `format`
 *     the plain-text list is byte-for-byte what it was, so a sender that has
 *     not been upgraded keeps working.
 *   GET /count?token=   {ok, daily, daily_with_zip, alerts, ewatch, pwatch,
 *     watch, by_source:{src:n}} for the private dashboard (open CORS like
 *     /alert-list; token-gated). Never shown on the public site.
 *   No new binding and no new secret.
 *
 * v5.3 (2026-10-03): ALERT OPTIONS ON A WATCHED ELEVATOR. Same ewatch: keys,
 *   same routes, same cap of 5 per address. A subscribe may now carry `kind`:
 *     any    the posted corn basis changes (the v5.1 watch; also what a body
 *            with no `kind` means, so the older page keeps working unchanged)
 *     cash   a cash price reaches a target: {ewid, crop, period, plabel,
 *            direction above|below, target_cents 100..3200}
 *     basis  a basis reaches a target: same fields, target_cents -300..300
 *     move   a basis moves at least move_cents (1..100) from the last email
 *   `wid` stays the alert's own id (the key under pend/w); `ewid` is the
 *   elevator+crop hash the sender looks up (same FNV-1a as the v5.1 wid).
 *   cash and basis are one-shot: the sender marks {fired:true} and the alert
 *   is removed. move and any re-arm: the sender records the new level.
 *   GET /elevator-watch-options   {ok, kinds, crops, max}. The page asks this
 *     first and offers only "any change" when it fails, so the page works the
 *     same before and after this worker is deployed.
 *   /elevator-watch-mark keeps every option field when it records a level.
 *
 * v5.2 (2026-10-01): WATCH A PRICE TARGET (futures). Double opt-in, same
 *   shape as WATCH AN ELEVATOR and WATCH A COUNTY below -- a third parallel
 *   system, not merged into either, for the same reason: the other two
 *   already work and must not be put at risk by this one. Different
 *   lifecycle, though: a price target is a ONE-SHOT alert (like a resting
 *   limit order), not a recurring "tell me every time this changes" watch --
 *   it fires once and removes itself, it does not keep mailing every move
 *   after the target is hit.
 *   POST /price-watch-subscribe {email, pid, symbol, direction, target_cents, label}
 *     pending only; nothing is sent from here. pid is a short hex id the
 *     homepage derives client-side from symbol|direction|target_cents (same
 *     FNV-1a scheme as the elevator wid) -- the worker never has to parse or
 *     validate what the alert means, only store what the homepage already
 *     computed and labeled, exactly like the elevator watch.
 *   GET/POST /price-watch-confirm?e=&p=&t=      GET shows a button, changes nothing.
 *   GET/POST /price-watch-unsubscribe?e=&t=[&p=]  all alerts, or one.
 *   GET  /price-watch-list?token=     for scripts/send_price_watch.py.
 *   POST /price-watch-mark?token=     sender records a confirm-mail send, or
 *     removes the alert once fired ({fired:true}) -- never re-arms itself.
 *   KV key pwatch:<email> = {pend:{pid:{ts,m,symbol,direction,target_cents,label}},
 *                            w:{pid:{symbol,direction,target_cents,label}}}.
 *   At most 5 price alerts per address, same cap as the other two watches.
 *
 * v5.1 (2026-09-30): WATCH AN ELEVATOR (cash bids). Double opt-in, same shape
 *   as WATCH A COUNTY below, kept as a parallel system rather than merged into
 *   it -- the county watch already works and this must not risk it.
 *   POST /elevator-watch-subscribe {email, wid, label}   pending only.
 *   GET/POST /elevator-watch-confirm?e=&w=&t=            GET shows a button,
 *                                                         changes nothing.
 *   GET/POST /elevator-watch-unsubscribe?e=&t=[&w=]       all watches, or one.
 *   GET  /elevator-watch-list?token=     for scripts/send_elevator_watch.py.
 *   POST /elevator-watch-mark?token=     sender records what it mailed / basis.
 *   KV key ewatch:<email> = {pend:{wid:{ts,m,label}}, w:{wid:{label,k,s}|null}}.
 *   wid is a short hex id the homepage derives from
 *   state|facility|city|commodity -- there is no natural 5-digit id for an
 *   elevator the way a county has a FIPS code, so this worker never parses a
 *   facility name out of a URL; it only ever sees the hash and the label the
 *   subscribe call sent along with it. At most 5 elevators per address.
 *
 * v5.0 (2026-09-25): WATCH A COUNTY (Farmland Atlas). Double opt-in.
 *   POST /watch-subscribe {email, fips}      pending only; nothing is sent from here.
 *   GET/POST /watch-confirm?e=&f=&t=         GET shows a button and changes nothing;
 *                                            POST confirms (same scanner-safe split as unsubscribe).
 *   GET/POST /watch-unsubscribe?e=&t=[&f=]   all watches, or one county with &f=.
 *   GET  /watch-list?token=                  for the sender job (scripts/send_watch.py).
 *   POST /watch-mark?token=                  sender records what it mailed / the figures last reported.
 *   KV key watch:<email> = {pend:{fips:{ts,m}}, w:{fips:{k,s}|null}}. At most 5 counties per address.
 *   The confirmation email is sent by the Actions job, not here (Gmail SMTP), so it can lag up to 30 minutes.
 *   All v4.2 routes are unchanged.
 */
/**
 * AGSIST subscriptions worker v4.2 — daily-briefing list + HAIL ALERT watch areas.
 * v4.2 (2026-08-02): accept the 25-mile alert radius the hail-map UI offers.
 *   v4.1 validated radius_mi against {1,5,10} — a farmer who picked 25 was
 *   silently saved at 5 and under-alerted. Recut from v4.1 (the original
 *   v4.2 file was lost with the July container; this is the same one-line fix).
 * v4.1 (2026-07-20): /alert-list now sends Access-Control-Allow-Origin:* (token-gated
 *   already) so the private subscriber dashboard can read it in-browser.
 * Supersedes v3.2 entirely (all routes intact); paste over the deployed worker.
 *
 * v4.0 (2026-07-18): RFC 8058 unsubscribe split — THE scanner fix.
 *   Proven on a real built message: the List-Unsubscribe header URL and the
 *   email body link are byte-identical. v3.2 deleted on GET, which meant any
 *   corporate link-scanner / Outlook SafeLinks / prefetcher that followed the
 *   body link silently unsubscribed a reader who never clicked. Meanwhile
 *   send_daily.py sends List-Unsubscribe-Post: List-Unsubscribe=One-Click, so
 *   Gmail's one-click unsubscribe POSTs — and v3.2 had no POST route: 404.
 *   Both directions were wrong. Now:
 *     GET  /unsubscribe?e=&t=   → "are you sure" page with a button that POSTs.
 *                                 MUTATES NOTHING. Scanners can fetch it all day.
 *     POST /unsubscribe?e=&t=   → remove immediately, 200, no confirmation page
 *                                 (RFC 8058 requires acting on the POST without
 *                                 a further step). Serves both the mailbox
 *                                 provider's one-click POST and the button.
 *   Same split for /alert-unsubscribe.
 *
 * Daily briefing:
 *   POST /subscribe          GET/POST /unsubscribe?e=&t=
 *   GET  /list?token=        POST /import?token=
 *
 * Hail alerts:
 *   POST /alert-subscribe    JSON {email, lat, lon, place, radius_mi}
 *                            One watch area per email — re-subscribing
 *                            moves your pin. radius_mi ∈ {1,5,10,25}, default 5.
 *   GET/POST /flag?k=&token=  day-markers for send dedup (14-day TTL)
 *   GET  /alert-list?token=  JSON array [{email,lat,lon,place,radius_mi},…]
 *                            for the nightly checker.
 *   GET/POST /alert-unsubscribe?e=&t=   signed, same HMAC as briefing.
 *
 * Bindings/secrets (unchanged through v5.23): KV binding SUBS; secrets LIST_TOKEN, UNSUB_SECRET.
 *
 * CANONICAL SOURCE: workers/subs-worker.js in the agsist repo. Edit there,
 * commit, then paste here — never the other way around.
 */

const ALLOWED_ORIGINS = ["https://agsist.com", "https://www.agsist.com"];

function cors(req) {
  const o = req.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(o) ? o : ALLOWED_ORIGINS[0],
    "Vary": "Origin",
  };
}

function json(obj, status, extra) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign({ "Content-Type": "application/json" }, extra || {}),
  });
}

// v5.33 GA gate. Cloud, hosting and data center networks by ASN, checked
// 2026-10-20 against each network's own registration. Readers' ISPs, mobile
// carriers and Starlink (14593) are not here. Left out on purpose:
// Cloudflare 13335, Akamai 36183 and Fastly 54113, the exits of iCloud
// Private Relay and Cloudflare WARP, which real readers on iPhones use; their
// organisation names are also excepted from the word check below.
const CLOUD_ASNS = new Set([
  16509, 14618, 8987,      // Amazon AWS
  15169, 396982, 19527,    // Google, Google Cloud
  8075,                    // Microsoft (Azure)
  45102, 37963,            // Alibaba Cloud
  132203, 45090,           // Tencent Cloud
  136907,                  // Huawei Cloud
  31898,                   // Oracle Cloud
  36351,                   // IBM Cloud (SoftLayer)
  14061,                   // DigitalOcean
  63949,                   // Linode (Akamai Cloud)
  20473,                   // Vultr (Choopa)
  24940,                   // Hetzner
  16276,                   // OVH
  51167,                   // Contabo
  12876,                   // Scaleway
  60781, 16265, 30633, 59253, // Leaseweb
  9009,                    // M247
  47583,                   // Hostinger
]);
const CLOUD_ORG_RE = /hosting|\bcloud|data ?cent(er|re)|server|\bcolo(cation)?\b|\bvps\b/i;
const RELAY_ASNS = new Set([13335, 36183, 54113]);
function gaOk(cf) {
  const asn = Number(cf && cf.asn);
  if (!Number.isInteger(asn) || asn <= 0) return false;   // no network data: not a reader we can vouch for
  if (RELAY_ASNS.has(asn)) return true;
  if (CLOUD_ASNS.has(asn)) return false;
  return !CLOUD_ORG_RE.test(String((cf && cf.asOrganization) || ""));
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// v5.13: there is no fallback key. Before, an unset UNSUB_SECRET silently
// became a public constant: "agsist-form" for the form rate limit, and the
// word "undefined" (what TextEncoder makes of a missing value) for every
// unsubscribe and confirm token, so anyone could have made a valid link.
// Now any operation that needs the secret refuses with a 503 and logs why.
class NoSecretError extends Error {}
// v5.13: an unsubscribe must always work. With UNSUB_SECRET set the token is
// checked against it, exactly as before (tokens are made by the Actions jobs
// with that same secret; there never was a fallback key for them: before
// v5.13 a missing secret made every unsubscribe crash). With it unset, the
// unsubscribe is honoured without a check, and the log says so loudly:
// removing someone from a list is low harm, a dead stop link is not.
async function unsubOk(env, msg, t) {
  if (typeof env.UNSUB_SECRET !== "string" || !env.UNSUB_SECRET) {
    console.error("agsist-subs: UNSUB_SECRET is not set; honouring an unsubscribe WITHOUT checking its token. Set the secret in Cloudflare.");
    return true;
  }
  return safeEq(t, await hmac16(msg, env.UNSUB_SECRET));
}
async function hmac16(email, secret) {
  if (typeof secret !== "string" || !secret)
    throw new NoSecretError("UNSUB_SECRET is not set on the agsist-subs Worker; refusing to sign or check a token");
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key,
    new TextEncoder().encode(email.toLowerCase()));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0"))
    .join("").slice(0, 16);
}

async function listKeys(env, prefix) {
  const out = [];
  let cursor;
  do {
    const page = await env.SUBS.list({ prefix, cursor });
    out.push(...page.keys.map(k => k.name));
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return out;
}

// ---------- v5.39: GET /export, the monthly backup ----------
const EXPORT_LIMIT_MAX = 900;       // 1 list + 900 gets stays under 1,000 KV operations a call
const EXPORT_LIMIT_DEFAULT = 500;
const EXPORT_BATCH = 50;            // values read in parallel, this many at a time
const EXPORT_PAGE_BYTES = 8 * 1024 * 1024;   // stop a page early past this many bytes of values

function b64Bytes(u8) {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
// UTF-8 byte order, the order KV lists keys in.
function utf8Cmp(a, b) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
}
// The cursor: the KV cursor that starts the current KV page, plus the last key already sent from it.
function exportCursorOut(c, after) {
  return b64Bytes(new TextEncoder().encode(JSON.stringify({ c: c || "", a: after || "" }))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function exportCursorIn(s) {
  if (!s) return { c: "", a: "" };
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    const o = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bin, ch => ch.charCodeAt(0))));
    if (o && typeof o.c === "string" && typeof o.a === "string") return o;
  } catch (e) { /* bad cursor */ }
  return null;
}
async function exportPage(env, cur, limit) {
  const page = await env.SUBS.list({ limit, cursor: cur.c || undefined });
  let keys = page.keys || [];
  if (cur.a) {
    const at = keys.findIndex(k => k.name === cur.a);
    keys = at >= 0 ? keys.slice(at + 1) : keys.filter(k => utf8Cmp(k.name, cur.a) > 0);
  }
  const out = [];
  let bytes = 0, gone = 0, last = "", full = false;
  for (let i = 0; i < keys.length && !full; i += EXPORT_BATCH) {
    const batch = keys.slice(i, i + EXPORT_BATCH);
    const got = await Promise.all(batch.map(k => env.SUBS.getWithMetadata(k.name, { type: "arrayBuffer" })));
    for (let j = 0; j < batch.length; j++) {
      const k = batch[j], g = got[j];
      last = k.name;
      if (!g || g.value === null || g.value === undefined) { gone++; continue; }   // expired between list and get
      const u8 = new Uint8Array(g.value);
      const row = { name: k.name };
      let text = null;
      try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(u8); } catch (e) { text = null; }
      if (text === null) row.value_b64 = b64Bytes(u8); else row.value = text;
      const meta = g.metadata !== undefined && g.metadata !== null ? g.metadata : k.metadata;
      if (meta !== undefined && meta !== null) row.metadata = meta;
      if (k.expiration) row.expiration = k.expiration;
      out.push(row);
      bytes += u8.length;
      if (bytes >= EXPORT_PAGE_BYTES && (j < batch.length - 1 || i + EXPORT_BATCH < keys.length)) { full = true; break; }
    }
  }
  let cursor = null;
  if (full) cursor = exportCursorOut(cur.c, last);
  else if (!page.list_complete && page.cursor) cursor = exportCursorOut(page.cursor, "");
  return { keys: out, count: out.length, gone, cursor, done: cursor === null };
}

function escHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// v5.13: every token and signature check. The time it takes does not depend
// on where the first wrong character is (a length mismatch still answers no).
function safeEq(a, b) {
  a = String(a == null ? "" : a); b = String(b == null ? "" : b);
  const n = Math.max(a.length, b.length);
  let d = a.length ^ b.length;
  for (let i = 0; i < n; i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0 && a.length > 0;
}

// v5.13: one line of visitor text (a label, a place, a company or contact
// name). CR, LF, tabs and every other control character become a space, so
// nothing a stranger types can start a new line in a mail header or body.
function oneLine(v, max) {
  return String(v == null ? "" : v)
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ")
    .replace(/ {2,}/g, " ").trim().slice(0, max);
}

// v5.13: the gate in front of every public POST. A browser always sends
// Origin on a cross-site POST, and a JSON Content-Type forces a CORS
// preflight, so another website cannot post here through its visitors'
// browsers. A script can fake both; the rate limit below is for that.
// /subscribe also takes an ordinary form body (the no-script form on
// daily.html, and copies of older pages still in a reader's cache), but only
// from an AGSIST page: the Origin check alone stops the cross-site post.
const PUBLIC_POSTS = new Set(["/subscribe", "/notice", "/alert-subscribe", "/watch-subscribe",
  "/elevator-watch-subscribe", "/price-watch-subscribe", "/sponsor-apply", "/form",
  "/rp-short",   // v5.14
  "/rp-gift/check", "/rp-gift/redeem"]);   // v5.16
PUBLIC_POSTS.add("/elev/me").add("/elev/save");   // v5.20: the elevator portal
PUBLIC_POSTS.add("/rp-order");   // v5.36: Rain Print order records
PUBLIC_POSTS.add("/rp-order/approve");   // v5.37: the buyer approves the proof
function publicGate(req, path) {
  const origin = req.headers.get("Origin") || "";
  if (!ALLOWED_ORIGINS.includes(origin)) return json({ ok: false, error: "forbidden" }, 403, cors(req));
  const ct = (req.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  if (ct === "application/json") return null;
  if (path === "/subscribe" && (ct === "application/x-www-form-urlencoded" || ct === "multipart/form-data")) return null;
  return json({ ok: false, error: "unsupported content type" }, 415, cors(req));
}

// v5.13: ONE RATE LIMIT FOR EVERY PUBLIC POST. [per address an hour, per
// address a day, everyone together a day]. "Address" is the client IP (an
// IPv6 address counts by its /64), kept only as an HMAC. The daily total
// keeps junk sign-ups from eating AGSIST's Gmail sending cap: every watch
// subscribe is a confirmation mail, every daily sign-up is a mail a day.
const RATE = {
  "/subscribe": [10, 30, 150], "/notice": [10, 30, 150], "/alert-subscribe": [10, 30, 100],
  "/watch-subscribe": [10, 30, 50], "/elevator-watch-subscribe": [10, 30, 50],
  "/price-watch-subscribe": [10, 30, 50], "/sponsor-apply": [5, 10, 25], "/form": [8, 24, 500],
  // v5.14: new Rain Print short links only (a repeat of a known code is free).
  // No mail; the daily total bounds KV writes (two per new id).
  // v5.25: 200 an hour and 600 a day per address. Each redraw while someone
  // designs makes a new id, so one busy designer (Sig testing his own print)
  // hit 60 in an hour and lost the QR and the print files. The day's total
  // for everyone is unchanged and still bounds KV writes.
  "/rp-short": [200, 600, 600],
  // v5.16: gift cards. Every check counts (hit or miss): 20 an hour, 60 a day
  // per address, so walking 2^55 codes is hopeless; redeem is rarer still.
  "/rp-gift/check": [20, 60, 1000], "/rp-gift/redeem": [5, 10, 100],
  // v5.23: Rain Print logos. A buyer uploads one or two; the daily total bounds
  // what strangers can store (100 a day at 2 MB at most).
  "/rp-logo": [10, 20, 100],
  // v5.20: the elevator portal. A manager opens the page and saves a few
  // times a day; a 24-character key cannot be walked at 60 tries an hour.
  "/elev/me": [60, 300, 1000], "/elev/save": [60, 300, 1000],
  // v5.36: one record per press of Pay. A buyer presses once or twice; the
  // daily total bounds KV writes.
  "/rp-order": [30, 100, 2000],
  // v5.36: approving a proof: a buyer taps once or twice; a wrong token counts too.
  "/rp-order/approve": [20, 60, 1000],
};
// Within one Worker isolate the hourly count is exact (JavaScript runs one
// request at a time), so a burst that lands before KV has caught up is still
// held to the hourly number on that isolate.
const RATE_MEM = new Map();
function ipBucket(ip) {
  ip = String(ip || "").trim().toLowerCase();
  if (!ip.includes(":")) return ip;
  let [head, tail] = ip.split("::");
  const h = head ? head.split(":") : [], t = tail !== undefined && tail ? tail.split(":") : [];
  const groups = tail === undefined ? h : h.concat(Array(Math.max(0, 8 - h.length - t.length)).fill("0"), t);
  return groups.slice(0, 4).map(g => g.replace(/^0+(?=.)/, "")).join(":") + "::/64";
}
async function rateLimit(req, env, path) {
  const lim = RATE[path];
  if (!lim) return null;
  const now = new Date();
  const day = now.toISOString().slice(0, 10).replace(/-/g, ""), hh = String(now.getUTCHours()).padStart(2, "0");
  const ip = req.headers.get("CF-Connecting-IP") || "";
  const who = ip ? await hmac16("rate-ip|" + ipBucket(ip), env.UNSUB_SECRET) : "";
  const deny = () => json({ ok: false, error: "too many requests; try again later" }, 429, cors(req));
  if (who) {
    const mk = path + "|" + who + "|" + day + hh;
    const n = RATE_MEM.get(mk) || 0;
    if (n >= lim[0]) return deny();
    if (RATE_MEM.size > 5000) RATE_MEM.clear();
    RATE_MEM.set(mk, n + 1);
  }
  // One key per accepted request (never a counter read and rewritten, which
  // loses counts when requests race), all of today's under one prefix: a
  // single list() gives the total for the day, this address's day and hour.
  const prefix = "rlq:" + path.slice(1) + ":" + day + ":";
  try {
    const page = await env.SUBS.list({ prefix, limit: 1000 });
    const names = page.keys.map(k => k.name);
    // v5.24: the cap for everyone says so; it is not about this address
    if (names.length >= lim[2] || !page.list_complete) return json({ ok: false, error: "busy today" }, 429, cors(req));
    if (who) {
      const mine = names.filter(k => k.startsWith(prefix + who + ":"));
      if (mine.length >= lim[1]) return deny();
      if (mine.filter(k => k.startsWith(prefix + who + ":" + hh + ":")).length >= lim[0]) return deny();
    }
  } catch (e) { /* KV list failed: let the request through rather than lose a real sign-up */ }
  const rnd = [...crypto.getRandomValues(new Uint8Array(4))].map(x => x.toString(16).padStart(2, "0")).join("");
  try { await env.SUBS.put(prefix + (who || "-") + ":" + hh + ":" + rnd, "", { expirationTtl: 2 * 86400 }); } catch (e) { /* as above */ }
  return null;
}

// v5.4: the daily list's optional fields. A ZIP is exactly five digits or it
// is not kept; `reports` is a boolean or one of the words a form sends, and
// anything else means "not given" (null), so the stored value is left alone.
function subZip(v) {
  const z = String(v == null ? "" : v).trim();
  return /^\d{5}$/.test(z) ? z : "";
}
function subBool(v) {
  if (v === true || v === false) return v;
  if (v === 1 || v === 0) return v === 1;
  const t = String(v == null ? "" : v).trim().toLowerCase();
  if (["true", "1", "on", "yes"].includes(t)) return true;
  if (["false", "0", "off", "no"].includes(t)) return false;
  return null;
}
function subRecord(email, raw) {
  let r = null;
  if (raw && typeof raw === "object") r = raw;
  else try { r = raw ? JSON.parse(raw) : null; } catch (e) { r = null; }
  if (!r || typeof r !== "object") r = {};
  return {
    email,
    zip: subZip(r.zip) || null,
    src: String(r.src || ""),
    ts: Number.isFinite(r.ts) ? r.ts : null,
    reports: r.reports !== false,
  };
}

// v5.4 merge, shared by /subscribe and /notice (daily:true). A bad ZIP is
// dropped, never a reason to refuse the subscribe; the first ts is kept; zip,
// reports and src change only when the request carries them.
async function putSub(env, email, src, zipIn, repIn) {
  const zip = subZip(zipIn), reports = subBool(repIn);
  src = String(src || "").slice(0, 60);
  let prev = null;
  try { const v = await env.SUBS.get("sub:" + email); prev = v ? JSON.parse(v) : null; } catch (e) { prev = null; }
  if (!prev || typeof prev !== "object") prev = {};
  const rec = {
    ts: Number.isFinite(prev.ts) ? prev.ts : Date.now(),
    src: src || String(prev.src || ""),
  };
  const keepZip = zip || subZip(prev.zip);
  if (keepZip) rec.zip = keepZip;
  rec.reports = reports !== null ? reports : prev.reports !== false;
  await env.SUBS.put("sub:" + email, JSON.stringify(rec), { metadata: rec });
}

// v5.13: the daily list from list() alone. Every write of sub:<email> since
// v5.13 carries the record as KV key metadata, which list() returns with the
// key, so a page of up to 1,000 readers is ONE KV operation instead of one per
// reader. A record written before v5.13 has no metadata and is read with
// get(), exactly as before; it gains metadata the next time it is written.
function subMetaOk(m) {
  return !!m && typeof m === "object" && Number.isFinite(m.ts);
}
async function subPage(env, cursor, limit) {
  const page = await env.SUBS.list({ prefix: "sub:", cursor: cursor || undefined, limit: limit || 1000 });
  const out = [];
  for (const k of page.keys) {
    const email = k.name.slice(4);
    out.push(subRecord(email, subMetaOk(k.metadata) ? k.metadata : await env.SUBS.get(k.name)));
  }
  return { out, cursor: page.list_complete ? "" : (page.cursor || "") };
}
async function subAll(env) {
  const out = [];
  let cursor = "";
  do {
    const p = await subPage(env, cursor);
    out.push(...p.out);
    cursor = p.cursor;
  } while (cursor);
  return out;
}

// v5.11: notice topics. rent:<state> is one email when NASS puts out the next
// county cash rents for that state. arcplc:<YYYY-MM-DD> is one reminder a week
// before that FSA ARC/PLC signup deadline. v5.18: rain-gauge is the waiting
// list for the rain gauge (no mail goes out on it). Anything else is refused.
const NOTE_MAX = 20;
const NOTE_TEXT_MAX = 280;   // v5.18: the rain-gauge note, one line
const RENT_STATES = new Set(("al ak az ar ca co ct de fl ga hi id il in ia ks ky la me md ma mi mn ms mo mt ne nv nh nj nm ny nc nd oh ok or pa ri sc sd tn tx ut vt va wa wv wi wy").split(" "));
// v5.28: rainyear:<YYYY>:<county FIPS>, the January full-year rain email.
const RAIN_ST_FIPS = new Set([1, 2, 4, 5, 6, 8, 9, 10, 11, 12, 13, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
  27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 44, 45, 46, 47, 48, 49, 50, 51, 53, 54, 55, 56]);
// v5.29: prf:<grid>, RMA's PRF grid id. Grids are row x 300 + column + 1 on
// NOAA's quarter-degree boxes from 20N 130W; the 48 states' 13,414 grids run
// 6196 to 34941, rows 20 to 116, columns 21 to 251 (data/prf, crop year 2027).
const PRF_MIN = 6196, PRF_MAX = 34941;
function prfGridOk(s) {
  if (!/^[1-9]\d{3,4}$/.test(s)) return false;
  const g = +s, row = Math.floor((g - 1) / 300), col = (g - 1) % 300;
  return g >= PRF_MIN && g <= PRF_MAX && row >= 20 && row <= 116 && col >= 21 && col <= 251;
}
// "YYYY-II": a year and RMA's interval, 01 (Jan-Feb) to 11 (Nov-Dec)
function prfInterval(v) {
  const s = String(v == null ? "" : v).trim();
  const m = /^(\d{4})-(0[1-9]|1[01])$/.exec(s);
  if (!m || +m[1] < 1948 || +m[1] > new Date().getUTCFullYear() + 1) return null;
  return s;
}
function noticeTopic(v, anyDate) {
  const t = String(v == null ? "" : v).trim().toLowerCase();
  if (t === "rain-gauge") return t;
  const pg = /^prf:(\d+)$/.exec(t);
  if (pg) return prfGridOk(pg[1]) ? t : null;
  let ry = /^rainyear:(\d{4}):(\d{5})$/.exec(t);
  if (ry) {
    if (!RAIN_ST_FIPS.has(+ry[2].slice(0, 2)) || ry[2].slice(2) === "000") return null;
    if (anyDate) return t;
    const now = new Date(), cy = now.getUTCFullYear(), y = +ry[1];
    return y === cy || (y === cy - 1 && now.getUTCMonth() === 0) ? t : null;
  }
  let m = /^rent:([a-z]{2})$/.exec(t);
  if (m) return RENT_STATES.has(m[1]) ? t : null;
  m = /^arcplc:(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) {
    const d = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    if (new Date(d).toISOString().slice(0, 10) !== t.slice(7)) return null;
    // a deadline still ahead (a day of slack for time zones), within ~13 months
    if (!anyDate && (d < Date.now() - 864e5 || d > Date.now() + 400 * 864e5)) return null;
    return t;
  }
  return null;
}

function htmlPage(msg, extraHtml) {
  return new Response(
    "<!doctype html><meta charset=utf-8><title>AGSIST</title>" +
    "<meta name=robots content=noindex>" +
    // v5.7: without this a phone lays the page out 980px wide and shrinks it,
    // so the unsubscribe question and its button arrive at a third size.
    "<meta name=viewport content=\"width=device-width,initial-scale=1\">" +
    "<body style=\"font-family:Georgia,serif;max-width:480px;margin:80px auto;" +
    "padding:0 16px;color:#1a1a1a\"><h2>" + msg + "</h2>" + (extraHtml || "") +
    "<p><a href=\"https://agsist.com\">agsist.com</a></p>",
    { headers: Object.assign({ "Content-Type": "text/html;charset=utf-8" }, PAGE_HEADERS) });
}
// v5.13: the confirm, unsubscribe and sponsor pages carry e= and t= in their
// address. No script, no framing, no referrer, no caching. Inline style
// attributes and a POST back to this same address are all these pages need.
const PAGE_HEADERS = {
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

// A confirmation link works for 14 days, as the privacy page says. Before
// 2026-10-06 the confirm routes only checked that the request existed, so an
// old link kept working and an unconfirmed address stayed stored indefinitely.
const PEND_TTL_MS = 14 * 24 * 3600 * 1000;
function pendExpired(rec) {
  return !rec || typeof rec.ts !== "number" || Date.now() - rec.ts > PEND_TTL_MS;
}

// v5.5: self-serve sponsor applications.
const SAPP_TIERS = { page: "page", supporter: "footer", daily: "briefing" };
const SAPP_LABEL = { page: "Own a page", supporter: "Supporter", daily: "Sponsor" };
const SAPP_DECISIONS = {
  approve: { from: ["confirmed"], to: "approved", ask: "Approve and put live", button: "Approve", done: "Approved" },
  decline: { from: ["confirmed", "approved"], to: "declined", ask: "Decline", button: "Decline", done: "Declined" },
  end:     { from: ["live", "approved"], to: "ending", ask: "End this sponsorship and free the slot", button: "End it", done: "Ending" },
};
function sappExpired(r) { return r.status === "pending" && pendExpired(r); }
// v5.13: what the first bytes of a base64 logo really are: "png", "jpeg",
// "webp", or "" for anything else.
function logoKind(b64) {
  let h = "";
  try { h = atob(String(b64).slice(0, 24)); } catch (e) { return ""; }
  if (h.startsWith("\x89PNG\r\n\x1a\n")) return "png";
  if (h.startsWith("\xff\xd8\xff")) return "jpeg";
  if (h.length >= 12 && h.slice(0, 4) === "RIFF" && h.slice(8, 12) === "WEBP") return "webp";
  return "";
}
// v5.13: a lookup that never answers for Object.prototype's own names
// (tier "constructor" or "toString" used to pass as a placement).
function own(obj, k) { return Object.prototype.hasOwnProperty.call(obj, k) ? obj[k] : undefined; }

// v5.8: the site's own forms (were Formspree). [max length, required, type]
const FORM_KINDS = {
  claim: {
    elevator: [120, true], town: [80, true], state: [2, true, "state"], contact_name: [80, true],
    role: [80, true], email: [254, true, "email"], phone: [30], bid_page_url: [320, false, "url"],
    hosted_board: [3, false, "yesno"], page: [60],
  },
  "sponsor-feedback": {
    request: [60, true], sponsor: [120], proof: [40], subject: [200], message: [6000, true, "text"],
    email: [254, false, "email"], page: [60],
  },
  "atlas-feedback": { email: [254, true, "email"], source: [60], page: [60] },
  // v5.9: Rain Print order requests (rain-print.html). address is required for
  // the print and the framed print (checked at the end of formClean), never for the digital file.
  "rain-print-order": {
    name: [80, true], email: [254, true, "email"], choice: [20, true, "rpchoice"], address: [600, false, "text"],
    notes: [2000, false, "text"], design_url: [1200, true, "rpurl"], design_code: [300, true, "rpcode"], page: [60],
    // v5.10: a gift of this year's print, made in January. Kept only with gift_january.
    gift_january: [3, false, "flag"], gift_to: [80], gift_deliver: [10, false, "rpdeliver"],
    gift_email: [254, false, "email"], gift_message: [240, false, "text"],
    // v5.12: an ordinary order given as a gift (note card in the box). Keeps the gift_ fields like gift_january.
    gift: [3, false, "flag"],
    // v5.23: the logo on the print (an rpl: id); also read from design_code
    logo: [12, false, "rplogo"],
  },
  // v5.12: Rain Print business quotes (rain-print.html#rp-biz). Sig emails back a quote and proofs.
  "rain-print-business": {
    business: [120, true], name: [80, true], email: [254, true, "email"], phone: [30],
    quantity: [3, true, "rpqty"], product: [10, true, "rpbproduct"], towns: [20000, true, "text"],
    ship: [10, true, "rpbship"], note_all: [300, false, "text"], notes: [2000, false, "text"], page: [60],
    logo: [12, false, "rplogo"],   // v5.23: for the note card or the prints
  },
  // v5.21: an elevator asks to post its own bids (list-your-elevator.html). Sig confirms by phone first.
  "elevator-listing": {
    elevator: [120, true], town: [80, true], state: [2, true, "state"], zip: [5, true, "zip5"],
    name: [80, true], role: [80, true], phone: [30, true, "phone"], email: [254, true, "email"],
    crops: [120, true, "crops"], how: [10, true, "elhow"], note: [600, false, "text"],
    dir_id: [200, false, "dirid"], page: [60],
  },
  // v5.22: a business asks about sponsoring PRF in one or more states (prf-sponsor.html). Sig replies with a price.
  "prf-sponsor": {
    business: [120, true], name: [80, true], email: [254, true, "email"], phone: [30, false, "phone"],
    states: [200, true, "prfstates"], line: [120], website: [320, false, "url"], message: [1000, false, "text"], page: [60],
  },
};
// v5.22: the states AGSIST has PRF pages for (data/prf/meta.json; Hawaii is left out).
// scripts/test_form_worker.mjs fails if this drifts from the data.
const PRF_STATES = ["AL", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME",
  "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA",
  "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"];
const EL_CROPS = ["corn", "soybeans", "wheat", "sorghum", "oats", "other"];
const EL_HOW = ["email", "phone", "not-sure"];
const EL_REQ_STATUS = ["pending", "created", "dismissed"];
const RP_CHOICES = ["digital", "print12x18", "framed12x18"];
const RP_DELIVER = ["buyer", "recipient"];
const RPB_PRODUCTS = ["print", "framed", "digital", "not-sure"];
const RPB_SHIP = ["one", "each", "not-sure"];
const RPB_QTY_MIN = 5, RPB_QTY_MAX = 500;    // v5.17: business orders start at 5 prints
const FORM_MAX_BYTES = 48 * 1024;   // v5.35: a 20,000-character business list plus the rest, in UTF-8
const FORM_RATE_MAX = 8;                 // posts per IP per hour, all kinds together
const FORM_TTL_S = 365 * 24 * 3600;      // a stored post is dropped after a year
const FORM_KEY_RE = /^form:[a-z-]{2,30}:\d{10,16}:[0-9a-f]{8}$/;

function formClean(kind, b) {
  const spec = FORM_KINDS[kind];
  const out = {};
  for (const f of Object.keys(spec)) {
    const [max, req, type] = spec[f];
    let v = b[f];
    if (type === "yesno") { out[f] = (v === true || /^(yes|on|true|1)$/i.test(String(v == null ? "" : v).trim())) ? "yes" : "no"; continue; }
    // v5.10: stored as "yes" only when set; an unset flag leaves no key at all.
    if (type === "flag") { if (v === true || /^(yes|on|true|1)$/i.test(String(v == null ? "" : v).trim())) out[f] = "yes"; continue; }
    v = String(v == null ? "" : v);
    // A message keeps its line breaks; every other field is one line.
    v = type === "text" ? v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ")
                        : v.replace(/[\u0000-\u001f\u007f]/g, " ");
    v = v.trim();
    if (!v) { if (req) return { error: f + " is required" }; continue; }
    if (v.length > max) return { error: f + " is too long" };
    if (type === "email") {
      v = v.toLowerCase();
      if (!EMAIL_RE.test(v)) return { error: "invalid email" };
    } else if (type === "state") {
      v = v.toUpperCase();
      if (!/^[A-Z]{2}$/.test(v)) return { error: "invalid state" };
    } else if (type === "rpchoice") {
      if (!RP_CHOICES.includes(v)) return { error: "invalid " + f };
    } else if (type === "rpurl") {
      // The design link the page builds: always agsist.com/rain-print plus its query.
      if (!/^https:\/\/agsist\.com\/rain-print\?[A-Za-z0-9%+._~=&-]+$/.test(v)) return { error: "invalid " + f };
    } else if (type === "rpcode") {
      if (!/^[A-Za-z0-9_-]+$/.test(v)) return { error: "invalid " + f };
    } else if (type === "rpdeliver") {
      if (!RP_DELIVER.includes(v)) return { error: "invalid " + f };
    } else if (type === "rpqty") {
      // a whole number of prints, 5 to 500 (v5.17), stored as its digits ("010" is "10")
      if (!/^\d{1,3}$/.test(v) || +v < RPB_QTY_MIN || +v > RPB_QTY_MAX) return { error: "invalid " + f };
      v = String(+v);
    } else if (type === "rpbproduct") {
      if (!RPB_PRODUCTS.includes(v)) return { error: "invalid " + f };
    } else if (type === "rpbship") {
      if (!RPB_SHIP.includes(v)) return { error: "invalid " + f };
    } else if (type === "zip5") {
      if (!/^\d{5}$/.test(v)) return { error: "invalid " + f };
    } else if (type === "phone") {
      if (!/^[0-9+().\-\s]+$/.test(v) || v.replace(/\D/g, "").length < 10) return { error: "invalid " + f };
    } else if (type === "crops") {
      // a list ("corn, soybeans" or an array): known crops only, each once, in the table's order
      const got = (Array.isArray(b[f]) ? b[f].map(String) : v.split(/[,;\s]+/)).map(x => x.trim().toLowerCase()).filter(Boolean);
      if (!got.length || got.some(x => !EL_CROPS.includes(x))) return { error: "invalid " + f };
      v = EL_CROPS.filter(x => got.includes(x)).join(", ");
    } else if (type === "prfstates") {
      // a list ("IA, NE" or an array): PRF state codes only, each once, A to Z
      const got = (Array.isArray(b[f]) ? b[f].map(String) : v.split(/[,;\s]+/)).map(x => x.trim().toUpperCase()).filter(Boolean);
      if (!got.length || got.some(x => !PRF_STATES.includes(x))) return { error: "invalid " + f };
      v = [...new Set(got)].sort().join(", ");
    } else if (type === "rplogo") {
      v = rplId(v);
      if (!v) return { error: "invalid " + f };
    } else if (type === "elhow") {
      if (!EL_HOW.includes(v)) return { error: "invalid " + f };
    } else if (type === "dirid") {
      if (!/^(known|reg):[^<>"`\\]{1,190}$/.test(v)) return { error: "invalid " + f };
    } else if (type === "url") {
      if (!/^https?:\/\//i.test(v)) v = "https://" + v;
      try { const u = new URL(v); if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".")) throw 0; }
      catch (e) { return { error: "invalid " + f }; }
      if (v.length > max) return { error: f + " is too long" };
    }
    out[f] = v;
  }
  if (kind === "rain-print-order") {
    // v5.23: the logo the design code carries is the one on the print
    const lg = rplFromCode(out.design_code);
    if (lg) out.logo = lg;
    if (out.choice === "digital") delete out.address;
    else if (!out.address) return { error: "address is required for a print" };
    if (out.gift_january !== "yes" && out.gift !== "yes") {
      for (const g of ["gift_to", "gift_deliver", "gift_email", "gift_message"]) delete out[g];
    } else {
      if (!out.gift_deliver) out.gift_deliver = "buyer";
      // a file sent straight to the person it is for needs their address; a print or framed print goes to Ship to
      if (out.choice === "digital" && out.gift_deliver === "recipient" && !out.gift_email) return { error: "gift_email is required to send the file to the recipient" };
      if (!(out.choice === "digital" && out.gift_deliver === "recipient")) delete out.gift_email;
    }
  }
  return { rec: out };
}

async function formRateOk(req, env) {
  const ip = req.headers.get("CF-Connecting-IP") || "";
  if (!ip) return true;
  // Only an HMAC of the address is stored, and only for two hours.
  const h = await hmac16("form-ip|" + ip, env.UNSUB_SECRET);
  const k = "rl:form:" + h + ":" + Math.floor(Date.now() / 3600e3);
  const n = Number(await env.SUBS.get(k)) || 0;
  if (n >= FORM_RATE_MAX) return false;
  await env.SUBS.put(k, String(n + 1), { expirationTtl: 7200 });
  return true;
}

// v5.14: Rain Print short links. rps:<id> = a plain design code, no expiry.
const RPS_LEN = 5, RPS_MAX_LEN = 8;      // 5 keeps HTTPS://AGSIST.COM/R?<id> at 26 bytes: QR version 2, 25 x 25
const RPS_MAX_BYTES = 1024;
const RPS_B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";   // Crockford: no I L O U
const RPS_ID_RE = /^[0-9A-HJKMNP-TV-Z]{5,8}$/;
// The design-code rules of decodeCode (components/rain-print.js): base64url
// of "1|place|station|year|LPCS|name[|day|label]..." (v1) or
// "2|place|station|year|LPCSX|name[|day|label]...[|dedication]" (v2, v5.15).
// The key letters are the page's to change, so only their shape is checked here.
function rpsCodeOk(code) {
  if (typeof code !== "string" || !/^[A-Za-z0-9_-]{8,400}$/.test(code)) return false;
  let raw;
  try {
    let b = code.replace(/-/g, "+").replace(/_/g, "/");
    while (b.length % 4) b += "=";
    const bin = atob(b), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (e) { return false; }
  const f = raw.split("|"), v2 = f[0] === "2";
  if ((f[0] !== "1" && !v2) || f.length < 6) return false;
  if (v2 && (f.length - 6) % 2 && !f.pop().trim()) return false;   // the dedication, when there is one
  if ((f.length - 6) % 2) return false;
  if (!f[1].trim()) return false;
  // v5.23: + a logo; v5.27: + the units-and-language letter and the options after a ~ (components/rain-print.js optCode)
  if (!(v2 ? /^[a-z0-9]{5}(?:[ic][0-9a-hjkmnp-tv-z]{12})?[A-H]?(?:~(?:[cs][0-9a-z]{4})?p?g?h?f?t?r?)?$/ : /^[a-z0-9]{4}$/).test(f[4])) return false;
  const year = parseInt(f[3], 10);
  if (!(year >= 1850 && year <= 2200) || String(year) !== f[3]) return false;
  for (let i = 6; i + 1 < f.length; i += 2) {
    if (!/^[0-9a-z]{1,2}$/.test(f[i]) || parseInt(f[i], 36) > 365) return false;
  }
  return true;
}
async function rpsHash(code) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code)));
  let out = "", acc = 0, bits = 0;
  for (let i = 0; out.length < RPS_MAX_LEN; i++) {
    acc = (acc << 8) | d[i]; bits += 8;
    while (bits >= 5 && out.length < RPS_MAX_LEN) { bits -= 5; out += RPS_B32[(acc >> bits) & 31]; }
    acc &= (1 << bits) - 1;
  }
  return out;
}
function rpsId(v) {
  const id = String(v == null ? "" : v).trim().toUpperCase().replace(/[IL]/g, "1").replace(/O/g, "0");
  return RPS_ID_RE.test(id) ? id : "";
}

// v5.14: a cheap brake that costs no KV: per isolate and client address an
// hour, at most RPS_MEM_MAX.post POSTs (repeats included, which RATE does not
// count) and RPS_MEM_MAX.miss GETs of an unknown id (someone walking the id
// space). Past the miss cap every GET from that address answers 429 until
// the hour turns, so a hit cannot be found by walking ids either.
const RPS_MEM_MAX = { post: 240, miss: 30, logo: 60 };   // v5.23: logo uploads, any answer
const RPS_MEM = new Map();
function rpsMemKey(req, kind) {
  return "rps|" + kind + "|" + ipBucket(req.headers.get("CF-Connecting-IP") || "") + "|" + Math.floor(Date.now() / 3600e3);
}
function rpsMemOk(req, kind) {
  if (!req.headers.get("CF-Connecting-IP")) return true;
  if (RPS_MEM.size > 5000) RPS_MEM.clear();
  if (kind === "get") return (RPS_MEM.get(rpsMemKey(req, "miss")) || 0) < RPS_MEM_MAX.miss;
  const k = rpsMemKey(req, kind), n = RPS_MEM.get(k) || 0;
  if (n >= RPS_MEM_MAX[kind]) return false;
  RPS_MEM.set(k, n + 1);
  return true;
}
function rpsMemMiss(req) {
  if (!req.headers.get("CF-Connecting-IP")) return;
  const k = rpsMemKey(req, "miss");
  RPS_MEM.set(k, (RPS_MEM.get(k) || 0) + 1);
}

// v5.23: RAIN PRINT LOGOS. rpl:<id> = the PNG bytes the page made.
const RPL_MAX_BYTES = 2 * 1024 * 1024;
const RPL_MAX_SIDE = 1600;
const RPL_TTL_S = 400 * 24 * 3600;      // an order, a quote or a locked gift card keeps it for good (rplKeep)
const RPL_B32 = "0123456789abcdefghjkmnpqrstvwxyz";   // Crockford, lowercase: no i l o u
const RPL_ID_RE = /^[0-9a-hjkmnp-tv-z]{12}$/;
function rplNew() {
  let s = "";
  for (const x of crypto.getRandomValues(new Uint8Array(12))) s += RPL_B32[x & 31];
  return s;
}
function rplId(v) {
  const id = String(v == null ? "" : v).trim().toLowerCase().replace(/[il]/g, "1").replace(/o/g, "0");
  return RPL_ID_RE.test(id) ? id : "";
}
// A whole PNG of 1 to RPL_MAX_SIDE px each way: {w, h}, or why not (a string).
function rplPng(b) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!(b instanceof Uint8Array) || b.length < 57 || sig.some((v, i) => b[i] !== v)) return "not a PNG";
  const u32 = (at) => ((b[at] << 24) >>> 0) + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3];
  const tag = (at) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
  if (u32(8) !== 13 || tag(12) !== "IHDR") return "not a PNG";
  const w = u32(16), h = u32(20);
  if (![1, 2, 4, 8, 16].includes(b[24]) || ![0, 2, 3, 4, 6].includes(b[25])) return "not a PNG";
  let p = 8, idat = false, end = false, extra = 0;
  while (p + 12 <= b.length) {
    const len = u32(p), t = tag(p + 4);
    if (!/^[A-Za-z]{4}$/.test(t) || p + 12 + len > b.length) return "not a PNG";
    if (t === "IDAT") idat = true;
    // v5.24: pixels only, not a place to keep text or files
    if (t === "tEXt" || t === "zTXt" || t === "iTXt") return "not a plain PNG";
    if (t !== "IHDR" && t !== "PLTE" && t !== "IDAT" && t !== "IEND" && (extra += len) > 64 * 1024) return "not a plain PNG";
    p += 12 + len;
    if (t === "IEND") { end = true; break; }
  }
  if (!end || !idat || p !== b.length) return "not a PNG";
  if (!w || !h || w > RPL_MAX_SIDE || h > RPL_MAX_SIDE) return "logo must be 1600 px or less each way";
  return { w, h };
}
// The logo id in a v2 design code's key field ("LPCSX" + i|c + id), or "".
function rplFromCode(code) {
  const f = rpgFields(code);
  return f && f[0] === "2" && f[4].length === 18 ? rplId(f[4].slice(6)) : "";
}
// An order, a quote or a locked gift card names this logo: keep it for good.
async function rplKeep(env, id) {
  id = rplId(id);
  if (!id) return;
  try {
    const got = await env.SUBS.getWithMetadata("rpl:" + id, { type: "arrayBuffer" });
    if (!got || !got.value) return;
    const m = got.metadata && typeof got.metadata === "object" ? got.metadata : {};
    if (m.kept) return;
    await env.SUBS.put("rpl:" + id, got.value, { metadata: Object.assign({}, m, { kept: Date.now() }) });
  } catch (e) { /* the order is stored; Sig still has the link until the logo's 400 days run out */ }
}

// v5.16: RAIN PRINT GIFT CARDS. A card is a code RP-XXXX-XXXX-XXXX: 11
// characters from crypto.getRandomValues in Crockford base32 (0-9 A-Z without
// I L O U), then one check character, the 11 read as a base-32 number mod 37
// (Crockford's check, which catches any one wrong character and any two
// neighbours swapped). The 5 check values past V (* ~ $ = U) are never made:
// a draw that would need one is thrown away and drawn again, so every
// character on a card is a plain letter or digit (54.8 random bits). The
// code is never stored: the record is rpg:<hmac16("rp-gift|" + CODE)>, so a
// KV listing gives nothing a stranger could type.
const RPG_RE = /^[0-9A-HJKMNP-TV-Z]{12}$/;
const RPG_KEY_RE = /^rpg:[0-9a-f]{16}$/;
const RPG_REF_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;   // v5.26: _ and 80 (Stripe's pi_..., cs_...)
const RPG_RANK = { digital: 0, print12x18: 1, framed12x18: 2 };
const RPG_MAX_BYTES = 1024, RPG_REDEEM_MAX_BYTES = 8 * 1024, RPG_ADMIN_MAX_BYTES = 8 * 1024;
const RPG_PENDING_MS = 120e3;   // a redeem that died half way frees the card after 2 minutes
const RPG_MEM_MISS = 10;        // unknown codes per address an hour, per isolate, then 429
const RPG_SITE = "https://agsist.com";
function rpgCheck(body) {
  let m = 0;
  for (const ch of body) m = (m * 32 + RPS_B32.indexOf(ch)) % 37;
  return m;
}
function rpgFormat(s) { return "RP-" + s.slice(0, 4) + "-" + s.slice(4, 8) + "-" + s.slice(8, 12); }
function rpgNew() {
  for (;;) {
    const body = [...crypto.getRandomValues(new Uint8Array(11))].map(b => RPS_B32[b & 31]).join("");
    const c = rpgCheck(body);
    if (c < 32) return rpgFormat(body + RPS_B32[c]);
  }
}
// Forgiving input: any case, spaces, dashes and dots ignored, the RP in front
// optional, I and L read as 1, O as 0. Answers the code as printed, or "".
function rpgNorm(v) {
  let s = String(v == null ? "" : v).toUpperCase().replace(/[\s._\u2010-\u2015-]/g, "")
    .replace(/[IL]/g, "1").replace(/O/g, "0");
  if (s.length === 14 && s.startsWith("RP")) s = s.slice(2);
  if (!RPG_RE.test(s) || rpgCheck(s.slice(0, 11)) !== RPS_B32.indexOf(s[11])) return "";
  return rpgFormat(s);
}
async function rpgKey(env, code) { return "rpg:" + await hmac16("rp-gift|" + code, env.UNSUB_SECRET); }
async function rpgCardK(env, code) { return hmac16("rp-gift-card|" + code, env.UNSUB_SECRET); }
function rpgMemKey(req) { return rpsMemKey(req, "gmiss"); }
function rpgMemOk(req) {
  if (!req.headers.get("CF-Connecting-IP")) return true;
  if (RPS_MEM.size > 5000) RPS_MEM.clear();
  return (RPS_MEM.get(rpgMemKey(req)) || 0) < RPG_MEM_MISS;
}
function rpgMemMiss(req) {
  if (!req.headers.get("CF-Connecting-IP")) return;
  const k = rpgMemKey(req);
  RPS_MEM.set(k, (RPS_MEM.get(k) || 0) + 1);
}
// The fields of a design code ("2|place|station|year|keys|name|..."), or null.
function rpgFields(code) {
  code = String(code || "").replace(/^GIFT-/, "");
  if (!rpsCodeOk(code)) return null;
  let b = code.replace(/-/g, "+").replace(/_/g, "/");
  while (b.length % 4) b += "=";
  const bin = atob(b), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes).split("|");
}
// A locked card takes only its own design; with edit "name" the name line
// (field 5) may differ and nothing else.
function rpgLockOk(lock, code) {
  const a = rpgFields(lock.design_code), b = rpgFields(code);
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && !(i === 5 && lock.edit === "name")) return false;
  return true;
}
function rpgDay(ts) {
  return ts ? new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" }) : null;
}
function rpgYearNow() { return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric" }).format(new Date())); }
function rpgText(v, max) {
  return String(v == null ? "" : v).replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]/g, " ")
    .replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
}
// What a stranger with the code may see: never the giver's email or message.
function rpgPublic(r) {
  return { kind: r.kind, product: r.product, to: r.to || "", from_line: r.from_line || "",
    lock: r.lock ? { design_code: r.lock.design_code, edit: r.lock.edit } : null, ships: r.ships,
    status: r.status === "pending" && Date.now() - (r.pending_ts || 0) > RPG_PENDING_MS ? "issued" : r.status,
    redeemed_on: r.status === "redeemed" ? rpgDay(r.redeemed_ts) : null, prepaid: rpgPrepaid(r) };
}
// v5.40: set at issue (the giver gave the address at checkout): nothing for the receiver to fill in.
// An older card Sig issued as already redeemed has redeemed_ts === issued_ts.
function rpgPrepaid(r) {
  return !!r && r.status === "redeemed" && (r.prepaid === true || (!!r.issued_ts && r.redeemed_ts === r.issued_ts));
}
// Sig's issue body -> the record's fields, or {error}.
function rpgIssueClean(b) {
  const product = String(b.product || "");
  if (!RP_CHOICES.includes(product)) return { error: "product must be one of " + RP_CHOICES.join(", ") };
  const order_ref = String(b.order_ref == null ? "" : b.order_ref).trim();
  if (!RPG_REF_RE.test(order_ref)) return { error: "order_ref is required (letters, digits, dashes, underscores; 80 at most)" };
  const g = b.giver && typeof b.giver === "object" ? b.giver : {};
  const email = String(g.email == null ? "" : g.email).trim().toLowerCase();
  if (email && !EMAIL_RE.test(email)) return { error: "invalid giver email" };
  const kind = b.lock ? "locked" : String(b.kind || "open");
  if (kind !== "open" && kind !== "locked") return { error: "kind must be open or locked" };
  let lock = null, year = 0;
  if (kind === "locked") {
    const l = b.lock && typeof b.lock === "object" ? b.lock : {};
    const dc = String(l.design_code || "").replace(/^GIFT-/, "");
    const f = rpgFields(dc);
    if (!f) return { error: "a locked card needs lock.design_code, a Rain Print design code" };
    const edit = String(l.edit || "none");
    if (edit !== "none" && edit !== "name") return { error: "lock.edit must be none or name" };
    lock = { design_code: dc, edit };
    year = Number(f[3]);
  }
  let ships = b.ships == null || b.ships === "" ? (lock && year >= rpgYearNow() ? "january" : "now") : String(b.ships);
  if (ships !== "now" && ships !== "january") return { error: "ships must be now or january" };
  return { rec: { kind, product, order_ref, giver: { name: oneLine(g.name, 80), email },
    to: oneLine(b.to, 80), from_line: oneLine(b.from_line, 80), message: rpgText(b.message, 240), lock, ships } };
}
async function rpgBody(req, max) {
  if (Number(req.headers.get("Content-Length") || 0) > max) return { status: 413, error: "too large" };
  let raw = "";
  try { raw = await req.text(); } catch (e) { raw = ""; }
  if (raw.length > max) return { status: 413, error: "too large" };
  let b = null;
  try { b = JSON.parse(raw); } catch (e) { b = null; }
  if (!b || typeof b !== "object" || Array.isArray(b)) return { status: 400, error: "bad json" };
  return { b };
}
async function rpgIndex(env, k, recKey) {
  let a = [];
  try { a = JSON.parse(await env.SUBS.get(k)) || []; } catch (e) { a = []; }
  if (!Array.isArray(a)) a = [];
  if (!a.includes(recKey)) a.push(recKey);
  await env.SUBS.put(k, JSON.stringify(a.slice(-50)));
}
// Writes a new card. Sig only (the caller has checked the token).
async function rpgIssue(env, f, extra) {
  let code = "", key = "";
  for (let i = 0; i < 5 && !code; i++) {
    const c = rpgNew(), k = await rpgKey(env, c);
    if ((await env.SUBS.get(k)) === null) { code = c; key = k; }
  }
  if (!code) return null;
  const no = (Number(await env.SUBS.get("rpg-n")) || 0) + 1;   // Sig alone issues, one at a time
  await env.SUBS.put("rpg-n", String(no));
  const now = Date.now(), last4 = code.slice(-4);
  const rec = Object.assign({ v: 1 }, f, { status: "issued", issued_ts: now, no, last4,
    redeemed_ts: null, redeem_key: null, void_reason: null }, extra || {});
  if (rec.status === "redeemed") rec.redeemed_ts = now;
  await env.SUBS.put(key, JSON.stringify(rec));
  await rpgIndex(env, "rpg-ref:" + f.order_ref, key);
  if (f.giver.email) await rpgIndex(env, "rpg-by:" + await hmac16("rp-gift-by|" + f.giver.email, env.UNSUB_SECRET), key);
  if (f.lock) await rplKeep(env, rplFromCode(f.lock.design_code));   // v5.23: a locked card's logo stays
  const k = await rpgCardK(env, code);
  return { ok: true, code, no, last4, key, status: rec.status, ships: rec.ships,
    card_url: RPG_SITE + "/rp-gift?c=" + code + "&k=" + k };
}
// v5.40: the card for one paid this-year gift order (rpo:...), issued by scripts/rp_buyer_email.py
// through POST /rp-gift/issue {order_key, to, message}. Once per order: the record keeps the
// code, and a second call answers the same card. The design and product come from the record,
// never from the body; the giver's name and email are not put on the card.
async function rpgIssueForOrder(env, b) {
  const k = String(b.order_key || "");
  if (!RPO_KEY_RE.test(k)) return { status: 400, error: "invalid order_key" };
  let r = null;
  try { r = JSON.parse(await env.SUBS.get(k)); } catch (e) { r = null; }
  if (!r || typeof r !== "object") return { status: 404, error: "not found" };
  if (!r.paid || !r.paid.session) return { status: 409, error: "not paid" };
  if (!r.gift || !/^GIFT-/.test(String(r.ref || ""))) return { status: 409, error: "not a gift card order" };
  if (r.gift_card && r.gift_card.code) {
    const g = r.gift_card;
    let rec = null;
    try { rec = JSON.parse(await env.SUBS.get(g.key)); } catch (e) { rec = null; }
    return { ok: true, already: true, code: g.code, no: g.no, last4: g.last4, key: g.key, status: rec ? rec.status : "redeemed",
      ships: rec ? rec.ships : "january", prepaid: rpgPrepaid(rec), card_url: RPG_SITE + "/rp-gift?c=" + g.code + "&k=" + await rpgCardK(env, g.code) };
  }
  let dc = String(r.ref).replace(/^GIFT-/, "");
  const short = /^RPS-([0-9A-Za-z]{5,8})$/.exec(dc);
  if (short) {
    const id = rpsId(short[1]), got = id ? await env.SUBS.get("rps:" + id) : null;
    dc = typeof got === "string" && rpsCodeOk(got) ? got : "";
  }
  if (!rpgFields(dc)) return { status: 409, error: "the design could not be read" };
  const sess = String(r.paid.session);
  const v = rpgIssueClean({ product: r.product, order_ref: RPG_REF_RE.test(sess) ? sess : k.replace(/:/g, "-"),
    to: b.to, message: b.message, lock: { design_code: dc, edit: "none" }, ships: "january" });
  if (v.error) return { status: 409, error: v.error };
  const out = await rpgIssue(env, v.rec, { status: "redeemed", prepaid: true, order_key: k });
  if (!out) return { status: 500, error: "no free code; try again" };
  r.gift_card = { code: out.code, no: out.no, last4: out.last4, key: out.key, at: new Date().toISOString(), session: sess };
  await rpoPut(env, k, r);
  return Object.assign({}, out, { already: false, prepaid: true });
}

// v5.20: THE ELEVATOR PORTAL. An elevator keeps its own listing (basis by
// crop and delivery period, hours, contact, a short note) from a private
// phone link https://agsist.com/post?k=<key>. elev:<id> is the record;
// elevkey:<hmac16("elev|" + key)> = id points a key at it (the key itself is
// never stored; the id rides along as list() metadata so a rekey can find
// and drop the old pointer without reading every one).
const ELEV_SITE = "https://agsist.com";
const ELEV_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ELEV_KEY_RE = /^[a-z2-7]{24}$/;
const ELEV_B32 = "abcdefghijklmnopqrstuvwxyz234567";
const ELEV_MAX_BYTES = 16 * 1024;
const ELEV_MAX_ROWS = 12;
const ELEV_NOTE_MAX = 140;
const ELEV_PERIOD_MAX = 16;
// The board each crop's cash price hangs on, and the months that board lists.
const ELEV_FUT = { corn: ["ZC", "HKNUZ"], soybeans: ["ZS", "FHKNQUX"], wheat: ["ZW", "HKNUZ"] };
function elevNewKey() {
  return [...crypto.getRandomValues(new Uint8Array(24))].map(b => ELEV_B32[b & 31]).join("");
}
async function elevKeyName(env, key) { return "elevkey:" + await hmac16("elev|" + key, env.UNSUB_SECRET); }
function elevPublic(r) {
  const out = Object.assign({}, r);
  delete out.email;
  return out;
}
function elevDate(v) {
  const s = String(v == null ? "" : v);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return "";
  const y = +m[1], mo = +m[2], d = +m[3];
  if (y < 2020 || y > 2100) return "";
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? s : "";
}
// The last second of today on Central time, as an ISO time (for "Closed today").
function elevEndOfDayCT(now) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
  const parts = (t) => Object.fromEntries(f.formatToParts(new Date(t)).map(p => [p.type, p.value]));
  const p = parts(now);
  const y = +p.year, mo = +p.month, d = +p.day;
  for (const h of [5, 6]) {
    const t = Date.UTC(y, mo - 1, d + 1, h);
    const q = parts(t);
    if (+q.hour === 0 && +q.day === new Date(Date.UTC(y, mo - 1, d + 1)).getUTCDate()) return new Date(t - 1000).toISOString();
  }
  return new Date(Date.UTC(y, mo - 1, d + 1, 6) - 1000).toISOString();
}
function elevText(v, max, field) {
  if (v == null) return { v: "" };
  if (typeof v !== "string") return { error: "invalid " + field };
  const s = oneLine(v, max + 1);
  if (s.length > max) return { error: field + " too long (" + max + " at most)" };
  return { v: s };
}
function elevPhone(v) {
  const t = elevText(v, 24, "phone");
  if (t.error || !t.v) return t;
  if (!/^[0-9()+\-. ]+$/.test(t.v) || t.v.replace(/\D/g, "").length < 7) return { error: "invalid phone" };
  return t;
}
function elevContact(c) {
  if (!c || typeof c !== "object" || Array.isArray(c)) return { error: "invalid contact" };
  const n = elevText(c.name, 60, "contact name"); if (n.error) return n;
  const p = elevPhone(c.phone); if (p.error) return p;
  return { v: { name: n.v, phone: p.v } };
}
function elevHours(h) {
  if (!h || typeof h !== "object" || Array.isArray(h)) return { error: "invalid hours" };
  const t = elevText(h.text, 80, "hours"); if (t.error) return t;
  const hv = elevText(h.harvest, 80, "harvest hours"); if (hv.error) return hv;
  return { v: { text: t.v, harvest: hv.v || null } };
}
function elevBids(rows) {
  if (!Array.isArray(rows)) return { error: "invalid bids" };
  if (rows.length > ELEV_MAX_ROWS) return { error: "too many bid rows (" + ELEV_MAX_ROWS + " at most)" };
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i], at = " (row " + (i + 1) + ")";
    if (!r || typeof r !== "object" || Array.isArray(r)) return { error: "invalid bid row" + at };
    const crop = typeof r.crop === "string" ? r.crop : "";
    if (!own(ELEV_FUT, crop)) return { error: "invalid crop" + at };
    const per = elevText(r.period, ELEV_PERIOD_MAX, "delivery period");
    if (per.error) return { error: per.error + at };
    if (!per.v) return { error: "delivery period missing" + at };
    const start = elevDate(r.start), end = elevDate(r.end);
    if (!start || !end) return { error: "invalid delivery dates" + at };
    if (end < start) return { error: "delivery ends before it starts" + at };
    const [root, months] = ELEV_FUT[crop];
    const fut = typeof r.futures === "string" ? r.futures.trim().toUpperCase() : "";
    const fm = /^(Z[CSW])([FGHJKMNQUVXZ])(\d{2})$/.exec(fut);
    if (!fm || fm[1] !== root || !months.includes(fm[2])) return { error: "invalid futures month" + at };
    const b = typeof r.basis === "number" ? r.basis : (typeof r.basis === "string" && r.basis.trim() !== "" ? Number(r.basis) : NaN);
    if (!Number.isFinite(b)) return { error: "invalid basis" + at };
    const basis = Math.round(b * 100) / 100;
    if (basis < -3 || basis > 2) return { error: "basis out of range (-3.00 to +2.00)" + at };
    out.push({ crop, period: per.v, start, end, futures: fut, basis: basis === 0 ? 0 : basis });
  }
  return { v: out };
}
async function elevBody(req) {
  if (Number(req.headers.get("Content-Length") || 0) > ELEV_MAX_BYTES) return { error: "too large", status: 413 };
  let raw = "";
  try { raw = await req.text(); } catch (e) { raw = ""; }
  if (raw.length > ELEV_MAX_BYTES) return { error: "too large", status: 413 };
  let b = null;
  try { b = JSON.parse(raw); } catch (e) { b = null; }
  if (!b || typeof b !== "object" || Array.isArray(b)) return { error: "bad json", status: 400 };
  return { b };
}
// v5.34: a board Sig pastes by hand. See the header.
const PASTE_SITES = {
  newcoop: { name: "NEW Cooperative", page: "https://www.newcoop.com/cash-bids",
             source: "posted from NEW Cooperative's public bid page" },
};
const PASTE_MAX_BYTES = 256 * 1024;
const PASTE_CELL = {
  commodity: /^[A-Za-z][A-Za-z0-9 #&()\/.,'-]{0,39}$/,
  delivery: /^\d{1,2}\/\d{1,2}\/\d{4}\s*-\s*\d{1,2}\/\d{1,2}\/\d{4}$/,
  cash: /^\$?\d{1,3}(?:\.\d{1,4})?$/,
  basis: /^[-+]?\d{1,4}(?:\.\d{1,2})?$/,
  future: /^\d{2,5}-[0-7]$/,
  change: /^(?:[-+]?\d{1,4}-[0-7]|-|unch|)$/i,
};
function pasteClean(b) {
  const site = typeof b.site === "string" ? b.site : "";
  if (!own(PASTE_SITES, site)) return { error: "unknown site" };
  if (!Array.isArray(b.locations) || !b.locations.length || b.locations.length > 200) return { error: "locations must be a list of 1 to 200" };
  const locations = [];
  let rows = 0;
  for (const [i, l] of b.locations.entries()) {
    const name = typeof l?.name === "string" ? l.name.replace(/\s+/g, " ").trim() : "";
    if (!name || name.length > 60 || /[<>]/.test(name)) return { error: "location " + (i + 1) + ": invalid name" };
    if (!Array.isArray(l.rows) || l.rows.length > 60) return { error: name + ": rows must be a list of at most 60" };
    const out = [];
    for (const [k, r] of l.rows.entries()) {
      const row = {};
      for (const [f, re] of Object.entries(PASTE_CELL)) {
        const v = typeof r?.[f] === "string" ? r[f].replace(/\s+/g, " ").trim() : "";
        if (!re.test(v)) return { error: name + " row " + (k + 1) + ": " + f + " does not look like the board's own (" + JSON.stringify(v.slice(0, 40)) + ")" };
        row[f] = v;
      }
      out.push(row);
    }
    rows += out.length;
    locations.push({ name, rows: out });
  }
  if (!rows) return { error: "no bid rows" };
  return { site, locations, rows };
}
async function elevGet(env, id) {
  try { const r = JSON.parse(await env.SUBS.get("elev:" + id)); return r && typeof r === "object" ? r : null; } catch (e) { return null; }
}
// The key from a post, to the record it opens. {error, status} when it opens none.
async function elevByKey(env, k) {
  const key = typeof k === "string" ? k.trim().toLowerCase() : "";
  if (!ELEV_KEY_RE.test(key)) return { error: "this link is not right", status: 404 };
  const id = await env.SUBS.get(await elevKeyName(env, key));
  const rec = id ? await elevGet(env, id) : null;
  if (!rec) return { error: "this link is not right", status: 404 };
  if (rec.active !== true) return { error: "this listing is turned off", status: 403 };
  return { rec };
}
async function elevSetKey(env, id) {
  // Drop every pointer at this id, then make one new key.
  const page = [];
  let cursor;
  do {
    const p = await env.SUBS.list({ prefix: "elevkey:", cursor });
    page.push(...p.keys);
    cursor = p.list_complete ? null : p.cursor;
  } while (cursor);
  for (const k of page) {
    const owner = k.metadata && k.metadata.id ? k.metadata.id : await env.SUBS.get(k.name);
    if (owner === id) await env.SUBS.delete(k.name);
  }
  const key = elevNewKey();
  await env.SUBS.put(await elevKeyName(env, key), id, { metadata: { id } });
  return ELEV_SITE + "/post?k=" + key;
}
function elevCreateClean(b) {
  const id = typeof b.id === "string" ? b.id.trim() : "";
  if (id.length < 3 || id.length > 60 || !ELEV_ID_RE.test(id)) return { error: "invalid id (lowercase letters, digits and dashes)" };
  const name = elevText(b.name, 80, "name"); if (name.error) return name;
  if (!name.v) return { error: "name missing" };
  const town = elevText(b.town, 60, "town"); if (town.error) return town;
  if (!town.v) return { error: "town missing" };
  const state = typeof b.state === "string" ? b.state.trim().toUpperCase() : "";
  if (!/^[A-Z]{2}$/.test(state)) return { error: "invalid state" };
  const zip = typeof b.zip === "string" ? b.zip.trim() : (typeof b.zip === "number" ? String(b.zip).padStart(5, "0") : "");
  if (!/^\d{5}$/.test(zip)) return { error: "invalid zip" };
  const lat = Number(b.lat), lon = Number(b.lon);
  if (b.lat == null || b.lon == null || b.lat === "" || b.lon === "" || !Number.isFinite(lat) || !Number.isFinite(lon) ||
      lat < 17 || lat > 72 || lon < -180 || lon > -64) return { error: "invalid lat/lon" };
  const contact = elevContact(b.contact || {}); if (contact.error) return contact;
  const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
  if (email && (!EMAIL_RE.test(email) || email.length > 254)) return { error: "invalid email" };
  const hours = elevHours(b.hours || {}); if (hours.error) return hours;
  const now = new Date().toISOString();
  return { rec: { id, name: name.v, town: town.v, state, zip, lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(lon * 1e5) / 1e5,
    active: true, contact: contact.v, email, hours: hours.v, closed_until: null, note: null, bids: [],
    bids_updated_at: null, info_updated_at: now, created_at: now } };
}

// v5.13 (M4): THE SPONSOR APPROVAL BOX. The proof code and the portal link's
// r= are both readable in the public repo, so neither proves who is asking.
// Sig's portal link now also carries k = hmac16("sponsor-portal|" + r) under
// UNSUB_SECRET (sponsor-report.html?r=<slug>-<token>&k=<16 hex>), and the page
// posts r and k with every request. An Approval without a k that matches its
// r is refused (400), so the page falls back to its written-out email, which
// comes from the sponsor's own address. Every other request is still taken,
// marked verified yes/no. The Subject is built here, never taken from the post.
const SPONSOR_R_RE = /^[a-z0-9][a-z0-9-]{1,79}$/;
async function sponsorKey(env, r) {
  return hmac16("sponsor-portal|" + r, env.UNSUB_SECRET);
}
async function sponsorFeedback(env, b, rec) {
  const r = String(b.r == null ? "" : b.r).trim().toLowerCase();
  const k = String(b.k == null ? "" : b.k).trim().toLowerCase();
  const verified = !!env.UNSUB_SECRET && SPONSOR_R_RE.test(r) && /^[0-9a-f]{16}$/.test(k) && safeEq(k, await sponsorKey(env, r));
  const approval = /^approv/i.test(rec.request || "");
  if (approval && !verified) return { error: "this approval needs the link Sig sent you" };
  if (SPONSOR_R_RE.test(r)) rec.r = r;
  rec.verified = verified ? "yes" : "no";
  const who = oneLine(rec.sponsor || rec.r || "unknown sponsor", 80);
  rec.subject = approval
    ? "Approved: " + who + " ad, proof " + oneLine(rec.proof || "-", 40) + " (verified link " + r + ")"
    : (verified ? "" : "[unverified link] ") + "AGSIST portal: " + oneLine(rec.request, 60) + " (" + who + ")";
  return {};
}

async function noticeCounts(env) {
  const keys = await listKeys(env, "note:"), by = {};
  for (const k of keys) {
    let r = null;
    try { r = JSON.parse(await env.SUBS.get(k)); } catch (e) { r = null; }
    for (const t of Object.keys((r && r.t) || {})) by[t] = (by[t] || 0) + 1;
  }
  return { notice: keys.length, notices: by };
}

async function formCounts(env) {
  const out = {};
  for (const kind of Object.keys(FORM_KINDS)) out[kind] = (await listKeys(env, "form:" + kind + ":")).length;
  return out;
}

// ---------- v5.36: Rain Print order records ----------
// rpo:<ts>:<rand> = one press of Pay on /rain-print (POST /rp-order), kept
// RPO_TTL_S. rpo-serial = {last}: the last print serial handed out (no expiry).
const RPO_TTL_S = 120 * 24 * 3600;
const RPO_MAX_BYTES = 4 * 1024;
const RPO_KEY_RE = /^rpo:\d{10,16}:[0-9a-f]{8}$/;
const RPO_PRINTS = ["print12x18", "framed12x18"];
const RPO_URL_RE = /^https:\/\/agsist\.com\/rain-print\?[A-Za-z0-9%+._~=&-]+$/;
// The ref Stripe gets (components/rain-print.js checkoutRef): a design code,
// GIFT-<code>, RPS-<short id> or GIFT-RPS-<short id>, 200 characters at most.
function rpoRefOk(ref) {
  if (typeof ref !== "string" || !ref || ref.length > 200) return false;
  if (/^(GIFT-)?RPS-[0-9A-HJKMNP-TV-Z]{5,8}$/.test(ref)) return true;
  return rpsCodeOk(ref.replace(/^GIFT-/, ""));
}
function rpoClean(b) {
  if (!rpoRefOk(b.ref)) return { error: "invalid ref" };
  if (!RP_CHOICES.includes(b.product)) return { error: "invalid product" };
  const url = String(b.design_url == null ? "" : b.design_url);
  if (url.length > 2000 || !RPO_URL_RE.test(url)) return { error: "invalid design_url" };
  const price = typeof b.price === "number" && Number.isFinite(b.price) && b.price >= 0 && b.price <= 10000 ? Math.round(b.price * 100) / 100 : null;
  const year = Number.isInteger(b.year) && b.year >= 1850 && b.year <= 2100 ? b.year : null;
  // the design in words only; anything else the body carries is dropped
  return { rec: {
    ref: b.ref, product: b.product, price, design_url: url,
    place: oneLine(b.place, 80), year, style: b.style === "r1" || b.style === "r2" ? b.style : "",
    name: oneLine(b.name, 60), markers: oneLine(b.markers, 400), dedication: oneLine(b.dedication, 160), gift: b.gift === true,
  } };
}
// Completed Checkout Sessions since sinceSec, from Stripe with a read-only key.
// Only the id, client_reference_id, payment status, amounts and time are kept:
// never customer_details or anything else about the buyer.
async function rpoSessions(env, sinceSec) {
  const out = [];
  let after = "";
  for (let i = 0; i < 10; i++) {
    const q = new URLSearchParams({ limit: "100", status: "complete", "created[gte]": String(sinceSec) });
    if (after) q.set("starting_after", after);
    const r = await fetch("https://api.stripe.com/v1/checkout/sessions?" + q, { headers: { Authorization: "Bearer " + env.STRIPE_READ_KEY } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const d = await r.json();
    const got = Array.isArray(d && d.data) ? d.data.filter(x => x && typeof x === "object") : [];
    for (const x of got) out.push({ id: String(x.id || ""), ref: typeof x.client_reference_id === "string" ? x.client_reference_id : "",
      paid: x.payment_status === "paid", total: Number(x.amount_total) || 0, sub: Number(x.amount_subtotal) || Number(x.amount_total) || 0,
      created: Number(x.created) || 0 });
    if (!d.has_more || !got.length) break;
    after = String(got[got.length - 1].id || "");
  }
  return out;
}
// The press a paid session belongs to: the latest unpaid press of the same ref
// made before the session (two minutes' slack), the same product's price first.
function rpoMatch(recs, s) {
  const c = recs.filter(r => !r.paid && r.ref === s.ref && (r.ts || 0) <= s.created * 1000 + 120e3);
  if (!c.length) return null;
  const same = c.filter(r => typeof r.price === "number" && Math.round(r.price * 100) === s.sub);
  return (same.length ? same : c).sort((a, b) => (b.ts || 0) - (a.ts || 0))[0];
}
function rpoPaid(s, via) {
  return { amount: s.total / 100, subtotal: s.sub / 100, at: new Date(s.created * 1000).toISOString(), session: s.id, via };
}
async function rpoPut(env, k, r) {
  const exp = Math.max(Math.floor(Date.now() / 1000) + 120, Math.floor((r.ts || Date.now()) / 1000) + RPO_TTL_S);
  await env.SUBS.put(k, JSON.stringify(r), { expiration: exp });
}
// No counter stored yet: last = 1. No. 0001 is already Sig's wife's print (Sig, Oct 17), so the first paid print is No. 0002.
const RPO_SERIAL_START_LAST = 1;
async function rpoSerialLast(env) {
  try { const v = JSON.parse(await env.SUBS.get("rpo-serial")); return v && Number.isInteger(v.last) && v.last >= 0 ? v.last : RPO_SERIAL_START_LAST; }
  catch (e) { return RPO_SERIAL_START_LAST; }
}
// v5.37: the proof email's Approve link carries k (the record key) and t, an HMAC
// of the key with UNSUB_SECRET under its own label. Nothing about the buyer.
function rpoApproveToken(env, k) { return hmac16("rp-approve|" + k, env.UNSUB_SECRET); }
// Business days (Mon to Fri) from an ISO time to now; holidays are not counted out here.
function rpoBizDaysSince(iso, nowMs) {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return 0;
  let n = 0;
  for (let d = new Date(t); ; ) {
    d = new Date(d.getTime() + 86400e3);
    if (d.getTime() > nowMs) break;
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) n++;
  }
  return n;
}
const RPO_APPROVE_WAIT_BIZ = 3;
function rpoFulfill(r, serial) {
  if (!r.design_url) return "";
  return r.design_url + "&maker=1" + (RPO_PRINTS.includes(r.product) && serial ? "&serial=" + serial : "");
}
// The records of the last `days` days, newest first, each paid or pay pressed.
// A session is matched to the latest unpaid press of the same ref made before
// it (the same product's price first). The match and a print's serial are
// written into the record, so they stay once the session is past the window.
async function rpoList(env, days) {
  const now = Date.now(), since = now - days * 86400e3;
  const recs = [];
  for (const k of await listKeys(env, "rpo:")) {
    if (!RPO_KEY_RE.test(k)) continue;
    let r = null;
    try { r = JSON.parse(await env.SUBS.get(k)); } catch (e) { r = null; }
    if (r && typeof r === "object" && (r.ts || 0) >= since) { r.key = k; recs.push(r); }
  }
  recs.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  let stripe = "no key", sessions = null;
  if (typeof env.STRIPE_READ_KEY === "string" && env.STRIPE_READ_KEY) {
    try {
      const oldest = recs.length ? recs[0].ts : now;
      sessions = await rpoSessions(env, Math.floor(oldest / 1000) - 60);
      stripe = "ok";
    } catch (e) { stripe = "could not be read (" + (e && e.message || "error") + ")"; sessions = null; }
  }
  const changed = new Set();
  if (sessions) {
    const used = new Set(recs.filter(r => r.paid && r.paid.session).map(r => r.paid.session));
    for (const s of sessions.filter(x => x.paid && x.ref && !used.has(x.id)).sort((a, b) => a.created - b.created)) {
      const hit = rpoMatch(recs, s);
      if (!hit) continue;
      hit.paid = rpoPaid(s, "poll");
      changed.add(hit);
    }
  }
  let last = await rpoSerialLast(env);
  const lastBefore = last;
  for (const r of recs) {
    if (r.paid && RPO_PRINTS.includes(r.product) && !r.serial) { r.serial = ++last; changed.add(r); }
  }
  if (last !== lastBefore) await env.SUBS.put("rpo-serial", JSON.stringify({ last }));
  for (const r of changed) { const k = r.key; delete r.key; await rpoPut(env, k, r); r.key = k; }
  // Without Stripe, a print's suggested serial: the next free ones, in the order pressed.
  let next = last;
  const toks = {};
  for (const r of recs) if (r.paid) toks[r.key] = await rpoApproveToken(env, r.key);
  const out = recs.map(r => {
    const serialNext = !r.serial && !sessions && RPO_PRINTS.includes(r.product) ? ++next : null;
    return {
      key: r.key, ts: r.ts, at: new Date(r.ts).toISOString(), ref: r.ref, product: r.product, price: r.price,
      design_url: r.design_url, place: r.place, year: r.year, style: r.style, name: r.name, markers: r.markers,
      dedication: r.dedication, gift: !!r.gift, status: r.paid ? "paid" : "pay pressed", paid: r.paid || null, mailed: r.mailed || null, alerted: r.alerted || null, no_press: !!r.no_press,
      approved: r.approved || null, approved_alerted: r.approved_alerted || null, approve_t: toks[r.key] || null,
      delivered: r.delivered || null,   // v5.38: the digital files went out (rp_buyer_email.py)
      // v5.40: the gift card issued for this order (never the code here) and the buyer's card email
      gift_card: r.gift_card ? { no: r.gift_card.no, last4: r.gift_card.last4, at: r.gift_card.at } : null, gift_mailed: r.gift_mailed || null,
      // the proof went out 3 business days ago and no answer: Sig's Today page flags it (never approved for the buyer)
      approval_overdue: !!(r.paid && r.mailed && !r.approved && rpoBizDaysSince(r.mailed.at, now) >= RPO_APPROVE_WAIT_BIZ),
      serial: r.serial || null, serial_next: serialNext, fulfill_url: rpoFulfill(r, r.serial || serialNext),
    };
  }).reverse();
  return { stripe, serial_last: last, orders: out };
}

// ---------- v5.36: the Stripe webhook (Sig: "alerts whenever an order is placed") ----------
// POST /rp-order/stripe, from Stripe only: the Stripe-Signature header is
// checked against STRIPE_WEBHOOK_SECRET (HMAC SHA-256 of "<t>.<body>", any v1,
// t within RPO_WH_TOLERANCE_S of now). A paid checkout.session.completed or a
// checkout.session.async_payment_succeeded marks its press paid (rpoMatch, as
// the poll does), hands a print its serial, and starts the email job once.
// Idempotent by session id (rpo-ev:<session>). Nothing about the buyer is
// stored: the event's customer_details is never read.
const RPO_WH_TOLERANCE_S = 300;
const RPO_WH_MAX_BYTES = 64 * 1024;
const RPO_PRODUCT_BY_CENTS = { 1900: "digital", 4500: "print12x18", 8900: "framed12x18" };
async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
}
// -> "" when the header is good, else why not
async function stripeSigProblem(header, raw, secret, nowS) {
  const parts = String(header || "").split(",").map(x => x.trim().split("="));
  const t = Number((parts.find(p => p[0] === "t") || [])[1]);
  const v1 = parts.filter(p => p[0] === "v1" && p[1]).map(p => p[1]);
  if (!Number.isInteger(t) || !v1.length) return "no signature";
  if (Math.abs(nowS - t) > RPO_WH_TOLERANCE_S) return "stale";
  const want = await hmacHex(secret, t + "." + raw);
  return v1.some(v => safeEq(v, want)) ? "" : "bad signature";
}
async function rpoWebhookSession(env, x) {
  const s = { id: String(x.id || ""), ref: typeof x.client_reference_id === "string" ? x.client_reference_id : "",
    total: Number(x.amount_total) || 0, sub: Number(x.amount_subtotal) || Number(x.amount_total) || 0, created: Number(x.created) || Math.floor(Date.now() / 1000) };
  if (!/^cs_[A-Za-z0-9_]{1,250}$/.test(s.id)) return { error: "no session" };
  const evKey = "rpo-ev:" + s.id;
  if (await env.SUBS.get(evKey) !== null) return { already: true };
  const recs = [];
  for (const k of await listKeys(env, "rpo:")) {
    if (!RPO_KEY_RE.test(k)) continue;
    let r = null;
    try { r = JSON.parse(await env.SUBS.get(k)); } catch (e) { r = null; }
    if (r && typeof r === "object") { r.key = k; recs.push(r); }
  }
  if (recs.some(r => r.paid && r.paid.session === s.id)) { await env.SUBS.put(evKey, "1", { expirationTtl: RPO_TTL_S }); return { already: true }; }
  let hit = rpoMatch(recs, s);
  if (!hit) {
    // paid with no press on record (a bare payment link, or the press post was lost): kept so Sig still sees it
    const ts = s.created * 1000;
    const rnd = [...crypto.getRandomValues(new Uint8Array(4))].map(v => v.toString(16).padStart(2, "0")).join("");
    const okRef = rpoRefOk(s.ref);
    hit = { key: "rpo:" + ts + ":" + rnd, ts, ref: okRef ? s.ref : "", product: RPO_PRODUCT_BY_CENTS[s.sub] || "", price: s.sub / 100,
      design_url: okRef ? "https://agsist.com/rain-print?d=" + s.ref : "", place: "", year: null, style: "", name: "", markers: "",
      dedication: "", gift: /^GIFT-/.test(s.ref), no_press: true };
  }
  hit.paid = rpoPaid(s, "webhook");
  if (RPO_PRINTS.includes(hit.product) && !hit.serial) {
    hit.serial = (await rpoSerialLast(env)) + 1;
    await env.SUBS.put("rpo-serial", JSON.stringify({ last: hit.serial }));
  }
  const k = hit.key; delete hit.key;
  await rpoPut(env, k, hit);
  await env.SUBS.put(evKey, "1", { expirationTtl: RPO_TTL_S });
  return { key: k };
}
// Starts .github/workflows/rp-buyer-email.yml (Sig's alert and the buyer email) at once.
// Needs GH_DISPATCH_TOKEN (a fine-grained token on dnilgis/agsist, Actions read and write);
// without it the job waits for its next run. RP_BUYER_EMAIL_LIVE = "1" lets buyer emails go
// to buyers; anything else is a dry run (every email to Sig only).
async function rpoDispatch(env) {
  if (typeof env.GH_DISPATCH_TOKEN !== "string" || !env.GH_DISPATCH_TOKEN) return "no token";
  try {
    const r = await fetch("https://api.github.com/repos/dnilgis/agsist/actions/workflows/rp-buyer-email.yml/dispatches", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.GH_DISPATCH_TOKEN, Accept: "application/vnd.github+json", "User-Agent": "agsist-subs", "Content-Type": "application/json" },
      body: JSON.stringify({ ref: "main", inputs: { dry_run: env.RP_BUYER_EMAIL_LIVE === "1" ? "false" : "true" } }),
    });
    return r.status === 204 ? "started" : "HTTP " + r.status;
  } catch (e) { return "failed"; }
}

export default {
  // v5.13: one place that turns a missing UNSUB_SECRET into a clear refusal.
  async fetch(req, env) {
    try {
      return await handle(req, env);
    } catch (e) {
      if (!(e instanceof NoSecretError)) throw e;
      console.error("agsist-subs: " + e.message);
      // The link pages (confirm, unsubscribe, sponsor) answer in HTML; the page
      // POSTs and the token routes in JSON.
      const u = new URL(req.url);
      if (!PUBLIC_POSTS.has(u.pathname) && !u.searchParams.has("token") && !req.headers.get("Authorization"))
        return new Response("<!doctype html><meta charset=utf-8><title>AGSIST</title><h2>This page is not working right now. Try again later.</h2>",
          { status: 503, headers: Object.assign({ "Content-Type": "text/html;charset=utf-8" }, PAGE_HEADERS) });
      return json({ ok: false, error: "temporarily unavailable" }, 503, cors(req));
    }
  },
};

// ---------- v5.30: THE HAY BOARD (agsist.com/haymow) ----------
// Readers post hay and forage for sale or wanted; buyers and sellers call each
// other. AGSIST takes no cut, routes nothing and ranks nothing by payment.
// hay:<id> = the post (contact inside), stored with a KV expiration at exp.
// The private key is never stored, only kh = hmac16("hay|" + key).
const HAY_TTL_S = 30 * 86400;
const HAY_RENEW_MAX_S = 60 * 86400;      // a renew adds 30 days, up to 60 days ahead
const HAY_MAX_BYTES = 4096;
const HAY_NOTE_MAX = 300;
const HAY_REPORTS_HIDE = 3;
const HAY_B32 = "0123456789abcdefghjkmnpqrstvwxyz";   // Crockford, lowercase
const HAY_ID_RE = /^[0-9a-hjkmnp-tv-z]{10}$/;
const HAY_KEY_RE = /^[0-9a-hjkmnp-tv-z]{24}$/;
const HAY_KINDS = ["sale", "wanted"];
const HAY_PRODUCTS = ["alfalfa", "grass", "mixed", "straw", "corn-stalks", "baleage", "other"];
const HAY_BALES = ["small-square", "large-square", "round", "wrapped", "bulk"];
const HAY_CUTTINGS = ["", "1", "2", "3", "4"];
const HAY_UNITS = ["bale", "ton"];
const HAY_WHY = ["sold", "spam", "wrong", "scam", "other"];
const HAY_PUBLIC = ["id", "kind", "zip", "place", "lat", "lng", "product", "cutting", "bale", "count", "price", "unit",
  "weight", "rfv", "rfq", "cp", "delivery", "note", "name", "ts", "updated", "exp"];
const HAY_ZIPS = "https://dnilgis.github.io/bids/data/zips/";
// A link of any kind: a scheme, www., or a word.tld.
const HAY_LINK_RE = /(https?:|ftp:|www\.|\b[a-z0-9-]+\s?\.\s?(com|net|org|biz|info|io|co|us|xyz|ly|me|site|online|shop|app|link|top)\b)/i;
const HAY_EMAIL_IN_TEXT = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
const HAY_PHONE_IN_TEXT = /(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;
let HAY_MEMO = null;                       // {at, rows}: the public list for 60 s on this isolate

function hayNew(n) {
  return [...crypto.getRandomValues(new Uint8Array(n))].map(b => HAY_B32[b & 31]).join("");
}
async function hayKh(env, key) { return hmac16("hay|" + key, env.UNSUB_SECRET); }
// Visitor text: tags and angle brackets out, one line, then the length check.
function hayText(v, max, field) {
  if (v == null || v === "") return { v: "" };
  if (typeof v !== "string") return { error: "invalid " + field };
  const s = oneLine(v.replace(/<[^>]*>/g, " ").replace(/[<>]/g, " "), max + 1);
  if (s.length > max) return { error: field + " too long (" + max + " at most)" };
  if (HAY_LINK_RE.test(s)) return { error: "no links in the " + field + ", please" };
  return { v: s };
}
function hayNum(v, lo, hi, field, dec) {
  if (v == null || v === "") return { v: null };
  const x = typeof v === "number" ? v : (typeof v === "string" ? Number(v.replace(/[$,\s]/g, "")) : NaN);
  if (!Number.isFinite(x) || x < lo || x > hi) return { error: "invalid " + field };
  const f = Math.pow(10, dec || 0);
  return { v: Math.round(x * f) / f };
}
function hayEnum(v, list, field, need) {
  const s = v == null ? "" : String(v).trim().toLowerCase();
  if (!s && !need) return { v: "" };
  if (!list.includes(s)) return { error: (s ? "invalid " : "missing ") + field };
  return { v: s };
}
// Text that is posted but held for Sig: repeated letters or words, or shouting.
function hayHeld(s) {
  if (!s) return "";
  if (/(.)\1{7,}/.test(s)) return "repeated text";
  const w = s.toLowerCase().match(/[a-z]+/g) || [];
  const seen = {};
  for (const x of w) if (x.length > 2 && (seen[x] = (seen[x] || 0) + 1) >= 5) return "repeated text";
  const letters = s.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 12 && letters.replace(/[^A-Z]/g, "").length / letters.length > 0.8) return "all caps";
  return "";
}
function hayDist(aLat, aLng, bLat, bLng) {
  const r = Math.PI / 180, dLat = (bLat - aLat) * r, dLng = (bLng - aLng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}
async function hayZipLL(zip) {
  try {
    const r = await fetch(HAY_ZIPS + zip.slice(0, 2) + ".json", { cf: { cacheTtl: 86400 } });
    if (r.ok) {
      const t = await r.json(), p = t && t[zip];
      if (Array.isArray(p) && Number.isFinite(+p[0]) && Number.isFinite(+p[1]) && !(+p[0] === 0 && +p[1] === 0)) return { lat: +p[0], lng: +p[1] };
    }
  } catch (e) { /* fall through */ }
  try {
    const r = await fetch("https://geocoding-api.open-meteo.com/v1/search?name=" + zip + "&count=1&language=en&format=json&countryCode=US");
    if (r.ok) {
      const d = await r.json(), x = d && d.results && d.results[0];
      if (x && Number.isFinite(+x.latitude) && Number.isFinite(+x.longitude)) return { lat: +x.latitude, lng: +x.longitude };
    }
  } catch (e) { /* none */ }
  return null;
}
// Every field a post can carry, checked. `old` is the stored post on an edit:
// a field left out keeps its value. -> {rec} or {error}
function hayClean(b, old) {
  const o = old || {};
  const pick = (k) => (Object.prototype.hasOwnProperty.call(b, k) ? b[k] : o[k]);
  const out = {};
  let t;
  t = hayEnum(pick("kind"), HAY_KINDS, "kind (sale or wanted)", true); if (t.error) return t; out.kind = t.v;
  const zip = String(pick("zip") == null ? "" : pick("zip")).trim();
  if (!/^\d{5}$/.test(zip)) return { error: "a 5-digit ZIP is needed" };
  out.zip = zip;
  t = hayEnum(pick("product"), HAY_PRODUCTS, "product", true); if (t.error) return t; out.product = t.v;
  const cut = String(pick("cutting") == null ? "" : pick("cutting")).trim().replace(/(st|nd|rd|th)$/i, "");
  t = hayEnum(cut, HAY_CUTTINGS, "cutting", false); if (t.error) return t; out.cutting = t.v;
  t = hayEnum(pick("bale"), HAY_BALES, "bale type", out.kind === "sale"); if (t.error) return t; out.bale = t.v;
  t = hayNum(pick("count"), 1, 100000, "count", 0); if (t.error) return t; out.count = t.v;
  if (out.kind === "sale" && out.count == null) return { error: "how many bales (or tons) is missing" };
  t = hayNum(pick("price"), 0.01, 5000, "price", 2); if (t.error) return t; out.price = t.v;
  t = hayEnum(pick("unit"), HAY_UNITS, "price unit (per bale or per ton)", out.price != null); if (t.error) return t; out.unit = out.price != null ? t.v : "";
  t = hayNum(pick("weight"), 20, 3000, "bale weight", 0); if (t.error) return t; out.weight = t.v;
  t = hayNum(pick("rfv"), 1, 400, "RFV", 0); if (t.error) return t; out.rfv = t.v;
  t = hayNum(pick("rfq"), 1, 400, "RFQ", 0); if (t.error) return t; out.rfq = t.v;
  t = hayNum(pick("cp"), 0.1, 40, "crude protein", 1); if (t.error) return t; out.cp = t.v;
  const dv = pick("delivery");
  if (dv == null || dv === "" || dv === "no" || dv === false) out.delivery = "no";
  else if (dv === "yes" || dv === true) out.delivery = "yes";
  else { t = hayNum(dv, 1, 1000, "delivery miles", 0); if (t.error || t.v == null) return { error: "invalid delivery" }; out.delivery = t.v; }
  t = hayText(pick("note"), HAY_NOTE_MAX, "note"); if (t.error) return t; out.note = t.v;
  if (HAY_EMAIL_IN_TEXT.test(out.note) || HAY_PHONE_IN_TEXT.test(out.note)) return { error: "put your phone or email in the contact boxes, not the note" };
  t = hayText(pick("name"), 60, "name"); if (t.error) return t; out.name = t.v;
  if (HAY_EMAIL_IN_TEXT.test(out.name) || HAY_PHONE_IN_TEXT.test(out.name)) return { error: "put your phone or email in the contact boxes, not the name" };
  const place = String(pick("place") == null ? "" : pick("place")).trim();
  out.place = /^[A-Za-z][A-Za-z .'-]{0,50}, [A-Z]{2}$/.test(place) ? place : "";
  const ph = pick("phone") == null ? "" : String(pick("phone")).trim();
  if (ph && (ph.length > 30 || !/^[0-9()+\-. ]+$/.test(ph) || ph.replace(/\D/g, "").length < 10)) return { error: "invalid phone" };
  out.phone = ph;
  const em = pick("email") == null ? "" : String(pick("email")).trim().toLowerCase();
  if (em && (em.length > 254 || !EMAIL_RE.test(em))) return { error: "invalid email" };
  out.email = em;
  if (!out.phone && !out.email) return { error: "a phone or an email is needed, so people can reach you" };
  const lat = pick("lat"), lng = pick("lng");
  if (lat != null && lat !== "" && lng != null && lng !== "") {
    const a = Number(lat), g = Number(lng);
    if (!Number.isFinite(a) || !Number.isFinite(g) || a < 17 || a > 72 || g < -180 || g > -64) return { error: "invalid lat/lng" };
    out.lat = Math.round(a * 100) / 100; out.lng = Math.round(g * 100) / 100;
  } else { out.lat = null; out.lng = null; }
  return { rec: out };
}
function hayPublic(r) {
  const out = {};
  for (const k of HAY_PUBLIC) out[k] = r[k] === undefined ? null : r[k];
  out.has_phone = !!r.phone; out.has_email = !!r.email;
  return out;
}
function hayLive(r, now) { return !!r && r.status === "live" && (r.exp || 0) > now; }
async function hayGet(env, id) {
  if (!HAY_ID_RE.test(String(id || ""))) return null;
  try { const r = JSON.parse(await env.SUBS.get("hay:" + id)); return r && typeof r === "object" ? r : null; } catch (e) { return null; }
}
async function hayPut(env, r) {
  HAY_MEMO = null;
  await env.SUBS.put("hay:" + r.id, JSON.stringify(r), { expiration: Math.max(Math.floor(Date.now() / 1000) + 120, Math.floor(r.exp / 1000)) });
}
async function hayAll(env) {
  const out = [];
  for (const k of await listKeys(env, "hay:")) {
    const r = await hayGet(env, k.slice(4));
    if (r) out.push(r);
  }
  return out;
}
async function hayBody(req) {
  if (Number(req.headers.get("Content-Length") || 0) > HAY_MAX_BYTES) return { error: "too large", status: 413 };
  let raw = "";
  try { raw = await req.text(); } catch (e) { raw = ""; }
  if (raw.length > HAY_MAX_BYTES) return { error: "too large", status: 413 };
  let b = null;
  try { b = JSON.parse(raw); } catch (e) { b = null; }
  if (!b || typeof b !== "object" || Array.isArray(b)) return { error: "bad json", status: 400 };
  return { b };
}
async function hayOwned(env, b) {
  const id = typeof b.id === "string" ? b.id.trim().toLowerCase() : "";
  const key = typeof b.key === "string" ? b.key.trim().toLowerCase() : "";
  const r = HAY_ID_RE.test(id) && HAY_KEY_RE.test(key) ? await hayGet(env, id) : null;
  if (!r || !safeEq(await hayKh(env, key), r.kh)) return { error: "this link is not right, or the post has expired", status: 404 };
  return { r };
}
const HAY_RATE = {
  "/hay/post": [3, 10, 300], "/hay/edit": [20, 60, 1000], "/hay/delete": [20, 60, 1000], "/hay/renew": [20, 60, 1000],
  "/hay/mine": [30, 100, 2000], "/hay/contact": [20, 60, 3000], "/hay/report": [5, 20, 500],
};
Object.assign(RATE, HAY_RATE);
for (const p of Object.keys(HAY_RATE)) PUBLIC_POSTS.add(p);

async function hayRoute(req, env, url, path) {
  const c = Object.assign({ "Cache-Control": "no-store" }, cors(req));
  const now = Date.now();

  if (path === "/hay/feed" && req.method === "GET") {
    if (!HAY_MEMO || now - HAY_MEMO.at > 60e3) HAY_MEMO = { at: now, rows: (await hayAll(env)).filter(r => hayLive(r, now)).map(hayPublic) };
    let rows = HAY_MEMO.rows.filter(r => r.exp > now);
    const kind = url.searchParams.get("kind");
    if (kind && HAY_KINDS.includes(kind)) rows = rows.filter(r => r.kind === kind);
    const lat = Number(url.searchParams.get("lat")), lng = Number(url.searchParams.get("lng"));
    const mi = Number(url.searchParams.get("mi"));
    if (url.searchParams.has("lat") && url.searchParams.has("lng") && Number.isFinite(lat) && Number.isFinite(lng)) {
      rows = rows.map(r => Object.assign({}, r, { mi: r.lat == null ? null : Math.round(hayDist(lat, lng, r.lat, r.lng)) }));
      if (Number.isFinite(mi) && mi > 0) rows = rows.filter(r => r.mi != null && r.mi <= mi);
      rows.sort((a, b) => (a.mi == null) - (b.mi == null) || a.mi - b.mi || b.ts - a.ts);
    } else rows = rows.slice().sort((a, b) => b.ts - a.ts);
    return json({ ok: true, generated_at: new Date(now).toISOString(), listings: rows }, 200,
      Object.assign({ "Cache-Control": "public, max-age=60" }, cors(req)));
  }

  // Sig only: Bearer LIST_TOKEN, never ?token=.
  if (path.startsWith("/hay/admin/")) {
    const bearer = /^Bearer\s+(\S+)\s*$/i.exec(req.headers.get("Authorization") || "");
    if (!bearer || !env.LIST_TOKEN || !safeEq(bearer[1], env.LIST_TOKEN)) return json({ ok: false }, 403, c);
    if (path === "/hay/admin/list" && req.method === "GET") {
      const onlyNew = url.searchParams.get("new") === "1";
      let rows = (await hayAll(env)).map(r => { const o = Object.assign({}, r); delete o.kh; o.reports = (r.reports || []).map(x => ({ why: x.why, ts: x.ts })); return o; });
      if (onlyNew) rows = rows.filter(r => !r.n || (r.status !== "live" && !r.hn));
      rows.sort((a, b) => a.ts - b.ts);
      return json({ ok: true, posts: rows }, 200, c);
    }
    if (req.method !== "POST") return json({ ok: false, error: "not found" }, 404, c);
    let b = {};
    try { b = await req.json(); } catch (e) { return json({ ok: false, error: "bad json" }, 400, c); }
    if (path === "/hay/admin/mark") {
      let marked = 0;
      for (const id of Array.isArray(b.ids) ? b.ids.slice(0, 500) : []) {
        const r = await hayGet(env, id);
        if (!r) continue;
        r.n = 1;
        if (r.status !== "live") r.hn = 1;
        await hayPut(env, r); marked++;
      }
      return json({ ok: true, marked }, 200, c);
    }
    const r = await hayGet(env, b.id);
    if (!r) return json({ ok: false, error: "no such post" }, 404, c);
    if (path === "/hay/admin/hide") { r.status = "hidden"; r.why_hidden = "sig"; r.hn = 1; await hayPut(env, r); return json({ ok: true, id: r.id, status: r.status }, 200, c); }
    if (path === "/hay/admin/clear") { r.status = "live"; r.reports = []; r.why_hidden = ""; r.hn = 1; await hayPut(env, r); return json({ ok: true, id: r.id, status: r.status }, 200, c); }
    return json({ ok: false, error: "not found" }, 404, c);
  }

  if (req.method !== "POST" || !Object.prototype.hasOwnProperty.call(HAY_RATE, path)) return json({ ok: false, error: "not found" }, 404, c);
  // publicGate (Origin, JSON) has already run: every route here is in PUBLIC_POSTS.
  const p = await hayBody(req);
  if (p.error) return json({ ok: false, error: p.error }, p.status, c);
  const b = p.b;
  if (b._gotcha) return json({ ok: true }, 200, c);
  const slow = await rateLimit(req, env, path);
  if (slow) return slow;

  if (path === "/hay/post") {
    const v = hayClean(b, null);
    if (v.error) return json({ ok: false, error: v.error }, 400, c);
    const rec = v.rec;
    if (rec.lat == null) {
      const ll = await hayZipLL(rec.zip);
      if (!ll) return json({ ok: false, error: "could not find ZIP " + rec.zip + "; check it" }, 400, c);
      rec.lat = Math.round(ll.lat * 100) / 100; rec.lng = Math.round(ll.lng * 100) / 100;
    }
    const id = hayNew(10), key = hayNew(24);
    const held = hayHeld(rec.note) || hayHeld(rec.name);
    Object.assign(rec, { id, kh: await hayKh(env, key), ts: now, updated: now, exp: now + HAY_TTL_S * 1000,
      status: held ? "held" : "live", why_hidden: held, reports: [], n: 0 });
    await hayPut(env, rec);
    return json({ ok: true, id, key, status: rec.status, exp: rec.exp }, 200, c);
  }

  if (path === "/hay/report") {
    const r = await hayGet(env, typeof b.id === "string" ? b.id.trim().toLowerCase() : "");
    if (!r || (r.exp || 0) <= now) return json({ ok: false, error: "no such post" }, 404, c);
    const why = HAY_WHY.includes(String(b.why || "")) ? String(b.why) : "other";
    const ip = req.headers.get("CF-Connecting-IP") || "";
    const who = ip ? await hmac16("hay-report|" + ipBucket(ip), env.UNSUB_SECRET) : "";
    r.reports = Array.isArray(r.reports) ? r.reports : [];
    if (who && !r.reports.some(x => x.who === who) && r.reports.length < 50) {
      r.reports.push({ who, why, ts: now });
      if (r.status === "live" && r.reports.length >= HAY_REPORTS_HIDE) { r.status = "hidden"; r.why_hidden = "reports"; r.hn = 0; }
      await hayPut(env, r);
    }
    return json({ ok: true }, 200, c);
  }

  if (path === "/hay/contact") {
    const r = await hayGet(env, typeof b.id === "string" ? b.id.trim().toLowerCase() : "");
    if (!hayLive(r, now)) return json({ ok: false, error: "this post is gone" }, 404, c);
    return json({ ok: true, id: r.id, name: r.name || "", phone: r.phone || "", email: r.email || "" }, 200, c);
  }

  // The poster's own routes: the id and the private key.
  const owner = await hayOwned(env, b);
  if (owner.error) return json({ ok: false, error: owner.error }, owner.status, c);
  const r = owner.r;
  const mine = () => Object.assign(hayPublic(r), { phone: r.phone, email: r.email, status: r.status });
  if (path === "/hay/mine") return json({ ok: true, post: mine() }, 200, c);
  if (path === "/hay/delete") { HAY_MEMO = null; await env.SUBS.delete("hay:" + r.id); return json({ ok: true, deleted: r.id }, 200, c); }
  if (path === "/hay/renew") {
    r.exp = Math.min(Math.max(r.exp, now) + HAY_TTL_S * 1000, now + HAY_RENEW_MAX_S * 1000);
    await hayPut(env, r);
    return json({ ok: true, post: mine() }, 200, c);
  }
  // /hay/edit: every field checked again before anything is stored.
  const v = hayClean(b, r);
  if (v.error) return json({ ok: false, error: v.error }, 400, c);
  if (v.rec.zip !== r.zip && !(Object.prototype.hasOwnProperty.call(b, "lat") && b.lat != null && b.lat !== "")) {
    const ll = await hayZipLL(v.rec.zip);
    if (!ll) return json({ ok: false, error: "could not find ZIP " + v.rec.zip + "; check it" }, 400, c);
    v.rec.lat = Math.round(ll.lat * 100) / 100; v.rec.lng = Math.round(ll.lng * 100) / 100;
  }
  Object.assign(r, v.rec, { updated: now });
  if (r.status === "live" || r.status === "held") {
    const held = hayHeld(r.note) || hayHeld(r.name);
    if (held && r.status === "live") { r.status = "held"; r.why_hidden = held; r.hn = 0; }
    else if (!held && r.status === "held" && r.why_hidden !== "sig") { r.status = "live"; r.why_hidden = ""; }
  }
  await hayPut(env, r);
  return json({ ok: true, post: mine() }, 200, c);
}

async function handle(req, env) {
  {
    const url = new URL(req.url);
    const path = url.pathname;

    // CORS preflight: browsers send OPTIONS before any JSON POST. Without
    // this, every signup form on the site fails before the POST even fires.
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: Object.assign({
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization",
          "Access-Control-Max-Age": "86400",
        }, cors(req)),
      });
    }

    // v5.19: the reader's own town, from Cloudflare's request data. Nothing kept.
    if (path === "/where" && req.method === "GET") {
      const cf = req.cf || {}, h = Object.assign({ "Cache-Control": "private, no-store" }, cors(req));
      const lat = Number(cf.latitude), lon = Number(cf.longitude);
      if (cf.country !== "US" || !cf.city || !Number.isFinite(lat) || !Number.isFinite(lon)) return json({ ok: false }, 200, h);
      return json({ ok: true, city: String(cf.city).slice(0, 60), region: String(cf.region || "").slice(0, 60),
        region_code: String(cf.regionCode || "").slice(0, 3), lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100 }, 200, h);
    }

    // v5.33: may this visit load Google Analytics? Network type only; nothing kept.
    if (path === "/ga-ok" && req.method === "GET") {
      return json({ ok: gaOk(req.cf) }, 200, Object.assign({ "Cache-Control": "private, max-age=3600" }, cors(req)));
    }

    // v5.13: origin and content type, before any public POST reads its body.
    if (req.method === "POST" && PUBLIC_POSTS.has(path)) {
      const refused = publicGate(req, path);
      if (refused) return refused;
    }

    // v5.30: the hay board. Every /hay/ route lives in hayRoute; nothing else starts with /hay/.
    if (path.startsWith("/hay/")) return hayRoute(req, env, url, path);

    // ---------- daily briefing: subscribe ----------
    if (path === "/subscribe" && req.method === "POST") {
      let email = "", src = "", trap = "", zipIn = null, repIn = null;
      const ct = req.headers.get("Content-Type") || "";
      try {
        if (ct.includes("json")) {
          const b = await req.json();
          email = b.email || ""; src = b.source || ""; trap = b._gotcha || "";
          zipIn = b.zip; repIn = b.reports;
        } else {
          const f = await req.formData();
          email = f.get("email") || ""; src = f.get("source") || ""; trap = f.get("_gotcha") || "";
          zipIn = f.get("zip"); repIn = f.get("reports");
        }
      } catch (e) { /* validation below */ }
      email = String(email).trim().toLowerCase();
      if (trap) return json({ ok: true }, 200, cors(req));
      if (!EMAIL_RE.test(email) || email.length > 254)
        return json({ ok: false, error: "invalid email" }, 400, cors(req));
      const slow = await rateLimit(req, env, path);
      if (slow) return slow;
      await putSub(env, email, src, zipIn, repIn);
      return json({ ok: true }, 200, cors(req));
    }

    // ---------- v5.11: one-time notices (rent release, ARC/PLC reminder) ----------
    // Kept under note:<email>, apart from the daily list, so a notice never
    // puts anyone on AGSIST Daily. daily:true (the "Also send the morning
    // briefing" box) adds the address to the daily list as /subscribe does.
    if (path === "/notice" && req.method === "POST") {
      let b = {};
      try { b = await req.json(); } catch (e) { b = {}; }
      if (!b || typeof b !== "object" || Array.isArray(b)) b = {};
      if (b._gotcha) return json({ ok: true }, 200, cors(req));
      const email = String(b.email || "").trim().toLowerCase();
      if (!EMAIL_RE.test(email) || email.length > 254)
        return json({ ok: false, error: "invalid email" }, 400, cors(req));
      const topic = noticeTopic(b.topic);
      if (!topic) return json({ ok: false, error: "invalid topic" }, 400, cors(req));
      const src = String(b.source || "").slice(0, 60);
      let r = null;
      try { const v = await env.SUBS.get("note:" + email); r = v ? JSON.parse(v) : null; } catch (e) { r = null; }
      if (!r || typeof r !== "object" || !r.t || typeof r.t !== "object") r = { ts: Date.now(), t: {} };
      if (!(topic in r.t) && Object.keys(r.t).length >= NOTE_MAX)
        return json({ ok: false, error: "too many notices for this address" }, 400, cors(req));
      const slow = await rateLimit(req, env, path);
      if (slow) return slow;
      // v5.32: a rent notice is one release a year. Asked again after it was
      // sent, it starts over (new ts, no sent), so send_rent_notice.py mails
      // the next release after this ask, as it does for a first ask.
      if (!(topic in r.t) || (topic.startsWith("rent:") && r.t[topic] && r.t[topic].sent)) r.t[topic] = { ts: Date.now(), src };
      // v5.18: the rain gauge list keeps an optional ZIP and a one-line note;
      // v5.24: asked again, it takes the new ones (the first ts and src stay)
      if (topic === "rain-gauge") {
        const z = subZip(b.zip), nt = oneLine(b.note, NOTE_TEXT_MAX);
        if (z) r.t[topic].zip = z;
        if (nt) r.t[topic].note = nt;
      }
      // v5.29: a prf topic keeps the newest interval the page showed, from the first ask
      if (topic.startsWith("prf:") && !r.t[topic].after) {
        const af = prfInterval(b.after);
        if (af) r.t[topic].after = af;
      }
      await env.SUBS.put("note:" + email, JSON.stringify(r));
      const daily = subBool(b.daily) === true;
      if (daily) await putSub(env, email, src, b.zip, b.reports);
      return json({ ok: true, topic, daily }, 200, cors(req));
    }

    if (path === "/notice-unsubscribe") {
      const e = (url.searchParams.get("e") || "").trim().toLowerCase();
      const t = url.searchParams.get("t") || "";
      const one = url.searchParams.get("topic") ? noticeTopic(url.searchParams.get("topic"), true) : "";
      const valid = EMAIL_RE.test(e) && await unsubOk(env, e, t);
      if (!valid || one === null) return htmlPage("That unsubscribe link isn't valid.");
      if (req.method === "GET") {
        const action = path + "?e=" + encodeURIComponent(e) + "&t=" + encodeURIComponent(t) + (one ? "&topic=" + encodeURIComponent(one) : "");
        return htmlPage(one ? "Stop this notice for this address?" : "Stop every AGSIST notice for this address?",
          "<p>" + escHtml(e) + "</p>" +
          "<form method=\"POST\" action=\"" + action + "\">" +
          "<button type=\"submit\" style=\"font:inherit;padding:10px 22px;cursor:pointer\">Yes, stop it</button></form>" +
          "<p style=\"color:#666\">Nothing happens until you press the button. AGSIST Daily, if you get it, is not changed.</p>");
      }
      if (req.method === "POST") {
        let r = null;
        try { const v = await env.SUBS.get("note:" + e); r = v ? JSON.parse(v) : null; } catch (x) { r = null; }
        if (one && r && r.t && typeof r.t === "object") {
          delete r.t[one];
          if (Object.keys(r.t).length) await env.SUBS.put("note:" + e, JSON.stringify(r));
          else await env.SUBS.delete("note:" + e);
        } else {
          await env.SUBS.delete("note:" + e);
        }
        return htmlPage(one ? "Stopped. No email about this one." : "Stopped. No more AGSIST notices.");
      }
    }

    // ---------- hail alerts: register/move a watch pin ----------
    if (path === "/alert-subscribe" && req.method === "POST") {
      let b = {};
      try { b = await req.json(); } catch (e) { /* validation below */ }
      if (!b || typeof b !== "object" || Array.isArray(b)) b = {};
      if (b._gotcha) return json({ ok: true }, 200, cors(req));
      const email = String(b.email || "").trim().toLowerCase();
      const lat = Number(b.lat), lon = Number(b.lon);
      let radius = Number(b.radius_mi) || 5;
      if (![1, 5, 10, 25].includes(radius)) radius = 5;
      const place = oneLine(b.place, 120);
      if (!EMAIL_RE.test(email) || email.length > 254)
        return json({ ok: false, error: "invalid email" }, 400, cors(req));
      if (!(lat >= 24 && lat <= 50 && lon >= -125 && lon <= -66))
        return json({ ok: false, error: "pin outside the continental US" }, 400, cors(req));
      const slow = await rateLimit(req, env, path);
      if (slow) return slow;
      await env.SUBS.put("alert:" + email, JSON.stringify(
        { lat: +lat.toFixed(4), lon: +lon.toFixed(4), place, radius_mi: radius, ts: Date.now() }));
      return json({ ok: true }, 200, cors(req));
    }

    // ---------- unsubscribes (briefing + alerts): RFC 8058 GET/POST split ----------
    // GET renders a confirm page and MUTATES NOTHING — link-scanners, SafeLinks
    // and prefetchers can follow the email link harmlessly. POST removes
    // immediately with no further confirmation step (RFC 8058 one-click; also
    // what the confirm page's button submits).
    if (path === "/unsubscribe" || path === "/alert-unsubscribe") {
      const e = (url.searchParams.get("e") || "").trim().toLowerCase();
      const t = url.searchParams.get("t") || "";
      const valid = EMAIL_RE.test(e) && await unsubOk(env, e, t);
      const isAlert = path === "/alert-unsubscribe";

      if (!valid) return htmlPage("That unsubscribe link isn't valid.");

      if (req.method === "GET") {
        const action = path + "?e=" + encodeURIComponent(e) + "&t=" + encodeURIComponent(t);
        return htmlPage(
          isAlert ? "Stop hail alerts for this address?" : "Unsubscribe from AGSIST Daily?",
          "<p>" + escHtml(e) + "</p>" +
          "<form method=\"POST\" action=\"" + action + "\">" +
          "<button type=\"submit\" style=\"font:inherit;padding:10px 22px;" +
          "cursor:pointer\">Yes, unsubscribe</button></form>" +
          "<p style=\"color:#666\">Nothing happens until you press the button.</p>");
      }

      if (req.method === "POST") {
        await env.SUBS.delete((isAlert ? "alert:" : "sub:") + e);
        // v5.11: "No more emails" covers the one-time notices too.
        if (!isAlert) await env.SUBS.delete("note:" + e);
        return htmlPage(isAlert
          ? "Hail alerts stopped for this address. No more alert emails."
          : "You're unsubscribed. No more emails.");
      }
    }


    // ---------- WATCH A COUNTY ----------
    const WATCH_MAX = 5, PEND_TTL = 14 * 864e5;
    async function getWatch(e) {
      const v = await env.SUBS.get("watch:" + e);
      const r = v ? JSON.parse(v) : {};
      r.pend = r.pend || {}; r.w = r.w || {};
      return r;
    }
    async function putWatch(e, r) {
      if (!Object.keys(r.pend).length && !Object.keys(r.w).length) await env.SUBS.delete("watch:" + e);
      else await env.SUBS.put("watch:" + e, JSON.stringify(r));
    }

    if (path === "/watch-subscribe" && req.method === "POST") {
      let b = {};
      try { b = await req.json(); } catch (e) { /* validation below */ }
      if (!b || typeof b !== "object" || Array.isArray(b)) b = {};
      if (b._gotcha) return json({ ok: true }, 200, cors(req));
      const email = String(b.email || "").trim().toLowerCase();
      const fips = String(b.fips || "").trim();
      if (!EMAIL_RE.test(email) || email.length > 254)
        return json({ ok: false, error: "invalid email" }, 400, cors(req));
      if (!/^\d{5}$/.test(fips))
        return json({ ok: false, error: "invalid county" }, 400, cors(req));
      const slow = await rateLimit(req, env, path);
      if (slow) return slow;
      const r = await getWatch(email);
      const now = Date.now();
      for (const f of Object.keys(r.pend)) if (now - r.pend[f].ts > PEND_TTL) delete r.pend[f];
      // Same answer whether or not the address is already watching: the reply must not tell a
      // stranger who is on the list.
      if (!(fips in r.w) && !(fips in r.pend)) {
        if (Object.keys(r.w).length + Object.keys(r.pend).length >= WATCH_MAX)
          return json({ ok: false, error: "limit" }, 429, cors(req));
        r.pend[fips] = { ts: now, m: 0 };
        await putWatch(email, r);
      }
      return json({ ok: true }, 200, cors(req));
    }

    if (path === "/watch-confirm" || path === "/watch-unsubscribe") {
      const e = (url.searchParams.get("e") || "").trim().toLowerCase();
      const f = (url.searchParams.get("f") || "").trim();
      const t = url.searchParams.get("t") || "";
      const conf = path === "/watch-confirm";
      const fOk = conf ? /^\d{5}$/.test(f) : (f === "" || /^\d{5}$/.test(f));
      // v5.13: a confirm needs the secret (503 without it); a stop link always works (unsubOk).
      const tokOk = conf ? safeEq(t, await hmac16(e + "|c|" + f, env.UNSUB_SECRET)) : await unsubOk(env, e + (f ? "|w|" + f : "|w"), t);
      if (!(EMAIL_RE.test(e) && fOk && tokOk)) return htmlPage("That link isn't valid.");
      const action = path + "?e=" + encodeURIComponent(e) + (f ? "&f=" + f : "") + "&t=" + encodeURIComponent(t);
      if (req.method === "GET") {
        return htmlPage(
          conf ? "Watch county " + escHtml(f) + " on AGSIST?" : (f ? "Stop watching county " + escHtml(f) + "?" : "Stop all county watches for this address?"),
          "<p>" + escHtml(e) + "</p><form method=\"POST\" action=\"" + action + "\">" +
          "<button type=\"submit\" style=\"font:inherit;padding:10px 22px;cursor:pointer\">" +
          (conf ? "Yes, watch it" : "Yes, stop") + "</button></form>" +
          "<p style=\"color:#666\">Nothing happens until you press the button.</p>");
      }
      if (req.method === "POST") {
        const r = await getWatch(e);
        if (conf) {
          if (!(f in r.pend) || pendExpired(r.pend[f])) {
            if (f in r.pend) { delete r.pend[f]; await putWatch(e, r); }
            return htmlPage("This confirmation link has expired. Sign up again on the county page.");
          }
          delete r.pend[f];
          r.w[f] = null;                       // the sender records the baseline figures on its next run
          await putWatch(e, r);
          return htmlPage("You are watching this county. You will get an email when its published figures change.");
        }
        if (f) { delete r.pend[f]; delete r.w[f]; } else { r.pend = {}; r.w = {}; }
        await putWatch(e, r);
        return htmlPage(f ? "Stopped. No more emails about this county." : "Stopped. No more county watch emails.");
      }
    }

    // ---------- authed routes ----------
    // v5.13: the token may also come as "Authorization: Bearer <token>", so the
    // scripts can stop putting it in the address. ?token= still works.
    const bearer = /^Bearer\s+(\S+)\s*$/i.exec(req.headers.get("Authorization") || "");
    const token = bearer ? bearer[1] : (url.searchParams.get("token") || "");
    const authed = !!env.LIST_TOKEN && safeEq(token, env.LIST_TOKEN);

    if (path === "/list" && req.method === "GET") {
      if (!authed) return json({ ok: false }, 403);
      if (url.searchParams.get("format") === "json") {
        // v5.4: one record per address, for the per-reader email.
        // v5.13: read from key metadata (see subPage). With &limit= (1..1000)
        // or &cursor=, one page: the same array, and the next page's cursor in
        // the X-Next-Cursor header ("" on the last page). Without either, the
        // whole list, exactly as before.
        const cors_ = { "Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": "X-Next-Cursor" };
        if (url.searchParams.has("limit") || url.searchParams.has("cursor")) {
          const lim = Math.min(1000, Math.max(1, parseInt(url.searchParams.get("limit"), 10) || 1000));
          const p = await subPage(env, url.searchParams.get("cursor") || "", lim);
          return json(p.out, 200, Object.assign({ "X-Next-Cursor": p.cursor }, cors_));
        }
        return json(await subAll(env), 200, cors_);
      }
      const keys = await listKeys(env, "sub:");
      return new Response(keys.map(k => k.slice(4)).join("\n"),
        { headers: { "Content-Type": "text/plain;charset=utf-8",
                     "Access-Control-Allow-Origin": "*" } });
    }

    if (path === "/count" && req.method === "GET") {
      // v5.4: totals for the private dashboard. Counts only, no addresses.
      if (!authed) return json({ ok: false }, 403);
      const subs = await subAll(env);   // v5.13: metadata, as /list
      let withZip = 0;
      const bySource = {};
      for (const r of subs) {
        if (r.zip) withZip++;
        const s = r.src || "(none)";
        bySource[s] = (bySource[s] || 0) + 1;
      }
      return json({
        ok: true,
        daily: subs.length,
        daily_with_zip: withZip,
        alerts: (await listKeys(env, "alert:")).length,
        ewatch: (await listKeys(env, "ewatch:")).length,
        pwatch: (await listKeys(env, "pwatch:")).length,
        watch: (await listKeys(env, "watch:")).length,
        by_source: bySource,
        // v5.13: whether UNSUB_SECRET is set on this Worker. A boolean, never the value.
        secret: typeof env.UNSUB_SECRET === "string" && env.UNSUB_SECRET.length > 0,
        // v5.8: stored form posts per kind. Counts only.
        forms: await formCounts(env),
        // v5.11: one-time notices: addresses, and sign-ups per topic.
        ...(await noticeCounts(env)),
      }, 200, { "Access-Control-Allow-Origin": "*" });
    }

    // v5.11: the one-time notices, for the job that mails them. ?topic= is a
    // whole topic (rent:wi) or a prefix ending in ":" (rent:, arcplc:);
    // &unsent=1 leaves out the ones already marked sent. One row per
    // address and topic.
    if (path === "/notice-list" && req.method === "GET") {
      if (!authed) return json({ ok: false }, 403);
      const want = String(url.searchParams.get("topic") || "").trim().toLowerCase();
      const unsent = url.searchParams.get("unsent") === "1";
      const out = [];
      for (const k of await listKeys(env, "note:")) {
        let r = null;
        try { r = JSON.parse(await env.SUBS.get(k)); } catch (e) { r = null; }
        if (!r || !r.t || typeof r.t !== "object") continue;
        for (const [topic, v] of Object.entries(r.t)) {
          if (want && !(want.endsWith(":") ? topic.startsWith(want) : topic === want)) continue;
          if (unsent && v && v.sent) continue;
          const row = { email: k.slice(5), topic, ts: v && v.ts || null, src: v && v.src || "", sent: v && v.sent || null };
          if (v && v.zip) row.zip = v.zip;     // v5.18: rain-gauge only
          if (v && v.note) row.note = v.note;
          if (v && v.after) row.after = v.after;   // v5.29: prf only
          if (v && v.iv) row.iv = v.iv;
          out.push(row);
        }
      }
      return json(out, 200);
    }

    if (path === "/notice-mark" && req.method === "POST") {
      if (!authed) return json({ ok: false }, 403);
      let b = {};
      try { b = await req.json(); } catch (e) { return json({ ok: false, error: "bad json" }, 400); }
      const email = String(b.email || "").trim().toLowerCase(), topic = noticeTopic(b.topic, true);
      if (!EMAIL_RE.test(email) || !topic) return json({ ok: false, error: "bad args" }, 400);
      let r = null;
      try { r = JSON.parse(await env.SUBS.get("note:" + email)); } catch (e) { r = null; }
      // v5.29: a prf topic recurs; the mark carries the interval it was for
      const iv = topic.startsWith("prf:") ? prfInterval(b.interval) : null;
      if (topic.startsWith("prf:") && !iv) return json({ ok: false, error: "bad args" }, 400);
      if (!r || !r.t || !(topic in r.t)) return json({ ok: true, skipped: true });   // stopped while the job ran
      if (iv) {
        const cur = r.t[topic];
        if (!cur.iv || iv > cur.iv) cur.iv = iv;
        if (b.quiet !== true) cur.sent = Date.now();
      } else r.t[topic].sent = Date.now();
      await env.SUBS.put("note:" + email, JSON.stringify(r));
      return json({ ok: true });
    }

    if (path === "/alert-list" && req.method === "GET") {
      if (!authed) return json({ ok: false }, 403);
      const keys = await listKeys(env, "alert:");
      const out = [];
      for (const k of keys) {
        const v = await env.SUBS.get(k);
        if (v) {
          const rec = JSON.parse(v);
          rec.email = k.slice(6);
          out.push(rec);
        }
      }
      // v4.1 (2026-07-20): open CORS like /list — the endpoint is already
      // token-gated, and Sig's local subscriber dashboard reads it in-browser.
      return json(out, 200, { "Access-Control-Allow-Origin": "*" });
    }


    if (path === "/watch-list" && req.method === "GET") {
      if (!authed) return json({ ok: false }, 403);
      const keys = await listKeys(env, "watch:");
      const out = [];
      for (const k of keys) {
        const v = await env.SUBS.get(k);
        if (v) { const rec = JSON.parse(v); rec.email = k.slice(6); out.push(rec); }
      }
      return json(out, 200);
    }

    if (path === "/watch-mark" && req.method === "POST") {
      if (!authed) return json({ ok: false }, 403);
      let b = {};
      try { b = await req.json(); } catch (e) { return json({ ok: false, error: "bad json" }, 400); }
      const email = String(b.email || "").trim().toLowerCase(), fips = String(b.fips || "");
      if (!EMAIL_RE.test(email) || !/^\d{5}$/.test(fips)) return json({ ok: false, error: "bad args" }, 400);
      const r = await getWatch(email);
      if (b.confirm_mailed) {
        if (!(fips in r.pend)) return json({ ok: true, skipped: true });
        r.pend[fips].m = 1;
      } else {
        if (!(fips in r.w)) return json({ ok: true, skipped: true });   // unsubscribed while the job ran
        r.w[fips] = { k: String(b.k || ""), s: b.s || {} };
      }
      await putWatch(email, r);
      return json({ ok: true });
    }

    // ---------- WATCH AN ELEVATOR (cash bids) ----------
    // Same shape as WATCH A COUNTY above, deliberately kept as a separate,
    // parallel system rather than folded into it: the county watch is live,
    // tested, and mailing real readers -- changing its key format to also
    // carry elevators risks the one that already works. An elevator has no
    // natural 5-digit id the way a county has a FIPS code, so the homepage
    // hashes state|facility|city|commodity into a short id (`wid`) client
    // side and sends the human-readable label along with it, so this worker
    // never has to parse a facility name out of a URL.
    const EWATCH_MAX = 5, EPEND_TTL = 14 * 864e5;
    // v5.3 alert options. The crops are the card's own crop keys
    // (merged-index.json `now`), the ranges are the card's per-bushel band
    // ($1 to $32, components/bids-homepage.js PPU_BAND) and a basis range wide
    // enough for any posted board. Anything else is refused, never coerced.
    const EKINDS = ["any", "cash", "basis", "move"];
    const ECROPS = ["corn", "soybeans", "wheat", "sorghum", "oats"];
    const EOPT_FIELDS = ["kind", "ewid", "crop", "period", "plabel", "direction", "target_cents", "move_cents"];
    function eOpts(rec) {
      const o = {};
      for (const f of EOPT_FIELDS) if (rec && rec[f] !== undefined) o[f] = rec[f];
      return o;
    }
    function eValidate(b) {
      const kind = (b.kind === undefined || b.kind === null || b.kind === "") ? "any" : String(b.kind).trim().toLowerCase();
      if (!EKINDS.includes(kind)) return { error: "invalid kind" };
      if (kind === "any") return { opt: {} };
      const ewid = String(b.ewid || "").trim().toLowerCase();
      const crop = String(b.crop || "").trim().toLowerCase();
      const period = String(b.period || "").trim().toLowerCase();
      const plabel = oneLine(b.plabel, 41);
      if (!/^[a-f0-9]{8,16}$/.test(ewid)) return { error: "invalid elevator id" };
      if (!ECROPS.includes(crop)) return { error: "invalid crop" };
      if (!/^[a-z0-9][a-z0-9\/-]{1,23}$/.test(period)) return { error: "invalid period" };
      if (!plabel || plabel.length > 40) return { error: "invalid period label" };
      const opt = { kind, ewid, crop, period, plabel };
      if (kind === "move") {
        const n = b.move_cents;
        if (!Number.isInteger(n) || n < 1 || n > 100) return { error: "invalid move" };
        opt.move_cents = n;
      } else {
        const direction = String(b.direction || "").trim().toLowerCase();
        if (direction !== "above" && direction !== "below") return { error: "invalid direction" };
        const t = b.target_cents;
        const lo = kind === "cash" ? 100 : -300, hi = kind === "cash" ? 3200 : 300;
        if (!Number.isInteger(t) || t < lo || t > hi) return { error: "invalid target" };
        opt.direction = direction; opt.target_cents = t;
      }
      return { opt };
    }

    if (path === "/elevator-watch-options" && req.method === "GET") {
      return json({ ok: true, kinds: EKINDS, crops: ECROPS, max: EWATCH_MAX }, 200, cors(req));
    }
    async function getEWatch(e) {
      const v = await env.SUBS.get("ewatch:" + e);
      const r = v ? JSON.parse(v) : {};
      r.pend = r.pend || {}; r.w = r.w || {};
      return r;
    }
    async function putEWatch(e, r) {
      if (!Object.keys(r.pend).length && !Object.keys(r.w).length) await env.SUBS.delete("ewatch:" + e);
      else await env.SUBS.put("ewatch:" + e, JSON.stringify(r));
    }

    if (path === "/elevator-watch-subscribe" && req.method === "POST") {
      let b = {};
      try { b = await req.json(); } catch (e) { /* validation below */ }
      if (!b || typeof b !== "object" || Array.isArray(b)) b = {};
      if (b._gotcha) return json({ ok: true }, 200, cors(req));
      const email = String(b.email || "").trim().toLowerCase();
      const wid = String(b.wid || "").trim().toLowerCase();
      const label = oneLine(b.label, 120);
      if (!EMAIL_RE.test(email) || email.length > 254)
        return json({ ok: false, error: "invalid email" }, 400, cors(req));
      if (!/^[a-f0-9]{8,16}$/.test(wid))
        return json({ ok: false, error: "invalid elevator id" }, 400, cors(req));
      if (!label)
        return json({ ok: false, error: "invalid label" }, 400, cors(req));
      const ev = eValidate(b);
      if (ev.error) return json({ ok: false, error: ev.error }, 400, cors(req));
      const slow = await rateLimit(req, env, path);
      if (slow) return slow;
      const r = await getEWatch(email);
      const now = Date.now();
      for (const w of Object.keys(r.pend)) if (now - r.pend[w].ts > EPEND_TTL) delete r.pend[w];
      // Same answer whether or not the address is already watching: the reply must not tell a
      // stranger who is on the list.
      if (!(wid in r.w) && !(wid in r.pend)) {
        if (Object.keys(r.w).length + Object.keys(r.pend).length >= EWATCH_MAX)
          return json({ ok: false, error: "limit" }, 429, cors(req));
        r.pend[wid] = Object.assign({ ts: now, m: 0, label }, ev.opt);
        await putEWatch(email, r);
      }
      return json({ ok: true }, 200, cors(req));
    }

    if (path === "/elevator-watch-confirm" || path === "/elevator-watch-unsubscribe") {
      const e = (url.searchParams.get("e") || "").trim().toLowerCase();
      const w = (url.searchParams.get("w") || "").trim().toLowerCase();
      const t = url.searchParams.get("t") || "";
      const conf = path === "/elevator-watch-confirm";
      const wOk = conf ? /^[a-f0-9]{8,16}$/.test(w) : (w === "" || /^[a-f0-9]{8,16}$/.test(w));
      // v5.13: a confirm needs the secret (503 without it); a stop link always works (unsubOk).
      const tokOk = conf ? safeEq(t, await hmac16(e + "|ec|" + w, env.UNSUB_SECRET)) : await unsubOk(env, e + (w ? "|ew|" + w : "|ew"), t);
      if (!(EMAIL_RE.test(e) && wOk && tokOk)) return htmlPage("That link isn't valid.");
      const rPeek = await getEWatch(e);
      const label = (w && (rPeek.pend[w] || rPeek.w[w] || {}).label) || "this elevator";
      const action = path + "?e=" + encodeURIComponent(e) + (w ? "&w=" + w : "") + "&t=" + encodeURIComponent(t);
      if (req.method === "GET") {
        return htmlPage(
          conf ? "Watch " + escHtml(label) + " on AGSIST?" : (w ? "Stop watching " + escHtml(label) + "?" : "Stop all elevator watches for this address?"),
          "<p>" + escHtml(e) + "</p><form method=\"POST\" action=\"" + action + "\">" +
          "<button type=\"submit\" style=\"font:inherit;padding:10px 22px;cursor:pointer\">" +
          (conf ? "Yes, watch it" : "Yes, stop") + "</button></form>" +
          "<p style=\"color:#666\">Nothing happens until you press the button.</p>");
      }
      if (req.method === "POST") {
        const r = await getEWatch(e);
        if (conf) {
          if (!(w in r.pend) || pendExpired(r.pend[w])) {
            if (w in r.pend) { delete r.pend[w]; await putEWatch(e, r); }
            return htmlPage("This confirmation link has expired. Ask to watch it again on the elevator's bid card.");
          }
          const pendLabel = r.pend[w].label;
          const opt = eOpts(r.pend[w]);
          delete r.pend[w];
          r.w[w] = Object.assign(opt, { label: pendLabel, k: null, s: null });   // the sender records the baseline on its next run
          await putEWatch(e, r);
          const kind = opt.kind || "any";
          return htmlPage("You are watching " + escHtml(pendLabel) + ". " + (
            // v5.6: a ZIP-wide alert (ewid "ab" + ZIP + miles) re-arms; it does not clear itself.
            kind === "cash" && /^ab\d{8}$/.test(opt.ewid || "") ? "You will get one email when an elevator in range posts at or above your price, then none until every one is back below it and one crosses again." :
            kind === "move" ? "You will get an email each time a new posting moves the basis " + opt.move_cents + "\u00a2 or more from the last email." :
            kind === "cash" || kind === "basis" ? "You will get one email when a new posting reaches your target. Then the alert clears itself." :
            "You will get an email when its posted basis changes."));
        }
        if (w) { delete r.pend[w]; delete r.w[w]; } else { r.pend = {}; r.w = {}; }
        await putEWatch(e, r);
        return htmlPage(w ? "Stopped. No more emails about " + escHtml(label) + "." : "Stopped. No more elevator watch emails.");
      }
    }

    if (path === "/elevator-watch-list" && req.method === "GET") {
      if (!authed) return json({ ok: false }, 403);
      const keys = await listKeys(env, "ewatch:");
      const out = [];
      for (const k of keys) {
        const v = await env.SUBS.get(k);
        if (v) { const rec = JSON.parse(v); rec.email = k.slice(7); out.push(rec); }
      }
      return json(out, 200);
    }

    if (path === "/elevator-watch-mark" && req.method === "POST") {
      if (!authed) return json({ ok: false }, 403);
      let b = {};
      try { b = await req.json(); } catch (e) { return json({ ok: false, error: "bad json" }, 400); }
      const email = String(b.email || "").trim().toLowerCase(), wid = String(b.wid || "").trim().toLowerCase();
      if (!EMAIL_RE.test(email) || !/^[a-f0-9]{8,16}$/.test(wid)) return json({ ok: false, error: "bad args" }, 400);
      const r = await getEWatch(email);
      if (b.confirm_mailed) {
        if (!(wid in r.pend)) return json({ ok: true, skipped: true });
        r.pend[wid].m = 1;
      } else if (b.fired) {
        // v5.3 one-shot target: the sender already mailed the hit, so it is removed, never re-armed.
        if (!(wid in r.w)) return json({ ok: true, skipped: true });   // unsubscribed while the job ran
        delete r.w[wid];
      } else {
        if (!(wid in r.w)) return json({ ok: true, skipped: true });   // unsubscribed while the job ran
        // v5.3: keep the alert's option fields; only the recorded level changes.
        r.w[wid] = Object.assign(eOpts(r.w[wid]), { label: (r.w[wid] && r.w[wid].label) || String(b.label || ""), k: String(b.k || ""), s: b.s || {} });
      }
      await putEWatch(email, r);
      return json({ ok: true });
    }

    // ---------- WATCH A PRICE TARGET (futures) ----------
    const PWATCH_MAX = 5, PPEND_TTL = 14 * 864e5;
    // Real, fetched contracts only -- must match ALLOWED_SYMBOLS in
    // scripts/send_price_watch.py exactly, or a confirmed alert can sit
    // forever because the sender has no quote for its symbol. Widen both
    // lists together, never just one.
    const PWATCH_SYMBOLS = new Set(["corn", "corn-dec", "beans", "beans-nov", "wheat", "cattle"]);
    async function getPWatch(e) {
      const v = await env.SUBS.get("pwatch:" + e);
      const r = v ? JSON.parse(v) : {};
      r.pend = r.pend || {}; r.w = r.w || {};
      return r;
    }
    async function putPWatch(e, r) {
      if (!Object.keys(r.pend).length && !Object.keys(r.w).length) await env.SUBS.delete("pwatch:" + e);
      else await env.SUBS.put("pwatch:" + e, JSON.stringify(r));
    }

    if (path === "/price-watch-subscribe" && req.method === "POST") {
      let b = {};
      try { b = await req.json(); } catch (e) { /* validation below */ }
      if (!b || typeof b !== "object" || Array.isArray(b)) b = {};
      if (b._gotcha) return json({ ok: true }, 200, cors(req));
      const email = String(b.email || "").trim().toLowerCase();
      const pid = String(b.pid || "").trim().toLowerCase();
      const symbol = String(b.symbol || "").trim().toLowerCase();
      const direction = String(b.direction || "").trim().toLowerCase();
      const target_cents = Number(b.target_cents);
      const label = oneLine(b.label, 120);
      if (!EMAIL_RE.test(email) || email.length > 254)
        return json({ ok: false, error: "invalid email" }, 400, cors(req));
      if (!/^[a-f0-9]{8,16}$/.test(pid))
        return json({ ok: false, error: "invalid alert id" }, 400, cors(req));
      if (!PWATCH_SYMBOLS.has(symbol))
        return json({ ok: false, error: "invalid symbol" }, 400, cors(req));
      if (direction !== "above" && direction !== "below")
        return json({ ok: false, error: "invalid direction" }, 400, cors(req));
      if (!Number.isFinite(target_cents) || target_cents <= 0 || target_cents > 100000)
        return json({ ok: false, error: "invalid target" }, 400, cors(req));
      if (!label)
        return json({ ok: false, error: "invalid label" }, 400, cors(req));
      const slow = await rateLimit(req, env, path);
      if (slow) return slow;
      const r = await getPWatch(email);
      const now = Date.now();
      for (const p of Object.keys(r.pend)) if (now - r.pend[p].ts > PPEND_TTL) delete r.pend[p];
      // Same answer whether or not the address already has this alert: the reply must not tell a
      // stranger who is on the list.
      if (!(pid in r.w) && !(pid in r.pend)) {
        if (Object.keys(r.w).length + Object.keys(r.pend).length >= PWATCH_MAX)
          return json({ ok: false, error: "limit" }, 429, cors(req));
        r.pend[pid] = { ts: now, m: 0, symbol, direction, target_cents: Math.round(target_cents), label };
        await putPWatch(email, r);
      }
      return json({ ok: true }, 200, cors(req));
    }

    if (path === "/price-watch-confirm" || path === "/price-watch-unsubscribe") {
      const e = (url.searchParams.get("e") || "").trim().toLowerCase();
      const p = (url.searchParams.get("p") || "").trim().toLowerCase();
      const t = url.searchParams.get("t") || "";
      const conf = path === "/price-watch-confirm";
      const pOk = conf ? /^[a-f0-9]{8,16}$/.test(p) : (p === "" || /^[a-f0-9]{8,16}$/.test(p));
      // v5.13: a confirm needs the secret (503 without it); a stop link always works (unsubOk).
      const tokOk = conf ? safeEq(t, await hmac16(e + "|pc|" + p, env.UNSUB_SECRET)) : await unsubOk(env, e + (p ? "|pw|" + p : "|pw"), t);
      if (!(EMAIL_RE.test(e) && pOk && tokOk)) return htmlPage("That link isn't valid.");
      const rPeek = await getPWatch(e);
      const label = (p && (rPeek.pend[p] || rPeek.w[p] || {}).label) || "this alert";
      const action = path + "?e=" + encodeURIComponent(e) + (p ? "&p=" + p : "") + "&t=" + encodeURIComponent(t);
      if (req.method === "GET") {
        return htmlPage(
          conf ? "Set the price alert for " + escHtml(label) + "?" : (p ? "Cancel the price alert for " + escHtml(label) + "?" : "Cancel all price alerts for this address?"),
          "<p>" + escHtml(e) + "</p><form method=\"POST\" action=\"" + action + "\">" +
          "<button type=\"submit\" style=\"font:inherit;padding:10px 22px;cursor:pointer\">" +
          (conf ? "Yes, set it" : "Yes, cancel") + "</button></form>" +
          "<p style=\"color:#666\">Nothing happens until you press the button.</p>");
      }
      if (req.method === "POST") {
        const r = await getPWatch(e);
        if (conf) {
          if (!(p in r.pend) || pendExpired(r.pend[p])) {
            if (p in r.pend) { delete r.pend[p]; await putPWatch(e, r); }
            return htmlPage("This confirmation link has expired. Set the alert again on the homepage.");
          }
          const rec = r.pend[p];
          delete r.pend[p];
          r.w[p] = { symbol: rec.symbol, direction: rec.direction, target_cents: rec.target_cents, label: rec.label };
          await putPWatch(e, r);
          return htmlPage("Alert set for " + escHtml(rec.label) + ". You will get one email the day it crosses your price, then it clears itself.");
        }
        if (p) { delete r.pend[p]; delete r.w[p]; } else { r.pend = {}; r.w = {}; }
        await putPWatch(e, r);
        return htmlPage(p ? "Cancelled. No email for " + escHtml(label) + "." : "Cancelled. No more price alert emails.");
      }
    }

    if (path === "/price-watch-list" && req.method === "GET") {
      if (!authed) return json({ ok: false }, 403);
      const keys = await listKeys(env, "pwatch:");
      const out = [];
      for (const k of keys) {
        const v = await env.SUBS.get(k);
        if (v) { const rec = JSON.parse(v); rec.email = k.slice(7); out.push(rec); }
      }
      return json(out, 200);
    }

    if (path === "/price-watch-mark" && req.method === "POST") {
      if (!authed) return json({ ok: false }, 403);
      let b = {};
      try { b = await req.json(); } catch (e) { return json({ ok: false, error: "bad json" }, 400); }
      const email = String(b.email || "").trim().toLowerCase(), pid = String(b.pid || "").trim().toLowerCase();
      if (!EMAIL_RE.test(email) || !/^[a-f0-9]{8,16}$/.test(pid)) return json({ ok: false, error: "bad args" }, 400);
      const r = await getPWatch(email);
      if (b.confirm_mailed) {
        if (!(pid in r.pend)) return json({ ok: true, skipped: true });
        r.pend[pid].m = 1;
      } else if (b.fired) {
        // one-shot: the sender already mailed the hit, so the alert never re-arms.
        if (!(pid in r.w)) return json({ ok: true, skipped: true });   // cancelled while the job ran
        delete r.w[pid];
      } else {
        return json({ ok: false, error: "nothing to record" }, 400);
      }
      await putPWatch(email, r);
      return json({ ok: true });
    }

    if (path === "/flag") {
      if (!authed) return json({ ok: false }, 403);
      const k = (url.searchParams.get("k") || "").trim();
      if (!/^[\w:.-]{1,64}$/.test(k)) return json({ ok: false, error: "bad key" }, 400);
      if (req.method === "GET") {
        const v = await env.SUBS.get("flag:" + k);
        return json({ ok: true, set: v !== null });
      }
      if (req.method === "POST") {
        await env.SUBS.put("flag:" + k, "1", { expirationTtl: 60 * 60 * 24 * 14 });
        return json({ ok: true, set: true });
      }
    }

    if (path === "/import" && req.method === "POST") {
      if (!authed) return json({ ok: false }, 403);
      const body = await req.text();
      let added = 0, skipped = 0;
      for (const raw of body.split(/[\n,]/)) {
        const e = raw.trim().toLowerCase();
        if (EMAIL_RE.test(e) && e.length <= 254) {
          const rec = { ts: Date.now(), src: "import" };
          await env.SUBS.put("sub:" + e, JSON.stringify(rec), { metadata: rec });
          added++;
        } else if (e) skipped++;
      }
      return json({ ok: true, added, skipped }, 200,
        { "Access-Control-Allow-Origin": "*" });
    }

    // ---------- v5.5: self-serve sponsor applications ----------
    if (path === "/sponsor-apply" && req.method === "POST") {
      let b = {};
      try { b = await req.json(); } catch (e) { /* validation below */ }
      if (!b || typeof b !== "object" || Array.isArray(b)) b = {};
      if (b._gotcha) return json({ ok: true }, 200, cors(req));
      const bad = (m) => json({ ok: false, error: m }, 400, cors(req));
      const str = (v, n) => oneLine(v, n);
      const tier = String(b.tier || "");
      if (!own(SAPP_TIERS, tier)) return bad("pick a placement");
      let slot = String(b.slot || "").trim().toLowerCase();
      if (tier === "page" && !/^[a-z0-9][a-z0-9-]{1,59}$/.test(slot)) return bad("pick a page");
      if (tier !== "page") slot = own(SAPP_TIERS, tier);
      const email = String(b.email || "").trim().toLowerCase();
      if (!EMAIL_RE.test(email) || email.length > 254) return bad("invalid email");
      const company = str(b.company, 80), contact = str(b.contact, 80), phone = str(b.phone, 30);
      const headline = str(b.headline, 90), body = str(b.body, 320);
      let link = str(b.url, 200);
      if (company.length < 2) return bad("company name is required");
      if (tier !== "supporter" && headline.length < 3) return bad("a headline is required");
      if (link && !/^https?:\/\//i.test(link)) link = "https://" + link;
      try { const u = new URL(link); if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".")) throw 0; }
      catch (e) { return bad("a working link to your site is required"); }
      if (b.terms !== true) return bad("please accept the terms");
      let logo = "";
      if (b.logo) {
        const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(b.logo));
        if (!m) return bad("the logo must be a PNG, JPG or WebP image");
        if (Math.floor(m[2].length * 3 / 4) > 250 * 1024) return bad("the logo is over 250 KB");
        // v5.13: the bytes must really be a PNG, JPEG or WebP image, whatever
        // the data URL says. A real image sent under the wrong one of the three
        // names is relabelled, so the file the job writes gets the right ending.
        const kind = logoKind(m[2]);
        if (!kind) return bad("the logo must be a PNG, JPG or WebP image");
        logo = kind === m[1] ? String(b.logo) : "data:image/" + kind + ";base64," + m[2];
      }
      // At most 3 open applications per address: a typo'd resubmit is fine, a flood is not.
      // v5.13: counted from a small per-address index (sapp-by:<email>, the
      // ids this address applied with), not by reading every application on
      // file. An application made before v5.13 is not in an index; those are
      // at most 14 days from expiring, so the cap is briefly a little looser.
      const idxKey = "sapp-by:" + email;
      let idx = [];
      try { idx = JSON.parse(await env.SUBS.get(idxKey) || "[]"); } catch (e) { idx = []; }
      if (!Array.isArray(idx)) idx = [];
      const openIds = [];
      for (const oid of idx.filter(x => /^[0-9a-f]{12}$/.test(String(x))).slice(-10)) {
        try {
          const r = JSON.parse(await env.SUBS.get("sapp:" + oid) || "null");
          if (r && r.email === email && (r.status === "pending" || r.status === "confirmed") && !sappExpired(r)) openIds.push(oid);
        } catch (e) { /* skip */ }
      }
      if (openIds.length >= 3) return json({ ok: false, error: "you already have 3 open applications; reply to the email you got" }, 429, cors(req));
      const slow = await rateLimit(req, env, path);
      if (slow) return slow;
      const id = [...crypto.getRandomValues(new Uint8Array(6))].map(x => x.toString(16).padStart(2, "0")).join("");
      const rec = { id, ts: Date.now(), status: "pending", m: 0, notified: 0, tier, slot, company, contact,
                    email, phone, headline, body, url: link, logo_len: logo.length };
      await env.SUBS.put("sapp:" + id, JSON.stringify(rec));
      if (logo) await env.SUBS.put("sapp-logo:" + id, logo);
      await env.SUBS.put(idxKey, JSON.stringify(openIds.concat(id)), { expirationTtl: 90 * 86400 });
      return json({ ok: true, id }, 200, cors(req));
    }

    if (path === "/sponsor-confirm" || path === "/sponsor-decide") {
      const id = String(url.searchParams.get("i") || "").toLowerCase();
      const t = String(url.searchParams.get("t") || "");
      const confirm = path === "/sponsor-confirm";
      const d = confirm ? "" : String(url.searchParams.get("d") || "");
      if (!/^[0-9a-f]{12}$/.test(id) || (!confirm && !own(SAPP_DECISIONS, d)) || !env.UNSUB_SECRET)
        return htmlPage("This link isn't valid.");
      const want = await hmac16(id + (confirm ? "|sc" : "|sd|" + d), env.UNSUB_SECRET);
      if (!safeEq(t, want)) return htmlPage("This link isn't valid.");
      const raw = await env.SUBS.get("sapp:" + id);
      const r = raw ? JSON.parse(raw) : null;
      if (!r) return htmlPage("This application is no longer on file.");
      const what = escHtml(r.company) + " &middot; " + escHtml(own(SAPP_LABEL, r.tier) || r.tier) +
                   (r.tier === "page" ? " (" + escHtml(r.slot) + ")" : "");
      if (confirm) {
        if (r.status !== "pending") return htmlPage("Already confirmed. Sig will be in touch.");
        if (sappExpired(r)) {
          await env.SUBS.delete("sapp:" + id); await env.SUBS.delete("sapp-logo:" + id);
          return htmlPage("This confirmation link has expired. Fill in the form again at agsist.com/sponsor-apply.");
        }
        if (req.method !== "POST")
          return htmlPage("Confirm your AGSIST ad: " + what,
            "<form method=post><button style=\"font-size:16px;padding:10px 18px\">Yes, send it to Sig</button></form>" +
            "<p>Your first month is free. Nothing runs until Sig has looked at it.</p>");
        r.status = "confirmed"; r.cts = Date.now();
        await env.SUBS.put("sapp:" + id, JSON.stringify(r));
        return htmlPage("Thanks. Sig has your ad.",
          "<p>He reviews every ad himself, usually the same day, and you'll get an email when it's live. " +
          "Your free month starts the day it runs.</p>");
      }
      const ok = SAPP_DECISIONS[d].from.includes(r.status);
      if (!ok) return htmlPage("Nothing to do: this application is " + escHtml(r.status) + ".");
      if (req.method !== "POST")
        return htmlPage(escHtml(SAPP_DECISIONS[d].ask) + ": " + what,
          "<form method=post><button style=\"font-size:16px;padding:10px 18px\">" + escHtml(SAPP_DECISIONS[d].button) +
          "</button></form>");
      r.status = SAPP_DECISIONS[d].to; r.dts = Date.now();
      await env.SUBS.put("sapp:" + id, JSON.stringify(r));
      return htmlPage(escHtml(SAPP_DECISIONS[d].done) + ": " + what,
        "<p>The site job picks this up within half an hour.</p>");
    }

    if (path === "/sponsor-apps" && req.method === "GET") {
      // v5.34: CORS for agsist.com, so elev-today.html can list the open ones
      // (company and tier only; it shows nothing else). Same token as before.
      if (!authed) return json({ ok: false }, 403, cors(req));
      const out = [];
      for (const k of await listKeys(env, "sapp:")) {
        try { out.push(JSON.parse(await env.SUBS.get(k))); } catch (e) { /* skip */ }
      }
      return json(out, 200, Object.assign({ "Cache-Control": "no-store" }, cors(req)));
    }

    if (path === "/sponsor-logo" && req.method === "GET") {
      if (!authed) return json({ ok: false }, 403);
      const id = String(url.searchParams.get("i") || "").toLowerCase();
      if (!/^[0-9a-f]{12}$/.test(id)) return json({ ok: false }, 400);
      return json({ ok: true, logo: (await env.SUBS.get("sapp-logo:" + id)) || "" });
    }

    if (path === "/sponsor-mark" && req.method === "POST") {
      if (!authed) return json({ ok: false }, 403);
      let b = {};
      try { b = await req.json(); } catch (e) { return json({ ok: false }, 400); }
      const id = String(b.id || "").toLowerCase();
      const raw = /^[0-9a-f]{12}$/.test(id) ? await env.SUBS.get("sapp:" + id) : null;
      if (!raw) return json({ ok: true, skipped: true });
      const r = JSON.parse(raw), set = b.set || {};
      // The job may move only these steps. Approve, decline and end are Sig's.
      const MOVES = { approved: ["live"], ending: ["ended"], pending: ["expired"] };
      if (set.status !== undefined) {
        if (!(MOVES[r.status] || []).includes(set.status)) return json({ ok: false, error: "bad move" }, 409);
        r.status = set.status;
      }
      for (const k of ["m", "notified", "reminded", "invoiced"]) if (Number.isInteger(set[k])) r[k] = set[k];
      if (typeof set.start === "string" && /^\d{4}-\d{2}-\d{2}$/.test(set.start)) r.start = set.start;
      if (typeof set.slug === "string" && /^[a-z0-9-]{2,60}$/.test(set.slug)) r.slug = set.slug;
      if (r.status === "expired" || r.status === "ended") await env.SUBS.delete("sapp-logo:" + id);
      await env.SUBS.put("sapp:" + id, JSON.stringify(r));
      return json({ ok: true });
    }

    // ---------- v5.14: Rain Print short links ----------
    // publicGate (Origin, JSON) has already run: /rp-short is in PUBLIC_POSTS.
    if (path === "/rp-short" && req.method === "POST") {
      const c = cors(req);
      if (!rpsMemOk(req, "post")) return json({ ok: false, error: "too many requests; try again later" }, 429, c);
      if (Number(req.headers.get("Content-Length") || 0) > RPS_MAX_BYTES)
        return json({ ok: false, error: "too large" }, 413, c);
      let raw = "";
      try { raw = await req.text(); } catch (e) { raw = ""; }
      if (raw.length > RPS_MAX_BYTES) return json({ ok: false, error: "too large" }, 413, c);
      let b = null;
      try { b = JSON.parse(raw); } catch (e) { b = null; }
      if (!b || typeof b !== "object" || Array.isArray(b)) return json({ ok: false, error: "bad json" }, 400, c);
      const code = b.code;
      if (!rpsCodeOk(code)) return json({ ok: false, error: "invalid code" }, 400, c);
      const full = await rpsHash(code);
      for (let len = RPS_LEN; len <= RPS_MAX_LEN; len++) {
        const id = full.slice(0, len), have = await env.SUBS.get("rps:" + id);
        if (have === code) return json({ ok: true, id }, 200, c);
        if (have === null) {
          // Only a new id is counted (RATE["/rp-short"]); a repeat writes nothing.
          const slow = await rateLimit(req, env, path);
          if (slow) return slow;
          await env.SUBS.put("rps:" + id, code);
          return json({ ok: true, id }, 200, c);
        }
      }
      return json({ ok: false, error: "no free id" }, 409, c);
    }

    if (path.startsWith("/rp-short/") && req.method === "GET") {
      const c = Object.assign({ "Vary": "Origin", "X-Content-Type-Options": "nosniff" }, cors(req));
      let seg = "";
      try { seg = decodeURIComponent(path.slice("/rp-short/".length)); } catch (e) { seg = ""; }
      const id = rpsId(seg);
      if (!id) return json({ ok: false, error: "not found" }, 404, Object.assign({ "Cache-Control": "public, max-age=86400" }, c));
      if (!rpsMemOk(req, "get")) return json({ ok: false, error: "too many requests; try again later" }, 429, Object.assign({ "Cache-Control": "no-store" }, c));
      const code = await env.SUBS.get("rps:" + id);
      // An id never changes its code once written, so a hit may be cached for
      // a week; a miss is not cached (the id may be made a moment later).
      if (typeof code !== "string" || !rpsCodeOk(code)) {
        rpsMemMiss(req);
        return json({ ok: false, error: "not found" }, 404, Object.assign({ "Cache-Control": "no-store" }, c));
      }
      return json({ ok: true, code }, 200, Object.assign({ "Cache-Control": "public, max-age=604800, immutable" }, c));
    }

    // ---------- v5.23: Rain Print logos ----------
    // Not in PUBLIC_POSTS: the body is PNG bytes, not JSON, so the gate is here.
    if (path === "/rp-logo" && req.method === "POST") {
      const c = cors(req);
      if (!ALLOWED_ORIGINS.includes(req.headers.get("Origin") || "")) return json({ ok: false, error: "forbidden" }, 403, c);
      const ct = (req.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
      if (ct !== "image/png") return json({ ok: false, error: "unsupported content type" }, 415, c);
      if (!rpsMemOk(req, "logo")) return json({ ok: false, error: "too many requests; try again later" }, 429, c);
      if (Number(req.headers.get("Content-Length") || 0) > RPL_MAX_BYTES) return json({ ok: false, error: "too large" }, 413, c);
      let buf = null;
      try { buf = await req.arrayBuffer(); } catch (e) { buf = null; }
      if (!buf || !buf.byteLength) return json({ ok: false, error: "not a PNG" }, 400, c);
      if (buf.byteLength > RPL_MAX_BYTES) return json({ ok: false, error: "too large" }, 413, c);
      const png = rplPng(new Uint8Array(buf));
      if (typeof png === "string") return json({ ok: false, error: png }, 400, c);
      const slow = await rateLimit(req, env, path);
      if (slow) return slow;
      // 60 random bits: two uploads never meet, so nothing is read back first
      const id = rplNew();
      await env.SUBS.put("rpl:" + id, buf, { expirationTtl: RPL_TTL_S, metadata: { w: png.w, h: png.h, ts: Date.now() } });
      return json({ ok: true, id, w: png.w, h: png.h }, 200, c);
    }
    if (path.startsWith("/rp-logo/") && req.method === "GET") {
      const c = Object.assign({ "Vary": "Origin", "X-Content-Type-Options": "nosniff" }, cors(req));
      let seg = "";
      try { seg = decodeURIComponent(path.slice("/rp-logo/".length)); } catch (e) { seg = ""; }
      const id = rplId(seg);
      if (!id) return json({ ok: false, error: "not found" }, 404, Object.assign({ "Cache-Control": "public, max-age=86400" }, c));
      if (!rpsMemOk(req, "get")) return json({ ok: false, error: "too many requests; try again later" }, 429, Object.assign({ "Cache-Control": "no-store" }, c));
      let v = null;
      try { v = await env.SUBS.get("rpl:" + id, { type: "arrayBuffer" }); } catch (e) { v = null; }
      if (!v || typeof rplPng(new Uint8Array(v)) === "string") {
        rpsMemMiss(req);
        return json({ ok: false, error: "not found" }, 404, Object.assign({ "Cache-Control": "no-store" }, c));
      }
      return new Response(v, { status: 200, headers: Object.assign({ "Content-Type": "image/png",
        "Cache-Control": "public, max-age=31536000, immutable", "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cross-Origin-Resource-Policy": "cross-origin" }, c) });
    }

    // ---------- v5.16: Rain Print gift cards ----------
    // Sig only: issue, void (and reissue), find. The token must come as
    // "Authorization: Bearer"; ?token= is refused here so it never sits in a URL.
    const sig = !!bearer && authed;
    const ac = cors(req);   // the admin page on agsist.com reads these answers
    // v5.39: the monthly backup (scripts/backup/backup-agsist.ps1). Bearer only; a ?token= in the address is refused outright.
    if (path === "/export") {
      const ns = { "Cache-Control": "no-store" };
      if (!sig || url.searchParams.has("token")) return json({ ok: false }, 403, ns);
      if (req.method !== "GET") return json({ ok: false, error: "GET only" }, 405, ns);
      const lim = Number(url.searchParams.get("limit") || EXPORT_LIMIT_DEFAULT);
      const limit = Number.isFinite(lim) ? Math.min(EXPORT_LIMIT_MAX, Math.max(1, Math.floor(lim))) : EXPORT_LIMIT_DEFAULT;
      const cur = exportCursorIn(url.searchParams.get("cursor") || "");
      if (!cur) return json({ ok: false, error: "bad cursor" }, 400, ns);
      const out = await exportPage(env, cur, limit);
      return json(Object.assign({ ok: true, generated_at: new Date().toISOString() }, out), 200, ns);
    }
    if (path === "/rp-gift/issue" && req.method === "POST") {
      if (!sig) return json({ ok: false }, 403, ac);
      const p = await rpgBody(req, RPG_ADMIN_MAX_BYTES);
      if (p.error) return json({ ok: false, error: p.error }, p.status, ac);
      // v5.40: a paid order's card, from the email job: once per order, kept on the order record
      if (p.b.order_key != null) {
        const o = await rpgIssueForOrder(env, p.b);
        return json(o.error ? { ok: false, error: o.error } : o, o.error ? o.status : 200, ac);
      }
      const v = rpgIssueClean(p.b);
      if (v.error) return json({ ok: false, error: v.error }, 400, ac);
      // already_redeemed: the giver gave the address at purchase; the card only announces it.
      const out = await rpgIssue(env, v.rec, p.b.already_redeemed === true ? { status: "redeemed", prepaid: true } : null);
      if (!out) return json({ ok: false, error: "no free code; try again" }, 500, ac);
      return json(out, 200, ac);
    }

    if (path === "/rp-gift/void" && req.method === "POST") {
      if (!sig) return json({ ok: false }, 403, ac);
      const p = await rpgBody(req, RPG_ADMIN_MAX_BYTES);
      if (p.error) return json({ ok: false, error: p.error }, p.status, ac);
      const b = p.b;
      let key = "";
      if (b.code) { const c = rpgNorm(b.code); if (c) key = await rpgKey(env, c); }
      else if (typeof b.key === "string" && RPG_KEY_RE.test(b.key)) key = b.key;
      if (!key) return json({ ok: false, error: "give code or key" }, 400, ac);
      let rec = null;
      try { rec = JSON.parse(await env.SUBS.get(key)); } catch (e) { rec = null; }
      if (!rec) return json({ ok: false, error: "no such card" }, 404, ac);
      if (rec.status === "void") return json({ ok: false, error: "already void", last4: rec.last4 }, 409, ac);
      if (rec.status === "redeemed" && b.force !== true)
        return json({ ok: false, error: "this card was used on " + rpgDay(rec.redeemed_ts) + "; send force:true to void it anyway", last4: rec.last4 }, 409, ac);
      rec.status = "void"; rec.void_ts = Date.now(); rec.void_reason = oneLine(b.reason || "voided", 200);
      const out = { ok: true, voided: rec.last4, order_ref: rec.order_ref };
      if (b.reissue === true) {
        const f = { kind: rec.kind, product: rec.product, order_ref: rec.order_ref, giver: rec.giver || { name: "", email: "" },
          to: rec.to, from_line: rec.from_line, message: rec.message, lock: rec.lock, ships: rec.ships };
        const n = await rpgIssue(env, f, { replaces: rec.last4 });
        if (!n) return json({ ok: false, error: "no free code; nothing was voided" }, 500, ac);
        rec.replaced_by = n.last4;
        Object.assign(out, { code: n.code, card_url: n.card_url, no: n.no, last4: n.last4, key: n.key, status: n.status, ships: n.ships });
      }
      await env.SUBS.put(key, JSON.stringify(rec));
      return json(out, 200, ac);
    }

    if (path === "/rp-gift/find" && req.method === "GET") {
      if (!sig) return json({ ok: false }, 403, ac);
      const ref = String(url.searchParams.get("order_ref") || "").trim();
      const em = String(url.searchParams.get("email") || "").trim().toLowerCase();
      let idx = "";
      if (ref && RPG_REF_RE.test(ref)) idx = "rpg-ref:" + ref;
      else if (em && EMAIL_RE.test(em)) idx = "rpg-by:" + await hmac16("rp-gift-by|" + em, env.UNSUB_SECRET);
      if (!idx) return json({ ok: false, error: "give order_ref or email" }, 400, ac);
      let keys = [];
      try { keys = JSON.parse(await env.SUBS.get(idx)) || []; } catch (e) { keys = []; }
      const cards = [];
      for (const k of Array.isArray(keys) ? keys : []) {
        if (typeof k !== "string" || !RPG_KEY_RE.test(k)) continue;
        let r = null;
        try { r = JSON.parse(await env.SUBS.get(k)); } catch (e) { r = null; }
        if (!r) continue;
        cards.push({ key: k, no: r.no, last4: r.last4, status: r.status, kind: r.kind, product: r.product, to: r.to,
          order_ref: r.order_ref, ships: r.ships, issued_on: rpgDay(r.issued_ts), redeemed_on: rpgDay(r.redeemed_ts),
          void_reason: r.void_reason, replaces: r.replaces || null, replaced_by: r.replaced_by || null });
      }
      return json({ ok: true, cards }, 200, ac);
    }

    // The printable card's data: only with k, the card link's own signature,
    // so a guessed code cannot read the giver's message.
    if (path === "/rp-gift/card" && req.method === "GET") {
      const c = Object.assign({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }, cors(req));
      if (!rpgMemOk(req)) return json({ ok: false, error: "too many requests; try again later" }, 429, c);
      const code = rpgNorm(url.searchParams.get("c"));
      const k = String(url.searchParams.get("k") || "").toLowerCase();
      const miss = () => { rpgMemMiss(req); return json({ ok: false, error: "not found" }, 404, c); };
      if (!code || !/^[0-9a-f]{16}$/.test(k) || !safeEq(k, await rpgCardK(env, code))) return miss();
      let rec = null;
      try { rec = JSON.parse(await env.SUBS.get(await rpgKey(env, code))); } catch (e) { rec = null; }
      if (!rec) return miss();
      return json(Object.assign({ ok: true, code, no: rec.no, message: rec.message || "", issued_on: rpgDay(rec.issued_ts) }, rpgPublic(rec)), 200, c);
    }

    // Public: publicGate has run (both are in PUBLIC_POSTS). Every try counts
    // toward RATE; an unknown code also counts toward the per-isolate miss cap,
    // past which even a real code answers 429 until the hour turns.
    if (path === "/rp-gift/check" && req.method === "POST") {
      const c = cors(req);
      if (!rpgMemOk(req)) return json({ ok: false, error: "too many requests; try again later" }, 429, c);
      const p = await rpgBody(req, RPG_MAX_BYTES);
      if (p.error) return json({ ok: false, error: p.error }, p.status, c);
      const slow = await rateLimit(req, env, path);
      if (slow) return slow;
      const code = rpgNorm(p.b.code);
      let rec = null;
      if (code) try { rec = JSON.parse(await env.SUBS.get(await rpgKey(env, code))); } catch (e) { rec = null; }
      if (!rec) { rpgMemMiss(req); return json({ ok: false, error: "We don't know that code. Check it against the card." }, 404, c); }
      return json(Object.assign({ ok: true, code }, rpgPublic(rec)), 200, c);
    }

    // Single use. KV has no compare-and-swap, so: refuse anything not issued,
    // write status "pending" with a fresh redeem_key, read it back, and go on
    // only if the key is still ours. Two redeems at one edge cannot both pass;
    // two at different edges inside KV's propagation window (up to about a
    // minute) could. Both orders then carry the same gift_card in the digest,
    // which flags it, and Sig honours the first.
    if (path === "/rp-gift/redeem" && req.method === "POST") {
      const c = cors(req);
      if (!rpgMemOk(req)) return json({ ok: false, error: "too many requests; try again later" }, 429, c);
      const p = await rpgBody(req, RPG_REDEEM_MAX_BYTES);
      if (p.error) return json({ ok: false, error: p.error }, p.status, c);
      const slow = await rateLimit(req, env, path);
      if (slow) return slow;
      const b = p.b, code = rpgNorm(b.code);
      const key = code ? await rpgKey(env, code) : "";
      let rec = null;
      if (key) try { rec = JSON.parse(await env.SUBS.get(key)); } catch (e) { rec = null; }
      if (!rec) { rpgMemMiss(req); return json({ ok: false, error: "We don't know that code. Check it against the card." }, 404, c); }
      if (rec.status === "void") return json({ ok: false, error: "This card is no longer active. Write to sig@farmers1st.com." }, 410, c);
      if (rpgPrepaid(rec)) return json({ ok: false, error: "This gift is already paid for and on its way. There is nothing to fill in." }, 409, c);   // v5.40
      if (rec.status === "redeemed") return json({ ok: false, error: "This card was used on " + rpgDay(rec.redeemed_ts) + "." }, 409, c);
      if (rec.status === "pending" && Date.now() - (rec.pending_ts || 0) <= RPG_PENDING_MS)
        return json({ ok: false, error: "This card is being used right now. Try again in two minutes." }, 409, c);
      const choice = b.choice == null || b.choice === "" ? rec.product : b.choice;
      const v = formClean("rain-print-order", Object.assign({}, b, { choice, gift: "", gift_january: "" }));
      if (v.error) return json({ ok: false, error: v.error }, 400, c);
      // v5.26: an RPS-<id> reference stands for its full design code
      let fullCode = v.rec.design_code || "";
      const rpsRef = /^(?:GIFT-)?RPS-([0-9A-Za-z]{5,8})$/.exec(fullCode);
      if (rpsRef) {
        const id = rpsId(rpsRef[1]), got = id ? await env.SUBS.get("rps:" + id) : null;
        fullCode = typeof got === "string" && rpsCodeOk(got) ? got : "";
      }
      if (rec.lock && !rpgLockOk(rec.lock, fullCode))
        return json({ ok: false, error: rec.lock.edit === "name" ? "This card is for the design the giver chose; only the name line can change." : "This card is for the design the giver chose." }, 400, c);
      const mine = [...crypto.getRandomValues(new Uint8Array(8))].map(x => x.toString(16).padStart(2, "0")).join("");
      rec.status = "pending"; rec.pending_ts = Date.now(); rec.redeem_key = mine;
      await env.SUBS.put(key, JSON.stringify(rec));
      let back = null;
      try { back = JSON.parse(await env.SUBS.get(key)); } catch (e) { back = null; }
      if (!back || back.redeem_key !== mine) return json({ ok: false, error: "This card is being used right now. Try again in two minutes." }, 409, c);
      const ts = Date.now(), up = RPG_RANK[v.rec.choice] > RPG_RANK[rec.product];
      const post = Object.assign({ kind: "rain-print-order", ts, n: 0 }, v.rec, {
        gift_card: "RP-\u2026-" + rec.last4 + " (No. " + rec.no + ")", gift_card_paid: rec.product,
        gift_card_order: rec.order_ref, gift_card_from: rec.from_line || (rec.giver && rec.giver.name) || "" });
      if (up) post.gift_card_upgrade = "yes";
      if (!post.logo && rpsRef && fullCode) { const lg = rplFromCode(fullCode); if (lg) post.logo = lg; }   // v5.26
      // One marker per redeem that got this far; a second one means the race
      // above was lost, and the digest says so in red.
      const used = "rpg-used:" + key.slice(4) + ":";
      await env.SUBS.put(used + ts + ":" + mine, "", { expirationTtl: FORM_TTL_S });
      try { if ((await env.SUBS.list({ prefix: used, limit: 10 })).keys.length > 1) post.gift_card_twice = "yes"; } catch (e) { /* the digest still compares */ }
      if (rec.ships === "january") { post.gift_january = "yes"; if (rec.to) post.gift_to = rec.to; }
      const rnd = [...crypto.getRandomValues(new Uint8Array(4))].map(x => x.toString(16).padStart(2, "0")).join("");
      const fkey = "form:rain-print-order:" + ts + ":" + rnd;
      await env.SUBS.put(fkey, JSON.stringify(post), { expirationTtl: FORM_TTL_S });
      if (post.logo) await rplKeep(env, post.logo);   // v5.23
      rec.status = "redeemed"; rec.redeemed_ts = ts; rec.form_key = fkey; delete rec.pending_ts;
      await env.SUBS.put(key, JSON.stringify(rec));
      return json({ ok: true, redeemed_on: rpgDay(ts), ships: rec.ships, product: rec.product, choice: v.rec.choice, upgrade: up }, 200, c);
    }

    // ---------- v5.36: Rain Print order records ----------
    // POST /rp-order: publicGate (Origin, JSON) has already run (PUBLIC_POSTS).
    if (path === "/rp-order" && req.method === "POST") {
      const c = cors(req);
      if (Number(req.headers.get("Content-Length") || 0) > RPO_MAX_BYTES) return json({ ok: false, error: "too large" }, 413, c);
      let raw = "";
      try { raw = await req.text(); } catch (e) { raw = ""; }
      if (raw.length > RPO_MAX_BYTES) return json({ ok: false, error: "too large" }, 413, c);
      let b = null;
      try { b = JSON.parse(raw); } catch (e) { b = null; }
      if (!b || typeof b !== "object" || Array.isArray(b)) return json({ ok: false, error: "bad json" }, 400, c);
      const v = rpoClean(b);
      if (v.error) return json({ ok: false, error: v.error }, 400, c);
      const slow = await rateLimit(req, env, path);
      if (slow) return slow;
      const ts = Date.now();
      const rnd = [...crypto.getRandomValues(new Uint8Array(4))].map(x => x.toString(16).padStart(2, "0")).join("");
      await env.SUBS.put("rpo:" + ts + ":" + rnd, JSON.stringify(Object.assign({ ts }, v.rec)), { expirationTtl: RPO_TTL_S });
      return json({ ok: true }, 200, c);
    }
    // Sig only: Bearer LIST_TOKEN, never ?token=. The Today page on agsist.com reads these.
    if (path === "/rp-order/list" && req.method === "GET") {
      if (!sig) return json({ ok: false }, 403, ac);
      const d = Number(url.searchParams.get("days") || 14);
      const days = Number.isFinite(d) ? Math.min(120, Math.max(1, Math.floor(d))) : 14;
      const out = await rpoList(env, days);
      return json(Object.assign({ ok: true, days }, out), 200, Object.assign({ "Cache-Control": "no-store" }, ac));
    }
    // v5.36: the buyer's "here's your print" email went out for this paid record (scripts/rp_buyer_email.py).
    // Only the time and the session id are kept; never the address it went to.
    // v5.36: Stripe's webhook. Not a browser post (no Origin): the signature is the gate.
    if (path === "/rp-order/stripe" && req.method === "POST") {
      if (typeof env.STRIPE_WEBHOOK_SECRET !== "string" || !env.STRIPE_WEBHOOK_SECRET) return json({ ok: false, error: "not set up" }, 503);
      if (Number(req.headers.get("Content-Length") || 0) > RPO_WH_MAX_BYTES) return json({ ok: false, error: "too large" }, 413);
      let raw = "";
      try { raw = await req.text(); } catch (e) { raw = ""; }
      if (raw.length > RPO_WH_MAX_BYTES) return json({ ok: false, error: "too large" }, 413);
      const why = await stripeSigProblem(req.headers.get("Stripe-Signature"), raw, env.STRIPE_WEBHOOK_SECRET, Math.floor(Date.now() / 1000));
      if (why) return json({ ok: false, error: why }, 400);
      let ev = null;
      try { ev = JSON.parse(raw); } catch (e) { ev = null; }
      const x = ev && ev.data && ev.data.object;
      if (!x || typeof x !== "object") return json({ ok: false, error: "bad event" }, 400);
      const type = String(ev.type || "");
      const paid = (type === "checkout.session.completed" && x.payment_status === "paid") || type === "checkout.session.async_payment_succeeded";
      if (!paid) return json({ ok: true, ignored: type }, 200);
      const done = await rpoWebhookSession(env, x);
      if (done.error) return json({ ok: false, error: done.error }, 400);
      if (done.already) return json({ ok: true, already: true }, 200);
      return json({ ok: true, job: await rpoDispatch(env) }, 200);
    }
    // v5.37: the buyer approves the proof (rain-print-approve.html posts {k, t}). publicGate has run.
    // Idempotent: a second approve answers already with the first time.
    if (path === "/rp-order/approve" && req.method === "POST") {
      const c = Object.assign({ "Cache-Control": "no-store" }, cors(req));
      const slow = await rateLimit(req, env, path);
      if (slow) return slow;
      let b = null;
      try { b = JSON.parse((await req.text()).slice(0, 2048)); } catch (e) { b = null; }
      const k = b && typeof b.k === "string" ? b.k : "", t = b && typeof b.t === "string" ? b.t : "";
      if (!RPO_KEY_RE.test(k) || !safeEq(t, await rpoApproveToken(env, k))) return json({ ok: false, error: "bad link" }, 403, c);
      let r = null;
      try { r = JSON.parse(await env.SUBS.get(k)); } catch (e) { r = null; }
      if (!r || !r.paid) return json({ ok: false, error: "not found" }, 404, c);
      if (r.approved) return json({ ok: true, already: true, at: r.approved.at, product: r.product }, 200, c);
      r.approved = { at: new Date().toISOString() };
      await rpoPut(env, k, r);
      const job = await rpoDispatch(env);   // Sig's "approved" alert goes out from the same email job
      return json({ ok: true, already: false, at: r.approved.at, product: r.product, job: job === "started" ? "started" : "later" }, 200, c);
    }
    // v5.36: Sig's order alert went out for this paid record (scripts/rp_buyer_email.py), once.
    // v5.37: /rp-order/approved-alerted, the same for his "approved, make it" alert.
    // v5.40: /rp-order/gift-mailed, the buyer's gift card email (only once the card is on the record).
    if ((path === "/rp-order/mailed" || path === "/rp-order/alerted" || path === "/rp-order/approved-alerted" || path === "/rp-order/gift-mailed") && req.method === "POST") {
      const what = { "/rp-order/mailed": "mailed", "/rp-order/alerted": "alerted", "/rp-order/approved-alerted": "approved_alerted", "/rp-order/gift-mailed": "gift_mailed" }[path];
      if (!sig) return json({ ok: false }, 403, ac);
      let b = null;
      try { b = await req.json(); } catch (e) { b = null; }
      const k = b && b.key;
      if (typeof k !== "string" || !RPO_KEY_RE.test(k)) return json({ ok: false, error: "invalid key" }, 400, ac);
      let r = null;
      try { r = JSON.parse(await env.SUBS.get(k)); } catch (e) { r = null; }
      if (!r) return json({ ok: false, error: "not found" }, 404, ac);
      if (!r.paid) return json({ ok: false, error: "not paid" }, 409, ac);
      if (what === "approved_alerted" && !r.approved) return json({ ok: false, error: "not approved" }, 409, ac);
      if (what === "gift_mailed" && !(r.gift_card && r.gift_card.code)) return json({ ok: false, error: "no gift card yet" }, 409, ac);
      if (r[what]) return json({ ok: true, already: true, [what]: r[what] }, 200, ac);
      r[what] = { at: new Date().toISOString(), session: String(r.paid.session || "") };
      await rpoPut(env, k, r);
      return json({ ok: true, already: false, [what]: r[what] }, 200, ac);
    }
    // v5.38: the files email for an approved digital file went out (or Sig sends them by hand), once.
    if (path === "/rp-order/delivered" && req.method === "POST") {
      if (!sig) return json({ ok: false }, 403, ac);
      let b = null;
      try { b = await req.json(); } catch (e) { b = null; }
      const k = b && b.key, how = b && b.how === "hand" ? "hand" : "email";
      if (typeof k !== "string" || !RPO_KEY_RE.test(k)) return json({ ok: false, error: "invalid key" }, 400, ac);
      let r = null;
      try { r = JSON.parse(await env.SUBS.get(k)); } catch (e) { r = null; }
      if (!r) return json({ ok: false, error: "not found" }, 404, ac);
      if (!r.paid) return json({ ok: false, error: "not paid" }, 409, ac);
      if (r.product !== "digital") return json({ ok: false, error: "not a digital file" }, 409, ac);
      if (!r.approved) return json({ ok: false, error: "not approved" }, 409, ac);
      if (r.delivered) return json({ ok: true, already: true, delivered: r.delivered }, 200, ac);
      r.delivered = { at: new Date().toISOString(), session: String(r.paid.session || ""), how };
      await rpoPut(env, k, r);
      return json({ ok: true, already: false, delivered: r.delivered }, 200, ac);
    }
    // v5.36: for the buyer email only (scripts/rp_buyer_email.py): the one paid session's livemode and
    // buyer address, read from Stripe now and handed back. Nothing is stored or logged here.
    if (path === "/rp-order/buyer" && req.method === "GET") {
      if (!sig) return json({ ok: false }, 403, ac);
      const k = String(url.searchParams.get("key") || "");
      if (!RPO_KEY_RE.test(k)) return json({ ok: false, error: "invalid key" }, 400, ac);
      let r = null;
      try { r = JSON.parse(await env.SUBS.get(k)); } catch (e) { r = null; }
      if (!r || !r.paid || !r.paid.session) return json({ ok: false, error: "not paid" }, 409, ac);
      if (typeof env.STRIPE_READ_KEY !== "string" || !env.STRIPE_READ_KEY) return json({ ok: false, error: "no key" }, 503, ac);
      const sr = await fetch("https://api.stripe.com/v1/checkout/sessions/" + encodeURIComponent(r.paid.session),
        { headers: { Authorization: "Bearer " + env.STRIPE_READ_KEY } });
      if (!sr.ok) return json({ ok: false, error: "stripe HTTP " + sr.status }, 502, ac);
      const x = await sr.json();
      const email = String((x && x.customer_details && x.customer_details.email) || "").trim();
      return json({ ok: true, livemode: !(x && x.livemode === false), email }, 200, Object.assign({ "Cache-Control": "no-store" }, ac));
    }
    if (path === "/rp-order/serial" && req.method === "POST") {
      if (!sig) return json({ ok: false }, 403, ac);
      let b = null;
      try { b = await req.json(); } catch (e) { b = null; }
      const last = b && b.last;
      if (!Number.isInteger(last) || last < 0 || last > 999999) return json({ ok: false, error: "last must be a whole number, 0 or more" }, 400, ac);
      await env.SUBS.put("rpo-serial", JSON.stringify({ last }));
      return json({ ok: true, serial_last: last, next: last + 1 }, 200, ac);
    }

    // ---------- v5.20: the elevator portal ----------
    // Sig only. Bearer LIST_TOKEN, never ?token= (sig, from the gift card block above).
    if (path.startsWith("/elev/admin/")) {
      if (!sig) return json({ ok: false }, 403, ac);
      if (path === "/elev/admin/list" && req.method === "GET") {
        const out = [];
        for (const k of await listKeys(env, "elev:")) {
          const r = await elevGet(env, k.slice(5));
          if (r) out.push(r);
        }
        out.sort((a, b) => String(a.id).localeCompare(String(b.id)));
        return json({ ok: true, elevators: out }, 200, Object.assign({ "Cache-Control": "no-store" }, ac));
      }
      // v5.21: requests from list-your-elevator, for the Requests list on elev-admin.html.
      if (path === "/elev/admin/requests" && req.method === "GET") {
        const out = [];
        for (const k of await listKeys(env, "form:elevator-listing:")) {
          try {
            const r = JSON.parse(await env.SUBS.get(k));
            if (!r) continue;
            r.key = k;
            if (!EL_REQ_STATUS.includes(r.status)) r.status = "pending";
            out.push(r);
          } catch (e) { /* skip */ }
        }
        out.sort((a, b) => (b.ts || 0) - (a.ts || 0));
        return json({ ok: true, requests: out }, 200, Object.assign({ "Cache-Control": "no-store" }, ac));
      }
      // v5.34: a board Sig pasted by hand. Its own size cap, larger than elevBody's.
      if (path === "/elev/admin/paste" && req.method === "POST") {
        if (Number(req.headers.get("Content-Length") || 0) > PASTE_MAX_BYTES) return json({ ok: false, error: "too large" }, 413, ac);
        let raw = "";
        try { raw = await req.text(); } catch (e) { raw = ""; }
        if (raw.length > PASTE_MAX_BYTES) return json({ ok: false, error: "too large" }, 413, ac);
        let b = null;
        try { b = JSON.parse(raw); } catch (e) { b = null; }
        if (!b || typeof b !== "object" || Array.isArray(b)) return json({ ok: false, error: "bad json" }, 400, ac);
        const v = pasteClean(b);
        if (v.error) return json({ ok: false, error: v.error }, 400, ac);
        const meta = PASTE_SITES[v.site];
        const rec = { site: v.site, name: meta.name, page: meta.page, source: meta.source,
                      pastedAt: new Date().toISOString(), locations: v.locations, rows: v.rows };
        await env.SUBS.put("paste:" + v.site, JSON.stringify(rec));
        return json({ ok: true, site: v.site, pastedAt: rec.pastedAt, rows: v.rows, locations: v.locations.length }, 200, ac);
      }
      if (req.method !== "POST") return json({ ok: false, error: "not found" }, 404, ac);
      const p = await elevBody(req);
      if (p.error) return json({ ok: false, error: p.error }, p.status, ac);
      const b = p.b;
      if (path === "/elev/admin/create") {
        const v = elevCreateClean(b);
        if (v.error) return json({ ok: false, error: v.error }, 400, ac);
        if (await env.SUBS.get("elev:" + v.rec.id) !== null) return json({ ok: false, error: "that id is taken" }, 409, ac);
        await env.SUBS.put("elev:" + v.rec.id, JSON.stringify(v.rec));
        const link = await elevSetKey(env, v.rec.id);
        return json({ ok: true, id: v.rec.id, link }, 200, ac);
      }
      if (path === "/elev/admin/request") {
        const key = typeof b.key === "string" ? b.key : "";
        if (!key.startsWith("form:elevator-listing:") || !FORM_KEY_RE.test(key)) return json({ ok: false, error: "no such request" }, 404, ac);
        const raw = await env.SUBS.get(key);
        let r = null;
        try { r = JSON.parse(raw); } catch (e) { r = null; }
        if (!r) return json({ ok: false, error: "no such request" }, 404, ac);
        const status = String(b.status || "");
        if (!EL_REQ_STATUS.includes(status)) return json({ ok: false, error: "status must be pending, created or dismissed" }, 400, ac);
        const lid = typeof b.id === "string" ? b.id.trim() : "";
        if (lid && (status !== "created" || !ELEV_ID_RE.test(lid) || lid.length > 60)) return json({ ok: false, error: "invalid id" }, 400, ac);
        r.status = status; r.status_ts = Date.now();
        if (lid) r.elev_id = lid; else delete r.elev_id;
        // Keep the original one-year expiry; a put without one would drop it.
        const exp = Math.max(Math.floor(Date.now() / 1000) + 120, Math.floor((r.ts || Date.now()) / 1000) + FORM_TTL_S);
        await env.SUBS.put(key, JSON.stringify(r), { expiration: exp });
        return json({ ok: true, key, status, id: r.elev_id || null }, 200, ac);
      }
      const id = typeof b.id === "string" ? b.id.trim() : "";
      const rec = ELEV_ID_RE.test(id) ? await elevGet(env, id) : null;
      if (!rec) return json({ ok: false, error: "no such elevator" }, 404, ac);
      if (path === "/elev/admin/rekey") {
        const link = await elevSetKey(env, id);
        return json({ ok: true, id, link }, 200, ac);
      }
      if (path === "/elev/admin/active") {
        if (typeof b.active !== "boolean") return json({ ok: false, error: "active must be true or false" }, 400, ac);
        rec.active = b.active;
        await env.SUBS.put("elev:" + id, JSON.stringify(rec));
        return json({ ok: true, id, active: rec.active }, 200, ac);
      }
      return json({ ok: false, error: "not found" }, 404, ac);
    }

    // The elevator's own page. publicGate (Origin, JSON) has already run.
    if ((path === "/elev/me" || path === "/elev/save") && req.method === "POST") {
      const c = Object.assign({ "Cache-Control": "no-store" }, cors(req));
      const slow = await rateLimit(req, env, path);
      if (slow) return slow;
      const p = await elevBody(req);
      if (p.error) return json({ ok: false, error: p.error }, p.status, c);
      const b = p.b;
      const found = await elevByKey(env, b.k);
      if (found.error) return json({ ok: false, error: found.error }, found.status, c);
      const rec = found.rec;
      if (path === "/elev/me") return json({ ok: true, record: elevPublic(rec) }, 200, c);
      // Every field is checked before anything is stored.
      const set = {};
      if (b.bids !== undefined) { const v = elevBids(b.bids); if (v.error) return json({ ok: false, error: v.error }, 400, c); set.bids = v.v; }
      if (b.hours !== undefined) { const v = elevHours(b.hours); if (v.error) return json({ ok: false, error: v.error }, 400, c); set.hours = v.v; }
      if (b.contact !== undefined) { const v = elevContact(b.contact); if (v.error) return json({ ok: false, error: v.error }, 400, c); set.contact = v.v; }
      if (b.note !== undefined) {
        if (b.note !== null && typeof b.note !== "string") return json({ ok: false, error: "invalid note" }, 400, c);
        const t = oneLine(b.note || "", ELEV_NOTE_MAX + 1);
        if (t.length > ELEV_NOTE_MAX) return json({ ok: false, error: "note too long (" + ELEV_NOTE_MAX + " at most)" }, 400, c);
        set.note = t || null;
      }
      if (b.closed_today !== undefined) {
        if (typeof b.closed_today !== "boolean") return json({ ok: false, error: "closed_today must be true or false" }, 400, c);
        set.closed_until = b.closed_today ? elevEndOfDayCT(Date.now()) : null;
      }
      const noChange = b.no_change === true;
      if (!Object.keys(set).length && !noChange) return json({ ok: false, error: "nothing to save" }, 400, c);
      const now = new Date().toISOString();
      let bidsMoved = noChange, infoMoved = false;
      for (const f of Object.keys(set)) {
        if (JSON.stringify(set[f]) === JSON.stringify(rec[f] === undefined ? null : rec[f])) continue;
        rec[f] = set[f];
        if (f === "bids") bidsMoved = true; else infoMoved = true;
      }
      if (bidsMoved) rec.bids_updated_at = now;
      if (infoMoved) rec.info_updated_at = now;
      if (bidsMoved || infoMoved) await env.SUBS.put("elev:" + rec.id, JSON.stringify(rec));
      return json({ ok: true, record: elevPublic(rec) }, 200, c);
    }

    // Public: every listing that is turned on, never an email or a key.
    // v5.34: what Sig pasted, public: the elevator's own posted numbers.
    if (path.startsWith("/elev/paste/") && req.method === "GET") {
      const site = path.slice("/elev/paste/".length);
      const h = Object.assign({ "Cache-Control": "public, max-age=60" }, cors(req));
      if (!own(PASTE_SITES, site)) return json({ ok: false, error: "unknown site" }, 404, h);
      let rec = null;
      try { rec = JSON.parse(await env.SUBS.get("paste:" + site)); } catch (e) { rec = null; }
      if (!rec) return json({ ok: false, error: "nothing pasted yet" }, 404, h);
      return json(Object.assign({ ok: true }, rec), 200, h);
    }
    if (path === "/elev/paste-status" && req.method === "GET") {
      const out = {};
      for (const site of Object.keys(PASTE_SITES)) {
        let rec = null;
        try { rec = JSON.parse(await env.SUBS.get("paste:" + site)); } catch (e) { rec = null; }
        out[site] = rec ? { name: rec.name, page: rec.page, pastedAt: rec.pastedAt, rows: rec.rows, locations: rec.locations.length }
                        : { name: PASTE_SITES[site].name, page: PASTE_SITES[site].page, pastedAt: null, rows: 0, locations: 0 };
      }
      return json({ ok: true, sites: out }, 200, Object.assign({ "Cache-Control": "public, max-age=60" }, cors(req)));
    }
    if (path === "/elev/feed" && req.method === "GET") {
      const out = [];
      for (const k of await listKeys(env, "elev:")) {
        const r = await elevGet(env, k.slice(5));
        if (r && r.active === true) out.push(elevPublic(r));
      }
      out.sort((a, b) => String(a.id).localeCompare(String(b.id)));
      return json({ ok: true, generated_at: new Date().toISOString(), elevators: out }, 200,
        Object.assign({ "Cache-Control": "public, max-age=60" }, cors(req)));
    }

    // ---------- v5.8: the site's own forms ----------
    if (path === "/form" && req.method === "POST") {
      const c = cors(req);
      // v5.13: the Origin check that was here is now publicGate, for every public POST.
      if (Number(req.headers.get("Content-Length") || 0) > FORM_MAX_BYTES)
        return json({ ok: false, error: "too large" }, 413, c);
      let raw = "";
      try { raw = await req.text(); } catch (e) { raw = ""; }
      if (raw.length > FORM_MAX_BYTES) return json({ ok: false, error: "too large" }, 413, c);
      let b = null;
      try { b = JSON.parse(raw); } catch (e) { b = null; }
      if (!b || typeof b !== "object" || Array.isArray(b)) return json({ ok: false, error: "bad json" }, 400, c);
      if (b._gotcha) return json({ ok: true }, 200, c);
      const kind = String(b.kind || "");
      if (!Object.prototype.hasOwnProperty.call(FORM_KINDS, kind)) return json({ ok: false, error: "unknown form" }, 400, c);
      const v = formClean(kind, b);
      if (v.error) return json({ ok: false, error: v.error }, 400, c);
      if (kind === "sponsor-feedback") {
        const sf = await sponsorFeedback(env, b, v.rec);
        if (sf.error) return json({ ok: false, error: sf.error }, 400, c);
      }
      if (!(await formRateOk(req, env))) return json({ ok: false, error: "too many posts; try again in an hour" }, 429, c);
      const slow = await rateLimit(req, env, path);
      if (slow) return slow;
      const ts = Date.now();
      const rnd = [...crypto.getRandomValues(new Uint8Array(4))].map(x => x.toString(16).padStart(2, "0")).join("");
      await env.SUBS.put("form:" + kind + ":" + ts + ":" + rnd,
        JSON.stringify(Object.assign({ kind, ts, n: 0 }, v.rec)), { expirationTtl: FORM_TTL_S });
      if (v.rec.logo) await rplKeep(env, v.rec.logo);   // v5.23
      return json({ ok: true }, 200, c);
    }

    if (path === "/form-list" && req.method === "GET") {
      if (!authed) return json({ ok: false }, 403);
      const kind = String(url.searchParams.get("kind") || "");
      if (kind && !Object.prototype.hasOwnProperty.call(FORM_KINDS, kind)) return json({ ok: false, error: "unknown form" }, 400);
      const onlyNew = url.searchParams.get("new") === "1";
      const out = [];
      for (const k of await listKeys(env, "form:" + (kind ? kind + ":" : ""))) {
        try {
          const r = JSON.parse(await env.SUBS.get(k));
          if (!r || (onlyNew && r.n)) continue;
          r.key = k; out.push(r);
        } catch (e) { /* skip */ }
      }
      out.sort((a, b) => (a.ts || 0) - (b.ts || 0));
      return json(out, 200, { "Access-Control-Allow-Origin": "*" });
    }

    if (path === "/form-mark" && req.method === "POST") {
      if (!authed) return json({ ok: false }, 403);
      let b = {};
      try { b = await req.json(); } catch (e) { return json({ ok: false, error: "bad json" }, 400); }
      const keys = Array.isArray(b.keys) ? b.keys.slice(0, 500) : [];
      let marked = 0;
      for (const k of keys) {
        if (typeof k !== "string" || !FORM_KEY_RE.test(k)) continue;
        const raw = await env.SUBS.get(k);
        if (!raw) continue;
        let r;
        try { r = JSON.parse(raw); } catch (e) { continue; }
        if (r.n) continue;
        r.n = 1;
        // Keep the original one-year expiry; a put without one would drop it.
        const exp = Math.max(Math.floor(Date.now() / 1000) + 120, Math.floor((r.ts || Date.now()) / 1000) + FORM_TTL_S);
        await env.SUBS.put(k, JSON.stringify(r), { expiration: exp });
        marked++;
      }
      return json({ ok: true, marked });
    }

    return json({ ok: false, error: "not found" }, 404);
  }
}
