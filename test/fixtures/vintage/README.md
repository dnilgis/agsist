Saved samples for scripts/vintage.py --selftest (no network).

- socrata-barge.json: 18 rows of USDA AgTransport downbound grain barge rates (deqi-uken), Sep 29 to Oct 13, 2026,
  as saved by the history backfill. The :id, :created_at and :updated_at system fields are made up for the test.
- usgs-dv.json: the shape of a USGS WaterServices daily-values answer (two gauges, stage and flow, one no-data day).
  The numbers are made up for the test.
- eia-table.xls: the first bytes of an Excel 97 file (the OLE header EIA's table downloads start with) and a title. Not a real
  workbook; the archive saves the bytes as sent and never opens them.
- The Socrata metadata sample is test/fixtures/history/agtransport/views-deqi-uken.json.
