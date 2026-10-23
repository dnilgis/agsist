/* Prediction bot scorecard: redraws the section from data/predictions.json.
   Moved out of scorecard.html on Oct 22, 2026, when that page became a section of /usda-calendar.
   Loaded by the page when a reader nears the section (or opens the page on one of its links);
   until then the baked HTML (scripts/prerender_wpi_scorecard.py, scripts/seed_static.py) shows. */
  (function(){
    'use strict';
    var M=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var VERDICT={not_enough:'Not enough calls yet.',coin_flip:'Coin flip.',held_up:'This one held up.',worse_than_coin:'Worse than a coin flip.'};
    /* "crowded" is the COT page's word for its own measure; the bot's three-year rank is labeled as the bot's rule */
    var SIGNAL={crowded_long:'The bot\u2019s own rule: funds in the top tenth of 3 years',crowded_short:'The bot\u2019s own rule: funds in the bottom tenth of 3 years',trend_up:'13-week trend up',trend_down:'13-week trend down'};
    function $(id){return document.getElementById(id);}
    function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
    function fdate(iso){if(!iso)return '-';var p=iso.split('-');return M[+p[1]-1]+' '+(+p[2])+', '+p[0];}
    function n(x){return x==null?'-':Number(x).toLocaleString('en-US');}
    function rate(x){return x==null?'-':x.toFixed(1)+'%';}
    function dollars(c){if(c==null)return '-';var s=(c/100).toFixed(4).replace(/0+$/,'');if(s.split('.')[1].length<2)s=(c/100).toFixed(2);return '$'+s;}
    function ord(x){var v=x%100;if(v>=11&&v<=13)return x+'th';return x+({1:'st',2:'nd',3:'rd'}[x%10]||'th');}
    function luck(p){if(p==null)return '-';if(p<0.01)return 'under 1 in 100';return 'about '+Math.round(p*100)+' in 100';}
    /* Why and where-it-stands: the same words as _pb_why / _pb_stand in scripts/seed_static.py. */
    function cents(x){return Math.abs(x).toFixed(2).replace(/\.?0+$/,'');}
    function why(c){var s=SIGNAL[c.signal]||c.signal||'';
      if(/^trend_/.test(c.signal)){
        if(c.trend_pct!=null)s+=' ('+(c.trend_pct>0?'+':'')+c.trend_pct.toFixed(1)+'% over 13 weeks)';
        if(c.cot_pct!=null)s+='. Funds at the '+ord(Math.round(c.cot_pct))+' percentile of the last 156 reports, not in the top or bottom tenth, so the trend decides';
      }else if(c.cot_pct!=null)s+=' ('+ord(Math.round(c.cot_pct))+' percentile of the last 156 reports)';
      return s;}
    function stand(c){
      if(c.status==='graded')return c.outcome==='hit'?'Graded: right':'Graded: wrong';
      if(c.status!=='open')return '-';
      var m=c.mark;if(!m||m.close==null||c.entry==null)return 'Shows after the bot\u2019s next run';
      var d=Math.round((m.close-c.entry)*100)/100,head=dollars(m.close)+' on '+fdate(m.date).replace(/, \d{4}$/,'')+', ';
      if(d===0)return head+'level with entry (a tie grades as a miss)';
      var right=(c.direction==='up'&&d>0)||(c.direction==='down'&&d<0);
      return head+cents(d)+' cents '+(d<0?'under':'over')+' entry: '+(right?'right side so far':'wrong side so far');}
    function nextLine(ne){if(!ne||!ne.day)return '';
      return 'Next calls: at the '+fdate(ne.day)+' close, on the '+fdate(ne.report)+' report.'+(ne.after_holiday?' '+fdate(ne.after_holiday)+' is a federal holiday, so the entry moves to the next business day.':'');}
    function dirSpan(d){return d==='up'?'<span class="pb-up">Up</span>':(d==='down'?'<span class="pb-down">Down</span>':'-');}
    function verdictLine(r,label,R){
      if(!r)return {v:'-',line:'',luck:''};
      if(r.verdict==='not_enough'){
        return {v:VERDICT.not_enough,line:n(r.graded)+' graded so far. A rate is shown from '+n(R.min_graded_for_rate)+' graded calls and '+n(R.min_windows_for_rate)+' non-overlapping windows.',luck:''};
      }
      return {v:r.verdict_text||VERDICT[r.verdict]||'-',
        line:'Right on '+n(r.hits)+' of '+n(r.graded)+' '+label+' ('+rate(r.hit_rate)+'). Across four non-overlapping groups of calls: '+rate(r.spell_rate_low)+' to '+rate(r.spell_rate_high)+' ('+n(r.windows)+' windows).',
        luck:'Odds pure guessing does at least this well: '+luck(r.p_luck)+'; at least this badly: '+luck(r.p_worse)+' ('+luck(r.p_worse_adjusted)+' after adjusting for the records tested at once).'};
    }
    /* The plain sentence at the top. Same words as pb_plain() in scripts/seed_static.py. */
    var PLAIN_COIN={coin_flip:'no better than a coin flip',worse_than_coin:'worse than a coin flip',held_up:'better than a coin flip on this page\u2019s test'};
    function plainLine(d){
      var ba=((d.backtest||{}).records||{}).all||{},out=[];
      if(ba.hit_rate!=null&&ba.first){var coin=PLAIN_COIN[ba.verdict];
        out.push('In plain words: replayed on history since '+String(ba.first).slice(0,4)+', the bot\u2019s rule was right '+rate(ba.hit_rate)+' of the time'+(coin?', '+coin+'.':'.'));
        out.push('I publish its calls anyway, graded by code, so you can hold any market call to the same test.');}
      var opn=(d.calls||[]).filter(function(c){return c.status==='open'&&c.exit_day;});
      if(opn.length){var days=opn.map(function(c){return c.exit_day;}).sort(),uniq=days.filter(function(x,i){return days.indexOf(x)===i;});
        out.push((opn.length===1?'The open call is':'The '+n(opn.length)+' open calls are')+' not graded until '+fdate(uniq[0])+(uniq.length===1?'':' or later')+', on that day\u2019s close only.');}
      return out.join(' ');
    }
    function loadRec(){
    fetch('/data/predictions.json',{cache:'no-cache'}).then(function(r){if(!r.ok)throw new Error(r.status);return r.json();}).then(function(d){
      var labels={};(d.crops||[]).forEach(function(c){labels[c.key]=c.label;});
      var R=d.rules||{};
      $('pb-plain').textContent=plainLine(d);
      document.querySelectorAll('[data-rule]').forEach(function(el){var k=el.getAttribute('data-rule');if(R[k]!=null)el.textContent=R[k];});
      if(R.registered)$('pb-reg').textContent=R.registered;
      if(R.version)$('pb-ver').textContent=R.version;
      $('pb-updated').textContent=d.updated?d.updated.replace('T',' ').replace('Z',' UTC'):'-';

      var live=((d.live||{}).records||{}).all;
      var L=verdictLine(live,'graded calls',R);
      $('pb-live-verdict').textContent=L.v;$('pb-live-line').textContent=L.line;$('pb-live-luck').textContent=L.luck;
      if(live&&live.verdict==='not_enough'){
        var o=(d.live||{}).open;
        $('pb-live-luck').textContent=(o?n(o)+' calls are waiting for their grading day. ':'')+'The first live calls are made at the '+fdate(d.first_live_call||d.live_start)+' close and graded four weeks later.';
      }

      var bt=d.backtest||{};var ba=(bt.records||{}).all;
      var B=verdictLine(ba,'weekly calls',R);
      if(bt.tests_in_family)$('pb-family').textContent=n(bt.tests_in_family);
      $('pb-bt-verdict').textContent=B.v;
      $('pb-bt-line').textContent=ba?(fdate(ba.first)+' to '+fdate(ba.last)+'. '+B.line):'Backtest not computed yet.';
      $('pb-bt-luck').textContent=B.luck;
      if(ba&&ba.moves_of){$('pb-bt-base').textContent='Always saying down: '+rate(ba.fell_rate)+'. Always saying up: '+rate(ba.rose_rate)+' ('+n(ba.moves_of)+' weekly calls).';}
      if(bt.cutoff)$('pb-cutoff').textContent=bt.cutoff;

      var lt=(d.latest||{}),lc=lt.calls||[];
      $('pb-latest-when').textContent=lt.date?('Made at the '+fdate(lt.date)+' close.'):'No live call yet. The first calls are made at the '+fdate(d.first_live_call||d.live_start)+' close.';
      var tb=$('pb-latest').querySelector('tbody');
      tb.innerHTML=lc.length?lc.map(function(c){return '<tr><td>'+esc(labels[c.crop]||c.crop)+'</td><td>'+dirSpan(c.direction)+'</td><td>'+esc(c.contract)+'</td><td class="num">'+dollars(c.entry)+'</td><td>'+fdate(c.exit_day)+'</td><td>'+esc(stand(c))+'</td><td>'+esc(why(c))+'</td></tr>';}).join(''):'<tr><td colspan="7">No calls yet.</td></tr>';
      $('pb-next').textContent=nextLine(d.next_entry);

      var lr=(d.live||{}).records||{},br=bt.records||{};
      var cb=$('pb-bycrop').querySelector('tbody');
      cb.innerHTML=(d.crops||[]).map(function(c){var a=lr[c.key]||{},b=br[c.key]||{};
        var lv=a.gate_ok?(n(a.hits)+' of '+n(a.graded)+' ('+rate(a.hit_rate)+')'):(''+n(a.graded)+' graded');
        var ls=a.gate_ok?n(a.windows):'-';
        var bv=b.graded?(n(b.hits)+' of '+n(b.graded)+' ('+rate(b.hit_rate)+')'):'-';
        var bs=b.graded?(rate(b.spell_rate_low)+'–'+rate(b.spell_rate_high)+' ('+n(b.windows)+' windows)'):'-';
        return '<tr><td>'+esc(c.label)+'</td><td class="num">'+lv+'</td><td class="num">'+ls+'</td><td class="num">'+bv+'</td><td class="num">'+bs+'</td><td>'+esc(b.verdict_text||VERDICT[b.verdict]||'n/a')+'</td></tr>';}).join('');
      $('pb-bycrop-note').textContent='Live figures show a dash until a crop has '+n(R.min_graded_for_rate)+' graded calls and '+n(R.min_windows_for_rate)+' non-overlapping windows. Backtest: '+n(bt.rules_tested)+' rule tested, '+n(bt.tests_in_family)+' records checked against a coin flip.';

      var calls=(d.calls||[]).slice().sort(function(a,b){return a.made<b.made?1:(a.made>b.made?-1:(a.crop<b.crop?-1:1));});
      var lb=$('pb-log').querySelector('tbody'),shown=0,PAGE=40;
      function row(c){var res;
        if(c.status==='graded')res=c.outcome==='hit'?'<span class="pb-hit">Right</span>':'<span class="pb-miss">Wrong</span>';
        else if(c.status==='ungradeable')res=''+esc(c.note||'no settlement in the feed');
        else res='<span class="pb-open">Open</span>';
        if(c.note)res+='<br><small>'+esc(c.note)+'</small>';
        return '<tr><td>'+fdate(c.made)+'</td><td>'+esc(labels[c.crop]||c.crop)+'</td><td>'+dirSpan(c.direction)+'</td><td>'+esc(c.contract)+'</td><td class="num">'+dollars(c.entry)+'</td><td class="num">'+(c.exit!=null?dollars(c.exit):'n/a')+'</td><td>'+fdate(c.exit_day)+'</td><td>'+res+'</td></tr>';}
      function render(){var s=calls.slice(0,shown+PAGE);shown=s.length;lb.removeAttribute('aria-busy');lb.innerHTML=s.length?s.map(row).join(''):'<tr><td colspan="8">No live calls yet.</td></tr>';
        var m=$('pb-log-more');m.innerHTML=shown<calls.length?'<button type="button" class="pb-more" id="pb-more-btn">Show '+Math.min(PAGE,calls.length-shown)+' more ('+(calls.length-shown)+' left)</button>':'';
        var bb=$('pb-more-btn');if(bb)bb.addEventListener('click',render);}
      render();
      var sk=(d.skipped||[]).slice(-12).reverse();
      /* One date per miss: the entry close the call belonged to (2026-10-16:
         the line printed the day the miss was written down, Oct 15, beside
         an entry close of Oct 13 and a report of Oct 6). Crops missed at the
         same close share one line. */
      var grp=[],byKey={};
      sk.forEach(function(s){var m=/entry close on (\d{4}-\d{2}-\d{2})/.exec(s.reason||''),ed=s.entry_day||(m&&m[1])||s.date,miss=/^missed/.test(s.reason||'');
        var key=ed+'|'+s.report+'|'+(miss?'missed':s.reason);
        if(!byKey[key]){byKey[key]={ed:ed,report:s.report,miss:miss,reason:s.reason,crops:[]};grp.push(byKey[key]);}
        byKey[key].crops.push(s.crop);});
      var order=(d.crops||[]).map(function(c){return c.key;});
      grp.forEach(function(g){g.crops=g.crops.sort(function(a,b){return order.indexOf(a)-order.indexOf(b);}).map(function(k){return labels[k]||k;});});
      $('pb-skipped').innerHTML=grp.length?grp.map(function(g){return '<b>'+esc(fdate(g.ed))+' close</b> ('+esc(fdate(g.report))+' report): '+esc(g.crops.join(', '))+'. '+esc(g.miss?'Missed: the bot did not run at that close, and a call is never made late.':g.reason.charAt(0).toUpperCase()+g.reason.slice(1)+'.');}).join('<br>'):'None so far.';
    }).catch(function(){
      ['pb-live-verdict','pb-bt-verdict'].forEach(function(id){$(id).textContent='Could not load the record right now.';});
      var lb=$('pb-log').querySelector('tbody');
      (function(f){f();if(!window.AgStates)(window.AgStatesQ=window.AgStatesQ||[]).push(f);})(function(){if(lb&&window.AgStates){lb.removeAttribute('aria-busy');lb.innerHTML='<tr><td colspan="8" id="pb-log-err"></td></tr>';
        AgStates.error('pb-log-err',{msg:'The call log didn\u2019t load.',retry:function(){lb.setAttribute('aria-busy','true');lb.innerHTML='<tr><td colspan="8"><span class="sr-only">Loading the call log</span><span class="st-sk st-line" aria-hidden="true" style="height:1.1em;margin:.65em 0"></span><span class="st-sk st-line" aria-hidden="true" style="height:1.1em;margin:.65em 0"></span><span class="st-sk st-line" aria-hidden="true" style="height:1.1em;margin:.65em 0"></span><span class="st-sk st-line" aria-hidden="true" style="height:1.1em;margin:.65em 0"></span><span class="st-sk st-line" aria-hidden="true" style="height:1.1em;margin:.65em 0"></span></td></tr>';loadRec();}});}});
    });
    }
    loadRec();
  })();
  
  /* Right-edge fade on the scrolling tables while there is more to the right. */
  (function(){
    function upd(w){w.classList.toggle('pb-fade',w.scrollLeft+w.clientWidth<w.scrollWidth-2);}
    document.querySelectorAll('.pb-wrap').forEach(function(w){
      upd(w);
      w.addEventListener('scroll',function(){upd(w);},{passive:true});
      if('ResizeObserver' in window){var ro=new ResizeObserver(function(){upd(w);});ro.observe(w);if(w.firstElementChild)ro.observe(w.firstElementChild);}
      else window.addEventListener('resize',function(){upd(w);});
    });
  })();
