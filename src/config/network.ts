import { defineChain } from "viem";

export const l2Chain = defineChain({
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

export const THANOS_SEPOLIA_CHAIN_ID = 111551119090;
export const THANOS_RPC_URL = "https://rpc.thanos-sepolia.tokamak.network";
export const THANOS_EXPLORER_URL = "https://explorer.thanos-sepolia.tokamak.network";
