import { useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type LogicalRange,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
  createSeriesMarkers,
  createChart,
} from "lightweight-charts";

import { GlobeApi } from "../../../lib/api";
import { getSeasonDirection, normalizedSeasonalityCurve, seasonTone } from "../../../lib/seasonality";
import type { EvaluationResponse, SeasonalityResponse, TimeseriesResponse } from "../../../types";

type Props = {
  payload: TimeseriesResponse | null;
  evaluation?: EvaluationResponse | null;
  seasonality?: SeasonalityResponse | null;
  dataSource?: "tradingview" | "dukascopy" | "yahoo";
  title?: string;
  sourceLabel?: string;
  goldThemeEnabled?: boolean;
  themePrimary?: string;
  isPanelLoading?: boolean;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  loopReplayTick?: number;
  onTimeRangeChange?: (range: { visibleSpan: number; rightOffset: number } | null) => void;
  onRecentSignalChange?: (signal: { direction: "bullish" | "bearish"; lines: string[]; ageBars: number } | null) => void;
};

type ZoneRect = {
  kind: "demand" | "supply";
  left: number;
  width: number;
  top: number;
  height: number;
  fill: string;
  border: string;
};

type CandleBar = { time: UTCTimestamp; open: number; high: number; low: number; close: number };

type EvalFlags = { over: boolean; under: boolean };

type ZoneRuntime = {
  start: number;
  end: number;
  low: number;
  high: number;
};

type TimeframeKey = "M" | "W" | "D" | "4H" | "1H";
type ContinuousMode = "regular" | "backadjusted";

const VAL_HIGH = 75;
const VAL_LOW = -75;
const SIGNAL_LOOKBACK = 2;
const TIMEFRAME_BARS: Record<TimeframeKey, number> = {
  M: 100,
  W: 100,
  D: 100,
  "4H": 100,
  "1H": 100,
};

const TF_SECONDS_FALLBACK: Record<TimeframeKey, number> = {
  M: 30 * 24 * 60 * 60,
  W: 7 * 24 * 60 * 60,
  D: 24 * 60 * 60,
  "4H": 4 * 60 * 60,
  "1H": 60 * 60,
};

function overlap1d(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

function resolveZoneOverlaps(input: ZoneRect[], heightLimit: number): ZoneRect[] {
  if (!input.length) return [];

  const merged: ZoneRect[] = [];
  const sameKind = [...input].sort((a, b) => (a.kind === b.kind ? a.top - b.top : a.kind.localeCompare(b.kind)));
  for (const zone of sameKind) {
    const right = zone.left + zone.width;
    const bottom = zone.top + zone.height;
    const target = merged.find((m) => {
      if (m.kind !== zone.kind) return false;
      const mRight = m.left + m.width;
      const mBottom = m.top + m.height;
      const xOverlap = overlap1d(zone.left, right, m.left, mRight);
      const yOverlap = overlap1d(zone.top, bottom, m.top, mBottom);
      const minX = Math.max(1, Math.min(zone.width, m.width));
      const minY = Math.max(1, Math.min(zone.height, m.height));
      return xOverlap / minX > 0.35 && yOverlap / minY > 0.35;
    });

    if (!target) {
      merged.push({ ...zone });
      continue;
    }

    const targetRight = target.left + target.width;
    const targetBottom = target.top + target.height;
    const nextLeft = Math.min(target.left, zone.left);
    const nextRight = Math.max(targetRight, right);
    const nextTop = Math.min(target.top, zone.top);
    const nextBottom = Math.max(targetBottom, bottom);
    target.left = nextLeft;
    target.width = Math.max(4, nextRight - nextLeft);
    target.top = Math.max(0, nextTop);
    target.height = Math.max(1, Math.min(heightLimit, nextBottom) - target.top);
  }

  // If supply and demand still collide, separate them slightly for readability.
  for (let i = 0; i < merged.length; i += 1) {
    for (let j = i + 1; j < merged.length; j += 1) {
      const a = merged[i];
      const b = merged[j];
      if (a.kind === b.kind) continue;
      const ax1 = a.left + a.width;
      const ay1 = a.top + a.height;
      const bx1 = b.left + b.width;
      const by1 = b.top + b.height;
      const xOverlap = overlap1d(a.left, ax1, b.left, bx1);
      const yOverlap = overlap1d(a.top, ay1, b.top, by1);
      const minArea = Math.max(1, Math.min(a.width * a.height, b.width * b.height));
      const overlapArea = xOverlap * yOverlap;
      if (overlapArea / minArea < 0.22) continue;

      const shift = 5;
      if (a.kind === "supply") {
        a.top = Math.max(0, a.top - shift);
      } else {
        a.top = Math.min(Math.max(0, heightLimit - a.height), a.top + shift);
      }
      if (b.kind === "supply") {
        b.top = Math.max(0, b.top - shift);
      } else {
        b.top = Math.min(Math.max(0, heightLimit - b.height), b.top + shift);
      }
    }
  }

  return merged;
}

function toTs(value: string): UTCTimestamp {
  return Math.floor(new Date(value).getTime() / 1000) as UTCTimestamp;
}

function hexToRgba(hex: string, alpha: number): string {
  const clean = String(hex || "").replace("#", "");
  const norm = clean.length === 3
    ? clean.split("").map((c) => `${c}${c}`).join("")
    : clean.padEnd(6, "0").slice(0, 6);
  const r = parseInt(norm.slice(0, 2), 16);
  const g = parseInt(norm.slice(2, 4), 16);
  const b = parseInt(norm.slice(4, 6), 16);
  const rr = Number.isFinite(r) ? r : 77;
  const gg = Number.isFinite(g) ? g : 135;
  const bb = Number.isFinite(b) ? b : 254;
  return `rgba(${rr},${gg},${bb},${Math.max(0, Math.min(1, alpha))})`;
}

function isCoreValuationLabel(label: string): boolean {
  const l = String(label || "").toLowerCase();
  if (l.includes("asset") || l.includes("combined")) return true;
  if (l.includes("gold")) return true;
  if (l.includes("dollar") || l.includes("dxy") || l.includes("usd")) return true;
  if (l.includes("10y") || l.includes("bond") || l.includes("anleihe")) return true;
  return false;
}

function buildEvalFlagsMap(evaluation: EvaluationResponse | null): Map<number, EvalFlags> {
  const map = new Map<number, EvalFlags>();
  if (!evaluation?.series?.length) return map;

  for (const row of evaluation.series) {
    if (!isCoreValuationLabel(row.label)) continue;
    for (const pt of row.points ?? []) {
      const values = [pt.v10, pt.v20]
        .map((v) => Number(v))
        .filter((v) => Number.isFinite(v));
      if (!values.length) continue;
      const ts = Number(toTs(pt.t));
      const current = map.get(ts) ?? { over: false, under: false };
      if (values.some((v) => v > VAL_HIGH)) current.over = true;
      if (values.some((v) => v < VAL_LOW)) current.under = true;
      map.set(ts, current);
    }
  }
  return map;
}

function buildZoneRuntime(zones: Array<{ start: string; end: string; low: number; high: number }>): ZoneRuntime[] {
  return zones
    .map((z) => {
      const start = Number(toTs(String(z.start)));
      const end = Number(toTs(String(z.end)));
      const low = Number(z.low);
      const high = Number(z.high);
      if (![start, end, low, high].every(Number.isFinite)) return null;
      return {
        start: Math.min(start, end),
        end: Math.max(start, end),
        low: Math.min(low, high),
        high: Math.max(low, high),
      };
    })
    .filter((z): z is ZoneRuntime => z !== null);
}

function touchesAnyZone(bar: CandleBar, zones: ZoneRuntime[]): boolean {
  const t = Number(bar.time);
  for (const z of zones) {
    if (t < z.start || t > z.end) continue;
    if (bar.high >= z.low && bar.low <= z.high) return true;
  }
  return false;
}

function buildSignalMarkers(
  bars: CandleBar[],
  evaluation: EvaluationResponse | null,
  demandZones: ZoneRuntime[],
  supplyZones: ZoneRuntime[],
): SeriesMarker<Time>[] {
  if (!bars.length) return [];
  const evalFlags = buildEvalFlagsMap(evaluation);
  if (!evalFlags.size) return [];

  const overAt = bars.map((bar) => Boolean(evalFlags.get(Number(bar.time))?.over));
  const underAt = bars.map((bar) => Boolean(evalFlags.get(Number(bar.time))?.under));
  const demandTouchAt = bars.map((bar) => touchesAnyZone(bar, demandZones));
  const supplyTouchAt = bars.map((bar) => touchesAnyZone(bar, supplyZones));

  const markers: SeriesMarker<Time>[] = [];
  let prevSell = false;
  let prevBuy = false;

  for (let i = 0; i < bars.length; i += 1) {
    const from = Math.max(0, i - SIGNAL_LOOKBACK);
    let overRecent = false;
    let underRecent = false;
    let demandRecent = false;
    let supplyRecent = false;
    for (let j = from; j <= i; j += 1) {
      overRecent = overRecent || overAt[j];
      underRecent = underRecent || underAt[j];
      demandRecent = demandRecent || demandTouchAt[j];
      supplyRecent = supplyRecent || supplyTouchAt[j];
    }

    const sellActive = overRecent && supplyRecent;
    const buyActive = underRecent && demandRecent;

    if (sellActive && !prevSell) {
      markers.push({
        time: bars[i].time,
        position: "aboveBar",
        shape: "arrowDown",
        color: "#ff384c",
      });
    }
    if (buyActive && !prevBuy) {
      markers.push({
        time: bars[i].time,
        position: "belowBar",
        shape: "arrowUp",
        color: "#39ff40",
      });
    }

    prevSell = sellActive;
    prevBuy = buyActive;
  }

  return markers.slice(-120);
}

function seasonHorizonDays(seasonality?: SeasonalityResponse | null): number {
  const horizonRaw = Number(seasonality?.stats?.bestHorizonDays ?? seasonality?.projectionDays ?? 20);
  return Math.max(1, Math.min(60, Number.isFinite(horizonRaw) ? Math.round(horizonRaw) : 20));
}

function inferBarStepSeconds(timeframe: TimeframeKey, bars: CandleBar[]): number {
  const fallback = TF_SECONDS_FALLBACK[timeframe] ?? (24 * 60 * 60);
  if (bars.length < 4) return fallback;
  const diffs: number[] = [];
  const start = Math.max(1, bars.length - 64);
  for (let i = start; i < bars.length; i += 1) {
    const d = Number(bars[i].time) - Number(bars[i - 1].time);
    if (Number.isFinite(d) && d > 0) diffs.push(d);
  }
  if (!diffs.length) return fallback;
  diffs.sort((a, b) => a - b);
  const mid = Math.floor(diffs.length / 2);
  const median = diffs.length % 2 ? diffs[mid] : (diffs[mid - 1] + diffs[mid]) / 2;
  return Number.isFinite(median) && median > 0 ? median : fallback;
}

function interpolateCurvePct(curve: Array<{ x: number; y: number }>, dayX: number): number {
  if (!curve.length) return 0;
  if (dayX <= curve[0].x) return Number(curve[0].y) || 0;
  for (let i = 1; i < curve.length; i += 1) {
    const a = curve[i - 1];
    const b = curve[i];
    if (dayX <= b.x) {
      const ax = Number(a.x);
      const bx = Number(b.x);
      const ay = Number(a.y);
      const by = Number(b.y);
      const dx = bx - ax;
      if (!Number.isFinite(dx) || Math.abs(dx) < 1e-9) return Number.isFinite(by) ? by : 0;
      const t = (dayX - ax) / dx;
      return ay + (by - ay) * t;
    }
  }
  return Number(curve[curve.length - 1].y) || 0;
}

function buildSeasonProjection(
  bars: CandleBar[],
  timeframe: TimeframeKey,
  seasonality?: SeasonalityResponse | null,
): Array<{ time: UTCTimestamp; value: number }> {
  if (!bars.length || !seasonality) return [];
  const last = bars[bars.length - 1];
  const horizon = seasonHorizonDays(seasonality);
  const stepSec = Math.max(60, Math.round(inferBarStepSeconds(timeframe, bars)));
  if (!Number.isFinite(last.close) || last.close <= 0) return [];

  const curve = normalizedSeasonalityCurve(seasonality);
  const maxSec = horizon * 24 * 60 * 60;

  const points: Array<{ time: UTCTimestamp; value: number }> = [];
  if (!curve.length) {
    const avgReturnPct = Number(seasonality.stats?.avgReturn20d ?? 0);
    if (!Number.isFinite(avgReturnPct)) return [];
    const steps = Math.max(1, Math.ceil(maxSec / stepSec));
    for (let k = 0; k <= steps; k += 1) {
      const elapsedSec = Math.min(maxSec, k * stepSec);
      const t = (Number(last.time) + elapsedSec) as UTCTimestamp;
      const ratio = maxSec > 0 ? elapsedSec / maxSec : 0;
      const pct = avgReturnPct * ratio;
      const v = Number(last.close) * (1 + pct / 100);
      if (Number.isFinite(v)) points.push({ time: t, value: v });
    }
    return points;
  }

  const usable = curve
    .filter((p) => Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)))
    .map((p) => ({ x: Number(p.x), y: Number(p.y) }))
    .filter((p) => p.x >= 0 && p.x <= horizon)
    .sort((a, b) => a.x - b.x);
  if (!usable.length) return [];

  const steps = Math.max(1, Math.ceil(maxSec / stepSec));
  for (let k = 0; k <= steps; k += 1) {
    const elapsedSec = Math.min(maxSec, k * stepSec);
    const dayX = elapsedSec / (24 * 60 * 60);
    const underlyingPct = interpolateCurvePct(usable, dayX);
    const t = (Number(last.time) + elapsedSec) as UTCTimestamp;
    const v = Number(last.close) * (1 + underlyingPct / 100);
    if (!Number.isFinite(v)) continue;
    points.push({ time: t, value: v });
  }

  return points.length ? points : [];
}

function mergeTimeseriesPayload(
  prev: TimeseriesResponse | null | undefined,
  next: TimeseriesResponse,
): TimeseriesResponse {
  if (!prev) return next;
  if (String(prev.assetId || "") !== String(next.assetId || "")) return next;
  const prevBars = Array.isArray(prev.ohlcv) ? prev.ohlcv : [];
  const nextBars = Array.isArray(next.ohlcv) ? next.ohlcv : [];
  if (!prevBars.length || !nextBars.length) return next;
  if (prevBars.length !== nextBars.length) return next;
  const prevFirst = prevBars[0];
  const nextFirst = nextBars[0];
  if (String(prevFirst?.t || "") !== String(nextFirst?.t || "")) return next;

  const mergedBars = [...prevBars];
  mergedBars[mergedBars.length - 1] = nextBars[nextBars.length - 1];
  return {
    ...next,
    ohlcv: mergedBars,
  };
}

export default function CandleChart({
  payload,
  evaluation = null,
  seasonality = null,
  dataSource = "tradingview",
  title = "Asset",
  sourceLabel = "TradingView",
  goldThemeEnabled = false,
  themePrimary = "#4d87fe",
  isPanelLoading = false,
  isFullscreen = false,
  onToggleFullscreen,
  loopReplayTick = 0,
  onTimeRangeChange,
  onRecentSignalChange,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const projectionSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const signalMarkersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const updateZonesRef = useRef<() => void>(() => {});
  const stageTimerRef = useRef<number | null>(null);
  const loopAnimFrameRef = useRef<number | null>(null);
  const stagedKeyRef = useRef("");
  const dataLenRef = useRef(0);
  const currentBarsRef = useRef<CandleBar[]>([]);
  const [timeframe, setTimeframe] = useState<TimeframeKey>("D");
  const [showHistoricalZones, setShowHistoricalZones] = useState(true);
  const [showSignals, setShowSignals] = useState(true);
  const [zones, setZones] = useState<ZoneRect[]>([]);
  const [continuousMode, setContinuousMode] = useState<ContinuousMode>("regular");
  const [tfPayloads, setTfPayloads] = useState<Record<string, TimeseriesResponse | null>>({});
  const [tfLoading, setTfLoading] = useState(false);
  const [noDataMessage, setNoDataMessage] = useState<string>("");
  const payloadSymbol = String(payload?.symbol ?? "").toUpperCase();
  const isFutureLikeAsset = /1!$|=F$|USOIL|NG1!|RB1!|ZW1!|ZC1!|ZS1!|ZL1!|KC1!|SB1!|CC1!|CT1!|OJ1!|LE1!|HE1!|ES1!|NQ1!|YM1!|RTY1!|FDAX1!/.test(payloadSymbol);
  const tfPayloadKey = `${timeframe}:${continuousMode}`;
  const primaryAccent = goldThemeEnabled ? themePrimary : "#2962ff";
  const bearishColor = goldThemeEnabled ? themePrimary : "#4d87fe";
  const activeBtnClass = goldThemeEnabled
    ? "border border-[#d6b24a]/75 bg-[#d6b24a]/24 text-[#fff2cf]"
    : "border border-[#2962ff]/75 bg-[#2962ff]/24 text-[#dce8ff]";
  const inactiveBtnClass = "border border-slate-600/70 bg-transparent text-slate-300";
  const titleBorderColor = goldThemeEnabled ? "rgba(214,178,74,0.58)" : "rgba(41,98,255,0.40)";
  const titleTextColor = goldThemeEnabled ? "#fff3d1" : "#d9e4ff";

  useEffect(() => {
    if (continuousMode === "backadjusted") {
      setTfPayloads({ "D:backadjusted": payload });
    } else {
      setTfPayloads({});
    }
  }, [continuousMode, dataSource, payload?.assetId, payload?.updatedAt]);

  useEffect(() => {
    const assetId = String(payload?.assetId ?? "").trim();
    if (!assetId) return;
    if (timeframe === "D" && payload) return;
    if (tfPayloads[tfPayloadKey] !== undefined) return;
    let cancelled = false;
    setTfLoading(true);
    GlobeApi.getTimeseries(assetId, timeframe, dataSource, continuousMode)
      .then((res) => {
        if (cancelled) return;
        setTfPayloads((prev) => ({ ...prev, [tfPayloadKey]: res }));
      })
      .catch(() => {
        if (cancelled) return;
        setTfPayloads((prev) => ({ ...prev, [tfPayloadKey]: null }));
      })
      .finally(() => {
        if (!cancelled) setTfLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [continuousMode, dataSource, payload, tfPayloadKey, tfPayloads, timeframe]);

  const activePayload = useMemo(() => {
    if (timeframe === "D" && continuousMode === "backadjusted") return payload;
    return tfPayloads[tfPayloadKey] ?? payload;
  }, [continuousMode, payload, tfPayloadKey, tfPayloads, timeframe]);

  useEffect(() => {
    const assetId = String(payload?.assetId ?? "").trim();
    if (!assetId) return;
    // Daily chart in regular mode is refreshed by App-level scheduler (5m).
    if (timeframe === "D" && continuousMode === "regular") return;
    const refreshMs = 5 * 60 * 1000;
    const timer = window.setInterval(() => {
      GlobeApi.getTimeseries(assetId, timeframe, dataSource, continuousMode)
        .then((res) => {
          setTfPayloads((prev) => {
            const current = prev[tfPayloadKey] ?? (timeframe === "D" && continuousMode === "backadjusted" ? payload : null);
            const merged = mergeTimeseriesPayload(current, res);
            return { ...prev, [tfPayloadKey]: merged };
          });
        })
        .catch(() => {
          // no-op (keep previous payload)
        });
    }, refreshMs);
    return () => window.clearInterval(timer);
  }, [continuousMode, dataSource, payload?.assetId, tfPayloadKey, timeframe]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const chart = createChart(host, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#95a8bf",
        fontSize: 11,
        attributionLogo: false,
      },
      rightPriceScale: {
        borderColor: "rgba(109,132,160,0.35)",
        scaleMargins: { top: 0.08, bottom: 0.12 },
        minimumWidth: 62,
      },
      timeScale: {
        borderColor: "rgba(109,132,160,0.35)",
        secondsVisible: false,
        rightOffset: 24,
        barSpacing: 7.2,
        fixLeftEdge: false,
      },
      grid: {
        vertLines: { color: "rgba(0,0,0,0)" },
        horzLines: { color: "rgba(0,0,0,0)" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: "rgba(180,200,230,0.42)",
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: "rgba(30,44,70,0.92)",
        },
        horzLine: {
          color: "rgba(180,200,230,0.42)",
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: "rgba(30,44,70,0.92)",
        },
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: {
          time: true,
          price: true,
        },
      },
    });

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: "#ffffff",
      downColor: bearishColor,
      wickUpColor: "#ffffff",
      wickDownColor: bearishColor,
      borderUpColor: "#ffffff",
      borderDownColor: bearishColor,
      borderVisible: true,
    });
    const projection = chart.addSeries(LineSeries, {
      color: "#39ff40",
      lineWidth: 2,
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
      pointMarkersVisible: false,
    });
    const signalMarkers = createSeriesMarkers(candles, []);

    chartRef.current = chart;
    seriesRef.current = candles;
    projectionSeriesRef.current = projection;
    signalMarkersRef.current = signalMarkers;

    const onRange = () => {
      updateZonesRef.current();
      if (!onTimeRangeChange) return;
      const logical: LogicalRange | null = chart.timeScale().getVisibleLogicalRange();
      if (!logical) {
        onTimeRangeChange(null);
        return;
      }
      const dataLen = Math.max(1, dataLenRef.current);
      const lastIndex = dataLen - 1;
      const span = Math.max(20, Number(logical.to) - Number(logical.from));
      const rightOffset = Math.max(0, Number(logical.to) - lastIndex);
      onTimeRangeChange({
        visibleSpan: span,
        rightOffset,
      });
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);

    return () => {
      if (stageTimerRef.current != null) {
        window.clearTimeout(stageTimerRef.current);
        stageTimerRef.current = null;
      }
      if (loopAnimFrameRef.current != null) {
        window.cancelAnimationFrame(loopAnimFrameRef.current);
        loopAnimFrameRef.current = null;
      }
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      projectionSeriesRef.current = null;
      signalMarkersRef.current = null;
      setZones([]);
    };
  }, [bearishColor, onTimeRangeChange]);

  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    const host = hostRef.current;
    const projectionSeries = projectionSeriesRef.current;
    const signalMarkers = signalMarkersRef.current;
    if (!series || !chart || !host || !projectionSeries || !signalMarkers) return;
    const renderKey = `${String(activePayload?.assetId || payload?.assetId || "")}:${timeframe}:${continuousMode}`;

    if (stageTimerRef.current != null) {
      window.clearTimeout(stageTimerRef.current);
      stageTimerRef.current = null;
    }
    if (loopAnimFrameRef.current != null) {
      window.cancelAnimationFrame(loopAnimFrameRef.current);
      loopAnimFrameRef.current = null;
    }

    const fullBars = (activePayload?.ohlcv ?? [])
      .slice(-500)
      .map((row) => {
        const open = Number(row.open);
        const close = Number(row.close);
        const highRaw = Number(row.high);
        const lowRaw = Number(row.low);
        if (![open, close, highRaw, lowRaw].every(Number.isFinite)) return null;
        const high = Math.max(highRaw, open, close);
        const low = Math.min(lowRaw, open, close);
        return {
          time: toTs(row.t),
          open,
          high,
          low,
          close,
        };
      })
      .filter((row): row is CandleBar => row !== null);
    const fastBars = fullBars.slice(-100);
    const demandRuntime = buildZoneRuntime(activePayload?.supplyDemand?.demand ?? []);
    const supplyRuntime = buildZoneRuntime(activePayload?.supplyDemand?.supply ?? []);

    const applySignalsAndProjection = (bars: CandleBar[]) => {
      if (showSignals) {
        const markers = buildSignalMarkers(bars, evaluation, demandRuntime, supplyRuntime);
        signalMarkers.setMarkers(markers);
        if (onRecentSignalChange) {
          const minIdx = Math.max(0, bars.length - 3);
          const thresholdTs = Number(bars[minIdx]?.time ?? 0);
          const recent = markers.filter((m) => Number(m.time) >= thresholdTs);
          if (recent.length) {
            const latest = recent[recent.length - 1];
            const bearish = String(latest.position || "").toLowerCase().includes("above");
            const trend = String(activePayload?.indicators?.trend ?? "Neutral");
            const trendBull = trend.toLowerCase().startsWith("bull");
            const sDir = getSeasonDirection(seasonality);
            const markerTime = Number(latest.time);
            let ageBars = 0;
            for (let i = bars.length - 1; i >= 0; i -= 1) {
              if (Number(bars[i].time) === markerTime) {
                ageBars = bars.length - 1 - i;
                break;
              }
            }
            onRecentSignalChange({
              direction: bearish ? "bearish" : "bullish",
              ageBars,
              lines: bearish
                ? [
                    "Bearish rejection near supply zone",
                    sDir === "SHORT" ? "Seasonality turning negative" : "Seasonality mixed",
                    trendBull ? "Momentum fading" : "Momentum breakdown",
                  ]
                : [
                    "Bullish reversal at demand zone",
                    sDir === "LONG" ? "Seasonality turning positive" : "Seasonality mixed",
                    trendBull ? "Momentum breakout" : "Momentum stabilizing",
                  ],
            });
          } else {
            onRecentSignalChange(null);
          }
        }
      } else {
        signalMarkers.setMarkers([]);
        onRecentSignalChange?.(null);
      }

      const projection = buildSeasonProjection(bars, timeframe, seasonality);
      if (!projection.length) {
        projectionSeries.setData([]);
        return;
      }

      const dir = getSeasonDirection(seasonality);
      const color = seasonTone(dir);
      projectionSeries.applyOptions({ color });
      projectionSeries.setData(projection);
    };

    const projectZones = (bars: CandleBar[]) => {
      const width = host.clientWidth;
      const heightLimit = host.clientHeight;
      const scale = chart.timeScale();
      const latestTs = bars.length ? Number(bars[bars.length - 1].time) : 0;
      const visibleRange = scale.getVisibleRange();
      const toUnix = (v: unknown): number => {
        if (typeof v === "number") return Number(v);
        if (typeof v === "string") {
          const ms = new Date(v).getTime();
          return Number.isFinite(ms) ? Math.floor(ms / 1000) : NaN;
        }
        if (v && typeof v === "object" && "year" in (v as Record<string, unknown>) && "month" in (v as Record<string, unknown>) && "day" in (v as Record<string, unknown>)) {
          const row = v as { year: number; month: number; day: number };
          const ms = Date.UTC(Number(row.year), Number(row.month) - 1, Number(row.day));
          return Number.isFinite(ms) ? Math.floor(ms / 1000) : NaN;
        }
        return NaN;
      };
      const visibleFromTs = Number.isFinite(toUnix(visibleRange?.from)) ? toUnix(visibleRange?.from) : NaN;
      const visibleToTs = Number.isFinite(toUnix(visibleRange?.to)) ? toUnix(visibleRange?.to) : NaN;

      const next: ZoneRect[] = [];
      const pushZone = (
        kind: "demand" | "supply",
        zone: ZoneRuntime,
        startTs: number,
        endTs: number,
        fill: string,
        border: string,
      ) => {
        if (Number.isFinite(visibleFromTs) && Number.isFinite(visibleToTs)) {
          // Do not render truncated "small edge zones":
          // only render when zone starts inside visible chart window.
          if (endTs < visibleFromTs || startTs > visibleToTs) return;
          if (startTs < visibleFromTs) return;
        }

        const yA = series.priceToCoordinate(zone.low);
        const yB = series.priceToCoordinate(zone.high);
        if (yA == null || yB == null) return;
        let top = Math.min(yA, yB);
        let height = Math.max(3, Math.abs(yA - yB));
        const bottom = top + height;
        if (bottom < 0 || top > heightLimit) return;
        const clampedTop = Math.max(0, top);
        const clampedBottom = Math.min(heightLimit, bottom);
        top = clampedTop;
        height = Math.max(1, clampedBottom - clampedTop);

        const startX = scale.timeToCoordinate(startTs as UTCTimestamp);
        const endX = scale.timeToCoordinate(endTs as UTCTimestamp);
        // Require full coordinate projection to avoid clipped edge stubs.
        if (startX == null || endX == null) return;
        // Do not clamp to chart edges; clipped edge stubs are intentionally hidden.
        const leftRaw = Math.min(startX, endX);
        const rightRaw = Math.max(startX, endX);
        if (!Number.isFinite(leftRaw) || !Number.isFinite(rightRaw)) return;
        if (rightRaw <= 0 || leftRaw >= width) return;
        if (leftRaw < 0 || rightRaw > width) return;

        const left = leftRaw;
        const right = rightRaw;
        const pixelWidth = right - left;
        if (!Number.isFinite(pixelWidth) || pixelWidth < 12) return;
        next.push({
          kind,
          left,
          width: pixelWidth,
          top,
          height,
          fill,
          border,
        });
      };

      const demandActive = demandRuntime.filter((z) => Number(z.end) >= latestTs - 1);
      const supplyActive = supplyRuntime.filter((z) => Number(z.end) >= latestTs - 1);
      const demandSource = showHistoricalZones ? demandRuntime : demandActive.slice(-4);
      const supplySource = showHistoricalZones ? supplyRuntime : supplyActive.slice(-4);

      for (const z of demandSource) {
        const endTs = showHistoricalZones ? Number(z.end) : latestTs;
        pushZone(
          "demand",
          z,
          z.start,
          endTs,
          "linear-gradient(180deg, rgba(255,255,255,0.14), rgba(255,255,255,0.04))",
          "rgba(255,255,255,0.28)",
        );
      }
      for (const z of supplySource) {
        const endTs = showHistoricalZones ? Number(z.end) : latestTs;
        pushZone(
          "supply",
          z,
          z.start,
          endTs,
          `linear-gradient(180deg, ${hexToRgba(primaryAccent, 0.22)}, ${hexToRgba(primaryAccent, 0.06)})`,
          hexToRgba(primaryAccent, 0.44),
        );
      }

      setZones(resolveZoneOverlaps(next, heightLimit));
    };

    updateZonesRef.current = () => projectZones(currentBarsRef.current);

    const setVisibleWindow = (bars: CandleBar[]) => {
      const totalBars = bars.length;
      if (!Number.isFinite(totalBars) || totalBars <= 0) return;
      const span = TIMEFRAME_BARS[timeframe] ?? 100;
      const stepSec = Math.max(60, Math.round(inferBarStepSeconds(timeframe, bars)));
      const horizonDays = seasonHorizonDays(seasonality);
      const projectionBars = Math.ceil((horizonDays * 24 * 60 * 60) / stepSec);
      const rightPad = Math.max(24, projectionBars + 6);
      const from = Math.max(0, totalBars - span);
      const to = totalBars + rightPad;
      chart.timeScale().setVisibleLogicalRange({ from, to });
    };

    if (fastBars.length) {
      setNoDataMessage("");
      if (loopReplayTick > 0) {
        const baseBars = fullBars.length ? fullBars : fastBars;
        const visibleSpan = Math.max(24, Math.min(220, TIMEFRAME_BARS[timeframe] ?? 100));
        // Loop animation should replay only the standard visible chart window,
        // not the full history.
        const animBars = baseBars.slice(Math.max(0, baseBars.length - visibleSpan));
        const total = animBars.length;
        const startLen = Math.max(2, Math.min(total, 3));
        let shown = startLen;
        const startBars = animBars.slice(0, startLen);
        series.setData(startBars);
        currentBarsRef.current = startBars;
        dataLenRef.current = startBars.length;
        applySignalsAndProjection(startBars);
        setVisibleWindow(startBars);
        projectZones(startBars);

        const t0 = performance.now();
        const pointsPerSecond = 34;
        const animate = (now: number) => {
          const target = Math.max(
            startLen,
            Math.min(total, Math.floor(startLen + ((now - t0) / 1000) * pointsPerSecond)),
          );
          if (target !== shown) {
            shown = target;
            const nextBars = animBars.slice(0, shown);
            series.setData(nextBars);
            currentBarsRef.current = nextBars;
            dataLenRef.current = nextBars.length;
            if (shown % 4 === 0 || shown >= total) {
              applySignalsAndProjection(nextBars);
              setVisibleWindow(nextBars);
              projectZones(nextBars);
            }
          }
          if (shown < total) {
            loopAnimFrameRef.current = window.requestAnimationFrame(animate);
          } else {
            const doneBars = animBars;
            applySignalsAndProjection(doneBars);
            setVisibleWindow(doneBars);
            projectZones(doneBars);
            loopAnimFrameRef.current = null;
          }
        };
        loopAnimFrameRef.current = window.requestAnimationFrame(animate);
      } else {
        const prevBars = currentBarsRef.current;
        const canReplaceLast =
          prevBars.length === fastBars.length &&
          prevBars.length > 2 &&
          Number(prevBars[0]?.time) === Number(fastBars[0]?.time) &&
          Number(prevBars[prevBars.length - 2]?.time) === Number(fastBars[fastBars.length - 2]?.time);
        const canAppend =
          prevBars.length + 1 === fastBars.length &&
          prevBars.length > 0 &&
          prevBars.every((bar, idx) => Number(bar.time) === Number(fastBars[idx]?.time));

        if (canReplaceLast || canAppend) {
          const lastBar = fastBars[fastBars.length - 1];
          series.update(lastBar);
          const nextBars = canAppend
            ? [...prevBars, lastBar]
            : [...prevBars.slice(0, Math.max(0, prevBars.length - 1)), lastBar];
          currentBarsRef.current = nextBars;
          applySignalsAndProjection(nextBars);
          dataLenRef.current = nextBars.length;
          setVisibleWindow(nextBars);
          projectZones(nextBars);
        } else {
          series.setData(fastBars);
          currentBarsRef.current = fastBars;
          applySignalsAndProjection(fastBars);
          dataLenRef.current = fastBars.length;
          setVisibleWindow(fastBars);
          projectZones(fastBars);
        }
      }
    } else {
      series.setData([]);
      projectionSeries.setData([]);
      signalMarkers.setMarkers([]);
      onRecentSignalChange?.(null);
      dataLenRef.current = 0;
      currentBarsRef.current = [];
      setZones([]);
      onTimeRangeChange?.(null);
      setNoDataMessage("No data available for this asset/timeframe.");
      return;
    }

    const stageDelayMs = loopReplayTick > 0 ? 1300 : 120;
    if (loopReplayTick <= 0 && stagedKeyRef.current !== renderKey) {
      stageTimerRef.current = window.setTimeout(() => {
        series.setData(fullBars);
        currentBarsRef.current = fullBars;
        applySignalsAndProjection(fullBars);
        dataLenRef.current = fullBars.length;
        setVisibleWindow(fullBars);
        projectZones(fullBars);
        stagedKeyRef.current = renderKey;
        stageTimerRef.current = null;
      }, stageDelayMs);
    }
  }, [activePayload, evaluation, loopReplayTick, onRecentSignalChange, onTimeRangeChange, primaryAccent, seasonality, showHistoricalZones, showSignals, timeframe]);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div className="pointer-events-none absolute inset-0 z-[1]">
        {zones.map((zone, idx) => (
          <div
            key={`z-${idx}`}
            className="absolute rounded-[4px]"
            style={{
              left: `${zone.left}px`,
              width: `${zone.width}px`,
              top: `${zone.top}px`,
              height: `${zone.height}px`,
              background: zone.fill,
              border: `1px solid ${zone.border}`,
              boxShadow: zone.kind === "supply" ? `0 0 10px ${hexToRgba(primaryAccent, 0.16)}` : "0 0 8px rgba(255,255,255,0.08)",
            }}
          />
        ))}
      </div>

      <div
        className="absolute left-2.5 right-12 top-2 z-[4] flex min-w-0 items-center gap-2 overflow-hidden"
      >
        <div
          className="pointer-events-none inline-flex shrink-0 items-center gap-2 rounded-md border bg-transparent px-2 py-1 text-[10px] font-semibold"
          style={{
            borderColor: titleBorderColor,
            color: titleTextColor,
          }}
        >
          <span>{title}</span>
          <span className="text-[9px] font-medium text-slate-300">
            {`Source: ${sourceLabel}`}
          </span>
        </div>

        <div className="scroll-thin flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden whitespace-nowrap pr-1">
          <div className="flex shrink-0 items-center gap-1 rounded-md border border-slate-700/65 bg-[rgba(7,14,26,0.78)] px-1 py-1">
            <button
              type="button"
              onClick={() => setShowHistoricalZones((v) => !v)}
              className={`rounded px-1.5 py-[2px] text-[9px] font-semibold transition ${
                showHistoricalZones
                  ? activeBtnClass
                  : inactiveBtnClass
              }`}
            >
              Hist Z
            </button>
            <button
              type="button"
              onClick={() => setShowSignals((v) => !v)}
              className={`rounded px-1.5 py-[2px] text-[9px] font-semibold transition ${
                showSignals
                  ? activeBtnClass
                  : inactiveBtnClass
              }`}
            >
              Signale
            </button>
          </div>

          <div className="flex shrink-0 items-center gap-1 rounded-md border border-slate-700/65 bg-[rgba(7,14,26,0.78)] px-1 py-1">
            {(["M", "W", "D", "4H", "1H"] as TimeframeKey[]).map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => setTimeframe(tf)}
                className={`rounded px-1 py-[2px] text-[9px] font-semibold transition ${
                  timeframe === tf
                    ? activeBtnClass
                    : inactiveBtnClass
                }`}
              >
                {tf}
              </button>
            ))}
            {tfLoading && (
              <span className="ml-1 text-[9px] font-semibold text-slate-300">...</span>
            )}
          </div>

          {isFutureLikeAsset && (
            <div className="flex shrink-0 items-center gap-1 rounded-md border border-slate-700/65 bg-[rgba(7,14,26,0.78)] px-1 py-1">
              <button
                type="button"
                onClick={() => setContinuousMode("regular")}
                className={`rounded px-1.5 py-[2px] text-[9px] font-semibold transition ${
                  continuousMode === "regular"
                    ? activeBtnClass
                    : inactiveBtnClass
                }`}
              >
                Regular
              </button>
              <button
                type="button"
                onClick={() => setContinuousMode("backadjusted")}
                className={`rounded px-1.5 py-[2px] text-[9px] font-semibold transition ${
                  continuousMode === "backadjusted"
                    ? activeBtnClass
                    : inactiveBtnClass
                }`}
              >
                Back-adj
              </button>
            </div>
          )}
        </div>
      </div>

      {onToggleFullscreen ? (
        <button
          type="button"
          onClick={onToggleFullscreen}
          className={`ivq-chart-fullscreen-btn absolute right-3 top-2 z-[5] ${isFullscreen ? "is-visible" : ""}`}
          title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
        >
          {isFullscreen ? <Minimize2 size={14} strokeWidth={1.9} /> : <Maximize2 size={14} strokeWidth={1.9} />}
        </button>
      ) : null}

      <div ref={hostRef} className="relative z-[2] h-full w-full" />
      {(isPanelLoading || tfLoading) ? (
        <div className="pointer-events-none absolute inset-0 z-[6] grid place-items-center bg-[rgba(6,12,22,0.26)]">
          <div
            className="h-8 w-8 animate-spin rounded-full border-2"
            style={{
              borderColor: hexToRgba(primaryAccent, 0.25),
              borderTopColor: primaryAccent,
            }}
          />
        </div>
      ) : null}
      {noDataMessage ? (
        <div className="pointer-events-none absolute inset-0 z-[5] grid place-items-center bg-[rgba(4,10,18,0.38)] px-3 text-center text-[11px] font-medium text-slate-300">
          {noDataMessage}
        </div>
      ) : null}
    </div>
  );
}
