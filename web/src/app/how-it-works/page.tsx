import type { Metadata } from "next";

export const metadata: Metadata = { title: "How it works" };

const sections = [
  {
    h: "What you're trading",
    p: [
      "Every StocMoon market is a YES/NO question with two outcome shares. In an UP/DOWN market, UP pays if the stock's reference price at close is higher than at open; DOWN pays if it's lower.",
      "A winning share redeems for exactly 1 USDC. A losing share redeems for 0. If the price is exactly equal (a push) or the market can't be settled on a valid price (invalid), every share redeems for 0.50 USDC.",
      "This is not leverage and not a perpetual. Your maximum loss is what you paid.",
    ],
  },
  {
    h: "Where prices come from",
    p: [
      "Stocks and their contract addresses come from the public Base Tokenized Stocks API (Coinbase-issued B20 tokens). Assets are identified by contract address, never by ticker.",
      "Settlement uses Chainlink's tokenized-equity feeds: underlying equity price × the token's multiplier. This reference price is not a bid, ask or execution price.",
      "On Base Sepolia (testnet) there are no official equity feeds, so StocMoon runs a transparent mirror that copies Base mainnet Chainlink rounds; each mirrored round records the mainnet round id so anyone can audit it.",
    ],
  },
  {
    h: "How share prices are set",
    p: [
      "Each market has an onchain automated market maker (a fixed-product market maker over YES/NO shares, collateralised 1:1 in USDC). Buying a side makes it more expensive; the price is the market's implied probability, not a forecast by StocMoon.",
      "Every trade states a minimum output (1% slippage limit) and a deadline. Quotes are indicative until the transaction confirms.",
      "Fees (shown before you confirm) go to liquidity providers and the protocol. You can close a position early by selling it back to the AMM until trading stops.",
    ],
  },
  {
    h: "How settlement works",
    p: [
      "At creation the contract records the opening reference price. After close plus a short settlement delay, anyone can settle by pointing the contract at the feed round that was in effect at the close time; the contract verifies the round and its successor itself.",
      "Feeds run 24/5 (Sun 8pm – Fri 8pm ET) and hold their last value on weekends, holidays and during corporate-action pauses. A closing price older than the market's staleness limit is rejected. If no valid price can be proved within the resolution window, anyone can mark the market INVALID and everyone gets 0.50 per share.",
      "All settlement parameters are copied into the market when it's created. No administrator can change them afterwards. The guardian can pause new trading or invalidate an unresolved market in an emergency; both actions are public onchain events, and exits (redeem, merge, withdraw liquidity) are never blocked.",
    ],
  },
  {
    h: "Stock Battles & earnings",
    p: [
      "Battles compare two stocks' percentage returns, (close − open) / open, over the same window, using the same settlement rules for both feeds.",
      "Earnings markets are resolved by a designated resolver against the public source written into the market's rules (e.g. the company's earnings release or SEC filing), with a dispute window before finalization. StocMoon never publishes its own estimates.",
    ],
  },
];

export default function HowItWorks() {
  return (
    <article className="mx-auto max-w-3xl space-y-10">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">How StocMoon works</h1>
        <p className="mt-2 text-muted">Everything that decides who gets paid is onchain and fixed before you enter a market.</p>
      </header>
      {sections.map((s) => (
        <section key={s.h} className="space-y-3">
          <h2 className="text-lg font-semibold">{s.h}</h2>
          {s.p.map((t) => <p key={t} className="leading-relaxed text-muted">{t}</p>)}
        </section>
      ))}
    </article>
  );
}
