/* The share kit on /cot, part 2 (kit v2, Sig Nov 6: "pick your market before making the picture"; the growth seat's
   tags and the share fallback). Kept out of cot-chart.js so that file stays under its size budget.

   - Share this chart: the phone's share sheet with the market's link, else copy it.
   - Save picture and Print sheet first ask which market (#cc-pick: Corn, Soybeans, Wheat, Cattle, Hogs, the rest under
     "More markets"); the picture and the sheet then lead with that market's numbers. In compare mode the picture is
     the compare chart, no question asked. Print sheet also offers the pin-up wall edition (cot-print.js wall()).
   - THE SHARE FALLBACK: the picture is built as soon as the market is picked (AgCotChart.image, a PNG file ready), so
     on a phone the share call runs inside the "Send picture" tap itself. If the share sheet refuses (iOS drops the tap
     after a delay: NotAllowedError, or any error but the reader's own cancel), the picture downloads instead and a
     visible note says so. A desktop downloads at once.
   - ONE LINK CONVENTION (AgCotKit.link): ?m=<market>&w=<report date>&utm_source=share&utm_medium=picture|link
     &utm_campaign=cot-<report date>#<market>. Arriving with a hash that names a market brings the chart into view.
   - ARRIVALS: a visit tagged utm_source share, print or email (this kit's links, the sheet's QR code, the email) is
     remembered for the visit and the one Funds this week box records it as its source ("cot-weekly:cot|print-qr");
     a QR arrival sends GA4 qr_visit once.
   - GA4: share_open {asset, market} at each tap, share_done only when the share sheet resolves, picture_download,
     and sheet_print (cot-print.js, at the print itself).
   The share sheet, the download fallback, the copy, the arrival and the GA names come from the share kit core
   (components/share-kit.js, AgShareKit). Nothing here draws in the page's flow: the picker is a <dialog>, so nothing moves. Exports window.AgCotShare. */
(function (root) {
  'use strict';
  var doc = root.document;
  var K = root.AgCotKit, G = root.AgCotGlance, C = root.AgCotChart, SK = root.AgShareKit;
  function $(id) { return doc.getElementById(id); }
  /* without the share kit core (blocked or not loaded) the chart works as ever; the three buttons say they are
     unavailable instead of doing nothing */
  if (doc && !SK) ['cc-share', 'cc-save', 'cc-print'].forEach(function (id) {
    var b = $(id); if (!b) return;
    b.disabled = true; b.setAttribute('aria-disabled', 'true'); b.title = 'Not available right now. Reload the page to try again.';
  });
  if (!doc || !K || !G || !C || !SK) return;
  var ga = SK.ga, EV = SK.EV, KEY = 'agsist_cot_from';

  /* ---- arrivals: where the reader came from, for the signup's source ---- */
  (function arrive() {
    var from = SK.arrival(root, KEY);
    var box = $('cot-signup');
    if (from && box) box.setAttribute('data-source', 'cot-weekly:cot|' + from);
    /* /cot?m=soybeans#soybeans: the hash names the market, so bring the chart into view */
    var h = String(root.location.hash || '').slice(1);
    if (h && G.keyOf(h) && $('cot-chart-box')) try { $('cot-chart-box').scrollIntoView(); } catch (e) {}
  })();

  function week() { var d = C.data(), r = d && d.cot && G.iso(d.cot.report_date); return r || ''; }
  var coarse = function () { return SK.coarse(root); };
  /* the 4:5 phone picture on a phone (a touch screen or a narrow window), the wide one on a desktop */
  var phone = function () { return coarse() || (root.innerWidth || 1200) < 700; };
  function note(s) { var n = $('cc-note'); if (n) { n.textContent = s; clearTimeout(note.t); note.t = setTimeout(function () { n.textContent = ''; }, 6000); } }

  /* ---- Share this chart: the link ---- */
  function copy(url) {
    SK.copy(root, url, function () { note('Link copied'); }, function () { note(SK.execCopy(doc, url) ? 'Link copied' : 'Copy this link: ' + url); });
  }
  var shareBtn = $('cc-share');
  if (shareBtn) shareBtn.addEventListener('click', function () {
    var keys = C.selected(), cmp = C.compare(), d = C.data(), url = K.link(keys, week(), 'share', 'link');
    var b = !cmp && d && d.cot ? G.brief(keys[0], d.cot, d.cx) : null;
    var title = (cmp ? 'Funds in ' + keys.map(function (k) { return G.NAMES[k]; }).join(', ') : 'Funds in ' + G.NAMES[keys[0]] + ', 52 weeks') + ' | AGSIST';
    var how = root.navigator.share && coarse() ? 'sheet' : 'copy';
    ga(EV.open, { asset: 'link', market: C.slugs(), method: how });
    if (how === 'sheet') {
      SK.share(root, { title: title, text: b ? b.text : title, url: url }, function () { ga(EV.done, { asset: 'link', market: C.slugs() }); });
      return;
    }
    copy(url);
  });

  /* ---- the picker ---- */
  var dlg = $('cc-pick'), mode = 'picture', ready = null;
  function open(m, cmp) {
    mode = m; ready = null;
    if (!dlg) return;
    $('cc-pick-mk').hidden = !!cmp;
    $('cc-pick-h').textContent = m === 'sheet' ? 'Print a sheet for which market?' : cmp ? 'Your picture' : 'Make a picture of which market?';
    $('cc-pick-p').textContent = m === 'sheet' ? 'The sheet leads with that market and its chart, then all six on one page.' : 'The picture leads with that market’s numbers.';
    $('cc-pick-wall').hidden = m !== 'sheet';
    $('cc-pv').hidden = true; $('cc-pv-send').hidden = true; $('cc-pv-note').textContent = '';
    var cur = C.current();
    Array.prototype.forEach.call(dlg.querySelectorAll('.cc-pk[data-k]'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-k') === cur)); });
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  }
  function shut() { if (!dlg) return; if (dlg.close) dlg.close(); else dlg.removeAttribute('open'); }
  if (dlg) {
    dlg.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('button') : null;
      if (!b) { if (e.target === dlg) shut(); return; }
      if (b.id === 'cc-pv-send') return send();
      if (b.id === 'cc-pick-x') return shut();
      var k = b.getAttribute('data-k');
      if (b.hasAttribute('data-wall')) return sheet(null, true);
      if (!k) return;
      Array.prototype.forEach.call(dlg.querySelectorAll('.cc-pk[data-k]'), function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      if (mode === 'sheet') sheet(k, false); else picture([k], false);
    });
  }

  /* ---- Print sheet ---- */
  var printBtn = $('cc-print');
  if (printBtn) printBtn.addEventListener('click', function () { ga(EV.open, { asset: 'sheet', market: C.slugs() }); open('sheet'); });
  function sheet(k, wall) {
    shut();
    if (!root.AgCotPrint || !root.AgCotPrint.print || !root.AgCotPrint.print(k, wall)) note('Still loading, try again in a moment');
  }

  /* ---- Save picture ---- */
  var saveBtn = $('cc-save');
  if (saveBtn) saveBtn.addEventListener('click', function () {
    ga(EV.open, { asset: 'picture', market: C.slugs() });
    open('picture', C.compare());
    if (C.compare()) picture(C.selected(), true);
  });
  function download(r) {
    SK.download(doc, r.blob, r.name);
    ga(EV.download, { market: r.slug });
  }
  /* build the picture for keys (one market, or the compare set) the moment it is picked: -> ready {blob, file, ...} */
  function picture(keys, cmp) {
    var d = C.data();
    var m = d && d.hist ? (cmp ? C.cmpModel(keys, d.hist, d.cot, d.cx) : C.model(keys[0], d.hist, d.cot, d.cx)) : null;
    if (!m) { note('The chart has not loaded, so there is no picture to save yet.'); shut(); return; }
    var pv = $('cc-pv-note');
    if (pv) pv.textContent = 'Making the picture…';
    var fonts = doc.fonts && doc.fonts.ready ? doc.fonts.ready : Promise.resolve();
    fonts.then(function () {
      var im = C.image(m, doc, { phone: phone() });
      C.lastImage = { w: im.canvas.width, h: im.canvas.height, texts: im.texts, sizes: im.sizes, ys: im.ys, market: keys.join(',') };
      var slug = keys.map(function (k) { return G.SLUG[k]; }).join('-');
      var name = 'agsist-cot-' + slug + '-' + m.last.date + '.png';
      im.canvas.toBlob(function (blob) {
        if (!blob) { note('Could not draw the picture here.'); shut(); return; }
        var file = SK.file(blob, name);
        var url = K.link(keys, m.last.date, 'share', 'picture');
        ready = { blob: blob, file: file, name: name, slug: slug, url: url, title: m.cmp ? m.headline : 'Funds in ' + G.NAMES[keys[0]],
          text: (m.headline ? m.headline + ' ' : '') + url };
        var canShare = SK.canShareFile(root, file);
        var shown = dlg && dlg.open;
        if (shown) {
          var img = $('cc-pv-img'), old = img.getAttribute('data-u');
          if (old) URL.revokeObjectURL(old);
          var u = URL.createObjectURL(blob); img.src = u; img.setAttribute('data-u', u);
          img.alt = 'The picture: ' + (m.cmp ? m.headline : (m.headline || m.name));
          $('cc-pv').hidden = false;
        }
        if (canShare && shown) {
          $('cc-pv-send').hidden = false; $('cc-pv-send').focus();
          if (pv) pv.textContent = 'Ready. Tap Send picture.';
          return;
        }
        download(ready);
        if (pv) pv.textContent = 'Picture saved.';
        note('Picture saved');
      }, 'image/png');
    });
  }
  /* inside the tap: the file is already made, so the share sheet opens on this gesture */
  function send() {
    var r = ready;
    if (!r) return;
    var pv = $('cc-pv-note');
    SK.share(root, { files: [r.file], title: r.title, text: r.text }, function () {
      ga(EV.done, { asset: 'picture', market: r.slug });
      if (pv) pv.textContent = 'Sent.';
    }, function () {                                          /* any refusal but the reader closing the sheet */
      download(r);
      var msg = 'Your phone did not open sharing, so the picture was saved to your downloads instead.';
      if (pv) pv.textContent = msg;
      note(msg);
    });
  }

  root.AgCotShare = { open: open, picture: picture, send: send, ready: function () { return ready; } };
})(typeof window !== 'undefined' ? window : this);
