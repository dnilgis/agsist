# AGSIST Pre-Launch Audit & Punch List

**Audited:** Feb 3, 2026 — 28 pages, 35 files, 181KB zipped  
**Goal:** Harden for search engine submission (Google Search Console + Bing Webmaster Tools)

---

## SCORE CARD

| Category | Status | Notes |
|----------|--------|-------|
| Title tags | ✅ 28/28 unique | 5 slightly short (404, exports, privacy, soils, terms) |
| Meta descriptions | ✅ 28/28 unique | All 70-160 chars — sweet spot |
| Canonical URLs | ✅ 27/28 | 404.html missing (acceptable) |
| Open Graph | ✅ 27/28 | 404.html missing (acceptable) |
| Schema.org JSON-LD | ✅ 27/28 | 404.html missing (acceptable) |
| H1 tags | ✅ 27/28 | 1 issue: spray.html (JS-generated, invisible to crawlers) |
| Heading hierarchy | ✅ All single-H1 | Clean H1→H2→H3 everywhere |
| Sitemap.xml | ✅ 27 URLs + homepage | All pages accounted for |
| robots.txt | ✅ Clean | Sitemap reference present |
| Google Analytics | ✅ 28/28 | G-6KXCTD5Z9H on every page |
| Favicon | ✅ 28/28 | PNG + apple-touch-icon |
| Viewport meta | ✅ 28/28 | |
| charset UTF-8 | ✅ 28/28 | |
| lang="en" | ✅ 28/28 | |
| Internal links | ✅ 0 broken | Nav (21 links) + footer (20 links) all resolve |
| Font preconnect | ✅ 28/28 | Google Fonts preconnected |
| Font display=swap | ✅ 28/28 | No FOIT |
| Semantic HTML | ✅ All have `<main>` | Footer/nav loaded via JS component |
| Image alt attrs | ✅ All present | |
| Duplicate content | ✅ None | All titles + descriptions unique |

---

## 🔴 CRITICAL FIXES (Do Before Submission)

### 1. spray.html — H1 is invisible to crawlers
The `<h1>` tag contains a JS template literal `${statusText[overall]}` which renders at runtime. Google/Bing crawlers see raw template text, not actual content.

**Fix:** Add a static H1 and use JS to append the dynamic status.
```html
<!-- Replace the template literal H1 with: -->
<h1>🌿 Spray Weather Conditions</h1>
<div id="spray-status" class="status-banner"><!-- JS fills this --></div>
```

### 2. Add `rel="noopener noreferrer"` to all external links
**19 pages** have `target="_blank"` links missing `rel="noopener"`. This is a security issue (tabnapping) and Google flags it.

**Affected:** calendar, cashbids, corn-prices, crop-progress, drought, exports, farmdoc, fastfacts, index, learn, market-news, milk-prices, news, offices, quickstats, resources, soils, soybean-prices, wheat-prices

**Fix:** Bulk find/replace across all files:
```
target="_blank"  →  target="_blank" rel="noopener noreferrer"
```
*(Skip links that already have rel="noopener")*

### 3. Add `aria-label` to all `<select>` elements
**9 pages** have `<select>` dropdowns without accessible labels. Screen readers can't identify them.

**Affected:** breakeven (1), calculator (2), crop-progress (2), drought (1), fastfacts (4), gdu (1), market-news (1), offices (1), quickstats (7)

**Fix:** Add `aria-label="descriptive text"` to each `<select>`:
```html
<select aria-label="Select state">
<select aria-label="Select commodity">
<select aria-label="Select year">
```

---

## 🟡 HIGH PRIORITY (Do Before or Shortly After Submission)

### 4. Add Twitter Card meta to 26 pages
Only `index.html` and `news.html` have `twitter:card` meta. The other 26 pages are missing it. Twitter/X uses Open Graph as fallback, but explicit twitter:card gives better control.

**Fix:** Add to `<head>` of all pages (can batch via template):
```html
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="[same as og:title]">
<meta name="twitter:description" content="[same as og:description]">
```

### 5. Add theme-color meta to 24 pages
Only index, news, privacy, terms have `<meta name="theme-color">`. This controls browser chrome color on mobile.

**Fix:** Add to all pages:
```html
<meta name="theme-color" content="#0a0a0c">
```

### 6. Lengthen 5 short titles
Google truncates at ~60 chars but very short titles (<30 chars) waste ranking potential.

| Page | Current (len) | Suggested |
|------|--------------|-----------|
| 404.html | "Page Not Found \| AGSIST" (23) | OK for 404 — skip |
| exports.html | "Export Sales Tracker \| AGSIST" (29) | "US Grain Export Sales Tracker — Weekly USDA Data \| AGSIST" |
| privacy.html | "Privacy Policy \| AGSIST" (23) | "Privacy Policy — Free Ag Dashboard \| AGSIST" |
| soils.html | "Soil Survey Lookup \| AGSIST" (27) | "Soil Survey Lookup — NRCS Web Soil Survey Tool \| AGSIST" |
| terms.html | "Terms of Use \| AGSIST" (21) | "Terms of Use — AGSIST Agricultural Dashboard" |

### 7. Add hover tooltips (?) for abbreviations
User requested this specifically. Many ag abbreviations appear across the site without explanation. Add a CSS tooltip system and apply to key terms.

**Universal tooltip abbreviations (use across all pages where they appear):**

| Abbrev | Expansion |
|--------|-----------|
| GDU | Growing Degree Units — heat accumulation for crop staging |
| WASDE | World Ag Supply & Demand Estimates — monthly USDA report |
| FSA | Farm Service Agency — USDA office for farm programs |
| NASS | National Agricultural Statistics Service — USDA data arm |
| CRP | Conservation Reserve Program — land retirement payments |
| ARC | Agriculture Risk Coverage — county-based safety net |
| PLC | Price Loss Coverage — reference price safety net |
| DDGs | Dried Distillers Grains — ethanol byproduct feed |
| NDM | Nonfat Dry Milk — dairy commodity |
| SRW | Soft Red Winter wheat |
| HRW | Hard Red Winter wheat |
| HRS | Hard Red Spring wheat |
| CBOT | Chicago Board of Trade — grain futures exchange |
| CME | Chicago Mercantile Exchange — derivatives exchange |
| AMS | Agricultural Marketing Service — USDA market reports |
| NRCS | Natural Resources Conservation Service — soil/conservation |
| RMA | Risk Management Agency — crop insurance |
| DMC | Dairy Margin Coverage — dairy safety net program |
| FMMO | Federal Milk Marketing Order — dairy pricing system |
| SCO | Supplemental Coverage Option — crop insurance add-on |
| ECO | Enhanced Coverage Option — area-based crop insurance |
| BPA | Bushels Per Acre |
| APH | Actual Production History — crop insurance yield basis |
| bu | Bushels |
| cwt | Hundredweight (100 lbs) |
| MPP | Margin Protection Program (dairy) |

**Implementation approach:**
```css
/* Add to shared.css */
.tip {
  position: relative;
  border-bottom: 1px dotted var(--dim);
  cursor: help;
}
.tip::after {
  content: attr(data-tip);
  position: absolute;
  bottom: 125%;
  left: 50%;
  transform: translateX(-50%);
  background: var(--card);
  color: var(--text);
  border: 1px solid var(--border);
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 0.75rem;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s;
  z-index: 100;
}
.tip:hover::after, .tip:focus::after {
  opacity: 1;
}
```

```html
<!-- Usage -->
<span class="tip" data-tip="World Ag Supply & Demand Estimates">WASDE</span>
```

**Priority pages for tooltips:** crop-progress (crop stages V2, V6, VT, R1-R6), learn.html (all marketing terms), exports.html (HRW, SRW, HRS), milk-prices.html (DMC, FMMO, Class III/IV), offices.html (FSA, NRCS, RMA)

### 8. Add skip-nav link for accessibility
Zero pages have a "skip to content" link. This is an accessibility best practice and helps keyboard users.

**Fix:** Add to header.html component:
```html
<a href="#main-content" class="skip-nav">Skip to content</a>
```
```css
.skip-nav {
  position: absolute;
  top: -40px;
  left: 0;
  background: var(--accent);
  color: #000;
  padding: 8px 16px;
  z-index: 10000;
  transition: top 0.2s;
}
.skip-nav:focus { top: 0; }
```
And add `id="main-content"` to each page's `<main>` tag.

---

## 🟢 NICE TO HAVE (Post-Launch Polish)

### 9. Add apple-mobile-web-app meta to 26 pages
Only index.html and news.html have these. Low priority since they're more for "Add to Home Screen" PWA behavior.

### 10. Reduce inline CSS on index.html (~17KB) and news.html (~20KB)
These are the heaviest pages for inline styles. Could extract to page-specific CSS files for cacheability. Not blocking — inline CSS actually helps first-paint speed.

### 11. Consider IndexNow for Bing
Bing supports IndexNow protocol for instant indexing. Since this is a GitHub Pages site, you could add a simple IndexNow key file. Low priority — sitemap submission handles this.

### 12. 404.html improvements
Missing: canonical, og tags, schema, H1. For a 404 page these are non-critical, but adding an H1 ("Page Not Found") and basic meta would be cleaner.

### 13. Schema.org `Offer` type cleanup
Several pages use `"@type": "Offer"` inside their schema, which is meant for products/services. For free tools, consider `"@type": "SoftwareApplication"` with `"offers": {"@type": "Offer", "price": "0"}` — tells Google it's a free tool.

---

## SEARCH ENGINE SUBMISSION CHECKLIST

### Google Search Console
1. Go to [search.google.com/search-console](https://search.google.com/search-console)
2. Add property → URL prefix → `https://agsist.com`
3. Verify ownership (DNS TXT record, HTML file, or meta tag)
4. Submit sitemap: `https://agsist.com/sitemap.xml`
5. Request indexing of homepage
6. Monitor Coverage report for crawl errors

### Bing Webmaster Tools
1. Go to [bing.com/webmasters](https://www.bing.com/webmasters)
2. Sign in → Import from Google Search Console (easiest if GSC is done first)
3. Or add site manually + verify via DNS/meta tag
4. Submit sitemap: `https://agsist.com/sitemap.xml`
5. Bing submission also covers Yahoo and DuckDuckGo

### Post-Submission Monitoring
- Check Google Search Console "Coverage" tab after 3-7 days
- Check Bing "Index Explorer" for crawl status
- Run `site:agsist.com` on Google after 1-2 weeks to see indexed pages
- Monitor "Core Web Vitals" in GSC once enough data accumulates

---

## COMPETITIVE POSITIONING NOTES

AGSIST's unique advantages for search ranking:
- **28 free pages** covering prices, tools, data, news — breadth no free competitor matches
- **Pure static HTML** — fastest possible load times (GitHub Pages CDN)
- **Dark theme agricultural site** — visually distinctive in SERPs
- **Tool density** — 15+ interactive tools on one domain
- **Clean URL structure** — all flat `/page.html`, no nested routes
- **No paywalls** — everything free, which Google increasingly rewards for utility content

Key long-tail targets to monitor:
- "free farm dashboard"
- "corn prices today free"
- "grain bin calculator bushels"
- "Wisconsin cash grain bids"
- "spray weather conditions farming"
- "USDA report calendar 2026"
- "break even calculator farming"
- "growing degree units calculator"
