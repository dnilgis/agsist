/* Maker mode is gated (components/rain-print.js MAKER_HASH, 2026-10-17): a
 * browser opens the maker box only once it holds the flag a right key leaves.
 * Tests that open ?maker=1 put that flag in first, the way Sig's own browser
 * has it. The key itself is never in the repo. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const S = readFileSync(fileURLToPath(new URL("../../components/rain-print.js", import.meta.url)), "utf8");
export const MAKER_HASH = /var MAKER_HASH = '([0-9a-f]{64})'/.exec(S)[1];
export async function makerFlag(ctx) {
  await ctx.addInitScript((h) => { try { localStorage.setItem("rp-maker", h); } catch (e) {} }, MAKER_HASH);
}
