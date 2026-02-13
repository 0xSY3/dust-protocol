"use client";

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { WagmiProvider, createConfig, http } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getSupportedChains } from "@/config/chains";

// Build wagmi config from chain registry
const supportedChains = getSupportedChains();
const viemChains = supportedChains.map(c => c.viemChain);
const transports = Object.fromEntries(
  supportedChains.map(c => [c.id, http(c.rpcUrl)])
);

const config = createConfig({
  chains: viemChains as [typeof viemChains[0], ...typeof viemChains],
  transports,
});

const queryClient = new QueryClient();

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
