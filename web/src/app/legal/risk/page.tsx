import type { Metadata } from "next";
import { LegalPage } from "../legal-page";

export const metadata: Metadata = { title: "Risk Disclosure" };

export default function Risk() {
  return (
    <LegalPage title="Risk Disclosure" updated="24 Nov 2026">
      <h2>Loss of funds</h2>
      <p>Outcome shares on the losing side are worth zero at settlement. Early exits are priced by the AMM and may return much less than you paid.</p>
      <h2>Reference prices are not trading prices</h2>
      <p>Settlement uses Chainlink tokenized-equity reference values (underlying price × issuer multiplier). They can differ from prices on any exchange, are smoothed in overnight sessions, lag fast moves, and hold their last value on weekends, US market holidays and during corporate-action pauses.</p>
      <h2>Stale or unavailable data</h2>
      <p>If no sufficiently fresh price can be proved for the close time, a market resolves as INVALID and every share redeems for 0.50 USDC, which may be less than you paid.</p>
      <h2>Testnet price mirror</h2>
      <p>On Base Sepolia, feeds are mirrored from Base mainnet by a relayer operated by StocMoon. A faulty relayer could publish wrong data; every mirrored round is auditable against mainnet.</p>
      <h2>AMM and liquidity</h2>
      <p>Liquidity providers take the opposite side of traders and can lose value; withdrawn liquidity may be returned partly as outcome shares. Thin liquidity means high price impact.</p>
      <h2>Smart contracts</h2>
      <p>The contracts are tested but unaudited. Bugs could lead to loss of funds. Administrative roles (guardian, resolver, config) exist and are described on the How it works page.</p>
      <h2>Event markets</h2>
      <p>Earnings markets depend on a human resolver and a dispute window. Resolution can be wrong or delayed.</p>
      <h2>Regulatory</h2>
      <p>Prediction markets and tokenized securities are regulated differently across jurisdictions. Access may be restricted or withdrawn at any time.</p>
    </LegalPage>
  );
}
