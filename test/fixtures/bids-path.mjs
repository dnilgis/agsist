// Where the tests find the bids data (dnilgis/bids, public): BIDS_PATH in CI (pr-checks.yml and
// main-checks.yml clone its data/ folder there), the local clone beside this one otherwise.
// Nov 4, 2026: without a clone, elev-desk-browser's Today tests waited out a timeout on the Paste
// button instead of saying why. A test that reads the bids data calls needBids() first: it fails at
// once, by name, when the data is not there. It is a failure, never a skip (a skip is not a pass,
// and AGSIST_NO_SKIPS=1 would only fail it later, with less said).
import { existsSync } from "node:fs";

export const BIDS = (process.env.BIDS_PATH || "/home/user/bids/").replace(/\/?$/, "/");
export const BIDS_MISSING = "BIDS_PATH has no data/merged: clone dnilgis/bids data or set BIDS_PATH (now " + BIDS + ")";
export function needBids() {
  if (!existsSync(BIDS + "data/merged")) throw new Error(BIDS_MISSING);
}
