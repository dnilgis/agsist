// AGSIST App - Part 1: Core Functions

document.addEventListener('DOMContentLoaded', () => {
    try {
        loadData();
        initWeather();
        calcBin();
        setInterval(loadData, 60000);
    } catch(e) {
        console.error("Init failed:", e);
        document.getElementById('update-time').innerText = "System Error";
    }
});

// Navigation
function switchTab(id) {
    window.scrollTo({top:0, behavior:'smooth'});
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.nav a').forEach(a => a.classList.remove('active'));
    document.getElementById(id)?.classList.add('active');
    document.querySelector(`.nav a[data-tab="${id}"]`)?.classList.add('active');
}

document.querySelectorAll('[data-tab]').forEach(el => {
    el.addEventListener('click', e => {
        e.preventDefault();
        switchTab(el.dataset.tab);
    });
});

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
        const m = data.markets;
        
        document.getElementById('update-time').textContent = new Date(data.updated).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});

        renderGrid('grains-grid', [m.grains?.corn, m.grains?.soybeans, m.grains?.wheat]);
        renderGrid('livestock-grid', [m.livestock?.cattle, m.livestock?.feeder, m.livestock?.milk]);
        renderGrid('metals-grid', [m.indices?.sp500, m.indices?.dow, m.metals?.gold, m.metals?.silver]);
        renderGrid('crypto-grid', [m.crypto?.bitcoin, m.crypto?.ethereum, m.crypto?.kaspa, m.crypto?.xrp]);

        renderNews(data.news || []);
        updateTicker(m, data.news || []);
    } catch (e) { 
        console.error(e); 
        document.getElementById('update-time').innerHTML = '<span style="color:var(--red)">Offline</span> <button onclick="loadData()" style="margin-left:8px;background:transparent;border:1px solid var(--border);color:var(--text);padding:2px 8px;border-radius:3px;cursor:pointer;font-size:0.7rem;">↻</button>';
    }
}
// AGSIST App - Part 2: Render Functions

function renderGrid(id, items) {
    const el = document.getElementById(id);
    if(!el) return;
    
    el.innerHTML = items.filter(Boolean).map(item => {
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

function renderNews(news) {
    const el = document.getElementById('news-wire-list');
    if(!news.length) {
        el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--dim)">No news available.</div>';
        return;
    }
    el.innerHTML = news.map(n => {
        const src = n.source.toLowerCase();
        const tagClass = src.includes('usda') ? 'usda' : src.includes('farm') ? 'farmprogress' : 'agweb';
        return `<a href="${n.link}" target="_blank" class="news-item">
            <span class="tag ${tagClass}">${n.source}</span>
            <h4>${n.title}</h4>
        </a>`;
    }).join('');
}

function updateTicker(m, news) {
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

    let html = '';
    const max = Math.max(items.length, news.length);
    for(let i=0; i<max; i++) {
        if(items[i % items.length]) html += items[i % items.length];
        if(news[i]) html += `<a href="${news[i].link}" target="_blank" class="ticker-item ticker-news"><span class="source">${news[i].source}</span> ${news[i].title}</a>`;
    }
    document.getElementById('news-ticker').innerHTML = html + html;
}
// AGSIST App - Part 3: Weather Functions

const DEFAULT_LAT = 41.58; 
const DEFAULT_LON = -93.62;

function initWeather(forceLocate = false) {
    const locName = document.getElementById('location-name');
    
    if (forceLocate || (navigator.geolocation && !sessionStorage.getItem('geoDenied'))) {
        if(forceLocate) locName.innerText = "DETECTING...";
        
        const t = setTimeout(() => {
            console.log("Geo timeout");
            loadWeather(DEFAULT_LAT, DEFAULT_LON, "CENTRAL US (DEFAULT)");
        }, 10000);

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                clearTimeout(t);
                loadWeather(pos.coords.latitude, pos.coords.longitude, "NEARBY");
            },
            (err) => {
                clearTimeout(t);
                console.warn("Geo denied", err);
                sessionStorage.setItem('geoDenied', 'true');
                loadWeather(DEFAULT_LAT, DEFAULT_LON, "CENTRAL US (DEFAULT)");
            }
        );
    } else {
        loadWeather(DEFAULT_LAT, DEFAULT_LON, "CENTRAL US (DEFAULT)");
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
// AGSIST App - Part 4: Calculator and Office Finder

const BU_PER_CUFT = 0.8036;

function calcBin() {
    const shape = document.getElementById('binShape').value;
    const grainParts = document.getElementById('grain').value.split('|');
    const lbPerBu = parseFloat(grainParts[0]);
    const stdMoist = parseFloat(grainParts[1]);
    
    document.getElementById('round-dims').style.display = shape === 'round' ? 'block' : 'none';
    document.getElementById('rect-dims').style.display = shape === 'rect' ? 'block' : 'none';
    
    let vol = 0;
    const h = Math.max(0, parseFloat(document.getElementById('eaveH').value) || 0);
    
    if(shape === 'round') {
        const d = Math.max(0, parseFloat(document.getElementById('diameter').value) || 0);
        vol = Math.PI * Math.pow(d/2, 2) * h;
    } else {
        const l = Math.max(0, parseFloat(document.getElementById('length').value) || 0);
        const w = Math.max(0, parseFloat(document.getElementById('width').value) || 0);
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
    const s = document.getElementById('state').value;
    const c = document.getElementById('county');
    c.innerHTML = (COUNTIES[s] || []).map(n => `<option>${n}</option>`).join('');
}

function findOffice() {
    const state = document.getElementById('state').value;
    const county = document.getElementById('county').value;
    
    if(!state) {
        alert('Please select a state');
        return;
    }
    
    const url = `https://offices.sc.egov.usda.gov/locator/app?state=${state}&county=${encodeURIComponent(county)}`;
    
    document.getElementById('fsa-link').href = url;
    document.getElementById('nrcs-link').href = url;
    document.getElementById('office-results').style.display = 'grid';
}
