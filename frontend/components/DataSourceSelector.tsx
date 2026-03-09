"use client";

type DataSource = "tradingview" | "dukascopy" | "yahoo";

type Props = {
  value: DataSource;
  onChange: (next: DataSource) => void;
};

export default function DataSourceSelector({ value, onChange }: Props) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      <button type="button" onClick={() => onChange("tradingview")} className={`ivq-glass-btn ${value === "tradingview" ? "is-active" : ""}`}>
        TradingView
      </button>
      <button type="button" onClick={() => onChange("dukascopy")} className={`ivq-glass-btn ${value === "dukascopy" ? "is-active" : ""}`}>
        Dukascopy
      </button>
      <button type="button" onClick={() => onChange("yahoo")} className={`ivq-glass-btn ${value === "yahoo" ? "is-active" : ""}`}>
        Yahoo
      </button>
    </div>
  );
}