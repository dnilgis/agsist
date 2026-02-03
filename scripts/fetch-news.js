// AGSIST News Aggregator with AI Summaries
// Fetches RSS feeds and generates TL;DR summaries using Claude API

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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
  // ═══════════════════════════════════════════════════════════════════════════
  // REDDIT - Use top/week to surface quality posts, trimmed to 4 best subs
  // ═══════════════════════════════════════════════════════════════════════════
  { url: 'https://www.reddit.com/r/farming/top/.rss?t=week', source: 'r/farming', category: 'community', icon: '🚜', isReddit: true },
  { url: 'https://www.reddit.com/r/agriculture/top/.rss?t=week', source: 'r/agriculture', category: 'community', icon: '🌾', isReddit: true },
  { url: 'https://www.reddit.com/r/ranching/top/.rss?t=week', source: 'r/ranching', category: 'community', icon: '🐄', isReddit: true },
  { url: 'https://www.reddit.com/r/agronomy/top/.rss?t=week', source: 'r/agronomy', category: 'community', icon: '🔬', isReddit: true },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // UNIVERSITIES - Verified working
  // ═══════════════════════════════════════════════════════════════════════════
  { url: 'https://ipcm.wisc.edu/feed/', source: 'UW Madison', category: 'university', icon: '🎓' },
  { url: 'https://farmdoc.illinois.edu/feed', source: 'farmdoc (UIUC)', category: 'university', icon: '🎓' },
  { url: 'http://feeds.feedburner.com/purdue/dnbY.rss', source: 'Purdue Ag', category: 'university', icon: '🎓' },
  { url: 'https://crops.extension.iastate.edu/rss/category/crop-production', source: 'Iowa State', category: 'university', icon: '🎓' },
  { url: 'https://blog-crop-news.extension.umn.edu/feeds/posts/default?alt=rss', source: 'UMN Crop News', category: 'university', icon: '🎓' },
  { url: 'https://agrilifetoday.tamu.edu/feed/', source: 'Texas A&M AgriLife', category: 'university', icon: '🎓' },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // AG NEWS / INDUSTRY - Verified working URLs from feedspot.com
  // ═══════════════════════════════════════════════════════════════════════════
  { url: 'https://brownfieldagnews.com/feed/', source: 'Brownfield', category: 'industry', icon: '📻' },
  { url: 'https://www.feedstuffs.com/rss.xml', source: 'Feedstuffs', category: 'industry', icon: '🐷' },
  { url: 'https://www.agweek.com/index.rss', source: 'Agweek', category: 'industry', icon: '📰' },
  { url: 'https://modernfarmer.com/feed/', source: 'Modern Farmer', category: 'industry', icon: '🌱' },
  { url: 'https://feeds.feedburner.com/CivilEats', source: 'Civil Eats', category: 'industry', icon: '🥗' },
  { url: 'https://agdaily.com/feed/', source: 'AgDaily', category: 'industry', icon: '📰' },
  { url: 'https://www.tsln.com/feed/', source: 'Tri-State Livestock', category: 'industry', icon: '🐄' },
  { url: 'https://www.lancasterfarming.com/feed/', source: 'Lancaster Farming', category: 'industry', icon: '🌾' },
  { url: 'https://allagnews.com/feed/', source: 'All Ag News', category: 'industry', icon: '📻' },
  { url: 'https://www.farmjournal.com/feed/', source: 'Farm Journal', category: 'industry', icon: '📰' },
  { url: 'https://www.croplife.com/feed/', source: 'CropLife', category: 'industry', icon: '🌱' },
  { url: 'https://www.agupdate.com/rss/', source: 'Ag Update', category: 'industry', icon: '📰' },
  { url: 'https://agritechtomorrow.com/rss/news', source: 'AgriTech Tomorrow', category: 'industry', icon: '🤖' },
  { url: 'https://www.morningagclips.com/feed/', source: 'Morning Ag Clips', category: 'industry', icon: '📰' },
  { url: 'https://www.farmanddairy.com/feed/', source: 'Farm and Dairy', category: 'industry', icon: '🌾' },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // MARKETS
  // ═══════════════════════════════════════════════════════════════════════════
  { url: 'https://www.farms.com/markets/rss.ashx', source: 'Farms.com Markets', category: 'markets', icon: '💹' },
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
    
    // Generate unique ID from full link hash (not truncated base64 which can collide)
    const id = link ? 
      crypto.createHash('md5').update(link).digest('hex').substring(0, 16) : 
      Date.now().toString() + Math.random().toString(36).substring(2, 8);
    
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
// REDDIT QUALITY FILTER
// ═══════════════════════════════════════════════════════════════════════════

// Title patterns that indicate spam, low-effort, or removed posts
const REDDIT_SPAM_PATTERNS = [
  /^\[removed\]$/i,
  /^\[deleted\]$/i,
  /^test$/i,
  /selling|buy my|discount code|coupon|promo/i,
  /check out my|subscribe to|follow me/i,
  /upvote if|upvote this/i,
  /crypto|bitcoin|nft|token sale/i,
  /onlyfans|OF link/i,
];

function isRedditSpam(title) {
  return REDDIT_SPAM_PATTERNS.some(p => p.test(title));
}

// Fetch Reddit post score to filter low-quality posts
async function getRedditScore(url) {
  try {
    const jsonUrl = url.replace(/\/$/, '') + '.json';
    const res = await fetch(jsonUrl, {
      headers: { 'User-Agent': 'AGSIST News Bot 1.0' }
    });
    if (!res.ok) return 0;
    const data = await res.json();
    const post = data?.[0]?.data?.children?.[0]?.data;
    return post ? (post.score || 0) : 0;
  } catch {
    return 0;
  }
}

// Filter Reddit items: require minimum score and no spam patterns
// Only keep top 2 posts per subreddit
async function filterRedditItems(items) {
  const MIN_SCORE = 3; // Minimum upvotes to include
  const MAX_PER_SUB = 2; // Max posts per subreddit
  
  const filtered = [];
  const perSub = {};
  
  for (const item of items) {
    // Skip obvious spam by title
    if (isRedditSpam(item.title)) {
      console.log(`    ✗ Spam filtered: "${item.title.substring(0, 50)}..."`);
      continue;
    }
    
    // Skip very short titles (likely low-effort)
    if (item.title.length < 15) {
      console.log(`    ✗ Too short: "${item.title}"`);
      continue;
    }
    
    // Check subreddit limit
    const sub = item.source;
    perSub[sub] = (perSub[sub] || 0);
    if (perSub[sub] >= MAX_PER_SUB) continue;
    
    // Check score via Reddit JSON API
    if (item.link) {
      const score = await getRedditScore(item.link);
      if (score < MIN_SCORE) {
        console.log(`    ✗ Low score (${score}): "${item.title.substring(0, 50)}..."`);
        await sleep(300);
        continue;
      }
      item.redditScore = score;
      await sleep(300); // Rate limit Reddit API
    }
    
    perSub[sub]++;
    filtered.push(item);
  }
  
  return filtered;
}

// ═══════════════════════════════════════════════════════════════════════════
// ARTICLE CONTENT FETCHER
// ═══════════════════════════════════════════════════════════════════════════

async function fetchArticleContent(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      }
    });
    clearTimeout(timeout);
    
    if (!res.ok) return null;
    
    const html = await res.text();
    
    // Extract article content - try multiple patterns
    let content = '';
    
    // Try article tag first
    const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
    if (articleMatch) content = articleMatch[1];
    
    // Try main content areas
    if (!content || content.length < 200) {
      const patterns = [
        /<main[^>]*>([\s\S]*?)<\/main>/i,
        /class="[^"]*post-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
        /class="[^"]*entry-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
        /class="[^"]*article-body[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
        /class="[^"]*story-body[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
        /class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      ];
      
      for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match && match[1].length > content.length) {
          content = match[1];
        }
      }
    }
    
    // Extract all paragraph text as fallback
    if (!content || content.length < 200) {
      const paragraphs = html.match(/<p[^>]*>([\s\S]*?)<\/p>/gi);
      if (paragraphs) {
        content = paragraphs.slice(0, 30).join(' '); // Get first 30 paragraphs
      }
    }
    
    // Try meta description as last resort
    if (!content || content.length < 100) {
      const metaMatch = html.match(/<meta[^>]*name="description"[^>]*content="([^"]+)"/i) ||
                        html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i);
      if (metaMatch) content = metaMatch[1];
    }
    
    // Clean and truncate - increased for comprehensive summaries
    content = cleanText(content);
    return content.substring(0, 12000); // ~3000 tokens for full article coverage
    
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
        model: 'claude-3-haiku-20240307',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: `Summarize this agricultural news article comprehensively. Capture ALL important information so a farmer doesn't need to read the original.

Include: main news/finding, ALL numbers/prices/statistics/percentages, ALL dates/deadlines, names of people/organizations/programs, locations, context/causes, impacts for farmers, recommendations/action items, expert quotes if any.

CRITICAL: Start directly with the summary content. Do NOT include any preamble like "Here is a summary" or "This article discusses". Just write the summary itself.

Write 6-12 sentences as needed. Be thorough but concise. Plain language. Facts only from the article.

TITLE: ${title}
SOURCE: ${source}

CONTENT:
${content.substring(0, 10000)}`
        }]
      })
    });
    
    if (!res.ok) {
      console.log(`  ⚠ Claude API error: ${res.status}`);
      return null;
    }
    
    const data = await res.json();
    let summary = data.content?.[0]?.text?.trim() || null;
    
    // Remove any preamble the AI might still add
    if (summary) {
      summary = summary
        .replace(/^(Here is|Here's|This is|Below is|The following is)[^.]*[.:]\s*/i, '')
        .replace(/^(This article|The article)[^.]*[.:]\s*/i, '')
        .trim();
    }
    
    return summary;
    
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
  const redditRaw = [];
  const stats = { community: 0, government: 0, university: 0, industry: 0, markets: 0, weather: 0 };
  
  for (const feed of FEEDS) {
    const items = await fetchFeed(feed);
    if (items.length > 0) {
      if (feed.isReddit) {
        redditRaw.push(...items);
      } else {
        allItems.push(...items);
        stats[feed.category] = (stats[feed.category] || 0) + items.length;
      }
    }
    await sleep(300);
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // PHASE 1b: Filter Reddit posts for quality
  // ─────────────────────────────────────────────────────────────────────────
  if (redditRaw.length > 0) {
    console.log(`\nFiltering ${redditRaw.length} Reddit posts for quality...\n`);
    const qualityReddit = await filterRedditItems(redditRaw);
    allItems.push(...qualityReddit);
    stats.community = qualityReddit.length;
    console.log(`\n✓ Kept ${qualityReddit.length}/${redditRaw.length} Reddit posts\n`);
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
    
    let content = item.description || '';
    
    // For Reddit: try to fetch the actual post content via JSON API
    if (item.category === 'community' && item.link) {
      try {
        // Reddit JSON API - add .json to URL
        const jsonUrl = item.link.replace(/\/$/, '') + '.json';
        const redditRes = await fetch(jsonUrl, {
          headers: { 'User-Agent': 'AGSIST News Bot 1.0' }
        });
        if (redditRes.ok) {
          const redditData = await redditRes.json();
          const postData = redditData?.[0]?.data?.children?.[0]?.data;
          if (postData) {
            // Get selftext (text posts) or combine with title for link posts
            const selftext = postData.selftext || '';
            if (selftext.length > 50) {
              content = selftext;
            } else if (postData.url && !postData.url.includes('reddit.com')) {
              // It's a link post - mention what it links to
              content = `Link post sharing: ${postData.url}. ${selftext}`.trim();
            }
          }
        }
        await sleep(300); // Rate limit Reddit API
      } catch (e) {
        // Fallback to RSS description
      }
    }
    
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
