/**
 * GSO Data Intelligence — Frontend Controller
 * Manages the GSO data crawler interface:
 *  - Catalog browsing & data fetching
 *  - Database hierarchy navigation
 *  - Data table rendering
 *  - Crawl progress tracking
 *  - Saved dataset management
 */

(function () {
    'use strict';

    // ─── State ──────────────────────────────────────────────
    let selectedCatalogItem = null;
    let currentData = null;
    let currentMetadata = null;
    let browsePath = [];
    let crawlInterval = null;
    let catalog = {};

    // ─── DOM Refs ───────────────────────────────────────────
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    // ─── Init ───────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', () => {
        loadCatalog();
        loadSavedDatasets();
        setupTabs();
        setupEventListeners();
        browseDatabase('');
    });

    // ═══════════════════════════════════════════════════════
    //  CATALOG
    // ═══════════════════════════════════════════════════════

    async function loadCatalog() {
        try {
            const resp = await fetch('/api/gso/catalog');
            catalog = await resp.json();
            renderCatalog(catalog);
            $('#stat-catalog').textContent = Object.keys(catalog).length;
        } catch (e) {
            console.error('[GSO] Failed to load catalog:', e);
        }
    }

    function renderCatalog(cat) {
        const container = $('#catalog-list');
        container.innerHTML = '';

        const categories = {};
        for (const [id, item] of Object.entries(cat)) {
            const c = item.category || 'Other';
            if (!categories[c]) categories[c] = [];
            categories[c].push({ id, ...item });
        }

        for (const [catName, items] of Object.entries(categories)) {
            // Category header
            const header = document.createElement('div');
            header.style.cssText = 'padding: 6px 14px; font-size: 8px; font-weight: 700; letter-spacing: 2px; color: var(--text-3); text-transform: uppercase; background: var(--bg-2); border-bottom: 1px solid var(--border);';
            header.textContent = catName;
            container.appendChild(header);

            for (const item of items) {
                const el = document.createElement('div');
                el.className = 'catalog-item';
                el.dataset.id = item.id;
                el.innerHTML = `
                    <span class="cat-icon">${item.icon}</span>
                    <div class="cat-info">
                        <div class="cat-name">${item.name}</div>
                        <div class="cat-desc">${item.description}</div>
                    </div>
                    <span class="cat-badge">${item.category}</span>
                `;
                el.addEventListener('click', () => selectCatalogItem(item.id));
                container.appendChild(el);
            }
        }
    }

    async function selectCatalogItem(id) {
        // Highlight
        $$('.catalog-item').forEach(el => el.classList.remove('selected'));
        const el = document.querySelector(`.catalog-item[data-id="${id}"]`);
        if (el) el.classList.add('selected');

        selectedCatalogItem = id;
        const item = catalog[id];
        if (!item) return;

        // Switch to data viewer tab
        switchTab('data-viewer');

        // Update header
        $('#viewer-title').textContent = `${item.icon} ${item.name.toUpperCase()}`;
        $('#btn-fetch-selected').style.display = '';
        $('#btn-save-current').style.display = 'none';
        $('#btn-export-csv').style.display = 'none';

        // Try loading saved data first
        try {
            const saved = await fetch(`/api/gso/saved/${id}`);
            const savedData = await saved.json();
            if (!savedData.error && savedData.data) {
                currentData = savedData.data;
                currentMetadata = savedData.metadata;
                renderDataTable(currentData);
                $('#btn-save-current').style.display = '';
                $('#btn-export-csv').style.display = '';
                $('#data-footer').textContent = `LOADED FROM SAVED · FETCHED: ${savedData.fetched_at || 'N/A'}`;
                return;
            }
        } catch (e) {
            // No saved data, will fetch
        }

        // Show empty state with fetch prompt
        showDataEmpty(`Click FETCH to download "${item.name}" from GSO`);
    }

    // ═══════════════════════════════════════════════════════
    //  DATA FETCHING
    // ═══════════════════════════════════════════════════════

    async function fetchSelectedItem() {
        if (!selectedCatalogItem) return;
        const item = catalog[selectedCatalogItem];
        if (!item) return;

        $('#btn-fetch-selected').textContent = '⏳ LOADING...';
        $('#btn-fetch-selected').disabled = true;

        try {
            const resp = await fetch(`/api/gso/fetch/${selectedCatalogItem}`);
            const result = await resp.json();

            if (result.error) {
                showDataEmpty(`Error: ${result.error}`);
                return;
            }

            currentData = result.data;
            currentMetadata = result.metadata;
            renderDataTable(currentData);
            $('#btn-save-current').style.display = '';
            $('#btn-export-csv').style.display = '';
            $('#data-footer').textContent = `FETCHED: ${result.fetched_at || new Date().toISOString()} · SOURCE: pxweb.gso.gov.vn`;

            // Mark catalog item as fetched
            const el = document.querySelector(`.catalog-item[data-id="${selectedCatalogItem}"]`);
            if (el) el.classList.add('fetched');
        } catch (e) {
            showDataEmpty(`Fetch error: ${e.message}`);
        } finally {
            $('#btn-fetch-selected').textContent = '⟳ FETCH';
            $('#btn-fetch-selected').disabled = false;
        }
    }

    // ═══════════════════════════════════════════════════════
    //  DATA TABLE RENDERING
    // ═══════════════════════════════════════════════════════

    function renderDataTable(data) {
        if (!data) {
            showDataEmpty('No data available');
            return;
        }

        const table = $('#data-table');
        const thead = $('#data-thead');
        const tbody = $('#data-tbody');
        const empty = $('#data-empty');

        thead.innerHTML = '';
        tbody.innerHTML = '';

        // PX-Web JSON format: { columns: [...], data: [{ key: [...], values: [...] }] }
        if (data.columns && data.data) {
            const cols = data.columns;
            const rows = data.data;

            // Header
            const headerRow = document.createElement('tr');
            cols.forEach(col => {
                const th = document.createElement('th');
                th.textContent = col.text || col.code || '';
                headerRow.appendChild(th);
            });
            thead.appendChild(headerRow);

            // Body
            const maxRows = Math.min(rows.length, 500);
            for (let i = 0; i < maxRows; i++) {
                const row = rows[i];
                const tr = document.createElement('tr');
                const cellData = [...(row.key || []), ...(row.values || [])];
                cellData.forEach((val, idx) => {
                    const td = document.createElement('td');
                    td.textContent = val;
                    // Highlight numeric values
                    if (idx >= (row.key || []).length) {
                        td.style.fontWeight = '600';
                        const num = parseFloat(val);
                        if (!isNaN(num)) {
                            td.textContent = num.toLocaleString();
                        }
                    }
                    tr.appendChild(td);
                });
                tbody.appendChild(tr);
            }

            if (rows.length > 500) {
                const tr = document.createElement('tr');
                const td = document.createElement('td');
                td.colSpan = cols.length;
                td.style.cssText = 'text-align: center; color: var(--text-3); font-style: italic; padding: 12px;';
                td.textContent = `Showing 500 of ${rows.length} rows`;
                tr.appendChild(td);
                tbody.appendChild(tr);
            }

            empty.style.display = 'none';
            table.style.display = '';
            return;
        }

        // Alternative: flat array of objects
        if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object') {
            const keys = Object.keys(data[0]);
            const headerRow = document.createElement('tr');
            keys.forEach(key => {
                const th = document.createElement('th');
                th.textContent = key;
                headerRow.appendChild(th);
            });
            thead.appendChild(headerRow);

            const maxRows = Math.min(data.length, 500);
            for (let i = 0; i < maxRows; i++) {
                const tr = document.createElement('tr');
                keys.forEach(key => {
                    const td = document.createElement('td');
                    td.textContent = data[i][key] ?? '';
                    tr.appendChild(td);
                });
                tbody.appendChild(tr);
            }

            empty.style.display = 'none';
            table.style.display = '';
            return;
        }

        // Alternative: json-stat or other format — show raw
        if (typeof data === 'object') {
            const headerRow = document.createElement('tr');
            ['Key', 'Value'].forEach(h => {
                const th = document.createElement('th');
                th.textContent = h;
                headerRow.appendChild(th);
            });
            thead.appendChild(headerRow);

            const entries = flattenObject(data);
            entries.slice(0, 200).forEach(([key, val]) => {
                const tr = document.createElement('tr');
                const tdKey = document.createElement('td');
                tdKey.textContent = key;
                tdKey.style.color = 'var(--text-2)';
                tr.appendChild(tdKey);
                const tdVal = document.createElement('td');
                tdVal.textContent = typeof val === 'object' ? JSON.stringify(val) : val;
                tr.appendChild(tdVal);
                tbody.appendChild(tr);
            });

            empty.style.display = 'none';
            table.style.display = '';
            return;
        }

        showDataEmpty('Unsupported data format');
    }

    function flattenObject(obj, prefix = '') {
        const entries = [];
        for (const [key, val] of Object.entries(obj)) {
            const path = prefix ? `${prefix}.${key}` : key;
            if (val && typeof val === 'object' && !Array.isArray(val)) {
                entries.push(...flattenObject(val, path));
            } else {
                entries.push([path, val]);
            }
        }
        return entries;
    }

    function showDataEmpty(msg) {
        const empty = $('#data-empty');
        const table = $('#data-table');
        table.style.display = 'none';
        empty.style.display = '';
        empty.innerHTML = `
            <div class="gso-empty-icon">📈</div>
            <div class="gso-empty-text">${msg}</div>
        `;
    }

    // ═══════════════════════════════════════════════════════
    //  DATABASE BROWSER
    // ═══════════════════════════════════════════════════════

    async function browseDatabase(path) {
        const container = $('#browse-tree');
        container.innerHTML = '<div style="padding: 16px; text-align: center;"><div class="gso-spinner"></div> <span style="color: var(--text-3); font-size: 10px; margin-left: 8px;">LOADING...</span></div>';

        try {
            const resp = await fetch(`/api/gso/browse?path=${encodeURIComponent(path)}`);
            const data = await resp.json();

            if (data.error) {
                container.innerHTML = `<div class="gso-empty"><div class="gso-empty-icon">⚠️</div><div class="gso-empty-text">${data.error}</div></div>`;
                return;
            }

            // Update breadcrumb
            browsePath = path ? path.split('/') : [];
            renderBreadcrumb();

            container.innerHTML = '';

            if (Array.isArray(data)) {
                data.forEach(item => {
                    const el = document.createElement('div');
                    el.className = 'browse-node';

                    const isFolder = item.type === 'l';  // 'l' = folder in PX-Web
                    const icon = isFolder ? '📁' : '📄';
                    const typeLabel = isFolder ? 'FOLDER' : 'TABLE';
                    const itemId = item.id || item.dbid || '';
                    const label = item.text || item.id || 'Unnamed';

                    el.innerHTML = `
                        <span class="browse-icon">${icon}</span>
                        <span class="browse-label">${label}</span>
                        <span class="browse-type">${typeLabel}</span>
                    `;

                    el.addEventListener('click', () => {
                        const newPath = path ? `${path}/${itemId}` : itemId;
                        if (isFolder) {
                            browseDatabase(newPath);
                        } else {
                            // It's a table — fetch metadata & data
                            fetchBrowsedTable(newPath, label);
                        }
                    });

                    container.appendChild(el);
                });

                if (data.length === 0) {
                    container.innerHTML = '<div class="gso-empty"><div class="gso-empty-icon">📂</div><div class="gso-empty-text">Empty folder</div></div>';
                }
            } else {
                // Might be metadata for a table
                container.innerHTML = '<div class="gso-empty"><div class="gso-empty-icon">📄</div><div class="gso-empty-text">Table metadata loaded — check Data Viewer</div></div>';
            }
        } catch (e) {
            container.innerHTML = `<div class="gso-empty"><div class="gso-empty-icon">⚠️</div><div class="gso-empty-text">Error: ${e.message}</div></div>`;
        }
    }

    function renderBreadcrumb() {
        const bc = $('#browse-breadcrumb');
        bc.innerHTML = '';

        const rootSeg = document.createElement('span');
        rootSeg.className = 'breadcrumb-segment';
        rootSeg.textContent = 'ROOT';
        rootSeg.addEventListener('click', () => browseDatabase(''));
        bc.appendChild(rootSeg);

        let pathSoFar = '';
        browsePath.forEach((seg, i) => {
            const sep = document.createElement('span');
            sep.className = 'breadcrumb-sep';
            sep.textContent = '›';
            bc.appendChild(sep);

            pathSoFar += (i === 0 ? '' : '/') + seg;
            const segEl = document.createElement('span');
            segEl.className = 'breadcrumb-segment';
            segEl.textContent = seg.length > 25 ? seg.substring(0, 25) + '...' : seg;
            segEl.title = seg;
            const capturePath = pathSoFar;
            segEl.addEventListener('click', () => browseDatabase(capturePath));
            bc.appendChild(segEl);
        });
    }

    async function fetchBrowsedTable(path, name) {
        switchTab('data-viewer');
        $('#viewer-title').textContent = `📄 ${name}`;
        showDataEmpty('Loading table data...');
        $('#btn-fetch-selected').style.display = 'none';
        $('#btn-save-current').style.display = 'none';
        $('#btn-export-csv').style.display = 'none';

        try {
            const resp = await fetch('/api/gso/browse-table', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path, name })
            });
            const result = await resp.json();

            if (result.error) {
                showDataEmpty(`Error: ${result.error}`);
                return;
            }

            currentData = result;
            renderDataTable(result);
            $('#btn-save-current').style.display = '';
            $('#btn-export-csv').style.display = '';
        } catch (e) {
            showDataEmpty(`Error: ${e.message}`);
        }
    }

    // ═══════════════════════════════════════════════════════
    //  CRAWL ALL
    // ═══════════════════════════════════════════════════════

    async function startCrawlAll() {
        const btn = $('#btn-crawl-all');
        btn.textContent = '⏳ CRAWLING...';
        btn.disabled = true;
        $('#gso-hero').classList.add('gso-running');

        // Switch to results tab
        switchTab('crawl-results');

        // Show progress
        const progress = $('#crawl-progress');
        progress.classList.add('active');

        try {
            // Start crawl (async on backend)
            fetch('/api/gso/crawl', { method: 'POST' });

            // Poll status
            crawlInterval = setInterval(async () => {
                try {
                    const resp = await fetch('/api/gso/crawl/status');
                    const status = await resp.json();

                    updateCrawlProgress(status);

                    if (!status.running && status.progress >= status.total && status.total > 0) {
                        clearInterval(crawlInterval);
                        crawlInterval = null;
                        btn.textContent = '⚡ CRAWL ALL';
                        btn.disabled = false;
                        $('#gso-hero').classList.remove('gso-running');
                        progress.classList.remove('active');
                        renderCrawlResults(status.results || []);
                        loadSavedDatasets();
                    }
                } catch (e) {
                    console.error('[GSO] Status poll error:', e);
                }
            }, 1000);
        } catch (e) {
            console.error('[GSO] Crawl start error:', e);
            btn.textContent = '⚡ CRAWL ALL';
            btn.disabled = false;
            $('#gso-hero').classList.remove('gso-running');
        }
    }

    function updateCrawlProgress(status) {
        const pct = status.total > 0 ? Math.round((status.progress / status.total) * 100) : 0;
        $('#progress-pct').textContent = `${pct}%`;
        $('#progress-fill').style.width = `${pct}%`;
        $('#progress-item').textContent = status.current_item || 'Processing...';
        $('#progress-count').textContent = `${status.progress} / ${status.total}`;
    }

    function renderCrawlResults(results) {
        const container = $('#results-list');
        container.innerHTML = '';

        let successCount = 0;
        let errorCount = 0;

        results.forEach(r => {
            if (r.status === 'success') successCount++;
            else errorCount++;

            const el = document.createElement('div');
            el.className = 'result-row';
            el.innerHTML = `
                <span class="result-icon">${r.icon || '📊'}</span>
                <span class="result-name">${r.name}</span>
                <span class="result-records">${r.record_count || 0} records</span>
                <span class="result-status">
                    <span class="${r.status === 'success' ? 'status-success' : 'status-error'}">
                        ${r.status === 'success' ? 'OK' : 'ERR'}
                    </span>
                </span>
            `;

            if (r.error) {
                el.title = r.error;
            }

            // Click to view data
            el.style.cursor = 'pointer';
            el.addEventListener('click', () => {
                if (r.status === 'success') {
                    selectCatalogItem(r.id);
                }
            });

            container.appendChild(el);
        });

        $('#result-badge').textContent = `${successCount} OK · ${errorCount} ERR`;
    }

    // ═══════════════════════════════════════════════════════
    //  SAVED DATASETS
    // ═══════════════════════════════════════════════════════

    async function loadSavedDatasets() {
        try {
            const resp = await fetch('/api/gso/saved');
            const datasets = await resp.json();
            renderSavedDatasets(datasets);

            $('#stat-saved').textContent = datasets.length;
            let totalRecords = 0;
            datasets.forEach(d => totalRecords += d.record_count || 0);
            $('#stat-records').textContent = totalRecords.toLocaleString();
            $('#saved-badge').textContent = datasets.length;
        } catch (e) {
            console.error('[GSO] Failed to load saved datasets:', e);
        }
    }

    function renderSavedDatasets(datasets) {
        const container = $('#saved-list');
        container.innerHTML = '';

        if (!datasets.length) {
            container.innerHTML = `
                <div class="gso-empty">
                    <div class="gso-empty-icon">💾</div>
                    <div class="gso-empty-text">No saved datasets yet.<br>Crawl data and save it for offline access.</div>
                </div>
            `;
            return;
        }

        datasets.forEach(d => {
            const el = document.createElement('div');
            el.className = 'saved-item';

            const sizeKB = d.file_size ? (d.file_size / 1024).toFixed(1) : '?';
            const fetchedDate = d.fetched_at ? new Date(d.fetched_at).toLocaleDateString() : 'N/A';

            el.innerHTML = `
                <div>
                    <div class="saved-name">${d.name || d.id}</div>
                    <div style="font-size: 9px; color: var(--text-3); margin-top: 2px;">${d.category || ''} · ${fetchedDate}</div>
                </div>
                <span class="saved-records">${(d.record_count || 0).toLocaleString()}</span>
                <span class="saved-size">${sizeKB} KB</span>
                <div class="saved-actions">
                    <button class="p-btn" data-action="view" data-id="${d.id}" title="View data">👁</button>
                    <button class="p-btn" data-action="export" data-id="${d.id}" title="Export CSV">📥</button>
                    <button class="p-btn" data-action="delete" data-id="${d.id}" title="Delete" style="color: var(--red); border-color: rgba(239,68,68,0.3);">✗</button>
                </div>
            `;

            // Action handlers
            el.querySelectorAll('[data-action]').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const action = btn.dataset.action;
                    const id = btn.dataset.id;
                    if (action === 'view') selectCatalogItem(id);
                    else if (action === 'export') exportDataset(id);
                    else if (action === 'delete') deleteDataset(id);
                });
            });

            container.appendChild(el);
        });
    }

    async function saveCurrentDataset() {
        if (!selectedCatalogItem || !currentData) return;

        try {
            const resp = await fetch(`/api/gso/save/${selectedCatalogItem}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    data: currentData,
                    metadata: currentMetadata || { name: catalog[selectedCatalogItem]?.name }
                })
            });
            const result = await resp.json();
            if (result.ok) {
                loadSavedDatasets();
                $('#data-footer').textContent = `SAVED ✓ — ${new Date().toLocaleString()}`;
            }
        } catch (e) {
            console.error('[GSO] Save error:', e);
        }
    }

    async function exportDataset(id) {
        try {
            const resp = await fetch(`/api/gso/export/${id}`);
            const csv = await resp.text();

            if (csv.startsWith('{') && JSON.parse(csv).error) {
                alert('Export error: ' + JSON.parse(csv).error);
                return;
            }

            // Download as file
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `gso_${id}_${new Date().toISOString().split('T')[0]}.csv`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error('[GSO] Export error:', e);
        }
    }

    async function deleteDataset(id) {
        if (!confirm(`Delete saved dataset "${id}"?`)) return;

        try {
            await fetch(`/api/gso/saved/${id}`, { method: 'DELETE' });
            loadSavedDatasets();
        } catch (e) {
            console.error('[GSO] Delete error:', e);
        }
    }

    // ═══════════════════════════════════════════════════════
    //  TABS
    // ═══════════════════════════════════════════════════════

    function setupTabs() {
        $$('.tab-item').forEach(tab => {
            tab.addEventListener('click', () => {
                switchTab(tab.dataset.tab);
            });
        });
    }

    function switchTab(tabId) {
        $$('.tab-item').forEach(t => t.classList.remove('active'));
        $$('.tab-content').forEach(c => c.classList.remove('active'));

        const tab = document.querySelector(`.tab-item[data-tab="${tabId}"]`);
        const content = document.getElementById(`tab-content-${tabId}`);
        if (tab) tab.classList.add('active');
        if (content) content.classList.add('active');
    }

    // ═══════════════════════════════════════════════════════
    //  EVENT LISTENERS
    // ═══════════════════════════════════════════════════════

    function setupEventListeners() {
        $('#btn-crawl-all').addEventListener('click', startCrawlAll);
        $('#btn-fetch-selected').addEventListener('click', fetchSelectedItem);
        $('#btn-save-current').addEventListener('click', saveCurrentDataset);
        $('#btn-browse-root').addEventListener('click', () => browseDatabase(''));

        $('#btn-export-csv').addEventListener('click', () => {
            if (selectedCatalogItem) {
                exportDataset(selectedCatalogItem);
            }
        });

        $('#btn-clear-cache').addEventListener('click', async () => {
            if (!confirm('Clear all cached GSO data?')) return;
            try {
                const resp = await fetch('/api/gso/cache', { method: 'DELETE' });
                const result = await resp.json();
                alert(`Cleared ${result.cleared} cached files`);
            } catch (e) {
                console.error('[GSO] Clear cache error:', e);
            }
        });
    }

})();
