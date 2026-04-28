SYSTEM SPECIFICATION: Financial Social Listening System using Lightweight LLM

Note for AI Coding Assistants: This document is the definitive architecture and implementation guide. Treat this as the source of truth for generating code, schemas, and infrastructure setup. This system is heavily optimized for Financial Investment and Trading Signals.

1. Project Overview & Tech Stack

Hệ thống sử dụng Lightweight LLM (Gemma 4B) như một Data Extractor, tách biệt hoàn toàn việc phân tích ngữ nghĩa và tính toán toán học. Mục tiêu cốt lõi là phát hiện sớm các tín hiệu FOMO (Sợ bỏ lỡ), FUD (Sợ hãi, Không chắc chắn, Nghi ngờ), và đánh giá tâm lý thị trường (Bull/Bear) đối với các mã tài sản cụ thể (Cổ phiếu, Crypto, Forex).

Ngôn ngữ chính: Python 3.10+

LLM Inference: vLLM hoặc Ollama (hỗ trợ OpenAI compatible API, tính năng Structured Output / JSON Mode).

Message Queue: Redis (Pub/Sub hoặc Streams) / Kafka (cho production).

Database (Time-series): ClickHouse hoặc PostgreSQL (TimescaleDB).

Backend API: FastAPI.

Data Validation: Pydantic.

2. Data Sources & Ingestion Strategy (Nguồn dữ liệu & Thu thập)

Để phục vụ đầu tư tài chính, dữ liệu cần có tính thời gian thực (real-time) và tính lan truyền cao. Hệ thống sẽ lấy dữ liệu từ các nguồn sau:

X (Twitter): Nguồn tin tức nhanh nhất cho Crypto và chứng khoán quốc tế.

Cách truy xuất: Sử dụng Twitter API v2 (Cấp độ Essential/Elevated) qua Webhooks hoặc stream rules. Nếu bị giới hạn API, sử dụng các thư viện scraping không chính thức nhưng cần proxy xoay vòng (rotating proxies).

Cộng đồng Chat (Telegram/Discord): Nơi phát sinh các tín hiệu "phím hàng" và tâm lý đám đông mạnh nhất.

Cách truy xuất: Sử dụng Telethon (Python) đăng nhập bằng User API để lắng nghe các channel/group công khai; sử dụng discord.py để làm bot theo dõi các server đầu tư.

Diễn đàn tài chính (Reddit, F319, FireAnt): Nơi thảo luận sâu về nhận định thị trường.

Cách truy xuất: Dùng PRAW cho Reddit (r/wallstreetbets, r/investing, r/CryptoCurrency). Viết crawler bằng Scrapy hoặc Playwright cho các diễn đàn nội địa như F319, FireAnt.

Báo chí Tài chính (Bloomberg, Reuters, CafeF, Vietstock): Nguồn tin tức chính thống ảnh hưởng đến vĩ mô.

Cách truy xuất: Lấy qua RSS Feeds (liên tục 1-5 phút/lần) hoặc kết nối API của các nhà cung cấp dữ liệu tài chính.

3. Directory Structure (Cấu trúc thư mục đề xuất)

Yêu cầu AI Agent tạo dự án theo cấu trúc sau:

social-listening-system/
├── docker-compose.yml       # Setup Redis, ClickHouse, vLLM
├── ingestion/               # Phase 1: Data Gathering & Micro-chunking
│   ├── scrapers/            # Các modules cào dữ liệu cho từng nguồn
│   │   ├── twitter_stream.py
│   │   ├── telethon_client.py
│   │   └── rss_news_reader.py
│   ├── chunker.py           # Chia nhỏ text
│   └── queue_producer.py    # Đẩy vào Redis/Kafka
├── llm_extractor/           # Phase 2: Gemma 4B Consumer (Finance Tuned)
│   ├── prompts.py
│   └── extractor_service.py
├── metrics_engine/          # Phase 3: External Calculation
│   └── aggregator.py        # Tính toán Bull/Bear Index, FOMO/FUD
├── database/                # Phase 4: Storage
│   └── schema.sql           # ClickHouse/Timescale DDL
└── api_dashboard/           # Phase 5: FastAPI cho Frontend
    └── main.py              # Các endpoints thống kê tài chính


4. Data Contracts & Data Models (Pydantic Schemas)

4.1. Phase 1: Ingestion & Micro-Chunking (Input Data)

Dữ liệu thô phải được chia nhỏ (max 200 tokens) trước khi đẩy vào Queue.

from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional

class RawChunk(BaseModel):
    chunk_id: str = Field(..., description="UUID của đoạn text")
    source: str = Field(..., description="Nguồn: x, telegram, reddit, f319, cafef")
    timestamp: datetime = Field(..., description="Thời gian phát hành/đăng tải")
    text: str = Field(..., description="Nội dung đã được chunking (<= 200 tokens)")
    author_credibility: float = Field(default=1.0, description="Độ uy tín của tác giả (Dựa trên follower, tick xanh)")
    engagement_weight: float = Field(default=1.0, description="Trọng số dựa trên likes/retweets/views")


4.2. Phase 2: LLM Inference Output (JSON Schema for Finance)

Mô hình BẮT BUỘC phải trả về JSON khớp với Schema tài chính này.

class LLMExtractedFeature(BaseModel):
    market_sentiment: float = Field(..., ge=-1.0, le=1.0, description="-1: Bearish (Bán tháo), 0: Neutral, 1: Bullish (Gom hàng)")
    fomo_fud_level: int = Field(..., ge=-5, le=5, description="-5: Panic Sell/FUD tột độ, 5: FOMO tột độ")
    topic_id: int = Field(..., description="1: Cổ phiếu/Token cụ thể, 2: Tin Vĩ mô (Lãi suất/Lạm phát), 3: Báo cáo tài chính, 4: Tin đồn/Scandal")
    assets_mentioned: list[str] = Field(default=[], description="Danh sách các mã tài sản được nhắc đến (VD: ['BTC', 'NVDA', 'VHM'])")


LLM System Prompt (Dành cho extractor_service.py):

You are a highly precise financial data extraction pipeline for an investment fund.
Analyze the user text to gauge market sentiment and identify financial assets.
Output ONLY a valid JSON object matching this schema. Do not output markdown or text.
Schema: { 
  "market_sentiment": float (-1.0 to 1.0), 
  "fomo_fud_level": int (-5 to 5), 
  "topic_id": int (1-4), 
  "assets_mentioned": array of strings 
}


4.3. Phase 3: Aggregated Metrics (Dữ liệu tính toán xong)

class ProcessedRecord(BaseModel):
    timestamp: datetime
    source: str
    topic_id: int
    asset_symbol: str
    market_sentiment: float
    engagement_weight: float
    fomo_fud_level: int


5. Business Logic & Algorithms (Mã giả cho tính toán Tài chính)

AI Agent Action: Triển khai thuật toán trong metrics_engine/aggregator.py. Bỏ qua LLM, sử dụng Python.

5.1. Asset Sentiment Index (ASI) Calculator

Tính điểm tâm lý cho một mã tài sản cụ thể. Trọng số phụ thuộc vào độ uy tín và tương tác.

def calculate_asi(records: list[ProcessedRecord]) -> float:
    if not records:
        return 0.0
    # ASI = Tổng(Sentiment * Trọng số tương tác) / Tổng số lượt nhắc
    total_weighted_sentiment = sum(r.market_sentiment * r.engagement_weight for r in records)
    total_mentions = len(records)
    return total_weighted_sentiment / total_mentions


5.2. Market Volatility / Flash Alert Trigger (Sliding Window)

Phát hiện dấu hiệu bơm xả (Pump & Dump) hoặc hoảng loạn bán tháo. Chạy mỗi 1-3 phút.

ALERT_THRESHOLD = 25 # Ngưỡng điểm kích hoạt cảnh báo

def check_market_anomaly(records_last_5m: list[ProcessedRecord]) -> dict:
    # Gom nhóm theo mã tài sản
    alerts = []
    assets = set(r.asset_symbol for r in records_last_5m)
    
    for asset in assets:
        asset_records = [r for r in records_last_5m if r.asset_symbol == asset]
        fomo_score = sum(r.fomo_fud_level for r in asset_records if r.fomo_fud_level >= 3)
        fud_score = sum(abs(r.fomo_fud_level) for r in asset_records if r.fomo_fud_level <= -3)
        
        if fomo_score > ALERT_THRESHOLD:
            alerts.append({"asset": asset, "type": "PUMP_SIGNAL", "score": fomo_score})
        elif fud_score > ALERT_THRESHOLD:
            alerts.append({"asset": asset, "type": "PANIC_SELL_DUMP", "score": fud_score})
            
    if alerts:
        trigger_webhook_to_trading_bot(alerts)
        
    return alerts


6. Database Schema (ClickHouse / SQL DDL)

AI Agent Action: Tối ưu indexing cho mã tài sản (asset_symbol).

CREATE TABLE financial_social_metrics (
    timestamp DateTime,
    chunk_id UUID,
    source String,
    topic_id UInt8,
    asset_symbol String,
    market_sentiment Float32,
    engagement_weight Float32,
    fomo_fud_level Int8
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (asset_symbol, timestamp, topic_id);


7. Dashboard API Endpoints (FastAPI Contract)

AI Agent Action: Tạo api_dashboard/main.py.

GET /api/v1/metrics/{asset_symbol}/sentiment-trend

Params: time_range (vd: 24h), interval (vd: 15m)

SQL Logic: SELECT toStartOfFifteenMinutes(timestamp) as time, SUM(market_sentiment * engagement_weight) / COUNT(*) as ASI FROM financial_social_metrics WHERE asset_symbol = '{asset_symbol}' GROUP BY time ORDER BY time

GET /api/v1/metrics/hot-assets

Params: time_range (vd: 1h)

SQL Logic: SELECT asset_symbol, COUNT(*) as volume, AVG(market_sentiment) as avg_sentiment FROM financial_social_metrics WHERE timestamp >= now() - INTERVAL 1 HOUR GROUP BY asset_symbol ORDER BY volume DESC LIMIT 10

GET /api/v1/metrics/fud-fomo-radar

SQL Logic: SELECT asset_symbol, SUM(fomo_fud_level) as extreme_index FROM financial_social_metrics WHERE abs(fomo_fud_level) >= 3 GROUP BY asset_symbol ORDER BY abs(extreme_index) DESC

8. Execution Instructions for AI Assistant

Khi người dùng yêu cầu "Triển khai hệ thống này", hỡi AI Assistant, hãy thực hiện theo trình tự:

Tạo file requirements.txt với fastapi, pydantic, redis, clickhouse-driver, instructor (hoặc outlines), tweepy, telethon, beautifulsoup4.

Viết file docker-compose.yml để mock Redis và Clickhouse.

Cài đặt các schema ở mục 4 vào thư mục shared/models.py.

Thiết lập mock data generator trong ingestion/scrapers/ để giả lập luồng tweet/telegram nhắn các mã như BTC, ETH, NVDA, TSLA.

Viết extractor_service.py với cấu hình prompt hướng tới phân tích tài chính.

Viết aggregator.py tập trung vào việc kích hoạt hàm check_market_anomaly để log ra màn hình các tín hiệu Pump/Dump.

Viết FastAPI endpoints thực thi các câu lệnh SQL để truy vấn thống kê tài chính.