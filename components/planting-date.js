/* /planting-date: corn and soybean planting dates for Wisconsin and Minnesota.
 * Static answer in the HTML; this script adds the season line, the reader's own
 * numbers (soil now and 5-day soil forecast from Open-Meteo, nearest NOAA
 * normals station's frost odds and heat units from data/planting/<st>.json,
 * the county's RMA final planting dates from data/rma-planting-dates.json),
 * and the zone-average fallback cards.
 * Station files are loaded only when a location is entered. Until the
 * planting-normals workflow has written them, the station block says so and
 * the zone averages stand in.
 */
(function(){
'use strict';

var $ = function(id){ return document.getElementById(id); };
var crop = 'corn';
var userLat = null, userLon = null, userCounty = '', userState = '';
var zipTouched = false; // true once the user has typed or located; stops the delayed geo prefill
var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
var MDAYS = [31,28,31,30,31,30,31,31,30,31,30,31];
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
function doyOf(mo, d){ var n=d; for(var i=0;i<mo-1;i++) n+=MDAYS[i]; return n; }        // mo 1-12, 365-day year
function mdOfDoy(n){ var mo=0; while(n>MDAYS[mo]){ n-=MDAYS[mo]; mo++; } return MONTHS[mo]+' '+n; }
function doyOfMD(s){ var m=/^(\d{2})-(\d{2})$/.exec(s||''); return m ? doyOf(+m[1], +m[2]) : null; }
function fmt(n){ return Math.round(n).toLocaleString('en-US'); }

/* ─── ZONE FALLBACK DATA ─────────────────────────────────────────────── */
// Approximate freeze-percentile dates by zone. They run early against station records
// (Madison median last spring freeze is about May 5, UW-Madison SSEC 1940-2024) and the fall
// ones were never checked against a station. Used only until a location and the NOAA station
// file are in.
var FROST_DATA = {
  sw_wi:  {zone:'Southern Wisconsin (Madison area)', spring10:'Apr 9',  spring50:'Apr 22', spring90:'May 5',  fall10:'Oct 7', fall50:'Sep 25', fall90:'Sep 13'},
  cw_wi:  {zone:'Central Wisconsin (Wausau area)',   spring10:'Apr 21', spring50:'May 2',  spring90:'May 15', fall10:'Sep 28',fall50:'Sep 18', fall90:'Sep 8'},
  nw_wi:  {zone:'Northern Wisconsin (Rhinelander)',  spring10:'May 3',  spring50:'May 15', spring90:'May 28', fall10:'Sep 18',fall50:'Sep 8',  fall90:'Aug 29'},
  smn:    {zone:'Southern Minnesota (Rochester)',    spring10:'Apr 10', spring50:'Apr 23', spring90:'May 6',  fall10:'Oct 5', fall50:'Sep 24', fall90:'Sep 13'},
  cmn:    {zone:'Central Minnesota (St. Cloud)',     spring10:'Apr 21', spring50:'May 4',  spring90:'May 17', fall10:'Sep 27',fall50:'Sep 17', fall90:'Sep 7'},
  nmn:    {zone:'Northern Minnesota (Brainerd)',     spring10:'Apr 29', spring50:'May 13', spring90:'May 27', fall10:'Sep 20',fall50:'Sep 9',  fall90:'Aug 29'}
};

// SHARED TABLE: average GDU per day by month, May-Sep, Wisconsin. /gdu-calculator carries the
// same constant (WI_HIST) with identical values; if you change one, change the other.
// The zone card counts day by day from this table, from the planting date up to the 50%
// first-fall-frost date of the selected zone. There is no April rate, so it starts at May 1.
var WI_HIST = [7.5, 15.5, 21.5, 19.5, 10.0];
var WI_DAYS = [31, 30, 31, 31, 30];
// GDU from (startMon startDay) up to, not including, (endMon endDay). Months are 0-based.
function gduBetween(sm, sd, em, ed){
  var total = 0;
  for(var mo = 4; mo <= 8; mo++){
    if(mo < sm || mo > em) continue;
    var first = (mo === sm) ? sd : 1;
    var last = (mo === em) ? ed - 1 : WI_DAYS[mo-4];
    if(last >= first) total += (last - first + 1) * WI_HIST[mo-4];
  }
  return total;
}
function parseMD(str){
  var m = /^([A-Za-z]{3}) (\d{1,2})$/.exec(str);
  return m ? {mo: MONTHS.indexOf(m[1]), d: parseInt(m[2],10)} : null;
}

/* ─── YIELD TABLES ───────────────────────────────────────────────────── */
// Corn planting date yield response (% of maximum yield), UW and UMN Extension guidance.
var CORN_PENALTY = [
  {label:'Apr 15', pct:97, note:'Early: cold soil injury possible'},
  {label:'Apr 20', pct:98, note:'Good if soil is 50°F or warmer'},
  {label:'Apr 25', pct:100,note:'Peak window'},
  {label:'May 1',  pct:100,note:'Peak window'},
  {label:'May 5',  pct:99, note:'Still excellent'},
  {label:'May 10', pct:98, note:'Small drag'},
  {label:'May 15', pct:97, note:'Good'},
  {label:'May 20', pct:95, note:'Loss starts to add up'},
  {label:'May 25', pct:90, note:'About 1% a day now'},
  {label:'Jun 1',  pct:83, note:'About 1% a day the week before'},
  // UMN Extension, % of max yield for a Jun 9 planting: 69 (Lamberton 1988-2003) and 79
  // (Lamberton, Morris, Waseca 2009-11). 74 is only the midpoint for row colouring; the row
  // prints the range. https://extension.umn.edu/corn-planting/planting-date-considerations-corn
  // No Jun 15 row: no cited source for it.
  {label:'Jun 10', pct:74, lo:69, hi:79, note:'UMN trials, Jun 9 planting: 69% (Lamberton 1988–2003) and 79% (Lamberton, Morris, Waseca 2009–11). Roughly 1 to 1.5 points a day in early June'}
];

// Soybean planting date yield response. APPROXIMATION, computed, not a trial table:
// the 55 bu/a base minus 0.2-0.5 bu/a per day of planting delay past May 1 (UW-Madison, Conley:
// about 0.4 bu/a/day past May 1; 0.2-0.5 bu/a/day after Apr 25). Straight line, no loss
// counted before May 1. The 0.4 was not re-read at the source for this page, so every row
// prints the 0.2-0.5 range and keeps 0.4 only as the midpoint for colour and the middle estimate.
// https://cropsandsoils.extension.wisc.edu/articles/agronomic-pivot-points-for-mid-may-planted-soybeans/
var BEAN_BASE = 55, BEAN_LOSS_PER_DAY = 0.4, BEAN_LOSS_LO = 0.2, BEAN_LOSS_HI = 0.5;
var BEAN_PENALTY = [
  {label:'Apr 25', days:0},
  {label:'May 1',  days:0},
  {label:'May 5',  days:4},
  {label:'May 10', days:9},
  {label:'May 15', days:14},
  {label:'May 20', days:19},
  {label:'May 25', days:24},
  {label:'Jun 1',  days:31},
  {label:'Jun 10', days:40},
  {label:'Jun 15', days:45},
  {label:'Jun 20', days:50, extra:'past the final planting date in every WI and MN county (RMA)'}
].map(function(r){
  var loss = BEAN_LOSS_PER_DAY * r.days, bu = BEAN_BASE - loss;
  r.bu = bu; r.lossBu = loss; r.pct = Math.round(bu / BEAN_BASE * 100);
  r.lossLo = BEAN_LOSS_LO * r.days; r.lossHi = BEAN_LOSS_HI * r.days;
  r.note = r.days===0
    ? (r.label==='Apr 25' ? 'No loss counted before May 1 here (UW-Madison sees 0.2–0.5 bu/a/day after Apr 25)' : 'Base: no delay past May 1')
    : r.days+' days × 0.2–0.5 bu/a/day (middle '+loss.toFixed(1)+')'+(r.extra?', '+r.extra:'');
  return r;
});

var DISEASE_CORN = [
  {name:'Imbibitional chilling injury',risk:'High risk under 50°F soil',desc:'Dry seed takes up cold water fast and cells rupture, leaving stand gaps. Worst with a cold rain in the first 24 hours after planting.'},
  {name:'Pythium seed rot',risk:'High risk under 50°F, wet soil',desc:'Pythium thrives in cold, saturated soil and kills germinating seed before emergence. Seed treatment helps but does not remove the risk.'},
  {name:'Seedling blight (Fusarium)',risk:'Moderate under 55°F',desc:'Slows early growth and discolors the mesocotyl and seminal roots. More common in cold, compacted soil.'}
];
var DISEASE_BEAN = [
  {name:'Sudden death syndrome (SDS)',risk:'Cold, wet soil at planting',desc:'Fusarium virguliforme infects roots early, near planting. Symptoms show at R3 to R5. Early planting can raise SDS pressure; manage it with variety choice and seed treatment.'},
  {name:'Phytophthora root rot',risk:'Wet, poorly drained soil',desc:'Cold saturated soil favors Phytophthora. Drainage and Rps gene choice are the main defenses. Mefenoxam seed treatment helps.'},
  {name:'Pythium seed rot',risk:'Cold wet soil under 50°F',desc:'Same pathogen as in corn; kills germinating seed in cold saturated soil. Metalaxyl seed treatment protects.'}
];

/* ─── SEASON LINE ────────────────────────────────────────────────────── */
function seasonLine(now){
  var mo = now.getMonth()+1, y = now.getFullYear();
  if(mo >= 7) return 'Planting is done for '+y+'. Your ZIP gives next spring\u2019s numbers: your nearest NOAA station\u2019s frost odds and heat units, and your county\u2019s final planting dates.';
  if(mo <= 3) return 'Planting has not started. Put in your ZIP to see your nearest NOAA station’s frost odds and heat units and your county’s final planting dates. Soil temperature means something once fields start to work in April.';
  return 'Planting season. Put in your ZIP for soil temperature now, a 5-day soil forecast, your station’s frost odds and your county’s final planting date.';
}

/* ─── INIT ──────────────────────────────────────────────────────────── */
function init(){
  var s = $('pd-season'); if(s) s.textContent = seasonLine(new Date());
  renderFrostTable($('pd-zone') ? $('pd-zone').value : 'cw_wi');
  renderWindowBars();
  renderPenaltyTable();
  renderGDUCompare();
  renderDiseaseCards();
  setTimeout(function(){
    if(zipTouched) return;
    var st = window.AGSIST_STATE;
    if(st && st.lat){
      var city = st.city || '', state = st.state || '';
      if(city){
        userLat = st.lat; userLon = st.lon;
        var w = st.weather || {};
        userCounty = w.county || ''; userState = (w.state || state || '').toUpperCase();
        $('pd-zip').value = city + (state ? ', ' + state : '');
        $('pd-loc-display').textContent = 'Location: ' + city + (state ? ', ' + state : '');
        loadLocal();
      }
    }
  }, 1000);
}

/* ─── CROP TOGGLE ───────────────────────────────────────────────────── */
function setCrop(c){
  crop = c;
  var corn = c === 'corn';
  $('pill-corn').classList.toggle('active', corn); $('pill-corn').setAttribute('aria-pressed', corn);
  $('pill-bean').classList.toggle('active', !corn); $('pill-bean').setAttribute('aria-pressed', !corn);
  $('pd-rm-lbl').textContent = corn ? 'Relative maturity (days)' : 'Maturity group (e.g. 1.0)';
  $('pd-rm-hint').textContent = corn ? 'Use your seed’s rating. 108-day corn is common in south-central WI, 95 to 100-day in the north.' : 'Use your seed’s rating. MG 2 to 3 is common in southern WI and MN, MG 0.5 to 1.5 in the north.';
  var el = $('pd-rm');
  if(corn){ el.min=70; el.max=135; el.step=1; el.value=108; }
  else { el.min=0; el.max=6; el.step=0.1; el.value=1; }
  renderWindowBars(); renderPenaltyTable(); renderGDUCompare(); renderDiseaseCards(); runVerdict(); renderStationGDU();
}
$('pill-corn').addEventListener('click', function(){ setCrop('corn'); });
$('pill-bean').addEventListener('click', function(){ setCrop('bean'); });

/* ─── ZONE FROST TABLE ──────────────────────────────────────────────── */
$('pd-zone').addEventListener('change', function(){ renderFrostTable(this.value); renderGDUCompare(); });

function renderFrostTable(zone){
  var d = FROST_DATA[zone];
  if(!d) return;
  var html = '<table class="frost-table">'
    +'<thead><tr><th>Event</th><th class="p10">10%</th><th class="p50">50%</th><th class="p90">90%</th></tr></thead>'
    +'<tbody>'
    +'<tr><td>Last spring frost</td><td class="p10">'+d.spring10+'</td><td class="p50">'+d.spring50+'</td><td class="p90">'+d.spring90+'</td></tr>'
    +'<tr><td>First fall frost</td><td class="p10">'+d.fall10+'</td><td class="p50">'+d.fall50+'</td><td class="p90">'+d.fall90+'</td></tr>'
    +'</tbody></table>'
    +'<p class="f-hint">Percentiles of the freeze date, not planting advice. These zone dates are approximate and run early: UW-Madison SSEC puts the Madison median last spring freeze near May 5 (1940-2024), 13 days after this table’s 50% date for southern Wisconsin. The freeze temperature behind them is not stated. Your ZIP gives your nearest NOAA station instead.</p>';
  var el = $('frost-table-wrap'); if(el) el.innerHTML = html;
}

/* ─── PLANTING WINDOW BARS ──────────────────────────────────────────── */
function renderWindowBars(){
  var isCorn = crop === 'corn';
  var t = $('win-title'); if(t) t.textContent = (isCorn ? 'Corn' : 'Soybean') + ' planting window: Wisconsin and Minnesota';
  var windows = isCorn ? [
    {label:'Best',       dates:'Apr 25 to May 10', pct:100, cls:'green', tip:'98% or more of peak yield on the table below, once soil holds 50°F.'},
    {label:'Good',       dates:'May 10 to May 20', pct:75,  cls:'gold',  tip:'Down 2 to 5% by May 20.'},
    {label:'Late',       dates:'May 20 to Jun 1',  pct:50,  cls:'gold',  tip:'About 1% a day. A shorter hybrid may fit better.'},
    {label:'Very late',  dates:'After Jun 1',      pct:25,  cls:'red',   tip:'Big losses; final planting dates are May 25 or 31.'}
  ] : [
    {label:'Best',       dates:'Apr 25 to May 1',  pct:100, cls:'green', tip:'Plant when the field is fit and soil is 50°F.'},
    {label:'Good',       dates:'May 1 to May 15',  pct:70,  cls:'gold',  tip:'About 1 to 7 bu/a below May 1 by May 15 (0.2 to 0.5 bu/a a day).'},
    {label:'Late',       dates:'May 15 to Jun 1',  pct:45,  cls:'gold',  tip:'About 3 to 16 bu/a below May 1 on a 55 bu base.'},
    {label:'Very late',  dates:'After Jun 1',      pct:20,  cls:'red',   tip:'More than 6 to 16 bu/a down. Final planting dates are Jun 10 or 15.'}
  ];
  $('win-bars').innerHTML = windows.map(function(w){
    return '<div class="window-bar-wrap">'
      +'<div class="window-bar-label"><span>'+w.label+'</span><span class="wb-dates">'+w.dates+'</span></div>'
      +'<div class="window-bar"><div class="window-bar-fill '+w.cls+'" style="width:'+w.pct+'%"></div></div>'
      +'<div class="wb-tip">'+w.tip+'</div></div>';
  }).join('');
}

/* ─── PENALTY TABLE ─────────────────────────────────────────────────── */
function renderPenaltyTable(){
  var isCorn = crop === 'corn';
  var data = isCorn ? CORN_PENALTY : BEAN_PENALTY;
  var maxYield = isCorn ? 200 : 55;
  var rows = data.map(function(d){
    var cls = d.pct===100?'opt':d.pct>=95?'':d.pct>=88?'warn':d.pct>=78?'hi':'hl';
    var pctStr, lossStr, estYield;
    if(d.bu!=null){ // soybean: computed from bu/a, approximation
      if(d.days>0){
        pctStr = Math.round((maxYield-d.lossHi)/maxYield*100)+'–'+Math.round((maxYield-d.lossLo)/maxYield*100)+'%';
        lossStr = '-'+d.lossLo.toFixed(1)+' to -'+d.lossHi.toFixed(1)+' bu/a';
        estYield = (maxYield-d.lossHi).toFixed(0)+'–'+(maxYield-d.lossLo).toFixed(0);
      } else { pctStr = '100%'; lossStr = '-'; estYield = maxYield.toFixed(0); }
    } else if(d.lo!=null){ // a published range, printed as a range
      pctStr = '~'+d.lo+'–'+d.hi+'%';
      lossStr = '-'+(100-d.hi)+' to -'+(100-d.lo)+'%';
      estYield = (maxYield*d.lo/100).toFixed(0)+'–'+(maxYield*d.hi/100).toFixed(0);
    } else {
      pctStr = d.pct+'%';
      lossStr = d.pct===100?'-':'-'+(100-d.pct)+'%';
      estYield = (maxYield * d.pct / 100).toFixed(0);
    }
    var col = d.pct===100?'var(--green)':d.pct>=95?'var(--gold)':'var(--pd-red)';
    return '<tr class="'+cls+'"><td>'+d.label+'</td><td style="color:'+col+'">'+pctStr+'</td><td>'+lossStr+'</td>'
      +'<td class="mono">~'+estYield+' bu/ac</td><td class="pen-note">'+d.note+'</td></tr>';
  }).join('');
  var foot = isCorn
    ? 'Est. yield on a 200 bu/ac base. Actual varies by hybrid, field and year. Source: UW and UMN Extension guidance. Jun 10 row: <a href="https://extension.umn.edu/corn-planting/planting-date-considerations-corn" target="_blank" rel="noopener">UMN Extension</a> trials, % of maximum yield for a Jun 9 planting: 69% (Lamberton 1988&ndash;2003) and 79% (Lamberton, Morris, Waseca 2009&ndash;11); optimum roughly Apr 21&ndash;May 10.'
    : 'Approximation, not a trial table: a 55 bu/ac base minus 0.2 to 0.5 bu/a per day past May 1, a straight line; the row colour uses the 0.4 middle. Rates from <a href="https://cropsandsoils.extension.wisc.edu/articles/agronomic-pivot-points-for-mid-may-planted-soybeans/" target="_blank" rel="noopener">UW-Madison (Conley)</a>: about 0.4 bu/a a day past May 1, 0.2&ndash;0.5 after Apr 25. Actual loss varies by year, variety and field.';
  $('penalty-section').innerHTML = '<div class="pd-card"><h2 class="pd-card-title">'+(isCorn?'Corn':'Soybean')+' Yield Penalty by Planting Date</h2>'
    +'<div class="pen-wrap"><table class="pen-table">'
    +'<thead><tr><th>Planted</th><th>% max</th><th>Loss</th><th>Est. yield</th><th class="pen-note">Notes</th></tr></thead>'
    +'<tbody>'+rows+'</tbody></table></div>'
    +'<p class="f-hint">'+foot+'</p></div>';
}

/* ─── MATURITY INPUT ─────────────────────────────────────────────────── */
// Blank or out-of-range maturity is no target, never a default (MG 0 is a real group).
function maturity(){
  var v = parseFloat($('pd-rm').value);
  var ok = crop==='corn' ? (isFinite(v)&&v>=70&&v<=135) : (isFinite(v)&&v>=0&&v<=6);
  var rm = ok ? v : null, target = null;
  // Corn: rm*22+250, an AGSIST line through K-State (110-day ~2,670) and Purdue (112-day ~2,700); same as /gdu-calculator.
  // Soybean: 1750 + 280*MG, a straight line through NDSU's soybean GDD model (planting to R8:
  // 1,694 for 00.8, 1,890 for 0.5, 2,058 for 1.1 RM), same as /gdu-calculator. Used ONLY for
  // MG -0.2 to 1.1; any other MG has no published figure, so no target is printed.
  // https://www.ag.ndsu.edu/news/newsreleases/2016/june-13-2016/ndsu-develops-soybean-growing-degree-day-model
  if(rm!==null) target = crop==='corn' ? Math.round(rm*22+250) : ((rm>=-0.2&&rm<=1.1) ? Math.round(1750+280*rm) : null);
  return {rm: rm, target: target};
}
function targetLine(m){
  if(m.target===null){
    if(m.rm===null) return crop==='corn' ? 'Enter a corn relative maturity from 70 to 135.' : 'Enter a soybean maturity group from 0 to 6.';
    return 'Soybean GDU target: n/a · no published GDD-to-maturity figure for MG '+m.rm+' (NDSU’s model covers 00.8–1.1); soybean maturity is driven by day length. Use the seed company’s rating.';
  }
  return 'GDU target for '+m.rm+(crop==='corn'?'-day RM corn':' MG soybean')+': '+fmt(m.target)+' GDUs'+(crop==='corn'?' (AGSIST line through K-State 110-day ≈ 2,670 and Purdue 112-day ≈ 2,700; a reference figure).':' to R8 (NDSU soybean GDD model).');
}

/* ─── ZONE GDU COMPARE ───────────────────────────────────────────────── */
function renderGDUCompare(){
  var zoneKey = $('pd-zone') ? $('pd-zone').value : 'cw_wi';
  var fz = FROST_DATA[zoneKey] || FROST_DATA.cw_wi;
  var frost = parseMD(fz.fall50);
  var dates = [{d:'May 1',m:4,dd:1,cls:'best'},{d:'May 10',m:4,dd:10,cls:'good'},{d:'May 20',m:4,dd:20,cls:'warn'},{d:'Jun 1',m:5,dd:1,cls:'late'}];
  dates.forEach(function(x){ x.gdu = Math.round(gduBetween(x.m, x.dd, frost.mo, frost.d)); });
  var m = maturity();
  $('cmp-grid').innerHTML = dates.map(function(d,i){
    var delta = i===0?0:d.gdu-dates[0].gdu;
    return '<div class="cmp-card '+d.cls+'"><div class="cmp-date">Plant '+d.d+'</div>'
      +'<div class="cmp-gdu">'+d.gdu.toLocaleString('en-US')+'</div>'
      +'<div class="cmp-label">GDUs to '+fz.fall50+'</div>'
      +(i>0?'<div class="cmp-delta neg">'+delta+' vs May 1</div>':'<div class="cmp-delta pos">Baseline</div>')+'</div>';
  }).join('');
  // No maturity call. The zone frost dates are approximations the page itself calls early and
  // unchecked, the heat units are a Wisconsin monthly average with no April rate, and the target
  // is a line through two seed-company figures. On those inputs a 108-day hybrid (typical for
  // south-central WI) came out "short" in every zone. The card only sets the two numbers side by
  // side; the station block (ZIP) gives station numbers.
  var vEl = $('cmp-verdict');
  var vtxt = '';
  if(m.target!==null){
    var who = crop==='corn' ? 'a '+m.rm+'-day hybrid is rated about ' : 'an MG '+m.rm+' variety needs about ';
    vtxt = 'On these approximate numbers, a May 1 planting gets about '+dates[0].gdu.toLocaleString('en-US')+' GDUs before the median first fall frost ('+fz.fall50+'), and '+who+fmt(m.target)+(crop==='corn'?' to black layer':' to R8')+'. That is not a maturity call: the frost dates and heat units here are rough zone averages, not your station. Check your nearest station’s frost date and your seed’s own GDU rating.';
  }
  vEl.textContent = vtxt; vEl.hidden = !vtxt;
  $('cmp-note').textContent = 'These counts come from a Wisconsin monthly-average table, from the planting date to the 50% first-fall-frost date for '+fz.zone+' ('+fz.fall50+'). Only the frost date changes with the zone. The table has no April rate, so it starts at May 1. The zone frost dates are approximate: the spring ones run about 13 days earlier than the Madison station median, and the fall ones have not been checked against a station, so a thin margin is a reason to check your station, not a final answer. '+targetLine(m);
}
$('pd-rm').addEventListener('input', function(){ renderGDUCompare(); renderStationGDU(); });

/* ─── DISEASE CARDS ─────────────────────────────────────────────────── */
function renderDiseaseCards(){
  var list = crop==='corn' ? DISEASE_CORN : DISEASE_BEAN;
  $('disease-grid').innerHTML = list.map(function(d){
    return '<div class="info-box red"><strong>'+d.name+'</strong> <span class="risk">'+d.risk+'</span><br>'+d.desc+'</div>';
  }).join('');
}

/* ─── LOCATION ──────────────────────────────────────────────────────── */
var autoBtnHTML = $('pd-auto-btn').innerHTML; // the globe icon, restored after geolocation
$('pd-auto-btn').addEventListener('click', function(){
  if(!navigator.geolocation) return;
  var btn = this; btn.textContent = '...';
  navigator.geolocation.getCurrentPosition(function(pos){
    zipTouched = true;
    userLat = pos.coords.latitude; userLon = pos.coords.longitude; userCounty = ''; userState = '';
    $('pd-loc-display').textContent = 'Location: '+userLat.toFixed(3)+'°N, '+Math.abs(userLon).toFixed(3)+'°W';
    $('pd-zip').value = '';
    btn.innerHTML = autoBtnHTML;
    reverseCounty().then(loadLocal, loadLocal);
  }, function(){ btn.innerHTML = autoBtnHTML; });
});

// Typing a new ZIP/city drops the old coordinates so the next load geocodes what is in the box.
$('pd-zip').addEventListener('input', function(){
  zipTouched = true;
  userLat = null; userLon = null; userCounty = ''; userState = '';
  $('pd-loc-display').textContent = 'ZIP or town in Wisconsin or Minnesota';
});
$('pd-zip').addEventListener('keydown', function(e){ if(e.key === 'Enter'){ e.preventDefault(); $('pd-fetch-btn').click(); } });

var STATE_ABBR = {'Wisconsin':'WI','Minnesota':'MN','Iowa':'IA','Illinois':'IL','Michigan':'MI','North Dakota':'ND','South Dakota':'SD'};
function takeAddress(a){
  a = a || {};
  userCounty = a.county || '';
  var iso = a['ISO3166-2-lvl4'] || '';
  userState = /^US-[A-Z]{2}$/.test(iso) ? iso.slice(3) : (STATE_ABBR[a.state] || '');
}
function geocodeZip(q){
  return fetch('https://nominatim.openstreetmap.org/search?q='+encodeURIComponent(q)+'&countrycodes=us&format=json&addressdetails=1&limit=1')
    .then(function(r){ return r.json(); })
    .then(function(d){
      if(!d || !d[0]) throw new Error('Location not found');
      userLat = parseFloat(d[0].lat); userLon = parseFloat(d[0].lon);
      takeAddress(d[0].address);
      $('pd-loc-display').textContent = 'Location: '+d[0].display_name.split(',').slice(0,2).join(',');
    });
}
function reverseCounty(){
  return fetch('https://nominatim.openstreetmap.org/reverse?lat='+userLat+'&lon='+userLon+'&format=json&zoom=10&addressdetails=1')
    .then(function(r){ return r.json(); }).then(function(d){ takeAddress(d && d.address); });
}

$('pd-fetch-btn').addEventListener('click', function(){
  var zipVal = ($('pd-zip').value || '').trim();
  var btn = this; btn.disabled = true; btn.textContent = 'Loading…';
  setStatus('Fetching…', '');
  var p = (userLat && userLon) ? Promise.resolve() : (zipVal ? geocodeZip(zipVal) : Promise.reject(new Error('Enter a ZIP or town, or use the location button')));
  p.then(loadLocal).catch(function(e){ setStatus('✗ '+e.message, 'err'); })
   .then(function(){ btn.disabled = false; btn.textContent = 'Show my numbers'; });
});
function setStatus(msg, cls){ var el = $('pd-status'); el.textContent = msg; el.className = 'f-status'+(cls?' '+cls:''); }

function loadLocal(){
  if(!userLat || !userLon){ setStatus('No location set', 'err'); return Promise.resolve(); }
  var sec = $('pd-local'); if(sec) sec.hidden = false;
  var where = ($('pd-loc-display').textContent || '').replace(/^Location:\s*/, '');
  $('pd-local-where').textContent = where;
  return Promise.all([fetchSoilTemp(), loadStation(), loadCountyDates()]).then(function(){
    setStatus('✓ Loaded', 'ok');
  });
}

/* ─── NEAREST NOAA STATION (data/planting/<st>.json) ─────────────────── */
var stationFiles = null, station = null, stationMiles = null;
function loadStationFiles(){
  if(stationFiles) return stationFiles;
  stationFiles = Promise.all(['wi','mn'].map(function(st){
    return fetch('/data/planting/'+st+'.json').then(function(r){ return r.ok ? r.json() : null; }).catch(function(){ return null; });
  }));
  return stationFiles;
}
function miles(lat1, lon1, lat2, lon2){
  var R = 3958.8, toR = Math.PI/180;
  var dLat = (lat2-lat1)*toR, dLon = (lon2-lon1)*toR;
  var a = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(lat1*toR)*Math.cos(lat2*toR)*Math.sin(dLon/2)*Math.sin(dLon/2);
  return 2*R*Math.asin(Math.sqrt(a));
}
var MAX_MILES = 75;
function loadStation(){
  var box = $('pd-stn');
  return loadStationFiles().then(function(files){
    var all = [], meta = null;
    files.forEach(function(f){ if(f && f.stations){ meta = meta || f; all = all.concat(f.stations); } });
    if(!all.length){
      station = null;
      box.innerHTML = '<h3>Frost odds at your nearest station</h3><div class="pd-empty"><strong>Station frost dates and heat units load after the first NOAA read.</strong> They come from NOAA’s 1991-2020 station normals and have not been pulled onto this site yet. Until then, the zone averages further down stand in; they run early.</div>';
      renderStationGDU(); return;
    }
    var best = null, bd = 1e9;
    all.forEach(function(s){ var d = miles(userLat, userLon, s.lat, s.lon); if(d < bd){ bd = d; best = s; } });
    if(bd > MAX_MILES){
      station = null;
      box.innerHTML = '<h3>Frost odds at your nearest station</h3><div class="pd-empty"><strong>No NOAA normals station in Wisconsin or Minnesota within '+MAX_MILES+' miles.</strong> This page covers those two states. The nearest is '+esc(best.n)+', '+fmt(bd)+' miles away, too far to stand in for your field.</div>';
      renderStationGDU(); return;
    }
    station = best; stationMiles = bd;
    var sp = best.s32.map(function(x){ return mdOfDoy(doyOfMD(x)); });
    var fa = best.f32.map(function(x){ return mdOfDoy(doyOfMD(x)); });
    var row28 = '';
    if(best.s28 && best.f28){
      var s28 = best.s28.map(function(x){ return mdOfDoy(doyOfMD(x)); }), f28 = best.f28.map(function(x){ return mdOfDoy(doyOfMD(x)); });
      row28 = '<tr><td>Last spring 28°F</td><td>'+s28[0]+'</td><td class="p50">'+s28[1]+'</td><td>'+s28[2]+'</td></tr>'
            + '<tr><td>First fall 28°F</td><td>'+f28[0]+'</td><td class="p50">'+f28[1]+'</td><td>'+f28[2]+'</td></tr>';
    }
    box.innerHTML = '<h3>Frost odds at '+esc(best.n)+'</h3>'
      +'<p class="stn-meta">NOAA normals station '+esc(best.id)+', '+fmt(bd)+' mi from you'+(best.el!=null?', '+fmt(best.el)+' ft':'')+'. 1991-2020.'+(bd>40?' That is a fair distance: low ground and lake effect can move these dates.':'')+'</p>'
      +'<table class="frost-table stn-table"><thead><tr><th></th><th>Early</th><th class="p50">Median</th><th>Late</th></tr></thead><tbody>'
      +'<tr><td>Last spring 32°F</td><td>'+sp[0]+'</td><td class="p50">'+sp[1]+'</td><td>'+sp[2]+'</td></tr>'
      +'<tr><td>First fall 32°F</td><td>'+fa[0]+'</td><td class="p50">'+fa[1]+'</td><td>'+fa[2]+'</td></tr>'+row28
      +'</tbody></table>'
      +'<p class="f-hint">Spring: the last 32°F night comes after the late date 1 year in 10, after the median half the time, and after the early date 9 years in 10. Fall: the first 32°F night comes before the early date 1 year in 10 and before the late date 9 years in 10. NOAA NCEI 1991-2020 normals'+(meta && meta.built_utc ? ', read '+esc(meta.built_utc.slice(0,10)) : '')+'.</p>';
    var mo = new Date().getMonth()+1;
    if(mo >= 7 || mo <= 3){
      $('pd-season').textContent = 'Next spring at '+best.n+': the last 32°F night comes after '+sp[1]+' in half of years and after '+sp[2]+' 1 year in 10. Corn goes in once 2-inch soil holds 50°F.';
    }
    renderStationGDU();
  });
}

// GDD normal between two days of the year (365-day), from the station's 5-day cumulative series.
function stationGdd(s, fromDoy, toDoy){
  var g = s.g; if(!g) return null;
  function cum(d){
    var x = (d - 91) / 5;
    if(x <= 0) return 0;
    var i = Math.floor(x); if(i >= g.length-1) return g[g.length-1];
    return g[i] + (g[i+1]-g[i]) * (x - i);
  }
  return Math.max(0, cum(toDoy) - cum(fromDoy));
}
var PLANT_DATES = [['Apr 20',4,20],['May 1',5,1],['May 10',5,10],['May 20',5,20],['Jun 1',6,1]];
function renderStationGDU(){
  var box = $('pd-stn-gdu'); if(!box) return;
  if(!station || !station.g){
    box.hidden = true; box.innerHTML = ''; return;
  }
  var med = doyOfMD(station.f32[1]), early = doyOfMD(station.f32[0]);
  var m = maturity();
  var mine = $('pd-plant') ? $('pd-plant').value : '';
  var dates = PLANT_DATES.slice();
  var mm = /^\d{4}-(\d{2})-(\d{2})$/.exec(mine || '');
  if(mm){ var md = MONTHS[+mm[1]-1]+' '+(+mm[2]); if(!dates.some(function(d){ return d[0]===md; })) dates.push([md+' (yours)', +mm[1], +mm[2]]); }
  dates.sort(function(a,b){ return doyOf(a[1],a[2]) - doyOf(b[1],b[2]); });
  var rows = dates.map(function(d){
    var from = doyOf(d[1], d[2]);
    var a = from < med ? stationGdd(station, from, med) : 0, b = from < early ? stationGdd(station, from, early) : 0;
    return '<tr'+(/yours/.test(d[0])?' class="mine"':'')+'><td>'+d[0]+'</td><td class="mono">'+fmt(a)+'</td><td class="mono">'+fmt(b)+'</td></tr>';
  }).join('');
  var tgt = m.target!==null
    ? (crop==='corn' ? 'A '+m.rm+'-day hybrid is rated about '+fmt(m.target)+' GDUs to black layer' : 'An MG '+m.rm+' variety needs about '+fmt(m.target)+' GDUs to R8')+' on the reference line below. Your seed company’s own GDU rating is the better number; set it next to these.'
    : targetLine(m);
  box.hidden = false;
  box.innerHTML = '<h3>Heat units before fall frost at '+esc(station.n)+'</h3>'
    +'<div class="pen-wrap"><table class="frost-table gdu-table"><thead><tr><th>Planted</th><th>GDUs to median 32°F ('+mdOfDoy(med)+')</th><th>GDUs to early 32°F, 1 yr in 10 ('+mdOfDoy(early)+')</th></tr></thead><tbody>'+rows+'</tbody></table></div>'
    +'<p class="stn-tgt">'+tgt+'</p>'
    +'<p class="f-hint">Normal growing degree days (base 50°F, capped at 86°F) from NOAA’s 1991-2020 daily normals for this station, added up from the planting date to the frost date. A normal year, not this year. A 32°F night does not always end the season. '+(m.target!==null?targetLine(m):'')+'</p>';
}
if($('pd-plant')) $('pd-plant').addEventListener('change', renderStationGDU);

/* ─── COUNTY FINAL PLANTING DATES (USDA RMA) ─────────────────────────── */
var rmaPromise = null;
function normalizeCountyName(n){
  return String(n||'').toLowerCase()
    .replace(/\s+county$/,'').replace(/\s+parish$/,'').replace(/\s+city$/,'')
    .replace(/^saint\s+/,'st ').replace(/\bst\.\s*/g,'st ')
    .replace(/\./g,'').replace(/[^a-z0-9 ]/g,'').replace(/\s+/g,' ').trim();
}
function loadCountyDates(){
  var box = $('pd-rma');
  rmaPromise = rmaPromise || fetch('/data/rma-planting-dates.json').then(function(r){ return r.ok ? r.json() : null; }).catch(function(){ return null; });
  return rmaPromise.then(function(d){
    var head = '<h3>Your county’s final planting dates</h3>';
    if(!d || !d.counties){ box.innerHTML = head+'<div class="pd-empty">The final planting date file could not be read. RMA’s own lookup: <a href="https://public-rma.fpac.usda.gov/apps/mapviewer/dates" target="_blank" rel="noopener">USDA RMA dates</a>.</div>'; return; }
    var want = normalizeCountyName(userCounty), hit = null;
    if(want && userState){
      for(var f in d.counties){
        var e = d.counties[f];
        if(e.state === userState && (normalizeCountyName(e.county) === want || normalizeCountyName(e.county).replace(/\s+/g,'') === want.replace(/\s+/g,''))){ hit = e; break; }
      }
    }
    if(!hit){
      box.innerHTML = head+'<div class="pd-empty">'+(userCounty ? esc(userCounty)+(userState?', '+esc(userState):'')+' is not in the RMA file this page reads.' : 'Your county did not come back from the location lookup.')+' In Wisconsin and Minnesota the final planting date is May 25 or May 31 for corn and Jun 10 or Jun 15 for soybeans. <a href="https://public-rma.fpac.usda.gov/apps/mapviewer/dates" target="_blank" rel="noopener">Look up your county at USDA RMA</a>.</div>';
      return;
    }
    var cy = d.crop_year, now = new Date(), y = now.getFullYear();
    var past = cy && (y > cy || (y === cy && now.getMonth() >= 6));
    var interp = hit.source && hit.source !== 'RMA';
    box.innerHTML = head
      +'<div class="rma-grid"><div class="rma-c"><div class="rma-l">Corn</div><div class="rma-v">'+esc(hit.corn)+'</div></div>'
      +'<div class="rma-c"><div class="rma-l">Soybeans</div><div class="rma-v">'+esc(hit.soybeans)+(interp?'*':'')+'</div></div></div>'
      +'<p class="f-hint">'+esc(hit.county)+' County, '+esc(hit.state)+'. USDA RMA Revenue Protection final planting dates, '+esc(cy)+' crop year'+(past?'; RMA sets the '+(cy+1)+' dates in its own file':'')+'. '
      +(interp?'*The soybean date in this file was filled from neighboring counties, not read for this county: <a href="'+esc(d.source_url)+'" target="_blank" rel="noopener">check it at RMA</a>. ':'<a href="'+esc(d.source_url)+'" target="_blank" rel="noopener">RMA date lookup</a>. ')
      +'Planting after it cuts the guarantee; the late planting period runs after it.</p>';
  });
}

/* ─── SOIL TEMPERATURE (Open-Meteo) ──────────────────────────────────── */
var lastSoil = null, lastTrend = null;
function runVerdict(){
  if(lastSoil == null) return;
  var soilNum = parseFloat(lastSoil);
  var verdict, cls, noteText;
  // Soil temperature alone said "Plant Now" in August, because nothing here looked at the
  // calendar. Outside the planting window a warm 2-inch reading is not a green light.
  var _mo = new Date().getMonth()+1, _dy = new Date().getDate();
  var _md = _mo*100+_dy;
  var _isBeans = crop !== 'corn';
  // End of the window this page covers: corn Jun 15 (the latest corn final planting date in
  // the RMA file, any state), soybeans Jun 30.
  var _tooLate = _md > (_isBeans?630:615);
  var _tooEarly = _mo < 4;
  // Latest RMA final planting date in any WI or MN county: corn May 31, soybeans Jun 15
  // (data/rma-planting-dates.json: WI/MN corn May 25 or 31, soybeans Jun 10 or 15).
  var _pastFinal = _md > (_isBeans?615:531);
  if(_tooLate || _tooEarly){
    verdict = 'Out of the planting window'; cls = 'wait';
    noteText = _tooLate
      ? 'The soil reading is current, but this is past the '+(_isBeans?'soybean':'corn')+' planting window this page covers for Wisconsin and Minnesota. The yield table shows what late planting costs, and insurance final planting dates are earlier still.'
      : 'Too early in the year for this call to mean anything. Come back once soils are working in spring.';
  }
  else if(soilNum>=55){ verdict='✓ Plant now: soil ideal (55°F or more)'; cls='go'; noteText='Good planting conditions. Go when the field is fit.'; }
  else if(soilNum>=50){ verdict='✓ Acceptable: soil at the threshold (50 to 54°F)'; cls='go'; noteText='Plant if the forecast warms. Watch for a cold rain in the first 24 hours.'; }
  else if(soilNum>=46){ verdict='Wait: soil marginal (46 to 49°F)'; cls='wait'; noteText='Wait 2 to 3 days. Cold soil risks imbibitional chilling and Pythium.'; }
  else { verdict='✗ Do not plant: soil too cold (under 46°F)'; cls='no'; noteText='Big stand and disease risk. Wait for steady warming.'; }
  // Warm soil past the last WI/MN final planting date is not a green light.
  if(_pastFinal && !_tooLate && !_tooEarly && cls==='go'){
    verdict = 'Late: soil ok, check your insurance final planting date'; cls = 'wait';
    noteText = 'Final planting dates are earlier than this in every WI and MN county (RMA): check your county. The yield table shows the loss from planting this late.';
  }
  var _inFinalWeek = _md > (_isBeans?610:525) && !_pastFinal && !_tooLate && !_tooEarly;
  if(_inFinalWeek) noteText += ' Final planting dates in WI and MN are '+(_isBeans?'Jun 10 or Jun 15':'May 25 or May 31')+' (RMA): check your county.';
  if(!_tooLate && !_tooEarly && lastTrend === 'cooling' && cls === 'go') noteText += ' The 5-day model forecast cools, so the "warming trend" part of the 50°F rule is not met.';
  if(!_tooEarly) noteText += ' The verdict uses the 3-day mean of the weather model’s hourly soil temperature at 6 cm (~2 in), not a probe reading.';
  $('st-verdict-wrap').innerHTML = '<div class="st-verdict '+cls+'">'+verdict+'</div>';
  $('st-note').textContent = noteText;
}

function fetchSoilTemp(){
  // Open-Meteo forecast-model soil temperature at 6 cm (~2 in): hourly, the past 3 days and
  // 6 forecast days, in Fahrenheit (temperature_unit applies to soil temperature too), local
  // time. The page's rule is 50°F for 3 days with a warming trend, so the verdict uses the mean
  // of the last 72 hourly values up to the current hour, and the trend line the forecast days.
  var url = 'https://api.open-meteo.com/v1/forecast'
    +'?latitude='+userLat+'&longitude='+userLon
    +'&current=temperature_2m'
    +'&hourly=soil_temperature_6cm&past_days=3&forecast_days=6'
    +'&temperature_unit=fahrenheit&timezone=auto';
  return fetch(url).then(function(r){ return r.ok ? r.json() : null; }).then(function(data){
    if(!data || !data.current) throw new Error('Weather data unavailable');
    var cur = data.current;
    var air = cur.temperature_2m!=null ? cur.temperature_2m.toFixed(1) : null;
    var hr = data.hourly || {}, ht = hr.time || [], hv = hr.soil_temperature_6cm || [];
    var curHour = String(cur.time||'').slice(0,13); // "YYYY-MM-DDTHH"
    var win = [];
    for(var i=0;i<ht.length;i++){ if(curHour && String(ht[i]).slice(0,13) <= curHour) win.push(hv[i]); }
    win = win.slice(-72);
    var vals = win.filter(function(v){ return v!=null && isFinite(v); });
    var soil2in = null, soilWhy = '';
    if(!curHour) soilWhy = 'The weather model did not say what hour it is at this location, so the last 3 days cannot be picked out.';
    else if(vals.length < 60) soilWhy = 'Only '+vals.length+' of the last 72 hourly soil readings came back (60 needed for a 3-day mean).';
    else soil2in = (vals.reduce(function(a,b){ return a+b; },0)/vals.length).toFixed(1);
    $('st-2in').textContent = soil2in!=null ? soil2in+'°F' : '-';
    $('st-2in-sub').textContent = soil2in!=null ? '3-day mean ('+vals.length+' h)' : '3-day mean unavailable';
    $('st-air').textContent = air ? air+'°F' : '-';
    var asof = $('st-asof');
    if(asof && curHour){ var h = +curHour.slice(11,13); asof.textContent = 'Model run read '+MONTHS[+curHour.slice(5,7)-1]+' '+(+curHour.slice(8,10))+', '+((h%12)||12)+' '+(h<12?'am':'pm')+' local time'; }
    // Forecast: daily means of the hours after the current hour, local days, 20+ hours each.
    var days = {}, order = [];
    for(var j=0;j<ht.length;j++){
      var t = String(ht[j]); if(!curHour || t.slice(0,13) <= curHour) continue;
      var v = hv[j]; if(v==null || !isFinite(v)) continue;
      var dk = t.slice(0,10); if(!days[dk]){ days[dk] = []; order.push(dk); } days[dk].push(v);
    }
    var fc = order.filter(function(k){ return days[k].length >= 20; }).slice(0,5).map(function(k){
      return {k:k, v: days[k].reduce(function(a,b){ return a+b; },0)/days[k].length};
    });
    var tr = $('st-trend');
    lastTrend = null;
    if(tr){
      if(fc.length >= 3 && soil2in != null){
        var diff = fc[fc.length-1].v - parseFloat(soil2in);
        lastTrend = diff >= 2 ? 'warming' : diff <= -2 ? 'cooling' : 'steady';
        tr.innerHTML = '<span class="tr-l">Next '+fc.length+' days (model, daily mean):</span> '
          + fc.map(function(f){ return '<span class="tr-d"><b>'+Math.round(f.v)+'°</b><i>'+MONTHS[+f.k.slice(5,7)-1]+' '+(+f.k.slice(8,10))+'</i></span>'; }).join('')
          + ' <span class="tr-w tr-'+lastTrend+'">'+lastTrend+'</span>';
      } else tr.textContent = 'No 5-day soil forecast came back for this location.';
    }
    var badge = $('st-badge'); if(badge) badge.style.display = 'inline-flex';
    // Verdict only from a real 3-day mean. No data, no verdict: a missing value must never
    // become 0°F and print "Do Not Plant" under a display showing a dash.
    if(soil2in == null){
      lastSoil = null;
      $('st-verdict-wrap').innerHTML = '<div class="st-verdict wait">No soil verdict</div>';
      $('st-note').textContent = soilWhy+' No 3-day mean, no verdict. Try again in an hour or check a nearby ZIP.';
      return;
    }
    lastSoil = soil2in;
    runVerdict();
  }).catch(function(e){
    $('st-note').textContent = 'Soil temperature did not load ('+e.message+'). Try again in a minute.';
  });
}

init();
})();
