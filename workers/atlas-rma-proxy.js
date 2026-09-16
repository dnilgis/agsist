// atlas-rma-proxy — a Cloudflare Worker that fetches one RMA Summary of Business
// zip and streams it back. It exists because pubfs-rma.fpac.usda.gov does not
// answer GitHub's runners (TCP connect timeout, measured 2026-09-13) but does
// answer Cloudflare. Same pattern as the Barchart proxy. Optional: the fetchers
// try the direct URL first and use this only when RMA_PROXY_BASE is set and the
// direct route failed.
//
// Deploy (browser only): Cloudflare dashboard -> Workers & Pages -> Create ->
// Create Worker -> name it atlas-rma-proxy -> Deploy -> Edit code -> replace
// everything with this file -> Deploy. Then in GitHub: repo Settings -> Secrets
// and variables -> Actions -> Variables -> New repository variable:
//   RMA_PROXY_BASE = https://atlas-rma-proxy.<your-subdomain>.workers.dev
//
// It serves exactly two shapes of URL and nothing else:
//   GET /colsom_YYYY.zip -> .../Summary_of_Business/cause_of_loss/colsom_YYYY.zip
//   GET /sobcov_YYYY.zip -> .../Summary_of_Business/state_county_crop/sobcov_YYYY.zip
const ROOT = "https://pubfs-rma.fpac.usda.gov/pub/Web_Data_Files/Summary_of_Business/";
const SHAPES = { colsom: "cause_of_loss/", sobcov: "state_county_crop/" };
export default {
  async fetch(request) {
    const m = new URL(request.url).pathname.match(/^\/(colsom|sobcov)_(19[89]\d|20\d\d)\.zip$/);
    if (!m) return new Response("not found", { status: 404 });
    const upstream = ROOT + SHAPES[m[1]] + m[1] + "_" + m[2] + ".zip";
    const r = await fetch(upstream, { headers: { "User-Agent": "AGSIST-automation/1.0 (+https://agsist.com/farmland-atlas)" } });
    if (!r.ok) return new Response("upstream " + r.status, { status: r.status === 404 ? 404 : 502 });
    return new Response(r.body, { status: 200, headers: { "content-type": "application/zip", "cache-control": "public, max-age=86400" } });
  }
};
