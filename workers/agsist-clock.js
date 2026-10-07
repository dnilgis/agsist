// v2 (2026-10-07): ALSO KEEPS THE PRICE LOOP ALIVE. prices.yml runs one
// ~5h20m loop per launch, started by GitHub cron -- and on Wed 2026-10-07 the
// 08:17 CT launch and the 11:03 CT recovery were BOTH dropped: the morning
// loop ran out at 08:55 CT and the homepage held 8:55 prices until 11:16 CT,
// mid-session. Now every fire also asks GitHub whether a Fetch Prices run is
// queued or in progress, and if none is and the market is open, starts one.
// It never starts a second (prices.yml has cancel-in-progress, so a second
// would kill a healthy loop): it only fills a gap.
//   Price window, Central time: Mon-Fri 05:00-14:00 (overnight tail, day
//   session, close), and Sun-Thu 18:45-02:30 (Globex evening).
// CRON TRIGGER CHANGES to "7,22,37,52 * * * *" (still ONE trigger), so the
// gap check runs every 15 minutes around the clock; due() below still starts
// fetch_bids.yml only at :07 and :37, 11-21 UTC, weekdays, exactly as before.
//
// agsist-clock — starts agsist's fetch_bids.yml on time, because GitHub's own
// schedule does not.
//
// MEASURED 2026-09-18: fetch_bids.yml asks for a run at :07 and :37, 6am-4pm
// CT, 22 a weekday. Four landed that day. Every successful run commits (the
// file carries its own `fetched` stamp), so four commits is four runs.
//
// WHAT THIS IS NOT FOR. dnilgis/bids poll.yml is already started every ten
// minutes by agsist-bid-scheduler (bids/worker-scheduler), and on 2026-09-19
// its commits land every ten minutes. Its midday gaps on 9/18 were ~40 minutes
// apart and OFF the ten-minute grid -- runs going back to back, each that long,
// not fires being dropped. A second scheduler would not shorten a run. That is
// a separate question about poll.yml's run length.
//
// ONE PULL PER HALF HOUR, NOT TWO. fetch_bids.yml's own cron stays, and this
// fires on the SAME minutes and hours as that cron (:07 and :37, 11-21 UTC,
// weekdays). When GitHub delivers too, the concurrency group runs one and
// queues the other, and the workflow's first job stops the queued one because
// the fetch it would repeat is minutes old. When GitHub drops its fire, this
// one fetches. Barchart OnDemand is paid; this never adds a pull and never
// widens the window.
//
// ONE CRON TRIGGER (v2: "7,22,37,52 * * * *"; v1 was "7,37 11-21 * * MON-FRI"). Cron Triggers are per ACCOUNT: 5
// on the free plan. agsist-bid-scheduler uses 3, so this makes 4. UTC
// throughout. The weekday names are spelt out because Cloudflare numbers the
// week 1-7 and GitHub 0-6 (bids/worker-scheduler/wrangler.toml has the story);
// MON-FRI means the same thing to both. due() below checks the same window
// again, so a trigger typed differently can never start a run outside it.
//
// DEPLOY (browser only) -- the kit README has the click paths:
//   Worker named agsist-clock, this file pasted over the starter code;
//   secret GH_TOKEN  = fine-grained token, dnilgis/agsist only, Actions: Read and write;
//   secret FIRE_KEY  = any long random string you make up, for /fire below;
//   Cron Trigger "7,22,37,52 * * * *" (v2).
//
// CHECK IT: open  https://agsist-clock.<your-subdomain>.workers.dev/fire?key=<FIRE_KEY>
//   It dispatches fetch_bids.yml once, right now, and shows GitHub's answer.
//   204 means the token works. Then the Actions tab of dnilgis/agsist shows a
//   "Fetch Grain Bids" run started by workflow_dispatch.

const OWNER = "dnilgis";
const REPO = "agsist";
const WORKFLOW = "fetch_bids.yml";
// Exactly fetch_bids.yml's cron: '7,37 11-21 * * 1-5'. 11:07-21:37 UTC is
// 6:07am-4:37pm CDT and 5:07am-3:37pm CST.
const MINUTES = [7, 37];
const FIRST_HOUR = 11, LAST_HOUR = 21;

function due(date) {
  const d = date.getUTCDay(), h = date.getUTCHours(), m = date.getUTCMinutes();
  return d >= 1 && d <= 5 && h >= FIRST_HOUR && h <= LAST_HOUR && MINUTES.includes(m);
}

const PRICES = "prices.yml";

// Central-time weekday (0=Sun) and minutes since midnight, DST-correct.
function ct(date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date).map(x => [x.type, x.value]));
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { dow, min: (+p.hour) * 60 + (+p.minute) };
}
function pricesWanted(date) {
  const { dow, min } = ct(date);
  if (dow >= 1 && dow <= 5 && min >= 5 * 60 && min < 14 * 60) return true;          // overnight tail + day session
  if (dow >= 0 && dow <= 4 && min >= 18 * 60 + 45) return true;                      // Globex evening, Sun-Thu
  if (dow >= 1 && dow <= 5 && min < 2 * 60 + 30) return true;                        // ...and past midnight, Mon-Fri
  return false;
}

function gh(token, path, init) {
  return fetch(`https://api.github.com/repos/${OWNER}/${REPO}${path}`, Object.assign({
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "agsist-clock (+https://agsist.com)",
    },
  }, init || {}));
}

// Is a Fetch Prices loop already queued or running? Unknown counts as yes:
// starting a second loop would cancel a healthy one.
async function pricesRunning(token) {
  for (const st of ["in_progress", "queued"]) {
    const r = await gh(token, `/actions/workflows/${PRICES}/runs?status=${st}&per_page=1`);
    if (!r.ok) return true;
    const j = await r.json();
    if ((j.total_count || 0) > 0) return true;
  }
  return false;
}

async function keepPrices(token, when) {
  if (!pricesWanted(when)) return "prices: outside the window";
  if (await pricesRunning(token)) return "prices: loop running";
  const r = await dispatch(token, PRICES);
  if (r.status !== 204) throw new Error(`prices dispatch failed: HTTP ${r.status} ${r.detail}`);
  return "prices: NO LOOP RUNNING -> started one";
}

async function dispatch(token, workflow) {
  const r = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${workflow || WORKFLOW}/dispatches`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "agsist-clock (+https://agsist.com)",   // GitHub refuses a request without one
    },
    body: JSON.stringify({ ref: "main" }),
  });
  let detail = "";
  if (r.status !== 204) { try { detail = (await r.text()).slice(0, 200); } catch (e) {} }
  return { status: r.status, detail };
}

export default {
  async scheduled(controller, env, ctx) {
    const when = new Date(controller.scheduledTime);
    // A MISSING OR DEAD TOKEN THROWS, it does not log and return. A handler that
    // returns normally is recorded by Cloudflare as a success, and a token that
    // expired would then fail quietly for weeks. 401/403: the token is wrong,
    // expired, or lacks Actions write. 404: it cannot see the repo or workflow.
    if (!env.GH_TOKEN) throw new Error("GH_TOKEN is not set; nothing started");
    const errs = [];
    try { console.log(`${when.toISOString()} ${await keepPrices(env.GH_TOKEN, when)}`); }
    catch (e) { errs.push(String(e.message || e)); }
    if (due(when)) {
      const r = await dispatch(env.GH_TOKEN);
      console.log(`${when.toISOString()} ${REPO}/${WORKFLOW} -> HTTP ${r.status}${r.detail ? " " + r.detail : ""}`);
      if (r.status !== 204) errs.push(`dispatch failed: HTTP ${r.status} ${r.detail}`);
    }
    if (errs.length) throw new Error(errs.join("; "));
  },

  // /fire?key=...  one dispatch now, to prove the token without waiting for a
  //                weekday; refused unless FIRE_KEY is set and matches.
  // anything else  a plain status page; it never shows the token.
  async fetch(request, env) {
    const u = new URL(request.url);
    if (u.pathname === "/fire") {
      if (!env.FIRE_KEY) return new Response("FIRE_KEY is not set; refusing to expose an unauthenticated trigger\n", { status: 403 });
      if (u.searchParams.get("key") !== env.FIRE_KEY) return new Response("forbidden\n", { status: 403 });
      if (!env.GH_TOKEN) return new Response("GH_TOKEN is not set\n", { status: 500 });
      const r = await dispatch(env.GH_TOKEN);
      return new Response(`${REPO}/${WORKFLOW} -> HTTP ${r.status}${r.status === 204 ? " (started)" : " " + r.detail}\n`,
        { status: r.status === 204 ? 200 : 502, headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    const now = new Date();
    return new Response([
      "agsist-clock",
      `now (UTC): ${now.toISOString()}`,
      `GH_TOKEN set: ${env.GH_TOKEN ? "yes" : "NO -- nothing will be started"}`,
      `FIRE_KEY set: ${env.FIRE_KEY ? "yes" : "no (/fire is refused)"}`,
      `starts ${OWNER}/${REPO} ${WORKFLOW} at minutes ${MINUTES.join(",")} of hours ${FIRST_HOUR}-${LAST_HOUR} UTC, Mon-Fri`,
      `restarts ${PRICES} when no price loop is running: Mon-Fri 05:00-14:00 CT and Sun-Thu 18:45-02:30 CT (v2)`,
      `price window open now: ${pricesWanted(now) ? "yes" : "no"}`,
    ].join("\n") + "\n", { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  },
};
