/* Season so far in the home Local conditions card (Sig, Nov 4, 2026: "I would like the YTD rain and GDUs to be
 * displayed year round, as well as the 30-day amounts for each, and the departure from normal").
 *
 * One reader for the county rain page's own figures, never a second calculation:
 *   rain, Jan 1 to the last reported day, and its usual       data/rain/<st>.json  total, usual, pct, as_of
 *   rain, the last 30 days, and the usual for those days       data/rain/<st>.json  r30 (fetch_county_rain.recent30,
 *                                                              the same function as the county page's "Last 30 days")
 *   corn GDDs (86/50) from May 1 and their 1991-2020 average   data/rain/wx/<st>.json g  (fetch_rain_weather)
 *   corn GDDs over the last 30 days and their average          data/rain/wx/<st>.json g30
 *   last season's corn GDDs, Jan 1 to Apr 30                   data/rain/wx/<st>.json gp
 * The only arithmetic here is a departure, figure minus its normal, as the county page's month table does it.
 * Every figure carries its own dates. Whether a figure has enough days is decided where it is built, never here:
 * a county row in the rain file passed the county page's own rule (county_rain.MIN_SHARE), r30 "m" and a GDD "m"
 * are the builders' withholds, and each reads "Not enough days reported". Nov 8 (Sig): the card keeps no stations
 * and sources paragraph (the county rain page keeps its method text); the shared picture names its source.
 *
 * Two month charts, one drawing (Sig, Nov 8: "add back the gdu by month chart like the precip chart", then "make sure
 * the month by month chart is perfect and readable clickable and shareable"):
 *   Rain by month   data/rain/<st>.json months  [rain, usual for the same reported days, days reported, days so far]
 *   GDDs by month   data/rain/wx/<st>.json gm   [GDDs, 1991-2020 normal for the same days or null, reported, so far];
 *                   a month the builder withheld is null and reads "not enough days reported"
 * Drawn at the panel's own width (1 unit = 1 px, so 12 px text is 12 px), a gridline at the top and the middle with
 * their values, the month still running drawn lighter and named "so far". Each month is a tap target the full column
 * high; a tap, or keyboard focus (arrow keys, Home, End), writes the month's numbers in the readout line under the
 * chart (aria-live). A percent is printed only on a usual of 0.50 in or 50 GDDs or more (a tiny normal makes a wild
 * percent; GDD30_PCT_MIN in fetch_rain_weather.py). "Save picture" draws the chart on the share kit's card
 * (components/share-kit.js); without the kit the chart works as ever and the button says it is unavailable.
 *
 *   AgSeason.fipsFor(rainFile, countyName)        the county's FIPS in a state rain file, or null
 *   AgSeason.model(rainFile, wxFile, fips)        what the block shows (no DOM)
 *   AgSeason.html(model, today)                   the block's HTML (today: an ISO date, for the year in a label)
 *   AgSeason.chart(model, width)                  the rain-by-month panel (SVG, legend, readout), or ""
 *   AgSeason.chartGdd(model, width)               the GDDs-by-month panel, or ""
 *   AgSeason.spec(model, "rain"|"gdd")            one chart as data; AgSeason.readout(spec, i) a month's line
 *   AgSeason.image(spec, doc, {wide})             the share picture: {canvas, texts, sizes, boxes}
 */
(function () {
  "use strict";
  var M3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var MINUS = "−", NOPE = "Not enough days reported";
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function num(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
  /* the county page's inch() is Python's f"{x:.2f}"; toFixed(2) rounds the same double the same way */
  function inch(x) { return x.toFixed(2); }
  function mdIso(iso) { return M3[+iso.slice(5, 7) - 1] + " " + (+iso.slice(8, 10)); }
  function mdNum(v) { return M3[Math.floor(v / 100) - 1] + " " + (v % 100); }
  function isoOf(year, mmdd) { return year + "-" + ("0" + Math.floor(mmdd / 100)).slice(-2) + "-" + ("0" + (mmdd % 100)).slice(-2); }
  function back(iso, days) { var d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() - days); return d.toISOString().slice(0, 10); }
  function span(a, b) { return a.slice(0, 7) === b.slice(0, 7) ? mdIso(a) + " to " + (+b.slice(8, 10)) : mdIso(a) + " to " + mdIso(b); }
  function norm(s) {
    return String(s || "").toLowerCase().replace(/\b(county|parish|borough|census area|city and borough|municipality)\b/g, "")
      .replace(/\bsaint\b/g, "st").replace(/[^a-z]/g, "");
  }

  function fipsFor(file, county) {
    var want = norm(county);
    if (!file || !want) return null;
    var pools = [file.counties || {}, file.none || {}];
    for (var p = 0; p < pools.length; p++) for (var f in pools[p]) if (norm(pools[p][f].name) === want) return f;
    return null;
  }

  /* a GDD row [total, missing, normal, years, percent] -> a figure */
  function gddFig(g) {
    if (g === "m") return { status: "thin" };
    if (!g || !g.length) return null;
    var o = { status: "ok", value: g[0], missing: g[1] };
    if (g.length > 2 && g[2] != null) { o.normal = g[2]; o.years = g[3]; o.dep = g[0] - g[2]; o.pct = g[4] == null ? null : g[4]; }
    return o;
  }

  function model(rain, wx, fips) {
    var m = { fips: fips, rain: null, rain30: null, gdd: null, gdd30: null, near: null };
    var c = rain && rain.counties && rain.counties[fips];
    if (!c && rain && rain.none && rain.none[fips] && rain.counties && rain.counties[rain.none[fips].near]) {
      m.near = { name: rain.none[fips].name, from: rain.counties[rain.none[fips].near].name };
      fips = rain.none[fips].near;
      c = rain.counties[fips];
    }
    m.year = rain && rain.year;
    m.state = rain && rain.state ? String(rain.state).toUpperCase() : "";
    if (c) {
      m.county = c.name;
      m.station = c.station ? { name: c.station.name, mi: c.station.mi, cocorahs: c.station.net === "cocorahs" } : null;
      m.normals = rain.normals;
      // the row is in the file only if it passed the county page's rule; a row with no total is withheld too
      m.rain = c.total == null ? { status: "thin", from: rain.year + "-01-01", to: c.as_of }
        : { status: "ok", value: c.total, normal: c.usual, dep: c.usual == null ? null : c.total - c.usual,
          pct: c.pct, from: rain.year + "-01-01", to: c.as_of, missing: c.missing };
      if (c.r30 !== undefined) {
        var f = back(c.as_of, 29);
        m.rain30 = c.r30 === "m" ? { status: "thin", from: f, to: c.as_of }
          : { status: "ok", value: c.r30[0], normal: c.r30[1], dep: c.r30[1] == null ? null : c.r30[0] - c.r30[1],
            pct: c.r30[2], from: f, to: c.as_of };
      }
      m.months = c.months || null;
    }
    var w = wx && wx.counties && wx.counties[fips];
    m.wxLoaded = !!(wx && wx.counties);
    if (w) {
      var to = isoOf(wx.year, w.a);
      m.wxStation = w.s ? { where: w.s[0], mi: w.s[2] } : "same";
      var g = gddFig(w.g);
      if (g) { g.from = wx.year + "-05-01"; g.to = to; g.season = wx.year; m.gdd = g; }
      else if (w.gp) {
        var gp = gddFig(w.gp.g);
        if (gp) { gp.from = w.gp.y + "-05-01"; gp.to = isoOf(w.gp.y, w.gp.a); gp.season = w.gp.y; gp.last = true; m.gdd = gp; }
        if (w.gp.s) m.gpStation = { where: w.gp.s[0], mi: w.gp.s[2] };
      }
      if (!m.gdd) m.gdd = { status: "wait", to: to };
      var g3 = gddFig(w.g30);
      if (g3) { g3.from = back(to, 29); g3.to = to; m.gdd30 = g3; }
      if (Array.isArray(w.gm) && w.gm.length) { m.gmonths = w.gm; m.wxYear = wx.year; m.wxTo = to; }
    }
    return m;
  }

  function tile(label, f, unit, fmt, k) {
    var body;
    if (!f) body = '<span class="wxs-v wxs-nl">Not loaded yet</span>';
    else if (f.status === "thin") body = '<span class="wxs-v wxs-nl">' + NOPE + "</span>";
    else if (f.status === "wait") body = '<span class="wxs-v wxs-nl">Counted from May 1</span>';
    else {
      var d = "";
      if (f.dep != null) {
        /* the county page's month table: a sign past half a hundredth (0.004 in), then the rounded size, so a
           departure of 0.0045 reads "+0.00" on both; GDDs are whole numbers */
        var eps = unit === "in" ? 0.004 : 0, up = f.dep > eps, dn = f.dep < -eps;
        var cls = up ? "wxs-up" : dn ? "wxs-dn" : "";
        d = '<span class="wxs-d ' + cls + '">' + (up ? "+" : dn ? MINUS : "") + fmt(Math.abs(f.dep)) + (unit === "in" ? " in" : "") + (f.pct != null ? " (" + f.pct + "%)" : "") + "</span>";
      } else d = '<span class="wxs-d">No normal for this station</span>';
      body = '<span class="wxs-v">' + fmt(f.value) + (unit === "in" ? ' <small>in</small>' : ' <small>GDDs</small>') + "</span>" + d;
    }
    return '<div class="wxs-t" data-k="' + k + '"><span class="wxs-k">' + label + "</span>" + body + "</div>";
  }

  function html(m, today) {
    var r = m.rain, r3 = m.rain30, g = m.gdd, g3 = m.gdd30, out = [];
    var yNow = String(today || new Date().toISOString()).slice(0, 4);
    /* a figure from a finished year (January reads last year through Dec 31) names its year */
    function lab(what, f, dflt) { return esc(what) + ", " + (f && f.from && f.to ? span(f.from, f.to) + (f.to.slice(0, 4) !== yNow ? ", " + f.to.slice(0, 4) : "") : dflt); }
    out.push('<div class="wxs-grid">');
    out.push(tile(lab("Rain", r, "since Jan 1"), r, "in", inch, "rain"));
    out.push(tile(lab("Rain", r3, "last 30 days"), r3, "in", inch, "rain30"));
    var gl = g && g.last ? "GDDs, " + g.season + " season, " + span(g.from, g.to) : lab("GDDs", g && g.status !== "wait" ? g : null, "from May 1");
    out.push(tile(gl, m.wxLoaded || g ? g : null, "gdd", num, "gdd"));
    out.push(tile(lab("GDDs", g3, "last 30 days"), g3, "gdd", num, "gdd30"));
    out.push("</div>");
    // Nov 8 (Sig): no stations and sources paragraph on the home card; a county read from its neighbor still says so
    if (m.near) out.push('<p class="wxs-near">' + esc(m.near.name) + " has no NOAA station with a full record this year; these are " + esc(m.near.from) + "&rsquo;s, next door.</p>");
    var hasR = !!(m.months && m.months.length), hasG = !!(m.gmonths && m.gmonths.length);
    if (hasR || hasG) {
      out.push('<div class="wxs-foot">');
      if (hasR) out.push('<button type="button" class="wxs-b" id="wxs-chart-b" aria-expanded="false" aria-controls="wxs-chart">Rain by month</button>');
      if (hasG) out.push('<button type="button" class="wxs-b" id="wxs-gchart-b" aria-expanded="false" aria-controls="wxs-gchart">GDDs by month</button>');
      out.push("</div>");
      if (hasR) out.push('<div class="wxs-chart" id="wxs-chart" data-kind="rain" hidden></div>');
      if (hasG) out.push('<div class="wxs-chart" id="wxs-gchart" data-kind="gdd" hidden></div>');
    }
    return out.join("");
  }

  /* ---------------------------------------------------------------- the month charts (rain and GDDs, one drawing) */
  function dim(y, i) { return new Date(Date.UTC(+y, i + 1, 0)).getUTCDate(); }
  function trim(v) { return String(+v.toFixed(2)); }
  var KIND = {
    rain: { title: "Rain by month", v: function (x) { return inch(x) + " in"; }, d: function (x) { return inch(x) + " in"; },
      bar: inch, eps: 0.004, pmin: 0.5, least: 0.1, ax: trim, axTop: function (v) { return trim(v) + " in"; } },
    gdd: { title: "GDDs by month", v: function (x) { return num(x) + " GDDs"; }, d: num,
      bar: num, eps: 0, pmin: 50, least: 10, ax: num, axTop: function (v) { return num(v) + " GDDs"; } }
  };
  KIND.rain.u = KIND.rain.d; KIND.gdd.u = num;

  /* one chart as data: the months, the year and its through day, whether the last month is still running */
  function spec(m, kind) {
    var g = kind === "gdd", mo = m && (g ? m.gmonths : m.months);
    if (!mo || !mo.length) return null;
    var year = g ? (m.wxYear || m.year) : m.year, to = g ? m.wxTo : (m.rain && m.rain.to), last = mo.length - 1, lx = mo[last];
    var thru = to && +to.slice(5, 7) === mo.length ? +to.slice(8, 10) : lx ? lx[3] : null;
    return { kind: g ? "gdd" : "rain", k: KIND[g ? "gdd" : "rain"], months: mo, year: year, to: to || null,
      part: thru != null && thru < dim(year, last), thru: thru, county: m.county || "", state: m.state || "",
      cocorahs: !!(m.station && m.station.cocorahs) };
  }
  /* the top of the scale: the next of 1, 2, 4, 6, 8, 10 times a power of ten at or over the tallest bar, so the
     middle gridline is a round number too */
  function scale(s) {
    var max = s.k.least;
    s.months.forEach(function (x) { if (x) max = Math.max(max, x[0] || 0, x[1] == null ? 0 : x[1]); });
    var p = Math.pow(10, Math.floor(Math.log(max) / Math.LN10)), st = [1, 2, 4, 6, 8, 10];
    for (var i = 0; i < st.length; i++) if (st[i] * p >= max - 1e-9) return +(st[i] * p).toPrecision(6);
    return 10 * p;
  }
  function mlabel(s, i) {
    if (s.part && i === s.months.length - 1) return M3[i] + (s.thru === 1 ? " 1" : " 1 to " + s.thru) + ", so far";
    return M3[i];
  }
  /* a month's line: "Sep: 7.18 in, usual 3.49 in, +3.69 in (206%)", "Jul: 712 GDDs, usual 680, +32 (105%)" */
  function readout(s, i) {
    if (!s || i < 0 || i > 11) return "";
    if (i >= s.months.length) return M3[i] + ": still to come";
    var x = s.months[i], k = s.k, t = mlabel(s, i) + ": ";
    if (!x) return t + "not enough days reported";
    t += k.v(x[0]);
    if (x[1] != null) {
      var dep = x[0] - x[1], up = dep > k.eps, dn = dep < -k.eps;
      t += ", usual " + k.u(x[1]) + ", " + (up ? "+" : dn ? MINUS : "") + k.d(Math.abs(dep));
      if (x[1] >= k.pmin) t += " (" + Math.round(100 * x[0] / x[1]) + "%)";
    } else t += ", no normal for this station";
    if (x[2] < x[3]) t += ", " + (x[3] - x[2]) + (x[3] - x[2] === 1 ? " day" : " days") + " not reported";
    return t;
  }
  /* the panel: the chart at width W px (1 unit = 1 px), its legend, the readout line and Save picture */
  function panel(s, W) {
    if (!s) return "";
    W = Math.max(280, Math.min(560, Math.round(W || 360)));
    var k = s.k, top = scale(s), mid = top / 2, H = 156, T = 10, B = H - 22, ph = B - T, n = s.months.length;
    var lt = k.axTop(top), lm = k.ax(mid), L = Math.ceil(Math.max(lt.length, lm.length) * 6.9) + 8, bw = (W - L - 2) / 12;
    function y(v) { return B - (v / top) * ph; }
    function f1(v) { return v.toFixed(1); }
    var o = '<svg class="wxs-svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + " " + H + '" role="group" aria-label="' +
      k.title + ", " + s.year + ', against the usual for the same days. Arrow keys move between months.">';
    [[top, lt], [mid, lm]].forEach(function (g) {
      var yy = y(g[0]);
      o += '<line x1="' + L + '" x2="' + (W - 2) + '" y1="' + f1(yy) + '" y2="' + f1(yy) + '" class="wxs-gl"/>' +
        '<text x="' + (L - 6) + '" y="' + f1(yy + 4) + '" text-anchor="end" class="wxs-cl">' + g[1] + "</text>";
    });
    o += '<line x1="' + L + '" x2="' + (W - 2) + '" y1="' + B + '" y2="' + B + '" class="wxs-gl wxs-base"/>';
    for (var i = 0; i < 12; i++) {
      var x0 = L + i * bw, x = s.months[i], lab = '<text x="' + f1(x0 + bw / 2) + '" y="' + (H - 6) + '" text-anchor="middle" class="wxs-cl">' + M3[i].charAt(0) + "</text>";
      if (i >= n) { o += lab; continue; }
      var pc = s.part && i === n - 1 ? " wxs-part" : "", bars = "";
      if (x) {
        var hu = x[1] == null ? 0 : (x[1] / top) * ph, ht = (x[0] / top) * ph;
        if (x[1] != null) bars += '<rect x="' + f1(x0 + bw * 0.12) + '" y="' + f1(B - hu) + '" width="' + f1(bw * 0.36) + '" height="' + f1(hu) + '" class="wxs-cu' + pc + '"><title>' + M3[i] + " usual " + k.v(x[1]) + "</title></rect>";
        bars += '<rect x="' + f1(x0 + bw * 0.5) + '" y="' + f1(B - ht) + '" width="' + f1(bw * 0.36) + '" height="' + f1(ht) + '" class="wxs-cy' + pc + '"><title>' + M3[i] + " " + k.v(x[0]) +
          (x[2] < x[3] ? ", " + (x[3] - x[2]) + (x[3] - x[2] === 1 ? " day" : " days") + " not reported" : "") + "</title></rect>";
      }
      o += '<g class="wxs-m" data-i="' + i + '" tabindex="' + (i === n - 1 ? 0 : -1) + '" role="button" aria-label="' + esc(readout(s, i)) + '">' +
        '<rect class="wxs-hit" x="' + f1(x0) + '" y="0" width="' + f1(bw) + '" height="' + H + '"/>' + bars + lab + "</g>";
    }
    o += "</svg>";
    var id = s.kind === "gdd" ? "wxs-gread" : "wxs-rread";
    return o + '<p class="wxs-cleg"><span class="wxs-sw wxs-cu"></span>Usual <span class="wxs-sw wxs-cy"></span>' + s.year +
      (s.to ? ", Jan 1 to " + mdIso(s.to) : "") + (s.part ? ' <span class="wxs-sw wxs-cy wxs-part"></span>' + M3[n - 1] + " so far" : "") + "</p>" +
      '<p class="wxs-read" id="' + id + '" aria-live="polite">Tap a month to read it.</p>' +
      '<button type="button" class="wxs-b wxs-pic" data-kind="' + s.kind + '">Save picture</button>';
  }
  /* rain by month: this year against the usual for the same reported days (the county page's month table) */
  function chart(m, W) { return panel(spec(m, "rain"), W); }
  /* GDDs by month: this year's corn GDDs against the station's 1991-2020 average for the same reported days */
  function chartGdd(m, W) { return panel(spec(m, "gdd"), W); }

  /* ---------------------------------------------------------------- the share picture
     The share kit's dark card (components/share-kit.js): agsist.com, the county and state with the year and its
     through day, the chart's title, the chart with three-letter months, each month's figure over its bar, the
     legend, and the source. 1080 x 1350 for a phone, 1200 x 630 wide; every word 20 px or more. Every word's box is
     kept (boxes) so a test can see that none overlap. -> {canvas, texts, sizes, boxes, w, h}, or null without the kit */
  function SK() { return (typeof window !== "undefined" && window.AgShareKit) || (typeof require === "function" ? require("./share-kit.js") : null); }
  var PIC_U = "#7fae86";
  function image(s, doc, o) {
    o = o || {};
    var K = SK();
    if (!K || !s) return null;
    var wide = !!o.wide, W = wide ? 1200 : 1080, H = wide ? 630 : 1350, P = wide ? 48 : 60, GOLD = K.GOLD, INK = K.INK, DIM = K.DIM;
    var c = K.canvas(doc, W, H), ctx = c.getContext("2d"), p = K.pen(ctx), boxes = [];
    K.frame(ctx, W, H, wide ? 10 : 12);
    function put(str, x, y, size, weight, ink, al) {
      p.font(size, weight);
      var w = ctx.measureText(str).width, x0 = al === "right" ? x - w : al === "center" ? x - w / 2 : x;
      p.text(str, x, y, size, weight, ink, al);
      boxes.push({ s: str, x0: x0, x1: x0 + w, y0: y - size * 0.8, y1: y + size * 0.24 });
      return w;
    }
    function fit(str, x, y, size, min, weight, ink, width) { return put(str, x, y, p.fit(str, size, min, weight, width), weight, ink); }
    var place = [s.county, s.state].filter(Boolean).join(", "), when = s.year + (s.to ? ", Jan 1 to " + mdIso(s.to) : "");
    var src = "NOAA daily records via RCC-ACIS." + (s.kind === "rain" && s.cocorahs ? " Volunteer gauge data: CoCoRaHS." : "");
    var sub = s.kind === "rain" ? "Rain against the usual for the same days" : "Corn GDDs (86/50) against the 1991 to 2020 average for the same days";
    var L = {};
    if (wide) {
      fit(s.k.title, P, 62, 44, 32, 800, INK, W - 2 * P);
      var aw = put("agsist.com", P, 102, 24, 800, GOLD);
      fit([place, when].filter(Boolean).join(" · "), P + aw + 16, 102, 24, 20, 600, DIM, W - 2 * P - aw - 16);
      fit(sub, P, 136, 20, 20, 500, DIM, W - 2 * P);
      L = { x: P, x1: W - P, top: 192, bot: 518, fs: 22, ml: 22, vl: 20, leg: 584, legs: 22, src: 616, srcs: 20 };
    } else {
      put("agsist.com", P, 84, 36, 800, GOLD);
      fit([place, when].filter(Boolean).join(" · "), P, 132, 28, 20, 600, DIM, W - 2 * P);
      fit(s.k.title, P, 222, 64, 44, 800, INK, W - 2 * P);
      fit(sub, P, 268, 26, 20, 500, DIM, W - 2 * P);
      L = { x: P, x1: W - P, top: 360, bot: 1100, fs: 26, ml: 26, vl: 22, leg: 1210, legs: 28, src: H - 56, srcs: 22 };
    }
    var top = scale(s), mid = top / 2, ph = L.bot - L.top, lt = s.k.axTop(top), lm = s.k.ax(mid);
    p.font(L.fs, 600);
    var gut = Math.ceil(Math.max(ctx.measureText(lt).width, ctx.measureText(lm).width)) + 16, x0 = L.x + gut, bw = (L.x1 - x0) / 12;
    function y(v) { return L.bot - (v / top) * ph; }
    ctx.fillStyle = "rgba(233,237,235,.18)";
    [[top, lt], [mid, lm]].forEach(function (g) {
      ctx.fillRect(x0, Math.round(y(g[0])), L.x1 - x0, 1);
      put(g[1], x0 - 14, y(g[0]) + L.fs * 0.35, L.fs, 600, DIM, "right");
    });
    ctx.fillStyle = "rgba(233,237,235,.45)"; ctx.fillRect(x0, L.bot, L.x1 - x0, 2);
    for (var i = 0; i < 12; i++) {
      var cx = x0 + i * bw, x = s.months[i], part = s.part && i === s.months.length - 1;
      put(M3[i], cx + bw / 2, L.bot + L.ml + 12, L.ml, 600, i < s.months.length ? INK : DIM, "center");
      if (i >= s.months.length) continue;
      if (!x) { put("n/a", cx + bw / 2, L.bot - 12, L.vl, 600, DIM, "center"); continue; }
      var hu = x[1] == null ? 0 : (x[1] / top) * ph, ht = (x[0] / top) * ph;
      ctx.globalAlpha = part ? 0.4 : 1;
      if (x[1] != null) { ctx.fillStyle = PIC_U; ctx.fillRect(cx + bw * 0.12, L.bot - hu, bw * 0.36, hu); }
      ctx.fillStyle = GOLD; ctx.fillRect(cx + bw * 0.5, L.bot - ht, bw * 0.36, ht);
      ctx.globalAlpha = 1;
      if (part) {
        ctx.lineWidth = 2;
        if (x[1] != null && hu > 2) { ctx.strokeStyle = PIC_U; ctx.strokeRect(cx + bw * 0.12 + 1, L.bot - hu + 1, bw * 0.36 - 2, hu - 2); }
        if (ht > 2) { ctx.strokeStyle = GOLD; ctx.strokeRect(cx + bw * 0.5 + 1, L.bot - ht + 1, bw * 0.36 - 2, ht - 2); }
      }
      /* the month's figure over its bars, shrunk to the column, left off when it cannot fit at 20 px */
      var v = s.k.bar(x[0]), vs = p.fit(v, L.vl, 20, 700, bw - 6);
      p.font(vs, 700);
      if (ctx.measureText(v).width <= bw - 6) put(v, cx + bw / 2, L.bot - Math.max(ht, hu) - 10, vs, 700, INK, "center");
    }
    /* the legend: swatch and words, left to right */
    var lx = L.x, sw = Math.round(L.legs * 0.8);
    function key(ink, words, hollow) {
      ctx.globalAlpha = hollow ? 0.4 : 1; ctx.fillStyle = ink; ctx.fillRect(lx, L.leg - sw + 2, sw, sw); ctx.globalAlpha = 1;
      if (hollow) { ctx.strokeStyle = ink; ctx.lineWidth = 2; ctx.strokeRect(lx + 1, L.leg - sw + 3, sw - 2, sw - 2); }
      lx += sw + 10;
      lx += put(words, lx, L.leg, L.legs, 600, INK) + 28;
    }
    key(PIC_U, "Usual");
    key(GOLD, when);
    if (s.part) key(GOLD, M3[s.months.length - 1] + " so far", true);
    fit(src, L.x, L.src, L.srcs, 20, 500, DIM, W - 2 * P);
    return { canvas: c, texts: p.texts, sizes: p.sizes, boxes: boxes, w: W, h: H };
  }

  var api = { fipsFor: fipsFor, model: model, html: html, chart: chart, chartGdd: chartGdd, spec: spec, readout: readout, panel: panel, image: image, scale: scale, norm: norm };
  if (typeof window !== "undefined") window.AgSeason = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof document === "undefined") return;

  /* ---- the home card ---- */
  var box = document.getElementById("wx-season");
  if (!box) return;
  var key = null, seq = 0;
  function get(u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); }
  function where() {
    var w = (window.AGSIST_STATE && window.AGSIST_STATE.weather) || {}, l = null;
    try { l = JSON.parse(localStorage.getItem("agsist-wx-loc") || "null"); } catch (e) {}
    var zip = /^\d{5}$/.test(String(w.zip || "")) ? String(w.zip) : (l && /^\d{5}$/.test(String(l.zip || "")) ? String(l.zip) : "");
    return { zip: zip, st: String(w.state || (l && l.state) || ""), county: String(w.county || (l && l.county) || "") };
  }
  /* the share kit, loaded once when a month chart first opens (home-kit.js loads the same file); null when it fails */
  var SK_JS = "/components/share-kit.js?v=1", kitState, kitWait = [];
  function kit(cb) {
    if (window.AgShareKit) { kitState = window.AgShareKit; return cb(kitState); }
    if (kitState === null) return cb(null);
    kitWait.push(cb);
    if (kitState === "loading") return;
    kitState = "loading";
    function done() { kitState = window.AgShareKit || null; var q = kitWait; kitWait = []; q.forEach(function (f) { f(kitState); }); }
    var sc = document.createElement("script"); sc.src = SK_JS; sc.async = true; sc.onload = done; sc.onerror = done; document.head.appendChild(sc);
  }
  var cur = null;
  function picOff(p) {
    var b = p.querySelector(".wxs-pic");
    if (b) { b.disabled = true; b.setAttribute("aria-disabled", "true"); b.textContent = "Picture not available right now"; }
  }
  function say(b, words) { var back = "Save picture"; b.textContent = words; setTimeout(function () { b.textContent = back; }, 2400); }
  function slug(x) { return String(x || "county").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
  function select(p, s, i) {
    var gs = p.querySelectorAll(".wxs-m"), on = null;
    for (var j = 0; j < gs.length; j++) {
      var me = +gs[j].getAttribute("data-i") === i;
      gs[j].setAttribute("tabindex", me ? "0" : "-1");
      gs[j].classList.toggle("wxs-on", me);
      if (me) on = gs[j];
    }
    if (!on) return null;
    p.setAttribute("data-sel", String(i));
    var r = p.querySelector(".wxs-read");
    if (r) r.textContent = readout(s, i);
    return on;
  }
  function draw(p) {
    var s = spec(cur, p.getAttribute("data-kind"));
    if (!s) return;
    p._s = s;
    p.innerHTML = panel(s, p.clientWidth || 360);
    p._w = p.clientWidth;
    var sel = p.getAttribute("data-sel");
    if (sel != null) select(p, s, +sel);
    kit(function (K) { if (!K) picOff(p); });
  }
  function picture(p, b) {
    var s = p._s;
    kit(function (K) {
      if (!K) { picOff(p); return; }
      var pg = "home-" + s.kind + "-month";
      K.ga(K.EV.open, { asset: "picture", page: pg });
      var wide = !K.coarse(window) && (window.innerWidth || 1200) >= 700;
      (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(function () {
        var im = image(s, document, { wide: wide });
        if (!im) { say(b, "Could not draw the picture here"); return; }
        api.lastImage = { w: im.w, h: im.h, texts: im.texts, sizes: im.sizes, boxes: im.boxes };
        im.canvas.toBlob(function (blob) {
          if (!blob) { say(b, "Could not draw the picture here"); return; }
          var name = "agsist-" + (s.kind === "gdd" ? "gdds" : "rain") + "-by-month-" + slug(s.county) + "-" + (s.to || s.year) + ".png", file = K.file(blob, name);
          var link = "https://agsist.com/?" + K.tags("share", "picture", pg + "-" + K.isoDay());
          function saved() { K.download(document, blob, name); K.ga(K.EV.download, { page: pg }); say(b, "Picture saved"); }
          if (K.canShareFile(window, file)) {
            K.share(window, { files: [file], title: s.k.title, text: s.k.title + ", " + [s.county, s.state].filter(Boolean).join(", ") + ": " + link },
              function () { K.ga(K.EV.done, { asset: "picture", page: pg }); }, saved);
            return;
          }
          saved();
        }, "image/png");
      });
    });
  }
  function hook(p) {
    function g(e) { return e.target && e.target.closest ? e.target.closest(".wxs-m") : null; }
    p.addEventListener("click", function (e) {
      var b = e.target && e.target.closest ? e.target.closest(".wxs-pic") : null;
      if (b) { if (!b.disabled) picture(p, b); return; }
      var t = g(e);
      if (t) { select(p, p._s, +t.getAttribute("data-i")); try { t.focus({ preventScroll: true }); } catch (x) {} }
    });
    p.addEventListener("focusin", function (e) { var t = g(e); if (t) select(p, p._s, +t.getAttribute("data-i")); });
    p.addEventListener("keydown", function (e) {
      var t = g(e);
      if (!t) return;
      var i = +t.getAttribute("data-i"), n = p._s.months.length, to = i;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") to = Math.min(n - 1, i + 1);
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") to = Math.max(0, i - 1);
      else if (e.key === "Home") to = 0;
      else if (e.key === "End") to = n - 1;
      else if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      var on = select(p, p._s, to);
      if (on && to !== i) on.focus();
    });
  }
  var PAIRS = [["wxs-chart-b", "wxs-chart"], ["wxs-gchart-b", "wxs-gchart"]];
  function wire() {
    PAIRS.forEach(function (a) {
      var b = document.getElementById(a[0]), p = document.getElementById(a[1]);
      if (!b || !p) return;
      hook(p);
      b.addEventListener("click", function () {
        var on = p.hidden;
        // one month chart open at a time
        PAIRS.forEach(function (o) {
          var ob = document.getElementById(o[0]), op = document.getElementById(o[1]);
          if (op && op !== p) { op.hidden = true; if (ob) ob.setAttribute("aria-expanded", "false"); }
        });
        p.hidden = !on;
        b.setAttribute("aria-expanded", on ? "true" : "false");
        if (on) draw(p);
      });
    });
  }
  window.addEventListener("resize", function () {
    PAIRS.forEach(function (a) { var p = document.getElementById(a[1]); if (p && !p.hidden && p.clientWidth !== p._w) draw(p); });
  });
  function paint(s) { box.innerHTML = s; box.classList.add("loaded"); }
  function load() {
    var at = where(), k = at.zip + "|" + at.st + "|" + at.county;
    if (k === key || (!at.zip && !at.county)) return;
    key = k;
    var mine = ++seq;
    var place = at.zip ? get("/data/places/zip/" + at.zip.slice(0, 2) + ".json").then(function (t) {
      var r = t && t[at.zip];
      return r ? { st: String(r[3] || "").toUpperCase(), county: r[4] } : null;
    }).catch(function () { return null; }) : Promise.resolve(null);
    place.then(function (p) {
      var st = (p && p.st) || (window.agsistStateCode ? window.agsistStateCode(at.st) : at.st.toUpperCase());
      var county = (p && p.county) || at.county;
      if (!/^[A-Z]{2}$/.test(st) || !county) { if (mine === seq) paint('<p class="wxs-msg">No county found for this place, so no season totals.</p>'); return; }
      var s = st.toLowerCase();
      return Promise.all([get("/data/rain/" + s + ".json").catch(function () { return null; }), get("/data/rain/wx/" + s + ".json").catch(function () { return null; })]).then(function (f) {
        if (mine !== seq) return;
        if (!f[0]) { paint('<p class="wxs-msg">The season totals did not load. They come back on the next visit.</p>'); return; }
        var fips = fipsFor(f[0], county);
        if (!fips) { paint('<p class="wxs-msg">No county rain record for ' + esc(county) + ", " + esc(st) + ".</p>"); return; }
        var m = model(f[0], f[1], fips);
        if (!m.rain) { paint('<p class="wxs-msg">No NOAA station in ' + esc(county) + " reported enough days this year.</p>"); return; }
        cur = m;
        paint(html(m));
        wire();
      });
    }).catch(function () { if (mine === seq) paint('<p class="wxs-msg">The season totals did not load.</p>'); });
  }
  load();
  setInterval(function () { if (document.visibilityState !== "hidden") load(); }, 2500);
})();
