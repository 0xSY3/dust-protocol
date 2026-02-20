import { ethers } from 'ethers'
import { NextResponse } from 'next/server'
import { getServerSponsor } from '@/lib/server-provider'
import { DEFAULT_CHAIN_ID } from '@/config/chains'
import { getDustPoolV2Address, DUST_POOL_V2_ABI } from '@/lib/dustpool/v2/contracts'
import { syncAndPostRoot } from '@/lib/dustpool/v2/relayer-tree'
import { toBytes32Hex } from '@/lib/dustpool/poseidon'

export const maxDuration = 60

const NO_STORE = { 'Cache-Control': 'no-store' } as const
const MAX_GAS_PRICE = ethers.utils.parseUnits('100', 'gwei')

// Rate limiting per nullifier
const transferCooldowns = new Map<string, number>()
const COOLDOWN_MS = 10_000
const MAX_ENTRIES = 1000

function checkCooldown(key: string): boolean {
  const now = Date.now()
  if (transferCooldowns.size > MAX_ENTRIES) {
    for (const [k, t] of transferCooldowns) {
      if (now - t > COOLDOWN_MS) transferCooldowns.delete(k)
    }
  }
  const last = transferCooldowns.get(key)
  if (last && now - last < COOLDOWN_MS) return false
  transferCooldowns.set(key, now)
  return true
}

// Transfers call the same contract.withdraw() as withdrawals.
// The difference: publicAmount = 0, so no funds are sent to recipient.
// Output commitments are still queued on-chain for the Merkle tree.
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const chainId = typeof body.targetChainId === 'number' ? body.targetChainId : DEFAULT_CHAIN_ID

    const address = getDustPoolV2Address(chainId)
    if (!address) {
      return NextResponse.json(
        { error: 'DustPoolV2 not deployed on this chain' },
        { status: 404, headers: NO_STORE },
      )
    }

    const { proof, publicSignals } = body
    if (!proof || !Array.isArray(publicSignals) || publicSignals.length !== 8) {
      return NextResponse.json(
        { error: 'Missing or invalid fields: proof (hex), publicSignals (8 elements)' },
        { status: 400, headers: NO_STORE },
      )
    }
    if (!/^0x[0-9a-fA-F]+$/.test(proof)) {
      return NextResponse.json({ error: 'Invalid proof format' }, { status: 400, headers: NO_STORE })
    }

    // Transfers must have publicAmount=0 — reject any attempt to use transfer endpoint for withdrawals
    const publicAmount = BigInt(publicSignals[5])
    if (publicAmount !== 0n) {
      return NextResponse.json(
        { error: 'Transfer requires publicAmount=0' },
        { status: 400, headers: NO_STORE },
      )
    }

    const nullifier0Hex = toBytes32Hex(BigInt(publicSignals[1]))
    if (!checkCooldown(nullifier0Hex)) {
      return NextResponse.json({ error: 'Please wait before retrying' }, { status: 429, headers: NO_STORE })
    }

    await syncAndPostRoot(chainId)

    const sponsor = getServerSponsor(chainId)
    const contract = new ethers.Contract(
      address,
      DUST_POOL_V2_ABI as unknown as ethers.ContractInterface,
      sponsor,
    )

    const merkleRoot = toBytes32Hex(BigInt(publicSignals[0]))
    const nullifier0 = toBytes32Hex(BigInt(publicSignals[1]))
    const nullifier1 = toBytes32Hex(BigInt(publicSignals[2]))
    const outCommitment0 = toBytes32Hex(BigInt(publicSignals[3]))
    const outCommitment1 = toBytes32Hex(BigInt(publicSignals[4]))
    const publicAsset = BigInt(publicSignals[6])
    const recipientBigInt = BigInt(publicSignals[7])
    const recipient = ethers.utils.getAddress(
      '0x' + recipientBigInt.toString(16).padStart(40, '0'),
    )
    // Transfers have publicAmount=0, no actual token transfer — use address(0)
    const tokenAddress = ethers.constants.AddressZero

    const feeData = await sponsor.provider.getFeeData()
    const maxFeePerGas = feeData.maxFeePerGas || ethers.utils.parseUnits('5', 'gwei')
    if (maxFeePerGas.gt(MAX_GAS_PRICE)) {
      return NextResponse.json({ error: 'Gas price too high' }, { status: 503, headers: NO_STORE })
    }

    const tx = await contract.withdraw(
      proof,
      merkleRoot,
      nullifier0,
      nullifier1,
      outCommitment0,
      outCommitment1,
      publicAmount,
      publicAsset,
      recipient,
      tokenAddress,
      {
        gasLimit: 800_000,
        type: 2,
        maxFeePerGas,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || ethers.utils.parseUnits('1.5', 'gwei'),
      },
    )

    await tx.wait()

    console.log(`[V2/transfer] Success: nullifier=${nullifier0.slice(0, 18)}... tx=${tx.hash}`)

    // Resync tree to capture output commitments
    await syncAndPostRoot(chainId)

    return NextResponse.json({ success: true }, { headers: NO_STORE })
  } catch (e) {
    console.error('[V2/transfer] Error:', e)
    const raw = e instanceof Error ? e.message : ''
    let message = 'Transfer failed'
    if (raw.includes('InvalidProof')) message = 'Invalid proof'
    else if (raw.includes('NullifierAlreadySpent')) message = 'Note already spent'
    else if (raw.includes('UnknownRoot')) message = 'Invalid or expired Merkle root'
    else if (raw.includes('InvalidFieldElement')) message = 'Invalid field element in public signals'

    return NextResponse.json({ error: message }, { status: 500, headers: NO_STORE })
  }
}
