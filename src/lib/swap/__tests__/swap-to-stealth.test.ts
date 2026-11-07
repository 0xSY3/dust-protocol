import { describe, it, expect } from 'vitest'
import { ethers } from 'ethers'
import { DUST_SWAP_ADAPTER_V2_ABI } from '../contracts'
import {
  buildSwapToStealthArgs,
  buildSwapToStealthRequestBody,
  parseSwapToStealthRequest,
  NO_INVOICE_ID,
  type SwapToStealthContext,
  type SwapToStealthRequest,
} from '../swap-to-stealth'

const ADAPTER = '0xb91Afd19FeB4000E228243f40B8d98ea07127400'
const USDC = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'
const ETH = ethers.constants.AddressZero
const CHAIN_ID = 11155111
const RELAYER = '0x8d56E94a02F06320BDc68FAfE23DEc9Ad7463496'

const CTX: SwapToStealthContext = {
  chainId: CHAIN_ID,
  adapterAddress: ADAPTER,
  poolKey: { currency0: ETH, currency1: USDC, fee: 500, tickSpacing: 10, hooks: ETH },
}

// Compressed secp256k1 generator point: a known-valid 33-byte key
const EPHEMERAL_PUB_KEY = '0x0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
// x = 5 has no point on secp256k1, so this is well-formed but not a public key
const OFF_CURVE_PUB_KEY = '0x020000000000000000000000000000000000000000000000000000000000000005'
const STEALTH = '0x9f5c4b1e2a3d4c5b6a7980716253443526170809'
const INVOICE_ID = '0x9f2c41d07be35a68c1e0f4b2a7d39e15'
const SNARK_SCALAR_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n

function publicSignals(overrides: Partial<Record<number, string>> = {}): string[] {
  const signals = [
    '111', // merkleRoot
    '222', // nullifier0
    '0', // nullifier1 (single input)
    '333', // outCommitment0
    '0', // outCommitment1
    '1000000000000000000', // publicAmount
    '444', // publicAsset
    BigInt(ADAPTER).toString(), // recipient
    String(CHAIN_ID), // chainId
  ]
  for (const [index, value] of Object.entries(overrides)) signals[Number(index)] = value as string
  return signals
}

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    proof: `0x${'ab'.repeat(768)}`,
    publicSignals: publicSignals(),
    targetChainId: CHAIN_ID,
    tokenIn: ETH,
    tokenOut: USDC,
    minAmountOut: '1980000000',
    relayerFeeBps: 200,
    stealthAddress: STEALTH,
    ephemeralPubKey: EPHEMERAL_PUB_KEY,
    viewTag: '0xab',
    ...overrides,
  }
}

function expectError(body: unknown, fragment: string) {
  const result = parseSwapToStealthRequest(body, CTX)
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error).toContain(fragment)
}

function parseOk(body: unknown): SwapToStealthRequest {
  const result = parseSwapToStealthRequest(body, CTX)
  if (!result.ok) throw new Error(`expected a valid request, got: ${result.error}`)
  return result.value
}

describe('parseSwapToStealthRequest', () => {
  describe('valid requests', () => {
    it('accepts ETH -> USDC without an invoice', () => {
      // #given a well-formed body with no invoiceId
      // #when parsed
      const request = parseOk(validBody())
      // #then direction, amounts and stealth fields are normalized and the invoice is the zero sentinel
      expect(request.zeroForOne).toBe(true)
      expect(request.tokenIn).toBe(ETH)
      expect(request.tokenOut).toBe(USDC)
      expect(request.minAmountOut).toBe(1980000000n)
      expect(request.relayerFeeBps).toBe(200)
      expect(request.stealthAddress).toBe(ethers.utils.getAddress(STEALTH))
      expect(request.ephemeralPubKey).toBe(EPHEMERAL_PUB_KEY)
      expect(request.viewTag).toBe('0xab')
      expect(request.invoiceId).toBe(NO_INVOICE_ID)
      expect(request.publicSignals).toHaveLength(9)
    })

    it('accepts USDC -> ETH and flips the swap direction', () => {
      // #given tokenIn is currency1 of the pool
      const body = validBody({ tokenIn: USDC, tokenOut: ETH })
      // #when parsed
      const request = parseOk(body)
      // #then zeroForOne is false
      expect(request.zeroForOne).toBe(false)
    })

    it('lowercases and keeps a 16-byte invoice id for ERC-20 output', () => {
      // #given an invoice id in mixed case
      const body = validBody({ invoiceId: INVOICE_ID.toUpperCase().replace('0X', '0x') })
      // #when parsed
      const request = parseOk(body)
      // #then the invoice id is carried through lowercase
      expect(request.invoiceId).toBe(INVOICE_ID)
    })

    it('treats a null invoice id as no invoice', () => {
      // #given invoiceId explicitly null
      // #when parsed
      const request = parseOk(validBody({ invoiceId: null }))
      // #then the zero sentinel is used
      expect(request.invoiceId).toBe(NO_INVOICE_ID)
    })

    it('defaults the relayer fee like /api/v2/swap when omitted', () => {
      // #given no relayerFeeBps
      const body = validBody()
      delete body.relayerFeeBps
      // #when parsed
      // #then the 100 bps default applies
      expect(parseOk(body).relayerFeeBps).toBe(100)
    })
  })

  describe('stealth recipient', () => {
    it('rejects the zero address', () => {
      // #given a zero stealth address
      // #when parsed / #then rejected before any gas is spent
      expectError(validBody({ stealthAddress: ETH }), 'zero address or the swap adapter')
    })

    it('rejects the adapter itself, case-insensitively', () => {
      // #given the adapter address in lowercase
      // #when parsed / #then rejected because the payout would be stranded
      expectError(validBody({ stealthAddress: ADAPTER.toLowerCase() }), 'zero address or the swap adapter')
    })

    it('rejects malformed and bad-checksum addresses', () => {
      // #given a short address and a mixed-case address with a broken checksum
      // #when parsed / #then both are rejected
      expectError(validBody({ stealthAddress: '0x1234' }), 'Invalid stealthAddress')
      expectError(validBody({ stealthAddress: '0x9F5c4b1e2a3d4c5b6a7980716253443526170809' }), 'Invalid stealthAddress')
    })
  })

  describe('ephemeral public key', () => {
    it.each([
      ['32 bytes', `0x02${'11'.repeat(31)}`],
      ['34 bytes', `0x02${'11'.repeat(33)}`],
      ['uncompressed prefix 0x04', `0x04${EPHEMERAL_PUB_KEY.slice(4)}`],
      ['missing 0x', EPHEMERAL_PUB_KEY.slice(2)],
      ['not on the curve', OFF_CURVE_PUB_KEY],
    ])('rejects %s', (_label, key) => {
      // #given an ephemeral key that ERC-5564 scheme 1 scanners cannot use
      // #when parsed / #then rejected
      expectError(validBody({ ephemeralPubKey: key }), 'ephemeralPubKey')
    })

    it('accepts the 0x03 parity prefix', () => {
      // #given the generator point's odd-y twin prefix
      const key = `0x03${EPHEMERAL_PUB_KEY.slice(4)}`
      // #when parsed / #then accepted (x is on the curve for both parities)
      expect(parseOk(validBody({ ephemeralPubKey: key })).ephemeralPubKey).toBe(key)
    })
  })

  describe('view tag and invoice id', () => {
    it.each([['two bytes', '0xabcd'], ['no 0x prefix', 'ab'], ['empty', '0x'], ['not a string', 171]])(
      'rejects a view tag that is %s',
      (_label, viewTag) => {
        // #given a view tag that is not exactly one byte
        // #when parsed / #then rejected
        expectError(validBody({ viewTag }), 'viewTag')
      },
    )

    it.each([['15 bytes', `0x${'ab'.repeat(15)}`], ['17 bytes', `0x${'ab'.repeat(17)}`], ['not hex', `0x${'zz'.repeat(16)}`]])(
      'rejects an invoice id that is %s',
      (_label, invoiceId) => {
        // #given an invoice id that is not exactly 16 bytes of hex
        // #when parsed / #then rejected
        expectError(validBody({ invoiceId }), 'invoiceId must be 16 bytes')
      },
    )

    it('rejects the all-zero invoice id because the adapter reads it as "no invoice"', () => {
      // #given bytes16(0)
      // #when parsed / #then rejected instead of silently dropped
      expectError(validBody({ invoiceId: NO_INVOICE_ID }), 'must not be zero')
    })

    it('rejects an invoice id when the output is ETH', () => {
      // #given USDC -> ETH with an invoice id
      const body = validBody({ tokenIn: USDC, tokenOut: ETH, invoiceId: INVOICE_ID })
      // #when parsed / #then rejected, since ETH metadata cannot carry it
      expectError(body, 'only supported when the output token is an ERC-20')
    })
  })

  describe('proof binding and pool', () => {
    it('rejects a proof that is not 768 bytes', () => {
      // #given a 767-byte proof
      // #when parsed / #then rejected before DustPoolV2 would revert InvalidProofLength
      expectError(validBody({ proof: `0x${'ab'.repeat(767)}` }), 'proof must be 768 bytes')
    })

    it('rejects public signals of the wrong count, format or range', () => {
      // #given 8 signals, a hex signal, and a signal equal to the field modulus
      // #when parsed / #then each is rejected
      expectError(validBody({ publicSignals: publicSignals().slice(0, 8) }), 'publicSignals')
      expectError(validBody({ publicSignals: publicSignals({ 0: '0x10' }) }), 'publicSignals')
      expectError(validBody({ publicSignals: publicSignals({ 0: SNARK_SCALAR_FIELD.toString() }) }), 'publicSignals')
    })

    it('rejects a proof for another chain', () => {
      // #given a proof whose chainId signal is mainnet
      // #when parsed / #then rejected (cross-chain replay)
      expectError(validBody({ publicSignals: publicSignals({ 8: '1' }) }), 'chainId')
    })

    it('rejects a proof whose withdraw recipient is not the adapter', () => {
      // #given a proof that withdraws to the stealth address directly
      const signals = publicSignals({ 7: BigInt(STEALTH).toString() })
      // #when parsed / #then rejected
      expectError(validBody({ publicSignals: signals }), 'recipient must be the swap adapter')
    })

    it('rejects tokens that are not the pool pair in swap order', () => {
      // #given tokenIn == tokenOut and a token outside the pool
      // #when parsed / #then both are rejected before the adapter would revert PoolKeyMismatch
      expectError(validBody({ tokenOut: ETH }), 'two currencies of the configured pool')
      expectError(validBody({ tokenOut: STEALTH }), 'two currencies of the configured pool')
    })
  })

  describe('amounts and fee', () => {
    it.each([['zero', '0'], ['negative', '-1'], ['a number', 5], ['leading zero', '01'], ['above uint256', (1n << 256n).toString()]])(
      'rejects minAmountOut that is %s',
      (_label, minAmountOut) => {
        // #given a minAmountOut that is not a positive canonical uint256 string
        // #when parsed / #then rejected
        expectError(validBody({ minAmountOut }), 'minAmountOut')
      },
    )

    it.each([[501], [-1], [1.5], ['200']])('rejects relayerFeeBps %s', (relayerFeeBps) => {
      // #given a fee outside the adapter's 0..500 integer range
      // #when parsed / #then rejected
      expectError(validBody({ relayerFeeBps }), 'relayerFeeBps')
    })
  })

  it('rejects non-object bodies', () => {
    // #given null, an array and a string
    // #when parsed / #then each is rejected
    expectError(null, 'JSON object')
    expectError([], 'JSON object')
    expectError('body', 'JSON object')
  })
})

describe('buildSwapToStealthArgs', () => {
  const iface = new ethers.utils.Interface(DUST_SWAP_ADAPTER_V2_ABI)

  it('targets the deployed selectors', () => {
    // #given the adapter ABI
    // #when the selectors are computed
    // #then executeSwapToStealth matches forge inspect and executeSwap is unchanged
    expect(iface.getSighash('executeSwapToStealth')).toBe('0x9f0d70c5')
    expect(iface.getSighash('executeSwap')).toBe('0x3a440b80')
  })

  it('encodes every field into its ABI slot', () => {
    // #given a parsed request carrying an invoice id
    const request = parseOk(validBody({ invoiceId: INVOICE_ID }))
    // #when encoded and decoded through the ABI
    const calldata = iface.encodeFunctionData('executeSwapToStealth', buildSwapToStealthArgs(request, CTX.poolKey, RELAYER))
    const decoded = iface.decodeFunctionData('executeSwapToStealth', calldata)
    // #then each argument lands where the contract reads it
    expect(decoded.proof).toBe(request.proof)
    expect(decoded.merkleRoot).toBe(ethers.utils.hexZeroPad('0x6f', 32))
    expect(decoded.nullifier0).toBe(ethers.utils.hexZeroPad('0xde', 32))
    expect(decoded.nullifier1).toBe(ethers.constants.HashZero)
    expect(decoded.publicAmount.toString()).toBe('1000000000000000000')
    expect(decoded.publicAsset.toString()).toBe('444')
    expect(decoded.tokenIn).toBe(ETH)
    expect(decoded.poolKey.currency1).toBe(USDC)
    expect(decoded.poolKey.fee).toBe(500)
    expect(decoded.poolKey.tickSpacing).toBe(10)
    expect(decoded.zeroForOne).toBe(true)
    expect(decoded.minAmountOut.toString()).toBe('1980000000')
    expect(decoded.stealthAddress).toBe(ethers.utils.getAddress(STEALTH))
    expect(decoded.ephemeralPubKey).toBe(EPHEMERAL_PUB_KEY)
    expect(decoded.viewTag).toBe('0xab')
    expect(decoded.invoiceId).toBe(INVOICE_ID)
    expect(decoded.tokenOut).toBe(USDC)
    expect(decoded.relayer).toBe(RELAYER)
    expect(decoded.relayerFeeBps.toNumber()).toBe(200)
  })

  it('passes bytes16(0) when there is no invoice', () => {
    // #given a request without an invoice id
    const request = parseOk(validBody())
    // #when encoded and decoded
    const decoded = iface.decodeFunctionData(
      'executeSwapToStealth',
      iface.encodeFunctionData('executeSwapToStealth', buildSwapToStealthArgs(request, CTX.poolKey, RELAYER)),
    )
    // #then the adapter sees the "no invoice" sentinel
    expect(decoded.invoiceId).toBe(NO_INVOICE_ID)
  })
})

describe('buildSwapToStealthRequestBody', () => {
  it('produces a body the server accepts unchanged', () => {
    // #given the values the client hook has after proving
    const body = buildSwapToStealthRequestBody({
      proofCalldata: `0x${'cd'.repeat(768)}`,
      publicSignals: publicSignals(),
      chainId: CHAIN_ID,
      tokenIn: USDC,
      tokenOut: ETH,
      minAmountOut: 500000000000000n,
      relayerFeeBps: 200,
      payout: { stealthAddress: STEALTH, ephemeralPubKey: EPHEMERAL_PUB_KEY, viewTag: '0x07' },
    })
    // #when it round-trips through JSON and the server parser
    const request = parseOk(JSON.parse(JSON.stringify(body)))
    // #then amounts survive as exact bigints and no invoice key is sent
    expect('invoiceId' in body).toBe(false)
    expect(request.minAmountOut).toBe(500000000000000n)
    expect(request.zeroForOne).toBe(false)
    expect(request.viewTag).toBe('0x07')
  })

  it('includes the invoice id only when one is given', () => {
    // #given an ERC-20 payout with an invoice id
    const body = buildSwapToStealthRequestBody({
      proofCalldata: `0x${'cd'.repeat(768)}`,
      publicSignals: publicSignals(),
      chainId: CHAIN_ID,
      tokenIn: ETH,
      tokenOut: USDC,
      minAmountOut: 1n,
      relayerFeeBps: 0,
      payout: { stealthAddress: STEALTH, ephemeralPubKey: EPHEMERAL_PUB_KEY, viewTag: '0x07' },
      invoiceId: INVOICE_ID,
    })
    // #when parsed by the server
    // #then the invoice id arrives intact
    expect(parseOk(JSON.parse(JSON.stringify(body))).invoiceId).toBe(INVOICE_ID)
  })
})
