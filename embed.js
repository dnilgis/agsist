/*! AGSIST embed loader — agsist.com/embed.js
 * Usage: <div data-agsist-widget="gdu"></div><script async src="https://agsist.com/embed.js"></script>
 * Widgets: gdu, arc-plc, rain (live). The rain box names its county:
 *   <div data-agsist-widget="rain" data-st="ia" data-c="19169"></div> (state letters, county FIPS; the code is on
 *   each county rain page under "Put this on your site or in your newsletter"). (calendar/briefing keys removed 2026-08-11 —
 * they advertised embed pages that do not exist; a third-party mounting
 * one got a broken iframe. They return when their pages ship.)
 * The iframe gives partners the live tool; the injected <a> is the real backlink
 * (iframe contents do not pass link equity to the host page — the anchor does).
 */
(function(){
  'use strict';
  var ORIGIN = 'https://agsist.com';
  var WIDGETS = {
    gdu:      { path:'/embed/gdu',      link:'/gdu-calculator', label:'GDU Calculator', minH:560 },
    'arc-plc':{ path:'/embed/arc-plc',  link:'/arc-plc',        label:'ARC or PLC calculator', minH:900 },
    rain:     { path:'/embed/rain',     link:'/rain',           label:'county rain box', minH:80, args:{ st:/^[a-z]{2}$/i, c:/^\d{5}$/ } }

  };
  function each(list, fn){ Array.prototype.forEach.call(list, fn); }

  function mount(node){
    if(node.getAttribute('data-agsist-mounted')) return;
    var key = node.getAttribute('data-agsist-widget');
    var cfg = WIDGETS[key];
    if(!cfg){ return; }
    node.setAttribute('data-agsist-mounted','1');

    var iframe = document.createElement('iframe');
    // a widget that names a place passes only its own, checked arguments (rain: st, c); anything else is dropped
    var extra = '';
    for (var k in (cfg.args || {})) {
      var v = node.getAttribute('data-' + k) || '';
      if (cfg.args[k].test(v)) extra += '&' + k + '=' + encodeURIComponent(v.toLowerCase());
    }
    iframe.src = ORIGIN + cfg.path + '?utm_source=embed&utm_medium=script' + extra;
    iframe.title = 'AGSIST ' + cfg.label;
    iframe.loading = 'lazy';
    iframe.setAttribute('scrolling','no');
    iframe.style.cssText = 'width:100%;max-width:480px;border:0;display:block;margin:0 auto;min-height:' + cfg.minH + 'px;';
    iframe.setAttribute('data-agsist-key', key);
    node.appendChild(iframe);

    // Real, crawlable backlink in the HOST page DOM (this is the SEO value).
    var a = document.createElement('a');
    a.href = ORIGIN + cfg.link + '?utm_source=embed';
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = 'From AGSIST';
    a.style.cssText = 'display:block;max-width:480px;margin:4px auto 0;text-align:right;'
      + 'font:600 11px system-ui,-apple-system,sans-serif;color:#4aab4c;text-decoration:none;';
    node.appendChild(a);
  }

  function init(){
    each(document.querySelectorAll('[data-agsist-widget]'), mount);
  }

  // Auto-resize: each widget posts {agsist:<key>, height:<px>} from agsist.com only.
  window.addEventListener('message', function(e){
    if(e.origin !== ORIGIN) return;            // hard origin check
    var d = e.data;
    if(!d || !d.agsist || !d.height) return;
    each(document.querySelectorAll('iframe[data-agsist-key]'), function(f){
      try{ if(f.contentWindow === e.source){ f.style.height = (d.height + 2) + 'px'; } }catch(err){}
    });
  });

  if(document.readyState !== 'loading'){ init(); }
  else { document.addEventListener('DOMContentLoaded', init); }
})();
