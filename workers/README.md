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

Secrets live in each worker's Settings → Variables (encrypted), never in code:
- agsist-subs: `LIST_TOKEN`, `UNSUB_SECRET`; KV binding `SUBS`
- agsist-fieldscout: `SH_CLIENT_ID`, `SH_CLIENT_SECRET`

After pasting a new version, verify:
- fieldscout: `GET /health` returns the new BUILD stamp
- subs: `GET /unsubscribe?e=x@y.zz&t=bad` renders the worker's own HTML page
