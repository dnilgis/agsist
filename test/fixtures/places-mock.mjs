/* Stand-in answers for our own place lookup (components/places.js over data/places/, 2026-10-29), for
 * the browser tests that set up a town lookup that answers late, fails, finds another town or names no
 * county. It replaced the Open-Meteo geocoder those tests used to answer for, so a test written for
 * that geocoder's answer ({results: [...]}) hands the same rows here and gets the file the page reads.
 *
 *   PLACES_ROUTE   a route pattern: every outside host plus our own data/places/ files
 *   isPlaces(u)    a URL (string or URL) is one of the place files
 *   placesKey(u)   "us/ch", "zip/54", "ca/qu": which file
 *   placesBody(u, results)  the file's body holding those rows (geocoder shape in) */
const ST = { alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE",
  florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY",
  louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO",
  montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA",
  "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "puerto rico": "PR", "district of columbia": "DC", alberta: "AB", "british columbia": "BC", manitoba: "MB", "new brunswick": "NB",
  "newfoundland and labrador": "NL", "nova scotia": "NS", ontario: "ON", "prince edward island": "PE", quebec: "QC", saskatchewan: "SK",
  yukon: "YT", "northwest territories": "NT", nunavut: "NU" };
export const PLACES_ROUTE = /^https?:\/\/(?!127\.0\.0\.1)|\/data\/places\/(zip|us|ca)\/[^/?]+\.json/;
const RE = /\/data\/places\/((zip|us|ca)\/([^/?]+))\.json/;
export function isPlaces(u) { return RE.test(String(u && u.href ? u.href : u)); }
export function placesKey(u) { const m = RE.exec(String(u && u.href ? u.href : u)); return m ? m[1] : ""; }
function code(admin1) { const a = String(admin1 || "").trim(); return /^[A-Z]{2}$/.test(a) ? a : ST[a.toLowerCase()] || a; }
export function placesBody(u, results) {
  const key = placesKey(u), list = (results || []).filter((r) => r && typeof r.latitude === "number");
  if (key.startsWith("zip/")) {
    const out = {};
    for (const r of list) for (const z of r.postcodes && r.postcodes.length ? r.postcodes : [/^\d{5}$/.test(r.name) ? r.name : ""]) {
      if (z) out[z] = [r.latitude, r.longitude, /^\d+$/.test(r.name) ? "" : r.name, code(r.admin1), r.admin2 || ""];
    }
    return out;
  }
  return { p: list.map((r) => [r.name, code(r.admin1), r.latitude, r.longitude, r.admin2 || "", r.population || 0, (r.postcodes || []).join(" "), "g"]) };
}
