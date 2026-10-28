Fixtures for scripts/ams_http.py --selftest.
ams_2162-head.pdf  the first 1024 bytes of the real https://www.ams.usda.gov/mnreports/ams_2162.pdf
                   (Bloomfield Livestock Feeder Cattle, Bloomfield IA, Wed Oct 7 2026), as the
                   cattle-auction probe saved it on the raw branch Oct 20 2026. Only the PDF magic matters.
ams_2162-text.txt  the first 30 lines of that report's pdftotext output, as saved by the same probe.
not-ams-text.txt   a made-up non-AMS report text (stands in for a mirror serving some other PDF).
web-page.html      a made-up "Page Not Found" page, the shape usda.azureedge.us returned for
                   /mnreports/AMS_2162.pdf (404, a web page) on Oct 28 2026.
