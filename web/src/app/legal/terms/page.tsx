import type { Metadata } from "next";
import { LegalPage } from "../legal-page";

export const metadata: Metadata = { title: "Terms of Service" };

export default function Terms() {
  return (
    <LegalPage title="Terms of Service" updated="24 Nov 2026">
      <h2>1. What StocMoon is</h2>
      <p>StocMoon is software that lets you interact with smart contracts on Base implementing binary prediction markets that settle on reference prices of tokenized stocks. StocMoon does not hold your funds; positions are held by your own wallet and the contracts.</p>
      <h2>2. Eligibility</h2>
      <ul>
        <li>You must be at least 18 years old.</li>
        <li>You must not be a resident, citizen or located in the United States, or in any jurisdiction where these markets are restricted or sanctioned (including Cuba, Iran, North Korea and Syria). The interface blocks these regions and requires a signed attestation; using a VPN or other means to circumvent restrictions is prohibited.</li>
        <li>You must not be on any sanctions list.</li>
      </ul>
      <h2>3. Testnet</h2>
      <p>The current deployment runs on Base Sepolia. Test USDC and outcome shares have no monetary value and cannot be redeemed for anything of value.</p>
      <h2>4. No affiliation or endorsement</h2>
      <p>StocMoon is independent. It is not affiliated with, endorsed or sponsored by Base, Coinbase, Moon, Chainlink, Circle, or any issuer of the underlying equities.</p>
      <h2>5. Tokenized stocks</h2>
      <p>StocMoon markets reference tokenized stocks but do not require holding them. Holding a tokenized stock does not by itself confer voting rights, direct ownership or other shareholder benefits; see the issuer&apos;s documentation.</p>
      <h2>6. Settlement</h2>
      <p>Each market&apos;s settlement rules are fixed in the smart contract at creation and described on the market page. Outcomes are determined by the contracts and the oracle data they verify, not by StocMoon&apos;s discretion, except for event markets, which follow the resolver and dispute process stated in their rules.</p>
      <h2>7. Risks</h2>
      <p>See the <a className="underline" href="/legal/risk">Risk Disclosure</a>. You can lose the full amount you put into a position.</p>
      <h2>8. No advice</h2>
      <p>Nothing on StocMoon is investment, legal or tax advice. Implied odds are market prices, not predictions.</p>
      <h2>9. Liability</h2>
      <p>The software is provided &quot;as is&quot; without warranties. To the maximum extent permitted by law, contributors are not liable for losses arising from its use, smart-contract bugs, oracle failures or network outages.</p>
    </LegalPage>
  );
}
