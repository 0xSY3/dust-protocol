import { ethers } from 'ethers'
import { NextResponse } from 'next/server'
import { getServerSponsor } from '@/lib/server-provider'
import { DEFAULT_CHAIN_ID, getChainConfig } from '@/config/chains'
import { getDustPoolV2Address } from '@/lib/dustpool/v2/contracts'
import { DUST_SWAP_ADAPTER_V2_ABI } from '@/lib/swap/contracts'
import {
  buildSwapToStealthArgs,
  parseSwapToStealthRequest,
  type SwapToStealthResponseBody,
} from '@/lib/swap/swap-to-stealth'
import { syncAndPostRoot } from '@/lib/dustpool/v2/relayer-tree'
import { toBytes32Hex } from '@/lib/dustpool/poseidon'
import { computeAssetId } from '@/lib/dustpool/v2/commitment'
import { acquireNullifier, releaseNullifier } from '@/lib/dustpool/v2/pending-nullifiers'
import { checkCooldown } from '@/lib/dustpool/v2/persistent-cooldown'
import { screenRecipient } from '@/lib/dustpool/v2/relayer-compliance'

export const maxDuration = 60

const NO_STORE = { 'Cache-Control': 'no-store' } as const
const MAX_GAS_PRICE = ethers.utils.parseUnits('100', 'gwei')
// FFLONK verify + swap + stealth payout + ERC-5564 announcement. Reuses executeSwap's 900k ceiling,
// which also covers the Poseidon hashing and re-deposit that this path skips.
const SWAP_TO_STEALTH_GAS_LIMIT = 900_000

const REVERT_MESSAGES: ReadonlyArray<readonly [string, string]> = [
  ['InvalidProofLength', 'Invalid proof length (expected 768 bytes)'],
  ['InvalidProof', 'Invalid proof'],
  ['NullifierAlreadySpent', 'Note already spent'],
  ['UnknownRoot', 'Invalid or expired Merkle root'],
  ['InsufficientPoolBalance', 'Insufficient pool balance'],
  ['InvalidFieldElement', 'Invalid field element in public signals'],
  ['SlippageExceeded', 'Swap slippage exceeded'],
  ['OracleDeviationExceeded', 'Swap price deviates too far from the oracle price'],
  ['InvalidChainId', 'Invalid chain ID in proof'],
  ['InvalidStealthAddress', 'Invalid stealth address'],
  ['InvalidEphemeralPubKey', 'Invalid ephemeral public key'],
  ['PoolKeyMismatch', 'Tokens do not match the swap pool'],
  ['TransferFailed', 'Payout to the stealth address failed'],
  ['Sponsor not configured', 'Relayer key not configured'],
]

function toClientMessage(raw: string): string {
  const match = REVERT_MESSAGES.find(([needle]) => raw.includes(needle))
  return match ? match[1] : 'Swap failed'
}

export async function POST(req: Request) {
  try {
    // Malformed JSON becomes null so the validator answers 400 instead of the generic 500 below
    const body: unknown = await req.json().catch(() => null)
    const requestedChainId = (body as { targetChainId?: unknown } | null)?.targetChainId
    const chainId = typeof requestedChainId === 'number' ? requestedChainId : DEFAULT_CHAIN_ID

    let config: ReturnType<typeof getChainConfig>
    try {
      config = getChainConfig(chainId)
    } catch {
      return NextResponse.json({ error: `Unsupported chain: ${chainId}` }, { status: 400, headers: NO_STORE })
    }
    const adapterAddress = config.contracts.dustSwapAdapterV2
    if (!adapterAddress) {
      return NextResponse.json(
        { error: 'DustSwapAdapterV2 not deployed on this chain' },
        { status: 404, headers: NO_STORE },
      )
    }
    if (!getDustPoolV2Address(chainId)) {
      return NextResponse.json(
        { error: 'DustPoolV2 not deployed on this chain' },
        { status: 404, headers: NO_STORE },
      )
    }
    const poolKey = config.contracts.dustSwapVanillaPoolKey
    if (!poolKey) {
      return NextResponse.json(
        { error: 'DustSwap pool key not configured for this chain' },
        { status: 404, headers: NO_STORE },
      )
    }

    const parsed = parseSwapToStealthRequest(body, { chainId, adapterAddress, poolKey })
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400, headers: NO_STORE })
    }
    const request = parsed.value

    const expectedAsset = await computeAssetId(chainId, request.tokenIn)
    if (expectedAsset !== request.publicSignals[6]) {
      return NextResponse.json(
        { error: 'tokenIn does not match proof asset' },
        { status: 400, headers: NO_STORE },
      )
    }

    // Unlike executeSwap, the output leaves the pool for an external address, so screen it like a withdraw
    const screenResult = await screenRecipient(request.stealthAddress, chainId)
    if (screenResult.blocked) {
      return NextResponse.json(
        { error: 'Recipient address is sanctioned' },
        { status: 403, headers: NO_STORE },
      )
    }

    const nullifier0Hex = toBytes32Hex(request.publicSignals[1])
    const nullifier1Hex = toBytes32Hex(request.publicSignals[2])
    const nullifier1IsZero = request.publicSignals[2] === 0n

    if (!(await checkCooldown(nullifier0Hex))) {
      return NextResponse.json({ error: 'Please wait before retrying' }, { status: 429, headers: NO_STORE })
    }
    if (!acquireNullifier(nullifier0Hex)) {
      return NextResponse.json({ error: 'Nullifier already being processed' }, { status: 409, headers: NO_STORE })
    }
    if (!nullifier1IsZero && !acquireNullifier(nullifier1Hex)) {
      releaseNullifier(nullifier0Hex)
      return NextResponse.json({ error: 'Nullifier already being processed' }, { status: 409, headers: NO_STORE })
    }

    try {
      await syncAndPostRoot(chainId)

      const sponsor = getServerSponsor(chainId)
      const adapter = new ethers.Contract(
        adapterAddress,
        DUST_SWAP_ADAPTER_V2_ABI as unknown as ethers.ContractInterface,
        sponsor,
      )

      const feeData = await sponsor.provider.getFeeData()
      const maxFeePerGas = feeData.maxFeePerGas || ethers.utils.parseUnits('5', 'gwei')
      if (maxFeePerGas.gt(MAX_GAS_PRICE)) {
        return NextResponse.json({ error: 'Gas price too high' }, { status: 503, headers: NO_STORE })
      }

      const args = buildSwapToStealthArgs(request, poolKey, await sponsor.getAddress())
      const tx = await adapter.executeSwapToStealth(...args, {
        gasLimit: SWAP_TO_STEALTH_GAS_LIMIT,
        type: 2,
        maxFeePerGas,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || ethers.utils.parseUnits('1.5', 'gwei'),
      })

      const receipt = await tx.wait()
      if (receipt.status !== 1) {
        throw new Error('Transaction reverted on-chain')
      }

      const executedTopic = adapter.interface.getEventTopic('PrivateSwapToStealthExecuted')
      const executedLog = receipt.logs.find(
        (log: ethers.providers.Log) =>
          log.address.toLowerCase() === adapterAddress.toLowerCase() && log.topics[0] === executedTopic,
      )
      if (!executedLog) {
        return NextResponse.json(
          { error: 'PrivateSwapToStealthExecuted event not found in receipt', txHash: receipt.transactionHash },
          { status: 500, headers: NO_STORE },
        )
      }
      const executed = adapter.interface.parseLog(executedLog)

      console.log(
        `[V2/swap-to-stealth] Success: nullifier=${nullifier0Hex.slice(0, 18)}... tx=${receipt.transactionHash}`,
      )

      // Best-effort resync: change notes from the withdraw proof still enter the tree
      try {
        await syncAndPostRoot(chainId)
      } catch (syncErr) {
        console.error('[V2/swap-to-stealth] Post-TX tree sync failed (non-fatal):', syncErr)
      }

      const response: SwapToStealthResponseBody = {
        txHash: receipt.transactionHash,
        stealthAddress: executed.args.stealthAddress,
        outputAmount: executed.args.outputAmount.toString(),
        blockNumber: receipt.blockNumber,
      }
      return NextResponse.json(response, { headers: NO_STORE })
    } finally {
      releaseNullifier(nullifier0Hex)
      if (!nullifier1IsZero) releaseNullifier(nullifier1Hex)
    }
  } catch (e) {
    console.error('[V2/swap-to-stealth] Error:', e)
    const raw = e instanceof Error ? e.message : String(e)
    // Only the mapped message goes back: ethers error text can carry the RPC URL and with it the provider API key
    return NextResponse.json({ error: toClientMessage(raw) }, { status: 500, headers: NO_STORE })
  }
}
