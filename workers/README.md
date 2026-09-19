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
| `agsist-clock.js` | agsist-clock | starts `fetch_bids.yml` at :07/:37 on weekdays, the same minutes as its own cron, on a Cloudflare cron, because GitHub drops its scheduled fires (bids `poll.yml` has its own scheduler, `agsist-bid-scheduler` in the bids repo) |

Secrets live in each worker's Settings → Variables (encrypted), never in code:
- agsist-subs: `LIST_TOKEN`, `UNSUB_SECRET`; KV binding `SUBS`
- agsist-fieldscout: `SH_CLIENT_ID`, `SH_CLIENT_SECRET`
- agsist-clock: `GH_TOKEN` (fine-grained, dnilgis/agsist only, Actions read and write), `FIRE_KEY` (any long string, guards `/fire`); one Cron Trigger `7,37 11-21 * * MON-FRI`
- atlas-rma-proxy: none; the repository variable `RMA_PROXY_BASE` points the fetchers at it

After pasting a new version, verify:
- fieldscout: `GET /health` returns the new BUILD stamp
- subs: `GET /unsubscribe?e=x@y.zz&t=bad` renders the worker's own HTML page
