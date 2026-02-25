import { describe, it, expect } from 'vitest'
import { getChainConfig, getSupportedChains, isChainSupported, type ChainContracts } from '../chains'

describe('Chain config: V1 fields removed', () => {
  it('ChainContracts type does not have V1 swap fields', () => {
    const config = getChainConfig(11155111)
    const contracts = config.contracts
    // These V1 fields should not exist on the type
    expect('dustSwapPoolETH' in contracts).toBe(false)
    expect('dustSwapPoolUSDC' in contracts).toBe(false)
    expect('dustSwapHook' in contracts).toBe(false)
    expect('dustSwapVerifier' in contracts).toBe(false)
    expect('dustSwapRouter' in contracts).toBe(false)
    expect('uniswapV4SwapRouter' in contracts).toBe(false)
  })

  it('ChainConfig does not have dustSwapDeploymentBlock', () => {
    const config = getChainConfig(11155111)
    expect('dustSwapDeploymentBlock' in config).toBe(false)
  })
})

describe('Chain config: V2 fields present', () => {
  it('Eth Sepolia has V2 swap adapter', () => {
    const config = getChainConfig(11155111)
    expect(config.contracts.dustSwapAdapterV2).toBe('0xb91Afd19FeB4000E228243f40B8d98ea07127400')
  })

  it('Eth Sepolia has vanilla pool key', () => {
    const config = getChainConfig(11155111)
    const key = config.contracts.dustSwapVanillaPoolKey
    expect(key).not.toBeNull()
    expect(key!.currency0).toBe('0x0000000000000000000000000000000000000000')
    expect(key!.currency1).toBe('0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238')
    expect(key!.fee).toBe(500)
    expect(key!.tickSpacing).toBe(10)
    expect(key!.hooks).toBe('0x0000000000000000000000000000000000000000')
  })

  it('Eth Sepolia has Uniswap V4 infra (PoolManager, StateView, Quoter)', () => {
    const config = getChainConfig(11155111)
    expect(config.contracts.uniswapV4PoolManager).toBeTruthy()
    expect(config.contracts.uniswapV4StateView).toBeTruthy()
    expect(config.contracts.uniswapV4Quoter).toBeTruthy()
  })

  it('Thanos Sepolia has no swap support', () => {
    const config = getChainConfig(111551119090)
    expect(config.contracts.dustSwapAdapterV2).toBeNull()
    expect(config.contracts.dustSwapVanillaPoolKey).toBeNull()
    expect(config.contracts.uniswapV4PoolManager).toBeNull()
  })
})

describe('Chain config: core functions work', () => {
  it('getChainConfig returns valid config for supported chains', () => {
    const eth = getChainConfig(11155111)
    expect(eth.name).toBe('Ethereum Sepolia')
    const thanos = getChainConfig(111551119090)
    expect(thanos.name).toBe('Thanos Sepolia')
  })

  it('getChainConfig throws for unsupported chain', () => {
    expect(() => getChainConfig(999999)).toThrow('Unsupported chain')
  })

  it('getSupportedChains returns both chains', () => {
    const chains = getSupportedChains()
    expect(chains).toHaveLength(2)
  })

  it('isChainSupported works correctly', () => {
    expect(isChainSupported(11155111)).toBe(true)
    expect(isChainSupported(111551119090)).toBe(true)
    expect(isChainSupported(1)).toBe(false)
  })
})
