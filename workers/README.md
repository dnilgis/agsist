# Cloudflare Workers — canonical sources

The deployed workers run in Cloudflare, but THIS DIRECTORY is the source of
truth. Every edit happens here first, gets committed, and is then pasted into
the Cloudflare dashboard (Workers & Pages → worker → Edit code) or deployed
with wrangler. Never edit in the dashboard without landing the same change
here — "the code only exists in Cloudflare" is how we nearly lost two workers
on 2026-07-18.

| file | worker | serves |
|---|---|---|
| `subs-worker.js` | agsist-subs | daily-briefing list, hail-alert pins, watches, sponsor sign-ups, the site's three forms, unsubscribes, send-dedup flags |
| `fieldscout-worker.js` | agsist-fieldscout | NDVI/moisture tiles, SSURGO, CDL rotation, hail history, drought, index stats |
| `atlas-rma-proxy.js` | atlas-rma-proxy | RMA Summary of Business zips and FSA's two CRP workbooks, for the runners those hosts do not answer |
| `barchart-proxy.js` | agsist-barchart | Barchart OnDemand quotes, key held server-side |

Secrets live in each worker's Settings → Variables (encrypted), never in code:
- agsist-subs: `LIST_TOKEN`, `UNSUB_SECRET`; KV binding `SUBS`
- agsist-fieldscout: `SH_CLIENT_ID`, `SH_CLIENT_SECRET`
- agsist-barchart: `BARCHART_API_KEY`
- atlas-rma-proxy: none; the repository variable `RMA_PROXY_BASE` points the fetchers at it

Scheduling is not done here. GitHub's own cron drops fires, so the workflows
that must run on time (`fetch_bids.yml`, `prices.yml`) are also started from
cron-job.org with a workflow_dispatch POST; the GitHub cron stays as a fallback.

Deploys run from GitHub (Cloudflare Workers Builds, root `workers`, deploy command `npx wrangler@4.149.0 deploy --config wrangler.subs.toml`, pinned so a new wrangler release cannot run with the Worker's secrets unreviewed; watch paths limited to the subs files). After a deploy, verify:
- fieldscout: `GET /health` returns the new BUILD stamp
- subs: `GET /unsubscribe?e=x@y.zz&t=bad` renders the worker's own HTML page
- subs v5.5 (sponsor sign-ups): `GET /sponsor-confirm?i=000000000000&t=x` answers "This link isn't valid." (the old worker answers 404 JSON)
- subs v5.8 (site forms): `GET /form-list?token=x` answers `{"ok":false}` with status 403 (the old worker answers 404 `not found`)
- subs v5.33 (GA gate): `GET /ga-ok` answers `{"ok":true}` from a home or phone connection and `{"ok":false}` from a cloud server (the old worker answers 404 `not found`, and until then Google Analytics stays off on every page)

## Deploying subs v5.8 (site forms, 2026-10-11)

What it adds: `POST /form` (the elevator claim form, the sponsor proof
approval and requests box, the Parcel Report waitlist), the token-gated
`GET /form-list` and `POST /form-mark` that `scripts/form_digest.py` uses,
and `forms` counts in `GET /count`. Every older route answers as before.

No new secret, no new binding: it uses the `SUBS` KV binding and the
`LIST_TOKEN` / `UNSUB_SECRET` secrets the worker already has.

Deploy one of two ways:
1. Dashboard: Workers & Pages -> agsist-subs -> Edit code, select all, paste
   the whole of `workers/subs-worker.js`, Deploy.
2. Wrangler, from the repo root, once the real KV id is in
   `workers/wrangler.subs.toml` (it still says `PASTE_SUBS_NAMESPACE_ID_HERE`,
   so a deploy fails safely until it is filled in):
   `npx wrangler@4.149.0 deploy --config workers/wrangler.subs.toml`

Then check: `GET /form-list?token=x` gives 403, not 404.

Nothing changes for readers until then: the three pages try `/form` first
and, on a 404 or no answer, send to Formspree exactly as before
(`components/form-post.js`). After the deploy they land in KV and the "Site
forms digest" workflow (`.github/workflows/form-digest.yml`, same secrets as
the sponsor job; optional `FORMS_TO`) emails Sig within about 15 minutes.
Before the deploy that workflow logs "worker has no /form-list yet" and
exits cleanly. The Formspree form can be retired once a few digests have
arrived.
