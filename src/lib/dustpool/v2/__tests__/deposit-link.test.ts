import { describe, it, expect } from 'vitest'
import { decodeFunctionData } from 'viem'
import {
  buildDepositLink,
  buildDepositCalldata,
  parseDepositLink,
} from '../deposit-link'
import { DUST_POOL_V2_ABI } from '../contracts'

describe('deposit-link', () => {
  const poolAddress = '0x3cbf3459e7E0E9Fd2fd86a28c426CED2a60f023f'
  const proof = `0x${'ab'.repeat(768)}` as `0x${string}`
  const commitment = '0x' + '1a2b'.padStart(64, '0') as `0x${string}`
  const amount = 200000000000000000n // 0.2 ETH
  const chainId = 11155111

  describe('buildDepositLink', () => {
    it('generates EIP-681 URI with contract address and chain', () => {
      const uri = buildDepositLink({ poolAddress, proof, commitment, amount, chainId })
      expect(uri).toContain(`ethereum:${poolAddress}`)
      expect(uri).toContain(`@${chainId}`)
    })

    it('encodes amount as hex in value param', () => {
      const uri = buildDepositLink({ poolAddress, proof, commitment, amount, chainId })
      expect(uri).toContain('value=2c68af0bb140000')
    })

    it('includes depositWithProof calldata', () => {
      const uri = buildDepositLink({ poolAddress, proof, commitment, amount, chainId })
      expect(uri).toContain(`data=${buildDepositCalldata(proof, commitment)}`)
    })
  })

  describe('buildDepositCalldata', () => {
    it('starts with the depositWithProof(bytes,bytes32) selector', () => {
      const data = buildDepositCalldata(proof, commitment)
      expect(data.startsWith('0x8cf0c766')).toBe(true)
    })

    it('encodes the 768-byte proof and the commitment', () => {
      const data = buildDepositCalldata(proof, commitment)
      // 0x + selector + head (proof offset, commitment) + proof length + 768 proof bytes
      expect(data.length).toBe(2 + 8 + 64 * 2 + 64 + 768 * 2)
      const decoded = decodeFunctionData({ abi: DUST_POOL_V2_ABI, data })
      expect(decoded.functionName).toBe('depositWithProof')
      expect(decoded.args).toEqual([proof, commitment])
    })
  })

  describe('parseDepositLink', () => {
    it('round-trips correctly', () => {
      const uri = buildDepositLink({ poolAddress, proof, commitment, amount, chainId })
      const parsed = parseDepositLink(uri)
      expect(parsed).not.toBeNull()
      expect(parsed!.poolAddress.toLowerCase()).toBe(poolAddress.toLowerCase())
      expect(parsed!.chainId).toBe(chainId)
      expect(parsed!.amount).toBe(amount)
      expect(parsed!.calldata).toBe(buildDepositCalldata(proof, commitment))
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
