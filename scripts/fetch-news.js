// AGSIST News Aggregator with AI Summaries
// Fetches RSS feeds and generates TL;DR summaries using Claude API

const fs = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════════

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MAX_SUMMARIES_PER_RUN = 30; // Limit API calls to control costs
const SUMMARY_MAX_AGE_HOURS = 48; // Re-summarize after 48 hours

// ═══════════════════════════════════════════════════════════════════════════
// FEED SOURCES
// ═══════════════════════════════════════════════════════════════════════════

const FEEDS = [
  // REDDIT - Community discussions
  { url: 'https://www.reddit.com/r/farming/.rss', source: 'r/farming', category: 'community', icon: '🚜' },
  { url: 'https://www.reddit.com/r/agriculture/.rss', source: 'r/agriculture', category: 'community', icon: '🌾' },
  { url: 'https://www.reddit.com/r/tractors/.rss', source: 'r/tractors', category: 'community', icon: '🚜' },
  { url: 'https://www.reddit.com/r/homestead/.rss', source: 'r/homestead', category: 'community', icon: '🏡' },
  { url: 'https://www.reddit.com/r/ranching/.rss', source: 'r/ranching', category: 'community', icon: '🐄' },
  { url: 'https://www.reddit.com/r/agronomy/.rss', source: 'r/agronomy', category: 'community', icon: '🔬' },
  { url: 'https://www.reddit.com/r/dairyfarming/.rss', source: 'r/dairyfarming', category: 'community', icon: '🥛' },
  { url: 'https://www.reddit.com/r/Cattle/.rss', source: 'r/Cattle', category: 'community', icon: '🐄' },
  
  // USDA / GOVERNMENT
  { url: 'https://www.usda.gov/rss/home.xml', source: 'USDA', category: 'government', icon: '🏛️' },
  { url: 'https://www.nass.usda.gov/rss/feeds/news_room.xml', source: 'USDA NASS', category: 'government', icon: '📊' },
  { url: 'https://www.ers.usda.gov/rss/feeds/ers-newsroom.xml', source: 'USDA ERS', category: 'government', icon: '📈' },
  { url: 'https://www.fsa.usda.gov/rss/news.xml', source: 'USDA FSA', category: 'government', icon: '🏛️' },
  { url: 'https://droughtmonitor.unl.edu/rss/rss.aspx', source: 'Drought Monitor', category: 'weather', icon: '🌡️' },
  { url: 'https://www.nrcs.usda.gov/rss/nrcs-news.xml', source: 'USDA NRCS', category: 'government', icon: '🌱' },
  { url: 'https://www.ams.usda.gov/rss-feeds/market-news', source: 'USDA AMS', category: 'markets', icon: '📊' },
  { url: 'https://www.rma.usda.gov/rss/news.xml', source: 'USDA RMA', category: 'government', icon: '🛡️' },
  
  // UNIVERSITIES / EXTENSION
  { url: 'https://extension.umn.edu/rss/crop-news', source: 'UMN Extension', category: 'university', icon: '🎓' },
  { url: 'https://crops.extension.iastate.edu/feed', source: 'Iowa State', category: 'university', icon: '🎓' },
  { url: 'https://agcrops.osu.edu/feed', source: 'Ohio State', category: 'university', icon: '🎓' },
  { url: 'https://ipcm.wisc.edu/feed/', source: 'UW Madison', category: 'university', icon: '🎓' },
  { url: 'https://farmdoc.illinois.edu/feed', source: 'farmdoc (UIUC)', category: 'university', icon: '🎓' },
  { url: 'https://extension.purdue.edu/extmedia/rss/ag-news.xml', source: 'Purdue Extension', category: 'university', icon: '🎓' },
  { url: 'https://www.agronomy.k-state.edu/rss/news.xml', source: 'Kansas State', category: 'university', icon: '🎓' },
  { url: 'https://cropwatch.unl.edu/feed', source: 'Nebraska Extension', category: 'university', icon: '🎓' },
  { url: 'https://www.ag.ndsu.edu/news/rss', source: 'NDSU Extension', category: 'university', icon: '🎓' },
  { url: 'https://www.canr.msu.edu/news/rss', source: 'Michigan State', category: 'university', icon: '🎓' },
  { url: 'https://extension.sdstate.edu/rss.xml', source: 'South Dakota State', category: 'university', icon: '🎓' },
  
  // AG NEWS / INDUSTRY
  { url: 'https://www.agweb.com/rss.xml', source: 'AgWeb', category: 'industry', icon: '📰' },
  { url: 'https://www.dtnpf.com/agriculture/web/ag/rss', source: 'DTN', category: 'industry', icon: '📰' },
  { url: 'https://www.agriculture.com/rss/news', source: 'Successful Farming', category: 'industry', icon: '📰' },
  { url: 'https://brownfieldagnews.com/feed/', source: 'Brownfield', category: 'industry', icon: '📻' },
  { url: 'https://www.feedstuffs.com/rss.xml', source: 'Feedstuffs', category: 'industry', icon: '🐷' },
  { url: 'https://www.hoards.com/rss.xml', source: "Hoard's Dairyman", category: 'industry', icon: '🥛' },
  { url: 'https://www.dairyherd.com/rss.xml', source: 'Dairy Herd', category: 'industry', icon: '🥛' },
  { url: 'https://www.farmjournal.com/rss.xml', source: 'Farm Journal', category: 'industry', icon: '📰' },
  { url: 'https://www.progressivefarmer.com/rss.xml', source: 'Progressive Farmer', category: 'industry', icon: '📰' },
  { url: 'https://www.no-tillfarmer.com/rss.xml', source: 'No-Till Farmer', category: 'industry', icon: '🌱' },
  { url: 'https://www.high-plains-journal.com/rss.xml', source: 'High Plains Journal', category: 'industry', icon: '🌾' },
  { url: 'https://www.cornandsoybeandigest.com/rss.xml', source: 'Corn & Soybean Digest', category: 'industry', icon: '🌽' },
  
  // MARKETS
  { url: 'https://www.farms.com/rss/markets/', source: 'Farms.com', category: 'markets', icon: '💹' },
  { url: 'https://www.barchart.com/solutions/rss/agriculture', source: 'Barchart Ag', category: 'markets', icon: '📈' },
  { url: 'https://www.cmegroup.com/rss/agricultural-news.xml', source: 'CME Group', category: 'markets', icon: '💹' },
  
  // WEATHER / CLIMATE
  { url: 'https://www.cpc.ncep.noaa.gov/rss/outlooks.xml', source: 'NOAA Climate', category: 'weather', icon: '🌦️' },
  { url: 'https://www.weather.gov/rss_page.php?site=mkx', source: 'NWS Milwaukee', category: 'weather', icon: '⛈️' },
];

// ═══════════════════════════════════════════════════════════════════════════
// RSS PARSER
// ═══════════════════════════════════════════════════════════════════════════

function parseRSS(xml, feed) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>|<entry>([\s\S]*?)<\/entry>/g;
  let match;
  let count = 0;
  
  while ((match = itemRegex.exec(xml)) !== null && count < 5) {
    const item = match[1] || match[2];
    
    // Title
    let title = (item.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) ||
                 item.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1] || '';
    title = cleanText(title);
    
    // Link
    let link = (item.match(/<link>([\s\S]*?)<\/link>/) ||
                item.match(/<link[^>]*href="([^"]+)"/) || [])[1] || '';
    link = link.trim();
    if (link.includes('reddit.com') && !link.startsWith('http')) {
      link = 'https://www.reddit.com' + link;
    }
    
    // Date
    let pubDate = (item.match(/<pubDate>([\s\S]*?)<\/pubDate>/) ||
                   item.match(/<published>([\s\S]*?)<\/published>/) ||
                   item.match(/<updated>([\s\S]*?)<\/updated>/) ||
                   item.match(/<dc:date>([\s\S]*?)<\/dc:date>/) || [])[1] || '';
    
    // Description (for fallback and Reddit content)
    let description = (item.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) ||
                       item.match(/<description>([\s\S]*?)<\/description>/) ||
                       item.match(/<summary[^>]*>([\s\S]*?)<\/summary>/) ||
                       item.match(/<content[^>]*>([\s\S]*?)<\/content>/) || [])[1] || '';
    description = cleanText(description).substring(0, 500);
    
    // Thumbnail
    let thumbnail = '';
    const thumbMatch = item.match(/<media:thumbnail[^>]*url="([^"]+)"/) ||
                       item.match(/<enclosure[^>]*url="([^"]+)"[^>]*type="image/) ||
                       item.match(/src="(https?:\/\/[^"]+\.(?:jpg|jpeg|png|gif|webp))"/i);
    if (thumbMatch) thumbnail = thumbMatch[1];
    
    if (!title || title.length < 5) continue;
    
    const id = link ? Buffer.from(link).toString('base64').substring(0, 20) : Date.now().toString();
    
    items.push({
      id,
      title: title.substring(0, 200),
      link,
      description,
      date: pubDate,
      timestamp: new Date(pubDate).getTime() || Date.now(),
      source: feed.source,
      category: feed.category,
      icon: feed.icon,
      thumbnail,
      summary: null, // Will be filled by AI
    });
    
    count++;
  }
  
  return items;
}

function cleanText(text) {
  return text.replace(/<[^>]*>/g, '')
             .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
             .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
             .replace(/\s+/g, ' ').trim();
}

// ═══════════════════════════════════════════════════════════════════════════
// ARTICLE CONTENT FETCHER
// ═══════════════════════════════════════════════════════════════════════════

async function fetchArticleContent(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AGSIST/1.0; +https://agsist.com)',
        'Accept': 'text/html,application/xhtml+xml',
      }
    });
    clearTimeout(timeout);
    
    if (!res.ok) return null;
    
    const html = await res.text();
    
    // Extract article content - try common patterns
    let content = '';
    
    // Try article tag
    const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
    if (articleMatch) content = articleMatch[1];
    
    // Try main content divs
    if (!content) {
      const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i) ||
                        html.match(/class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/i) ||
                        html.match(/class="[^"]*article[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      if (mainMatch) content = mainMatch[1];
    }
    
    // Try meta description as fallback
    if (!content || content.length < 100) {
      const metaMatch = html.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/i) ||
                        html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i);
      if (metaMatch) content = metaMatch[1];
    }
    
    // Clean and truncate
    content = cleanText(content);
    return content.substring(0, 3000); // Limit to ~750 tokens
    
  } catch (e) {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CLAUDE API SUMMARIZER
// ═══════════════════════════════════════════════════════════════════════════

async function generateSummary(title, content, source) {
  if (!ANTHROPIC_API_KEY) {
    return null;
  }
  
  if (!content || content.length < 50) {
    return null;
  }
  
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307', // Cheapest, fastest
        max_tokens: 100,
        messages: [{
          role: 'user',
          content: `Summarize this agricultural news in exactly 2 sentences for a farmer. Be specific and practical. No fluff.

Title: ${title}
Source: ${source}
Content: ${content.substring(0, 2000)}

TL;DR:`
        }]
      })
    });
    
    if (!res.ok) {
      console.log(`  ⚠ Claude API error: ${res.status}`);
      return null;
    }
    
    const data = await res.json();
    const summary = data.content?.[0]?.text?.trim();
    
    return summary || null;
    
  } catch (e) {
    console.log(`  ⚠ Summary error: ${e.message}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FETCH SINGLE FEED
// ═══════════════════════════════════════════════════════════════════════════

async function fetchFeed(feed) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    
    const res = await fetch(feed.url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'AGSIST/1.0 (Agricultural News Aggregator)',
        'Accept': 'application/rss+xml, application/xml, text/xml, application/atom+xml, */*',
      }
    });
    clearTimeout(timeout);
    
    if (res.ok) {
      const xml = await res.text();
      if (xml.includes('<item>') || xml.includes('<entry>')) {
        const items = parseRSS(xml, feed);
        if (items.length > 0) {
          console.log(`✓ ${feed.source} (${items.length} items)`);
          return items;
        }
      }
    }
    
    console.log(`✗ ${feed.source} - HTTP ${res.status}`);
  } catch (e) {
    console.log(`✗ ${feed.source} - ${e.message}`);
  }
  
  return [];
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('AGSIST News Aggregator + AI Summaries');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  if (!ANTHROPIC_API_KEY) {
    console.log('⚠ No ANTHROPIC_API_KEY - summaries will use RSS descriptions\n');
  }
  
  // Load existing data (for caching summaries)
  const outputPath = path.join(process.cwd(), 'data', 'news.json');
  let existingData = { items: [] };
  const existingSummaries = new Map(); // link -> { summary, timestamp }
  
  try {
    if (fs.existsSync(outputPath)) {
      existingData = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
      console.log(`Loaded ${existingData.items?.length || 0} existing items\n`);
      
      // Build summary cache
      const maxAge = SUMMARY_MAX_AGE_HOURS * 60 * 60 * 1000;
      for (const item of existingData.items || []) {
        if (item.summary && item.link) {
          const age = Date.now() - (item.summaryTimestamp || 0);
          if (age < maxAge) {
            existingSummaries.set(item.link, {
              summary: item.summary,
              timestamp: item.summaryTimestamp
            });
          }
        }
      }
      console.log(`Cached ${existingSummaries.size} existing summaries\n`);
    }
  } catch (e) {
    console.log('No existing data found\n');
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // PHASE 1: Fetch all RSS feeds
  // ─────────────────────────────────────────────────────────────────────────
  console.log('PHASE 1: Fetching RSS feeds...\n');
  
  const allItems = [];
  const stats = { community: 0, government: 0, university: 0, industry: 0, markets: 0, weather: 0 };
  
  for (const feed of FEEDS) {
    const items = await fetchFeed(feed);
    if (items.length > 0) {
      allItems.push(...items);
      stats[feed.category] = (stats[feed.category] || 0) + items.length;
    }
    await sleep(300);
  }
  
  // Sort by date and dedupe
  allItems.sort((a, b) => b.timestamp - a.timestamp);
  const seen = new Set();
  const uniqueItems = allItems.filter(item => {
    if (seen.has(item.link)) return false;
    seen.add(item.link);
    return true;
  });
  
  console.log(`\n✓ Fetched ${uniqueItems.length} unique articles\n`);
  
  // ─────────────────────────────────────────────────────────────────────────
  // PHASE 2: Generate AI summaries
  // ─────────────────────────────────────────────────────────────────────────
  console.log('PHASE 2: Generating summaries...\n');
  
  let summaryCount = 0;
  let cachedCount = 0;
  let skippedCount = 0;
  
  for (const item of uniqueItems.slice(0, 100)) { // Process top 100 articles
    
    // Check cache first
    const cached = existingSummaries.get(item.link);
    if (cached) {
      item.summary = cached.summary;
      item.summaryTimestamp = cached.timestamp;
      cachedCount++;
      continue;
    }
    
    // Limit API calls per run
    if (summaryCount >= MAX_SUMMARIES_PER_RUN) {
      // Still provide a basic summary from description
      if (item.description && item.description.length > 50) {
        item.summary = item.description.substring(0, 200) + (item.description.length > 200 ? '...' : '');
      } else {
        item.summary = `${item.source}: ${item.title}`;
      }
      item.summaryTimestamp = Date.now();
      skippedCount++;
      continue;
    }
    
    console.log(`  Summarizing: ${item.title.substring(0, 50)}...`);
    
    // For Reddit: use description as content (it's the selftext)
    let content = item.description;
    
    // For non-Reddit: try to fetch full article
    if (item.category !== 'community' && item.link && ANTHROPIC_API_KEY) {
      const fetched = await fetchArticleContent(item.link);
      if (fetched && fetched.length > content.length) {
        content = fetched;
      }
      await sleep(500); // Be nice to servers
    }
    
    // Generate AI summary if we have API key
    if (ANTHROPIC_API_KEY && content && content.length >= 50) {
      const summary = await generateSummary(item.title, content, item.source);
      if (summary) {
        item.summary = summary;
        item.summaryTimestamp = Date.now();
        summaryCount++;
        console.log(`    ✓ AI summary generated`);
        await sleep(200); // Rate limit API calls
        continue;
      }
    }
    
    // Fallback: use truncated description
    if (content && content.length > 50) {
      item.summary = content.substring(0, 200) + (content.length > 200 ? '...' : '');
    } else {
      item.summary = `${item.source} reports: "${item.title}"`;
    }
    item.summaryTimestamp = Date.now();
    console.log(`    → Using description as summary`);
  }
  
  console.log(`\n✓ Generated ${summaryCount} AI summaries`);
  console.log(`✓ Used ${cachedCount} cached summaries`);
  console.log(`✓ Used ${skippedCount} description fallbacks\n`);
  
  // ─────────────────────────────────────────────────────────────────────────
  // PHASE 3: Save output
  // ─────────────────────────────────────────────────────────────────────────
  
  const output = {
    items: uniqueItems.slice(0, 100),
    stats,
    feedCount: FEEDS.length,
    successCount: Object.values(stats).reduce((a, b) => a + b, 0),
    summariesGenerated: summaryCount,
    updated: new Date().toISOString(),
  };
  
  // Ensure data directory exists
  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  
  // Write JSON
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`✅ Saved ${output.items.length} articles to data/news.json`);
  console.log(`   Community: ${stats.community || 0}`);
  console.log(`   Government: ${stats.government || 0}`);
  console.log(`   University: ${stats.university || 0}`);
  console.log(`   Industry: ${stats.industry || 0}`);
  console.log(`   Markets: ${stats.markets || 0}`);
  console.log(`   Weather: ${stats.weather || 0}`);
  console.log(`   AI Summaries: ${summaryCount} new, ${cachedCount} cached`);
  console.log('═══════════════════════════════════════════════════════════════');
}

main().catch(console.error);
