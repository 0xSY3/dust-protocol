// Gelato Relay configuration
// Uses 1Balance for managed, multi-chain gas sponsorship

export const GELATO_API_KEY = process.env.GELATO_API_KEY || '';

// Chains where Gelato Relay is available for sponsoredCall
// Thanos Sepolia is NOT supported by Gelato — uses sponsor wallet fallback
const GELATO_SUPPORTED_CHAIN_IDS = new Set<number>([
  11155111,   // Ethereum Sepolia
  // Add mainnet chains here as we expand:
  // 1,       // Ethereum Mainnet
  // 10,      // Optimism
  // 137,     // Polygon
  // 42161,   // Arbitrum One
  // 8453,    // Base
]);

export function isGelatoSupported(chainId: number): boolean {
  return GELATO_SUPPORTED_CHAIN_IDS.has(chainId);
}

export function isGelatoConfigured(): boolean {
  return GELATO_API_KEY.length > 0;
}
