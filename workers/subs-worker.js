/**
 * UNSUB_SECRET MUST BE SET on this Worker in Cloudflare (Settings -> Variables
 *   and Secrets), the same value the Actions jobs sign links with. Check it:
 *   GET /count?token=... answers "secret": true or false (never the value).
 *   Without it, confirm links answer 503; unsubscribe links still work, unchecked.
 * Deploys from GitHub: Cloudflare Workers Builds runs wrangler.subs.toml on
 *   every push to main that touches this file. No more pasting into the dashboard.
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
 *   POST /notice-mark?token=  {email, topic}: records the notice as sent.
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
 *   POST /sponsor-apply  JSON {tier: page|supporter|founding, slot, company,
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
 * Bindings/secrets (unchanged): KV binding SUBS; secrets LIST_TOKEN, UNSUB_SECRET.
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
  "/elevator-watch-subscribe", "/price-watch-subscribe", "/sponsor-apply", "/form"]);
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
    if (names.length >= lim[2] || !page.list_complete) return deny();
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
// before that FSA ARC/PLC signup deadline. Anything else is refused.
const NOTE_MAX = 20;
const RENT_STATES = new Set(("al ak az ar ca co ct de fl ga hi id il in ia ks ky la me md ma mi mn ms mo mt ne nv nh nj nm ny nc nd oh ok or pa ri sc sd tn tx ut vt va wa wv wi wy").split(" "));
function noticeTopic(v, anyDate) {
  const t = String(v == null ? "" : v).trim().toLowerCase();
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
const SAPP_TIERS = { page: "page", supporter: "footer", founding: "briefing" };
const SAPP_LABEL = { page: "Own a page", supporter: "Supporter", founding: "Sponsor" };
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
  },
  // v5.12: Rain Print business quotes (rain-print.html#rp-biz). Sig emails back a quote and proofs.
  "rain-print-business": {
    business: [120, true], name: [80, true], email: [254, true, "email"], phone: [30],
    quantity: [3, true, "rpqty"], product: [10, true, "rpbproduct"], towns: [8000, true, "text"],
    ship: [10, true, "rpbship"], note_all: [300, false, "text"], notes: [2000, false, "text"], page: [60],
  },
};
const RP_CHOICES = ["digital", "print12x18", "framed12x18"];
const RP_DELIVER = ["buyer", "recipient"];
const RPB_PRODUCTS = ["print", "framed", "digital", "not-sure"];
const RPB_SHIP = ["one", "each", "not-sure"];
const RPB_QTY_MIN = 10, RPB_QTY_MAX = 500;   // business orders start at 10 prints
const FORM_MAX_BYTES = 16 * 1024;
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
      // a whole number of prints, 10 to 500, stored as its digits ("010" is "10")
      if (!/^\d{1,3}$/.test(v) || +v < RPB_QTY_MIN || +v > RPB_QTY_MAX) return { error: "invalid " + f };
      v = String(+v);
    } else if (type === "rpbproduct") {
      if (!RPB_PRODUCTS.includes(v)) return { error: "invalid " + f };
    } else if (type === "rpbship") {
      if (!RPB_SHIP.includes(v)) return { error: "invalid " + f };
    } else if (type === "url") {
      if (!/^https?:\/\//i.test(v)) v = "https://" + v;
      try { const u = new URL(v); if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".")) throw 0; }
      catch (e) { return { error: "invalid " + f }; }
      if (v.length > max) return { error: f + " is too long" };
    }
    out[f] = v;
  }
  if (kind === "rain-print-order") {
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

    // v5.13: origin and content type, before any public POST reads its body.
    if (req.method === "POST" && PUBLIC_POSTS.has(path)) {
      const refused = publicGate(req, path);
      if (refused) return refused;
    }

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
      if (!(topic in r.t)) r.t[topic] = { ts: Date.now(), src };
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
          out.push({ email: k.slice(5), topic, ts: v && v.ts || null, src: v && v.src || "", sent: v && v.sent || null });
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
      if (!r || !r.t || !(topic in r.t)) return json({ ok: true, skipped: true });   // stopped while the job ran
      r.t[topic].sent = Date.now();
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
      if (!authed) return json({ ok: false }, 403);
      const out = [];
      for (const k of await listKeys(env, "sapp:")) {
        try { out.push(JSON.parse(await env.SUBS.get(k))); } catch (e) { /* skip */ }
      }
      return json(out);
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
