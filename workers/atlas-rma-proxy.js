// atlas-rma-proxy — a Cloudflare Worker that fetches a federal file the GitHub
// runners cannot reach and streams it back. Same pattern as the Barchart proxy.
// Optional: every fetcher tries the direct URL first and uses this only when
// the repository variable RMA_PROXY_BASE is set and the direct route failed.
//
// WHY IT EXISTS
//   pubfs-rma.fpac.usda.gov   TCP connect timeout from a runner, 2026-09-13.
//                             It has answered runners directly since.
//   www.fsa.usda.gov          accepted a runner's connection and sat on it until
//                             the far end closed, twice, 629 seconds, 2026-09-17.
//                             It answers other networks in about a second. This
//                             is the only thing between the Atlas and its three
//                             CRP layers. Whether it answers Cloudflare is not
//                             yet measured; the first run after deploying says.
//
// Deploy (browser only): Cloudflare dashboard -> Workers & Pages -> Create ->
// Create Worker -> name it atlas-rma-proxy -> Deploy -> Edit code -> replace
// everything with this file -> Deploy. If it already exists, open it -> Edit
// code -> replace -> Deploy. Then in GitHub: repo Settings -> Secrets and
// variables -> Actions -> Variables -> New repository variable:
//   RMA_PROXY_BASE = https://atlas-rma-proxy.<your-subdomain>.workers.dev
//
// It serves exactly these shapes of URL and nothing else:
//   GET /colsom_YYYY.zip       -> RMA .../Summary_of_Business/cause_of_loss/colsom_YYYY.zip
//   GET /sobcov_YYYY.zip       -> RMA .../Summary_of_Business/state_county_crop/sobcov_YYYY.zip
//   GET /fsa/documents/...     -> https://www.fsa.usda.gov/documents/...
//   GET /fsa/sites/default/files/...  -> https://www.fsa.usda.gov/sites/default/files/...
// The FSA routes are limited to those two directories so the Worker cannot be
// used as a general proxy for fsa.usda.gov, let alone anything else.
const ROOT = "https://pubfs-rma.fpac.usda.gov/pub/Web_Data_Files/Summary_of_Business/";
const SHAPES = { colsom: "cause_of_loss/", sobcov: "state_county_crop/" };
const FSA = "https://www.fsa.usda.gov";
const FSA_PREFIXES = ["/documents/", "/sites/default/files/"];
const UA = "AGSIST-automation/1.0 (+https://agsist.com/farmland-atlas)";

const ALLOWED_HOSTS = ["pubfs-rma.fpac.usda.gov", "www.fsa.usda.gov"];

async function relay(upstream, type) {
  const r = await fetch(upstream, { headers: { "User-Agent": UA }, redirect: "follow" });
  // A redirect is followed, but only if it lands back on one of the two hosts
  // this Worker exists for. Anything else is refused, so the Worker can never
  // be walked off to a third site by a redirect it did not choose.
  let landed = "";
  try { landed = new URL(r.url || upstream).hostname; } catch (e) {}
  if (!ALLOWED_HOSTS.includes(landed)) return new Response("redirected off host", { status: 502 });
  if (!r.ok) return new Response("upstream " + r.status, { status: r.status === 404 ? 404 : 502 });
  return new Response(r.body, { status: 200, headers: {
    "content-type": type || r.headers.get("content-type") || "application/octet-stream",
    "cache-control": "public, max-age=86400" } });
}

export default {
  async fetch(request) {
    const path = new URL(request.url).pathname;
    const m = path.match(/^\/(colsom|sobcov)_(19[89]\d|20\d\d)\.zip$/);
    if (m) return relay(ROOT + SHAPES[m[1]] + m[1] + "_" + m[2] + ".zip", "application/zip");
    if (path.startsWith("/fsa/")) {
      const rest = path.slice(4);                       // keeps the leading slash
      // Plain path characters, and %20 (a space in a file name) as the one
      // escape allowed. No other "%", so no encoded dot or slash can pass the
      // prefix check and be decoded into another directory upstream.
      if (!/^(?:[A-Za-z0-9._\/-]|%20)+$/.test(rest) || rest.includes("..") || rest.includes("//") ||
          !FSA_PREFIXES.some(p => rest.startsWith(p)))
        return new Response("not found", { status: 404 });
      return relay(FSA + rest);
    }
    return new Response("not found", { status: 404 });
  }
};
