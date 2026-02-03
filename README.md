# AGSIST News Hub

A comprehensive agriculture news aggregator pulling from 40+ sources including Reddit communities, USDA/government feeds, university extension services, and industry publications. Features AI-generated TL;DR summaries for quick reading.

## 🚀 Quick Start

### 1. Enable GitHub Actions Permissions
1. Go to your repo → **Settings** → **Actions** → **General**
2. Scroll to **"Workflow permissions"**
3. Select **"Read and write permissions"**
4. Click **Save**

### 2. Add Anthropic API Key (for AI Summaries)
1. Go to your repo → **Settings** → **Secrets and variables** → **Actions**
2. Click **"New repository secret"**
3. Name: `ANTHROPIC_API_KEY`
4. Value: Your API key from [console.anthropic.com](https://console.anthropic.com)
5. Click **Add secret**

> **Note:** AI summaries are optional. Without an API key, the system uses RSS descriptions as summaries.

### 3. Copy Files to Your Repo
```
your-repo/
├── .github/
│   └── workflows/
│       └── fetch-news.yml
├── scripts/
│   └── fetch-news.js
├── data/
│   └── news.json
└── news.html
```

### 4. Update news.html
Edit the config section:
```javascript
const GITHUB_USER = 'your-username';
const GITHUB_REPO = 'your-repo';
const GITHUB_BRANCH = 'main';
```

### 5. Run the Workflow
- Go to **Actions** tab
- Click **"Fetch Ag News"**
- Click **"Run workflow"**

## 📡 Sources (40+ feeds)

### Reddit Communities (8 feeds)
- r/farming, r/agriculture, r/tractors, r/homestead
- r/ranching, r/agronomy, r/dairyfarming, r/Cattle

### Government (7 feeds)
- USDA News, USDA NASS, USDA ERS, USDA FSA
- USDA NRCS, USDA RMA, USDA AMS

### University Extension (11 feeds)
- UMN, Iowa State, Ohio State, UW Madison, farmdoc/UIUC
- Purdue, Kansas State, Nebraska, NDSU, Michigan State, South Dakota State

### Industry & Dairy (12 feeds)
- AgWeb, DTN, Successful Farming, Brownfield, Feedstuffs
- Hoard's Dairyman, Dairy Herd, Farm Journal, Progressive Farmer
- No-Till Farmer, High Plains Journal, Corn & Soybean Digest

### Markets (4 feeds)
- Farms.com, Barchart Ag, CME Group, USDA AMS

### Weather (3 feeds)
- Drought Monitor, NOAA Climate, NWS Milwaukee

## ⚡ Features

- **40+ feeds** aggregated every 2 hours
- **AI-generated TL;DR** summaries (via Claude Haiku - ~$2-3/month)
- **Summary caching** - reuses summaries for 48 hours to save costs
- **Fallback to live Reddit** if GitHub JSON unavailable
- **Category filtering** - Community, Government, University, Industry, Markets, Weather
- **TL;DR popup** - quick article preview without leaving the page
- **Mobile-responsive** dark theme design

## 💰 Cost Estimate

Using Claude 3 Haiku (cheapest model):
- ~30 new summaries per run × 12 runs/day = 360 API calls/day max
- With caching, actual new summaries: ~20-50/day
- **Estimated cost: $2-5/month**

Without API key: Works fine, just uses RSS descriptions instead of AI summaries.

## 🔧 Customization

### Adjust Summary Rate Limit
Edit `scripts/fetch-news.js`:
```javascript
const MAX_SUMMARIES_PER_RUN = 30; // Reduce to lower costs
const SUMMARY_MAX_AGE_HOURS = 48; // Increase to cache longer
```

### Add More Reddit Subs
```javascript
{ url: 'https://www.reddit.com/r/YOUR_SUB/.rss', source: 'r/YOUR_SUB', category: 'community', icon: '🌾' },
```

### Add RSS Feeds
```javascript
{ url: 'https://example.com/feed.rss', source: 'Example', category: 'industry', icon: '📰' },
```

## 📊 How It Works

```
GitHub Action (every 2hr)
       ↓
fetch-news.js runs
       ↓
Phase 1: Fetch 40+ RSS feeds
       ↓
Phase 2: For each article:
         - Check summary cache (skip if <48hr old)
         - Fetch full article content
         - Call Claude API for 2-sentence summary
         - Fallback to description if API fails
       ↓
Phase 3: Save to data/news.json
       ↓
news.html loads JSON
       ↓
User clicks TL;DR → shows AI summary in popup
```

## 🛡️ Safety Features

- **Summary caching**: Reuses existing summaries to reduce API costs
- **Rate limiting**: Max 30 summaries per run
- **Graceful fallback**: Uses descriptions if API unavailable
- **Preservation guard**: If fetch fails, keeps old data
- **Deduplication**: Removes duplicate articles
- **Timeout handling**: 15s timeout per feed
