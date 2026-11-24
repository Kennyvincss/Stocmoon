import type { Metadata } from "next";
import { LegalPage } from "../legal-page";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function Privacy() {
  return (
    <LegalPage title="Privacy Policy" updated="24 Nov 2026">
      <h2>What we store</h2>
      <ul>
        <li>Public blockchain data about StocMoon contracts (addresses, transactions), which is public by nature.</li>
        <li>Optional profile data you sign: username and avatar URL.</li>
        <li>Eligibility attestations: wallet address, detected country, the signed message, and a salted hash of your IP address.</li>
        <li>Cached tokenized-stock reference data from the public Base Tokenized Stocks API.</li>
      </ul>
      <h2>What we don&apos;t store</h2>
      <p>No private keys, seed phrases, emails or names. We never ask for them.</p>
      <h2>Why</h2>
      <p>To operate the interface, enforce jurisdiction restrictions, prevent replayed signatures and show leaderboards.</p>
      <h2>Third parties</h2>
      <p>Your wallet provider, RPC providers and hosting/CDN providers process your requests under their own policies. The interface reads country information from CDN geolocation headers.</p>
      <h2>Contact & deletion</h2>
      <p>You can overwrite your profile at any time. Onchain data cannot be deleted by anyone.</p>
    </LegalPage>
  );
}
