"use client";

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { WagmiProvider, createConfig, http } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { defineChain } from "viem";

// Define Thanos Sepolia chain
const thanosSepolia = defineChain({
  id: 111551119090,
  name: "Thanos Sepolia",
  nativeCurrency: {
    decimals: 18,
    name: "TON",
    symbol: "TON",
  },
  rpcUrls: {
    default: {
      http: ["https://rpc.thanos-sepolia.tokamak.network"],
    },
  },
  blockExplorers: {
    default: {
      name: "Thanos Explorer",
      url: "https://explorer.thanos-sepolia.tokamak.network",
    },
  },
  testnet: true,
});

const config = createConfig({
  chains: [thanosSepolia],
  transports: {
    [thanosSepolia.id]: http(),
  },
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
