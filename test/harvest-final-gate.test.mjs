/* /harvest-price-tracker: a running figure is never called final (site panel
 * Nov 4 2026, skeptic row 40). The worked example under "Selling ahead" said
 * "the final price is set when October ends" with no gate, so on Nov 3, with
 * Iowa's window closed and RMA's price not yet released, it still spoke of a
 * running figure, and when the harvest price sat under the projected price it
 * gave no caveat at all. hWordsFor and hTail take the window state from
 * isOpen and isDone. Frozen clock and fixture windows; no live file. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const HTML = readFileSync(ROOT + "harvest-price-tracker.html", "utf8");

function liftFn(name) {
  const i = HTML.indexOf("function " + name + "(");
  assert.ok(i >= 0, `harvest-price-tracker.html no longer defines ${name}()`);
  let dd = 0, j = HTML.indexOf("{", i);
  for (; j < HTML.length; j++) {
    if (HTML[j] === "{") dd++;
    else if (HTML[j] === "}" && --dd === 0) break;
  }
  return HTML.slice(i, j + 1);
}

function ctx(todayIso) {
  const c = { TODAY: new Date(todayIso), MON: ["January","February","March","April","May","June","July","August","September","October","November","December"],
    runWords: () => "average of 22 of 22 trading days through Oct 30" };
  vm.createContext(c);
  vm.runInContext(["d", "shortd", "isOpen", "isClosed", "isDone", "hWordsFor", "hTail"].map(liftFn).join("\n"), c);
  return c;
}

const IA = { crop: "Corn", hs: "2026-10-01", he: "2026-10-31", hstatus: "Pending" };

test("open window: running words, the caveat names the window's close", () => {
  const c = ctx("2026-10-16T12:00:00");
  assert.match(c.hTail(IA), /today&rsquo;s running figure; the final price is set after the window closes Oct\s31/);
  assert.equal(c.hWordsFor(IA, null), "RMA&rsquo;s running harvest price");
});

test("closed, not released (Nov 3): last posted, never final, never running", () => {
  const c = ctx("2026-11-03T12:00:00");
  const t = c.hTail(IA) + " " + c.hWordsFor(IA, null);
  assert.match(t, /last posted/);
  assert.match(t, /RMA has not released the final price/);
  assert.doesNotMatch(t, /running|the final harvest price|October ends/);
});

test("released: the final price, no caveat", () => {
  const c = ctx("2026-11-06T12:00:00");
  const g = { ...IA, hstatus: "Released" };
  assert.equal(c.hTail(g), "");
  assert.equal(c.hWordsFor(g, null), "the final harvest price");
});

test("the short-crop line always carries the gated caveat", () => {
  assert.doesNotMatch(HTML, /October ends/);
  assert.match(HTML, /money\(Hc,'bu'\)\+\s*hTail\(g\)\+/);
});
