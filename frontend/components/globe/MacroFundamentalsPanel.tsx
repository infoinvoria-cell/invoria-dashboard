import { useEffect, useMemo, useState } from "react";

import { GlobeApi } from "../../lib/api";
import type { FundamentalOscillatorResponse, MacroPoint } from "../../types";

const MACRO_LOOKBACK_DAYS = 31;

type SeriesDef = {
  label: string;
  color: string;
  points: MacroPoint[];
};

type ChartLevel = {
  value: number;
  color: string;
  dash?: string;
};

type MiniKpi = {
  label: string;
  value: string;
  tone?: "bull" | "bear" | "warn" | "neutral" | string;
  strength?: number;
};

type MiniChartOptions = {
  mode?: "line" | "step" | "histogram";
  levels?: ChartLevel[];
  showRightLabels?: boolean;
  showInlineLabels?: boolean;
  inlineLabelMode?: "name" | "value" | "nameValue";
  showXAxisMonths?: boolean;
  showZeroLine?: boolean;
  rightAxisTicks?: number[];
  rightAxisFormatter?: (value: number) => string;
  rightPadding?: number;
  positiveBarColor?: string;
  negativeBarColor?: string;
  showSeriesLegend?: boolean;
  thresholdColoring?: {
    upper: number;
    lower: number;
    upperColor: string;
    lowerColor: string;
    neutralColor: string;
  };
};

function valueAt(points: MacroPoint[]): number {
  if (!points.length) return 0;
  return Number(points[points.length - 1]?.v ?? 0);
}

function clipPointsToRecent(points: MacroPoint[], lookbackDays = MACRO_LOOKBACK_DAYS): MacroPoint[] {
  const rows = Array.isArray(points) ? points : [];
  if (!rows.length) return [];
  const cutoff = Date.now() - Math.max(1, Number(lookbackDays || 31)) * 24 * 60 * 60 * 1000;
  const filtered = rows.filter((p) => {
    const ts = new Date(String(p?.t ?? "")).getTime();
    if (!Number.isFinite(ts)) return true;
    return ts >= cutoff;
  });
  if (filtered.length >= 2) return filtered;
  return rows.slice(-Math.min(rows.length, 120));
}

function colorForRegime(regime: string, neutralColor = "#4d87fe"): string {
  const r = String(regime || "").toLowerCase();
  if (r.includes("stress")) return "#ff384c";
  if (r.includes("low")) return "#39ff40";
  return neutralColor;
}

function statusByValue(value: number, positiveLabel: string, negativeLabel: string, neutralLabel = "Neutral"): string {
  const v = Number(value || 0);
  if (v > 0) return positiveLabel;
  if (v < 0) return negativeLabel;
  return neutralLabel;
}

function toneColor(tone?: string): string {
  const t = String(tone || "").toLowerCase();
  if (t === "bull") return "#39ff40";
  if (t === "bear") return "#ff384c";
  if (t === "warn") return "#ff9800";
  return "#9db0cf";
}

function monthLabelDe(ts: string): string {
  const d = new Date(String(ts || ""));
  if (Number.isNaN(d.getTime())) return "";
  let m = new Intl.DateTimeFormat("de-DE", { month: "short" }).format(d);
  m = m.replace(".", "");
  if (!m) return "";
  return m.charAt(0).toUpperCase() + m.slice(1);
}

function formatAxisDe(value: number): string {
  return Number(value || 0).toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function MiniSeriesChart({
  series,
  yMin = -100,
  yMax = 100,
  options,
  replayTick = 0,
}: {
  series: SeriesDef[];
  yMin?: number;
  yMax?: number;
  options?: MiniChartOptions;
  replayTick?: number;
}) {
  const width = 340;
  const height = 112;
  const hasRightLabels = options?.showRightLabels === true;
  const hasInlineLabels = options?.showInlineLabels === true;
  const axisTicks = options?.rightAxisTicks ?? [];
  const hasRightAxis = axisTicks.length > 0;
  const hasXAxis = options?.showXAxisMonths === true;
  const showZeroLine = options?.showZeroLine !== false;
  const mode = options?.mode ?? "line";

  const padLeft = 6;
  const padTop = 8;
  const padRight = options?.rightPadding ?? (hasRightLabels || hasInlineLabels || hasRightAxis ? 86 : 6);
  const padBottom = hasXAxis ? 16 : 8;
  const innerW = width - padLeft - padRight;
  const innerH = height - padTop - padBottom;
  const plotRight = padLeft + innerW;

  const maxLen = Math.max(2, ...series.map((s) => s.points.length));
  const [animatedLen, setAnimatedLen] = useState<number | null>(null);
  const effectiveLen = Math.max(2, Math.min(maxLen, animatedLen ?? maxLen));
  const rng = Math.max(1e-9, yMax - yMin);

  useEffect(() => {
    if (replayTick <= 0 || maxLen <= 2) {
      setAnimatedLen(null);
      return;
    }
    let raf: number | null = null;
    const startLen = 2;
    let shown = startLen;
    setAnimatedLen(startLen);
    const t0 = performance.now();
    const pointsPerSecond = 34;
    const animate = (now: number) => {
      const target = Math.max(
        startLen,
        Math.min(maxLen, Math.floor(startLen + ((now - t0) / 1000) * pointsPerSecond)),
      );
      if (target !== shown) {
        shown = target;
        setAnimatedLen(target);
      }
      if (shown < maxLen) {
        raf = window.requestAnimationFrame(animate);
      }
    };
    raf = window.requestAnimationFrame(animate);
    return () => {
      if (raf != null) window.cancelAnimationFrame(raf);
    };
  }, [maxLen, replayTick]);

  const plotted = useMemo(() => {
    return series.map((s) => {
      const pts = s.points.slice(-effectiveLen).map((p, idx) => {
        const x = padLeft + (idx / Math.max(1, effectiveLen - 1)) * innerW;
        const v = Number(p.v);
        const y = padTop + (1 - (Math.max(yMin, Math.min(yMax, v)) - yMin) / rng) * innerH;
        return { x, y, v, t: String(p.t || "") };
      });
      let path = "";
      if (pts.length > 0) {
        if (mode === "step") {
          path = `M${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
          for (let i = 1; i < pts.length; i += 1) {
            path += ` L${pts[i].x.toFixed(2)},${pts[i - 1].y.toFixed(2)} L${pts[i].x.toFixed(2)},${pts[i].y.toFixed(2)}`;
          }
        } else {
          path = pts.map((p, idx) => `${idx === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
        }
      }
      return { color: s.color, label: s.label, path, pts };
    });
  }, [effectiveLen, innerH, innerW, mode, padLeft, padTop, rng, series, yMax, yMin]);

  const linePaths = useMemo(() => plotted.map((s) => ({ color: s.color, path: s.path })), [plotted]);
  const coloredLineSegments = useMemo(() => {
    const cfg = options?.thresholdColoring;
    if (!cfg) return [];
    const out: Array<{ d: string; color: string }> = [];
    for (const s of plotted) {
      for (let i = 1; i < s.pts.length; i += 1) {
        const p0 = s.pts[i - 1];
        const p1 = s.pts[i];
        const v = (Number(p0.v) + Number(p1.v)) / 2;
        let color = cfg.neutralColor;
        if (v >= cfg.upper) color = cfg.upperColor;
        else if (v <= cfg.lower) color = cfg.lowerColor;
        out.push({
          d: `M${p0.x.toFixed(2)},${p0.y.toFixed(2)} L${p1.x.toFixed(2)},${p1.y.toFixed(2)}`,
          color,
        });
      }
    }
    return out;
  }, [options?.thresholdColoring, plotted]);

  const rightLabels = useMemo(() => {
    if (!hasRightLabels && !hasInlineLabels) return [];
    const mode = options?.inlineLabelMode ?? "nameValue";
    const raw = plotted
      .map((s) => {
        const last = s.pts[s.pts.length - 1];
        if (!last) return null;
        const lastVal = Number(last.v);
        let label = s.label;
        if (mode === "value") label = Number.isFinite(lastVal) ? lastVal.toFixed(1) : "-";
        if (mode === "nameValue") label = `${s.label} ${Number.isFinite(lastVal) ? lastVal.toFixed(1) : "-"}`;
        return { label, color: s.color, y: last.y };
      })
      .filter((x): x is { label: string; color: string; y: number } => x !== null)
      .sort((a, b) => a.y - b.y);

    const minGap = 11;
    for (let i = 1; i < raw.length; i += 1) {
      if (raw[i].y < raw[i - 1].y + minGap) raw[i].y = raw[i - 1].y + minGap;
    }
    const maxY = padTop + innerH - 3;
    if (raw.length && raw[raw.length - 1].y > maxY) {
      raw[raw.length - 1].y = maxY;
      for (let i = raw.length - 2; i >= 0; i -= 1) {
        if (raw[i].y > raw[i + 1].y - minGap) raw[i].y = raw[i + 1].y - minGap;
      }
    }
    const minY = padTop + 4;
    for (let i = 0; i < raw.length; i += 1) {
      raw[i].y = Math.max(minY, Math.min(maxY, raw[i].y));
    }
    return raw;
  }, [hasInlineLabels, hasRightLabels, innerH, options?.inlineLabelMode, padTop, plotted]);

  const monthTicks = useMemo(() => {
    if (!hasXAxis || !plotted.length || !plotted[0].pts.length) return [];
    const pts = plotted[0].pts;
    const idxs = [0, Math.floor((pts.length - 1) / 3), Math.floor((pts.length - 1) * (2 / 3)), pts.length - 1];
    const uniq = Array.from(new Set(idxs)).filter((i) => i >= 0 && i < pts.length);
    return uniq.map((i) => ({ x: pts[i].x, label: monthLabelDe(pts[i].t) }));
  }, [hasXAxis, plotted]);

  const levelLines = useMemo(() => {
    const rows = options?.levels ?? [];
    return rows
      .map((lvl) => {
        const v = Number(lvl.value);
        if (!Number.isFinite(v) || v < yMin || v > yMax) return null;
        const y = padTop + (1 - (v - yMin) / rng) * innerH;
        return { ...lvl, y };
      })
      .filter((x): x is ChartLevel & { y: number } => x !== null);
  }, [innerH, options?.levels, padTop, rng, yMax, yMin]);

  const zeroY = padTop + (1 - (0 - yMin) / rng) * innerH;
  const barRects = useMemo(() => {
    if (mode !== "histogram") return [];
    const bars: Array<{ x: number; y: number; w: number; h: number; color: string }> = [];
    const barW = Math.max(1, (innerW / Math.max(1, maxLen)) * 0.78);
    const posColor = options?.positiveBarColor ?? "#39ff40";
    const negColor = options?.negativeBarColor ?? "#ff384c";
    for (const s of plotted) {
      for (const p of s.pts) {
        const top = Math.min(zeroY, p.y);
        const h = Math.max(0.8, Math.abs(p.y - zeroY));
        const color = p.v >= 0 ? posColor : negColor;
        bars.push({
          x: p.x - barW / 2,
          y: top,
          w: barW,
          h,
          color,
        });
      }
    }
    return bars;
  }, [innerW, maxLen, mode, options?.negativeBarColor, options?.positiveBarColor, plotted, zeroY]);
  const rightAxis = useMemo(() => {
    if (!hasRightAxis) return [];
    return axisTicks
      .map((tick) => {
        const v = Number(tick);
        if (!Number.isFinite(v)) return null;
        const y = padTop + (1 - (v - yMin) / rng) * innerH;
        return { value: v, y };
      })
      .filter((x): x is { value: number; y: number } => x !== null);
  }, [axisTicks, hasRightAxis, innerH, padTop, rng, yMax, yMin]);
  const rightAxisFmt = options?.rightAxisFormatter ?? formatAxisDe;

  return (
    <div className="relative h-full w-full overflow-hidden">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full" preserveAspectRatio="none" role="img" aria-label="macro chart">
        <rect x="0" y="0" width={width} height={height} fill="rgba(6,14,27,0.15)" />
        {showZeroLine ? (
          <line x1={padLeft} x2={plotRight} y1={zeroY} y2={zeroY} stroke="rgba(116,142,189,0.32)" strokeDasharray="3 4" strokeWidth="1" />
        ) : null}
        {levelLines.map((lvl) => (
          <line
            key={`${lvl.value}-${lvl.color}`}
            x1={padLeft}
            x2={plotRight}
            y1={lvl.y}
            y2={lvl.y}
            stroke={lvl.color}
            strokeDasharray={lvl.dash ?? "3 4"}
            strokeWidth="1"
          />
        ))}
        {mode === "histogram"
          ? barRects.map((b, idx) => <rect key={`bar-${idx}`} x={b.x} y={b.y} width={b.w} height={b.h} fill={b.color} />)
          : options?.thresholdColoring
            ? coloredLineSegments.map((seg, idx) => (
                <path key={`seg-${idx}`} d={seg.d} fill="none" stroke={seg.color} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              ))
            : linePaths.map((l, idx) => (
                <path key={idx} d={l.path} fill="none" stroke={l.color} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              ))}
        {hasRightAxis ? <line x1={plotRight} x2={plotRight} y1={padTop} y2={padTop + innerH} stroke="rgba(114,136,171,0.42)" strokeWidth="1" /> : null}
        {hasXAxis ? <line x1={padLeft} x2={plotRight} y1={padTop + innerH} y2={padTop + innerH} stroke="rgba(96,120,158,0.38)" strokeWidth="1" /> : null}
        {monthTicks.map((tick, idx) => (
          <text key={`mx-${idx}`} x={tick.x} y={height - 2} textAnchor="middle" fontSize="9" fill="#c9d4e7">
            {tick.label}
          </text>
        ))}
        {rightAxis.map((tick, idx) => (
          <text key={`ry-${idx}`} x={plotRight + 58} y={tick.y + 3} textAnchor="end" fontSize="9" fill="#d5deee">
            {rightAxisFmt(tick.value)}
          </text>
        ))}
        {rightLabels.map((lbl, idx) => (
          <g key={`rl-${idx}`}>
            <line x1={plotRight + 2} x2={plotRight + 12} y1={lbl.y} y2={lbl.y} stroke={lbl.color} strokeWidth="1.2" />
            <text x={plotRight + 14} y={lbl.y + 3} fontSize="8.1" fill={lbl.color}>
              {lbl.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function MacroCard({
  title,
  subtitle,
  series,
  yMin,
  yMax,
  chartOptions,
  kpis = [],
  primaryColor = "#2962ff",
  loopReplayTick = 0,
}: {
  title: string;
  subtitle?: string;
  series: SeriesDef[];
  yMin?: number;
  yMax?: number;
  chartOptions?: MiniChartOptions;
  kpis?: MiniKpi[];
  primaryColor?: string;
  loopReplayTick?: number;
}) {
  return (
    <div className="ivq-subpanel flex min-h-0 flex-col p-3">
      <div className="mb-1 flex items-center justify-between">
        <div className="ivq-section-label mb-0">{title}</div>
        {subtitle ? <div className="text-[10px] text-slate-400">{subtitle}</div> : null}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded border" style={{ borderColor: `${primaryColor}33` }}>
        <MiniSeriesChart series={series} yMin={yMin} yMax={yMax} options={chartOptions} replayTick={loopReplayTick} />
      </div>
      {kpis.length > 0 ? (
        <div className="mt-2 grid grid-cols-3 gap-2">
          {kpis.map((kpi) => (
            <div key={kpi.label} className="rounded border border-slate-700/55 bg-[rgba(7,13,24,0.45)] px-1 py-[2px]">
              <div className="truncate text-[8px] uppercase tracking-[0.08em] text-slate-400">{kpi.label}</div>
              <div className="truncate text-[10px] font-semibold" style={{ color: toneColor(kpi.tone) }}>
                {kpi.value}
              </div>
              <div className="mt-[2px] h-[2px] rounded-full bg-slate-700/55">
                <div className="h-[2px] rounded-full" style={{ width: `${Math.max(2, Math.min(100, Number(kpi.strength ?? 0)))}%`, backgroundColor: toneColor(kpi.tone) }} />
              </div>
            </div>
          ))}
        </div>
      ) : chartOptions?.showSeriesLegend === false || chartOptions?.showRightLabels ? null : (
        <div className="mt-2 grid grid-cols-3 gap-2">
          {series.map((s) => (
            <div key={s.label} className="truncate rounded border border-slate-700/50 bg-[rgba(7,13,24,0.52)] px-1 py-[2px] text-[9px]">
              <span style={{ color: s.color }}>{s.label}</span>{" "}
              <span className="text-slate-200">{valueAt(s.points).toFixed(1)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function MacroFundamentalsPanel({
  goldThemeEnabled = false,
  loopReplayTick = 0,
  enabled = false,
}: {
  goldThemeEnabled?: boolean;
  loopReplayTick?: number;
  enabled?: boolean;
}) {
  const [data, setData] = useState<FundamentalOscillatorResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const primaryColor = goldThemeEnabled ? "#d6b24a" : "#2962ff";
  const primaryAltColor = goldThemeEnabled ? "#c9a84a" : "#4d87fe";

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    GlobeApi.getFundamentalMacro()
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((_err) => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const cotNet: SeriesDef[] = useMemo(
    () => [
      {
        label: "Commercials",
        color: primaryColor,
        points: clipPointsToRecent((data?.cot?.net?.commercials ?? []).map((p) => ({ ...p, v: Number(p.v) }))),
      },
      {
        label: "Large Specs",
        color: "#ffffff",
        points: clipPointsToRecent((data?.cot?.net?.largeSpecs ?? []).map((p) => ({ ...p, v: Number(p.v) }))),
      },
      {
        label: "Small Traders",
        color: "#39ff40",
        points: clipPointsToRecent((data?.cot?.net?.smallTraders ?? []).map((p) => ({ ...p, v: Number(p.v) }))),
      },
    ],
    [data, primaryColor],
  );
  const cotIdx: SeriesDef[] = useMemo(
    () => [
      { label: "Large Specs", color: "#ffffff", points: clipPointsToRecent(data?.cot?.index?.largeSpecs ?? []) },
      { label: "Small Traders", color: "#39ff40", points: clipPointsToRecent(data?.cot?.index?.smallTraders ?? []) },
      { label: "Commercials", color: primaryColor, points: clipPointsToRecent(data?.cot?.index?.commercials ?? []) },
    ],
    [data, primaryColor],
  );
  const liquidity: SeriesDef[] = useMemo(
    () => [{ label: "Net Liquidity", color: primaryAltColor, points: clipPointsToRecent(data?.fedLiquidity?.net ?? []) }],
    [data, primaryAltColor],
  );
  const vix: SeriesDef[] = useMemo(
    () => [{ label: "Risk Osc", color: primaryColor, points: clipPointsToRecent(data?.vix?.ratioOsc ?? []) }],
    [data, primaryColor],
  );
  const cotNetStatus = useMemo(() => {
    const v = valueAt(cotNet[0]?.points ?? []);
    return statusByValue(v, "Positioning: Net Long", "Positioning: Net Short");
  }, [cotNet]);
  const cotIdxStatus = useMemo(() => {
    const c = valueAt(cotIdx[2]?.points ?? []);
    if (c >= 80) return "Regime: Extreme Bullish";
    if (c <= 20) return "Regime: Extreme Bearish";
    return "Regime: Neutral";
  }, [cotIdx]);
  const liqStatus = useMemo(() => {
    const v = valueAt(liquidity[0]?.points ?? []);
    return statusByValue(v, "Liquidity: Expanding", "Liquidity: Tightening");
  }, [liquidity]);
  const vixStatus = useMemo(() => `Regime: ${data?.vix?.regime ?? "Neutral"}`, [data?.vix?.regime]);
  const cotNetKpis = useMemo<MiniKpi[]>(
    () => [
      { label: "Commercials", value: valueAt(cotNet[0]?.points ?? []).toFixed(0), tone: valueAt(cotNet[0]?.points ?? []) >= 0 ? "bull" : "bear", strength: (Math.abs(valueAt(cotNet[0]?.points ?? [])) / 140) * 100 },
      { label: "Large Specs", value: valueAt(cotNet[1]?.points ?? []).toFixed(0), tone: valueAt(cotNet[1]?.points ?? []) >= 0 ? "bull" : "bear", strength: (Math.abs(valueAt(cotNet[1]?.points ?? [])) / 140) * 100 },
      { label: "Small Traders", value: valueAt(cotNet[2]?.points ?? []).toFixed(0), tone: valueAt(cotNet[2]?.points ?? []) >= 0 ? "bull" : "bear", strength: (Math.abs(valueAt(cotNet[2]?.points ?? [])) / 140) * 100 },
    ],
    [cotNet],
  );
  const cotIdxKpis = useMemo<MiniKpi[]>(
    () => [
      {
        label: "Commercials",
        value: valueAt(cotIdx[2]?.points ?? []).toFixed(1),
        tone: valueAt(cotIdx[2]?.points ?? []) >= 80 ? "bull" : valueAt(cotIdx[2]?.points ?? []) <= 20 ? "bear" : "neutral",
        strength: valueAt(cotIdx[2]?.points ?? []),
      },
      {
        label: "Large Specs",
        value: valueAt(cotIdx[0]?.points ?? []).toFixed(1),
        tone: valueAt(cotIdx[0]?.points ?? []) >= 80 ? "bull" : valueAt(cotIdx[0]?.points ?? []) <= 20 ? "bear" : "neutral",
        strength: valueAt(cotIdx[0]?.points ?? []),
      },
      {
        label: "Small Traders",
        value: valueAt(cotIdx[1]?.points ?? []).toFixed(1),
        tone: valueAt(cotIdx[1]?.points ?? []) >= 80 ? "bull" : valueAt(cotIdx[1]?.points ?? []) <= 20 ? "bear" : "neutral",
        strength: valueAt(cotIdx[1]?.points ?? []),
      },
    ],
    [cotIdx],
  );
  const liquidityKpis = useMemo<MiniKpi[]>(() => {
    const points = liquidity[0]?.points ?? [];
    const last = valueAt(points);
    const prev = points.length > 6 ? Number(points[points.length - 6]?.v ?? 0) : 0;
    const delta = last - prev;
    return [
      { label: "Net", value: last.toFixed(1), tone: last >= 0 ? "bull" : "bear", strength: Math.abs(last) },
      { label: "5d Delta", value: `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}`, tone: delta >= 0 ? "bull" : "bear", strength: Math.abs(delta) * 3.2 },
      { label: "Bias", value: last >= 0 ? "Risk-On" : "Risk-Off", tone: last >= 0 ? "bull" : "bear", strength: Math.abs(last) * 1.4 },
    ];
  }, [liquidity]);
  const vixKpis = useMemo<MiniKpi[]>(() => {
    const osc = valueAt(vix[0]?.points ?? []);
    const vixLast = valueAt(data?.vix?.vix ?? []);
    const vix3Last = valueAt(data?.vix?.vix3m ?? []);
    return [
      { label: "Osc", value: osc.toFixed(1), tone: osc >= 60 ? "bear" : osc <= -60 ? "bull" : "neutral", strength: Math.abs(osc) },
      { label: "VIX", value: vixLast.toFixed(2), tone: vixLast > vix3Last ? "bear" : "neutral", strength: Math.abs((vixLast / Math.max(1e-9, vix3Last || 1)) * 40) },
      { label: "VIX3", value: vix3Last.toFixed(2), tone: vixLast < vix3Last ? "bull" : "neutral", strength: Math.abs((vix3Last / Math.max(1e-9, vixLast || 1)) * 40) },
    ];
  }, [data?.vix?.vix, data?.vix?.vix3m, vix]);

  return (
    <div className="glass-panel ivq-panel h-full min-h-0 overflow-hidden p-1.5">
      <div className="mb-1 flex items-center justify-between px-1">
        <div className="text-[10px] uppercase tracking-[0.12em] text-slate-400">Macro Dashboard</div>
        <div className="text-[10px]" style={{ color: colorForRegime(data?.vix?.regime ?? "Neutral", primaryAltColor) }}>
          {loading ? "loading..." : `Risk: ${data?.vix?.regime ?? "Neutral"}`}
        </div>
      </div>
      <div className="grid h-[calc(100%-18px)] min-h-0 grid-cols-2 grid-rows-2 gap-3">
        <MacroCard
          title="COT Net Positioning"
          subtitle={cotNetStatus}
          series={cotNet}
          primaryColor={primaryColor}
          yMin={-160}
          yMax={160}
          kpis={cotNetKpis}
          loopReplayTick={loopReplayTick}
          chartOptions={{
            mode: "step",
            showRightLabels: false,
            showInlineLabels: true,
            inlineLabelMode: "nameValue",
            rightPadding: 94,
            showXAxisMonths: true,
            showZeroLine: false,
            showSeriesLegend: false,
          }}
        />
        <MacroCard
          title="COT Index (0-100)"
          subtitle={cotIdxStatus}
          series={cotIdx}
          primaryColor={primaryColor}
          yMin={0}
          yMax={100}
          kpis={cotIdxKpis}
          loopReplayTick={loopReplayTick}
          chartOptions={{
            mode: "step",
            levels: [
              { value: 80, color: goldThemeEnabled ? "rgba(214,178,74,0.9)" : "rgba(77,135,254,0.9)", dash: "2 3" },
              { value: 20, color: "rgba(255,56,76,0.9)", dash: "2 3" },
            ],
            showRightLabels: false,
            showInlineLabels: true,
            inlineLabelMode: "nameValue",
            rightPadding: 94,
            showXAxisMonths: true,
            showZeroLine: false,
            showSeriesLegend: false,
          }}
        />
        <MacroCard
          title="Fed Liquidity Proxy"
          subtitle={liqStatus}
          series={liquidity}
          primaryColor={primaryColor}
          yMin={-120}
          yMax={60}
          kpis={liquidityKpis}
          loopReplayTick={loopReplayTick}
          chartOptions={{
            mode: "histogram",
            showInlineLabels: true,
            inlineLabelMode: "value",
            rightPadding: 82,
            showXAxisMonths: true,
            showZeroLine: true,
            positiveBarColor: "#39ff40",
            negativeBarColor: "#ff384c",
            showSeriesLegend: false,
          }}
        />
        <MacroCard
          title="VIX / VIX3"
          subtitle={vixStatus}
          series={vix}
          primaryColor={primaryColor}
          yMin={-100}
          yMax={100}
          kpis={vixKpis}
          loopReplayTick={loopReplayTick}
          chartOptions={{
            showInlineLabels: true,
            inlineLabelMode: "value",
            rightPadding: 82,
            showXAxisMonths: true,
            showZeroLine: true,
            levels: [
              { value: 60, color: "#ff384c", dash: "" },
              { value: -60, color: "#39ff40", dash: "" },
            ],
            thresholdColoring: {
              upper: 60,
              lower: -60,
              upperColor: "#ff384c",
              lowerColor: "#39ff40",
              neutralColor: primaryColor,
            },
            showSeriesLegend: false,
          }}
        />
      </div>
    </div>
  );
}

