// AGSIST App - Main JavaScript

document.addEventListener('DOMContentLoaded', () => {
    try {
        loadData();
        initWeather();
        loadCashBidSources();
        calcBin();
        calcBreakEven();
        initGduDate();
        renderUsdaCalendar();
        loadInsuranceDeadlines();
        renderSidebarDeadlines();
        setInterval(loadData, 60000);
    } catch(e) {
        console.error("Init failed:", e);
        document.getElementById('update-time').innerText = "System Error";
    }
});

// Mobile Menu Toggle
function toggleMenu() {
    const nav = document.querySelector('.nav');
    nav.classList.toggle('open');
}

// Close menu when clicking a nav link (mobile)
document.querySelectorAll('.nav a').forEach(link => {
    link.addEventListener('click', () => {
        document.querySelector('.nav').classList.remove('open');
    });
});

// Twitter feed tab switching
function showTwitterFeed(feed) {
    // Hide all feeds
    document.querySelectorAll('.twitter-feed').forEach(el => {
        el.style.display = 'none';
        el.classList.remove('active');
    });
    // Remove active from all tabs
    document.querySelectorAll('.twitter-tab').forEach(el => {
        el.classList.remove('active');
    });
    // Show selected feed
    const feedEl = document.getElementById('twitter-' + feed);
    if (feedEl) {
        feedEl.style.display = 'block';
        feedEl.classList.add('active');
    }
    // Mark tab as active (use event if available)
    if (typeof event !== 'undefined' && event.target) {
        event.target.classList.add('active');
    }
    // Re-render Twitter widgets if needed
    if (typeof twttr !== 'undefined' && twttr.widgets) {
        twttr.widgets.load(feedEl);
    }
}

// Navigation
function switchTab(id) {
    window.scrollTo({top:0, behavior:'smooth'});
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.nav a').forEach(a => a.classList.remove('active'));
    document.getElementById(id)?.classList.add('active');
    document.querySelector(`.nav a[data-tab="${id}"]`)?.classList.add('active');
    // Close mobile menu on tab switch
    document.querySelector('.nav').classList.remove('open');
}

document.querySelectorAll('[data-tab]').forEach(el => {
    el.addEventListener('click', e => {
        e.preventDefault();
        switchTab(el.dataset.tab);
    });
});

// Scroll to element helper
function scrollToEl(id) {
    const el = document.getElementById(id);
    if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

// Format helper
function formatVal(value, unit) {
    if (!value && value !== 0) return '-';
    if (unit === '$') {
        return '$' + value.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2});
    }
    return value.toFixed(2);
}

// Data Loader
async function loadData() {
    try {
        const res = await fetch('data/markets.json');
        if(!res.ok) throw new Error("JSON not found");
        const data = await res.json();
        
        if(!data.updated) {
            document.getElementById('update-time').innerHTML = '<span style="color:var(--accent)">Awaiting Data</span>';
            return;
        }
        
        const m = data.markets;
        
        document.getElementById('update-time').textContent = new Date(data.updated).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
        
        // Update footer timestamp
        const footerUpdated = document.getElementById('footer-updated');
        if(footerUpdated) {
            footerUpdated.textContent = 'Data: ' + new Date(data.updated).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
        }

        renderGrid('grains-grid', [m.grains?.corn, m.grains?.soybeans, m.grains?.wheat]);
        renderGrid('livestock-grid', [m.livestock?.cattle, m.livestock?.feeder, m.livestock?.milk]);
        renderGrid('metals-grid', [m.indices?.sp500, m.indices?.dow, m.metals?.gold, m.metals?.silver]);
        renderGrid('crypto-grid', [m.crypto?.bitcoin, m.crypto?.ethereum, m.crypto?.kaspa, m.crypto?.xrp]);

        renderNews(data.news || []);
        renderUsdaFeed(data.usda || []);
        updateTicker(m, data.news || []);
    } catch (e) { 
        console.error(e); 
        document.getElementById('update-time').innerHTML = '<span style="color:var(--red)">Offline</span> <button onclick="loadData()" style="margin-left:8px;background:transparent;border:1px solid var(--border);color:var(--text);padding:2px 8px;border-radius:3px;cursor:pointer;font-size:0.7rem;">↻</button>';
    }
}

// Render market grid
function renderGrid(id, items) {
    const el = document.getElementById(id);
    if(!el) return;
    
    const validItems = items.filter(Boolean);
    if(validItems.length === 0) {
        el.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px 20px;color:var(--dim)">No data available</div>';
        return;
    }
    
    el.innerHTML = validItems.map(item => {
        const isUp = item.change >= 0;
        const sign = isUp ? '+' : '';
        const color = isUp ? 'var(--green)' : 'var(--red)';
        
        let rangeHtml = '';
        let rangePct = 0;
        
        if(item.low52 && item.high52) {
            rangePct = ((item.price - item.low52)/(item.high52 - item.low52)) * 100;
            rangeHtml = `
            <div class="range-container">
                <div class="range-label">52 WEEK RANGE</div>
                <div class="range-bar"><div class="range-cursor" style="left:${Math.max(0,Math.min(100,rangePct))}%"></div></div>
                <div class="range-labels">
                    <span>L: ${formatVal(item.low52, item.unit)}</span>
                    <span>H: ${formatVal(item.high52, item.unit)}</span>
                </div>
            </div>`;
        }

        const expandedHtml = `
        <div class="expanded-detail">
            <div class="detail-row">
                <span class="detail-label">Previous Close</span>
                <span class="detail-value">${formatVal(item.prevClose, item.unit)}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Day Change</span>
                <span class="detail-value" style="color:${color}">${sign}${item.change.toFixed(2)} (${sign}${item.changePct.toFixed(2)}%)</span>
            </div>
            ${item.contract && item.contract !== 'Spot' ? `
            <div class="detail-row">
                <span class="detail-label">Contract</span>
                <span class="detail-value" style="color:var(--accent)">${item.contract}</span>
            </div>` : ''}
            <div class="detail-row">
                <span class="detail-label">52W Position</span>
                <span class="detail-value">${rangePct.toFixed(0)}% from low</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">52 Week Low</span>
                <span class="detail-value">${formatVal(item.low52, item.unit)}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">52 Week High</span>
                <span class="detail-value">${formatVal(item.high52, item.unit)}</span>
            </div>
        </div>`;

        return `
        <div class="market-card">
            <div class="head">
                <div>
                    <div class="name">${item.name}</div>
                    <div class="symbol">${item.symbol} ${item.contract && item.contract !== 'Spot' ? `<span style="color:var(--accent)">${item.contract}</span>` : ''}</div>
                </div>
            </div>
            <div class="price">${formatVal(item.price, item.unit)} <span class="unit">${item.unit}</span></div>
            <div class="meta" style="color:${color}">
                <span>${sign}${item.change.toFixed(2)}</span>
                <span>${sign}${item.changePct.toFixed(2)}%</span>
            </div>
            ${rangeHtml}
            ${expandedHtml}
        </div>`;
    }).join('');
}

// Render news feeds
function renderNews(news) {
    const el = document.getElementById('news-wire-list');
    if(!el) return;
    if(!news.length) {
        el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--dim)">No news available</div>';
        return;
    }
    el.innerHTML = news.map(n => {
        const src = n.source.toLowerCase();
        const tagClass = src.includes('usda') ? 'usda' : 
                        src.includes('farm') ? 'farmprogress' : 
                        src.includes('brownfield') ? 'brownfield' :
                        src.includes('dtn') ? 'dtn' :
                        src.includes('world') ? 'worldgrain' : 'agweb';
        return `<a href="${n.link}" target="_blank" class="news-item">
            <span class="tag ${tagClass}">${n.source}</span>
            <h4>${n.title}</h4>
        </a>`;
    }).join('');
}

function renderUsdaFeed(items) {
    const el = document.getElementById('usda-feed-list');
    if(!el) return;
    if(!items.length) {
        el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--dim)">No USDA updates available</div>';
        return;
    }
    el.innerHTML = items.map(n => {
        return `<a href="${n.link}" target="_blank" class="news-item">
            <span class="tag usda">${n.source}</span>
            <h4>${n.title}</h4>
        </a>`;
    }).join('');
}

function updateTicker(m, news) {
    if(!m || Object.keys(m).length === 0) {
        document.getElementById('news-ticker').innerHTML = '<span class="ticker-item" style="color:var(--dim)">Awaiting market data...</span>';
        return;
    }
    
    const items = [];
    const add = (k, d) => {
        if(d) items.push(`<span class="ticker-item"><span class="label">${k}</span>${formatVal(d.price, d.unit)}<span class="${d.change>=0?'up':'down'}">${d.change>=0?'+':''}${d.changePct.toFixed(1)}%</span></span>`);
    };
    
    add('CORN', m.grains?.corn);
    add('BEANS', m.grains?.soybeans);
    add('WHEAT', m.grains?.wheat);
    add('CATTLE', m.livestock?.cattle);
    add('GOLD', m.metals?.gold);
    add('BTC', m.crypto?.bitcoin);
    add('KAS', m.crypto?.kaspa);

    if(items.length === 0 && news.length === 0) {
        document.getElementById('news-ticker').innerHTML = '<span class="ticker-item" style="color:var(--dim)">No market data available</span>';
        return;
    }

    let html = '';
    const max = Math.max(items.length, news.length);
    for(let i=0; i<max; i++) {
        if(items[i % items.length]) html += items[i % items.length];
        if(news[i]) html += `<a href="${news[i].link}" target="_blank" class="ticker-item ticker-news"><span class="source">${news[i].source}</span> ${news[i].title}</a>`;
    }
    document.getElementById('news-ticker').innerHTML = html + html;
}

// Weather Functions
const DEFAULT_LAT = 45.4;  // Barron, WI area
const DEFAULT_LON = -91.85;

function initWeather(forceLocate = false) {
    const locName = document.getElementById('location-name');
    
    if (forceLocate || (navigator.geolocation && !sessionStorage.getItem('geoDenied'))) {
        if(forceLocate) locName.innerText = "DETECTING...";
        
        const t = setTimeout(() => {
            console.log("Geo timeout");
            loadWeather(DEFAULT_LAT, DEFAULT_LON, "NORTHWEST WI");
        }, 10000);

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                clearTimeout(t);
                loadWeather(pos.coords.latitude, pos.coords.longitude, "YOUR AREA");
            },
            (err) => {
                clearTimeout(t);
                console.warn("Geo denied", err);
                sessionStorage.setItem('geoDenied', 'true');
                loadWeather(DEFAULT_LAT, DEFAULT_LON, "NORTHWEST WI");
            }
        );
    } else {
        loadWeather(DEFAULT_LAT, DEFAULT_LON, "NORTHWEST WI");
    }
}

async function loadWeather(lat, lon, label) {
    document.getElementById('radar-iframe').src = `https://embed.windy.com/embed2.html?lat=${lat}&lon=${lon}&zoom=6&level=surface&overlay=radar&menu=&message=&marker=&calendar=now&pressure=&type=map&location=coordinates&detail=&metricWind=mph&metricTemp=%C2%B0F&radarRange=-1`;
    document.getElementById('location-name').innerText = label;

    try {
        const pointRes = await fetch(`https://api.weather.gov/points/${lat},${lon}`);
        const pointData = await pointRes.json();
        const forecastRes = await fetch(pointData.properties.forecast);
        const forecastData = await forecastRes.json();
        
        const periods = forecastData.properties.periods.slice(0, 5);
        document.getElementById('forecast').innerHTML = periods.map(p => `
            <div class="forecast-mini">
                <div class="day">${p.name.toUpperCase()}</div>
                <div class="desc">${p.shortForecast}</div>
                <div class="temp">${p.temperature}°</div>
            </div>
        `).join('');
    } catch (e) {
        console.error("Weather error:", e);
        document.getElementById('forecast').innerHTML = '<div style="padding:20px;text-align:center;color:var(--dim)">Forecast unavailable</div>';
    }
}

// Cash Bid Sources - Links to REAL data sources (no fake prices)
const CASH_BID_SOURCES = [
    {name: "DTN Cash Bids", url: "https://www.dtn.com/agriculture/grains/cash-grain-bids/", desc: "Real-time regional elevator bids"},
    {name: "AgWeb Cash Grain", url: "https://www.agweb.com/markets/cash-grain-bids", desc: "Cash prices by location"},
    {name: "Barchart Cash Prices", url: "https://www.barchart.com/futures/quotes/ZC*0/cash-prices", desc: "Corn cash prices nationwide"}
];

function loadCashBidSources() {
    const container = document.getElementById('local-markets');
    if (!container) return;
    
    container.innerHTML = `
    <div style="padding:8px 0;font-size:0.8rem;color:var(--dim);border-bottom:1px solid var(--border)">
        Live cash bids from regional sources:
    </div>` + CASH_BID_SOURCES.map(source => `
        <a href="${source.url}" target="_blank" class="elevator-item">
            <div>
                <span class="elevator-name">${source.name}</span>
                <span style="display:block;font-size:0.75rem;color:var(--dim)">${source.desc}</span>
            </div>
            <div style="color:var(--accent);font-size:1.2rem">→</div>
        </a>`).join('');
}

// Grain Bin Calculator
const BU_PER_CUFT = 0.8036;

function calcBin() {
    const shape = document.getElementById('binShape')?.value;
    const grainEl = document.getElementById('grain');
    if(!grainEl) return;
    
    const grainParts = grainEl.value.split('|');
    const lbPerBu = parseFloat(grainParts[0]);
    const stdMoist = parseFloat(grainParts[1]);
    
    document.getElementById('round-dims').style.display = shape === 'round' ? 'block' : 'none';
    document.getElementById('rect-dims').style.display = shape === 'rect' ? 'block' : 'none';
    
    let vol = 0;
    const h = Math.max(0, parseFloat(document.getElementById('eaveH')?.value) || 0);
    
    if(shape === 'round') {
        const d = Math.max(0, parseFloat(document.getElementById('diameter')?.value) || 0);
        vol = Math.PI * Math.pow(d/2, 2) * h;
    } else {
        const l = Math.max(0, parseFloat(document.getElementById('length')?.value) || 0);
        const w = Math.max(0, parseFloat(document.getElementById('width')?.value) || 0);
        vol = l * w * h;
    }
    
    const bu = vol * BU_PER_CUFT;
    const moistIn = parseFloat(document.getElementById('moistIn')?.value) || stdMoist;
    const pack = parseFloat(document.getElementById('pack')?.value) || 0;
    const packedBu = bu * (1 + (pack/100));
    let shrinkPct = Math.max(0, (moistIn - stdMoist) * 1.3);
    const dryBu = packedBu * (1 - (shrinkPct/100));
    
    document.getElementById('rVol').textContent = Math.round(vol).toLocaleString() + ' ft³';
    document.getElementById('rTotal').textContent = Math.round(packedBu).toLocaleString();
    document.getElementById('rWeight').textContent = (packedBu * lbPerBu / 2000).toFixed(1) + ' T';
    document.getElementById('rShrink').textContent = shrinkPct.toFixed(1) + '%';
    document.getElementById('rDryBu').textContent = Math.round(dryBu).toLocaleString();
}

// Break-Even Calculator
function calcBreakEven() {
    const seed = parseFloat(document.getElementById('beSeed')?.value) || 0;
    const fert = parseFloat(document.getElementById('beFert')?.value) || 0;
    const chem = parseFloat(document.getElementById('beChem')?.value) || 0;
    const ins = parseFloat(document.getElementById('beIns')?.value) || 0;
    const mach = parseFloat(document.getElementById('beMach')?.value) || 0;
    const labor = parseFloat(document.getElementById('beLabor')?.value) || 0;
    const rent = parseFloat(document.getElementById('beRent')?.value) || 0;
    const dry = parseFloat(document.getElementById('beDry')?.value) || 0;
    const other = parseFloat(document.getElementById('beOther')?.value) || 0;
    const yld = parseFloat(document.getElementById('beYield')?.value) || 0;
    const price = parseFloat(document.getElementById('bePrice')?.value) || 0;
    
    // Skip if elements don't exist (not on Tools tab)
    if (!document.getElementById('beSeed')) return;
    
    const totalCost = seed + fert + chem + ins + mach + labor + rent + dry + other;
    const costPerBu = yld > 0 ? totalCost / yld : 0;
    const breakEven = costPerBu;
    const revenue = yld * price;
    const profit = revenue - totalCost;
    const profitPerBu = yld > 0 ? profit / yld : 0;
    const yieldNeeded = price > 0 ? totalCost / price : 0;
    
    document.getElementById('beTotalCost').textContent = '$' + totalCost.toFixed(0);
    document.getElementById('beCostBu').textContent = '$' + costPerBu.toFixed(2) + '/bu';
    document.getElementById('beBreakEven').textContent = '$' + breakEven.toFixed(2) + '/bu';
    document.getElementById('beRevenue').textContent = '$' + revenue.toFixed(0);
    
    const profitEl = document.getElementById('beProfit');
    profitEl.textContent = (profit >= 0 ? '+' : '') + '$' + profit.toFixed(0);
    profitEl.style.color = profit >= 0 ? 'var(--green)' : 'var(--red)';
    
    const profitBuEl = document.getElementById('beProfitBu');
    profitBuEl.textContent = (profitPerBu >= 0 ? '+' : '') + '$' + profitPerBu.toFixed(2) + '/bu';
    profitBuEl.style.color = profitPerBu >= 0 ? 'var(--green)' : 'var(--red)';
    
    document.getElementById('beYieldNeeded').textContent = yieldNeeded.toFixed(0) + ' bu/ac';
}

// GDU Calculator (Tools Tab)
function calcGDU() {
    const plantDateStr = document.getElementById('gduPlantDate')?.value;
    const maturity = parseInt(document.getElementById('gduMaturity')?.value) || 2550;
    const avgHigh = parseFloat(document.getElementById('gduHigh')?.value) || 82;
    const avgLow = parseFloat(document.getElementById('gduLow')?.value) || 58;
    
    // Skip if elements don't exist (not on Tools tab)
    if (!document.getElementById('gduPlantDate')) return;
    
    // Calculate daily GDU with 86/50 method
    const cappedHigh = Math.min(avgHigh, 86);
    const cappedLow = Math.max(avgLow, 50);
    const dailyGdu = Math.max(0, ((cappedHigh + cappedLow) / 2) - 50);
    
    document.getElementById('gduDaily').textContent = dailyGdu.toFixed(1) + ' GDU/day';
    
    if (!plantDateStr) {
        document.getElementById('gduDays').textContent = '-';
        document.getElementById('gduAccum').textContent = '-';
        document.getElementById('gduRemain').textContent = '-';
        document.getElementById('gduProgress').textContent = '-';
        document.getElementById('gduBlackLayer').textContent = '-';
        document.getElementById('gduStages').innerHTML = '<div style="color:var(--dim)">Enter planting date to see growth stages</div>';
        return;
    }
    
    const plantDate = new Date(plantDateStr);
    const today = new Date();
    const daysSincePlanting = Math.max(0, Math.floor((today - plantDate) / (1000 * 60 * 60 * 24)));
    const accumulatedGdu = daysSincePlanting * dailyGdu;
    const remaining = Math.max(0, maturity - accumulatedGdu);
    const progress = Math.min(100, (accumulatedGdu / maturity) * 100);
    
    // Calculate black layer date
    const daysToMaturity = Math.ceil(maturity / dailyGdu);
    const blackLayerDate = new Date(plantDate);
    blackLayerDate.setDate(blackLayerDate.getDate() + daysToMaturity);
    
    document.getElementById('gduDays').textContent = daysSincePlanting + ' days';
    document.getElementById('gduAccum').textContent = Math.round(accumulatedGdu).toLocaleString();
    document.getElementById('gduRemain').textContent = Math.round(remaining).toLocaleString() + ' GDU';
    document.getElementById('gduProgress').textContent = progress.toFixed(0) + '%';
    document.getElementById('gduBlackLayer').textContent = blackLayerDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    
    // Growth stages
    const stages = [
        { name: '🌱 Emergence (VE)', gdu: 120 },
        { name: '🌿 V6 (Knee High)', gdu: 475 },
        { name: '🌾 V12 (Tassel Visible)', gdu: 870 },
        { name: '🌽 VT/R1 (Silking)', gdu: 1350 },
        { name: '🧈 R3 (Milk)', gdu: 1660 },
        { name: '🫛 R4 (Dough)', gdu: 1925 },
        { name: '🟡 R5 (Dent)', gdu: 2190 },
        { name: '⬛ R6 (Black Layer)', gdu: maturity }
    ];
    
    let stagesHtml = '';
    stages.forEach(stage => {
        const daysToStage = Math.ceil(stage.gdu / dailyGdu);
        const stageDate = new Date(plantDate);
        stageDate.setDate(stageDate.getDate() + daysToStage);
        
        let status, statusClass;
        if (accumulatedGdu >= stage.gdu) {
            status = '✓ Reached';
            statusClass = 'color:var(--green)';
        } else {
            status = stageDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            statusClass = 'color:var(--accent)';
        }
        
        stagesHtml += `
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:0.85rem">
            <span>${stage.name}</span>
            <span style="font-family:'JetBrains Mono',monospace;${statusClass}">${status}</span>
        </div>`;
    });
    
    document.getElementById('gduStages').innerHTML = stagesHtml;
}

// Initialize GDU planting date to May 1 of current year
function initGduDate() {
    const gduDateEl = document.getElementById('gduPlantDate');
    if (gduDateEl && !gduDateEl.value) {
        const currentYear = new Date().getFullYear();
        gduDateEl.value = `${currentYear}-05-01`;
        calcGDU();
    }
}

// USDA Economic Calendar 2026
const USDA_CALENDAR = [
    { date: '2026-01-12', report: 'WASDE', desc: 'World Supply & Demand Estimates' },
    { date: '2026-01-12', report: 'Crop Production', desc: 'Annual Summary' },
    { date: '2026-01-12', report: 'Grain Stocks', desc: 'Quarterly Stocks Report' },
    { date: '2026-02-11', report: 'WASDE', desc: 'World Supply & Demand Estimates' },
    { date: '2026-03-11', report: 'WASDE', desc: 'World Supply & Demand Estimates' },
    { date: '2026-03-31', report: 'Prospective Plantings', desc: 'Planting Intentions - MAJOR' },
    { date: '2026-03-31', report: 'Grain Stocks', desc: 'Quarterly Stocks Report' },
    { date: '2026-04-09', report: 'WASDE', desc: 'World Supply & Demand Estimates' },
    { date: '2026-05-12', report: 'WASDE', desc: 'World Supply & Demand Estimates' },
    { date: '2026-06-11', report: 'WASDE', desc: 'World Supply & Demand Estimates' },
    { date: '2026-06-30', report: 'Acreage', desc: 'Planted Acreage Report - MAJOR' },
    { date: '2026-06-30', report: 'Grain Stocks', desc: 'Quarterly Stocks Report' },
    { date: '2026-07-10', report: 'WASDE', desc: 'World Supply & Demand Estimates' },
    { date: '2026-08-12', report: 'WASDE', desc: 'World Supply & Demand Estimates' },
    { date: '2026-08-12', report: 'Crop Production', desc: 'First yield estimates - MAJOR' },
    { date: '2026-09-11', report: 'WASDE', desc: 'World Supply & Demand Estimates' },
    { date: '2026-09-11', report: 'Crop Production', desc: 'Monthly Production' },
    { date: '2026-09-30', report: 'Grain Stocks', desc: 'Quarterly Stocks Report' },
    { date: '2026-10-09', report: 'WASDE', desc: 'World Supply & Demand Estimates' },
    { date: '2026-10-09', report: 'Crop Production', desc: 'Monthly Production' },
    { date: '2026-11-10', report: 'WASDE', desc: 'World Supply & Demand Estimates' },
    { date: '2026-11-10', report: 'Crop Production', desc: 'Monthly Production' },
    { date: '2026-12-10', report: 'WASDE', desc: 'World Supply & Demand Estimates' },
    { date: '2026-12-10', report: 'Crop Production', desc: 'Monthly Production' }
];

function renderUsdaCalendar() {
    const sidebarEl = document.getElementById('usda-calendar');
    const fullEl = document.getElementById('full-usda-calendar');
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Get upcoming reports for sidebar (next 5)
    const upcoming = USDA_CALENDAR
        .filter(r => new Date(r.date) >= today)
        .slice(0, 5);
    
    if (sidebarEl) {
        if (upcoming.length === 0) {
            sidebarEl.innerHTML = '<div style="padding:16px;color:var(--dim);text-align:center">No upcoming reports</div>';
        } else {
            sidebarEl.innerHTML = upcoming.map(r => {
                const date = new Date(r.date);
                const daysUntil = Math.ceil((date - today) / (1000 * 60 * 60 * 24));
                const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                const isMajor = r.desc.includes('MAJOR');
                
                let urgency = '';
                if (daysUntil <= 3) urgency = 'color:var(--red);font-weight:700';
                else if (daysUntil <= 7) urgency = 'color:var(--accent)';
                
                return `
                <div class="calendar-item" style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
                    <div>
                        <div style="font-weight:600;color:var(--text);font-size:0.9rem">${r.report}${isMajor ? ' 🔥' : ''}</div>
                        <div style="font-size:0.75rem;color:var(--dim)">${r.desc.replace(' - MAJOR', '')}</div>
                    </div>
                    <div style="text-align:right">
                        <div style="font-family:'JetBrains Mono',monospace;font-size:0.85rem;${urgency}">${dateStr}</div>
                        <div style="font-size:0.7rem;color:var(--dim)">${daysUntil === 0 ? 'TODAY' : daysUntil === 1 ? 'Tomorrow' : daysUntil + ' days'}</div>
                    </div>
                </div>`;
            }).join('');
        }
    }
    
    // Full calendar view (grouped by month)
    if (fullEl) {
        const byMonth = {};
        USDA_CALENDAR.forEach(r => {
            const date = new Date(r.date);
            const monthKey = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
            if (!byMonth[monthKey]) byMonth[monthKey] = [];
            byMonth[monthKey].push(r);
        });
        
        let html = '';
        Object.entries(byMonth).forEach(([month, reports]) => {
            html += `
            <div style="margin-bottom:24px">
                <h3 style="color:var(--accent);font-size:1rem;margin-bottom:12px;font-family:'JetBrains Mono',monospace">${month.toUpperCase()}</h3>
                <div style="background:var(--card);border-radius:4px;overflow:hidden">
            `;
            
            reports.forEach(r => {
                const date = new Date(r.date);
                const isPast = date < today;
                const dateStr = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                const isMajor = r.desc.includes('MAJOR');
                
                html += `
                <div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;${isPast ? 'opacity:0.5' : ''}">
                    <div>
                        <div style="font-weight:600;color:var(--text)">${r.report}${isMajor ? ' <span style="color:var(--accent)">★ MARKET MOVER</span>' : ''}</div>
                        <div style="font-size:0.8rem;color:var(--dim)">${r.desc.replace(' - MAJOR', '')}</div>
                    </div>
                    <div style="font-family:'JetBrains Mono',monospace;font-size:0.85rem;color:${isPast ? 'var(--dim)' : 'var(--text)'}">${dateStr}</div>
                </div>`;
            });
            
            html += '</div></div>';
        });
        
        fullEl.innerHTML = html;
    }
}

// Crop Insurance Deadlines by State (2026)
const INSURANCE_DEADLINES = {
    WI: [
        { date: '2026-02-28', crop: 'Corn & Soybeans', type: 'Price Discovery Ends', desc: 'RP projected price established' },
        { date: '2026-03-15', crop: 'Corn & Soybeans', type: 'Sales Closing', desc: 'Last day to purchase or change coverage' },
        { date: '2026-06-30', crop: 'Corn & Soybeans', type: 'Acreage Report', desc: 'Report planted acres to FSA' },
        { date: '2026-07-15', crop: 'Corn & Soybeans', type: 'Premium Billing', desc: 'Premium bills issued' },
        { date: '2026-10-31', crop: 'Corn & Soybeans', type: 'Harvest Price Ends', desc: 'RP harvest price established' },
        { date: '2026-11-15', crop: 'Corn & Soybeans', type: 'Production Report', desc: 'Report production to agent' },
        { date: '2026-09-30', crop: 'Winter Wheat', type: 'Sales Closing', desc: 'For 2027 crop year' }
    ],
    MN: [
        { date: '2026-02-28', crop: 'Corn & Soybeans', type: 'Price Discovery Ends', desc: 'RP projected price established' },
        { date: '2026-03-15', crop: 'Corn & Soybeans', type: 'Sales Closing', desc: 'Last day to purchase or change coverage' },
        { date: '2026-06-30', crop: 'Corn & Soybeans', type: 'Acreage Report', desc: 'Report planted acres to FSA' },
        { date: '2026-07-15', crop: 'Corn & Soybeans', type: 'Premium Billing', desc: 'Premium bills issued' },
        { date: '2026-10-31', crop: 'Corn & Soybeans', type: 'Harvest Price Ends', desc: 'RP harvest price established' },
        { date: '2026-11-15', crop: 'Corn & Soybeans', type: 'Production Report', desc: 'Report production to agent' },
        { date: '2026-09-30', crop: 'Spring Wheat', type: 'Sales Closing', desc: 'For 2027 crop year' }
    ],
    IA: [
        { date: '2026-02-28', crop: 'Corn & Soybeans', type: 'Price Discovery Ends', desc: 'RP projected price established' },
        { date: '2026-03-15', crop: 'Corn & Soybeans', type: 'Sales Closing', desc: 'Last day to purchase or change coverage' },
        { date: '2026-06-30', crop: 'Corn & Soybeans', type: 'Acreage Report', desc: 'Report planted acres to FSA' },
        { date: '2026-07-15', crop: 'Corn & Soybeans', type: 'Premium Billing', desc: 'Premium bills issued' },
        { date: '2026-10-31', crop: 'Corn & Soybeans', type: 'Harvest Price Ends', desc: 'RP harvest price established' },
        { date: '2026-11-15', crop: 'Corn & Soybeans', type: 'Production Report', desc: 'Report production to agent' }
    ],
    IL: [
        { date: '2026-02-28', crop: 'Corn & Soybeans', type: 'Price Discovery Ends', desc: 'RP projected price established' },
        { date: '2026-03-15', crop: 'Corn & Soybeans', type: 'Sales Closing', desc: 'Last day to purchase or change coverage' },
        { date: '2026-06-30', crop: 'Corn & Soybeans', type: 'Acreage Report', desc: 'Report planted acres to FSA' },
        { date: '2026-07-15', crop: 'Corn & Soybeans', type: 'Premium Billing', desc: 'Premium bills issued' },
        { date: '2026-10-31', crop: 'Corn & Soybeans', type: 'Harvest Price Ends', desc: 'RP harvest price established' },
        { date: '2026-11-15', crop: 'Corn & Soybeans', type: 'Production Report', desc: 'Report production to agent' },
        { date: '2026-09-30', crop: 'Winter Wheat', type: 'Sales Closing', desc: 'For 2027 crop year' }
    ],
    ND: [
        { date: '2026-02-28', crop: 'Corn & Soybeans', type: 'Price Discovery Ends', desc: 'RP projected price established' },
        { date: '2026-03-15', crop: 'Corn, Soybeans, Sunflowers', type: 'Sales Closing', desc: 'Last day to purchase or change coverage' },
        { date: '2026-03-15', crop: 'Spring Wheat, Barley, Oats', type: 'Sales Closing', desc: 'Last day to purchase or change coverage' },
        { date: '2026-06-30', crop: 'All Crops', type: 'Acreage Report', desc: 'Report planted acres to FSA' },
        { date: '2026-07-15', crop: 'All Crops', type: 'Premium Billing', desc: 'Premium bills issued' },
        { date: '2026-10-31', crop: 'Corn & Soybeans', type: 'Harvest Price Ends', desc: 'RP harvest price established' },
        { date: '2026-11-15', crop: 'All Crops', type: 'Production Report', desc: 'Report production to agent' }
    ],
    SD: [
        { date: '2026-02-28', crop: 'Corn & Soybeans', type: 'Price Discovery Ends', desc: 'RP projected price established' },
        { date: '2026-03-15', crop: 'Corn, Soybeans, Sunflowers', type: 'Sales Closing', desc: 'Last day to purchase or change coverage' },
        { date: '2026-03-15', crop: 'Spring Wheat, Barley, Oats', type: 'Sales Closing', desc: 'Last day to purchase or change coverage' },
        { date: '2026-06-30', crop: 'All Crops', type: 'Acreage Report', desc: 'Report planted acres to FSA' },
        { date: '2026-07-15', crop: 'All Crops', type: 'Premium Billing', desc: 'Premium bills issued' },
        { date: '2026-10-31', crop: 'Corn & Soybeans', type: 'Harvest Price Ends', desc: 'RP harvest price established' },
        { date: '2026-11-15', crop: 'All Crops', type: 'Production Report', desc: 'Report production to agent' }
    ]
};

function loadInsuranceDeadlines() {
    const state = document.getElementById('insuranceState')?.value || 'WI';
    const fullEl = document.getElementById('insurance-deadlines');
    
    const deadlines = INSURANCE_DEADLINES[state] || INSURANCE_DEADLINES['WI'];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (fullEl) {
        fullEl.innerHTML = deadlines.map(d => {
            const date = new Date(d.date);
            const isPast = date < today;
            const daysUntil = Math.ceil((date - today) / (1000 * 60 * 60 * 24));
            const dateStr = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
            
            let urgencyStyle = '';
            let badge = '';
            if (!isPast && daysUntil <= 7) {
                urgencyStyle = 'border-left:3px solid var(--red);';
                badge = '<span style="background:var(--red);color:#fff;padding:2px 6px;border-radius:2px;font-size:0.65rem;margin-left:8px">URGENT</span>';
            } else if (!isPast && daysUntil <= 30) {
                urgencyStyle = 'border-left:3px solid var(--accent);';
                badge = '<span style="background:var(--accent);color:#000;padding:2px 6px;border-radius:2px;font-size:0.65rem;margin-left:8px">SOON</span>';
            }
            
            return `
            <div style="padding:16px;border-bottom:1px solid var(--border);background:var(--card);${urgencyStyle}${isPast ? 'opacity:0.5;' : ''}">
                <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
                    <div>
                        <span style="font-weight:700;color:var(--text)">${d.type}</span>${badge}
                        <div style="font-size:0.85rem;color:var(--accent);margin-top:2px">${d.crop}</div>
                    </div>
                    <div style="text-align:right">
                        <div style="font-family:'JetBrains Mono',monospace;font-size:0.9rem;color:${isPast ? 'var(--dim)' : 'var(--text)'}">${dateStr}</div>
                        ${!isPast ? `<div style="font-size:0.7rem;color:var(--dim)">${daysUntil === 0 ? 'TODAY' : daysUntil + ' days'}</div>` : '<div style="font-size:0.7rem;color:var(--dim)">Passed</div>'}
                    </div>
                </div>
                <div style="font-size:0.8rem;color:var(--dim)">${d.desc}</div>
            </div>`;
        }).join('');
    }
}

function renderSidebarDeadlines() {
    const sidebarEl = document.getElementById('sidebar-deadlines');
    if (!sidebarEl) return;
    
    // Use WI/MN combined for sidebar (user's region)
    const deadlines = [...INSURANCE_DEADLINES['WI']];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const upcoming = deadlines
        .filter(d => new Date(d.date) >= today)
        .sort((a, b) => new Date(a.date) - new Date(b.date))
        .slice(0, 4);
    
    if (upcoming.length === 0) {
        sidebarEl.innerHTML = '<div style="padding:16px;color:var(--dim);text-align:center">No upcoming deadlines</div>';
        return;
    }
    
    sidebarEl.innerHTML = upcoming.map(d => {
        const date = new Date(d.date);
        const daysUntil = Math.ceil((date - today) / (1000 * 60 * 60 * 24));
        const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        
        let urgency = '';
        if (daysUntil <= 7) urgency = 'color:var(--red);font-weight:700';
        else if (daysUntil <= 30) urgency = 'color:var(--accent)';
        
        return `
        <div class="deadline-item" style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
            <div>
                <div style="font-weight:600;color:var(--text);font-size:0.85rem">${d.type}</div>
                <div style="font-size:0.7rem;color:var(--dim)">${d.crop}</div>
            </div>
            <div style="text-align:right">
                <div style="font-family:'JetBrains Mono',monospace;font-size:0.8rem;${urgency}">${dateStr}</div>
                <div style="font-size:0.65rem;color:var(--dim)">${daysUntil === 0 ? 'TODAY' : daysUntil + 'd'}</div>
            </div>
        </div>`;
    }).join('');
}

// USDA Office Finder
const COUNTIES = {
    WI: ['Barron','Burnett','Chippewa','Clark','Dunn','Eau Claire','Polk','Rusk','St. Croix','Trempealeau','Washburn'],
    MN: ['Anoka','Chisago','Dakota','Hennepin','Isanti','Ramsey','Washington','Winona'],
    IA: ['Boone','Dallas','Jasper','Madison','Marion','Marshall','Polk','Story','Warren'],
    IL: ['Champaign','Cook','DeKalb','DuPage','Kane','Lake','McHenry','Will','Winnebago'],
    IN: ['Allen','Elkhart','Hamilton','Lake','Marion','St. Joseph'],
    MI: ['Allegan','Barry','Branch','Calhoun','Clinton','Eaton','Hillsdale','Huron','Ingham','Ionia'],
    ND: ['Burleigh','Cass','Grand Forks','Ward','Williams'],
    SD: ['Brown','Lincoln','Minnehaha','Pennington'],
    NE: ['Douglas','Lancaster','Sarpy'],
    KS: ['Johnson','Sedgwick','Shawnee'],
    MO: ['Boone','Greene','Jackson','St. Louis'],
    OH: ['Cuyahoga','Franklin','Hamilton','Lucas','Summit']
};

function loadCounties() {
    const s = document.getElementById('state')?.value;
    const c = document.getElementById('county');
    if(!c) return;
    c.innerHTML = (COUNTIES[s] || []).map(n => `<option>${n}</option>`).join('');
}

function findOffice() {
    const state = document.getElementById('state')?.value;
    const county = document.getElementById('county')?.value;
    
    if(!state) {
        alert('Please select a state');
        return;
    }
    
    const url = `https://offices.sc.egov.usda.gov/locator/app?state=${state}&county=${encodeURIComponent(county)}`;
    
    document.getElementById('fsa-link').href = url;
    document.getElementById('nrcs-link').href = url;
    document.getElementById('office-results').style.display = 'grid';
}

// Keyboard Shortcuts
document.addEventListener('keydown', (e) => {
    // Don't trigger if user is typing in an input
    if(e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    
    // Don't trigger with modifier keys (Ctrl, Alt, Cmd)
    if(e.ctrlKey || e.altKey || e.metaKey) return;
    
    switch(e.key) {
        case '1': switchTab('dashboard'); break;
        case '2': switchTab('tools'); break;
        case '3': switchTab('calendar'); break;
        case '4': switchTab('resources'); break;
        case '?': 
            alert('Keyboard Shortcuts:\n\n1 - Dashboard\n2 - Tools\n3 - Calendar\n4 - Resources\n? - Show this help');
            break;
    }
});
