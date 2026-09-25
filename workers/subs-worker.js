/**
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

function htmlPage(msg, extraHtml) {
  return new Response(
    "<!doctype html><meta charset=utf-8><title>AGSIST</title>" +
    "<meta name=robots content=noindex>" +
    "<body style=\"font-family:Georgia,serif;max-width:480px;margin:80px auto;" +
    "padding:0 16px;color:#1a1a1a\"><h2>" + msg + "</h2>" + (extraHtml || "") +
    "<p><a href=\"https://agsist.com\">agsist.com</a></p>",
    { headers: { "Content-Type": "text/html;charset=utf-8" } });
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
      let email = "", src = "", trap = "";
      const ct = req.headers.get("Content-Type") || "";
      try {
        if (ct.includes("json")) {
          const b = await req.json();
          email = b.email || ""; src = b.source || ""; trap = b._gotcha || "";
        } else {
          const f = await req.formData();
          email = f.get("email") || ""; src = f.get("source") || ""; trap = f.get("_gotcha") || "";
        }
      } catch (e) { /* validation below */ }
      email = String(email).trim().toLowerCase();
      if (trap) return json({ ok: true }, 200, cors(req));
      if (!EMAIL_RE.test(email) || email.length > 254)
        return json({ ok: false, error: "invalid email" }, 400, cors(req));
      await env.SUBS.put("sub:" + email,
        JSON.stringify({ ts: Date.now(), src: String(src).slice(0, 60) }));
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
          if (!(f in r.pend)) return htmlPage("This confirmation link has expired. Sign up again on the county page.");
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
      return new Response(keys.map(k => k.slice(4)).join("\n"),
        { headers: { "Content-Type": "text/plain;charset=utf-8",
                     "Access-Control-Allow-Origin": "*" } });
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
