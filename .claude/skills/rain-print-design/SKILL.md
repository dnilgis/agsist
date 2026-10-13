---
name: rain-print-design
description: Use when changing how a Rain Print looks or showing Sig a design. Covers the render harness, the scoring loop and Sig's standing design rules.
---
# Rain Print design loop

- The production engine is components/rain-print.js; rain-print.html is the page. Styles: R1 "Staircase" (default) and R2 "Roots", both for sale. Score history and rules live in the scratchpad (design/scores.md, STANDING-DECISIONS.md).
- Prototype harness: an ES module exporting `fonts` and `render(data)` (SVG, viewBox 0 0 1800 1200). Render with `node design/harness/render.mjs <module> <out> [data.json]`, which writes the flat print PNG and a framed-on-wall PNG. Use data/r-year.json (it has a dedication). Make dry (p x0.25) and wet (p x2.2) copies and render those too.
- LOOK at every PNG before sending. Send Sig one design at a time with a short caption, and ask for a 1-5 score and a note. Log each score in scores.md.
- Sig's rules:
  - snow days are drawn above the line only, never also as rain below
  - R1 verdict and year totals go upper left so the chart runs full width
  - optional 30-year monthly normals, with missing days excluded on both sides
  - optional dedication
  - serial "No. 0001 · SRL" under a muted QR (#A4A89F) on physical prints only, one count forever
  - QR uses the short link (/r?ID)
  - optional remarkable days (components/rain-print-records.js)
  - no store names; plain farm words; no em dashes
  - missing days are gaps, not dry; sample data is labeled
  - production limits: lines >= 0.7 units, text >= 11 units, 0.6 in safe margin
- Rain Print stays out of menus and footer until Sig says the design is final (promote:false).
