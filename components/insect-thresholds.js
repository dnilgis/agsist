/* /insect-thresholds: the soybean aphid call. The numbers are the published economic threshold, read from
   UMN Extension (scouting soybean aphid, reviewed 2023), Iowa State ICM (Aug 28, 2017) and UW A3646 (2023 edition):
   through R5, treat when ALL THREE are true: an average of 250 aphids per plant, more than 80 percent of
   plants infested, and numbers still rising. R6: UMN says no threshold has been developed.
   Scouting runs from mid to late June until R6.5. */
(function(root){
'use strict';
var ET={avg:250, pct:80};
/* aphidCall({avg, pct, rising:true|false|null, stage:'pre'|'r1_r5'|'r6'|'r65'}) */
function aphidCall(o){
  var avg=+o.avg, pct=+o.pct, st=o.stage||'r1_r5';
  if(st==='r65')return {call:'past', why:'Past R6.5, when pods and leaves begin to yellow. UMN says scouting runs until then.'};
  if(st==='r6')return {call:'no-threshold', why:'No economic threshold has been developed for R6 (UMN). Early R6 may need treatment if the aphids are very large in number and the plants are under other stress. That is a judgment call, not a number. UW A3646 says that once pods reach full seed it is too late to protect yield and treatment is not recommended.'};
  if(!(avg>=0)||!(pct>=0)||o.avg===''||o.pct==='')return {call:'missing', why:'Enter the mean aphids per plant and the percent of plants with aphids.'};
  var a=avg>=ET.avg, p=pct>ET.pct, r=o.rising===true;
  var miss=[]; if(!a)miss.push('the mean is under 250 per plant'); if(!p)miss.push('80 percent of plants or fewer have aphids'); if(!r)miss.push(o.rising===false?'numbers are not rising':'you have not said whether numbers are rising');
  if(a&&p&&r)return {call:'treat', why:'All three conditions are met: a mean of 250 or more aphids per plant, more than 80 percent of plants infested, and rising. Iowa State and UMN both give this as the threshold through R5.'};
  return {call:'not-yet', why:'Not at the threshold: '+miss.join('; ')+'. All three must be true before treating. Count a representative set of plants through the field, not the border.'};
}
var api={ET:ET, aphidCall:aphidCall};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
else{
  root.AgInsect=api;
  document.addEventListener('DOMContentLoaded',function(){
    var f=document.getElementById('it-form'); if(!f)return;
    function $(i){return document.getElementById(i);}
    function run(){
      var r=aphidCall({avg:$('it-avg').value,pct:$('it-pct').value,stage:$('it-stage').value,
        rising:$('it-rise').value==='yes'?true:$('it-rise').value==='no'?false:null});
      var head={treat:'At the threshold',  'not-yet':'Not at the threshold', 'no-threshold':'No threshold set for R6', past:'Past the scouting window', missing:'Enter your counts'}[r.call];
      $('it-call').textContent=head; $('it-why').textContent=r.why;
    }
    f.addEventListener('input',run); f.addEventListener('change',run); run();
  });
}
})(typeof window!=='undefined'?window:this);
