"use client";

import { useEffect, useMemo, useState } from "react";
import { Globe2 } from "lucide-react";

import { GlobeApi } from "../../lib/api";
import { headlineGlyph } from "../../lib/icons";
import type { NewsItem } from "../../types";

type Props = {
  globalNews: NewsItem[];
  assetNews: NewsItem[];
  assetName: string;
  assetIconUrl?: string;
  goldThemeEnabled?: boolean;
};

type TranslationRow = {
  loading: boolean;
  showTranslated: boolean;
  title?: string;
  description?: string;
};

function rowKey(item: NewsItem, idx: number): string {
  return String(item.newsId || item.url || `${item.title}-${idx}`);
}

function relativeTime(value?: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return "";
  const diffMs = Math.max(0, Date.now() - dt.getTime());
  const diffMin = Math.floor(diffMs / (1000 * 60));
  if (diffMin < 60) return `${Math.max(1, diffMin)}m`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD}d`;
  return dt.toISOString().slice(0, 10);
}

function sentimentMeta(sentiment: string, goldThemeEnabled = false): { label: string; color: string; glow: string } {
  const probe = String(sentiment || "").toLowerCase();
  if (probe.includes("bull")) return { label: "Bullish", color: "#39ff40", glow: "rgba(57,255,64,0.45)" };
  if (probe.includes("bear")) return { label: "Bearish", color: "#ff5267", glow: "rgba(255,82,103,0.45)" };
  return {
    label: "Neutral",
    color: goldThemeEnabled ? "#d6b24a" : "#78a7ff",
    glow: goldThemeEnabled ? "rgba(214,178,74,0.45)" : "rgba(120,167,255,0.42)",
  };
}

function categoryLabel(category?: string): string {
  const raw = String(category || "macro").trim();
  if (!raw) return "Macro";
  return raw
    .split("_")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : ""))
    .join(" ");
}

function sourceDomain(item: NewsItem): string {
  const explicit = String(item.sourceDomain || "").trim();
  if (explicit) return explicit;
  try {
    return new URL(item.url).hostname.replace(/^www\./, "");
  } catch (_err) {
    return "";
  }
}

function sourceLogo(item: NewsItem): string {
  const domain = sourceDomain(item);
  if (!domain) return headlineGlyph(item.source || item.title || "news");
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
}

function sortRows(items: NewsItem[]): NewsItem[] {
  return [...items].sort((a, b) => {
    const pa = Number(a.priorityScore ?? 0);
    const pb = Number(b.priorityScore ?? 0);
    if (pb !== pa) return pb - pa;
    const ta = new Date(String(a.timestamp || a.publishedAt || 0)).getTime();
    const tb = new Date(String(b.timestamp || b.publishedAt || 0)).getTime();
    return tb - ta;
  });
}

function NewsList({
  title,
  titleIconUrl,
  items,
  goldThemeEnabled = false,
}: {
  title: string;
  titleIconUrl: string;
  items: NewsItem[];
  goldThemeEnabled?: boolean;
}) {
  const [showGerman, setShowGerman] = useState(false);
  const [translations, setTranslations] = useState<Record<string, TranslationRow>>({});
  const rows = useMemo(() => sortRows(items).slice(0, 10), [items]);
  const accentClass = goldThemeEnabled ? "hover:border-[#d6b24a]/60 hover:text-[#fff3d1]" : "hover:border-[#2962ff]/60 hover:text-[#dce8ff]";

  const ensureGermanTranslation = async (item: NewsItem, idx: number) => {
    const key = rowKey(item, idx);
    const current = translations[key];
    if (current?.loading || current?.title || current?.description) {
      setTranslations((prev) => ({
        ...prev,
        [key]: { ...(prev[key] ?? { loading: false }), showTranslated: true, loading: false },
      }));
      return;
    }

    setTranslations((prev) => ({
      ...prev,
      [key]: { ...(prev[key] ?? {}), loading: true, showTranslated: false },
    }));

    try {
      const res = await GlobeApi.translateNews(
        String(item.newsId || key),
        String(item.title || ""),
        String(item.description || ""),
        "DE",
      );
      setTranslations((prev) => ({
        ...prev,
        [key]: {
          loading: false,
          showTranslated: true,
          title: String(res.title || item.title || ""),
          description: String(res.description || item.description || ""),
        },
      }));
    } catch (_err) {
      setTranslations((prev) => ({
        ...prev,
        [key]: { ...(prev[key] ?? {}), loading: false, showTranslated: false },
      }));
    }
  };

  useEffect(() => {
    if (!showGerman) {
      setTranslations((prev) =>
        Object.fromEntries(
          Object.entries(prev).map(([key, value]) => [key, { ...value, showTranslated: false, loading: false }]),
        ),
      );
      return;
    }
    rows.forEach((item, idx) => {
      void ensureGermanTranslation(item, idx);
    });
  }, [rows, showGerman]);

  return (
    <div className="glass-panel ivq-subpanel flex min-h-0 flex-1 flex-col">
      <div className="ivq-section-label flex items-center justify-between gap-1.5">
        <div className="flex items-center gap-1.5">
          <img src={titleIconUrl} alt="" width={14} height={14} className="h-3.5 w-3.5 object-contain" loading="lazy" />
          <span>{title}</span>
        </div>
        <button
          type="button"
          onClick={() => setShowGerman((prev) => !prev)}
          className={`inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-slate-700/65 px-1.5 text-[9px] font-semibold text-slate-200 transition ${accentClass}`}
          title={showGerman ? "Switch back to English" : "Translate to German"}
        >
          <Globe2 size={11} strokeWidth={1.8} />
          <span>{showGerman ? "EN" : "DE"}</span>
        </button>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="space-y-2">
          {rows.map((item, idx) => {
            const key = rowKey(item, idx);
            const translation = translations[key];
            const translated = Boolean(showGerman && translation?.showTranslated);
            const titleText = translated ? (translation?.title || item.title) : item.title;
            const descriptionText = translated ? (translation?.description || item.description || "") : String(item.description || "");
            const sentiment = sentimentMeta(String(item.sentiment || "neutral"), goldThemeEnabled);
            const country = String(item.country || "").trim();
            const category = categoryLabel(item.category);
            const timestamp = relativeTime(item.timestamp || item.publishedAt);
            const relatedAssets = Array.isArray(item.relatedAssets) ? item.relatedAssets.slice(0, 3) : [];

            return (
              <article
                key={key}
                className="rounded-xl border border-slate-700/55 bg-[rgba(7,14,26,0.62)] px-3 py-2.5 text-[11px] text-slate-100 shadow-[0_10px_24px_rgba(0,0,0,0.22)]"
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <img
                      src={sourceLogo(item)}
                      alt=""
                      width={18}
                      height={18}
                      className="h-[18px] w-[18px] shrink-0 rounded-sm bg-slate-900/60 object-contain"
                      loading="lazy"
                      onError={(event) => {
                        event.currentTarget.src = headlineGlyph(item.source || item.title || "news");
                      }}
                    />
                    <div className="min-w-0">
                      <div className="truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-300">{item.source}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        {country ? (
                          <span className="rounded border border-slate-700/65 px-1.5 py-[1px] text-[9px] text-slate-300">
                            {country}
                          </span>
                        ) : null}
                        <span className="rounded border border-slate-700/65 px-1.5 py-[1px] text-[9px] text-slate-300">
                          {category}
                        </span>
                        {translation?.loading && showGerman ? (
                          <span className="rounded border border-slate-700/65 px-1.5 py-[1px] text-[9px] text-slate-300">
                            Translating...
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>

                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className={`block text-[12px] font-semibold leading-snug text-slate-50 transition ${goldThemeEnabled ? "hover:text-[#ffe4a6]" : "hover:text-[#97b7ff]"}`}
                >
                  {titleText}
                </a>

                {descriptionText ? (
                  <p className="mt-1.5 line-clamp-2 text-[10px] leading-snug text-slate-400">
                    {descriptionText}
                  </p>
                ) : null}

                <div className="mt-2 flex items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1 text-[9px] font-semibold text-slate-300">
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ backgroundColor: sentiment.color, boxShadow: `0 0 8px ${sentiment.glow}` }}
                      />
                      {sentiment.label}
                    </span>
                    {relatedAssets.length ? (
                      <span className="truncate text-[9px] text-slate-500">
                        {relatedAssets.join(" • ").toUpperCase()}
                      </span>
                    ) : null}
                  </div>
                  <div className="shrink-0 text-[9px] text-slate-500">{timestamp}</div>
                </div>
              </article>
            );
          })}
          {!rows.length ? <div className="text-[11px] text-slate-500">No relevant headlines</div> : null}
        </div>
      </div>
    </div>
  );
}

export function NewsColumns({ globalNews, assetNews, assetName, assetIconUrl, goldThemeEnabled = false }: Props) {
  return (
    <div className="grid h-full grid-cols-1 gap-3 min-[769px]:grid-cols-2">
      <NewsList
        title="Global News"
        titleIconUrl={headlineGlyph("global")}
        items={globalNews}
        goldThemeEnabled={goldThemeEnabled}
      />
      <NewsList
        title={`${assetName || "Asset"} News`}
        titleIconUrl={assetIconUrl || headlineGlyph(assetName || "asset")}
        items={assetNews}
        goldThemeEnabled={goldThemeEnabled}
      />
    </div>
  );
}
