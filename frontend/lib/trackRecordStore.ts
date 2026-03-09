import { promises as fs } from "fs";
import path from "path";

import type { TrackRecordTradeInput, TradeDirection } from "@/components/track-record/metrics";

const TRACK_RECORD_DATA_DIR = path.join(process.cwd(), "data", "track-record");
const HISTORICAL_DATASET_PATH = path.join(TRACK_RECORD_DATA_DIR, "trades_clean_compounded.csv");
const APPENDED_DATASET_SEED_PATH = path.join(TRACK_RECORD_DATA_DIR, "trades_appended_api.json");
const APPENDED_DATASET_PATH = process.env.VERCEL
  ? path.join("/tmp", "trades_appended_api.json")
  : APPENDED_DATASET_SEED_PATH;

type StoredTrade = {
  date: string;
  return_pct: number;
  trade_result: number;
  trade_direction: TradeDirection;
  source: "api";
};

function normalizeDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid trade date: ${value}`);
  }
  return parsed.toISOString();
}

function deriveDirection(seed: string, index: number): TradeDirection {
  let hash = 7;
  const value = `${seed}-${index}`;
  for (let cursor = 0; cursor < value.length; cursor += 1) {
    hash = (hash * 31 + value.charCodeAt(cursor)) % 100_003;
  }
  return hash % 100 < 51 ? "Long" : "Short";
}

function tradeKey(trade: Pick<TrackRecordTradeInput, "date" | "return_pct" | "trade_result" | "trade_direction">): string {
  return [
    new Date(trade.date).toISOString(),
    Number(trade.return_pct).toFixed(4),
    Number(trade.trade_result ?? trade.return_pct).toFixed(4),
    trade.trade_direction ?? "",
  ].join("|");
}

export async function loadHistoricalTrackRecordTrades(): Promise<TrackRecordTradeInput[]> {
  const content = await fs.readFile(HISTORICAL_DATASET_PATH, "utf8");
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length <= 1) return [];

  return lines.slice(1).map((line, index) => {
    const [closeDate, gainValue] = line.split(",");
    const returnPct = Number.parseFloat(gainValue);

    return {
      date: normalizeDate(closeDate),
      return_pct: returnPct,
      trade_result: returnPct,
      trade_direction: deriveDirection(closeDate, index),
      source: "historical",
    } satisfies TrackRecordTradeInput;
  });
}

export async function loadAppendedTrackRecordTrades(): Promise<StoredTrade[]> {
  try {
    const raw = await fs.readFile(APPENDED_DATASET_PATH, "utf8");
    return parseStoredTrades(raw);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      if (APPENDED_DATASET_PATH !== APPENDED_DATASET_SEED_PATH) {
        try {
          const fallbackRaw = await fs.readFile(APPENDED_DATASET_SEED_PATH, "utf8");
          return parseStoredTrades(fallbackRaw);
        } catch (fallbackError) {
          if ((fallbackError as NodeJS.ErrnoException).code === "ENOENT") {
            return [];
          }
          throw fallbackError;
        }
      }
      return [];
    }
    throw error;
  }
}

export async function loadTrackRecordTrades(): Promise<TrackRecordTradeInput[]> {
  const historical = await loadHistoricalTrackRecordTrades();
  const appended = await loadAppendedTrackRecordTrades();
  return [...historical, ...appended].sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime());
}

export async function appendTrackRecordTrades(input: TrackRecordTradeInput | TrackRecordTradeInput[]): Promise<TrackRecordTradeInput[]> {
  const trades = Array.isArray(input) ? input : [input];
  const historical = await loadHistoricalTrackRecordTrades();
  const historicalEndDate = historical.length > 0 ? new Date(historical[historical.length - 1].date).getTime() : null;
  const existingAppended = await loadAppendedTrackRecordTrades();

  const normalized = trades.map((trade, index) => {
    const date = normalizeDate(trade.date);
    const timestamp = new Date(date).getTime();
    if (historicalEndDate != null && timestamp <= historicalEndDate) {
      throw new Error("Appended trades must be later than the historical dataset end date.");
    }

    const returnPct = Number(trade.return_pct);
    if (!Number.isFinite(returnPct)) {
      throw new Error(`Invalid return_pct for appended trade: ${trade.return_pct}`);
    }

    const tradeDirection =
      trade.trade_direction === "Long" || trade.trade_direction === "Short"
        ? trade.trade_direction
        : deriveDirection(date, existingAppended.length + index);

    return {
      date,
      return_pct: Number(returnPct),
      trade_result: Number.isFinite(Number(trade.trade_result)) ? Number(trade.trade_result) : Number(returnPct),
      trade_direction: tradeDirection,
      source: "api" as const,
    } satisfies StoredTrade;
  });

  const merged = [...existingAppended, ...normalized];
  const deduped = Array.from(new Map(merged.map((trade) => [tradeKey(trade), trade])).values()).sort(
    (left, right) => new Date(left.date).getTime() - new Date(right.date).getTime(),
  );

  await fs.writeFile(APPENDED_DATASET_PATH, JSON.stringify(deduped, null, 2), "utf8");
  return [...historical, ...deduped].sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime());
}

export async function getHistoricalTrackRecordEndDate(): Promise<string | null> {
  const historical = await loadHistoricalTrackRecordTrades();
  return historical.length > 0 ? historical[historical.length - 1].date : null;
}

function parseStoredTrades(raw: string): StoredTrade[] {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];

  return parsed
    .map((item, index) => {
      const date = normalizeDate(String(item?.date ?? ""));
      const returnPct = Number(item?.return_pct);
      if (!Number.isFinite(returnPct)) return null;

      return {
        date,
        return_pct: Number(returnPct),
        trade_result: Number.isFinite(Number(item?.trade_result))
          ? Number(item.trade_result)
          : Number(returnPct),
        trade_direction:
          item?.trade_direction === "Long" || item?.trade_direction === "Short"
            ? item.trade_direction
            : deriveDirection(date, index),
        source: "api" as const,
      };
    })
    .filter((item): item is StoredTrade => item != null)
    .sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime());
}
