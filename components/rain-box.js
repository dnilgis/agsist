/* The county rain box (Nov 3, 2026).
 *
 * One line for a county: "Story County, IA: 53.72 in of rain since Jan 1, 156% of usual, through Nov 2."
 * Two users, one copy of the wording:
 *   embed/rain.html          the box other sites put in an iframe (reads data/rain/<st>.json)
 *   rain/<state>/<county>    the closed fold "Put this on your site or in your newsletter"; the line itself is
 *                            written into the page by scripts/build_county_rain.py (box_line, the Python copy of
 *                            line() below; test/rain-box.test.mjs holds the two equal on the saved fixtures)
 * It never computes a number: the total and the percent are the data file's, rounded the way the page rounds
 * them. No percent where the page has none (pct null: no NOAA normal, or too early for a fair one).
 * No link to a data source; the source is named in plain text. */
(function () {
  "use strict";
  var STATES = {AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",CO:"Colorado",CT:"Connecticut",DE:"Delaware",FL:"Florida",GA:"Georgia",HI:"Hawaii",ID:"Idaho",IL:"Illinois",IN:"Indiana",IA:"Iowa",KS:"Kansas",KY:"Kentucky",LA:"Louisiana",ME:"Maine",MD:"Maryland",MA:"Massachusetts",MI:"Michigan",MN:"Minnesota",MS:"Mississippi",MO:"Missouri",MT:"Montana",NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",NJ:"New Jersey",NM:"New Mexico",NY:"New York",NC:"North Carolina",ND:"North Dakota",OH:"Ohio",OK:"Oklahoma",OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",SC:"South Carolina",SD:"South Dakota",TN:"Tennessee",TX:"Texas",UT:"Utah",VT:"Vermont",VA:"Virginia",WA:"Washington",WV:"West Virginia",WI:"Wisconsin",WY:"Wyoming"};
  var M3 = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  var ORIGIN = "https://agsist.com";

  /* the same as scripts/county_rain.py slug() after the Farmland Atlas names: accents and apostrophes dropped */
  function slug(s) {
    s = String(s);
    if (s.normalize) s = s.normalize("NFD").replace(/[̀-ͯ]/g, "");
    return s.replace(/['’]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }
  function shortDate(iso) { var p = String(iso).split("-"); return M3[+p[1] - 1] + " " + (+p[2]); }
  function done(d) { return /-12-31$/.test(String(d && d.edate || "")); }
  /* "Story County, IA: 53.72 in of rain since Jan 1, 156% of usual, through Nov 2." */
  function line(c, st, d) {
    var thru = shortDate(c.as_of) + (done(d) ? ", " + d.year : "");
    var pct = (c.pct === null || c.pct === undefined) ? "" : ", " + c.pct + "% of usual";
    return c.name + ", " + st + ": " + Number(c.total).toFixed(2) + " in of rain since Jan 1" + pct + ", through " + thru + ".";
  }
  function source(c) { return "NOAA daily records" + (c.station && c.station.net === "cocorahs" ? ", CoCoRaHS volunteer gauge" : ""); }
  function path(c, st) { return "/rain/" + slug(STATES[st] || st) + "/" + slug(c.name); }
  /* the iframe code a reader copies from the county page */
  function code(st, fips, name) {
    return '<iframe src="' + ORIGIN + "/embed/rain?st=" + String(st).toLowerCase() + "&c=" + fips + '" title="' +
      String(name).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;") +
      ' rain, AGSIST" width="100%" height="110" style="border:0;max-width:480px" loading="lazy"></iframe>';
  }
  var api = { line: line, source: source, path: path, slug: slug, code: code, STATES: STATES };
  if (typeof window !== "undefined") window.AgRainBox = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof document === "undefined") return;

  /* ---- the county page fold: filled on first open, nothing runs before */
  function copy(t, btn) {
    var ok = function () { btn.textContent = "Copied"; setTimeout(function () { btn.textContent = "Copy"; }, 1800); };
    var hand = function () { btn.textContent = "Select and copy by hand"; };
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(t).then(ok, hand); return; }
    var ta = document.createElement("textarea");
    ta.value = t; ta.setAttribute("readonly", ""); ta.style.cssText = "position:fixed;left:-9999px;top:0";
    document.body.appendChild(ta); ta.select();
    var good = false;
    try { good = document.execCommand("copy"); } catch (e) { good = false; }
    document.body.removeChild(ta);
    if (good) ok(); else hand();
  }
  function button(get) {
    var b = document.createElement("button");
    b.type = "button"; b.className = "btn btn-secondary"; b.textContent = "Copy";
    b.style.cssText = "min-height:44px;padding:.3rem .9rem;margin-left:.4rem;font-size:.85rem";
    b.addEventListener("click", function () { copy(get(), b); });
    return b;
  }
  function fill(box) {
    if (box.getAttribute("data-on")) return;
    box.setAttribute("data-on", "1");
    var st = box.getAttribute("data-st") || "", fips = box.getAttribute("data-c") || "", name = box.getAttribute("data-n") || "";
    var s = box.querySelector(".rc-emb-s");
    if (s) {
      var t = s.textContent;   // the sentence as written in the page; the label below is not copied
      s.insertBefore(document.createTextNode("In words, for a newsletter, paper or radio: "), s.firstChild);
      s.appendChild(button(function () { return t; }));
    }
    if (!/^[A-Z]{2}$/.test(st) || !/^\d{5}$/.test(fips)) return;
    var p = document.createElement("p");
    p.className = "rc-fine";
    var k = code(st, fips, name);
    var c = document.createElement("code");
    c.textContent = k;
    c.style.cssText = "display:block;overflow-wrap:anywhere;font-size:.8rem;margin:.2rem 0";
    p.appendChild(document.createTextNode("For your website: "));
    p.appendChild(button(function () { return k; }));
    p.appendChild(c);
    box.insertBefore(p, s || null);
  }
  function init() {
    var boxes = document.querySelectorAll("details.rc-emb");
    Array.prototype.forEach.call(boxes, function (box) {
      if (box.open) fill(box);
      box.addEventListener("toggle", function () { if (box.open) fill(box); });
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
