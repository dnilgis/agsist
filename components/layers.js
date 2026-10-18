/* AGSIST layer registry reader (Oct 18, 2026).
   data/layers.json describes every data layer once (source, scope, how it is
   fetched, privacy). This file only reads that description; it fetches
   nothing. Works in node (require) and in the browser (window.AGLayers).

     var R = AGLayers.load(registryJSON);   // object or JSON text
     R.byId.rent, R.byGroup.water, R.forScope('field'), R.privacy('land_transfers')

   test/layers.test.mjs runs it; scripts/check_layers.py checks the registry. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AGLayers = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var KINDS = ['atlas-county', 'state-file', 'live', 'worker'];
  var PRIVACY = ['public', 'names-noindex', 'owner-live-only'];

  function load(reg) {
    if (typeof reg === 'string') reg = JSON.parse(reg);
    if (!reg || !Array.isArray(reg.layers)) throw new Error('layers: no layers list');
    var byId = {}, byGroup = {}, list = [];
    reg.layers.forEach(function (l) {
      if (!l || !l.id) throw new Error('layers: entry without id');
      if (byId[l.id]) throw new Error('layers: duplicate id ' + l.id);
      byId[l.id] = l; list.push(l);
      (byGroup[l.group] = byGroup[l.group] || []).push(l);
    });
    return {
      version: reg.version,
      groups: reg.groups || Object.keys(byGroup),
      list: list,
      byId: byId,
      byGroup: byGroup,
      forScope: function (scope) {
        return list.filter(function (l) { return (l.scope || []).indexOf(scope) >= 0; });
      },
      // Unknown ids read as the strictest class, so a typo never makes something public.
      privacy: function (id) { var l = byId[id]; return l && PRIVACY.indexOf(l.privacy) >= 0 ? l.privacy : 'names-noindex'; }
    };
  }
  return { load: load, KINDS: KINDS, PRIVACY: PRIVACY };
});
