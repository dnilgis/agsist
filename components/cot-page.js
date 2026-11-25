/* /cot page: cards, The Read, the chart and the countdown. Moved out of
   cot.html 2026-10-15 so the page carries its words, not its code. */
(function(){
'use strict';

var CFG = [
  {key:'corn',        label:'Corn',             short:'Corn',   emoji:'', color:'#d4a23f', group:'grains'},
  {key:'beans',       label:'Soybeans',         short:'Beans',  emoji:'', color:'#4aab4c', group:'grains'},
  {key:'wheat',       label:'Wheat (SRW)',      short:'SRW',    emoji:'', color:'#5ba3e0', group:'grains'},
  {key:'kcwheat',     label:'KC Wheat (HRW)',   short:'KC',     emoji:'', color:'#2fb5a5', group:'grains'},
  {key:'mplswheat',   label:'Mpls Wheat (HRS)', short:'Mpls',   emoji:'', color:'#9b7cc4', group:'grains'},
  {key:'soymeal',     label:'Soybean Meal',     short:'Meal',   emoji:'', color:'#7ab87c', group:'crush'},
  {key:'soyoil',      label:'Soybean Oil',      short:'Oil',    emoji:'', color:'#d8c24a', group:'crush'},
  {key:'livecattle',  label:'Live Cattle',      short:'Cattle', emoji:'', color:'#d9534f', group:'livestock'},
  {key:'feedercattle',label:'Feeder Cattle',    short:'Feeder', emoji:'', color:'#e07b5a', group:'livestock'},
  {key:'leanhogs',    label:'Lean Hogs',        short:'Hogs',   emoji:'', color:'#e89ab0', group:'livestock'},
  {key:'milk',        label:'Class III Milk',   short:'Milk',   emoji:'', color:'#8fb8e0', group:'dairy'}
];
var GROUP_ORDER = [['grains','Grain Board'],['crush','Crush Complex'],['livestock','Livestock'],['dairy','Dairy']];
var GROUPS = {}, COLORS = {}, LABELS = {}, SHORT = {}, EMOJI = {};
CFG.forEach(function(c){ COLORS[c.key]=c.color; LABELS[c.key]=c.label; SHORT[c.key]=c.short; EMOJI[c.key]=c.emoji; (GROUPS[c.group]=GROUPS[c.group]||[]).push(c.key); });
var ALL_KEYS = CFG.map(function(c){ return c.key; });

function cotCardHTML(c){
  return '<div class="cot-card" id="card-'+c.key+'" data-key="'+c.key+'" role="button" tabindex="0" aria-label="'+c.label+' summary card. Activate to focus in chart.">'
    +'<div class="cot-card-head"><span class="cot-card-name">'+c.label+'</span><span class="cot-card-verdict flat" id="verdict-'+c.key+'">-</span></div>'
    +'<div class="cot-pctl" id="pctl-'+c.key+'"></div>'
    +'<div class="cot-card-net flat" id="net-'+c.key+'">--</div>'
    +'<div class="cot-card-unit">contracts, net</div>'
    +'<div class="cot-card-chg nc" id="chg-'+c.key+'">Loading\u2026</div>'
    +'<div class="cot-card-bar-wrap"><div class="cot-card-fill" id="fill-'+c.key+'"></div><div class="cot-card-zero" id="zero-'+c.key+'"></div><div class="cot-card-dot" id="dot-'+c.key+'" style="background:var(--text-muted)"></div></div>'
    +'<div class="cot-card-range-labels"><span id="min-'+c.key+'">--</span><span>52-wk range</span><span id="max-'+c.key+'">--</span></div>'
    +'<div class="cot-insight" id="insight-'+c.key+'"></div>'
    +'</div>';
}
function buildCards(){
  var grid=document.getElementById('cot-summary-grid'); if(!grid) return;
  var html='';
  GROUP_ORDER.forEach(function(g){
    var members=CFG.filter(function(c){ return c.group===g[0]; });
    if(!members.length) return;
    html+='<h3 class="cot-group-head">'+g[1]+'</h3>';
    members.forEach(function(c){ html+=cotCardHTML(c); });
  });
  grid.innerHTML=html;
  Array.prototype.forEach.call(grid.querySelectorAll('.cot-card'),function(card){
    /* THE CARD PROMISES SOMETHING IT HAS TO KEEP. Every card is role="button"
       with an accessible name ending "Activate to focus in chart", and this
       selected the chart's tab and stopped there -- with the chart roughly
       4,700px further down the page. Pressing Enter on a card appeared to do
       nothing at all: no movement, no focus change, nothing in view. Bring the
       chart to the reader, and put keyboard focus on it so a screen reader
       lands somewhere that reflects what just happened. */
    function focus(){
      var key = card.getAttribute('data-key');
      if (window.AgCotChart && window.AgCotChart.select) window.AgCotChart.select(key, true);
      var target = document.getElementById('cot-chart-box');
      if (!target) return;
      try {
        target.scrollIntoView({
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
          block: 'center'
        });
      } catch (_) { target.scrollIntoView(); }
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      try { target.focus({ preventScroll: true }); } catch (_) { target.focus(); }
    }
    card.addEventListener('click',focus);
    card.addEventListener('keydown',function(e){ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); focus(); } });
  });
}
buildCards();

function fmtK(n) {
  if (n == null || isNaN(n)) return '--';
  var abs = Math.abs(n), sign = n >= 0 ? '+' : '\u2212';
  return sign + (abs >= 1000 ? (abs/1000).toFixed(1)+'k' : abs);
}
/* MAGNITUDE ONLY, NO SIGN. fmtK() always prefixes + or -, so fmtK(Math.abs(x))
   ALWAYS emits a plus -- which is how the week-over-week cell came to render a
   fall of 18,946 contracts as "\u25bc +18.9k wk/wk". The arrow already carries
   the direction; the number beside it must not contradict it. */
function fmtMag(n) {
  if (n == null || isNaN(n)) return '--';
  var abs = Math.abs(n);
  return abs >= 1000 ? (abs / 1000).toFixed(1) + 'k' : String(abs);
}
function fmtKShort(n) {
  if (n == null || isNaN(n)) return '--';
  var abs = Math.abs(n);
  return (n < 0 ? '\u2212' : '') + (abs >= 1000 ? Math.round(abs/1000)+'k' : Math.round(abs));
}


// ---- Card statistics and The Read: computed in scripts/cot_analysis.py ----
/* MOVED TO THE PIPELINE 2026-10-06. Until then these were computed here, from
   the 52-week history file, on a different convention from every other
   percentile on the page (strictly below, against the prior 51 weeks, under a
   "52wk" label, so a window low printed as "0th percentile"), with a "crowded"
   flag at 85/15 on raw contracts that ignored the sign -- Feeder Cattle, net
   LONG, was "crowded short" -- and The Read called a 270-contract net dip
   "liquidation" when longs had risen 1,321. cot_analysis.py now writes
   commodities[k].card (trailing 52 weekly reports, current week included,
   percentile = share of weeks at or below) and the chosen Read. This file
   renders them. They arrive with data/cot-analysis.json, which the second
   script's vintage guard has already matched to the cards' report and nets;
   when it has not, nothing here is shown. */
var CX_A = null;              // the analysis file, once the guard has passed it
var COT_SUMMARY = null;       // the cot.json payload on screen
/* THE ONE PRINTED PERCENTILE (2026-10-20, panel F3). cot_analysis.shown_pct()
   writes it as crowd.shown; this is the same rule for a file without it.
   Whole number, 1 to 99, and rounding never carries a not-crowded 89.8 up to
   the 90th (the crowded line) or a not-crowded 10.2 down to the 10th. The card
   printed "90th" beside The Read's "89th" for soybeans' 89.8. */
function shownPct(p, crowded, hi, lo){
  if(p==null||isNaN(p)) return null;
  hi=hi==null?90:hi; lo=lo==null?10:lo;
  var n=Math.min(99,Math.max(1,Math.round(p)));
  if(!crowded&&n>=hi&&p<hi) n=Math.floor(hi)-1;
  if(!crowded&&n<=lo&&p>lo) n=Math.floor(lo)+1;
  return n;
}
function fmtMagK(n){var a=Math.abs(n);return a>=1000?(a/1000).toFixed(0)+'k':String(a);}
function divLabel(d){return d==='bearish'?'net rose while price fell':d==='bullish'?'net fell while price rose':d==='confirmed-up'?'net and price both rose':d==='confirmed-down'?'net and price both fell':'';}
/* The analysis is used only while it is on the report the cards show. A poll
   that brings a new cot.json before the new analysis would otherwise put last
   week's sentences under this week's numbers. */
function cxAligned(){
  if (!CX_A || !CX_A.report_date || !COT_LOADED) return false;
  var a = Date.parse(COT_LOADED + ' 12:00:00 GMT'), b = Date.parse(CX_A.report_date + 'T12:00:00Z');
  return isFinite(a) && isFinite(b) && Math.abs(a - b) <= 86400000;
}
function cxCommodity(key){ return (cxAligned() && CX_A.commodities && CX_A.commodities[key]) || null; }
/* Long, short or flat, as cot_analysis.side_of() decided it: flat is a net
   under a fixed share of the market's own open interest, not a fixed number of
   contracts (5,000 was 0.27% of corn and 13.9% of Class III milk). fetch_cot.py
   writes the same field into cot.json from the same function. Without either,
   only the sign is known and nothing is called flat. */
function cotSide(key, d){
  var c = cxCommodity(key);
  if (c && c.side) return c.side;
  if (d && d.side) return d.side;
  if (!d || typeof d.net !== 'number') return null;
  return d.net > 0 ? 'long' : d.net < 0 ? 'short' : 'flat';
}
window.cotSetAnalysis = function(cx){
  CX_A = cx || null;
  if (COT_SUMMARY) {
    ALL_KEYS.forEach(function(k){ if (COT_SUMMARY[k]) renderCard(k, COT_SUMMARY[k]); });
    renderVerdict(COT_SUMMARY);
  }
  cotRenderDerived();
  if (window.AgCotChart && window.AgCotChart.update) window.AgCotChart.update({ cx: CX_A });
};

/* Blank a card the report did not carry, and say so on its face. */
function cotMarkCard(key, present) {
  var net  = document.getElementById('net-' + key);
  var chg  = document.getElementById('chg-' + key);
  var vd   = document.getElementById('verdict-' + key);
  var pill = document.getElementById('pctl-' + key);
  var ins  = document.getElementById('insight-' + key);
  var card = document.getElementById('card-' + key);
  if (card) card.classList.toggle('cot-card-absent', !present);
  if (present) return;
  if (net) { net.textContent = '-'; net.className = 'cot-card-net'; }
  if (chg) { chg.textContent = 'not in this report'; chg.className = 'cot-card-chg nc'; }
  if (vd)  { vd.textContent = '-'; vd.className = 'cot-card-verdict'; }
  if (pill) pill.textContent = '';
  if (ins)  ins.innerHTML = '';
  if (card) card.setAttribute('aria-label',
    (LABELS[key] || key) + ': no data in this report.');
}

/* FUNDS THIS WEEK (2026-11-04, made plainer 2026-11-05): the crowded verdict on one line when it
   fits (else the report's dates), the chart's own brief line per market
   (components/cot-chart.js), and every market as a table row behind one tap
   (components/cot-glance.js row: market | long or short | rank | change). The
   rank and the weight word come with cot-analysis.json for the same report;
   until then the cells carry neither rather than guess. */
function renderGlance() {
  var G = window.AgCotGlance, tb = document.getElementById('cg-rows');
  if (!G || !COT_SUMMARY) return;
  var cx = cxAligned() ? CX_A : null;
  var v = document.getElementById('cg-verdict');
  if (v) {
    var vt = G.verdict(COT_SUMMARY, cx), alt = G.asOfShort(COT_SUMMARY, cx);
    v.textContent = vt || alt;
    if (vt && v.scrollWidth > v.clientWidth + 1) v.textContent = alt;   /* one line only */
  }
  if (!tb) return;
  var rs = G.rows(COT_SUMMARY, cx);
  tb.innerHTML = rs.map(function (r) {
    return '<tr data-k="' + r.key + '"><td><button type="button" class="cg-pick" data-k="' + r.key + '">' + r.name + '</button></td><td>' + r.pos + '</td><td>' + (r.rank || '') + '</td><td>' + r.chg + '</td></tr>';
  }).join('');
  var since = rs.map(function (r) { return r.since; }).filter(Boolean);
  var key = document.getElementById('cg-key');
  if (key && since.length && since.every(function (x) { return x === since[0]; }))
    key.textContent = 'Rank: the net as a share of open interest, against every week since ' + since[0] + '. \u201cAbove 48%\u201d means higher than 48% of those weeks; for a short, \u201cbelow 67%\u201d means a bigger net short than 67% of them. Change: contracts bought (+) or sold this week.';
}
/* a market in the table picks it on the chart */
(function () {
  var tb = document.getElementById('cg-rows');
  if (!tb) return;
  tb.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('[data-k]') : null;
    if (!b || !window.AgCotChart || !window.AgCotChart.select) return;
    window.AgCotChart.select(b.getAttribute('data-k'), true);
    var box = document.getElementById('cot-chart-box');
    if (box) try { box.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) { box.scrollIntoView(); }
  });
})();
function cotRenderDerived() {
  var read = document.getElementById('cot-read');
  renderGlance();
  if (!cxAligned()) {
    /* No analysis that matches the cards: say nothing rather than last week's
       sentences under this week's numbers. */
    ALL_KEYS.forEach(function (k) {
      var el = document.getElementById('insight-' + k);
      if (el) el.innerHTML = '';
      var pl = document.getElementById('pctl-' + k);
      if (pl) { pl.textContent = ''; pl.className = 'cot-pctl'; }
    });
    if (read) read.style.display = 'none';
    return;
  }
  ALL_KEYS.forEach(renderInsight);
  renderTheRead();
}

function renderInsight(key){
  var c = cxCommodity(key), k = c && c.card;
  var pill=document.getElementById('pctl-'+key);
  var el=document.getElementById('insight-'+key);
  if(!k){ if(pill) pill.textContent=''; if(el) el.innerHTML=''; return null; }
  /* ONE MEASURE ON THE CARD (2026-10-10). This pill used to rank RAW NET
     CONTRACTS over the trailing year beside a share-of-open-interest
     percentile over the whole record: two rankings under one card. It now
     shows the page's one measure (cot_analysis.py `crowd`: net as a share of
     open interest, every week since 2010), hued only when crowded; the
     52-week figure in contracts moves under "show the math". */
  var cr=c.crowd,cp=cr?cr.pctl:(c.pctl&&c.pctl.net_oi_all);
  if(pill){
    var th=(CX_A&&CX_A.thresholds)||{};
    var sp=(cr&&typeof cr.shown==='number')?cr.shown:shownPct(cp,c.crowded,th.crowded_hi,th.crowded_lo);
    /* in words, never an ordinal (2026-11-06): "higher than 48% of weeks since 2010" */
    var yr=String(c.first_week||'').slice(0,4);
    var words=(cr&&cr.words)||(sp==null?'':(c.net<0?'a bigger net short than '+(100-sp)+'% of weeks since '+yr:'higher than '+sp+'% of weeks since '+yr));
    pill.textContent=cp==null?'':words+', as a share of open interest'+(c.crowded?', crowded '+c.crowded:'');
    pill.className='cot-pctl'+(c.crowded==='long'?' hot':c.crowded==='short'?' cold':'');
  }
  if(!el) return k;
  /* Direction of the NET, said as such. "Funds cut 8k" under a net short that
     had just grown by 8k read as the opposite of what happened. */
  var dirWord=k.chg<0?'<span class="dn">fell</span>':k.chg>0?'<span class="up">rose</span>':'was unchanged';
  var sharp='';
  /* A move smaller than this market's typical week (the median absolute weekly
     change over the same window) gets no adjective. */
  if(k.significant_move){
    if(k.largest_in_window) sharp=', the largest weekly '+(k.chg<0?'fall':'rise')+' in net in the last '+k.weeks+' weeks';
    else if(k.weeks_since_larger>=4) sharp=', sharpest '+(k.chg<0?'fall':'rise')+' in net in '+k.weeks_since_larger+' weeks';
  }
  var f=(k.flips&&k.flips[0])||null, flipTxt='';
  if(f&&f.weeks_ago<=6){ flipTxt=' Funds flipped <b class="'+(f.to==='long'?'up':'dn')+'">net '+f.to+'</b> '+(f.weeks_ago===0?'this week':f.weeks_ago+' week'+(f.weeks_ago>1?'s':'')+' ago')+'.'; }
  /* longs and shorts (Nov 7): the analysis card's own line (AgCotGlance.how), never figured here */
  var hw=window.AgCotGlance&&window.AgCotGlance.how?window.AgCotGlance.how(key,COT_SUMMARY,CX_A):'';
  var html='Net '+dirWord+(k.chg?' <b>'+fmtMagK(k.chg)+'</b> contract'+(Math.abs(k.chg)===1?'':'s'):'')+' this week'+sharp
    +'.'+(hw?' '+esc(hw):'')+flipTxt;
  if(k.divergence){
    var dvCls=(k.divergence==='bearish'||k.divergence==='confirmed-down')?'dn':'up';
    /* Said once: "net and price both fell (price −5.0%)", not the rising/falling
       sentence and then the label repeating it. */
    html+=' Over 4 weeks, <b class="'+dvCls+'">'+divLabel(k.divergence)+'</b> (price change, contract rolls removed, '+(k.price4>=0?'+':'−')+Math.abs(k.price4).toFixed(1)+'%).';
  }
  /* The withdrawn analog hit rate (2026-08-21) stays withdrawn: it selected
     weeks with a percentile computed over the whole array, after the fact, and
     counted overlapping weeks of one episode as separate cases. The card's
     52-week contract rank fold is gone too (2026-11-06): the pill's
     share-of-open-interest rank is the one ranking on the card. */
  el.innerHTML=html;
  return k;
}
/* CORN AND SOYBEANS FIRST, EVERY WEEK (2026-10-15). The Read used to be one
   market, the most newsworthy, which on the Oct 6 report was Lean Hogs. It now
   opens with one plain line each for corn and soybeans (grain_lines, written
   by cot_analysis.build_grain_lines) and puts the newsworthy pick second. */
function renderTheRead(){
  var box=document.getElementById('cot-read'), body=document.getElementById('cot-read-body');
  if(!box||!body) return;
  var a=cxAligned()&&CX_A, r=a&&a.read, lines=(a&&a.grain_lines)||[];
  var html=lines.filter(function(g){ return g&&g.text; }).map(function(g){
    return '<p class="cot-read-line"><b>'+esc(g.label)+'</b>: '+esc(g.text)+'</p>';
  });
  if(r&&r.text) html.push('<p class="cot-read-line'+(html.length?' cot-read-also':'')+'">'
    +(html.length?'<span class="cot-read-also-tag">Also this week</span> ':'')
    +'<b>'+esc(r.label)+'</b>: '+esc(r.text)+'</p>');
  if(!html.length){ box.style.display='none'; return; }
  body.innerHTML=html.join('');
  box.style.display='block';
}
function renderCard(key, d) {
  var net = d.net, prev = d.prev, min52 = d.min52, max52 = d.max52;
  var range = (max52 - min52) || 1;
  var isLong = net >= 0;
  var cls = cotSide(key, d) || 'flat';

  /* Declared HERE, not thirty lines down inside the chg cell's own if-block.
     `var` hoists, so the accessible name below read it as undefined, isFinite()
     was false, and the ", up 18.9k this week" clause silently never rendered --
     the weekly move reached sighted readers and nobody else. */
  var chg = (prev != null && isFinite(net) && isFinite(prev)) ? (net - prev) : NaN;

  var netEl = document.getElementById('net-' + key);
  if (netEl) { netEl.textContent = fmtK(net); netEl.className = 'cot-card-net ' + cls; }
  // v2: accessible name carries the data once it exists (was action-only)
  var cardEl = document.getElementById('card-' + key);
  if (cardEl) cardEl.setAttribute('aria-label', (LABELS[key]||key)+': net '+(net>=0?'long ':'short ')+fmtMag(net)+(isFinite(chg)?', '+(chg>=0?'up ':'down ')+fmtMag(chg)+' this week':'')+'. Activate to focus in chart.');

  var vEl = document.getElementById('verdict-' + key);
  if (vEl) {
    vEl.textContent = cls === 'long' ? 'Net Long' : cls === 'short' ? 'Net Short' : 'Flat';
    vEl.className = 'cot-card-verdict ' + cls;
    var band = (cxCommodity(key) && cxCommodity(key).flat_band) || d.flat_band;
    var fp = (cxAligned() && CX_A.thresholds && CX_A.thresholds.flat_oi_pct) || d.flat_oi_pct || (COT_SUMMARY && COT_SUMMARY.flat_oi_pct);
    if (band && fp) vEl.title = 'Flat means a net within ±' + Number(band).toLocaleString('en-US')
      + ' contracts (' + fp + '% of open interest)';
  }

  var chgEl = document.getElementById('chg-' + key);
  if (chgEl && isFinite(chg)) {
    chgEl.textContent = (chg >= 0 ? '▲' : '▼') + ' ' + fmtMag(chg) + ' this week';
    chgEl.className = 'cot-card-chg ' + (chg > 0 ? 'up' : chg < 0 ? 'dn' : 'nc');
  }

  var minEl = document.getElementById('min-' + key);
  var maxEl = document.getElementById('max-' + key);
  if (minEl) minEl.textContent = fmtKShort(min52);
  if (maxEl) maxEl.textContent = fmtKShort(max52);

  var zeroPct = Math.max(0, Math.min(100, (( 0   - min52) / range) * 100));
  var currPct = Math.max(0, Math.min(100, ((net  - min52) / range) * 100));
  var fillStart = Math.min(zeroPct, currPct);
  var fillWidth = Math.abs(currPct - zeroPct);
  var fillClr = isLong ? 'rgba(74,171,76,.35)' : 'rgba(239,68,68,.32)';
  var dotClr  = isLong ? 'var(--green)' : '#ef4444';

  var zeroEl = document.getElementById('zero-' + key);
  var fillEl = document.getElementById('fill-' + key);
  var dotEl  = document.getElementById('dot-'  + key);
  if (zeroEl) zeroEl.style.left = zeroPct.toFixed(1) + '%';
  if (fillEl) { fillEl.style.left = fillStart.toFixed(1)+'%'; fillEl.style.width = fillWidth.toFixed(1)+'%'; fillEl.style.background = fillClr; }
  if (dotEl)  { dotEl.style.left = currPct.toFixed(1)+'%'; dotEl.style.background = dotClr; }
}

function renderVerdict(summary) {
  var keys = ['corn', 'beans', 'wheat'];
  var scores = [], netLong = 0;
  keys.forEach(function(k) {
    if (!summary[k]) return;
    var d = summary[k];
    var range = (d.max52 - d.min52) || 1;
    scores.push((d.net - d.min52) / range);
    if (d.net > 0) netLong++;
  });
  var avg = scores.length ? scores.reduce(function(a,b){return a+b;},0)/scores.length : 0.5;

  var banner = document.getElementById('cot-verdict-banner');
  var badge  = document.getElementById('cvb-badge');
  var text   = document.getElementById('cvb-text');
  var date   = document.getElementById('cvb-date');

  var nLong = 0, nShort = 0, nFlat = 0, nTracked = 0;
  ALL_KEYS.forEach(function(k){
    if (!summary[k] || typeof summary[k].net !== 'number') return;
    /* Counted with the same cotSide() the cards use, so the headline and the
       card can never disagree about which markets are flat. */
    nTracked++; var sd = cotSide(k, summary[k]);
    if (sd === 'flat') nFlat++; else if (sd === 'long') nLong++; else nShort++;
  });
  var cls = 'mixed';
  var badgeTxt = nTracked ? (nLong + ' long / ' + nShort + ' short' + (nFlat ? ' / ' + nFlat + ' flat' : '')) : '-';
  var desc = nTracked
    ? ('Managed money is net long in ' + nLong + ' of the ' + nTracked + ' markets on this page and '
       + 'net short in ' + nShort + (nFlat ? ', with ' + nFlat + ' too close to zero to call' : '') + '. Which way they lean is a measure of who is exposed, not of '
       + 'where price is going. The section below tests that on the full record.')
    : 'Loading fund positioning data…';
  var fpct = (cxAligned() && CX_A.thresholds && CX_A.thresholds.flat_oi_pct) || summary.flat_oi_pct;
  if (nTracked && nFlat && fpct) desc += ' Flat means a net position under ' + fpct + '% of that market\u2019s open interest.';

  if (banner) banner.className = 'cot-verdict-banner ' + cls;
  if (badge)  { badge.textContent = badgeTxt; badge.className = 'cvb-badge ' + cls; }
  if (text)   text.textContent = desc;
  /* Benchmark review, Oct 29, 2026: the positions' Tuesday and the day CFTC released them, plainly at
     the top, so the count never reads as a live one. The release day is cot_analysis's own
     (cot_calendar.release_date), shown only when that file is for this same report. */
  if (date && summary.report_date) date.textContent = 'Positions held Tuesday, ' + summary.report_date + cotReleased() + ' · CFTC Disaggregated, futures only';
}
/* ' · released Fri Oct 23' from cot-analysis.json's release_date, or '' */
function cotReleased(){
  var r = cxAligned() && CX_A.release_date;
  var m = r && /^(\d{4})-(\d{2})-(\d{2})$/.exec(r);
  if (!m) return '';
  var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
  return ' · released ' + ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getUTCDay()] + ' ' +
    ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()] + ' ' + d.getUTCDate();
}

var historyData = null;


/* ── LOADING COT, AND LOADING IT AGAIN ────────────────────────────────────
   This was a one-shot fetch on page load. Combined with a countdown that ran
   on the clock alone, a reader who opened the page before the Friday release
   and waited -- which is exactly what the countdown invites them to do --
   watched it reach zero and then saw nothing happen, because nothing on the
   page ever asked for the file a second time. Analytics showed people sitting
   there. The page kept a promise it had no mechanism to keep.

   It now re-reads the file while a release is outstanding, and re-renders in
   place when the new report lands. See cotTick() below for the state. */
var COT_LOADED = null;            // the report_date now on screen

function cotApply(data, isPoll) {
  /* A KEY THE PAYLOAD DID NOT CARRY USED TO KEEP ITS OLD CARD. The loop was
     `if (data[k]) renderCard(...)` -- a missing commodity was skipped in
     silence, leaving the previous render in the DOM, while renderVerdict
     stamped the NEW report date across the top regardless. Measured with
     mplswheat dropped from an August 18 payload: the card still read +9.9k
     with "\u25b2 1.0k wk/wk" and a Net Long badge, under a banner saying
     "Positions as of August 18, 2026". Last week's number wearing this week's
     date, with nothing on screen to tell them apart.

     fetch_cot.py reaches this state on its own: it prints "WARNING: No rows
     for <key>" and drops the key, and its only exit guard passes if ANY one
     commodity survived. A renamed exchange -- the fetcher's own docstring
     names MGEX -> MIAX as the live risk to spring wheat -- lands here. */
  COT_SUMMARY = data;
  /* Decide the report on screen BEFORE painting, so cxAligned() compares the
     analysis with the report these cards are about to show, not the last one. */
  var fresh = data.report_date || null;
  var moved = isPoll && COT_LOADED && fresh && fresh !== COT_LOADED;
  COT_LOADED = fresh;
  ALL_KEYS.forEach(function(k) {
    if (data[k]) { renderCard(k, data[k]); cotMarkCard(k, true); }
    else         { cotMarkCard(k, false); }
  });
  renderVerdict(data);
  /* The live cards are on screen: they supersede the summary baked in for crawlers. cot.html hides
     .cg-baked under html.cot-live, so that summary shows with scripts off and until this point. */
  var _bk = document.getElementById('cot-baked');
  if (_bk) _bk.style.display = 'none';
  document.documentElement.classList.add('cot-live');
  try {
    document.documentElement.setAttribute('data-cot-report', fresh || '');
    /* The nets the cards are showing, so another block can check that a
       second data file agrees about the NUMBERS and not only the date. */
    var _n = {};
    ALL_KEYS.forEach(function(k){ if (data[k] && typeof data[k].net === 'number') _n[k] = data[k].net; });
    document.documentElement.setAttribute('data-cot-nets', JSON.stringify(_n));
  } catch (e) {}
  if (moved) {
    /* The chart and the written read are built from the history file, which
       has moved too. Re-read it rather than leaving last week's line under
       this week's numbers. */
    cotLoadHistory(true);
    /* The release bar says so: cotTick() below sees the report came out today and shows "Updated today with the
       report of Tuesday, ..." for the rest of the day (AgCotGlance.release), announced once as a state change. */
    /* Everything else on the page that reads a different file learns here,
       in the same tick, rather than on its own timer. */
    try { document.dispatchEvent(new CustomEvent('cot:new-report', { detail: fresh })); } catch (e) {}
  }
  /* The summary can move without the history file moving, so the agreement
     has to be re-tested from this side too, not only when history loads. */
  cotRenderDerived();
  if (window.AgCotChart && window.AgCotChart.update) window.AgCotChart.update({ cot: data });
  cotTick();
}

function cotLoad(isPoll) {
  return fetch('/data/cot.json' + (isPoll ? '?t=' + Date.now() : ''),
               isPoll ? { cache: 'no-store' } : undefined)
    .then(function(r) { if (!r.ok) throw new Error('no-cot'); return r.json(); })
    .then(function(data) { cotApply(data, isPoll); })
    .catch(function() {
      if (isPoll) return;               // a failed poll is not news; keep what is shown
      var banner = document.getElementById('cot-verdict-banner');
      var text   = document.getElementById('cvb-text');
      /* Worded as a schedule note, this was indistinguishable from "no new
         report yet" -- so a reader whose fetch had simply failed had no reason
         to reload, and sat in front of blank headline figures. */
      if (text) text.textContent = 'Couldn\u2019t load the latest COT data, retrying.';
      /* the report could not load: the summary baked into the page takes its place */
      var bk = document.getElementById('cot-baked');
      if (bk && !COT_SUMMARY) bk.style.display = 'block';
      if (banner) banner.className = 'cot-verdict-banner mixed';
    });
}
cotLoad(false);

/* 2026-09-25 audit: nothing retried a failed history fetch. cotLoad() has a 30-second retry; this did not, so
   one failed request at the release moment left last week's chart under the new-report banner (poll path) or
   "Could not load the chart data - retrying" with no retry (first load). Both paths now retry every 30 seconds
   until one succeeds. */
var COT_HIST_TIMER = null;
function cotHistStop(){ if (COT_HIST_TIMER) { clearInterval(COT_HIST_TIMER); COT_HIST_TIMER = null; } }
function cotHistStart(){ if (!COT_HIST_TIMER) COT_HIST_TIMER = setInterval(function(){ cotLoadHistory(true); }, 30000); }
function cotLoadHistory(isPoll) {
 return fetch('/data/cot-history.json' + (isPoll ? '?t=' + Date.now() : ''),
              isPoll ? { cache: 'no-store' } : undefined)
  .then(function(r) { if (!r.ok) throw new Error('no-hist'); return r.json(); })
  .then(function(data) {
    historyData = data;
    cotHistStop();
    if (window.AgCotChart && window.AgCotChart.update) window.AgCotChart.update({ hist: data });
    cotRenderDerived();
  })
  .catch(function() {
    cotHistStart();
    /* A FAILED REFRESH IS NOT A REASON TO DELETE THE CHART. cotLoad guards its
       poll path -- "a failed poll is not news" -- and this did not, so a
       history hiccup at the exact release moment wiped the 52-week chart the
       reader was looking at and replaced it with "Chart data refreshes after
       each Friday CFTC release", which is false: it had just refreshed. */
    if (isPoll) return;
    var msg = document.getElementById('cc-msg');
    if (msg) { msg.hidden = false; msg.textContent = 'Could not load the chart data, retrying.'; }
  });
}
cotLoadHistory(false);

/* ── THE COUNTDOWN TELLS THE TRUTH ABOUT THE DATA, NOT THE CLOCK ──────────
   A timer to Friday 21:30 UTC once reset to "6d 23h" at zero over a page still showing the old report. The
   due moment comes from cot.json next_release (cot_calendar.release_date, holiday-aware), and past it the bar
   says the report is due, keeps saying so, and polls; it counts down again only once the new report is on
   screen (AgCotGlance.release, cotTick below). */
/* A first load that failed gets its own slower retry, separate from the
   release-day poll: the page has nothing to show, so it keeps asking until it
   does, whatever day of the week it is. */
var COT_RETRY = null;
function cotStartRetry(){
  if (COT_RETRY) return;
  COT_RETRY = setInterval(function(){ cotLoad(true); }, 30000);
}
function cotStopRetry(){ if (COT_RETRY) { clearInterval(COT_RETRY); COT_RETRY = null; } }

var COT_POLL = null;
var COT_POLL_STEP = 0;
function cotStartPolling(){
  if (COT_POLL) return;
  /* TWO MINUTES WAS THE WRONG NUMBER FOR THE FIRST TWENTY.
     This only ever runs while a release is outstanding, and the people it
     runs for are sitting on the page at 3:30 watching a countdown. A flat
     120s meant that, on average, a reader saw the new report a minute after
     it was on the CDN -- on top of however long the pipeline took. The file
     is a few kB.

       first 20 min past the release  ->  every 15s
       next 40 min                    ->  every 45s
       after that                     ->  every 2 min

     A late release still self-heals; it just stops costing the reader a
     minute of staring at a number that has already been superseded. */
  COT_POLL_STEP = 0;
  var t0 = Date.now();
  var arm = function(ms){
    if (COT_POLL) clearInterval(COT_POLL);
    COT_POLL = setInterval(function(){
      cotLoad(true);
      var age = Date.now() - t0;
      var want = age < 1200000 ? 15000 : age < 3600000 ? 45000 : 120000;
      if (want !== COT_POLL_STEP) { COT_POLL_STEP = want; arm(want); }
    }, ms);
    COT_POLL_STEP = ms;
  };
  arm(15000);
}
function cotStopPolling(){ if (COT_POLL) { clearInterval(COT_POLL); COT_POLL = null; } }

/* THE RELEASE BAR (2026-11-06).
   One countdown on the page, at the very top (#cot-rel; the old one in the closed fold is gone). Its words come
   from AgCotGlance.release(): "New report in 2 h 14 m · today 3:30 PM ET", then "New report out at 3:30 PM ET,
   updating" while the page polls, "The report due ... is late" after three hours, and "Updated today with the
   report of Tuesday, Nov 3" for the rest of the release day. The text is rewritten each minute only when it
   changes and is NOT a live region; #cot-rel-live announces the state changes only (countdown to due, due to
   updated, and so on), never the minutes. */
var COT_REL_STATE = '';
/* THE BAR TURNS OVER AT 3:30, NOT UP TO A MINUTE AFTER (Nov 7). It used to refresh every 60 s counted from whenever
   the script started, so a reader watching the countdown saw "under 1 m" for up to a minute past the release before
   "out at 3:30 PM ET, updating", and the minutes changed at a different second on every load. Each refresh now sets
   the next one for the moment the words change: the next whole minute counted from the release time, and the
   release instant itself. The late mark (three hours on) and midnight ET fall on those minutes too. */
var COT_TICK = null;
function cotTickNext(due){
  if (COT_TICK) clearTimeout(COT_TICK);
  var d = due ? due - Date.now() : NaN, wait = 60000;
  if (d >= 60000) wait = d % 60000 + 1;         /* the countdown shows whole minutes left, rounded down */
  else if (d > 0) wait = d;                     /* the last minute: wake at the release itself */
  else if (d <= 0) wait = 60000 - (-d % 60000); /* past it: on the minute, counted from the release */
  COT_TICK = setTimeout(cotTick, wait);
}
/* a tab put away and brought back can have had its timers held back by the browser: catch up at once */
document.addEventListener('visibilitychange', function(){ if (!document.hidden) cotTick(); });
function cotTick(){
  var G = window.AgCotGlance, bar = document.getElementById('cot-rel'), el = document.getElementById('cot-rel-t');
  cotTickNext(COT_SUMMARY && G && G.etInstant && /^\d{4}-\d{2}-\d{2}$/.test(COT_SUMMARY.next_release || '')
    ? G.etInstant(COT_SUMMARY.next_release, COT_SUMMARY.next_release_time_et || '15:30') : 0);
  if (!COT_LOADED || !COT_SUMMARY) {
    /* NO REPORT ON SCREEN IS NOT THE SAME AS NOTHING TO DO: keep asking for the file. The bar keeps its baked
       date and time. */
    cotStopPolling();
    cotStartRetry();
    return;
  }
  cotStopRetry();
  var r = G && G.release ? G.release(COT_SUMMARY, cxAligned() ? CX_A : null, Date.now()) : null;
  if (!r || r.state === 'none') { cotStopPolling(); return; }
  /* past the release time and still on the old report: poll for it */
  if (r.state === 'due' || r.state === 'late') cotStartPolling(); else cotStopPolling();
  if (el && el.textContent !== r.text) el.textContent = r.text;
  if (bar) bar.setAttribute('data-state', r.state);
  var a = document.getElementById('cot-rel-a');
  if (a && r.inbox && a.textContent !== r.inbox) a.textContent = r.inbox;
  if (r.state !== COT_REL_STATE) {
    var live = document.getElementById('cot-rel-live');
    /* the first paint is not news; later changes of state are */
    if (live && COT_REL_STATE) live.textContent = r.state === 'countdown' ? 'Next report: ' + r.next.replace(/^Next report: /, '') : r.text;
    COT_REL_STATE = r.state;
    /* the answer line's "Next report" follows the bar */
    if (window.AgCotChart && window.AgCotChart.answerLine) window.AgCotChart.answerLine();
  }
}
cotTick();

/* THE SIGNUP BOX ON ARRIVAL (Nov 6: grow the Funds this week list). The release bar's "Get it in your inbox
   Friday", the print sheet's QR code, the email's forward line and the homepage's "Email me Fridays" all land on
   #cot-signup, the one Funds this week ask (components/signup-ask.js draws it; no second signup path). The browser
   may jump to the box (late, and smoothly, with the site's scroll-behavior); once the ask has drawn, a box not yet
   in view is brought to the top at once, without animation (and kept in view for a moment while the report above
   draws, until the reader scrolls), and its email field takes focus without a second scroll.
   A box already answered in this browser is hidden by signup-ask.js and nothing is focused. GA4 gets funds_ask
   {where} on the bar's link. */
(function(){
  var box = document.getElementById('cot-signup'), link = document.getElementById('cot-rel-a');
  if (!box) return;
  var waiting = 0;
  function arrive(){
    if (location.hash !== '#cot-signup') return;
    clearTimeout(waiting);
    var n = 0;
    (function wait(){
      var input = box.querySelector('.sa-in');
      if (box.hidden) return;
      if (!input) { if (++n <= 80) waiting = setTimeout(wait, 100); return; }
      bring();
      try { input.focus({ preventScroll: true }); } catch (_) { input.focus(); }
      /* the report above may still be drawing: keep the box in view for a moment, until the reader scrolls */
      var k = 0, stop = function(){ k = 99; };
      ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach(function(ev){ window.addEventListener(ev, stop, { once: true, passive: true }); });
      (function hold(){ if (k++ < 15 && location.hash === '#cot-signup') { bring(); waiting = setTimeout(hold, 100); } })();
    })();
  }
  /* one jump, not the page's smooth scroll across the whole report; nothing when the box is already in view */
  function bring(){
    var r = box.getBoundingClientRect(), vh = window.innerHeight || document.documentElement.clientHeight;
    if (box.hidden || (r.top >= 0 && r.bottom <= vh)) return;
    try { box.scrollIntoView({ block: 'start', behavior: 'instant' }); } catch (_) { box.scrollIntoView(true); }
  }
  if (link) link.addEventListener('click', function(){
    try { if (typeof window.gaEvent === 'function') window.gaEvent('funds_ask', { where: 'cot_release_bar' }); } catch (_) {}
    /* the same hash twice fires no hashchange: look after the browser's own jump */
    setTimeout(arrive, 0);
  });
  window.addEventListener('hashchange', arrive);
  arrive();
})();

})();
