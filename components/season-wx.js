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
 * are the builders' withholds, and each reads "Not enough days reported". The stations are named on tap; the
 * sources are named in plain text, never linked.
 *
 *   AgSeason.fipsFor(rainFile, countyName)        the county's FIPS in a state rain file, or null
 *   AgSeason.model(rainFile, wxFile, fips)        what the block shows (no DOM)
 *   AgSeason.html(model, today)                   the block's HTML (today: an ISO date, for the year in a label)
 *   AgSeason.chart(model)                         the rain-by-month chart (SVG), or ""
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
    // stations and sources, on tap
    var s = [];
    if (m.near) s.push(esc(m.near.name) + " has no NOAA station with a full record this year; these are " + esc(m.near.from) + "&rsquo;s, next door.");
    if (m.station) s.push("Rain: the " + (m.station.cocorahs ? "volunteer gauge " : "NOAA station ") + esc(m.station.name) + ", " + m.station.mi + " mi from the middle of " + esc(m.county || "the county") +
      ", against NOAA&rsquo;s " + (m.normals === "1991-2020" ? "1991 to 2020" : "current 30-year") + " daily normals for the same days. Days not reported are left out of both.");
    if (m.wxStation) s.push("GDDs are corn growing degree days (86/50): " + (m.wxStation === "same" ? "highs and lows from the same station" : "highs and lows from the weather station " + esc(m.wxStation.where) + ", " + m.wxStation.mi + " mi from the rain " + (m.station && m.station.cocorahs ? "gauge" : "station")) +
      "; each day&rsquo;s high and low held between 50&deg;F and 86&deg;F, averaged, minus 50. Normal: the station&rsquo;s own 1991 to 2020 average for the same days" + (m.gdd && m.gdd.years ? " (" + m.gdd.years + " years)" : "") + ".");
    if (m.gpStation) s.push("Last season&rsquo;s GDDs: " + esc(m.gpStation.where) + ", " + m.gpStation.mi + " mi off.");
    s.push("A figure is shown only with enough days reported, by the county rain page&rsquo;s own rule; the 30-day rain needs every day. NOAA daily records through RCC-ACIS." +
      (m.station && m.station.cocorahs ? " Volunteer gauge data: CoCoRaHS." : ""));
    out.push('<div class="wxs-foot">');
    if (m.months && m.months.length) out.push('<button type="button" class="wxs-b" id="wxs-chart-b" aria-expanded="false" aria-controls="wxs-chart">Rain by month</button>');
    out.push('<details class="wxs-src"><summary>Stations and sources</summary><p>' + s.join(" ") + "</p></details></div>");
    if (m.months && m.months.length) out.push('<div class="wxs-chart" id="wxs-chart" hidden></div>');
    return out.join("");
  }

  /* rain by month: this year against the usual for the same reported days (the county page's month table) */
  function chart(m) {
    var mo = m.months;
    if (!mo || !mo.length) return "";
    var W = 360, H = 120, pad = 14, n = 12, bw = (W - 8) / n, max = 0.1;
    mo.forEach(function (x) { max = Math.max(max, x[0] || 0, x[1] || 0); });
    var bars = "";
    for (var i = 0; i < n; i++) {
      var x0 = 4 + i * bw, x = mo[i];
      if (x) {
        var hu = x[1] == null ? 0 : (x[1] / max) * (H - pad * 2), ht = (x[0] / max) * (H - pad * 2);
        if (x[1] != null) bars += '<rect x="' + (x0 + bw * 0.12).toFixed(1) + '" y="' + (H - pad - hu).toFixed(1) + '" width="' + (bw * 0.36).toFixed(1) + '" height="' + hu.toFixed(1) + '" class="wxs-cu"><title>' + M3[i] + " usual " + inch(x[1]) + " in</title></rect>";
        bars += '<rect x="' + (x0 + bw * 0.5).toFixed(1) + '" y="' + (H - pad - ht).toFixed(1) + '" width="' + (bw * 0.36).toFixed(1) + '" height="' + ht.toFixed(1) + '" class="wxs-cy"><title>' + M3[i] + " " + inch(x[0]) + " in" + (x[2] < x[3] ? ", " + (x[3] - x[2]) + (x[3] - x[2] === 1 ? " day" : " days") + " not reported" : "") + "</title></rect>";
      }
      bars += '<text x="' + (x0 + bw / 2).toFixed(1) + '" y="' + (H - 2) + '" text-anchor="middle" class="wxs-cl">' + M3[i].charAt(0) + "</text>";
    }
    return '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Rain by month, ' + m.year + ', against the usual for the same days">' + bars +
      '<text x="4" y="10" class="wxs-cl">' + inch(max) + " in</text></svg>" +
      '<p class="wxs-cleg"><span class="wxs-sw wxs-cu"></span>Usual <span class="wxs-sw wxs-cy"></span>' + m.year +
      (m.rain && m.rain.to ? ", Jan 1 to " + mdIso(m.rain.to) : "") + "</p>";
  }

  var api = { fipsFor: fipsFor, model: model, html: html, chart: chart, norm: norm };
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
  function wire() {
    var b = document.getElementById("wxs-chart-b"), p = document.getElementById("wxs-chart");
    if (b && p) b.addEventListener("click", function () { var on = p.hidden; p.hidden = !on; b.setAttribute("aria-expanded", on ? "true" : "false"); });
  }
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
        paint(html(m));
        var p2 = document.getElementById("wxs-chart");
        if (p2) p2.innerHTML = chart(m);
        wire();
      });
    }).catch(function () { if (mine === seq) paint('<p class="wxs-msg">The season totals did not load.</p>'); });
  }
  load();
  setInterval(function () { if (document.visibilityState !== "hidden") load(); }, 2500);
})();
