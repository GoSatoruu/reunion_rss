/**
 * Mission Control Center — Space Intelligence Module
 * Full-featured tabbed command interface with:
 *   - Mission Overview (KPIs, Next Launch Spotlight, ISS, DSN mini, Weather mini)
 *   - Launches (full manifest with countdowns)
 *   - Orbital Assets (constellation donut chart + breakdown)
 *   - Deep Space Network (antenna-level status)
 *   - Space Weather (solar wind, KP, NOAA scales)
 */
const MCC = (function () {
    'use strict';

    // ── State ────────────────────────────────────────────
    let state = {
        launches: [],
        orbits: {},
        network: {},
        weather: {},
        iss: {},
        activeTab: 'overview',
        countdownInterval: null,
        metInterval: null,
        issInterval: null,
    };

    // ── Constellation Colors ─────────────────────────────
    const CONST_COLORS = [
        '#a855f7', '#3b82f6', '#22d3ee', '#22c55e',
        '#f59e0b', '#ef4444', '#ec4899', '#6366f1',
        '#14b8a6', '#f97316',
    ];

    // ── Tab Management ───────────────────────────────────
    function switchTab(tabId) {
        state.activeTab = tabId;

        // Update tab bar
        document.querySelectorAll('.mcc-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.tab === tabId);
        });

        // Update panels
        document.querySelectorAll('.mcc-panel').forEach(p => {
            p.classList.toggle('active', p.id === `panel-${tabId}`);
        });
    }

    // ── Init ─────────────────────────────────────────────
    async function init() {
        console.log('[MCC] Initializing Mission Control Center...');

        // Attach tab click handlers
        document.querySelectorAll('.mcc-tab').forEach(tab => {
            tab.addEventListener('click', () => switchTab(tab.dataset.tab));
        });

        const loader = document.getElementById('mcc-loader');
        const steps = [
            document.getElementById('load-step-1'),
            document.getElementById('load-step-2'),
            document.getElementById('load-step-3'),
            document.getElementById('load-step-4'),
            document.getElementById('load-step-5'),
        ];

        function markStep(idx) {
            if (steps[idx]) {
                steps[idx].textContent = '✓ ' + steps[idx].textContent.substring(2);
                steps[idx].classList.add('done');
            }
        }

        // Step 1: Init
        markStep(0);

        // Parallel fetch
        const [launchData, orbitData, networkData, weatherData, issData] = await Promise.all([
            fetchJSON('/api/space/launches').then(d => { markStep(1); return d; }),
            fetchJSON('/api/space/orbits').then(d => { markStep(2); return d; }),
            fetchJSON('/api/space/network').then(d => { markStep(3); return d; }),
            fetchJSON('/api/space/weather').then(d => { markStep(4); return d; }),
            fetchJSON('/api/space/iss'),
        ]);

        state.launches = launchData?.results || [];
        state.orbits = orbitData || {};
        state.network = networkData || {};
        state.weather = weatherData || {};
        state.iss = issData || {};

        // Render all tabs
        renderOverview();
        renderLaunches();
        renderOrbital();
        renderDSN();
        renderWeather();

        // Start live tickers
        startCountdown();
        startMET();
        startISS();

        // Update footer
        const el = document.getElementById('last-updated');
        if (el) el.textContent = `LAST SYNC: ${new Date().toLocaleTimeString()}`;

        // Hide loader
        if (loader) {
            loader.style.opacity = '0';
            loader.style.transition = 'opacity 0.5s ease';
            setTimeout(() => { loader.style.display = 'none'; }, 500);
        }

        // Auto-refresh every 5 minutes
        setInterval(async () => {
            const [l, o, n, w, i] = await Promise.all([
                fetchJSON('/api/space/launches'),
                fetchJSON('/api/space/orbits'),
                fetchJSON('/api/space/network'),
                fetchJSON('/api/space/weather'),
                fetchJSON('/api/space/iss'),
            ]);
            state.launches = l?.results || state.launches;
            state.orbits = o || state.orbits;
            state.network = n || state.network;
            state.weather = w || state.weather;
            state.iss = i || state.iss;

            renderOverview();
            renderLaunches();
            renderOrbital();
            renderDSN();
            renderWeather();

            if (el) el.textContent = `LAST SYNC: ${new Date().toLocaleTimeString()}`;
        }, 300000);
    }

    async function fetchJSON(url) {
        try {
            const r = await fetch(url);
            return await r.json();
        } catch (e) {
            console.error(`[MCC] Fetch error: ${url}`, e);
            return null;
        }
    }

    // ══════════════════════════════════════════════════════
    // RENDER: MISSION OVERVIEW
    // ══════════════════════════════════════════════════════
    function renderOverview() {
        // KPIs
        animateCounter('kpi-total-sats', state.orbits.total || 0);
        setEl('kpi-upcoming', state.launches.length || '0');
        setEl('kpi-dsn-active', (state.network.dsn || []).length || '0');

        const wind = state.weather;
        setEl('kpi-solar-wind', wind.solar_wind_speed || '—');

        // ISS
        if (state.iss && state.iss.latitude !== undefined) {
            setEl('kpi-iss-alt', Math.round(state.iss.altitude || 420));
            setEl('iss-coords', `LAT: ${parseFloat(state.iss.latitude).toFixed(4)} / LON: ${parseFloat(state.iss.longitude).toFixed(4)}`);
            setEl('iss-alt-detail', `ALTITUDE: ~${Math.round(state.iss.altitude || 420)} KM · SPEED: 27,600 KM/H`);
        }
        setEl('iss-crew', `CREW: ${state.iss.crew_count || '—'} ASTRONAUTS ABOARD`);

        // Next Launch Spotlight
        if (state.launches.length > 0) {
            const launch = state.launches[0];
            const heroEl = document.getElementById('spotlight-hero');
            if (heroEl && launch.image) {
                heroEl.style.backgroundImage = `url('${launch.image}')`;
            }
            setEl('spotlight-provider', launch.launch_service_provider?.name || 'MISSION CONTROL');
            setEl('spotlight-name', launch.name || 'Upcoming Mission');
            const date = new Date(launch.window_start || launch.net);
            setEl('spotlight-date', date.toISOString().replace('T', ' ').substring(0, 16) + ' UTC');
            setEl('spotlight-pad', launch.pad?.location?.name || 'CLASSIFIED');
            setEl('spotlight-vehicle', launch.rocket?.configuration?.name || launch.name?.split('|')[0]?.trim() || '—');
            setEl('spotlight-status', launch.status?.name || 'TBD');
        }

        // DSN Mini
        renderDSNMini();

        // Weather Mini
        setEl('wx-mini-wind', `${wind.solar_wind_speed || '—'} KM/S`);
        const kp = wind.kp_index || 0;
        const kpLabel = kp <= 3 ? 'QUIET' : kp <= 5 ? 'UNSETTLED' : kp <= 7 ? 'STORM' : 'SEVERE';
        setEl('wx-mini-kp', `${kp} ${kpLabel}`);
        const kpEl = document.getElementById('wx-mini-kp');
        if (kpEl) {
            kpEl.style.color = kp <= 3 ? 'var(--amber)' : kp <= 5 ? 'var(--amber)' : 'var(--red)';
        }
        setEl('wx-mini-storm', kp >= 5 ? `G${Math.min(kp - 4, 5)} STORM` : 'NONE');
        const stormEl = document.getElementById('wx-mini-storm');
        if (stormEl) stormEl.style.color = kp >= 5 ? 'var(--red)' : 'var(--green)';
    }

    function renderDSNMini() {
        const container = document.getElementById('dsn-mini-container');
        if (!container) return;

        const dsn = state.network.dsn || [];
        if (dsn.length === 0) {
            container.innerHTML = '<div class="panel-loading">NO DSN DATA</div>';
            return;
        }

        container.innerHTML = dsn.slice(0, 3).map(s => {
            const isActive = s.activity?.includes('TRACK') || s.activity?.includes('RECEIV');
            const statusClass = isActive ? 'active' : 'transmitting';
            return `
                <div class="mcc-dsn-row">
                    <div class="mcc-dsn-antenna">📡</div>
                    <div class="mcc-dsn-info">
                        <span class="mcc-dsn-facility">${s.facility}</span>
                        <span class="mcc-dsn-target">${s.target || '—'}</span>
                        <span class="mcc-dsn-signal">${s.band} · ${s.signal_strength}</span>
                    </div>
                    <span class="mcc-dsn-status ${statusClass}">${s.activity}</span>
                </div>
            `;
        }).join('');
    }

    // ══════════════════════════════════════════════════════
    // RENDER: LAUNCHES
    // ══════════════════════════════════════════════════════
    function renderLaunches() {
        const container = document.getElementById('launch-grid-container');
        if (!container) return;

        if (state.launches.length === 0) {
            container.innerHTML = '<div class="empty-state">NO UPCOMING LAUNCHES IN MANIFEST</div>';
            return;
        }

        container.innerHTML = state.launches.slice(0, 12).map((launch, i) => {
            const date = new Date(launch.window_start || launch.net);
            const statusName = (launch.status?.name || 'TBD').toUpperCase();
            let badgeClass = 'tbd';
            if (statusName.includes('GO')) badgeClass = 'go';
            else if (statusName.includes('TBC') || statusName.includes('CONF')) badgeClass = 'tbc';

            const mission = launch.mission?.description || '';
            const vehicle = launch.rocket?.configuration?.name || launch.name?.split('|')[0]?.trim() || '—';

            return `
                <div class="mcc-launch-card" style="animation-delay: ${i * 0.05}s;">
                    <div class="mcc-launch-hero" style="background-image: url('${launch.image || 'https://images.unsplash.com/photo-1517976487492-5750f3195933?auto=format&fit=crop&q=80&w=600'}')">
                        <span class="mcc-launch-badge ${badgeClass}">${statusName}</span>
                        <div class="mcc-launch-countdown">
                            <span class="mcc-launch-cd-prefix">T−</span>
                            <span class="mcc-launch-cd-timer" data-launch-time="${date.getTime()}">CALCULATING...</span>
                        </div>
                    </div>
                    <div class="mcc-launch-body">
                        <div class="mcc-launch-provider">${launch.launch_service_provider?.name || 'PROVIDER TBD'}</div>
                        <div class="mcc-launch-name">${launch.name}</div>
                        ${mission ? `<div class="mcc-launch-mission">${mission}</div>` : ''}
                        <div class="mcc-launch-details">
                            <div class="mcc-launch-detail">
                                <span class="mcc-launch-detail-label">DATE (UTC)</span>
                                <span class="mcc-launch-detail-val">${date.toISOString().replace('T', ' ').substring(0, 16)}</span>
                            </div>
                            <div class="mcc-launch-detail">
                                <span class="mcc-launch-detail-label">VEHICLE</span>
                                <span class="mcc-launch-detail-val">${vehicle}</span>
                            </div>
                            <div class="mcc-launch-detail">
                                <span class="mcc-launch-detail-label">LOCATION</span>
                                <span class="mcc-launch-detail-val">${launch.pad?.location?.name || 'CLASSIFIED'}</span>
                            </div>
                            <div class="mcc-launch-detail">
                                <span class="mcc-launch-detail-label">ORBIT</span>
                                <span class="mcc-launch-detail-val">${launch.mission?.orbit?.name || '—'}</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    // ══════════════════════════════════════════════════════
    // RENDER: ORBITAL ASSETS
    // ══════════════════════════════════════════════════════
    function renderOrbital() {
        const operators = state.orbits.operators || [];
        const total = state.orbits.total || 0;

        // Donut 
        drawDonut(operators, total);

        // Counter
        animateCounter('donut-total', total);

        // List
        const listEl = document.getElementById('constellation-list');
        if (!listEl) return;

        if (operators.length === 0) {
            listEl.innerHTML = '<div class="panel-loading">NO ORBITAL DATA</div>';
            return;
        }

        const max = Math.max(...operators.map(o => o.count), 1);

        listEl.innerHTML = operators.map((op, i) => {
            const color = CONST_COLORS[i % CONST_COLORS.length];
            const pct = (op.count / max) * 100;
            return `
                <div class="mcc-const-row">
                    <div class="mcc-const-dot" style="background:${color};box-shadow:0 0 4px ${color};"></div>
                    <div class="mcc-const-name">${op.name}</div>
                    <div class="mcc-const-count">${op.count.toLocaleString()}</div>
                    <div class="mcc-const-bar-track">
                        <div class="mcc-const-bar-fill" style="width:${pct}%;background:${color};"></div>
                    </div>
                </div>
            `;
        }).join('');
    }

    function drawDonut(operators, total) {
        const canvas = document.getElementById('constellation-donut');
        if (!canvas || operators.length === 0) return;

        const ctx = canvas.getContext('2d');
        const size = canvas.width;
        const cx = size / 2;
        const cy = size / 2;
        const outerR = size / 2 - 10;
        const innerR = outerR * 0.62;

        ctx.clearRect(0, 0, size, size);

        let startAngle = -Math.PI / 2;

        operators.forEach((op, i) => {
            const sliceAngle = (op.count / Math.max(total, 1)) * 2 * Math.PI;
            const color = CONST_COLORS[i % CONST_COLORS.length];

            ctx.beginPath();
            ctx.arc(cx, cy, outerR, startAngle, startAngle + sliceAngle);
            ctx.arc(cx, cy, innerR, startAngle + sliceAngle, startAngle, true);
            ctx.closePath();
            ctx.fillStyle = color;
            ctx.globalAlpha = 0.85;
            ctx.fill();

            // Subtle separator
            ctx.beginPath();
            ctx.arc(cx, cy, outerR, startAngle, startAngle + sliceAngle);
            ctx.arc(cx, cy, innerR, startAngle + sliceAngle, startAngle, true);
            ctx.closePath();
            ctx.strokeStyle = 'rgba(9,11,14,0.8)';
            ctx.lineWidth = 2;
            ctx.globalAlpha = 1;
            ctx.stroke();

            startAngle += sliceAngle;
        });

        // Inner glow
        const glow = ctx.createRadialGradient(cx, cy, innerR - 2, cx, cy, innerR + 5);
        glow.addColorStop(0, 'rgba(168, 85, 247, 0.05)');
        glow.addColorStop(1, 'transparent');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, size, size);
    }

    // ══════════════════════════════════════════════════════
    // RENDER: DEEP SPACE NETWORK
    // ══════════════════════════════════════════════════════
    function renderDSN() {
        const container = document.getElementById('dsn-complex-container');
        const nsnContainer = document.getElementById('nsn-container');
        if (!container) return;

        const dsn = state.network.dsn || [];
        const nsn = state.network.nsn || [];

        if (dsn.length === 0) {
            container.innerHTML = '<div class="panel-loading" style="grid-column:1/-1;">NO DSN DATA AVAILABLE</div>';
            return;
        }

        // Group DSN by complex
        const complexes = {
            'GOLDSTONE': { loc: 'MOJAVE DESERT, CALIFORNIA', antennas: [] },
            'MADRID': { loc: 'ROBLEDO DE CHAVELA, SPAIN', antennas: [] },
            'CANBERRA': { loc: 'TIDBINBILLA, AUSTRALIA', antennas: [] },
        };

        dsn.forEach(s => {
            const name = (s.facility || '').toUpperCase();
            if (name.includes('GOLDSTONE') || name.includes('USA')) {
                complexes['GOLDSTONE'].antennas.push(s);
            } else if (name.includes('MADRID') || name.includes('ESP')) {
                complexes['MADRID'].antennas.push(s);
            } else if (name.includes('CANBERRA') || name.includes('AUS')) {
                complexes['CANBERRA'].antennas.push(s);
            }
        });

        container.innerHTML = Object.entries(complexes).map(([name, data]) => {
            const antennasHtml = data.antennas.length > 0 ? data.antennas.map(a => {
                const isActive = a.activity?.includes('TRACK') || a.activity?.includes('RECEIV');
                const statusClass = isActive ? 'tracking' : a.activity?.includes('TRANSMIT') ? 'transmitting' : 'idle';
                const signalColor = isActive ? 'var(--green)' : a.activity?.includes('TRANSMIT') ? 'var(--amber)' : 'var(--text-3)';

                return `
                    <div class="mcc-antenna-visual ${statusClass}">
                        <div class="mcc-antenna-dish">
                            <svg viewBox="0 0 32 32" fill="none" stroke="${signalColor}" stroke-width="1.5">
                                <path d="M8 20 L16 8 L24 20" stroke-linecap="round"/>
                                <ellipse cx="16" cy="20" rx="10" ry="3"/>
                                <line x1="16" y1="8" x2="16" y2="4" stroke-width="2"/>
                                <circle cx="16" cy="3" r="1.5" fill="${signalColor}"/>
                            </svg>
                            <div class="signal-rings">
                                <div class="mcc-signal-ring" style="background:${signalColor};"></div>
                                <div class="mcc-signal-ring" style="background:${signalColor};"></div>
                                <div class="mcc-signal-ring" style="background:${signalColor};"></div>
                            </div>
                        </div>
                        <div class="mcc-antenna-data">
                            <span class="mcc-antenna-id">${a.facility}</span>
                            <span class="mcc-antenna-target-label">TARGET</span>
                            <span class="mcc-antenna-target-name">${a.target || 'STANDBY'}</span>
                            <div class="mcc-antenna-meta">
                                <span>${a.band || '—'}</span>
                                <span>${a.signal_strength || '—'}</span>
                                <span style="color:${signalColor};font-weight:700;">${a.activity}</span>
                            </div>
                        </div>
                    </div>
                `;
            }).join('') : '<div style="padding:12px;font-size:10px;color:var(--text-3);letter-spacing:1.5px;">NO ACTIVE ANTENNAS</div>';

            return `
                <div class="mcc-dsn-complex">
                    <div class="mcc-dsn-complex-header">
                        <span class="mcc-dsn-complex-name">${name}</span>
                        <span class="mcc-dsn-complex-loc">${data.loc}</span>
                    </div>
                    <div class="mcc-dsn-complex-body">
                        ${antennasHtml}
                    </div>
                </div>
            `;
        }).join('');

        // NSN
        if (nsnContainer && nsn.length > 0) {
            nsnContainer.innerHTML = nsn.map(n => `
                <div class="mcc-nsn-card">
                    <div class="mcc-nsn-icon">🛰️</div>
                    <div class="mcc-nsn-info">
                        <span class="mcc-nsn-name">${n.facility}</span>
                        <span class="mcc-nsn-status">● ${n.status}</span>
                    </div>
                    <span class="mcc-nsn-links">${n.active_links}</span>
                </div>
            `).join('');
        }
    }

    // ══════════════════════════════════════════════════════
    // RENDER: SPACE WEATHER
    // ══════════════════════════════════════════════════════
    function renderWeather() {
        const wx = state.weather;
        if (!wx || Object.keys(wx).length === 0) return;

        const container = document.getElementById('wx-cards-container');
        if (container) {
            const windSpeed = wx.solar_wind_speed || 0;
            const kp = wx.kp_index || 0;
            const bz = wx.bz_component || 0;
            const density = wx.proton_density || 0;

            const windStatus = windSpeed < 400 ? 'nominal' : windSpeed < 600 ? 'elevated' : 'storm';
            const kpStatus = kp <= 3 ? 'nominal' : kp <= 5 ? 'elevated' : 'storm';
            const bzStatus = bz > -5 ? 'nominal' : bz > -10 ? 'elevated' : 'storm';
            const densityStatus = density < 10 ? 'nominal' : density < 20 ? 'elevated' : 'storm';

            container.innerHTML = `
                <div class="mcc-wx-card" style="--top-color: var(--cyan);">
                    <div style="position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,var(--cyan),transparent);"></div>
                    <span class="mcc-wx-icon">💨</span>
                    <span class="mcc-wx-label">SOLAR WIND</span>
                    <span class="mcc-wx-value">${windSpeed}</span>
                    <span class="mcc-wx-unit">KM/S</span>
                    <span class="mcc-wx-status ${windStatus}">${windStatus === 'nominal' ? 'NOMINAL' : windStatus === 'elevated' ? 'ELEVATED' : 'HIGH'}</span>
                </div>
                <div class="mcc-wx-card">
                    <div style="position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,var(--amber),transparent);"></div>
                    <span class="mcc-wx-icon">🧲</span>
                    <span class="mcc-wx-label">KP INDEX</span>
                    <span class="mcc-wx-value">${kp}</span>
                    <span class="mcc-wx-unit">${kp <= 3 ? 'QUIET' : kp <= 5 ? 'UNSETTLED' : 'STORM'}</span>
                    <span class="mcc-wx-status ${kpStatus}">${kpStatus === 'nominal' ? 'QUIET' : kpStatus === 'elevated' ? 'ACTIVE' : 'STORM'}</span>
                </div>
                <div class="mcc-wx-card">
                    <div style="position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,var(--mcc-blue),transparent);"></div>
                    <span class="mcc-wx-icon">🔽</span>
                    <span class="mcc-wx-label">BZ COMPONENT</span>
                    <span class="mcc-wx-value">${bz}</span>
                    <span class="mcc-wx-unit">nT (IMF)</span>
                    <span class="mcc-wx-status ${bzStatus}">${bz > -5 ? 'NORTHWARD' : bz > -10 ? 'MODERATE' : 'SOUTHWARD'}</span>
                </div>
                <div class="mcc-wx-card">
                    <div style="position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,var(--green),transparent);"></div>
                    <span class="mcc-wx-icon">⚛️</span>
                    <span class="mcc-wx-label">PROTON DENSITY</span>
                    <span class="mcc-wx-value">${density}</span>
                    <span class="mcc-wx-unit">P/CM³</span>
                    <span class="mcc-wx-status ${densityStatus}">${density < 10 ? 'NOMINAL' : density < 20 ? 'ELEVATED' : 'HIGH'}</span>
                </div>
            `;
        }

        // NOAA Scales
        const kp = wx.kp_index || 0;
        const geoLevel = kp >= 5 ? Math.min(kp - 4, 5) : 0;
        updateScale('scale-geo', geoLevel, 5, 'G');
        updateScale('scale-rad', wx.solar_radiation_level || 0, 5, 'S');
        updateScale('scale-radio', wx.radio_blackout_level || 0, 5, 'R');

        // Solar Cycle
        setEl('wx-sunspot', wx.sunspot_number || '~180');
        setEl('wx-flux', wx.solar_flux || '~165 SFU');
        setEl('wx-xray', wx.xray_flux || 'C-CLASS');
    }

    function updateScale(barId, level, max, prefix) {
        const bar = document.getElementById(barId);
        const label = document.getElementById(barId + '-level');
        if (!bar || !label) return;

        const pct = Math.max(10, (level / max) * 100);
        bar.style.width = pct + '%';

        const color = level === 0 ? 'var(--green)' : level <= 2 ? 'var(--amber)' : 'var(--red)';
        bar.style.background = color;
        label.style.color = color;
        label.textContent = `${prefix}${level}`;
    }

    // ══════════════════════════════════════════════════════
    // LIVE TICKERS
    // ══════════════════════════════════════════════════════

    function startCountdown() {
        function tick() {
            // Spotlight countdown
            if (state.launches.length > 0) {
                const launch = state.launches[0];
                const target = new Date(launch.window_start || launch.net).getTime();
                updateCountdown(target);
            }

            // Launch card countdowns
            document.querySelectorAll('.mcc-launch-cd-timer[data-launch-time]').forEach(el => {
                const target = parseInt(el.dataset.launchTime, 10);
                const diff = target - Date.now();
                if (diff <= 0) {
                    el.textContent = 'LAUNCHED';
                    el.style.color = 'var(--green)';
                    return;
                }
                const d = Math.floor(diff / 86400000);
                const h = Math.floor((diff % 86400000) / 3600000);
                const m = Math.floor((diff % 3600000) / 60000);
                const s = Math.floor((diff % 60000) / 1000);
                el.textContent = `${d}D ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
            });
        }
        tick();
        state.countdownInterval = setInterval(tick, 1000);
    }

    function updateCountdown(targetMs) {
        const diff = targetMs - Date.now();
        if (diff <= 0) {
            setEl('cd-days', '00');
            setEl('cd-hours', '00');
            setEl('cd-mins', '00');
            setEl('cd-secs', '00');
            return;
        }
        setEl('cd-days', String(Math.floor(diff / 86400000)).padStart(2, '0'));
        setEl('cd-hours', String(Math.floor((diff % 86400000) / 3600000)).padStart(2, '0'));
        setEl('cd-mins', String(Math.floor((diff % 3600000) / 60000)).padStart(2, '0'));
        setEl('cd-secs', String(Math.floor((diff % 60000) / 1000)).padStart(2, '0'));
    }

    function startMET() {
        function tick() {
            const now = new Date();
            const utc = now.toISOString().substring(11, 19);
            setEl('kpi-met', utc);
        }
        tick();
        state.metInterval = setInterval(tick, 1000);
    }

    function startISS() {
        async function tick() {
            try {
                const data = await fetchJSON('/api/space/iss');
                if (data && data.latitude !== undefined) {
                    state.iss = data;
                    setEl('iss-coords', `LAT: ${parseFloat(data.latitude).toFixed(4)} / LON: ${parseFloat(data.longitude).toFixed(4)}`);
                    setEl('iss-alt-detail', `ALTITUDE: ~${Math.round(data.altitude || 420)} KM · SPEED: 27,600 KM/H`);
                    setEl('kpi-iss-alt', Math.round(data.altitude || 420));
                }
            } catch (e) { /* silent */ }
        }
        state.issInterval = setInterval(tick, 30000);
    }

    // ── Utilities ────────────────────────────────────────
    function setEl(id, val) {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    }

    function animateCounter(id, target) {
        const el = document.getElementById(id);
        if (!el) return;

        const start = parseInt(el.textContent) || 0;
        const diff = target - start;
        if (diff === 0) { el.textContent = target.toLocaleString(); return; }

        const duration = 1200;
        const steps = 40;
        const stepTime = duration / steps;
        let current = start;
        let step = 0;

        const timer = setInterval(() => {
            step++;
            const progress = step / steps;
            // Ease out cubic
            const eased = 1 - Math.pow(1 - progress, 3);
            current = Math.round(start + diff * eased);
            el.textContent = current.toLocaleString();
            if (step >= steps) {
                el.textContent = target.toLocaleString();
                clearInterval(timer);
            }
        }, stepTime);
    }

    // Theme toggle
    document.addEventListener('DOMContentLoaded', () => {
        const toggle = document.getElementById('theme-toggle');
        if (toggle) {
            const saved = localStorage.getItem('gvbc-theme');
            if (saved === 'light') document.documentElement.setAttribute('data-theme', 'light');

            toggle.addEventListener('click', () => {
                const isLight = document.documentElement.getAttribute('data-theme') === 'light';
                if (isLight) {
                    document.documentElement.removeAttribute('data-theme');
                    localStorage.setItem('gvbc-theme', 'dark');
                } else {
                    document.documentElement.setAttribute('data-theme', 'light');
                    localStorage.setItem('gvbc-theme', 'light');
                }
            });
        }
    });

    // Auto-init
    document.addEventListener('DOMContentLoaded', init);

    // Public API
    return { switchTab };
})();
