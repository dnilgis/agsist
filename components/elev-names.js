/* The one elevator name key (components/elev-names.js)
   ---------------------------------------------------------------------------
   Twin of scripts/elevator_names.py; test/elev-names.test.mjs runs the same
   cases through both and fails if they drift, and fails if a page script
   grows its own copy again.
     displayName  the name a page prints
     cleanPlace   a town or delivery point as printed
     basisName    the basis history key (data/basis, data/basis-sparklines)
     facKey       one elevator across spellings ("CDR FARMS, LLC" = "CDR Farms LLC")
     mergeKey     one board across the two feeds ("Services Inc." = "Service, Inc.")
     nameKey      one business for counting companies
     tradeKey     one operator inside a town (trade words and the town out)
     niceCase     a name or town sent in capitals, as people write it
   Every key starts from displayName, so a source system's archived copy
   ("zFarmers Cooperative Elevator Co.OLD") keys as the elevator it is.
   Exact fixes are in data/elevator-names.json (setNames); until they load the
   general rules still apply. */
(function (root) {
  var NAMES = { operators: {}, places: {} };
  var OP_HEAD = /^\s*(?:cash\s+bid\s+)?(?:jsi\s+site|iframe|current\s+grain\s+bids)\s*-\s*/i;
  var OP_TAIL = /\s*-\s*cash\s+bid\s+include\s*$/i;
  var ST_TAIL = new RegExp('(?:\\s*[,.]\\s*(?:' + ('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND ' +
    'OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY').split(' ').join('|') + '))+\\s*$', 'i');
  var LEGAL_TAIL = /[\s,._-]*\b(inc|incorporated|llc|l\.l\.c|ltd|lp|co|corp|company)\b\.?[\s,._-]*$/i;
  var LEGAL_SUFFIX = { llc: 1, lc: 1, inc: 1, incorporated: 1, co: 1, corp: 1, corporation: 1, ltd: 1, limited: 1, lp: 1, llp: 1, company: 1 };
  var FOLD = { bros: 'brother', brothers: 'brother', brother: 'brother', st: 'saint', mt: 'mount', ft: 'fort',
    farmers: 'farmer', assn: 'association', assoc: 'association', elev: 'elevator', elevators: 'elevator' };
  var FAC_TAIL = { LLC: 1, LC: 1, INC: 1, INCORPORATED: 1, CO: 1, CORP: 1, CORPORATION: 1, LTD: 1, LIMITED: 1, LP: 1, LLP: 1,
    COMPANY: 1, COOP: 1, COOPERATIVE: 1, ASSN: 1, ASSOCIATION: 1 };
  var OP_NOISE = /\b(inc|llc|l\s?l\s?c|co|company|corp|corporation|cooperative|coop|co-op|the|of|grain|elevator|elevators|farmers)\b/g;
  var TOWN_ALT = { saint: 'st', mount: 'mt', fort: 'ft', sainte: 'ste' };
  /* a firm's legal name and the short name its boards use (Wisner NE: "ADM" and "Archer-Daniels-Midland Company") */
  var PARENT_ALIASES = [[/\barcher[\s-]*daniels[\s-]*midland\b/g, 'adm']];
  var CO_OPERATIVE = /\bco[\s.-]*operative\b/g;
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  function setNames(json) {
    NAMES = { operators: (json && json.operators) || {}, places: (json && json.places) || {} };
    return NAMES;
  }
  /* "zShawnee Feed Old", "zFarmers ... Co.OLD", "zOLDPettisville Grain Co.",
     "zSargeant Grain CompanyOLD", "zFosston Tri-Coop2017": the board itself. */
  function archiveClean(s) {
    return String(s || '').trim().replace(/^z(?:OLD)?(?=[A-Z])/, '').replace(/\s*\.?\s*\b(?:OLD|Old)$/, '')
      .replace(/([a-z])OLD$/, '$1').replace(/([A-Za-z])(?:19|20)\d\d$/, '$1').trim();
  }
  function displayName(op) {
    var s = String(op || '').trim();
    if (has(NAMES.operators, s)) return NAMES.operators[s];
    s = s.replace(OP_HEAD, '').replace(OP_TAIL, '').trim().replace(/,+$/, '').trim();
    return archiveClean(s);
  }
  function cleanPlace(p) {
    var s = String(p || '').trim();
    if (has(NAMES.places, s)) return NAMES.places[s];
    s = s.replace(/^[{\s]+|[}\s]+$/g, '').replace(/[,\s]+$/, '').trim();
    var out = s.replace(ST_TAIL, '').trim().replace(/,+$/, '').trim();
    return out || s;
  }
  function basisName(op) { return displayName(op).toUpperCase().split(/\s+/).filter(Boolean).join(' '); }
  function facKey(s) {
    var t = displayName(s).toUpperCase().replace(/&/g, ' AND ').replace(/\bCO[\s.-]*OPERATIVE\b/g, 'COOPERATIVE').replace(/\bCO[\s.-]*OP\b/g, 'COOP')
      .replace(/[^A-Z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
    while (t.length > 1 && FAC_TAIL[t[t.length - 1]]) t.pop();
    return t.join('');
  }
  function mergeKey(name) {
    var t = displayName(name).toLowerCase().replace(/[^a-z0-9]+/g, ' ')
      .replace(/co op/g, 'coop').replace(/co operative/g, 'cooperative').split(' ').filter(Boolean);
    while (t.length && LEGAL_SUFFIX[t[t.length - 1]]) t.pop();
    return t.map(function (x) { return (x === 'cooperative' || x === 'coops') ? 'coop' : x; })
      .map(function (x) { return FOLD[x] || x; })
      .map(function (x) { return (x.length > 3 && x.charAt(x.length - 1) === 's') ? x.slice(0, -1) : x; }).join('');
  }
  function nameKey(op) {
    var s = displayName(op);
    for (var i = 0; i < 2; i++) { var t = s.replace(LEGAL_TAIL, '').trim(); s = t || s; }
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  }
  function tradeKey(name, town) {
    var s = displayName(name).toLowerCase().replace(CO_OPERATIVE, 'cooperative');
    PARENT_ALIASES.forEach(function (a) { s = s.replace(a[0], a[1]); });
    s = s.replace(/\bco\s?-?\s?op\b/g, 'coop').replace(OP_NOISE, ' ');
    (String(town || '').toLowerCase().match(/[a-z0-9]+/g) || []).forEach(function (w) {
      [w, TOWN_ALT[w] || w].forEach(function (v) { s = s.replace(new RegExp('\\b' + v + '\\b', 'g'), ' '); });
    });
    return s.replace(/[^a-z0-9]/g, '');
  }
  /* Registry names come in capitals ("PINE BLUFFS"): shown as people write them. */
  function niceCase(s) {
    s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    if (!s || !(s === s.toUpperCase() || s === s.toLowerCase()) || !/[a-z]/i.test(s)) return s;
    return s.toLowerCase().replace(/(^|[\s\-'(/.])([a-z])/g, function (m, a, b) { return a + b.toUpperCase(); })
      .replace(/\b(Llc|Inc|Co-op|Coop)\b/g, function (w) { return { Llc: 'LLC', Inc: 'Inc', 'Co-op': 'Co-op', Coop: 'Coop' }[w]; });
  }

  /* A board's chart label: the company, then the delivery site it posts for, every word spelled out (Nov 12, 2026, E53).
     boardLabel(company, places, town, st) -> "Mid-Iowa Cooperative, Cargill Iowa Falls". places is the board's list
     of place names as the network writes them (the town itself is one of them). Display only, so no Python twin.
     The rules never invent a name:
       - the town in the list is the page's town, not a site; the others are the delivery sites
       - the page's own state code ("Ia") is spelled out when the town's name follows or it ends the site
       - initials of the town ("IF", "Cr") are the town's name; ADM and CHS are capitals
       - a coded site with no words in it ("Ds-crg-cr") is shown as printed and called a delivery code
       - a company's legal tail ("Inc") is dropped; nothing else is cut, shortened or abbreviated */
  var STATES = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
    FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky',
    LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
    MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina',
    ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
    SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia',
    WI: 'Wisconsin', WY: 'Wyoming' };
  var CAPS = { ADM: 1, CHS: 1, POET: 1 };
  function placeKey(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function siteOf(site, town, st) {
    var t = String(site || '').replace(/\s+-\s+/g, ' ').replace(/\s+/g, ' ').trim();
    if (/^[a-z]{1,4}(?:-[a-z]{1,4})+$/i.test(t)) return 'delivery code ' + t;
    t = niceCase(t).replace(/\s*\(([^)]*)\)/g, function (m, w) { return ' ' + (/^beans$/i.test(w.trim()) ? 'soybeans' : w.trim().toLowerCase()); }).trim();
    var ini = String(town || '').split(/\s+/).filter(Boolean).map(function (w) { return w.charAt(0).toUpperCase(); }).join('');
    var words = t.split(' ');
    words = words.map(function (w, i) {
      var u = w.toUpperCase();
      if (CAPS[u]) return u;
      if (ini.length > 1 && u === ini) return town;
      if (st && STATES[st] && u === st && /^[A-Z][A-Za-z]?$/.test(w) && w !== w.toLowerCase()) {
        var rest = placeKey(words.slice(i + 1).join(' ')), whole = placeKey(STATES[st] + ' ' + words.slice(i + 1).join(' '));
        if (i === words.length - 1 || (placeKey(town) && whole.indexOf(placeKey(town)) >= 0 && rest)) return STATES[st];
      }
      return w;
    });
    return words.join(' ');
  }
  function boardLabel(company, places, town, st) {
    var c = displayName(company).replace(/[\s,]+(?:inc|llc|ltd|corp)\.?$/i, '').trim(), tk = placeKey(town);
    c = niceCase(c).replace(/\bAdm\b/g, 'ADM').replace(/\bPoet\b/g, 'POET');
    var sites = (places || []).filter(function (p) { return placeKey(p) !== tk; });
    c = c.replace(/\bCoop(?:erative)?\b/g, 'Co-op');
    var out = sites.map(function (x) { return siteOf(x, town, String(st || '').toUpperCase()).replace(/\bCoop(?:erative)?\b/g, 'Co-op'); }).join(' and ');
    return out ? c + ', ' + out : (town ? c + ', ' + town : c);   // always the company, then the place it posts for
  }
  var api = { setNames: setNames, archiveClean: archiveClean, displayName: displayName, cleanPlace: cleanPlace,
    basisName: basisName, facKey: facKey, mergeKey: mergeKey, nameKey: nameKey, tradeKey: tradeKey, niceCase: niceCase, boardLabel: boardLabel, states: STATES };
  root.elevNames = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : this);
