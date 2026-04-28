/**
 * GVBC Reunion — Intelligence & Processing Library (intel.js)
 * Ported from Python to Client-Side JavaScript
 */

const Intel = {
    // ─── STOP WORDS (from app.py) ───────────────────────
    STOP_WORDS: new Set([
        "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
        "of", "with", "by", "from", "is", "it", "as", "was", "are", "be",
        "has", "had", "have", "will", "been", "not", "no", "do", "does",
        "did", "this", "that", "its", "his", "her", "he", "she", "they",
        "we", "you", "your", "their", "our", "my", "me", "him", "them",
        "us", "if", "so", "up", "out", "all", "about", "than", "into",
        "over", "after", "new", "more", "also", "how", "what", "when",
        "who", "which", "where", "why", "can", "could", "would", "should",
        "may", "just", "very", "most", "being", "get", "got", "set",
        "say", "says", "said", "like", "make", "go", "going", "back",
        "still", "even", "well", "way", "take", "come", "some", "many",
        "much", "own", "other", "now", "then", "here", "there", "only",
        "any", "each", "every", "both", "few", "s", "t", "don", "isn",
        "aren", "won", "didn", "doesn", "re", "ve", "ll", "amp", "quot",
        "one", "two", "first", "last", "next", "per", "off", "against",
        "between", "through", "during", "before", "under", "around", "among",
        "while", "since", "until", "such", "those", "these", "down",
        "too", "another", "because", "think", "see", "look", "people",
        "know", "time", "year", "day", "week", "month", "world", "news",
        // Vietnamese Stopwords
        "và", "của", "là", "trong", "có", "cho", "đã", "những", "được", "với",
        "không", "một", "người", "từ", "tại", "này", "khi", "vào", "đến", "các",
        "như", "năm", "sẽ", "để", "ra", "việc", "về", "nhưng", "lại", "thấy",
        "cũng", "đang", "còn", "chỉ", "nhiều", "hơn", "hoặc", "theo", "nào",
        "ngày", "sau", "mới", "lên", "phải", "làm", "đó", "hệ", "trên", "qua",
        "lúc", "đi", "bị", "bởi", "thì", "hai", "rất", "cùng", "rằng", "nay"
    ]),

    // ─── Text Processing ───────────────────────────────
    extractText(html) {
        if (!html) return "";
        const tmp = document.createElement("div");
        tmp.innerHTML = html;
        return tmp.textContent || tmp.innerText || "";
    },

    tokenize(text) {
        if (!text) return [];
        // Matches letters (including Vietnamese accented characters) >= 3 chars
        const tokens = text.toLowerCase().match(/[a-zA-Z\u00C0-\u1EF9]{3,}/g) || [];
        return tokens.filter(t => !this.STOP_WORDS.has(t));
    },

    getTrending(articles) {
        const wordFreq = {};
        const bigramFreq = {};
        let total = articles.length;

        articles.forEach(art => {
            const titleTokens = this.tokenize(art.title || "");
            const summaryTokens = this.tokenize(this.extractText(art.summary || ""));
            
            // Weight titles 3x
            const allTokens = [...titleTokens, ...titleTokens, ...titleTokens, ...summaryTokens];
            
            allTokens.forEach(t => {
                wordFreq[t] = (wordFreq[t] || 0) + 1;
            });

            // Bigrams from title
            for (let i = 0; i < titleTokens.length - 1; i++) {
                const bigram = `${titleTokens[i]} ${titleTokens[i+1]}`;
                bigramFreq[bigram] = (bigramFreq[bigram] || 0) + 1;
            }
        });

        const keywords = Object.entries(wordFreq)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20)
            .map(([word, count]) => ({ word, count }));

        const phrases = Object.entries(bigramFreq)
            .filter(([_, count]) => count >= 2)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([phrase, count]) => ({ phrase, count }));

        return { total_articles: total, keywords, phrases };
    },

    // ─── Financial Technical Indicators ────────────────
    sma(data, window) {
        if (data.length < window) return new Array(data.length).fill(null);
        const result = [];
        for (let i = 0; i < data.length; i++) {
            if (i < window - 1) {
                result.push(null);
            } else {
                const slice = data.slice(i - window + 1, i + 1);
                const sum = slice.reduce((a, b) => a + b, 0);
                result.push(sum / window);
            }
        }
        return result;
    },

    ema(data, span) {
        const result = [];
        const multiplier = 2 / (span + 1);
        let currentEma = data[0];
        result.push(currentEma);

        for (let i = 1; i < data.length; i++) {
            currentEma = (data[i] - currentEma) * multiplier + currentEma;
            result.push(currentEma);
        }
        return result;
    },

    rsi(data, period = 14) {
        const result = new Array(data.length).fill(50);
        if (data.length < period + 1) return result;

        const changes = [];
        for (let i = 1; i < data.length; i++) {
            changes.push(data[i] - data[i - 1]);
        }

        let gains = 0;
        let losses = 0;

        for (let i = 0; i < period; i++) {
            if (changes[i] > 0) gains += changes[i];
            else losses -= changes[i];
        }

        let avgGain = gains / period;
        let avgLoss = losses / period;

        for (let i = period; i < data.length; i++) {
            if (i > period) {
                const change = changes[i - 1];
                const gain = change > 0 ? change : 0;
                const loss = change < 0 ? -change : 0;
                avgGain = (avgGain * (period - 1) + gain) / period;
                avgLoss = (avgLoss * (period - 1) + loss) / period;
            }

            if (avgLoss === 0) {
                result[i] = 100;
            } else {
                const rs = avgGain / avgLoss;
                result[i] = 100 - (100 / (1 + rs));
            }
        }
        return result;
    },

    macd(data, fast = 12, slow = 26, signal = 9) {
        const emaFast = this.ema(data, fast);
        const emaSlow = this.ema(data, slow);
        const macdLine = emaFast.map((f, i) => (f !== null && emaSlow[i] !== null) ? f - emaSlow[i] : null);
        
        // Remove nulls for signal calculation
        const validMacd = macdLine.filter(m => m !== null);
        const validSignalLine = this.ema(validMacd, signal);
        
        // Re-align signal line with nulls
        const signalLine = new Array(macdLine.length).fill(null);
        let signalIdx = 0;
        for (let i = 0; i < macdLine.length; i++) {
            if (macdLine[i] !== null) {
                signalLine[i] = validSignalLine[signalIdx++];
            }
        }
        
        const histogram = macdLine.map((m, i) => (m !== null && signalLine[i] !== null) ? m - signalLine[i] : null);

        return { macdLine, signalLine, histogram };
    },

    bollinger(data, window = 20, numStd = 2) {
        const middle = this.sma(data, window);
        const upper = [];
        const lower = [];

        for (let i = 0; i < data.length; i++) {
            if (middle[i] === null) {
                upper.push(null);
                lower.push(null);
            } else {
                const slice = data.slice(i - window + 1, i + 1);
                const avg = middle[i];
                const squareDiffs = slice.map(v => Math.pow(v - avg, 2));
                const variance = squareDiffs.reduce((a, b) => a + b, 0) / window;
                const std = Math.sqrt(variance);
                upper.push(avg + std * numStd);
                lower.push(avg - std * numStd);
            }
        }
        return { upper, middle, lower };
    },

    atr(highs, lows, closes, period = 14) {
        const trs = [highs[0] - lows[0]];
        for (let i = 1; i < closes.length; i++) {
            const tr = Math.max(
                highs[i] - lows[i],
                Math.abs(highs[i] - closes[i - 1]),
                Math.abs(lows[i] - closes[i - 1])
            );
            trs.push(tr);
        }
        return this.sma(trs, period);
    },

    // ─── Sentiment Intelligence ───────────────────────
    
    getNewsSentiment(articles) {
        const bullish = new Set(["surge", "gain", "jump", "record", "high", "growth", "profit", "bull", "rally", "up", "soar", "climb", "dividend", "outperform", "beat", "tăng", "lãi", "đỉnh", "tăng trưởng"]);
        const bearish = new Set(["drop", "fall", "plunge", "loss", "crash", "bear", "down", "slump", "shrink", "miss", "cut", "warning", "bankrupt", "giảm", "lỗ", "đáy", "suy thoái"]);
        
        let pos = 0;
        let neg = 0;

        articles.forEach(art => {
            const tokens = [...this.tokenize(art.title || ""), ...this.tokenize(this.extractText(art.summary || ""))];
            tokens.forEach(t => {
                if (bullish.has(t)) pos++;
                else if (bearish.has(t)) neg++;
            });
        });

        const total = pos + neg;
        if (total === 0) return 50;
        return Math.round((pos / total) * 100);
    },

    // ─── Stats Engines ───────────────────────────────
    
    getFlightStats(flights) {
        const total = flights.length;
        const airborne = flights.filter(f => !f.on_ground);
        const ground = total - airborne.length;
        
        const counts = {};
        const regions = { "North America": 0, "Europe": 0, "Asia": 0, "Middle East": 0, "Africa": 0, "South America": 0, "Oceania": 0, "Other": 0 };
        const altBrackets = { "0-1km": 0, "1-3km": 0, "3-6km": 0, "6-10km": 0, "10km+": 0 };
        
        let totalSpeed = 0;
        let speedCount = 0;
        let maxSpeed = 0;
        
        flights.forEach(f => {
            // Country
            counts[f.country] = (counts[f.country] || 0) + 1;
            
            // Regions
            const lat = f.lat, lon = f.lon;
            if (lat >= 25 && lat <= 72 && lon >= -130 && lon <= -60) regions["North America"]++;
            else if (lat >= 35 && lat <= 72 && lon >= -10 && lon <= 40) regions["Europe"]++;
            else if (lat >= 10 && lat <= 55 && lon >= 60 && lon <= 150) regions["Asia"]++;
            else if (lat >= 12 && lat <= 42 && lon >= 25 && lon <= 65) regions["Middle East"]++;
            else if (lat >= -35 && lat <= 37 && lon >= -20 && lon <= 52) regions["Africa"]++;
            else if (lat >= -56 && lat <= 15 && lon >= -82 && lon <= -34) regions["South America"]++;
            else if (lat >= -50 && lat <= 0 && lon >= 110 && lon <= 180) regions["Oceania"]++;
            else regions["Other"]++;

            // Alt (airborne)
            if (!f.on_ground) {
                const a = f.alt;
                if (a < 1000) altBrackets["0-1km"]++;
                else if (a < 3000) altBrackets["1-3km"]++;
                else if (a < 6000) altBrackets["3-6km"]++;
                else if (a < 10000) altBrackets["6-10km"]++;
                else altBrackets["10km+"]++;
                
                if (f.velocity > 0) {
                    const s = f.velocity * 3.6;
                    totalSpeed += s;
                    speedCount++;
                    if (s > maxSpeed) maxSpeed = s;
                }
            }
        });

        const topCountries = Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20)
            .map(([country, count]) => ({ country, count }));

        const callsignCounts = {};
        flights.forEach(f => {
            if (f.callsign) {
                const cs = f.callsign.trim();
                if (cs) callsignCounts[cs] = (callsignCounts[cs] || 0) + 1;
            }
        });
        const topCallsigns = Object.entries(callsignCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 25)
            .map(([callsign, count]) => ({ callsign, count }));

        const airborneCount = airborne.length;
        const groundCount = total - airborneCount;

        return {
            timestamp: Math.floor(Date.now() / 1000),
            total_tracked: total,
            airborne: airborneCount,
            on_ground: groundCount,
            avg_speed_kmh: speedCount ? Math.round(totalSpeed / speedCount) : 0,
            avg_altitude_m: airborneCount ? Math.round(flights.reduce((sum, f) => sum + (f.alt || 0), 0) / airborneCount) : 0,
            max_speed_kmh: Math.round(maxSpeed),
            countries: topCountries,
            regions,
            altitude_distribution: altBrackets,
            top_callsigns: topCallsigns
        };
    },

    getCountryMentions(articles) {
        const counts = {};
        const countryArticles = {};
        const countries = [
            "Afghanistan", "Albania", "Algeria", "Argentina", "Armenia", "Australia",
            "Austria", "Azerbaijan", "Bahrain", "Bangladesh", "Belarus", "Belgium",
            "Bolivia", "Bosnia", "Brazil", "Bulgaria", "Cambodia", "Cameroon",
            "Canada", "Chad", "Chile", "China", "Colombia", "Congo", "Costa Rica",
            "Croatia", "Cuba", "Cyprus", "Czech", "Denmark", "Dominican", "Ecuador",
            "Egypt", "El Salvador", "Estonia", "Ethiopia", "Finland", "France",
            "Georgia", "Germany", "Ghana", "Greece", "Guatemala", "Haiti",
            "Honduras", "Hungary", "Iceland", "India", "Indonesia", "Iran", "Iraq",
            "Ireland", "Israel", "Italy", "Jamaica", "Japan", "Jordan", "Kazakhstan",
            "Kenya", "Korea", "Kuwait", "Kyrgyzstan", "Laos", "Latvia", "Lebanon",
            "Libya", "Lithuania", "Luxembourg", "Madagascar", "Malaysia", "Mali",
            "Malta", "Mexico", "Moldova", "Mongolia", "Montenegro", "Morocco",
            "Mozambique", "Myanmar", "Nepal", "Netherlands", "New Zealand",
            "Nicaragua", "Niger", "Nigeria", "North Korea", "Norway", "Oman",
            "Pakistan", "Palestine", "Panama", "Paraguay", "Peru", "Philippines",
            "Poland", "Portugal", "Qatar", "Romania", "Russia", "Rwanda",
            "Saudi Arabia", "Senegal", "Serbia", "Singapore", "Slovakia",
            "Slovenia", "Somalia", "South Africa", "South Korea", "Spain",
            "Sri Lanka", "Sudan", "Sweden", "Switzerland", "Syria", "Taiwan",
            "Tajikistan", "Tanzania", "Thailand", "Tunisia", "Turkey", "Turkmenistan",
            "Uganda", "Ukraine", "United Arab Emirates", "United Kingdom",
            "United States", "Uruguay", "Uzbekistan", "Venezuela", "Vietnam",
            "Yemen", "Zambia", "Zimbabwe",
        ];

        const aliases = {
            "US": "United States", "USA": "United States", "U.S.": "United States",
            "America": "United States", "American": "United States",
            "UK": "United Kingdom", "Britain": "United Kingdom", "British": "United Kingdom",
            "UAE": "United Arab Emirates", "Emirates": "United Arab Emirates",
            "Russian": "Russia", "Chinese": "China", "Japanese": "Japan",
            "Korean": "South Korea", "Israeli": "Israel", "Palestinian": "Palestine",
            "Iranian": "Iran", "Iraqi": "Iraq", "Syrian": "Syria",
            "Turkish": "Turkey", "French": "France", "German": "Germany",
            "Italian": "Italy", "Spanish": "Spain", "Brazilian": "Brazil",
            "Mexican": "Mexico", "Canadian": "Canada", "Australian": "Australia",
            "Indian": "India", "Pakistani": "Pakistan", "Afghan": "Afghanistan",
            "Egyptian": "Egypt", "Saudi": "Saudi Arabia", "Ukrainian": "Ukraine",
            "Vietnamese": "Vietnam", "Thai": "Thailand", "Filipino": "Philippines",
            "Indonesian": "Indonesia", "Malaysian": "Malaysia",
            "Nigerian": "Nigeria", "Kenyan": "Kenya", "Ethiopian": "Ethiopia",
            "South Korean": "South Korea", "North Korean": "North Korea",
        };

        articles.forEach(art => {
            const text = (art.title + " " + this.extractText(art.summary)).toLowerCase();
            const mentioned = new Set();

            countries.forEach(c => {
                if (text.includes(c.toLowerCase())) mentioned.add(c);
            });

            Object.entries(aliases).forEach(([alias, canonical]) => {
                const regex = new RegExp(`\\b${alias.replace(".", "\\.")}\\b`, "i");
                if (regex.test(text)) mentioned.add(canonical);
            });

            mentioned.forEach(c => {
                counts[c] = (counts[c] || 0) + 1;
                if (!countryArticles[c]) countryArticles[c] = [];
                if (countryArticles[c].length < 3) countryArticles[c].push(art.title);
            });
        });

        const total = articles.length;
        const ranked = Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 25)
            .map(([country, count]) => ({
                country,
                mentions: count,
                pct: ((count / Math.max(total, 1)) * 100).toFixed(1),
                headlines: countryArticles[country] || []
            }));

        return { total_articles: total, countries: ranked };
    },

    calculateMarketSentiment(assetHistories, newsSentiment) {
        let positiveSignals = 0;
        let totalSignals = 0;
        const movers = [];

        Object.entries(assetHistories).forEach(([symbol, hist]) => {
            if (!hist || hist.length < 2) return;

            const closes = hist.map(d => d.close);
            const current = closes[closes.length - 1];
            const prev = closes[closes.length - 2];
            const change = current - prev;
            const pct = (change / prev) * 100;

            const sma7 = this.sma(closes, 7);
            const lastSma7 = sma7[sma7.length - 1];

            if (current > lastSma7) positiveSignals++;
            totalSignals++;

            if (pct > 0) positiveSignals++;
            totalSignals++;

            movers.push({
                symbol,
                price: current,
                change: change,
                percent_change: pct,
                abs_change: Math.abs(pct)
            });
        });

        const techSentiment = totalSignals > 0 ? Math.round((positiveSignals / totalSignals) * 100) : 50;
        const sentimentScore = Math.round((techSentiment * 0.6) + (newsSentiment * 0.4));

        let stance = "NEUTRAL";
        if (sentimentScore >= 70) stance = "STRONGLY BULLISH";
        else if (sentimentScore >= 55) stance = "BULLISH";
        else if (sentimentScore <= 30) stance = "STRONGLY BEARISH";
        else if (sentimentScore <= 45) stance = "BEARISH";

        movers.sort((a, b) => b.abs_change - a.abs_change);

        return {
            sentiment_score: sentimentScore,
            tech_sentiment: techSentiment,
            news_sentiment: newsSentiment,
            stance,
            top_movers: movers.slice(0, 5)
        };
    },

    getVesselStats(vessels) {
        const total = vessels.length;
        const underway = vessels.filter(v => v.status === "Underway");
        const moored = total - underway.length;
        
        let totalSpeed = 0;
        underway.forEach(v => totalSpeed += (v.speed || 0));
        
        const typeCounts = {};
        const flagCounts = {};
        
        vessels.forEach(v => {
            typeCounts[v.type] = (typeCounts[v.type] || 0) + 1;
            flagCounts[v.flag] = (flagCounts[v.flag] || 0) + 1;
        });

        const sortedTypes = Object.entries(typeCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([type, count]) => ({ type, count }));

        const sortedFlags = Object.entries(flagCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20)
            .map(([flag, count]) => ({ flag, count }));

        // Procedural Choke Points (mimicking server logic)
        const chokePoints = [
            { name: "Suez Canal", lat: 29.9, lon: 32.5 },
            { name: "Panama Canal", lat: 9.1, lon: -79.9 },
            { name: "Strait of Malacca", lat: 2.2, lon: 102.2 },
            { name: "Strait of Hormuz", lat: 26.6, lon: 56.3 },
            { name: "Gibraltar", lat: 35.9, lon: -5.3 }
        ];

        const chokeStats = chokePoints.map(cp => {
            const nearby = vessels.filter(v => {
                const dist = Math.sqrt(Math.pow(v.lat - cp.lat, 2) + Math.pow(v.lon - cp.lon, 2));
                return dist < 5;
            }).length;
            return { name: cp.name, count: nearby };
        });

        return {
            total_tracked: total,
            underway: underway.length,
            moored: moored,
            avg_speed_knots: underway.length ? Math.round(totalSpeed / underway.length) : 0,
            est_teu_volume: total * 450, // Mock heuristic
            types: sortedTypes,
            flags: sortedFlags,
            choke_points: chokeStats
        };
    }
};

window.Intel = Intel;

// ─── Global Dashboard Clocks ──────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    function tickClock() {
        const now = new Date();
        const localEl = document.getElementById("nav-clock-local");
        const utcEl = document.getElementById("nav-clock-utc");
        const tyoEl = document.getElementById("nav-clock-tyo");
        const nycEl = document.getElementById("nav-clock-nyc");
        const legacyEl = document.getElementById("nav-clock");

        if (localEl || legacyEl) {
            const timeLocal = now.toLocaleTimeString("en-GB", { hour12: false }) + " UTC+" + String(Math.floor(-now.getTimezoneOffset() / 60)).padStart(2, "0");
            if (localEl) localEl.textContent = timeLocal;
            if (legacyEl) legacyEl.textContent = timeLocal;
        }
        if (utcEl) {
            utcEl.textContent = now.toLocaleTimeString("en-GB", { timeZone: "UTC", hour12: false }) + " UTC";
        }
        if (tyoEl) {
            try { tyoEl.textContent = now.toLocaleTimeString("en-GB", { timeZone: "Asia/Tokyo", hour12: false }) + " TYO"; } catch(e){}
        }
        if (nycEl) {
            try { nycEl.textContent = now.toLocaleTimeString("en-GB", { timeZone: "America/New_York", hour12: false }) + " NYC"; } catch(e){}
        }
    }
    tickClock();
    setInterval(tickClock, 1000);
});
