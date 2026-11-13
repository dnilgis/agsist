/* components/a2809.js -- UW Extension A2809 (Laboski and Peters), "Nutrient
   application guidelines for field, vegetable, and fruit crops in Wisconsin",
   the tables /fast-facts uses for corn N, for P and K and for lime. Typed from the
   2012 printing (R-11-2012), the copy UW posted in March 2026 as A2809-web.pdf
   (https://cropsandsoils.extension.wisc.edu/files/2026/03/A2809-web.pdf, read Oct 16, 2026).
   It is NOT the 2026 online edition: UW announced updated N, P and K rates in 2026
   (Updates to A2809, Ruark, read Oct 18, 2026) and those tables are not typed here yet.
   UW announced them in that talk; the online Corn chapter was still unposted when read Nov 13, 2026.

   Corn N:
     Table 6.1  MRTN rate and profitable range by soil, previous crop and
                N:corn price ratio (Wisconsin trials)
   P and K:
     Table 7.1  soil test P categories, by crop demand level and soil group
     Table 7.2  soil test K categories, by crop demand level and soil group
     Table 7.4  P2O5 and K2O rates by crop, yield goal and category
     Table 4.2  demand levels: corn grain and soybean 1; corn silage and
                alfalfa 2. A rotation takes the highest level in it, and an
                irrigated corn-soybean field uses level 2.
   Lime:
     Table 5.1  tons of 60-69 neutralizing index (NI) lime from water pH and
                buffer pH (Sikora buffer on Wisconsin reports), per target pH
     Table 5.2  plow depth multiplier
     Text p.33-34: adjust by 65 / NI (range midpoint), round 60-69 lime to the
     nearest ton and higher NI lime to the nearest 0.5 ton, lime only when
     water pH is more than 0.2 below target, minimum 2 t of 60-69 (1.5 t of
     80-89) on most soils, 1 t on sands under 1% organic matter when the
     calculation is under 1.5 t, never more than 12 t (8 t for potato).

   One copy of these numbers on the site: fast-facts.html prints its tables
   from the same rows and test/fast-facts-a2809.test.mjs checks they agree. */
(function(root){
'use strict';

/* Category lower bounds (ppm). A value at or above a bound is in that class;
   below the L bound is VL. "<10" VL, "10-15" L, "16-20" O ... ">30" EH. */
var P_CATS={
  1:{loamy:{L:10,O:16,H:21,EH:31}, sandy:{L:12,O:23,H:33,EH:43}},
  2:{loamy:{L:12,O:18,H:26,EH:36}, sandy:{L:18,O:26,H:38,EH:56}}
};
/* K has a VH class, except sandy and organic soils at demand level 1. */
var K_CATS={
  1:{loamy:{L:70,O:101,H:131,VH:161,EH:191}, sandy:{L:45,O:66,H:91,EH:131}},
  2:{loamy:{L:90,O:111,H:141,VH:171,EH:241}, sandy:{L:50,O:81,H:121,VH:161,EH:201}}
};

/* Table 7.4 rows: [low, high, P2O5 VL,L,O,H,EH,  K2O VL,L,O,H,VH,EH] lb/a.
   The rates are totals, starter included. P has no VH class. */
var CROPS={
  corn:{name:'Corn grain', unit:'bu', demand:1, rows:[
    [71,90,    70,60,30,15,0,    70,55,25,15,5,0],
    [91,110,   80,70,40,20,0,    75,60,30,15,10,0],
    [111,130,  85,75,45,25,0,    80,65,35,20,10,0],
    [131,150,  95,85,55,30,0,    85,70,40,20,10,0],
    [151,170, 100,90,60,30,0,    90,75,45,25,10,0],
    [171,190, 110,100,70,35,0,   95,80,50,25,15,0],
    [191,210, 115,105,75,40,0,  105,90,60,30,15,0],
    [211,230, 125,115,85,45,0,  110,95,65,35,15,0],
    [231,250, 130,120,90,45,0,  115,100,70,35,20,0],
    [251,270, 140,130,100,50,0, 120,105,75,40,20,0]]},
  corn_silage:{name:'Corn silage', unit:'ton', demand:2, rows:[
    [10,15,    85,75,45,25,0,   160,145,105,55,25,0],
    [15.1,20, 105,95,65,35,0,   200,185,145,75,35,0],
    [20.1,25, 120,110,80,40,0,  240,225,185,95,45,0],
    [25.1,30, 140,130,100,50,0, 285,270,230,115,60,0],
    [30.1,35, 155,145,115,60,0, 325,310,270,135,70,0],
    [35.1,40, 175,165,135,70,0, 365,350,310,155,80,0]]},
  soybean:{name:'Soybean', unit:'bu', demand:1, rows:[
    [15,25,    55,45,15,10,0,    75,60,30,15,10,0],
    [26,35,    65,55,25,15,0,    85,70,40,20,10,0],
    [36,45,    70,60,30,15,0,   100,85,55,30,15,0],
    [46,55,    80,70,40,20,0,   115,100,70,35,20,0],
    [56,65,    90,80,50,25,0,   130,115,85,45,20,0],
    [66,75,    95,85,55,30,0,   145,130,100,50,25,0],
    [76,85,   105,95,65,35,0,   155,140,110,55,30,0],
    [86,95,   110,100,70,35,0,  170,155,125,65,30,0],
    [96,105,  120,110,80,40,0,  185,170,140,70,35,0]]},
  alfalfa_seeding:{name:'Alfalfa, seeding year', unit:'ton', demand:2, rows:[
    [1.5,2.5,  65,55,25,15,0,   160,145,105,55,25,0]]},
  /* A2809 prints the 4th row as "5.5-6.5 ton" after "4.6-5.5"; read as 5.6-6.5. */
  alfalfa:{name:'Alfalfa, established', unit:'ton', demand:2, kNote:'c', rows:[
    [2.6,3.5,  80,70,40,20,0,   235,220,180,90,45,0],
    [3.6,4.5,  90,80,50,25,0,   295,280,240,120,60,0],
    [4.6,5.5, 105,95,65,35,0,   355,340,300,150,75,0],
    [5.6,6.5, 120,110,80,40,0,  415,400,360,180,90,0],
    [6.6,7.5, 130,120,90,45,0,  475,460,420,210,105,0],
    [7.6,8.5, 145,135,105,55,0, 535,520,480,240,120,0],
    [8.6,9.5, 155,145,115,60,0, 595,580,540,270,135,0]]}
};
var P_COLS=['VL','L','O','H','EH'], K_COLS=['VL','L','O','H','VH','EH'];
var CAT_NAMES={VL:'Very Low',L:'Low',O:'Optimum',H:'High',VH:'Very High',EH:'Excessively High'};

function category(v,b){
  if(!(v>=0))return null;
  var order=['EH','VH','H','O','L'];
  for(var i=0;i<order.length;i++){var c=order[i];if(b[c]!=null&&v>=b[c])return c;}
  return 'VL';
}
/* The Table 7.4 row for a yield goal: the first row whose top is at or above
   it. Below the first row or above the last, the end row is used and the
   result says so (A2809 adds crop removal for yields above its table). */
function rowFor(crop,y){
  var rows=CROPS[crop].rows, i;
  for(i=0;i<rows.length;i++){if(y<=rows[i][1])return {row:rows[i],below:y<rows[0][0],above:false};}
  return {row:rows[rows.length-1],below:false,above:true};
}
function rowLabel(r,unit){return fmtNum(r[0])+'–'+fmtNum(r[1])+' '+unit;}
function fmtNum(n){return String(n);}

/* pk({crop, yieldGoal, p, k, soil:'loamy'|'sandy', rotation:1|2})
   -> {demand, soil, row, pCat, kCat, p2o5, k2o, ...} or null when a value is missing. */
function pk(o){
  var c=CROPS[o.crop];if(!c)return null;
  var y=+o.yieldGoal, p=+o.p, k=+o.k;
  if(!(y>0)||!(p>=0)||!(k>=0)||o.p===''||o.k==='')return null;
  var soil=o.soil==='sandy'?'sandy':'loamy';
  var demand=Math.max(c.demand,o.rotation==2?2:1);
  var pCat=category(p,P_CATS[demand][soil]), kCat=category(k,K_CATS[demand][soil]);
  var r=rowFor(o.crop,y), row=r.row;
  var p2o5=row[2+P_COLS.indexOf(pCat)], k2o=row[7+K_COLS.indexOf(kCat)];
  return {crop:o.crop, cropName:c.name, unit:c.unit, demand:demand, soil:soil,
    pCat:pCat, kCat:kCat, pCatName:CAT_NAMES[pCat], kCatName:CAT_NAMES[kCat],
    p2o5:p2o5, k2o:k2o, rowLabel:rowLabel(row,c.unit), belowTable:r.below, aboveTable:r.above,
    kNote:c.kNote||null};
}

/* ─── Lime, Table 5.1: tons/a of 60-69 NI lime = a + b x BpH + c x WpH ─── */
var LIME={
  5.2:[36.1,-3.29,-2.67], 5.4:[48.2,-4.84,-3.03], 5.6:[51.0,-5.40,-2.67],
  5.8:[57.2,-5.55,-3.50], 6.0:[72.7,-7.59,-3.78], 6.3:[103,-12.6,-3.18],
  6.5:[134,-17.2,-2.73],  6.6:[152,-20.3,-2.17],  6.8:[195,-28.4,0.144]
};
var DEPTH={7:1.00, 8:1.15, 9:1.31, 10:1.46};   /* Table 5.2: 0-7, 7.1-8, 8.1-9, over 9 in */

function roundTo(x,step){return Math.round(x/step)*step;}
/* lime({wph, bph, target, ni, depth:7|8|9|10, sandyLowOM:bool}) */
function lime(o){
  var w=+o.wph, b=+o.bph, t=+o.target, ni=+o.ni||65;
  var f=LIME[t.toFixed(1)]||LIME[String(t)];
  if(!f||!(w>0)||!(b>0)||!(ni>0))return null;
  var gap=Math.round((t-w)*100)/100;
  if(!(gap>0.2))return {need:false, gap:gap, target:t};
  var mult=DEPTH[o.depth]||1;
  var base=(f[0]+f[1]*b+f[2]*w)*mult;            /* 60-69 lime, unrounded */
  var raw=base*65/ni;                             /* the lime being used */
  var step=ni<70?1:0.5, tons, rule=null;
  if(o.sandyLowOM){
    /* A2809 sets only the 1 t floor for these sands, no 2 t minimum. */
    if(base<1.5){tons=1;rule='sandy';}else tons=roundTo(raw,step);
  } else {
    var min=2*65/ni;
    if(raw<min){raw=min;rule='min';}
    tons=roundTo(raw,step);
  }
  var capped=false;
  if(tons>12){tons=12;capped=true;}
  return {need:true, gap:gap, target:t, base:base, base60:Math.max(0,Math.round(base)), raw:raw,
    tons:tons, step:step, rule:rule, capped:capped, mult:mult};
}

/* ─── Corn N, Table 6.1: total lb N/a (starter included) by soil, previous
   crop and N:corn price ratio. Each cell is [MRTN rate, low, high]; the
   low-high range is every rate within $1/a of the MRTN return (figured at
   $4 corn). The rate for a ratio does not change with price level. ─── */
var N_RATIOS=[0.05,0.10,0.15,0.20];
var N_CORN={
  hi_corn:{soil:'Loamy, high yield potential', prev:'Corn, forage legumes, legume vegetables, green manures',
    cells:[[190,170,210],[165,155,180],[150,140,160],[135,125,150]]},
  hi_soy:{soil:'Loamy, high yield potential', prev:'Soybean, small grains',
    cells:[[140,125,160],[120,105,130],[105,95,115],[90,80,105]]},
  med_corn:{soil:'Loamy, medium yield potential', prev:'Corn, forage legumes, legume vegetables, green manures',
    cells:[[145,130,160],[125,115,140],[115,105,125],[105,95,110]]},
  med_soy:{soil:'Loamy, medium yield potential', prev:'Soybean, small grains',
    cells:[[130,110,150],[100,85,120],[85,70,95],[70,60,80]]},
  sand_irr:{soil:'Sands and loamy sands, irrigated', prev:'All crops',
    cells:[[215,200,230],[200,185,210],[185,175,195],[175,165,185]]},
  sand_dry:{soil:'Sands and loamy sands, not irrigated', prev:'All crops',
    cells:[[140,130,150],[130,120,140],[120,110,130],[110,100,120]]}
};
/* The A2809 column for a ratio: the nearest of 0.05, 0.10, 0.15, 0.20.
   A2809 prints only these four columns, so nothing is read between them;
   a ratio past either end uses the end column and says so (off:true). */
function nColumn(ratio){
  if(!(ratio>0))return null;
  var i=ratio<0.075?0:ratio<0.125?1:ratio<0.175?2:3;
  return {i:i, ratio:N_RATIOS[i], off:ratio<0.05||ratio>0.20};
}
/* nRate({row:'hi_soy', ratio}) -> {rate, lo, hi, col, off, soil, prev} or null */
function nRate(o){
  var r=N_CORN[o.row], c=nColumn(+o.ratio);
  if(!r||!c)return null;
  var cell=r.cells[c.i];
  return {rate:cell[0], lo:cell[1], hi:cell[2], col:c.ratio, off:c.off, soil:r.soil, prev:r.prev};
}

/* ─── Nitrogen credits, chapter 9 (edition R-11-2012, the copy UW posted Mar 2026) ───
   Table 9.4  forage legume credits, lb N/a: [medium/fine >8 in, medium/fine <8 in, sand >8, sand <8]
              regrowth. Red clover and birdsfoot trefoil: 80% of the alfalfa figure for a like
              stand. Second year, good or fair stand: 50 on medium/fine, 0 on sands.
   Table 9.5  green manure credits, lb N/a: [<6 in growth, >6 in growth low, high].
   Table 9.6  field crop legumes: soybean and leguminous vegetables 20 on medium/fine, 0 on sands;
              never for corn or wheat after soybean (the Table 6.1 rows already count it).
   Tables 9.1 and 9.2  manure: total N per unit, share available by time to incorporation.
   Table 9.3 is Table 9.2 times Table 9.1, rounded; test/nitrogen-credits.test.mjs recomputes it. */
var LEGUME_YEAR1={
  alfalfa_good:[190,150,140,100], alfalfa_fair:[160,120,110,70], alfalfa_poor:[130,90,80,40],
  vetch:[160,90,110,40]
};
var LEGUME_SECOND_YEAR={fine:50, sand:0};   /* "All crops, good or fair stand" */
var CLOVER_SHARE=0.8;                        /* red clover, birdsfoot trefoil, of a like alfalfa stand */
var GREEN_MANURE={
  alfalfa:{short:40, tall:[60,100]}, red_clover:{short:40, tall:[50,80]},
  sweet_clover:{short:40, tall:[80,120]}, vetch:{short:40, tall:[40,90], tallest:[110,160]}
};
var FIELD_LEGUME={soybean:{fine:20, sand:0}, legume_veg:{fine:20, sand:0}};
/* Manure availability, first year N by time to incorporation (> 72 h or not, 1-72 h, < 1 h or injected),
   P2O5 80, K2O 80, S 55 (% of total). Second year N 10, third year N 5. */
var MANURE_AVAIL={
  beef_liquid:[30,40,50], beef_solid:[25,30,35], dairy_liquid:[30,40,50], dairy_solid:[25,30,35],
  goat:[25,30,35], horse:[25,30,35], poultry:[50,55,60], sheep:[25,30,35], swine:[40,50,65], veal:[30,40,50]
};
var MANURE_SECOND_YEAR_N=10, MANURE_THIRD_YEAR_N=5, MANURE_P_K_FIRST_YEAR=80;
/* Table 9.2 rows: name, unit, availability group, dry matter %, lb per unit of total N, P2O5, K2O, S */
var MANURE={
  beef_s:{name:'Beef, solid', unit:'ton', avail:'beef_solid', dm:29, n:13, p:8, k:12, s:1.9},
  dairy_semi:{name:'Dairy, semi-solid (11.1 to 20% DM)', unit:'ton', avail:'dairy_solid', dm:15, n:8, p:4, k:6, s:0.8},
  dairy_solid:{name:'Dairy, solid (over 20% DM)', unit:'ton', avail:'dairy_solid', dm:33, n:9, p:4, k:7, s:1.2},
  goat_s:{name:'Goat, solid', unit:'ton', avail:'goat', dm:43, n:13, p:7, k:10, s:2.0},
  horse:{name:'Horse, solid', unit:'ton', avail:'horse', dm:33, n:10, p:6, k:8, s:1.3},
  chicken:{name:'Poultry, chicken, solid', unit:'ton', avail:'poultry', dm:57, n:49, p:44, k:33, s:3.0},
  duck:{name:'Poultry, duck, solid', unit:'ton', avail:'poultry', dm:36, n:12, p:10, k:9, s:1.8},
  turkey:{name:'Poultry, turkey, solid', unit:'ton', avail:'poultry', dm:59, n:51, p:44, k:31, s:3.8},
  sheep:{name:'Sheep, solid', unit:'ton', avail:'sheep', dm:34, n:19, p:9, k:24, s:2.2},
  swine_s:{name:'Swine, solid', unit:'ton', avail:'swine', dm:19, n:18, p:13, k:10, s:2.0},
  beef_l:{name:'Beef, liquid', unit:'1,000 gal', avail:'beef_liquid', dm:3, n:16, p:7, k:15, s:1.6},
  dairy_l:{name:'Dairy, liquid (under 4% DM)', unit:'1,000 gal', avail:'dairy_liquid', dm:2, n:14, p:4, k:14, s:1.1},
  dairy_slurry:{name:'Dairy, slurry (4.1 to 11% DM)', unit:'1,000 gal', avail:'dairy_liquid', dm:6, n:24, p:8, k:21, s:2.2},
  goat_l:{name:'Goat, liquid', unit:'1,000 gal', avail:'goat', dm:4, n:17, p:8, k:19, s:1.7},
  poultry_l:{name:'Poultry, liquid', unit:'1,000 gal', avail:'poultry', dm:2, n:12, p:7, k:9, s:1.3},
  swine_fin_in:{name:'Swine, finish (indoor pit)', unit:'1,000 gal', avail:'swine', dm:5, n:43, p:18, k:28, s:3.2},
  swine_fin_out:{name:'Swine, finish (outdoor pit)', unit:'1,000 gal', avail:'swine', dm:2, n:18, p:7, k:10, s:1.0},
  swine_nursery:{name:'Swine, farrow-nursery (indoor pit)', unit:'1,000 gal', avail:'swine', dm:2, n:21, p:8, k:13, s:1.0},
  veal:{name:'Veal calf, liquid', unit:'1,000 gal', avail:'veal', dm:1, n:9, p:3, k:16, s:0.6}
};
var INCORP=['none','h1_72','h1'];             /* > 72 h or not incorporated, 1 to 72 h, < 1 h or injected */

/* legumeCredit({crop:'alfalfa'|'red_clover'|'birdsfoot'|'vetch', stand:'good'|'fair'|'poor',
   regrowth:'gt8'|'lt8', soil:'fine'|'sand', year:1|2})  -> {n, note} or null when A2809 prints none */
function legumeCredit(o){
  var soil=o.soil==='sand'?'sand':'fine', col=(soil==='fine'?0:2)+(o.regrowth==='lt8'?1:0);
  if(+o.year===2){
    if(o.crop==='vetch')return null;                              /* the second-year row names stands, not vetch */
    if(o.stand!=='good'&&o.stand!=='fair')return null;            /* "All crops, good or fair stand" */
    return {n:LEGUME_SECOND_YEAR[soil], note:'second year, good or fair stand'};
  }
  var key=o.crop==='vetch'?'vetch':'alfalfa_'+(o.stand||'good'), row=LEGUME_YEAR1[key];
  if(!row)return null;
  var n=row[col], share=(o.crop==='red_clover'||o.crop==='birdsfoot')?CLOVER_SHARE:1;
  return {n:Math.round(n*share), base:n, share:share, note:share<1?'80% of the alfalfa figure for a like stand':''};
}
/* greenManureCredit({crop, tall:bool, spring:bool}) -> {lo,hi} lb N/a; spring seedings plowed down the
   following spring take the top of the range, fall seedings the bottom */
function greenManureCredit(o){
  var g=GREEN_MANURE[o.crop]; if(!g)return null;
  if(!o.tall)return {lo:g.short, hi:g.short};
  return {lo:g.tall[0], hi:g.tall[1], pick:o.spring?g.tall[1]:g.tall[0]};
}
/* fieldLegumeCredit({crop:'soybean'|'legume_veg', soil, next:'corn'|'wheat'|'other'}) -> lb N/a */
function fieldLegumeCredit(o){
  var c=FIELD_LEGUME[o.crop]; if(!c)return null;
  /* Table 9.6 footnote a: the soybean credit does not apply to corn or wheat after soybean (those rates
     already count it). A pea or bean crop is not excluded: it takes its 20 lb on medium and fine soils. */
  if(o.crop==='soybean'&&(o.next==='corn'||o.next==='wheat'))return 0;
  return c[o.soil==='sand'?'sand':'fine'];
}
/* manureN({type, rate, incorp:'none'|'h1_72'|'h1', yearsAgo:0|1|2, totalN}) -> lb N/a credited this year.
   totalN overrides Table 9.2 (a manure test, lb N per unit). A2809 rounds each year's credit to a whole lb. */
function manureN(o){
  var m=MANURE[o.type]; if(!m)return null;
  var rate=+o.rate; if(!(rate>=0))return null;
  var total=+o.totalN>0?+o.totalN:m.n, y=+o.yearsAgo||0, pct;
  if(y===0){var i=INCORP.indexOf(o.incorp); if(i<0)return null; pct=MANURE_AVAIL[m.avail][i];}
  else if(y===1)pct=MANURE_SECOND_YEAR_N; else if(y===2)pct=MANURE_THIRD_YEAR_N; else return null;
  return {n:Math.round(total*pct/100*rate), pct:pct, total:total, unit:m.unit};
}

var api={P_CATS:P_CATS, K_CATS:K_CATS, CROPS:CROPS, P_COLS:P_COLS, K_COLS:K_COLS, CAT_NAMES:CAT_NAMES,
  LIME:LIME, DEPTH:DEPTH, category:category, rowFor:rowFor, pk:pk, lime:lime,
  N_RATIOS:N_RATIOS, N_CORN:N_CORN, nColumn:nColumn, nRate:nRate,
  LEGUME_YEAR1:LEGUME_YEAR1, LEGUME_SECOND_YEAR:LEGUME_SECOND_YEAR, CLOVER_SHARE:CLOVER_SHARE, GREEN_MANURE:GREEN_MANURE,
  FIELD_LEGUME:FIELD_LEGUME, MANURE_SECOND_YEAR_N:MANURE_SECOND_YEAR_N, MANURE_THIRD_YEAR_N:MANURE_THIRD_YEAR_N, MANURE_P_K_FIRST_YEAR:MANURE_P_K_FIRST_YEAR, MANURE_AVAIL:MANURE_AVAIL, MANURE:MANURE, INCORP:INCORP,
  legumeCredit:legumeCredit, greenManureCredit:greenManureCredit, fieldLegumeCredit:fieldLegumeCredit, manureN:manureN};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
else root.AgA2809=api;
})(typeof window!=='undefined'?window:this);
