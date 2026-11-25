import { ImageResponse } from "next/og";
import { feedToNumber } from "@stocmoon/core";
import { getMarket } from "@/lib/server/markets";

export const dynamic = "force-dynamic";

/** Share card for a market or position (`?side=UP`). All values come from chain state. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  const market = Number.isSafeInteger(id) && id > 0 ? await getMarket(id).catch(() => null) : null;
  const side = (new URL(req.url).searchParams.get("side") ?? "").slice(0, 12).replace(/[^A-Za-z]/g, "");
  const a = market?.assetMetaA?.symbol ?? "—";
  const b = market?.assetMetaB?.symbol ?? "";
  const dec = market?.assetMetaA?.decimals ?? 8;
  const title = !market ? "StocMoon" : market.kind === "BATTLE" ? `${a} vs ${b}` : market.kind === "EVENT" ? a : `${a} · UP or DOWN`;
  const sub = !market
    ? "Programmable stock markets on Base"
    : market.kind === "UP_DOWN"
      ? `From $${feedToNumber(market.openPriceA, dec).toFixed(2)} · closes ${new Date(market.closeTime * 1000).toUTCString().slice(5, 22)} UTC`
      : (market.question ?? "Which stock has the higher % return?");
  const pct = market ? Math.round(market.priceYes * 100) : 50;
  const status = !market ? "" : market.phase === "resolved" ? `Resolved: ${market.outcome}` : `Market odds ${pct}% / ${100 - pct}%`;
  const up = !["DOWN", "NO"].includes(side.toUpperCase());
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between",
          background: "#0a0a0b", color: "#f4f4f2", padding: 64, fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 28, color: "#8b8d93" }}>
          <div style={{ width: 28, height: 28, borderRadius: 14, background: "#f4f4f2" }} />
          {`StocMoon · Market #${market?.id ?? ""}`}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ fontSize: 80, fontWeight: 700, letterSpacing: -2 }}>{title}</div>
          <div style={{ fontSize: 32, color: "#8b8d93" }}>{sub}</div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          {side ? (
            <div
              style={{
                display: "flex", fontSize: 44, fontWeight: 700, padding: "12px 32px", borderRadius: 999,
                background: up ? "#0f2a1f" : "#2e1416", color: up ? "#2fd08a" : "#ff5c63",
              }}
            >
              {side.toUpperCase()}
            </div>
          ) : (
            <div style={{ display: "flex" }} />
          )}
          <div style={{ fontSize: 28, color: "#8b8d93" }}>{status}</div>
        </div>
      </div>
    ),
    { width: 1200, height: 630, headers: { "cache-control": "public, max-age=60" } },
  );
}
