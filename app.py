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
from flask import Flask, jsonify, render_template, request

app = Flask(__name__)

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
SOURCES_FILE = os.path.join(DATA_DIR, "sources.json")

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

@app.route("/api/flights")
def get_flights():
    """Proxy to OpenSky Network. Accepts optional bounding box query params."""
    lamin = request.args.get("lamin", "-90")
    lamax = request.args.get("lamax", "90")
    lomin = request.args.get("lomin", "-180")
    lomax = request.args.get("lomax", "180")

    try:
        resp = requests.get(
            OPENSKY_URL,
            params={"lamin": lamin, "lamax": lamax, "lomin": lomin, "lomax": lomax},
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()

        # Transform to a lighter format for the frontend
        flights = []
        if data and data.get("states"):
            for s in data["states"]:
                if s[5] is not None and s[6] is not None:  # lon, lat must exist
                    flights.append({
                        "icao24": s[0],
                        "callsign": (s[1] or "").strip(),
                        "country": s[2],
                        "lon": s[5],
                        "lat": s[6],
                        "alt": s[7],  # baro altitude in meters
                        "velocity": s[9],  # m/s
                        "heading": s[10],  # degrees
                        "on_ground": s[8],
                    })
        return jsonify({"time": data.get("time"), "flights": flights})

    except requests.RequestException as e:
        print(f"[FLIGHTS] OpenSky error: {e}")
        return jsonify({"error": str(e), "flights": []}), 502


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
}


def _extract_text(html_str):
    """Strip HTML tags and decode entities."""
    text = re.sub(r"<[^>]+>", " ", html_str or "")
    text = html_mod.unescape(text)
    return text


def _tokenize(text):
    """Split text into lowercase alphanumeric tokens of length >= 3."""
    return [w for w in re.findall(r"[a-zA-Z]{3,}", text.lower()) if w not in STOP_WORDS]


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
# Run
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
