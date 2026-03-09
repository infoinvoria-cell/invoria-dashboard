import { useState } from "react";

import type { AssetItem } from "../types";

const FX_FLAG_CODES: Record<string, string> = {
  usd: "1f1fa-1f1f8",
  eur: "1f1ea-1f1fa",
  jpy: "1f1ef-1f1f5",
  gbp: "1f1ec-1f1e7",
  chf: "1f1e8-1f1ed",
  aud: "1f1e6-1f1fa",
  cad: "1f1e8-1f1e6",
  nzd: "1f1f3-1f1ff",
};

const EQUITY_BADGES: Record<string, string> = {
  spx: "500",
  nasdaq: "100",
  dow: "30",
  russell: "2K",
  dax: "40",
};

const EMOJI_ICON_CODES: Record<string, string> = {
  gold: "1f947",
  silver: "1f948",
  copper: "1f529",
  platinum: "1faa8",
  palladium: "2699-fe0f",
  aluminum: "1f529",
  oil: "1f6e2",
  gas: "1f525",
  gasoline: "26fd",
  wheat: "1f33e",
  corn: "1f33d",
  soy: "1fad8",
  soyoil: "1f9f4",
  coffee: "2615",
  sugar: "1f36c",
  cocoa: "1f36b",
  cotton: "1f9f5",
  orange: "1f34a",
  cattle: "1f404",
  hogs: "1f416",
  btc: "1fa99",
};

const LOCAL_ICON_FILES: Record<string, string> = {
  usd: "Dollar.png",
  gold: "Gold.png",
  silver: "silber.png",
  copper: "Kupfer.webp",
  spx: "SP.png",
  nasdaq: "NASDAQ.jpg",
  dax: "DAX.png",
};

function twemojiUrl(code: string): string {
  return `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${code}.svg`;
}

function publicIconUrl(fileName: string): string {
  if (typeof window !== "undefined") {
    const p = String(window.location.pathname || "");
    if (p.startsWith("/globe-app")) {
      return `/globe-app/asset-icons/${fileName}`;
    }
  }
  return `/asset-icons/${fileName}`;
}

function localIconUrlForKey(iconKey: string): string | undefined {
  const key = String(iconKey || "").toLowerCase();
  const file = LOCAL_ICON_FILES[key];
  return file ? publicIconUrl(file) : undefined;
}

function commoditySymbol(iconKey: string): string {
  const key = String(iconKey || "").toLowerCase();
  if (key === "gold") return "Au";
  if (key === "silver") return "Ag";
  if (key === "copper") return "Cu";
  if (key === "platinum") return "Pt";
  if (key === "palladium") return "Pd";
  if (key === "aluminum") return "Al";
  if (key === "oil") return "Oil";
  if (key === "gas") return "Gas";
  if (key === "gasoline") return "RBOB";
  if (key === "wheat") return "Wht";
  if (key === "corn") return "Corn";
  if (key === "soy") return "Soy";
  if (key === "soyoil") return "Syo";
  if (key === "coffee") return "Cof";
  if (key === "sugar") return "Sug";
  if (key === "cocoa") return "Coc";
  if (key === "cotton") return "Cot";
  if (key === "orange") return "OJ";
  if (key === "cattle") return "Cat";
  if (key === "hogs") return "Hog";
  return key.slice(0, 3).toUpperCase();
}

function parseCrossPairCodes(assetName: string): [string, string] {
  const pair = String(assetName || "").toUpperCase().trim();
  if (pair.includes("/")) {
    const [baseRaw, quoteRaw] = pair.split("/");
    return [String(baseRaw || "").slice(0, 3), String(quoteRaw || "").slice(0, 3)];
  }
  return [pair.slice(0, 3), pair.slice(3, 6)];
}

export function shortName(value: string, max = 12): string {
  const clean = String(value || "").trim();
  if (!clean) return "-";
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}...`;
}

export function iconUrlForAsset(asset: AssetItem): string | undefined {
  const key = String(asset.iconKey || "").toLowerCase();
  if (asset.category === "Cross Pairs") {
    const name = String(asset.name || "").toUpperCase();
    const base = name.includes("/") ? name.split("/")[0] : name.slice(0, 3);
    const code = FX_FLAG_CODES[String(base || "").toLowerCase()];
    return code ? twemojiUrl(code) : undefined;
  }
  const local = localIconUrlForKey(key);
  if (local) return local;
  if (asset.category === "FX") {
    const code = FX_FLAG_CODES[key];
    return code ? twemojiUrl(code) : undefined;
  }
  const code = EMOJI_ICON_CODES[key];
  return code ? twemojiUrl(code) : undefined;
}

export function iconTextForAsset(asset: AssetItem): string {
  const key = String(asset.iconKey || "").toLowerCase();
  const nameLower = String(asset.name || "").toLowerCase();
  if (asset.category === "Cross Pairs") {
    const raw = String(asset.name || "").toUpperCase();
    return raw.includes("/") ? raw : raw.slice(0, 6);
  }
  if (asset.category === "Equities") {
    return EQUITY_BADGES[key] ?? "IDX";
  }
  if (asset.category === "Stocks") {
    const ticker = String(asset.symbol || asset.name || "").toUpperCase().split(".")[0];
    return ticker.slice(0, 4) || "STK";
  }
  if (asset.category === "Crypto") {
    return key === "btc" ? "BTC" : "CR";
  }
  if (asset.category === "FX") {
    if (nameLower.includes("dollar index") || String(asset.id || "").toLowerCase() === "usd_index") return "DXY";
    return asset.name.slice(0, 3).toUpperCase();
  }
  return commoditySymbol(key);
}

export function headlineGlyph(title: string): string {
  const t = title.toLowerCase();
  if (t.includes("dollar") || t.includes("usd")) return localIconUrlForKey("usd") || twemojiUrl(FX_FLAG_CODES.usd);
  if (t.includes("euro") || t.includes("eur")) return twemojiUrl(FX_FLAG_CODES.eur);
  if (t.includes("yen") || t.includes("jpy")) return twemojiUrl(FX_FLAG_CODES.jpy);
  if (t.includes("oil")) return twemojiUrl(EMOJI_ICON_CODES.oil);
  if (t.includes("gold")) return localIconUrlForKey("gold") || twemojiUrl(EMOJI_ICON_CODES.gold);
  if (t.includes("silver")) return localIconUrlForKey("silver") || twemojiUrl(EMOJI_ICON_CODES.silver);
  if (t.includes("copper")) return localIconUrlForKey("copper") || twemojiUrl(EMOJI_ICON_CODES.copper);
  if (t.includes("nasdaq")) return localIconUrlForKey("nasdaq") || twemojiUrl("1f4c8");
  if (t.includes("s&p") || t.includes("sp500") || t.includes("s&p 500")) return localIconUrlForKey("spx") || twemojiUrl("1f4c9");
  if (t.includes("dax")) return localIconUrlForKey("dax") || twemojiUrl("1f1e9-1f1ea");
  if (t.includes("coffee")) return twemojiUrl(EMOJI_ICON_CODES.coffee);
  return twemojiUrl("1f30d");
}

export function AssetIcon({
  iconKey,
  category,
  assetName = "",
  className = "",
}: {
  iconKey: string;
  category: string;
  assetName?: string;
  className?: string;
}) {
  const [imgError, setImgError] = useState(false);
  const key = String(iconKey || "").toLowerCase();
  const local = localIconUrlForKey(key);
  const isGoldTheme =
    typeof document !== "undefined" && document.body.classList.contains("ivq-theme-gold");
  const accentBorder = isGoldTheme ? "border-[#d6b24a]/45" : "border-[#2962ff]/45";
  const accentBg = isGoldTheme ? "bg-[#d6b24a]/10" : "bg-[#2962ff]/10";
  const accentText = isGoldTheme ? "text-[#fff3d1]" : "text-[#d9e4ff]";

  if (category === "Cross Pairs") {
    const [base, quote] = parseCrossPairCodes(assetName);
    const baseFlag = FX_FLAG_CODES[String(base || "").toLowerCase()];
    const quoteFlag = FX_FLAG_CODES[String(quote || "").toLowerCase()];

    if (baseFlag && quoteFlag && !imgError) {
      return (
        <span
          className={`inline-flex h-[14px] min-w-[24px] items-center justify-center gap-[2px] rounded-[4px] border ${accentBorder} ${accentBg} px-[3px] ${className}`}
        >
          <img
            src={twemojiUrl(baseFlag)}
            alt={String(base || "")}
            width={11}
            height={11}
            className="inline-block h-[11px] w-[11px] object-contain"
            loading="lazy"
            onError={() => setImgError(true)}
          />
          <img
            src={twemojiUrl(quoteFlag)}
            alt={String(quote || "")}
            width={11}
            height={11}
            className="inline-block h-[11px] w-[11px] object-contain"
            loading="lazy"
            onError={() => setImgError(true)}
          />
        </span>
      );
    }

    return (
      <span
        className={`inline-flex h-[14px] min-w-[20px] items-center justify-center rounded-[4px] border ${accentBorder} ${accentBg} px-[4px] text-[9px] font-semibold ${accentText} ${className}`}
      >
        {String(base || "").slice(0, 2)}/{String(quote || "").slice(0, 2)}
      </span>
    );
  }

  if (category === "Equities" || category === "Stocks") {
    if (local && !imgError) {
      return (
        <img
          src={local}
          alt={key}
          width={14}
          height={14}
          className={`inline-block h-[14px] w-[14px] object-contain ${className}`}
          loading="lazy"
          onError={() => setImgError(true)}
        />
      );
    }
    const badge = category === "Stocks"
      ? String(assetName || key || "STK").toUpperCase().split(".")[0].slice(0, 4)
      : (EQUITY_BADGES[key] ?? "IDX");
    return (
      <span
        className={`inline-flex h-[14px] min-w-[20px] items-center justify-center rounded-[4px] border ${accentBorder} ${accentBg} px-1 text-[9px] font-semibold ${accentText} ${className}`}
      >
        {badge}
      </span>
    );
  }

  if (local && !imgError) {
    return (
      <img
        src={local}
        alt={key}
        width={14}
        height={14}
        className={`inline-block h-[14px] w-[14px] object-contain ${className}`}
        loading="lazy"
        onError={() => setImgError(true)}
      />
    );
  }

  const fxCode = category === "FX" ? FX_FLAG_CODES[key] : undefined;
  const genericCode = EMOJI_ICON_CODES[key];
  const code = fxCode || genericCode;
  if (code && !imgError) {
    return (
      <img
        src={twemojiUrl(code)}
        alt={key}
        width={14}
        height={14}
        className={`inline-block h-[14px] w-[14px] object-contain ${className}`}
        loading="lazy"
        onError={() => setImgError(true)}
      />
    );
  }

  return (
    <span
      className={`inline-flex h-[14px] min-w-[20px] items-center justify-center rounded-[4px] border border-slate-500/50 bg-slate-900/60 px-1 text-[9px] font-semibold text-[#d9e4ff] ${className}`}
    >
      {commoditySymbol(key)}
    </span>
  );
}
