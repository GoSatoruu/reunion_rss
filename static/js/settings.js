/**
 * Reunion RSS — Settings Page Logic
 * Handles RSS source CRUD operations.
 */

// ─── Initialization ──────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    initTheme();
    loadConfig();
    loadSources();

    document.getElementById("add-source-form").addEventListener("submit", addSource);

    // Quick-add chip buttons
    document.querySelectorAll(".chip").forEach(chip => {
        chip.addEventListener("click", () => {
            const name = chip.dataset.name;
            const url = chip.dataset.url;
            quickAddSource(name, url, chip);
        });
    });

    // Preferences toggles
    document.getElementById("toggle-flights").addEventListener("change", updateConfig);
    document.getElementById("toggle-ships").addEventListener("change", updateConfig);
    document.getElementById("toggle-space").addEventListener("change", updateConfig);
    document.getElementById("flight-provider").addEventListener("change", updateConfig);
    
    document.getElementById("btn-save-api-config")?.addEventListener("click", updateApiConfig);

    document.getElementById("theme-toggle")?.addEventListener("click", toggleTheme);
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
    if (currentTheme === "light") {
        document.documentElement.removeAttribute("data-theme");
        localStorage.setItem("theme", "dark");
    } else {
        document.documentElement.setAttribute("data-theme", "light");
        localStorage.setItem("theme", "light");
    }
}

// ─── Load Configuration ──────────────────────────────
async function loadConfig() {
    try {
        const res = await fetch("/api/config");
        const config = await res.json();
        document.getElementById("toggle-flights").checked = config.enable_flights !== false;
        document.getElementById("toggle-ships").checked = config.enable_ships !== false;
        document.getElementById("toggle-space").checked = config.enable_space !== false;
        
        const providerSelect = document.getElementById("flight-provider");
        if (providerSelect && config.flight_provider) {
            providerSelect.value = config.flight_provider;
        }

        const llmApiUrl = document.getElementById("llm-api-url");
        if (llmApiUrl && config.llm_api_url) llmApiUrl.value = config.llm_api_url;

        const llmApiKey = document.getElementById("llm-api-key");
        if (llmApiKey && config.llm_api_key) llmApiKey.value = config.llm_api_key;

        const llmModel = document.getElementById("llm-model");
        if (llmModel && config.llm_model) llmModel.value = config.llm_model;

    } catch (err) {
        console.error("Load config error:", err);
    }
}

// ─── Update Configuration ────────────────────────────
async function updateConfig() {
    const enable_flights = document.getElementById("toggle-flights").checked;
    const enable_ships = document.getElementById("toggle-ships").checked;
    const enable_space = document.getElementById("toggle-space").checked;
    const flight_provider = document.getElementById("flight-provider")?.value || "opensky";
    
    try {
        const res = await fetch("/api/config", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enable_flights, enable_ships, enable_space, flight_provider })
        });
        if (res.ok) {
            showToast("Preferences saved", "success");
        } else {
            showToast("Failed to save preferences", "error");
        }
    } catch (err) {
        console.error("Update config error:", err);
        showToast("Error saving preferences", "error");
    }
}

// ─── Update API Configuration ────────────────────────
async function updateApiConfig() {
    const llm_api_url = document.getElementById("llm-api-url").value;
    const llm_api_key = document.getElementById("llm-api-key").value;
    const llm_model = document.getElementById("llm-model").value;

    try {
        const res = await fetch("/api/config", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ llm_api_url, llm_api_key, llm_model })
        });
        if (res.ok) {
            showToast("API configurations saved", "success");
        } else {
            showToast("Failed to save API configurations", "error");
        }
    } catch (err) {
        console.error("Update config error:", err);
        showToast("Error saving API configurations", "error");
    }
}

// ─── Load Sources ────────────────────────────────────
async function loadSources() {
    const list = document.getElementById("sources-list");
    const loading = document.getElementById("sources-loading");
    const empty = document.getElementById("sources-empty");

    loading.style.display = "flex";
    empty.style.display = "none";

    // Clear old items
    list.querySelectorAll(".source-item").forEach(el => el.remove());

    try {
        const res = await fetch("/api/sources");
        const sources = await res.json();
        loading.style.display = "none";

        if (!sources.length) {
            empty.style.display = "flex";
            return;
        }

        sources.forEach((src, i) => {
            const item = document.createElement("div");
            item.className = "source-item";
            item.style.animationDelay = `${i * 0.06}s`;
            item.innerHTML = `
                <div class="source-info">
                    <span class="source-name">${escapeHtml(src.name)}</span>
                    <span class="source-url">${escapeHtml(src.url)}</span>
                </div>
                <button class="p-btn p-btn-sm btn-danger" onclick="deleteSource('${src.id}')">
                    ✕ REMOVE
                </button>
            `;
            list.appendChild(item);
        });

        // Update quick-add chips: disable ones already added
        updateChipStates(sources);
    } catch (err) {
        loading.style.display = "none";
        console.error("Load sources error:", err);
        showToast("Error loading sources", "error");
    }
}

// ─── Add Source ──────────────────────────────────────
async function addSource(e) {
    e.preventDefault();

    const nameInput = document.getElementById("source-name");
    const urlInput = document.getElementById("source-url");
    const name = nameInput.value.trim();
    const url = urlInput.value.trim();

    if (!url) {
        showToast("Please enter an RSS feed URL", "error");
        return;
    }

    try {
        const res = await fetch("/api/sources", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, url }),
        });

        if (!res.ok) {
            const data = await res.json();
            showToast(data.error || "Failed to add source", "error");
            return;
        }

        nameInput.value = "";
        urlInput.value = "";
        showToast(`Added "${name || url}"`, "success");
        loadSources();
    } catch (err) {
        console.error("Add source error:", err);
        showToast("Error adding source", "error");
    }
}

// ─── Quick Add ───────────────────────────────────────
async function quickAddSource(name, url, chipEl) {
    chipEl.disabled = true;
    chipEl.style.opacity = "0.5";

    try {
        const res = await fetch("/api/sources", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, url }),
        });

        if (res.ok) {
            showToast(`Added "${name}"`, "success");
            loadSources();
        } else {
            chipEl.disabled = false;
            chipEl.style.opacity = "1";
            showToast("Failed to add source", "error");
        }
    } catch (err) {
        chipEl.disabled = false;
        chipEl.style.opacity = "1";
        showToast("Error adding source", "error");
    }
}

// ─── Delete Source ───────────────────────────────────
async function deleteSource(id) {
    try {
        await fetch(`/api/sources/${id}`, { method: "DELETE" });
        showToast("Source removed", "success");
        loadSources();
    } catch (err) {
        console.error("Delete source error:", err);
        showToast("Error removing source", "error");
    }
}

// ─── Update Chip States ─────────────────────────────
function updateChipStates(sources) {
    const sourceUrls = sources.map(s => s.url);
    document.querySelectorAll(".chip").forEach(chip => {
        const isAdded = sourceUrls.includes(chip.dataset.url);
        chip.disabled = isAdded;
        chip.style.opacity = isAdded ? "0.4" : "1";
        if (isAdded) {
            chip.textContent = `✓ ${chip.dataset.name}`;
        } else {
            chip.textContent = chip.dataset.name;
        }
    });
}

// ─── Toast Notifications ────────────────────────────
function showToast(message, type = "info") {
    const container = document.getElementById("toast-container");
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 3000);
}

// ─── Helpers ─────────────────────────────────────────
function escapeHtml(text) {
    const el = document.createElement("span");
    el.textContent = text;
    return el.innerHTML;
}
