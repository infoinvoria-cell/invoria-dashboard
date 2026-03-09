import type { DatasetObservation, DatasetOption } from "@/components/monte-carlo/types";

function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createNormal(rng: () => number): () => number {
  return () => {
    const u1 = Math.max(rng(), 1e-9);
    const u2 = Math.max(rng(), 1e-9);
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };
}

function buildSeries(
  seed: number,
  name: string,
  description: string,
  kind: DatasetOption["kind"],
  sourceGroup: DatasetOption["sourceGroup"],
  drift: number,
  volatility: number,
  signalBias: number,
): DatasetOption {
  const rng = createRng(seed);
  const normal = createNormal(rng);
  const observations: DatasetObservation[] = [];
  let close = 100;
  const startDate = new Date("2024-01-02T00:00:00Z");

  for (let index = 0; index < 360; index += 1) {
    const date = new Date(startDate.getTime() + index * 86400000);
    const cyclical = Math.sin(index / 18) * 0.0022 + Math.cos(index / 51) * 0.0016;
    const regimeShift = index > 180 ? 0.00018 : -0.00005;
    const dailyReturn = drift + cyclical + regimeShift + normal() * volatility;
    const signalRaw = Math.sin(index / 13) + Math.cos(index / 29) * 0.6 + signalBias;
    const signal = signalRaw > 0.4 ? 1 : signalRaw < -0.35 ? -1 : 0;
    const strategyReturn = signal === 0 ? dailyReturn * 0.12 : dailyReturn * (signal > 0 ? 1.15 : -0.82);
    const open = close;
    close = Math.max(18, close * (1 + dailyReturn));
    const high = Math.max(open, close) * (1 + rng() * 0.012);
    const low = Math.min(open, close) * (1 - rng() * 0.012);
    const volume = Math.round(850000 + rng() * 2400000);

    observations.push({
      date: date.toISOString().slice(0, 10),
      open,
      high,
      low,
      close,
      volume,
      returns: dailyReturn,
      signal,
      strategyReturn,
    });
  }

  return {
    id: name.toLowerCase().replace(/\s+/g, "-"),
    name,
    description,
    kind,
    sourceGroup,
    observations,
  };
}

export const MOCK_DATASETS: DatasetOption[] = [
  buildSeries(
    11,
    "Historical Market Basket",
    "Historische Marktdaten mit diversifiziertem Macro-Beta und moderatem Signal-Overlay.",
    "market",
    "Marktdaten",
    0.00046,
    0.0108,
    0.06,
  ),
  buildSeries(
    29,
    "Strategy Simulation Data",
    "Strategie-Simulationsdaten mit Trendpersistenz und defensiven Short-Phasen.",
    "strategy",
    "Strategie",
    0.00061,
    0.0124,
    0.22,
  ),
  buildSeries(
    77,
    "Screener Momentum Signals",
    "Screener-Signale transformiert in Strategie-Renditen zur Robustheitsprüfung.",
    "screener",
    "Strategie",
    0.00038,
    0.0142,
    -0.04,
  ),
];
