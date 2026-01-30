/**
 * AGSIST X (Twitter) Feed Aggregator
 * Fetches posts from RSS feeds (no API needed)
 * 
 * Add/remove accounts in the ACCOUNTS array below
 */

const fs = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURE YOUR ACCOUNTS HERE
// ═══════════════════════════════════════════════════════════════════════════
const ACCOUNTS = [
  // === GRAIN MARKETS ===
  { handle: 'RichNelson_Alln', name: 'Rich Nelson', tag: 'grain' },        // Allendale grain analyst
  { handle: 'texzona', name: 'Ted Seifried', tag: 'grain' },               // Zaner Ag Hedge
  { handle: 'ScottSeifert1', name: 'Scott Seifert', tag: 'grain' },        // Grain markets
  { handle: 'MGrayGrain', name: 'Mike Gray', tag: 'grain' },               // Grain analyst
  { handle: 'ChrisHydeGrain', name: 'Chris Hyde', tag: 'grain' },          // Grain markets
  { handle: 'MattBennettGrain', name: 'Matt Bennett', tag: 'grain' },      // AgMarket.Net
  { handle: 'GrainStats', name: 'Grain Stats', tag: 'grain' },             // Grain data
  
  // === MARKETS & TRADING ===
  { handle: 'RampCapitalLLC', name: 'Ramp Capital', tag: 'markets' },      // Market commentary
  { handle: 'philaborninabarn', name: 'Phil in the Barn', tag: 'markets' },// Trading perspective
  
  // === WEATHER ===
  { handle: 'RyanHallYall', name: 'Ryan Hall Y\'all', tag: 'weather' },   // Severe weather
  { handle: 'kannbwx', name: 'Eric Snodgrass', tag: 'weather' },           // Ag weather - Nutrien
  { handle: 'DroughtMonitor', name: 'Drought Monitor', tag: 'weather' },   // USDM official
  { handle: 'ABORNINABARN', name: 'AG Weather', tag: 'weather' },          // Farm weather
  
  // === FARM LIFE & POLICY ===
  { handle: 'RoachAg', name: 'Tim Roach', tag: 'farm' },                   // Farm perspective
  { handle: 'FarmPolicy', name: 'Farm Policy News', tag: 'farm' },         // Ag policy
  { handle: 'USDAFarmPolicy', name: 'USDA Farm Policy', tag: 'farm' },     // Official USDA
];

// RSS sources - script tries each until one works
// RSSHub is most reliable, Nitter instances as fallback
const RSS_SOURCES = [
  // RSSHub instances (most reliable)
  { type: 'rsshub', base: 'https://rsshub.app/twitter/user' },
  { type: 'rsshub', base: 'https://rsshub.rssforever.com/twitter/user' },
  { type: 'rsshub', base: 'https://rss.fatpandac.com/twitter/user' },
  // Nitter instances (fallback)
  { type: 'nitter', base: 'https://nitter.poast.org' },
  { type: 'nitter', base: 'https://nitter.privacydev.net' },
  { type: 'nitter', base: 'https://n.opnxng.com' },
];

const MAX_TWEETS_PER_ACCOUNT = 3;
const MAX_TOTAL_TWEETS = 40;
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'tweets.json');

// ═══════════════════════════════════════════════════════════════════════════
// FETCH LOGIC
// ═══════════════════════════════════════════════════════════════════════════

async function fetchWithTimeout(url, timeout = 10000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
}

function parseRSS(xml, account) {
  const tweets = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  const titleRegex = /<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>|<title>([\s\S]*?)<\/title>/;
  const linkRegex = /<link>([\s\S]*?)<\/link>/;
  const pubDateRegex = /<pubDate>([\s\S]*?)<\/pubDate>/;
  const descRegex = /<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>|<description>([\s\S]*?)<\/description>/;

  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const item = match[1];
    
    const titleMatch = item.match(titleRegex);
    const linkMatch = item.match(linkRegex);
    const dateMatch = item.match(pubDateRegex);
    const descMatch = item.match(descRegex);
    
    let text = titleMatch ? (titleMatch[1] || titleMatch[2] || '') : '';
    // Clean up the text
    text = text.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
    
    // Skip retweets if they're just "RT @someone"
    if (text.startsWith('RT @') && text.length < 20) continue;
    // Skip replies that are just @mentions
    if (text.startsWith('@') && !text.includes(' ')) continue;
    
    const link = linkMatch ? linkMatch[1].trim() : '';
    const pubDate = dateMatch ? dateMatch[1].trim() : '';
    
    // Extract tweet ID from link
    const idMatch = link.match(/status\/(\d+)/);
    const id = idMatch ? idMatch[1] : Date.now().toString();
    
    // Extract images from description
    const descContent = descMatch ? (descMatch[1] || descMatch[2] || '') : '';
    const images = [];
    const imgRegex = /<img[^>]+src=["']([^"']+)["']/g;
    let imgMatch;
    while ((imgMatch = imgRegex.exec(descContent)) !== null) {
      let imgUrl = imgMatch[1];
      // Convert nitter image URLs to original Twitter/X URLs if possible
      if (imgUrl.includes('nitter')) {
        imgUrl = imgUrl.replace(/https?:\/\/[^/]+\/pic\//, 'https://pbs.twimg.com/');
      }
      // Skip profile pics and emoji
      if (!imgUrl.includes('profile_images') && !imgUrl.includes('emoji')) {
        images.push(imgUrl);
      }
    }
    
    // Check for video
    const hasVideo = descContent.includes('video') || descContent.includes('.mp4');
    
    if (text && link) {
      tweets.push({
        id,
        text: text.substring(0, 500), // Limit length
        link: link.replace(/nitter\.[^/]+/, 'x.com').replace('twitter.com', 'x.com'),
        date: pubDate,
        timestamp: new Date(pubDate).getTime(),
        handle: account.handle,
        name: account.name,
        tag: account.tag,
        images: images.slice(0, 4), // Max 4 images per post
        hasVideo,
        isRT: text.startsWith('RT @'),
      });
    }
  }
  
  return tweets.slice(0, MAX_TWEETS_PER_ACCOUNT);
}

async function fetchAccountTweets(account) {
  for (const source of RSS_SOURCES) {
    let url;
    if (source.type === 'rsshub') {
      url = `${source.base}/${account.handle}`;
    } else {
      url = `${source.base}/${account.handle}/rss`;
    }
    
    try {
      console.log(`  Trying ${source.base}...`);
      const res = await fetchWithTimeout(url);
      if (res.ok) {
        const xml = await res.text();
        if (xml.includes('<item>')) {
          const tweets = parseRSS(xml, account);
          console.log(`  ✓ Got ${tweets.length} tweets from ${source.type}`);
          return tweets;
        }
      }
    } catch (e) {
      console.log(`  ✗ ${source.base} failed: ${e.message}`);
    }
  }
  console.log(`  ✗ All sources failed for @${account.handle}`);
  return [];
}

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('AGSIST X Feed Fetcher');
  console.log('═══════════════════════════════════════════════════\n');
  
  const allTweets = [];
  
  for (const account of ACCOUNTS) {
    console.log(`Fetching @${account.handle}...`);
    const tweets = await fetchAccountTweets(account);
    allTweets.push(...tweets);
    // Small delay between accounts to be nice
    await new Promise(r => setTimeout(r, 1000));
  }
  
  // Sort by timestamp (newest first)
  allTweets.sort((a, b) => b.timestamp - a.timestamp);
  
  // Limit total
  const finalTweets = allTweets.slice(0, MAX_TOTAL_TWEETS);
  
  // Ensure output directory exists
  const outputDir = path.dirname(OUTPUT_FILE);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  // Write output
  const output = {
    updated: new Date().toISOString(),
    count: finalTweets.length,
    accounts: ACCOUNTS.map(a => a.handle),
    tweets: finalTweets,
  };
  
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  
  console.log('\n═══════════════════════════════════════════════════');
  console.log(`✓ Saved ${finalTweets.length} tweets to ${OUTPUT_FILE}`);
  console.log('═══════════════════════════════════════════════════');
}

main().catch(console.error);
