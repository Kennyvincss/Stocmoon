"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Moon, Sun } from "lucide-react";
import { useAccount, useReadContract } from "wagmi";
import { erc20Abi } from "viem";
import { motion } from "framer-motion";
import { Logo } from "@/components/logo";
import { useTheme } from "@/components/providers";
import { NAV, isActive } from "./nav";
import { MarketTicker } from "./market-ticker";
import { cn } from "@/lib/utils";
import { contractsConfigured, isTestnet, publicEnv } from "@/lib/public-env";
import { appChain } from "@/lib/wagmi";
import { fmtUsdc } from "@/lib/format";
import { usePortfolio } from "@/lib/api";

function PortfolioShortcut() {
  const { address } = useAccount();
  const bal = useReadContract({
    address: publicEnv.usdc, abi: erc20Abi, functionName: "balanceOf", args: address ? [address] : undefined,
    query: { enabled: Boolean(address && publicEnv.usdc), refetchInterval: 15_000 },
  });
  const p = usePortfolio(address);
  if (!address) {
    return <p className="text-xs leading-relaxed text-muted">Connect a wallet to see your balance and positions.</p>;
  }
  const open = p.data?.positions.filter((x) => x.bucket === "open").length ?? 0;
  const claim = p.data?.positions.filter((x) => x.bucket === "claimable").length ?? 0;
  return (
    <Link href="/portfolio" className="block space-y-2 rounded-xl bg-surface-2 p-3 text-sm hover:bg-border">
      <div className="text-xs text-muted">Available</div>
      <div className="tabular font-semibold">{bal.data !== undefined ? fmtUsdc(bal.data) : "…"}</div>
      <div className="flex gap-3 text-xs text-muted">
        <span>{open} open</span>
        <span className={cn(claim > 0 && "font-medium text-up")}>{claim} claimable</span>
      </div>
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { theme, toggle } = useTheme();
  return (
    <div className="min-h-dvh">
      {/* desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-border bg-surface px-4 py-5 lg:flex">
        <Link href="/" className="px-2"><Logo /></Link>
        <nav className="mt-8 flex flex-col gap-1">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link key={href} href={href}
                className={cn("relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted transition-colors hover:text-text",
                  active && "text-text")}>
                {active && <motion.span layoutId="nav-pill" className="absolute inset-0 rounded-xl bg-surface-2" transition={{ type: "spring", duration: 0.35 }} />}
                <Icon className="relative h-4 w-4" />
                <span className="relative">{label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto space-y-4">
          <PortfolioShortcut />
          <div className="flex flex-wrap gap-x-3 gap-y-1 px-1 text-xs text-muted">
            <Link href="/how-it-works" className="hover:text-text">How it works</Link>
            <Link href="/legal/terms" className="hover:text-text">Terms</Link>
            <Link href="/legal/risk" className="hover:text-text">Risk</Link>
            <Link href="/legal/privacy" className="hover:text-text">Privacy</Link>
          </div>
        </div>
      </aside>

      <div className="lg:pl-60">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-border bg-bg/85 px-4 backdrop-blur md:px-8">
          <Link href="/" className="lg:hidden"><Logo withText={false} /></Link>
          <div className="hidden items-center gap-2 text-xs text-muted lg:flex">
            <span className={cn("h-2 w-2 rounded-full", contractsConfigured ? "bg-up" : "bg-warn")} />
            {appChain.name}{isTestnet && " · testnet funds have no value"}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={toggle} className="rounded-full p-2 text-muted hover:bg-surface-2 hover:text-text" aria-label="Toggle theme">
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <ConnectButton chainStatus="icon" accountStatus={{ smallScreen: "avatar", largeScreen: "full" }} showBalance={false} />
          </div>
        </header>

        {contractsConfigured && <MarketTicker />}

        {isTestnet && (
          <div className="border-b border-border bg-warn-soft px-4 py-2 text-center text-xs text-warn md:px-8">
            {appChain.name} testnet. Test USDC and outcome shares have no monetary value. Reference prices are mirrored from Base mainnet Chainlink feeds.
          </div>
        )}

        <main className="mx-auto w-full max-w-6xl px-4 pb-28 pt-6 md:px-8 lg:pb-16">{children}</main>

        <footer className="mx-auto max-w-6xl px-4 pb-28 text-xs leading-relaxed text-muted md:px-8 lg:pb-10">
          StocMoon is an independent project and is not affiliated with or endorsed by Base, Coinbase, Moon, Chainlink or any
          stock issuer. Markets settle on reference (NAV) prices, which are not executable trading prices. Prediction markets
          are risky: you can lose the full amount you put into a position. Not available to US persons or restricted jurisdictions.
        </footer>
      </div>

      {/* mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-6 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href}
            className={cn("flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium text-muted", isActive(pathname, href) && "text-text")}>
            <Icon className="h-5 w-5" />
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
