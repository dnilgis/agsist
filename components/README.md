# AGSIST Component System

A simple system for shared header and footer across all pages.

## Quick Start

To create a new page, copy `TEMPLATE.html` and edit it. The 3 required pieces are:

```html
<head>
    <!-- 1. Link shared CSS -->
    <link rel="stylesheet" href="/components/shared.css">
</head>
<body>
    <!-- 2. Header placeholder -->
    <div id="header"></div>
    
    <!-- Your content here -->
    
    <!-- 3. Footer placeholder -->
    <div id="footer"></div>
    
    <!-- 4. Load components script (before </body>) -->
    <script src="/components/load-components.js"></script>
</body>
```

That's it! The header and footer will load automatically.

---

## Files

| File | Purpose |
|------|---------|
| `header.html` | Navigation bar + mobile menu |
| `footer.html` | Site footer with links |
| `shared.css` | CSS variables + nav/footer styles |
| `load-components.js` | Loads header & footer into placeholders |
| `TEMPLATE.html` | Starter template for new pages |

---

## To Edit Navigation or Footer

1. Edit `header.html` or `footer.html`
2. Deploy to GitHub
3. All pages automatically use the updated version

---

## CSS Variables Available

These are defined in `shared.css` and can be used in any page:

```css
var(--bg)          /* #0a0a0c - page background */
var(--surface)     /* #111114 - card/section background */
var(--card)        /* #16161a - elevated surfaces */
var(--card-hover)  /* #1c1c22 - hover state */
var(--border)      /* #2a2a32 - borders */
var(--text)        /* #e8e8ec - primary text */
var(--dim)         /* #8a8a94 - secondary text */
var(--accent)      /* #e6b042 - gold accent */

/* Category colors */
var(--community)   /* #ff6b35 - orange */
var(--government)  /* #10b981 - green */
var(--university)  /* #3b82f6 - blue */
var(--industry)    /* #8b5cf6 - purple */
var(--markets)     /* #f59e0b - amber */
var(--weather)     /* #06b6d4 - cyan */
```

---

## Troubleshooting

**Header/footer not loading?**
1. Check browser console (F12) for errors
2. Verify files are deployed to `/components/` folder
3. Make sure paths start with `/` (absolute paths)

**Styles not applying?**
1. Make sure `shared.css` is linked before page-specific styles
2. Check that CSS variables are spelled correctly

---

## File Structure

```
your-site/
├── index.html
├── news.html
├── corn-prices.html
├── (other pages...)
└── components/
    ├── header.html
    ├── footer.html
    ├── shared.css
    ├── load-components.js
    ├── TEMPLATE.html
    └── README.md
```
