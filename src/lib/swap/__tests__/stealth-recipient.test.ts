import { describe, it, expect } from 'vitest'
import { ethers } from 'ethers'
import { generateStealthAddress, parseStealthMetaAddress } from '@/lib/stealth'
import {
  classifyRecipientInput,
  metaAddressUriFromRegistry,
  parseInvoiceIdInput,
  toStealthPayout,
} from '../stealth-recipient'
import { buildSwapToStealthRequestBody, parseSwapToStealthRequest } from '../swap-to-stealth'

const ADAPTER = '0xb91Afd19FeB4000E228243f40B8d98ea07127400'
const USDC = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'
const CHAIN_ID = 11155111

// Two compressed keys (generator point and 2·G) form a syntactically valid meta-address
const SPENDING_PUB = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
const VIEWING_PUB = '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5'
const META_URI = `st:eth:0x${SPENDING_PUB}${VIEWING_PUB}`

describe('classifyRecipientInput', () => {
  it('treats empty or whitespace input as no recipient', () => {
    // #given an untouched field
    // #when classified / #then the swap keeps its default re-deposit behaviour
    expect(classifyRecipientInput('')).toEqual({ kind: 'none' })
    expect(classifyRecipientInput('   ')).toEqual({ kind: 'none' })
  })

  it('accepts a st:eth meta-address', () => {
    // #given a pasted meta-address with surrounding spaces
    // #when classified
    const result = classifyRecipientInput(`  ${META_URI} `)
    // #then the trimmed URI is kept for generateStealthAddress
    expect(result).toEqual({ kind: 'meta-address', uri: META_URI })
  })

  it('rejects a truncated meta-address', () => {
    // #given a meta-address missing its last byte
    // #when classified / #then invalid, with a hint
    const result = classifyRecipientInput(META_URI.slice(0, -2))
    expect(result.kind).toBe('invalid')
  })

  it('normalizes .dust names with or without the suffix', () => {
    // #given a bare name and a suffixed mixed-case name
    // #when classified
    // #then both resolve to the canonical suffixed form
    expect(classifyRecipientInput('alice')).toEqual({ kind: 'name', name: 'alice.dust' })
    expect(classifyRecipientInput('Alice.DUST')).toEqual({ kind: 'name', name: 'alice.dust' })
  })

  it('rejects plain addresses and names with illegal characters', () => {
    // #given a 0x address (not a name, not a meta-address) and a name with a space
    // #when classified / #then invalid
    expect(classifyRecipientInput(ADAPTER).kind).toBe('invalid')
    expect(classifyRecipientInput('alice smith.dust').kind).toBe('invalid')
  })
})

describe('metaAddressUriFromRegistry', () => {
  it('builds the same URI as InvoiceCheckout with or without 0x', () => {
    // #given registry output with and without the 0x prefix
    // #when converted
    // #then both parse as the same meta-address
    const withPrefix = metaAddressUriFromRegistry(`0x${SPENDING_PUB}${VIEWING_PUB}`)
    const withoutPrefix = metaAddressUriFromRegistry(`${SPENDING_PUB}${VIEWING_PUB}`)
    expect(withPrefix).toBe(META_URI)
    expect(withoutPrefix).toBe(META_URI)
  })
})

describe('parseInvoiceIdInput', () => {
  it('accepts an empty field and a 16-byte id', () => {
    // #given no invoice and a mixed-case invoice id
    // #when parsed
    // #then empty is "none" and the id is lowercased
    expect(parseInvoiceIdInput('')).toEqual({ kind: 'none' })
    expect(parseInvoiceIdInput('0x9F2C41D07BE35A68C1E0F4B2A7D39E15')).toEqual({
      kind: 'valid',
      invoiceId: '0x9f2c41d07be35a68c1e0f4b2a7d39e15',
    })
  })

  it('rejects wrong lengths and the zero id', () => {
    // #given a 15-byte id and bytes16(0)
    // #when parsed / #then both are invalid
    expect(parseInvoiceIdInput(`0x${'ab'.repeat(15)}`).kind).toBe('invalid')
    expect(parseInvoiceIdInput(`0x${'00'.repeat(16)}`).kind).toBe('invalid')
  })
})

describe('toStealthPayout', () => {
  it('turns a freshly generated stealth address into a payload the relayer accepts', () => {
    // #given a stealth address generated in the browser for a meta-address
    const generated = generateStealthAddress(parseStealthMetaAddress(META_URI), CHAIN_ID)
    // #when converted to the API payout and parsed by the server validator
    const payout = toStealthPayout(generated)
    const body = buildSwapToStealthRequestBody({
      proofCalldata: `0x${'ab'.repeat(768)}`,
      publicSignals: ['1', '2', '0', '3', '0', '4', '5', BigInt(ADAPTER).toString(), String(CHAIN_ID)],
      chainId: CHAIN_ID,
      tokenIn: ethers.constants.AddressZero,
      tokenOut: USDC,
      minAmountOut: 1n,
      relayerFeeBps: 200,
      payout,
    })
    const parsed = parseSwapToStealthRequest(JSON.parse(JSON.stringify(body)), {
      chainId: CHAIN_ID,
      adapterAddress: ADAPTER,
      poolKey: { currency0: ethers.constants.AddressZero, currency1: USDC, fee: 500, tickSpacing: 10, hooks: ethers.constants.AddressZero },
    })
    // #then the key and tag are 0x-prefixed with the right sizes and the request validates
    expect(payout.ephemeralPubKey).toMatch(/^0x0[23][0-9a-f]{64}$/)
    expect(payout.viewTag).toMatch(/^0x[0-9a-f]{2}$/)
    expect(payout.stealthAddress).toBe(generated.stealthAddress)
    expect(parsed.ok).toBe(true)
  })

  it('does not double-prefix values that already carry 0x', () => {
    // #given generator output that already includes 0x
    const payout = toStealthPayout({
      stealthAddress: '0x0000000000000000000000000000000000000001',
      stealthEOAAddress: '0x0000000000000000000000000000000000000001',
      ephemeralPublicKey: `0x${SPENDING_PUB}`,
      viewTag: '0xab',
      stealthPublicKey: SPENDING_PUB,
    })
    // #when converted / #then exactly one prefix remains
    expect(payout.ephemeralPubKey).toBe(`0x${SPENDING_PUB}`)
    expect(payout.viewTag).toBe('0xab')
  })
})
