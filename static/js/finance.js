/**
 * GVBC Reunion — Finance Intelligence Logic
 */

document.addEventListener("DOMContentLoaded", async () => {
    initTheme();
    startClock();
    
    // Mount TradingView Chart
    initTradingView();
    
    // Load Data
    await Promise.all([
        loadIntelligence(),
        loadVNIndex(),
        loadGlobalFxAndCommodities(),
        loadMacroAlerts()
    ]);
    
    document.getElementById("finance-loader").style.display = "none";
    document.getElementById("theme-toggle")?.addEventListener("click", toggleTheme);
    
    // Refresh intervals
    setInterval(loadIntelligence, 60000);
    setInterval(loadVNIndex, 60000);
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
    
    // Re-init chart for theme change
    initTradingView();
}

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

// ─── Backend Factor Grid ───────────────────────────

async function initTradingView() {
    await loadFactorGrid();
}

async function loadFactorGrid() {
    try {
        const grid = document.getElementById("factors-grid");
        if (!grid) return;
        
        const res = await fetch("/api/finance/factors");
        const data = await res.json();
        if (data.status !== "success" || !data.factors) return;

        let html = "";
        data.factors.forEach(f => {
            const isUp = f.change >= 0;
            const color = isUp ? "#10b981" : "#ef4444";
            const sign = isUp ? "+" : "";
            const absChange = Math.abs(f.percent_change).toFixed(2);
            const trendIcon = isUp ? "▲" : "▼";

            html += `
                <div class="factor-card" id="fcard-${f.id}">
                    <div class="factor-header" onclick="toggleSize('fcard-${f.id}')">
                        <span>${f.name}</span><button class="resize-btn">⤢</button>
                    </div>
                    <div class="factor-data-block" style="flex:1; display:flex; flex-direction:column; justify-content:center; align-items:flex-end; padding: 12px 16px; background:var(--bg-0);">
                        <div style="font-size:2rem; font-family:'JetBrains Mono', monospace; font-weight:300; color:var(--text-0); line-height:1.2;">
                            ${f.price.toLocaleString("en-US", {minimumFractionDigits: 2})} <span style="font-size:0.8rem; color:var(--text-3); font-weight:700;">${f.unit}</span>
                        </div>
                        <div style="font-size:1.1rem; font-family:'JetBrains Mono', monospace; font-weight:600; color:${color}; margin-top:4px;">
                            ${sign}${f.change.toLocaleString("en-US", {minimumFractionDigits: 2})} (${trendIcon}${absChange}%)
                        </div>
                    </div>
                </div>
            `;
        });
        
        grid.innerHTML = html;
        
    } catch (e) {
        console.error("Factor Grid Error", e);
    }
}

window.toggleSize = function(cardId) {
    const card = document.getElementById(cardId);
    if (!card) return;

    if (!card.hasAttribute("data-state")) card.setAttribute("data-state", "0");
    let state = parseInt(card.getAttribute("data-state"));
    state = (state + 1) % 4;
    card.setAttribute("data-state", state.toString());

    card.classList.remove("expand-h", "expand-v", "expand-full");
    
    if (state === 1) card.classList.add("expand-h");
    else if (state === 2) card.classList.add("expand-v");
    else if (state === 3) card.classList.add("expand-full");
}

// ─── Intelligence & Movers ───────────────────────────
async function loadIntelligence() {
    try {
        const res = await fetch("/api/finance/intelligence");
        const data = await res.json();
        
        let sentimentEl = document.getElementById("kpi-sentiment");
        let stanceEl = document.getElementById("kpi-stance");
        
        sentimentEl.textContent = data.sentiment_score + "/100";
        stanceEl.textContent = data.stance;
        
        if (data.stance.includes("BULLISH")) {
            stanceEl.style.color = "#10b981";
        } else if (data.stance.includes("BEARISH")) {
            stanceEl.style.color = "#ef4444";
        } else {
            stanceEl.style.color = "#f59e0b";
        }

        // --- Detail Sentiment Panel ---
        const techEl = document.getElementById("sent-tech");
        const newsEl = document.getElementById("sent-news");
        const sentBar = document.getElementById("sent-bar");
        
        if (techEl) {
            techEl.textContent = data.tech_sentiment + "/100";
            techEl.style.color = data.tech_sentiment >= 55 ? "#10b981" : (data.tech_sentiment <= 45 ? "#ef4444" : "#f59e0b");
        }
        if (newsEl) {
            newsEl.textContent = data.news_sentiment + "/100";
            newsEl.style.color = data.news_sentiment >= 55 ? "#10b981" : (data.news_sentiment <= 45 ? "#ef4444" : "#f59e0b");
        }
        if (sentBar) {
            sentBar.style.width = data.sentiment_score + "%";
            if (data.sentiment_score >= 55) sentBar.style.background = "#10b981";
            else if (data.sentiment_score <= 45) sentBar.style.background = "#ef4444";
            else sentBar.style.background = "#f59e0b";
        }

        // Top Movers
        const moversBody = document.getElementById("finance-movers-body");
        if (data.top_movers && data.top_movers.length > 0) {
            let html = "";
            data.top_movers.forEach((m, i) => {
                const isUp = m.change >= 0;
                const color = isUp ? "#10b981" : "#ef4444";
                const sign = isUp ? "+" : "";
                html += `
                    <div class="finance-stat-row">
                        <span class="stat-rank">${String(i+1).padStart(2,'0')}</span>
                        <div style="display:flex; flex-direction:column;">
                            <span class="stat-name">${m.symbol}</span>
                            <span style="font-size:9px; color:var(--text-3);">${m.name}</span>
                        </div>
                        <span class="stat-val" style="color:${color};">${sign}${m.percent_change.toFixed(2)}%</span>
                    </div>
                `;
            });
            moversBody.innerHTML = html;
        } else {
            moversBody.innerHTML = '<div class="empty-state"><span>INSUFFICIENT DATA</span></div>';
        }

        // Media Quotes
        const quotesBody = document.getElementById("finance-quotes-body");
        if (data.media_quotes && data.media_quotes.length > 0) {
            let html = "";
            data.media_quotes.forEach((q, i) => {
                html += `
                    <div class="finance-stat-row">
                        <span class="stat-rank">${String(i+1).padStart(2,'0')}</span>
                        <div style="display:flex; flex-direction:column;">
                            <span class="stat-name">${q.symbol}</span>
                            <span style="font-size:9px; color:var(--text-3);">TICKER MENTION</span>
                        </div>
                        <span class="stat-val" style="color:var(--text-1);">${q.mentions} MSG</span>
                    </div>
                `;
            });
            if (quotesBody) quotesBody.innerHTML = html;
        } else {
            if (quotesBody) quotesBody.innerHTML = '<div class="empty-state"><span>NO QUOTES FOUND</span></div>';
        }
    } catch(e) {
        console.error("Intel Error", e);
    }
}

// ─── VN-INDEX KPI ────────────────────────────────────
async function loadVNIndex() {
    try {
        const res = await fetch("/api/finance/vnindex");
        const data = await res.json();
        if (data && data.price) {
            const el = document.getElementById("kpi-vnindex");
            el.textContent = data.price.toLocaleString("en-US", {minimumFractionDigits: 2});
            if (data.change >= 0) el.style.color = "#10b981";
            else el.style.color = "#ef4444";
        }
    } catch(e) {}
}

// ─── Global FX & Gold ────────────────────────────────
async function loadGlobalFxAndCommodities() {
    try {
        const res = await fetch("/api/finance/global");
        const data = await res.json();
        
        if (data.commodities) {
            const gold = data.commodities.find(c => c.symbol === "GC=F");
            if (gold) {
                const el = document.getElementById("kpi-gold");
                el.textContent = "$" + gold.price.toLocaleString("en-US", {minimumFractionDigits: 2});
                el.style.color = gold.change >= 0 ? "#10b981" : "#ef4444";
            }
        }
        
        if (data.forex) {
            const usd = data.forex.find(c => c.symbol === "USDVND=X");
            if (usd) {
                const el = document.getElementById("kpi-fx");
                el.textContent = usd.price.toLocaleString("en-US", {minimumFractionDigits: 0});
                el.style.color = usd.change >= 0 ? "#10b981" : "#ef4444";
            }
        }
    } catch(e) {}
}

// ─── Macro Alerts ────────────────────────────────────
async function loadMacroAlerts() {
    try {
        const res = await fetch("/api/finance/macro");
        const data = await res.json();
        
        const macroBody = document.getElementById("finance-macro-body");
        let html = "";
        
        // Grab some important ones
        const alerts = [];
        if(data.global && data.global.length) {
            alerts.push(data.global[0]); // FED RATE
            alerts.push(data.global[1]); // US CPI
        }
        if(data.vietnam && data.vietnam.length > 2) {
            alerts.push(data.vietnam[0]); // VN GDP
            alerts.push(data.vietnam[2]); // VN INFLATION
        }
        if(data.rates && data.rates.length) {
            alerts.push(data.rates[0]); // US 10Y
            alerts.push(data.rates[1]); // VN 10Y
        }
        
        alerts.forEach(a => {
            const trendColor = a.trend === "up" ? "#ff4d4d" : (a.trend === "down" ? "#22c55e" : "#f59e0b");
            // Reverse color for GDP/Growth
            let actualColor = trendColor;
            if(a.label.includes("GROWTH")) {
                 actualColor = a.trend === "up" ? "#22c55e" : "#ff4d4d";
            }
            
            html += `
                <div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg-1); border:1px solid var(--border); padding:8px 12px; border-radius:4px;">
                    <div style="display:flex; flex-direction:column;">
                        <span style="font-size:10px; font-weight:700; color:var(--text-1);">${a.icon} ${a.label}</span>
                        <span style="font-size:9px; color:var(--text-3);">${a.sublabel}</span>
                    </div>
                    <div style="font-family:'JetBrains Mono',monospace; font-weight:700; font-size:14px; color:${actualColor};">
                        ${a.value}${a.unit}
                    </div>
                </div>
            `;
        });
        
        macroBody.innerHTML = html;
        
    } catch(e) {
        document.getElementById("finance-macro-body").innerHTML = '<div class="empty-state"><span>NO DATA</span></div>';
    }
}
