/* Contrast from the CSS tokens, both themes (a11y audit 2026-10-19, items 1, 5, 6, 7).
 *
 * Reads the :root and [data-theme="light"] custom properties out of
 * components/styles.css, resolves var() chains, and computes WCAG ratios for
 * the pairs the audit found under 4.5:1:
 *   5. dark text on solid gold buttons (light: #111 on --gold #8a6514 = 3.55);
 *      every such rule must sit on --gold-fill
 *   6. --blue had no light value (#6f9fc2, 2.83 on white); the Daily thread day
 *      tag, vs icon and TMYK label were hard-coded #5aa0d2 (2.2 on its tint)
 *   7. the stale-date / high-risk orange #f0913a (2.38 on white), 5 copies
 *   1. the light row red for a weaker basis is not the page red, whose
 *      lightness equals the green's (1.02:1)
 *
 *   node --test test/a11y-contrast-tokens.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const CSS = read("components/styles.css").replace(/\/\*[\s\S]*?\*\//g, "");

function block(sel) {
  const out = {};
  const re = new RegExp("(^|\\n)\\s*" + sel.replace(/[[\]"().]/g, "\\$&") + "\\s*\\{([^}]*)\\}", "g");
  let m, n = 0;
  while ((m = re.exec(CSS))) { n++; for (const d of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);?/g)) out[d[1]] = d[2].trim(); }
  assert.ok(n >= 1, `styles.css has no ${sel} block`);
  return out;
}
const DARK = block(":root");
const LIGHT = { ...DARK, ...block('[data-theme="light"]') };
function tok(theme, name, depth = 0) {
  let v = theme[name];
  assert.ok(v != null, `token ${name} is not defined`);
  const m = /^var\((--[\w-]+)(?:\s*,\s*([^)]+))?\)$/.exec(v);
  if (m) return theme[m[1]] != null ? tok(theme, m[1], depth + 1) : m[2].trim();
  return v;
}
function rgb(c) {
  c = c.trim();
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c);
  if (m) { let h = m[1]; if (h.length === 3) h = h.replace(/./g, "$&$&"); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); }
  m = /^rgba?\(([^)]+)\)$/.exec(c);
  if (m) return m[1].split(",").slice(0, 3).map(Number);
  throw new Error("not a color: " + c);
}
const lum = (c) => { const [r, g, b] = rgb(c).map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const hex = (a) => "#" + a.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const over = (rgbStr, alpha, bg) => { const f = rgb(rgbStr), b = rgb(bg); return hex(f.map((v, i) => v * alpha + b[i] * (1 - alpha))); };

const SURF = ["--bg", "--surface", "--surface2", "--surface3"];

test("the token reader sees both themes", () => {
  assert.equal(tok(DARK, "--gold"), "#d4a23f");
  assert.equal(tok(LIGHT, "--gold"), "#8a6514");
  assert.equal(tok(LIGHT, "--surface"), "#ffffff");
});

test("6: --blue reads 4.5:1 on every surface in both themes, and on the Daily tag tint", () => {
  assert.notEqual(tok(LIGHT, "--blue"), tok(DARK, "--blue"), "--blue has its own light-theme value");
  for (const [name, th] of [["dark", DARK], ["light", LIGHT]]) {
    const blue = tok(th, "--blue");
    for (const s of SURF) {
      const bg = tok(th, s);
      assert.ok(ratio(blue, bg) >= 4.5, `${name}: --blue ${blue} on ${s} ${bg} is ${ratio(blue, bg).toFixed(2)}:1`);
      /* the thread day tag and the cautious mood chip: rgba(74,143,186,.08) over the surface */
      const tint = over("rgb(74,143,186)", 0.08, bg);
      assert.ok(ratio(blue, tint) >= 4.5, `${name}: --blue on the tag tint over ${s} is ${ratio(blue, tint).toFixed(2)}:1`);
    }
  }
  /* the audit measured the light tag background at #d9e5eb */
  assert.ok(ratio(tok(LIGHT, "--blue"), "#d9e5eb") >= 4.5);
});

test("6: the Daily blue is the token in every copy, and the frozen archive is covered", () => {
  for (const f of ["scripts/generate_daily.py", "daily.html", "css/home.css"])
    assert.doesNotMatch(read(f), /#5aa0d2/i, `${f} still hard-codes the tag blue`);
  const gen = read("scripts/generate_daily.py");
  assert.match(gen, /\.dv3-thread-day\{\{[^}]*color:var\(--blue\)/);
  assert.match(read("daily.html"), /\.dv3-thread-day\{[^}]*color:var\(--blue\)/);
  /* published archive pages keep #5aa0d2 in their own CSS; styles.css overrides it in light */
  const archived = readdirSync(join(ROOT, "daily")).filter((f) => /^\d{4}-\d{2}-\d{2}\.html$/.test(f));
  assert.ok(archived.length >= 200, `only ${archived.length} archive pages found`);
  const frozen = archived.filter((f) => /#5aa0d2/i.test(read("daily/" + f)));
  if (frozen.length) {
    assert.match(CSS, /\[data-theme="light"\] :is\(\.dv3-thread-day, \.dv3-sec-vs-icon, \.dv3-tmyk-label\) \{ color: var\(--blue\) \}/,
      `${frozen.length} archive pages carry #5aa0d2 and styles.css no longer overrides it in light`);
    for (const f of frozen.slice(0, 5)) assert.match(read("daily/" + f), /\/components\/styles\.css/, `${f} links styles.css`);
  }
});

test("7: the stale-date and high-risk orange is var(--orange) in all five copies, 4.5:1 both themes", () => {
  let n = 0;
  for (const f of ["components/home.js", "components/home-yield.js", "components/geo.js"]) {
    const s = read(f);
    assert.doesNotMatch(s, /#f0913a/i, `${f} still has #f0913a`);
    n += (s.match(/'var\(--orange\)'/g) || []).length;
  }
  assert.ok(n >= 5, `expected the 5 orange writes to use var(--orange), found ${n}`);
  for (const [name, th] of [["dark", DARK], ["light", LIGHT]]) for (const s of SURF) {
    const r = ratio(tok(th, "--orange"), tok(th, s));
    assert.ok(r >= 4.5, `${name}: --orange on ${s} is ${r.toFixed(2)}:1`);
  }
});

/* 5: every rule that puts dark text on a solid gold background */
function goldRules() {
  const files = [];
  for (const f of readdirSync(ROOT)) if (f.endsWith(".html")) files.push(f);
  for (const d of ["components", "css"]) for (const f of readdirSync(join(ROOT, d))) if (/\.(css|html|js)$/.test(f)) files.push(d + "/" + f);
  const out = [];
  for (const f of files) {
    const s = read(f);
    if (!/var\(--(gold|brand)(-fill)?\)/.test(s)) continue;
    for (const m of s.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
      const d = m[2];
      const bg = /background(?:-color)?\s*:\s*var\(--(gold|brand)(-fill)?\)/.exec(d);
      const ink = /(?:^|[;{\s])color\s*:\s*(#[0-2][0-9a-f]{2}(?:[0-9a-f]{3})?)\b/i.exec(d);
      if (bg && ink) out.push({ f, sel: m[1].trim().slice(-60), fill: bg[2] === "-fill", tokn: "--" + bg[1] + (bg[2] || ""), ink: ink[1] });
    }
  }
  return out;
}

test("5: dark text on a gold button sits on --gold-fill, 4.5:1 in both themes", () => {
  const rules = goldRules();
  assert.ok(rules.length >= 23, `only ${rules.length} gold-button rules found (22 in 13 files plus post.html); the files have moved`);
  for (const r of rules) {
    assert.ok(r.fill, `${r.f}: "${r.sel}" puts ${r.ink} on var(${r.tokn}); light theme needs --gold-fill`);
    for (const [name, th] of [["dark", DARK], ["light", LIGHT]]) {
      const x = ratio(r.ink, tok(th, r.tokn));
      assert.ok(x >= 4.5, `${r.f} ${name}: ${r.ink} on ${r.tokn} is ${x.toFixed(2)}:1`);
    }
  }
  const files = new Set(rules.map((r) => r.f));
  for (const f of ["components/here.css", "components/custom-rates.css", "combine-loss.html", "grain-emc.html", "post.html"]) assert.ok(files.has(f), `${f} was scanned`);
});

test("1: light theme row red for a weaker basis is the darker red, 4.5:1, and not the green's lightness", () => {
  const g = read("components/cb-glance.css");
  const m = /\[data-theme="light"\] \.bid-basis\.bz-dn\{color:(#[0-9a-f]{6})\}/.exec(g);
  assert.ok(m, "cb-glance.css has a light .bid-basis.bz-dn");
  const red = m[1], green = tok(LIGHT, "--green");
  assert.ok(ratio(green, tok(LIGHT, "--red")) < 1.1, "the page red and green are the same lightness, which is why the override exists");
  assert.ok(ratio(red, green) >= 1.25, `row red ${red} vs green ${green} is ${ratio(red, green).toFixed(2)}:1 in lightness`);
  for (const s of SURF) assert.ok(ratio(red, tok(LIGHT, s)) >= 4.5, `${red} on ${s}`);
  /* the Best card and the key use the same red */
  const page = read("cash-bids.html");
  assert.ok(page.includes(`[data-theme="light"] .bbc-basis.bz-dn{color:${red}}`) && page.includes(`[data-theme="light"] .cb-basis-key .bz-dn{color:${red}}`));
});
