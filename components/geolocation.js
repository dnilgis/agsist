/**
 * AGSIST Geolocation Module
 * Detects user's state and persists it across all AGSIST pages
 * Include: <script src="/components/geolocation.js"></script>
 */

const AGSIST_GEO = {
    // All US states with FIPS codes
    states: {
        'AL': { name: 'Alabama', fips: '01' },
        'AK': { name: 'Alaska', fips: '02' },
        'AZ': { name: 'Arizona', fips: '04' },
        'AR': { name: 'Arkansas', fips: '05' },
        'CA': { name: 'California', fips: '06' },
        'CO': { name: 'Colorado', fips: '08' },
        'CT': { name: 'Connecticut', fips: '09' },
        'DE': { name: 'Delaware', fips: '10' },
        'FL': { name: 'Florida', fips: '12' },
        'GA': { name: 'Georgia', fips: '13' },
        'HI': { name: 'Hawaii', fips: '15' },
        'ID': { name: 'Idaho', fips: '16' },
        'IL': { name: 'Illinois', fips: '17' },
        'IN': { name: 'Indiana', fips: '18' },
        'IA': { name: 'Iowa', fips: '19' },
        'KS': { name: 'Kansas', fips: '20' },
        'KY': { name: 'Kentucky', fips: '21' },
        'LA': { name: 'Louisiana', fips: '22' },
        'ME': { name: 'Maine', fips: '23' },
        'MD': { name: 'Maryland', fips: '24' },
        'MA': { name: 'Massachusetts', fips: '25' },
        'MI': { name: 'Michigan', fips: '26' },
        'MN': { name: 'Minnesota', fips: '27' },
        'MS': { name: 'Mississippi', fips: '28' },
        'MO': { name: 'Missouri', fips: '29' },
        'MT': { name: 'Montana', fips: '30' },
        'NE': { name: 'Nebraska', fips: '31' },
        'NV': { name: 'Nevada', fips: '32' },
        'NH': { name: 'New Hampshire', fips: '33' },
        'NJ': { name: 'New Jersey', fips: '34' },
        'NM': { name: 'New Mexico', fips: '35' },
        'NY': { name: 'New York', fips: '36' },
        'NC': { name: 'North Carolina', fips: '37' },
        'ND': { name: 'North Dakota', fips: '38' },
        'OH': { name: 'Ohio', fips: '39' },
        'OK': { name: 'Oklahoma', fips: '40' },
        'OR': { name: 'Oregon', fips: '41' },
        'PA': { name: 'Pennsylvania', fips: '42' },
        'RI': { name: 'Rhode Island', fips: '44' },
        'SC': { name: 'South Carolina', fips: '45' },
        'SD': { name: 'South Dakota', fips: '46' },
        'TN': { name: 'Tennessee', fips: '47' },
        'TX': { name: 'Texas', fips: '48' },
        'UT': { name: 'Utah', fips: '49' },
        'VT': { name: 'Vermont', fips: '50' },
        'VA': { name: 'Virginia', fips: '51' },
        'WA': { name: 'Washington', fips: '53' },
        'WV': { name: 'West Virginia', fips: '54' },
        'WI': { name: 'Wisconsin', fips: '55' },
        'WY': { name: 'Wyoming', fips: '56' }
    },

    nameToAbbr: {},

    init: function() {
        for (const [abbr, data] of Object.entries(this.states)) {
            this.nameToAbbr[data.name] = abbr;
            this.nameToAbbr[data.name.toLowerCase()] = abbr;
        }
    },

    getState: function() {
        const stored = localStorage.getItem('agsist_state');
        return (stored && this.states[stored]) ? stored : 'WI';
    },

    setState: function(abbr) {
        if (this.states[abbr]) {
            localStorage.setItem('agsist_state', abbr);
            window.dispatchEvent(new CustomEvent('agsist-state-change', { detail: abbr }));
            return true;
        }
        return false;
    },

    getStateName: function(abbr) {
        abbr = abbr || this.getState();
        return this.states[abbr]?.name || 'Wisconsin';
    },

    // Browser geolocation detection
    detectLocation: function(onSuccess, onError) {
        if (!navigator.geolocation) {
            if (onError) onError('Geolocation not supported');
            return;
        }

        navigator.geolocation.getCurrentPosition(
            async (pos) => {
                try {
                    const resp = await fetch(
                        `https://nominatim.openstreetmap.org/reverse?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&format=json`,
                        { headers: { 'User-Agent': 'AGSIST/1.0' } }
                    );
                    const data = await resp.json();
                    const stateName = data.address?.state;

                    if (stateName) {
                        const abbr = this.nameToAbbr[stateName] || this.nameToAbbr[stateName.toLowerCase()];
                        if (abbr) {
                            this.setState(abbr);
                            if (onSuccess) onSuccess(abbr, this.states[abbr].name);
                            return;
                        }
                    }
                    if (onError) onError('Could not determine state');
                } catch (err) {
                    if (onError) onError('Geocoding failed');
                }
            },
            () => { if (onError) onError('Location access denied'); },
            { timeout: 10000 }
        );
    },

    // Build USDA Quick Stats URL
    buildQuickStatsUrl: function(params) {
        const base = 'https://quickstats.nass.usda.gov/results/';
        const qs = new URLSearchParams();
        for (const [k, v] of Object.entries(params)) {
            if (v) qs.append(k, v);
        }
        return base + '?' + qs.toString();
    }
};

AGSIST_GEO.init();
