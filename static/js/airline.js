/**
 * GVBC Reunion — Airline Intelligence Page
 * Full-page flight analytics with interactive map and statistics
 * Supports: OpenSky Network, FlightRadar24, Local Simulator
 */

let aMap = null;
let aMarkersLayer = null;
let aTileLayer = null;
let currentProvider = "opensky";

// ─── Init ────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    startClock();
    initAirlineMap();
    loadFlightDataAndStats();

    // Auto-refresh every 15s for FR24, 30s for others
    setInterval(loadFlightDataAndStats, 15000);

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
        const res = await fetch("/api/flights");

        if (res.ok) {
            const flightData = await res.json();
            const flights = flightData.flights || [];
            currentProvider = flightData.provider || "opensky";

            // Render flights on map
            renderFlightsOnMap(flights);

            // Compute stats client-side using Intel.js
            const stats = Intel.getFlightStats(flights);
            renderKPIs(stats);
            renderCountries(stats.countries || []);
            renderAltitude(stats.altitude_distribution || {});
            renderRegions(stats.regions || {});
            renderCallsigns(stats.top_callsigns || []);

            // Update providers info strip
            updateProviderBadge(currentProvider, flights.length);

            // Render FR24 enriched data (route info) if available
            if (currentProvider === "flightradar24") {
                renderTopRoutes(flights);
            }
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

        // Build enriched popup for FR24 data
        let popupExtra = "";
        if (f.origin && f.destination) {
            popupExtra += `<br>✈ ${f.origin} → ${f.destination}`;
        }
        if (f.aircraft_code) {
            popupExtra += `<br>🛩️ ${f.aircraft_code}`;
        }
        if (f.registration) {
            popupExtra += `<br>📋 REG: ${f.registration}`;
        }

        const marker = L.marker([f.lat, f.lon], { icon }).addTo(aMarkersLayer);
        marker.bindPopup(`
            <div style="font-family:var(--font-mono);font-size:11px;line-height:1.6;">
                <strong style="color:#22d3ee;">${f.callsign || f.icao24}</strong><br>
                🌍 ${f.country}${popupExtra}<br>
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


// ─── Top Routes (FR24 enriched data) ─────────────────
function renderTopRoutes(flights) {
    const panel = document.getElementById("airline-routes-panel");
    if (!panel) return;

    const routeCounts = {};
    flights.forEach(f => {
        if (f.origin && f.destination) {
            const route = `${f.origin} → ${f.destination}`;
            routeCounts[route] = (routeCounts[route] || 0) + 1;
        }
    });

    const topRoutes = Object.entries(routeCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12);

    const body = panel.querySelector(".panel-body") || panel;
    const loading = panel.querySelector(".panel-loading");
    if (loading) loading.style.display = "none";

    if (!topRoutes.length) {
        body.innerHTML = '<div class="empty-state"><span>NO ROUTE DATA</span></div>';
        return;
    }

    const maxCount = topRoutes[0][1];
    let html = '';
    topRoutes.forEach(([route, count], i) => {
        const pct = Math.round((count / maxCount) * 100);
        html += `
            <div class="airline-stat-row">
                <span class="stat-rank">${String(i + 1).padStart(2, "0")}</span>
                <span class="stat-name">${escapeHtml(route)}</span>
                <span class="stat-count">${count}</span>
                <div class="stat-bar-cell">
                    <div class="stat-bar" style="width:${pct}%"></div>
                </div>
            </div>
        `;
    });
    body.innerHTML = html;
}


// ─── Provider Badge ──────────────────────────────────
function updateProviderBadge(provider, count) {
    const providerNames = {
        "opensky": "OPENSKY NETWORK",
        "flightradar24": "FLIGHTRADAR24",
        "mock": "LOCAL SIMULATOR",
        "error": "ERROR — OFFLINE"
    };

    const footerSpan = document.querySelector("#status-bar .status-left span");
    if (footerSpan) {
        footerSpan.textContent = `AIRLINE INTELLIGENCE MODULE — ${providerNames[provider] || provider.toUpperCase()} — ${count.toLocaleString()} TRACKED`;
    }

    // Update map header with provider badge
    const providerBadge = document.getElementById("provider-badge");
    if (providerBadge) {
        const color = provider === "flightradar24" ? "#f59e0b" 
                    : provider === "opensky" ? "#22c55e" 
                    : provider === "mock" ? "#8b5cf6" 
                    : "#ef4444";
        providerBadge.innerHTML = `<span style="color:${color};font-weight:700;letter-spacing:1px;">${providerNames[provider] || "UNKNOWN"}</span>`;
    }

    // Show/hide FR24 routes panel
    const routesPanel = document.getElementById("airline-routes-panel");
    if (routesPanel) {
        routesPanel.style.display = (provider === "flightradar24") ? "block" : "none";
    }
}


// ─── Helpers ─────────────────────────────────────────
function escapeHtml(text) {
    const el = document.createElement("span");
    el.textContent = text;
    return el.innerHTML;
}
