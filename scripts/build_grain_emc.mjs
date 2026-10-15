#!/usr/bin/env node
/* build_grain_emc.mjs: bakes the static parts of /grain-emc from the same
 * math the page runs (components/grain-emc.js), so a crawler, a printer and a
 * reader with no script see the same numbers the calculator gives:
 *   <!--EMC:CHART:corn--> and <!--EMC:CHART:wheat-->: the EMC charts
 *     (30 to 90 F down the side, 30 to 90% humidity across, % wet basis),
 *     each with its print-only title, how-to-read line, equation, note,
 *     QR code (components/qr.js, drawn here, a plain link to the page) and
 *     the AGSIST print footer.
 *   <!--EMC:LIMITS-->: the humidity-limit table for corn at the default 15.5%.
 *
 *   node scripts/build_grain_emc.mjs          # write grain-emc.html
 *   node scripts/build_grain_emc.mjs --check  # exit 1 if the page is stale
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PAGE = ROOT + "grain-emc.html";
const ctx = { window: {} };
vm.runInNewContext(readFileSync(ROOT + "components/grain-emc.js", "utf8"), ctx);
vm.runInNewContext(readFileSync(ROOT + "components/qr.js", "utf8"), ctx);
const E = ctx.AgEMC, QR = ctx.window.AgQR;
const URL_ = "https://agsist.com/grain-emc";
const TEMPS = [30, 40, 50, 60, 70, 80, 90], RHS = [30, 40, 50, 60, 70, 80, 90];
const f1 = (x) => (Math.round(x * 10) / 10).toFixed(1);

function shade(v) {
  // seven grayscale-safe steps by EMC, light to dark
  const edges = [9, 11, 13, 15, 17, 19];
  let i = 0;
  while (i < edges.length && v >= edges[i]) i++;
  return i;
}

const COPY = {
  corn: {
    title: "Corn EMC chart: equilibrium moisture content, % wet basis",
    howto: "Find the air temperature down the side and the relative humidity across the top. The cell is the moisture corn ends up at in that air, % wet basis. Each cell gives two published fits, low over high; plan on the high one.",
    eq: "Low: Modified Chung-Pfost, ASABE D245.6 shelled corn, RH = exp(-374.34/(T+31.696) &middot; exp(-0.18662&middot;M)). High: the classic Henderson corn fit, 1-RH = exp(-8.6541e-5&middot;(T+49.81)&middot;M^1.8634). T &deg;C, M % dry basis.",
    note: "Extension tables for the same air (Minnesota, Kentucky, Arkansas) run up to about 1.5 points apart. Grain drying down settles a little wetter than grain taking on water in the same air. Bold: within half a point of a 15.5% target.",
    target: 15.5,
  },
  wheat: {
    title: "Wheat EMC chart: equilibrium moisture content, % wet basis",
    howto: "Find the air temperature down the side and the relative humidity across the top. The cell is the moisture wheat ends up at in that air, % wet basis.",
    eq: "Modified Henderson, ASAE D245.5 wheat: 1-RH = exp(-2.3007e-5&middot;(T+55.815)&middot;M^2.2857). T &deg;C, M % dry basis.",
    note: "Matches the University of Minnesota Extension wheat table at 60 F within a tenth of a point. Soft red winter wheat runs about a point drier. Bold: within half a point of a 13.5% target.",
    target: 13.5,
  },
};

function chart(k) {
  const c = COPY[k], name = E.GRAINS[k].name;
  const head = "<tr><th scope=\"col\" class=\"cr\">Air</th>" + RHS.map((r) => `<th scope="col">${r}%</th>`).join("") + "</tr>";
  const body = TEMPS.map((t) => {
    const cells = RHS.map((rh) => {
      const e = E.emc(k, t, rh);
      const lo = f1(e.wb), hi = f1(e.wet);
      const near = Math.abs(e.wb - c.target) <= 0.5 || Math.abs(e.wet - c.target) <= 0.5 || (e.wb < c.target && e.wet > c.target);
      const txt = lo === hi ? lo : `<span>${lo}</span><span class="hi">${hi}</span>`;
      return `<td class="sh${shade(e.wet)}${near ? " near" : ""}">${txt}</td>`;
    }).join("");
    return `<tr><th scope="row">${t} F</th>${cells}</tr>`;
  }).join("\n");
  const qr = QR.svg(URL_, "QR code: agsist.com/grain-emc");
  return `<section class="emc-chart" id="${k}-emc-chart" aria-labelledby="${k}-chart">
        <h2 id="${k}-chart">${name} EMC chart</h2>
        <p class="emc-ptitle">${c.title}</p>
        <p class="emc-howto">${c.howto}</p>
        <div class="emc-tw" tabindex="0" role="region" aria-label="${name} EMC chart, scrolls sideways"><table class="emc-grid">
<caption class="sr-only">${c.title}</caption>
<thead>${head}</thead>
<tbody>
${body}
</tbody></table></div>
        <p class="emc-eq">${c.eq}</p>
        <p class="emc-cnote">${c.note}</p>
        <div class="emc-pfoot"><span class="emc-qr">${qr}</span><p class="emc-print-foot">A G S I S T &nbsp;&middot;&nbsp; agsist.com/grain-emc &nbsp;&middot;&nbsp; free tools for working farmers</p></div>
        <p class="emc-chart-act"><button type="button" class="emc-btn" data-print-chart="${k}">Print this chart</button></p>
      </section>`;
}

function limits() {
  const rows = [];
  for (let f = 30; f <= 90; f += 10) {
    const h = E.rhFor("corn", f, 15.5), d = E.rhDries("corn", f, 15.5);
    rows.push(`<tr><th scope="row">${f} F</th><td>${Math.floor(h.rh)}%</td><td>${Math.floor(d.rh)}%</td></tr>`);
  }
  return rows.join("");
}

function fill(html, tag, inner) {
  const re = new RegExp(`(<!--EMC:${tag}-->)[\\s\\S]*?(<!--/EMC:${tag}-->)`);
  if (!re.test(html)) throw new Error("marker missing: " + tag);
  return html.replace(re, (_, a, b) => a + inner + b);
}

export function bake(html) {
  html = fill(html, "CHART:corn", chart("corn"));
  html = fill(html, "CHART:wheat", chart("wheat"));
  html = fill(html, "LIMITS", limits());
  return html;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const cur = readFileSync(PAGE, "utf8"), next = bake(cur);
  if (process.argv.includes("--check")) {
    if (cur !== next) { console.error("grain-emc.html is stale: run node scripts/build_grain_emc.mjs"); process.exit(1); }
    console.log("grain-emc.html: charts and limits match components/grain-emc.js");
  } else {
    if (cur !== next) writeFileSync(PAGE, next);
    console.log("grain-emc.html " + (cur !== next ? "written" : "unchanged"));
  }
}
