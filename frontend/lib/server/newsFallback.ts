import type { NewsItem, NewsResponse } from "@/types";

const NEWS_TTL_MS = 10 * 60 * 1000;
const GOOGLE_RSS_BASE = "https://news.google.com/rss/search";

const GLOBAL_NEWS_KEYWORDS = [
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
];

const PREFERRED_NEWS_DOMAINS = [
  "bloomberg.com",
  "cnn.com",
  "investing.com",
  "reuters.com",
  "cnbc.com",
  "marketwatch.com",
  "finance.yahoo.com",
  "seekingalpha.com",
  "financialjuice.com",
  "ft.com",
  "wsj.com",
];

const RSS_GLOBAL_FEEDS: Array<[string, string]> = [
  ["Bloomberg", "https://feeds.bloomberg.com/markets/news.rss"],
  ["CNN", "https://rss.cnn.com/rss/money_latest.rss"],
  ["CNBC", "https://www.cnbc.com/id/100003114/device/rss/rss.html"],
  ["Financial Times", "https://www.ft.com/rss/home"],
  ["MarketWatch", "https://feeds.content.dowjones.io/public/rss/mw_topstories"],
  ["Reuters", "https://feeds.reuters.com/reuters/businessNews"],
  ["Investing.com", "https://www.investing.com/rss/news_25.rss"],
  ["Seeking Alpha", "https://seekingalpha.com/feed.xml"],
  ["Seeking Alpha Market Currents", "https://seekingalpha.com/market_currents.xml"],
  ["Yahoo Finance", "https://finance.yahoo.com/news/rssindex"],
  ["Financial Juice", "https://www.financialjuice.com/home/rss"],
];

const RSS_TOPIC_QUERIES = [
  "financial juice OR financialjuice macro markets",
  "seeking alpha markets breaking",
  "bloomberg macro risk markets",
  "reuters commodities disruptions",
  "cnbc inflation central bank",
  "breaking headlines macro markets",
];

const ASSET_NEWS_QUERY: Record<string, string> = {
  usd_index: "US dollar index OR DXY OR Fed OR treasury yields",
  eur: "eurozone OR ECB OR euro inflation OR EU growth",
  jpy: "yen OR Bank of Japan OR BOJ policy OR Japan rates",
  gbp: "pound sterling OR Bank of England OR UK inflation",
  chf: "Swiss franc OR SNB OR Switzerland inflation",
  aud: "Australian dollar OR RBA OR Australia inflation OR China demand",
  cad: "Canadian dollar OR Bank of Canada OR crude oil OR Canada inflation",
  nzd: "New Zealand dollar OR RBNZ OR New Zealand inflation",
  gold: "gold OR bullion OR central bank buying",
  silver: "silver OR precious metals demand",
  platinum: "platinum OR autocatalyst demand OR PGM",
  palladium: "palladium OR autocatalyst demand OR PGM",
  aluminum: "aluminum OR aluminium OR smelter OR industrial metals",
  copper: "copper OR China demand",
  oil: "oil OR OPEC OR crude OR supply disruption",
  natgas: "natural gas OR LNG OR gas storage OR pipeline disruption",
  sp500: "US equities OR Fed OR earnings",
  nasdaq100: "tech stocks OR US rates",
  dowjones: "Dow Jones OR industrial stocks OR US macro",
  russell2000: "small caps OR Russell 2000 OR US growth outlook",
  bitcoin: "bitcoin OR crypto regulation OR ETF",
  dax40: "Germany economy OR ECB OR eurozone",
};

type CacheRow = {
  expires: number;
  value: NewsResponse;
};

const cache = new Map<string, CacheRow>();

function nowIso(): string {
  return new Date().toISOString();
}

function parseDate(value: string | undefined): Date | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function withinDays(value: string | undefined, days: number): boolean {
  const parsed = parseDate(value);
  if (!parsed) return false;
  return parsed.getTime() >= Date.now() - (Math.max(1, days) * 24 * 60 * 60 * 1000);
}

function decodeXml(value: string): string {
  return repairMojibake(
    String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">"),
  );
}

function repairMojibake(value: string): string {
  const raw = String(value || "");
  const mapped = raw
    .replace(/â/g, "’")
    .replace(/â/g, "‘")
    .replace(/â/g, "“")
    .replace(/â/g, "”")
    .replace(/â/g, "–")
    .replace(/â/g, "—")
    .replace(/â¦/g, "…")
    .replace(/Â/g, "");
  if (!/[Ââ€œâ€]/.test(mapped)) return mapped;
  try {
    return Buffer.from(mapped, "latin1").toString("utf8");
  } catch {
    return mapped;
  }
}

function stripTags(value: string): string {
  return decodeXml(String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

function extractTag(block: string, tagName: string): string {
  const match = block.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, "i"));
  return stripTags(match?.[1] || "");
}

function extractAttribute(block: string, tagName: string, attr: string): string {
  const match = block.match(new RegExp(`<${tagName}[^>]*\\b${attr}=["']([^"']+)["'][^>]*\\/?>`, "i"));
  return stripTags(match?.[1] || "");
}

function sourceDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function normalizeSource(value: string, url: string): string {
  const explicit = String(value || "").trim();
  if (explicit) return explicit;
  const host = sourceDomain(url);
  return host || "Unknown";
}

function containsTerms(text: string, terms: string[]): boolean {
  if (!terms.length) return true;
  const hay = String(text || "").toLowerCase();
  return terms.some((term) => hay.includes(term));
}

function queryTerms(query: string): string[] {
  return String(query || "")
    .replace(/[()"']/g, " ")
    .split(/\s+OR\s+/i)
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length >= 3);
}

function classifySentiment(text: string): NewsItem["sentiment"] {
  const probe = String(text || "").toLowerCase();
  if (/(surge|beats|bullish|rally|cuts inflation|disinflation|dovish|stimulus|rebound|cools)/.test(probe)) return "Bullish";
  if (/(selloff|bearish|attack|war|sanction|crisis|recession|defaults?|hot inflation|hawkish|collapse|disruption)/.test(probe)) return "Bearish";
  return "Neutral";
}

function classifyCategory(text: string): NewsItem["category"] {
  const probe = String(text || "").toLowerCase();
  if (/(fed|ecb|boj|rates?|inflation|cpi|ppi|central bank)/.test(probe)) return "macro";
  if (/(oil|gas|lng|opec|copper|gold|silver|wheat|corn|coffee|sugar|cocoa)/.test(probe)) return "commodities";
  if (/(war|conflict|attack|sanction|military|border)/.test(probe)) return "geopolitics";
  return "macro";
}

function sourceScore(source: string, url: string): number {
  const hay = `${String(source || "")} ${sourceDomain(url)}`.toLowerCase();
  if (hay.includes("reuters")) return 90;
  if (hay.includes("bloomberg")) return 88;
  if (hay.includes("ft")) return 86;
  if (hay.includes("wsj")) return 85;
  if (hay.includes("cnbc")) return 82;
  if (hay.includes("marketwatch")) return 78;
  if (hay.includes("yahoo")) return 74;
  if (hay.includes("investing")) return 72;
  return 68;
}

function priorityScore(publishedAt: string | undefined, source: string, url: string): number {
  const dt = parseDate(publishedAt);
  const ageHours = dt ? Math.max(0, (Date.now() - dt.getTime()) / (60 * 60 * 1000)) : 72;
  const freshness = Math.max(0, 100 - ageHours * 4);
  return Math.round((freshness * 0.6) + (sourceScore(source, url) * 0.4));
}

function buildNewsItem(row: {
  title: string;
  url: string;
  source: string;
  publishedAt?: string;
  relatedAssets?: string[];
}): NewsItem | null {
  const title = String(row.title || "").trim();
  const url = String(row.url || "").trim();
  if (!title || !url) return null;
  const source = normalizeSource(row.source, url);
  const publishedAt = parseDate(row.publishedAt)?.toISOString() ?? nowIso();
  const combinedText = `${title} ${source}`.trim();
  return {
    newsId: `news:${Math.abs(hashCode(`${title}|${url}`))}`,
    title,
    description: "",
    source,
    url,
    publishedAt,
    timestamp: publishedAt,
    category: classifyCategory(combinedText),
    relatedAssets: row.relatedAssets ?? [],
    sentiment: classifySentiment(combinedText),
    sourceDomain: sourceDomain(url),
    priorityScore: priorityScore(publishedAt, source, url),
  };
}

function hashCode(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

function dedupeAndSort(items: NewsItem[], maxItems: number): NewsItem[] {
  const map = new Map<string, NewsItem>();
  for (const item of items) {
    const key = `${String(item.url || "").trim().toLowerCase()}|${String(item.title || "").trim().toLowerCase()}`;
    if (!key) continue;
    const current = map.get(key);
    if (!current || Number(item.priorityScore ?? 0) > Number(current.priorityScore ?? 0)) {
      map.set(key, item);
    }
  }
  return Array.from(map.values())
    .sort((left, right) => {
      const p = Number(right.priorityScore ?? 0) - Number(left.priorityScore ?? 0);
      if (p !== 0) return p;
      return new Date(String(right.publishedAt || right.timestamp || 0)).getTime()
        - new Date(String(left.publishedAt || left.timestamp || 0)).getTime();
    })
    .slice(0, maxItems);
}

function parseRssFeed(xml: string, fallbackSource: string, relatedAssets: string[] = []): NewsItem[] {
  const text = String(xml || "");
  if (!text.includes("<")) return [];

  const items: NewsItem[] = [];
  const itemMatches = text.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
  for (const block of itemMatches) {
    const title = extractTag(block, "title");
    const link = extractTag(block, "link");
    const publishedAt = extractTag(block, "pubDate") || extractTag(block, "published") || extractTag(block, "updated");
    const source = extractTag(block, "source") || fallbackSource;
    const row = buildNewsItem({ title, url: link, source, publishedAt, relatedAssets });
    if (row) items.push(row);
  }

  const entryMatches = text.match(/<entry\b[\s\S]*?<\/entry>/gi) ?? [];
  for (const block of entryMatches) {
    const title = extractTag(block, "title");
    const link = extractAttribute(block, "link", "href");
    const publishedAt = extractTag(block, "published") || extractTag(block, "updated") || extractTag(block, "date");
    const source = extractTag(block, "source") || fallbackSource;
    const row = buildNewsItem({ title, url: link, source, publishedAt, relatedAssets });
    if (row) items.push(row);
  }

  return items;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
      "user-agent": "Mozilla/5.0",
    },
    cache: "no-store",
    next: { revalidate: 0 },
    signal: AbortSignal.timeout(7000),
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.text();
}

async function fetchFeed(source: string, url: string, relatedAssets: string[] = []): Promise<NewsItem[]> {
  try {
    const xml = await fetchText(url);
    return parseRssFeed(xml, source, relatedAssets);
  } catch {
    return [];
  }
}

async function googleSearchFeed(query: string, days: number, preferDomains: boolean, relatedAssets: string[] = []): Promise<NewsItem[]> {
  const q = String(query || "").trim();
  if (!q) return [];
  const domainScope = PREFERRED_NEWS_DOMAINS.map((domain) => `site:${domain}`).join(" OR ");
  const fullQuery = preferDomains
    ? `(${q}) (${domainScope}) when:${Math.max(1, days)}d`
    : `(${q}) when:${Math.max(1, days)}d`;
  const url = new URL(GOOGLE_RSS_BASE);
  url.searchParams.set("q", fullQuery);
  url.searchParams.set("hl", "en-US");
  url.searchParams.set("gl", "US");
  url.searchParams.set("ceid", "US:en");
  return fetchFeed("Google News", url.toString(), relatedAssets);
}

function filterByRecencyAndTerms(items: NewsItem[], days: number, terms: string[]): NewsItem[] {
  return items.filter((item) => {
    if (!withinDays(item.publishedAt || item.timestamp, days)) return false;
    return containsTerms(item.title, terms);
  });
}

function assetQuery(assetId: string): string {
  const key = String(assetId || "").trim().toLowerCase();
  return ASSET_NEWS_QUERY[key] || key.replace(/[_-]+/g, " ");
}

async function getGlobalNewsFresh(maxItems = 10, days = 2): Promise<NewsResponse | null> {
  const terms = [...GLOBAL_NEWS_KEYWORDS];
  const query = GLOBAL_NEWS_KEYWORDS.map((keyword) => `"${keyword}"`).join(" OR ");

  const gathered = await Promise.allSettled([
    ...RSS_GLOBAL_FEEDS.map(([source, url]) => fetchFeed(source, url)),
    googleSearchFeed(query, days, true),
    ...RSS_TOPIC_QUERIES.map((topic) => googleSearchFeed(topic, days, true)),
  ]);

  const rows: NewsItem[] = [];
  for (const result of gathered) {
    if (result.status !== "fulfilled") continue;
    rows.push(...filterByRecencyAndTerms(result.value, days, terms));
  }

  let picked = dedupeAndSort(rows, maxItems);
  if (picked.length < maxItems) {
    const fallback = await googleSearchFeed(query, days, false);
    picked = dedupeAndSort([...rows, ...filterByRecencyAndTerms(fallback, days, terms)], maxItems);
  }

  return picked.length
    ? { updatedAt: nowIso(), items: picked }
    : null;
}

async function getAssetNewsFresh(assetId: string, maxItems = 10, days = 2): Promise<NewsResponse | null> {
  const query = assetQuery(assetId);
  const terms = queryTerms(query);
  const relatedAssets = [String(assetId || "").toUpperCase()];

  const gathered = await Promise.allSettled([
    googleSearchFeed(query, days, true, relatedAssets),
    googleSearchFeed(`${query} Bloomberg Reuters CNBC`, days, true, relatedAssets),
    googleSearchFeed(`${query} Seeking Alpha Financial Juice`, days, true, relatedAssets),
  ]);

  const rows: NewsItem[] = [];
  for (const result of gathered) {
    if (result.status !== "fulfilled") continue;
    rows.push(...filterByRecencyAndTerms(result.value, days, terms));
  }

  let picked = dedupeAndSort(rows, maxItems);
  if (picked.length < maxItems) {
    const fallback = await googleSearchFeed(query, days, false, relatedAssets);
    picked = dedupeAndSort([...rows, ...filterByRecencyAndTerms(fallback, days, terms)], maxItems);
  }

  return picked.length
    ? { updatedAt: nowIso(), items: picked }
    : null;
}

export async function getFallbackGlobalNews(): Promise<NewsResponse | null> {
  const key = "global";
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;
  const fresh = await getGlobalNewsFresh();
  if (!fresh) return null;
  cache.set(key, { expires: Date.now() + NEWS_TTL_MS, value: fresh });
  return fresh;
}

export async function getFallbackAssetNews(assetId: string): Promise<NewsResponse | null> {
  const key = `asset:${String(assetId || "").trim().toLowerCase()}`;
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;
  const fresh = await getAssetNewsFresh(assetId);
  if (!fresh) return null;
  cache.set(key, { expires: Date.now() + NEWS_TTL_MS, value: fresh });
  return fresh;
}
