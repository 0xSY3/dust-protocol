import { describe, it, expect } from 'vitest'
import { getChainConfig, getSupportedChains } from '@/config/chains'

describe('Swap config: dustSwapAdapterV2 presence', () => {
  it('Arb Sepolia (421614) has dustSwapAdapterV2 set', () => {
    // #given Arbitrum Sepolia has a deployed DustSwapAdapterV2
    // #when fetching the chain config
    const config = getChainConfig(421614)
    // #then dustSwapAdapterV2 is non-null
    expect(config.contracts.dustSwapAdapterV2).not.toBeNull()
    expect(config.contracts.dustSwapAdapterV2).toBeTruthy()
  })

  it('Base Sepolia (84532) has dustSwapAdapterV2 set', () => {
    // #given Base Sepolia has a deployed DustSwapAdapterV2
    // #when fetching the chain config
    const config = getChainConfig(84532)
    // #then dustSwapAdapterV2 is non-null
    expect(config.contracts.dustSwapAdapterV2).not.toBeNull()
    expect(config.contracts.dustSwapAdapterV2).toBeTruthy()
  })

  it('OP Sepolia (11155420) has null dustSwapAdapterV2', () => {
    // #given OP Sepolia has no Uniswap V4 infrastructure
    // #when fetching the chain config
    const config = getChainConfig(11155420)
    // #then dustSwapAdapterV2 is null
    expect(config.contracts.dustSwapAdapterV2).toBeNull()
  })
})

describe('Swap config: dustSwapVanillaPoolKey', () => {
  it('Arb Sepolia has null dustSwapVanillaPoolKey (pool keys disabled)', () => {
    // #given Arb Sepolia pool is not initialized — swap disabled via null pool key
    // #when fetching the chain config
    const config = getChainConfig(421614)
    // #then dustSwapVanillaPoolKey is null
    expect(config.contracts.dustSwapVanillaPoolKey).toBeNull()
  })

  it('Base Sepolia has null dustSwapVanillaPoolKey (pool keys disabled)', () => {
    // #given Base Sepolia vanilla pool is not initialized yet
    // #when fetching the chain config
    const config = getChainConfig(84532)
    // #then dustSwapVanillaPoolKey is null
    expect(config.contracts.dustSwapVanillaPoolKey).toBeNull()
  })

  it('Eth Sepolia has non-null dustSwapVanillaPoolKey', () => {
    // #given Eth Sepolia has an initialized vanilla ETH/USDC pool
    // #when fetching the chain config
    const config = getChainConfig(11155111)
    // #then dustSwapVanillaPoolKey is present with valid pool parameters
    expect(config.contracts.dustSwapVanillaPoolKey).not.toBeNull()
    expect(config.contracts.dustSwapVanillaPoolKey!.currency0).toBeTruthy()
    expect(config.contracts.dustSwapVanillaPoolKey!.currency1).toBeTruthy()
    expect(config.contracts.dustSwapVanillaPoolKey!.fee).toBeGreaterThan(0)
    expect(config.contracts.dustSwapVanillaPoolKey!.tickSpacing).toBeGreaterThan(0)
  })
})
