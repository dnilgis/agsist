(function(){var U='https://agsist-subs.dnilgis.workers.dev/watch-subscribe';
document.querySelectorAll('form.watch').forEach(function(F){F.addEventListener('submit',function(ev){
ev.preventDefault();var m=F.querySelector('.wm'),b=F.querySelector('button'),em=F.elements.email.value.trim();
if(!em)return;b.disabled=true;m.textContent='Sending...';
fetch(U,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:em,fips:F.getAttribute('data-fips'),_gotcha:F.elements._gotcha.value})})
.then(function(r){return r.json().then(function(j){return{s:r.status,j:j}})})
.then(function(o){b.disabled=false;
if(o.s===200){m.textContent='Check your inbox for a confirmation link. It can take up to 30 minutes. Look in spam if it is not there.';F.elements.email.value='';try{gaEvent('watch_county',{fips:F.getAttribute('data-fips')})}catch(e){}}
else if(o.s===429){m.textContent='One address can watch up to 5 counties.'}
else{m.textContent='That did not go through. Check the address and try again.'}})
.catch(function(){b.disabled=false;m.textContent='That did not go through. Try again in a minute.'});});});})();
