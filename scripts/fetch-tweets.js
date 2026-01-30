// Fetch tweets from RSSHub/Nitter and save to JSON
// No dependencies needed - uses built-in fetch

const fs = require('fs');
const path = require('path');

// Try RSSHub first (faster), then xcancel (most stable Nitter)
const RSS_SOURCES = [
  { type: 'rsshub', base: 'https://rsshub.app/twitter/user/' },
  { type: 'nitter', base: 'https://xcancel.com/' },
];

// 🛡️ VERIFIED HANDLES - Updated early 2026
const ACCOUNTS = [
  { handle: 'RichNelsonMkts', name: 'Rich Nelson', tag: 'grain' },      // Corrected from @RichNelson_Alln
  { handle: 'TheTedSpread', name: 'Ted Seifried', tag: 'grain' },       // Corrected from @texzona
  { handle: 'ScottSeifert1', name: 'Scott Seifert', tag: 'grain' },     // Verified
  { handle: 'GrainStats', name: 'Grain Stats', tag: 'grain' },          // Verified
  { handle: 'RampCapitalLLC', name: 'Ramp Capital', tag: 'markets' },   // Verified
  { handle: 'RyanHallYall', name: "Ryan Hall Y'all", tag: 'weather' },  // Verified
  { handle: 'snodgrss', name: 'Eric Snodgrass', tag: 'weather' },       // Corrected from @kannbwx
];

function parseRSS(xml, account) {
  const tweets = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  let count = 0;

  while ((match = itemRegex.exec(xml)) !== null && count < 3) {
    const item = match[1];

    const title = (item.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) ||
                   item.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
    const link = (item.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '';
    const pubDate = (item.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '';
    const description = (item.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) ||
                        item.match(/<description>([\s\S]*?)<\/description>/) || [])[1] || '';

    let text = title
      .replace(/<[^>]*>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();

    if (!text || text.length < 5 || text.includes('not yet whitelisted')) continue;

    const tweetId = (link.match(/status\/(\d+)/) || [])[1] || Date.now().toString();

    // Extract images
    const images = [];
    const imgRegex = /<img[^>]+src=["']([^"']+)["']/g;
    let imgMatch;
    while ((imgMatch = imgRegex.exec(description)) !== null) {
      const url = imgMatch[1];
      if (!url.includes('profile_images') && !url.includes('emoji') && !url.includes('twemoji')) {
        // Convert to pbs.twimg.com if needed
        let cleanUrl = url;
        if (url.includes('/pic/')) {
          cleanUrl = 'https://pbs.twimg.com/' + url.split('/pic/')[1];
        }
        images.push(cleanUrl);
      }
    }

    const hasVideo = description.includes('video') || description.includes('.mp4');

    const xLink = link
      .replace(/xcancel\.com/, 'x.com')
      .replace(/nitter\.[^\/]+/, 'x.com')
      .replace('twitter.com', 'x.com');

    tweets.push({
      id: tweetId,
      text: text.substring(0, 500),
      link: xLink,
      date: pubDate,
      timestamp: new Date(pubDate).getTime() || 0,
      handle: account.handle,
      name: account.name,
      tag: account.tag,
      images: images.slice(0, 4),
      hasVideo,
      isRT: text.startsWith('RT @'),
    });

    count++;
  }

  return tweets;
}

async function fetchAccount(account) {
  for (const source of RSS_SOURCES) {
    let url;
    if (source.type === 'rsshub') {
      url = `${source.base}${account.handle}`;
    } else {
      url = `${source.base}${account.handle}/rss`;
    }
    
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        }
      });
      
      clearTimeout(timeout);
      
      if (res.ok) {
        const xml = await res.text();
        if (xml.includes('<item>') && !xml.includes('not yet whitelisted')) {
          console.log(`✓ @${account.handle} via ${source.type}`);
          return parseRSS(xml, account);
        }
      }
    } catch (e) {
      // Try next source
    }
  }
  
  console.log(`✗ @${account.handle} - all sources failed`);
  return null; // Return null instead of empty array to signal failure
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('Fetching ag feed...\n');
  
  // 🛡️ SAFETY GUARD: Load existing tweets to preserve on partial failure
  const outputPath = path.join(process.cwd(), 'data', 'tweets.json');
  let existingData = { tweets: [] };
  try {
    if (fs.existsSync(outputPath)) {
      existingData = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
      console.log(`Loaded ${existingData.tweets?.length || 0} existing tweets as backup\n`);
    }
  } catch (e) {
    console.log('No existing data to preserve');
  }
  
  // Group existing tweets by handle for easy lookup
  const existingByHandle = {};
  for (const tweet of (existingData.tweets || [])) {
    if (!existingByHandle[tweet.handle]) {
      existingByHandle[tweet.handle] = [];
    }
    existingByHandle[tweet.handle].push(tweet);
  }
  
  const allTweets = [];
  let successCount = 0;
  let preservedCount = 0;
  
  for (const account of ACCOUNTS) {
    const tweets = await fetchAccount(account);
    
    if (tweets && tweets.length > 0) {
      // Fresh tweets fetched successfully
      allTweets.push(...tweets);
      successCount++;
    } else if (existingByHandle[account.handle]?.length > 0) {
      // 🛡️ SAFETY GUARD: Keep old tweets if fetch failed
      console.log(`  ↳ Preserving ${existingByHandle[account.handle].length} old tweets for @${account.handle}`);
      allTweets.push(...existingByHandle[account.handle]);
      preservedCount++;
    }
    
    // Small delay between accounts
    await sleep(500);
  }
  
  // Sort by date
  allTweets.sort((a, b) => b.timestamp - a.timestamp);
  
  const output = {
    tweets: allTweets.slice(0, 50),
    count: allTweets.length,
    accounts: successCount,
    preserved: preservedCount,
    updated: new Date().toISOString(),
  };
  
  // Ensure data directory exists
  const dataDir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  
  // Write JSON
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  
  console.log(`\n✅ Saved ${output.count} tweets`);
  console.log(`   Fresh: ${successCount}/${ACCOUNTS.length} accounts`);
  if (preservedCount > 0) {
    console.log(`   Preserved: ${preservedCount} accounts (from previous run)`);
  }
  console.log(`   Output: ${outputPath}`);
}

main().catch(console.error);
