/* /newsletter-block: pick a state and county, copy the monthly block.
 * The lines come ready-made from data/newsletter/<st>.json
 * (scripts/build_newsletter_block.py); this file only lays them out as plain
 * text, simple HTML with inline styles (Word, Mailchimp, Constant Contact) and
 * a 1200 x 630 image. It never rewords or recomputes a number. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var stSel = $("nlb-st"), cSel = $("nlb-c"), out = $("nlb-out"), msg = $("nlb-msg");
  var bTxt = $("nlb-txt"), bRich = $("nlb-rich"), bCode = $("nlb-code"), aPng = $("nlb-png"), img = $("nlb-img");
  if (!stSel || !cSel || !out) return;
  var idx = null, sfile = null, cur = null, pngUrl = null;

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function say(t) { if (msg) msg.textContent = t; }
  function getJSON(url) {
    return fetch(url, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    });
  }

  /* the block, in order: rain, year, gauge, basis, the Daily, the source */
  function lines(s, b) {
    return { head: b.head, ytd: b.ytd, stn: b.stn, basis: s.basis.slice(), daily: "Get this every morning: " + s.daily, src: b.src, url: b.url, utm: s.utm || "" };
  }
  function plain(L) {
    return [L.head, L.ytd, L.stn].concat(L.basis, [L.daily, L.src]).join("\n");
  }
  var P = 'style="margin:0 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.45;color:#222222;"';
  var S = 'style="margin:0 0 10px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.4;color:#555555;"';
  var A = 'style="color:#2a6b1f;text-decoration:underline;"';
  /* links in the HTML carry the paste tag (data file's utm); the words never do */
  function tag(u, L) { return L.utm ? u + (u.indexOf("?") < 0 ? "?" : "&") + L.utm : u; }
  function html(L) {
    var path = L.url.replace(/^https:\/\//, "");
    var src = esc(L.src).replace(esc(path), '<a href="' + esc(tag(L.url, L)) + '" ' + A + ">" + esc(path) + "</a>");
    return '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;border-collapse:collapse;">' +
      '<tr><td style="border-top:3px solid #c9a227;padding:10px 0 4px 0;">' +
      '<p style="margin:0 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:17px;line-height:1.35;font-weight:bold;color:#222222;">' + esc(L.head) + "</p>" +
      "<p " + P + ">" + esc(L.ytd) + "</p>" +
      "<p " + S + ">" + esc(L.stn) + "</p>" +
      L.basis.map(function (x) { return "<p " + P + ">" + esc(x) + "</p>"; }).join("") +
      '<p style="margin:10px 0 4px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.45;color:#222222;">Get this every morning: <a href="' + esc(tag("https://agsist.com/daily", L)) + '" ' + A + ">agsist.com/daily</a></p>" +
      '<p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.4;color:#555555;">' + src + "</p>" +
      "</td></tr></table>";
  }

  /* the image: 1200 x 630, the same lines, shrunk until they fit */
  function wrap(ctx, text, maxW) {
    var words = String(text).split(" "), rows = [], row = "";
    words.forEach(function (w) {
      var t = row ? row + " " + w : w;
      if (ctx.measureText(t).width > maxW && row) { rows.push(row); row = w; } else { row = t; }
    });
    if (row) rows.push(row);
    return rows;
  }
  function draw(L) {
    var W = 1200, H = 630, X = 64, MW = W - 2 * X;
    var c = document.createElement("canvas");
    c.width = W; c.height = H;
    var ctx = c.getContext("2d");
    if (!ctx) return null;
    var font = '"Inter", Arial, Helvetica, sans-serif';
    var parts = [
      { t: L.head, s: 44, w: "700", col: "#1d1d1b", gap: 14 },
      { t: L.ytd, s: 32, w: "400", col: "#1d1d1b", gap: 10 },
      { t: L.stn, s: 22, w: "400", col: "#5b5a55", gap: 22 }
    ].concat(L.basis.map(function (x) { return { t: x, s: 26, w: "400", col: "#1d1d1b", gap: 8 }; }));
    var layout, k = 1;
    for (var tries = 0; tries < 12; tries++) {
      var y = 0, rows = [];
      parts.forEach(function (p) {
        var size = Math.round(p.s * k);
        ctx.font = p.w + " " + size + "px " + font;
        wrap(ctx, p.t, MW).forEach(function (r) { rows.push({ r: r, size: size, p: p }); y += size * 1.25; });
        y += p.gap * k;
      });
      layout = rows;
      if (y <= H - 120 - 96) break;
      k *= 0.92;
    }
    ctx.fillStyle = "#faf7f0"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#c9a227"; ctx.fillRect(0, 0, W, 10);
    ctx.fillStyle = "#2a6b1f"; ctx.font = "800 26px " + font; ctx.textBaseline = "alphabetic";
    ctx.fillText("AGSIST", X, 62);
    var yy = 120, last = null;
    layout.forEach(function (o) {
      if (last && last !== o.p) yy += last.gap * k;
      ctx.font = o.p.w + " " + o.size + "px " + font; ctx.fillStyle = o.p.col;
      yy += o.size; ctx.fillText(o.r, X, yy); yy += o.size * 0.25;
      last = o.p;
    });
    ctx.fillStyle = "#e3dccb"; ctx.fillRect(X, H - 104, MW, 2);
    ctx.fillStyle = "#1d1d1b"; ctx.font = "700 26px " + font;
    ctx.fillText(L.daily, X, H - 62);
    ctx.fillStyle = "#5b5a55"; ctx.font = "400 19px " + font;
    ctx.fillText(L.src, X, H - 30, MW);
    return c;
  }

  function enable(on) {
    [bTxt, bRich, bCode].forEach(function (b) { if (b) b.disabled = !on; });
    if (aPng) aPng.setAttribute("aria-disabled", on ? "false" : "true");
  }
  function show(fips) {
    var b = sfile && sfile.counties[fips];
    if (!b) { cur = null; enable(false); return; }
    cur = lines(sfile, b);
    out.innerHTML = html(cur);
    enable(true);
    say("");
    try { history.replaceState(null, "", location.pathname + "?c=" + fips); } catch (e) { /* a link without the county still works */ }
    var draw1 = function () {
      var c = draw(cur);
      if (!c || !img) return;
      var slug = cur.url.split("/").pop();
      c.toBlob(function (blob) {
        if (!blob) return;
        if (pngUrl) URL.revokeObjectURL(pngUrl);
        pngUrl = URL.createObjectURL(blob);
        img.src = pngUrl; img.hidden = false;
        var w = $("nlb-imgwait"); if (w) w.hidden = true;
        if (aPng) { aPng.href = pngUrl; aPng.setAttribute("download", "agsist-" + sfile.state.toLowerCase() + "-" + slug + "-" + sfile.year + "-" + String(sfile.month).padStart(2, "0") + ".png"); }
      }, "image/png");
    };
    if (document.fonts && document.fonts.load) document.fonts.load('700 44px "Inter"').then(draw1, draw1); else draw1();
  }

  function copyText(t) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t);
    return new Promise(function (ok, no) {
      var ta = document.createElement("textarea");
      ta.value = t; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      var done = false;
      try { done = document.execCommand("copy"); } catch (e) { done = false; }
      document.body.removeChild(ta);
      if (done) { ok(); } else { no(new Error("copy")); }
    });
  }
  function copyRich(h, t) {
    if (navigator.clipboard && navigator.clipboard.write && window.ClipboardItem) {
      return navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([h], { type: "text/html" }), "text/plain": new Blob([t], { type: "text/plain" }) })]);
    }
    return new Promise(function (ok, no) {
      var r = document.createRange(); r.selectNodeContents(out);
      var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
      var done = false;
      try { done = document.execCommand("copy"); } catch (e) { done = false; }
      sel.removeAllRanges();
      if (done) { ok(); } else { no(new Error("copy")); }
    });
  }
  function wire(btn, fn, okWord) {
    if (!btn) return;
    btn.addEventListener("click", function () {
      if (!cur) return;
      fn().then(function () { say(okWord); }, function () { say("Copy did not work in this browser. Select the block above and copy it by hand."); });
    });
  }
  wire(bTxt, function () { return copyText(plain(cur)); }, "Copied as plain text.");
  wire(bRich, function () { return copyRich(html(cur), plain(cur)); }, "Copied. Paste it into Word or your email editor.");
  wire(bCode, function () { return copyText(html(cur)); }, "HTML code copied. Paste it into a code or HTML block.");
  if (aPng) aPng.addEventListener("click", function (e) { if (!cur || aPng.getAttribute("aria-disabled") === "true") e.preventDefault(); else say("Image saved."); });

  function loadState(st, fips) {
    cSel.disabled = true;
    cSel.innerHTML = '<option value="">Pick a county</option>';
    sfile = null; cur = null; enable(false);
    out.innerHTML = '<p class="s">Pick a county to see its block.</p>';
    if (img) img.hidden = true;
    var w0 = $("nlb-imgwait"); if (w0) w0.hidden = false;
    if (!st) return;
    say("Loading " + (idx.states[st] ? idx.states[st].name : st) + ".");
    getJSON("/data/newsletter/" + st.toLowerCase() + ".json").then(function (s) {
      sfile = s;
      Object.keys(s.counties).sort(function (a, b) { return s.counties[a].name.localeCompare(s.counties[b].name); }).forEach(function (f) {
        var o = document.createElement("option");
        o.value = f; o.textContent = s.counties[f].name;
        cSel.appendChild(o);
      });
      cSel.disabled = false;
      say("");
      if (fips && s.counties[fips]) { cSel.value = fips; show(fips); }
    }, function () {
      say("The " + (idx.states[st] ? idx.states[st].name : st) + " numbers did not load. Try again in a minute; the county rain pages have the same rain numbers.");
    });
  }

  getJSON("/data/newsletter/index.json").then(function (d) {
    idx = d;
    Object.keys(d.states).forEach(function (st) {
      var o = document.createElement("option");
      o.value = st; o.textContent = d.states[st].name;
      stSel.appendChild(o);
    });
    var want = (new URLSearchParams(location.search).get("c") || "").replace(/\D/g, "");
    if (/^\d{5}$/.test(want)) {
      var st = Object.keys(d.states).filter(function (k) { return d.states[k].fp === want.slice(0, 2); })[0];
      if (st) { stSel.value = st; loadState(st, want); }
    }
  }, function () {
    say("The newsletter numbers did not load. Try again in a minute; each county rain page has the same rain numbers.");
  });
  stSel.addEventListener("change", function () { loadState(stSel.value); });
  cSel.addEventListener("change", function () { if (cSel.value) show(cSel.value); });
})();
