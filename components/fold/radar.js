/* fold/radar.js: the storm replay hook of the radar tab on /rain (was inline on /rain-radar until Nov 11, 2026).
 * Loaded by components/page-tabs.js before components/radar-rain-page.js. */
/* Storm replay over your field: its code loads only when a reader opens it (components/storm-replay.js). */
(function(){var p=null;function ld(s){return new Promise(function(ok,no){var e=document.createElement('script');e.src=s;e.onload=ok;e.onerror=no;document.head.appendChild(e);});}
window.agsistStormReplay=function(o,note){if(!window.L){if(note)note.textContent='The map did not load, so the replay cannot open. Try again in a minute.';return;}
if(note)note.textContent='Opening the replay\u2026';
p=p||ld('/components/storm-replay-core.js?v=3').then(function(){return window.AgRadarRain?0:ld('/components/radar-rain.js?v=1');}).then(function(){return ld('/components/storm-replay.js?v=3');});
p.then(function(){if(note)note.textContent='';window.AgStormReplay.open(o||{});},function(){p=null;if(note)note.textContent='The replay did not load. Check your signal and try again.';});};
if(/[?&]sr=1(&|$)/.test(location.search)){var go=function(){window.agsistStormReplay({});};if(document.readyState==='complete')go();else window.addEventListener('load',go);}})();
