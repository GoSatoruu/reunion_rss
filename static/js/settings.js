/**
 * Reunion RSS — Settings Page Logic
 * Handles RSS source CRUD operations.
 */

// ─── Initialization ──────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
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
});

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
