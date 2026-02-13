"use client";

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider, createConfig } from "@privy-io/wagmi";
import { http } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getSupportedChains } from "@/config/chains";
import { PRIVY_APP_ID, PRIVY_CONFIG } from "@/config/privy";

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
    <PrivyProvider appId={PRIVY_APP_ID} config={PRIVY_CONFIG}>
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={config}>
          <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
        </WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
