/**
 * GVBC Reunion — Social Listening Dashboard (v2.0)
 * Financial Signal Intelligence: ASI, FOMO/FUD Radar, Flash Alerts
 * Implements algorithms from social.md specification
 */

document.addEventListener("DOMContentLoaded", () => {
    initTheme();

    // ── LLM Analysis Buttons ──────────────────────────
    document.querySelectorAll(".ai-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const type = btn.getAttribute("data-type");
            const labels = {
                summary: "Requesting Executive Summary via LLM...",
                sentiment: "Requesting Sentiment Report via LLM...",
                entities: "Requesting Entity Extraction via LLM..."
            };
            runAnalysis(type, labels[type]);
        });
    });

    // ── Scan RSS Button ───────────────────────────────
    document.getElementById("btn-scan-rss")?.addEventListener("click", async () => {
        const status = document.getElementById("scan-status");
        status.textContent = "⚡ Scanning RSS feeds...";
        appendMessage("user", "Initiating RSS feed scan with rule-based financial extractor...");

        try {
            const res = await fetch("/api/social/scan", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ use_llm: false })
            });
            const data = await res.json();

            if (data.status === "success") {
                status.textContent = `✅ Scanned ${data.articles_processed} articles → ${data.records_created} records created`;
                appendMessage("ai",
                    `**RSS Scan Complete**\n\n` +
                    `- Articles processed: **${data.articles_processed}**\n` +
                    `- Records created: **${data.records_created}**\n` +
                    `- Assets detected: ${data.records?.map(r => r.asset_symbol).filter((v, i, a) => a.indexOf(v) === i).join(", ") || "None"}\n\n` +
                    `Dashboard refreshing...`
                );
                // Refresh dashboard
                await loadDashboard();
            } else {
                status.textContent = `❌ Error: ${data.error || "Unknown"}`;
                appendMessage("ai", `**Scan Error:** ${data.error || "Unknown error"}`);
            }
        } catch (e) {
            status.textContent = `❌ Connection error: ${e.message}`;
            appendMessage("ai", `**Connection Error:** ${e.message}`);
        }
    });

    // ── Mock Data Button ──────────────────────────────
    document.getElementById("btn-generate-mock")?.addEventListener("click", async () => {
        const status = document.getElementById("scan-status");
        status.textContent = "🎲 Generating mock financial signals...";
        appendMessage("user", "Generating mock social listening data for demonstration...");

        try {
            const res = await fetch("/api/social/mock", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ count: 80 })
            });
            const data = await res.json();

            if (data.status === "success") {
                status.textContent = `✅ Generated ${data.records_generated} mock records`;
                appendMessage("ai",
                    `**Mock Data Generated**\n\n` +
                    `- Records created: **${data.records_generated}**\n` +
                    `- Sources: X, Telegram, Reddit, CafeF, Bloomberg RSS, F319, FireAnt, Discord\n` +
                    `- Assets: BTC, ETH, NVDA, TSLA, VHM, FPT, HPG, SOL, AAPL, GOLD, VNINDEX, SSI\n\n` +
                    `Dashboard refreshing...`
                );
                await loadDashboard();
            } else {
                status.textContent = `❌ Error: ${data.error || "Unknown"}`;
            }
        } catch (e) {
            status.textContent = `❌ Connection error: ${e.message}`;
        }
    });

    // ── Theme Toggle ──────────────────────────────────
    document.getElementById("theme-toggle")?.addEventListener("click", toggleTheme);

    // ── Initial Load ──────────────────────────────────
    loadDashboard();

    // ── Auto-refresh every 60 seconds ─────────────────
    setInterval(loadDashboard, 60000);
});


// ═══════════════════════════════════════════════════════
// Dashboard Data Loading
// ═══════════════════════════════════════════════════════

async function loadDashboard() {
    try {
        const res = await fetch("/api/social/dashboard");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        renderMetrics(data);
        renderHotAssets(data.hot_assets || []);
        renderRadar(data.fud_fomo_radar || []);
        renderAlerts(data.alerts || []);
        renderSources(data.sources || []);
        renderTopics(data.topics || []);
        renderMoodDonut(data.market_mood || {});
        renderSentimentChart(data.sentiment_timeline || []);

        const statusEl = document.getElementById("ai-status");
        if (statusEl) {
            statusEl.textContent = "LIVE";
            statusEl.style.color = "var(--green)";
        }
    } catch (e) {
        console.error("[SOCIAL] Dashboard load error:", e);
        const statusEl = document.getElementById("ai-status");
        if (statusEl) {
            statusEl.textContent = "OFFLINE";
            statusEl.style.color = "var(--red)";
        }
    }
}


// ═══════════════════════════════════════════════════════
// Render Functions
// ═══════════════════════════════════════════════════════

function renderMetrics(data) {
    // Records count
    const recordsEl = document.getElementById("mc-records-val");
    if (recordsEl) recordsEl.textContent = data.total_records_1h || 0;

    // Overall ASI
    const asiEl = document.getElementById("mc-asi-val");
    const asiCard = document.getElementById("mc-asi");
    if (asiEl) {
        const asi = data.overall_asi || 0;
        asiEl.textContent = (asi >= 0 ? "+" : "") + asi.toFixed(3);
        if (asiCard) {
            asiCard.className = `metric-card ${asi > 0.1 ? "mc-bullish" : asi < -0.1 ? "mc-bearish" : "mc-neutral"}`;
        }
    }

    // Bull/Bear percentages
    const mood = data.market_mood || {};
    const bullEl = document.getElementById("mc-bull-val");
    const bearEl = document.getElementById("mc-bear-val");
    const bullCard = document.getElementById("mc-bull");
    const bearCard = document.getElementById("mc-bear");

    if (bullEl) bullEl.textContent = `${(mood.bullish_pct || 0).toFixed(1)}%`;
    if (bearEl) bearEl.textContent = `${(mood.bearish_pct || 0).toFixed(1)}%`;
    if (bullCard) bullCard.className = "metric-card mc-bullish";
    if (bearCard) bearCard.className = "metric-card mc-bearish";

    // Alerts
    const alertsEl = document.getElementById("mc-alerts-val");
    const alertsCard = document.getElementById("mc-alerts");
    const alertCount = (data.alerts || []).length;
    if (alertsEl) alertsEl.textContent = alertCount;
    if (alertsCard) {
        alertsCard.className = `metric-card ${alertCount > 0 ? "mc-alert" : "mc-neutral"}`;
    }
}


function renderHotAssets(assets) {
    const container = document.getElementById("hot-assets-list");
    const badge = document.getElementById("hot-asset-count");
    if (!container) return;

    if (badge) badge.textContent = assets.length;

    if (!assets.length) {
        container.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--text-3); font-size: 11px;">No data — run a scan first</div>`;
        return;
    }

    const maxVol = Math.max(...assets.map(a => a.volume), 1);

    container.innerHTML = assets.map((a, i) => {
        const sentiment = a.avg_sentiment || 0;
        const barClass = sentiment > 0.1 ? "bar-bull" : sentiment < -0.1 ? "bar-bear" : "bar-neutral";
        const barWidth = Math.round((a.volume / maxVol) * 100);
        const fomoColor = a.fomo_index > 1 ? "var(--red)" :
                          a.fomo_index < -1 ? "var(--cyan)" : "var(--text-2)";

        return `<div class="hot-asset-row">
            <span class="ha-rank">${i + 1}</span>
            <span class="ha-symbol">${a.asset}</span>
            <span class="ha-volume">${a.volume} hits</span>
            <span class="ha-fomo" style="color: ${fomoColor}">${a.fomo_index > 0 ? "+" : ""}${a.fomo_index}</span>
            <div class="ha-bar-cell">
                <div class="ha-bar ${barClass}" style="width: ${barWidth}%"></div>
            </div>
        </div>`;
    }).join("");
}


function renderRadar(radarData) {
    const container = document.getElementById("radar-list");
    if (!container) return;

    if (!radarData.length) {
        container.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--text-3); font-size: 11px;">No extreme signals detected</div>`;
        return;
    }

    const maxIdx = Math.max(...radarData.map(r => Math.abs(r.extreme_index)), 1);

    container.innerHTML = radarData.map(r => {
        const isFomo = r.extreme_index > 0;
        const pct = Math.min(Math.abs(r.extreme_index) / maxIdx * 50, 50);
        const signalClass = isFomo ? "signal-fomo" : Math.abs(r.extreme_index) <= 3 ? "signal-stable" : "signal-fud";
        const signalText = r.signal;

        let gaugeHtml;
        if (isFomo) {
            gaugeHtml = `<div class="radar-gauge-fill gauge-fomo" style="width: ${pct}%;"></div>`;
        } else {
            gaugeHtml = `<div class="radar-gauge-fill gauge-fud" style="width: ${pct}%; right: ${50 - pct}%;"></div>`;
        }

        return `<div class="radar-row">
            <span class="radar-asset">${r.asset}</span>
            <div class="radar-gauge">
                ${gaugeHtml}
                <div class="radar-gauge-center"></div>
            </div>
            <span class="radar-signal ${signalClass}">${signalText}</span>
        </div>`;
    }).join("");
}


function renderAlerts(alerts) {
    const container = document.getElementById("alerts-list");
    const badge = document.getElementById("alert-count-badge");
    if (!container) return;

    if (badge) badge.textContent = alerts.length;

    if (!alerts.length) {
        container.innerHTML = `<div class="alert-card">
            <span class="alert-icon">🔇</span>
            <div class="alert-body">
                <div class="alert-title" style="color: var(--text-3);">No alerts detected</div>
                <div class="alert-detail">System monitoring for anomalies...</div>
            </div>
        </div>`;
        return;
    }

    container.innerHTML = alerts.slice(-8).reverse().map(a => {
        const icon = a.type === "PUMP_SIGNAL" ? "🚀" : "💥";
        const typeLabel = a.type === "PUMP_SIGNAL" ? "PUMP SIGNAL" : "PANIC SELL / DUMP";
        const timeStr = a.timestamp ? new Date(a.timestamp).toLocaleTimeString("en-GB", { hour12: false }) : "";

        return `<div class="alert-card">
            <span class="alert-icon">${icon}</span>
            <div class="alert-body">
                <div class="alert-title">${a.asset} — ${typeLabel}</div>
                <div class="alert-detail">Score: ${a.score} | Mentions: ${a.mentions || "—"}</div>
            </div>
            <span class="alert-time">${timeStr}</span>
        </div>`;
    }).join("");
}


function renderSources(sources) {
    const container = document.getElementById("sources-list");
    if (!container) return;

    if (!sources.length) {
        container.innerHTML = `<div class="source-row"><span class="source-name" style="color: var(--text-3);">No data</span><span class="source-count">—</span></div>`;
        return;
    }

    const sourceIcons = {
        x_twitter: "𝕏", telegram: "📱", reddit: "🔴", cafef: "📰",
        bloomberg_rss: "📊", f319: "💬", fireant: "🐜", discord: "💜",
    };

    container.innerHTML = sources.map(s => `<div class="source-row">
        <span class="source-name">${sourceIcons[s.source] || "📡"} ${s.source}</span>
        <span class="source-count">${s.count}</span>
    </div>`).join("");
}


function renderTopics(topics) {
    const container = document.getElementById("topics-list");
    if (!container) return;

    if (!topics.length) {
        container.innerHTML = `<div class="source-row"><span class="source-name" style="color: var(--text-3);">No data</span><span class="source-count">—</span></div>`;
        return;
    }

    const topicIcons = { 1: "📈", 2: "🏦", 3: "📋", 4: "⚠️" };

    container.innerHTML = topics.map(t => `<div class="source-row">
        <span class="source-name">${topicIcons[t.topic_id] || "📌"} ${t.label}</span>
        <span class="source-count">${t.count}</span>
    </div>`).join("");
}


function renderMoodDonut(mood) {
    const canvas = document.getElementById("mood-donut-canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    const bull = mood.bullish_pct || 33;
    const bear = mood.bearish_pct || 33;
    const neutral = mood.neutral_pct || 34;

    // Update text
    const bullPctEl = document.getElementById("mood-bull-pct");
    const bearPctEl = document.getElementById("mood-bear-pct");
    const neutralPctEl = document.getElementById("mood-neutral-pct");
    if (bullPctEl) bullPctEl.textContent = `${bull.toFixed(1)}%`;
    if (bearPctEl) bearPctEl.textContent = `${bear.toFixed(1)}%`;
    if (neutralPctEl) neutralPctEl.textContent = `${neutral.toFixed(1)}%`;

    // Draw donut
    const w = canvas.width, h = canvas.height;
    const cx = w / 2, cy = h / 2;
    const outerR = 36, innerR = 22;

    ctx.clearRect(0, 0, w, h);

    const total = bull + bear + neutral;
    const segments = [
        { pct: bull / total, color: "#22c55e" },
        { pct: bear / total, color: "#ef4444" },
        { pct: neutral / total, color: "#f59e0b" },
    ];

    let startAngle = -Math.PI / 2;
    segments.forEach(seg => {
        const endAngle = startAngle + seg.pct * 2 * Math.PI;
        ctx.beginPath();
        ctx.arc(cx, cy, outerR, startAngle, endAngle);
        ctx.arc(cx, cy, innerR, endAngle, startAngle, true);
        ctx.closePath();
        ctx.fillStyle = seg.color;
        ctx.fill();
        startAngle = endAngle;
    });

    // Center text
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-0').trim() || "#fff";
    ctx.font = "bold 11px 'JetBrains Mono'";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const dominantPct = Math.max(bull, bear, neutral);
    const label = dominantPct === bull ? "BULL" : dominantPct === bear ? "BEAR" : "MIX";
    ctx.fillText(label, cx, cy);
}


function renderSentimentChart(timeline) {
    const canvas = document.getElementById("sentiment-chart");
    if (!canvas || !timeline.length) return;

    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = 100 * dpr;
    canvas.style.width = rect.width + "px";
    canvas.style.height = "100px";
    ctx.scale(dpr, dpr);

    const w = rect.width, h = 100;
    const pad = { left: 40, right: 10, top: 10, bottom: 24 };
    const chartW = w - pad.left - pad.right;
    const chartH = h - pad.top - pad.bottom;

    ctx.clearRect(0, 0, w, h);

    // Background grid
    ctx.strokeStyle = "rgba(30, 42, 56, 0.5)";
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
        const y = pad.top + (chartH / 4) * i;
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(w - pad.right, y);
        ctx.stroke();
    }

    // Zero line
    const zeroY = pad.top + chartH / 2;
    ctx.strokeStyle = "rgba(148, 163, 184, 0.3)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(pad.left, zeroY);
    ctx.lineTo(w - pad.right, zeroY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Data
    const asiValues = timeline.map(t => t.asi);
    const volumes = timeline.map(t => t.volume);
    const labels = timeline.map(t => t.time);

    const maxAsi = Math.max(Math.abs(Math.min(...asiValues)), Math.abs(Math.max(...asiValues)), 0.3);
    const maxVol = Math.max(...volumes, 1);

    const n = timeline.length;
    const stepX = chartW / Math.max(n - 1, 1);

    // Volume bars (background)
    const barWidth = Math.max(stepX * 0.5, 3);
    volumes.forEach((v, i) => {
        const x = pad.left + stepX * i;
        const barH = (v / maxVol) * chartH * 0.4;
        ctx.fillStyle = "rgba(245, 158, 11, 0.15)";
        ctx.fillRect(x - barWidth / 2, h - pad.bottom - barH, barWidth, barH);
    });

    // ASI line
    ctx.beginPath();
    ctx.strokeStyle = "#22d3ee";
    ctx.lineWidth = 2;
    asiValues.forEach((v, i) => {
        const x = pad.left + stepX * i;
        const y = pad.top + chartH / 2 - (v / maxAsi) * (chartH / 2);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // ASI area fill
    ctx.beginPath();
    asiValues.forEach((v, i) => {
        const x = pad.left + stepX * i;
        const y = pad.top + chartH / 2 - (v / maxAsi) * (chartH / 2);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.lineTo(pad.left + stepX * (n - 1), zeroY);
    ctx.lineTo(pad.left, zeroY);
    ctx.closePath();
    const gradient = ctx.createLinearGradient(0, pad.top, 0, h - pad.bottom);
    gradient.addColorStop(0, "rgba(34, 211, 238, 0.15)");
    gradient.addColorStop(0.5, "rgba(34, 211, 238, 0.02)");
    gradient.addColorStop(1, "rgba(34, 211, 238, 0.15)");
    ctx.fillStyle = gradient;
    ctx.fill();

    // Data points
    asiValues.forEach((v, i) => {
        const x = pad.left + stepX * i;
        const y = pad.top + chartH / 2 - (v / maxAsi) * (chartH / 2);
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fillStyle = v > 0 ? "#22c55e" : v < 0 ? "#ef4444" : "#f59e0b";
        ctx.fill();
    });

    // Y-axis labels
    ctx.fillStyle = "rgba(148, 163, 184, 0.7)";
    ctx.font = "9px 'JetBrains Mono'";
    ctx.textAlign = "right";
    ctx.fillText(`+${maxAsi.toFixed(2)}`, pad.left - 4, pad.top + 4);
    ctx.fillText("0.00", pad.left - 4, zeroY + 3);
    ctx.fillText(`-${maxAsi.toFixed(2)}`, pad.left - 4, h - pad.bottom);

    // X-axis labels (show every Nth)
    ctx.textAlign = "center";
    const labelStep = Math.max(1, Math.floor(n / 6));
    labels.forEach((label, i) => {
        if (i % labelStep === 0 || i === n - 1) {
            const x = pad.left + stepX * i;
            ctx.fillText(label, x, h - pad.bottom + 14);
        }
    });
}


// ═══════════════════════════════════════════════════════
// Chat / LLM Streaming (preserved from v1)
// ═══════════════════════════════════════════════════════

function appendMessage(role, content) {
    const history = document.getElementById("chat-history");
    const msg = document.createElement("div");
    msg.className = "chat-message";

    const roleEl = document.createElement("div");
    roleEl.className = `chat-role ${role === 'user' ? 'user' : 'ai'}`;
    roleEl.textContent = role === 'user' ? 'COMMANDER' : 'ANALYST';

    const contentEl = document.createElement("div");
    contentEl.className = "chat-content";
    contentEl.innerHTML = role === 'ai' && typeof marked !== 'undefined' ? marked.parse(content) : content;

    msg.appendChild(roleEl);
    msg.appendChild(contentEl);
    history.appendChild(msg);
    history.scrollTop = history.scrollHeight;
}

async function runAnalysis(type, userText) {
    appendMessage("user", userText);
    const statusBadge = document.getElementById("ai-status");
    statusBadge.textContent = "ANALYZING...";
    statusBadge.style.color = "var(--amber)";

    const history = document.getElementById("chat-history");
    const msg = document.createElement("div");
    msg.className = "chat-message";

    const roleEl = document.createElement("div");
    roleEl.className = `chat-role ai`;
    roleEl.textContent = 'ANALYST';

    const contentEl = document.createElement("div");
    contentEl.className = "chat-content";
    contentEl.innerHTML = '<span class="p-spinner" style="display:inline-block; width:12px; height:12px; border-width:2px; vertical-align:middle; margin-right:5px;"></span> THINKING...';

    msg.appendChild(roleEl);
    msg.appendChild(contentEl);
    history.appendChild(msg);
    history.scrollTop = history.scrollHeight;

    try {
        const res = await fetch("/api/social/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type })
        });

        if (!res.ok) {
            contentEl.innerHTML = `Error: HTTP ${res.status}`;
            statusBadge.textContent = "ERROR";
            statusBadge.style.color = "var(--red)";
            return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let fullText = "";
        contentEl.innerHTML = "";

        let buffer = "";
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            let lines = buffer.split("\n");
            buffer = lines.pop();

            for (let line of lines) {
                if (line.startsWith("data: ")) {
                    const dataStr = line.substring(6);
                    if (dataStr === "[DONE]") break;
                    try {
                        const j = JSON.parse(dataStr);
                        if (j.content) {
                            fullText += j.content;
                            contentEl.innerHTML = typeof marked !== 'undefined' ? marked.parse(fullText) : fullText;
                            history.scrollTop = history.scrollHeight;
                        }
                    } catch (e) {
                        // Incomplete chunk, skip
                    }
                }
            }
        }

        statusBadge.textContent = "LIVE";
        statusBadge.style.color = "var(--green)";
    } catch (e) {
        contentEl.innerHTML += `<br><br>**Connection Error:** ${e.message}`;
        statusBadge.textContent = "ERROR";
        statusBadge.style.color = "var(--red)";
    }
}


// ═══════════════════════════════════════════════════════
// Theme Management
// ═══════════════════════════════════════════════════════

function initTheme() {
    const savedTheme = localStorage.getItem("theme");
    if (savedTheme === "light") {
        document.documentElement.setAttribute("data-theme", "light");
    }
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute("data-theme");
    if (currentTheme === "light") {
        document.documentElement.removeAttribute("data-theme");
        localStorage.setItem("theme", "dark");
    } else {
        document.documentElement.setAttribute("data-theme", "light");
        localStorage.setItem("theme", "light");
    }
}
