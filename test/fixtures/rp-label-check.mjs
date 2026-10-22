/* Rain Print label checker (2026-10-13). Reads a print's SVG the way a reader
 * sees it and reports every place where words or leaders collide:
 *
 *   small       text under 11 units (production limit)
 *   clip        text outside the 0.6 in safe area (60 units in from each edge)
 *   text/text   two pieces of text overlap
 *   text/mark   text over a dot, ring, bar, pile or the QR that is not its own
 *   text/line   text over a line that is not its own (data, axis, leaders, the preview band)
 *   leader/leader  two leaders (or a leader and another date's drop line) cross
 *   leader/mark    a leader runs through another label's dot or ring
 *   leader/data    a leader cuts the data (the year's line, bars, snow) away from its own start
 *                  (crossing a dashed line, the usual year or the preview's "so far" line, is allowed)
 *   grid        (soft, reported apart) text over a light grid line
 *
 * Ownership comes from the art's data-rp groups: a label, its leader and its
 * mark share a group and may touch each other. Text is measured with the real
 * font metrics (test/fixtures/rp-font-metrics.json, measured in Chromium from
 * the print's own woff2 files): advance widths for the width, and each
 * glyph's ink ascent and descent for the height.
 */
import { readFileSync } from "node:fs";

const M = JSON.parse(readFileSync(new URL("./rp-font-metrics.json", import.meta.url), "utf8"));
const IDX = new Map([...M.chars].map((c, i) => [c, i]));
const SAFE = { x0: 60, y0: 60, x1: 1740, y1: 1140 };
// Staircase A2 clean (2026-10-17): its gridline (#EEF0F2), the history threads (#DDD8D0) and the stone and blue fills behind the year are as light as the old ones
const SOFT_STROKE = new Set(["#E4E6E1", "#D6D9D2", "#DCE6EE", "#EEF0F2", "#DDD8D0"]);
const SOFT_FILL = new Set(["#FFFFFF", "#F3E2DF", "#DDE5EC", "#ECE6DE", "#EAEFF4"]);

function variant(o) {
  const F = /Fraunces/.test(o.fam) ? "F" : "S";
  const w = [300, 400, 500, 600].reduce((a, b) => (Math.abs(b - o.w) < Math.abs(a - o.w) ? b : a));
  return F + (o.it ? "400i" : w);
}
function widthRow(key, size) {
  const tab = M.w[key], sizes = Object.keys(tab).map(Number).sort((a, b) => a - b);
  if (sizes.length === 1) return tab[sizes[0]];
  if (size <= sizes[0]) return tab[sizes[0]];
  if (size >= sizes[sizes.length - 1]) return tab[sizes[sizes.length - 1]];
  let i = 0; while (sizes[i + 1] < size) i++;
  const a = sizes[i], b = sizes[i + 1], t = (size - a) / (b - a);
  return tab[a].map((v, k) => v + (tab[b][k] - v) * t);
}
/* The engine's measure(text, {fam, w, it, size}) with the real metrics: what a browser canvas returns, without kerning. */
export function measure(s, o) {
  const row = widthRow(variant(o), o.size);
  let w = 0;
  for (const ch of String(s)) { const i = IDX.get(ch); w += (i === undefined ? 1 : row[i] / 1000) * o.size; }
  return w;
}
function inkV(s, o) {
  const key = variant(o);
  let a = 0, d = 0;
  for (const ch of String(s)) {
    const i = IDX.get(ch);
    if (ch === " ") continue;
    a = Math.max(a, i === undefined ? 0.95 : M.asc[key][i] / 1000);
    d = Math.max(d, i === undefined ? 0.25 : M.desc[key][i] / 1000);
  }
  return { a: a * o.size, d: d * o.size };
}

const unesc = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
function attrs(s) { const o = {}; for (const m of s.matchAll(/([\w:-]+)="([^"]*)"/g)) o[m[1]] = m[2]; return o; }

function pathSegs(d) {
  const segs = [], tok = d.match(/[MLHVZmlhvz]|-?\d*\.?\d+(?:e-?\d+)?/g) || [];
  let i = 0, x = 0, y = 0, sx = 0, sy = 0, cmd = "";
  const num = () => +tok[i++];
  while (i < tok.length) {
    if (/[A-Za-z]/.test(tok[i])) cmd = tok[i++];
    const px = x, py = y;
    switch (cmd) {
      case "M": x = num(); y = num(); sx = x; sy = y; cmd = "L"; continue;
      case "m": x += num(); y += num(); sx = x; sy = y; cmd = "l"; continue;
      case "L": x = num(); y = num(); break;
      case "l": x += num(); y += num(); break;
      case "H": x = num(); break;
      case "h": x += num(); break;
      case "V": y = num(); break;
      case "v": y += num(); break;
      case "Z": case "z": x = sx; y = sy; break;
      default: i++; continue;
    }
    segs.push([px, py, x, y]);
  }
  return segs;
}

/* Parse the SVG into texts (with ink boxes) and primitives, each with an owner (its data-rp group). */
export function parse(svg, opt = {}) {
  const meas = opt.measure || measure;
  const texts = [], prims = [], stack = [];
  let ownerN = 0, depth = 0, cur = null;
  const owner = () => { for (let k = stack.length - 1; k >= 0; k--) if (stack[k].rp) return stack[k]; return { rp: "none", id: "none" }; };
  const re = /<(\/?)([a-zA-Z]+)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(svg))) {
    if (m[5] !== undefined) { if (cur) cur.runs.push({ s: m[5], f: cur.fs[cur.fs.length - 1] }); continue; }
    const close = m[1] === "/", tag = m[2], a = attrs(m[3] || ""), self = m[4] === "/";
    if (tag === "g") {
      if (close) { stack.pop(); depth--; }
      else if (!self) { depth++; stack.push({ rp: a["data-rp"] || null, id: a["data-rp"] ? a["data-rp"] + "#" + ownerN++ : null, fill: a.fill, opacity: a.opacity }); }
      continue;
    }
    const own = owner();
    if (own.rp === "wm") continue;   // the preview watermark runs over everything by design
    // a <tspan> inside a text (a reader's date after its words) is measured in its own size and weight
    if (tag === "tspan" && cur) {
      if (close) { if (cur.fs.length > 1) cur.fs.pop(); }
      else if (!self) {
        const p = cur.fs[cur.fs.length - 1];
        cur.fs.push({ ...p, size: +(a["font-size"] || p.size), w: +(a["font-weight"] || p.w), it: a["font-style"] ? a["font-style"] === "italic" : p.it });
        // a dx (the year riding after the name, 2026-10-22) moves the pen before the tspan's words
        if (a.dx) cur.runs.push({ s: "", f: cur.fs[cur.fs.length - 1], dx: +a.dx });
      }
      continue;
    }
    if (tag === "text") {
      if (close) {
        if (cur) {
          const runs = cur.runs.map((r) => ({ s: unesc(r.s), f: r.f, dx: r.dx || 0 })), s = runs.map((r) => r.s).join(""), o = cur.o;
          const size = Math.min(...cur.sizes, ...runs.map((r) => r.f.size));
          const ls = +(o["letter-spacing"] || 0), n = [...s].length;
          const sum = runs.reduce((t, r) => t + r.dx + meas(r.s, r.f), 0), adv = sum + ls * n, ink = sum + ls * Math.max(0, n - 1);
          const anchor = o["text-anchor"] || "start", x = +o.x, y = +o.y;
          const x0 = anchor === "middle" ? x - adv / 2 : anchor === "end" ? x - adv : x;
          const vs = runs.map((r) => inkV(r.s, r.f)), v = { a: Math.max(0, ...vs.map((q) => q.a)), d: Math.max(0, ...vs.map((q) => q.d)) };
          // each glyph's own ink box too, for text that only nearly touches (a comma far from the name above it)
          const glyphs = []; let gx = x0;
          for (const r of runs) { gx += r.dx; for (const ch of r.s) { const gw = meas(ch, r.f), gv = inkV(ch, r.f); if (ch !== " ") glyphs.push({ x: gx, y: y - gv.a, w: gw, h: gv.a + gv.d }); gx += gw + ls; } }
          texts.push({ s, size, owner: cur.owner, rp: cur.rp, x: x0, y: y - v.a, w: ink, h: v.a + v.d, glyphs, runs: runs.map((r) => ({ s: r.s, size: r.f.size, w: r.f.w })) });
        }
        cur = null;
      } else {
        const f = { fam: a["font-family"] || "IBM Plex Sans", w: +(a["font-weight"] || 400), it: a["font-style"] === "italic", size: +a["font-size"] };
        cur = { o: a, runs: [], fs: [f], sizes: [f.size], owner: own.id, rp: own.rp };
      }
      continue;
    }
    if (close) continue;
    const g = stack.length ? stack[stack.length - 1] : {};
    const stroke = a.stroke, sw = +(a["stroke-width"] || 0);
    if (tag === "line") {
      prims.push({ type: "seg", seg: [+a.x1, +a.y1, +a.x2, +a.y2], sw, owner: own.id, rp: own.rp, soft: SOFT_STROKE.has(stroke), dashed: !!a["stroke-dasharray"] });
    } else if (tag === "path") {
      if (own.rp === "qr") continue;   // the code's modules: its quiet-zone rect stands for it
      const segs = pathSegs(a.d || "");
      segs.forEach((sg) => prims.push({ type: "seg", seg: sg, sw: sw || 1, owner: own.id, rp: own.rp, soft: SOFT_STROKE.has(stroke), dashed: !!a["stroke-dasharray"], path: true }));
    } else if (tag === "rect") {
      const fill = a.fill || g.fill || "#000";
      const b = { x: +a.x, y: +a.y, w: +a.width, h: +a.height };
      if (own.rp === "band") { prims.push({ type: "box", box: b, owner: own.id, rp: own.rp, soft: false }); continue; }
      if (b.w >= 1800 && b.h >= 1200) continue;   // the paper
      prims.push({ type: "box", box: b, owner: own.id, rp: own.rp, soft: own.rp !== "qr" && SOFT_FILL.has(fill) });
    } else if (tag === "circle") {
      const r = +a.r + (+(a["stroke-width"] || 0)) / 2;
      prims.push({ type: "box", box: { x: +a.cx - r, y: +a.cy - r, w: 2 * r, h: 2 * r }, owner: own.id, rp: own.rp, soft: false, dot: true, c: [+a.cx, +a.cy] });
    }
  }
  return { texts, prims, balanced: depth === 0 };
}

const LABEL = /^(mark|wet|rec|dry)/;
function boxHit(a, b, p) { return a.x < b.x + b.w + p && b.x < a.x + a.w + p && a.y < b.y + b.h + p && b.y < a.y + a.h + p; }
function segBox(s, b, p) {
  // Liang-Barsky against b grown by p
  let [x1, y1, x2, y2] = s, t0 = 0, t1 = 1;
  const dx = x2 - x1, dy = y2 - y1, X0 = b.x - p, X1 = b.x + b.w + p, Y0 = b.y - p, Y1 = b.y + b.h + p;
  for (const [pp, q] of [[-dx, x1 - X0], [dx, X1 - x1], [-dy, y1 - Y0], [dy, Y1 - y1]]) {
    if (pp === 0) { if (q < 0) return false; continue; }
    const r = q / pp;
    if (pp < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return true;
}
function cross(a, b) {
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const A = [a[0], a[1]], B = [a[2], a[3]], Cc = [b[0], b[1]], D = [b[2], b[3]];
  const d1 = o(Cc, D, A), d2 = o(Cc, D, B), d3 = o(A, B, Cc), d4 = o(A, B, D);
  if (Math.abs(d1) < 1e-6 && Math.abs(d2) < 1e-6) return false;   // collinear: one line drawn over itself, not a crossing
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
function clipSeg(s, from, r) {
  // the part of segment s farther than r from point `from` (one piece, enough for straight leaders)
  const [x1, y1, x2, y2] = s, L = Math.hypot(x2 - x1, y2 - y1);
  if (L < 1e-9) return null;
  const d1 = Math.hypot(x1 - from[0], y1 - from[1]), d2 = Math.hypot(x2 - from[0], y2 - from[1]);
  if (d1 <= d2) { if (L <= r) return null; const t = Math.min(1, r / L); return [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, x2, y2]; }
  if (L <= r) return null; const t = Math.min(1, r / L); return [x1, y1, x2 - (x2 - x1) * t, y2 - (y2 - y1) * t];
}

/* All the collisions on one print. Returns [{kind, a, b}] (a, b: short descriptions). */
export function check(svg, opt = {}) {
  const { texts, prims, balanced } = parse(svg, opt);
  const out = [], pad = opt.pad ?? 1;
  const name = (t) => (t.s !== undefined ? '"' + t.s + '"' : t.rp) + " [" + t.rp + "]";
  if (!balanced) out.push({ kind: "svg", a: "unbalanced groups", b: "" });
  texts.forEach((t) => {
    if (t.size < 11 - 1e-9) out.push({ kind: "small", a: name(t), b: t.size + " u" });
    if (t.rp === "band") return;
    if (t.x < SAFE.x0 || t.y < SAFE.y0 || t.x + t.w > SAFE.x1 || t.y + t.h > SAFE.y1) out.push({ kind: "clip", a: name(t), b: [t.x, t.y, t.x + t.w, t.y + t.h].map((v) => v.toFixed(0)).join(",") });
  });
  for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
    const a = texts[i], b = texts[j];
    if (a.rp === "band" || b.rp === "band") continue;   // the band's words sit on the band, over the art
    if (boxHit(a, b, pad) && a.glyphs.some((g) => b.glyphs.some((h) => boxHit(g, h, pad)))) out.push({ kind: "text/text", a: name(a), b: name(b) });
  }
  texts.forEach((t) => {
    prims.forEach((p) => {
      if (p.owner === t.owner) return;
      if (t.rp === "band") return;   // the band covers what is under its words
      const hitp = p.type === "seg" ? segBox(p.seg, t, pad + p.sw / 2) : boxHit(t, p.box, pad);
      if (!hitp) return;
      if (p.soft) { if (p.type === "seg") out.push({ kind: "grid", a: name(t), b: p.rp }); return; }
      out.push({ kind: p.type === "box" ? "text/mark" : "text/line", a: name(t), b: p.rp + (p.dot ? " dot" : "") });
    });
  });
  // leaders: every line in a label group (mark drop lines, ticks, leaders, brackets)
  const leads = prims.filter((p) => p.type === "seg" && LABEL.test(p.rp) && p.sw <= 1.5);
  for (let i = 0; i < leads.length; i++) for (let j = i + 1; j < leads.length; j++) {
    const a = leads[i], b = leads[j];
    if (a.owner === b.owner) continue;
    if (cross(a.seg, b.seg)) out.push({ kind: "leader/leader", a: a.rp, b: b.rp });
  }
  const dots = prims.filter((p) => p.dot);
  // a leader may leave its ring through a dot on the very same spot (a date on that day), and nowhere else
  leads.forEach((l) => dots.forEach((d) => {
    if (d.owner === l.owner || !segBox(l.seg, d.box, 0)) return;
    const own = dots.find((o) => o.owner === l.owner);
    if (own && Math.hypot(own.c[0] - d.c[0], own.c[1] - d.c[1]) < 9) { const far = clipSeg(l.seg, own.c, 9); if (!far || !segBox(far, d.box, 0)) return; }
    out.push({ kind: "leader/mark", a: l.rp, b: d.rp });
  }));
  // a leader (not a date's own drop line) must not cut the data away from where it starts
  const data = prims.filter((p) => p.rp === "data" && !p.soft && !p.dashed);
  prims.filter((p) => p.type === "seg" && /^(wet|rec)/.test(p.rp) && p.sw <= 1.5).forEach((l) => {
    const own = dots.find((d) => d.owner === l.owner);
    const start = own ? own.c : [l.seg[0], l.seg[1]];
    const s = clipSeg(l.seg, start, 9);
    if (!s) return;
    data.forEach((p) => {
      const h = p.type === "seg" ? cross(s, p.seg) : segBox(s, p.box, 0);
      if (h) out.push({ kind: "leader/data", a: l.rp, b: "data" });
    });
  });
  return out;
}

export function counts(issues, soft = false) {
  const c = {};
  issues.forEach((i) => { if (!soft && i.kind === "grid") return; c[i.kind] = (c[i.kind] || 0) + 1; });
  return c;
}
export const HARD = (issues) => issues.filter((i) => i.kind !== "grid");
