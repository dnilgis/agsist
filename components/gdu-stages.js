/* components/gdu-stages.js -- the one corn and soybean GDU stage table on the
   site. /gdu-calculator and /fast-facts both read it; do not copy these
   numbers into a page. Moved here from gdu-calculator.html on 2026-10-16.

   Corn: Purdue NCH-40 Table 3 (Neild & Newman), reproduced in the Illinois
   Agronomy Handbook ch.2. Cumulative GDU FROM PLANTING, 86/50 modified, for a
   2700-GDU hybrid.
     https://www.extension.purdue.edu/extmedia/nch/nch-40.html
     https://dli.grainger.uiuc.edu/aces_dli/02AGRON.PDF
   An older copy mixed three systems and invented two values:
     V3 200  was NCH-40's V2        V5 350  was NCH-40's V4
     V8 700  was Bayer's number against NCH-40's 610
     V10 900 (prose row) was Bayer's V12; NCH-40's V10 is 740
     R2 1560 and R3 1750 appear in NO published source at all
     the 2450 late-dent row was missing entirely, leaving a 510-GDU hole to R6
   R4 1925 and R5 2190 are right: NCH-40 uses pre-Ritchie names and prints them
   as "R3 Dough" and "R4 Denting"; mapped by stage name they match modern
   naming. NCH-40 publishes no milk-stage value, so R3 is left out rather than
   guessed.
   VT is a range, not one number. NCH-40 / UKY AGR-202 print 1135 and R1 1400,
   but tassels usually emerge only 1-3 days before silking (UW-Madison), and
   other guides put VT near 1,300. gdu is the low end (used for stage order);
   hi is the top of the range shown to the reader.

   Soybean: rough marks, also from planting. Soybean stages follow day length
   as much as heat, so pages label these as approximate. */
(function(root){
'use strict';
var corn=[
  {s:'VE', gdu:120,  key:true,  icon:'sprout', desc:'Emergence'},
  {s:'V2', gdu:200,  key:false, icon:'leaf',   desc:'2nd leaf collar'},
  {s:'V4', gdu:345,  key:true,  icon:'leaf',   desc:'Ear shoots forming'},
  {s:'V6', gdu:475,  key:false, icon:'leaf',   desc:'Growing point above soil'},
  {s:'V8', gdu:610,  key:true,  icon:'wheat',  desc:'Kernel rows set'},
  {s:'V10',gdu:740,  key:false, icon:'leaf',   desc:'Rapid growth'},
  {s:'V12',gdu:870,  key:false, icon:'leaf',   desc:'Ear size being set'},
  {s:'VT', gdu:1135, hi:1350, key:true, icon:'wheat', desc:'Tasseling (GDU varies by source; check the field)'},
  {s:'R1', gdu:1400, key:true,  icon:'flower', desc:'Silking'},
  {s:'R2', gdu:1660, key:false, icon:'',       desc:'Blister'},
  {s:'R4', gdu:1925, key:false, icon:'wheat',  desc:'Dough stage'},
  {s:'R5', gdu:2190, key:true,  icon:'wheat',  desc:'Dent stage'},
  {s:'R5.5',gdu:2450,key:false, icon:'wheat',  desc:'Full dent, milk line moving'},
  {s:'R6', gdu:2700, key:true,  icon:'circle-check', desc:'Black layer'}
];
var bean=[
  {s:'VE', gdu:130,  key:true,  icon:'sprout', desc:'Emergence'},
  {s:'V1', gdu:200,  key:false, icon:'leaf',   desc:'First trifoliate'},
  {s:'V3', gdu:400,  key:true,  icon:'leaf',   desc:'Third trifoliate'},
  {s:'V5', gdu:600,  key:false, icon:'leaf',   desc:'Fifth trifoliate'},
  {s:'R1', gdu:800,  key:true,  icon:'flower', desc:'First flower'},
  {s:'R2', gdu:1000, key:true,  icon:'flower', desc:'Full bloom'},
  {s:'R3', gdu:1200, key:true,  icon:'sprout', desc:'Pod set'},
  {s:'R4', gdu:1400, key:true,  icon:'sprout', desc:'Full pod'},
  {s:'R5', gdu:1600, key:true,  icon:'sprout', desc:'Seed fill'},
  {s:'R6', gdu:1750, key:false, icon:'sprout', desc:'Full seed'},
  {s:'R7', gdu:1900, key:true,  icon:'',       desc:'Beginning maturity'},
  {s:'R8', gdu:2000, key:true,  icon:'circle-check', desc:'Full maturity'}
];
/* The last stage reached at a GDU total from planting, or null before the first. */
function stageAt(stages,gdu){
  var out=null;
  for(var i=0;i<stages.length;i++){if(gdu>=stages[i].gdu)out=stages[i];}
  return out;
}
var api={corn:corn, bean:bean, stageAt:stageAt};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
else root.AgGduStages=api;
})(typeof window!=='undefined'?window:this);
