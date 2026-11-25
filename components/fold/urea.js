/* fold/urea.js: the urea loss tab of /spray (was the inline script of /urea until Nov 11, 2026).
 * Loaded by components/page-tabs.js the first time the tab opens. Its ids that /spray also uses carry u-. */
(function(){
var P=document.getElementById('p-urea')||document;
P.querySelectorAll('.faq-a').forEach(function(a){a.setAttribute('aria-hidden','true');});
document.getElementById('u-faq-list').addEventListener('click',function(e){
  var btn=e.target.closest('.faq-q');
  if(!btn)return;
  var item=btn.closest('.faq-item');
  var open=item.classList.contains('open');
  P.querySelectorAll('.faq-item').forEach(function(x){x.classList.remove('open');x.querySelector('.faq-q').setAttribute('aria-expanded','false');x.querySelector('.faq-a').setAttribute('aria-hidden','true');});
  if(!open){item.classList.add('open');btn.setAttribute('aria-expanded','true');item.querySelector('.faq-a').setAttribute('aria-hidden','false');}
});

var prefersReducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
if(!prefersReducedMotion&&'IntersectionObserver' in window){var io=new IntersectionObserver(function(e){e.forEach(function(x){if(x.isIntersecting){x.target.classList.add('vis');io.unobserve(x.target);}});},{threshold:.08});P.querySelectorAll('.fade-up').forEach(function(el){io.observe(el);});}
else{P.querySelectorAll('.fade-up').forEach(function(el){el.classList.add('vis');});}

var WX_ICONS={0:'<svg class="ic-sp" aria-hidden="true"><use href="#sp-sun"/></svg>',1:'<svg class="ic-sp" aria-hidden="true"><use href="#sp-cloud-sun"/></svg>',2:'<svg class="ic-sp" aria-hidden="true"><use href="#sp-cloud-sun"/></svg>',3:'<svg class="ic-sp" aria-hidden="true"><use href="#sp-cloud"/></svg>',45:'<svg class="ic-sp" aria-hidden="true"><use href="#sp-cloud-fog"/></svg>',51:'<svg class="ic-sp" aria-hidden="true"><use href="#sp-cloud-sun-rain"/></svg>',53:'<svg class="ic-sp" aria-hidden="true"><use href="#sp-cloud-rain"/></svg>',55:'<svg class="ic-sp" aria-hidden="true"><use href="#sp-cloud-rain"/></svg>',61:'<svg class="ic-sp" aria-hidden="true"><use href="#sp-cloud-sun-rain"/></svg>',63:'<svg class="ic-sp" aria-hidden="true"><use href="#sp-cloud-rain"/></svg>',65:'<svg class="ic-sp" aria-hidden="true"><use href="#sp-cloud-lightning"/></svg>',71:'<svg class="ic-sp" aria-hidden="true"><use href="#sp-cloud-snow"/></svg>',73:'<svg class="ic-sp" aria-hidden="true"><use href="#sp-snowflake"/></svg>',75:'<svg class="ic-sp" aria-hidden="true"><use href="#sp-snowflake"/></svg>',80:'<svg class="ic-sp" aria-hidden="true"><use href="#sp-cloud-sun-rain"/></svg>',81:'<svg class="ic-sp" aria-hidden="true"><use href="#sp-cloud-rain"/></svg>',82:'<svg class="ic-sp" aria-hidden="true"><use href="#sp-cloud-lightning"/></svg>',95:'<svg class="ic-sp" aria-hidden="true"><use href="#sp-cloud-lightning"/></svg>'};

// ─────────────────────────────────────────────────────────────────
// RISK SCORING FUNCTIONS — scientific basis documented inline
// ─────────────────────────────────────────────────────────────────

// Temperature risk — urease enzyme kinetics
// Values reflect exponential activity curve with practical calibration:
// <32°F: enzyme very slow (not zero: Montana State Soil Scoop, urea broadcast Oct-Apr averaged 18%, up to 44% loss);
// <40°F: slow; <50°F: low-moderate. The caps in applyTempGate are a design choice, not zero loss.
// 50-80°F: steep climb matching Q10≈2 per 10°C enzyme kinetics;
// 80°F+: near-maximum enzyme activity, rapid loss possible within hours
var UREA_CUR=null,UREA_DAILY=null,UREA_POP=null;
function phMult(){var e=document.getElementById('in-ph');return e?(parseFloat(e.value)||1):1;}
function tillMult(){var e=document.getElementById('in-till');return e?(parseFloat(e.value)||1):1;}
function soilEntered(){var e=document.getElementById('in-soil');return !!(e&&e.value!==''&&!isNaN(parseFloat(e.value)));}
function tempDesc(tempF){return tempF<32?'Below freezing. Urease works very slowly, so loss starts slowly, but Montana State trials averaged 18% and up to 44% loss from urea broadcast between October and April. NBPT still helps.':tempF<40?'Near-frozen. Urease activity is slow, so loss starts slowly; it is not zero.':tempF<50?'Cold. Urease activity is low, so loss is slow while it stays cold. Surface urea is still exposed until rain or tillage moves it in, and loss picks up as soil warms and dries. NBPT still helps if it will sit on the surface.':tempF<65?'Moderate enzyme activity. A urease inhibitor (NBPT) is an option, especially on no-till or high-pH fields.':tempF<80?'High enzyme activity. Losses can begin within hours; a urease inhibitor (NBPT) would slow them.':'Extreme enzyme activity. Urease near peak efficiency. Significant losses likely without protection.';}
function soilTempDesc(tempF){return 'Using your soil-surface probe reading instead of air temperature. '+(tempF<50?'Low urease activity.':tempF<65?'Moderate enzyme activity; a urease inhibitor (NBPT) is an option.':tempF<80?'High enzyme activity; a urease inhibitor (NBPT) would slow the loss.':'Extreme enzyme activity; losses likely without protection.');}
// Max hourly precipitation chance over the next 48 h (NWS forecast grid, hourly), from the current hour.
// Falls back to the current hour's chance when the hourly array is missing.
function popNext48(d){var h=d&&d.hourly,c=d&&d.current||{};if(h&&h.time&&h.precipitation_probability){var now=String(c.time||'').slice(0,13),start=0;for(var i=0;i<h.time.length;i++){if(String(h.time[i]).slice(0,13)<=now)start=i;else break;}var mx=null;for(var j=start;j<Math.min(h.time.length,start+48);j++){var v=h.precipitation_probability[j];if(v!=null&&(mx==null||v>mx))mx=v;}if(mx!=null)return{pop:mx,h48:true};}return{pop:c.precipitation_probability||0,h48:false};}
// Postal code for a state name from the geocoder. An unknown name gets no code, never a guess.
var US_STATE_CODES={'Alabama':'AL','Alaska':'AK','Arizona':'AZ','Arkansas':'AR','California':'CA','Colorado':'CO','Connecticut':'CT','Delaware':'DE','District of Columbia':'DC','Florida':'FL','Georgia':'GA','Hawaii':'HI','Idaho':'ID','Illinois':'IL','Indiana':'IN','Iowa':'IA','Kansas':'KS','Kentucky':'KY','Louisiana':'LA','Maine':'ME','Maryland':'MD','Massachusetts':'MA','Michigan':'MI','Minnesota':'MN','Mississippi':'MS','Missouri':'MO','Montana':'MT','Nebraska':'NE','Nevada':'NV','New Hampshire':'NH','New Jersey':'NJ','New Mexico':'NM','New York':'NY','North Carolina':'NC','North Dakota':'ND','Ohio':'OH','Oklahoma':'OK','Oregon':'OR','Pennsylvania':'PA','Rhode Island':'RI','South Carolina':'SC','South Dakota':'SD','Tennessee':'TN','Texas':'TX','Utah':'UT','Vermont':'VT','Virginia':'VA','Washington':'WA','West Virginia':'WV','Wisconsin':'WI','Wyoming':'WY','Puerto Rico':'PR','Guam':'GU','U.S. Virgin Islands':'VI'};
function stateCode(name){return (name&&US_STATE_CODES[String(name).trim()])||'';}
// Rain term for the headline score. Uses the forecast AMOUNT for today and tomorrow when one is
// forecast, with the same bands as the 5-day strip (rainRiskDaily): 0.5 in or more counts as
// incorporating rain, 0.25 to 0.5 as partial, and a light shower under 0.25 as the worst case (wets the
// granules without moving them in), exactly as the strip scores it. With no amount forecast, the 48-hour
// chance is used as before (rainRisk). Returns {rR, inches, day}.
function rainNow(){
  var pop=UREA_POP?UREA_POP.pop:((UREA_CUR&&UREA_CUR.precipitation_probability)||0);
  var d=UREA_DAILY,best=null;
  if(d&&d.precipitation_sum){for(var i=0;i<Math.min(2,d.precipitation_sum.length);i++){var mm=d.precipitation_sum[i];if(mm!=null&&(best==null||mm>best.mm))best={mm:mm,i:i};}}
  if(best&&best.mm/25.4>=0.01){var inches=best.mm/25.4;var dp=d.precipitation_probability_max&&d.precipitation_probability_max[best.i]!=null?d.precipitation_probability_max[best.i]:pop;return {rR:rainRiskDaily(dp,best.mm),inches:inches,day:best.i===0?'today':'tomorrow',pop:pop,chance:dp};}
  return {rR:rainRisk(pop),inches:null,day:null,pop:pop};
}
function rainLine(rn){
  if(rn.inches==null)return '';
  var amt=rn.inches.toFixed(2)+' in '+rn.day;
  return rn.inches>=0.5?' The forecast has '+amt+'; if it comes, that is enough to move urea into the soil, and the score counts it.':rn.inches>=0.25?' The forecast has '+amt+', a partial incorporation at best, and the score counts it that way.':' The forecast has '+amt+', a light shower: it wets the granules without moving them in, the worst case, and the score counts it that way.';
}
function setRainFactor(rn){
  var pop=rn.pop,rR=rn.rR;
  if(rn.inches!=null){
    var amt=rn.inches.toFixed(2)+' in '+rn.day;
    setFactor('rain',amt,(rn.inches>=0.5?'Forecast amount for '+rn.day+' is ½ inch or more: enough to incorporate urea on bare or tilled soil, if it comes. Spread before it, not after.':rn.inches>=0.25?'Forecast amount for '+rn.day+' is ¼ to ½ inch: partial incorporation at best. Some of the urea may stay near the surface.':'Forecast amount for '+rn.day+' is under ¼ inch: a light shower wets the granules and starts the loss without moving urea into the soil, the worst case.')+' Highest 48-hour chance: '+pop+'%.',rR,rR);
    return;
  }
  var rDesc=(UREA_POP&&UREA_POP.h48?'Highest hourly rain chance over the next 48 hours: chance only, not amount. ':'Rain chance for this hour only, not amount. ')+(pop<20?'Little rain expected: urea stays on the surface through the two to three weeks when most loss happens.':pop<40?'Some rain possible but unlikely. Under ¼" would activate urea without incorporating it, the worst case.':pop<60?'Rain likely, but amount is what matters: ½"+ incorporates, less can accelerate loss. Check the 5-day totals below.':'High rain chance. If it verifies ½"+, urea gets incorporated, good timing. Confirm the total in the 5-day strip.');
  setFactor('rain',UREA_POP&&UREA_POP.h48?pop+'% max, 48 h':pop+'% this hour',rDesc,rR,rR);
}
function appendRainLine(rn){var v=document.getElementById('risk-verdict');var l=rainLine(rn);if(v&&l)v.textContent+=l;}
// Soil surface (2026-10-16). Montana State EB0209, Table 2: moist soil or heavy dew is high risk, dry soil lower
// risk, "with soil moisture likely being the most important risk condition"; urea on a dry surface "can remain
// undissolved for at least a week with no volatilization loss" (Fig. 3); trial losses were 30 to 44% on wet or snowy
// surfaces that dried slowly against 10 to 20% on a dry surface with only light rain after. The score is multiplied
// by 0.6 on a dry surface, 1.0 moist, 1.2 wet: an AGSIST rule of thumb set from those ranges, not a model.
// 2026-10-29: the NWS forecast grid that replaced Open-Meteo carries no soil moisture, so this reads none and the
// surface comes from the reader's pick. Kept for a source that gives it: 0 to 1 cm soil moisture (m3/m3) is dry under 0.15, moist
// 0.15 to 0.30, wet 0.30 and over (rough bands: near wilting point and near field capacity for a loam). What the
// farmer picks for the surface right now overrides it. No reading and no pick: multiplier 1, said so.
var UREA_HOURLY=null;
var SURF={dry:{mult:0.6,lab:'Dry'},moist:{mult:1.0,lab:'Moist'},wet:{mult:1.2,lab:'Wet'}};
function surfClass(sm){if(sm==null||isNaN(sm))return null;return sm<0.15?'dry':sm<0.30?'moist':'wet';}
function surfNow(){
  var e=document.getElementById('in-surf'),pick=e&&SURF[e.value]?e.value:null;
  var sm=null,h=UREA_HOURLY,c=UREA_CUR||{};
  if(h&&h.time&&h.soil_moisture_0_to_1cm){var now=String(c.time||'').slice(0,13),idx=-1;for(var i=0;i<h.time.length;i++){if(String(h.time[i]).slice(0,13)<=now)idx=i;else break;}if(idx>=0){var v=h.soil_moisture_0_to_1cm[idx];if(typeof v==='number'&&isFinite(v))sm=v;}}
  var cls=pick||surfClass(sm);
  return{cls:cls,sm:sm,picked:!!pick,mult:cls?SURF[cls].mult:1};
}
function surfDay(date){
  var h=UREA_HOURLY;if(!h||!h.time||!h.soil_moisture_0_to_1cm||!date)return{cls:null,mult:1};
  var t=0,n=0;for(var i=0;i<h.time.length;i++){if(String(h.time[i]).slice(0,10)===date){var v=h.soil_moisture_0_to_1cm[i];if(typeof v==='number'&&isFinite(v)){t+=v;n++;}}}
  var cls=n?surfClass(t/n):null;return{cls:cls,mult:cls?SURF[cls].mult:1};
}
function renderSurf(sf){
  var fs=document.getElementById('fs-surf'),fv=document.getElementById('fv-surf'),fd=document.getElementById('fd-surf'),fb=document.getElementById('fb-surf');
  var src=sf.picked?'your pick':(sf.sm!=null?'forecast 0 to 1 cm soil moisture '+sf.sm.toFixed(2)+' m³/m³, a model estimate':'');
  var c=!sf.cls?{cls:'note',lab:'NOT IN FORECAST',val:'Pick it above',w:50,col:'var(--risk-mod)',d:'This forecast has no soil moisture for your spot, so the score leaves the surface out (multiplier 1). Pick what you see above. Montana State calls surface moisture likely the most important risk condition.'}
    :sf.cls==='dry'?{cls:'low',lab:'LOWER (dry)',val:'Dry ('+src+')',w:25,col:'var(--risk-low)',d:'A dry surface: Montana State found urea on dry soil can sit undissolved for a week or more with no loss, and trial losses were 10 to 20% on a dry surface with only light rain after. Dew or a light shower starts it. The score multiplies by 0.6 here, a rule of thumb.'}
    :sf.cls==='moist'?{cls:'hig',lab:'HIGH (moist)',val:'Moist ('+src+')',w:65,col:'var(--risk-high)',d:'Moist soil or heavy dew dissolves the granule and starts the loss: Montana State lists it first among high-risk conditions. The score multiplies by 1.0 here.'}
    :{cls:'ext',lab:'HIGHEST (wet)',val:'Wet ('+src+')',w:85,col:'var(--risk-extreme)',d:'A wet or snowy surface that dries slowly gave the largest losses in Montana State trials, 30 to 44% of the N. Avoid it unless half an inch of rain or tillage will move the urea in. The score multiplies by 1.2 here, a rule of thumb.'};
  if(fs){fs.className='factor-score '+c.cls;fs.textContent=c.lab;}
  if(fv)fv.textContent=c.val;
  if(fd)fd.textContent=c.d;
  if(fb){fb.style.width=c.w+'%';fb.style.background=c.col;}
}
function appendSurfLine(sf,tempF){
  var v=document.getElementById('risk-verdict');if(!v||!sf.cls||tempF<32)return;
  var how=sf.picked?'You picked a ':'The forecast reads a ';
  v.textContent+=sf.cls==='dry'?' '+how+'dry surface: urea on dry soil can sit undissolved for a week or more with little loss (Montana State), so the score is lower; dew or a light shower starts it.'
    :sf.cls==='wet'?' '+how+'wet surface: the worst start, 30 to 44% loss in Montana State trials when it dried slowly.'
    :' '+how+'moist surface: the granule will dissolve and start losing.';
}
function soilTempOverride(airF){var e=document.getElementById('in-soil');if(e&&e.value!==''){var v=parseFloat(e.value);if(!isNaN(v))return Math.round(v);}return airF;}
function saveFieldInputs(){try{var o={ph:(document.getElementById('in-ph')||{}).value,till:(document.getElementById('in-till')||{}).value,soil:(document.getElementById('in-soil')||{}).value};localStorage.setItem('agsist-urea-field',JSON.stringify(o));}catch(e){}}
function restoreFieldInputs(){try{var s=localStorage.getItem('agsist-urea-field');if(!s)return;var o=JSON.parse(s);var p=document.getElementById('in-ph');if(p&&o.ph)p.value=o.ph;var t=document.getElementById('in-till');if(t&&o.till)t.value=o.till;var so=document.getElementById('in-soil');if(so&&o.soil!=null)so.value=o.soil;}catch(e){}}
// Montana State EB0209: 0.5 in of water within two days moves urea into bare or tilled soil; on residue it
// takes about 1.5 in. When that much is forecast for today or tomorrow, the advice is to spread before it,
// with the chance shown, never "wait for a wetter window". Below freezing the cold-ground advice stands.
function rainAdvice(rn,tempF){
  if(tempF<32||rn.inches==null||rn.inches<0.5)return;
  var till=tillMult(),noTill=till>=1.5,need=noTill?1.5:0.5,amt=rn.inches.toFixed(2)+' in forecast '+(rn.day==='today'?'today':'for tomorrow');
  var ch=(rn.chance!=null&&rn.chance!==undefined)?' ('+rn.chance+'% chance)':'';
  var v=document.getElementById('risk-verdict'),rh=document.getElementById('u-rec-head'),rt=document.getElementById('u-rec-text'),rb=document.getElementById('u-rec-box');
  var head,txt;
  if(rn.inches>=need){
    head='Spread Before the Rain';
    txt='Spread before the rain: '+amt+ch+'. '+(noTill?'That is about the 1.5 in Montana State says it takes to move urea off residue':'On bare or tilled soil, half an inch moves urea into the soil (Montana State)')+', if it comes. If it misses, the urea sits exposed; NBPT covers that.'+(till===1?' Heavy residue needs about 1.5 in.':'');
  } else {
    head='Partial on Residue';
    txt=amt.charAt(0).toUpperCase()+amt.slice(1)+ch+'. On bare or tilled soil that would move urea in, but on heavy residue Montana State puts the need at about 1.5 in within two days, so count it as partial. Spread before it with NBPT, or wait for a bigger rain.';
  }
  if(v)v.textContent=txt;
  if(rh){rh.className='rec-head low';rh.textContent=head;}
  if(rt)rt.textContent=txt;
  if(rb)rb.className='rec-box low';
}
// The residue card follows the tillage picker.
function renderResidue(){
  var t=tillMult(),fs=document.getElementById('fs-res'),fv=document.getElementById('fv-res'),fd=document.getElementById('fd-res'),fb=document.getElementById('fb-res');
  var c=t>=1.5?{cls:'hig',lab:'HIGH (no-till)',val:'Higher risk',w:75,col:'var(--risk-high)',d:'Crop residue holds urease enzyme, and urea sitting on a corn stalk never reaches soil. Montana State says it takes about 1.5 in of water within two days to move urea off residue, against 0.5 in on bare or tilled soil. The score multiplies by 1.5 on no-till, a rule of thumb.'}
    :t<1?{cls:'low',lab:'LOWER (tilled)',val:'Lower risk',w:30,col:'var(--risk-low)',d:'Bare, tilled ground: little residue holding urea on the surface, and half an inch of rain moves urea into the soil (Montana State). The score multiplies by 0.7 here, a rule of thumb.'}
    :{cls:'mod',lab:'NOT SET',val:'Pick your tillage',w:50,col:'var(--risk-mod)',d:'Pick your tillage above. Residue holds urease and keeps urea off the soil: Montana State puts the water needed to move urea in at about 1.5 in on residue, against 0.5 in on bare or tilled soil.'};
  if(fs){fs.className='factor-score '+c.cls;fs.textContent=c.lab;}
  if(fv)fv.textContent=c.val;
  if(fd)fd.textContent=c.d;
  if(fb){fb.style.width=c.w+'%';fb.style.background=c.col;}
}
function renderScore(){if(!UREA_CUR)return;var c=UREA_CUR,airF=Math.round(c.temperature_2m),tempF=soilTempOverride(airF);var tR=tempRisk(tempF),hR=humidRisk(c.relative_humidity_2m),wR=windRisk(Math.round(c.wind_speed_10m)),rn=rainNow(),rR=rn.rR,sf=surfNow();updateGauge(Math.round(Math.min(100,compositeScore(tR,hR,wR,rR)*phMult()*tillMult()*sf.mult)),tempF);appendSurfLine(sf,tempF);appendRainLine(rn);rainAdvice(rn,tempF);renderResidue();renderSurf(sf);if(tempF!==airF){setFactor('temp',tempF+'°F soil',soilTempDesc(tempF),tR,tR);}else{setFactor('temp',airF+'°F',tempDesc(airF),tR,tR);}if(UREA_DAILY)buildForecastStrip(UREA_DAILY,phMult(),tillMult());}
function tempRisk(f){
  if(f<32)return 2;
  if(f<40)return 5;
  if(f<50)return 15;
  if(f<60)return 30;
  if(f<70)return 50;
  if(f<80)return 72;
  if(f<90)return 88;
  return 98;
}

// Humidity/surface moisture risk
// Peak risk at 50-70% RH: moist enough to dissolve urea and activate enzyme,
// but not wet enough to move N into the soil.
// FIX v2: >85% RH returns 45 (was 35) — saturated air still correlates with
// wet surface conditions where volatilization continues; dilution effect is
// partial, not a strong protective factor.
// Source: Bremner & Mulvaney 1978; IPNI Nitrogen in Crop Production.
function humidRisk(h){
  if(h<30)return 25;
  if(h<50)return 45;
  if(h<70)return 75;
  if(h<85)return 60;
  return 45; // FIX v2: was 35 — saturated surface still has active urease
}

// Wind risk — monotonically increasing
// Wind removes the NH3 concentration gradient above the soil surface,
// maintaining the chemical driving force for N escape.
// Even light winds (3-5 mph) fully remove the boundary layer.
// Source: Hargrove 1988 (NH3 volatilization transport); FAO fertilizer guides.
function windRisk(mph){
  if(mph<2)return 15;
  if(mph<5)return 35;
  if(mph<10)return 60;
  if(mph<15)return 78;
  return 90;
}

// Rain risk (current conditions) — uses precipitation probability only
// because forecast amounts aren't available for the current period.
// Note: This is a conservative proxy. High probability still may not mean ≥½".
// For daily strip, use rainRiskDaily() which incorporates precipitation_sum.
// Current-conditions rain uses probability only — amount is unknown, so this
// cannot confirm the ½" incorporation that would actually stop volatilization.
// It never drops to "low": a high chance of a trace shower is the worst case,
// not a safe one. The 5-day strip (rainRiskDaily) uses real precip totals and
// is the authority — this stays in the uncertain/moderate band.
function rainRisk(pop48h){
  if(pop48h>=70)return 45;
  if(pop48h>=50)return 52;
  if(pop48h>=30)return 60;
  return 70;
}

// Rain risk for daily forecast strip — uses actual forecast precipitation totals
// ½" (12.7mm) = incorporation threshold: urea moves below enzyme contact zone
// ¼" (6.35mm) = danger zone: activates granule WITHOUT incorporating
// Source: Hargrove 1988; Ferguson et al. 1984; multiple extension N management guides
function rainRiskDaily(pop, precipMm){
  var precipInches=precipMm/25.4;
  if(precipInches>=0.5)return 8;      // incorporation rain — volatilization risk removed
  if(precipInches>=0.25)return 35;    // partial incorporation possible — meaningful risk reduction
  if(precipInches>0)return 88;        // WORST case: dissolves granules and activates enzyme without incorporating
  // No forecast precip — fall back to probability, using the same bands as rainRisk().
  // Amount unknown, so a high chance never drops to low, and risk only falls as the chance rises.
  if(pop>=70)return 45;
  if(pop>=50)return 52;
  if(pop>=30)return 60;
  return 70;                          // dry window — extended exposure; loss builds as dew cycles dissolve granules
}

function compositeScore(tR,hR,wR,rR){
  // Weights: temp 35% (primary driver), humid 25%, wind 20%, rain 20%
  return Math.round(tR*0.35+hR*0.25+wR*0.20+rR*0.20);
}

// One forecast-strip day. A confirmed incorporating rain (>=0.5") sets the day score to the
// rain value (8) directly — temperature no longer matters once the urea is in the soil.
function dayRisk(tMax,tMin,pop,precipMm,ph,till,surf){
  if(tMax==null||tMin==null||isNaN(tMax)||isNaN(tMin))return null;
  var tAvg=(tMax+tMin)/2,rR=rainRiskDaily(pop,precipMm);
  var score=precipMm/25.4>=0.5?rR:Math.round(Math.min(100,(tempRisk(tAvg)*0.55+rR*0.45)*(ph||1)*(till||1)*(surf||1)));
  var gated=applyTempGate(score,tAvg);
  return{score:score,gated:gated,level:scoreToLevel(gated),tAvg:tAvg};
}

function applyTempGate(score,tempF){
  // Temperature gate: enzyme activity limits maximum possible score at cold temps
  if(tempF<32)return Math.min(score,8);
  if(tempF<40)return Math.min(score,22);
  if(tempF<50)return Math.min(score,40);
  return score;
}

function scoreToLevel(s){if(s<30)return'low';if(s<55)return'moderate';if(s<75)return'high';return'extreme';}
(function(){var up=document.getElementById('urea-price-line');function letGo(){if(up)up.classList.remove('up-wait');}
try{(window.AgFertPick?AgFertPick.load():fetch('/data/fertilizer-prices.json').then(function(r){return r.ok?r.json():null;})).then(function(d){
  letGo();var el=up;if(!el||!d||!d.prices)return;
  var u=d.prices.filter(function(p){return p.key==='urea';})[0];
  if(!u||typeof u.price!=='number'||!(u.price>0)||!u.as_of)return;
  var when=new Date(u.as_of+'T12:00:00Z').toLocaleDateString('en-US',{timeZone:'UTC',month:'short',day:'numeric'});
  var nPct=parseFloat(String(u.symbol||'').split('-')[0]);if(!(nPct>0))return;
  var perN=(u.price/(2000*nPct/100)).toFixed(2);
  var src=u.src_label||('co-op cash price, posted '+when);
  el.innerHTML='Looking for the price? Urea: <strong>$'+Math.round(u.price)+'/ton</strong>, '+src+'. $'+Math.round(u.price)+' / ('+'2,000 lb x '+nPct+'% N) = about $'+perN+' per lb N. Call to confirm. <a href="/fertilizer">All fertilizer prices</a>.';
  el.hidden=false;}).catch(letGo);}catch(e){letGo();}})();
/* Cheapest N per lb, named from the posted co-op prices (data/fertilizer-prices.json), straight N
   products only (N-0-0: urea, anhydrous, UAN). Was a fixed line saying urea is lowest cost per lb N;
   at the site's own posted prices anhydrous is (accuracy pass, Oct 17). Nothing shown without prices. */
function cheapestN(d){
  var best=null;
  ((d&&d.prices)||[]).forEach(function(p){var m=/^(\d+)-0-0$/.exec(String(p.symbol||''));
    if(!m||p.unit!=='$/ton'||typeof p.price!=='number'||!(p.price>0)||!p.as_of)return;
    var per=p.price/(2000*(+m[1])/100);if(!best||per<best.per)best={name:p.name,per:per,as_of:p.as_of};});
  return best;
}
(function(){try{(window.AgFertPick?AgFertPick.load():fetch('/data/fertilizer-prices.json').then(function(r){return r.ok?r.json():null;})).then(function(d){
  var el=document.getElementById('urea-cheapest-n'),b=cheapestN(d);if(!el||!b)return;
  var when=new Date(b.as_of+'T12:00:00Z').toLocaleDateString('en-US',{timeZone:'UTC',month:'short',day:'numeric'});
  el.textContent=' At posted co-op prices (as of '+when+'), the cheapest N per lb is '+b.name.toLowerCase()+', about $'+b.per.toFixed(2)+'.';
  el.hidden=false;}).catch(function(){});}catch(e){}})();
function scoreToLabel(s){var l=scoreToLevel(s);return{low:'Low Risk',moderate:'Moderate Risk',high:'High Risk',extreme:'Extreme Risk'}[l];}
function riskColor(level){return{low:'var(--risk-low)',moderate:'var(--risk-mod)',high:'var(--risk-high)',extreme:'var(--risk-extreme)'}[level]||'var(--risk-mod)';}
function levelIcon(level){return{low:'<svg class="ic-sp" aria-hidden="true"><use href="#sp-circle-check"/></svg>',moderate:'<svg class="ic-sp" aria-hidden="true"><use href="#sp-triangle-alert"/></svg>',high:'<svg class="ic-sp" aria-hidden="true"><use href="#sp-triangle-alert"/></svg>',extreme:'<svg class="ic-sp" aria-hidden="true"><use href="#sp-octagon-alert"/></svg>'}[level]||'';}
function levelAbbr(level){return level.toUpperCase().substring(0,3);}

function setFactor(id,val,desc,score,pct){
  var level=scoreToLevel(score);
  var labelAbbr={low:'low',moderate:'mod',high:'hig',extreme:'ext'};
  var labels={low:'LOW',moderate:'MOD',high:'HIGH',extreme:'EXTREME'};
  var el=document.getElementById('fv-'+id);
  var dl=document.getElementById('fd-'+id);
  var sl=document.getElementById('fs-'+id);
  var bl=document.getElementById('fb-'+id);
  var fa=document.getElementById('f-'+id);
  if(el)el.textContent=val;
  if(dl)dl.textContent=desc;
  if(sl){sl.textContent=labels[level];sl.className='factor-score '+labelAbbr[level];}
  if(bl){bl.style.width=pct+'%';bl.style.background=riskColor(level);}
  if(fa){
    if(level==='high'||level==='extreme')fa.style.borderColor='rgba(240,96,96,.2)';
    else if(level==='low')fa.style.borderColor='rgba(62,207,110,.18)';
    else fa.style.borderColor='rgba(230,176,66,.2)';
  }
}

function updateGauge(rawScore,tempF){
  var gatedScore=applyTempGate(rawScore,tempF);
  var level=scoreToLevel(gatedScore);
  var color=riskColor(level);
  var circumference=236;
  var offset=circumference-(circumference*gatedScore/100);
  var fill=document.getElementById('gauge-fill');
  var num=document.getElementById('gauge-num');
  var badge=document.getElementById('risk-badge');
  var verdict=document.getElementById('risk-verdict');
  var panel=document.getElementById('risk-panel');
  var banner=document.getElementById('tg-banner');
  var tgIcon=document.getElementById('tg-icon');
  var tgText=document.getElementById('tg-text');
  if(fill){fill.style.strokeDashoffset=offset;fill.style.stroke=color;}
  if(num){num.textContent=gatedScore;num.style.color=color;}
  if(badge){badge.className='risk-badge '+level;badge.innerHTML=levelIcon(level)+' '+scoreToLabel(gatedScore);}
  if(panel){panel.className='risk-panel '+level;}
  if(tempF<32){if(banner)banner.className='tg-banner show';if(tgIcon)tgIcon.innerHTML='<svg class="ic-sp" aria-hidden="true"><use href="#sp-snowflake"/></svg>';if(tgText)tgText.textContent=(soilEntered()?'Soil surface is frozen ('+Math.round(tempF)+'°F soil)':'Air is below freezing ('+Math.round(tempF)+'°F)')+', urease works very slowly, so loss starts slowly, but Montana State trials still averaged 18% and up to 44% loss from urea broadcast between October and April. Score is capped at 8 (a design choice, not zero loss). NBPT still helps; runoff on slopes is a second concern.';}
  else if(tempF<40){if(banner)banner.className='tg-banner show';if(tgIcon)tgIcon.innerHTML='<svg class="ic-sp" aria-hidden="true"><use href="#sp-snowflake"/></svg>';if(tgText)tgText.textContent='Very cold ('+Math.round(tempF)+'°F): urease activity is slow, so loss starts slowly. Score is capped at 22. Risk will increase rapidly as temperatures rise above 50°F.';}
  else if(tempF<50){if(banner)banner.className='tg-banner show';if(tgIcon)tgIcon.innerHTML='<svg class="ic-sp" aria-hidden="true"><use href="#sp-thermometer"/></svg>';if(tgText)tgText.textContent='Cool conditions ('+Math.round(tempF)+'°F): score capped at 40. Low-moderate risk at most. Monitor the forecast for warming; volatilization risk accelerates above 55°F.';}
  else{if(banner)banner.className='tg-banner';}
  var verdictText;
  if(tempF<32){verdictText=(soilEntered()?'Soil surface is frozen':'Air is below freezing')+', urease works very slowly, so loss starts slowly. But Montana State trials averaged 18% and up to 44% loss from urea broadcast between October and April, highest on a moist or snowy surface that stayed dry after. NBPT still helps, and frozen ground adds runoff risk on slopes.';}
  else if(tempF<40){verdictText='Very cold conditions: urease activity is slow, so loss starts slowly, though it is not zero. Watch for soil thaw and warming temperatures; risk will climb quickly once temps exceed 50°F.';}
  else if(tempF<50){verdictText='Cool conditions: urease activity is low but present. Risk is manageable. A urease inhibitor (NBPT) slows loss if temperatures are forecast to warm above 65°F in the coming days.';}
  else{var verdicts={low:'Conditions are favorable for surface urea application. Minimal nitrogen loss expected in the next 24–48 hours.',moderate:'Moderate volatilization risk. Options: wait for a better window, or use a urease inhibitor (NBPT). Monitor forecast closely.',high:'High N-loss risk. Options: wait for a cooler day or a dry surface, spread just ahead of a half-inch rain, work it in, or use a urease inhibitor (NBPT).',extreme:'Extreme risk. Do not apply surface urea. Conditions favour high losses; Montana State trials measured up to 44% on a wet surface that dried slowly. Wait for conditions to change or use injection.'};verdictText=verdicts[level];}
  if(verdict)verdict.textContent=verdictText;
  var rb=document.getElementById('u-rec-box');var rh=document.getElementById('u-rec-head');var rt=document.getElementById('u-rec-text');var recHead,recText;
  if(tempF<32){recHead='<svg class="ic-sp" aria-hidden="true"><use href="#sp-snowflake"/></svg> Below Freezing: Not an Application Window';recText='Loss starts slowly in the cold, but urea broadcast between October and April averaged 18% and up to 44% loss in Montana State trials, highest on a moist or snowy surface. If you must apply, NBPT still helps. Frozen ground also risks runoff on slopes. Re-check as soil thaws and temps approach 50°F.';if(rb)rb.className='rec-box low';if(rh){rh.className='rec-head cold';rh.innerHTML=recHead;}}
  else if(tempF<40){recHead='<svg class="ic-sp" aria-hidden="true"><use href="#sp-snowflake"/></svg> Cold: Low Volatilization Risk';recText='Urease activity is slow, so loss starts slowly. If you need to apply now, NBPT still helps, especially if the urea will sit on the surface through thaw-and-dry cycles. Risk increases quickly once temperatures exceed 50°F.';if(rb)rb.className='rec-box low';if(rh){rh.className='rec-head low';rh.innerHTML=recHead;}}
  else if(tempF<50){recHead='<svg class="ic-sp" aria-hidden="true"><use href="#sp-thermometer"/></svg> Cool: Manageable Risk';recText='Conditions are cool enough that volatilization risk is low but not negligible. NBPT is worthwhile if temperatures are forecast to rise above 65°F in the coming days or if no rain is expected within 48 hours.';if(rb)rb.className='rec-box low';if(rh){rh.className='rec-head low';rh.innerHTML=recHead;}}
  else{var recHeads={low:'<svg class="ic-sp" aria-hidden="true"><use href="#sp-circle-check"/></svg> Good Window',moderate:'<svg class="ic-sp" aria-hidden="true"><use href="#sp-triangle-alert"/></svg> Use Caution',high:'<svg class="ic-sp" aria-hidden="true"><use href="#sp-triangle-alert"/></svg> High Risk',extreme:'<svg class="ic-sp" aria-hidden="true"><use href="#sp-octagon-alert"/></svg> Do Not Apply'};var recs={low:'Conditions are favorable. Apply urea normally. Watch the 48-hour forecast. If temperatures rise above 65°F or light rain (under ½") is expected, reassess.',moderate:'Risk is present but manageable. Options: apply NBPT-treated urea, or wait for a better window. If forecast shows ½"+ rain within 48 hours, standard urea is acceptable.',high:'Significant nitrogen loss likely without protection. Options: delay application and watch the 5-day forecast for a lower-risk window, work it in, or use a urease inhibitor (NBPT).',extreme:'Do not surface-apply urea today. Wait for a cooler day or a dry surface, or spread just ahead of a half-inch rain; if application cannot wait, treat with NBPT stabilizer, knowing losses will still be elevated. Injecting below the surface, or switching to UAN placed with a coulter, also avoids the loss if you have the equipment.'};recHead=recHeads[level];recText=recs[level];if(rb)rb.className='rec-box '+level;if(rh){rh.className='rec-head '+level;rh.innerHTML=recHead;}}
  if(rt)rt.textContent=recText;
}

function buildForecastStrip(dailyData,ph,till){
  var strip=document.getElementById('fc-strip');
  if(!strip||!dailyData)return;
  var days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  strip.innerHTML='';
  for(var i=0;i<5;i++){
    var date=new Date(dailyData.time[i]+'T12:00:00');
    var name=i===0?'Today':days[date.getDay()];
    var tMax=dailyData.temperature_2m_max?dailyData.temperature_2m_max[i]:null;
    var tMin=dailyData.temperature_2m_min?dailyData.temperature_2m_min[i]:null;
    var pop=dailyData.precipitation_probability_max&&dailyData.precipitation_probability_max[i]!=null?dailyData.precipitation_probability_max[i]:0;
    // Use actual precipitation_sum (mm) when available for accurate incorporation assessment
    // This is more precise than probability alone: ½" threshold is the key incorporation cutoff
    var precipMm=dailyData.precipitation_sum&&dailyData.precipitation_sum[i]!=null?dailyData.precipitation_sum[i]:0;
    var sd=i===0?surfNow():surfDay(dailyData.time[i]);
    var dr=dayRisk(tMax,tMin,pop,precipMm,ph,till,sd.mult); // uses actual mm totals, not just probability
    var el=document.createElement('div');
    el.className='fc-day';
    if(!dr){
      // Missing forecast temperature: do not invent one and do not score the day.
      el.title=name+': no forecast';
      el.innerHTML='<div class="fc-day-name">'+name+'</div><div class="fc-day-icon"><svg class="ic-sp" aria-hidden="true"><use href="#sp-thermometer"/></svg></div><div class="fc-day-risk">-</div><div class="fc-day-temp">no forecast</div>';
      strip.appendChild(el);
      continue;
    }
    var gated=dr.gated,level=dr.level;
    var precipInches=precipMm/25.4;
    var precipNote=precipMm>0?(' · '+precipInches.toFixed(2)+'"'):'';
    el.title=name+': '+Math.round(tMax)+'°/'+Math.round(tMin)+'°F · '+pop+'% rain'+precipNote+(sd.cls?' · surface '+sd.cls:'')+' · '+scoreToLabel(gated);
    el.innerHTML='<div class="fc-day-name">'+name+'</div><div class="fc-day-icon">'+(WX_ICONS[dailyData.weather_code[i]]||'<svg class="ic-sp" aria-hidden="true"><use href="#sp-thermometer"/></svg>')+'</div><div class="fc-day-risk '+level+'">'+levelAbbr(level)+'</div><div class="fc-day-temp">'+Math.round(tMax)+'°/'+Math.round(tMin)+'°</div>';
    strip.appendChild(el);
  }
}

function loadWeather(lat,lon,label){
  document.getElementById('u-loc-setup').style.display='none';
  document.getElementById('u-factor-section').style.display='block';
  document.getElementById('risk-location').innerHTML='<svg class="ic-sp" aria-hidden="true"><use href="#sp-map-pin"/></svg> '+(label||'Your Location');
  // precipitation_sum added to daily — used in rainRiskDaily() for accurate incorporation assessment
  var nwsP=window.AgNWS?window.AgNWS.forecast(lat,lon,{days:7}):Promise.reject(new Error('the forecast reader did not load'));
  nwsP.then(function(d){
    if(!d||!d.current||d.current.temperature_2m==null||d.current.relative_humidity_2m==null||d.current.wind_speed_10m==null)throw new Error('no current conditions');
    UREA_CUR=d.current;UREA_DAILY=d.daily;UREA_POP=popNext48(d);UREA_HOURLY=d.hourly||null;
    var c=d.current;
    var airF=Math.round(c.temperature_2m),tempF=airF;
    var humid=c.relative_humidity_2m;
    var wind=Math.round(c.wind_speed_10m);
    var pop=UREA_POP.pop;
    tempF=soilTempOverride(tempF);var tR=tempRisk(tempF);
    var hR=humidRisk(humid);
    var wR=windRisk(wind);
    var rn=rainNow(),rR=rn.rR;
    var sf=surfNow(),rawTotal=Math.round(Math.min(100,compositeScore(tR,hR,wR,rR)*phMult()*tillMult()*sf.mult));
    updateGauge(rawTotal,tempF);appendSurfLine(sf,tempF);appendRainLine(rn);rainAdvice(rn,tempF);renderResidue();renderSurf(sf);
    if(tempF!==airF)setFactor('temp',tempF+'°F soil',soilTempDesc(tempF),tR,tR);else setFactor('temp',tempF+'°F',tempDesc(tempF),tR,tR);
    var hDesc=humid<30?'Dry air. Urea dissolution slow, but light rain or dew can still activate the enzyme. Watch for moisture events.':humid<50?'Low-moderate humidity. Some slowing from dryness. Monitor.':humid<70?'Moderate humidity. Optimal zone for urease activity. Risk is elevated.':humid<85?'Humid air, surface likely moist. Urease has favorable conditions. Risk is running.':'Saturated air, surface likely wet. Urease stays active; volatilization continues.';
    setFactor('humid',humid+'% RH',hDesc,hR,hR);
    var wDesc=wind<3?'Light or calm. Ammonia gradient building above surface.':wind<5?'Light wind. Ammonia beginning to disperse from surface.':wind<10?'Moderate wind. Continuously removing NH₃ from surface gradient. Volatilization rate elevated.':wind<15?'Significant wind. Rapid ammonia dispersal. Loss rate is high.':'Strong wind. Maximum ammonia dispersal from soil surface. N loss accelerated under all conditions.';
    setFactor('wind',wind+' mph',wDesc,wR,wR);
    setRainFactor(rn);
    buildForecastStrip(d.daily,phMult(),tillMult());
    try{var _o={};try{_o=JSON.parse(localStorage.getItem('agsist-wx-loc')||'{}')||{};}catch(e){_o={};}_o.lat=lat;_o.lon=lon;_o.label=label||null;localStorage.setItem('agsist-wx-loc',JSON.stringify(_o));}catch(e){}
    if(!label){fetch('https://nominatim.openstreetmap.org/reverse?lat='+lat+'&lon='+lon+'&format=json').then(function(r){return r.json();}).then(function(geo){var city=geo.address.city||geo.address.town||geo.address.village||geo.address.county||'';var st=geo.address.state_code||(/^US-([A-Z]{2})$/.exec(geo.address['ISO3166-2-lvl4']||'')||[])[1]||stateCode(geo.address.state);if(city)document.getElementById('risk-location').innerHTML='<svg class="ic-sp" aria-hidden="true"><use href="#sp-map-pin"/></svg> '+city+(st?', '+st:'');}).catch(function(){});}
  }).catch(function(){document.getElementById('risk-verdict').textContent='The weather didn’t load. Check your connection and refresh.';});
}

function requestGeo(){
  if(!navigator.geolocation){document.getElementById('zip-row').style.display='flex';return;}
  document.getElementById('risk-verdict').textContent='Detecting your location…';
  navigator.geolocation.getCurrentPosition(function(p){loadWeather(p.coords.latitude,p.coords.longitude,null);},function(){document.getElementById('zip-row').style.display='flex';document.getElementById('u-loc-setup').style.display='block';},{timeout:5000,maximumAge:600000});
}

function ureaZipErr(msg){var e=document.getElementById('urea-zip-err');if(e){e.textContent=msg||'';if(msg)e.removeAttribute('hidden');else e.setAttribute('hidden','');}}
function loadZip(){
  var zip=document.getElementById('urea-zip').value.trim();
  if(zip.length!==5||isNaN(zip)){ureaZipErr('Enter a valid 5-digit ZIP code.');return;}
  ureaZipErr('');
  // our own ZIP table, [lat, lon, town, state code, county] (2026-10-29: no outside geocoder)
  fetch('/data/places/zip/'+zip.slice(0,2)+'.json').then(function(r){if(r.status===404)return null;if(!r.ok)throw new Error(r.status);return r.json();}).then(function(t){var r=t&&t[zip];if(Array.isArray(r)&&isFinite(+r[0])&&isFinite(+r[1])){var _state=/^[A-Z]{2}$/.test(r[3]||'')?r[3]:'';var lbl=(r[2]||('ZIP '+zip))+(r[2]&&_state?', '+_state:'');loadWeather(+r[0],+r[1],lbl);}else{ureaZipErr('Couldn’t find that ZIP. Check the digits or try "Use My Location".');}}).catch(function(){ureaZipErr('Couldn’t reach the location lookup. Check your connection and try again.');});
}

document.getElementById('u-btn-geo').addEventListener('click',requestGeo);
document.getElementById('u-btn-show-zip').addEventListener('click',function(){document.getElementById('zip-row').style.display='flex';});
document.getElementById('u-btn-zip-go').addEventListener('click',loadZip);
document.getElementById('urea-zip').addEventListener('keydown',function(e){if(e.key==='Enter')loadZip();});
document.getElementById('u-btn-change-loc').addEventListener('click',function(){document.getElementById('zip-row').style.display='flex';document.getElementById('u-loc-setup').style.display='block';});

restoreFieldInputs();
['in-ph','in-till','in-soil','in-surf'].forEach(function(id){var e=document.getElementById(id);if(e){e.addEventListener('change',function(){saveFieldInputs();renderScore();});if(id==='in-soil')e.addEventListener('input',function(){saveFieldInputs();renderScore();});}});
setTimeout(function(){
  /* 2026-10-19: never ask for the location on load. A saved place loads at once; with none, the browser is asked only on a tap of Use My Location. */
  try{var saved=localStorage.getItem('agsist-wx-loc');if(saved){var p=JSON.parse(saved);if(p&&p.lat&&p.lon){loadWeather(p.lat,p.lon,p.label);return;}if(p&&/^\d{5}$/.test(String(p.zip||''))){document.getElementById('urea-zip').value=p.zip;loadZip();return;}}}catch(e){}
  var rv=document.getElementById('risk-verdict'),rl=document.getElementById('risk-location'),rb=document.getElementById('risk-badge');
  /* a ZIP typed before this timer has already drawn the place: leave it */
  if(!rl||!/Detecting location/.test(rl.textContent))return;
  if(rv)rv.textContent='Tap Use My Location or enter a ZIP below for the risk at your field.';
  if(rl)rl.lastChild.textContent=' No location yet';
  if(rb)rb.lastChild.textContent=' Set location';
},600);
})();
