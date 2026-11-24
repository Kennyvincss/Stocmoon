"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useStocks } from "@/lib/api";
import { CATEGORIES } from "@/lib/categories";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { StockCard } from "@/components/cards";
import { EmptyState, StaleBanner } from "@/components/common";
import { cn } from "@/lib/utils";

type View = "popular" | "gainers" | "losers" | "recent" | "all";

export default function MarketsPage() {
  const q = useStocks();
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("popular");
  const [category, setCategory] = useState<string | null>(null);
  const [tradableOnly, setTradableOnly] = useState(false);

  const list = useMemo(() => {
    let s = q.data?.stocks ?? [];
    const needle = query.trim().toLowerCase();
    if (needle) s = s.filter((x) => x.symbol.toLowerCase().includes(needle) || x.name.toLowerCase().includes(needle) || x.address.toLowerCase() === needle);
    if (category) s = s.filter((x) => x.category === category);
    if (tradableOnly) s = s.filter((x) => x.tradable);
    const val = (x: (typeof s)[number]) => (x.totalSupply ?? 0) * (x.navPrice ?? 0);
    switch (view) {
      case "popular":
        return [...s].sort((a, b) => Number(b.tradable) - Number(a.tradable) || val(b) - val(a));
      case "gainers":
        return s.filter((x) => (x.change24h ?? 0) > 0).sort((a, b) => b.change24h! - a.change24h!);
      case "losers":
        return s.filter((x) => (x.change24h ?? 0) < 0).sort((a, b) => a.change24h! - b.change24h!);
      case "recent":
        return [...s].filter((x) => x.firstMintDate).sort((a, b) => Date.parse(b.firstMintDate!) - Date.parse(a.firstMintDate!));
      default:
        return [...s].sort((a, b) => a.symbol.localeCompare(b.symbol));
    }
  }, [q.data, query, view, category, tradableOnly]);

  const presentCategories = useMemo(() => CATEGORIES.filter((c) => q.data?.stocks.some((s) => s.category === c)), [q.data]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Markets</h1>
        <p className="text-sm text-muted">Tokenized stocks from the Base Tokenized Stocks API. Identified by contract address.</p>
      </div>
      {q.data && <StaleBanner source={q.data.source} fetchedAt={q.data.fetchedAt} error={q.data.error} />}

      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search company, ticker or contract address" className="pl-9" />
        </div>
        <Tabs value={view} onValueChange={(v) => setView(v as View)}>
          <TabsList className="w-full overflow-x-auto md:w-auto">
            <TabsTrigger value="popular">Popular</TabsTrigger>
            <TabsTrigger value="gainers">Gainers</TabsTrigger>
            <TabsTrigger value="losers">Losers</TabsTrigger>
            <TabsTrigger value="recent">Recent</TabsTrigger>
            <TabsTrigger value="all">A–Z</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <button onClick={() => setTradableOnly((v) => !v)}
          className={cn("rounded-full px-3 py-1 text-xs font-medium", tradableOnly ? "bg-up-soft text-up" : "bg-surface-2 text-muted hover:text-text")}>
          Tradable now
        </button>
        <span className="mx-1 h-4 w-px bg-border" />
        {presentCategories.map((c) => (
          <button key={c} onClick={() => setCategory(category === c ? null : c)}
            className={cn("rounded-full px-3 py-1 text-xs font-medium", category === c ? "bg-accent text-accent-fg" : "bg-surface-2 text-muted hover:text-text")}>
            {c}
          </button>
        ))}
      </div>

      {q.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 9 }, (_, i) => <Skeleton key={i} className="h-[74px]" />)}</div>
      ) : q.isError ? (
        <EmptyState title="Couldn't load stocks" body={(q.error as Error).message} />
      ) : list.length === 0 ? (
        <EmptyState title="No stocks match"
          body={view === "gainers" || view === "losers" ? "24h changes are only shown when they can be verified from recorded reference prices." : "Try a different search or filter."} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{list.map((s, i) => <StockCard key={s.address} stock={s} index={i} />)}</div>
      )}
    </div>
  );
}
