import { ethers } from 'ethers'
import { NextResponse } from 'next/server'
import { getServerSponsor } from '@/lib/server-provider'
import { DEFAULT_CHAIN_ID } from '@/config/chains'
import { getDustPoolV2Address, DUST_POOL_V2_ABI } from '@/lib/dustpool/v2/contracts'
import { syncAndPostRoot } from '@/lib/dustpool/v2/relayer-tree'
import { toBytes32Hex } from '@/lib/dustpool/poseidon'
import { computeAssetId } from '@/lib/dustpool/v2/commitment'

export const maxDuration = 60

const NO_STORE = { 'Cache-Control': 'no-store' } as const
const MAX_GAS_PRICE = ethers.utils.parseUnits('100', 'gwei')

// Rate limiting per nullifier to prevent replay spam
const withdrawCooldowns = new Map<string, number>()
const COOLDOWN_MS = 10_000
const MAX_ENTRIES = 1000

function checkCooldown(key: string): boolean {
  const now = Date.now()
  if (withdrawCooldowns.size > MAX_ENTRIES) {
    for (const [k, t] of withdrawCooldowns) {
      if (now - t > COOLDOWN_MS) withdrawCooldowns.delete(k)
    }
  }
  const last = withdrawCooldowns.get(key)
  if (last && now - last < COOLDOWN_MS) return false
  withdrawCooldowns.set(key, now)
  return true
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    // Client sends targetChainId (not chainId) for V2 routes
    const chainId = typeof body.targetChainId === 'number' ? body.targetChainId : DEFAULT_CHAIN_ID

    const address = getDustPoolV2Address(chainId)
    if (!address) {
      return NextResponse.json(
        { error: 'DustPoolV2 not deployed on this chain' },
        { status: 404, headers: NO_STORE },
      )
    }

    const { proof, publicSignals, tokenAddress } = body
    if (!proof || !Array.isArray(publicSignals) || publicSignals.length !== 8) {
      return NextResponse.json(
        { error: 'Missing or invalid fields: proof (hex), publicSignals (8 elements), tokenAddress' },
        { status: 400, headers: NO_STORE },
      )
    }
    if (!/^0x[0-9a-fA-F]+$/.test(proof)) {
      return NextResponse.json({ error: 'Invalid proof format' }, { status: 400, headers: NO_STORE })
    }
    if (!tokenAddress || !/^0x[0-9a-fA-F]{40}$/.test(tokenAddress)) {
      return NextResponse.json({ error: 'Invalid tokenAddress' }, { status: 400, headers: NO_STORE })
    }

    // Verify tokenAddress matches the publicAsset in the ZK proof.
    // Without this check, an attacker could deposit dust ETH and withdraw a different token.
    const expectedAsset = await computeAssetId(chainId, tokenAddress)
    const proofAsset = BigInt(publicSignals[6])
    if (expectedAsset !== proofAsset) {
      return NextResponse.json(
        { error: 'tokenAddress does not match proof asset' },
        { status: 400, headers: NO_STORE },
      )
    }

    // Public signals: [merkleRoot, nullifier0, nullifier1, outCommitment0, outCommitment1, publicAmount, publicAsset, recipient]
    const nullifier0Hex = toBytes32Hex(BigInt(publicSignals[1]))
    if (!checkCooldown(nullifier0Hex)) {
      return NextResponse.json({ error: 'Please wait before retrying' }, { status: 429, headers: NO_STORE })
    }

    // Sync tree and post root before submitting (so isKnownRoot passes)
    await syncAndPostRoot(chainId)

    const sponsor = getServerSponsor(chainId)
    const contract = new ethers.Contract(
      address,
      DUST_POOL_V2_ABI as unknown as ethers.ContractInterface,
      sponsor,
    )

    // Convert public signals to contract parameters
    const merkleRoot = toBytes32Hex(BigInt(publicSignals[0]))
    const nullifier0 = toBytes32Hex(BigInt(publicSignals[1]))
    const nullifier1 = toBytes32Hex(BigInt(publicSignals[2]))
    const outCommitment0 = toBytes32Hex(BigInt(publicSignals[3]))
    const outCommitment1 = toBytes32Hex(BigInt(publicSignals[4]))
    const publicAmount = BigInt(publicSignals[5])
    const publicAsset = BigInt(publicSignals[6])
    // Recipient stored as uint256(uint160(address)) in circuit
    const recipientBigInt = BigInt(publicSignals[7])
    const recipient = ethers.utils.getAddress(
      '0x' + recipientBigInt.toString(16).padStart(40, '0'),
    )

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
        gasLimit: 800_000, // FFLONK verify ~500K + state updates + transfer
        type: 2,
        maxFeePerGas,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || ethers.utils.parseUnits('1.5', 'gwei'),
      },
    )

    const receipt = await tx.wait()

    console.log(
      `[V2/withdraw] Success: nullifier=${nullifier0.slice(0, 18)}... recipient=${recipient} tx=${receipt.transactionHash}`,
    )

    // Resync tree to capture output commitments queued by the withdrawal
    await syncAndPostRoot(chainId)

    return NextResponse.json(
      {
        txHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        fee: receipt.effectiveGasPrice.mul(receipt.gasUsed).toString(),
      },
      { headers: NO_STORE },
    )
  } catch (e) {
    console.error('[V2/withdraw] Error:', e)
    const raw = e instanceof Error ? e.message : ''
    let message = 'Withdrawal failed'
    if (raw.includes('InvalidProof')) message = 'Invalid proof'
    else if (raw.includes('NullifierAlreadySpent')) message = 'Note already spent'
    else if (raw.includes('UnknownRoot')) message = 'Invalid or expired Merkle root'
    else if (raw.includes('InsufficientPoolBalance')) message = 'Insufficient pool balance'
    else if (raw.includes('InvalidProofLength')) message = 'Invalid proof length (expected 768 bytes)'
    else if (raw.includes('InvalidFieldElement')) message = 'Invalid field element in public signals'

    return NextResponse.json({ error: message }, { status: 500, headers: NO_STORE })
  }
}
