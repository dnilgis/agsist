(function(){
var rb=document.getElementById('rc-open');
if(rb)rb.addEventListener('click',function(){
  var box=document.getElementById('rc-box'),o=!box.hidden;box.hidden=o;rb.setAttribute('aria-expanded',o?'false':'true');
  if(o||box.getAttribute('data-on'))return;box.setAttribute('data-on','1');
  var s=document.createElement('script');s.src='/components/rent-calc.js?v=2';
  s.onload=function(){window.AgRentCalc.mount(box,{st:rb.getAttribute('data-st'),fips:rb.getAttribute('data-fips')});};
  s.onerror=function(){box.textContent='The calculator did not load. Try again in a minute.';box.removeAttribute('data-on');};
  document.head.appendChild(s);
});
var rec=JSON.parse(document.getElementById('rec').textContent);
var cp=document.getElementById('cp');
if(cp)cp.addEventListener('click',function(){
  var u=location.origin+location.pathname;
  var done=function(){cp.textContent='Link copied';setTimeout(function(){cp.textContent='Copy link';},1800);};
  if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(u).then(done,function(){window.prompt('Copy this link',u);});}
  else window.prompt('Copy this link',u);
  try{gaEvent('atlas_county_share',{fips:rec.fips});}catch(e){}
});
try{gaEvent('atlas_county_page',{fips:rec.fips});}catch(e){}
})();
