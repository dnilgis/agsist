# AGSIST: notes for anyone building here

agsist.com is a static GitHub Pages site. GitHub Pages will not deploy a site
over 1 GB. Past that the site does not break, it freezes: every data commit
stops reaching readers and nothing on the page says so.

## Build pages the efficient way

Before generating a set of pages (one per county, town, state, crop), decide
what has to be in each file and what can come from data:

- **In every page:** what a reader or a search engine needs at first glance.
  Title, the answer, the key numbers, FAQ, structured data.
- **Loaded from data on demand:** anything bulky or rarely opened. Detail
  tables, scenario grids, "show the math", full calculators. Put it in one
  data file per state (or per set) and render it when the reader opens it.
- **One shared page, not one file per item:** anything that is the same
  layout filled with different data and does not need to rank in search
  (print sheets, embeds, share views). Use one page with a query parameter.

Multiply before shipping: page size x number of pages. A 100 KB template
across 2,800 counties is 280 MB.

`scripts/check_site_budget.py` enforces this (published total, per-folder
budgets, and a 150 KB cap on any page in a generated set). Run it before shipping
any generated page set; the site-budget workflow runs it on every push. Raising a budget is a decision: change the number in that file in the
same commit and say why.
