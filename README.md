<p align="center">
  <img src="branding/full_logo.png" alt="The Great Vietnam Banking Corporation" width="480">
</p>

<h1 align="center">ITDR</h1>

<p align="center">
  <strong>Live News Feed · Flight Tracking · Ship Tracking</strong><br>
  A real-time intelligence dashboard built with Python, HTML, CSS & JavaScript.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/python-3.10+-blue?logo=python&logoColor=white" alt="Python">
  <img src="https://img.shields.io/badge/flask-3.1-green?logo=flask&logoColor=white" alt="Flask">
  <img src="https://img.shields.io/badge/leaflet-1.9-199900?logo=leaflet&logoColor=white" alt="Leaflet">
  <img src="https://img.shields.io/badge/license-MIT-red" alt="License">
</p>

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 📰 **RSS News Feed** | Aggregate articles from any RSS source. Cards with title, summary, date and source badge. |
| ✈️ **Flight Tracking** | Live aircraft positions on a dark Leaflet map via [OpenSky Network](https://opensky-network.org). Auto-refreshes every 15 seconds. |
| 🚢 **Ship Tracking** | Real-time vessel positions via embedded [MarineTraffic](https://www.marinetraffic.com) map. |
| ⚙️ **Settings** | Add, remove, and quick-add popular RSS sources (BBC, Reuters, TechCrunch, Hacker News, NASA, NPR). |

---

Browser (Intel.js Analysis) ─→ Flask (app.py Proxy)
                             ├─ GET /api/feed            → RSS Feeds
                             ├─ GET /api/finance/history → Market Data
                             ├─ GET /api/flights        → Live Flights
                             └─ CRUD /api/sources       → data/sources.json

---

## 🚀 Quick Start

### Running with Docker (Recommended)

The easiest way to run ITDR is using Docker.

```bash
# Clone the repository
git clone https://github.com/GoSatoruu/reunion_rss.git
cd reunion_rss

# Start the application using Docker Compose
docker-compose up -d
```

The application will be available at **http://localhost** (or **http://<VPS_IP>** if running on a remote server). To stop the application, run `docker-compose down`.

### Auto-Updating with Docker (Watchtower)

The `docker-compose.yml` file includes **Watchtower**, a utility that automatically checks for new images every 5 minutes. Whenever a new commit is pushed and built to the GitHub Container Registry, Watchtower will safely download it and restart your application without any manual intervention!

If you prefer to update manually or pull the latest changes, you can do so by running:

```bash
git pull origin main
docker-compose pull
docker-compose up -d
```

### Running Locally

#### Prerequisites
- Python 3.10+

### Installation

```bash
# Clone the repository
git clone https://github.com/GoSatoruu/reunion_rss.git
cd reunion_rss

# Create and activate virtual environment
python -m venv venv
# On Windows:
.\venv\Scripts\activate
# On Linux/macOS:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run the server
python app.py
```

Open **http://localhost:5000** in your browser.

### First Steps
1. Go to **Settings** → Add RSS sources (or use the quick-add chips)
2. Return to **Dashboard** to see your news feed
3. The flight map loads automatically with live data

---

## 📁 Project Structure

```
reunion_rss/
├── app.py                  # Flask backend
├── requirements.txt        # Python dependencies
├── data/
│   └── sources.json        # RSS sources storage (auto-created)
├── branding/               # Brand assets
│   ├── logo.png            # Dragon icon (light bg)
│   ├── logo_dark.png       # Dragon icon (dark bg)
│   ├── full_logo.png       # Full logo with text
│   └── full_logo_dark.png  # Full logo (dark bg)
├── static/
│   ├── css/
│   │   └── style.css       # Dark glassmorphism theme
│   ├── js/
│   │   ├── intel.js        # NEW: Client-side analytics & financial math
│   │   ├── app.js          # Dashboard logic
│   │   ├── finance.js      # Finance Intelligence logic
│   │   ├── airline.js      # Aviation analytics
│   │   ├── logistics.js    # Maritime analytics
│   │   └── settings.js     # Settings CRUD logic
│   └── img/                # Runtime logo copies
├── templates/
│   ├── index.html          # Dashboard page
│   └── settings.html       # Settings page
└── README.md
```

---

## 🔌 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/sources` | List all RSS sources |
| `POST` | `/api/sources` | Add a new RSS source (`{"name": "...", "url": "..."}`) |
| `DELETE` | `/api/sources/<id>` | Remove an RSS source |
| `GET` | `/api/feed` | Fetch aggregated articles from all sources |
| `GET` | `/api/finance/history/bulk` | RAW market data for multiple tickers at once |
| `GET` | `/api/flights` | Raw flight states from OpenSky Network |
| `GET` | `/api/vessels` | Raw nautical states from marine simulator |

---

## 🛡️ Data Sources

- **Flight Data**: [OpenSky Network](https://opensky-network.org) — Free, no API key required (anonymous: ~100 req/day)
- **Ship Data**: [MarineTraffic](https://www.marinetraffic.com) — Embedded live map widget
- **RSS Parsing**: [feedparser](https://github.com/kurtmckee/feedparser) — Universal RSS/Atom parser

---

## 📜 License

MIT License — see [LICENSE](LICENSE) for details.

<p align="center">
  <img src="branding/logo.png" alt="GVBC Dragon" width="60">
  <br>
  <sub>The Great Vietnam Banking Corporation © 2026</sub>
</p>