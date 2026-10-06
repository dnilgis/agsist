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

async function hmac16(email, secret) {
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
  try { r = raw ? JSON.parse(raw) : null; } catch (e) { r = null; }
  if (!r || typeof r !== "object") r = {};
  return {
    email,
    zip: subZip(r.zip) || null,
    src: String(r.src || ""),
    ts: Number.isFinite(r.ts) ? r.ts : null,
    reports: r.reports !== false,
  };
}

function htmlPage(msg, extraHtml) {
  return new Response(
    "<!doctype html><meta charset=utf-8><title>AGSIST</title>" +
    "<meta name=robots content=noindex>" +
    "<body style=\"font-family:Georgia,serif;max-width:480px;margin:80px auto;" +
    "padding:0 16px;color:#1a1a1a\"><h2>" + msg + "</h2>" + (extraHtml || "") +
    "<p><a href=\"https://agsist.com\">agsist.com</a></p>",
    { headers: { "Content-Type": "text/html;charset=utf-8" } });
}

// A confirmation link works for 14 days, as the privacy page says. Before
// 2026-10-06 the confirm routes only checked that the request existed, so an
// old link kept working and an unconfirmed address stayed stored indefinitely.
const PEND_TTL_MS = 14 * 24 * 3600 * 1000;
function pendExpired(rec) {
  return !rec || typeof rec.ts !== "number" || Date.now() - rec.ts > PEND_TTL_MS;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;

    // CORS preflight: browsers send OPTIONS before any JSON POST. Without
    // this, every signup form on the site fails before the POST even fires.
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: Object.assign({
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Accept",
          "Access-Control-Max-Age": "86400",
        }, cors(req)),
      });
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
      // v5.4: merge into what is already there. A bad ZIP is dropped, never
      // a reason to refuse the subscribe.
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
      await env.SUBS.put("sub:" + email, JSON.stringify(rec));
      return json({ ok: true }, 200, cors(req));
    }

    // ---------- hail alerts: register/move a watch pin ----------
    if (path === "/alert-subscribe" && req.method === "POST") {
      let b = {};
      try { b = await req.json(); } catch (e) { /* validation below */ }
      if (b._gotcha) return json({ ok: true }, 200, cors(req));
      const email = String(b.email || "").trim().toLowerCase();
      const lat = Number(b.lat), lon = Number(b.lon);
      let radius = Number(b.radius_mi) || 5;
      if (![1, 5, 10, 25].includes(radius)) radius = 5;
      const place = String(b.place || "").slice(0, 120);
      if (!EMAIL_RE.test(email) || email.length > 254)
        return json({ ok: false, error: "invalid email" }, 400, cors(req));
      if (!(lat >= 24 && lat <= 50 && lon >= -125 && lon <= -66))
        return json({ ok: false, error: "pin outside the continental US" }, 400, cors(req));
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
      const valid = EMAIL_RE.test(e) && t === await hmac16(e, env.UNSUB_SECRET);
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
      if (b._gotcha) return json({ ok: true }, 200, cors(req));
      const email = String(b.email || "").trim().toLowerCase();
      const fips = String(b.fips || "").trim();
      if (!EMAIL_RE.test(email) || email.length > 254)
        return json({ ok: false, error: "invalid email" }, 400, cors(req));
      if (!/^\d{5}$/.test(fips))
        return json({ ok: false, error: "invalid county" }, 400, cors(req));
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
      const want = await hmac16(e + (conf ? "|c|" + f : (f ? "|w|" + f : "|w")), env.UNSUB_SECRET);
      if (!(EMAIL_RE.test(e) && fOk && t === want)) return htmlPage("That link isn't valid.");
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
    const token = url.searchParams.get("token") || "";
    const authed = env.LIST_TOKEN && token === env.LIST_TOKEN;

    if (path === "/list" && req.method === "GET") {
      if (!authed) return json({ ok: false }, 403);
      const keys = await listKeys(env, "sub:");
      if (url.searchParams.get("format") === "json") {
        // v5.4: one record per address, for the per-reader email.
        const out = [];
        for (const k of keys) out.push(subRecord(k.slice(4), await env.SUBS.get(k)));
        return json(out, 200, { "Access-Control-Allow-Origin": "*" });
      }
      return new Response(keys.map(k => k.slice(4)).join("\n"),
        { headers: { "Content-Type": "text/plain;charset=utf-8",
                     "Access-Control-Allow-Origin": "*" } });
    }

    if (path === "/count" && req.method === "GET") {
      // v5.4: totals for the private dashboard. Counts only, no addresses.
      if (!authed) return json({ ok: false }, 403);
      const subs = await listKeys(env, "sub:");
      let withZip = 0;
      const bySource = {};
      for (const k of subs) {
        const r = subRecord(k.slice(4), await env.SUBS.get(k));
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
      }, 200, { "Access-Control-Allow-Origin": "*" });
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
      const plabel = String(b.plabel || "").trim();
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
      if (b._gotcha) return json({ ok: true }, 200, cors(req));
      const email = String(b.email || "").trim().toLowerCase();
      const wid = String(b.wid || "").trim().toLowerCase();
      const label = String(b.label || "").trim().slice(0, 120);
      if (!EMAIL_RE.test(email) || email.length > 254)
        return json({ ok: false, error: "invalid email" }, 400, cors(req));
      if (!/^[a-f0-9]{8,16}$/.test(wid))
        return json({ ok: false, error: "invalid elevator id" }, 400, cors(req));
      if (!label)
        return json({ ok: false, error: "invalid label" }, 400, cors(req));
      const ev = eValidate(b);
      if (ev.error) return json({ ok: false, error: ev.error }, 400, cors(req));
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
      const want = await hmac16(e + (conf ? "|ec|" + w : (w ? "|ew|" + w : "|ew")), env.UNSUB_SECRET);
      if (!(EMAIL_RE.test(e) && wOk && t === want)) return htmlPage("That link isn't valid.");
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
      if (b._gotcha) return json({ ok: true }, 200, cors(req));
      const email = String(b.email || "").trim().toLowerCase();
      const pid = String(b.pid || "").trim().toLowerCase();
      const symbol = String(b.symbol || "").trim().toLowerCase();
      const direction = String(b.direction || "").trim().toLowerCase();
      const target_cents = Number(b.target_cents);
      const label = String(b.label || "").trim().slice(0, 120);
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
      const want = await hmac16(e + (conf ? "|pc|" + p : (p ? "|pw|" + p : "|pw")), env.UNSUB_SECRET);
      if (!(EMAIL_RE.test(e) && pOk && t === want)) return htmlPage("That link isn't valid.");
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
          await env.SUBS.put("sub:" + e, JSON.stringify({ ts: Date.now(), src: "import" }));
          added++;
        } else if (e) skipped++;
      }
      return json({ ok: true, added, skipped }, 200,
        { "Access-Control-Allow-Origin": "*" });
    }

    return json({ ok: false, error: "not found" }, 404);
  },
};
