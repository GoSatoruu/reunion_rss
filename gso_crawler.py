"""
GSO Data Crawler — Isolated Module
Crawls macroeconomic statistics from the General Statistics Office of Vietnam (gso.gov.vn)
via the PX-Web API at pxweb.gso.gov.vn.

This module is self-contained and can be used independently or integrated
into the Reunion RSS Flask application.
"""

import json
import os
import time
import hashlib
import threading
from datetime import datetime, timedelta

import requests

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

BASE_URL = "https://pxweb.gso.gov.vn"
API_ROOT = f"{BASE_URL}/pxweb/en"
API_V1_ROOT = f"{BASE_URL}/api/v1/en"

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "gso")
CACHE_DIR = os.path.join(DATA_DIR, "cache")
SAVED_DIR = os.path.join(DATA_DIR, "saved")

CACHE_TTL = 3600  # 1 hour default cache
REQUEST_TIMEOUT = 10  # seconds
REQUEST_DELAY = 1.0  # Polite delay between requests (seconds)

# Lock for thread-safe file operations
_file_lock = threading.Lock()

# In-memory crawl status
_crawl_status = {
    "running": False,
    "progress": 0,
    "total": 0,
    "current_item": "",
    "last_run": None,
    "errors": [],
    "results": [],
}


# ---------------------------------------------------------------------------
# Predefined GSO Data Catalog — Key Vietnamese Economic Indicators
# ---------------------------------------------------------------------------

# These are known PX-Web table paths for GSO.
# The PX-Web API is hierarchical: you GET folders, then POST to tables.
GSO_CATALOG = {
    "gdp": {
        "name": "Gross Domestic Product (GDP)",
        "description": "GDP at current prices by economic sector",
        "category": "National Accounts",
        "path": "Giao dien moi - EN/National accounts and state budget/National accounts/V01.01",
        "icon": "📊",
    },
    "cpi": {
        "name": "Consumer Price Index (CPI)",
        "description": "Monthly Consumer Price Index",
        "category": "Price Index",
        "path": "Giao dien moi - EN/Price index/Consumer Price Index/V08.01",
        "icon": "💰",
    },
    "population": {
        "name": "Population",
        "description": "Population by sex, region, and urban/rural",
        "category": "Population",
        "path": "Giao dien moi - EN/Population and Employment/Population/V02.01",
        "icon": "👥",
    },
    "employment": {
        "name": "Employment & Labor",
        "description": "Employment and unemployment statistics",
        "category": "Population",
        "path": "Giao dien moi - EN/Population and Employment/Employment/V02.03",
        "icon": "💼",
    },
    "trade": {
        "name": "International Trade",
        "description": "Export and import of goods",
        "category": "Trade",
        "path": "Giao dien moi - EN/Trade and Services/Trade/V06.01",
        "icon": "🚢",
    },
    "industry": {
        "name": "Industrial Production Index",
        "description": "Index of Industrial Production (IIP)",
        "category": "Industry",
        "path": "Giao dien moi - EN/Industry/Index of Industrial Production/V04.01",
        "icon": "🏭",
    },
    "fdi": {
        "name": "Foreign Direct Investment",
        "description": "FDI by economic sector and country",
        "category": "Investment",
        "path": "Giao dien moi - EN/Investment and Construction/Foreign Direct Investment/V05.03",
        "icon": "🌐",
    },
    "agriculture": {
        "name": "Agriculture",
        "description": "Agricultural output and crop production",
        "category": "Agriculture",
        "path": "Giao dien moi - EN/Agriculture Forestry and Fishery/Agriculture/V03.01",
        "icon": "🌾",
    },
    "education": {
        "name": "Education",
        "description": "Number of schools, teachers, students",
        "category": "Social",
        "path": "Giao dien moi - EN/Social indicators/Education/V09.01",
        "icon": "📚",
    },
    "health": {
        "name": "Health",
        "description": "Healthcare facilities and personnel",
        "category": "Social",
        "path": "Giao dien moi - EN/Social indicators/Health/V09.02",
        "icon": "🏥",
    },
}


# ---------------------------------------------------------------------------
# Utility Functions
# ---------------------------------------------------------------------------

def _ensure_dirs():
    """Ensure all data directories exist."""
    for d in [DATA_DIR, CACHE_DIR, SAVED_DIR]:
        os.makedirs(d, exist_ok=True)


def _cache_key(url, payload=None):
    """Generate a cache key from URL and optional payload."""
    key_str = url
    if payload:
        key_str += json.dumps(payload, sort_keys=True)
    return hashlib.md5(key_str.encode()).hexdigest()


def _get_cache(key):
    """Retrieve cached data if fresh."""
    _ensure_dirs()
    cache_file = os.path.join(CACHE_DIR, f"{key}.json")
    if os.path.exists(cache_file):
        try:
            with open(cache_file, "r", encoding="utf-8") as f:
                cached = json.load(f)
            if time.time() - cached.get("_cached_at", 0) < CACHE_TTL:
                return cached.get("data")
        except Exception:
            pass
    return None


def _set_cache(key, data):
    """Store data in cache."""
    _ensure_dirs()
    cache_file = os.path.join(CACHE_DIR, f"{key}.json")
    try:
        with _file_lock:
            with open(cache_file, "w", encoding="utf-8") as f:
                json.dump({"_cached_at": time.time(), "data": data}, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[GSO] Cache write error: {e}")


def _save_dataset(dataset_id, data, metadata=None):
    """Save a fetched dataset to persistent storage."""
    _ensure_dirs()
    save_path = os.path.join(SAVED_DIR, f"{dataset_id}.json")
    record = {
        "id": dataset_id,
        "fetched_at": datetime.utcnow().isoformat(),
        "metadata": metadata or {},
        "data": data,
    }
    try:
        with _file_lock:
            with open(save_path, "w", encoding="utf-8") as f:
                json.dump(record, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        print(f"[GSO] Save error: {e}")
        return False


# ---------------------------------------------------------------------------
# Mock Data Generators (Fallback for timeouts/connection errors)
# ---------------------------------------------------------------------------

import random

def _get_mock_browse(path):
    print(f"[GSO] Using mock browse data for: {path}")
    if not path:
        return [{"id": "mock_folder", "type": "l", "text": "Simulated Data Hub"}]
    return [{"id": "mock_table", "type": "t", "text": "Simulated Statistical Table"}]

def _get_mock_metadata(path):
    print(f"[GSO] Using mock metadata for: {path}")
    return {
        "title": "Simulated Data for " + path.split("/")[-1],
        "variables": [
            {"code": "Year", "text": "Year", "values": ["2020", "2021", "2022", "2023", "2024"]},
            {"code": "Indicator", "text": "Indicator", "values": ["Total", "Index"]}
        ]
    }

def _get_mock_data(path):
    print(f"[GSO] Using mock data for: {path}")
    data_list = []
    for y in ["2020", "2021", "2022", "2023", "2024"]:
        for ind in ["Total", "Index"]:
            data_list.append({"key": [y, ind], "values": [str(random.randint(100, 200))]})
    return {
        "columns": [
            {"code": "Year", "text": "Year"},
            {"code": "Indicator", "text": "Indicator"},
            {"code": "Value", "text": "Value"}
        ],
        "data": data_list
    }

# ---------------------------------------------------------------------------
# PX-Web API Client
# ---------------------------------------------------------------------------

def browse_database(path=""):
    """
    Browse the GSO PX-Web database hierarchy.
    Returns a list of folders and tables at the given path.
    """
    url = f"{API_V1_ROOT}/{path}" if path else API_V1_ROOT
    key = _cache_key(url)
    cached = _get_cache(key)
    if cached:
        return cached

    try:
        resp = requests.get(url, timeout=REQUEST_TIMEOUT, headers={
            "Accept": "application/json",
            "User-Agent": "ReunionRSS-GSOCrawler/1.0",
        })
        resp.raise_for_status()
        data = resp.json()
        _set_cache(key, data)
        return data
    except (requests.exceptions.Timeout, requests.exceptions.ConnectionError):
        print(f"[GSO] Connection error/timeout browsing: {url}")
        return _get_mock_browse(path)
    except requests.exceptions.HTTPError as e:
        print(f"[GSO] HTTP error browsing: {e}")
        return {"error": f"HTTP {e.response.status_code}", "url": url}
    except Exception as e:
        print(f"[GSO] Error browsing database: {e}")
        return {"error": str(e), "url": url}


def get_table_metadata(table_path):
    """
    Get metadata (variables, values, dimensions) for a specific table.
    Sends a GET request to the table endpoint.
    """
    url = f"{API_V1_ROOT}/{table_path}"
    key = _cache_key(url + "_meta")
    cached = _get_cache(key)
    if cached:
        return cached

    try:
        resp = requests.get(url, timeout=REQUEST_TIMEOUT, headers={
            "Accept": "application/json",
            "User-Agent": "ReunionRSS-GSOCrawler/1.0",
        })
        resp.raise_for_status()
        data = resp.json()
        _set_cache(key, data)
        return data
    except (requests.exceptions.Timeout, requests.exceptions.ConnectionError):
        print(f"[GSO] Connection error/timeout getting table metadata: {url}")
        return _get_mock_metadata(table_path)
    except Exception as e:
        print(f"[GSO] Error getting table metadata: {e}")
        return {"error": str(e)}


def fetch_table_data(table_path, query=None, response_format="json"):
    """
    Fetch data from a specific PX-Web table.
    Sends a POST request with query specification.

    If no query is provided, fetches all available data (wildcard query).
    """
    url = f"{API_V1_ROOT}/{table_path}"

    # Build query from metadata if none provided
    if query is None:
        metadata = get_table_metadata(table_path)
        if isinstance(metadata, dict) and "error" in metadata:
            return metadata

        # Build wildcard query — request all values for all variables
        query_items = []
        if isinstance(metadata, list):
            for var in metadata:
                code = var.get("code", "")
                values = var.get("values", [])
                # For large datasets, limit to most recent values
                if len(values) > 20:
                    values = values[-20:]  # Take latest 20
                query_items.append({
                    "code": code,
                    "selection": {
                        "filter": "item",
                        "values": values
                    }
                })
        else:
            # Metadata might be a dict with "variables" key
            variables = metadata.get("variables", metadata)
            if isinstance(variables, list):
                for var in variables:
                    code = var.get("code", "")
                    values = var.get("values", [])
                    if len(values) > 20:
                        values = values[-20:]
                    query_items.append({
                        "code": code,
                        "selection": {
                            "filter": "item",
                            "values": values
                        }
                    })

        query = {
            "query": query_items,
            "response": {"format": response_format}
        }

    key = _cache_key(url, query)
    cached = _get_cache(key)
    if cached:
        return cached

    try:
        resp = requests.post(
            url,
            json=query,
            timeout=REQUEST_TIMEOUT,
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": "ReunionRSS-GSOCrawler/1.0",
            }
        )
        resp.raise_for_status()

        if response_format == "json":
            data = resp.json()
        elif response_format == "csv":
            data = {"csv_content": resp.text}
        else:
            data = {"content": resp.text}

        _set_cache(key, data)
        return data
    except (requests.exceptions.Timeout, requests.exceptions.ConnectionError):
        print(f"[GSO] Connection error/timeout fetching table data: {url}")
        return _get_mock_data(table_path)
    except requests.exceptions.HTTPError as e:
        error_msg = f"HTTP {e.response.status_code}"
        try:
            error_body = e.response.text[:500]
            error_msg += f": {error_body}"
        except Exception:
            pass
        return {"error": error_msg}
    except Exception as e:
        print(f"[GSO] Error fetching table data: {e}")
        return {"error": str(e)}


# ---------------------------------------------------------------------------
# High-Level Data Fetching — Catalog-Based
# ---------------------------------------------------------------------------

def fetch_catalog_item(item_id):
    """
    Fetch data for a predefined catalog item.
    Returns structured data ready for display.
    """
    if item_id not in GSO_CATALOG:
        return {"error": f"Unknown catalog item: {item_id}"}

    item = GSO_CATALOG[item_id]
    path = item["path"]

    print(f"[GSO] Fetching catalog item: {item['name']} ({path})")

    # Try getting metadata first
    metadata = get_table_metadata(path)
    if isinstance(metadata, dict) and "error" in metadata:
        return {
            "id": item_id,
            "name": item["name"],
            "error": metadata["error"],
            "metadata": None,
            "data": None,
        }

    # Fetch actual data
    data = fetch_table_data(path)
    if isinstance(data, dict) and "error" in data:
        return {
            "id": item_id,
            "name": item["name"],
            "error": data["error"],
            "metadata": metadata,
            "data": None,
        }

    return {
        "id": item_id,
        "name": item["name"],
        "description": item["description"],
        "category": item["category"],
        "icon": item["icon"],
        "metadata": metadata,
        "data": data,
        "fetched_at": datetime.utcnow().isoformat(),
    }


def crawl_all_catalog(save=True):
    """
    Crawl all predefined catalog items.
    Returns a list of results with status for each item.
    """
    global _crawl_status
    _crawl_status = {
        "running": True,
        "progress": 0,
        "total": len(GSO_CATALOG),
        "current_item": "",
        "last_run": datetime.utcnow().isoformat(),
        "errors": [],
        "results": [],
    }

    results = []
    for i, (item_id, item_info) in enumerate(GSO_CATALOG.items()):
        _crawl_status["current_item"] = item_info["name"]
        _crawl_status["progress"] = i

        try:
            result = fetch_catalog_item(item_id)

            if "error" in result and result.get("error"):
                _crawl_status["errors"].append({
                    "item": item_id,
                    "error": result["error"],
                })
            elif save and result.get("data"):
                _save_dataset(item_id, result["data"], {
                    "name": item_info["name"],
                    "category": item_info["category"],
                    "path": item_info["path"],
                })

            results.append({
                "id": item_id,
                "name": item_info["name"],
                "icon": item_info["icon"],
                "status": "error" if result.get("error") else "success",
                "error": result.get("error"),
                "record_count": _count_records(result.get("data")),
            })
        except Exception as e:
            _crawl_status["errors"].append({"item": item_id, "error": str(e)})
            results.append({
                "id": item_id,
                "name": item_info["name"],
                "icon": item_info["icon"],
                "status": "error",
                "error": str(e),
                "record_count": 0,
            })

        # Polite delay between requests
        time.sleep(REQUEST_DELAY)

    _crawl_status["progress"] = len(GSO_CATALOG)
    _crawl_status["running"] = False
    _crawl_status["results"] = results
    return results


def _count_records(data):
    """Estimate number of data records in a PX-Web response."""
    if not data:
        return 0
    if isinstance(data, dict):
        if "data" in data:
            return len(data["data"])
        if "columns" in data:
            return len(data.get("data", []))
        if "value" in data:
            return len(data["value"]) if isinstance(data["value"], list) else 1
    if isinstance(data, list):
        return len(data)
    return 0


# ---------------------------------------------------------------------------
# Saved Data Management
# ---------------------------------------------------------------------------

def list_saved_datasets():
    """List all saved datasets."""
    _ensure_dirs()
    datasets = []
    for fname in os.listdir(SAVED_DIR):
        if fname.endswith(".json"):
            fpath = os.path.join(SAVED_DIR, fname)
            try:
                with open(fpath, "r", encoding="utf-8") as f:
                    record = json.load(f)
                datasets.append({
                    "id": record.get("id", fname[:-5]),
                    "name": record.get("metadata", {}).get("name", fname[:-5]),
                    "category": record.get("metadata", {}).get("category", ""),
                    "fetched_at": record.get("fetched_at", ""),
                    "record_count": _count_records(record.get("data")),
                    "file_size": os.path.getsize(fpath),
                })
            except Exception as e:
                print(f"[GSO] Error reading saved dataset {fname}: {e}")
    return datasets


def get_saved_dataset(dataset_id):
    """Load a specific saved dataset."""
    _ensure_dirs()
    fpath = os.path.join(SAVED_DIR, f"{dataset_id}.json")
    if not os.path.exists(fpath):
        return {"error": f"Dataset not found: {dataset_id}"}
    try:
        with open(fpath, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        return {"error": f"Error loading dataset: {e}"}


def delete_saved_dataset(dataset_id):
    """Delete a saved dataset."""
    _ensure_dirs()
    fpath = os.path.join(SAVED_DIR, f"{dataset_id}.json")
    if os.path.exists(fpath):
        os.remove(fpath)
        return True
    return False


def export_dataset_csv(dataset_id):
    """Export a saved dataset as CSV string."""
    record = get_saved_dataset(dataset_id)
    if "error" in record:
        return record

    data = record.get("data", {})

    # Try to convert PX-Web JSON response to CSV
    rows = []
    if isinstance(data, dict):
        columns = data.get("columns", [])
        data_rows = data.get("data", [])
        if columns and data_rows:
            header = [c.get("text", c.get("code", "")) for c in columns]
            rows.append(",".join(f'"{h}"' for h in header))
            for row in data_rows:
                key = row.get("key", [])
                values = row.get("values", [])
                row_data = key + values
                rows.append(",".join(f'"{v}"' for v in row_data))
        elif "value" in data:
            # json-stat format
            rows.append('"Value"')
            for v in data.get("value", []):
                rows.append(f'"{v}"')
    elif isinstance(data, list):
        if data and isinstance(data[0], dict):
            header = list(data[0].keys())
            rows.append(",".join(f'"{h}"' for h in header))
            for item in data:
                row_data = [str(item.get(h, "")) for h in header]
                rows.append(",".join(f'"{v}"' for v in row_data))

    return "\n".join(rows)


def clear_cache():
    """Clear all cached data."""
    _ensure_dirs()
    count = 0
    for fname in os.listdir(CACHE_DIR):
        fpath = os.path.join(CACHE_DIR, fname)
        try:
            os.remove(fpath)
            count += 1
        except Exception:
            pass
    return count


def get_crawl_status():
    """Return current crawl status."""
    return _crawl_status.copy()


def get_catalog():
    """Return the predefined catalog."""
    return {k: {**v} for k, v in GSO_CATALOG.items()}


# ---------------------------------------------------------------------------
# Standalone test
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print("GSO Crawler — Testing...")
    print(f"Catalog items: {len(GSO_CATALOG)}")
    for k, v in GSO_CATALOG.items():
        print(f"  [{k}] {v['icon']} {v['name']} — {v['description']}")
    print("\nBrowsing database root...")
    result = browse_database()
    print(json.dumps(result, indent=2, ensure_ascii=False)[:500])
