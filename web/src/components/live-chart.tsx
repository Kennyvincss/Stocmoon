"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  CandlestickSeries, ColorType, createChart, LineStyle,
  type CandlestickData, type IChartApi, type IPriceLine, type ISeriesApi, type UTCTimestamp,
} from "lightweight-charts";
import { apiGet, useHistory } from "@/lib/api";
import { useTheme } from "@/components/providers";
import { useNow } from "@/hooks/useNow";
import { cn } from "@/lib/utils";
import { fmtUsd } from "@/lib/format";

export interface LiveResponse {
  source: "pyth" | "reference";
  session?: "regular" | "24/7";
  liveConfigured?: boolean;
  price: number | null;
  time: number | null;
  reference: { price: number | null; time: number | null };
}

const FRAMES = [
  { id: "1s", secs: 1, history: "1H" },
  { id: "5s", secs: 5, history: "1H" },
  { id: "1m", secs: 60, history: "1D" },
  { id: "5m", secs: 300, history: "1D" },
  { id: "15m", secs: 900, history: "1W" },
  { id: "1H", secs: 3600, history: "1M" },
  { id: "1D", secs: 86400, history: "1Y" },
] as const;
type FrameId = (typeof FRAMES)[number]["id"];

const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

// Per-token tick buffers live outside React so polling can append without effects or refs.
const tickBuffers = new Map<string, { t: number; p: number }[]>();
const MAX_TICKS = 5_000;

/** Live price polled every second (display only; settlement uses the onchain Chainlink reference). */
export function useLivePrice(address: string) {
  const key = address.toLowerCase();
  return useQuery({
    queryKey: ["live", key],
    queryFn: async () => {
      const r = await apiGet<LiveResponse>(`/api/live/${address}`);
      const buf = tickBuffers.get(key) ?? [];
      if (r.price) {
        const t = Math.floor(Date.now() / 1000);
        const last = buf[buf.length - 1];
        if (!(last && last.t === t && last.p === r.price)) buf.push({ t, p: r.price });
        if (buf.length > MAX_TICKS) buf.splice(0, buf.length - MAX_TICKS);
        tickBuffers.set(key, buf);
      }
      return { ...r, ticks: buf.slice() };
    },
    refetchInterval: 1_000,
    refetchIntervalInBackground: false,
  });
}

function toCandles(ticks: { t: number; p: number }[], secs: number): CandlestickData<UTCTimestamp>[] {
  const out: CandlestickData<UTCTimestamp>[] = [];
  for (const { t, p } of ticks) {
    const b = (Math.floor(t / secs) * secs) as UTCTimestamp;
    const last = out[out.length - 1];
    if (last && last.time === b) {
      last.high = Math.max(last.high, p);
      last.low = Math.min(last.low, p);
      last.close = p;
    } else if (!last || b > last.time) {
      out.push({ time: b, open: last?.close ?? p, high: Math.max(p, last?.close ?? p), low: Math.min(p, last?.close ?? p), close: p });
    }
  }
  return out;
}

export function LiveChart({
  address, entry, sentiment,
}: { address: string; entry?: number | null; sentiment?: { up: number; label: string } | null }) {
  const [frame, setFrame] = useState<FrameId>("1m");
  const fr = FRAMES.find((f) => f.id === frame)!;
  const live = useLivePrice(address);
  const hist = useHistory(address, fr.history);
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const entryLine = useRef<IPriceLine | null>(null);
  const { theme } = useTheme();

  const d = live.data;
  const now = useNow(1_000);
  const candles = useMemo(() => {
    const ticks = d?.ticks ?? [];
    const seed = (hist.data?.points ?? []).map((p) => ({ t: p.time, p: p.value }));
    const firstLive = ticks[0]?.t ?? Infinity;
    return toCandles([...seed.filter((x) => x.t < firstLive), ...ticks], fr.secs).slice(-400);
  }, [hist.data, fr.secs, d?.ticks]);

  useEffect(() => {
    if (!el.current) return;
    const c = createChart(el.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: css("--muted"), attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { color: `${css("--border")}66` } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: true, rightOffset: 4 },
      crosshair: { horzLine: { labelBackgroundColor: css("--surface-2") }, vertLine: { labelBackgroundColor: css("--surface-2") } },
    });
    chart.current = c;
    series.current = c.addSeries(CandlestickSeries, {
      upColor: css("--up"), downColor: css("--down"), wickUpColor: css("--up"), wickDownColor: css("--down"), borderVisible: false,
    });
    return () => {
      c.remove();
      chart.current = null;
      series.current = null;
      entryLine.current = null;
    };
  }, []);

  useEffect(() => {
    series.current?.applyOptions({ upColor: css("--up"), downColor: css("--down"), wickUpColor: css("--up"), wickDownColor: css("--down") });
    chart.current?.applyOptions({ layout: { textColor: css("--muted"), background: { type: ColorType.Solid, color: "transparent" } } });
  }, [theme]);

  const lastFrame = useRef<string>("");
  useEffect(() => {
    const s = series.current;
    if (!s || !candles.length) return;
    if (lastFrame.current !== frame) {
      s.setData(candles);
      chart.current?.timeScale().scrollToRealTime();
      lastFrame.current = frame;
    } else {
      s.setData(candles);
    }
    if (entryLine.current) s.removePriceLine(entryLine.current);
    entryLine.current = entry ? s.createPriceLine({ price: entry, color: css("--muted"), lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: "entry" }) : null;
  }, [candles, frame, entry]);

  const price = d?.price ?? null;
  const base = entry ?? candles[0]?.open ?? null;
  const change = price !== null && base ? price - base : null;
  const age = d?.time ? Math.floor(now / 1000) - d.time : null;
  const isLive = d?.source === "pyth" && age !== null && age < 120;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <motion.div key={price ?? 0} initial={{ opacity: 0.6 }} animate={{ opacity: 1 }} className="tabular text-4xl font-semibold tracking-tight">
            {fmtUsd(price)}
          </motion.div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            {change !== null && base ? (
              <span className={cn("tabular font-medium", change >= 0 ? "text-up" : "text-down")}>
                {change >= 0 ? "▲" : "▼"} {fmtUsd(Math.abs(change))} ({((change / base) * 100).toFixed(2)}%){entry ? " vs entry" : ""}
              </span>
            ) : null}
            <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs", isLive ? "bg-up-soft text-up" : "bg-surface-2 text-muted")}>
              <span className={cn("h-1.5 w-1.5 rounded-full", isLive ? "animate-pulse bg-up" : "bg-muted")} />
              {d?.source === "pyth"
                ? isLive ? (d.session === "24/7" ? "Live · 24/7 indicative (Pyth)" : "Live · Pyth") : "Market closed · last price"
                : d?.liveConfigured === false ? "Reference price · live feed not configured" : "Reference price"}
            </span>
            {sentiment && (
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted">
                Sentiment <b className={sentiment.up >= 0.5 ? "text-up" : "text-down"}>{sentiment.up >= 0.5 ? "UP" : "DOWN"} {Math.round(Math.max(sentiment.up, 1 - sentiment.up) * 100)}%</b>
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-1 rounded-full bg-surface-2 p-1">
          {FRAMES.map((f) => (
            <button key={f.id} onClick={() => setFrame(f.id)}
              className={cn("rounded-full px-2.5 py-1 text-xs font-medium text-muted hover:text-text", frame === f.id && "bg-surface text-text shadow-sm")}>
              {f.id}
            </button>
          ))}
        </div>
      </div>
      <div className="relative h-72 w-full sm:h-96">
        <div ref={el} className="absolute inset-0" />
        {!candles.length && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted">Waiting for price data…</div>
        )}
      </div>
      <p className="text-[11px] leading-relaxed text-muted">
        {d?.source === "pyth"
          ? "Live price: Pyth underlying share price × the token's multiplier. Display only — markets settle on the Chainlink reference price recorded onchain."
          : "Showing the Chainlink reference price, which updates on 0.5% moves or every 24h. Second-by-second movement appears once a live feed is configured."}
      </p>
    </div>
  );
}
