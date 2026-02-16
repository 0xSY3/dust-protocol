"use client";

import { ChakraProvider, createSystem, defaultConfig } from "@chakra-ui/react";
import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider, createConfig } from "@privy-io/wagmi";
import { http, fallback } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getSupportedChains } from "@/config/chains";
import { PRIVY_APP_ID, PRIVY_CONFIG, isPrivyEnabled } from "@/config/privy";

// Build wagmi config from chain registry with fallback RPCs
const supportedChains = getSupportedChains();
const viemChains = supportedChains.map(c => c.viemChain);
const transports = Object.fromEntries(
  supportedChains.map(c => [
    c.id,
    c.rpcUrls.length > 1
      ? fallback(c.rpcUrls.map(url => http(url))) // Multiple RPCs → fallback
      : http(c.rpcUrls[0]) // Single RPC → direct http
  ])
);

const config = createConfig({
  chains: viemChains as [typeof viemChains[0], ...typeof viemChains],
  transports,
});

const queryClient = new QueryClient();

// Custom Chakra system — force dark theme for all components
const darkSystem = createSystem(defaultConfig, {
  globalCss: {
    "html, body": {
      bg: "#06080F",
      color: "rgba(255,255,255,0.92)",
      colorScheme: "dark",
    },
  },
});

export function Providers({ children }: { children: React.ReactNode }) {
  // Skip Privy wrapping when appId is not configured (prevents crash)
  if (!isPrivyEnabled) {
    return (
      <QueryClientProvider client={queryClient}>
        <ChakraProvider value={darkSystem}>{children}</ChakraProvider>
      </QueryClientProvider>
    );
  }

  return (
    <PrivyProvider appId={PRIVY_APP_ID} config={PRIVY_CONFIG}>
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={config}>
          <ChakraProvider value={darkSystem}>{children}</ChakraProvider>
        </WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
