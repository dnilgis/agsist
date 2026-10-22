#!/usr/bin/env node
/* scripts/build_rp_sealed.mjs: the Rain Print QR keeps working with the subs
 * worker down (Oct 22, 2026, after the Cloudflare block).
 *
 * A printed Rain Print carries HTTPS://AGSIST.COM/R?<id>. /r asks the worker
 * for the design code behind <id> (rps:<id> in its storage). When the worker
 * does not answer, /r opens a sealed copy instead, written here from the
 * private daily copy of the worker's storage (feedbag, private-data,
 * kv-backup/latest.json.gz) into data/rp-sealed/ on agsist.com:
 *
 *   bits  = PBKDF2-SHA256(password = id, salt = SALT, ITERATIONS, 256 bits)
 *   name  = hex(HKDF-SHA256(bits, info "name", 16 bytes))   the file name
 *   key   = HKDF-SHA256(bits, info "key") as an AES-256-GCM key
 *   file  = data/rp-sealed/<name>.bin = 0x01 | iv (12) | AES-GCM(key, iv,
 *           code padded with "." to PAD bytes, additional data = name)
 *
 * One slow derivation, split two ways with HKDF: the phone pays for PBKDF2
 * once, and an attacker gains nothing from the split (finding a file name
 * already costs the full PBKDF2). The design map itself is never published:
 * no id, no list of ids, no plaintext, no index file; every file is the same
 * size whatever the code's length. Only the page (r.html, same constants)
 * and this script know the recipe, and both are public on purpose: the
 * secret is the id printed on the paper.
 *
 * THREAT MODEL. The repo is public, so anyone can list the file names. To
 * open one they must guess its id and run the full KDF for every guess:
 * there is no shortcut from a name back to an id. Ids made before Oct 22,
 * 2026 are 5 Crockford base32 letters (32^5 = 33.5 million).
 * At 600,000 iterations one CPU core does about 5 guesses a second (about 73
 * core-days for every 5-letter id); a high-end gaming GPU does on the order of
 * 15,000 a second, so a determined attacker with one could open every print
 * in under an hour. What they would get: the design codes (place, station,
 * year, style and layer choices; never a name, dedication, marked day or
 * logo, which are stripped before sealing). New short links are 8 letters
 * (subs worker v5.51): 32^8 = 1.1e12 guesses, years on that GPU. The worker
 * itself limits a reader to 30 unknown ids an hour.
 *
 * Usage (sponsor-report.yml, daily, after fetching the private copy):
 *   node scripts/build_rp_sealed.mjs <kv-backup.json[.gz]> [--out data/rp-sealed]
 * Prints counts only, never an id or a code. Changes nothing when the copy
 * cannot be read or holds no short links; never prunes more than half of the
 * folder in one run (a broken copy must not wipe it).
 */
import { webcrypto as wc } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, mkdirSync, unlinkSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";

const subtle = wc.subtle;
export const SALT = "agsist.com/r sealed v1";
export const ITERATIONS = 600000;
export const NAME_BYTES = 16;
export const PAD = 400;                                   // the longest design code (CODE_RE)
export const VERSION = 1;
export const ID_RE = /^[0-9A-HJKMNP-TV-Z]{5,8}$/;
export const CODE_RE = /^[A-Za-z0-9_-]{8,400}$/;
const enc = new TextEncoder();
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const OUT_DEFAULT = path.join(ROOT, "data", "rp-sealed");

/* NOTHING PERSONAL IS SEALED (Sig, Oct 22). Before sealing, the design is
   decoded with the page's own code (components/rain-print.js) and drawn
   again without what a buyer typed or added: the name line, the dedication,
   the marked days and their labels, the logo, the gift flag. What stays:
   place, station, year, style and the layer choices. /r says "Your name and
   message show when our system is back." -> the stripped code, or '' when
   the design can't be read (that id gets no sealed file). */
let RP = null;
function rainPrint() {
  if (RP) return RP;
  const c = { TextEncoder, TextDecoder, URLSearchParams, btoa, atob };
  c.window = c;
  vm.runInNewContext(readFileSync(path.join(ROOT, "components", "rain-print.js"), "utf8"), c);
  RP = c.RainPrint;
  return RP;
}
export const PERSONAL = ["name", "dedication", "markers", "logo", "logoInk", "gift", "gift_to", "giftTo", "giftMsg"];
export function strip(code) {
  const R = rainPrint();
  const d = R.decodeCode(String(code || ""));
  if (!d) return "";
  const x = Object.assign({}, d, { name: "", dedication: "", markers: [], logo: "", gift: false });
  const out = R.encodeCode(x);
  const back = out ? R.decodeCode(out) : null;
  if (!back || back.name || back.dedication || (back.markers && back.markers.length) || back.logo || back.gift) return "";
  return CODE_RE.test(out) ? out : "";
}

const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, "0")).join("");

export async function derive(id) {
  const pw = await subtle.importKey("raw", enc.encode(id), "PBKDF2", false, ["deriveBits"]);
  const bits = await subtle.deriveBits({ name: "PBKDF2", salt: enc.encode(SALT), iterations: ITERATIONS, hash: "SHA-256" }, pw, 256);
  const ikm = await subtle.importKey("raw", bits, "HKDF", false, ["deriveBits", "deriveKey"]);
  const nameBits = await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: enc.encode("name") }, ikm, NAME_BYTES * 8);
  const key = await subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: enc.encode("key") }, ikm,
    { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  return { name: hex(new Uint8Array(nameBits)), key };
}

export async function seal(code, d) {
  const iv = wc.getRandomValues(new Uint8Array(12));
  const pt = enc.encode(code.padEnd(PAD, "."));
  const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(d.name) }, d.key, pt));
  const out = new Uint8Array(1 + 12 + ct.length);
  out[0] = VERSION; out.set(iv, 1); out.set(ct, 13);
  return out;
}

export async function open(buf, d) {
  try {
    const u8 = new Uint8Array(buf);
    if (u8.length < 13 + 16 || u8[0] !== VERSION) return null;
    const pt = await subtle.decrypt({ name: "AES-GCM", iv: u8.slice(1, 13), additionalData: enc.encode(d.name) }, d.key, u8.slice(13));
    const code = new TextDecoder().decode(pt).replace(/\.+$/, "");
    return CODE_RE.test(code) ? code : null;
  } catch (e) {
    return null;
  }
}

/* {id: stripped code} from the worker storage copy (list_source.py's format:
   {taken, keys: [{name, value | value_b64, ...}]}). */
export function records(raw) {
  const buf = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw;
  const doc = JSON.parse(buf.toString("utf8"));
  const out = {};
  for (const k of (doc && doc.keys) || []) {
    if (!k || typeof k.name !== "string" || !k.name.startsWith("rps:")) continue;
    const id = k.name.slice(4);
    let v = typeof k.value === "string" ? k.value : null;
    if (v === null && typeof k.value_b64 === "string") { try { v = Buffer.from(k.value_b64, "base64").toString("utf8"); } catch (e) { v = null; } }
    if (!ID_RE.test(id) || typeof v !== "string" || !CODE_RE.test(v)) continue;
    const bare = strip(v);
    if (bare) out[id] = bare;
  }
  return out;
}

async function pool(items, n, fn) {
  let i = 0;
  const run = async () => { while (i < items.length) { const k = i++; await fn(items[k]); } };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, run));
}

export async function build(recs, out = OUT_DEFAULT) {
  const ids = Object.keys(recs);
  const r = { records: ids.length, kept: 0, written: 0, pruned: 0, prune_refused: false };
  if (!ids.length) { r.skipped = "no short links in the copy"; return r; }
  mkdirSync(out, { recursive: true });
  const before = readdirSync(out).filter((f) => /^[0-9a-f]{32}\.bin$/.test(f));
  const want = new Set();
  await pool(ids, 8, async (id) => {
    const d = await derive(id);
    const f = path.join(out, d.name + ".bin");
    want.add(d.name + ".bin");
    // An id never changes its code, so a file that already opens to it stays
    // byte for byte (no daily churn, and no second message under one key).
    if (existsSync(f) && (await open(readFileSync(f), d)) === recs[id]) { r.kept++; return; }
    writeFileSync(f, await seal(recs[id], d));
    r.written++;
  });
  const gone = before.filter((f) => !want.has(f));
  if (gone.length && gone.length * 2 > before.length) r.prune_refused = true;
  else for (const f of gone) { unlinkSync(path.join(out, f)); r.pruned++; }
  return r;
}

async function main(argv) {
  const args = argv.slice(2);
  const oi = args.indexOf("--out");
  const out = oi >= 0 ? path.resolve(args[oi + 1]) : OUT_DEFAULT;
  const src = args.find((a, i) => !a.startsWith("--") && (oi < 0 || i !== oi + 1));
  let recs;
  try { recs = records(readFileSync(src)); } catch (e) {
    console.log("::warning::Rain Print QR backup: the storage copy could not be read; data/rp-sealed left as it was");
    return 0;
  }
  const r = await build(recs, out);
  if (r.skipped) console.log("::warning::Rain Print QR backup: " + r.skipped + "; data/rp-sealed left as it was");
  else console.log("Rain Print QR backup: %d short links, %d kept, %d written, %d removed", r.records, r.kept, r.written, r.pruned);
  if (r.prune_refused) console.log("::warning::Rain Print QR backup: more than half of the sealed files are not in the copy; none removed (check the copy)");
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv).then((c) => process.exit(c), () => { console.log("::warning::Rain Print QR backup failed; data/rp-sealed left as it was"); process.exit(0); });
}
