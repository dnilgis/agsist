/* THE SPONSOR AD — ONE MARKUP, EVERY PAGE.
 *
 *   AgsistAd.render(sponsor, surface, {slot: "daily-briefing"}) -> html string
 *
 * sponsor  the object in data/daily.json -> sponsor (built from
 *          data/sponsor.json by scripts/generate_daily.py), or the portal's
 *          copy of the same fields.
 * surface  which placement this is: homepage | daily_page | archive. It picks
 *          the tagged link out of sponsor.cta_urls, so a click on the homepage
 *          and a click on /daily arrive in the sponsor's own analytics as two
 *          different mediums.
 * click    (homepage only) links report clicks under this slot name, the ad
 *          itself carries no slot because its wrapper already does.
 * slot     the measurement slot name. Present -> the ad carries
 *          data-sponsor-slot and its links data-sponsor-click, and
 *          components/sponsor-metrics.js counts it (MRC viewable: half the
 *          pixels, one continuous second). Absent -> nothing is counted, which
 *          is what the house ad and the sponsor's own proof copy need.
 *
 * scripts/generate_daily.py render_sponsor_block_html() writes the same markup
 * in Python for the archive pages. scripts/sponsor-checks.mjs renders one
 * sponsor through both and fails if a single byte differs, so the page Rich
 * approves on his portal is the page that runs, on every surface.
 *
 * The look lives in components/sponsor-ad.css and nowhere else.
 */
(function (root) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* "40+ carriers" -> <b>40+</b> carriers. The number is the part a reader's
     eye catches; the rest is the label. A fact with no leading number is left
     as plain text. */
  function fact(f) {
    var m = /^([0-9][0-9,.+%]*)\s+([\s\S]+)$/.exec(String(f == null ? '' : f));
    return m ? '<b>' + esc(m[1]) + '</b> ' + esc(m[2]) : esc(f);
  }

  /* 715-568-5050 -> tel:+17155685050. Anything that is not a 10-digit US
     number gets no link rather than a wrong one. */
  function tel(p) {
    var d = String(p == null ? '' : p).replace(/\D/g, '');
    if (d.length === 11 && d.charAt(0) === '1') d = d.slice(1);
    return d.length === 10 ? 'tel:+1' + d : '';
  }

  function render(sp, surface, opts) {
    if (!sp) return '';
    opts = opts || {};
    var house = !!sp.is_house_ad;
    var slot = (!house && opts.slot) ? String(opts.slot) : '';
    /* click-only: the homepage measures its OUTER wrapper (#dsp-filled), so
       the ad inside must not carry a second slot -- that would count every
       view twice. Its links still report clicks under the wrapper's name. */
    var clickOnly = (!house && !slot && opts.click) ? String(opts.click) : '';
    var adv = sp.advertiser || '';
    var urls = sp.cta_urls || {};
    var url = urls[surface] || sp.cta_url || '#';
    var ext = /^https?:/i.test(url);
    var clickAttr = (slot || clickOnly) ? ' data-sponsor-click="' + esc(slot || clickOnly) + '"' : '';
    var h = '';

    h += '<aside class="sa-ad' + (house ? ' sa-ad--house' : '') + '" aria-label="' +
         esc(house ? 'Sponsor this slot' : 'Sponsored: ' + adv) + '"' +
         (slot ? ' data-sponsor-slot="' + esc(slot) + '"' : '') + '>';

    h += '<div class="sa-top"><span class="sa-label">' + esc(sp.label || 'SPONSORED') + '</span>' +
         ((adv && !house) ? '<span class="sa-by">' + esc(adv) + '</span>' : '') + '</div>';

    h += '<div class="sa-main">';
    if (sp.logo && !house) {
      h += '<div class="sa-logo"><img src="' + esc(sp.logo) + '" alt="' + esc(adv + ' logo') +
           '" loading="lazy" decoding="async" onerror="this.parentNode.className+=\' sa-logo--text\'">' +
           '<span class="sa-wordmark">' + esc(adv) + '</span></div>';
    }
    h += '<div class="sa-copy"><div class="sa-headline">' + esc(sp.headline) + '</div>' +
         '<p class="sa-body">' + esc(sp.body) + '</p></div>';
    h += '</div>';

    var facts = (!house && sp.facts && sp.facts.length) ? sp.facts : [];
    if (facts.length) {
      h += '<ul class="sa-facts">';
      for (var i = 0; i < facts.length; i++) h += '<li>' + fact(facts[i]) + '</li>';
      h += '</ul>';
    }

    h += '<div class="sa-actions"><a class="sa-cta" href="' + esc(url) + '" rel="sponsored noopener"' +
         (ext ? ' target="_blank"' : '') + clickAttr + '>' + esc(sp.cta_text || 'Learn more') +
         ' <span class="sa-cta-arrow" aria-hidden="true">&rarr;</span></a>';
    var t = house ? '' : tel(sp.phone);
    if (t) {
      h += '<a class="sa-phone" href="' + t + '" rel="sponsored"' + clickAttr +
           '><span class="sa-phone-k">or call</span> ' + esc(sp.phone) + '</a>';
    }
    h += '</div>';

    if (sp.disclosure) h += '<p class="sa-disc">' + esc(sp.disclosure) + '</p>';
    h += '</aside>';
    return h;
  }

  var api = { render: render, esc: esc };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.AgsistAd = api;
})(typeof window !== 'undefined' ? window : this);
