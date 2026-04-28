"""
Reunion RSS — News Feed & Live Tracking Web App
Flask backend with RSS aggregation, flight tracking proxy, and settings management.
"""

import json
import os
import uuid
from datetime import datetime

import feedparser
import requests
import yfinance as yf
from flask import Flask, jsonify, render_template, request, Response

# FlightRadar24 SDK
try:
    from FlightRadar24 import FlightRadar24API
    _fr24_available = True
except ImportError:
    _fr24_available = False
    print("[FLIGHTS] FlightRadar24API not installed — FR24 provider unavailable")

app = Flask(__name__)

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
SOURCES_FILE = os.path.join(DATA_DIR, "sources.json")
CONFIG_FILE = os.path.join(DATA_DIR, "config.json")

# Default configuration settings
DEFAULT_CONFIG = {
    "enable_flights": True,
    "enable_ships": True,
    "enable_space": True,
    "llm_api_url": "http://localhost:1234/v1",
    "llm_api_key": "lm-studio",
    "llm_model": "local-model"
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _load_sources():
    """Load RSS sources from JSON file."""
    os.makedirs(DATA_DIR, exist_ok=True)
    if not os.path.exists(SOURCES_FILE):
        with open(SOURCES_FILE, "w") as f:
            json.dump([], f)
        return []
    with open(SOURCES_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def _save_sources(sources):
    """Persist RSS sources to JSON file."""
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(SOURCES_FILE, "w", encoding="utf-8") as f:
        json.dump(sources, f, indent=2)


def _load_config():
    """Load configuration settings."""
    os.makedirs(DATA_DIR, exist_ok=True)
    if not os.path.exists(CONFIG_FILE):
        _save_config(DEFAULT_CONFIG)
        return DEFAULT_CONFIG
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            config = json.load(f)
            # Merge with defaults to ensure all keys exist
            merged = DEFAULT_CONFIG.copy()
            merged.update(config)
            return merged
    except Exception:
        return DEFAULT_CONFIG


def _save_config(config):
    """Persist configuration settings."""
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2)


# ---------------------------------------------------------------------------
# Page routes
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/settings")
def settings():
    return render_template("settings.html")


@app.route("/finance")
def finance_page():
    return render_template("finance.html")


@app.route("/social")
def social_page():
    return render_template("social.html")


# ---------------------------------------------------------------------------
# RSS Source CRUD API
# ---------------------------------------------------------------------------

@app.route("/api/sources", methods=["GET"])
def get_sources():
    return jsonify(_load_sources())


@app.route("/api/sources", methods=["POST"])
def add_source():
    data = request.get_json(force=True)
    name = data.get("name", "").strip()
    url = data.get("url", "").strip()
    if not url:
        return jsonify({"error": "URL is required"}), 400

    sources = _load_sources()
    new_source = {
        "id": str(uuid.uuid4()),
        "name": name or url,
        "url": url,
        "added": datetime.utcnow().isoformat(),
    }
    sources.append(new_source)
    _save_sources(sources)
    return jsonify(new_source), 201


@app.route("/api/sources/<source_id>", methods=["DELETE"])
def delete_source(source_id):
    sources = _load_sources()
    sources = [s for s in sources if s["id"] != source_id]
    _save_sources(sources)
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Config API
# ---------------------------------------------------------------------------

@app.route("/api/config", methods=["GET"])
def get_config():
    return jsonify(_load_config())


@app.route("/api/config", methods=["PUT"])
def update_config():
    data = request.get_json(force=True)
    config = _load_config()
    
    if "enable_flights" in data:
        config["enable_flights"] = bool(data["enable_flights"])
    if "enable_ships" in data:
        config["enable_ships"] = bool(data["enable_ships"])
    if "enable_space" in data:
        config["enable_space"] = bool(data["enable_space"])
    if "flight_provider" in data:
        config["flight_provider"] = str(data["flight_provider"])
    if "llm_api_url" in data:
        config["llm_api_url"] = str(data["llm_api_url"])
    if "llm_api_key" in data:
        config["llm_api_key"] = str(data["llm_api_key"])
    if "llm_model" in data:
        config["llm_model"] = str(data["llm_model"])
        
    _save_config(config)
    return jsonify(config)


# ---------------------------------------------------------------------------
# Social Listening & LLM Analysis
# ---------------------------------------------------------------------------

@app.route("/api/social/analyze", methods=["POST"])
def social_analyze():
    config = _load_config()
    data = request.get_json(force=True) if request.data else {}
    prompt_type = data.get("type", "summary")
    
    sources = _load_sources()
    articles = []
    for src in sources:
        try:
            feed = feedparser.parse(src["url"])
            for entry in feed.entries[:3]:
                # Truncate overly long summaries to save tokens
                summary = str(getattr(entry, 'summary', ''))
                if len(summary) > 600:
                    summary = summary[:600] + "..."
                articles.append(f"Title: {getattr(entry, 'title', '')}\nSummary: {summary}")
        except Exception as e:
            print(f"[SOCIAL] Error reading RSS: {e}")
            pass
            
    # Limit total articles and chunk them
    articles = articles[:15]
    chunk_size = 5
    article_chunks = [articles[i:i + chunk_size] for i in range(0, len(articles), chunk_size)]
    
    if prompt_type == "summary":
        task = "Summarize the key geopolitical, financial, and technological events from the provided news context. YOU MUST RESPOND ENTIRELY IN VIETNAMESE."
    elif prompt_type == "sentiment":
        task = "Analyze the overall sentiment of the provided news context. Highlight positive, negative, and neutral trends. YOU MUST RESPOND ENTIRELY IN VIETNAMESE."
    elif prompt_type == "entities":
        task = "Extract the key entities (people, organizations, countries) mentioned in the context and their current status or actions. YOU MUST RESPOND ENTIRELY IN VIETNAMESE."
    else:
        task = "Analyze the following news context. YOU MUST RESPOND ENTIRELY IN VIETNAMESE."

    base_url = config.get("llm_api_url", "http://localhost:1234/v1").rstrip('/')
    if not base_url.endswith("/v1"):
        base_url += "/v1"
    url = base_url + "/chat/completions"
    headers = {
        "Authorization": f"Bearer {config.get('llm_api_key', 'lm-studio')}",
        "Content-Type": "application/json"
    }

    def generate():
        import json
        try:
            for chunk in article_chunks:
                if not chunk: continue
                context = "\n\n".join(chunk)
                full_prompt = f"Context (Latest News Part):\n{context}\n\nTask: {task}"
                
                payload = {
                    "model": config.get("llm_model", "local-model"),
                    "messages": [
                        {"role": "system", "content": "You are a senior intelligence analyst. Provide concise, highly analytical, and objective reports based only on the context provided. Use markdown formatting. YOUR OUTPUT MUST BE IN VIETNAMESE."},
                        {"role": "user", "content": full_prompt}
                    ],
                    "temperature": 0.3,
                    "stream": True
                }
                
                resp = requests.post(url, json=payload, headers=headers, stream=True, timeout=300)
                if resp.status_code != 200:
                    try:
                        err_data = resp.json()
                        err_msg = err_data.get("error", err_data)
                        err_content = "\n\n**[LM Studio Error: " + str(err_msg) + "]**"
                        yield "data: " + json.dumps({"content": err_content}) + "\n\n"
                    except Exception:
                        err_content = "\n\n**[HTTP " + str(resp.status_code) + "]**"
                        yield "data: " + json.dumps({"content": err_content}) + "\n\n"
                    break
                    
                for line in resp.iter_lines():
                    if line:
                        line_str = line.decode('utf-8')
                        if line_str.startswith("data: "):
                            data_str = line_str[6:]
                            if data_str == "[DONE]":
                                continue
                            try:
                                j = json.loads(data_str)
                                content = j["choices"][0]["delta"].get("content", "")
                                if content:
                                    yield "data: " + json.dumps({"content": content}) + "\n\n"
                            except Exception:
                                pass
                                
                yield "data: " + json.dumps({"content": "\n\n---\n\n"}) + "\n\n"
                
            yield "data: [DONE]\n\n"
        except Exception as e:
            err_content = "\n\n**[Backend Error: " + str(e) + "]**"
            yield "data: " + json.dumps({"content": err_content}) + "\n\n"

    return Response(generate(), mimetype='text/event-stream')


# ---------------------------------------------------------------------------
# Social Listening Engine — Financial Signal Processing API
# ---------------------------------------------------------------------------

import social_engine

@app.route("/api/social/dashboard")
def social_dashboard():
    """Return complete social listening dashboard metrics."""
    try:
        # Auto-generate mock data if store is empty (demo mode)
        if not social_engine.get_records():
            social_engine.generate_mock_records(80)

        summary = social_engine.build_dashboard_summary()
        return jsonify(summary)
    except Exception as e:
        print(f"[SOCIAL_ENGINE] Dashboard error: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/social/scan", methods=["POST"])
def social_scan():
    """Scan RSS feeds and process through the extraction pipeline."""
    try:
        config = _load_config()
        data = request.get_json(force=True) if request.data else {}
        use_llm = data.get("use_llm", False)

        sources = _load_sources()
        articles = []
        for src in sources:
            try:
                feed = feedparser.parse(src["url"])
                for entry in feed.entries[:5]:
                    summary = str(getattr(entry, 'summary', ''))
                    if len(summary) > 600:
                        summary = summary[:600] + "..."
                    articles.append({
                        "title": getattr(entry, 'title', ''),
                        "summary": summary,
                        "source": src["name"],
                    })
            except Exception as e:
                print(f"[SOCIAL_SCAN] Error reading RSS: {e}")

        articles = articles[:30]  # Limit

        new_records = social_engine.process_rss_articles(
            articles, config, use_llm=use_llm
        )

        return jsonify({
            "status": "success",
            "articles_processed": len(articles),
            "records_created": len(new_records),
            "records": [r.to_dict() for r in new_records[:20]],
        })
    except Exception as e:
        print(f"[SOCIAL_SCAN] Error: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/social/mock", methods=["POST"])
def social_generate_mock():
    """Generate mock social listening data for demonstration."""
    try:
        data = request.get_json(force=True) if request.data else {}
        count = min(int(data.get("count", 80)), 200)
        records = social_engine.generate_mock_records(count)
        return jsonify({
            "status": "success",
            "records_generated": len(records),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/social/hot-assets")
def social_hot_assets():
    """Return hot assets ranked by mention volume."""
    records = social_engine.get_records()
    from datetime import timedelta as _td
    cutoff = datetime.utcnow() - _td(hours=1)
    recent = [r for r in records if r.timestamp > cutoff]
    return jsonify(social_engine.get_hot_assets(recent))


@app.route("/api/social/fud-fomo-radar")
def social_fud_fomo_radar():
    """Return FOMO/FUD extreme index per asset."""
    records = social_engine.get_records()
    from datetime import timedelta as _td
    cutoff = datetime.utcnow() - _td(hours=1)
    recent = [r for r in records if r.timestamp > cutoff]
    return jsonify(social_engine.get_fud_fomo_radar(recent))


@app.route("/api/social/alerts")
def social_alerts():
    """Return recent market anomaly alerts."""
    return jsonify(social_engine.get_alerts()[-20:])


@app.route("/api/social/sentiment-trend")
def social_sentiment_trend():
    """Return ASI trend for a specific asset."""
    asset = request.args.get("asset", "BTC")
    interval = int(request.args.get("interval", 15))
    records = social_engine.get_records()
    trend = social_engine.get_sentiment_trend(records, asset, interval)
    return jsonify(trend)


# ---------------------------------------------------------------------------
# RSS Feed aggregation
# ---------------------------------------------------------------------------

@app.route("/api/feed")
def get_feed():
    sources = _load_sources()
    articles = []

    for src in sources:
        try:
            feed = feedparser.parse(src["url"])
            for entry in feed.entries[:15]:  # max 15 per source
                published = ""
                if hasattr(entry, "published"):
                    published = entry.published
                elif hasattr(entry, "updated"):
                    published = entry.updated

                articles.append({
                    "title": getattr(entry, "title", "No title"),
                    "link": getattr(entry, "link", "#"),
                    "summary": getattr(entry, "summary", ""),
                    "published": published,
                    "source": src["name"],
                    "source_id": src["id"],
                })
        except Exception as e:
            print(f"[RSS] Error parsing {src['url']}: {e}")

    # Sort by published date descending (best effort)
    articles.sort(key=lambda a: a.get("published", ""), reverse=True)
    return jsonify(articles)


# ---------------------------------------------------------------------------
# Flight Tracking Proxy  (OpenSky Network)
# ---------------------------------------------------------------------------

OPENSKY_URL = "https://opensky-network.org/api/states/all"

# In-memory cache for OpenSky data (prevents 429 rate limiting)
import time as _time
_opensky_cache = {
    "data": None,
    "flights": [],
    "timestamp": 0,
}
OPENSKY_CACHE_TTL = 30  # seconds — OpenSky free tier allows ~10 req/min
FR24_CACHE_TTL = 15  # seconds — FR24 has better coverage, cache briefly


# ── FR24 ICAO24-to-country lookup (top registrations) ─────────────
_FR24_COUNTRY_PREFIXES = {
    "a": "United States", "4b": "Switzerland", "3c": "Germany",
    "40": "United Kingdom", "48": "Austria", "44": "Belgium",
    "38": "France", "33": "Italy", "34": "Spain", "47": "Norway",
    "46": "Denmark", "4c": "Ireland", "49": "Finland", "4d": "Netherlands",
    "50": "Czech Republic", "89": "South Korea", "88": "Thailand",
    "8a": "Japan", "76": "Brazil", "e0": "Mexico", "c0": "Canada",
    "7c": "Australia", "71": "South Africa", "78": "China",
    "75": "India", "70": "Pakistan", "06": "Morocco",
    "0c": "Egypt", "60": "Ethiopia", "74": "Vietnam",
    "50": "Israel", "4a": "Sweden", "01": "Nigeria",
    "80": "Indonesia", "73": "Argentina", "e4": "Colombia",
    "ab": "UAE", "aa": "Saudi Arabia", "a9": "Qatar",
    "a8": "Kuwait", "a0": "Turkey", "15": "Russia",
    "86": "Taiwan", "76": "Singapore", "84": "Malaysia",
    "85": "Philippines",
}


def _guess_country_from_icao(icao24):
    """Rough country guess from ICAO24 hex prefix."""
    if not icao24:
        return "Unknown"
    icao_lower = icao24.lower()
    # Try 2-char prefix first, then 1-char
    prefix2 = icao_lower[:2]
    prefix1 = icao_lower[:1]
    return _FR24_COUNTRY_PREFIXES.get(prefix2, _FR24_COUNTRY_PREFIXES.get(prefix1, "Unknown"))


def _get_fr24_data():
    """Fetch live flight data from FlightRadar24 via the unofficial SDK."""
    if not _fr24_available:
        print("[FLIGHTS] FlightRadar24API not available, falling back to mock")
        return _generate_mock_flights()

    try:
        fr_api = FlightRadar24API()
        raw_flights = fr_api.get_flights()

        flights = []
        for f in raw_flights:
            lat = f.latitude
            lon = f.longitude
            if lat is None or lon is None:
                continue
            if lat == 0 and lon == 0:
                continue

            alt_m = (f.altitude or 0) * 0.3048  # FR24 returns feet → convert to meters
            speed_ms = (f.ground_speed or 0) * 0.514444  # knots → m/s
            on_ground = f.on_ground if hasattr(f, "on_ground") else (alt_m < 100)

            # Try to get origin country from ICAO24 hex address
            country = _guess_country_from_icao(f.icao_24bit)

            flights.append({
                "icao24": f.icao_24bit or "",
                "callsign": (f.callsign or "").strip(),
                "country": country,
                "lon": lon,
                "lat": lat,
                "alt": alt_m,
                "velocity": speed_ms,
                "heading": f.heading or 0,
                "on_ground": on_ground,
                "airline_icao": getattr(f, "airline_icao", "") or "",
                "aircraft_code": getattr(f, "aircraft_code", "") or "",
                "registration": getattr(f, "registration", "") or "",
                "origin": getattr(f, "origin_airport_iata", "") or "",
                "destination": getattr(f, "destination_airport_iata", "") or "",
            })

        data = {"time": int(_time.time()), "provider": "flightradar24"}
        print(f"[FLIGHTS] FlightRadar24 fetched: {len(flights)} aircraft")
        return data, flights

    except Exception as e:
        print(f"[FLIGHTS] FlightRadar24 error: {e}")
        # Return stale cache or mock
        if _opensky_cache["data"] is not None:
            return _opensky_cache["data"], _opensky_cache["flights"]
        return _generate_mock_flights()


def _generate_mock_flights():
    """Procedurally generates realistic global flight data for the mock provider."""
    import random
    random.seed(int(_time.time() / 60)) # Change pattern every minute
    
    flights = []
    # Major hubs (lat, lon)
    hubs = [
        (40.64, -73.77), (51.47, -0.45), (35.77, 140.39), 
        (1.36, 103.99), (25.25, 55.36), (49.00, 2.54),
        (37.61, -122.37), (22.30, 113.91), (-33.94, 151.17)
    ]
    
    countries = ["United States", "China", "United Kingdom", "France", "Japan", "Germany", "UAE", "Australia", "Singapore", "Canada"]
    prefixes = ["AAL", "DAL", "UAL", "BAW", "AFR", "JAL", "UAE", "SIA", "QFA", "ACA", "CCA"]
    
    for i in range(2500):
        # Pick a random hub, scatter flights around it
        hub_lat, hub_lon = random.choice(hubs)
        lat = hub_lat + random.uniform(-15, 15)
        lon = hub_lon + random.uniform(-25, 25)
        
        # Determine altitude and speed
        alt = random.randint(8000, 12000) if random.random() > 0.2 else random.randint(1000, 8000)
        speed = random.randint(220, 270) if alt > 8000 else random.randint(100, 200) # m/s (x 3.6 for kmh)
        heading = random.randint(0, 359)
        on_ground = random.random() < 0.05
        
        flights.append({
            "icao24": f"{random.randint(100000, 999999)}",
            "callsign": f"{random.choice(prefixes)}{random.randint(10, 9999)}",
            "country": random.choice(countries),
            "lon": lon,
            "lat": lat,
            "alt": 0 if on_ground else alt,
            "velocity": 0 if on_ground else speed,
            "heading": heading,
            "on_ground": on_ground,
        })
    
    return {
        "time": int(_time.time()),
        "states": [] # Not needed since we return parsed flights
    }, flights


def _get_opensky_data(force_refresh=False):
    """Fetch flight data from selected provider with caching."""
    now = _time.time()

    # Check config for provider
    config = _load_config()
    provider = config.get("flight_provider", "opensky")

    if provider == "mock":
        # Always generate fresh mock data or rely on a short cache
        if not force_refresh and _opensky_cache["data"] is not None and _opensky_cache.get("provider") == "mock":
            if now - _opensky_cache["timestamp"] < 3: # Fast update for mock
                return _opensky_cache["data"], _opensky_cache["flights"]
        
        data, flights = _generate_mock_flights()
        _opensky_cache["data"] = data
        _opensky_cache["flights"] = flights
        _opensky_cache["timestamp"] = now
        _opensky_cache["provider"] = "mock"
        return data, flights

    # ── FlightRadar24 provider ────────────────────────
    if provider == "flightradar24":
        if not force_refresh and _opensky_cache["data"] is not None and _opensky_cache.get("provider") == "flightradar24":
            if now - _opensky_cache["timestamp"] < FR24_CACHE_TTL:
                return _opensky_cache["data"], _opensky_cache["flights"]

        data, flights = _get_fr24_data()
        _opensky_cache["data"] = data
        _opensky_cache["flights"] = flights
        _opensky_cache["timestamp"] = now
        _opensky_cache["provider"] = "flightradar24"
        return data, flights

    # ── OpenSky provider (default) ────────────────────
    # Return cache if fresh
    if not force_refresh and _opensky_cache["data"] is not None and _opensky_cache.get("provider") == "opensky":
        if now - _opensky_cache["timestamp"] < OPENSKY_CACHE_TTL:
            return _opensky_cache["data"], _opensky_cache["flights"]

    try:
        resp = requests.get(OPENSKY_URL, timeout=15)
        resp.raise_for_status()
        data = resp.json()

        flights = []
        if data and data.get("states"):
            for s in data["states"]:
                if s[5] is not None and s[6] is not None:
                    flights.append({
                        "icao24": s[0],
                        "callsign": (s[1] or "").strip(),
                        "country": s[2],
                        "lon": s[5],
                        "lat": s[6],
                        "alt": s[7] or 0,
                        "velocity": s[9] or 0,
                        "heading": s[10] or 0,
                        "on_ground": s[8],
                    })

        # Update cache
        _opensky_cache["data"] = data
        _opensky_cache["flights"] = flights
        _opensky_cache["timestamp"] = now
        _opensky_cache["provider"] = "opensky"
        print(f"[FLIGHTS] OpenSky cache refreshed: {len(flights)} aircraft")
        return data, flights

    except requests.RequestException as e:
        print(f"[FLIGHTS] OpenSky error: {e}")
        # Return stale cache if available
        if _opensky_cache["data"] is not None:
            print("[FLIGHTS] Returning stale cached data")
            return _opensky_cache["data"], _opensky_cache["flights"]
        # If absolutely nothing works, fallback to mock data internally as last resort
        print("[FLIGHTS] Fatal OpenSky error, returning local simulated fallback data")
        return _generate_mock_flights()


@app.route("/airline")
def airline_page():
    return render_template("airline.html")


@app.route("/api/flights")
def get_flights():
    """Flight data proxy — serves from selected provider (OpenSky / FlightRadar24 / Mock)."""
    try:
        data, flights = _get_opensky_data()
        config = _load_config()
        provider = config.get("flight_provider", "opensky")
        return jsonify({
            "time": data.get("time"),
            "flights": flights,
            "provider": provider,
            "count": len(flights),
        })
    except Exception as e:
        return jsonify({"error": str(e), "flights": [], "provider": "error"}), 502


# Analytics removed - handled on client via Intel.js
# @app.route("/api/flights/stats")


# ---------------------------------------------------------------------------
# Logistics Intelligence (Procedural Marine Simulator)
# ---------------------------------------------------------------------------

import math

_vessels_cache = {"data": [], "timestamp": 0}
VESSELS_CACHE_TTL = 3600  # Regenerate every 1 hour

def _generate_vessel_data():
    """Generates a realistic procedural dataset of global marine traffic."""
    import random
    random.seed(int(_time.time() / 3600))
    
    ports = [
        {"name": "Shanghai", "lat": 31.2, "lon": 121.5, "weight": 10},
        {"name": "Singapore", "lat": 1.25, "lon": 103.8, "weight": 9},
        {"name": "Rotterdam", "lat": 51.9, "lon": 4.1, "weight": 8},
        {"name": "Los Angeles", "lat": 33.7, "lon": -118.2, "weight": 7},
        {"name": "Panama Canal", "lat": 9.1, "lon": -79.6, "weight": 6},
        {"name": "Suez Canal", "lat": 29.9, "lon": 32.5, "weight": 6},
        {"name": "Dubai/Jebel Ali", "lat": 25.0, "lon": 55.0, "weight": 6},
        {"name": "Santos", "lat": -24.0, "lon": -46.3, "weight": 5},
        {"name": "Durban", "lat": -29.8, "lon": 31.0, "weight": 4},
        {"name": "Sydney", "lat": -33.8, "lon": 151.2, "weight": 4},
        {"name": "Houston", "lat": 29.7, "lon": -95.2, "weight": 5},
    ]

    vessels = []
    types = ["Cargo", "Tanker", "Passenger", "Fishing", "Military", "Other"]
    type_weights = [0.45, 0.25, 0.05, 0.15, 0.05, 0.05]
    
    flags = ["Panama", "Liberia", "Marshall Islands", "Hong Kong", "Singapore", "China", "Greece", "Malta", "Bahamas", "Cyprus"]
    
    # Generate 1500 vessels
    for i in range(1500):
        # Pick a target port based on weight
        port = random.choices(ports, weights=[p["weight"] for p in ports])[0]
        
        # Scatter them along implied approaches (mostly ocean, some near port)
        distance = random.expovariate(1/15.0)  # degrees away
        angle = random.uniform(0, 2 * math.pi)
        
        lat = port["lat"] + (math.cos(angle) * distance)
        lon = port["lon"] + (math.sin(angle) * distance)
        
        # Ensure lat/lon bounds
        lat = max(min(lat, 85), -85)
        lon = ((lon + 180) % 360) - 180
        
        vtype = random.choices(types, weights=type_weights)[0]
        
        speed = random.uniform(0, 2) if distance < 0.5 else random.uniform(10, 25) # knots
        heading = (math.degrees(math.atan2(-math.sin(angle), -math.cos(angle))) + 360) % 360
        if speed < 1: heading = random.randint(0, 359) # Anchored
        
        length = random.randint(100, 400) if vtype in ["Cargo", "Tanker"] else random.randint(20, 150)
        
        vessels.append({
            "mmsi": f"{random.randint(100000000, 999999999)}",
            "name": f"VESSEL_{random.randint(1000, 9999)}",
            "type": vtype,
            "flag": random.choice(flags),
            "lat": lat,
            "lon": lon,
            "speed": round(speed, 1),
            "heading": int(heading),
            "length": length,
            "status": "Underway" if speed >= 1 else "Moored/Anchored"
        })
        
    return vessels

@app.route("/logistics")
def logistics_page():
    return render_template("logistics.html")


@app.route("/api/vessels")
def get_vessels():
    now = _time.time()
    if not _vessels_cache["data"] or (now - _vessels_cache["timestamp"]) > VESSELS_CACHE_TTL:
        _vessels_cache["data"] = _generate_vessel_data()
        _vessels_cache["timestamp"] = now
    
    return jsonify({
        "time": int(now),
        "vessels": _vessels_cache["data"]
    })


# Analytics removed - handled on client via Intel.js
# @app.route("/api/vessels/stats")


# ---------------------------------------------------------------------------
# Analytics — Trending Keywords
# ---------------------------------------------------------------------------

import re
import html as html_mod
from collections import Counter

STOP_WORDS = {
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "is", "it", "as", "was", "are", "be",
    "has", "had", "have", "will", "been", "not", "no", "do", "does",
    "did", "this", "that", "its", "his", "her", "he", "she", "they",
    "we", "you", "your", "their", "our", "my", "me", "him", "them",
    "us", "if", "so", "up", "out", "all", "about", "than", "into",
    "over", "after", "new", "more", "also", "how", "what", "when",
    "who", "which", "where", "why", "can", "could", "would", "should",
    "may", "just", "very", "most", "being", "get", "got", "set",
    "say", "says", "said", "like", "make", "go", "going", "back",
    "still", "even", "well", "way", "take", "come", "some", "many",
    "much", "own", "other", "now", "then", "here", "there", "only",
    "any", "each", "every", "both", "few", "s", "t", "don", "isn",
    "aren", "won", "didn", "doesn", "re", "ve", "ll", "amp", "quot",
    "one", "two", "first", "last", "next", "per", "off", "against",
    "between", "through", "during", "before", "under", "around", "among",
    "while", "since", "until", "such", "those", "these", "down",
    "too", "another", "because", "think", "see", "look", "people",
    "know", "time", "year", "day", "week", "month", "world", "news",
    # Vietnamese Stopwords
    "và", "của", "là", "trong", "có", "cho", "đã", "những", "được", "với",
    "không", "một", "người", "từ", "tại", "này", "khi", "vào", "đến", "các",
    "như", "năm", "sẽ", "để", "ra", "việc", "về", "nhưng", "lại", "thấy",
    "cũng", "đang", "còn", "chỉ", "nhiều", "hơn", "hoặc", "theo", "nào",
    "ngày", "sau", "mới", "lên", "phải", "làm", "đó", "hệ", "trên", "qua",
    "lúc", "đi", "bị", "bởi", "thì", "hai", "rất", "cùng", "rằng", "nay",
}


def _extract_text(html_str):
    """Strip HTML tags and decode entities."""
    text = re.sub(r"<[^>]+>", " ", html_str or "")
    text = html_mod.unescape(text)
    return text


def _tokenize(text):
    """Split text into lowercase alphanumeric tokens (including Vietnamese)."""
    # Endpoint removed - analysis now handled on client with Intel.js
    # \w matches any word character (including accented chars), [^\W_] ensures no numbers/underscores
    tokens = re.findall(r"[a-zA-Z\u00C0-\u1EF9]{3,}", text.lower())
    return [w for w in tokens if w not in STOP_WORDS]


# Endpoint removed - analysis now handled on client with Intel.js
# @app.route("/api/trending")


# ---------------------------------------------------------------------------
# Analytics — Country Mentions
# ---------------------------------------------------------------------------

COUNTRIES = [
    "Afghanistan", "Albania", "Algeria", "Argentina", "Armenia", "Australia",
    "Austria", "Azerbaijan", "Bahrain", "Bangladesh", "Belarus", "Belgium",
    "Bolivia", "Bosnia", "Brazil", "Bulgaria", "Cambodia", "Cameroon",
    "Canada", "Chad", "Chile", "China", "Colombia", "Congo", "Costa Rica",
    "Croatia", "Cuba", "Cyprus", "Czech", "Denmark", "Dominican", "Ecuador",
    "Egypt", "El Salvador", "Estonia", "Ethiopia", "Finland", "France",
    "Georgia", "Germany", "Ghana", "Greece", "Guatemala", "Haiti",
    "Honduras", "Hungary", "Iceland", "India", "Indonesia", "Iran", "Iraq",
    "Ireland", "Israel", "Italy", "Jamaica", "Japan", "Jordan", "Kazakhstan",
    "Kenya", "Korea", "Kuwait", "Kyrgyzstan", "Laos", "Latvia", "Lebanon",
    "Libya", "Lithuania", "Luxembourg", "Madagascar", "Malaysia", "Mali",
    "Malta", "Mexico", "Moldova", "Mongolia", "Montenegro", "Morocco",
    "Mozambique", "Myanmar", "Nepal", "Netherlands", "New Zealand",
    "Nicaragua", "Niger", "Nigeria", "North Korea", "Norway", "Oman",
    "Pakistan", "Palestine", "Panama", "Paraguay", "Peru", "Philippines",
    "Poland", "Portugal", "Qatar", "Romania", "Russia", "Rwanda",
    "Saudi Arabia", "Senegal", "Serbia", "Singapore", "Slovakia",
    "Slovenia", "Somalia", "South Africa", "South Korea", "Spain",
    "Sri Lanka", "Sudan", "Sweden", "Switzerland", "Syria", "Taiwan",
    "Tajikistan", "Tanzania", "Thailand", "Tunisia", "Turkey", "Turkmenistan",
    "Uganda", "Ukraine", "United Arab Emirates", "United Kingdom",
    "United States", "Uruguay", "Uzbekistan", "Venezuela", "Vietnam",
    "Yemen", "Zambia", "Zimbabwe",
]

# Also match common short forms
COUNTRY_ALIASES = {
    "US": "United States", "USA": "United States", "U.S.": "United States",
    "America": "United States", "American": "United States",
    "UK": "United Kingdom", "Britain": "United Kingdom", "British": "United Kingdom",
    "UAE": "United Arab Emirates", "Emirates": "United Arab Emirates",
    "Russian": "Russia", "Chinese": "China", "Japanese": "Japan",
    "Korean": "South Korea", "Israeli": "Israel", "Palestinian": "Palestine",
    "Iranian": "Iran", "Iraqi": "Iraq", "Syrian": "Syria",
    "Turkish": "Turkey", "French": "France", "German": "Germany",
    "Italian": "Italy", "Spanish": "Spain", "Brazilian": "Brazil",
    "Mexican": "Mexico", "Canadian": "Canada", "Australian": "Australia",
    "Indian": "India", "Pakistani": "Pakistan", "Afghan": "Afghanistan",
    "Egyptian": "Egypt", "Saudi": "Saudi Arabia", "Ukrainian": "Ukraine",
    "Vietnamese": "Vietnam", "Thai": "Thailand", "Filipino": "Philippines",
    "Indonesian": "Indonesia", "Malaysian": "Malaysia",
    "Nigerian": "Nigeria", "Kenyan": "Kenya", "Ethiopian": "Ethiopia",
    "South Korean": "South Korea", "North Korean": "North Korea",
}


# Endpoint removed - analysis now handled on client with Intel.js
# @app.route("/api/countries")


# ---------------------------------------------------------------------------
# Market Data API — Technical Indicators
# ---------------------------------------------------------------------------

def _compute_sma(series, window):
    """Simple Moving Average."""
    return series.rolling(window=window, min_periods=1).mean()

def _compute_ema(series, span):
    """Exponential Moving Average."""
    return series.ewm(span=span, adjust=False).mean()

def _compute_rsi(series, period=14):
    """Relative Strength Index."""
    delta = series.diff()
    gain = delta.where(delta > 0, 0.0)
    loss = (-delta).where(delta < 0, 0.0)
    avg_gain = gain.rolling(window=period, min_periods=1).mean()
    avg_loss = loss.rolling(window=period, min_periods=1).mean()
    rs = avg_gain / avg_loss.replace(0, float('nan'))
    rsi = 100 - (100 / (1 + rs))
    return rsi.fillna(50)

def _compute_macd(series, fast=12, slow=26, signal=9):
    """MACD Line, Signal Line, and Histogram."""
    ema_fast = _compute_ema(series, fast)
    ema_slow = _compute_ema(series, slow)
    macd_line = ema_fast - ema_slow
    signal_line = _compute_ema(macd_line, signal)
    histogram = macd_line - signal_line
    return macd_line, signal_line, histogram

def _compute_bollinger(series, window=20, num_std=2):
    """Bollinger Bands: upper, middle (SMA), lower."""
    middle = _compute_sma(series, window)
    std = series.rolling(window=window, min_periods=1).std()
    upper = middle + (std * num_std)
    lower = middle - (std * num_std)
    return upper, middle, lower

def _compute_atr(high, low, close, period=14):
    """Average True Range."""
    import numpy as np
    prev_close = close.shift(1)
    tr = np.maximum(high - low, np.maximum(abs(high - prev_close), abs(low - prev_close)))
    return tr.rolling(window=period, min_periods=1).mean()

def _get_vnindex_hist(period="3mo"):
    """Fetch VNINDEX historical data with fallback tickers."""
    tickers_to_try = ["^VNINDEX", "^VNINDEX.VN"]
    for ticker_symbol in tickers_to_try:
        try:
            ticker = yf.Ticker(ticker_symbol)
            hist = ticker.history(period=period)
            if not hist.empty:
                return hist
        except Exception:
            continue
    return None


@app.route("/api/finance/vnindex/history")
def get_vnindex_history():
    """Return VNINDEX close prices for sparkline chart."""
    try:
        period = request.args.get("period", "1mo")
        hist = _get_vnindex_hist(period)
        if hist is None or hist.empty:
            return jsonify({"error": "No data"}), 404

        data_points = []
        for idx, row in hist.iterrows():
            data_points.append({
                "date": str(idx.date()),
                "close": round(float(row['Close']), 2),
                "volume": int(row.get('Volume', 0)),
            })

        return jsonify({"symbol": "VNINDEX", "period": period, "data": data_points})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/finance/history/bulk")
def get_bulk_history():
    """Return history for multiple symbols at once."""
    symbols = request.args.get("symbols", "").split(",")
    period = request.args.get("period", "14d")
    results = {}

    def fetch_hist(sym):
        try:
            # Handle VNINDEX specially
            if sym == "^VNINDEX":
                hist = _get_vnindex_hist(period)
            else:
                t = yf.Ticker(sym)
                hist = t.history(period=period)
            
            if hist is None or hist.empty:
                return sym, None
            
            data = []
            for idx, row in hist.iterrows():
                data.append({
                    "date": str(idx.date()),
                    "close": round(float(row['Close']), 2),
                    "open": round(float(row.get('Open', row['Close'])), 2),
                    "high": round(float(row.get('High', row['Close'])), 2),
                    "low": round(float(row.get('Low', row['Close'])), 2),
                })
            return sym, data
        except Exception:
            return sym, None

    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = [executor.submit(fetch_hist, s) for s in symbols if s]
        for f in as_completed(futures):
            sym, data = f.result()
            if data:
                results[sym] = data
    
    return jsonify(results)


# ---------------------------------------------------------------------------
# Global Finance Statistics API
# ---------------------------------------------------------------------------

from concurrent.futures import ThreadPoolExecutor, as_completed

# Ticker definitions grouped by category
FINANCE_TICKERS = {
    "indices": [
        {"symbol": "^GSPC",    "name": "S&P 500",      "flag": "🇺🇸"},
        {"symbol": "^DJI",     "name": "DOW JONES",    "flag": "🇺🇸"},
        {"symbol": "^IXIC",    "name": "NASDAQ",       "flag": "🇺🇸"},
        {"symbol": "^N225",    "name": "NIKKEI 225",   "flag": "🇯🇵"},
        {"symbol": "^FTSE",    "name": "FTSE 100",     "flag": "🇬🇧"},
        {"symbol": "^GDAXI",   "name": "DAX",          "flag": "🇩🇪"},
        {"symbol": "000001.SS","name": "SSE COMPOSITE", "flag": "🇨🇳"},
        {"symbol": "^HSI",     "name": "HANG SENG",    "flag": "🇭🇰"},
        {"symbol": "^KS11",    "name": "KOSPI",        "flag": "🇰🇷"},
    ],
    "forex": [
        {"symbol": "USDVND=X", "name": "USD/VND", "flag": "🇻🇳"},
        {"symbol": "EURUSD=X", "name": "EUR/USD", "flag": "🇪🇺"},
        {"symbol": "GBPUSD=X", "name": "GBP/USD", "flag": "🇬🇧"},
        {"symbol": "USDJPY=X", "name": "USD/JPY", "flag": "🇯🇵"},
        {"symbol": "USDCNY=X", "name": "USD/CNY", "flag": "🇨🇳"},
        {"symbol": "USDSGD=X", "name": "USD/SGD", "flag": "🇸🇬"},
        {"symbol": "USDKRW=X", "name": "USD/KRW", "flag": "🇰🇷"},
    ],
    "commodities": [
        {"symbol": "GC=F",  "name": "GOLD",         "flag": "🥇"},
        {"symbol": "SI=F",  "name": "SILVER",       "flag": "🥈"},
        {"symbol": "CL=F",  "name": "CRUDE OIL",    "flag": "🛢️"},
        {"symbol": "NG=F",  "name": "NATURAL GAS",  "flag": "🔥"},
        {"symbol": "HG=F",  "name": "COPPER",       "flag": "🟤"},
    ],
    "crypto": [
        {"symbol": "BTC-USD",  "name": "BITCOIN",   "flag": "₿"},
        {"symbol": "ETH-USD",  "name": "ETHEREUM",  "flag": "Ξ"},
        {"symbol": "BNB-USD",  "name": "BNB",       "flag": "◆"},
        {"symbol": "SOL-USD",  "name": "SOLANA",    "flag": "◎"},
    ],
}


def _fetch_single_ticker(ticker_info):
    """Fetch price data for a single ticker. Used in thread pool."""
    symbol = ticker_info["symbol"]
    try:
        t = yf.Ticker(symbol)
        hist = t.history(period="5d")
        if hist.empty:
            return None

        current = float(hist['Close'].iloc[-1])
        prev = float(hist['Close'].iloc[-2]) if len(hist) > 1 else current
        change = current - prev
        pct = (change / prev * 100) if prev else 0

        return {
            "symbol": symbol,
            "name": ticker_info["name"],
            "flag": ticker_info.get("flag", ""),
            "price": round(current, 4 if "=X" in symbol else 2),
            "change": round(change, 4 if "=X" in symbol else 2),
            "percent_change": round(pct, 2),
        }
    except Exception as e:
        print(f"[Finance] Error fetching {symbol}: {e}")
        return None


@app.route("/api/finance/global")
def get_global_finance():
    """Fetch all finance categories concurrently."""
    category = request.args.get("category", None)  # optional filter

    if category and category in FINANCE_TICKERS:
        tickers_to_fetch = FINANCE_TICKERS[category]
        results = {category: []}
    else:
        tickers_to_fetch = []
        for cat_tickers in FINANCE_TICKERS.values():
            tickers_to_fetch.extend(cat_tickers)
        results = {k: [] for k in FINANCE_TICKERS}

    # Fetch concurrently
    with ThreadPoolExecutor(max_workers=8) as executor:
        future_to_ticker = {
            executor.submit(_fetch_single_ticker, t): t
            for t in tickers_to_fetch
        }
        for future in as_completed(future_to_ticker):
            ticker_info = future_to_ticker[future]
            data = future.result()
            if data:
                # Determine which category this ticker belongs to
                for cat_name, cat_list in FINANCE_TICKERS.items():
                    if any(t["symbol"] == ticker_info["symbol"] for t in cat_list):
                        if cat_name in results:
                            results[cat_name].append(data)
                        break

    # Sort each category to maintain defined order
    for cat_name in results:
        symbol_order = [t["symbol"] for t in FINANCE_TICKERS.get(cat_name, [])]
        results[cat_name].sort(key=lambda x: symbol_order.index(x["symbol"]) if x["symbol"] in symbol_order else 999)

    return jsonify(results)


# ---------------------------------------------------------------------------
# Macroeconomic Statistics API
# ---------------------------------------------------------------------------

@app.route("/api/finance/macro")
def get_macro_data():
    """Return macroeconomic indicators.
    Macro data changes slowly (monthly/quarterly), so we serve curated data.
    In production this would be backed by a data provider like FRED or World Bank.
    """
    # Vietnam macro indicators
    vietnam_macro = [
        {"icon": "📊", "label": "GDP GROWTH", "sublabel": "VIETNAM Q4 2025", "value": "6.72", "unit": "%", "trend": "up"},
        {"icon": "🏦", "label": "INTEREST RATE", "sublabel": "SBV REFINANCING", "value": "4.50", "unit": "%", "trend": "neutral"},
        {"icon": "📈", "label": "INFLATION (CPI)", "sublabel": "YOY MAR 2026", "value": "3.18", "unit": "%", "trend": "up"},
        {"icon": "💵", "label": "USD/VND RATE", "sublabel": "INTERBANK", "value": "25,890", "unit": "VND", "trend": "neutral"},
        {"icon": "🏗️", "label": "FDI INFLOW", "sublabel": "YTD 2026", "value": "4.8", "unit": "B USD", "trend": "up"},
        {"icon": "⚖️", "label": "TRADE BALANCE", "sublabel": "MAR 2026", "value": "+2.1", "unit": "B USD", "trend": "up"},
        {"icon": "🏭", "label": "PMI MANUFACTURING", "sublabel": "MAR 2026", "value": "51.2", "unit": "INDEX", "trend": "up"},
        {"icon": "📦", "label": "EXPORTS", "sublabel": "MAR 2026", "value": "35.4", "unit": "B USD", "trend": "up"},
    ]

    # Global macro indicators
    global_macro = [
        {"icon": "🇺🇸", "label": "FED FUNDS RATE", "sublabel": "US FEDERAL RESERVE", "value": "4.50", "unit": "%", "trend": "neutral"},
        {"icon": "🇺🇸", "label": "US CPI", "sublabel": "YOY FEB 2026", "value": "2.8", "unit": "%", "trend": "down"},
        {"icon": "🇺🇸", "label": "US GDP GROWTH", "sublabel": "Q4 2025 ANNUALIZED", "value": "2.4", "unit": "%", "trend": "neutral"},
        {"icon": "🇪🇺", "label": "ECB RATE", "sublabel": "EUROPEAN CENTRAL BANK", "value": "2.65", "unit": "%", "trend": "down"},
        {"icon": "🇨🇳", "label": "CHINA GDP", "sublabel": "YOY Q4 2025", "value": "5.0", "unit": "%", "trend": "neutral"},
        {"icon": "🇯🇵", "label": "BOJ RATE", "sublabel": "BANK OF JAPAN", "value": "0.50", "unit": "%", "trend": "up"},
        {"icon": "🌍", "label": "BRENT CRUDE", "sublabel": "ICE FUTURES", "value": "73.50", "unit": "USD/BBL", "trend": "down"},
        {"icon": "🥇", "label": "GOLD SPOT", "sublabel": "XAU/USD", "value": "3,124", "unit": "USD/OZ", "trend": "up"},
    ]

    # Additional key metrics
    key_rates = [
        {"icon": "📉", "label": "US 10Y YIELD", "sublabel": "TREASURY", "value": "4.25", "unit": "%", "trend": "neutral"},
        {"icon": "📉", "label": "VN 10Y YIELD", "sublabel": "GOVERNMENT BOND", "value": "2.85", "unit": "%", "trend": "down"},
        {"icon": "💰", "label": "DXY INDEX", "sublabel": "US DOLLAR INDEX", "value": "103.8", "unit": "INDEX", "trend": "down"},
        {"icon": "📊", "label": "VIX", "sublabel": "VOLATILITY INDEX", "value": "18.5", "unit": "INDEX", "trend": "neutral"},
    ]

    return jsonify({
        "vietnam": vietnam_macro,
        "global": global_macro,
        "rates": key_rates,
    })

# ---------------------------------------------------------------------------
# Finance Intelligence API
# ---------------------------------------------------------------------------

# Finance intelligence now handled on client via Intel.js
# ...

@app.route("/api/finance/factors")
def get_finance_factors():
    """Returns 9 core macroeconomic factors as pure data."""
    try:
        targets = [
            {"id": "vnindex", "symbol": "^VNINDEX", "name": "VN-INDEX", "unit": "PTS"},
            {"id": "vn30", "symbol": "VN30.VS", "name": "VN30 INDEX", "unit": "PTS"}, # VN30 proxy
            {"id": "usd", "symbol": "USDVND=X", "name": "USD/VND", "unit": "VND"},
            {"id": "dxy", "symbol": "DX-Y.NYB", "name": "DOLLAR INDEX", "unit": "PTS"},
            {"id": "us10y", "symbol": "^TNX", "name": "US 10Y YIELD", "unit": "%"},
            {"id": "spx", "symbol": "^GSPC", "name": "S&P 500", "unit": "PTS"},
            {"id": "gold", "symbol": "GC=F", "name": "GOLD SPOT", "unit": "USD"},
            {"id": "crude", "symbol": "CL=F", "name": "WTI CRUDE", "unit": "USD"}
        ]
        
        results = []
        for t in targets:
            try:
                # Use yfinance for general tracking
                yf_t = yf.Ticker(t["symbol"])
                hist = yf_t.history(period="5d")
                
                # Fallback to vnindex logic for exact match
                if hist.empty and t["symbol"] == "^VNINDEX":
                    hist = _get_vnindex_hist("5d")
                    
                if hist is None or hist.empty:
                    # Provide a reliable fallback for VN30 if not found
                    if t["id"] == "vn30":
                        hist = _get_vnindex_hist("5d")
                    else:
                        continue
                        
                close = hist['Close']
                current = float(close.iloc[-1])
                prev = float(close.iloc[-2]) if len(close) > 1 else current
                change = current - prev
                pct = (change / prev * 100) if prev else 0
                
                results.append({
                    "id": t["id"],
                    "name": t["name"],
                    "price": round(current, 2 if current < 1000 else 0),
                    "change": round(change, 2 if change < 100 else 0),
                    "percent_change": round(pct, 2),
                    "unit": t["unit"]
                })
            except Exception:
                pass
                
        # Inject VN10Y Bond manually since YF doesn't have an exact match cleanly
        results.append({
            "id": "vn10y",
            "name": "VN 10Y BOND",
            "price": 2.85,
            "change": -0.02,
            "percent_change": -0.70,
            "unit": "%"
        })
        
        return jsonify({"status": "success", "factors": results})

    except Exception as e:
        print("[Factors] Error: ", e)
        return jsonify({"error": str(e)}), 500


# ---------------------------------------------------------------------------
# Space Intelligence (Launches & Orbit Stats)
# ---------------------------------------------------------------------------

LAUNCH_LIBRARY_URL = "https://lldev.thespacedevs.com/2.2.0/launch/upcoming/"
CELESTRAK_ACTIVE_URL = "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=json"

_space_cache = {
    "launches": None,
    "launches_timestamp": 0,
    "orbits": None,
    "orbits_timestamp": 0,
}
SPACE_CACHE_TTL = 3600 # 1 hour

@app.route("/space")
def space_page():
    return render_template("space.html")

@app.route("/api/space/launches")
def get_space_launches():
    now = _time.time()
    if not _space_cache["launches"] or (now - _space_cache["launches_timestamp"]) > SPACE_CACHE_TTL:
        try:
            resp = requests.get(LAUNCH_LIBRARY_URL, timeout=15)
            if resp.status_code == 200:
                data = resp.json()
                _space_cache["launches"] = data.get("results", [])
                _space_cache["launches_timestamp"] = now
            else:
                return jsonify({"results": _space_cache["launches"] or []})
        except Exception as e:
            print(f"[SPACE] Error fetching launches: {e}")
            return jsonify({"results": _space_cache["launches"] or []})
    
    return jsonify({"results": _space_cache["launches"]})

@app.route("/api/space/orbits")
def get_orbit_stats():
    now = _time.time()
    if not _space_cache["orbits"] or (now - _space_cache["orbits_timestamp"]) > SPACE_CACHE_TTL:
        try:
            resp = requests.get(CELESTRAK_ACTIVE_URL, timeout=20)
            if resp.status_code == 200:
                data = resp.json()
                stats = {
                    "total": len(data),
                    "operators": Counter(),
                    "recent": []
                }
                for sat in data:
                    name = sat.get("OBJECT_NAME", "UNKNOWN")
                    if "STARLINK" in name: stats["operators"]["SpaceX (Starlink)"] += 1
                    elif "ONEWEB" in name: stats["operators"]["OneWeb"] += 1
                    elif "GPS" in name: stats["operators"]["US (GPS)"] += 1
                    elif "GLONASS" in name: stats["operators"]["Russia (GLONASS)"] += 1
                    elif "BEIDOU" in name: stats["operators"]["China (Beidou)"] += 1
                    elif "GALILEO" in name: stats["operators"]["EU (Galileo)"] += 1
                    elif "IRIDIUM" in name: stats["operators"]["Iridium"] += 1
                    else: stats["operators"]["Other"] += 1
                stats["operators"] = [{"name": k, "count": v} for k, v in stats["operators"].most_common(10)]
                _space_cache["orbits"] = stats
                _space_cache["orbits_timestamp"] = now
            else:
                return jsonify(_space_cache["orbits"] or {"error": "Source unavailable"})
        except Exception as e:
            print(f"[SPACE] Error fetching orbit stats: {e}")
            return jsonify(_space_cache["orbits"] or {"error": str(e)})
            
    return jsonify(_space_cache["orbits"])


@app.route("/api/space/network")
def get_space_network():
    import random
    import requests
    import xml.etree.ElementTree as ET

    dsn_data = []
    
    try:
        # Fetch true live data from NASA DSN
        req = requests.get("https://eyes.nasa.gov/dsn/data/dsn.xml", timeout=5)
        if req.status_code == 200:
            root = ET.fromstring(req.content)
            stations = root.findall('dish')
            
            # Extract top 3 active connections
            for dish in stations:
                if len(dsn_data) >= 3: break
                
                name = dish.get('name', 'Unknown')
                targets = dish.findall('target')
                
                if targets:
                    target_name = targets[0].get('name', '').upper()
                    signals = dish.findall('downSignal') + dish.findall('upSignal')
                    
                    if signals and target_name:
                        band = signals[0].get('dataRate', '10.0') # using dataRate as placeholder if band unavailable
                        power = signals[0].get('power', f'-{random.randint(110, 160)}')
                        
                        fac_name = "Goldstone (USA)" if name.startswith(('1', '2', '3')) else "Canberra (AUS)" if name.startswith(('4', '5')) else "Madrid (ESP)"
                        
                        dsn_data.append({
                            "facility": f"{fac_name} [DSS-{name}]",
                            "activity": "TRACKING LIVE",
                            "signal_strength": f"{power} dBm",
                            "band": "S/X/Ka Band",
                            "target": target_name
                        })
    except Exception as e:
        print("[DSN] Error fetching true DSN data:", e)

    # Fallback to simulated if offline or empty
    if not dsn_data:
        dsn_complexes = ["Goldstone (USA)", "Madrid (ESP)", "Canberra (AUS)"]
        bands = ["X-Band", "Ka-Band", "S-Band"]
        statuses = ["RECEIVING", "TRANSMITTING", "TRACKING"]
        
        for c in dsn_complexes:
            activity = random.choice(statuses)
            dsn_data.append({
                "facility": c,
                "activity": activity,
                "signal_strength": f"-{random.randint(110, 160)} dBm",
                "band": random.choice(bands),
                "target": random.choice(["VOYAGER 1", "VOYAGER 2", "JWST", "MRO", "PERSEVERANCE", "JUNO"])
            })
        
    nsn_data = [
        {"facility": "Near Space Network", "status": "NOMINAL", "active_links": random.randint(10, 30)},
        {"facility": "TDRS Constellation", "status": "NOMINAL", "active_links": random.randint(5, 12)}
    ]
    
    return jsonify({
        "dsn": dsn_data,
        "nsn": nsn_data
    })


# ---------------------------------------------------------------------------
# ISS Real-Time Tracking
# ---------------------------------------------------------------------------

_iss_cache = {"data": None, "timestamp": 0}
ISS_CACHE_TTL = 15  # 15 seconds

@app.route("/api/space/iss")
def get_iss_position():
    """Real-time ISS position via open-notify / wttr-style API."""
    now = _time.time()
    if _iss_cache["data"] and (now - _iss_cache["timestamp"]) < ISS_CACHE_TTL:
        return jsonify(_iss_cache["data"])

    try:
        resp = requests.get("http://api.open-notify.org/iss-now.json", timeout=5)
        if resp.status_code == 200:
            data = resp.json()
            pos = data.get("iss_position", {})
            result = {
                "latitude": float(pos.get("latitude", 0)),
                "longitude": float(pos.get("longitude", 0)),
                "altitude": 420,  # Average ISS altitude in km
                "velocity": 7.66,  # km/s
                "crew_count": 7,  # Updated manually, typical crew size
                "timestamp": data.get("timestamp", int(now)),
            }
            _iss_cache["data"] = result
            _iss_cache["timestamp"] = now
            return jsonify(result)
    except Exception as e:
        print(f"[ISS] Error fetching position: {e}")

    # Fallback: procedural ISS position (it orbits ~every 92 mins)
    import random
    orbit_period = 92 * 60  # seconds
    phase = (now % orbit_period) / orbit_period * 2 * math.pi
    lat = 51.6 * math.sin(phase)  # ISS inclination ~51.6°
    lon = (((now / orbit_period) * 360) % 360) - 180

    result = {
        "latitude": round(lat, 4),
        "longitude": round(lon, 4),
        "altitude": 420 + random.randint(-5, 5),
        "velocity": 7.66,
        "crew_count": 7,
        "timestamp": int(now),
    }
    _iss_cache["data"] = result
    _iss_cache["timestamp"] = now
    return jsonify(result)


# ---------------------------------------------------------------------------
# Space Weather (NOAA SWPC / Procedural Fallback)
# ---------------------------------------------------------------------------

_weather_cache = {"data": None, "timestamp": 0}
WEATHER_CACHE_TTL = 600  # 10 minutes

@app.route("/api/space/weather")
def get_space_weather():
    """Space weather data from NOAA SWPC with procedural fallback."""
    now = _time.time()
    if _weather_cache["data"] and (now - _weather_cache["timestamp"]) < WEATHER_CACHE_TTL:
        return jsonify(_weather_cache["data"])

    result = {}

    # Try NOAA SWPC planetary K-index
    try:
        kp_resp = requests.get(
            "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json",
            timeout=8
        )
        if kp_resp.status_code == 200:
            kp_data = kp_resp.json()
            if len(kp_data) > 1:
                latest = kp_data[-1]
                result["kp_index"] = float(latest[1]) if latest[1] else 0
    except Exception as e:
        print(f"[WEATHER] KP index error: {e}")

    # Try NOAA SWPC solar wind plasma
    try:
        plasma_resp = requests.get(
            "https://services.swpc.noaa.gov/products/solar-wind/plasma-7-day.json",
            timeout=8
        )
        if plasma_resp.status_code == 200:
            plasma_data = plasma_resp.json()
            if len(plasma_data) > 1:
                latest = plasma_data[-1]
                if latest[1]:
                    result["proton_density"] = round(float(latest[1]), 1)
                if latest[2]:
                    result["solar_wind_speed"] = round(float(latest[2]))
    except Exception as e:
        print(f"[WEATHER] Plasma error: {e}")

    # Try NOAA SWPC magnetic field (Bz)
    try:
        mag_resp = requests.get(
            "https://services.swpc.noaa.gov/products/solar-wind/mag-7-day.json",
            timeout=8
        )
        if mag_resp.status_code == 200:
            mag_data = mag_resp.json()
            if len(mag_data) > 1:
                latest = mag_data[-1]
                if latest[3]:
                    result["bz_component"] = round(float(latest[3]), 1)
    except Exception as e:
        print(f"[WEATHER] Mag field error: {e}")

    # Fill in any missing values with procedural data
    import random
    random.seed(int(now / 600))  # Change every 10 minutes
    result.setdefault("kp_index", round(random.uniform(1.0, 4.0), 1))
    result.setdefault("solar_wind_speed", random.randint(300, 550))
    result.setdefault("proton_density", round(random.uniform(2.0, 15.0), 1))
    result.setdefault("bz_component", round(random.uniform(-8.0, 5.0), 1))
    result.setdefault("solar_radiation_level", 0)
    result.setdefault("radio_blackout_level", 0)
    result.setdefault("sunspot_number", random.randint(140, 220))
    result.setdefault("solar_flux", f"{random.randint(140, 200)} SFU")
    result.setdefault("xray_flux", random.choice(["A-CLASS", "B-CLASS", "C-CLASS"]))

    _weather_cache["data"] = result
    _weather_cache["timestamp"] = now

    return jsonify(result)


# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
