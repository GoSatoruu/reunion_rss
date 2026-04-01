/**
 * GVBC Reunion — Airline Intelligence Page
 * Full-page flight analytics with interactive map and statistics
 */

let aMap = null;
let aMarkersLayer = null;
let aTileLayer = null;

// ─── Init ────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    startClock();
    initAirlineMap();
    loadFlightDataAndStats();

    // Auto-refresh every 30s (aligned with server cache TTL)
    setInterval(loadFlightDataAndStats, 30000);

    document.getElementById("theme-toggle")?.addEventListener("click", toggleTheme);
});

// ─── Clock ───────────────────────────────────────────
function startClock() {
    const el = document.getElementById("nav-clock");
    if (!el) return;
    function tick() {
        const now = new Date();
        el.textContent = now.toLocaleTimeString("en-GB", { hour12: false }) + " UTC+" +
            String(Math.floor(-now.getTimezoneOffset() / 60)).padStart(2, "0");
    }
    tick();
    setInterval(tick, 1000);
}

// ─── Theme ───────────────────────────────────────────
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
    if (aTileLayer) {
        const tileUrl = newTheme === "light"
            ? "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
            : "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
        aTileLayer.setUrl(tileUrl);
    }
}

// ─── Map Init ────────────────────────────────────────
function initAirlineMap() {
    aMap = L.map("airline-map", {
        center: [25, 10],
        zoom: 3,
        minZoom: 2,
        maxZoom: 14,
        zoomControl: true,
    });

    const isLight = document.documentElement.getAttribute("data-theme") === "light";
    const tileUrl = isLight
        ? "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
        : "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";

    aTileLayer = L.tileLayer(tileUrl, {
        attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
        subdomains: "abcd",
        maxZoom: 19,
    }).addTo(aMap);

    aMarkersLayer = L.layerGroup().addTo(aMap);
}

// ─── Load Data ───────────────────────────────────────
async function loadFlightDataAndStats() {
    try {
        // Fetch flights + stats concurrently
        const [flightsRes, statsRes] = await Promise.allSettled([
            fetch("/api/flights"),
            fetch("/api/flights/stats"),
        ]);

        // Render flights on map
        if (flightsRes.status === "fulfilled" && flightsRes.value.ok) {
            const flightData = await flightsRes.value.json();
            renderFlightsOnMap(flightData.flights || []);
        }

        // Render stats
        if (statsRes.status === "fulfilled" && statsRes.value.ok) {
            const stats = await statsRes.value.json();
            renderKPIs(stats);
            renderCountries(stats.countries || []);
            renderAltitude(stats.altitude_distribution || {});
            renderRegions(stats.regions || {});
            renderCallsigns(stats.top_callsigns || []);
        }

        // Hide loader
        const loader = document.getElementById("airline-loader");
        if (loader) loader.style.display = "none";

        // Update timestamp
        const el = document.getElementById("last-updated");
        if (el) {
            const now = new Date();
            el.textContent = `LAST SYNC: ${now.toLocaleTimeString("en-GB", { hour12: false })}`;
        }

    } catch (e) {
        console.error("[Airline Intel Error]", e);
        const loader = document.getElementById("airline-loader");
        if (loader) loader.innerHTML = "<span>FLIGHT DATA UNAVAILABLE</span>";
    }
}


// ─── Render Flights on Map ───────────────────────────
function renderFlightsOnMap(flights) {
    aMarkersLayer.clearLayers();

    flights.forEach(f => {
        if (f.on_ground) return; // Only show airborne

        const heading = f.heading || 0;
        const alt = f.alt || 0;
        const speed = f.velocity ? `${Math.round(f.velocity * 3.6)} km/h` : "N/A";
        const altStr = alt ? `${Math.round(alt)}m` : "N/A";

        // Color by altitude
        let color;
        if (alt >= 10000) color = "#22c55e";      // cruise — green
        else if (alt >= 3000) color = "#f59e0b";   // climb — amber
        else color = "#ef4444";                     // low — red

        const icon = L.divIcon({
            className: "flight-icon",
            html: `<div style="
                transform: rotate(${heading}deg);
                font-size: 12px;
                color: ${color};
                text-shadow: 0 0 5px ${color}80;
                line-height: 1;
            ">✈</div>`,
            iconSize: [14, 14],
            iconAnchor: [7, 7],
        });

        const marker = L.marker([f.lat, f.lon], { icon }).addTo(aMarkersLayer);
        marker.bindPopup(`
            <div style="font-family:var(--font-mono);font-size:11px;line-height:1.6;">
                <strong style="color:#22d3ee;">${f.callsign || f.icao24}</strong><br>
                🌍 ${f.country}<br>
                📏 ALT: ${altStr}<br>
                ⚡ SPD: ${speed}<br>
                🧭 HDG: ${Math.round(heading)}°
            </div>
        `);
    });
}


// ─── KPI Cards ───────────────────────────────────────
function renderKPIs(stats) {
    document.getElementById("kpi-total").textContent = stats.total_tracked?.toLocaleString() || "—";
    document.getElementById("kpi-airborne").textContent = stats.airborne?.toLocaleString() || "—";
    document.getElementById("kpi-ground").textContent = stats.on_ground?.toLocaleString() || "—";
    document.getElementById("kpi-speed").textContent = stats.avg_speed_kmh?.toLocaleString() || "—";
    document.getElementById("kpi-alt").textContent = stats.avg_altitude_m?.toLocaleString() || "—";
}


// ─── Country Distribution ────────────────────────────
function renderCountries(countries) {
    const container = document.getElementById("airline-countries-body");
    const loading = document.getElementById("countries-stat-loading");
    if (loading) loading.style.display = "none";

    if (!countries.length) {
        container.innerHTML = '<div class="empty-state"><span>NO DATA</span></div>';
        return;
    }

    const maxCount = countries[0]?.count || 1;
    let html = '';
    countries.slice(0, 15).forEach((c, i) => {
        const pct = Math.round((c.count / maxCount) * 100);
        html += `
            <div class="airline-stat-row">
                <span class="stat-rank">${String(i + 1).padStart(2, "0")}</span>
                <span class="stat-name">${escapeHtml(c.country)}</span>
                <span class="stat-count">${c.count.toLocaleString()}</span>
                <div class="stat-bar-cell">
                    <div class="stat-bar" style="width:${pct}%"></div>
                </div>
            </div>
        `;
    });
    container.innerHTML = html;
}


// ─── Altitude Distribution ───────────────────────────
function renderAltitude(altDist) {
    const container = document.getElementById("airline-alt-body");
    const loading = document.getElementById("alt-stat-loading");
    if (loading) loading.style.display = "none";

    const entries = Object.entries(altDist);
    const maxVal = Math.max(...entries.map(([, v]) => v), 1);

    let html = '<div class="alt-chart-wrap">';
    entries.forEach(([label, count], i) => {
        const pct = Math.round((count / maxVal) * 100);
        html += `
            <div class="alt-chart-row">
                <span class="alt-label">${label}</span>
                <div class="alt-bar-track">
                    <div class="alt-bar-fill alt-${i}" style="width:${pct}%"></div>
                </div>
                <span class="alt-count">${count.toLocaleString()}</span>
            </div>
        `;
    });
    html += '</div>';
    container.innerHTML = html;
}


// ─── Region Distribution ─────────────────────────────
function renderRegions(regions) {
    const container = document.getElementById("airline-region-body");
    const loading = document.getElementById("region-stat-loading");
    if (loading) loading.style.display = "none";

    const entries = Object.entries(regions).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    const maxVal = entries.length ? entries[0][1] : 1;
    const regionIcons = {
        "North America": "🌎", "South America": "🌎", "Europe": "🌍",
        "Asia": "🌏", "Middle East": "🕌", "Africa": "🌍",
        "Oceania": "🌏", "Other": "🌐"
    };

    let html = '';
    entries.forEach(([ name, count ], i) => {
        const pct = Math.round((count / maxVal) * 100);
        html += `
            <div class="airline-stat-row">
                <span class="stat-rank">${regionIcons[name] || "🌐"}</span>
                <span class="stat-name">${escapeHtml(name)}</span>
                <span class="stat-count">${count.toLocaleString()}</span>
                <div class="stat-bar-cell">
                    <div class="stat-bar" style="width:${pct}%"></div>
                </div>
            </div>
        `;
    });
    container.innerHTML = html;
}


// ─── Active Callsigns ────────────────────────────────
function renderCallsigns(callsigns) {
    const container = document.getElementById("airline-callsigns-body");
    const loading = document.getElementById("callsigns-stat-loading");
    if (loading) loading.style.display = "none";

    if (!callsigns.length) {
        container.innerHTML = '<div class="empty-state"><span>NO CALLSIGNS</span></div>';
        return;
    }

    let html = '<div class="callsign-grid">';
    callsigns.slice(0, 20).forEach(cs => {
        html += `<div class="callsign-chip">${escapeHtml(cs.callsign)}</div>`;
    });
    html += '</div>';
    container.innerHTML = html;
}


// ─── Helpers ─────────────────────────────────────────
function escapeHtml(text) {
    const el = document.createElement("span");
    el.textContent = text;
    return el.innerHTML;
}
