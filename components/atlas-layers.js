/* atlas-layers.js: every Farmland Atlas layer's own value rule, its files, and the full county record (Nov 18, 2026,
   Atlas batch 2). Until batch 2 this code drew a second map on /farmland-atlas ("Every layer, one county at a time");
   that map is folded into the opening view: components/atlas-now.js draws every map, and loads this file the first
   time a reader opens one of these layers, a county's full record, or an old link (#l=, #s=, a county code).
   Nothing here draws a map. The layer rules, the side files and the record are the old map's own, moved unchanged. */
(function(){
'use strict';
var $=function(id){return document.getElementById(id);};
var DATA='/data/atlas/';
var ATLAS=null, GEO=null, READS=null, HOST={};
var PATHS={};          // fips -> true for a county with an outline (the new view's map; a code with no boundary is not a county)
var STATE='';          // the state the map is zoomed to, '' for the whole country (the new view sets it)
var SEL=null;          // selected fips
var DECADES=['1900s','1910s','1920s','1930s','1940s','1950s','1960s','1970s','1980s','1990s','2000s','2010s','2020s'];

// ---------- helpers
function fmt(x,k){ if(x===null||x===undefined||isNaN(x)) return '-'; return Number(x).toLocaleString('en-US',{maximumFractionDigits:k===undefined?1:k,minimumFractionDigits:0}); }
function money(x){ if(x===null||x===undefined) return '-'; var v=Math.floor(Math.abs(x)+0.5); return (x<0?'−$':'$')+v.toLocaleString('en-US'); }   // half away from zero, same as the pipeline
function pm(v,ci,k){ return (v>0?'+':'')+Number(v).toFixed(k)+' ± '+Number(ci).toFixed(k); }
function r2(x){ return x===null||x===undefined?'-':Number(x).toFixed(2); }
function pct(x,k){ return x===null||x===undefined?'-':fmt(x*100,k===undefined?0:k)+'%'; }
// One rule for a share on every copy (panel, sheet, county page, compare; 2026-10-20): the share from its acres,
// printed once to a whole percent, and "under 1%" for a nonzero share that rounds to 0
function shareWords(s){ return s!=null&&s>0&&s<0.005?'under 1%':pct(s,0); }
function pracShare(Pr,x){ return x.acres!=null&&Pr.cropland?x.acres/Pr.cropland:x.share; }
function irrShareOf(sh){ return sh.irrigated_acres!=null&&sh.harvested_acres?sh.irrigated_acres/sh.harvested_acres:sh.share; }
function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
// 134 of the 3,144 counties in atlas.json carry a unit word that is not "County". Test with 'u' in c, not c.u:
// Carson City's unit word is an empty string because its name is already whole, and truthiness would print "Carson City County".
function cname(c){ var u=('u' in c)?c.u:'County'; return c.name+(u?' '+u:'')+', '+c.state; }
function get(o){ for(var i=1;i<arguments.length;i++){ if(o==null) return undefined; o=o[arguments[i]]; } return o; }
function ok(layer){ return layer&&layer.status==='ok'; }
function why(layer){ return layer&&layer.status?layer.status.replace(/^(withheld|not yet measured):\s*/,''):'no data'; }
function sigDir(slope,ci){ if(slope==null||ci==null) return 'no clear direction'; if(slope-ci>0) return 'up'; if(slope+ci<0) return 'down'; return 'no clear direction'; }

var STATE_NAMES={};

// ---------- layers: value() returns a number or null; the pipeline computed every one of these
var LAYERS=[
 {key:'heat_recent',grp:'Night heat',label:'July low, last 10 yrs',ramp:'heat',unit:'F',k:1,fixed:true,needs:'heat',
  v:function(c){return get(c,'heat','months','jul','recent','mean');},title:'July mean daily low, last ten years (F)'},
 {key:'heat_trend',grp:'Night heat',label:'Trend since 1976',div:true,unit:'F/decade',k:2,needs:'heat',
  v:function(c){return get(c,'heat','months','jul','trend','per_decade');},title:'July mean low trend since 1976 (F per decade); every slope is colored, a direction is called only where the 95% interval excludes zero'},
 {key:'heat_hot',grp:'Night heat',label:'Hot Julys since 1900',ramp:'heat',unit:'Julys',k:0,needs:'heat',
  sidecar:true,v:function(c,f){var d=jdec(f); if(!d) return null; var n=0; for(var k in d) n+=d[k].hot||0; return n;},title:'Julys since 1900 whose average low was at or above 70 F'},
 {key:'heat_decade',grp:'Night heat',label:'By decade',ramp:'heat',unit:'F',k:1,needs:'heat',slider:true,sidecar:true,
  v:function(c,f){var d=jdec(f); d=d&&d[DECADES[DEC]]; return d&&d.n>=5?d.mean:null;},title:'July mean daily low by decade (F)'},
 {key:'water_irr',grp:'Water',label:'Cropland irrigated',ramp:'water',unit:'%',pct:true,k:0,needs:'water',
  v:function(c){return get(c,'water','irrigated_share_2022','share');},title:'Share of harvested cropland irrigated, 2022 census'},
 {key:'water_gw',grp:'Water',label:'From groundwater',ramp:'water',unit:'%',pct:true,k:0,needs:'water',
  v:function(c){return get(c,'water','groundwater_share_2015','share');},title:'Share of irrigation water pumped from groundwater, 2015 (USGS: crop irrigation where USGS splits it out, all irrigation including golf courses elsewhere)'},
 {key:'water_applied',grp:'Water',label:'Water withdrawn',ramp:'water',unit:'ft/acre',k:2,needs:'water',
  v:function(c){return get(c,'water','applied_2015','acre_ft_per_acre');},title:'Irrigation water withdrawn per irrigated acre, 2015 (acre-feet per acre, conveyance losses included; USGS crop irrigation where it splits it out, all irrigation including golf courses elsewhere)'},
 {key:'prem_slope',grp:'Water',label:'Irrigated ÷ dry rent, trend',div:true,unit:'×/yr',k:3,needs:'water_premium',
  v:function(c){var w=c.water_premium; return ok(w)&&w.ratio_slope_per_year!=null?w.ratio_slope_per_year:null;},title:'Irrigated cash rent as a multiple of dry rent: fitted change per year'},
 {key:'loss_hd',grp:'Loss record',label:'Heat + drought share',ramp:'loss',unit:'%',pct:true,k:0,needs:'loss',
  v:function(c){return get(c,'loss','share_all','heat_drought');},title:'Share of crop insurance indemnities since 1989 caused by heat and drought'},
 {key:'loss_hd_recent',grp:'Loss record',label:'Heat + drought, 2020 on',ramp:'loss',unit:'%',pct:true,k:0,needs:'loss',
  v:function(c){var v=get(c,'loss','heat_drought_2020s'); return v==null?null:v;},title:'Share of indemnities since 2020 caused by heat and drought'},
 {key:'loss_wet',grp:'Loss record',label:'Excess moisture share',ramp:'loss',unit:'%',pct:true,k:0,needs:'loss',
  v:function(c){return get(c,'loss','share_all','wet');},title:'Share of indemnities since 1989 caused by excess moisture and flood'},
 {key:'loss_irr',grp:'Loss record',label:'Irrigation failure',ramp:'loss',unit:'$',money:true,k:0,needs:'loss',
  v:function(c){var v=get(c,'loss','irrigation_failure_indemnity'); return v==null?null:Math.max(0,v);},title:'Indemnities paid for irrigation failure, all years (a net reversal reads as $0)'},
 {key:'rent',grp:'Rent',label:'Non-irrigated rent',ramp:'gold',unit:'$/acre',money:true,k:0,needs:'rent',
  v:function(c){return METRICS.rent(c);},title:'Non-irrigated cropland cash rent, latest published year (counties last surveyed more than three years before the newest survey are left grey)'},
 {key:'rent_irr',grp:'Rent',label:'Irrigated rent',ramp:'water',unit:'$/acre',money:true,k:0,needs:'rent',
  v:function(c){return METRICS.irr(c);},title:'Irrigated cropland cash rent, latest published year (counties last surveyed more than three years before the newest survey are left grey)'},
 {key:'rent_change',grp:'Rent',label:'Rent, ≈10-yr change',div:true,unit:'%',k:0,needs:'rent',
  v:function(c){return METRICS.rent(c)==null?null:get(c,'rent','nonirr_change10','pct');},title:'Change in non-irrigated cash rent over about ten years, nominal dollars'},
 {key:'rent_rev',grp:'Rent',label:'Rent ÷ corn gross',ramp:'gold',unit:'%',k:1,fixed:true,side:'rentrev',
  v:function(c,f){var r=rrev(f); return r&&r.p!=null&&r.py>=RREV_LATEST-3?r.p:null;},title:'Cash rent as a share of corn gross: rent ÷ (county corn yield of the same practice × state price received), each county\'s latest year with all three'},
 {key:'yield_slope',grp:'Corn yield',label:'Corn yield trend',div:true,unit:'bu/ac/yr',k:1,needs:'yield',
  v:function(c){var y=c['yield']; return ok(y)&&y.slope!=null?y.slope:null;},title:'County corn yield trend, bushels per acre per year, fitted on every published year since 2008'},
 {key:'yield_worst',grp:'Corn yield',label:'Worst year vs median',ramp:'gold',unit:'%',pct:true,k:0,needs:'yield',
  v:function(c){var y=c['yield']; return ok(y)?y.worst.share_of_median:null;},title:'Lowest published county corn yield as a share of the county median'},
 {key:'sob_cost',grp:'Loss ratio',label:'Claims per $100 of coverage',ramp:'loss',unit:'$',k:2,cost:true,needs:'sob',
  v:function(c){var x=get(c,'sob','loss_cost_last10'); return x==null?null:x*100;},title:'Crop insurance claims paid per $100 of coverage (liability), a year, last ten closed crop years'},
 {key:'sob_10',grp:'Loss ratio',label:'Loss ratio, last 10 years',ramp:'loss',unit:'',k:2,fixed:true,needs:'sob',
  pivot:1, v:function(c){return get(c,'sob','ratio_last10');},title:'Crop insurance loss ratio, indemnity ÷ premium, last ten closed crop years (1.00 = paid out what it took in)'},
 {key:'sob_all',grp:'Loss ratio',label:'Loss ratio, since 1989',ramp:'loss',unit:'',k:2,fixed:true,needs:'sob',
  pivot:1, v:function(c){return get(c,'sob','loss_ratio_all');},title:'Crop insurance loss ratio, every closed crop year since 1989 (1.00 = paid out what it took in)'},
 {key:'sob_over',grp:'Loss ratio',label:'Share of years over 1.00',ramp:'loss',unit:'%',pct:true,k:0,needs:'sob',
  v:function(c){return get(c,'sob','share_over_one');},title:'Share of closed crop years in which indemnities exceeded premium (counties with fewer than ten rated years are grey)'},
 {key:'val',grp:'Land value',label:'Land + buildings, 2022',ramp:'gold',unit:'$/acre',money:true,k:0,needs:'value',
  v:function(c){return get(c,'value','latest');},title:'Estimated market value of land and buildings per acre, 2022 Census of Agriculture, as operators reported it'},
 {key:'val_cagr',grp:'Land value',label:'Change, %/yr',div:true,unit:'%/yr',k:1,needs:'value',
  v:function(c){return get(c,'value','change_cagr_pct');},title:'Compound annual change in census land value between the last two censuses, nominal'},
 {key:'val_rtv',grp:'Land value',label:'Rent ÷ value',ramp:'gold',unit:'%',k:2,fixed:true,needs:'value',
  v:function(c){return get(c,'value','rent_to_value_pct');},title:'Non-irrigated cropland cash rent as a share of census land value, same year, gross (grey where cropland is under half of land in farms or a tenth is irrigated)'},
 {key:'crp_share',grp:'CRP',label:'Share of cropland + CRP',ramp:'green',unit:'%',k:1,needs:'crp',
  v:function(c){return get(c,'crp','share_pct');},title:'CRP acres as a share of CRP acres plus 2022 harvested cropland'},
 {key:'crp_peak',grp:'CRP',label:'Change from peak',div:true,unit:'%',k:0,needs:'crp',
  v:function(c){return get(c,'crp','change_from_peak_pct');},title:'Latest CRP acres against the county\'s peak year since 1986, percent (counties whose peak never reached 100 acres are grey)'},
 {key:'crp_rate',grp:'CRP',label:'Rental payment, $/ac',ramp:'green',unit:'$/acre',money:true,k:0,needs:'crp',
  v:function(c){return get(c,'crp','rate');},title:'Average annual CRP rental payment per acre under contract, latest fiscal year, USDA FSA (counties under 100 enrolled acres are grey)'},
 {key:'crp_exp',grp:'CRP',label:'Expiring, next 3 FY',ramp:'green',unit:'acres',k:0,needs:'crp',
  v:function(c){return get(c,'crp','expiring_next3','acres');},title:'CRP acres whose contracts expire in the current and next two fiscal years'},
 {key:'dr_share',grp:'Drought',label:'Weeks in D2+, since 2000',ramp:'heat',unit:'%',k:0,needs:'drought',
  v:function(c){return get(c,'drought','weeks','share_d2_pct');},title:'Share of weekly Drought Monitor maps since 2000 with at least half the county in severe drought (D2) or worse'},
 {key:'dr_last5',grp:'Drought',label:'Weeks in D2+, last 5 yrs',ramp:'heat',unit:'wks',k:0,needs:'drought',
  v:function(c){return get(c,'drought','last5','d2');},title:'Weeks in the last five full years with at least half the county in D2 or worse'},
 {key:'dr_half',grp:'Drought',label:'Years half or more in D2+',ramp:'heat',unit:'yrs',k:0,needs:'drought',
  v:function(c){return get(c,'drought','years_half_or_more');},title:'Full years since 2000 in which at least half the county was in D2 or worse for 26 weeks or more'},
 {key:'gs_normal',grp:'Rain and heat',label:'Apr–Sep rain, normal',ramp:'water',unit:'in',k:1,needs:'climate',side:'more',
  v:function(c,f){return mv(f,'c',0);},title:'Growing-season rain, April to September, 1991–2020 average, inches'},
 {key:'gs_recent',grp:'Rain and heat',label:'Last 10 seasons vs normal',div:true,unit:'%',k:0,needs:'climate',side:'more',
  v:function(c,f){var p=mv(f,'c',2); return p==null?null:p-100;},title:'April–September rain over the last ten complete seasons, percent above or below the 1991–2020 normal'},
 {key:'gs_latest',grp:'Rain and heat',label:'Last season vs normal',div:true,unit:'%',k:0,needs:'climate',side:'more',
  v:function(c,f){var p=mv(f,'c',3); return p==null?null:p-100;},title:'The latest complete April–September season, percent above or below the 1991–2020 normal'},
 {key:'gs_cv',grp:'Rain and heat',label:'Year-to-year swing',ramp:'heat',unit:'%',k:0,needs:'climate',side:'more',
  v:function(c,f){return mv(f,'c',1);},title:'How far a typical growing season lands from the average, percent of the 1991–2020 normal (higher is less dependable; grey under 6 inches of normal)'},
 {key:'jul_high',grp:'Rain and heat',label:'July highs, last 10 yrs',ramp:'heat',unit:'F',k:1,needs:'climate',side:'more',
  v:function(c,f){return mv(f,'c',4);},title:'July mean daily high, last ten years (F)'},
 {key:'fr_ffd',grp:'Season',label:'Frost-free days',ramp:'green',unit:'days',k:0,needs:'frost',side:'more',
  v:function(c,f){return mv(f,'f',2);},title:'Median days between the last spring and first fall freeze (32 F on the county-average low), 1996 on'},
 {key:'fr_spring',grp:'Season',label:'Last spring freeze',ramp:'green',unit:'',k:0,doy:true,needs:'frost',side:'more',
  v:function(c,f){var v=mv(f,'f',0); return v===-1?null:v;},title:'Median date of the last spring freeze (32 F on the county-average low), 1996 on; low ground freezes later'},
 {key:'fr_fall',grp:'Season',label:'First fall freeze',ramp:'green',unit:'',k:0,doy:true,needs:'frost',side:'more',
  v:function(c,f){var v=mv(f,'f',1); return v===999?null:v;},title:'Median date of the first fall freeze (32 F on the county-average low), 1996 on; low ground freezes earlier'},
 {key:'fr_gdd',grp:'Season',label:'Corn GDD, May–Sep',ramp:'gold',unit:'GDD',k:0,needs:'frost',side:'more',
  v:function(c,f){return mv(f,'f',3);},title:'Median corn growing degree days, May 1 to September 30, 86/50 method, 1996 on'},
 {key:'fr_hot',grp:'Season',label:'Days 95 °F+',ramp:'heat',unit:'days',k:1,needs:'frost',side:'more',
  v:function(c,f){return mv(f,'f',4);},title:'Days a year with a county-average high of 95 F or more, June to August, 1996 on'},
 {key:'st_hail',grp:'Storms',label:'Hail 1"+ days a year',ramp:'loss',unit:'days',k:1,needs:'storms',side:'more',
  v:function(c,f){return mv(f,'s',0);},title:'Days a year with a hail report of 1 inch or more, 2010 on. Reports, not storms: more people and a bigger county log more report days'},
 {key:'st_hail2',grp:'Storms',label:'Hail 2"+ days a year',ramp:'loss',unit:'days',k:2,needs:'storms',side:'more',
  v:function(c,f){return mv(f,'s',1);},title:'Days a year with a hail report of 2 inches or more, 2010 on (reports; a bigger county logs more)'},
 {key:'st_wind',grp:'Storms',label:'Severe wind days a year',ramp:'loss',unit:'days',k:1,needs:'storms',side:'more',
  v:function(c,f){return mv(f,'s',2);},title:'Days a year with a thunderstorm wind report of 58 mph or more, measured or estimated, 2010 on (reports; a bigger county logs more)'},
 {key:'en_solar',grp:'Solar and wind',label:'Solar, operating',ramp:'gold',unit:'MW',k:0,needs:'energy',
  v:function(c){var e=c.energy; return ok(e)?e.solar:null;},title:'Solar nameplate capacity operating in the county, MW, EIA Form 860 (plants of 1 MW or more)'},
 {key:'en_wind',grp:'Solar and wind',label:'Wind, operating',ramp:'gold',unit:'MW',k:0,needs:'energy',
  v:function(c){var e=c.energy; return ok(e)?e.wind:null;},title:'Wind nameplate capacity operating in the county, MW, EIA Form 860'},
 {key:'en_prop',grp:'Solar and wind',label:'Proposed',ramp:'gold',unit:'MW',k:0,needs:'energy',
  v:function(c){var e=c.energy; return ok(e)?e.proposed:null;},title:'Solar, wind and battery capacity developers have told EIA they plan in the county, MW'},
 {key:'we_depth',grp:'Wells and rights',label:'Irrigation well depth',ramp:'water',unit:'ft',k:0,needs:'wells',
  v:function(c){return get(c,'wells','depth_median_ft');},title:'Median total depth of irrigation wells on the state register, feet (registers differ: compare a county with its own state)'},
 {key:'we_static',grp:'Wells and rights',label:'Water level when drilled',ramp:'water',unit:'ft',k:0,needs:'wells',
  v:function(c){var v=get(c,'wells','static_median_ft'); if(v==null&&!get(c,'wells','first_water')) v=get(c,'wells','level_median_ft'); return v;},title:'Median water level of irrigation wells when drilled, feet below land surface (state registers; Oklahoma records first water instead and is left out)'},
 {key:'we_irr',grp:'Wells and rights',label:'Irrigation wells on record',ramp:'water',unit:'',k:0,log:true,needs:'wells',
  v:function(c){var v=get(c,'wells','irrigation_wells'); return v==null?get(c,'wells','irrigation_active'):v;},title:'Irrigation wells on the state register (log scale; Kansas: active irrigation water rights, surface water included). Registers differ: Nebraska counts wells in use; most others count every well ever logged, sealed ones included; Michigan and Arizona include lawn and multi-use wells. Compare a county with its own state'},
 {key:'we_prio',grp:'Wells and rights',label:'KS: rights, priority year',ramp:'water',unit:'',k:0,needs:'wells',
  v:function(c){return get(c,'wells','priority_year_median');},title:'Kansas: median priority year of active irrigation water rights (older is served first in a shortage)'},
 {key:'sales_med',grp:'Recorded sales',label:'Median sale $/acre',ramp:'gold',unit:'$/acre',money:true,k:0,side:'sales',
  v:function(c,f){var r=srow(f); return r&&r[0]!=null?r[0]:null;},title:'Median price per acre of recorded farmland sales, last 12 months of each state\'s records (sale count beside every figure)'},
 {key:'sales_n',grp:'Recorded sales',label:'Number of sales',ramp:'green',unit:'sales',k:0,side:'sales',
  v:function(c,f){var r=srow(f); return r?r[5]:null;},title:'Recorded market sales of farmland, last 12 months of each state\'s records'},
 {key:'ten_rent',grp:'Who farms it',label:'Rented, 2022',ramp:'gold',unit:'%',pct:true,k:0,side:'tenure',
  v:function(c,f){return tenShare(f,'2022');},title:'Share of land in farms rented from others, 2022 Census of Agriculture, as farms reported it'},
 {key:'pr_tile',grp:'Tile and tillage',label:'Tile-drained',ramp:'water',unit:'%',pct:true,k:0,needs:'practices',
  v:function(c){return get(c,'practices','tile');},title:'Land drained by tile as a share of the county\'s cropland, 2022 Census of Agriculture'},
 {key:'pr_notill',grp:'Tile and tillage',label:'No-till',ramp:'green',unit:'%',pct:true,k:0,needs:'practices',
  v:function(c){return get(c,'practices','notill');},title:'Cropland farmed no-till as a share of all cropland, 2022 Census of Agriculture'},
 {key:'pr_cover',grp:'Tile and tillage',label:'Cover crops',ramp:'green',unit:'%',pct:true,k:0,needs:'practices',
  v:function(c){return get(c,'practices','cover');},title:'Cropland planted to cover crops (CRP excluded) as a share of all cropland, 2022 Census of Agriculture'},
 {key:'afida',grp:'Who farms it',label:'Foreign-held acres',ramp:'water',unit:'acres',k:0,side:'afida',log:true,
  v:function(c,f){return afidaAcres(f);},title:'Agricultural acres held by foreign persons, latest AFIDA year, as disclosed to USDA FSA (forest included; log scale)'},
 {key:'lv_cattle',grp:'Livestock',label:'Cattle and calves',ramp:'gold',unit:'head',k:0,log:true,needs:'livestock',side:'more',
  v:function(c,f){return mv(f,'l',0);},title:'Cattle and calves on farms, 2022 Census of Agriculture (log scale)'},
 {key:'lv_dens',grp:'Livestock',label:'Cattle per 1,000 farm acres',ramp:'gold',unit:'/1,000 ac',k:0,needs:'livestock',side:'more',
  v:function(c,f){return mv(f,'l',3);},title:'Cattle and calves per 1,000 acres of land in farms, 2022 census (all cattle, feedlots included: a feedlot county reads far above any grazing rate)'},
 {key:'lv_beef',grp:'Livestock',label:'Beef cows',ramp:'gold',unit:'head',k:0,log:true,needs:'livestock',side:'more',
  v:function(c,f){return mv(f,'l',1);},title:'Beef cows, 2022 census (log scale)'},
 {key:'lv_milk',grp:'Livestock',label:'Milk cows',ramp:'gold',unit:'head',k:0,log:true,needs:'livestock',side:'more',
  v:function(c,f){return mv(f,'l',2);},title:'Milk cows, 2022 census (log scale)'},
 {key:'lv_chg',grp:'Livestock',label:'Cattle, 2017 to 2022',div:true,unit:'%',k:0,needs:'livestock',side:'more',
  v:function(c,f){return mv(f,'l',4);},title:'Change in cattle and calves between the 2017 and 2022 censuses, percent (counties under 50 head in 2017 are grey)'}
];

// ---------- the land pages' own files, read in place so the Atlas and those pages never disagree
var SIDE={
  tenure:{url:'/data/tenure/tenure.json', why:'the census tenure file did not load'},
  afida:{url:'/data/afida/county.json', nat:'/data/afida/national.json', why:'the AFIDA file did not load'},
  more:{url:'/data/atlas/more.json', why:'the weather, storm and livestock file did not load'},
  rentrev:{url:'/data/cash-rent/national.json', why:'the cash rent file did not load'},
  sales:{url:'/data/land/atlas-layer.json', why:'the recorded sales file did not load'}
};
// ---------- recorded farmland sales (Nov 5, 2026): every county with a recorded market sale is shown, no
// minimum count. The count stands beside every figure and a count under the file's "thin" is marked; never hidden.
// Row: [median $/acre or null, sales in it, 1 bare land / 2 any 20+ acre sale / 0 none priced, first, last, sales in the window, page]
var SMON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function srow(f){ var S=SIDE.sales; return S.ok?S.d.counties[f]||null:null; }
function sst(c){ var S=SIDE.sales; return S.ok&&c?S.d.states[c.state]||null:null; }
function sday(iso,month){ var m=SMON[Number(iso.slice(5,7))-1]; return month?m+' '+iso.slice(0,4):m+' '+Number(iso.slice(8,10))+', '+iso.slice(0,4); }
function srange(a,b,month){ return a===b?sday(a,month):sday(a,month)+' to '+sday(b,month); }
function swin(st){ return srange(st.cur[0],st.cur[1],true); }
function scount(n){ return fmt(n,0)+' '+(n===1?'sale':'sales'); }
function sthin(n){ return n<(SIDE.sales.d.thin||5); }
function sthinText(n){ return 'based on '+scount(n)+': a thin read'; }
// the short tag beside a county's figure in the tip, the rail and the next-door list
function stag(L,f){ var r=srow(f); if(!r||L.side!=='sales') return ''; if(L.key==='sales_n') return ''; return r[0]==null?'':' · '+scount(r[1])+(sthin(r[1])?', thin':''); }
function swhy(c,f){
  var S=SIDE.sales; if(!S.ok) return S.why; var st=sst(c);
  if(!st) return S.d.listed&&S.d.listed[c.state]?'sales here are listed on the land sales pages, not yet counted on this map':'no public sale records here yet';
  var r=srow(f); if(!r) return 'no recorded sale in the window ('+swin(st)+')';
  return scount(r[5])+' in the window, none of '+S.d.min_acres+' acres or more with a price per acre';
}
// fills for a county with no figure: grey where no state record is read, dots where the state is read and the
// county had no sale, a hatch where it had sales but none priced as farmland
function sfill(c,f){ var st=sst(c); if(!st) return '#3b4245'; return srow(f)?'url(#fa-nop)':'url(#fa-zero)'; }
function sLegend(L,inScope){
  var S=SIDE.sales.d, sts=Object.keys(S.states).sort(), thin=0, any=0;
  for(var f in S.counties){ var c=ATLAS.counties[f]; if(!c||!inScope(f)) continue; var r=S.counties[f]; if(L.key==='sales_med'&&r[0]!=null){ if(sthin(r[1])) thin++; if(r[2]===2) any++; } }
  var h='<span><span class="sk" style="background:#3b4245"></span>no public sale records here yet</span>'
    +'<span><span class="sk zero"></span>no recorded sale in the window</span>'
    +(L.key==='sales_med'?'<span><span class="sk nop"></span>sales, none of '+S.min_acres+'+ acres with a price</span>':'');
  h+='<span class="fa-note">'+(L.key==='sales_med'?'Median price per acre of recorded market sales: bare farm land of '+S.min_acres+' acres or more; a county with none uses its sales of '+S.min_acres+' acres or more with buildings or woods (said in its card). Every county with a sale is colored, whatever the count. '
      +(thin?fmt(thin,0)+' of these medians rest on fewer than '+S.thin+' sales: a thin read, marked in the card and the lists. ':'')
      +(any?fmt(any,0)+' use sales with buildings or woods. ':'')
    :'Recorded market sales of farmland in each county. ')
    +'Window, the last 12 months of each state\'s records: '+sts.map(function(k){ var t=S.states[k]; return esc(STATE_NAMES[k]||k)+' '+esc(swin(t))+(t.dates==='month'?' (sale months)':''); }).join('; ')+'. '
    +'Sources: '+sts.map(function(k){ return esc(S.states[k].who||k); }).join(', ')+' transfer records.</span>';
  return h;
}
function sCard(L,c,f){
  var r=srow(f), st=sst(c), h='';
  if(!r||(L.key==='sales_med'&&r[0]==null)){ h+='<div class="fa-cc-v dim">'+esc(swhy(c,f))+'</div>'; }
  else {
    var mo=st.dates==='month';
    if(L.key==='sales_med') h+='<div class="fa-cc-v">'+esc(money(r[0]))+'<span class="fa-cc-u"> an acre</span></div>';
    else h+='<div class="fa-cc-v">'+esc(scount(r[5]))+'</div>';
    var ls=[];
    if(r[0]!=null){
      ls.push((L.key==='sales_med'?'Median of ':'Median '+money(r[0])+' an acre, from ')+scount(r[1])+(r[2]===1?' of bare farm land, '+SIDE.sales.d.min_acres+' acres or more':' of '+SIDE.sales.d.min_acres+' acres or more with buildings or woods (no bare farm land sale in the window)'));
      ls.push((r[1]===1?'Sold ':'Sales from ')+srange(r[3],r[4],mo));
      if(sthin(r[1])) ls.push('<b class="fa-thin">'+esc(sthinText(r[1]).replace(/^b/,'B'))+'</b>');
    } else ls.push('None of '+SIDE.sales.d.min_acres+' acres or more with a price per acre');
    ls.push(scount(r[5])+' recorded in all, '+swin(st)+(mo?' (sale months)':''));
    h+='<div class="fa-cc-r">'+ls.map(function(x){ return x.indexOf('<b')===0?x:esc(x); }).join('<br>')+'</div>';
  }
  if(st&&r&&r[6]) h+='<a class="fa-cc-print" href="/land-sales/'+esc(st.slug)+'/'+esc(r[6])+'">Land sales in this county</a><a class="fa-cc-print" href="/farmland-atlas/'+esc(st.slug)+'/'+esc(r[6])+'">County page</a>';
  else if(SIDE.sales.ok&&SIDE.sales.d.listed&&SIDE.sales.d.listed[c.state]) h+='<a class="fa-cc-print" href="/land-sales/'+esc(SIDE.sales.d.listed[c.state])+'/">Land sales in '+esc(STATE_NAMES[c.state]||c.state)+'</a>';
  return h;
}
// rent ÷ corn gross: read from data/cash-rent/national.json, the file the county pages and the rent share calculator use, so they cannot disagree.
// p = rent ÷ (county corn yield of the same practice × state price received), py its year, pp = that price is preliminary.
// A file without pair_rule divided dryland rent by a mixed yield; this layer withholds it.
var RREV_LATEST=null, FOF=null;
function rrev(f){ var R=SIDE.rentrev; return R.ok&&R.d.counties?R.d.counties[f]||null:null; }
function fipsOf(c){ if(!FOF){ FOF=new Map(); for(var f in ATLAS.counties) FOF.set(ATLAS.counties[f],f); } return FOF.get(c); }
function rnote(L,f){ if(L.key!=='rent_rev') return ''; var r=rrev(f); return r&&r.py?' ('+r.py+' corn'+(r.pp?', preliminary price':'')+')':''; }
function rlatest(L){ return L.key==='rent_rev'?RREV_LATEST:RENT_LATEST; }
// weather, storms, livestock, freeze dates: fetched when one of those layers is picked (build: MORE_KEYS)
function mv(f,blk,i){ var M=SIDE.more; if(!M.ok) return null; var r=M.d.counties&&M.d.counties[f]; r=r&&r[blk]; var v=r?r[i]:null; return v==null?null:v; }
function doyLabel(d){ var t=new Date(Date.UTC(2021,0,1)+(Math.round(d)-1)*864e5); return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][t.getUTCMonth()]+' '+t.getUTCDate(); }
function loadSide(k){
  var S=SIDE[k];
  if(!S.p){
    var get1=function(u){ return fetch(u,{cache:'no-cache'}).then(function(r){return r.ok?r.json():null;}).catch(function(){return null;}); };
    S.p=Promise.all([get1(S.url), S.nat?get1(S.nat):Promise.resolve(null)]).then(function(r){
      if(r[0]&&k==='more'&&r[0].generated!==ATLAS.generated){ S.why='the weather and livestock file is from another build; reload the page'; }
      else if(r[0]&&k==='rentrev'&&!r[0].pair_rule){ S.why='this cash rent file divides dryland rent by a yield that mixes irrigated and dryland acres; the ratio returns with the next NASS refresh'; }
      else if(r[0]&&(k!=='afida'||(r[1]&&r[1].latest_year))){ S.d=r[0]; S.n=r[1]; S.ok=true; }
      if(k==='rentrev'&&S.ok){ for(var rf in S.d.counties){ var py=S.d.counties[rf].py; if(py&&(!RREV_LATEST||py>RREV_LATEST)) RREV_LATEST=py; } }
      S.done=true; return S;
    });
  }
  return S.p;
}
/* the national answer beside the legend on the rented layer (benchmark Oct 16: it sat 2.7 phone screens down).
   rented / (owned + rented), census land in farms; 2022: 345,889,019 / 880,100,848 = 39.3% */
function tenNatLine(){
  var T=SIDE.tenure.d, N=T&&T.national, sh=function(p){ return p&&p[0]!=null&&p[1]!=null&&p[0]+p[1]>0?p[1]/(p[0]+p[1]):null; };
  if(!N) return '';
  var ys=(T.years||[]).map(String), last=ys[ys.length-1], first=ys[0], a=sh(N[last]), b=sh(N[first]);
  if(a==null) return '';
  var st=(STATE&&T.states&&T.states[STATE])?sh(T.states[STATE].y&&T.states[STATE].y[last]):null;
  return '<p class="fa-natline"><b>'+(100*a).toFixed(1)+'%</b> of U.S. farmland was rented in '+last+' ('+Math.round(N[last][1]/1e6)+' of '+Math.round((N[last][0]+N[last][1])/1e6)+' million acres)'
    +(b!=null?'; '+(100*b).toFixed(1)+'% in '+first:'')
    +(st!=null?'. '+esc(STATE_NAMES[STATE]||STATE)+': '+(100*st).toFixed(1)+'%':'')+'. Census of Agriculture.</p>';
}
window.AgTenureData=function(){ return loadSide('tenure').then(function(S){ return S.ok?S.d:null; }); };
function tenShare(f,y){ var T=SIDE.tenure.d, c=T&&T.counties&&T.counties[f], p=c&&c.y&&c.y[y]; if(!p||p[0]==null||p[1]==null||p[0]+p[1]<=0) return null; return p[1]/(p[0]+p[1]); }
function afidaAcres(f){
  var A=SIDE.afida; if(!A.ok||!PATHS[f]) return null;     // an off-map code is not a county AFIDA could report
  var c=A.d[f], y=String(A.n.latest_year);
  // a county absent from the file, or without a filing in the latest year, disclosed no holdings: zero, not missing
  return c&&c.y?(c.y[y]||0):0;
}
var DEC=12;

// ---------- July decade series: a sidecar file, not the index. Only the two layers below need it,
// so it is fetched the first time one of them is picked and never on first paint.
var HEATD=null, HEATD_P=null, HEATD_DONE=false, HEATD_WHY='';
function loadHeatDecades(){
  if(!HEATD_P) HEATD_P=fetch(DATA+(get(ATLAS,'sidecars','heat_decades')||'heat-decades.json'),{cache:'no-cache'}).then(function(r){return r.ok?r.json():null;}).catch(function(){return null;}).then(function(r){
    // a sidecar from another build would color counties from numbers the rest of the page is not using
    if(!r||!r.counties) HEATD_WHY='the decade file did not load';
    else if(r.generated!==ATLAS.generated) HEATD_WHY='the decade file is from another build; reload for the current one';
    else HEATD=r.counties;
    HEATD_DONE=true; return HEATD;
  });
  return HEATD_P;
}
function jdec(f){ return HEATD?HEATD[f]:null; }

function shortv(L,v){
  if(L.key==='we_prio') return String(Math.round(v));
  if(L.doy) return doyLabel(v);
  if(L.pivot!=null&&v===L.pivot) return Number(v).toFixed(2);     // "1.00", as the title writes it
  function exact(x){ return String(Number(Number(x).toPrecision(10))); }
  if(L.cost) return '$'+rh(Number(v),2);
  if(L.pct) return exact(v*100)+'%';
  var a=Math.abs(v), sgn2=(L.div&&v>0?'+':v<0?'−':''), body;
  if(a>=1e6&&a%1e4===0) body=exact(a/1e6)+'M'; else if(a>=1000&&a%100===0) body=exact(a/1000)+'k'; else body=Number(exact(a)).toLocaleString('en-US',{maximumFractionDigits:6});
  return sgn2+(L.money?'$':'')+body+(L.unit==='%'||L.unit==='%/yr'?'%':'');
}
function fmtv(L,v){ var t=fmtv0(L,v); return typeof t==='string'?t.replace(/^-/,'−'):t; }
function fmtv0(L,v){ if(v==null) return '-'; if(L.key==='sales_n') return scount(v); if(L.doy) return doyLabel(v); if(L.cost) return '$'+rh(Number(v),2); if(L.pct) return pct(v,L.k); if(L.money) return money(v); if(L.key==='we_prio') return String(Math.round(v)); if(L.fixed) return Number(v).toFixed(L.k)+(L.unit==='%'?'%':L.unit?' '+L.unit:''); return (L.div&&v>0?'+':'')+fmt(v,L.k)+(L.unit==='%'||L.unit==='%/yr'?L.unit:L.unit?' '+L.unit:''); }

function farmReady(){ return SIDE.tenure.done&&SIDE.tenure.ok; }
function isFarm(f){ if(!farmReady()) return true; var a=farmAcres(f); return a==null||a>=10000; }
function rankWords(p){
  if(!p) return ''; var r=p[0], n=p[1], t=p[2]||1, N=fmt(n,0); if(n<2||t>=n) return '';
  var tie=t>1?'tied for ':'', last=r+t-1;
  if(r===1) return tie+'highest of '+N+(t>1?' ('+fmt(t,0)+' counties)':'');
  if(last===n) return tie+'lowest of '+N+(t>1?' ('+fmt(t,0)+' counties)':'');
  if(r<=n/2) return tie+ord(r)+' highest of '+N;
  return tie+ord(n-last+1)+' lowest of '+N;
}
var NB=null;
function neighbours(f){
  if(!NB){ NB={}; var at={};
    // two counties are neighbours when they share a stretch of boundary; a corner touch (Four Corners) is not one
    (GEO.features||[]).forEach(function(ft){ var id=ft.id, g=ft.geometry; if(!PATHS[id]||!g) return;
      var rings=g.type==='Polygon'?g.coordinates:g.type==='MultiPolygon'?[].concat.apply([],g.coordinates):[];
      rings.forEach(function(r){ for(var i=0;i+1<r.length;i++){ var p=r[i][0]+','+r[i][1], q=r[i+1][0]+','+r[i+1][1], k=p<q?p+'|'+q:q+'|'+p, s=at[k]; if(!s) at[k]=[id]; else if(s.indexOf(id)<0) s.push(id); } }); });
    for(var k in at){ var s=at[k]; if(s.length<2) continue; for(var i=0;i<s.length;i++){ var m=NB[s[i]]=NB[s[i]]||{}; for(var j=0;j<s.length;j++) if(j!==i) m[s[j]]=1; } }
    for(var x in NB) NB[x]=Object.keys(NB[x]).filter(function(g){return ATLAS.counties[g];});
  }
  return NB[f]||[];
}
function farmAcres(f){ var T=SIDE.tenure.d, c=T&&T.counties&&T.counties[f], p=c&&c.y&&c.y['2022']; if(!p) return 0; return p[0]!=null&&p[1]!=null?p[0]+p[1]:null; }   // null: one part suppressed (D), size unknown
function shortName(c,st){ var u=('u' in c)?c.u:'County'; return c.name+(/^city$/i.test(u)?' (city)':'')+(st&&c.state!==st?', '+c.state:''); }
// Field Scout opens on the county's middle, zoomed to where a field can be drawn
function scoutHref(f){
  var ft=null; (GEO&&GEO.features||[]).some(function(x){ if(x.id===f){ ft=x; return true; } return false; });
  if(!ft||!ft.geometry) return '/field-scout';
  var x0=180,x1=-180,y0=90,y1=-90;
  (function walk(c){ if(typeof c[0]==='number'){ if(c[0]<x0)x0=c[0]; if(c[0]>x1)x1=c[0]; if(c[1]<y0)y0=c[1]; if(c[1]>y1)y1=c[1]; } else c.forEach(walk); })(ft.geometry.coordinates);
  return '/field-scout?at='+((y0+y1)/2).toFixed(4)+','+((x0+x1)/2).toFixed(4)+'&fips='+f;
}
// a date layer ranks by the calendar: the latest freeze is not the "highest"
var PAGES=null;   // fips -> static page path, from the generated index; the link stays on the state hub until it loads
var PAGE_FIPS='';
function pageLink(fips){
  PAGE_FIPS=fips;
  function set(){ if(fips!==PAGE_FIPS) return; var c=$('fa-p-cmp'); if(c) c.href='/farmland-atlas/compare#'+fips; var a=$('fa-p-page'); if(!a) return; var p=PAGES&&PAGES[fips]; a.href=p||'/farmland-atlas/states/'; a.textContent=p?'County page':'All counties by state'; a.title=p?'A page of its own for this county, with a link you can share':''; }
  set(); if(PAGES) return;
  fetch('/farmland-atlas/data/counties-index.json').then(function(r){ if(!r.ok) throw new Error('index'); return r.json(); }).then(function(a){ var m={}; for(var i=0;i<a.length;i++) m[a[i][0]]=a[i][2]; PAGES=m; set(); }).catch(function(){ PAGES=null; });
}
function layerOff(l){ if(l.side) return false; var st=get(ATLAS,'layers',l.needs,'status'); if(!st) return l.needs==='practices'; return st!=='ok'; }   // a layer the data file does not know yet is dimmed, not drawn empty
function layerOf(k){ return LAYERS.filter(function(l){return l.key===k;})[0]; }
// ---------- tooltip + selection
function rrevWhy(f){ var R=SIDE.rentrev; if(!R.ok) return R.why; var r=rrev(f); if(!r) return 'USDA published no cropland cash rent here';
  if(r.p!=null) return 'latest year with rent, a same-practice corn yield and a price is '+r.py+'; the map colors '+(RREV_LATEST-3)+' on';
  if(r.pw) return r.pw+' ('+r.pwy+')'; return 'no county corn yield published, so no ratio'; }
function rrevLegend(byF,inScope){
  // the source and as-of line for the rent file, plus how many colored counties lean on a preliminary price
  var np=0, py={}, R=SIDE.rentrev.d||{};
  for(var f in byF){ if(!inScope(f)) continue; var r=rrev(f); if(r&&r.pp){ np++; py[r.py]=1; } }
  var ys=Object.keys(py).sort();
  return '<span class="fa-note">Rent ÷ (county corn yield of the same practice × state price received), all USDA NASS: dryland rent over the dryland yield, irrigated over irrigated. Each county shows its own latest year with all three; '+(RREV_LATEST-3)+' to '+RREV_LATEST+' are colored, older ratios are hatched.'
    +(np?' '+fmt(np,0)+' '+(np===1?'county uses':'counties use')+' a preliminary '+ys.join(', ')+' price.':'')
    +(R.generated?' Cash rent file refreshed '+esc(R.generated)+'.':'')+' Every year for every county: open a county page and tap the rent share calculator.</span>';
}
function missingWhy(c,L,f){ if(L.key==='rent'){ var rr=get(c,'rent','nonirr'); if(rr&&rr.year&&RENT_LATEST&&rr.year<RENT_LATEST-3) return 'latest published rent is from '+rr.year; } if(L.key==='sob_over'&&ok(c.sob)&&get(c,'sob','share_over_one')==null) return 'fewer than ten crop years with a rated premium'; if((L.side&&!SIDE[L.side].done)||(L.sidecar&&!HEATD_DONE)) return 'loading'; if(L.side==='rentrev') return rrevWhy(f); if(L.side==='sales') return swhy(c,f); if(L.side) return L.side==='tenure'?'not published for this county (census suppression or no match)':L.side==='more'?(!SIDE.more.ok?(SIDE.more.why||'the file did not load'):L.key==='fr_spring'&&mv(f,'f',0)===-1?'no freeze after March 1 in most years':L.key==='fr_fall'&&mv(f,'f',1)===999?'no freeze before December in most years':'withheld or not published here; the county record says why'):'no data'; var lay=c[L.needs]; if(!lay) return 'no data'; if(lay.status!=='ok') return why(lay);
  if(L.key==='crp_peak') return 'peak enrollment under 100 acres';
  if(L.key==='crp_rate') return 'under 100 acres enrolled';
  if(L.key==='val_rtv'&&get(c,'value','flag')) return 'the census value moved against next door; see the county record';
  if(L.key==='val_rtv') return 'no same-year dry rent, a tenth or more of cropland irrigated, or cropland under half of land in farms';
  return 'withheld'; }

// ---------- county panel
var READS_P=null;
function loadReads(){ if(!READS_P) READS_P=fetch(DATA+'reads.json',{cache:'no-cache'}).then(function(r){return r.ok?r.json():null;}).catch(function(){return null;}).then(function(r){ READS=r; return r; }); return READS_P; }
// ---------- county panel: a strip of six figures, then three bands (money, risk, water and land).
// Every chart is drawn at the width it is shown at, so its text is real pixels, and every chart
// carries a title with units, labelled gridlines, named reference lines and printed values.
var LAST_PANEL=null, CHART_N=0, CW=520;
function ord(n){ var s=['th','st','nd','rd'], v=n%100; return Number(n).toLocaleString('en-US')+(s[(v-20)%10]||s[v]||s[0]); }
function sgn(v,k){ var t=Number(v).toFixed(k); if(Number(t)===0) t=Number(0).toFixed(k); return (Number(t)>0?'+':Number(t)<0?'−':'')+t.replace('-',''); }
function rh(v,k){ var m=Math.pow(10,k); return (Math.sign(v)*Math.round(Math.abs(v)*m+1e-9)/m).toFixed(k); }   // half away from zero, like the pipeline; toFixed alone rounds 2.135 down
function f1(v){ return rh(Number(v),1); }
function mUSD(x){ if(x==null) return '-'; var a=Math.abs(x); if(a>=1e9) return '$'+(x/1e9).toFixed(2)+' billion'; if(a>=1e6) return '$'+(x/1e6).toFixed(1)+' million'; return money(x); }
function niceTicks(lo,hi,n){
  if(!(hi>lo)){ var d=Math.abs(hi)||1; lo-=d/2; hi+=d/2; }
  var raw=(hi-lo)/(n||4), mag=Math.pow(10,Math.floor(Math.log(raw)/Math.LN10)), r=raw/mag;
  var step=(r<=1?1:r<=2?2:r<=2.5?2.5:r<=5?5:10)*mag, a=Math.floor(lo/step+1e-9)*step, b=Math.ceil(hi/step-1e-9)*step, t=[];
  for(var v=a; v<=b+step/2; v+=step) t.push(Math.round(v/step)*step);
  return t;
}
// o: {title, sub, kind:'bars'|'line', pts:[{x:'2013', v:number|null, partial:bool}], y0, ticks, cap,
//     fmtY(v), fmtV(v), refs:[{v, label}], top:k (label the k largest), last:bool, first:bool, note}
function chart(o){
  var P=o.pts.filter(function(p){return p.v!=null&&!isNaN(p.v);});
  if(P.length<2) return '';
  var W=CW, H=o.height||210, pl=48, pr=12, pt=14, pb=28, id='fa-hx'+(++CHART_N);
  var cap=o.cap||Infinity, vs=P.map(function(p){return Math.min(p.v,cap);}), rv=(o.refs||[]).map(function(r){return r.v;});
  var lo=o.y0!=null?o.y0:Math.min.apply(null,vs.concat(rv)), hi=Math.max.apply(null,vs.concat(rv));
  var T=o.ticks||niceTicks(lo,hi,4), yA=T[0], yB=Math.max(T[T.length-1],Math.min(hi,cap));   // a 53-week year still fits under fixed ticks
  var n=o.pts.length, iw=W-pl-pr, ih=H-pt-pb, bars=o.kind==='bars';
  var X=function(i){ return pl+(bars?iw*(i+0.5)/n:(n===1?iw/2:iw*i/(n-1))); };
  var Y=function(v){ return pt+ih*(1-(Math.max(yA,Math.min(v,yB))-yA)/(yB-yA)); };
  var fy=o.fmtY||function(v){return fmt(v,0);}, fv=o.fmtV||fy, s='';
  s+='<defs><pattern id="'+id+'" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" class="hb"/><line x1="0" y1="0" x2="0" y2="5" class="hl"/></pattern></defs>';
  T.forEach(function(t){ var y=Y(t).toFixed(1); s+='<line class="g" x1="'+pl+'" x2="'+(W-pr)+'" y1="'+y+'" y2="'+y+'"/><text class="yt" x="'+(pl-6)+'" y="'+(+y+4)+'" text-anchor="end">'+esc(fy(t))+'</text>'; });
  // x labels far enough apart to read
  var every=Math.max(1,Math.ceil(44/(iw/Math.max(1,n))));
  var lastX=-1e9, xl=[];
  o.pts.forEach(function(p,i){ if(i%every===0) xl.push(i); });
  if(xl[xl.length-1]!==n-1&&X(n-1)-X(xl[xl.length-1])>=44) xl.push(n-1);     // the last year too, if it has room
  xl.forEach(function(i){ var p=o.pts[i], ax=X(i), an=ax<pl+18?'start':ax>W-pr-18?'end':'middle'; s+='<text class="xt" x="'+ax.toFixed(1)+'" y="'+(H-8)+'" text-anchor="'+an+'">'+esc(p.x)+'</text>'; });
  // reference lines are named in the caption, where no bar or point can sit on top of the words
  (o.refs||[]).forEach(function(r){ var y=Y(r.v).toFixed(1); s+='<line class="rf" x1="'+pl+'" x2="'+(W-pr)+'" y1="'+y+'" y2="'+y+'"/>'; });
  var lab={}, C=P.filter(function(p){return !p.partial;});
  if(o.top){ C.filter(function(p){return p.v>0;}).sort(function(a,b){return b.v-a.v;}).slice(0,o.top).forEach(function(p){ lab[p.x]=1; }); }
  if(o.last&&C.length) lab[C[C.length-1].x]=1;
  if(o.first&&C.length) lab[C[0].x]=1;
  // labels are placed after every mark, largest first, and one that would overlap a placed label is dropped
  var LB=[], placed=[];
  function addLabel(x,y,txt,pri){ LB.push({x:x,y:y,t:txt,p:pri}); }
  if(bars){
    var bw=Math.max(2,Math.min(22,iw/n*0.72));
    o.pts.forEach(function(p,i){ if(p.v==null||isNaN(p.v)) return; var x=X(i)-bw/2, y=Y(p.v), y0=Y(Math.max(yA,0));
      s+='<rect class="b'+(p.partial?' p':'')+'" x="'+x.toFixed(1)+'" y="'+Math.min(y,y0).toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+Math.max(1,Math.abs(y0-y)).toFixed(1)+'"'+(p.partial?' style="fill:url(#'+id+')"':'')+'><title>'+esc(p.x+': '+fv(p.v)+(p.partial?' (so far)':''))+'</title></rect>';
      if(p.v>cap) s+='<path class="brk" d="M'+(x-2)+' '+(pt+7)+'l'+(bw+4)+' -5M'+(x-2)+' '+(pt+11)+'l'+(bw+4)+' -5"/>';
      if((lab[p.x]||p.v>cap)&&!p.partial&&p.v>0) addLabel(X(i),Math.min(y,y0)-4,p.x+': '+fv(p.v),p.v);
    });
  } else {
    var d='', pen=false;
    o.pts.forEach(function(p,i){ if(p.v==null||isNaN(p.v)){ pen=false; return; } d+=(pen?'L':'M')+X(i).toFixed(1)+' '+Y(p.v).toFixed(1); pen=true; });
    s+='<path class="ln" d="'+d+'"/>';
    o.pts.forEach(function(p,i){ if(p.v==null||isNaN(p.v)) return; var x=X(i), y=Y(p.v);
      s+='<circle class="dt'+(p.partial?' p':'')+'" cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+'" r="'+(p.partial?3.5:2.6)+'"><title>'+esc(p.x+': '+fv(p.v)+(p.partial?' (so far)':''))+'</title></circle>';
      if(lab[p.x]) addLabel(x,y-8,fv(p.v),p.v);
    });
  }
  LB.sort(function(a,b){return b.p-a.p;}).forEach(function(l){
    var w=l.t.length*6.2+4, x0=Math.max(pl,Math.min(W-pr-w,l.x-w/2)), y=Math.max(11,l.y), box=[x0,y-11,x0+w,y+2];
    if(placed.some(function(b){ return box[0]<b[2]&&box[2]>b[0]&&box[1]<b[3]&&box[3]>b[1]; })) return;
    placed.push(box); s+='<text class="vt" x="'+(x0+w/2).toFixed(1)+'" y="'+y.toFixed(1)+'" text-anchor="middle">'+esc(l.t)+'</text>';
  });
  var CP=C.length?C:P, hiP=CP.slice().sort(function(a,b){return b.v-a.v;})[0], lastP=CP[CP.length-1];
  var openP=P.filter(function(p){return p.partial;})[0];
  var aria=o.title+'. '+(o.sub||'')+'. Highest '+hiP.x+' '+fv(hiP.v)+'; latest complete '+lastP.x+' '+fv(lastP.v)+(openP?'; '+openP.x+' so far '+fv(openP.v):'')+'.';
  var key=(o.refs||[]).map(function(r){ return '<span class="k"><i class="dash"></i>'+esc(r.label)+'</span>'; }).join('')+(o.pts.some(function(p){return p.partial;})?'<span class="k"><i class="'+(bars?'hatch':'hollow')+'"></i>'+esc(o.partialKey||'so far this year, still open')+'</span>':'');
  return '<figure class="fa-chart"><figcaption><b>'+esc(o.title)+'</b>'+(o.sub?'<span>'+esc(o.sub)+'</span>':'')+(key?'<span class="keys">'+key+'</span>':'')+'</figcaption>'
    +'<svg viewBox="0 0 '+W+' '+H+'" width="'+W+'" height="'+H+'" role="img" aria-label="'+esc(aria)+'">'+s+'</svg>'
    +(o.note?'<p class="fa-ch-note">'+esc(o.note)+'</p>':'')+'</figure>';
}
// Finished drought years the record is short of (the 2024 hole, 2026-10-16). Named in every
// drought total, never skipped quietly. Per county from its series; across the Atlas from atlas.json.
function drMissing(Dr){
  if(!Dr) return [];
  if(Dr.missing_years) return Dr.missing_years.map(Number);
  var s=Dr.series||{}, out=[];
  if(!Dr.first_year||!Dr.last_full_year) return out;
  for(var y=+Dr.first_year;y<=+Dr.last_full_year;y++){ if(!s[y]||s[y].maps<40) out.push(y); }
  return out;
}
function yrsCov(a,b,miss){
  var m=(miss||[]).filter(function(y){return y>=a&&y<=b;});
  return a+'–'+b+(m.length?' except '+(m.length>1?m.slice(0,-1).join(', ')+' and '+m[m.length-1]:m[0]):'');
}
function natDrMissing(A){
  var d=A&&A.national&&A.national.drought; if(!d) return [];
  if(d.missing_years) return d.missing_years.map(Number);
  var by=d.county_weeks_d2_by_year||{}, ks=Object.keys(by).map(Number); if(!ks.length) return [];
  var out=[]; for(var y=Math.min.apply(null,ks);y<=+d.latest_full_year;y++){ if(by[y]==null) out.push(y); }
  return out;
}
function yearPts(series,fn,from,to,partialYear){
  var ks=Object.keys(series||{}).map(Number).filter(function(y){return !isNaN(y);}).sort(function(a,b){return a-b;});
  if(!ks.length) return [];
  var a=from||ks[0], b=to||ks[ks.length-1], out=[];
  for(var y=a;y<=b;y++){ var r=series[y]; out.push({x:String(y), v:r==null?null:fn(r,y), partial:partialYear===y}); }
  return out;
}
// one fact: label on its own line, then the figure, then what it is out of
function fact(label,value,sub,withheld){
  return '<div class="fa-f'+(withheld?' w':'')+'"><div class="k">'+esc(label)+'</div><div class="v">'+(withheld?'<span class="dim">'+esc(value)+'</span>':esc(value))+(sub?' <span class="s">'+esc(sub)+'</span>':'')+'</div></div>';
}
var NOTYET='not yet measured';
function facthead(t){ return '<div class="fa-fh">'+esc(t)+'</div>'; }
function band(id,title,facts,charts,na,arith){
  var cols=CW_COLS;
  return '<section class="fa-band" id="'+id+'" aria-labelledby="'+id+'-h"><h3 class="fa-band-h" id="'+id+'-h">'+esc(title)+'</h3>'
    +'<div class="fa-facts">'+facts+'</div>'
    +(charts.filter(Boolean).length?'<div class="fa-charts" style="grid-template-columns:repeat('+Math.min(cols,charts.filter(Boolean).length)+',minmax(0,1fr))">'+charts.join('')+'</div>':'')
    +(na.length?'<p class="fa-na"><b>Not available here:</b> '+na.map(function(x){return esc(x[0])+', '+esc(x[1]);}).join(' · ')+'</p>':'')
    +'<details class="fa-arith"><summary>How these are computed</summary><div class="body">'+arith+'</div></details></section>';
}
var CW_COLS=2;
function measure(){
  var box=$('fa-p-cards'), pw=(box&&box.clientWidth)||($('fa-panel').clientWidth-36)||520;
  CW_COLS=pw>=760?2:1; CW=Math.max(260,Math.floor((pw-(CW_COLS-1)*20)/CW_COLS));
}

// state comparison for the strip, from the index every visitor already has
var RENT_LATEST=null;
var METRICS={
  rent:function(c){ var r=get(c,'rent','nonirr'); if(!r||r.value==null) return null; if(r.year&&RENT_LATEST&&r.year<RENT_LATEST-3) return null; return r.value; },
  irr:function(c){ var r=get(c,'rent','irr'); return r&&r.value!=null&&(!r.year||!RENT_LATEST||r.year>=RENT_LATEST-3)?r.value:null; },
  value:function(c){ return get(c,'value','latest'); },
  valueRank:function(c){ return get(c,'value','flag')?null:get(c,'value','latest'); },
  yld:function(c){ var n=get(c,'yield','n'); return n!=null&&n<15?null:get(c,'yield','median'); },
  cost:function(c){ var x=get(c,'sob','loss_cost_last10'); return x==null?null:x*100; },
  heat:function(c){ return get(c,'heat','months','jul','recent','mean'); },
  rented:function(c,f){ return SIDE.tenure.ok?tenShare(f,'2022'):null; }
};
function stateStat(key,st,f){
  // a code with no boundary (a Connecticut planning region) is not ranked against the old counties
  if(!PATHS[f]) return null;
  if(SIDE.tenure.done&&!SIDE.tenure.ok) return null;     // without farm acres, Staten Island would be in the pool
  var vals=[], mine=null, yr=(key==='rent'||key==='irr')?get(ATLAS.counties[f],'rent',key==='rent'?'nonirr':'irr','year'):null;
  for(var g in ATLAS.counties){ var c=ATLAS.counties[g]; if(c.state!==st||!PATHS[g]) continue;
    if(yr&&get(c,'rent',key==='rent'?'nonirr':'irr','year')!==yr) continue;    // one survey year at a time
    var v=METRICS[key](c,g); if(v==null||isNaN(v)) continue; if(g===f) mine=v; if(!isFarm(g)) continue; if(key==='value'&&get(c,'value','flag')) continue; vals.push(v); }
  if(vals.length<(yr&&yr!==RENT_LATEST?10:3)) return null;     // five 2025 surveys in Nebraska are not a state benchmark
  vals.sort(function(a,b){return a-b;});
  var m=vals.length, med=m%2?vals[(m-1)/2]:(vals[m/2-1]+vals[m/2])/2;
  var inPool=mine!=null&&isFarm(f)&&!(key==='value'&&get(ATLAS.counties[f],'value','flag'));
  return {n:m, med:med, rank:inPool?vals.filter(function(x){return x>mine;}).length+1:null, ties:inPool?vals.filter(function(x){return x===mine;}).length:1};
}
function tile(id,label,value,unit,sub,st,fmed,stat){
  var rk=!stat||!stat.rank?'':rankWords([stat.rank,stat.n,stat.ties||1]);
  var cmp=stat?'<span class="c">'+esc(st)+' median '+esc(fmed(stat.med))+(rk?' · '+rk:'')+'</span>':'';
  return '<div class="fa-tile" id="'+id+'"><div class="t">'+esc(label)+'</div><div class="v">'+(value==null?'<span class="dim">-</span>':esc(value)+(unit?'<small>'+esc(unit)+'</small>':''))+'</div><div class="s">'+esc(sub||'')+'</div>'+cmp+'</div>';
}
function renderStrip(fips,c){
  var st=c.state, R=c.rent, V=c.value, Y=c['yield'], S=c.sob, j=get(c,'heat','months','jul'), h='';
  var rv=ok(R)&&R.nonirr?R.nonirr:null, sh=get(c,'water','irrigated_share_2022','share');
  var ia=get(c,'water','applied_2015','irrigated_acres'), ha=get(c,'water','irrigated_share_2022','harvested_acres');
  if(sh==null&&ia&&ha) sh=ia/ha;
  // Oct 19, 2026: a rent tile more than three survey years old shows n/a with its last year (the county page and sheet rule)
  var old_=function(r){ return !!(r&&r.year&&RENT_LATEST&&r.year<RENT_LATEST-3); }, OLDW=', more than three survey years old';
  if(R&&R.irr&&(!ok(R)||!R.nonirr||(sh!=null&&sh>=0.10))){
    var dryW=rv?(old_(rv)?' · dry last published '+rv.year:' · dry '+money(rv.value)):' · no dry rent published';
    h+=old_(R.irr)?tile('fa-t-rent','Cash rent, irrigated', null,'/ac', 'last published '+R.irr.year+OLDW+dryW, st, money, null)
      :tile('fa-t-rent','Cash rent, irrigated', money(R.irr.value),'/ac', R.irr.year+' county average'+dryW, st, money, stateStat('irr',st,fips));
  } else h+=old_(rv)?tile('fa-t-rent','Cash rent, non-irrigated', null,'/ac', 'last published '+rv.year+OLDW, st, money, null)
    :tile('fa-t-rent','Cash rent, non-irrigated', rv?money(rv.value):null,'/ac', rv?rv.year+' county average':why(R), st, money, rv?stateStat('rent',st,fips):null);
  h+=tile('fa-t-val','Land and buildings', ok(V)&&V.latest!=null?money(V.latest):null,'/ac', ok(V)?(V.flag?V.latest_year+' census · read with care: '+flagWords(V.flag,true):V.latest_year+' census, operators\' own estimate'):why(V), st, money, ok(V)?stateStat('value',st,fips):null);
  h+=tile('fa-t-yld','Corn yield, median', ok(Y)?f1(Y.median):null,' bu/ac', ok(Y)?Y.n+' published years, '+Y.first_year+'–'+Y.last_year:why(Y), st, f1, ok(Y)&&Y.n>=15?stateStat('yld',st,fips):null);
  var lc=ok(S)&&S.last10&&S.last10.loss_cost!=null?S.last10.loss_cost*100:null;
  h+=tile('fa-t-cost','Claims paid per $100 of coverage', lc!=null?'$'+rh(lc,2):null,'', lc!=null?S.last10.from+'–'+S.last10.to+', closed crop years':(ok(S)?'under the premium gate':why(S)), st, function(v){return '$'+rh(v,2);}, lc!=null?stateStat('cost',st,fips):null);
  var jr=j&&j.recent&&j.recent.mean!=null?j.recent:null;
  h+=tile('fa-t-heat','July night low, average', jr?f1(jr.mean):null,' °F', jr?jr.from+'–'+jr.to+(j.normal_1991_2020&&j.normal_1991_2020.mean!=null?' · normal '+f1(j.normal_1991_2020.mean)+' °F':''):why(get(c,'heat')), st, function(v){return f1(v)+' °F';}, jr?stateStat('heat',st,fips):null);
  h+=tile('fa-t-rented','Farmland rented','…','', '2022 census', st, pct, null);
  $('fa-p-strip').innerHTML=h;
}

function renderRead(fips,c){
  var rd=READS&&READS.counties&&READS.counties[fips], box=$('fa-p-read');
  if(!(rd&&rd.text&&rd.sha===c.sha)){ box.hidden=true; box.innerHTML=''; return; }
  box.innerHTML='<div class="fa-read clamp"><p>'+esc(rd.text)+'</p></div><button type="button" class="fa-more" hidden>Read all</button>';
  box.hidden=false;
  var p=box.querySelector('.fa-read'), b=box.querySelector('.fa-more');
  if(p.scrollHeight>p.clientHeight+4){ b.hidden=false; b.addEventListener('click',function(){ p.classList.remove('clamp'); b.hidden=true; }); }
  else p.classList.remove('clamp');
}

function renderPanel(fips,c){
  LAST_PANEL={fips:fips,c:c};
  measure(); CHART_N=0;
  $('fa-p-sub').textContent=(STATE_NAMES[c.state]||c.state)+' · FIPS '+fips;
  renderStrip(fips,c);
  var d=c;

  // ---- MONEY
  var f='', ch=[], na=[], R=c.rent, V=c.value, Y=c['yield'];
  f+=facthead('Cash rent');
  if(ok(R)){
    if(R.nonirr) f+=fact('Non-irrigated, '+R.nonirr.year, money(R.nonirr.value)+'/ac', 'county average, all land quality');
    if(R.nonirr_change10) f+=fact('Change '+R.nonirr_change10.from_year+' to '+R.nonirr_change10.to_year, sgn(R.nonirr_change10.pct,1)+'%', 'nominal');
    if(R.irr) f+=fact('Irrigated, '+R.irr.year, money(R.irr.value)+'/ac');
    if(R.pasture&&(!RENT_LATEST||R.pasture.year>=RENT_LATEST-3)) f+=fact('Pasture, '+R.pasture.year, money(R.pasture.value)+'/ac');
    var sr=d.rent&&d.rent.series_nonirr;
    if(sr&&Object.keys(sr).length>2){
      var rp=yearPts(sr,function(v){return v;}), gaps=rp.filter(function(p){return p.v==null;}).map(function(p){return p.x;});
      ch.push(chart({title:'Non-irrigated cash rent',sub:'$ per acre, county average, NASS',kind:'line',pts:rp,y0:0,fmtY:function(v){return '$'+fmt(v,0);},last:true,first:true,
        note:gaps.length?'No county survey in '+(gaps.length>1?gaps.slice(0,-1).join(', ')+' and '+gaps[gaps.length-1]:gaps[0])+'.':''}));
    }
  } else f+=fact('Cash rent',''+why(R),'',true);
  f+='<div class="fa-own" id="fa-rrev-slot"></div>';
  f+=facthead('Land value');
  if(ok(V)){
    if(V.latest!=null) f+=fact('Land and buildings, '+V.latest_year+' census', money(V.latest)+'/ac', 'what farm operators guessed their own land and buildings were worth; not a sale price');
    if(V.flag) f+=fact('Read with care', 'the '+V.latest_year+' census value '+flagWords(V.flag), 'the census figure counts buildings and small residential farms; the change, the rent ratio and the rank are not shown','',true);
    if(V.latest==null) f+=fact('Land and buildings, '+V.latest_year+' census',''+why(get(V,'values',V.latest_year)||{status:'suppressed'}),'',true);
    var older=Object.keys(V.values||{}).sort().filter(function(y){return String(y)!==String(V.latest_year)&&V.values[y].per_acre!=null;}).map(function(y){return y+': '+money(V.values[y].per_acre);});
    if(older.length) f+=fact('Earlier censuses', older.join(' · '));
    if(V.change&&V.change.pct!=null) f+=fact('Change '+V.change.from_year+' to '+V.change.to_year, sgn(V.change.pct,1)+'%', sgn(V.change.cagr_pct,1)+'% a year, nominal');
    var rtv=V.rent_to_value||{};
    if(rtv.pct!=null) f+=fact('Dry cropland rent ÷ census value of all farm real estate, '+rtv.year, fmt(rtv.pct,2)+'%', money(rtv.rent)+' ÷ '+money(rtv.value)+(rtv.cropland_share_pct!=null?'; cropland is '+rtv.cropland_share_pct+'% of land in farms':'')+'; the value includes buildings, pasture and woods; not a cap rate');
    else if(rtv.status) f+=fact('Dry rent ÷ census value',''+why(rtv),'',true);
  } else f+=fact('Land value',''+why(V),'',true);
  f+=facthead('Corn yield');
  if(ok(Y)){
    f+=fact('Median, '+Y.first_year+'–'+Y.last_year, f1(Y.median)+' bu/ac', Y.n+' published years, '+(irrShare(c)!=null&&irrShare(c)>=0.10?'irrigated and dryland combined':'all practices'));
    var ry5=recentYield(d['yield']);
    if(ry5) f+=fact(ry5.from+'-'+String(ry5.to).slice(2)+' average', f1(ry5.avg)+' bu/ac', 'average of '+ry5.used.join(', ')+'; '+ry5.n+' published years, the high ('+ry5.hi+') and low ('+ry5.lo+') dropped');
    f+=fact('Lowest published year', Y.worst.year+': '+f1(Y.worst.value)+' bu/ac', pct(Y.worst.share_of_median,0)+' of median');
    if(Y.slope!=null) f+=fact('Trend, '+(Y.window||'').replace('-','–'), sgn(Y.slope,1)+' bu/ac a year');
    else f+=fact('Trend',''+why({status:Y.trend_status||'withheld'}),'',true);
    if(d['yield']&&d['yield'].hist&&Object.keys(d['yield'].hist).length>2){
      ch.push(chart({title:'County corn yield',sub:'bushels per acre, NASS, all practices',kind:'line',pts:yearPts(d['yield'].hist,function(v){return v;}),
        refs:[{v:Y.median,label:'median '+f1(Y.median)+' bu/ac'}],fmtY:function(v){return fmt(v,0);},fmtV:f1,last:true}));
    }
  } else f+=fact('Corn yield',''+why(Y),'',true);
  f+=facthead('Who farms it')+'<div class="fa-own" id="fa-own-slot"><div class="fa-f"><div class="k">Loading the census and AFIDA files</div></div></div>';
  var arm='Cash rent: USDA NASS Cash Rents Survey county estimates, $/acre; the change is nominal, from the closest published year about ten years back. '
    +'Land value: USDA Census of Agriculture, "land and buildings, estimated market value per acre", the average of what operators reported. It is not a sale price or an appraisal. '
    +'Dry rent ÷ value is withheld where a tenth or more of cropland is irrigated, because the census value then carries the irrigation. '
    +'Corn yield: NASS county yields, every published year; the trend is a straight-line fit'+(ok(Y)&&Y.slope_ci95!=null?' ('+sgn(Y.slope,2)+' ± '+fmt(Y.slope_ci95,2)+' bu/ac a year at 95%, n '+Y.n+')':'')+'. '
    +'Who farms it: census land in farms by tenure; AFIDA foreign holdings as filed with USDA FSA. <a href="/farmland-atlas/methods#m-rent">Full method</a>';
  var money_band=band('fa-b-money','Money: rent, land value, yield',f,ch,na,arm);

  // ---- RISK
  f=''; ch=[]; na=[];
  var S=c.sob, Lo=c.loss, Dr=c.drought, H=c.heat, j=get(H,'months','jul'), a=get(H,'months','aug');
  f+=facthead('Crop insurance');
  if(ok(S)){
    var l10=S.last10||{};
    if(l10.loss_cost!=null) f+=fact('Claims paid per $100 of coverage, '+l10.from+'–'+l10.to, '$'+rh(l10.loss_cost*100,2), mUSD(l10.indemnity)+' paid on '+mUSD(l10.liability)+' insured');
    else f+=fact('Paid per $100 insured, last ten years',''+why(l10.status?l10:{status:'withheld: under $1M of premium'}),'',true);
    if(l10.ratio!=null) f+=fact('Loss ratio, '+l10.from+'–'+l10.to, r2(l10.ratio), 'claims ÷ total premium (farmer share plus federal subsidy)');
    var sameSpan=l10.from===S.first_year&&l10.to===S.last_year;
    if(S.loss_ratio_all!=null&&!sameSpan) f+=fact('Loss ratio, '+S.first_year+'–'+S.last_year, r2(S.loss_ratio_all), mUSD(S.total_indemnity)+' paid on '+mUSD(S.total_premium)+' premium');
    else if(S.loss_ratio_all==null) f+=fact('Loss ratio, '+S.first_year+'–'+S.last_year,''+why({status:S.loss_ratio_all_status||'withheld: under $1M of premium'}),'',true);
    var per=S.periods?Object.keys(S.periods).filter(function(k){return S.periods[k].ratio!=null;}):[];
    if(per.length>1) f+=fact('Loss ratio by period', per.map(function(k){return k.replace('-','–')+': '+r2(S.periods[k].ratio);}).join(' · '));
    if(S.years_over_one!=null) f+=fact('Years paying out more than premium', S.years_over_one+' of '+S.years_with_ratio, 'crop years with $1M or more of premium');
    else if(S.years_over_one_status) f+=fact('Years paying out more than premium',''+why({status:S.years_over_one_status}),'',true);
    if(S.worst_year) f+=fact('Worst year', String(S.worst_year.year), 'ratio '+r2(S.worst_year.ratio)+(S.worst_year.tied&&S.worst_year.tied.length?' ('+S.worst_year.tied.join(', ')+' also '+r2(S.worst_year.ratio)+')':''));
    if(S.partial) f+=fact(S.partial.year+' so far', mUSD(S.partial.indemnity)+' paid', 'on '+mUSD(S.partial.premium)+' premium. Claims are still being paid, so this year is left out above');
    var py=d.sob&&d.sob.per_year;
    if(py){ ch.push(chart({title:'Loss ratio by crop year',sub:'indemnity ÷ premium; bars above 3 are cut and labelled',kind:'bars',
        pts:yearPts(py,function(r){return r.ratio;},null,null,S.partial_year),y0:0,cap:3,ticks:[0,1,2,3],fmtY:function(v){return v.toFixed(1);},fmtV:function(v){return v.toFixed(2);},
        refs:[{v:1,label:'1.00 = paid out what premium took in'}],top:3,
        note:'Blank years had under $1M of premium.'})); }
  } else f+=fact('Crop insurance',''+why(S),'',true);
  if(ok(Lo)&&Lo.share_all&&Object.keys(Lo.share_all).some(function(k){return Lo.share_all[k]>0;})){
    var NM={heat_drought:'heat and drought',wet:'excess moisture',hail:'hail',wind:'wind',cold:'freeze',irrigation:'irrigation failure',price:'price decline',unassigned:'not assigned',other:'other'};
    var top3=Object.keys(Lo.share_all).filter(function(k){return Lo.share_all[k]>0;}).sort(function(x,y){return Lo.share_all[y]-Lo.share_all[x];}).slice(0,3);
    f+=fact('Largest causes of payouts, '+Lo.first_year+'–'+Lo.last_year, top3.map(function(k){return NM[k]+' '+shareWords(Lo.share_all[k]);}).join(' · '));
    var lp=Lo.periods?Object.keys(Lo.periods).filter(function(k){return Lo.periods[k].heat_drought_share!=null;}):[];
    if(lp.length) f+=fact('Heat and drought share of payouts, by period', lp.map(function(k){return k.replace('-','–')+': '+pct(Lo.periods[k].heat_drought_share,0);}).join(' · '), 'each period can hang on one or two bad years');
  }
  f+=facthead('Drought');
  if(ok(Dr)){
    var wk=Dr.weeks||{}, drm=drMissing(d.drought||Dr);
    f+=fact('Weeks with half the county or more in D2 (severe) drought or worse, '+yrsCov(Dr.first_year,Dr.last_full_year,drm), fmt(wk.d2,0)+' of '+fmt(wk.counted,0), fmt(wk.share_d2_pct,0)+'% of weeks, at least half the county in D2 or worse');
    var ds0=d.drought&&d.drought.series||{}, full=Object.keys(ds0).filter(function(y){return ds0[y].maps>=40;}), mx=Math.max.apply(null,full.map(function(y){return ds0[y].d2;}).concat([0]));
    if(mx>0){ var ties=full.filter(function(y){return ds0[y].d2===mx;}); f+=fact(ties.length>1?'Years with the most D2+ weeks':'Year with the most D2+ weeks', ties.join(', '), mx+' weeks'+(ties.length>1?' each':'')); }
    else f+=fact('Worst year','no week in D2 or worse since '+Dr.first_year);
    if(Dr.last5) f+=fact('Last five full years, '+yrsCov(Dr.last5.from,Dr.last5.to,drm), Dr.last5.d2+' weeks');
    if(drm.length) f+=fact('Left out', drm.join(', '), 'the Atlas copy of that year is incomplete, so it is not in any total here');
    if(Dr.partial_year) f+=fact(Dr.partial_year.year+' so far', Dr.partial_year.d2+' of '+Dr.partial_year.maps+' weeks');
    // full years and the running year only: a year the copy is short of is a gap, never a zero bar
    var ds=null; if(d.drought&&d.drought.series){ ds={}; Object.keys(d.drought.series).forEach(function(y){ var r=d.drought.series[y]; if(r.maps>=40||(Dr.partial_year&&+y===Dr.partial_year.year)) ds[y]=r; }); }
    if(ds&&mx>0){ ch.push(chart({title:'Weeks a year in severe drought or worse',sub:'at least half the county in D2+, U.S. Drought Monitor',kind:'bars',
        pts:yearPts(ds,function(r){return r.d2;},null,null,Dr.partial_year?Dr.partial_year.year:null),y0:0,ticks:[0,13,26,39,52],fmtY:function(v){return String(v);},
        refs:[{v:26,label:'26 weeks = half the year'}],top:2})); }
  } else f+=fact('Drought',''+why(Dr),'',true);
  f+=facthead('July night heat');
  if(ok(H)&&j){
    if(j.recent&&j.recent.mean!=null) f+=fact('July average low, '+j.recent.from+'–'+j.recent.to, f1(j.recent.mean)+' °F', j.normal_1991_2020&&j.normal_1991_2020.mean!=null?'1991–2020 normal '+f1(j.normal_1991_2020.mean)+' °F':'');
    if(j.trend&&j.trend.per_decade!=null) f+=fact('Trend since '+j.trend.from, sgn(j.trend.per_decade,2)+' °F a decade', (j.trend.direction==='no clear direction'?'no clear direction':j.trend.direction)+' (± '+Number(j.trend.ci95_per_decade).toFixed(2)+')');
    var tf=j.trend_full; if(tf&&tf.per_decade!=null){ var dr=sigDir(tf.per_decade,tf.ci95_per_decade); f+=fact('Trend since '+tf.from, sgn(tf.per_decade,2)+' °F a decade', (dr==='up'?'warming':dr==='down'?'cooling':'no clear direction')+' (± '+Number(tf.ci95_per_decade).toFixed(2)+')'); }
    var hot=0, ny=0, fd=null; if(j.decades) DECADES.forEach(function(k){ var x=j.decades[k]; if(!x) return; hot+=x.hot||0; ny+=x.n||0; if(fd==null&&x.n) fd=k; });
    if(ny) f+=fact('Julys averaging 70 °F or warmer', hot+' of '+ny, 'Julys on record since the '+fd);
    if(a&&a.recent&&a.recent.mean!=null) f+=fact('August average low, '+a.recent.from+'–'+a.recent.to, f1(a.recent.mean)+' °F');
    if(j.decades){ ch.push(chart({title:'July average low, by decade',sub:'°F, mean of daily lows, NOAA',kind:'line',
        partialKey:'this decade so far',
        pts:DECADES.map(function(dd,di){ var x=j.decades[dd]; return {x:dd, v:x&&x.n>=5?x.mean:null, partial:di===DECADES.length-1&&!!(x&&x.n<10)}; }),
        refs:j.normal_1991_2020&&j.normal_1991_2020.mean!=null?[{v:j.normal_1991_2020.mean,label:'1991–2020 normal '+fmt(j.normal_1991_2020.mean,1)+' °F'}]:[],
        fmtY:function(v){return fmt(v,0)+'°';},fmtV:function(v){return f1(v)+'°';},first:true,top:1,last:true})); }
  } else f+=fact('July night heat',''+why(H),'',true);
  var ar='Crop insurance: USDA RMA Summary of Business, every policy in the county, rainfall-index pasture plans left out. Loss ratio = indemnity ÷ total premium (farmer-paid plus subsidy). Paid per $100 insured = indemnity ÷ liability × 100. RMA prices premium from each county\'s own losses, so loss ratios drift toward the same level everywhere; paid per $100 insured is the better measure of how much ground has cost insurers. '
    +'A ratio prints only on $1M or more of premium, and the crop year still being settled is left out of every figure. Causes: RMA cause-of-loss files, closed crop years. '
    +'Heat and drought share: each period is the dollars paid for heat and drought over all dollars paid; one or two drought years can carry a whole period, and older decades had different insurance products. '
    +'Drought: a week counts when at least half the county was in D2 (severe) or worse on the Drought Monitor map. '
    +'Heat: NOAA nClimDiv county monthly mean of daily lows. A trend gets a direction only when its 95% interval excludes zero. <a href="/farmland-atlas/methods#m-loss">Full method</a>';
  var risk_band=band('fa-b-risk','Risk: insurance record, drought, night heat',f,ch,na,ar);

  // ---- WEATHER AND SEASON
  f=''; ch=[]; na=[];
  var Cl=c.climate, Fr=c.frost, St=c.storms;
  f+=facthead('Growing-season rain, April to September');
  if(ok(Cl)&&Cl.gs_normal_in!=null){
    f+=fact('1991–2020 normal', fmt(Cl.gs_normal_in,1)+' in', Cl.annual_normal_in!=null?'of '+fmt(Cl.annual_normal_in,1)+' in a year':'');
    var pn=function(x){ return x.pct_of_normal!=null?x.pct_of_normal+'% of normal':''; };
    if(Cl.gs_recent) f+=fact('Last ten seasons, '+Cl.gs_recent.from+'–'+Cl.gs_recent.to, fmt(Cl.gs_recent.mean_in,1)+' in', pn(Cl.gs_recent));
    if(Cl.gs_latest) f+=fact(String(Cl.gs_latest.year), fmt(Cl.gs_latest.in,1)+' in', pn(Cl.gs_latest));
    if(Cl.gs_driest) f+=fact('Driest season since 1991', Cl.gs_driest.year+': '+fmt(Cl.gs_driest.in,1)+' in', pn(Cl.gs_driest));
    if(Cl.gs_years_under_75pct) f+=fact('Seasons under 75% of normal', Cl.gs_years_under_75pct.n+' of '+Cl.gs_years_under_75pct.of, Cl.gs_years_under_75pct.from+'–'+Cl.gs_years_under_75pct.to);
    if(Cl.gs_cv_pct!=null) f+=fact('How far a typical season lands from normal', Cl.gs_cv_pct+'%', '1991–2020; a higher number is a less dependable season');
    if(Cl.gs_pct_status) f+=fact('Percent of normal',''+why({status:Cl.gs_pct_status}),'',true);
    if(Cl.gs_series){ ch.push(chart({title:'April–September rain, by season',sub:'inches, NOAA county average',kind:'bars',
        pts:yearPts(Cl.gs_series,function(v){return v;}),y0:0,refs:[{v:Cl.gs_normal_in,label:'1991–2020 normal '+fmt(Cl.gs_normal_in,1)+' in'}],
        fmtY:function(v){return fmt(v,0);},fmtV:function(v){return fmt(v,1)+' in';},top:2})); }
  } else f+=fact('Growing-season rain',''+why(ok(Cl)?{status:Cl.gs_status||'withheld'}:Cl),'',true);
  if(ok(Cl)&&Cl.jul_high&&Cl.jul_high.recent) f+=fact('July average high, '+Cl.jul_high.recent.from+'–'+Cl.jul_high.recent.to, f1(Cl.jul_high.recent.mean_f)+' °F', Cl.jul_high.normal_f!=null?'1991–2020 normal '+f1(Cl.jul_high.normal_f)+' °F':'');
  f+=facthead('Frost, season length and heat units');
  if(ok(Fr)){
    var ls=Fr.last_spring_freeze, fs=Fr.first_fall_freeze;
    if(ls) f+=fact('Last spring freeze, median', ls.median||(ls.censored==='before'?'before Mar 1':'-'), 'half of years froze later'+(ls.late?'; '+ls.late.years+' of '+ls.n+' on or after '+ls.late.on_or_after:'')+(ls.latest?'; latest '+ls.latest.date+', '+ls.latest.year:''));
    if(fs) f+=fact('First fall freeze, median', fs.median||(fs.censored==='after'?'after Nov 30':'-'), 'half of years froze earlier'+(fs.early?'; '+fs.early.years+' of '+fs.n+' on or before '+fs.early.on_or_before:'')+(fs.earliest?'; earliest '+fs.earliest.date+', '+fs.earliest.year:''));
    if(Fr.frost_free_days&&Fr.frost_free_days.median!=null) f+=fact('Frost-free days, median', (Fr.frost_free_days.at_least?'at least ':'')+Fr.frost_free_days.median, Fr.from+'–'+Fr.to+(Fr.frost_free_days.open_years?'; '+Fr.frost_free_days.open_years+' years ran past the Mar 1–Nov 30 window':''));
    else if(Fr.frost_free_days&&Fr.frost_free_days.status) f+=fact('Frost-free days',''+why(Fr.frost_free_days),'',true);
    if(Fr.gdd) f+=fact('Corn GDD, May 1 to Sep 30, median', fmt(Fr.gdd.median,0), (Fr.gdd.recent?'last ten years '+fmt(Fr.gdd.recent.mean,0)+'; ':'')+'86/50 method');
    if(Fr.hot_days) f+=fact('Days 95 °F or hotter, June to August', fmt(Fr.hot_days.per_year,1)+' a year', Fr.hot_days.recent?'last ten years '+fmt(Fr.hot_days.recent.per_year,1):'');
  } else f+=fact('Freeze dates and GDD',''+why(Fr),'',true);
  f+=facthead('Storm reports');
  if(ok(St)){
    f+=fact('Days with hail 1 inch or larger', fmt(St.hail_1in_days_per_year,1)+' a year', St.hail_1in_days+' days, '+St.from+'–'+St.to+(St.worst_hail_year?'; most in '+St.worst_hail_year.year+' ('+St.worst_hail_year.days+')':''));
    f+=fact('Days with hail 2 inches or larger', fmt(St.hail_2in_days_per_year,2)+' a year', St.hail_2in_days+' days');
    f+=fact('Days with wind 58 mph or more', fmt(St.wind_days_per_year,1)+' a year', St.wind_days+' days');
    f+=fact('Tornado tracks through the county', String(St.tornadoes), St.from+'–'+St.to);
  } else f+=fact('Storm reports',''+why(St),'',true);
  var awx='Rain and July highs: NOAA nClimDiv county monthly values, averaged over a 5 km grid; a season counts only when all six months are in. Normal = 1991–2020. '
    +'Freeze dates, GDD and hot days: NOAA nClimGrid daily county averages, 1996 on; a freeze is a county-average low of 32 °F or lower, roughly the day half the county froze. Low ground and frost pockets freeze later in spring and earlier in fall than these dates; station freeze tables will read later in spring and earlier in fall. Says little in mountain counties. '
    +'Storms: NOAA Storm Events reports filed against the county, 2010 on (the year the severe hail line became 1 inch). A report is where someone saw it: more people, more reports; a zero is no report, not no hail. <a href="/farmland-atlas/methods#m-weather">Full method</a>';
  var wx_band=(Cl&&Cl.status===NOTYET&&Fr&&Fr.status===NOTYET&&St&&St.status===NOTYET)?'':band('fa-b-wx','Weather: rain, frost, storms',f,ch,na,awx);
  var wxl=document.querySelector('.fa-bandnav a[href="#fa-b-wx"]'); if(wxl) wxl.hidden=!wx_band;     // no dead link before the first weather fetch

  // ---- WATER AND LAND
  f=''; ch=[]; na=[];
  var W=c.water, P=c.water_premium, E=c.energy, Wl=c.wells, C=c.crp, Pr=c.practices;
  f+=facthead('Water');
  if(ok(W)){
    var sh=W.irrigated_share_2022||{}, gw=W.groundwater_share_2015||{}, ap=W.applied_2015, tiny=ap&&ap.status&&/under 1,000/.test(ap.status);
    if(sh.share!=null&&sh.reported===false) f+=fact('Harvested cropland irrigated, 2022','none reported');
    else if(sh.share!=null) f+=fact('Harvested cropland irrigated, 2022', shareWords(irrShareOf(sh)), sh.irrigated_acres!=null?fmt(sh.irrigated_acres,0)+' of '+fmt(sh.harvested_acres,0)+' acres':'');
    else f+=fact('Harvested cropland irrigated, 2022',''+why(sh),'',true);
    var gwb=gw.basis==='IR'?'USGS all irrigation, golf courses included (no crop split for this county)':gw.basis==='IC'?'USGS crop irrigation':'';
    if(gw.share!=null&&!tiny) f+=fact('Irrigation water from groundwater, 2015', pct(gw.share,0), gwb);
    else if(gw.share==null&&!tiny) f+=fact('Irrigation water from groundwater, 2015',''+why(gw),'',true);
    if(ap&&ap.acre_ft_per_acre!=null) f+=fact('Water withdrawn per irrigated acre, 2015', fmt(ap.acre_ft_per_acre,2)+' acre-ft', gwb);
    else if(tiny) f+=fact('USGS 2015 water use','under 1,000 irrigated acres, too little to measure','',true);
  } else f+=fact('Water',''+why(W),'',true);
  var thin=ok(P)&&/^not called/.test(P.direction||'');
  if(ok(P)&&thin) f+=fact('Irrigated rent as a multiple of dry rent',''+P.direction+', so the multiple means little here','',true);
  if(ok(P)&&!thin){
    f+=fact('Irrigated rent as a multiple of dry rent, '+P.latest.year, Number(P.latest.ratio).toFixed(2)+'×', 'was '+Number(P.first.ratio).toFixed(2)+'× in '+P.first.year+'; '+P.direction);
    f+=fact('Irrigated minus dry rent, '+P.latest.year, money(P.latest.premium)+'/ac');
    if(d.water_premium&&d.water_premium.ratio){ ch.push(chart({title:'Irrigated rent as a multiple of dry rent',sub:'irrigated ÷ non-irrigated cash rent, same county, same year',kind:'line',
        pts:yearPts(d.water_premium.ratio,function(v){return v;}),y0:0,refs:[{v:1,label:'1.00× = irrigated rents for the same as dry'}],fmtY:function(v){return fmt(v,1)+'×';},fmtV:function(v){return Number(v).toFixed(2)+'×';},last:true,first:true})); }
  }
  if(ok(P)&&thin) f+=fact('Irrigated minus dry rent, '+P.latest.year, money(P.latest.premium)+'/ac');
  if(ok(Lo)&&(Lo.irrigation_failure_indemnity||0)>=10000) f+=fact('Insurance paid for irrigation failure', mUSD(Lo.irrigation_failure_indemnity), Lo.first_year+'–'+Lo.last_year);
  if(ok(Wl)&&Wl.kind==='state_register'){
    f+=facthead('Irrigation wells, '+Wl.register);
    f+=fact('Irrigation wells on record', fmt(Wl.irrigation_wells,0), Wl.rated_100gpm!=null&&Wl.rate_n?fmt(Wl.rated_100gpm,0)+' of the '+fmt(Wl.rate_n,0)+' with a recorded rate pump 100 gpm or more':'');
    if(Wl.depth_median_ft!=null) f+=fact('Median well depth', fmt(Wl.depth_median_ft,0)+' ft', 'of '+fmt(Wl.depth_n,0)+' with a depth');
    if(Wl.level_median_ft!=null) f+=fact(/first water/.test(Wl.level_kind||'')?'Median depth to first water when drilled':'Median water level when drilled', fmt(Wl.level_median_ft,0)+' ft below ground', 'of '+fmt(Wl.level_n,0)+'; '+(Wl.level_kind||'as recorded')+', across every decade of drilling, not today\'s level');
    if(/Michigan|Arizona/.test(Wl.register||'')) f+=fact('Read with care', /Michigan/.test(Wl.register)?'the register counts lawn and garden irrigation wells with farm wells':'a well counts when irrigation is one of its listed uses, domestic included','the 100 gpm count is the better farm signal','',true);
    var dk=Object.keys(Wl.by_decade||{}).sort(); if(dk.length) f+=fact('Completed by decade', dk.map(function(k){return k+' '+Wl.by_decade[k];}).join(' · '));
  } else if(ok(Wl)){
    if(Wl.wells!=null){
      f+=facthead('Wells, Nebraska register');
      f+=fact('Irrigation wells, not decommissioned', fmt(Wl.irrigation_active,0), 'of '+fmt(Wl.wells,0)+' registered wells, all uses');
      if(Wl.depth_median_ft!=null) f+=fact('Median well depth', fmt(Wl.depth_median_ft,0)+' ft');
      if(Wl.static_median_ft!=null) f+=fact('Median water level when drilled', fmt(Wl.static_median_ft,0)+' ft below ground', 'measured at completion, not today');
    } else {
      f+=facthead('Water rights, Kansas register');
      f+=fact('Active irrigation rights', fmt(Wl.irrigation_active,0), 'of '+fmt(Wl.active,0)+' active points of diversion');
      if(Wl.priority_year_median!=null) f+=fact('Median priority year', String(Wl.priority_year_median), 'older rights are served first in a shortage');
    }
  } else na.push(['Wells and water rights', why(Wl)]);
  if(ok(Pr)){
    f+=facthead('Drainage and tillage, 2022 census');
    var prf=function(label,x,none){ if(!x) return; if(x.reported===false) f+=fact(label,'none reported'); else if(x.share!=null) f+=fact(label, shareWords(pracShare(Pr,x))+' of cropland', fmt(x.acres,0)+' acres'); else f+=fact(label,''+why(x),'',true); };
    prf('Drained by tile',Pr.tile);
    // no 2017-to-2022 tile change: Iowa's statewide census total fell 8% (14.1M to 13.0M acres) while tile is
    // almost never pulled; a county's change measures who answered the census, not drainage put in
    prf('Drained by ditches',Pr.ditch);
    prf('Farmed no-till',Pr.notill);
    prf('Other conservation tillage',Pr.reduced);
    prf('Cover crops (CRP excluded)',Pr.cover);
  } else na.push(['Tile drainage and tillage', Pr?why(Pr):'not loaded into the Atlas yet']);
  var Lv=c.livestock;
  if(ok(Lv)){
    f+=facthead('Livestock and pasture, 2022 census');
    var lvf=function(label,x,unit){ if(!x) return; if(x.none_reported) f+=fact(label,'none reported'); else if(x.value!=null) f+=fact(label, fmt(x.value,0)+(unit||'')); else f+=fact(label,''+why(x),'',true); };
    lvf('Cattle and calves',Lv.cattle,' head');
    if(Lv.cattle_change) f+=fact('Cattle, '+Lv.cattle_change.from+' to '+Lv.cattle_change.to, sgn(Lv.cattle_change.pct,1)+'%', fmt(Lv.cattle_change.from_head,0)+' → '+fmt(Lv.cattle_change.to_head,0)+' head');
    if(Lv.cattle_per_1000ac!=null) f+=fact('Cattle per 1,000 acres in farms', fmt(Lv.cattle_per_1000ac,1));
    lvf('Beef cows',Lv.beef_cows,' head'); lvf('Milk cows',Lv.milk_cows,' head'); lvf('Cattle on feed',Lv.on_feed,' head');
    lvf('Hogs and pigs',Lv.hogs,' head'); lvf('Permanent pasture and rangeland',Lv.pasture,' acres');
  } else if(Lv&&Lv.status!==NOTYET) na.push(['Livestock', why(Lv)]);
  f+=facthead('Solar and wind');
  if(ok(E)){
    var op=E.operable||{}, pr=E.proposed||{}, ptot=(pr.solar||0)+(pr.wind||0)+(pr.storage||0);
    f+=fact('Operating, plants of 1 MW or more', fmt(op.solar,0)+' MW solar · '+fmt(op.wind,0)+' MW wind', 'EIA Form 860 '+(E.year||''));
    f+=fact('Proposed to EIA', ptot?fmt(pr.solar,0)+' MW solar · '+fmt(pr.wind,0)+' MW wind · '+fmt(pr.storage,0)+' MW batteries':'none');
  } else na.push(['Solar and wind', why(E)]);
  if(ok(C)){
    f+=facthead('Conservation Reserve (CRP)');
    if(C.latest&&C.latest.acres!=null) f+=fact('Enrolled, '+C.latest.year, fmt(C.latest.acres,0)+' acres', C.share_of_cropland&&C.share_of_cropland.pct!=null?fmt(C.share_of_cropland.pct,1)+'% of harvested cropland plus CRP':'');
    if(C.expiring_next3) f+=fact('Expiring FY'+C.expiring_next3.from+'–'+C.expiring_next3.to, fmt(C.expiring_next3.acres,0)+' acres', (function(x){ var ce=x.acres!=null&&C.latest&&C.latest.acres?x.acres/C.latest.acres:(x.share_of_enrolled_pct!=null?x.share_of_enrolled_pct/100:null); return ce==null?'':shareWords(ce)+' of what is enrolled'; })(C.expiring_next3));
    if(C.rate&&C.rate.usd_per_acre!=null) f+=fact('Average CRP rental payment, FY'+C.rate.year, money(C.rate.usd_per_acre)+'/ac', 'averaged over every contract in force, some signed 10 to 15 years ago; not today\'s offer'+(ok(c.rent)&&c.rent.nonirr?'. County dry cash rent '+money(c.rent.nonirr.value)+'/ac in '+c.rent.nonirr.year:''));
    else if(C.rate&&C.rate.status) f+=fact('Average CRP rental payment',''+why(C.rate),'',true);
  } else na.push(['CRP', why(C)]);
  var aw='Irrigated share: 2022 Census of Agriculture. Groundwater share and water withdrawn: USGS 2015 county water use; not shown under 1,000 irrigated acres. '
    +'Rent multiple: irrigated ÷ non-irrigated cash rent in the same survey year, so general rent inflation cancels out; its direction is called only when the 95% interval of the fitted trend excludes zero'+(ok(P)&&P.ratio_slope_per_year!=null?' ('+sgn(P.ratio_slope_per_year,4)+' ± '+fmt(P.ratio_slope_ci95,4)+' a year, '+P.n_pairs+' paired years)':'')+'. '
    +'Wells and rights: the Nebraska DNR and Kansas DWR registers. Energy: EIA Form 860. Tile, ditches, tillage and cover crops: 2017 and 2022 Census of Agriculture, as shares of the county\'s cropland; a share over 100% is withheld because the census counts drainage on all land in farms (<a href="/farmland-atlas/methods#m-practices">method</a>). <a href="/farmland-atlas/methods#m-water">Full method</a>';
  var water_band=band('fa-b-water','Water and land',f,ch,na,aw);

  $('fa-p-cards').innerHTML=money_band+risk_band+wx_band+water_band+nextDoor(fips,c);
  $('fa-p-cards').querySelectorAll('#fa-b-nb button.fa-link').forEach(function(b){ b.addEventListener('click',function(){ select(b.getAttribute('data-fips')); }); });
}
var NBCOLS=[
  ['Dry rent','$/acre',function(c){return METRICS.rent(c);},function(v){return money(v);},'nonirr'],
  ['Irrigated rent','$/acre',function(c){return METRICS.irr(c);},function(v){return money(v);},'irr'],
  ['Land value','$/acre, 2022',function(c){return METRICS.value(c);},function(v){return money(v);}],
  ['Corn yield','median, bu/ac',function(c){return METRICS.yld(c);},function(v){return f1(v);}],
  ['Claims paid','per $100 of coverage',function(c){return METRICS.cost(c);},function(v){return '$'+rh(v,2);}],
  ['July low','°F, last 10 yrs',function(c){return METRICS.heat(c);},function(v){return f1(v);}],
  ['Tile','share of cropland',function(c){return get(c,'practices','tile');},shareWords],
  ['Irrigated','share of cropland',function(c){return get(c,'water','irrigated_share_2022','share');},shareWords],
  ['Drought','share of weeks in D2+',function(c){var x=get(c,'drought','weeks','share_d2_pct'); return x==null?null:x/100;},function(v){return pct(v,0);}]
];
function nextDoor(fips,d){
  var c=ATLAS.counties[fips]; if(!c||!PATHS[fips]) return '';
  var nb=neighbours(fips); if(!nb.length) return '<section class="fa-band" id="fa-b-nb"><h3 class="fa-band-h">Next door</h3><p class="fa-na">This county shares no border with another county on the map.</p></section>';
  var rows=[fips].concat(nb.slice().sort(function(a,b){ var A=ATLAS.counties[a], B=ATLAS.counties[b]; return (A.state+A.name)<(B.state+B.name)?-1:1; }));
  var cols=NBCOLS.filter(function(k){ return rows.some(function(f){ var v=k[2](ATLAS.counties[f]); return v!=null&&!isNaN(v); }); });
  function yrOf(k,g){ return k[4]?get(g,'rent',k[4],'year'):null; }
  function baseYr(k){ return k[4]?RENT_LATEST:null; }     // the newest survey; an older one is tagged, not compared
  function shown(k,v){ return Number(String(k[3](v)).replace(/[^0-9.\-]/g,'')); }     // rank on what the reader sees
  function pool(k,list){ return list.filter(function(x){ var g=ATLAS.counties[x], v=k[2](g); return v!=null&&!isNaN(v)&&(!k[4]||yrOf(k,g)===baseYr(k)); }).map(function(x){ return shown(k,k[2](ATLAS.counties[x])); }); }
  var th='<tr><th>County</th>'+cols.map(function(k){ return '<th class="n">'+esc(k[0])+'<span class="sc">'+esc(k[1])+'</span></th>'; }).join('')+'</tr>';
  var body=rows.map(function(f){ var g=ATLAS.counties[f], me=f===fips;
    return '<tr'+(me?' class="me"':'')+'><td>'+(me?esc(shortName(g,'~')):'<button type="button" class="fa-link" data-fips="'+f+'">'+esc(shortName(g,c.state))+'</button>')+'</td>'+cols.map(function(k){
      var v=k[2](g); if(v==null||isNaN(v)) return '<td class="n">n/a</td>';
      var y=yrOf(k,g), extra=k[4]&&y!==baseYr(k)?' <span class="yr">'+esc(y)+'</span>':'', rk='';
      if(me&&(!k[4]||y===baseYr(k))){ var vals=pool(k,rows), sv=shown(k,v);
        if(vals.length>1){ var r=vals.filter(function(x){return x>sv;}).length+1, t=vals.filter(function(x){return x===sv;}).length, n=vals.length;
          if(t<n) rk='<span class="rk">'+(t>1?'tied ':'')+(r===1?'highest':r+t-1===n?'lowest':ord(r)+' of '+n)+'</span>'; } }
      return '<td class="n">'+esc(k[3](v))+extra+rk+'</td>'; }).join('')+'</tr>'; }).join('');
  var med='<tr class="med"><td>Median of the '+nb.length+' next door</td>'+cols.map(function(k){
    var vals=nb.filter(function(f){ var g=ATLAS.counties[f], v=k[2](g); return v!=null&&!isNaN(v)&&(!k[4]||yrOf(k,g)===baseYr(k)); }).map(function(f){ return k[2](ATLAS.counties[f]); }).sort(function(a,b){return a-b;});
    if(!vals.length) return '<td class="n">n/a</td>'; var m=vals.length, md=m%2?vals[(m-1)/2]:(vals[m/2-1]+vals[m/2])/2; return '<td class="n">'+esc(k[3](md))+(m<3?'<span class="rk">'+m+' '+(m===1?'county':'counties')+'</span>':'')+'</td>'; }).join('')+'</tr>';
  return '<section class="fa-band" id="fa-b-nb" aria-labelledby="fa-b-nb-h"><h3 class="fa-band-h" id="fa-b-nb-h">Next door: the counties that share a border</h3>'
    +'<div class="tblscroll"><table class="fa-table fa-nbt"><thead>'+th+'</thead><tbody>'+body+med+'</tbody></table></div>'
    +'<p class="fa-na">Rank counts this county and its neighbors with a figure, at the precision shown. A rent from another survey year carries its year and is left out of the rent rank and median. Across a state line, rent and yield come from each state\'s own survey.</p></section>';
}
// the recent yield level: the last five years of the newest county series, the high and low dropped
// (4 published: the middle two); fewer than 4 published, none. The county's own median runs 18 years
// against a trend of +3 bu a year, so it sits below what the ground grows now.
// "fell 28% while the 8 counties next door rose a median 27%"; a jump reads the same way up
function flagWords(fl,short){ var dir=fl.dir||'fell', nb=fl.nb_pct>=0?'rose a median '+Math.round(fl.nb_pct)+'%':'fell a median '+Math.round(Math.abs(fl.nb_pct))+'%';
  return dir+' '+Math.round(Math.abs(fl.own_pct))+'% from 2017 while '+(short?'next door ':'the '+fl.n+' counties next door ')+nb; }
function recentYield(y){
  if(!y||!y.hist) return null;
  var last=y.last_year, yrs=[]; if(!last) return null;
  if(RENT_LATEST&&last<RENT_LATEST-3) return null;
  for(var k=last-4;k<=last;k++) if(y.hist[k]!=null) yrs.push(k);
  if(yrs.length<4) return null;
  var vals=yrs.map(function(k){return {y:k,v:y.hist[k]};}).sort(function(a,b){return a.v-b.v;}), drop=[];
  // five years: drop the high and the low; four: the same, the middle two. Dropping only the low
  // leaned high (Anderson SC read 103.0 bu where the middle two average 75.9; panel 9/19)
  drop=[vals[0].y,vals[vals.length-1].y]; vals=vals.slice(1,vals.length-1);
  var avg=vals.reduce(function(a,b){return a+b.v;},0)/vals.length;
  var byv=yrs.map(function(k){return {y:k,v:y.hist[k]};}).sort(function(a,b){return a.v-b.v;});
  return {from:last-4,to:last,avg:avg,n:yrs.length,used:vals.map(function(x){return x.y;}).sort(),dropped:drop,lo:byv[0].y,hi:byv[byv.length-1].y};
}
function irrShare(c){ var s=get(c,'water','irrigated_share_2022','share'); return s==null?null:s; }
function renderNoDetail(fips,whyNot){
  $('fa-p-sub').textContent='FIPS '+fips;
  $('fa-p-strip').innerHTML='';
  var rb=$('fa-p-read'); rb.hidden=true; rb.innerHTML='';
  $('fa-p-cards').innerHTML='<p class="fa-note" style="margin:0">'+esc(whyNot)+'</p>';
}
function renderRentShare(fips){
  loadSide('rentrev').then(function(){
    var slot=$('fa-rrev-slot'); if(SEL!==fips||!slot) return;
    var R=SIDE.rentrev, r=rrev(fips), h='';
    if(!R.ok) h=fact('Rent as a share of corn gross',''+R.why,'',true);
    else if(r&&r.p!=null) h=fact('Rent as a share of corn gross, '+r.py, Number(r.p).toFixed(1)+'%', (r.rk==='irr'?'irrigated':'non-irrigated')+' rent ÷ ('+({nonirr:'dryland corn yield',irr:'irrigated corn yield',all:'all-practice corn yield, no irrigated corn reported'}[r.pb]||'corn yield')+' × state price received)'+(r.pp?'; the '+r.py+' price is preliminary':''));
    else if(r&&r.pw) h=fact('Rent as a share of corn gross',r.pw+' ('+r.pwy+')','',true);
    else if(r) h=fact('Rent as a share of corn gross','no county corn yield published, so no ratio','',true);
    slot.innerHTML=h;
  });
}
function renderOwnership(fips){
  renderRentShare(fips);
  Promise.all([loadSide('tenure'),loadSide('afida')]).then(function(){
    if(SEL!==fips) return;
    var T=SIDE.tenure, A=SIDE.afida, h='', tc=T.ok&&T.d.counties&&T.d.counties[fips], s22=tenShare(fips,'2022');
    if(tc){
      // 2022 only: the county files for 1997-2017 add up to well under the state totals (IL 19.3M vs 27.0M acres in 2017)
      if(s22!=null){ var p=tc.y['2022']; h+=fact('Land rented from others, 2022', pct(s22,0), fmt(p[1],0)+' of '+fmt(p[0]+p[1],0)+' acres owned or rented by farms'); }
      else h+=fact('Land rented from others, 2022','suppressed by NASS for this county','',true);
      var s02=tenShare(fips,'2002');
      // no 2002-to-2022 change: owned plus rented acres jump by a median 1.77x from the 2017 to the 2022 census file, so the two are not the same count
    } else h+=fact('Land in farms rented', T.ok?'not published for this county':''+T.why,'',true);
    if(A.ok){
      var ac=afidaAcres(fips), ly=A.n.latest_year, rec=A.d[fips], top=rec&&rec.top&&rec.top[0];
      h+=fact('Held by foreign persons, '+ly, ac?fmt(ac,0)+' acres':'none disclosed', 'agricultural land, as filed under AFIDA');
      if(ac&&top&&top[0]) h+=fact('Largest holder country', /^999/.test(String(top[0]))?'No predominant country':/^998/.test(String(top[0]))?'No country listed':String(top[0]).toLowerCase().replace(/\b[a-z]/g,function(x){return x.toUpperCase();}));
    } else h+=fact('Held by foreign persons',''+A.why,'',true);
    h+='<p class="fa-na" style="grid-column:1/-1">Rented vs owner-farmed since 1997 for every state is in the national picture below the map. More on foreign-held land in <a href="#foreign">the national picture</a>.</p>';
    var slot=$('fa-own-slot'); if(slot) slot.innerHTML=h;
    var t=$('fa-t-rented'), c=ATLAS.counties[fips];
    if(t&&c){ var stat=s22!=null?stateStat('rented',c.state,fips):null;
      t.outerHTML=tile('fa-t-rented','Farmland rented', s22!=null?pct(s22,0):null,'', s22!=null?'2022 census, share of land in farms':'not published', c.state, function(v){return pct(v,0);}, stat); }
  });
}
// ---------- the full county record under the map (the old map's panel, kept: the new view's map picks the county)
var PANEL_HTML='<section class="fa-panel" id="fa-panel" hidden>'
  +'<p class="sr-only" id="fa-p-status" role="status"></p>'
  +'<div class="fa-p-head"><div><h2 id="fa-p-name" tabindex="-1">-</h2><div class="fa-sub" id="fa-p-sub"></div></div>'
  +'<div class="fa-ptools"><button type="button" id="fa-p-copy">Copy link</button><button type="button" id="fa-p-map">Back to the map</button><a id="fa-p-print" href="/farmland-atlas/sheet" target="_blank" rel="noopener">Printable county sheet</a><a id="fa-p-page" href="/farmland-atlas/states/">All counties by state</a><a id="fa-p-scout" href="/field-scout">Scout a field in this county</a><a id="fa-p-cmp" href="/farmland-atlas/compare">Compare counties</a><span class="fa-note" id="fa-p-copied" role="status"></span></div></div>'
  +'<div class="fa-strip" id="fa-p-strip"></div><div id="fa-p-read" hidden></div>'
  +'<nav class="fa-bandnav" aria-label="County sections"><a href="#fa-b-money">Money</a><a href="#fa-b-risk">Risk</a><a href="#fa-b-wx">Weather</a><a href="#fa-b-water">Water and land</a><a href="#fa-b-nb">Next door</a></nav>'
  +'<div id="fa-p-cards"></div></section>';
function panelBox(){
  if($('fa-panel')) return $('fa-panel');
  var host=HOST.panelHost&&HOST.panelHost(); if(!host) return null;
  host.innerHTML=PANEL_HTML;
  $('fa-p-map').addEventListener('click',function(){ if(HOST.toMap) HOST.toMap(); });
  $('fa-p-copy').addEventListener('click',function(){ var u=location.href, done=function(ok){ $('fa-p-copied').textContent=ok?'Link copied':'Copy this address: '+u; setTimeout(function(){ $('fa-p-copied').textContent=''; },4000); };
    if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(u).then(function(){done(true);},function(){done(false);}); else done(false); gaEvent('atlas_copy',{fips:SEL}); });
  host.querySelectorAll('.fa-bandnav a').forEach(function(a){ a.addEventListener('click',function(e){ e.preventDefault(); var t=$(a.getAttribute('href').slice(1)); if(t) t.scrollIntoView({behavior:'smooth',block:'start'}); }); });
  return $('fa-panel');
}
// a county named in a table or the next-door list: the map picks it, and its record opens here
function select(fips,how){ if(HOST.pick) HOST.pick(fips); openPanel(fips,how); }
function openPanel(fips,how){
  var c=ATLAS.counties[fips]; if(!c) return;
  var panel=panelBox(); if(!panel) return;
  SEL=fips; panel.hidden=false;
  $('fa-p-name').textContent=cname(c);
  $('fa-p-sub').textContent='Loading the county file';
  $('fa-p-strip').innerHTML='';
  var rb=$('fa-p-read'); rb.hidden=true; rb.innerHTML='';
  $('fa-p-cards').innerHTML='';
  var pl=$('fa-p-print'); if(pl) pl.href='/farmland-atlas/sheet#'+fips;
  pageLink(fips);
  var moved=false, mv=function(){ moved=true; };
  function settle(){ if(how!=='link') return; if(moved||SEL!==fips) return; var t=panel.getBoundingClientRect().top; if(Math.abs(t)>24) panel.scrollIntoView({block:'start'}); }
  if(how==='link'){ ['wheel','touchstart','keydown'].forEach(function(e){ window.addEventListener(e,mv,{once:true,passive:true}); }); }
  else panel.scrollIntoView({behavior:'smooth',block:'start'});
  var done=false, slow=setTimeout(function(){ if(!done&&SEL===fips) $('fa-p-sub').textContent='Still loading: the county file is slow. It will appear here when it arrives.'; },8000);
  var net=false;
  // the outlines are only for the next-door list and the Field Scout link: fetched with the record, never on first paint
  Promise.all([fetch(DATA+'counties/'+fips+'.json',{cache:'no-cache'}).then(function(r){ if(!r.ok&&r.status!==404) net=true; return r.ok?r.json():null;}).catch(function(){ net=true; return null;}), loadGeo(), loadSide('tenure')]).then(function(res){
    var d=res[0];
    done=true; clearTimeout(slow);
    if(SEL!==fips) return;             // a later click won
    var ps=$('fa-p-scout'); if(ps) ps.href=scoutHref(fips);
    var whyNot=d?null:net?'The county file did not load: the connection dropped. Tap the county again to retry.':'The detail file for this county is not published yet. It appears after the next build.';
    if(d&&d.generated!==ATLAS.generated){ d=null; whyNot='The detail file for this county is from another build. Reload the page for the current one.'; }
    if(d){ renderPanel(fips,d); renderOwnership(fips); loadReads().then(function(){ if(SEL===fips){ renderRead(fips,d); settle(); } }); }
    else { LAST_PANEL=null; renderNoDetail(fips,whyNot); }
    renderScatters(); settle();
    $('fa-p-status').textContent=cname(c)+' loaded';
    if(how==='link') try{ $('fa-p-name').focus({preventScroll:true}); }catch(e){}
  });
  gaEvent('atlas_county',{fips:fips});
}
var GEO_P=null;
function loadGeo(){
  if(!GEO_P) GEO_P=fetch(DATA+'counties.geo.json').then(function(r){ return r.ok?r.json():null; }).catch(function(){ return null; }).then(function(g){ GEO=g||{features:[]}; return GEO; });
  return GEO_P;
}
// redraw the charts at the new width when the window changes enough to matter
var RZ=null;
window.addEventListener('resize',function(){ clearTimeout(RZ); RZ=setTimeout(function(){ if(!LAST_PANEL||SEL!==LAST_PANEL.fips) return; var old=CW, oc=CW_COLS; measure(); if(CW_COLS!==oc||Math.abs(CW-old)>150){ renderPanel(LAST_PANEL.fips,LAST_PANEL.c); renderOwnership(LAST_PANEL.fips); if(READS) renderRead(LAST_PANEL.fips,LAST_PANEL.c); } },250); });

// ---------- thesis
function renderThesis(){
  var T=ATLAS.thesis_test; if(!T||T.status!=='ok'){ $('fa-thesis').hidden=true; return; }
  $('fa-thesis').hidden=false;
  $('fa-thesis-claim').textContent='The claim under test: '+(T.claim||'');
  $('fa-thesis-verdict').textContent=T.verdict||'No verdict.';
  var tb=$('fa-thesis-table').querySelector('tbody'), h='';
  var tests=T.tests.slice().sort(function(a,b){ return (a.scope==='within_state'?0:1)-(b.scope==='within_state'?0:1); });
  tests.forEach(function(t){
    var ws=t.scope==='within_state', scope=ws?'within its state':'all counties';
    if(t.status!=='ok'){ h+='<tr><td>'+esc(t.x)+'<span class="sc">'+scope+'</span></td><td class="n">'+t.n+'</td><td class="n" colspan="3" style="text-align:left;color:var(--text-muted)">'+esc(t.status.replace(/^withheld:\s*/,''))+'</td></tr>'; return; }
    var pc=t.p_corrected, pcs=pc<0.001?'under 0.1%':pc>=1?'100% (capped)':fmt(pc*100,1)+'%';
    var f=t.fifths||{}, u=ws?' vs state':'';
    h+='<tr'+(ws?' class="lead"':'')+'><td>'+esc(t.x)+'<span class="sc">'+scope+'</span></td><td class="n">'+t.n+'</td><td class="n">'+sgn(t.r,2)+'</td><td class="n">'+pcs+'</td><td class="n">'+(f.coolest_mean_slope!=null&&f.hottest_mean_slope!=null?sgn(f.coolest_mean_slope,2)+' → '+sgn(f.hottest_mean_slope,2)+u:'n/a')+'</td></tr>';
  });
  tb.innerHTML=h;
}
function renderByState(){
  var bs=get(ATLAS,'national','heat_by_state'); if(!bs){ $('fa-bystate').hidden=true; return; }
  var h='', keys=Object.keys(bs).sort(function(a,b){ return (STATE_NAMES[a]||a)<(STATE_NAMES[b]||b)?-1:1; });
  keys.forEach(function(st){ var v=bs[st];
    h+='<tr'+(STATE&&st===STATE?' class="lead"':'')+'><td>'+esc(STATE_NAMES[st]||st)+'</td><td class="n">'+v.warming+' of '+v.counties+'</td><td class="n">'+(v.warming_full!=null?v.warming_full+' of '+v.counties_full:'n/a')+'</td><td class="n">'+sgn(v.median_trend_per_decade,2)+'</td></tr>'; });
  $('fa-bystate-table').querySelector('tbody').innerHTML=h;
  $('fa-bystate').hidden=false;
}
function renderPremium(){
  var rows=[];
  for(var f in ATLAS.counties){ var c=ATLAS.counties[f], w=c.water_premium; if(ok(w)&&w.ratio_slope_per_year!=null&&w.first&&w.first.ratio!=null) rows.push({f:f,c:c,w:w}); }
  if(!rows.length){ $('fa-premium').hidden=true; return; }
  var minLead=get(ATLAS,'layers','rent','gates','min_leader_pairs')||8;
  // a multiple over a few dollars of dry rent is noise, so a county needs $25+ of dry rent at both ends to lead a table
  var lead=rows.filter(function(r){return r.w.n_pairs>=minLead&&(r.w.first.nonirr==null||r.w.first.nonirr>=25)&&(r.w.latest.nonirr==null||r.w.latest.nonirr>=25);});
  var down=lead.filter(function(r){return r.w.direction==='falling';}).sort(function(a,b){return a.w.ratio_slope_per_year-b.w.ratio_slope_per_year;}).slice(0,10);
  var up=lead.filter(function(r){return r.w.direction==='rising';}).sort(function(a,b){return b.w.ratio_slope_per_year-a.w.ratio_slope_per_year;}).slice(0,10);
  function tr(r){ return '<tr><td><button type="button" class="fa-link" data-fips="'+r.f+'">'+esc(cname(r.c))+'</button></td><td class="n">'+Number(r.w.first.ratio).toFixed(2)+'× <span class="yr">'+r.w.first.year+'</span> → '+Number(r.w.latest.ratio).toFixed(2)+'× <span class="yr">'+r.w.latest.year+'</span></td><td class="n">'+r.w.n_pairs+'</td></tr>'; }
  var empty='<tr><td colspan="3" style="color:var(--text-muted)">none with the interval clear of zero</td></tr>';
  $('fa-prem-narrow').querySelector('tbody').innerHTML=down.length?down.map(tr).join(''):empty;
  $('fa-prem-wide').querySelector('tbody').innerHTML=up.length?up.map(tr).join(''):empty;
  var nW=rows.filter(function(r){return r.w.direction==='rising';}).length, nN=rows.filter(function(r){return r.w.direction==='falling';}).length;
  var chance=get(ATLAS,'national','premium','expected_by_chance_each_way');
  $('fa-prem-counts').textContent=rows.length+' counties publish both rents in enough years. The multiple is rising in '+nW+', falling in '+nN+', with no clear direction in '+(rows.length-nW-nN)+'.'+(chance!=null?' By chance alone about '+fmt(chance,0)+' would be called each way.':'')+' The tables list counties with '+minLead+' or more paired years and at least $25 of dry rent at both ends.';
  document.querySelectorAll('#fa-premium button.fa-link').forEach(function(b){ b.addEventListener('click',function(){ select(b.getAttribute('data-fips')); }); });
  $('fa-premium').hidden=false;
}
// rent against night heat: one labelled scatter with the open county marked; water as a table
// built when the section is opened: 2,700 circles in a closed fold cost 130-330 ms on every county click
function renderScatters(){
  var fold=$('fa-price'); if(fold&&!fold.open){ if(!fold._w){ fold._w=1; fold.addEventListener('toggle',function(){ if(fold.open) renderScatters(); }); } return; }
  var pts=[];
  for(var f in ATLAS.counties){ var c=ATLAS.counties[f], r=METRICS.rent(c); if(r==null) continue; var h=get(c,'heat','months','jul','recent','mean'); if(h!=null) pts.push({f:f,n:cname(c),x:h,y:r}); }
  var svg=$('fa-sc-heat');
  if(pts.length>2){
    var W=Math.max(300,Math.min(640,(svg.parentNode&&svg.parentNode.clientWidth)||560)),H=Math.round(W*0.6),pl=54,pb=40,pt=12,pr=14;
    var xs=pts.map(function(p){return p.x;}), ys=pts.map(function(p){return p.y;});
    var XT=niceTicks(Math.min.apply(null,xs),Math.max.apply(null,xs),6), YT=niceTicks(0,Math.max.apply(null,ys),5);
    var x0=XT[0],x1=XT[XT.length-1],y1=YT[YT.length-1];
    var X=function(v){return pl+(W-pl-pr)*(v-x0)/(x1-x0);}, Y=function(v){return pt+(H-pt-pb)*(1-v/y1);};
    var s='';
    YT.forEach(function(t){ s+='<line class="g" x1="'+pl+'" x2="'+(W-pr)+'" y1="'+Y(t).toFixed(1)+'" y2="'+Y(t).toFixed(1)+'"/><text class="yt" x="'+(pl-6)+'" y="'+(Y(t)+4).toFixed(1)+'" text-anchor="end">$'+fmt(t,0)+'</text>'; });
    XT.forEach(function(t){ s+='<line class="g" y1="'+pt+'" y2="'+(H-pb)+'" x1="'+X(t).toFixed(1)+'" x2="'+X(t).toFixed(1)+'"/><text class="xt" x="'+X(t).toFixed(1)+'" y="'+(H-pb+16)+'" text-anchor="middle">'+fmt(t,0)+'°</text>'; });
    s+='<text class="xt" x="'+((pl+W-pr)/2)+'" y="'+(H-4)+'" text-anchor="middle">July average low, last ten years, °F</text>';
    s+='<text class="xt" transform="rotate(-90)" x="'+(-(pt+H-pb)/2)+'" y="12" text-anchor="middle">Non-irrigated rent, $/acre</text>';
    pts.forEach(function(p){ if(p.f===SEL) return; s+='<circle class="sd" r="2.6" cx="'+X(p.x).toFixed(1)+'" cy="'+Y(p.y).toFixed(1)+'" data-fips="'+p.f+'"><title>'+esc(p.n+': '+fmt(p.x,1)+' °F · $'+fmt(p.y,0)+'/ac')+'</title></circle>'; });
    var me=pts.filter(function(p){return p.f===SEL;})[0];
    if(me){ var mx=X(me.x), right=mx>W*0.65; s+='<circle class="me" r="6" cx="'+mx.toFixed(1)+'" cy="'+Y(me.y).toFixed(1)+'"/><text class="vt" x="'+(right?mx-9:mx+9).toFixed(1)+'" y="'+(Y(me.y)-8).toFixed(1)+'" text-anchor="'+(right?'end':'start')+'">'+esc(me.n.replace(/, [A-Z]{2}$/,'')+' $'+fmt(me.y,0))+'</text>'; }
    svg.setAttribute('viewBox','0 0 '+W+' '+H); svg.setAttribute('width',W); svg.setAttribute('height',H);
    svg.setAttribute('aria-label','Scatter of '+pts.length+' counties: non-irrigated rent against July average low.'+(me?' '+me.n+': '+fmt(me.x,1)+' °F, $'+fmt(me.y,0)+' an acre.':''));
    svg.innerHTML=s;
    svg.onclick=function(e){ var t=e.target; if(t.getAttribute&&t.getAttribute('data-fips')) select(t.getAttribute('data-fips')); };
  }
  // water: a table of bands, because the median county irrigates 4% and a scatter piles up at zero
  var bins=[[0,0.01,'under 1%'],[0.01,0.05,'1 to 5%'],[0.05,0.25,'5 to 25%'],[0.25,0.5,'25 to 50%'],[0.5,1.01,'50% or more']], out=[];
  bins.forEach(function(b){ var v=[]; for(var f in ATLAS.counties){ var c=ATLAS.counties[f], w=get(c,'water','irrigated_share_2022','share'), r=METRICS.rent(c); if(w==null||r==null||!PATHS[f]) continue; if(w>=b[0]&&w<b[1]) v.push(r); }
    v.sort(function(x,y){return x-y;}); var m=v.length, med=m?(m%2?v[(m-1)/2]:(v[m/2-1]+v[m/2])/2):null; out.push('<tr><td>'+b[2]+'</td><td class="n">'+m+'</td><td class="n">'+(med!=null?money(med):'n/a')+'</td></tr>'); });
  $('fa-water-table').querySelector('tbody').innerHTML=out.join('');
  $('fa-price').hidden=pts.length<3;
}

// ---------- the interface the opening view (components/atlas-now.js) uses: it draws every map; this file keeps the
// layers' own value rules, their files and the full county record, so the old deep links and every layer stay
function boot(host){
  HOST=host||{};
  if(HOST.names) for(var k in HOST.names) STATE_NAMES[k]=HOST.names[k];
  if(HOST.paths) PATHS=HOST.paths;
  if(BOOT) return BOOT;
  BOOT=fetch(DATA+'atlas.json',{cache:'no-cache'}).then(function(r){ if(!r.ok) throw new Error('atlas'); return r.json(); }).then(function(a){
    if(!a||!a.counties) throw new Error('atlas');
    ATLAS=a;
    for(var rf in ATLAS.counties){ var ry=get(ATLAS.counties[rf],'rent','nonirr','year'); if(ry&&(!RENT_LATEST||ry>RENT_LATEST)) RENT_LATEST=ry; }
    var drm=natDrMissing(ATLAS);
    if(drm.length) LAYERS.forEach(function(l){ if(l.needs==='drought'&&l.title.indexOf(' left out')<0) l.title+=' ('+drm.join(' and ')+' left out: the Atlas copy of that year is incomplete)'; });
    // Codes in the data with no boundary: Connecticut's planning regions and NASS's split reporting
    // districts (W Pottawattamie, West Otter Tail ...). They keep their numbers but are not called counties.
    for(var fx in ATLAS.counties){ if(!PATHS[fx]){ var cx=ATLAS.counties[fx]; cx.name=String(cx.name).replace(/\s+Ct$/,''); cx.u=cx.state==='CT'?'planning region':'reporting district'; } }
    return api;
  });
  BOOT.catch(function(){ BOOT=null; });
  return BOOT;
}
var BOOT=null;
function list(){ return LAYERS.map(function(l){ return {key:l.key, grp:l.grp, label:l.label, title:l.title, off:ATLAS?layerOff(l):false, slider:!!l.slider}; }); }
// one layer's figures: {fips: value} for every county with an outline, and the words the key and the read line need
function layer(key,opt){
  var L=layerOf(key); if(!L) return Promise.reject(new Error('layer'));
  opt=opt||{}; if(opt.dec!=null) DEC=opt.dec; STATE=opt.state||'';
  var waits=[]; if(L.sidecar) waits.push(loadHeatDecades()); if(L.side) waits.push(loadSide(L.side));
  return Promise.all(waits).then(function(){
    var vals={}, n=0, cls={}, all=function(){ return true; };
    for(var f in PATHS){ var c=ATLAS.counties[f]; if(!c) continue; var v=L.v(c,f); if(v!=null&&!isNaN(v)){ vals[f]=v; n++; } }
    if(L.side==='sales'&&SIDE.sales.ok){
      for(var g in PATHS){ var cc=ATLAS.counties[g]; if(!cc||vals[g]!=null) continue;
        cls[g]=!sst(cc)?'ko':(L.key==='sales_med'&&srow(g))?'kx':'kn'; }
    }
    var note='', why0=L.sidecar&&HEATD_WHY?HEATD_WHY:(L.side&&!SIDE[L.side].ok?SIDE[L.side].why:'');
    if(L.side==='sales'&&SIDE.sales.ok){ var h=sLegend(L,all); note=h.slice(h.indexOf('<span class="fa-note">')); }
    if(L.side==='rentrev'&&SIDE.rentrev.ok) note=rrevLegend(vals,all);
    return {key:L.key, grp:L.grp, label:L.label, title:L.title+(L.slider?', '+DECADES[DEC]:''), n:n, vals:vals, cls:cls,
      unit:L.unit, k:L.k, pct:!!L.pct, money:!!L.money, cost:!!L.cost, doy:!!L.doy, div:!!L.div, log:!!L.log, fixed:!!L.fixed, ramp:L.ramp, slider:!!L.slider,
      natline:L.key==='ten_rent'?tenNatLine():'', note:note, why:why0,
      salesWords:L.side==='sales'?{ko:'no public sale records here yet', kn:'no recorded sale in the window', kx:SIDE.sales.ok?'sales, none of '+SIDE.sales.d.min_acres+'+ acres with a price':''}:null};
  });
}
function fmtOf(key,v){ var L=layerOf(key); return L?fmtv(L,v):String(v); }
function shortOf(key,v){ var L=layerOf(key); return L?shortv(L,v):String(v); }
// the read line for one county on one layer: the figure (or why there is none) and the layer's own notes
function card(key,f){
  var L=layerOf(key), c=ATLAS&&ATLAS.counties[f]; if(!L||!c) return '';
  if(L.side==='sales') return sCard(L,c,f);
  var v=L.v(c,f);
  if(v==null||isNaN(v)) return esc(L.label)+': '+esc(missingWhy(c,L,f));
  return esc(L.label)+': <b>'+esc(fmtv(L,v))+(L.money&&L.unit==='$/acre'?'<span class="fa-cc-u"> an acre</span>':'')+'</b>'+esc(rnote(L,f));
}
function national(){ renderThesis(); renderByState(); renderPremium(); renderScatters(); }
// the reference line on the decade map (the old map's selector, 60 to 70 F): the counties whose July average low in
// the decade on the map is at or above the line, out of those with five Julys or more in it
function heatLine(line){
  var d=DECADES[DEC==null?DECADES.length-1:DEC], n=0, at=0, hit={};
  for(var f in PATHS){ var dd=jdec(f); dd=dd&&dd[d]; if(dd&&dd.n>=5){ n++; if(dd.mean>=line){ at++; hit[f]=1; } } }
  return {n:n, at:at, hit:hit, decade:d};
}
// rent layers rank within one survey year (the newest): an older survey is shown, not ranked
function ryearOf(key,f){
  var c=ATLAS&&ATLAS.counties[f]; if(!c) return null;
  if(key==='rent_rev'){ var r=rrev(f); return r&&r.py||null; }
  return key==='rent'?get(c,'rent','nonirr','year'):key==='rent_irr'?get(c,'rent','irr','year'):null;
}
function rlatestOf(key){ return key==='rent_rev'?RREV_LATEST:key==='rent'||key==='rent_irr'?RENT_LATEST:null; }
var api={boot:boot, list:list, layer:layer, fmt:fmtOf, short:shortOf, card:card, panel:openPanel, national:national, decades:DECADES,
  heatLine:heatLine, ryear:ryearOf, rlatest:rlatestOf,
  tenure:function(){ return loadSide('tenure').then(function(S){ return S.ok?S.d:null; }); }};
window.AtlasLayers=api;
})();
