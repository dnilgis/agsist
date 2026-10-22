# Cloudflare Workers — canonical sources

The deployed workers run in Cloudflare, but THIS DIRECTORY is the source of
truth. Every edit happens here first, gets committed, and is then pasted into
the Cloudflare dashboard (Workers & Pages → worker → Edit code) or deployed
with wrangler. Never edit in the dashboard without landing the same change
here — "the code only exists in Cloudflare" is how we nearly lost two workers
on 2026-07-18.

| file | worker | serves |
|---|---|---|
| `subs-worker.js` | agsist-api (new home, Oct 22, 2026; was agsist-subs) | daily-briefing list, hail-alert pins, watches, sponsor sign-ups, the site's three forms, unsubscribes, send-dedup flags |
| `fieldscout-worker.js` | agsist-fieldscout | NDVI/moisture tiles, SSURGO, CDL rotation, hail history, drought, index stats |
| `atlas-rma-proxy.js` | atlas-rma-proxy | RMA Summary of Business zips and FSA's two CRP workbooks, for the runners those hosts do not answer |
| `barchart-proxy.js` | agsist-barchart | Barchart OnDemand quotes, key held server-side |

Secrets live in each worker's Settings → Variables (encrypted), never in code:
- agsist-api (and the old agsist-subs): see "The agsist-api Worker" below for the full list; KV binding `SUBS`
- agsist-fieldscout: `SH_CLIENT_ID`, `SH_CLIENT_SECRET`
- agsist-barchart: `BARCHART_API_KEY`
- atlas-rma-proxy: none; the repository variable `RMA_PROXY_BASE` points the fetchers at it

Scheduling is not done here. GitHub's own cron drops fires, so the workflows
that must run on time (`fetch_bids.yml`, `prices.yml`) are also started from
cron-job.org with a workflow_dispatch POST; the GitHub cron stays as a fallback.

Deploys run from GitHub (Cloudflare Workers Builds, root `workers`, deploy command `npx wrangler@4.149.0 deploy --config wrangler.api.toml` for agsist-api, `wrangler.subs.toml` for the old agsist-subs, pinned so a new wrangler release cannot run with the Worker's secrets unreviewed; watch paths limited to the subs files). After a deploy, verify:
- fieldscout: `GET /health` returns the new BUILD stamp
- subs: `GET /unsubscribe?e=x@y.zz&t=bad` renders the worker's own HTML page
- subs v5.5 (sponsor sign-ups): `GET /sponsor-confirm?i=000000000000&t=x` answers "This link isn't valid." (the old worker answers 404 JSON)
- subs v5.8 (site forms): `GET /form-list?token=x` answers `{"ok":false}` with status 403 (the old worker answers 404 `not found`)
- subs v5.33 (GA gate): `GET /ga-ok` answers `{"ok":true}` from a home or phone connection and `{"ok":false}` from a cloud server (the old worker answers 404 `not found`, and until then Google Analytics stays off on every page)

## The agsist-api Worker (Oct 22, 2026)

Cloudflare blocked the old host, agsist-subs.dnilgis.workers.dev, on Oct 21
(phishing interstitial). Support said in writing that replacing it with a new
Worker on the same account is Sig's call. The same `subs-worker.js` now runs
as a new Worker, **agsist-api**, at `https://agsist-api.dnilgis.workers.dev`.
Every page, component and script calls the new host. The lists that must take
either host while both may answer: the signup backup in `components/loader.js`,
`components/outbox.js` (a kept item goes to the new host), `sw.js`
NEVER_CACHE, and `data/audit-expected.json`. `wrangler.subs.toml` stays so
the old Worker's build still works until it is deleted. Emails never name
either host: `scripts/email_links.py` refuses any `*.workers.dev` link.

### Workers Builds settings (Cloudflare, Workers & Pages, Create, Import a repository)
- Repository: `dnilgis/agsist`, production branch `main`
- Worker name: `agsist-api` (must match `name` in `wrangler.api.toml`)
- Root directory: `workers`
- Build command: none (leave empty)
- Deploy command: `npx wrangler@4.149.0 deploy --config wrangler.api.toml`
- Non-production branch builds: off
- Build watch paths, include: `workers/subs-worker.js`, `workers/wrangler.api.toml`
- KV binding: `SUBS` -> namespace id `9024f0b7ca5948bf9ed98d6135d73357` (the same store the
  old Worker uses; `wrangler.api.toml` declares it, so the first deploy binds it)

### Secrets and variables (Settings, Variables and Secrets; every key as type Secret)
Read from `env.*` in `subs-worker.js`. None of them is in this repo.

| name | kind | what it is | needed for |
|---|---|---|---|
| `LIST_TOKEN` | Secret | Bearer token for the list, count, export and Sig-only routes. Must equal the GitHub secret `LIST_TOKEN`. | every sender job, the morning report, backups, the Today page |
| `UNSUB_SECRET` | Secret | HMAC key for every signed link and lookup key. Must equal the GitHub secret `UNSUB_SECRET`. | unsubscribe and confirm links, link ids, gift cards, elevator desk keys, hay edit keys, sponsor report links, proof approval |
| `STRIPE_WEBHOOK_SECRET` | Secret | the signing secret (`whsec_...`) of the Stripe webhook endpoint that points at this Worker | `POST /rp-order/stripe` (503 without it) |
| `STRIPE_READ_KEY` | Secret | Stripe restricted key, Checkout Sessions Read and Charges Read only (`rk_live_...`) | `/rp-order/list` reading paid sessions from Stripe |
| `GH_DISPATCH_TOKEN` | Secret | GitHub fine-grained token, repository dnilgis/agsist only, Actions: Read and write (Metadata: Read comes with it) | starting `rp-buyer-email.yml` and `rp-design-email.yml` |
| `RP_BUYER_EMAIL_LIVE` | Variable | `1` = buyer emails reach buyers; anything else sends them to Sig only | Rain Print buyer email |
| `RP_DESIGN_EMAIL_LIVE` | Variable | `1` = "email me this design" reaches readers; anything else is a dry run to Sig | Rain Print design email |

`SUBS` is the KV binding, not a secret. A missing `UNSUB_SECRET` makes confirm links answer 503;
a missing `LIST_TOKEN` makes every token route answer 403.

A fresh `UNSUB_SECRET` (a new value, not the old one) also changes every key made from it: links
already in inboxes stop checking out (a stop link then answers "That unsubscribe link no longer
works." with the email-to-stop line, v5.52), and gift card codes, elevator desk keys, hay board
edit keys, sponsor report links and proof approval links made before the change no longer match.

### Outside this repo, the new host goes in
- GitHub secret `LIST_URL` in dnilgis/agsist: `https://agsist-api.dnilgis.workers.dev` (about 20 jobs read it).
- Stripe webhook endpoint: `https://agsist-api.dnilgis.workers.dev/rp-order/stripe`, events
  `checkout.session.completed` and `checkout.session.async_payment_succeeded`. A new endpoint
  has a new signing secret: that goes into `STRIPE_WEBHOOK_SECRET` above. The old endpoint
  (old host, agsist-subs.dnilgis.workers.dev/rp-order/stripe) is disabled once the new one answers.
- dnilgis/bids reads the elevator feed and the paste status from the new host (its own PR).

### Check after the first deploy
- `GET /unsubscribe?k=abcdefghjkmnpqrs&t=0000000000000000` answers 403 with "That unsubscribe
  link no longer works." (v5.52; older code answers "That link isn't valid.")
- `GET /ga-ok` answers `{"ok":true}` from a home or phone connection
- `GET /count` with `Authorization: Bearer <LIST_TOKEN>` answers `{"ok":true,...}` with `"secret": true`
- `GET /elev/feed` answers JSON with an `elevators` list

## Deploying subs v5.8 (site forms, 2026-10-11)

What it adds: `POST /form` (the elevator claim form, the sponsor proof
approval and requests box, the Parcel Report waitlist), the token-gated
`GET /form-list` and `POST /form-mark` that `scripts/form_digest.py` uses,
and `forms` counts in `GET /count`. Every older route answers as before.

No new secret, no new binding: it uses the `SUBS` KV binding and the
`LIST_TOKEN` / `UNSUB_SECRET` secrets the worker already has.

Deploy one of two ways:
1. Dashboard: Workers & Pages -> agsist-api (then agsist-subs) -> Edit code, select all, paste
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
