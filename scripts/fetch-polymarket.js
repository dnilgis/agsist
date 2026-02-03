#!/usr/bin/env node
// fetch-polymarket.js
// Fetches ag-relevant prediction markets from Polymarket gamma API.
// Runs server-side via GitHub Action — no CORS issues.
// Writes data/polymarket.json for ag-odds.html to read.
// Zero npm dependencies — uses native Node https.

const fs = require('fs');
const path = require('path');
const https = require('https');

// ═══════════════════════════════════════════════════════════════
// SEARCH QUERIES — ag-focused, grouped by category
// ═══════════════════════════════════════════════════════════════
const SEARCHES = [
    // Trade policy affecting agriculture
    { q: 'tariff china', cat: 'tariffs' },
    { q: 'tariff canada', cat: 'tariffs' },
    { q: 'tariff mexico', cat: 'tariffs' },
    { q: 'trade war', cat: 'tariffs' },
    { q: 'USMCA', cat: 'tariffs' },
    { q: 'import export ban', cat: 'tariffs' },

    // Fed/economy — directly impacts commodity prices & farm credit
    { q: 'fed rate cut', cat: 'fed' },
    { q: 'fed rate hike', cat: 'fed' },
    { q: 'recession 2026', cat: 'fed' },
    { q: 'inflation rate', cat: 'fed' },
    { q: 'interest rate', cat: 'fed' },

    // Ag policy
    { q: 'farm bill', cat: 'policy' },
    { q: 'government shutdown', cat: 'policy' },
    { q: 'ethanol mandate', cat: 'policy' },
    { q: 'EPA agriculture', cat: 'policy' },
    { q: 'biofuel', cat: 'policy' },
    { q: 'USDA', cat: 'policy' },
    { q: 'food prices', cat: 'policy' },

    // Commodities & weather
    { q: 'oil price', cat: 'commodities' },
    { q: 'drought', cat: 'commodities' },
    { q: 'El Nino', cat: 'commodities' },
    { q: 'La Nina', cat: 'commodities' },
    { q: 'crop production', cat: 'commodities' },
    { q: 'grain prices', cat: 'commodities' },
    { q: 'corn soybeans wheat', cat: 'commodities' },
];

// ═══════════════════════════════════════════════════════════════
// RELEVANCE FILTER — reject markets that clearly aren't ag-relevant
// Our search queries are already ag-focused, so we only need to
// block noise that leaks through broad keyword matches.
// ═══════════════════════════════════════════════════════════════

// If the question contains ANY of these, reject it immediately
const BLOCKLIST = [
    // Crypto
    'bitcoin', 'btc', 'ethereum', 'eth ', 'crypto', 'microstrategy',
    'nft', 'solana', 'dogecoin', 'memecoin', 'token price',
    // Immigration (not trade)
    'deport', 'deportation', 'immigration', 'immigrant', 'border wall',
    'asylum', 'migrant',
    // Social issues unrelated to ag
    'abortion', 'roe v wade', 'supreme court justice',
    'marriage equality', 'gender',
    // Entertainment & sports
    'oscar', 'grammy', 'emmy', 'super bowl winner', 'nba finals',
    'nfl', 'mlb', 'nhl', 'world cup', 'premier league',
    'box office', 'movie', 'netflix', 'streaming',
    'dating', 'kardashian', 'celebrity',
    // Tech companies
    'tiktok ban', 'twitter', 'x.com', 'facebook', 'instagram',
    'spacex', 'mars landing', 'moon landing',
    'ai model', 'chatgpt', 'openai', 'google gemini',
    // Extreme events
    'nuclear war', 'world war',
    'assassination', 'imprisoned',
    'alien', 'ufo', 'uap',
    // Health/pharma noise
    'covid vaccine mandate', 'ivermectin',
    'bird flu vaccine',
    // Political personality noise
    'who will win', 'approval rating',
    'twitter followers', 'podcast',
    'pardon', 'indictment',
];

function isRelevant(question) {
    const q = question.toLowerCase();
    for (const block of BLOCKLIST) {
        if (q.includes(block)) return false;
    }
    // If it passes the blocklist, trust the search query — it was ag-focused
    return true;
}

// ═══════════════════════════════════════════════════════════════
// API HELPERS
// ═══════════════════════════════════════════════════════════════

function fetchJSON(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'AGSIST/1.0' } }, res => {
            if (res.statusCode !== 200) {
                reject(new Error('HTTP ' + res.statusCode));
                res.resume();
                return;
            }
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => {
                try { resolve(JSON.parse(body)); }
                catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function searchEvents(query) {
    const url = 'https://gamma-api.polymarket.com/events?closed=false&limit=8&_q=' + encodeURIComponent(query);
    try {
        const data = await fetchJSON(url);
        return Array.isArray(data) ? data : [];
    } catch (e) {
        console.warn('  ✗ "' + query + '": ' + e.message);
        return [];
    }
}

function extractMarkets(events) {
    const out = [];
    for (const evt of events) {
        if (!evt.markets || !Array.isArray(evt.markets)) continue;
        for (const m of evt.markets) {
            if (m.closed) continue;
            const question = m.question || evt.title || '';

            // ── RELEVANCE CHECK ──
            if (!isRelevant(question)) continue;

            let yesPct = 0;
            try {
                if (m.outcomePrices) {
                    yesPct = Math.round(parseFloat(JSON.parse(m.outcomePrices)[0]) * 100);
                } else if (m.lastTradePrice) {
                    yesPct = Math.round(parseFloat(m.lastTradePrice) * 100);
                }
            } catch (e) { continue; }
            if (yesPct <= 0 || yesPct >= 100) continue;

            let vol = 0;
            try { vol = parseFloat(m.volume) || parseFloat(m.volumeNum) || 0; } catch(e) {}

            // Skip very low volume (< $5K) — unreliable signal
            if (vol < 5000) continue;

            out.push({
                id: m.conditionId || m.id || evt.slug + '-' + out.length,
                question: question,
                pct: yesPct,
                volume: Math.round(vol),
                endDate: m.endDate || evt.endDate || null,
                slug: evt.slug || '',
            });
        }
    }
    return out;
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

async function main() {
    console.log('Fetching Polymarket data for AGSIST...\n');
    const allResults = [];
    let ok = 0, fail = 0;

    for (let i = 0; i < SEARCHES.length; i += 4) {
        const batch = SEARCHES.slice(i, i + 4);
        const results = await Promise.allSettled(
            batch.map(s => searchEvents(s.q).then(events => ({ cat: s.cat, q: s.q, events })))
        );
        for (const r of results) {
            if (r.status === 'fulfilled') {
                ok++;
                if (r.value.events.length > 0)
                    console.log('  ✓ "' + r.value.q + '" → ' + r.value.events.length + ' events');
                r.value.events.forEach(evt => allResults.push({ cat: r.value.cat, event: evt }));
            } else { fail++; }
        }
        if (i + 4 < SEARCHES.length) await sleep(200);
    }

    console.log('\n' + ok + ' queries succeeded, ' + fail + ' failed');

    // Deduplicate and categorize
    const seen = {};
    const cats = { tariffs: [], fed: [], policy: [], commodities: [] };

    for (const item of allResults) {
        for (const m of extractMarkets([item.event])) {
            if (seen[m.id]) continue;
            seen[m.id] = true;
            if (cats[item.cat]) {
                cats[item.cat].push(m);
            }
        }
    }

    let total = 0;
    for (const key of Object.keys(cats)) {
        cats[key].sort((a, b) => b.volume - a.volume);
        cats[key] = cats[key].slice(0, 8);
        total += cats[key].length;
        if (cats[key].length) console.log('  ' + key + ': ' + cats[key].length + ' markets');
    }

    console.log('\n' + total + ' ag-relevant markets kept');

    const output = {
        updated: new Date().toISOString(),
        totalMarkets: total,
        categories: cats,
    };
    const outPath = path.join(__dirname, '..', 'data', 'polymarket.json');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
    console.log('✅ ' + total + ' markets → ' + outPath);
}

main().catch(e => { console.error(e); process.exit(1); });
