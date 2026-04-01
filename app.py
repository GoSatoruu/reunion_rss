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
from flask import Flask, jsonify, render_template, request

app = Flask(__name__)

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
SOURCES_FILE = os.path.join(DATA_DIR, "sources.json")
CONFIG_FILE = os.path.join(DATA_DIR, "config.json")

# Default configuration settings
DEFAULT_CONFIG = {
    "enable_flights": True,
    "enable_ships": True
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
    if "flight_provider" in data:
        config["flight_provider"] = str(data["flight_provider"])
        
    _save_config(config)
    return jsonify(config)


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
    """Fetch OpenSky data with caching. Returns parsed flights list."""
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


    # Return cache if fresh
    if not force_refresh and _opensky_cache["data"] is not None and _opensky_cache.get("provider") != "mock":
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
    """Proxy to OpenSky Network with caching."""
    try:
        data, flights = _get_opensky_data()
        return jsonify({"time": data.get("time"), "flights": flights})
    except Exception as e:
        return jsonify({"error": str(e), "flights": []}), 502


@app.route("/api/flights/stats")
def get_flight_stats():
    """Compute analytics from cached OpenSky data."""
    try:
        data, flights = _get_opensky_data()

        total = len(flights)
        airborne = [f for f in flights if not f["on_ground"]]
        on_ground_count = total - len(airborne)

        # Country distribution (top 20)
        country_counter = Counter(f["country"] for f in flights)
        top_countries = [
            {"country": c, "count": n}
            for c, n in country_counter.most_common(20)
        ]

        # Altitude distribution (airborne only)
        alt_brackets = {"0-1km": 0, "1-3km": 0, "3-6km": 0, "6-10km": 0, "10km+": 0}
        for f in airborne:
            a = f["alt"]
            if a < 1000: alt_brackets["0-1km"] += 1
            elif a < 3000: alt_brackets["1-3km"] += 1
            elif a < 6000: alt_brackets["3-6km"] += 1
            elif a < 10000: alt_brackets["6-10km"] += 1
            else: alt_brackets["10km+"] += 1

        # Speed stats (m/s -> km/h)
        speeds = [f["velocity"] * 3.6 for f in airborne if f["velocity"] > 0]
        avg_speed = round(sum(speeds) / len(speeds), 1) if speeds else 0
        max_speed = round(max(speeds), 1) if speeds else 0

        # Average altitude
        alts = [f["alt"] for f in airborne if f["alt"] > 0]
        avg_alt = round(sum(alts) / len(alts), 0) if alts else 0

        # Top callsigns (active, non-empty)
        callsign_list = [f["callsign"] for f in airborne if f["callsign"]]
        top_callsigns = Counter(callsign_list).most_common(25)
        top_callsigns_data = [{"callsign": cs, "count": n} for cs, n in top_callsigns]

        # Region distribution
        regions = {"North America": 0, "Europe": 0, "Asia": 0, "Middle East": 0,
                   "Africa": 0, "South America": 0, "Oceania": 0, "Other": 0}
        for f in flights:
            lat, lon = f["lat"], f["lon"]
            if 25 <= lat <= 72 and -130 <= lon <= -60: regions["North America"] += 1
            elif 35 <= lat <= 72 and -10 <= lon <= 40: regions["Europe"] += 1
            elif 10 <= lat <= 55 and 60 <= lon <= 150: regions["Asia"] += 1
            elif 12 <= lat <= 42 and 25 <= lon <= 65: regions["Middle East"] += 1
            elif -35 <= lat <= 37 and -20 <= lon <= 52: regions["Africa"] += 1
            elif -56 <= lat <= 15 and -82 <= lon <= -34: regions["South America"] += 1
            elif -50 <= lat <= 0 and 110 <= lon <= 180: regions["Oceania"] += 1
            else: regions["Other"] += 1

        return jsonify({
            "timestamp": data.get("time"),
            "total_tracked": total,
            "airborne": len(airborne),
            "on_ground": on_ground_count,
            "avg_speed_kmh": avg_speed,
            "max_speed_kmh": max_speed,
            "avg_altitude_m": avg_alt,
            "countries": top_countries,
            "altitude_distribution": alt_brackets,
            "regions": regions,
            "top_callsigns": top_callsigns_data,
        })

    except Exception as e:
        print(f"[FLIGHTS STATS] Error: {e}")
        return jsonify({"error": str(e)}), 502


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


@app.route("/api/vessels/stats")
def get_vessel_stats():
    now = _time.time()
    if not _vessels_cache["data"] or (now - _vessels_cache["timestamp"]) > VESSELS_CACHE_TTL:
        _vessels_cache["data"] = _generate_vessel_data()
        _vessels_cache["timestamp"] = now
        
    vessels = _vessels_cache["data"]
    total = len(vessels)
    
    # Types distribution
    type_counts = Counter(v["type"] for v in vessels)
    type_data = [{"type": k, "count": v} for k, v in type_counts.most_common()]
    
    # Flags distribution
    flag_counts = Counter(v["flag"] for v in vessels)
    flag_data = [{"flag": k, "count": v} for k, v in flag_counts.most_common(15)]
    
    # Speeds
    active = [v for v in vessels if v["speed"] > 1]
    avg_speed = round(sum(v["speed"] for v in active) / len(active), 1) if active else 0
    underway = len(active)
    moored = total - underway
    
    # Estimated TEU (very rough simulation: Cargo ships avg 8000 TEU)
    cargo_count = type_counts.get("Cargo", 0)
    est_teu = cargo_count * 8000
    
    # Choke points (rough bounding boxes)
    choke_points = {
        "Suez Canal": 0,
        "Panama Canal": 0,
        "Strait of Malacca": 0,
        "English Channel": 0
    }
    
    for v in vessels:
        lat, lon = v["lat"], v["lon"]
        if 27 <= lat <= 32 and 31 <= lon <= 34: choke_points["Suez Canal"] += 1
        elif 8 <= lat <= 11 and -81 <= lon <= -78: choke_points["Panama Canal"] += 1
        elif 1 <= lat <= 6 and 95 <= lon <= 104: choke_points["Strait of Malacca"] += 1
        elif 49 <= lat <= 51 and -5 <= lon <= 2: choke_points["English Channel"] += 1

    choke_data = [{"name": k, "count": v} for k, v in choke_points.items()]

    return jsonify({
        "timestamp": int(now),
        "total_tracked": total,
        "underway": underway,
        "moored": moored,
        "avg_speed_knots": avg_speed,
        "est_teu_volume": est_teu,
        "types": type_data,
        "flags": flag_data,
        "choke_points": choke_data
    })


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
    # \w matches any word character (including accented chars), [^\W_] ensures no numbers/underscores
    tokens = re.findall(r"[a-zA-Z\u00C0-\u1EF9]{3,}", text.lower())
    return [w for w in tokens if w not in STOP_WORDS]


@app.route("/api/trending")
def get_trending():
    """Extract top trending keywords from current feed articles."""
    sources = _load_sources()
    word_freq = Counter()
    bigram_freq = Counter()
    total_articles = 0

    for src in sources:
        try:
            feed = feedparser.parse(src["url"])
            for entry in feed.entries[:15]:
                title = getattr(entry, "title", "")
                summary = _extract_text(getattr(entry, "summary", ""))
                # Weight titles more heavily
                title_tokens = _tokenize(title)
                summary_tokens = _tokenize(summary)
                tokens = title_tokens * 3 + summary_tokens

                word_freq.update(tokens)

                # Bigrams from title only (more meaningful)
                for i in range(len(title_tokens) - 1):
                    bigram = f"{title_tokens[i]} {title_tokens[i+1]}"
                    bigram_freq[bigram] += 1

                total_articles += 1
        except Exception:
            pass

    # Top 20 single keywords
    top_keywords = [
        {"word": w, "count": c}
        for w, c in word_freq.most_common(20)
    ]

    # Top 10 bigrams with count >= 2
    top_bigrams = [
        {"phrase": p, "count": c}
        for p, c in bigram_freq.most_common(10)
        if c >= 2
    ]

    return jsonify({
        "total_articles": total_articles,
        "keywords": top_keywords,
        "phrases": top_bigrams,
    })


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


@app.route("/api/countries")
def get_country_mentions():
    """Scan articles for country name mentions and rank them."""
    sources = _load_sources()
    country_counts = Counter()
    country_articles = {}  # country -> list of article titles
    total_articles = 0

    for src in sources:
        try:
            feed = feedparser.parse(src["url"])
            for entry in feed.entries[:15]:
                title = getattr(entry, "title", "")
                summary = _extract_text(getattr(entry, "summary", ""))
                text = f"{title} {summary}"
                total_articles += 1

                mentioned = set()

                # Check full country names
                for country in COUNTRIES:
                    if country.lower() in text.lower():
                        mentioned.add(country)

                # Check aliases
                for alias, canonical in COUNTRY_ALIASES.items():
                    # Word boundary check for short aliases
                    pattern = r'\b' + re.escape(alias) + r'\b'
                    if re.search(pattern, text, re.IGNORECASE):
                        mentioned.add(canonical)

                for country in mentioned:
                    country_counts[country] += 1
                    if country not in country_articles:
                        country_articles[country] = []
                    if len(country_articles[country]) < 3:
                        country_articles[country].append(title)
        except Exception:
            pass

    ranked = []
    for country, count in country_counts.most_common(25):
        ranked.append({
            "country": country,
            "mentions": count,
            "pct": round(count / max(total_articles, 1) * 100, 1),
            "headlines": country_articles.get(country, []),
        })

    return jsonify({
        "total_articles": total_articles,
        "countries": ranked,
    })


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


@app.route("/api/finance/vnindex")
def get_vnindex():
    try:
        hist = _get_vnindex_hist("3mo")
        if hist is None or hist.empty:
            return jsonify({"error": "No market data found"}), 404

        close = hist['Close']
        current_price = close.iloc[-1]
        previous_close = close.iloc[-2] if len(close) > 1 else current_price
        change = current_price - previous_close
        percent_change = (change / previous_close) * 100 if previous_close else 0

        # --- Compute Indicators ---
        sma_20 = _compute_sma(close, 20).iloc[-1]
        sma_50 = _compute_sma(close, 50).iloc[-1]
        ema_12 = _compute_ema(close, 12).iloc[-1]
        ema_26 = _compute_ema(close, 26).iloc[-1]
        rsi_14 = _compute_rsi(close, 14).iloc[-1]
        macd_line, signal_line, macd_hist = _compute_macd(close)
        bb_upper, bb_middle, bb_lower = _compute_bollinger(close)
        atr = _compute_atr(hist['High'], hist['Low'], close, 14).iloc[-1]

        # Volume info
        vol_current = int(hist['Volume'].iloc[-1]) if 'Volume' in hist else 0
        vol_avg_20 = int(hist['Volume'].rolling(20).mean().iloc[-1]) if 'Volume' in hist and len(hist) >= 20 else vol_current

        # Day range
        day_high = float(hist['High'].iloc[-1])
        day_low = float(hist['Low'].iloc[-1])
        day_open = float(hist['Open'].iloc[-1])

        # 52-week (use available data)
        high_52w = float(hist['High'].max())
        low_52w = float(hist['Low'].min())

        # Determine trend signal
        signals = []
        if current_price > sma_20:
            signals.append("ABOVE SMA20")
        else:
            signals.append("BELOW SMA20")
        if rsi_14 > 70:
            signals.append("OVERBOUGHT")
        elif rsi_14 < 30:
            signals.append("OVERSOLD")
        else:
            signals.append("NEUTRAL RSI")
        if macd_line.iloc[-1] > signal_line.iloc[-1]:
            signals.append("MACD BULLISH")
        else:
            signals.append("MACD BEARISH")

        # Overall signal
        bullish_count = sum(1 for s in signals if "ABOVE" in s or "BULLISH" in s or "OVERSOLD" in s)
        if bullish_count >= 2:
            overall = "BULLISH"
        elif bullish_count == 0:
            overall = "BEARISH"
        else:
            overall = "NEUTRAL"

        return jsonify({
            "symbol": "VNINDEX",
            "price": round(float(current_price), 2),
            "change": round(float(change), 2),
            "percent_change": round(float(percent_change), 2),
            "timestamp": str(hist.index[-1]),
            "open": round(day_open, 2),
            "high": round(day_high, 2),
            "low": round(day_low, 2),
            "volume": vol_current,
            "avg_volume_20": vol_avg_20,
            "high_period": round(high_52w, 2),
            "low_period": round(low_52w, 2),
            "indicators": {
                "sma_20": round(float(sma_20), 2),
                "sma_50": round(float(sma_50), 2),
                "ema_12": round(float(ema_12), 2),
                "ema_26": round(float(ema_26), 2),
                "rsi_14": round(float(rsi_14), 2),
                "macd": round(float(macd_line.iloc[-1]), 2),
                "macd_signal": round(float(signal_line.iloc[-1]), 2),
                "macd_histogram": round(float(macd_hist.iloc[-1]), 2),
                "bb_upper": round(float(bb_upper.iloc[-1]), 2),
                "bb_middle": round(float(bb_middle.iloc[-1]), 2),
                "bb_lower": round(float(bb_lower.iloc[-1]), 2),
                "atr_14": round(float(atr), 2),
            },
            "signals": signals,
            "overall_signal": overall,
        })
    except Exception as e:
        print(f"[Market Data Error] {e}")
        return jsonify({"error": str(e)}), 500


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
# Run
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
