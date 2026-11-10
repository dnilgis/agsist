/* The weather fold on a county rain page (Nov 4, 2026).
 *
 * The page bakes only the fold's one-line summary (scripts/build_county_rain.py wx_fold). This file
 * fills the fold from data/rain/wx/<st>.json (scripts/fetch_rain_weather.py), one small file per state,
 * read when the fold comes near the screen, so opening it moves nothing below it after the tap.
 * It never computes a number: every figure, percent and date is the data file's. A figure the file
 * withholds ("m": more than 5% of its days missing) says "not enough days reported". Every line
 * carries its date or its span. No link to a data source; the source is named in plain text. */
(function () {
  "use strict";
  var M3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var ML = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var NOPE = "not enough days reported";
  var DEG = "&deg;F";
  function md(v) { return M3[Math.floor(v / 100) - 1] + " " + (v % 100); }
  function num(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  function days(n) { return n + (n === 1 ? " day" : " days"); }
  function deg(n) { return (n < 0 ? "&minus;" + (-n) : String(n)) + DEG; }
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function li(k, v) { return "<li><b>" + k + ":</b> " + v + "</li>"; }
  function miss(n) { return n ? " (" + days(n) + " not reported)" : ""; }

  /* the fold's body for one county row; noun: "station" or "gauge" (the rain page's word) */
  function render(r, noun) {
    var a = md(r.a), out = [], L = [];
    if (r.s) {
      out.push('<p class="rc-fine">Highs and lows from the weather station ' + esc(r.s[0]) + ", " + r.s[2] +
        " miles from the rain " + noun + ", which keeps no temperatures. Jan 1 to " + a + ".</p>");
    } else {
      out.push('<p class="rc-fine">Highs and lows from the same ' + noun + ", Jan 1 to " + a + ".</p>");
    }
    var g = r.g;
    if (g === "m") L.push(li("Corn GDDs, May 1 to " + a, NOPE));
    else if (g) L.push(li("Corn GDDs, May 1 to " + a, num(g[0]) +
      (g.length > 2 ? ", " + g[4] + "% of the 1991 to 2020 average for the same days (" + num(g[2]) + ", " + g[3] + " years)" : ", no 1991 to 2020 average for this station yet") +
      (g[1] ? "; " + days(g[1]) + " not reported, left out of both" : "") + "."));
    function ext(k, x, n) {
      if (x === "m") return li(k, NOPE);
      if (!x) return "";
      return li(k, deg(x[0]) + " on " + md(x[1]) + (x[2] ? ", and " + days(x[2]) + " more at " + deg(x[0]) : "") + miss(n) + ".");
    }
    L.push(ext("Hottest day", r.h, r.mh));
    L.push(ext("Coldest day", r.l, r.ml));
    if (r.d9 !== undefined) L.push(li("Days at 90" + DEG + " or above, Jan 1 to " + a, r.d9 === "m" ? NOPE : r.d9 + miss(r.mh) + "."));
    if (r.d3 !== undefined) L.push(li("Days at 32" + DEG + " or below, Jul 1 to " + a, r.d3 === "m" ? NOPE : r.d3 + "."));
    var fr = r.fr || {}, ns = {};
    function fz(key, t, spring) {
      var x = fr[key];
      if (!x) return "";
      var v = x[0] === "m" ? NOPE : x[0] === 0 ? (spring ? "none Jan 1 to Jun 30" : "none yet through " + a) : "on " + md(x[0]);
      if (x.length > 2) ns[x[2]] = 1;
      return t + DEG + " " + v + (x.length > 2 ? " (usual: " + (x[1] === 0 ? "none" : md(x[1])) + ")" : "");
    }
    function fline(k, parts) {
      parts = parts.filter(Boolean);
      if (parts.length) L.push(li(k, parts.join("; ") + "."));
    }
    fline("Last spring freeze", [fz("s32", 32, 1), fz("s28", 28, 1)]);
    fline("First fall freeze", [fz("f32", 32), fz("f28", 28)]);
    var nk = Object.keys(ns);
    (r.nt || []).forEach(function (x) {
      L.push(li("Of note", deg(x[2]) + " on " + md(x[3]) + ", the " + (x[0] === "h" ? "warmest " : "coldest ") + ML[x[1] - 1] +
        " day here " + (x[4] ? "since " + x[4] + " (" + x[5] + " years of record)" : "in " + x[5] + " years of record") + "."));
    });
    out.push('<ul class="rc-list">' + L.join("") + "</ul>");
    out.push('<p class="rc-fine">Corn GDDs: each day&rsquo;s high and low held between 50' + DEG + " and 86" + DEG +
      ", averaged, minus 50, the standard corn method, added from May 1. The average and the usual dates are this station&rsquo;s own 1991 to 2020 record" +
      (nk.length ? "; a usual freeze date is the middle year of " + nk.join(" or ") + " years" : "") + ". " +
      "Of note: against every year of this station&rsquo;s record, only with 20 or more full years and no gap since the year named. " +
      "A figure with more than 5% of its days not reported is not shown. NOAA daily records through RCC-ACIS.</p>");
    return out.join("");
  }
  var api = { render: render, md: md };
  if (typeof window !== "undefined") window.AgRainWx = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof document === "undefined") return;

  var el = document.querySelector("details.rc-wx[data-w]");
  if (!el) return;
  var box = document.createElement("div"), started = false;
  el.appendChild(box);
  function fill() {
    if (started) return;
    started = true;
    var w = el.getAttribute("data-w").split("/"), noun = el.getAttribute("data-n") || "station";
    fetch("/data/rain/wx/" + w[0] + ".json?v=" + (el.getAttribute("data-v") || "")).then(function (res) {
      if (!res.ok) throw new Error(res.status);
      return res.json();
    }).then(function (d) {
      var r = d && d.counties && d.counties[w[1]];
      if (!r) throw new Error("no row");
      /* a newer read than the page's own line above: say so, never two answers unexplained */
      var f = String(d.fetched || "");
      box.innerHTML = (f.replace(/\D/g, "") === el.getAttribute("data-v") ? "" :
        '<p class="rc-fine">Read again since the line above was written: these figures run to ' + md(r.a) + ".</p>") + render(r, noun);
    }).catch(function () {
      started = false;
      box.innerHTML = '<p class="rc-fine">The weather figures did not load. Close and open this again to retry.</p>';
    });
  }
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (es) {
      if (es.some(function (x) { return x.isIntersecting; })) { io.disconnect(); fill(); }
    }, { rootMargin: "800px 0px" });
    io.observe(el);
  }
  el.addEventListener("toggle", function () { if (el.open) fill(); });
})();
