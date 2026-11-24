import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { Providers } from "@/components/providers";
import { AppShell } from "@/components/shell/app-shell";
import { publicEnv } from "@/lib/public-env";

export const metadata: Metadata = {
  metadataBase: new URL(publicEnv.appUrl),
  title: { default: "StocMoon — programmable stock markets on Base", template: "%s · StocMoon" },
  description: "Predict whether tokenized stocks go UP or DOWN. USDC-settled prediction markets on Base, priced by an onchain AMM and settled on Chainlink reference prices.",
  openGraph: { title: "StocMoon", description: "Programmable stock markets on Base", images: ["/api/og/market/0"] },
};

export const viewport: Viewport = {
  themeColor: [{ media: "(prefers-color-scheme: dark)", color: "#0a0a0b" }, { media: "(prefers-color-scheme: light)", color: "#f7f7f5" }],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <body className="font-sans">
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
