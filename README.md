# lrp-history

The full record of USDA RMA's daily Livestock Risk Protection offers and
actual ending values, for the backtest behind agsist.com/lrp. Written only by
the `lrp` workflow on main (scripts/fetch_lrp.py --history). GitHub Pages
deploys main, never this branch, so none of this counts toward the site size.

- `state.json`: every daily zip read, with its listed size, and the run checks
- `offers/<RY>/<YYYYMMDD>.json`: one sales day, one copy of every offer
- `aev/<RY>.json`: actual ending values released in that reinsurance year
- `probe/`: the first raw capture of RMA's sources (2026-10-15)

Source: https://pubfs-rma.fpac.usda.gov/pub/References/adm_livestock/
