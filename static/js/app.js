/**
 * GVBC Reunion — Dashboard Logic
 * Palantir-style intelligence dashboard
 */

// ─── State ───────────────────────────────────────────
let flightMap = null;
let flightMarkersLayer = null;
let flightTileLayer = null;
let flightRefreshTimer = null;
let cachedArticles = []; // Cache for client-side processing

// ─── Initialization ──────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
    initTheme();
    loadVNIndex();
    loadFeed();
    loadTrending();
    loadCountries();
    loadGlobalFinance();
    loadMacroData();
    if (document.getElementById("finance-intel-panel")) {
        loadFinanceIntelligence();
        setInterval(loadFinanceIntelligence, 60000); // 1 min auto-refresh
    }
    if (document.getElementById("space-panel")) {
        loadSpaceLaunches();
        setInterval(loadSpaceLaunches, 3600000); // 1 hour auto-refresh
    }
    
    // Check config before loading maps
    const config = await loadConfig();

    document.getElementById("btn-refresh-feed").addEventListener("click", () => {
        loadFeed();
        loadTrending();
        loadCountries();
    });
    
    if (config.enable_flights) {
        initFlightMap();
        loadFlights();
        document.getElementById("btn-refresh-flights").addEventListener("click", loadFlights);
        flightRefreshTimer = setInterval(loadFlights, 15000);
    }
    
    document.getElementById("theme-toggle")?.addEventListener("click", toggleTheme);

    // Auto-refresh market data every 60s
    setInterval(loadVNIndex, 60000);

    // Auto-refresh global finance every 90s
    setInterval(loadGlobalFinance, 90000);

    // Auto-refresh macro data every 5 min (changes slowly)
    setInterval(loadMacroData, 300000);
});

// ─── Theme Management ────────────────────────────────
function initTheme() {
    const savedTheme = localStorage.getItem("theme");
    if (savedTheme === "light") {
        document.documentElement.setAttribute("data-theme", "light");
    }
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute("data-theme");
    const newTheme = currentTheme === "light" ? "dark" : "light";
    
    if (newTheme === "light") {
        document.documentElement.setAttribute("data-theme", "light");
        localStorage.setItem("theme", "light");
    } else {
        document.documentElement.removeAttribute("data-theme");
        localStorage.setItem("theme", "dark");
    }
    
    // Update Leaflet map tiles if active
    if (flightTileLayer) {
        const tileUrl = newTheme === "light" 
            ? "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
            : "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
        flightTileLayer.setUrl(tileUrl);
    }
}

// ─── Load Configuration ──────────────────────────────
async function loadConfig() {
    try {
        const res = await fetch("/api/config");
        const config = await res.json();
        
        // Hide maps if disabled
        if (!config.enable_flights) {
            document.getElementById("flight-panel").classList.add("hidden");
        }
        if (!config.enable_ships) {
            document.getElementById("ship-panel").classList.add("hidden");
            // Remove iframe src to stop data loading
            document.getElementById("ship-map").src = "";
        }
        
        // If both hidden, hide the container row to reclaim space
        if (!config.enable_flights && !config.enable_ships) {
            document.querySelector(".dash-right").classList.add("hidden");
        }
        
        return config;
    } catch (err) {
        console.error("Load config error:", err);
        return { enable_flights: true, enable_ships: true };
    }
}

// ─── Clock logic moved to intel.js ───────────────────


// ═══════════════════════════════════════════════════════
// VN-INDEX — Full Widget with Indicators
// ═══════════════════════════════════════════════════════

async function loadVNIndex() {
    try {
        // Fetch raw history instead of processed indicators
        const res = await fetch("/api/finance/vnindex/history?period=3mo");
        if (!res.ok) throw new Error("Failed to fetch VNINDEX history");
        const histData = await res.json();
        const dataPoints = histData.data;
        if (!dataPoints || dataPoints.length < 2) throw new Error("Insufficient history");

        const closes = dataPoints.map(d => d.close);
        const currentPrice = closes[closes.length - 1];
        const prevClose = closes[closes.length - 2];
        const change = currentPrice - prevClose;
        const pctChange = (change / prevClose) * 100;
        
        // --- Compute Indicators Locally ---
        const sma20 = Intel.sma(closes, 20);
        const sma50 = Intel.sma(closes, 50);
        const ema12 = Intel.ema(closes, 12);
        const ema26 = Intel.ema(closes, 26);
        const rsi14 = Intel.rsi(closes, 14);
        const macdRes = Intel.macd(closes);
        const bbRes = Intel.bollinger(closes);
        const atrRes = Intel.atr(dataPoints.map(d => d.high || d.close), dataPoints.map(d => d.low || d.close), closes, 14);

        // Derive signals
        const signals = [];
        const lastSma20 = sma20[sma20.length - 1];
        const lastRsi14 = rsi14[rsi14.length - 1];
        const lastMacdLine = macdRes.macdLine[macdRes.macdLine.length - 1];
        const lastMacdSignal = macdRes.signalLine[macdRes.signalLine.length - 1];

        if (currentPrice > lastSma20) signals.push("ABOVE SMA20");
        else signals.push("BELOW SMA20");

        if (lastRsi14 > 70) signals.push("OVERBOUGHT");
        else if (lastRsi14 < 30) signals.push("OVERSOLD");
        else signals.push("NEUTRAL RSI");

        if (lastMacdLine > lastMacdSignal) signals.push("MACD BULLISH");
        else signals.push("MACD BEARISH");

        let bullishCount = signals.filter(s => s.includes("ABOVE") || s.includes("BULLISH") || s.includes("OVERSOLD")).length;
        const overall = bullishCount >= 2 ? "BULLISH" : (bullishCount === 0 ? "BEARISH" : "NEUTRAL");

        // Prepare data object for rendering
        const data = {
            price: currentPrice,
            change: change,
            percent_change: pctChange,
            overall_signal: overall,
            timestamp: dataPoints[dataPoints.length - 1].date,
            open: dataPoints[dataPoints.length - 1].open || currentPrice,
            high: dataPoints[dataPoints.length - 1].high || currentPrice,
            low: dataPoints[dataPoints.length - 1].low || currentPrice,
            volume: dataPoints[dataPoints.length - 1].volume,
            low_period: Math.min(...closes),
            high_period: Math.max(...closes),
            indicators: {
                rsi_14: lastRsi14,
                macd: lastMacdLine,
                macd_signal: lastMacdSignal,
                macd_histogram: macdRes.histogram[macdRes.histogram.length - 1],
                sma_20: lastSma20,
                sma_50: sma50[sma50.length - 1],
                ema_12: ema12[ema12.length - 1],
                ema_26: ema26[ema26.length - 1],
                bb_upper: bbRes.upper[bbRes.upper.length - 1],
                bb_middle: bbRes.middle[bbRes.middle.length - 1],
                bb_lower: bbRes.lower[bbRes.lower.length - 1],
                atr_14: atrRes[atrRes.length - 1]
            },
            signals: signals
        };
        
        // Hide loader, show data
        document.getElementById("vnindex-loading").style.display = "none";
        document.getElementById("vnindex-data").style.display = "flex";
        
        // --- Price ---
        const priceEl = document.getElementById("vnindex-price");
        priceEl.textContent = data.price.toLocaleString("en-US", {minimumFractionDigits: 2});
        
        // --- Change ---
        const changeEl = document.getElementById("vnindex-change");
        const pctEl = document.getElementById("vnindex-pct");
        
        changeEl.textContent = (data.change >= 0 ? "+" : "") + data.change.toFixed(2);
        pctEl.textContent = (data.percent_change >= 0 ? "+" : "") + data.percent_change.toFixed(2) + "%";
        
        // Apply color classes
        const trendClass = data.change >= 0 ? "market-up" : "market-down";
        [priceEl, changeEl, pctEl].forEach(el => {
            el.classList.remove("market-up", "market-down");
            el.classList.add(trendClass);
        });
        
        // --- Overall Signal Badge ---
        const signalBadge = document.getElementById("vnindex-overall-signal");
        if (data.overall_signal) {
            signalBadge.textContent = data.overall_signal;
            signalBadge.className = "vnindex-signal-badge";
            if (data.overall_signal === "BULLISH") signalBadge.classList.add("signal-bullish");
            else if (data.overall_signal === "BEARISH") signalBadge.classList.add("signal-bearish");
            else signalBadge.classList.add("signal-neutral");
        }
        
        // --- OHLC ---
        if (data.open !== undefined) {
            document.getElementById("vnindex-open").textContent = data.open.toLocaleString("en-US", {minimumFractionDigits: 2});
            document.getElementById("vnindex-high").textContent = data.high.toLocaleString("en-US", {minimumFractionDigits: 2});
            document.getElementById("vnindex-low").textContent = data.low.toLocaleString("en-US", {minimumFractionDigits: 2});
            document.getElementById("vnindex-volume").textContent = formatVolume(data.volume);
        }
        
        // --- Range bar ---
        if (data.low_period !== undefined && data.high_period !== undefined) {
            document.getElementById("vnindex-range-low").textContent = data.low_period.toLocaleString();
            document.getElementById("vnindex-range-high").textContent = data.high_period.toLocaleString();
            const range = data.high_period - data.low_period;
            if (range > 0) {
                const pct = ((data.price - data.low_period) / range) * 100;
                document.getElementById("vnindex-range-pointer").style.left = `${Math.max(0, Math.min(100, pct))}%`;
            }
        }
        
        // --- Timestamp ---
        if (data.timestamp) {
            const ts = new Date(data.timestamp);
            document.getElementById("vnindex-timestamp").textContent = 
                ts.toLocaleDateString("en-GB", {day: "2-digit", month: "short"}).toUpperCase();
        }
        
        // --- Technical Indicators Panel ---
        if (data.indicators) {
            renderIndicators(data);
        }
        
        // --- Load sparkline ---
        loadSparkline();
        
    } catch (e) {
        console.error("[Market Error]", e);
        document.getElementById("vnindex-loading").innerHTML = "<span>MARKET DATA OFFLINE</span>";
        document.getElementById("indicators-loading").innerHTML = "<span>NO DATA</span>";
    }
}

function renderIndicators(data) {
    const ind = data.indicators;
    
    // Hide loader
    document.getElementById("indicators-loading").style.display = "none";
    document.getElementById("indicators-data").style.display = "grid";
    
    // RSI
    const rsiVal = ind.rsi_14;
    document.getElementById("rsi-value").textContent = rsiVal.toFixed(1);
    const rsiLabel = document.getElementById("rsi-label");
    rsiLabel.className = "rsi-label";
    if (rsiVal >= 70) {
        rsiLabel.textContent = "OVERBOUGHT";
        rsiLabel.classList.add("rsi-overbought");
    } else if (rsiVal <= 30) {
        rsiLabel.textContent = "OVERSOLD";
        rsiLabel.classList.add("rsi-oversold");
    } else {
        rsiLabel.textContent = "NEUTRAL";
        rsiLabel.classList.add("rsi-neutral");
    }
    drawRSIGauge(rsiVal);
    
    // MACD
    document.getElementById("macd-line").textContent = ind.macd.toFixed(2);
    document.getElementById("macd-signal").textContent = ind.macd_signal.toFixed(2);
    const macdHistEl = document.getElementById("macd-hist");
    macdHistEl.textContent = (ind.macd_histogram >= 0 ? "+" : "") + ind.macd_histogram.toFixed(2);
    macdHistEl.classList.remove("market-up", "market-down");
    macdHistEl.classList.add(ind.macd_histogram >= 0 ? "market-up" : "market-down");
    
    // Moving Averages
    document.getElementById("sma-20").textContent = ind.sma_20.toLocaleString("en-US", {minimumFractionDigits: 2});
    document.getElementById("sma-50").textContent = ind.sma_50.toLocaleString("en-US", {minimumFractionDigits: 2});
    document.getElementById("ema-12").textContent = ind.ema_12.toLocaleString("en-US", {minimumFractionDigits: 2});
    document.getElementById("ema-26").textContent = ind.ema_26.toLocaleString("en-US", {minimumFractionDigits: 2});
    
    // Color the MAs based on price position
    ["sma-20", "sma-50", "ema-12", "ema-26"].forEach(id => {
        const el = document.getElementById(id);
        const val = parseFloat(el.textContent.replace(/,/g, ""));
        el.classList.remove("market-up", "market-down");
        el.classList.add(data.price > val ? "market-up" : "market-down");
    });
    
    // Bollinger Bands
    document.getElementById("bb-upper").textContent = ind.bb_upper.toLocaleString("en-US", {minimumFractionDigits: 2});
    document.getElementById("bb-middle").textContent = ind.bb_middle.toLocaleString("en-US", {minimumFractionDigits: 2});
    document.getElementById("bb-lower").textContent = ind.bb_lower.toLocaleString("en-US", {minimumFractionDigits: 2});
    document.getElementById("atr-14").textContent = ind.atr_14.toFixed(2);
    
    // Signal Tags
    const tagsContainer = document.getElementById("signal-tags");
    tagsContainer.innerHTML = "";
    if (data.signals) {
        data.signals.forEach(sig => {
            const tag = document.createElement("span");
            tag.className = "signal-tag";
            tag.textContent = sig;
            if (sig.includes("ABOVE") || sig.includes("BULLISH") || sig.includes("OVERSOLD")) {
                tag.classList.add("tag-bullish");
            } else if (sig.includes("BELOW") || sig.includes("BEARISH") || sig.includes("OVERBOUGHT")) {
                tag.classList.add("tag-bearish");
            } else {
                tag.classList.add("tag-neutral");
            }
            tagsContainer.appendChild(tag);
        });
    }
}

// ─── RSI Gauge ───────────────────────────────────────
function drawRSIGauge(value) {
    const canvas = document.getElementById("rsi-gauge");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h - 2;
    const radius = Math.min(cx, cy) - 6;
    
    ctx.clearRect(0, 0, w, h);
    
    // Background arc (semicircle)
    ctx.beginPath();
    ctx.arc(cx, cy, radius, Math.PI, 0, false);
    ctx.lineWidth = 6;
    ctx.strokeStyle = "rgba(30, 42, 56, 0.6)";
    ctx.stroke();
    
    // Colored segments: green (0-30), amber (30-70), red (70-100)
    const drawSegment = (startPct, endPct, color) => {
        const startAngle = Math.PI + (startPct / 100) * Math.PI;
        const endAngle = Math.PI + (endPct / 100) * Math.PI;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, startAngle, endAngle, false);
        ctx.lineWidth = 6;
        ctx.strokeStyle = color;
        ctx.stroke();
    };
    
    drawSegment(0, 30, "rgba(34, 197, 94, 0.4)");   // oversold zone
    drawSegment(30, 70, "rgba(245, 158, 11, 0.3)");  // neutral
    drawSegment(70, 100, "rgba(239, 68, 68, 0.4)");  // overbought
    
    // Needle
    const angle = Math.PI + (value / 100) * Math.PI;
    const needleLen = radius - 4;
    const nx = cx + Math.cos(angle) * needleLen;
    const ny = cy + Math.sin(angle) * needleLen;
    
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(nx, ny);
    ctx.lineWidth = 2;
    ctx.strokeStyle = value <= 30 ? "#22c55e" : value >= 70 ? "#ef4444" : "#f59e0b";
    ctx.stroke();
    
    // Center dot
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fillStyle = "#22d3ee";
    ctx.fill();
}


// ─── Sparkline Chart ─────────────────────────────────
async function loadSparkline() {
    try {
        const res = await fetch("/api/finance/vnindex/history?period=1mo");
        if (!res.ok) return;
        const data = await res.json();
        if (!data.data || data.data.length < 2) return;
        
        drawSparkline(data.data.map(d => d.close));
    } catch (e) {
        console.error("[Sparkline Error]", e);
    }
}

function drawSparkline(prices) {
    const canvas = document.getElementById("vnindex-sparkline");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    
    const w = canvas.parentElement.clientWidth - 8;
    const h = 60;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    ctx.scale(dpr, dpr);
    
    ctx.clearRect(0, 0, w, h);
    
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min || 1;
    const padding = 4;
    const effectiveH = h - padding * 2;
    const effectiveW = w - padding * 2;
    
    const isUp = prices[prices.length - 1] >= prices[0];
    const lineColor = isUp ? "#22c55e" : "#ef4444";
    const fillColor = isUp ? "rgba(34, 197, 94, 0.08)" : "rgba(239, 68, 68, 0.08)";
    
    // Draw area fill
    ctx.beginPath();
    ctx.moveTo(padding, h - padding);
    prices.forEach((p, i) => {
        const x = padding + (i / (prices.length - 1)) * effectiveW;
        const y = padding + effectiveH - ((p - min) / range) * effectiveH;
        ctx.lineTo(x, y);
    });
    ctx.lineTo(padding + effectiveW, h - padding);
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();
    
    // Draw line
    ctx.beginPath();
    prices.forEach((p, i) => {
        const x = padding + (i / (prices.length - 1)) * effectiveW;
        const y = padding + effectiveH - ((p - min) / range) * effectiveH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    
    // Last point dot
    const lastX = padding + effectiveW;
    const lastY = padding + effectiveH - ((prices[prices.length - 1] - min) / range) * effectiveH;
    ctx.beginPath();
    ctx.arc(lastX, lastY, 3, 0, Math.PI * 2);
    ctx.fillStyle = lineColor;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(lastX, lastY, 5, 0, Math.PI * 2);
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.3;
    ctx.stroke();
    ctx.globalAlpha = 1;
}

function formatVolume(vol) {
    if (!vol || vol === 0) return "--";
    if (vol >= 1e9) return (vol / 1e9).toFixed(1) + "B";
    if (vol >= 1e6) return (vol / 1e6).toFixed(1) + "M";
    if (vol >= 1e3) return (vol / 1e3).toFixed(1) + "K";
    return vol.toString();
}


// ─── Trending Board ──────────────────────────────────
async function loadTrending() {
    const container = document.getElementById("trending-container");
    const loading = document.getElementById("trending-loading");

    try {
        // Use cached articles if available, otherwise fetch
        let articles = cachedArticles;
        if (!articles.length) {
            const res = await fetch("/api/feed");
            articles = await res.json();
            cachedArticles = articles;
        }
        
        // Process on client
        const data = Intel.getTrending(articles);
        loading.style.display = "none";

        document.getElementById("trending-article-count").textContent =
            `${data.total_articles} ARTICLES`;

        if (!data.keywords.length) {
            container.innerHTML = '<div class="empty-state"><span>NO DATA — ADD RSS SOURCES</span></div>';
            return;
        }

        const maxCount = data.keywords[0]?.count || 1;
        let html = '<div class="trending-grid">';

        data.keywords.slice(0, 15).forEach((kw, i) => {
            const pct = Math.round((kw.count / maxCount) * 100);
            html += `
                <div class="trend-row">
                    <span class="trend-rank">${String(i + 1).padStart(2, "0")}</span>
                    <span class="trend-word">${escapeHtml(kw.word)}</span>
                    <span class="trend-count">${kw.count}</span>
                    <div class="trend-bar-cell">
                        <div class="trend-bar" style="width:${pct}%"></div>
                    </div>
                </div>`;
        });

        html += '</div>';

        // Phrases section
        if (data.phrases && data.phrases.length) {
            html += '<div class="trend-phrases"><div class="trend-phrases-title">DETECTED PHRASES</div>';
            data.phrases.forEach(p => {
                html += `<span class="phrase-chip">${escapeHtml(p.phrase)} ×${p.count}</span>`;
            });
            html += '</div>';
        }

        container.innerHTML = html;
    } catch (err) {
        loading.style.display = "none";
        console.error("Trending error:", err);
        container.innerHTML = '<div class="empty-state"><span>ANALYSIS FAILED</span></div>';
    }
}

// ─── Country Mentions Board ──────────────────────────
async function loadCountries() {
    const container = document.getElementById("country-container");
    const loading = document.getElementById("country-loading");

    try {
        // Use cached articles if available
        let articles = cachedArticles;
        if (!articles.length) {
            const res = await fetch("/api/feed");
            articles = await res.json();
            cachedArticles = articles;
        }

        // Process on client
        const data = Intel.getCountryMentions(articles);
        loading.style.display = "none";

        document.getElementById("country-article-count").textContent =
            `${data.total_articles} SCANNED`;

        if (!data.countries.length) {
            container.innerHTML = '<div class="empty-state"><span>NO GEOPOLITICAL DATA</span></div>';
            return;
        }

        const maxMentions = data.countries[0]?.mentions || 1;
        let html = '<div class="country-grid">';

        data.countries.forEach((c, i) => {
            const barPct = Math.round((c.mentions / maxMentions) * 100);
            const tooltipHtml = c.headlines.map(h =>
                `<div class="tooltip-headline">${escapeHtml(h)}</div>`
            ).join("");

            html += `
                <div class="country-row">
                    <span class="country-rank">${String(i + 1).padStart(2, "0")}</span>
                    <span class="country-name">${escapeHtml(c.country)}</span>
                    <span class="country-pct">${c.pct}%</span>
                    <div class="country-bar-cell">
                        <div class="country-bar" style="width:${barPct}%"></div>
                    </div>
                    ${tooltipHtml ? `<div class="country-tooltip">${tooltipHtml}</div>` : ""}
                </div>`;
        });

        html += '</div>';
        container.innerHTML = html;
    } catch (err) {
        loading.style.display = "none";
        console.error("Country error:", err);
        container.innerHTML = '<div class="empty-state"><span>SCAN FAILED</span></div>';
    }
}


// ═══════════════════════════════════════════════════════
// NEWS FEED — Rectangle Box Cards
// ═══════════════════════════════════════════════════════

async function loadFeed() {
    const container = document.getElementById("feed-container");
    const loading = document.getElementById("feed-loading");
    const empty = document.getElementById("feed-empty");

    loading.style.display = "flex";
    empty.style.display = "none";
    container.querySelectorAll(".news-rect-card").forEach(c => c.remove());

    try {
        const res = await fetch("/api/feed");
        const articles = await res.json();
        cachedArticles = articles; // Cache for other components
        loading.style.display = "none";

        document.getElementById("feed-count").textContent = `${articles.length} ITEMS`;

        if (!articles.length) {
            empty.style.display = "flex";
            return;
        }

        articles.forEach((article, i) => {
            const card = document.createElement("a");
            card.className = "news-rect-card";
            card.href = article.link;
            card.target = "_blank";
            card.rel = "noopener noreferrer";
            card.style.animationDelay = `${i * 0.04}s`;

            const tempDiv = document.createElement("div");
            tempDiv.innerHTML = article.summary || "";
            const cleanSummary = tempDiv.textContent || tempDiv.innerText || "";

            card.innerHTML = `
                <div class="news-rect-inner">
                    <div class="news-rect-content">
                        <div class="news-rect-source">
                            <span class="news-rect-source-dot"></span>
                            ${escapeHtml(article.source)}
                        </div>
                        <div class="news-rect-title">${escapeHtml(article.title)}</div>
                        <div class="news-rect-summary">${escapeHtml(cleanSummary)}</div>
                        <div class="news-rect-meta">
                            <span class="news-rect-meta-icon">◷</span>
                            <span>${formatDate(article.published)}</span>
                        </div>
                    </div>
                    <div class="news-rect-index">${String(i + 1).padStart(2, "0")}</div>
                </div>
            `;
            container.appendChild(card);
        });

        updateTimestamp();
    } catch (err) {
        loading.style.display = "none";
        console.error("Feed error:", err);
        empty.style.display = "flex";
    }
}


// ─── Flight Tracking Map ─────────────────────────────
function initFlightMap() {
    flightMap = L.map("flight-map", {
        center: [20, 0],
        zoom: 2,
        minZoom: 2,
        maxZoom: 12,
        zoomControl: true,
    });

    const isLight = document.documentElement.getAttribute("data-theme") === "light";
    const tileUrl = isLight 
        ? "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
        : "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";

    flightTileLayer = L.tileLayer(tileUrl, {
        attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
        subdomains: "abcd",
        maxZoom: 19,
    }).addTo(flightMap);

    flightMarkersLayer = L.layerGroup().addTo(flightMap);
}

async function loadFlights() {
    try {
        let params = "";
        if (flightMap && flightMap.getZoom() >= 4) {
            const b = flightMap.getBounds();
            params = `?lamin=${b.getSouth()}&lamax=${b.getNorth()}&lomin=${b.getWest()}&lomax=${b.getEast()}`;
        }

        const res = await fetch(`/api/flights${params}`);
        const data = await res.json();

        if (!data.flights) return;

        flightMarkersLayer.clearLayers();

        document.getElementById("flight-count").textContent =
            `${data.flights.length} ACTIVE`;

        data.flights.forEach(f => {
            const heading = f.heading || 0;
            const alt = f.alt ? `${Math.round(f.alt)}m` : "N/A";
            const speed = f.velocity ? `${Math.round(f.velocity * 3.6)} km/h` : "N/A";

            const icon = L.divIcon({
                className: "flight-icon",
                html: `<div style="
                    transform: rotate(${heading}deg);
                    font-size: 14px;
                    color: #22d3ee;
                    text-shadow: 0 0 6px rgba(34,211,238,0.6);
                    line-height: 1;
                ">✈</div>`,
                iconSize: [18, 18],
                iconAnchor: [9, 9],
            });

            const marker = L.marker([f.lat, f.lon], { icon }).addTo(flightMarkersLayer);
            marker.bindPopup(`
                <div class="flight-popup">
                    <strong>${f.callsign || f.icao24}</strong><br>
                    ORIGIN: ${f.country}<br>
                    ALT: ${alt}<br>
                    SPD: ${speed}<br>
                    HDG: ${Math.round(heading)}°
                </div>
            `);
        });

        updateTimestamp();
    } catch (err) {
        console.error("Flight data error:", err);
    }
}

// ─── Helpers ─────────────────────────────────────────
function escapeHtml(text) {
    const el = document.createElement("span");
    el.textContent = text;
    return el.innerHTML;
}

function formatDate(dateStr) {
    if (!dateStr) return "—";
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        return d.toLocaleDateString("en-GB", {
            day: "2-digit", month: "short", year: "numeric",
            hour: "2-digit", minute: "2-digit", hour12: false,
        }).toUpperCase();
    } catch {
        return dateStr;
    }
}

function updateTimestamp() {
    const el = document.getElementById("last-updated");
    if (el) {
        const now = new Date();
        el.textContent = `LAST SYNC: ${now.toLocaleTimeString("en-GB", { hour12: false })}`;
    }
}


// ═══════════════════════════════════════════════════════
// FINANCE INTELLIGENCE WIDGET
// ═══════════════════════════════════════════════════════

async function loadFinanceIntelligence() {
    const loading = document.getElementById("finance-intel-loading");
    const container = document.getElementById("finance-intel-data");
    
    if (!loading || !container) return;

    try {
        // 1. Get News Sentiment (use cached articles)
        let articles = cachedArticles;
        if (!articles.length) {
            const res = await fetch("/api/feed");
            articles = await res.json();
            cachedArticles = articles;
        }
        const newsSentiment = Intel.getNewsSentiment(articles);

        // 2. Get Asset Histories for Tech Sentiment
        const symbols = ["^VNINDEX", "^GSPC", "BTC-USD", "GC=F", "CL=F"];
        const res = await fetch(`/api/finance/history/bulk?symbols=${symbols.join(",")}&period=14d`);
        const histories = await res.json();
        
        // 3. Process on Client
        const data = Intel.calculateMarketSentiment(histories, newsSentiment);
        
        loading.style.display = "none";
        container.style.display = "flex";

        document.getElementById("intel-sentiment").textContent = data.sentiment_score + "/100";
        const stanceEl = document.getElementById("intel-stance");
        stanceEl.textContent = data.stance;
        
        // Color stance
        const borderEl = document.getElementById("intel-stance-border");
        if (data.stance.includes("BULLISH")) {
            stanceEl.style.color = "#10b981";
            borderEl.style.borderLeftColor = "#10b981";
        } else if (data.stance.includes("BEARISH")) {
            stanceEl.style.color = "#ef4444";
            borderEl.style.borderLeftColor = "#ef4444";
        } else {
            stanceEl.style.color = "#f59e0b";
            borderEl.style.borderLeftColor = "#f59e0b";
        }

        const moversEl = document.getElementById("intel-movers");
        moversEl.innerHTML = "";
        if (data.top_movers && data.top_movers.length > 0) {
            data.top_movers.slice(0, 3).forEach(mover => {
                const isUp = mover.change >= 0;
                const color = isUp ? "#10b981" : "#ef4444";
                const sign = isUp ? "+" : "";
                moversEl.innerHTML += `
                    <div style="display:flex; justify-content:space-between; font-size:0.85rem; padding:4px 0; border-bottom:1px dashed var(--border-color);">
                        <span style="font-weight:600; color:var(--text-light);">${mover.symbol}</span>
                        <span style="color:${color}; font-family:'JetBrains Mono', monospace; font-weight:700;">${sign}${mover.percent_change.toFixed(2)}%</span>
                    </div>
                `;
            });
        }

    } catch (e) {
        console.error("[Finance Intel Error]", e);
        if (loading) loading.innerHTML = "<span>ANALYSIS UNAVAILABLE</span>";
    }
}

// ═══════════════════════════════════════════════════════
// GLOBAL FINANCE STATISTICS — Right Column
// ═══════════════════════════════════════════════════════

async function loadGlobalFinance() {
    try {
        const res = await fetch("/api/finance/global");
        if (!res.ok) throw new Error("Finance API error");
        const data = await res.json();

        // Render each category
        if (data.indices) renderFinanceCategory("indices", data.indices);
        if (data.forex) renderFinanceCategory("forex", data.forex);
        if (data.commodities) renderFinanceCategory("commodities", data.commodities);
        if (data.crypto) renderFinanceCategory("crypto", data.crypto);

        // Update indices status badge
        const statusBadge = document.getElementById("indices-status");
        if (statusBadge && data.indices) {
            statusBadge.textContent = `${data.indices.length} MARKETS`;
        }

        updateTimestamp();
    } catch (e) {
        console.error("[Global Finance Error]", e);
        ["indices", "forex", "commodities", "crypto"].forEach(cat => {
            const loading = document.getElementById(`${cat}-loading`);
            if (loading) loading.innerHTML = "<span>DATA UNAVAILABLE</span>";
        });
    }
}

function renderFinanceCategory(category, tickers) {
    const loading = document.getElementById(`${category}-loading`);
    const list = document.getElementById(`${category}-list`);
    if (!list) return;

    if (loading) loading.style.display = "none";
    list.style.display = "flex";

    if (!tickers || tickers.length === 0) {
        list.innerHTML = '<div class="empty-state"><span>NO DATA</span></div>';
        return;
    }

    let html = '';
    tickers.forEach(t => {
        const isUp = t.change >= 0;
        const dirClass = isUp ? "fin-up" : "fin-down";
        const arrow = isUp ? "▲" : "▼";
        const changeSign = isUp ? "+" : "";

        // Format price based on magnitude
        let priceStr;
        if (t.price >= 10000) {
            priceStr = t.price.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
        } else if (t.price >= 100) {
            priceStr = t.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        } else {
            priceStr = t.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
        }

        html += `
            <div class="fin-ticker-row ${dirClass}">
                <span class="fin-flag">${t.flag}</span>
                <div class="fin-name-block">
                    <span class="fin-name">${escapeHtml(t.name)}</span>
                    <span class="fin-symbol">${escapeHtml(t.symbol)}</span>
                </div>
                <span class="fin-price">${priceStr}</span>
                <div class="fin-change-block">
                    <span class="fin-change">${changeSign}${t.change.toFixed(2)}</span>
                    <span class="fin-change-pct">${arrow} ${changeSign}${t.percent_change.toFixed(2)}%</span>
                </div>
            </div>
        `;
    });

    list.innerHTML = html;
}


// ═══════════════════════════════════════════════════════
// MACROECONOMIC STATISTICS — Right Column
// ═══════════════════════════════════════════════════════

async function loadMacroData() {
    try {
        const res = await fetch("/api/finance/macro");
        if (!res.ok) throw new Error("Macro API error");
        const data = await res.json();

        const loading = document.getElementById("macro-loading");
        const container = document.getElementById("macro-data");
        const status = document.getElementById("macro-status");

        if (loading) loading.style.display = "none";
        if (container) container.style.display = "flex";
        if (status) status.textContent = "LIVE";

        let html = '';

        // Vietnam section
        if (data.vietnam && data.vietnam.length) {
            html += '<div class="macro-section-header">🇻🇳 VIETNAM ECONOMY</div>';
            html += renderMacroSection(data.vietnam);
        }

        // Global section
        if (data.global && data.global.length) {
            html += '<div class="macro-section-header">🌐 GLOBAL INDICATORS</div>';
            html += renderMacroSection(data.global);
        }

        // Key rates section
        if (data.rates && data.rates.length) {
            html += '<div class="macro-section-header">📉 KEY RATES & INDICES</div>';
            html += renderMacroSection(data.rates);
        }

        container.innerHTML = html;
    } catch (e) {
        console.error("[Macro Error]", e);
        const loading = document.getElementById("macro-loading");
        if (loading) loading.innerHTML = "<span>MACRO DATA UNAVAILABLE</span>";
    }
}

function renderMacroSection(items) {
    let html = '';
    items.forEach(item => {
        const trendClass = item.trend === 'up' ? 'trend-up' : item.trend === 'down' ? 'trend-down' : 'trend-neutral';
        const trendIcon = item.trend === 'up' ? '▲' : item.trend === 'down' ? '▼' : '─';

        html += `
            <div class="macro-row">
                <span class="macro-icon">${item.icon}</span>
                <div class="macro-info">
                    <span class="macro-label">${escapeHtml(item.label)}</span>
                    <span class="macro-sublabel">${escapeHtml(item.sublabel)}</span>
                </div>
                <div class="macro-value-block">
                    <span class="macro-value">${escapeHtml(item.value)} ${escapeHtml(item.unit)}</span>
                    <span class="macro-trend ${trendClass}">${trendIcon} ${item.trend.toUpperCase()}</span>
                </div>
            </div>
        `;
    });
    return html;
}

// ═══════════════════════════════════════════════════════
// SPACE INTELLIGENCE (MINI WIDGET)
// ═══════════════════════════════════════════════════════

async function loadSpaceLaunches() {
    const container = document.getElementById("launch-mini-container");
    if (!container) return;

    try {
        const res = await fetch("/api/space/launches");
        const data = await res.json();
        const launches = data.results || [];
        
        container.innerHTML = "";
        if (launches.length === 0) {
            container.innerHTML = '<div class="empty-state"><span>NO UPCOMING LAUNCHES</span></div>';
            return;
        }

        launches.slice(0, 5).forEach((launch, i) => {
            const date = new Date(launch.window_start || launch.net);
            const row = document.createElement("div");
            row.className = "trend-row"; 
            row.style.gridTemplateColumns = "1fr 80px";
            row.style.padding = "8px 12px";
            row.innerHTML = `
                <div style="display:flex; flex-direction:column; overflow:hidden;">
                    <div style="font-size:11px; font-weight:700; color:var(--text-0); white-space:nowrap; text-overflow:ellipsis; overflow:hidden;">${escapeHtml(launch.name)}</div>
                    <div style="font-size:9px; color:var(--text-3); font-weight:700; letter-spacing:1px; text-transform:uppercase;">${escapeHtml(launch.launch_service_provider?.name || 'MISSION CONTROL')}</div>
                </div>
                <div style="text-align:right;">
                    <div style="font-size:10px; font-weight:700; color:var(--cyan);">${date.toLocaleDateString('en-GB', {day:'2-digit', month:'short'}).toUpperCase()}</div>
                    <div style="font-size:9px; color:var(--text-3); font-family:var(--font-mono);">${date.toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit', hour12:false})}</div>
                </div>
            `;
            container.appendChild(row);
        });
    } catch (err) {
        console.error("Space launch mini error:", err);
        container.innerHTML = '<div class="empty-state"><span>SYNC FAILED</span></div>';
    }
}
