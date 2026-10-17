/* components/ys-calendar.js: /usda-calendar lines of the "Your area" box (components/your-state.js). */
(function (Y) {
  'use strict';
  var h = Y.h, DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function wday(iso) { return DOW[new Date(iso + 'T12:00:00Z').getUTCDay()] + ' ' + h.day(iso); }
  /* "4:00 PM ET" on a date -> the instant (Eastern daylight time from the 2nd Sunday of March
     to the 1st Sunday of November, as the page and scripts/build_usda_ics.mjs reckon it) */
  function etInstant(iso, time) {
    var m = /(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(time || ''), y = +iso.slice(0, 4);
    if (!m) return NaN;
    function sun(mo, n) { var d = new Date(Date.UTC(y, mo, 1)); return 1 + (7 - d.getUTCDay()) % 7 + (n - 1) * 7; }
    var t = Date.UTC(y, +iso.slice(5, 7) - 1, +iso.slice(8, 10));
    var off = t >= Date.UTC(y, 2, sun(2, 2)) && t < Date.UTC(y, 10, sun(10, 1)) ? 4 : 5;
    return t + (+m[1] % 12 + (/PM/i.test(m[3]) ? 12 : 0) + off) * 36e5 + m[2] * 6e4;
  }
  function yourTime(iso, time, tz) {
    var t = etInstant(iso, time), s;
    if (isNaN(t)) return '';
    try { s = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(t)); } catch (e) { return ''; }
    return time.indexOf(s + ' ') === 0 ? '' : ' (' + s + ' your time)';
  }
  function build(o, st, name, out, src) {
    var R = (o.reports || []).slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    var today = h.isoToday(o.now, o.tz), stats = h.stat(o.d['state-stats'], st), pr = o.d['crop-progress'];
    var sp = pr && pr.in_season && pr.states && pr.states[st], s;
    function next(type) {
      for (var i = 0; i < R.length; i++) { var r = R[i], t = etInstant(r.date, r.time); if (r.type === type && r.date >= today && !(t <= o.now)) return r; }
      return null;
    }
    function when(r) { return wday(r.date) + ', ' + h.esc(r.time) + yourTime(r.date, r.time, o.tz); }
    var cp = next('croprog');
    if (cp) {
      var g = [], dt = '';
      ['corn', 'soybeans'].forEach(function (c) {
        var r = sp && sp[c + '_harvested'];
        if (!r || typeof r.pct !== 'number' || h.age(r.date, o.now) > 21) return;
        dt = r.date;
        g.push(c + ' ' + r.pct + '% harvested' + (typeof r.avg5 === 'number' ? ' (5-yr avg ' + r.avg5 + '%)' : ''));
      });
      s = '<b>Crop Progress</b>, ' + when(cp) + ': ' + h.esc(name) + '’s harvest pace and crop ratings.';
      if (g.length) { s += ' Last week, ending ' + h.day(dt) + ': ' + g.join(', ') + '.'; src.push('USDA NASS crop progress, week ending ' + h.day(dt) + ' (5-yr avg is AGSIST arithmetic on NASS weeks)'); }
      out.push(s);
    }
    var pd = next('supply');
    if (pd) {
      var mo = +pd.date.slice(5, 7), cs = mo >= 8 && mo <= 11, sl = cs && stats && stats.forecast ? h.statLine(stats, name) : '';
      s = '<b>Crop Production</b>, ' + when(pd) + ': USDA’s ' + h.esc(name) + (cs ? ' corn and soybean yields.' : ' crop estimates.');
      if (sl) { s += ' Last time, ' + sl; src.push('USDA NASS state forecast, ' + h.nassDay(stats)); }
      out.push(s);
    }
    var fs = next('fsa');
    if (fs) out.push('<b>' + h.esc(fs.name) + '</b>, ' + wday(fs.date) + ', at your FSA county office. ' + h.countyLink(o.loc, name));
    out.push('Calendar files: <a href="/usda-calendar-grain.ics" download>grain reports only (.ics)</a> &middot; <a href="/usda-calendar-livestock.ics" download>livestock and dairy only (.ics)</a>');
  }
  Y.mode('calendar', { files: ['crop-progress', 'state-stats'], build: build });
  Y.etInstant = etInstant; Y.yourTime = yourTime;
})(typeof module === 'object' && module.exports ? require('./your-state.js') : window.AGSIST_YOUR_STATE);
