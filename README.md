# references (data branch, never deployed)

Primary sources that back numbers and rules on agsist.com: RMA policies,
handbooks and bulletins, extension fact sheets, vendor data sheets.

GitHub Pages deploys `main` only. This branch shares no history with `main`
and is not published, so nothing here counts toward the 1 GB site limit.

## What is here

- `refs/<id>.pdf` or `refs/<id>.html`: the original file as the source served it
- `refs/<id>.txt`: readable text (PDFs through `pdftotext -layout`; pages with
  menus, headers, footers and scripts stripped). The first lines give the
  title, URL, fetch time and sha256 of the original.
- `index.json`: one row per source: id, url, title, why (what it backs on the
  site), status (new, updated, unchanged, failed), bytes, sha256,
  fetched_utc, checked_utc, pages, etag, last_modified, error.

## Where it comes from

- The list: `references/sources.json` on `main`. Add a source there.
- The fetcher: `scripts/fetch_refs.py` on `main`.
- The run: `.github/workflows/refs.yml`, monthly and on demand:

      gh workflow run refs.yml --ref main
      gh workflow run refs.yml --ref main -f ids=rma-pm-20-064,uw-a2809-2026

Each row also says where the copy came from: `via` is `direct` (the live URL),
`mirror`, `alt-host` (rma.usda.gov with or without www) or `wayback` (the
Internet Archive's closest snapshot, date in `archive_timestamp`). A copy that
did not come from the live URL is not proof the live page still says the same
thing; every run tries the live URL first again.

A failed source keeps its last good copy and is marked `failed` in
`index.json`. Do not edit `refs/` or `index.json` by hand; the workflow
rewrites them.

## Reading a source

    git fetch origin references
    git show origin/references:index.json
    git show origin/references:refs/<id>.txt
