"use client";

import { useEffect, useRef } from "react";
import { BaselineSeries, ColorType, createChart, type UTCTimestamp } from "lightweight-charts";
import type { HistoryItem } from "@/lib/server/portfolio";

/** Cumulative net USDC flow (received − paid) from indexed transactions. */
export function PnlChart({ history }: { history: HistoryItem[] }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!el.current) return;
    const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    const c = createChart(el.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: css("--muted"), attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      rightPriceScale: { borderVisible: false }, timeScale: { borderVisible: false }, handleScale: false, handleScroll: false,
    });
    const s = c.addSeries(BaselineSeries, {
      baseValue: { type: "price", price: 0 }, topLineColor: css("--up"), bottomLineColor: css("--down"),
      topFillColor1: `${css("--up")}33`, topFillColor2: `${css("--up")}00`, bottomFillColor1: `${css("--down")}00`, bottomFillColor2: `${css("--down")}33`,
      priceLineVisible: false,
    });
    const rows = history.filter((h) => h.time && !["add_liquidity", "remove_liquidity", "claim_fees"].includes(h.action))
      .sort((a, b) => Date.parse(a.time!) - Date.parse(b.time!));
    let acc = 0;
    const points = new Map<number, number>();
    for (const h of rows) {
      acc += (Number(h.collateralOut) - Number(h.collateralIn)) / 1e6;
      points.set(Math.floor(Date.parse(h.time!) / 1000), acc);
    }
    s.setData([...points.entries()].map(([time, value]) => ({ time: time as UTCTimestamp, value })));
    c.timeScale().fitContent();
    return () => c.remove();
  }, [history]);
  return (
    <div>
      <div ref={el} className="h-48 w-full" />
      <p className="mt-2 text-xs text-muted">Net USDC received minus paid across trades and redemptions (excludes liquidity provision). Open positions are not included.</p>
    </div>
  );
}
