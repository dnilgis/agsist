/* The stable id of one hail report (events-YYYY.json record), computed, never stored.
 * Same function as event_id() in scripts/fetch_hail.py; test/hail-event-ids.test.mjs
 * asserts the two agree. A record is [lat, lon, size, "MM-DD", "ST"]; the year is
 * the file's. Usage: hailEventId.eventId(2026, rec).then(function (id) { ... }) */
(function (g) {
  "use strict";
  function key(year, e) {
    var mag = e[2] === null || e[2] === undefined ? "" : Number(e[2]).toFixed(2);
    return year + "-" + String(e[3]).replace("/", "-") + "|" + String(e[4] || "").toUpperCase() + "|" +
      Number(e[0]).toFixed(2) + "|" + Number(e[1]).toFixed(2) + "|" + mag;
  }
  function eventId(year, e) {
    var bytes = new TextEncoder().encode(key(year, e));
    return g.crypto.subtle.digest("SHA-1", bytes).then(function (buf) {
      var hex = "";
      new Uint8Array(buf).forEach(function (b) { hex += (b < 16 ? "0" : "") + b.toString(16); });
      return hex.slice(0, 12);
    });
  }
  var api = { key: key, eventId: eventId };
  g.hailEventId = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
