from __future__ import annotations

import asyncio
import json
import os
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import urlparse
import xml.etree.ElementTree as ET

import requests


GLOBAL_NEWS_KEYWORDS: tuple[str, ...] = (
    "rate cut",
    "rate hike",
    "inflation",
    "central bank",
    "fed",
    "ecb",
    "boj",
    "war",
    "conflict",
    "attack",
    "sanctions",
    "crisis",
    "oil disruption",
    "energy shock",
    "recession",
    "default",
    "bank collapse",
    "geopolitical",
)

ASSET_NEWS_QUERY: dict[str, str] = {
    "usd_index": "US dollar index OR DXY OR Fed OR treasury yields",
    "eur": "eurozone OR ECB OR euro inflation OR EU growth",
    "jpy": "yen OR Bank of Japan OR BOJ policy OR Japan rates",
    "gbp": "pound sterling OR Bank of England OR UK inflation",
    "chf": "Swiss franc OR SNB OR Switzerland inflation",
    "aud": "Australian dollar OR RBA OR Australia inflation OR China demand",
    "cad": "Canadian dollar OR Bank of Canada OR crude oil OR Canada inflation",
    "nzd": "New Zealand dollar OR RBNZ OR New Zealand inflation",
    "gold": "gold OR bullion OR central bank buying",
    "silver": "silver OR precious metals demand",
    "platinum": "platinum OR autocatalyst demand OR PGM",
    "palladium": "palladium OR autocatalyst demand OR PGM",
    "aluminum": "aluminum OR aluminium OR smelter OR industrial metals",
    "wti_spot": "oil OR OPEC OR crude OR supply disruption",
    "oil": "oil OR OPEC OR crude OR supply disruption",
    "natgas": "natural gas OR LNG OR gas storage OR pipeline disruption",
    "gasoline": "gasoline OR refinery OR crack spread OR fuel demand",
    "sp500": "US equities OR Fed OR earnings",
    "nasdaq100": "tech stocks OR US rates",
    "dowjones": "Dow Jones OR industrial stocks OR US macro",
    "russell2000": "small caps OR Russell 2000 OR US growth outlook",
    "bitcoin": "bitcoin OR crypto regulation OR ETF",
    "corn": "corn OR grain supply OR USDA OR export ban",
    "soybeans": "soybeans OR soybean demand OR China imports",
    "soyoil": "soybean oil OR biofuel demand OR ag commodities",
    "wheat": "wheat OR grain supply OR export ban",
    "coffee": "coffee OR arabica OR robusta OR crop weather",
    "sugar": "sugar OR ethanol OR cane crop",
    "cocoa": "cocoa OR west africa crop OR chocolate demand",
    "cotton": "cotton OR textile demand OR crop outlook",
    "orange_juice": "orange juice OR citrus crop OR weather risk",
    "live_cattle": "live cattle OR feedlot OR USDA cattle report",
    "lean_hogs": "lean hogs OR pork demand OR USDA hog report",
    "copper": "copper OR China demand",
    "dax40": "Germany economy OR ECB OR eurozone",
}

FINNHUB_ASSET_SYMBOL: dict[str, str] = {
    "usd_index": "UUP",
    "eur": "FXE",
    "jpy": "FXY",
    "gbp": "FXB",
    "chf": "FXF",
    "aud": "FXA",
    "cad": "FXC",
    "nzd": "NZDUSD",
    "gold": "GC=F",
    "silver": "SI=F",
    "platinum": "PL=F",
    "palladium": "PA=F",
    "aluminum": "ALI=F",
    "wti_spot": "CL=F",
    "sp500": "SPY",
    "nasdaq100": "QQQ",
    "dowjones": "DIA",
    "russell2000": "IWM",
    "bitcoin": "BTCUSD",
    "corn": "ZC=F",
    "soybeans": "ZS=F",
    "soyoil": "ZL=F",
    "wheat": "ZW=F",
    "coffee": "KC=F",
    "sugar": "SB=F",
    "cocoa": "CC=F",
    "cotton": "CT=F",
    "orange_juice": "OJ=F",
    "live_cattle": "LE=F",
    "lean_hogs": "HE=F",
    "copper": "HG=F",
    "dax40": "DAX",
}

PREFERRED_NEWS_DOMAINS: tuple[str, ...] = (
    "bloomberg.com",
    "cnn.com",
    "investing.com",
    "reuters.com",
    "cnbc.com",
    "marketwatch.com",
    "finance.yahoo.com",
    "seekingalpha.com",
    "financialjuice.com",
    "livesquawk.com",
    "livescroll.com",
    "ft.com",
    "wsj.com",
)

RSS_GLOBAL_FEEDS: tuple[tuple[str, str], ...] = (
    ("Bloomberg", "https://feeds.bloomberg.com/markets/news.rss"),
    ("CNN", "https://rss.cnn.com/rss/money_latest.rss"),
    ("CNBC", "https://www.cnbc.com/id/100003114/device/rss/rss.html"),
    ("Financial Times", "https://www.ft.com/rss/home"),
    ("MarketWatch", "https://feeds.content.dowjones.io/public/rss/mw_topstories"),
    ("Reuters", "https://feeds.reuters.com/reuters/businessNews"),
    ("Investing.com", "https://www.investing.com/rss/news_25.rss"),
    ("Seeking Alpha", "https://seekingalpha.com/feed.xml"),
    ("Seeking Alpha Market Currents", "https://seekingalpha.com/market_currents.xml"),
    ("Yahoo Finance", "https://finance.yahoo.com/news/rssindex"),
    ("Financial Juice", "https://www.financialjuice.com/home/rss"),
)

RSS_TOPIC_QUERIES: tuple[str, ...] = (
    "financial juice OR financialjuice macro markets",
    "seeking alpha markets breaking",
    "bloomberg macro risk markets",
    "reuters commodities disruptions",
    "cnbc inflation central bank",
    "live squawk OR livescroll markets",
    "breaking headlines macro markets",
)


class NewsProvider(Protocol):
    async def get_global_news(self, max_items: int = 10, days: int = 5) -> list[dict[str, Any]]:
        ...

    async def get_asset_news(self, asset_id: str, max_items: int = 10, days: int = 5) -> list[dict[str, Any]]:
        ...


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _parse_dt(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        try:
            return datetime.fromtimestamp(float(value), tz=timezone.utc)
        except Exception:
            return None
    raw = str(value).strip()
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).astimezone(timezone.utc)
    except Exception:
        pass
    try:
        parsed = parsedate_to_datetime(raw)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except Exception:
        return None


def _within_days(published_at: Any, days: int) -> bool:
    dt = _parse_dt(published_at)
    if dt is None:
        return False
    return dt >= (_utc_now() - timedelta(days=int(max(1, days))))


def _query_to_terms(query: str) -> list[str]:
    cleaned = str(query or "").replace('"', " ").replace("(", " ").replace(")", " ")
    parts = [p.strip().lower() for p in cleaned.split("OR")]
    terms = [p for p in parts if p and len(p) >= 3]
    return terms


def _contains_terms(text: str, terms: list[str]) -> bool:
    if not terms:
        return True
    hay = str(text or "").lower()
    return any(term in hay for term in terms)


def _source_name(value: Any) -> str:
    if isinstance(value, dict):
        name = str(value.get("name") or "").strip()
        if name:
            return name
    out = str(value or "").strip()
    return out or "Unknown"


def _domain(value: str) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    if "://" not in raw:
        raw = f"https://{raw}"
    try:
        host = urlparse(raw).netloc.lower().strip()
    except Exception:
        host = ""
    if host.startswith("www."):
        host = host[4:]
    return host


def _source_priority(source: Any, url: Any) -> int:
    src = str(source or "").lower()
    host = _domain(str(url or ""))
    for idx, dom in enumerate(PREFERRED_NEWS_DOMAINS):
        if dom in src or dom in host:
            return max(1, 100 - (idx * 8))
    return 0


def _normalize_item(
    *,
    title: Any,
    source: Any,
    url: Any,
    published_at: Any,
    fallback_age_hours: int = 1,
) -> dict[str, Any] | None:
    t = str(title or "").strip()
    u = str(url or "").strip()
    if not t or not u:
        return None
    dt = _parse_dt(published_at)
    if dt is None:
        dt = _utc_now() - timedelta(hours=int(max(0, fallback_age_hours)))
    out = {
        "title": t,
        "source": _source_name(source),
        "url": u,
        "publishedAt": _iso(dt),
    }
    out["_priority"] = _source_priority(out.get("source"), out.get("url"))
    return out


def _dedupe_sort_limit(rows: list[dict[str, Any]], max_items: int) -> list[dict[str, Any]]:
    seen: set[str] = set()
    uniq: list[dict[str, Any]] = []
    for row in rows:
        key = f"{str(row.get('url', '')).strip()}|{str(row.get('title', '')).strip().lower()}"
        if key in seen:
            continue
        seen.add(key)
        uniq.append(row)

    def _sort_key(row: dict[str, Any]) -> tuple[int, float]:
        dt = _parse_dt(row.get("publishedAt"))
        ts = dt.timestamp() if dt is not None else 0.0
        prio = int(row.get("_priority", 0) or 0)
        return prio, ts

    uniq.sort(key=_sort_key, reverse=True)
    out: list[dict[str, Any]] = []
    for row in uniq[: int(max(1, max_items))]:
        clean = {k: v for k, v in row.items() if not str(k).startswith("_")}
        out.append(clean)
    return out


def _asset_query(asset_id: str) -> str:
    aid = str(asset_id or "").strip().lower()
    return ASSET_NEWS_QUERY.get(aid, f"{aid} macro markets")


async def _http_get_json(
    url: str,
    *,
    params: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    timeout_seconds: float = 12.0,
) -> Any:
    def _run() -> Any:
        res = requests.get(url, params=params, headers=headers, timeout=timeout_seconds)
        res.raise_for_status()
        return res.json()

    return await asyncio.to_thread(_run)


async def _http_get_text(
    url: str,
    *,
    params: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    timeout_seconds: float = 8.0,
) -> str:
    def _run() -> str:
        req_headers = {
            "User-Agent": "InvoriaMacroBot/1.0 (+https://localhost)",
            "Accept": "application/rss+xml, application/xml, text/xml, */*",
        }
        if headers:
            req_headers.update(headers)
        res = requests.get(url, params=params, headers=req_headers, timeout=timeout_seconds)
        res.raise_for_status()
        return res.text

    return await asyncio.to_thread(_run)


class MockNewsProvider:
    def __init__(self, mock_dir: Path) -> None:
        self._mock_dir = Path(mock_dir)
        self._global_news = self._read_json("news_global.json")
        self._asset_news = self._read_json("news_asset.json")

    def _read_json(self, name: str) -> Any:
        path = self._mock_dir / name
        with path.open("r", encoding="utf-8") as fh:
            return json.load(fh)

    def _prepare(
        self,
        rows: list[dict[str, Any]],
        *,
        query_terms: list[str],
        max_items: int,
        days: int,
    ) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for idx, row in enumerate(rows):
            if not isinstance(row, dict):
                continue
            item = _normalize_item(
                title=row.get("title"),
                source=row.get("source"),
                url=row.get("url"),
                published_at=row.get("publishedAt"),
                fallback_age_hours=(idx * 6) + 2,
            )
            if item is None:
                continue
            combined = f"{item['title']} {str(row.get('description') or '')}"
            if query_terms and not _contains_terms(combined, query_terms):
                continue
            if not _within_days(item.get("publishedAt"), days):
                continue
            out.append(item)
        return _dedupe_sort_limit(out, max_items)

    async def get_global_news(self, max_items: int = 10, days: int = 5) -> list[dict[str, Any]]:
        rows = self._global_news if isinstance(self._global_news, list) else []
        terms = list(GLOBAL_NEWS_KEYWORDS)
        return self._prepare(rows, query_terms=terms, max_items=max_items, days=days)

    async def get_asset_news(self, asset_id: str, max_items: int = 10, days: int = 5) -> list[dict[str, Any]]:
        table = self._asset_news if isinstance(self._asset_news, dict) else {}
        rows = table.get(str(asset_id).lower(), [])
        if not isinstance(rows, list) or not rows:
            rows = self._global_news if isinstance(self._global_news, list) else []
        terms = _query_to_terms(_asset_query(asset_id))
        return self._prepare(rows, query_terms=terms, max_items=max_items, days=days)


class NewsApiProvider:
    def __init__(self, api_key: str) -> None:
        self._api_key = str(api_key).strip()

    async def _search(self, query: str, *, max_items: int, days: int) -> list[dict[str, Any]]:
        if not self._api_key:
            return []
        since = (_utc_now() - timedelta(days=int(max(1, days)))).strftime("%Y-%m-%dT%H:%M:%SZ")
        params = {
            "q": query,
            "language": "en",
            "from": since,
            "sortBy": "relevancy",
            "pageSize": int(max(10, min(50, max_items))),
        }
        payload = await _http_get_json(
            "https://newsapi.org/v2/everything",
            params=params,
            headers={"X-Api-Key": self._api_key},
            timeout_seconds=12.0,
        )
        rows = payload.get("articles", []) if isinstance(payload, dict) else []
        out: list[dict[str, Any]] = []
        for idx, row in enumerate(rows):
            if not isinstance(row, dict):
                continue
            item = _normalize_item(
                title=row.get("title"),
                source=row.get("source"),
                url=row.get("url"),
                published_at=row.get("publishedAt"),
                fallback_age_hours=(idx * 3) + 1,
            )
            if item is None:
                continue
            if not _within_days(item.get("publishedAt"), days):
                continue
            out.append(item)
        return _dedupe_sort_limit(out, max_items)

    async def get_global_news(self, max_items: int = 10, days: int = 5) -> list[dict[str, Any]]:
        query = " OR ".join(f'"{kw}"' for kw in GLOBAL_NEWS_KEYWORDS)
        rows = await self._search(query, max_items=max_items, days=days)
        terms = list(GLOBAL_NEWS_KEYWORDS)
        filtered = [row for row in rows if _contains_terms(row.get("title", ""), terms)]
        return _dedupe_sort_limit(filtered or rows, max_items)

    async def get_asset_news(self, asset_id: str, max_items: int = 10, days: int = 5) -> list[dict[str, Any]]:
        query = _asset_query(asset_id)
        rows = await self._search(query, max_items=max_items, days=days)
        terms = _query_to_terms(query)
        filtered = [row for row in rows if _contains_terms(row.get("title", ""), terms)]
        return _dedupe_sort_limit(filtered or rows, max_items)


class FinnhubProvider:
    def __init__(self, api_key: str) -> None:
        self._api_key = str(api_key).strip()

    async def _general_news(self) -> list[dict[str, Any]]:
        if not self._api_key:
            return []
        payload = await _http_get_json(
            "https://finnhub.io/api/v1/news",
            params={"category": "general", "token": self._api_key},
            timeout_seconds=10.0,
        )
        return payload if isinstance(payload, list) else []

    async def _company_news(self, symbol: str, days: int) -> list[dict[str, Any]]:
        if not self._api_key or not symbol:
            return []
        now = _utc_now()
        frm = (now - timedelta(days=int(max(1, days)))).strftime("%Y-%m-%d")
        to = now.strftime("%Y-%m-%d")
        payload = await _http_get_json(
            "https://finnhub.io/api/v1/company-news",
            params={"symbol": symbol, "from": frm, "to": to, "token": self._api_key},
            timeout_seconds=10.0,
        )
        return payload if isinstance(payload, list) else []

    def _prepare(self, rows: list[dict[str, Any]], *, terms: list[str], max_items: int, days: int) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for idx, row in enumerate(rows):
            if not isinstance(row, dict):
                continue
            title = row.get("headline") or row.get("title")
            desc = row.get("summary") or row.get("description") or ""
            item = _normalize_item(
                title=title,
                source=row.get("source"),
                url=row.get("url"),
                published_at=row.get("datetime"),
                fallback_age_hours=(idx * 3) + 1,
            )
            if item is None:
                continue
            if not _within_days(item.get("publishedAt"), days):
                continue
            if terms and not _contains_terms(f"{item['title']} {desc}", terms):
                continue
            out.append(item)
        return _dedupe_sort_limit(out, max_items)

    async def get_global_news(self, max_items: int = 10, days: int = 5) -> list[dict[str, Any]]:
        rows = await self._general_news()
        return self._prepare(rows, terms=list(GLOBAL_NEWS_KEYWORDS), max_items=max_items, days=days)

    async def get_asset_news(self, asset_id: str, max_items: int = 10, days: int = 5) -> list[dict[str, Any]]:
        aid = str(asset_id or "").lower().strip()
        terms = _query_to_terms(_asset_query(aid))
        symbol = FINNHUB_ASSET_SYMBOL.get(aid, "")
        rows = await self._company_news(symbol, days=days) if symbol else []
        if not rows:
            rows = await self._general_news()
        return self._prepare(rows, terms=terms, max_items=max_items, days=days)


class GNewsProvider:
    def __init__(self, api_key: str) -> None:
        self._api_key = str(api_key).strip()

    async def _search(self, query: str, *, max_items: int, days: int) -> list[dict[str, Any]]:
        if not self._api_key:
            return []
        since = (_utc_now() - timedelta(days=int(max(1, days)))).strftime("%Y-%m-%dT%H:%M:%SZ")
        payload = await _http_get_json(
            "https://gnews.io/api/v4/search",
            params={
                "q": query,
                "lang": "en",
                "from": since,
                "sortby": "relevance",
                "max": int(max(1, min(10, max_items))),
                "apikey": self._api_key,
            },
            timeout_seconds=12.0,
        )
        rows = payload.get("articles", []) if isinstance(payload, dict) else []
        out: list[dict[str, Any]] = []
        for idx, row in enumerate(rows):
            if not isinstance(row, dict):
                continue
            item = _normalize_item(
                title=row.get("title"),
                source=row.get("source"),
                url=row.get("url"),
                published_at=row.get("publishedAt"),
                fallback_age_hours=(idx * 3) + 1,
            )
            if item is None:
                continue
            if not _within_days(item.get("publishedAt"), days):
                continue
            out.append(item)
        return _dedupe_sort_limit(out, max_items)

    async def get_global_news(self, max_items: int = 10, days: int = 5) -> list[dict[str, Any]]:
        query = " OR ".join(f'"{kw}"' for kw in GLOBAL_NEWS_KEYWORDS)
        rows = await self._search(query, max_items=max_items, days=days)
        terms = list(GLOBAL_NEWS_KEYWORDS)
        filtered = [row for row in rows if _contains_terms(row.get("title", ""), terms)]
        return _dedupe_sort_limit(filtered or rows, max_items)

    async def get_asset_news(self, asset_id: str, max_items: int = 10, days: int = 5) -> list[dict[str, Any]]:
        query = _asset_query(asset_id)
        rows = await self._search(query, max_items=max_items, days=days)
        terms = _query_to_terms(query)
        filtered = [row for row in rows if _contains_terms(row.get("title", ""), terms)]
        return _dedupe_sort_limit(filtered or rows, max_items)


class RssNewsProvider:
    def __init__(self) -> None:
        self._google_base = "https://news.google.com/rss/search"

    def _parse_feed(self, text: str, *, fallback_source: str = "") -> list[dict[str, Any]]:
        if not text or "<" not in text:
            return []
        try:
            root = ET.fromstring(text)
        except Exception:
            return []

        rows: list[dict[str, Any]] = []
        channel_title = ""
        ch = root.find(".//channel/title")
        if ch is not None and ch.text:
            channel_title = str(ch.text).strip()
        feed_title = root.find(".//{*}title")
        if not channel_title and feed_title is not None and feed_title.text:
            channel_title = str(feed_title.text).strip()

        for idx, item in enumerate(root.findall(".//item")):
            title = (item.findtext("title") or "").strip()
            link = (item.findtext("link") or "").strip()
            pub = item.findtext("pubDate") or item.findtext("{*}date") or item.findtext("{*}published")
            src = item.findtext("source") or channel_title or fallback_source or _domain(link)
            row = _normalize_item(
                title=title,
                source=src,
                url=link,
                published_at=pub,
                fallback_age_hours=(idx * 2) + 1,
            )
            if row is not None:
                rows.append(row)

        for idx, entry in enumerate(root.findall(".//{*}entry")):
            title = (entry.findtext("{*}title") or "").strip()
            link = ""
            for ln in entry.findall("{*}link"):
                href = str(ln.attrib.get("href") or "").strip()
                rel = str(ln.attrib.get("rel") or "").strip().lower()
                if href and (not link or rel in {"alternate", ""}):
                    link = href
            pub = entry.findtext("{*}published") or entry.findtext("{*}updated") or entry.findtext("{*}date")
            src = (
                entry.findtext("{*}source/{*}title")
                or channel_title
                or fallback_source
                or _domain(link)
            )
            row = _normalize_item(
                title=title,
                source=src,
                url=link,
                published_at=pub,
                fallback_age_hours=(idx * 2) + 1,
            )
            if row is not None:
                rows.append(row)

        return rows

    async def _fetch_feed(self, source_name: str, url: str) -> list[dict[str, Any]]:
        try:
            xml = await _http_get_text(url, timeout_seconds=7.0)
        except Exception:
            return []
        return self._parse_feed(xml, fallback_source=source_name)

    async def _google_search_feed(self, query: str, *, days: int, prefer_domains: bool = True) -> list[dict[str, Any]]:
        q = str(query or "").strip()
        if not q:
            return []
        full_query = f"({q}) when:{max(1, int(days))}d"
        if prefer_domains:
            # Bias toward requested institutional sources.
            domain_scope = " OR ".join(f"site:{dom}" for dom in PREFERRED_NEWS_DOMAINS)
            full_query = f"({q}) ({domain_scope}) when:{max(1, int(days))}d"
        params = {
            "q": full_query,
            "hl": "en-US",
            "gl": "US",
            "ceid": "US:en",
        }
        try:
            xml = await _http_get_text(self._google_base, params=params, timeout_seconds=7.0)
        except Exception:
            return []
        rows = self._parse_feed(xml, fallback_source="Google News")
        # Google News URLs are wrapper links; keep title/source and rely on link as delivered.
        return rows

    async def get_global_news(self, max_items: int = 10, days: int = 5) -> list[dict[str, Any]]:
        terms = list(GLOBAL_NEWS_KEYWORDS)
        query = " OR ".join(f'"{kw}"' for kw in GLOBAL_NEWS_KEYWORDS)

        tasks = [self._fetch_feed(name, url) for name, url in RSS_GLOBAL_FEEDS]
        tasks.append(self._google_search_feed(query, days=days, prefer_domains=True))
        tasks.extend([self._google_search_feed(q, days=days, prefer_domains=True) for q in RSS_TOPIC_QUERIES])
        gathered = await asyncio.gather(*tasks, return_exceptions=True)

        rows: list[dict[str, Any]] = []
        for result in gathered:
            if isinstance(result, Exception) or not isinstance(result, list):
                continue
            for row in result:
                if not isinstance(row, dict):
                    continue
                if not _within_days(row.get("publishedAt"), days):
                    continue
                title = str(row.get("title") or "")
                if terms and not _contains_terms(title, terms):
                    continue
                rows.append(row)
        out = _dedupe_sort_limit(rows, max_items)
        if len(out) >= max_items:
            return out
        # Fallback broader query if preferred-source scope was too narrow.
        fallback = await self._google_search_feed(query, days=days, prefer_domains=False)
        rows.extend(fallback)
        return _dedupe_sort_limit(rows, max_items)

    async def get_asset_news(self, asset_id: str, max_items: int = 10, days: int = 5) -> list[dict[str, Any]]:
        query = _asset_query(asset_id)
        terms = _query_to_terms(query)

        rows = await self._google_search_feed(query, days=days, prefer_domains=True)
        extra_queries = [
            f"{query} Bloomberg Reuters CNBC",
            f"{query} Seeking Alpha Financial Juice",
            f"{query} LiveSquawk breaking",
        ]
        extra = await asyncio.gather(
            *[self._google_search_feed(q, days=days, prefer_domains=True) for q in extra_queries],
            return_exceptions=True,
        )
        for result in extra:
            if isinstance(result, Exception) or not isinstance(result, list):
                continue
            rows.extend([x for x in result if isinstance(x, dict)])
        out: list[dict[str, Any]] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            if not _within_days(row.get("publishedAt"), days):
                continue
            title = str(row.get("title") or "")
            if terms and not _contains_terms(title, terms):
                continue
            out.append(row)
        best = _dedupe_sort_limit(out, max_items)
        if len(best) >= max_items:
            return best
        fallback = await self._google_search_feed(query, days=days, prefer_domains=False)
        for row in fallback:
            if not isinstance(row, dict):
                continue
            if not _within_days(row.get("publishedAt"), days):
                continue
            title = str(row.get("title") or "")
            if terms and not _contains_terms(title, terms):
                continue
            out.append(row)
        return _dedupe_sort_limit(out, max_items)


class GdeltNewsProvider:
    def __init__(self) -> None:
        self._base_url = "https://api.gdeltproject.org/api/v2/doc/doc"

    async def _search(self, query: str, *, max_items: int, days: int) -> list[dict[str, Any]]:
        q = str(query or "").strip()
        if not q:
            return []
        payload = await _http_get_json(
            self._base_url,
            params={
                "query": q,
                "mode": "ArtList",
                "maxrecords": int(max(1, min(50, max_items))),
                "sort": "DateDesc",
                "format": "json",
                "timespan": f"{int(max(1, days))}d",
            },
            timeout_seconds=12.0,
        )
        rows = payload.get("articles", []) if isinstance(payload, dict) else []
        out: list[dict[str, Any]] = []
        for idx, row in enumerate(rows):
            if not isinstance(row, dict):
                continue
            source_name = (
                row.get("source")
                or row.get("domain")
                or row.get("seendate")
                or "GDELT"
            )
            item = _normalize_item(
                title=row.get("title"),
                source=source_name,
                url=row.get("url"),
                published_at=row.get("seendate") or row.get("socialimage") or row.get("date"),
                fallback_age_hours=(idx * 2) + 1,
            )
            if item is None:
                continue
            if not _within_days(item.get("publishedAt"), days):
                continue
            out.append(item)
        return _dedupe_sort_limit(out, max_items)

    async def get_global_news(self, max_items: int = 10, days: int = 5) -> list[dict[str, Any]]:
        query = " OR ".join(f'"{kw}"' for kw in GLOBAL_NEWS_KEYWORDS)
        return await self._search(query, max_items=max_items, days=days)

    async def get_asset_news(self, asset_id: str, max_items: int = 10, days: int = 5) -> list[dict[str, Any]]:
        return await self._search(_asset_query(asset_id), max_items=max_items, days=days)


class LayeredNewsProvider:
    def __init__(self, providers: list[NewsProvider]) -> None:
        self._providers = providers

    async def get_global_news(self, max_items: int = 10, days: int = 5) -> list[dict[str, Any]]:
        tasks = [provider.get_global_news(max_items=max_items, days=days) for provider in self._providers]
        gathered = await asyncio.gather(*tasks, return_exceptions=True)
        merged: list[dict[str, Any]] = []
        for result in gathered:
            if isinstance(result, Exception) or not isinstance(result, list):
                continue
            merged.extend([x for x in result if isinstance(x, dict)])
        return _dedupe_sort_limit(merged, max_items)

    async def get_asset_news(self, asset_id: str, max_items: int = 10, days: int = 5) -> list[dict[str, Any]]:
        tasks = [
            provider.get_asset_news(asset_id=asset_id, max_items=max_items, days=days)
            for provider in self._providers
        ]
        gathered = await asyncio.gather(*tasks, return_exceptions=True)
        merged: list[dict[str, Any]] = []
        for result in gathered:
            if isinstance(result, Exception) or not isinstance(result, list):
                continue
            merged.extend([x for x in result if isinstance(x, dict)])
        return _dedupe_sort_limit(merged, max_items)


_PROVIDER: NewsProvider | None = None


def _env_first(*keys: str) -> str:
    for key in keys:
        value = str(os.getenv(key, "")).strip()
        if value:
            return value
    return ""


def get_news_provider(mock_dir: Path) -> NewsProvider:
    global _PROVIDER
    if _PROVIDER is not None:
        return _PROVIDER

    mode = str(os.getenv("IVQ_NEWS_PROVIDER", "auto")).strip().lower()
    mock = MockNewsProvider(mock_dir)

    news_api_key = _env_first("IVQ_NEWSAPI_KEY", "NEWSAPI_KEY")
    finnhub_key = _env_first("IVQ_FINNHUB_KEY", "FINNHUB_API_KEY")
    gnews_key = _env_first("IVQ_GNEWS_KEY", "GNEWS_API_KEY")
    rss_enabled = str(os.getenv("IVQ_RSS_NEWS_ENABLED", "true")).strip().lower() not in {"0", "false", "off", "no"}
    gdelt_enabled = str(os.getenv("IVQ_GDELT_NEWS_ENABLED", "true")).strip().lower() not in {"0", "false", "off", "no"}

    available: dict[str, NewsProvider] = {}
    if news_api_key:
        available["newsapi"] = NewsApiProvider(news_api_key)
    if finnhub_key:
        available["finnhub"] = FinnhubProvider(finnhub_key)
    if gnews_key:
        available["gnews"] = GNewsProvider(gnews_key)
    if gdelt_enabled:
        available["gdelt"] = GdeltNewsProvider()
    if rss_enabled:
        available["rss"] = RssNewsProvider()

    if mode == "mock":
        _PROVIDER = LayeredNewsProvider([mock])
        return _PROVIDER

    if mode in {"newsapi", "finnhub", "gnews", "gdelt", "rss"}:
        preferred = available.get(mode)
        providers = [preferred, mock] if preferred is not None else [mock]
        _PROVIDER = LayeredNewsProvider([p for p in providers if p is not None])
        return _PROVIDER

    ordered = [available.get("newsapi"), available.get("finnhub"), available.get("gnews"), available.get("gdelt"), available.get("rss"), mock]
    _PROVIDER = LayeredNewsProvider([p for p in ordered if p is not None])
    return _PROVIDER
