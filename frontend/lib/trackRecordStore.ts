import { promises as fs } from "fs";
import path from "path";

import type { TrackRecordTradeInput, TradeDirection } from "@/components/track-record/metrics";

const ROOT_CANDIDATES = Array.from(
  new Set([
    process.cwd(),
    path.join(process.cwd(), "frontend"),
  ]),
);

const HISTORICAL_DATASET_RELATIVE_PATHS = [
  path.join("data", "track-record", "trades_clean_compounded.csv"),
  path.join("public", "track-record", "trades_clean_compounded.csv"),
];

const APPENDED_DATASET_RELATIVE_PATHS = [
  path.join("data", "track-record", "trades_appended_api.json"),
  path.join("public", "track-record", "trades_appended_api.json"),
];

type StoredTrade = {
  date: string;
  return_pct: number;
  trade_result: number;
  trade_direction: TradeDirection;
  source: "api";
};

function buildCandidatePaths(relativePaths: string[]): string[] {
  const candidates: string[] = [];

  for (const root of ROOT_CANDIDATES) {
    for (const relativePath of relativePaths) {
      candidates.push(path.join(root, relativePath));
    }
  }

  return Array.from(new Set(candidates));
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveExistingPath(relativePaths: string[]): Promise<string | null> {
  const candidates = buildCandidatePaths(relativePaths);

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function resolveWritablePath(relativePaths: string[]): Promise<string> {
  const candidates = buildCandidatePaths(relativePaths);

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  for (const candidate of candidates) {
    if (await fileExists(path.dirname(candidate))) {
      return candidate;
    }
  }

  return candidates[0];
}

function parseCsvRow(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === "\"") {
      if (inQuotes && line[index + 1] === "\"") {
        current += "\"";
        index += 1;
        continue;
      }

      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
}

function normalizeHeader(value: string): string {
  return value.replace(/^\uFEFF/, "").trim().toLowerCase();
}

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

function tradeKey(
  trade: Pick<TrackRecordTradeInput, "date" | "return_pct" | "trade_result" | "trade_direction">
): string {
  return [
    new Date(trade.date).toISOString(),
    Number(trade.return_pct).toFixed(4),
    Number(trade.trade_result ?? trade.return_pct).toFixed(4),
    trade.trade_direction ?? "",
  ].join("|");
}

export async function loadHistoricalTrackRecordTrades(): Promise<TrackRecordTradeInput[]> {
  const historicalPath = await resolveExistingPath(HISTORICAL_DATASET_RELATIVE_PATHS);

  if (!historicalPath) {
    console.error("TRACK RECORD CSV ERROR: historical dataset not found", {
      cwd: process.cwd(),
      candidates: buildCandidatePaths(HISTORICAL_DATASET_RELATIVE_PATHS),
    });
    return [];
  }

  try {
    const content = await fs.readFile(historicalPath, "utf8");

    const lines = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length <= 1) return [];

    const header = parseCsvRow(lines[0]).map(normalizeHeader);
    const closeDateIndex = header.indexOf("close date");
    const gainIndex = header.indexOf("gain (%)");

    if (closeDateIndex === -1 || gainIndex === -1) {
      console.error("TRACK RECORD CSV ERROR: required headers missing", {
        path: historicalPath,
        header,
      });
      return [];
    }

    const trades: TrackRecordTradeInput[] = [];

    lines.slice(1).forEach((line, index) => {
      const columns = parseCsvRow(line);
      const closeDate = columns[closeDateIndex];
      const gainValue = columns[gainIndex];
      const returnPct = Number.parseFloat(gainValue);

      if (!closeDate || !Number.isFinite(returnPct)) {
        return;
      }

      try {
        const date = normalizeDate(closeDate);

        trades.push({
          date,
          return_pct: returnPct,
          trade_result: returnPct,
          trade_direction: deriveDirection(date, index),
          source: "historical",
        });
      } catch {
        return;
      }
    });

    return trades.sort(
      (left, right) =>
        new Date(left.date).getTime() - new Date(right.date).getTime()
    );
  } catch (error) {
    console.error("TRACK RECORD CSV ERROR:", {
      path: historicalPath,
      error,
    });
    return [];
  }
}

export async function loadAppendedTrackRecordTrades(): Promise<StoredTrade[]> {
  const appendedPath = await resolveExistingPath(APPENDED_DATASET_RELATIVE_PATHS);

  if (!appendedPath) {
    return [];
  }

  try {
    const raw = await fs.readFile(appendedPath, "utf8");
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
      .sort(
        (left, right) =>
          new Date(left.date).getTime() - new Date(right.date).getTime()
      );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    console.error("APPENDED TRACK RECORD ERROR:", {
      path: appendedPath,
      error,
    });
    return [];
  }
}

export async function loadTrackRecordTrades(): Promise<TrackRecordTradeInput[]> {
  const historical = await loadHistoricalTrackRecordTrades();
  const appended = await loadAppendedTrackRecordTrades();

  return [...historical, ...appended].sort(
    (left, right) =>
      new Date(left.date).getTime() - new Date(right.date).getTime()
  );
}

export async function appendTrackRecordTrades(
  input: TrackRecordTradeInput | TrackRecordTradeInput[]
): Promise<TrackRecordTradeInput[]> {
  const trades = Array.isArray(input) ? input : [input];

  const historical = await loadHistoricalTrackRecordTrades();

  const historicalEndDate =
    historical.length > 0
      ? new Date(historical[historical.length - 1].date).getTime()
      : null;

  const existingAppended = await loadAppendedTrackRecordTrades();

  const normalized = trades.map((trade, index) => {
    const date = normalizeDate(trade.date);

    const timestamp = new Date(date).getTime();

    if (historicalEndDate != null && timestamp <= historicalEndDate) {
      throw new Error(
        "Appended trades must be later than the historical dataset end date."
      );
    }

    const returnPct = Number(trade.return_pct);

    if (!Number.isFinite(returnPct)) {
      throw new Error(`Invalid return_pct: ${trade.return_pct}`);
    }

    const tradeDirection =
      trade.trade_direction === "Long" || trade.trade_direction === "Short"
        ? trade.trade_direction
        : deriveDirection(date, existingAppended.length + index);

    return {
      date,
      return_pct: Number(returnPct),
      trade_result: Number.isFinite(Number(trade.trade_result))
        ? Number(trade.trade_result)
        : Number(returnPct),
      trade_direction: tradeDirection,
      source: "api" as const,
    } satisfies StoredTrade;
  });

  const merged = [...existingAppended, ...normalized];

  const deduped = Array.from(
    new Map(merged.map((trade) => [tradeKey(trade), trade])).values()
  ).sort(
    (left, right) =>
      new Date(left.date).getTime() - new Date(right.date).getTime()
  );

  const payload = JSON.stringify(deduped, null, 2);
  const primaryAppendedPath = await resolveWritablePath(APPENDED_DATASET_RELATIVE_PATHS);

  await fs.mkdir(path.dirname(primaryAppendedPath), { recursive: true });
  await fs.writeFile(primaryAppendedPath, payload, "utf8");

  const publicFallbackPath = buildCandidatePaths([path.join("public", "track-record", "trades_appended_api.json")])
    .find((candidate) => candidate !== primaryAppendedPath);

  if (publicFallbackPath && await fileExists(path.dirname(publicFallbackPath))) {
    await fs.writeFile(publicFallbackPath, payload, "utf8");
  }

  return [...historical, ...deduped].sort(
    (left, right) =>
      new Date(left.date).getTime() - new Date(right.date).getTime()
  );
}

export async function getHistoricalTrackRecordEndDate(): Promise<string | null> {
  const historical = await loadHistoricalTrackRecordTrades();

  return historical.length > 0
    ? historical[historical.length - 1].date
    : null;
}
