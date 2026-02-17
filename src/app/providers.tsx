"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider, createConfig } from "@privy-io/wagmi";
import { http, fallback } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getSupportedChains } from "@/config/chains";
import { PRIVY_APP_ID, PRIVY_CONFIG, isPrivyEnabled } from "@/config/privy";

const supportedChains = getSupportedChains();
const viemChains = supportedChains.map(c => c.viemChain);
const transports = Object.fromEntries(
  supportedChains.map(c => [
    c.id,
    c.rpcUrls.length > 1
      ? fallback(c.rpcUrls.map(url => http(url)))
      : http(c.rpcUrls[0])
  ])
);

const config = createConfig({
  chains: viemChains as [typeof viemChains[0], ...typeof viemChains],
  transports,
});

const queryClient = new QueryClient();

export function Providers({ children }: { children: React.ReactNode }) {
  if (!isPrivyEnabled) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  }

  return (
    <PrivyProvider appId={PRIVY_APP_ID} config={PRIVY_CONFIG}>
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={config}>
          {children}
        </WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
