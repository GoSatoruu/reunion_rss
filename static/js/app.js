/**
 * GVBC Reunion — Dashboard Logic
 * Palantir-style intelligence dashboard
 */

// ─── State ───────────────────────────────────────────
let flightMap = null;
let flightMarkersLayer = null;
let flightRefreshTimer = null;

// ─── Initialization ──────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    startClock();
    loadFeed();
    loadTrending();
    loadCountries();
    initFlightMap();
    loadFlights();

    document.getElementById("btn-refresh-feed").addEventListener("click", () => {
        loadFeed();
        loadTrending();
        loadCountries();
    });
    document.getElementById("btn-refresh-flights").addEventListener("click", loadFlights);

    // Auto-refresh
    flightRefreshTimer = setInterval(loadFlights, 15000);
});

// ─── Clock ───────────────────────────────────────────
function startClock() {
    const el = document.getElementById("nav-clock");
    function tick() {
        const now = new Date();
        el.textContent = now.toLocaleTimeString("en-GB", { hour12: false }) + " UTC+" +
            String(Math.floor(-now.getTimezoneOffset() / 60)).padStart(2, "0");
    }
    tick();
    setInterval(tick, 1000);
}

// ─── Trending Board ──────────────────────────────────
async function loadTrending() {
    const container = document.getElementById("trending-container");
    const loading = document.getElementById("trending-loading");

    try {
        const res = await fetch("/api/trending");
        const data = await res.json();
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
        const res = await fetch("/api/countries");
        const data = await res.json();
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

// ─── News Feed ───────────────────────────────────────
async function loadFeed() {
    const container = document.getElementById("feed-container");
    const loading = document.getElementById("feed-loading");
    const empty = document.getElementById("feed-empty");

    loading.style.display = "flex";
    empty.style.display = "none";
    container.querySelectorAll(".feed-card").forEach(c => c.remove());

    try {
        const res = await fetch("/api/feed");
        const articles = await res.json();
        loading.style.display = "none";

        document.getElementById("feed-count").textContent = `${articles.length} ITEMS`;

        if (!articles.length) {
            empty.style.display = "flex";
            return;
        }

        articles.forEach((article, i) => {
            const card = document.createElement("a");
            card.className = "feed-card";
            card.href = article.link;
            card.target = "_blank";
            card.rel = "noopener noreferrer";
            card.style.animationDelay = `${i * 0.03}s`;

            const tempDiv = document.createElement("div");
            tempDiv.innerHTML = article.summary || "";
            const cleanSummary = tempDiv.textContent || tempDiv.innerText || "";

            card.innerHTML = `
                <div class="feed-card-source">
                    <span class="source-dot"></span>
                    ${escapeHtml(article.source)}
                </div>
                <div class="feed-card-title">${escapeHtml(article.title)}</div>
                <div class="feed-card-summary">${escapeHtml(cleanSummary)}</div>
                <div class="feed-card-meta">
                    <span>${formatDate(article.published)}</span>
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

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
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
