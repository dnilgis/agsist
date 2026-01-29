# AGSIST Complete Update Package

This package contains everything you need to update your AGSIST site with improved readability, navigation, SEO, and mobile support.

---

## PACKAGE CONTENTS

| File | Purpose | Deploy Location |
|------|---------|-----------------|
| `index.html` | **Complete updated homepage** with all improvements | Replace existing `index.html` |
| `styles.css` | **Updated external stylesheet** with refined colors | Replace existing `styles.css` |
| `soybean-prices.html` | **NEW** Coming soon page for soybeans | Site root |
| `wheat-prices.html` | **NEW** Coming soon page for wheat | Site root |
| `404.html` | Custom error page | Site root |
| `robots.txt` | Search engine instructions | Site root |
| `sitemap.xml` | Page list for Google/Bing | Site root |
| `structured-data.html` | JSON-LD schemas (copy to each page) | Reference file |

---

## HOW IT ALL WORKS TOGETHER

**Homepage (index.html):** Uses embedded `<style>` block with refined colors
**All other pages:** Use `styles.css` which now has the SAME refined colors

This means:
- ✅ Homepage matches corn-prices.html, tools.html, etc.
- ✅ Soybean & wheat coming soon pages match corn page style
- ✅ All pages have consistent softer contrast and improved readability

---

## WHAT'S IMPROVED IN INDEX.HTML

### Readability (Less Eye Strain)
- **Background:** `#0d0d0f` (slightly lighter than pure black)
- **Cards:** `#141418` (warmer dark)
- **Borders:** `#2a2a32` (more visible, subtle purple tint)
- **Text:** `#e8e8ec` (softer white, less harsh)
- **Dim text:** `#a0a0a8` (more readable)
- **Line height:** `1.6` (increased from 1.5)

### Font Sizes (All Increased)
- Secondary labels: `0.9rem` (was 0.85rem)
- Meta text: `0.75rem` (was 0.7rem)
- Tiny text: `0.7rem` (was 0.65rem)
- News items: `0.95rem` (was 0.9rem)

### New Features
- **Clickable price cards:** Corn → corn-prices.html, Soybeans → soybean-prices.html, Wheat → wheat-prices.html
- **Mobile hamburger menu:** Shows at 767px and below
- **"Prices" dropdown:** In navigation with links to dedicated price pages
- **Enhanced footer:** 5 columns with internal links for SEO
- **Touch-friendly:** 44px minimum touch targets on mobile
- **iOS zoom prevention:** Form inputs use 16px font

---

## DEPLOYMENT STEPS

### Step 1: Backup
Before deploying, backup your current `index.html`:
```bash
cp index.html index-backup.html
```

### Step 2: Upload Files to Site Root
- `index.html` (replace existing)
- `styles.css` (replace existing - THIS IS IMPORTANT for corn page to match)
- `soybean-prices.html` (new page)
- `wheat-prices.html` (new page)
- `404.html`
- `robots.txt`
- `sitemap.xml`

### Step 3: Test
1. Load your site - verify new colors/fonts look good
2. Click corn price → should go to corn-prices.html
3. Resize browser to mobile → hamburger menu should appear
4. Visit a fake URL → should show 404 page
5. Check https://agsist.com/robots.txt loads
6. Check https://agsist.com/sitemap.xml loads

### Step 4: Submit Sitemap
1. Go to Google Search Console
2. Sitemaps → Add new sitemap
3. Enter: `sitemap.xml`
4. Submit

---

## STRUCTURED DATA

The `structured-data.html` file contains JSON-LD schemas for each page type.

**For each page**, copy the relevant `<script type="application/ld+json">` block into the `<head>`:

- **corn-prices.html:** WebPage + Product schema
- **soybean-prices.html:** WebPage + Product schema
- **wheat-prices.html:** WebPage + Product schema
- **tools.html:** CollectionPage + ItemList schema
- **gdu-calculator.html:** SoftwareApplication schema
- **breakeven-calculator.html:** SoftwareApplication schema
- **grain-bin-calculator.html:** SoftwareApplication schema
- **calendar.html:** WebPage schema
- **fastfacts.html:** WebPage schema
- **learn.html:** WebPage schema
- **resources.html:** WebPage schema

Your homepage already has Organization + WebSite schemas - keep those!

---

## PAGES THAT NEED TO EXIST

The new navigation links to these pages:
- `corn-prices.html` ✓ (you have this)
- `soybean-prices.html` (create or remove from nav/footer)
- `wheat-prices.html` (create or remove from nav/footer)
- `privacy.html` (create or remove from footer)
- `terms.html` (create or remove from footer)

If you don't have these pages yet, either create them or edit index.html to remove the links.

---

## CSS VARIABLE REFERENCE

```css
:root {
    --bg: #0d0d0f;          /* Page background */
    --card: #141418;        /* Card/panel background */
    --border: #2a2a32;      /* Border color */
    --text: #e8e8ec;        /* Primary text */
    --dim: #a0a0a8;         /* Secondary/muted text */
    --accent: #e6b042;      /* Gold accent color */
    --green: #4ade80;       /* Positive/up color */
    --red: #f87171;         /* Negative/down color */
}
```

---

## TROUBLESHOOTING

**Mobile menu not showing?**
- Check browser width is 767px or less
- Verify the `.menu-toggle` CSS and JS are present

**Dropdown not working?**
- Check the JavaScript at the bottom of the file is intact
- Check browser console for errors

**Colors look different?**
- Clear browser cache (Ctrl+Shift+R)
- Check if any other CSS files are overriding (your styles.css shouldn't affect index.html since it uses embedded styles)

**404 page not showing?**
- For GitHub Pages: 404.html in root works automatically
- For other hosts: Configure server (see 404.html for instructions)

---

## SUPPORT

Questions? Just ask in the next message.

Built with care for AGSIST 🌽
