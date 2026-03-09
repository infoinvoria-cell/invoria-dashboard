import { promises as fs } from "fs";
import path from "path";

export type EdgeStrategyDirection = "Long" | "Short";

export type EdgeStrategyTrade = {
  id: string;
  timestamp: string;
  symbol: string;
  entryPrice: number;
  exitPrice: number;
  profit: number;
  positionSize: number;
  direction: EdgeStrategyDirection;
  tradeReturnPct: number;
};

export type EdgeStrategyDocument = {
  id: string;
  name: string;
  asset: string;
  source: "tradingview_csv";
  fileName: string;
  createdAt: string;
  updatedAt: string;
  trades: EdgeStrategyTrade[];
};

type StrategyIndexEntry = {
  id: string;
  name: string;
  asset: string;
  fileName: string;
  tradeCount: number;
  createdAt: string;
  updatedAt: string;
};

type StrategyIndexFile = {
  strategies: StrategyIndexEntry[];
};

const STORAGE_DIR = path.join(process.cwd(), "data", "strategies");
const INDEX_PATH = path.join(STORAGE_DIR, "index.json");

function normalizeDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid timestamp: ${value}`);
  }
  return parsed.toISOString();
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function parseNumber(value: string | undefined): number | null {
  if (value == null) return null;
  const normalized = value.replace(/,/g, ".").replace(/[%$€\s]/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }

  result.push(current.trim());
  return result;
}

function getFieldValue(row: Record<string, string>, aliases: string[]): string | undefined {
  for (const alias of aliases) {
    const found = row[alias];
    if (found != null && found !== "") return found;
  }
  return undefined;
}

function deriveDirection(value: string | undefined, index: number): EdgeStrategyDirection {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized.includes("short") || normalized === "sell" || normalized === "-1") return "Short";
  if (normalized.includes("long") || normalized === "buy" || normalized === "1") return "Long";
  return index % 2 === 0 ? "Long" : "Short";
}

function deriveReturnPct(row: Record<string, string>, entryPrice: number, exitPrice: number, direction: EdgeStrategyDirection): number {
  const rawTradeReturn = parseNumber(getFieldValue(row, ["trade_return", "trade return", "return", "return_pct", "trade %"]));
  if (rawTradeReturn != null) {
    return rawTradeReturn;
  }

  if (entryPrice > 0 && exitPrice > 0) {
    const move = direction === "Long" ? (exitPrice - entryPrice) / entryPrice : (entryPrice - exitPrice) / entryPrice;
    return move * 100;
  }

  const profit = parseNumber(getFieldValue(row, ["profit", "net_profit", "net profit", "pnl"])) ?? 0;
  const positionSize = parseNumber(getFieldValue(row, ["position_size", "position size", "contracts", "qty"])) ?? 1;
  const notional = Math.abs(entryPrice * positionSize);
  if (notional > 0) {
    return (profit / notional) * 100;
  }

  return 0;
}

function parseTradingViewCsv(csvContent: string, fileName: string, requestedName?: string): EdgeStrategyDocument {
  const lines = csvContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    throw new Error("CSV file contains no trades.");
  }

  const headers = splitCsvLine(lines[0]).map((header) => header.trim().toLowerCase());
  const rows = lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    return headers.reduce<Record<string, string>>((accumulator, header, index) => {
      accumulator[header] = values[index] ?? "";
      return accumulator;
    }, {});
  });

  const now = new Date().toISOString();
  const trades = rows
    .map((row, index) => {
      const timestampRaw = getFieldValue(row, ["timestamp", "time", "date", "exit_time", "exit time"]);
      if (!timestampRaw) return null;

      const symbol = getFieldValue(row, ["symbol", "ticker", "asset"]) ?? "Unknown";
      const entryPrice = parseNumber(getFieldValue(row, ["entry_price", "entry price", "entry"])) ?? 0;
      const exitPrice = parseNumber(getFieldValue(row, ["exit_price", "exit price", "exit"])) ?? entryPrice;
      const profit = parseNumber(getFieldValue(row, ["profit", "net_profit", "net profit", "pnl"])) ?? 0;
      const positionSize = parseNumber(getFieldValue(row, ["position_size", "position size", "contracts", "qty"])) ?? 1;
      const direction = deriveDirection(getFieldValue(row, ["direction", "side", "position", "signal"]), index);
      const tradeReturnPct = deriveReturnPct(row, entryPrice, exitPrice, direction);

      return {
        id: `${index + 1}`,
        timestamp: normalizeDate(timestampRaw),
        symbol,
        entryPrice,
        exitPrice,
        profit,
        positionSize,
        direction,
        tradeReturnPct,
      } satisfies EdgeStrategyTrade;
    })
    .filter((trade): trade is EdgeStrategyTrade => trade != null)
    .sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());

  if (trades.length === 0) {
    throw new Error("CSV file does not contain valid trades.");
  }

  const inferredAsset = trades[0]?.symbol || "Unknown";
  const baseName = requestedName?.trim() || fileName.replace(/\.[^.]+$/, "");
  const id = `${slugify(baseName || inferredAsset || "strategy")}-${Date.now()}`;

  return {
    id,
    name: baseName || `Strategy ${new Date().toLocaleDateString("en-GB")}`,
    asset: inferredAsset,
    source: "tradingview_csv",
    fileName,
    createdAt: now,
    updatedAt: now,
    trades,
  };
}

async function ensureStorage(): Promise<void> {
  await fs.mkdir(STORAGE_DIR, { recursive: true });
  try {
    await fs.access(INDEX_PATH);
  } catch {
    const emptyIndex: StrategyIndexFile = { strategies: [] };
    await fs.writeFile(INDEX_PATH, JSON.stringify(emptyIndex, null, 2), "utf8");
  }
}

async function readIndex(): Promise<StrategyIndexFile> {
  await ensureStorage();
  const raw = await fs.readFile(INDEX_PATH, "utf8");
  const parsed = JSON.parse(raw) as Partial<StrategyIndexFile>;
  return {
    strategies: Array.isArray(parsed.strategies) ? parsed.strategies : [],
  };
}

async function writeIndex(index: StrategyIndexFile): Promise<void> {
  await ensureStorage();
  await fs.writeFile(INDEX_PATH, JSON.stringify(index, null, 2), "utf8");
}

function strategyFilePath(id: string): string {
  return path.join(STORAGE_DIR, `${id}.json`);
}

function toIndexEntry(strategy: EdgeStrategyDocument): StrategyIndexEntry {
  return {
    id: strategy.id,
    name: strategy.name,
    asset: strategy.asset,
    fileName: strategy.fileName,
    tradeCount: strategy.trades.length,
    createdAt: strategy.createdAt,
    updatedAt: strategy.updatedAt,
  };
}

export async function listEdgeStrategies(): Promise<EdgeStrategyDocument[]> {
  const index = await readIndex();
  const documents = await Promise.all(
    index.strategies.map(async (entry) => {
      try {
        const raw = await fs.readFile(strategyFilePath(entry.id), "utf8");
        return JSON.parse(raw) as EdgeStrategyDocument;
      } catch {
        return null;
      }
    }),
  );

  return documents
    .filter((item): item is EdgeStrategyDocument => item != null)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function saveEdgeStrategyFromCsv(csvContent: string, fileName: string, strategyName?: string): Promise<EdgeStrategyDocument> {
  const strategy = parseTradingViewCsv(csvContent, fileName, strategyName);
  await ensureStorage();
  await fs.writeFile(strategyFilePath(strategy.id), JSON.stringify(strategy, null, 2), "utf8");

  const index = await readIndex();
  index.strategies = [...index.strategies.filter((entry) => entry.id !== strategy.id), toIndexEntry(strategy)];
  await writeIndex(index);

  return strategy;
}

export async function renameEdgeStrategy(id: string, name: string): Promise<EdgeStrategyDocument> {
  const raw = await fs.readFile(strategyFilePath(id), "utf8");
  const strategy = JSON.parse(raw) as EdgeStrategyDocument;
  strategy.name = name.trim() || strategy.name;
  strategy.updatedAt = new Date().toISOString();
  await fs.writeFile(strategyFilePath(id), JSON.stringify(strategy, null, 2), "utf8");

  const index = await readIndex();
  index.strategies = index.strategies.map((entry) =>
    entry.id === id ? { ...entry, name: strategy.name, updatedAt: strategy.updatedAt } : entry,
  );
  await writeIndex(index);
  return strategy;
}

export async function deleteEdgeStrategy(id: string): Promise<void> {
  try {
    await fs.unlink(strategyFilePath(id));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const index = await readIndex();
  index.strategies = index.strategies.filter((entry) => entry.id !== id);
  await writeIndex(index);
}
