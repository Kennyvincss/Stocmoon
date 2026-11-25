import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import { coinbaseWallet, injectedWallet, metaMaskWallet, rainbowWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { chainFor } from "@stocmoon/core";
import { publicEnv } from "./public-env";

export const appChain = chainFor(publicEnv.chainId);

const projectId = publicEnv.walletConnectProjectId;
const connectors = connectorsForWallets(
  [
    {
      groupName: "Recommended",
      // WalletConnect-based wallets need a project id; without one we offer injected + Coinbase Wallet only.
      wallets: projectId ? [coinbaseWallet, metaMaskWallet, rainbowWallet, walletConnectWallet] : [coinbaseWallet, injectedWallet],
    },
  ],
  { appName: "StocMoon", projectId: projectId ?? "walletconnect-disabled" },
);

export const wagmiConfig = createConfig({
  chains: [appChain],
  connectors,
  transports: { [appChain.id]: http(publicEnv.rpcUrl) } as Record<number, ReturnType<typeof http>>,
  ssr: true,
});
