# Cloudflare Workers — canonical sources

The deployed workers run in Cloudflare, but THIS DIRECTORY is the source of
truth. Every edit happens here first, gets committed, and is then pasted into
the Cloudflare dashboard (Workers & Pages → worker → Edit code) or deployed
with wrangler. Never edit in the dashboard without landing the same change
here — "the code only exists in Cloudflare" is how we nearly lost two workers
on 2026-07-18.

| file | worker | serves |
|---|---|---|
| `subs-worker.js` | agsist-subs | daily-briefing list, hail-alert pins, unsubscribes, send-dedup flags |
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

After pasting a new version, verify:
- fieldscout: `GET /health` returns the new BUILD stamp
- subs: `GET /unsubscribe?e=x@y.zz&t=bad` renders the worker's own HTML page
- subs v5.5 (sponsor sign-ups): `GET /sponsor-confirm?i=000000000000&t=x` answers "This link isn't valid." (the old worker answers 404 JSON)
