import { describe, it, expect } from 'vitest'
import {
  buildDepositLink,
  buildDepositCalldata,
  parseDepositLink,
} from '../deposit-link'

describe('deposit-link', () => {
  const poolAddress = '0x3cbf3459e7E0E9Fd2fd86a28c426CED2a60f023f'
  const commitment = '0x' + '1a2b'.padStart(64, '0') as `0x${string}`
  const amount = 200000000000000000n // 0.2 ETH
  const chainId = 11155111

  describe('buildDepositLink', () => {
    it('generates EIP-681 URI with contract address and chain', () => {
      const uri = buildDepositLink({ poolAddress, commitment, amount, chainId })
      expect(uri).toContain(`ethereum:${poolAddress}`)
      expect(uri).toContain(`@${chainId}`)
    })

    it('encodes amount as hex in value param', () => {
      const uri = buildDepositLink({ poolAddress, commitment, amount, chainId })
      expect(uri).toContain('value=2c68af0bb140000')
    })

    it('includes deposit calldata', () => {
      const uri = buildDepositLink({ poolAddress, commitment, amount, chainId })
      // deposit(bytes32) selector = 0xb214faa5
      expect(uri).toContain('b214faa5')
    })
  })

  describe('buildDepositCalldata', () => {
    it('encodes deposit(bytes32) calldata', () => {
      const data = buildDepositCalldata(commitment)
      expect(data).toMatch(/^0x/)
      // 0x + 4-byte selector + 32-byte commitment = 2 + 8 + 64
      expect(data.length).toBe(2 + 8 + 64)
    })

    it('starts with deposit selector', () => {
      const data = buildDepositCalldata(commitment)
      expect(data.startsWith('0xb214faa5')).toBe(true)
    })
  })

  describe('parseDepositLink', () => {
    it('round-trips correctly', () => {
      const uri = buildDepositLink({ poolAddress, commitment, amount, chainId })
      const parsed = parseDepositLink(uri)
      expect(parsed).not.toBeNull()
      expect(parsed!.poolAddress.toLowerCase()).toBe(poolAddress.toLowerCase())
      expect(parsed!.chainId).toBe(chainId)
      expect(parsed!.amount).toBe(amount)
    })

    it('returns null for non-ethereum URI', () => {
      expect(parseDepositLink('https://example.com')).toBeNull()
    })

    it('returns null for malformed URI', () => {
      expect(parseDepositLink('ethereum:noquery')).toBeNull()
    })

    it('returns null for missing value param', () => {
      expect(parseDepositLink('ethereum:0xabc@1?data=0x00')).toBeNull()
    })
  })
})
