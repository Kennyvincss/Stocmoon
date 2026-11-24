"use client";

import "@rainbow-me/rainbowkit/styles.css";
import { darkTheme, lightTheme, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, createContext, useContext } from "react";
import { WagmiProvider } from "wagmi";
import { wagmiConfig, appChain } from "@/lib/wagmi";

type Theme = "dark" | "light";
const ThemeCtx = createContext<{ theme: Theme; toggle: () => void }>({ theme: "dark", toggle: () => {} });
export const useTheme = () => useContext(ThemeCtx);

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 5_000, retry: 1, refetchOnWindowFocus: false } } }),
  );
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const saved = (typeof window !== "undefined" && localStorage.getItem("stocmoon-theme")) as Theme | null;
    if (saved === "light" || saved === "dark") setTheme(saved);
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("stocmoon-theme", theme);
  }, [theme]);

  const rk = theme === "dark"
    ? darkTheme({ accentColor: "#f4f4f2", accentColorForeground: "#0a0a0b", borderRadius: "large", overlayBlur: "small" })
    : lightTheme({ accentColor: "#111113", accentColorForeground: "#ffffff", borderRadius: "large", overlayBlur: "small" });

  return (
    <ThemeCtx.Provider value={{ theme, toggle: () => setTheme((t) => (t === "dark" ? "light" : "dark")) }}>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <RainbowKitProvider theme={rk} initialChain={appChain} modalSize="compact" appInfo={{ appName: "StocMoon", learnMoreUrl: "/how-it-works" }}>
            {children}
          </RainbowKitProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </ThemeCtx.Provider>
  );
}
