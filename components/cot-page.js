/* /cot page: cards, The Read, the chart and the countdown. Moved out of
   cot.html 2026-10-15 so the page carries its words, not its code. */
(function(){
'use strict';

var CFG = [
  {key:'corn',        label:'Corn',             short:'Corn',   emoji:'<svg class="ic" aria-hidden="true"><use href="#i-sprout"/></svg>', color:'#d4a23f', group:'grains'},
  {key:'beans',       label:'Soybeans',         short:'Beans',  emoji:'<svg class="ic" aria-hidden="true"><use href="#i-bean"/></svg>', color:'#4aab4c', group:'grains'},
  {key:'wheat',       label:'Wheat (SRW)',      short:'SRW',    emoji:'<svg class="ic" aria-hidden="true"><use href="#i-wheat"/></svg>', color:'#5ba3e0', group:'grains'},
  {key:'kcwheat',     label:'KC Wheat (HRW)',   short:'KC',     emoji:'<svg class="ic" aria-hidden="true"><use href="#i-wheat"/></svg>', color:'#2fb5a5', group:'grains'},
  {key:'mplswheat',   label:'Mpls Wheat (HRS)', short:'Mpls',   emoji:'<svg class="ic" aria-hidden="true"><use href="#i-wheat"/></svg>', color:'#9b7cc4', group:'grains'},
  {key:'soymeal',     label:'Soybean Meal',     short:'Meal',   emoji:'<svg class="ic" aria-hidden="true"><use href="#i-package"/></svg>', color:'#7ab87c', group:'crush'},
  {key:'soyoil',      label:'Soybean Oil',      short:'Oil',    emoji:'<svg class="ic" aria-hidden="true"><use href="#i-droplet"/></svg>', color:'#d8c24a', group:'crush'},
  {key:'livecattle',  label:'Live Cattle',      short:'Cattle', emoji:'<svg class="ic" aria-hidden="true"><use href="#i-beef"/></svg>', color:'#d9534f', group:'livestock'},
  {key:'feedercattle',label:'Feeder Cattle',    short:'Feeder', emoji:'<svg class="ic" aria-hidden="true"><use href="#i-beef"/></svg>', color:'#e07b5a', group:'livestock'},
  {key:'leanhogs',    label:'Lean Hogs',        short:'Hogs',   emoji:'<svg class="ic" aria-hidden="true"><use href="#i-ham"/></svg>', color:'#e89ab0', group:'livestock'},
  {key:'milk',        label:'Class III Milk',   short:'Milk',   emoji:'<svg class="ic" aria-hidden="true"><use href="#i-milk"/></svg>', color:'#8fb8e0', group:'dairy'}
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
      setActiveTab(key);
      var chart = document.getElementById('cot-chart');
      var target = (chart && (chart.closest('section') || chart.parentElement)) || chart;
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
function buildLegend(keys,hasPrice){
  var el=document.getElementById('cot-legend'); if(!el) return;
  var h='';
  keys.forEach(function(k){ h+='<span class="cot-legend-item"><span class="cot-legend-dot" style="background:'+COLORS[k]+'"></span>'+LABELS[k]+'</span>'; });
  if(hasPrice){ h+='<span class="cot-legend-item" id="legend-price"><span class="cot-legend-dot" style="background:rgba(240,240,235,.9)"></span>'
    +(hasPrice.adjusted?'Price, roll-adjusted to the current front month (right axis)':'Price, front-month continuous, not roll-adjusted: it jumps at contract changes (right axis)')+'</span>'; }
  h+='<span class="cot-legend-item" style="margin-left:auto;font-size:0.755rem">Contracts (thousands) \u00b7 Source: CFTC</span>';
  el.innerHTML=h;
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
function ordinal(n){n=Math.round(n);var s=['th','st','nd','rd'],v=n%100;return n+(s[(v-20)%10]||s[v]||s[0]);}
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
  if (historyData) drawChart(activeKey);
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

function cotRenderDerived() {
  var read = document.getElementById('cot-read');
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
    pill.textContent=cp==null?'':((c.crowded&&cr&&cr.word)?cr.word+', crowded '+c.crowded:ordinal(sp)+' percentile')
      +' of every week since '+String(c.first_week||'').slice(0,4)+', as a share of open interest';
    pill.className='cot-pctl'+(c.crowded==='long'?' hot':c.crowded==='short'?' cold':'');
  }
  if(!el) return k;
  /* Direction of the NET, said as such. "Funds cut 8k" under a net short that
     had just grown by 8k read as the opposite of what happened. */
  var dirWord=k.chg<0?'<span class="dn">fell</span>':k.chg>0?'<span class="up">rose</span>':'was unchanged';
  var sharp='', driveTxt='';
  /* A move smaller than this market's typical week (the median absolute weekly
     change over the same window) gets no adjective. */
  if(k.significant_move){
    if(k.largest_in_window) sharp=', the largest weekly '+(k.chg<0?'fall':'rise')+' in net in the last '+k.weeks+' weeks';
    else if(k.weeks_since_larger>=4) sharp=', sharpest '+(k.chg<0?'fall':'rise')+' in net in '+k.weeks_since_larger+' weeks';
    driveTxt=', driven by <b>'+esc(k.driver)+'</b>';
  }
  var f=(k.flips&&k.flips[0])||null, flipTxt='';
  if(f&&f.weeks_ago<=6){ flipTxt=' Funds flipped <b class="'+(f.to==='long'?'up':'dn')+'">net '+f.to+'</b> '+(f.weeks_ago===0?'this week':f.weeks_ago+' week'+(f.weeks_ago>1?'s':'')+' ago')+'.'; }
  var html='Net '+dirWord+(k.chg?' <b>'+fmtMagK(k.chg)+'</b> contract'+(Math.abs(k.chg)===1?'':'s'):'')+' this week'+sharp+driveTxt
    +'.'+flipTxt;
  if(k.divergence){
    var dvCls=(k.divergence==='bearish'||k.divergence==='confirmed-down')?'dn':'up';
    /* Said once: "net and price both fell (price −5.0%)", not the rising/falling
       sentence and then the label repeating it. */
    html+=' Over 4 weeks, <b class="'+dvCls+'">'+divLabel(k.divergence)+'</b> (price '+(k.price4>=0?'+':'−')+Math.abs(k.price4).toFixed(1)+'%).';
  }
  /* The withdrawn analog hit rate (2026-08-21) stays withdrawn: it selected
     weeks with a percentile computed over the whole array, after the fact, and
     counted overlapping weeks of one episode as separate cases. */
  html+='<details class="cot-math"><summary>Show the math</summary>Where the net ranks among the last '+k.weeks+' weeks, in contracts: the '
    +ordinal(k.pct)+' percentile (a rank, not the place in the high-low range the futures pages show). Contracts are not adjusted for the size of the market, so the pill above, not this, is the ranking.</details>';
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
  if (date && summary.report_date) date.textContent = 'Positions as of ' + summary.report_date + ' (Tuesday) · CFTC Disaggregated, futures only';
}

var historyData = null;
var activeKey   = 'grains';


/* ── CHART INK FOLLOWS THE THEME ──────────────────────────────────────────
   Every mark on this canvas was hardcoded rgba(255,255,255,...) - gridlines,
   the zero line, both axes' labels, and the whole price overlay. The site has
   a light theme and a toggle in the header (components/styles.css defines
   [data-theme="light"]), and in light mode the body is #f6f7f5. Measured: the
   canvas paints an identical 487 white-ink pixels in both themes, so in light
   mode a reader gets a coloured shape floating with NO axis, NO gridlines, NO
   zero line, and no price line at all - and on a positioning chart the zero
   line is the difference between net long and net short, which is the whole
   point of looking at it.

   Canvas cannot inherit CSS colour, so it has to ask. */
function chartInk(a) {
  /* Dark ink on a light ground at the same alpha reads fainter than light ink
     on a dark one, and the faintest mark here is a .05 gridline, which on
     white is nothing at all. Light-theme alphas are scaled up. */
  if (document.documentElement.getAttribute('data-theme') === 'light')
    return 'rgba(18,22,20,' + Math.min(1, parseFloat(a) * 1.7).toFixed(3) + ')';
  return 'rgba(255,255,255,' + a + ')';
}
function chartOverlayInk(a) {
  return (document.documentElement.getAttribute('data-theme') === 'light'
    ? 'rgba(52,58,54,' : 'rgba(240,240,235,') + a + ')';
}

function drawChart(key) {
  var canvas = document.getElementById('cot-chart');
  var msg    = document.getElementById('cot-chart-msg');
  if (!canvas || !historyData) return;

  var history = (historyData && historyData.history) || {};
  var keys = GROUPS[key] ? GROUPS[key].slice() : [key];

  var allDates = [];
  keys.forEach(function(k) {
    (history[k] || []).forEach(function(r) { if (!allDates.includes(r.date)) allDates.push(r.date); });
  });
  allDates.sort();

  if (!allDates.length) {
    canvas.style.display = 'none';
    if (msg) { msg.style.display = 'block'; msg.textContent = 'No chart data yet, populates after the weekly CFTC release.'; }
    return;
  }

  canvas.style.display = 'block';
  if (msg) msg.style.display = 'none';
  try{var a11y=document.getElementById('cot-chart-a11y');if(a11y){var parts=[];keys.forEach(function(k){var arr=history[k]||[];if(arr.length){var f=arr[0],l=arr[arr.length-1];parts.push(LABELS[k]+': net moved from '+f.net+' on '+f.date+' to '+l.net+' on '+l.date);}});a11y.textContent='52-week managed money net positioning. '+parts.join('. ')+'.';}}catch(e){}

  var dpr = window.devicePixelRatio || 1;
  /* ASK THE CONTAINER, NOT THE CANVAS. The line below used to set an inline
     canvas.style.width in px, which shadows the stylesheet's width:100% -- so
     every later call, including the resize handler and the theme redraw, read
     back the FROZEN value instead of the real container. Measured: a canvas
     first drawn at 1280px stayed 827px inline on a 390px phone, right edge at
     864 in a 390px viewport, and the page sets overflow-x:clip so there is no
     scrollbar to reach it. The clipped portion is the right-hand side of the
     chart -- the most recent months, including this week's point. Rotation
     never recovered either. */
  var W = (canvas.parentElement ? canvas.parentElement.clientWidth : 0) || canvas.offsetWidth || 700;
  var H = 260;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.height = H + 'px';

  var ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  var allNets = [];
  keys.forEach(function(k) {
    (history[k] || []).forEach(function(r) { allNets.push(r.net); });
  });
  if (!allNets.length) return;
  var minNet = Math.min.apply(null, allNets);
  var maxNet = Math.max.apply(null, allNets);
  minNet = Math.min(minNet, 0);
  maxNet = Math.max(maxNet, 0);
  var pad = (maxNet - minNet) * 0.1 || 5000;
  minNet -= pad; maxNet += pad;
  var netRange = maxNet - minNet || 1;

  /* THE PRICE AXIS WAS PRINTING 93 FOR 930. The right-hand price ticks are
     drawn at PAD.left + cW + 4 with textAlign='left', and PAD.right was 16 --
     so a label started 12px from the canvas edge with only 16px of room. At
     9px JetBrains Mono a four-digit label measures 21.7px, ending ~9.7px PAST
     the bitmap, where canvas silently drops it. Soybean prices in the history
     file are all four digits (1196.75, 1207.25, 1219.5, 1155 ...), so the only
     price scale on the page read 125 / 114 / 104 / 93 for ~1259 / ~1147 /
     ~1043 / ~930 -- wrong by a factor of ten, with nothing to check it
     against. Right-align the ticks and give the overlay a real gutter. */
  var PAD = { top: 16, right: (keys.length === 1 ? 50 : 16), bottom: 32, left: 54 };
  var cW = W - PAD.left - PAD.right;
  var cH = H - PAD.top  - PAD.bottom;

  function xOf(i) { return PAD.left + (i / Math.max(allDates.length - 1, 1)) * cW; }
  function yOf(n) { return PAD.top + (1 - (n - minNet) / netRange) * cH; }

  /* AXIS (2026-10-12): ticks at 1-2-5 steps (50k, 100k, 200k...), not at
     quarter points of a padded range, which printed "-68k" and "-248k". Hairline
     gridlines at each tick, a solid zero line (net long above, net short below),
     11px text, signs with a true minus. Dates as "Oct 14". */
  function niceStep(span, n) {
    var raw = span / Math.max(1, n), p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
  }
  function fmtTick(v) {
    if (v === 0) return '0';
    var a = Math.abs(v), t = a >= 1000 ? (Math.round(a / 100) / 10).toString().replace(/\.0$/, '') + 'k' : String(Math.round(a));
    return (v < 0 ? '−' : '+') + t;
  }
  var CH_FONT = '11px JetBrains Mono, monospace';
  var tStep = niceStep(netRange, cH < 200 ? 4 : 5);
  ctx.font = CH_FONT;
  ctx.textAlign = 'right';
  for (var tv = Math.ceil(minNet / tStep) * tStep; tv <= maxNet; tv += tStep) {
    var yy = yOf(tv);
    if (Math.abs(tv) < tStep / 2) continue;           // the zero line is drawn below
    ctx.strokeStyle = chartInk('.08');
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PAD.left, Math.round(yy) + .5); ctx.lineTo(PAD.left + cW, Math.round(yy) + .5); ctx.stroke();
    ctx.fillStyle = chartInk('.62');
    ctx.fillText(fmtTick(tv), PAD.left - 6, yy + 4);
  }
  var zeroY = yOf(0);
  ctx.strokeStyle = chartInk('.4');
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(PAD.left, Math.round(zeroY) + .5); ctx.lineTo(PAD.left + cW, Math.round(zeroY) + .5); ctx.stroke();
  ctx.fillStyle = chartInk('.62');
  ctx.fillText('0', PAD.left - 6, zeroY + 4);

  var MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  ctx.fillStyle = chartInk('.62');
  ctx.font = CH_FONT;
  ctx.textAlign = 'center';
  var maxLabels = Math.max(2, Math.floor(cW / 64));
  var step = Math.max(1, Math.ceil(allDates.length / maxLabels));
  var lastI = allDates.length - 1;
  function dLbl(i, yr) {
    var parts = allDates[i].split('-');
    return MON[(+parts[1] || 1) - 1] + ' ' + (+parts[2] || '') + (yr ? ' ’' + String(parts[0]).slice(2) : '');
  }
  /* The first and latest weeks carry the year (the window spans two); the
     ones between are placed only where they clear their neighbours. */
  var taken = [];
  function place(i, lbl, align) {
    var w = ctx.measureText(lbl).width, x = align === 'right' ? xOf(i) + 2 : xOf(i);
    var x0 = align === 'left' ? x : align === 'right' ? x - w : x - w / 2, x1 = x0 + w;
    for (var q = 0; q < taken.length; q++) if (x0 < taken[q][1] + 10 && x1 > taken[q][0] - 10) return;
    taken.push([x0, x1]);
    ctx.textAlign = align;
    ctx.fillText(lbl, x, H - 8);
  }
  place(lastI, dLbl(lastI, true), 'right');
  if (lastI > 0) place(0, dLbl(0, true), 'left');
  for (var di = step; di < lastI; di += step) place(di, dLbl(di, false), 'center');
  if (taken.length < 3 && lastI > 2) place(Math.round(lastI / 2), dLbl(Math.round(lastI / 2), false), 'center');
  ctx.textAlign = 'right';

  keys.forEach(function(k) {
    var pts = history[k] || [];
    if (!pts.length) return;
    var color = COLORS[k];

    ctx.beginPath();
    pts.forEach(function(r, i) {
      var xi = allDates.indexOf(r.date);
      var x = xOf(xi), y = yOf(r.net);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    var lastIdx = allDates.indexOf(pts[pts.length-1].date);
    var firstIdx = allDates.indexOf(pts[0].date);
    ctx.lineTo(xOf(lastIdx), zeroY);
    ctx.lineTo(xOf(firstIdx), zeroY);
    ctx.closePath();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = keys.length === 1 ? 2 : 1.5;
    ctx.lineJoin = 'round';
    pts.forEach(function(r, i) {
      var xi = allDates.indexOf(r.date);
      var x = xOf(xi), y = yOf(r.net);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    if (pts.length) {
      var lastR = pts[pts.length - 1];
      var lxi = allDates.indexOf(lastR.date);
      ctx.beginPath();
      ctx.arc(xOf(lxi), yOf(lastR.net), 4, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }
  });
  // ---- price overlay (single-commodity view, only when price present) ----
  var priceMeta=null;
  if(keys.length===1){
    var pk=keys[0], parr=history[pk]||[];
    /* NOT THE RAW FRONT MONTH WHEN A REPAIRED SERIES EXISTS. `price` is
       front-month continuous and steps by the whole spread at every contract
       change; lean hogs drew -14.6% and -15.8% weekly "moves" that were rolls.
       cot_analysis.py joins the roll-repaired index (px_adj) onto these rows.
       When every priced row in view has it, the line is that index scaled so
       its last point equals the last front-month close (a back-adjusted
       series); otherwise it is the raw close and the legend says so. A market
       whose price the pipeline withholds is not drawn at all. */
    var wh=(cxCommodity(pk)&&cxCommodity(pk).price_withheld_reason)||null;
    var pricedVis=[]; if(!wh) allDates.forEach(function(dt){ for(var z=0;z<parr.length;z++){ if(parr[z].date===dt&&typeof parr[z].price==='number'){pricedVis.push({date:dt,raw:parr[z].price,adj:(typeof parr[z].px_adj==='number'?parr[z].px_adj:null)}); break;} } });
    var lastRaw=pricedVis.length?pricedVis[pricedVis.length-1]:null;
    var useAdj=pricedVis.length>=2&&pricedVis.every(function(r){return r.adj!==null;})&&lastRaw&&lastRaw.adj;
    var kAdj=useAdj?lastRaw.raw/lastRaw.adj:1;
    pricedVis.forEach(function(r){ r.price=useAdj?Math.round(r.adj*kAdj*100)/100:r.raw; });
    if(pricedVis.length>=2){
      var pVals=pricedVis.map(function(r){return r.price;});
      var pMin=Math.min.apply(null,pVals), pMax=Math.max.apply(null,pVals);
      var pPad=(pMax-pMin)*0.12||1; pMin-=pPad; pMax+=pPad; var pRange=pMax-pMin||1;
      function yOfP(p){ return PAD.top + (1-(p-pMin)/pRange)*cH; }
      // price line (white, thin, over the net area)
      ctx.beginPath(); ctx.strokeStyle=chartOverlayInk('.85'); ctx.lineWidth=1.5; ctx.lineJoin='round'; ctx.setLineDash([]);
      var started=false;
      pricedVis.forEach(function(r){ var xi=allDates.indexOf(r.date); var x=xOf(xi),y=yOfP(r.price); if(!started){ctx.moveTo(x,y);started=true;}else ctx.lineTo(x,y); });
      ctx.stroke();
      // last price dot
      var lastP=pricedVis[pricedVis.length-1]; var lpx=xOf(allDates.indexOf(lastP.date)), lpy=yOfP(lastP.price);
      ctx.beginPath(); ctx.arc(lpx,lpy,3,0,Math.PI*2); ctx.fillStyle=chartOverlayInk('.95'); ctx.fill();
      // right-axis price ticks
      ctx.fillStyle=chartInk('.62'); ctx.font='11px JetBrains Mono, monospace'; ctx.textAlign='left';
      ctx.textAlign='right';
      for(var pt=0;pt<=3;pt++){ var pv=pMin+(pt/3)*pRange; var py=yOfP(pv); ctx.fillText(Math.round(pv).toString(), W-4, py+3); }
      priceMeta={min:pMin,max:pMax,last:lastP.price,n:pricedVis.length,adjusted:!!useAdj,
                 byDate:pricedVis.reduce(function(m,r){m[r.date]=r;return m;},{})};
    }
  }
  CHART_GEO = { keys:keys, allDates:allDates, history:history, W:W, H:H,
    PADleft:PAD.left, cW:cW, xOf:xOf, yOf:yOf, colors:COLORS, labels:LABELS, priceMeta:priceMeta };
  buildLegend(keys, priceMeta);
}

function setActiveTab(key) {
  activeKey = key;
  document.querySelectorAll('.cot-chart-tab').forEach(function(btn) {
    var on = btn.dataset.key === key;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  drawChart(key);
}

document.querySelectorAll('.cot-chart-tab').forEach(function(btn) {
  btn.addEventListener('click', function() { setActiveTab(btn.dataset.key); });
});

var CHART_GEO = null;
(function(){
  var canvas = document.getElementById('cot-chart');
  var xhair  = document.getElementById('cot-xhair');
  var tip    = document.getElementById('cot-tip');
  if (!canvas || !xhair || !tip) return;
  function fmtTip(n){ var a=Math.abs(n); var s=n<0?'-':'+'; return s+(a>=1000?(a/1000).toFixed(1)+'k':a); }
  function nearestIndex(px){
    var g=CHART_GEO; if(!g||!g.allDates.length) return -1;
    var best=0,bd=1e9;
    for(var i=0;i<g.allDates.length;i++){ var dx=Math.abs(g.xOf(i)-px); if(dx<bd){bd=dx;best=i;} }
    return best;
  }
  function show(clientX){
    var g=CHART_GEO; if(!g) return;
    var rect=canvas.getBoundingClientRect();
    var px=clientX-rect.left;
    if(px<g.PADleft||px>g.PADleft+g.cW){ hide(); return; }
    var i=nearestIndex(px); if(i<0) return;
    var date=g.allDates[i];
    var x=g.xOf(i);
    xhair.style.left=x+'px'; xhair.style.display='block';
    var rows=['<b>'+date+'</b>'];
    g.keys.forEach(function(k){
      var arr=g.history[k]||[]; var rec=null;
      for(var j=0;j<arr.length;j++){ if(arr[j].date===date){rec=arr[j];break;} }
      if(rec){ var line='<span style="color:'+g.colors[k]+'">\u25CF</span> '+g.labels[k]+': '+fmtTip(rec.net); var pm=g.priceMeta&&g.priceMeta.byDate&&g.priceMeta.byDate[date]; if(g.keys.length===1&&pm){ line+='  \u00b7  px '+pm.raw+(g.priceMeta.adjusted?' (adj '+pm.price+')':''); } rows.push(line); }
    });
    tip.innerHTML=rows.join('<br>');
    tip.style.display='block';
    // position tip: flip to left side near right edge
    var tw=tip.offsetWidth||120;
    var left=x+12; if(left+tw>g.W) left=x-tw-12; if(left<0) left=4;
    tip.style.left=left+'px'; tip.style.top='8px';
  }
  function hide(){ xhair.style.display='none'; tip.style.display='none'; }
  canvas.addEventListener('mousemove',function(e){ show(e.clientX); });
  canvas.addEventListener('mouseleave',hide);
  canvas.addEventListener('touchstart',function(e){ if(e.touches[0]) show(e.touches[0].clientX); },{passive:true});
  canvas.addEventListener('touchmove',function(e){ if(e.touches[0]) show(e.touches[0].clientX); },{passive:true});
  canvas.addEventListener('touchend',hide);
})();


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
var COT_ANNOUNCE_UNTIL = 0;       // the arrival message owns the badge until this
var COT_ANNOUNCE_TEXT  = '';

function cotApply(data, isPoll) {
  var _bk = document.getElementById('cot-baked');
  if (_bk) _bk.style.display = 'none';   // live render supersedes the crawler bake
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
    /* AND HOLD THE ANNOUNCEMENT ON SCREEN. Written straight into the badge,
       it survived about a millisecond: cotTick() runs on the next line, sees a
       fresh report_date, and replaces it with "next update in 6d 21h". The one
       sentence the whole fix exists to deliver -- to a reader who has been
       sitting on this page waiting for it -- flashed and was gone. It now owns
       the badge for a full minute, and cotTick() will not touch it until the
       window closes. */
    COT_ANNOUNCE_UNTIL = Date.now() + 60000;
    COT_ANNOUNCE_TEXT  = 'updated, ' + fresh + ' report is in';
    /* Everything else on the page that reads a different file learns here,
       in the same tick, rather than on its own timer. */
    try { document.dispatchEvent(new CustomEvent('cot:new-report', { detail: fresh })); } catch (e) {}
  }
  /* The summary can move without the history file moving, so the agreement
     has to be re-tested from this side too, not only when history loads. */
  cotRenderDerived();
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
    var _canvas = document.getElementById('cot-chart'); if (_canvas) _canvas.style.display = '';
    drawChart(activeKey);
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
    var msg = document.getElementById('cot-chart-msg');
    if (msg) { msg.style.display = 'block'; msg.textContent = 'Could not load the chart data, retrying.'; }
    var canvas = document.getElementById('cot-chart');
    if (canvas) canvas.style.display = 'none';
  });
}
cotLoadHistory(false);

window.addEventListener('resize', function() {
  if (historyData) drawChart(activeKey);
});

/* The canvas is painted once and does not know the theme changed under it.
   Without this, toggling to light left the previous theme's ink on screen
   until something else forced a redraw. */
if (window.MutationObserver) {
  new MutationObserver(function(){ if (historyData) drawChart(activeKey); })
    .observe(document.documentElement, { attributes:true, attributeFilter:['data-theme'] });
}

/* ── THE COUNTDOWN TELLS THE TRUTH ABOUT THE DATA, NOT THE CLOCK ──────────
   What this was: a timer to Friday 21:30 UTC. At zero it said "expected
   shortly" for under a minute, then cotNextTarget() rolled to the FOLLOWING
   Friday and it went back to "next update in 6d 23h" -- over a page still
   showing the previous week's report. Readers watched it hit zero and reset
   with nothing new on the page. The counter never once looked at the data.

   What it is now: the expected report is derived from the report on screen --
   the Tuesday after it -- and the release moment is that week's Friday at
   3:30 PM New York, computed against the real zone so it is right in EST and
   EDT alike. Until the release, it counts down. After the release, it does NOT
   reset: it says the report is due, keeps saying so, and polls for it. The
   countdown can only start again once the new report is actually on screen. */
function cotEtOffsetMin(ts){
  /* Minutes New York is behind UTC at that instant: 240 in EDT, 300 in EST. */
  var p = {};
  new Intl.DateTimeFormat('en-US', { timeZone:'America/New_York', hour12:false,
    year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' })
    .formatToParts(new Date(ts)).forEach(function(x){ p[x.type] = x.value; });
  var h = +p.hour === 24 ? 0 : +p.hour;
  return (ts - Date.UTC(+p.year, +p.month - 1, +p.day, h, +p.minute)) / 60000;
}
function cotEtInstant(y, m, d, hh, mm){
  var guess = Date.UTC(y, m, d, hh + 4, mm);           // assume EDT, then correct
  return Date.UTC(y, m, d, hh, mm) + cotEtOffsetMin(guess) * 60000;
}
/* WHEN THE NEXT REPORT IS DUE -- AND DELIBERATELY NOT WHAT IT WILL BE CALLED.
   This used to derive the next as-of date by adding ten days to the report on
   screen and name it in the badge. On a holiday week that is a date CFTC never
   published: the release shifts, the as-of can shift, and the page would tell a
   reader the "November 17 report" was late when no such report exists. Naming a
   report we have not got is inventing a date, which is the same sin as
   inventing a number, so the badge now names only the report actually in hand.

   The DUE MOMENT is still derived from the report on screen -- the Friday after
   the following Tuesday, 3:30 PM New York -- because that is the schedule
   CFTC publishes to, and being a little early on a holiday week costs a reader
   nothing except a message that says we are still checking. */
function cotNextRelease(loadedReportDate){
  if (!loadedReportDate) return null;
  /* fetch_cot.py writes next_release from cot_calendar.release_date(): usually
     the Friday, the Monday when a federal holiday falls Wednesday to Friday
     (six weeks in CFTC's 2026 schedule). Trusted only when it belongs to the
     report on screen; otherwise fall back to the plain Friday. */
  var nr = COT_SUMMARY && COT_SUMMARY.report_date === loadedReportDate && COT_SUMMARY.next_release;
  if (nr && /^\d{4}-\d{2}-\d{2}$/.test(nr)) {
    var q = nr.split('-');
    return { due: cotEtInstant(+q[0], +q[1] - 1, +q[2], 15, 30) };
  }
  var t = Date.parse(loadedReportDate + ' 12:00:00 GMT');
  if (!isFinite(t)) return null;
  var nextTue = new Date(t + 7 * 86400000);
  var fri = new Date(nextTue.getTime() + 3 * 86400000);
  return { due: cotEtInstant(fri.getUTCFullYear(), fri.getUTCMonth(), fri.getUTCDate(), 15, 30) };
}
function cotFmtLeft(ms){
  var s = Math.floor(ms / 1000), d = Math.floor(s / 86400),
      h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return d + 'd ' + h + 'h';
  if (h > 0) return h + 'h ' + m + 'm';
  return m > 0 ? m + 'm' : '<1m';
}
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

function cotTick(){
  var el = document.getElementById('cot-countdown');
  if (!el) return;
  /* STATE FIRST, TEXT SECOND. Written the other way round, the arrival message
     took an early return that skipped cotStopPolling() -- so the page went on
     re-fetching cot.json for the whole minute the message was up, after the
     thing it was polling for had already arrived. What is on the badge and
     what the page is doing are two different questions and are now answered
     separately. */
  var nx  = cotNextRelease(COT_LOADED);
  /* While the arrival window is open the badge shows the arrival message and
     the computed text is discarded -- not merely suppressed. Written as "only
     write when the window is closed", nothing ever put the announcement on
     screen at all: cotApply set the text variable and cotTick declined to
     write anything, so the badge kept the stale overdue line while the new
     numbers rendered underneath it. */
  var announcing = Date.now() < COT_ANNOUNCE_UNTIL;
  /* WRITE ONLY ON CHANGE. This badge is role="status" aria-live="polite", and
     cotTick runs every 60 seconds. Rewriting the same sentence re-fires the
     announcement, so a screen-reader user waiting through an outstanding
     release heard "this week's report is due, checking every couple of
     minutes" once a minute, indefinitely. Assigning identical text is not a
     no-op to assistive tech even though it looks like one. */
  var say = function (t) {
    var next = announcing ? COT_ANNOUNCE_TEXT : t;
    if (el.textContent !== next) el.textContent = next;
  };

  if (!nx) {
    /* NO REPORT ON SCREEN IS NOT THE SAME AS NOTHING TO DO. COT_LOADED was the
       only gate on polling, so a first fetch that failed -- a blip, a cold CDN,
       a phone with one bar -- left this returning early forever: empty badge,
       polling disarmed, and the page never asking for the file again for as
       long as it stayed open. The retry is what makes that failure temporary. */
    cotStopPolling();
    cotStartRetry();
    say('');
    return;
  }
  cotStopRetry();

  var left = nx.due - Date.now();
  if (left > 0) {
    cotStopPolling();
    say('next update in ' + cotFmtLeft(left));
    return;
  }

  /* Past the release and still on the old report. Say which one is missing and
     roughly how late it is, rather than resetting the clock over stale data. */
  cotStartPolling();
  var lateH = Math.floor(-left / 3600000);
  say(lateH < 3
    ? 'this week\u2019s report is due, checking every couple of minutes'
    : 'this week\u2019s report hasn\u2019t landed here yet (' +
      (lateH < 24 ? lateH + 'h' : Math.floor(lateH / 24) + 'd') +
      '), still checking. When a federal holiday falls Wednesday to Friday, CFTC releases on the Monday.');
}
cotTick(); setInterval(cotTick, 60000);

})();
