"""
Social Listening Engine — Financial Signal Processing Module
============================================================
Implements the algorithms from social.md specification:
- LLM Feature Extraction (via OpenAI-compatible API)
- Asset Sentiment Index (ASI) Calculator
- Market Volatility / Flash Alert Trigger (Sliding Window)
- FOMO/FUD Radar Aggregation
- Mock data generator for demonstration
"""

import json
import re
import uuid
import random
import time
from datetime import datetime, timedelta
from collections import defaultdict
from typing import Optional


# ---------------------------------------------------------------------------
# Data Models (from social.md §4)
# ---------------------------------------------------------------------------

class RawChunk:
    """Phase 1: Ingestion & Micro-Chunking input data."""
    def __init__(self, chunk_id: str, source: str, timestamp: datetime,
                 text: str, author_credibility: float = 1.0,
                 engagement_weight: float = 1.0):
        self.chunk_id = chunk_id
        self.source = source
        self.timestamp = timestamp
        self.text = text[:800]  # enforce token limit
        self.author_credibility = author_credibility
        self.engagement_weight = engagement_weight


class LLMExtractedFeature:
    """Phase 2: LLM Inference Output — finance-tuned JSON schema."""
    def __init__(self, market_sentiment: float, fomo_fud_level: int,
                 topic_id: int, assets_mentioned: list):
        self.market_sentiment = max(-1.0, min(1.0, market_sentiment))
        self.fomo_fud_level = max(-5, min(5, fomo_fud_level))
        self.topic_id = topic_id
        self.assets_mentioned = assets_mentioned or []


class ProcessedRecord:
    """Phase 3: Aggregated metric record ready for storage/dashboard."""
    def __init__(self, timestamp: datetime, source: str, topic_id: int,
                 asset_symbol: str, market_sentiment: float,
                 engagement_weight: float, fomo_fud_level: int):
        self.timestamp = timestamp
        self.source = source
        self.topic_id = topic_id
        self.asset_symbol = asset_symbol
        self.market_sentiment = market_sentiment
        self.engagement_weight = engagement_weight
        self.fomo_fud_level = fomo_fud_level

    def to_dict(self):
        return {
            "timestamp": self.timestamp.isoformat(),
            "source": self.source,
            "topic_id": self.topic_id,
            "asset_symbol": self.asset_symbol,
            "market_sentiment": round(self.market_sentiment, 3),
            "engagement_weight": round(self.engagement_weight, 2),
            "fomo_fud_level": self.fomo_fud_level,
        }


# ---------------------------------------------------------------------------
# Topic ID Labels
# ---------------------------------------------------------------------------
TOPIC_LABELS = {
    1: "Cổ phiếu/Token cụ thể",
    2: "Tin Vĩ mô (Lãi suất/Lạm phát)",
    3: "Báo cáo tài chính",
    4: "Tin đồn/Scandal",
}

# ---------------------------------------------------------------------------
# LLM System Prompt (from social.md §4.2)
# ---------------------------------------------------------------------------
LLM_SYSTEM_PROMPT = """You are a highly precise financial data extraction pipeline for an investment fund.
Analyze the user text to gauge market sentiment and identify financial assets.
Output ONLY a valid JSON object matching this schema. Do not output markdown or text.
Schema: {
  "market_sentiment": float (-1.0 to 1.0),
  "fomo_fud_level": int (-5 to 5),
  "topic_id": int (1-4),
  "assets_mentioned": array of strings
}"""


# ---------------------------------------------------------------------------
# In-Memory Store (replaces ClickHouse for embedded mode)
# ---------------------------------------------------------------------------
_records_store: list = []  # List of ProcessedRecord
_alerts_store: list = []   # List of alert dicts


def get_records():
    return _records_store


def get_alerts():
    return _alerts_store


def clear_old_records(max_age_hours=24):
    """Remove records older than max_age_hours."""
    global _records_store
    cutoff = datetime.utcnow() - timedelta(hours=max_age_hours)
    _records_store = [r for r in _records_store if r.timestamp > cutoff]


# ---------------------------------------------------------------------------
# §5.1 Asset Sentiment Index (ASI) Calculator
# ---------------------------------------------------------------------------

def calculate_asi(records: list) -> float:
    """
    ASI = Σ(Sentiment × Engagement Weight) / Total mentions
    Returns value in range [-1.0, 1.0]
    """
    if not records:
        return 0.0
    total_weighted_sentiment = sum(
        r.market_sentiment * r.engagement_weight for r in records
    )
    total_mentions = len(records)
    return total_weighted_sentiment / total_mentions


# ---------------------------------------------------------------------------
# §5.2 Market Volatility / Flash Alert Trigger (Sliding Window)
# ---------------------------------------------------------------------------

ALERT_THRESHOLD = 25  # Score threshold for triggering alert

def check_market_anomaly(records_window: list) -> list:
    """
    Detect Pump & Dump or Panic Sell signals within a time window.
    Groups by asset symbol and checks FOMO/FUD extremes.
    """
    alerts = []
    assets = set(r.asset_symbol for r in records_window)

    for asset in assets:
        asset_records = [r for r in records_window if r.asset_symbol == asset]
        fomo_score = sum(
            r.fomo_fud_level for r in asset_records if r.fomo_fud_level >= 3
        )
        fud_score = sum(
            abs(r.fomo_fud_level) for r in asset_records if r.fomo_fud_level <= -3
        )

        if fomo_score > ALERT_THRESHOLD:
            alerts.append({
                "asset": asset,
                "type": "PUMP_SIGNAL",
                "score": fomo_score,
                "mentions": len(asset_records),
                "timestamp": datetime.utcnow().isoformat(),
            })
        elif fud_score > ALERT_THRESHOLD:
            alerts.append({
                "asset": asset,
                "type": "PANIC_SELL_DUMP",
                "score": fud_score,
                "mentions": len(asset_records),
                "timestamp": datetime.utcnow().isoformat(),
            })

    return alerts


# ---------------------------------------------------------------------------
# Aggregation Functions (Dashboard Queries)
# ---------------------------------------------------------------------------

def get_hot_assets(records: list, top_n: int = 10) -> list:
    """
    Equivalent to: SELECT asset_symbol, COUNT(*) as volume,
    AVG(market_sentiment) as avg_sentiment ... ORDER BY volume DESC
    """
    asset_data = defaultdict(lambda: {"count": 0, "sentiment_sum": 0.0,
                                       "fomo_sum": 0, "engagement_sum": 0.0})
    for r in records:
        d = asset_data[r.asset_symbol]
        d["count"] += 1
        d["sentiment_sum"] += r.market_sentiment
        d["fomo_sum"] += r.fomo_fud_level
        d["engagement_sum"] += r.engagement_weight

    result = []
    for asset, d in asset_data.items():
        count = d["count"]
        result.append({
            "asset": asset,
            "volume": count,
            "avg_sentiment": round(d["sentiment_sum"] / count, 3),
            "asi": round(
                d["sentiment_sum"] * d["engagement_sum"] / (count * count), 3
            ) if count > 0 else 0,
            "fomo_index": round(d["fomo_sum"] / count, 1),
        })

    result.sort(key=lambda x: x["volume"], reverse=True)
    return result[:top_n]


def get_fud_fomo_radar(records: list) -> list:
    """
    Equivalent to: SELECT asset_symbol, SUM(fomo_fud_level) as extreme_index
    WHERE abs(fomo_fud_level) >= 3 ...
    """
    extreme_data = defaultdict(lambda: {"extreme_sum": 0, "count": 0})
    for r in records:
        if abs(r.fomo_fud_level) >= 3:
            d = extreme_data[r.asset_symbol]
            d["extreme_sum"] += r.fomo_fud_level
            d["count"] += 1

    result = []
    for asset, d in extreme_data.items():
        result.append({
            "asset": asset,
            "extreme_index": d["extreme_sum"],
            "extreme_mentions": d["count"],
            "signal": "FOMO" if d["extreme_sum"] > 0 else "FUD",
        })

    result.sort(key=lambda x: abs(x["extreme_index"]), reverse=True)
    return result


def get_sentiment_trend(records: list, asset_symbol: str,
                        interval_minutes: int = 15) -> list:
    """
    Time-bucketed ASI trend for a specific asset.
    Equivalent to: SELECT toStartOfFifteenMinutes(timestamp) as time,
    SUM(sentiment * engagement) / COUNT(*) as ASI ...
    """
    asset_records = [r for r in records if r.asset_symbol == asset_symbol]
    if not asset_records:
        return []

    # Bucket by interval
    buckets = defaultdict(list)
    for r in asset_records:
        bucket_time = r.timestamp.replace(
            minute=(r.timestamp.minute // interval_minutes) * interval_minutes,
            second=0, microsecond=0
        )
        buckets[bucket_time].append(r)

    trend = []
    for t in sorted(buckets.keys()):
        bucket = buckets[t]
        asi = calculate_asi(bucket)
        avg_fomo = sum(r.fomo_fud_level for r in bucket) / len(bucket)
        trend.append({
            "time": t.isoformat(),
            "asi": round(asi, 3),
            "avg_fomo": round(avg_fomo, 1),
            "volume": len(bucket),
        })

    return trend


# ---------------------------------------------------------------------------
# LLM Extraction Service
# ---------------------------------------------------------------------------

def extract_features_with_llm(text: str, config: dict) -> Optional[LLMExtractedFeature]:
    """
    Send text chunk to LLM for financial feature extraction.
    Uses OpenAI-compatible API (LM Studio / vLLM / Ollama).
    Returns LLMExtractedFeature or None on failure.
    """
    import requests as req

    base_url = config.get("llm_api_url", "http://localhost:1234/v1").rstrip("/")
    if not base_url.endswith("/v1"):
        base_url += "/v1"
    url = base_url + "/chat/completions"

    headers = {
        "Authorization": f"Bearer {config.get('llm_api_key', 'lm-studio')}",
        "Content-Type": "application/json",
    }

    payload = {
        "model": config.get("llm_model", "local-model"),
        "messages": [
            {"role": "system", "content": LLM_SYSTEM_PROMPT},
            {"role": "user", "content": text},
        ],
        "temperature": 0.1,
        "max_tokens": 200,
        "response_format": {"type": "json_object"},
    }

    try:
        resp = req.post(url, json=payload, headers=headers, timeout=30)
        if resp.status_code != 200:
            print(f"[SOCIAL_ENGINE] LLM HTTP {resp.status_code}")
            return None

        data = resp.json()
        content = data["choices"][0]["message"]["content"]
        parsed = json.loads(content)

        return LLMExtractedFeature(
            market_sentiment=float(parsed.get("market_sentiment", 0)),
            fomo_fud_level=int(parsed.get("fomo_fud_level", 0)),
            topic_id=int(parsed.get("topic_id", 1)),
            assets_mentioned=parsed.get("assets_mentioned", []),
        )
    except Exception as e:
        print(f"[SOCIAL_ENGINE] LLM extraction error: {e}")
        return None


# ---------------------------------------------------------------------------
# Rule-Based Fallback Extractor (no LLM required)
# ---------------------------------------------------------------------------

# Asset ticker patterns
ASSET_PATTERNS = {
    "BTC": r"\b(BTC|Bitcoin|bitcoin)\b",
    "ETH": r"\b(ETH|Ethereum|ethereum)\b",
    "SOL": r"\b(SOL|Solana|solana)\b",
    "BNB": r"\b(BNB)\b",
    "XRP": r"\b(XRP|Ripple|ripple)\b",
    "NVDA": r"\b(NVDA|Nvidia|NVIDIA)\b",
    "TSLA": r"\b(TSLA|Tesla)\b",
    "AAPL": r"\b(AAPL|Apple)\b",
    "MSFT": r"\b(MSFT|Microsoft)\b",
    "GOOGL": r"\b(GOOGL|Google|Alphabet)\b",
    "META": r"\b(META|Facebook)\b",
    "AMZN": r"\b(AMZN|Amazon)\b",
    "VHM": r"\b(VHM|Vinhomes)\b",
    "VNM": r"\b(VNM|Vinamilk)\b",
    "VIC": r"\b(VIC|Vingroup)\b",
    "FPT": r"\b(FPT)\b",
    "HPG": r"\b(HPG|Hoà Phát|Hoa Phat)\b",
    "SSI": r"\b(SSI)\b",
    "VNINDEX": r"\b(VN-?INDEX|VNINDEX)\b",
    "GOLD": r"\b(gold|Gold|GOLD|vàng|XAU)\b",
    "OIL": r"\b(crude oil|Crude Oil|dầu thô|WTI|Brent)\b",
}

BULLISH_WORDS = {
    "surge", "gain", "jump", "record", "high", "growth", "profit", "bull",
    "rally", "soar", "climb", "outperform", "beat", "upgrade", "buy",
    "breakout", "moon", "pump", "rocket", "boom", "tăng", "lãi", "đỉnh",
    "bùng nổ", "khởi sắc", "tích cực", "tăng trưởng", "mua vào",
}

BEARISH_WORDS = {
    "drop", "fall", "plunge", "loss", "crash", "bear", "slump", "shrink",
    "miss", "cut", "warning", "bankrupt", "sell", "dump", "panic", "fear",
    "scam", "fraud", "giảm", "lỗ", "đáy", "suy thoái", "bán tháo",
    "sụp đổ", "tiêu cực", "rủi ro", "cảnh báo",
}

FOMO_WORDS = {
    "fomo", "don't miss", "to the moon", "100x", "1000x", "gem",
    "buy now", "last chance", "đừng bỏ lỡ", "cơ hội cuối", "phi",
    "bắt đáy", "all-in", "accumulate",
}

FUD_WORDS = {
    "fud", "rug pull", "ponzi", "scam", "hack", "exploit", "bankrupt",
    "sec lawsuit", "ban", "cấm", "lừa đảo", "cảnh báo", "rủi ro",
    "investigation", "collapse", "fraud",
}

MACRO_WORDS = {
    "interest rate", "inflation", "gdp", "fed", "central bank", "cpi",
    "unemployment", "fiscal", "monetary", "lãi suất", "lạm phát",
    "ngân hàng trung ương",
}


def extract_features_rulebased(text: str) -> LLMExtractedFeature:
    """
    Rule-based feature extraction fallback when LLM is unavailable.
    Uses keyword matching for sentiment, FOMO/FUD, topic, and asset detection.
    """
    text_lower = text.lower()

    # Detect assets
    assets = []
    for ticker, pattern in ASSET_PATTERNS.items():
        if re.search(pattern, text):
            assets.append(ticker)

    # Sentiment scoring
    bull_count = sum(1 for w in BULLISH_WORDS if w in text_lower)
    bear_count = sum(1 for w in BEARISH_WORDS if w in text_lower)
    total = bull_count + bear_count
    if total > 0:
        sentiment = (bull_count - bear_count) / total
    else:
        sentiment = 0.0

    # FOMO/FUD scoring
    fomo_count = sum(1 for w in FOMO_WORDS if w in text_lower)
    fud_count = sum(1 for w in FUD_WORDS if w in text_lower)
    fomo_fud = min(5, fomo_count * 2) - min(5, fud_count * 2)

    # Topic detection
    if any(w in text_lower for w in MACRO_WORDS):
        topic_id = 2
    elif any(w in text_lower for w in {"earnings", "revenue", "profit", "doanh thu", "lợi nhuận", "báo cáo"}):
        topic_id = 3
    elif any(w in text_lower for w in {"scandal", "fraud", "lawsuit", "bê bối", "kiện", "vụ án"}):
        topic_id = 4
    else:
        topic_id = 1

    return LLMExtractedFeature(
        market_sentiment=round(sentiment, 3),
        fomo_fud_level=fomo_fud,
        topic_id=topic_id,
        assets_mentioned=assets,
    )


# ---------------------------------------------------------------------------
# RSS → ProcessedRecord Pipeline
# ---------------------------------------------------------------------------

def process_rss_articles(articles: list, config: dict,
                         use_llm: bool = False) -> list:
    """
    Process RSS articles through the extraction pipeline.
    Returns list of ProcessedRecord objects.
    """
    new_records = []
    now = datetime.utcnow()

    for art in articles:
        title = art.get("title", "")
        summary = art.get("summary", "")
        source = art.get("source", "rss")
        text = f"{title}. {summary}"

        # Extract features
        if use_llm:
            feature = extract_features_with_llm(text, config)
            if feature is None:
                feature = extract_features_rulebased(text)
        else:
            feature = extract_features_rulebased(text)

        # Create records for each mentioned asset
        if feature.assets_mentioned:
            for asset in feature.assets_mentioned:
                record = ProcessedRecord(
                    timestamp=now,
                    source=source,
                    topic_id=feature.topic_id,
                    asset_symbol=asset,
                    market_sentiment=feature.market_sentiment,
                    engagement_weight=1.0,
                    fomo_fud_level=feature.fomo_fud_level,
                )
                new_records.append(record)
                _records_store.append(record)
        else:
            # Still create a record tagged as "GENERAL"
            record = ProcessedRecord(
                timestamp=now,
                source=source,
                topic_id=feature.topic_id,
                asset_symbol="GENERAL",
                market_sentiment=feature.market_sentiment,
                engagement_weight=1.0,
                fomo_fud_level=feature.fomo_fud_level,
            )
            new_records.append(record)
            _records_store.append(record)

    # Run anomaly detection on recent records
    cutoff = now - timedelta(minutes=5)
    recent = [r for r in _records_store if r.timestamp > cutoff]
    new_alerts = check_market_anomaly(recent)
    if new_alerts:
        _alerts_store.extend(new_alerts)
        # Keep only last 50 alerts
        while len(_alerts_store) > 50:
            _alerts_store.pop(0)

    return new_records


# ---------------------------------------------------------------------------
# Mock Data Generator (for demonstration / testing)
# ---------------------------------------------------------------------------

def generate_mock_records(count: int = 80) -> list:
    """
    Generate realistic mock social listening data for demo purposes.
    Simulates data from multiple sources about various assets.
    """
    global _records_store
    sources = ["x_twitter", "telegram", "reddit", "cafef", "bloomberg_rss",
               "f319", "fireant", "discord"]
    assets = ["BTC", "ETH", "NVDA", "TSLA", "VHM", "FPT", "HPG",
              "SOL", "AAPL", "GOLD", "VNINDEX", "SSI"]

    now = datetime.utcnow()
    records = []

    # Seed with current time for variety
    random.seed(int(time.time() / 300))  # Change every 5 minutes

    for i in range(count):
        # Random time within last 2 hours
        ts = now - timedelta(minutes=random.randint(0, 120))
        asset = random.choice(assets)
        source = random.choice(sources)

        # Generate correlated sentiment + fomo
        base_sentiment = random.gauss(0.1, 0.4)
        base_sentiment = max(-1.0, min(1.0, base_sentiment))

        if asset in ("BTC", "SOL"):
            # Crypto tends to be more volatile / FOMO-driven
            fomo_bias = random.choice([-1, 0, 0, 1, 1, 2, 3])
        elif asset in ("VHM", "HPG"):
            # VN stocks — moderate sentiment
            fomo_bias = random.choice([-2, -1, 0, 0, 1])
        else:
            fomo_bias = random.choice([-1, 0, 0, 0, 1])

        fomo = max(-5, min(5, int(base_sentiment * 3) + fomo_bias))

        topic = random.choices([1, 2, 3, 4], weights=[50, 25, 15, 10])[0]
        engagement = round(random.uniform(0.3, 3.0), 2)

        record = ProcessedRecord(
            timestamp=ts,
            source=source,
            topic_id=topic,
            asset_symbol=asset,
            market_sentiment=round(base_sentiment, 3),
            engagement_weight=engagement,
            fomo_fud_level=fomo,
        )
        records.append(record)

    _records_store.extend(records)

    # Trim store to max 500 records
    if len(_records_store) > 500:
        _records_store = _records_store[-500:]

    # Run anomaly check
    cutoff = now - timedelta(minutes=5)
    recent = [r for r in _records_store if r.timestamp > cutoff]
    new_alerts = check_market_anomaly(recent)
    if new_alerts:
        _alerts_store.extend(new_alerts)
        while len(_alerts_store) > 50:
            _alerts_store.pop(0)

    return records


# ---------------------------------------------------------------------------
# Dashboard Summary Builder
# ---------------------------------------------------------------------------

def build_dashboard_summary() -> dict:
    """
    Build complete dashboard data for the Social Listening frontend.
    Returns all metrics, hot assets, radar, alerts, and trends.
    """
    records = _records_store
    now = datetime.utcnow()

    # Time windows
    last_1h = [r for r in records
                if r.timestamp > now - timedelta(hours=1)]
    last_5m = [r for r in records
                if r.timestamp > now - timedelta(minutes=5)]

    # Overall ASI
    overall_asi = calculate_asi(last_1h)

    # Hot assets
    hot_assets = get_hot_assets(last_1h, top_n=10)

    # FOMO/FUD radar
    radar = get_fud_fomo_radar(last_1h)

    # Alerts
    alerts = _alerts_store[-10:]

    # Source distribution
    source_dist = defaultdict(int)
    for r in last_1h:
        source_dist[r.source] += 1
    source_list = [{"source": k, "count": v}
                   for k, v in sorted(source_dist.items(),
                                       key=lambda x: -x[1])]

    # Topic distribution
    topic_dist = defaultdict(int)
    for r in last_1h:
        topic_dist[r.topic_id] += 1
    topic_list = [{"topic_id": k, "label": TOPIC_LABELS.get(k, "Unknown"),
                   "count": v}
                  for k, v in sorted(topic_dist.items(),
                                      key=lambda x: -x[1])]

    # Overall market mood
    bull_count = sum(1 for r in last_1h if r.market_sentiment > 0.2)
    bear_count = sum(1 for r in last_1h if r.market_sentiment < -0.2)
    neutral_count = len(last_1h) - bull_count - bear_count
    total = max(len(last_1h), 1)

    # Sentiment trend (15-min buckets for all records)
    all_buckets = defaultdict(list)
    for r in last_1h:
        bucket_time = r.timestamp.replace(
            minute=(r.timestamp.minute // 15) * 15,
            second=0, microsecond=0
        )
        all_buckets[bucket_time].append(r)

    sentiment_timeline = []
    for t in sorted(all_buckets.keys()):
        bucket = all_buckets[t]
        asi = calculate_asi(bucket)
        sentiment_timeline.append({
            "time": t.strftime("%H:%M"),
            "asi": round(asi, 3),
            "volume": len(bucket),
        })

    return {
        "timestamp": now.isoformat(),
        "total_records_1h": len(last_1h),
        "total_records_5m": len(last_5m),
        "overall_asi": round(overall_asi, 3),
        "market_mood": {
            "bullish_pct": round(bull_count / total * 100, 1),
            "bearish_pct": round(bear_count / total * 100, 1),
            "neutral_pct": round(neutral_count / total * 100, 1),
        },
        "hot_assets": hot_assets,
        "fud_fomo_radar": radar,
        "alerts": alerts,
        "sources": source_list,
        "topics": topic_list,
        "sentiment_timeline": sentiment_timeline,
    }
