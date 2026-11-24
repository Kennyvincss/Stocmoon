"use client";

import { useEffect, useRef, useState } from "react";
import { AreaSeries, ColorType, createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { useHistory } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useTheme } from "@/components/providers";

const RANGES = ["1H", "4H", "1D", "1W", "1M", "1Y"] as const;

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function PriceChart({ address, openPrice }: { address: string; openPrice?: number | null }) {
  const [range, setRange] = useState<(typeof RANGES)[number]>("1D");
  const q = useHistory(address, range);
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<"Area"> | null>(null);
  const { theme } = useTheme();

  const points = q.data?.points ?? [];
  const first = points[0]?.value;
  const last = points[points.length - 1]?.value;
  const up = first !== undefined && last !== undefined ? last >= first : true;

  useEffect(() => {
    if (!el.current) return;
    const c = createChart(el.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: cssVar("--muted"), attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true },
      crosshair: { horzLine: { labelBackgroundColor: cssVar("--surface-2") }, vertLine: { labelBackgroundColor: cssVar("--surface-2") } },
      handleScale: false,
      handleScroll: false,
    });
    chart.current = c;
    series.current = c.addSeries(AreaSeries, { lineWidth: 2, priceLineVisible: false });
    return () => {
      c.remove();
      chart.current = null;
      series.current = null;
    };
  }, []);

  useEffect(() => {
    const color = cssVar(up ? "--up" : "--down");
    series.current?.applyOptions({ lineColor: color, topColor: `${color}33`, bottomColor: `${color}00` });
    chart.current?.applyOptions({ layout: { textColor: cssVar("--muted"), background: { type: ColorType.Solid, color: "transparent" } } });
  }, [up, theme]);

  useEffect(() => {
    if (!series.current) return;
    const dedup = new Map<number, number>();
    for (const p of points) dedup.set(p.time, p.value);
    series.current.setData([...dedup.entries()].sort((a, b) => a[0] - b[0]).map(([time, value]) => ({ time: time as UTCTimestamp, value })));
    if (openPrice) {
      series.current.createPriceLine({ price: openPrice, color: cssVar("--muted"), lineStyle: 2, lineWidth: 1, axisLabelVisible: true, title: "entry" });
    }
    chart.current?.timeScale().fitContent();
  }, [points, openPrice]);

  return (
    <div>
      <div className="relative h-64 w-full sm:h-80">
        <div ref={el} className="absolute inset-0" />
        {q.isLoading && <Skeleton className="absolute inset-0" />}
        {!q.isLoading && points.length < 2 && (
          <div className="absolute inset-0 flex items-center justify-center text-center text-sm text-muted">
            Not enough reference-price history for this range yet.
          </div>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex gap-1">
          {RANGES.map((r) => {
            const enabled = q.data ? q.data.available[r] !== false : true;
            return (
              <button key={r} disabled={!enabled} onClick={() => setRange(r)} title={enabled ? undefined : "Not enough data for this range"}
                className={cn("rounded-full px-2.5 py-1 text-xs font-medium text-muted hover:text-text disabled:opacity-30",
                  range === r && "bg-surface-2 text-text")}>
                {r}
              </button>
            );
          })}
        </div>
        <span className="hidden text-[11px] text-muted sm:block">
          {q.data?.source?.includes("chainlink") ? "Chainlink reference price" : q.data?.source === "nav-snapshots" ? "Recorded API NAV" : ""}
        </span>
      </div>
    </div>
  );
}
