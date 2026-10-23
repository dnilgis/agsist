/* What's priced in: redraws the section from data/whats-priced-in.json and data/analyst-scorecard.json.
   Moved out of whats-priced-in.html on Oct 22, 2026, when that page became a section of /usda-calendar.
   Loaded by the page when a reader nears the section (or opens the page on one of its links);
   until then the baked HTML (scripts/prerender_wpi_scorecard.py, scripts/seed_static.py) shows. */
(function(){
  function daysUntil(d){/* AUDIT 2026-08-11: compare calendar DATES, not noon-anchored ceil — the old version said 'tomorrow' all report-day morning */var t=new Date(d+'T00:00:00');var now=new Date();now.setHours(0,0,0,0);return Math.round((t-now)/86400000);}
  /* A LOCAL ONE ON PURPOSE. There is an identical esc() further down the page,
     but it lives inside the scorecard's own IIFE and is not visible from this
     one. Reaching for it renders the whole panel as "briefly unavailable":
     resultBanner throws ReferenceError, the fetch's catch swallows it, and the
     reader gets an error where the report was. Four characters, declared where
     it is used. Kept byte-identical to the other so the baked port can mirror
     one rule; test/wpi-numbers-strip.test.mjs holds them together. */
  
  function num(n,u){return (n==null)?'-':(n+(u?(' '+u):''));}
  /* THE STRIP. Renders what the pipeline decided and decides nothing itself.
     A missing figure prints an em dash and the reason the pipeline gave, never
     a blank cell and never a zero. */
  function numbersEl(rows){
    if(!rows||!rows.length)return '';
    var DASH='n/a';
    var body=rows.map(function(r){
      var u=r.unit?(' '+r.unit):'';
      var exp=(r.expected==null)?(DASH+(r.expected_why?('<div style="font-size:.72rem;color:var(--wp-mut)">'+esc(r.expected_why)+'</div>'):'')):(r.expected+u+(r.source_date_unknown?'<div style="font-size:.72rem;color:var(--wp-mut)">source date unknown</div>':''));
      var rng=(r.low!=null&&r.high!=null)?('<div style="font-size:.72rem;color:var(--wp-mut)">range '+r.low+' to '+r.high+'</div>'):'';
      var now=(r.usda_current==null)?DASH:(r.usda_current+u);
      var printed,tag='';
      if(r.actual==null){ printed='<td class="wait">'+esc(r.why||'not printed yet')+'</td>'; }
      else{
        if(r.surprise==='bullish')tag='<span class="v bull">bullish</span>';
        else if(r.surprise==='bearish')tag='<span class="v bear">bearish</span>';
        else if(r.surprise==='in line')tag='<span class="v flat">in line</span>';
        else tag='<span class="v flat" title="'+esc(r.why||'')+'">no call</span>';
        /* Where it sat against the survey's own low and high, worded by the pipeline (report_bands.range_context). */
        var ctx=r.context?('<div style="font-size:.72rem;color:var(--wp-mut)">'+esc(r.context)+'</div>'):'';
        printed='<td class="n"><b>'+r.actual+u+'</b>'+tag+ctx+'</td>';
      }
      return '<tr><td>'+esc(r.label)+rng+'</td><td class="n">'+exp+'</td><td class="n">'+now+'</td>'+printed+'</tr>';
    }).join('');
    /* One link per distinct survey: a report's yields and its stocks can come from two surveys, and one link would credit both to the first. */
    var srcs=rows.map(function(r){return r.source;}).filter(function(s,i,a){return s&&a.indexOf(s)===i;});
    var src=srcs[0];
    var links=srcs.length>1?('Survey sources: '+srcs.map(function(s){return '<a href="'+esc(s)+'" rel="nofollow noopener" target="_blank">'+esc(s.replace(/^https?:\/\/(www\.)?/,'').split('/')[0])+'</a>';}).join(', ')):('<a href="'+esc(src)+'" rel="nofollow noopener" target="_blank">Survey source</a>');
    var note=src?('<div class="src">Trade estimates come from a published pre-report survey, entered as published. '+links+'. Graded on the distance from the trade average: within 0.5% for a yield, 1% for production and 2% for stocks is in line; past that, more supply than the trade expected is bearish and less is bullish. The survey\u2019s low-high range is shown beside the grade and does not change it.</div>'):'';
    var waiting=rows.every(function(r){return r.actual==null;});
    /* Once USDA prints, its standing figure is the one from BEFORE the report. */
    return '<div class="wp-nums"><div class="nh"><b>Every number on this report</b><span>'
      +(waiting?'USDA prints at 11:00 a.m. CT. This fills in on its own.':'Graded against the pre-report survey.')
      +'</span></div><table><thead><tr><th>Number</th><th>Trade expects</th><th>'+(waiting?'USDA now':'USDA before')+'</th><th>USDA printed</th></tr></thead><tbody>'
      +body+'</tbody></table>'+note+'</div>';
  }

  /* THE NUMBER TO BEAT. USDA's standing figures from the last WASDE, shown
     between reports until the next survey is typed in. Their own numbers,
     dated, never ours. Port: scripts/prerender_wpi_scorecard.py to_beat_el();
     test/wpi-to-beat.test.mjs holds the two to the same bytes. */
  function toBeatEl(tb,nextReport){
    if(!tb||!tb.rows||!tb.rows.length)return '';
    var MO=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var p=String(tb.date||'').split('-'),md=(p.length===3)?(MO[+p[1]-1]+' '+(+p[2])):esc(tb.date);
    var body=tb.rows.map(function(r){
      return '<tr><td>'+esc(r.label)+'</td><td class="n"><b>'+esc(r.value)+' '+esc(r.unit)+'</b></td></tr>';
    }).join('');
    return '<div class="wp-nums wp-beat"><div class="nh"><b>The number to beat</b><span>USDA\u2019s '+esc(tb.report)+' ('+md+'), standing until the '+esc(nextReport||'next report')+'</span></div>'
      +'<table><thead><tr><th>Number</th><th>USDA now</th></tr></thead><tbody>'+body+'</tbody></table>'
      +'<div class="src">USDA\u2019s own figures'+(tb.wasde_no?(' ('+esc(tb.wasde_no)+')'):'')+'. A survey average, high and low go beside them once a pre-report survey posts, with the source and time. '
      +'<a href="'+esc(tb.source)+'" rel="noopener" target="_blank">USDA WASDE</a></div></div>';
  }
  function nextCard(n,skipNums){
    if(!n)return '<div class="wp-err">No upcoming report is scheduled right now. Check the <a href="/usda-calendar" style="color:var(--wp-gold2)">USDA calendar</a>.</div>';
    var d=daysUntil(n.date);
    var cd=(d>1)?(d+' days\u00a0out'):(d===1?'tomorrow':(d===0?'today':'released'));
    var lo=n.estimate_low,hi=n.estimate_high,av=n.estimate_avg,u=n.unit||'';
    var W=n.withheld||{};
    function gap(key,title){return W[key]?('<div class="wp-gap"><b>'+title+':</b> '+W[key]+'</div>'):'';}
    var rangeHtml='';
    if(lo!=null&&hi!=null&&hi>lo){
      /* CLAMP IT. Unclamped, an average outside its own range put the tick
         hundreds of pixels past the end of the bar -- off-screen at phone width,
         so the reader saw a range bar with no average and no sign one was
         intended. */
      var pAvRaw=(av!=null)?((av-lo)/(hi-lo)*100):50;
      var pAv=Math.max(0,Math.min(100,pAvRaw));
      var avOut=(av!=null)&&(av<lo||av>hi);
      rangeHtml='<div class="wp-range"><span aria-hidden="true">'+lo+'</span>'
        +'<span class="wp-rbar" role="img" aria-label="Trade range '+lo+' to '+hi
        +(n.unit?(' '+n.unit):'')+(av!=null?(', average '+av):'')+'">'
        +'<span class="span" style="left:0;right:0"></span><span class="avg" style="left:'+pAv.toFixed(0)+'%"></span></span>'
        +'<span aria-hidden="true">'+hi+'</span></div>'
        +(avOut?'<div class="wp-gap">The survey average ('+av+') falls outside the published high and low. The marker is pinned to the end of the bar.</div>':'')
        +'<div class="wp-metric">Trade range for '+n.metric+' &middot; avg <b style="color:var(--wp-gold2)">'+num(av,u)+'</b></div>';
    } else { rangeHtml=gap('range','No trade range yet'); }
    var odds='';
    if(n.implied_odds&&n.implied_odds.length){
      odds='<div class="wp-odds">'+n.implied_odds.map(function(o){
        return '<div class="o"><div class="ol"><span>'+o.label+'</span><span>'+o.pct+'%</span></div><div class="ot"><span class="of" style="width:'+o.pct+'%"></span></div></div>';
      }).join('')+'</div>';
    } else { odds=gap('odds','No market odds'); }
    var thr='';
    if(n.bullish_threshold||n.bearish_threshold){
      thr='<div class="wp-thr">'
        +'<div class="t bull"><div class="k">Bullish surprise</div><div class="v">'+(n.bullish_threshold||'-')+'</div></div>'
        +'<div class="t bear"><div class="k">Bearish surprise</div><div class="v">'+(n.bearish_threshold||'-')+'</div></div></div>';
    } else { thr=gap('thresholds','No surprise thresholds'); }
    var pos=n.positioning?('<div class="wp-pos">Fund positioning: '+n.positioning+'</div>')
      :gap('positioning','No positioning');
    return '<div class="wp-card"><div class="hd"><span class="rpt">'+n.report+'</span><span class="cd">'+n.date+(n.time?(' \u00b7 '+n.time.replace('12:00 PM ET','11:00 a.m. CT')):'')+' \u00b7 '+cd+'</span></div>'
      +(n.commodity?'<div class="wp-metric">'+n.commodity+': '+(n.metric||'')+'</div>':'')
      +(n.expectation?'<div class="wp-exp">'+n.expectation+'</div>':'')
      +toBeatEl(n.to_beat,n.report)+rangeHtml+odds+thr+pos+(skipNums?'':numbersEl(n.numbers))+'</div>';
  }
  var MON3=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function lastLine(lr){
    var b=lr.biggest_surprise||{},p=lr.date.split('-');
    var md=MON3[+p[1]-1]+' '+(+p[2]);
    var body;
    if(!lr.metric_count)body='No figure had a trade estimate to grade it against.';
    else if(lr.all_in_line||!b.metric)body='Every graded figure landed in line with the trade.';
    else body=lr.in_line_count+' of '+lr.metric_count+' graded figures landed in line. Biggest miss, '+esc(b.metric)+': '
      +num(b.actual,b.unit)+' vs '+num(b.expected,b.unit)+' expected ('+(b.gap_pct!=null?((b.gap_pct>0?'+':'')+b.gap_pct+'%, '):'')+(b.surprise||'no trade estimate')+').';
    var re=(b.reaction&&b.reaction_from==='settles'&&!lr.all_in_line)?(' '+esc(b.reaction)):'';
    return '<div class="wp-last"><b>Last report, the '+esc(lr.report)+' ('+md+'):</b> '+body+re
      +' <a href="#track-record">Every figure</a></div>';
  }
  function resultBanner(lr){
    if(!lr||!lr.date)return '';
    /* CALENDAR DAYS, the same comparison days_until() already makes, so the
       baked copy and the hydrated copy agree. A local-noon anchor made this
       off by one against prerender_wpi_scorecard.py's date arithmetic: on
       report morning the baker showed the banner and the live page did not,
       and six days later the reverse -- from one JSON file. */
    var _t=new Date(); _t.setHours(0,0,0,0);
    var _r=new Date(lr.date+'T00:00:00'); _r.setHours(0,0,0,0);
    var age=Math.round((_t-_r)/86400000);
    if(age<0||age>45)return '';
    /* BETWEEN REPORTS, ONE LINE (2026-10-15). The full banner lives report day
       plus five; after that the last result was folded away in the track
       record and the first screen answered nothing for three weeks. Twin of
       last_line() in scripts/prerender_wpi_scorecard.py. */
    if(age>5)return lastLine(lr);
    var b=lr.biggest_surprise||{};
    var sc=(b.surprise==='bullish')?'bull':(b.surprise==='bearish'?'bear':'flat');
    /* metric_count is the GRADED count; a figure with no trade estimate is
       neither in line nor a surprise, so it is named beside the count instead. */
    var ung=lr.ungraded_count?(' ('+lr.ungraded_count+' had no trade estimate)'):'';
    var miss=(lr.metric_count||0)-(lr.in_line_count||0);
    var sum=!lr.metric_count
      ? 'No figure in this report had a trade estimate to grade it against'+ung+'.'
      : lr.all_in_line
      ? 'Landed in line across the board, no real surprise versus what the trade had priced in'+ung+'.'
      : lr.in_line_count+' of '+lr.metric_count+' graded figures landed in line with the trade'+ung+'. '+(miss>1?'The biggest miss:':'The one that didn\u2019t:');
    var big='';
    if(b.metric && !lr.all_in_line){
      var gp=(b.gap_pct!=null)?((b.gap_pct>0?'+':'')+b.gap_pct+'% vs trade'):'';
      /* The grade is against the trade AVERAGE; where the print sat in the
         survey's own low-high range is the pipeline's context line. */
      var inNote='';
      if(b.context&&b.low!=null&&b.high!=null){
        inNote=b.context.charAt(0).toUpperCase()+b.context.slice(1)+' ('+b.low+' to '+b.high+').';
      }
      big='<div class="wp-res-big">'
        +'<div class="wp-res-row"><span class="wp-res-metric">'+b.metric+'</span>'
        +'<span class="wp-res-tag '+sc+'">'+(b.surprise||'no trade estimate')+'</span></div>'
        +'<div class="wp-res-nums"><b>'+num(b.actual,b.unit)+'</b> actual &middot; '+num(b.expected,b.unit)+' expected'+(gp?(' &middot; '+gp):'')+'</div>'
        +(inNote?'<div class="wp-res-reaction">'+inNote+'</div>':'')
        +(b.reaction?'<div class="wp-res-reaction">'+b.reaction+'</div>':'')+'</div>';
    }
    /* THE WALK-THROUGH LIVES HERE NOW, not only on the next-report card.
       The strip used to hang off `upcoming`, which stops being the report the
       moment its date passes -- so on 2026-09-11 it showed the trade's guesses
       all morning and was gone before the grade was even written. Same rows,
       same renderer, attached to the banner that already runs report day plus
       five. */
    return '<div class="wp-result '+sc+'"><div class="wp-res-hd"><span class="wp-res-k">How the '+lr.report+' landed</span><span class="wp-res-d">'+lr.date+'</span></div>'
      +'<div class="wp-res-sum">'+sum+'</div>'+big+numbersEl(lr.numbers)
      +'<div class="wp-res-foot">Every figure, scored, in the <a href="#track-record">track record</a> below.</div></div>';
  }
  function fmtNum(n,u){return (n==null)?'n/a':(n+(u?('\u00a0'+u):''));}
  /* AN EMPTY SURPRISE IS NOT "IN LINE". Both builders used to return "in line"
     when there was no consensus to compare against, and the page rendered
     `r.surprise||'in line'` on top of that — so a metric nobody had filed an
     estimate for was published as having landed where the trade expected. */
  function tagText(s){return s?s:'no trade estimate';}
  function tagCls(s){return (s==='bullish')?'bull':(s==='bearish'?'bear':'flat');}
  function gapText(g){return (g==null)?'':((g>0?'+':'')+g+'% vs trade');}
  function historyEl(h){
    if(!h||!h.length)return '<div class="wp-err">No scored reports yet.</div>';
    var groups=[],idx={};
    h.forEach(function(r){var k=r.date+'|'+r.report;if(!(k in idx)){idx[k]=groups.length;groups.push({date:r.date,report:r.report,rows:[]});}groups[idx[k]].rows.push(r);});
    return groups.map(function(g){
      var surp=g.rows.filter(function(r){return r.surprise&&r.surprise!=='in line';});
      /* "ALL IN LINE" OVER A REPORT NOBODY GRADED. The row-level fix landed;
         the group pill above it kept asserting the report matched expectations
         for windows where no expectation was ever filed -- the page's own lede
         says the July WASDE went unscored. A pill counts what was scored. */
      var scoredRows=g.rows.filter(function(r){return r.surprise;});
      var pill=surp.length?(surp.length+' surprise'+(surp.length>1?'s':''))
             :(scoredRows.length?'all in line':'not scored');
      var pillCls=surp.length?'surp':'line';
      var ordered=g.rows.slice().sort(function(a,b){var av=(a.surprise&&a.surprise!=='in line')?0:1,bv=(b.surprise&&b.surprise!=='in line')?0:1;return av-bv;});
      var body=ordered.map(function(r){
        var cls=tagCls(r.surprise);
        var gp=gapText(r.gap_pct);
        /* Not graded (survey date unknown) says so in the tag, and a row with
           no price move says why, dated. Port: prerender history_el(). */
        return '<div class="wp-hr"><div class="wp-hr-top"><span class="wp-hr-metric">'+r.metric+'</span><span class="wp-tag '+cls+'">'+(r.ungraded_why?'not graded':tagText(r.surprise))+'</span></div>'
          +'<div class="wp-hr-nums">'+fmtNum(r.expected,r.unit)+' <span class="wp-arrow">\u2192</span> <b class="'+cls+'">'+fmtNum(r.actual,r.unit)+'</b></div>'
          +(gp?'<div class="wp-hr-gap">'+gp+(r.context?' &middot; '+esc(r.context):'')+'</div>':'')
          +(r.ungraded_why?'<div class="wp-hr-gap">'+esc(r.ungraded_why)+'</div>'
            :(r.source_date_unknown?'<div class="wp-hr-gap">Trade survey source date unknown.</div>':''))
          +(r.reaction?'<div class="wp-hr-reaction">'+r.reaction+(r.reaction_source?' <a href="'+esc(r.reaction_source)+'" rel="nofollow noopener" target="_blank">Source</a>':'')+'</div>'
            :'<div class="wp-hr-gap">'+esc(r.reaction_why||'No note written on how the market took it.')+'</div>')+'</div>';
      }).join('');
      return '<div class="wp-hg"><div class="wp-hg-hd"><span class="wp-hg-rpt">'+g.report+'</span>'
        +'<span class="wp-hg-meta"><span class="wp-hg-pill '+pillCls+'">'+pill+'</span><span class="wp-hg-date">'+g.date+'</span></span></div>'+body+'</div>';
    }).join('');
  }
  function agsND(o){if(typeof o==='string')return /^\s*\u2014\s*$/.test(o)?'-':o.replace(/^\s*\u2014\s*/,'').replace(/\s*\u2014\s*/g,', ');if(Array.isArray(o))return o.map(agsND);if(o&&typeof o==='object'){for(var k in o)if(Object.prototype.hasOwnProperty.call(o,k))o[k]=agsND(o[k]);}return o;} /* the site prints no em dashes; older data files still carry some */
  fetch('/data/whats-priced-in.json',{cache:'no-store'}).then(function(r){if(!r.ok)throw 0;return r.json();}).then(function(d){d=agsND(d);
    if(d.sample){document.getElementById('wp-sample').style.display='block';return;}  /* no placeholder figures, ever */
    document.getElementById('wp-result').innerHTML=resultBanner(d.latest_result);
    /* ONE TABLE. If the next card is still the report the banner just graded,
       the banner already carries its numbers. */
    var lrd=d.latest_result&&d.latest_result.date;
    document.getElementById('wp-next').innerHTML=nextCard(d.upcoming,!!(d.upcoming&&lrd&&d.upcoming.date===lrd&&document.getElementById('wp-result').innerHTML));
    document.getElementById('wp-history').innerHTML=historyEl(d.history);
    try{
      var s=document.getElementById('wp-dataset-ld');
      if(s&&d.updated){var ld=JSON.parse(s.textContent);ld.dateModified=d.updated;s.textContent=JSON.stringify(ld);}
    }catch(e){}
    var up=d.upcoming||{};
    gaEvent('wpi_view',{report:up.report||'',range_live:!!(up.estimate_low!=null&&up.estimate_high!=null)});
    var lr=d.latest_result;
    if(lr&&document.getElementById('wp-result').innerHTML){
      gaEvent('wpi_result',{report:lr.report||'',in_line:lr.in_line_count,of:lr.metric_count});
    }
  }).catch(function(){
    document.getElementById('wp-next').innerHTML='<div class="wp-err">Report expectations didn’t load. Refresh, or see the <a href="/usda-calendar" style="color:var(--wp-gold2)">USDA report calendar</a>.</div>';
  });
  var wrap=document.querySelector('.wp-wrap');
  if(wrap)wrap.addEventListener('click',function(e){var a=e.target.closest('a[href^="/"]');if(a)gaEvent('wpi_link',{to:a.getAttribute('href'),page:'whats-priced-in'});});
  document.querySelectorAll('#wp-faq details').forEach(function(d){d.addEventListener('toggle',function(){if(d.open)gaEvent('faq_open',{page:'whats-priced-in'});});});
})();

(function(){
  
  function biasCell(b){
    if(b==null)return '<span class="as-bias">-</span>';
    if(Math.abs(b)<0.25)return '<span class="as-bias">&#8776; even</span>';
    var hi=b>0;return '<span class="as-bias"><span class="'+(hi?'hi':'lo')+'">'+(hi?'+':'')+b.toFixed(2)+'% '+(hi?'high':'low')+'</span></span>';
  }
  /* ── EVERYONE WHO HAS BEEN SCORED IS ON THIS TABLE ──────────────────────
     The building rows were computed, published into the JSON, and rendered
     only when the ranked table was EMPTY. On 2026-09-09 that meant one row on
     the page: Arlan Suderman, ranked #1, alone, at 1.81% average error and a
     0% beat-trade rate — while Jerry Gulke at 0.03%, Robert McClure at 0.98%
     and the house model at 1.85% sat in a hidden array. The page ranked the
     least accurate forecaster on record first and said nothing about the three
     it was not showing.

     They are one table now, with a rule across it. Above the rule is the
     ranking, which still needs three scored calls to enter — a two-call
     leaderboard is noise and that threshold is not moving. Below it are the
     records still building, greyed, with how many calls each still needs. */
  /* THE SPREAD TRAVELS WITH THE MEAN. 2.11% over four calls that ran 1.60% to
     2.46% and 2.11% over four calls that all landed on 2.11% are different
     records, and the board printed them the same way while ordering people by
     the first two digits. */
  function spreadNote(r){
    if(r.err_min==null||r.err_max==null)return '';
    if((r.n||0)<2||(r.err_max-r.err_min)<0.005)return '';
    return '<span class="as-spread">calls ran '+r.err_min.toFixed(2)+'\u2013'+r.err_max.toFixed(2)+'%</span>';
  }
  /* CLOSEST OF WHO FILED IS NOT A WIN. Both badges this board had ever awarded
     sat on forecasts that were FURTHER from the print than the free consensus
     two columns to the left. `wins` now counts only closest-and-beat-the-trade;
     anything that was merely closest says so in grey, in words. */
  /* A MIDPOINT WE COMPUTED, SAID ON THE BOARD ROW TOO. The per-report rows
     already mark it; the board averaged the same figure and said nothing. */
  function derivedNote(r){
    if(!r.derived_n)return '';
    var t=(r.derived_n===r.n)?'midpoint of a stated range':(r.derived_n+' of '+r.n+' a midpoint of a stated range');
    return '<span class="as-res-derived" title="The forecaster published a range, not a point. AGSIST scored its midpoint so the call could be scored at all.">'+t+'</span>';
  }
  function winsBadge(r){
    if(r.closest_n==null){
      /* An older scorecard file, where `wins` counted closest alone. Say the
         weaker thing rather than the thing the number cannot support. */
      return r.wins?('<span class="as-wins mut" title="Closest of the forecasters who filed a number for that metric. It does not mean the call beat the trade consensus.">'+r.wins+'\u00d7 closest filed</span>'):'';
    }
    var out='';
    if(r.wins)out+='<span class="as-wins" title="Closest of everyone on record for that metric, and closer to the print than the trade consensus. A midpoint we worked out from a published range does not count.">'+r.wins+'\u00d7 closest, beat trade</span>';
    var only=r.closest_n-r.wins;
    if(only>0)out+='<span class="as-wins mut" title="Closest of the forecasters who filed a number for that metric, but still further from the print than the free trade consensus, so it did not beat the trade.">'+only+'\u00d7 closest filed, wider than trade</span>';
    return out;
  }
  function boardRow(r,rank,minN,showRank){
    var beatCls=(r.beat_rate!=null&&r.beat_rate>=50)?'as-beat':'as-beat lo';
    /* THE COUNT, NOT ONLY THE RATE. "0%" over three calls and "0%" over thirty
       are not the same claim about a forecaster. */
    var cnt=(r.beat_yes!=null&&r.beat_n!=null)?('<span class="as-mut"> &middot; '+r.beat_yes+' of '+r.beat_n+'</span>')
      :((r.beat_n!=null&&r.beat_n!==r.n)?('<span class="as-mut"> of '+r.beat_n+'</span>'):'');
    var beat=(r.beat_rate==null)
      ? '<span class="as-mut" title="None of this forecaster\u2019s scored calls had a trade estimate to beat">no trade to beat</span>'
      : '<span class="as-cell"><span class="'+beatCls+'">'+r.beat_rate+'%</span>'+cnt+'</span>';
    var calls=r.qualified?String(r.n):(r.n+' of '+minN);
    return '<tr'+(r.qualified?'':' class="as-building"')+'>'
      +(showRank?('<td class="rk" data-label="#">'+(rank||'n/a')+'</td>'):'')
      +'<td data-label="Analyst"><span class="who">'+esc(r.analyst)+'</span>'
      +(/agsist\.com/i.test(r.firm||'')?'<span class="as-ours" title="AGSIST’s own model, scored by the same rules as everyone else.">ours</span>':'')
      +'<span class="firm">'+esc(r.firm)+'</span>'
      +winsBadge(r)+'</td>'
      +'<td class="num" data-label="Calls">'+calls+'</td>'
      +'<td class="num" data-label="Avg error"><span class="as-cell"><span class="as-acc">'+r.mape.toFixed(2)+'%</span>'+spreadNote(r)+derivedNote(r)+'</span></td>'
      +'<td class="num" data-label="Beat trade">'+beat+'</td>'
      +'<td class="num" data-label="Bias">'+biasCell(r.bias)+'</td></tr>';
  }
  /* ── ONE TABLE PER METRIC CLASS, AND NO ORDINAL IT CANNOT SUPPORT ────────
     Two separate things were wrong here. The first was upstream: score() added
     every error percentage into one mean regardless of metric, so one soybean
     ending-stocks call at 2.58% off carried a forecaster over the 3-call bar
     and he printed "#1" on a record that was really two yield calls. That is
     fixed in build_analyst_scorecard.py; this side now renders one class at a
     time and says on the table which class it is.

     The second was here: "#1  1.81%" over "#2  2.11%" is a finishing order
     asserted on three and four observations with a 0.30-point gap and no
     interval anywhere on the page. Ordinals now need two qualifying
     forecasters AND ordinal_min_n scored calls each; under that the records
     print in order of average error with the spread beside each one, and the
     column of places is not rendered at all -- a "#" column full of dashes
     still tells a reader that a place exists and is merely being withheld. */
  var ORD_MIN=10;
  function boardTbl(rows,building,minN,cls,ordMin){
    minN=minN||3;ordMin=ordMin||ORD_MIN;
    rows=rows||[];building=building||[];
    if(!rows.length&&!building.length)return '<div class="as-err">No forecasters scored yet.</div>';
    var ordinals=(cls&&cls.ordinals_ok!=null)
      ? !!cls.ordinals_ok
      : (rows.length>1&&rows.every(function(r){return (r.n||0)>=ordMin;}));
    var span=ordinals?6:5;
    var head='<table class="as-tbl"><thead><tr>'+(ordinals?'<th>#</th>':'')+'<th>Analyst</th><th class="num">Calls</th><th class="num">Avg error</th><th class="num">Beat trade</th><th class="num">Bias</th></tr></thead><tbody>';
    var cap='';
    if(cls&&cls.label){
      cap='<tr class="as-cap"><td colspan="'+span+'"><b>'+esc(cls.label)+'</b>'
        +((cls.calls!=null)?(' \u00b7 '+cls.calls+' scored call'+(cls.calls===1?'':'s')):'')
        +'. Errors are averaged inside this group only: a 2% miss on a yield and a 2% miss on '
        +'ending stocks are not the same miss, and this page does not add them together.</td></tr>';
    }
    var body=rows.map(function(r,i){return boardRow(r,ordinals?i+1:null,minN,ordinals);}).join('');
    var brows=building.map(function(r){return boardRow(r,null,minN,ordinals);}).join('');
    var note='';
    if(building.length&&rows.length){
      note='<tr class="as-split"><td colspan="'+span+'">Still building. Listed above the line once a forecaster has '
        +'<b>'+minN+' scored calls in this group</b>. Their accuracy so far is real and is shown; '
        +'their position is not, because '+(minN-1)+' calls is not a record.</td></tr>';
    }
    var lead='';
    if(!rows.length){lead='<div class="as-err" style="margin-bottom:.6rem">Nobody has '+minN+' scored calls in this group yet. Building records below.</div>';}
    else if(rows.length===1){lead='<div class="as-err" style="margin-bottom:.6rem">A finishing order needs at least two forecasters with '+ordMin+' scored calls each in the same group. One forecaster has '+minN+' or more so far, so this board shows records, not places.</div>';}
    else if(!ordinals){lead='<div class="as-err" style="margin-bottom:.6rem">Listed by average error, with no places. This page prints a finishing order only once every forecaster above the line has <b>'+ordMin+' scored calls</b> in the same group. Under that, the gap between two averages sits inside the spread of each one\u2019s own calls (shown beside every average), so an order would be a coin flip.</div>';}
    return lead+head+cap+body+note+brows+'</tbody></table>';
  }
  /* ── WHAT THE BOARD'S OWN NUMBERS SAY, IN ONE LINE, UNDER THE BOARD ──────
     Under a heading about who calls these reports well, every qualifying
     forecaster on this board has a beat-trade rate of 0% -- the page's own
     column said so and the page never said what it meant. It says it here, and
     it is computed, so it changes on its own the day somebody beats it. */
  function beatNote(qrows,brows){
    qrows=qrows||[];brows=brows||[];
    if(!qrows.length)return '';
    var yes=0,n=0,counted=true;
    qrows.forEach(function(r){
      if(r.beat_n==null)return;
      n+=r.beat_n;
      if(r.beat_yes==null)counted=false;else yes+=r.beat_yes;
    });
    if(!n)return '<b>No forecaster above the line has a call with a trade consensus on file</b>, so nothing here has been measured against the free number yet.';
    /* An older scorecard file carries the rounded rate but not the raw count.
       A rounded rate cannot be turned back into "3 of 17" -- but every rate
       being exactly 0 does settle the only question this sentence asks, so the
       sentence still gets written, without the counts it cannot prove. */
    if(!counted){
      var allZero=qrows.every(function(r){return r.beat_rate===0;});
      if(!allZero)return '';
      return '<b>No forecaster with enough scored calls to be listed above the line has beaten the trade consensus.</b> '
        +'Not one of the '+n+' graded call'+(n===1?'':'s')+' with a consensus on file landed closer to the USDA print '
        +'than the free trade estimate in the \u201cBeat trade\u201d column.';
    }
    /* BELOW THE LINE, ONE COUNT PER GROUP (Oct 16 head to head, B1). The
       pooled count read "2 of 7" under the yield board: 2 of 6 yield calls
       plus Suderman's one stocks call, the two groups the page says it never
       pools. Each group now gets its own count, named. */
    var tail='';
    var grp={},order=[],byes=0,bok=true;
    brows.forEach(function(r){
      if(r.beat_n==null)return;
      var k=r.class_label||'calls';
      if(!grp[k]){grp[k]={yes:0,n:0};order.push(k);}
      grp[k].n+=r.beat_n;
      if(r.beat_yes==null)bok=false;else{grp[k].yes+=r.beat_yes;byes+=r.beat_yes;}
    });
    if(bok&&byes>0)tail=' Below the line, records still building have landed closer than the consensus on '
      +order.map(function(k){return grp[k].yes+' of '+grp[k].n+' '+esc(k.toLowerCase());}).join('; ')+'.';
    if(yes===0){
      return '<b>No forecaster with enough scored calls to be listed above the line has beaten the trade consensus.</b> '
        +'Of the '+n+' graded call'+(n===1?'':'s')+' with a consensus on file, 0 landed closer to the USDA print than '
        +'the free trade estimate in the \u201cBeat trade\u201d column. The consensus is the number a forecast has to beat '
        +'to be worth anything.'+tail;
    }
    return 'Forecasters above the line have landed closer to the print than the trade consensus on <b>'+yes+' of '+n+'</b> graded calls.'+tail;
  }
  /* Every metric class that is not the main board still gets a table. Sig's
     rule is that misses stay on the record; the stocks call that used to carry
     a forecaster onto the leaderboard is still here, scored on its own. */
  function otherClasses(classes,primary,minN,ordMin){
    if(!classes||!classes.length)return '';
    var rest=classes.filter(function(c){return c.key!==primary;});
    if(!rest.length)return '';
    return '<div class="as-legend" style="margin-top:1.2rem">Scored separately, because the errors are not comparable:</div>'
      +rest.map(function(c){return '<div class="as-otherblk">'+boardTbl(c.leaderboard,c.building,minN,c,ordMin)+'</div>';}).join('');
  }
  // WHEN THE CALL WAS LOCKED, SHOWN NEXT TO IT. A forecast filed the morning of
  // a report and one filed three weeks out are not the same claim, and the board
  // used to render them identically. Only calls that carry a lock date get the
  // note; the rest render exactly as before.
  var MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function lockNote(iso){
    if(!iso)return '';
    var m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if(!m)return '';
    var mi=parseInt(m[2],10)-1;
    if(mi<0||mi>11)return '';
    return '<span class="as-lock" title="The date this call was locked and can no longer be changed">locked '+MON[mi]+' '+parseInt(m[3],10)+'</span>';
  }
  function upcomingPanel(u){
    if(!u||!u.panel||!u.panel.length)return '<div class="as-err">No forecasts logged yet for the next report. Check back as analysts publish ahead of the release.</div>';
    var rows=u.panel.map(function(p){
      var vals=p.metrics.map(function(m){return '<span>'+esc(m.label)+':</span> '+esc(m.value)+(m.unit?(' '+esc(m.unit)):'');}).join(' &nbsp; ');
      var nm=p.source?('<a href="'+esc(p.source)+'" target="_blank" rel="noopener" style="color:inherit;text-decoration:none">'+esc(p.analyst)+'</a>'):esc(p.analyst);
      var lk=lockNote(p.locked_on);
      return '<div class="as-pa"><span class="nm">'+nm+'</span> <span class="fm">'+esc(p.firm)+'</span>'+(lk?(' '+lk):'')+'<div class="vals">'+vals+'</div></div>';
    }).join('');
    return '<div class="as-panelbox"><div style="font-family:\'JetBrains Mono\',monospace;font-size:.8rem;color:var(--as-gold2);margin-bottom:.4rem">'+esc(u.report)+' &middot; '+esc(u.date)+'</div>'+rows+'</div>';
  }
  function pipelineEl(pl){
    if(!pl||!pl.length)return '<div class="as-err">No calls filed yet. As forecasters post numbers ahead of a report, they land here, timestamped, and graded automatically once USDA prints.</div>';
    return pl.map(function(r){
      var mets=r.metrics.map(function(m){
        var ref=(m.consensus!=null)?('trade '+m.consensus):(m.usda_current!=null?('USDA '+m.usda_current):'');
        var calls=m.calls.map(function(c){
          var lc=(c.lean==='bullish')?'bull':(c.lean==='bearish'?'bear':'neut');
          var dev=(c.dev_pct!=null)?((c.dev_pct>0?'+':'')+c.dev_pct+'% '+esc(c.ref_label)):'';
          var nm=c.source?('<a href="'+esc(c.source)+'" target="_blank" rel="noopener" class="as-pl-link">'+esc(c.analyst)+'</a>'):esc(c.analyst);
          return '<div class="as-pl-call"><span class="as-pl-who">'+nm+'</span><span class="as-pl-firm">'+esc(c.firm)+'</span>'
            +'<span class="as-pl-val">'+esc(c.value)+(m.unit?(' '+esc(m.unit)):'')+'</span>'
            +'<span class="as-pl-badge '+lc+'">'+(dev?dev+' &middot; ':'')+esc(c.lean)+'</span>'+lockNote(c.locked_on)+'</div>';
        }).join('');
        return '<div class="as-pl-met"><div class="as-pl-met-lbl"><b>'+esc(m.label)+'</b>'+(ref?(' &middot; '+esc(ref)):'')+'</div>'+calls+'</div>';
      }).join('');
      return '<div class="as-pl-rep"><div class="as-pl-hd"><span class="as-pl-rep-name">'+esc(r.report)+'</span><span class="as-pl-date">'+esc(r.date)+'</span></div>'+mets+'</div>';
    }).join('');
  }
  function rosterEl(list){
    if(!list||!list.length)return '';
    return '<div class="as-roster">'+list.map(function(a){return '<span class="as-chip"><b>'+esc(a.firm||a.analyst)+'</b><span>'+esc(a.analyst)+'</span></span>';}).join('')+'</div>';
  }
  function reportsEl(reps){
    if(!reps||!reps.length)return '<div class="as-err">No graded forecaster calls yet, these fill in as forecasters on record get scored against the print.</div>';
    var blocks=reps.map(function(r){
      var mets=(r.metrics||[]).filter(function(m){return m.results&&m.results.length;});
      if(!mets.length)return '';
      var ms=mets.map(function(m){
        var cls=(m.surprise==='bullish')?'bull':(m.surprise==='bearish'?'bear':'flat');
        var res=m.results.map(function(x){
          /* SAY WHEN THE NUMBER IS OURS. Some of these are a midpoint AGSIST
             computed because the forecaster published a range. Rendering
             "180.75 &middot; 0.03% off &middot; closest call" with no mark
             credits a forecaster for a figure they never said. */
          /* ONLY the values AGSIST reduced from a published range. Keying this
             on source_note marked every properly-sourced call as derived --
             a false claim about four forecasters to disclose one. */
          var note=x.derived?(' <span class="as-res-derived" title="'+esc(x.source_note||'')+'">midpoint of a stated range</span>'):'';
          /* THE STAR IS A WIN OR IT IS NOTHING. It used to mark the closest
             number filed, and both stars on this page sat on forecasts that
             were further from the print than the free consensus: Sep 11 corn,
             182.6 at 2.30% off, starred over a consensus 0.22% off; Aug 12
             soybeans, 0.57% starred over a consensus at 0.38%. Both rows
             already carried "beat": false in the same JSON. Closest-of-those-
             who-filed now says exactly that, in grey, in words. */
          var star=(x.star!=null)?!!x.star:!!(x.closest&&x.beat);
          var mark=star?('\u2605 '):'';
          var tail=x.beat
            ? ' &middot; <span class="as-res-beat">beat trade</span>'
            : (x.closest?' &middot; <span class="as-mut">closest filed, wider than the trade</span>':'');
          return '<div class="as-res-row"><span class="as-res-who'+(star?' best':'')+'">'+mark+esc(x.analyst)+note+'</span>'
            +'<span class="as-res-stat">'+esc(x.value)+' &middot; '+x.err_pct.toFixed(2)+'% off'+tail+'</span></div>';
        }).join('');
        /* THE TRADE NUMBER, AND WHERE IT CAME FROM. `trade &mdash;` told a
           reader nothing about why there was no consensus, and the source link
           beside every consensus in analyst-estimates.json reached no page. */
        var cons=(m.consensus==null)
          ? '<span class="as-mut">no trade estimate on record</span>'
          : (m.consensus_source
              ? '<a href="'+esc(m.consensus_source)+'" target="_blank" rel="noopener" class="as-pl-link">trade '+esc(m.consensus)+'</a>'
              : 'trade '+esc(m.consensus));
        var n=(m.n_estimates!=null)?('<span class="as-mut"> &middot; '+m.n_estimates+' forecaster'+(m.n_estimates===1?'':'s')+' on record</span>'):'';
        /* WHAT EVERY FORECAST ON THIS METRIC WAS UP AGAINST. Without it the
           reader cannot tell that the closest call listed below lost to the
           consensus printed in the line above it. */
        var ce=(m.consensus_err_pct!=null)?('<span class="as-mut"> &middot; trade missed by '+m.consensus_err_pct.toFixed(2)+'%</span>'):'';
        return '<div class="as-met"><div class="as-met-hd"><span class="ml">'+esc(m.label)+'</span><span class="as-tag '+cls+'">'+esc(m.surprise||'no trade estimate')+'</span></div>'
          +'<div class="mc">'+cons+' <span class="as-arrow">\u2192</span> actual '+esc(m.actual)+(m.unit?('\u00a0'+esc(m.unit)):'')+ce+n+'</div>'+res+'</div>';
      }).join('');
      return '<div class="as-rep"><div class="hd"><span class="rpt">'+esc(r.report)+'</span><span class="cd">'+esc(r.date)+'</span></div>'+ms+'</div>';
    }).filter(Boolean).join('');
    return blocks||'<div class="as-err">No graded forecaster calls yet, these fill in as forecasters on record get scored against the print.</div>';
  }
  function agsND(o){if(typeof o==='string')return /^\s*\u2014\s*$/.test(o)?'-':o.replace(/^\s*\u2014\s*/,'').replace(/\s*\u2014\s*/g,', ');if(Array.isArray(o))return o.map(agsND);if(o&&typeof o==='object'){for(var k in o)if(Object.prototype.hasOwnProperty.call(o,k))o[k]=agsND(o[k]);}return o;} /* the site prints no em dashes; older data files still carry some */
  fetch('/data/analyst-scorecard.json',{cache:'no-store'}).then(function(r){if(!r.ok)throw 0;return r.json();}).then(function(d){d=agsND(d);
    if(d.sample){document.getElementById('as-ribbon').style.display='block';}
    var minN=d.min_n||3,ordMin=d.ordinal_min_n||ORD_MIN;
    var classes=(d.classes&&d.classes.length)?d.classes:null;
    var primary=d.primary_class||(classes?classes[0].key:null);
    var pcls=null;
    if(classes){pcls=classes.filter(function(c){return c.key===primary;})[0]||classes[0];}
    document.getElementById('as-board').innerHTML=boardTbl(d.leaderboard,d.building,minN,pcls,ordMin);
    /* The note is computed over EVERY class, not just the one on the main
       table, so a forecaster cannot be quietly excluded from the sentence by
       sitting in a second group. */
    var qrows=[],brows=[];
    if(classes){classes.forEach(function(c){qrows=qrows.concat(c.leaderboard||[]);brows=brows.concat(c.building||[]);});}
    else{qrows=(d.leaderboard||[]).slice();brows=(d.building||[]).slice();}
    document.getElementById('as-board-note').innerHTML=beatNote(qrows,brows);
    document.getElementById('as-board-note').style.display=document.getElementById('as-board-note').innerHTML?'':'none';
    document.getElementById('as-other').innerHTML=classes?otherClasses(classes,primary,minN,ordMin):'';
    if(d.leaderboard&&d.leaderboard.length){document.getElementById('as-legend').style.display='block';document.getElementById('as-minn').textContent=minN;document.getElementById('as-ordmin').textContent=ordMin;}
    document.getElementById('as-upcoming').innerHTML=pipelineEl(d.pipeline);
    document.getElementById('as-roster').innerHTML=rosterEl(d.roster)||'<div class="as-err">Roster loading&hellip;</div>';
    document.getElementById('as-reports').innerHTML=reportsEl(d.reports);
    try{var s=document.getElementById('as-dataset-ld');if(s&&d.updated){var ld=JSON.parse(s.textContent);ld.dateModified=d.updated;s.textContent=JSON.stringify(ld);}}catch(e){}
    gaEvent('scorecard_view',{ranked:(d.leaderboard||[]).length,scored_reports:(d.reports||[]).length});
  }).catch(function(){
    /* THE BAKED TABLE IS A CLAIM, AND IT GOES WITH THE FILE IT CAME FROM.
       The static copy below is only true of the scorecard that produced it, so
       when the scorecard cannot be read, the sentence under the board and the
       second class table are cleared too rather than left standing beside an
       error message. */
    document.getElementById('as-board').innerHTML='<div class="as-err">The analyst board didn’t load. Refresh, or see the <a href="#track-record" style="color:var(--as-gold2)">track record</a> above and the <a href="/usda-calendar" style="color:var(--as-gold2)">USDA calendar</a>.</div>';
    var bn=document.getElementById('as-board-note');if(bn){bn.innerHTML='';bn.style.display='none';}
    var ob=document.getElementById('as-other');if(ob)ob.innerHTML='';
  });
  var wrap=document.querySelector('.as-wrap');
  if(wrap)wrap.addEventListener('click',function(e){var a=e.target.closest('a[href^="/"]');if(a)gaEvent('scorecard_link',{to:a.getAttribute('href'),page:'analyst-scorecard'});});
  document.querySelectorAll('#as-faq details').forEach(function(x){x.addEventListener('toggle',function(){if(x.open)gaEvent('faq_open',{page:'analyst-scorecard'});});});
})();
