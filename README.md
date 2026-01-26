# AGSIST

Free live agricultural dashboard for farmers. Corn, soybean, wheat prices + news + weather.

**Live site:** https://agsist.com

## Features

- 📊 **Real-time commodity prices** - Corn, soybeans, wheat, cattle, hogs, milk, oil, gold, crypto
- 📰 **Ag news** - Aggregated from 7+ RSS feeds (DTN, AgWeb, Farm Progress, Brownfield, USDA)
- 🌤️ **Weather** - Windy radar centered on NW Wisconsin
- 🧮 **Farm calculators** - Grain bin capacity, GDU, fertilizer cost, break-even
- 📅 **USDA calendar** - Report dates and crop insurance deadlines
- 📱 **Mobile-friendly** - PWA, works offline

## Data Updates

Prices update automatically via GitHub Actions:
- Every 30 minutes during market hours (Mon-Fri 8am-4pm CT)
- Every 2 hours on weekends
- Data from Yahoo Finance API

## Pages

| Page | Description |
|------|-------------|
| `/` | Dashboard - prices, news, weather |
| `/tools.html` | Calculators + cash bids |
| `/fastfacts.html` | Nutrient management quick reference |
| `/learn.html` | Farming guides (basis, marketing, insurance) |
| `/calendar.html` | USDA reports + insurance deadlines |
| `/resources.html` | Quick links to essential ag sites |

## Tech Stack

- Static HTML/CSS/JS (no framework)
- GitHub Pages hosting
- GitHub Actions for data fetching
- Python + yfinance for market data

## Local Development

```bash
# Fetch fresh market data
python fetch_markets.py

# Serve locally
python -m http.server 8000
```

## Built by

[Farmers First Agri Service](https://farmers1st.com) - Crop insurance & agronomy in Barron County, WI

[Loke Drone LC](https://lokedrone.com) - Agricultural drone services

---

Made in Wisconsin 🧀
