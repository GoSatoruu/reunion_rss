/**
 * GVBC Reunion — Logistics Intelligence Page
 * Full-page maritime tracking and analytics platform.
 */

let lMap = null;
let lMarkersLayer = null;
let lTileLayer = null;

// ─── Init ────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    startClock();
    initLogisticsMap();
    loadVesselDataAndStats();

    // Auto-refresh every 30s
    setInterval(loadVesselDataAndStats, 30000);

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
    if (lTileLayer) {
        const tileUrl = newTheme === "light"
            ? "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
            : "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
        lTileLayer.setUrl(tileUrl);
    }
}

// ─── Map Init ────────────────────────────────────────
function initLogisticsMap() {
    lMap = L.map("logistics-map", {
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

    lTileLayer = L.tileLayer(tileUrl, {
        attribution: '&copy; CARTO | Syntheset Maritime',
        subdomains: "abcd",
        maxZoom: 19,
    }).addTo(lMap);

    lMarkersLayer = L.layerGroup().addTo(lMap);
}

// ─── Load Data ───────────────────────────────────────
async function loadVesselDataAndStats() {
    try {
        const [vesselsRes, statsRes] = await Promise.allSettled([
            fetch("/api/vessels"),
            fetch("/api/vessels/stats"),
        ]);

        // Render vessels on map
        if (vesselsRes.status === "fulfilled" && vesselsRes.value.ok) {
            const data = await vesselsRes.value.json();
            renderVesselsOnMap(data.vessels || []);
        }

        // Render stats
        if (statsRes.status === "fulfilled" && statsRes.value.ok) {
            const stats = await statsRes.value.json();
            renderKPIs(stats);
            renderTypes(stats.types || []);
            renderFlags(stats.flags || []);
            renderChokePoints(stats.choke_points || []);
        }

        // Hide loader
        const loader = document.getElementById("logistics-loader");
        if (loader) loader.style.display = "none";

        // Update timestamp
        const el = document.getElementById("last-updated");
        if (el) {
            const now = new Date();
            el.textContent = `LAST SYNC: ${now.toLocaleTimeString("en-GB", { hour12: false })}`;
        }

    } catch (e) {
        console.error("[Logistics Intel Error]", e);
        const loader = document.getElementById("logistics-loader");
        if (loader) loader.innerHTML = "<span style='color:#ef4444;'>MARITIME FEED UNAVAILABLE</span>";
    }
}


// ─── Render Vessels on Map ───────────────────────────
function renderVesselsOnMap(vessels) {
    lMarkersLayer.clearLayers();

    vessels.forEach(v => {
        let color, symbol;
        switch (v.type) {
            case "Cargo": color = "#f97316"; symbol = "🚢"; break;
            case "Tanker": color = "#a855f7"; symbol = "⛽"; break;
            case "Passenger": color = "#3b82f6"; symbol = "🛳️"; break;
            case "Fishing": color = "#22c55e"; symbol = "🎣"; break;
            case "Military": color = "#6b7280"; symbol = "⚓"; break;
            default: color = "#a1a1aa"; symbol = "⛴️"; break;
        }

        // Only rotate if underway
        const rotation = v.status === "Underway" ? v.heading : 0;
        const opacity = v.status === "Underway" ? 1 : 0.6;

        // Custom div icon using SVG triangle for heading visualization
        const iconHtml = `
            <div style="
                transform: rotate(${rotation}deg);
                width: 14px; height: 14px;
                opacity: ${opacity};
                display: flex; align-items: center; justify-content: center;
            ">
                <svg viewBox="0 0 24 24" fill="${color}" stroke="#111" stroke-width="1.5" style="width:100%;height:100%;">
                    <path d="M12 2L4 20L12 17L20 20L12 2Z"></path>
                </svg>
            </div>
        `;

        const icon = L.divIcon({
            className: "vessel-icon",
            html: iconHtml,
            iconSize: [14, 14],
            iconAnchor: [7, 7],
        });

        const marker = L.marker([v.lat, v.lon], { icon }).addTo(lMarkersLayer);
        marker.bindPopup(`
            <div style="font-family:var(--font-mono);font-size:11px;line-height:1.6;">
                <strong style="color:#f59e0b;">${v.name}</strong> (${v.type})<br>
                MMSI: ${v.mmsi}<br>
                🏳️ <strong>${v.flag}</strong><br>
                ⚡ SPD: ${v.speed} kn - 🧭 HDG: ${v.heading}°<br>
                STATUS: ${v.status}
            </div>
        `);
    });
}


// ─── KPI Cards ───────────────────────────────────────
function renderKPIs(stats) {
    document.getElementById("kpi-total").textContent = stats.total_tracked?.toLocaleString() || "—";
    document.getElementById("kpi-underway").textContent = stats.underway?.toLocaleString() || "—";
    document.getElementById("kpi-moored").textContent = stats.moored?.toLocaleString() || "—";
    document.getElementById("kpi-speed").textContent = stats.avg_speed_knots?.toLocaleString() || "—";
    document.getElementById("kpi-teu").textContent = (stats.est_teu_volume / 1000).toFixed(1) + "k" || "—";
}


// ─── Type Distribution ───────────────────────────────
function renderTypes(types) {
    const container = document.getElementById("logistics-types-body");
    const loading = document.getElementById("types-loading");
    if (loading) loading.style.display = "none";

    const maxVal = Math.max(...types.map(t => t.count), 1);
    let html = '<div class="dist-chart-wrap">';
    
    types.forEach(t => {
        const pct = Math.round((t.count / maxVal) * 100);
        html += `
            <div class="dist-chart-row">
                <span class="dist-label">${t.type}</span>
                <div class="dist-bar-track">
                    <div class="dist-bar-fill type-${t.type.replace(/\s/g, '')}" style="width:${pct}%"></div>
                </div>
                <span class="dist-count">${t.count.toLocaleString()}</span>
            </div>
        `;
    });
    html += '</div>';
    container.innerHTML = html;
}


// ─── Top Flags ───────────────────────────────────────
function renderFlags(flags) {
    const container = document.getElementById("logistics-flags-body");
    const loading = document.getElementById("flags-loading");
    if (loading) loading.style.display = "none";

    if (!flags.length) return;

    const maxCount = flags[0].count;
    let html = '';
    flags.slice(0, 10).forEach((f, i) => {
        const pct = Math.round((f.count / maxCount) * 100);
        html += `
            <div class="logistics-stat-row">
                <span class="stat-rank">${String(i + 1).padStart(2, "0")}</span>
                <span class="stat-name">${escapeHtml(f.flag)}</span>
                <span class="stat-count">${f.count.toLocaleString()}</span>
                <div class="stat-bar-cell">
                    <div class="stat-bar" style="width:${pct}%; background: linear-gradient(90deg, #f59e0b, #fbbf24);"></div>
                </div>
            </div>
        `;
    });
    container.innerHTML = html;
}


// ─── Choke Points ────────────────────────────────────
function renderChokePoints(points) {
    const container = document.getElementById("logistics-choke-body");
    const loading = document.getElementById("choke-loading");
    if (loading) loading.style.display = "none";

    // Sort descending
    points.sort((a, b) => b.count - a.count);
    const maxCount = points[0]?.count || 1;

    let html = '';
    points.forEach((p, i) => {
        const pct = Math.round((p.count / maxCount) * 100);
        
        // Color based on congestion level
        let color = "#22c55e"; // Green/low
        if (pct > 75) color = "#ef4444"; // Red/high
        else if (pct > 40) color = "#f59e0b"; // Amber/med

        html += `
            <div class="logistics-stat-row">
                <span class="stat-rank">⚠️</span>
                <span class="stat-name">${escapeHtml(p.name)}</span>
                <span class="stat-count" style="color:${color};">${p.count.toLocaleString()} / HR</span>
                <div class="stat-bar-cell">
                    <div class="stat-bar" style="width:${pct}%; background: ${color}; opacity: 0.8;"></div>
                </div>
            </div>
        `;
    });
    container.innerHTML = html;
}

// ─── Helpers ─────────────────────────────────────────
function escapeHtml(text) {
    const el = document.createElement("span");
    el.textContent = text;
    return el.innerHTML;
}
