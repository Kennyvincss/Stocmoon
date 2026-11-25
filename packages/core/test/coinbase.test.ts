import { describe, expect, it } from "vitest";
import { fetchAllTokenizedStocks, parseTokenizedStock } from "../src/coinbase";

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";

function fakeFetch(pages: Record<string, unknown>) {
  const calls: string[] = [];
  const impl = (async (input: string) => {
    calls.push(input);
    const token = new URL(input).searchParams.get("page_token") ?? "";
    const body = pages[token];
    if (!body) return new Response("nope", { status: 500 });
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("parseTokenizedStock", () => {
  it("handles omitted optional fields and never treats missing NAV as a price", () => {
    const s = parseTokenizedStock({ contract_address: A, symbol: "NVDA", name: "NVIDIA" })!;
    expect(s.navPrice).toBeNull();
    expect(s.totalSupply).toBeNull();
    expect(s.pausedFeatures).toEqual([]);
    expect(s.apiStatus.listable).toBe(false);
    expect(s.apiStatus.reasons).toContain("No NAV/reference price published");
  });

  it("applies the multiplier to compute share-equivalent supply", () => {
    const s = parseTokenizedStock({
      contract_address: A,
      symbol: "AAPL",
      total_supply: "1000",
      multiplier: 1.02,
      nav_price: "204.5",
      nav_price_updated_at: "2026-11-20T20:00:00Z",
    })!;
    expect(s.shareEquivalentSupply).toBeCloseTo(1020);
    expect(s.navPrice).toBe(204.5);
    expect(s.apiStatus.listable).toBe(true);
  });

  it("marks paused assets as not listable", () => {
    const s = parseTokenizedStock({
      contract_address: A,
      symbol: "X",
      nav_price: 10,
      nav_price_updated_at: "2026-11-20T20:00:00Z",
      paused_features: [0],
    })!;
    expect(s.apiStatus.listable).toBe(false);
    expect(s.apiStatus.reasons[0]).toMatch(/transfer/);
  });

  it("rejects records without a valid address and zero/negative NAV", () => {
    expect(parseTokenizedStock({ symbol: "NOPE" })).toBeNull();
    expect(parseTokenizedStock({ contract_address: "0x123" })).toBeNull();
    expect(parseTokenizedStock({ contract_address: A, nav_price: 0 })!.navPrice).toBeNull();
    expect(parseTokenizedStock({ contract_address: A, nav_price: -3 })!.navPrice).toBeNull();
  });
});

describe("fetchAllTokenizedStocks", () => {
  it("follows next_page_token until absent and dedupes by address", async () => {
    const { impl, calls } = fakeFetch({
      "": { tokens: [{ contract_address: A, symbol: "A" }], next_page_token: "p2" },
      p2: { tokens: [{ contract_address: B, symbol: "B" }, { contract_address: A.toUpperCase().replace("0X", "0x"), symbol: "A2" }, { bad: 1 }] },
    });
    const r = await fetchAllTokenizedStocks({ fetchImpl: impl, pageSize: 1 });
    expect(r.pages).toBe(2);
    expect(r.stocks.map((s) => s.symbol).sort()).toEqual(["A2", "B"]);
    expect(r.skipped).toBe(1);
    expect(calls[1]).toContain("page_token=p2");
    expect(calls[0]).toContain("page_size=1");
  });

  it("throws on HTTP errors and repeated page tokens", async () => {
    const { impl } = fakeFetch({});
    await expect(fetchAllTokenizedStocks({ fetchImpl: impl })).rejects.toThrow(/HTTP 500/);
    const loop = fakeFetch({ "": { tokens: [], next_page_token: "x" }, x: { tokens: [], next_page_token: "x" } });
    await expect(fetchAllTokenizedStocks({ fetchImpl: loop.impl })).rejects.toThrow(/repeated/);
  });
});
