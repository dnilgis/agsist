/* Every past briefing on /daily#past, by month with a search (its own page, /archive, until
   Oct 23, 2026). Loaded when a reader opens the fold or the page opens on #past; until then the
   baked month list (scripts/generate_daily.py, SEED:archivelist) carries every link. */
(function(){
'use strict';

var DAY_NAMES  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
var MON_NAMES  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
var MON_FULL   = ['January','February','March','April','May','June','July','August','September','October','November','December'];

var allEntries = [];    // full sorted list
var activeMonth = null; // null = all
var searchTerm  = '';

function escHtml(s){ return (s||'').replace(/^\s*\u2014\s*/,'').replace(/\s*\u2014\s*/g,', ').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function parseDateOnly(str){
  if(!str)return null;
  var dateOnly = str.indexOf('T')>-1 ? str.split('T')[0] : str;
  var d = new Date(dateOnly+'T12:00:00');
  return isNaN(d.getTime()) ? null : d;
}

function shortLabel(d){
  return DAY_NAMES[d.getDay()]+' '+MON_NAMES[d.getMonth()]+' '+d.getDate();
}

function monthKey(d){
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
}

function monthDisplay(key){
  var parts = key.split('-');
  return MON_FULL[parseInt(parts[1],10)-1]+' '+parts[0];
}

// ── Render ─────────────────────────────────────────────────────────────
function render(){
  var filtered = allEntries.filter(function(e){
    var monthMatch = !activeMonth || e.monthKey === activeMonth;
    var searchMatch = !searchTerm || (e.headline||'').toLowerCase().indexOf(searchTerm) !== -1
                   || (e.lead||'').toLowerCase().indexOf(searchTerm) !== -1
                   || (e.date||'').indexOf(searchTerm) !== -1
                   || (e.shortLabel||'').toLowerCase().indexOf(searchTerm) !== -1;
    return monthMatch && searchMatch;
  });

  var statsEl = document.getElementById('arc-stats');
  var bodyEl  = document.getElementById('arc-body');

  if(!filtered.length){
    if(statsEl) statsEl.innerHTML = '<span class="arc-stats-count">No results</span>';
    if(bodyEl)  bodyEl.innerHTML  = '<div class="arc-empty"><strong>No briefings found</strong>'+(searchTerm?'Try a different search term.':'Nothing here yet.')+'</div>';
    return;
  }

  // Group by month
  var groups = {}; // monthKey → entries[]
  var order  = []; // monthKey order
  filtered.forEach(function(e){
    if(!groups[e.monthKey]){ groups[e.monthKey]=[]; order.push(e.monthKey); }
    groups[e.monthKey].push(e);
  });

  var totalWeekday = filtered.filter(function(e){return !e.isWkend;}).length;
  if(statsEl) statsEl.innerHTML = '<span class="arc-stats-count"><strong>'+filtered.length+'</strong> briefing'+(filtered.length!==1?'s':'')+' &middot; <strong>'+totalWeekday+'</strong> market day'+(totalWeekday!==1?'s':'')+'</span>';

  var html='';
  // Months fold. With no search or month picked, only the newest month is
  // open; a search or a picked month opens every group it matched.
  var openAll = !!(searchTerm || activeMonth);
  order.forEach(function(mk, gi){
    var grp = groups[mk];
    html += '<details class="arc-month-group"'+((openAll||gi===0)?' open':'')+'>';
    html += '<summary><div class="arc-month-label"><span>'+monthDisplay(mk)+'</span><span class="arc-month-count">'+grp.length+' briefing'+(grp.length!==1?'s':'')+'</span></div></summary>';
    html += '<div class="arc-grid">';
    grp.forEach(function(e){
      var hasHL = e.headline && e.headline.trim();
      html +=
        '<a href="/daily'+(e.date?'/'+e.date.split('T')[0]:'')+'" class="arc-card'+(e.isWkend?' wkend':'')+'" title="Read the '+escHtml(e.shortLabel)+' briefing">'+
          '<div class="arc-card-head">'+
            '<span class="arc-card-date">'+escHtml(e.shortLabel)+'</span>'+
            (e.yc==='played_out'?'<span class="arc-yc" title="That day\'s call played out" style="width:8px;height:8px;border-radius:50%;background:#5fc28a;flex-shrink:0"></span>':
             e.yc==='didnt'?'<span class="arc-yc" title="That day\'s call didn\'t play out" style="width:8px;height:8px;border-radius:50%;background:#e0685f;flex-shrink:0"></span>':'')+
            '<span class="arc-card-badge '+(e.isWkend?'wkend':'wkday')+'">'+(e.isWkend?'Weekend':'Market Day')+'</span>'+
          '</div>'+
          '<div class="arc-card-hl'+(hasHL?'':' placeholder')+'">'+escHtml(hasHL?e.headline:'No briefing this day')+'</div>'+
          (e.lead?'<div class="arc-card-lead">'+escHtml(e.lead.slice(0,120)+(e.lead.length>120?'…':''))+'</div>':'')+
        '</a>';
    });
    html += '</div></details>';
  });
  if(bodyEl) bodyEl.innerHTML = html;
}

// ── Month filter pills ────────────────────────────────────────────────
function buildMonthFilters(){
  var months = {};
  allEntries.forEach(function(e){ months[e.monthKey] = (months[e.monthKey]||0)+1; });
  var keys = Object.keys(months);
  if(keys.length <= 1){ document.getElementById('arc-month-filters').style.display='none'; return; }

  var html = '<button class="arc-filter-btn active" data-month="">All</button>';
  keys.forEach(function(mk){
    html += '<button class="arc-filter-btn" data-month="'+escHtml(mk)+'">'+monthDisplay(mk)+'</button>';
  });

  var wrap = document.getElementById('arc-month-filters');
  if(wrap){
    wrap.innerHTML = html;
    wrap.addEventListener('click', function(e){
      var btn = e.target.closest('.arc-filter-btn');
      if(!btn)return;
      wrap.querySelectorAll('.arc-filter-btn').forEach(function(b){b.classList.remove('active');});
      btn.classList.add('active');
      activeMonth = btn.getAttribute('data-month') || null;
      render();
    });
  }
}

// ── Search ────────────────────────────────────────────────────────────
var searchInput = document.getElementById('arc-search');
var searchClear = document.getElementById('arc-search-clear');
if(searchInput){
  searchInput.addEventListener('input', function(){
    searchTerm = this.value.trim().toLowerCase();
    if(searchClear) searchClear.classList.toggle('vis', searchTerm.length > 0);
    render();
  });
}
if(searchClear){
  searchClear.addEventListener('click', function(){
    if(searchInput) searchInput.value='';
    searchTerm='';
    searchClear.classList.remove('vis');
    render();
  });
}

// ── Load archive ──────────────────────────────────────────────────────
function load(){ return fetch('/data/daily-archive/index.json', {cache:'no-store'})
  .then(function(r){ return r.ok ? r.json() : Promise.reject(r.status); })
  .then(function(manifest){
    var briefings = (manifest && manifest.briefings) || [];

    allEntries = briefings.map(function(item){
      var d = parseDateOnly(item.date);
      var isWkend = d ? (d.getDay()===0||d.getDay()===6) : false;
      if(item.market_closed) isWkend = true;
      return {
        date:       item.date || '',
        headline:   item.headline || '',
        lead:       item.lead || item.teaser || '',
        shortLabel: d ? shortLabel(d) : (item.date_display||item.label||item.date||''),
        monthKey:   d ? monthKey(d) : 'unknown',
        isWkend:    isWkend,
        yc:         item.yc_outcome || '',
      };
    });

    document.getElementById('arc-loading').style.display='none';
    var content = document.getElementById('arc-content');
    if(content){ content.classList.add('vis'); }
    // The static list stays as the no-JS / failed-fetch fallback; the
    // searchable cards below carry the same links once they have loaded.
    var staticList = document.getElementById('arc-static');
    if(staticList && allEntries.length){ staticList.classList.add('arc-hidden'); }

    buildMonthFilters();
    render();
  })
  .catch(function(){
    var loadEl = document.getElementById('arc-loading');
    if(loadEl && document.querySelector('#arc-static a')){ loadEl.style.display='none'; return; }
    if(loadEl) loadEl.innerHTML = '<div class="arc-empty"><strong>The list of briefings didn\u2019t load.</strong>Refresh in a minute, or <a href="/daily" style="color:var(--gold)">read today\'s briefing \u2192</a></div>';
  });
}
window.AgPastBriefings={load:load};

})();
(function(){
  var st;
  document.addEventListener('input',function(e){if(e.target&&e.target.id==='arc-search'){clearTimeout(st);var v=(e.target.value||'').trim();st=setTimeout(function(){if(window.gaEvent&&v)gaEvent('archive_search',{q:v.slice(0,40)});},800);}},true);
  document.addEventListener('click',function(e){var c=e.target.closest&&e.target.closest('.arc-card');if(c&&window.gaEvent){var dt=c.querySelector('.arc-card-date');gaEvent('briefing_open',{date:dt?dt.textContent:''});}},true);
})();
