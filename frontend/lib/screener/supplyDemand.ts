import type { OhlcvPoint } from "@/types";

import type { PineZone } from "@/lib/screener/types";

function candleBodyTouch(candle: OhlcvPoint, low: number, high: number): boolean {
  const bodyLow = Math.min(candle.open, candle.close);
  const bodyHigh = Math.max(candle.open, candle.close);
  return bodyHigh >= low && bodyLow <= high;
}

function closeInside(candle: OhlcvPoint, low: number, high: number): boolean {
  return candle.close >= low && candle.close <= high;
}

function zoneId(kind: "demand" | "supply", strength: "normal" | "strong", originIndex: number, start: string): string {
  return `${kind}:${strength}:${originIndex}:${start}`;
}

export function buildSupplyDemandZones(
  candles: OhlcvPoint[],
  minBarsBeforeBox: number,
): PineZone[] {
  const safeMinBars = Math.max(1, minBarsBeforeBox);
  const bull = candles.map((row) => row.close > row.open);
  const bear = candles.map((row) => row.close < row.open);
  const zones: PineZone[] = [];
  const activeDemand: PineZone[] = [];
  const activeSupply: PineZone[] = [];

  const maybeCreate = (index: number, kind: "demand" | "supply", strength: "normal" | "strong", originOffset: number) => {
    const originIndex = index - originOffset;
    if (originIndex < 0 || originIndex >= candles.length) return;
    const origin = candles[originIndex];
    const zone: PineZone = {
      id: zoneId(kind, strength, originIndex, origin.t),
      kind,
      strength,
      start: candles[index].t,
      end: candles[index].t,
      low: origin.low,
      high: origin.high,
      originIndex,
      startIndex: index,
      endIndex: index,
      active: true,
      broken: false,
      touched: false,
      inZone: false,
      lastTouchedIndex: null,
    };
    zones.push(zone);
    if (kind === "demand") {
      activeDemand.push(zone);
      return;
    }
    activeSupply.push(zone);
  };

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    if (index >= 2 + safeMinBars - 1) {
      const longCreate = bear[index - 2] && bull[index - 1] && bull[index] && candles[index - 2].high < candles[index].low;
      const shortCreate = bull[index - 2] && bear[index - 1] && bear[index] && candles[index - 2].low > candles[index].high;
      if (longCreate) maybeCreate(index, "demand", "normal", 2);
      if (shortCreate) maybeCreate(index, "supply", "normal", 2);
    }

    if (index >= 3 + safeMinBars - 1) {
      const longStrongCreate =
        bear[index - 3]
        && bull[index - 2]
        && bull[index - 1]
        && bull[index]
        && candles[index - 3].high < candles[index - 1].low
        && candles[index].low > candles[index - 3].high;
      const shortStrongCreate =
        bull[index - 3]
        && bear[index - 2]
        && bear[index - 1]
        && bear[index]
        && candles[index - 3].low > candles[index - 1].high
        && candles[index].high < candles[index - 3].low;
      if (longStrongCreate) maybeCreate(index, "demand", "strong", 3);
      if (shortStrongCreate) maybeCreate(index, "supply", "strong", 3);
    }

    const nextDemand: PineZone[] = [];
    const nextSupply: PineZone[] = [];

    for (const zone of activeDemand) {
      zone.end = candle.t;
      zone.endIndex = index;
      zone.touched = zone.touched || candleBodyTouch(candle, zone.low, zone.high);
      zone.inZone = closeInside(candle, zone.low, zone.high);
      if (zone.touched) zone.lastTouchedIndex = index;
      if (candle.close < zone.low) {
        zone.active = false;
        zone.broken = true;
      } else {
        nextDemand.push(zone);
      }
    }

    for (const zone of activeSupply) {
      zone.end = candle.t;
      zone.endIndex = index;
      zone.touched = zone.touched || candleBodyTouch(candle, zone.low, zone.high);
      zone.inZone = closeInside(candle, zone.low, zone.high);
      if (zone.touched) zone.lastTouchedIndex = index;
      if (candle.close > zone.high) {
        zone.active = false;
        zone.broken = true;
      } else {
        nextSupply.push(zone);
      }
    }

    activeDemand.splice(0, activeDemand.length, ...nextDemand);
    activeSupply.splice(0, activeSupply.length, ...nextSupply);
  }

  return zones;
}

export function pickRelevantZones(candles: OhlcvPoint[], zones: PineZone[]) {
  const latest = candles.at(-1);
  if (!latest) {
    return {
      demand: null as PineZone | null,
      supply: null as PineZone | null,
      strongestDemand: null as PineZone | null,
      strongestSupply: null as PineZone | null,
    };
  }

  const distance = (zone: PineZone) => {
    if (latest.close >= zone.low && latest.close <= zone.high) return 0;
    return Math.min(Math.abs(latest.close - zone.low), Math.abs(latest.close - zone.high));
  };

  const active = zones.filter((zone) => zone.active || zone.endIndex === candles.length - 1);
  const demand = active.filter((zone) => zone.kind === "demand").sort((left, right) => distance(left) - distance(right))[0] ?? null;
  const supply = active.filter((zone) => zone.kind === "supply").sort((left, right) => distance(left) - distance(right))[0] ?? null;
  const strongestDemand = active.filter((zone) => zone.kind === "demand" && zone.strength === "strong").sort((left, right) => distance(left) - distance(right))[0] ?? null;
  const strongestSupply = active.filter((zone) => zone.kind === "supply" && zone.strength === "strong").sort((left, right) => distance(left) - distance(right))[0] ?? null;

  return { demand, supply, strongestDemand, strongestSupply };
}
