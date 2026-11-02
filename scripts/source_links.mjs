// The direct-link rule for data sources (Sig, Oct 29, 2026), for the node bakers and tests.
// One definition: the two patterns are read from scripts/source_links.py, never copied here.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PY = readFileSync(fileURLToPath(new URL("./source_links.py", import.meta.url)), "utf8");
const pat = (name) => {
  const m = PY.match(new RegExp("^" + name + " = re\\.compile\\(r'''([\\s\\S]*?)''', re\\.I\\)", "m"));
  if (!m) throw new Error("source_links.py: no " + name + " pattern");
  return new RegExp(m[1], "i");
};
export const DATA_SOURCE = pat("DATA_SOURCE");
export const KEEP = pat("KEEP");

const unesc = (u) => String(u || "").replace(/&amp;/g, "&");

/** true for a link straight at a data source (dataset, report, download, API, feed, query) */
export function isDataSource(url) {
  const u = unesc(url);
  if (!/^https?:\/\//i.test(u) || /^https?:\/\/([a-z0-9-]+\.)*agsist\.com/i.test(u)) return false;
  return DATA_SOURCE.test(u) && !KEEP.test(u);
}

/** an <a> for a link that may stay, else the text alone (textHtml is already escaped) */
export function link(url, textHtml, attrs = "") {
  if (isDataSource(url)) return textHtml;
  return `<a href="${String(url).replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"${attrs}>${textHtml}</a>`;
}

const ANCHOR = /<a\b[^<>]*?href\s*=\s*(\\?["'])(https?:\/\/[^"'\\]+)\1[^<>]*>([\s\S]*?)<\/a\s*>/gi;

/** the data-source links in a page or fragment */
export function scan(text) {
  return [...String(text).matchAll(ANCHOR)].map((m) => m[2]).filter(isDataSource);
}

/** every data-source <a> replaced by its text */
export function unlink(text) {
  return String(text).replace(ANCHOR, (all, q, u, inner) => (isDataSource(u) ? inner : all));
}
