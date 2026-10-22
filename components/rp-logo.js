/* components/rp-logo.js: a farm or business logo on a Rain Print (2026-10-14).
 *
 * The buyer picks a PNG, JPG, WebP or SVG (10 MB at most). Everything happens
 * in the browser, with no outside service:
 *   - the file's first bytes say what it is (the name and type are not trusted);
 *   - it is drawn into a canvas: an SVG only through an <img> from a blob URL,
 *     where it runs no script and loads nothing, and never into the page; its
 *     markup is never stored, sent or shown, only its pixels;
 *   - transparent or white margins are trimmed, the longest side is capped at
 *     1600 px, transparency is kept, and it goes out as a PNG (2 MB at most);
 *   - the PNG is stored by the subs worker (v5.23): POST /rp-logo answers an
 *     id, GET /rp-logo/<id> gives it back. The design carries the id.
 *   - when the worker can't be reached (2026-10-22), the PNG is kept in this
 *     browser and goes up later under the same id (KEPT IN THIS BROWSER below).
 * "Ink color" (the default) prints the logo in the print's own dark ink: one
 * color, its shape from its alpha and how dark each pixel is, so a JPG's white
 * background drops out. It is made here from the stored PNG each time
 * (inkPixels), so the same id prints the same way everywhere.
 *
 * Pure parts (kindOf, trimBox, inkPixels, ppi) take plain {data, width,
 * height} pixels and run in node for test/rp-logo.test.mjs.
 */
(function (root) {
  'use strict';
  var BASE = 'https://agsist-api.dnilgis.workers.dev';
  var MAX_FILE = 10 * 1024 * 1024, MAX_SIDE = 1600, MAX_PNG = 2 * 1024 * 1024, WORK_SIDE = 3200;
  var ID_RE = /^[0-9a-hjkmnp-tv-z]{12}$/;
  var NAMES = { png: 'PNG', jpeg: 'JPG', webp: 'WebP', svg: 'SVG' };

  function err(msg) { var e = new Error(msg); e.plain = true; return e; }
  function cleanId(v) {
    var id = String(v == null ? '' : v).trim().toLowerCase().replace(/[il]/g, '1').replace(/o/g, '0');
    return ID_RE.test(id) ? id : '';
  }

  /* What a file is, from its first bytes: 'png', 'jpeg', 'webp', 'svg' or ''.
     An SVG is text whose first tag (after an XML line, a doctype or comments)
     is <svg. GIF, HEIC, PDF and the rest are ''. */
  function kindOf(head) {
    var b = head instanceof Uint8Array ? head : new Uint8Array(head || []);
    var at = function (sig, from) { for (var i = 0; i < sig.length; i++) if (b[(from || 0) + i] !== sig[i]) return false; return true; };
    if (at([137, 80, 78, 71, 13, 10, 26, 10])) return 'png';
    if (at([0xff, 0xd8, 0xff])) return 'jpeg';
    if (at([82, 73, 70, 70]) && at([87, 69, 66, 80], 8)) return 'webp';
    var t = '';
    for (var k = 0; k < Math.min(b.length, 4096); k++) t += String.fromCharCode(b[k]);
    t = t.replace(/^﻿|^\xEF\xBB\xBF/, '');
    t = t.replace(/^\s*(<\?xml[\s\S]*?\?>\s*)?/, '');
    for (var guard = 0; guard < 20; guard++) {
      var m = /^(<!--[\s\S]*?-->|<!DOCTYPE[^>[]*(\[[\s\S]*?\])?\s*>)\s*/i.exec(t);
      if (!m) break;
      t = t.slice(m[0].length);
    }
    return /^<svg[\s>]/i.test(t) ? 'svg' : '';
  }

  // ---------- pixels (plain {data, width, height}, RGBA) ----------
  function lum(d, i) { return (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255; }
  /* The margin color: transparent when most of the edge is, else the median
     edge color. Only a transparent or near-white margin is trimmed. */
  function edgeOf(px) {
    var d = px.data, W = px.width, H = px.height, clear = 0, n = 0, rs = [], gs = [], bs = [];
    var take = function (x, y) {
      var i = (y * W + x) * 4; n++;
      if (d[i + 3] < 16) { clear++; return; }
      rs.push(d[i]); gs.push(d[i + 1]); bs.push(d[i + 2]);
    };
    var step = Math.max(1, Math.floor(Math.max(W, H) / 400));
    for (var x = 0; x < W; x += step) { take(x, 0); take(x, H - 1); }
    for (var y = 0; y < H; y += step) { take(0, y); take(W - 1, y); }
    if (clear * 2 >= n) return { clear: true };
    var med = function (a) { a.sort(function (p, q) { return p - q; }); return a[a.length >> 1]; };
    return { clear: false, r: med(rs), g: med(gs), b: med(bs) };
  }
  /* The box around everything that is not margin: {x, y, w, h}, or null when
     the picture is blank. A colored margin (a logo on a full-bleed color) is
     part of the logo and stays. */
  function trimBox(px) {
    var d = px.data, W = px.width, H = px.height, e = edgeOf(px);
    var white = !e.clear && e.r >= 235 && e.g >= 235 && e.b >= 235;
    if (!e.clear && !white) return { x: 0, y: 0, w: W, h: H };
    var x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
      var i = (y * W + x) * 4, a = d[i + 3];
      if (a < 16) continue;
      if (white && d[i] >= 232 && d[i + 1] >= 232 && d[i + 2] >= 232) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x1 < 0) return null;
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
  function hexRgb(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
    var v = m ? parseInt(m[1], 16) : 0x1e2125;
    return [v >> 16 & 255, v >> 8 & 255, v & 255];
  }
  /* The one-color version: every pixel in the ink, its alpha how much ink it
     carries. A picture with a transparent background keeps its shape from its
     alpha (near-white bits inside it drop out); an opaque one (a JPG) reads
     its darkness against its lightest tone, so a white background becomes
     transparent and anything from a mid color down prints solid. -> Uint8ClampedArray. */
  function inkPixels(px, inkHex) {
    var d = px.data, n = px.width * px.height, out = new Uint8ClampedArray(n * 4), ink = hexRgb(inkHex);
    var clearN = 0, hist = new Array(256).fill(0), solid = 0;
    for (var i = 0; i < n; i++) {
      var a = d[i * 4 + 3];
      if (a < 128) clearN++;
      else { hist[Math.round(lum(d, i * 4) * 255)]++; solid++; }
    }
    var cut = function (q) { var want = solid * q, s = 0; for (var k = 0; k < 256; k++) { s += hist[k]; if (s >= want) return k / 255; } return 1; };
    var hasClear = clearN > n * 0.02;
    var hi = cut(0.98), lo = cut(0.02);
    var span = Math.max(0.12, hi - lo - 0.08);
    for (var j = 0; j < n; j++) {
      var p = j * 4, al = d[p + 3] / 255, L = lum(d, p), c;
      if (hasClear) c = al * (L <= 0.88 ? 1 : L >= 0.97 ? 0 : (0.97 - L) / 0.09);
      // a colored part (a red barn, a green field) prints as solid ink, not gray; paper-light stays paper
      else c = al * Math.min(1, Math.max(0, 1.6 * (hi - 0.04 - L) / span));
      out[p] = ink[0]; out[p + 1] = ink[1]; out[p + 2] = ink[2]; out[p + 3] = Math.round(255 * c);
    }
    return out;
  }
  // pixels per inch the logo prints at: its pixel size over the printed box (art units, 100 to the inch)
  function ppi(pxW, pxH, boxW, boxH) {
    if (!(pxW > 0 && pxH > 0 && boxW > 0 && boxH > 0)) return 0;
    return Math.min(pxW / (boxW / 100), pxH / (boxH / 100));
  }

  // ---------- the browser ----------
  var doc = root.document;
  function canvas(w, h) { var c = doc.createElement('canvas'); c.width = w; c.height = h; return c; }
  function blobUrl(blob) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(String(r.result)); };
      r.onerror = function () { rej(err('This browser couldn’t read the file.')); };
      r.readAsDataURL(blob);
    });
  }
  function loadImg(src) {
    return new Promise(function (res, rej) {
      var img = new Image();
      img.onload = function () { res(img); };
      img.onerror = function () { rej(err('That picture didn’t open. Try saving it as a PNG or JPG.')); };
      img.src = src;
    });
  }
  function toPng(c) {
    return new Promise(function (res, rej) { c.toBlob(function (b) { b ? res(b) : rej(err('This browser couldn’t make the picture.')); }, 'image/png'); });
  }
  /* file -> Promise<{blob (PNG), url (data URL of it), w, h, kind}>. Rejects
     with a plain-words Error. */
  function process(file) {
    if (!file || !(file.size > 0)) return Promise.reject(err('That file is empty.'));
    if (file.size > MAX_FILE) return Promise.reject(err('That file is over 10 MB. Try a smaller copy of the logo.'));
    var kind = '';
    return file.slice(0, 4096).arrayBuffer().then(function (head) {
      kind = kindOf(new Uint8Array(head));
      if (!kind) throw err('That file isn’t a PNG, JPG, WebP or SVG. Save the logo as one of those and try again.');
      // an SVG opens only as an image: no script runs and nothing outside it loads
      var u = URL.createObjectURL(kind === 'svg' ? new Blob([file], { type: 'image/svg+xml' }) : file);
      return loadImg(u).then(function (img) { URL.revokeObjectURL(u); return img; }, function (e) { URL.revokeObjectURL(u); throw e; });
    }).then(function (img) {
      var w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
      // an SVG sized only in percent has no size of its own: draw it square, the trim finds its edges
      if (kind === 'svg' && !(w0 > 0 && h0 > 0)) { w0 = 1000; h0 = 1000; }
      if (!(w0 > 0 && h0 > 0)) throw err('That picture has no size. Try saving it as a PNG.');
      // a vector draws at full working size; a photo is never made bigger than it is
      var s = kind === 'svg' ? WORK_SIDE / Math.max(w0, h0) : Math.min(1, WORK_SIDE / Math.max(w0, h0));
      var W = Math.max(1, Math.round(w0 * s)), H = Math.max(1, Math.round(h0 * s));
      var c = canvas(W, H), cx = c.getContext('2d');
      cx.drawImage(img, 0, 0, W, H);
      var px = cx.getImageData(0, 0, W, H), bx = trimBox(px);
      if (!bx) throw err('That picture looks blank. Try another copy of the logo.');
      var side = MAX_SIDE, out;
      var make = function () {
        var k = Math.min(1, side / Math.max(bx.w, bx.h));
        var w = Math.max(1, Math.round(bx.w * k)), h = Math.max(1, Math.round(bx.h * k));
        var o = canvas(w, h), ox = o.getContext('2d');
        ox.imageSmoothingQuality = 'high';
        ox.drawImage(c, bx.x, bx.y, bx.w, bx.h, 0, 0, w, h);
        out = { w: w, h: h };
        return toPng(o).then(function (b) {
          if (b.size > MAX_PNG && side > 400) { side = Math.round(side * 0.8); return make(); }
          if (b.size > MAX_PNG) throw err('That logo is too detailed to save. Try a simpler copy.');
          return b;
        });
      };
      return make().then(function (b) { out.blob = b; out.kind = kind; return blobUrl(b); }).then(function (url) { out.url = url; return out; });
    });
  }
  // a data URL of the one-color version, the same size
  var INK = {};
  function inkUrl(url, inkHex) {
    var k = inkHex + '|' + url.length + '|' + url.slice(-64);
    if (INK[k]) return INK[k];
    INK[k] = loadImg(url).then(function (img) {
      var w = img.naturalWidth, h = img.naturalHeight, c = canvas(w, h), cx = c.getContext('2d');
      cx.drawImage(img, 0, 0);
      var px = cx.getImageData(0, 0, w, h), id = cx.createImageData(w, h);
      id.data.set(inkPixels(px, inkHex));
      cx.putImageData(id, 0, 0);
      return c.toDataURL('image/png');
    });
    INK[k].catch(function () { delete INK[k]; });
    return INK[k];
  }
  /* A hung upload gives up after UPLOAD_MS (2026-10-14, panel 3 F1): a logo
     left "saving" for good would keep ordering shut for good. 60 s: a 2 MB
     PNG on a slow farm uplink takes about half that. */
  var UPLOAD_MS = 60000;
  var NOT_SAVED = 'The logo couldn\u2019t be saved just now, so it\u2019s not on the print. Try again in a minute, or email it to me with your order.';
  /* offline: the worker couldn't be reached or answered as if it were out (no
     answer, a network error, a 403, 5xx or anything but its own JSON; Oct 21
     2026: Cloudflare's block page). Then the page keeps the logo here
     (keepLocal) instead of dropping it. A refusal the worker means (too big,
     too many) is not offline. */
  function offline(msg) { var e = err(msg || NOT_SAVED); e.offline = true; return e; }
  function upload(blob, asId) {
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var t = setTimeout(function () { if (ctl) ctl.abort(); }, root.AgRpLogo && root.AgRpLogo.UPLOAD_MS || UPLOAD_MS);
    var opts = { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: blob, credentials: 'omit' };
    if (ctl) opts.signal = ctl.signal;
    // asId: a logo kept in this browser goes up under the id its design already carries (the worker checks it is this PNG's own)
    return fetch(BASE + '/rp-logo' + (asId ? '?id=' + asId : ''), opts).then(function (r) {
      clearTimeout(t);
      return r.json().catch(function () { return null; }).then(function (j) {
        var id = cleanId(j && j.id);
        if (r.ok && j && j.ok && id) return id;
        if (!j || r.status === 403 || r.status >= 500) throw offline();
        // the worker's cap for everyone that day is not about this reader (F3)
        throw err(r.status === 429 && j && j.error === 'busy today' ? 'Lots of people are using this today. Try again tomorrow, or email the logo to me with your order.'
          : r.status === 429 ? 'Too many logos from here today. Try again later, or email the logo with your order.'
          : r.status === 413 ? 'That logo is too big to save. Try a simpler copy.'
          : NOT_SAVED);
      });
    }, function () {
      clearTimeout(t);
      throw offline();
    });
  }

  /* KEPT IN THIS BROWSER (2026-10-22, BUILD-RULES 14). When the upload can't
     reach the worker, the PNG is kept in IndexedDB under its own id: 12
     letters from SHA-256 of the PNG's bytes, the same letters the worker
     uses, so the worker makes the same id from the same bytes (POST
     /rp-logo?id=, subs worker v5.47) and nothing in the design changes when
     it goes up. The id goes on a waiting list (localStorage WAIT_KEY), and
     flushWaiting() sends each one on the next visit to the page, until the
     worker has it. load() reads a kept one from here when the worker can't. */
  var B32 = '0123456789abcdefghjkmnpqrstvwxyz', WAIT_KEY = 'agsist-rp-logo-wait', DB = 'agsist-rp', STORE = 'logos';
  function contentId(blob) {
    if (!(root.crypto && root.crypto.subtle)) return Promise.reject(err(NOT_SAVED));
    return blob.arrayBuffer().then(function (buf) { return root.crypto.subtle.digest('SHA-256', buf); }).then(function (h) {
      var b = new Uint8Array(h), s = '';
      for (var i = 0; i < 12; i++) s += B32[b[i] & 31];
      return s;
    });
  }
  function db() {
    return new Promise(function (res, rej) {
      try {
        var q = root.indexedDB.open(DB, 1);
        q.onupgradeneeded = function () { q.result.createObjectStore(STORE); };
        q.onsuccess = function () { res(q.result); };
        q.onerror = function () { rej(q.error || err(NOT_SAVED)); };
      } catch (e) { rej(e); }
    });
  }
  function dbDo(mode, fn) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var tx = d.transaction(STORE, mode), q = fn(tx.objectStore(STORE));
        tx.oncomplete = function () { d.close(); res(q && q.result); };
        tx.onerror = tx.onabort = function () { d.close(); rej(tx.error || err(NOT_SAVED)); };
      });
    });
  }
  function waiting() {
    var a = null;
    try { a = JSON.parse(root.localStorage.getItem(WAIT_KEY) || '[]'); } catch (e) { a = []; }
    return (Array.isArray(a) ? a : []).filter(function (id) { return ID_RE.test(id); });
  }
  function setWaiting(a) { try { if (a.length) root.localStorage.setItem(WAIT_KEY, JSON.stringify(a)); else root.localStorage.removeItem(WAIT_KEY); } catch (e) {} }
  // blob (the PNG process() made) -> Promise of its id, kept here and waiting to go up
  function keepLocal(blob) {
    return contentId(blob).then(function (id) {
      return dbDo('readwrite', function (st) { return st.put(blob, id); }).then(function () {
        var a = waiting();
        if (a.indexOf(id) < 0) setWaiting(a.concat([id]).slice(-10));
        return id;
      });
    });
  }
  function localBlob(id) { return dbDo('readonly', function (st) { return st.get(id); }).then(function (b) { if (!b) throw err('The logo in this design isn’t on file any more.'); return b; }); }
  function isWaiting(id) { return waiting().indexOf(cleanId(id)) >= 0; }
  var FLUSHING = null;
  // -> Promise of how many are still waiting
  function flushWaiting() {
    if (FLUSHING) return FLUSHING;
    var a = waiting();
    FLUSHING = a.reduce(function (p, id) {
      return p.then(function () {
        return localBlob(id).then(function (b) { return upload(b, id); }).then(function (got) {
          if (got === id) setWaiting(waiting().filter(function (x) { return x !== id; }));
        }, function () {});
      });
    }, Promise.resolve()).then(function () { FLUSHING = null; return waiting().length; });
    return FLUSHING;
  }
  /* id -> Promise<{url (data URL), w, h}>: the stored PNG, read as a data URL
     so a canvas drawing the print is never tainted. */
  var LOADS = {};
  function load(id) {
    id = cleanId(id);
    if (!id) return Promise.reject(err('That logo id isn’t right.'));
    if (LOADS[id]) return LOADS[id];
    // the worker's copy, or the one kept in this browser while the worker was out (keepLocal)
    var local = false, kept = function (e) { return localBlob(id).then(function (b) { local = true; return b; }, function () { throw e; }); };
    LOADS[id] = fetch(BASE + '/rp-logo/' + id, { credentials: 'omit' }).then(function (r) {
      if (!r.ok) throw err(r.status === 404 ? 'The logo in this design isn’t on file any more.' : 'The logo didn’t load.');
      return r.blob();
    }, function () { throw err('The logo didn’t load.'); }).then(null, kept).then(function (b) {
      return b.slice(0, 8).arrayBuffer().then(function (h) {
        if (kindOf(new Uint8Array(h)) !== 'png') throw err('The logo didn’t load.');
        return blobUrl(new Blob([b], { type: 'image/png' }));
      });
    }).then(function (url) {
      return loadImg(url).then(function (img) { return { url: url, w: img.naturalWidth, h: img.naturalHeight, local: local }; });
    });
    LOADS[id].catch(function () { delete LOADS[id]; });
    return LOADS[id];
  }
  function remember(id, got) { id = cleanId(id); if (id && got) LOADS[id] = Promise.resolve(got); }

  root.AgRpLogo = {
    kindOf: kindOf, trimBox: trimBox, inkPixels: inkPixels, ppi: ppi, cleanId: cleanId, ID_RE: ID_RE,
    MAX_FILE: MAX_FILE, MAX_SIDE: MAX_SIDE, MAX_PNG: MAX_PNG, NAMES: NAMES, BASE: BASE,
    process: process, inkUrl: inkUrl, upload: upload, load: load, remember: remember, UPLOAD_MS: UPLOAD_MS,
    keepLocal: keepLocal, flushWaiting: flushWaiting, isWaiting: isWaiting, contentId: contentId, WAIT_KEY: WAIT_KEY,
    ACCEPT: 'image/png,image/jpeg,image/webp,image/svg+xml,.png,.jpg,.jpeg,.webp,.svg'
  };
})(typeof window !== 'undefined' ? window : this);
