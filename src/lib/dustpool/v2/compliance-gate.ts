// Pre-spend compliance gate: ensures all input notes have on-chain compliance
// proofs before any withdrawal, transfer, split, or swap. Skips gracefully
// when the compliance verifier is not deployed or is disabled.

import { type PublicClient } from 'viem'
import { getChainConfig } from '@/config/chains'
import { getDustPoolV2Address, DUST_POOL_V2_ABI } from './contracts'
import { computeNullifier } from './nullifier'
import { proveCompliance } from './compliance-flow'
import { toBytes32Hex } from '@/lib/dustpool/poseidon'

export interface NoteForCompliance {
  commitment: bigint
  leafIndex: number
  /** Skip proof gen if already verified or inherited locally */
  complianceStatus?: 'unverified' | 'verified' | 'inherited'
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

/**
 * Ensure all notes have compliance proofs verified on-chain before spending.
 *
 * - Returns immediately if compliance verifier is not configured or set to address(0)
 * - Skips dummy notes (leafIndex < 0)
 * - Skips notes already verified on-chain
 * - Generates and submits proof for any unverified notes
 */
/** Callback to persist complianceStatus after a successful compliance proof */
export type OnComplianceVerified = (commitmentHex: string, txHash: string) => Promise<void>

export async function ensureComplianceProved(
  notes: NoteForCompliance[],
  nullifierKey: bigint,
  chainId: number,
  publicClient: PublicClient,
  onStatus?: (status: string) => void,
  onVerified?: OnComplianceVerified
): Promise<void> {
  const config = getChainConfig(chainId)
  if (!config.contracts.dustPoolV2ComplianceVerifier) return

  const poolAddress = getDustPoolV2Address(chainId)
  if (!poolAddress) return

  // Verify on-chain that verifier is actually enabled (owner could have zeroed it)
  const verifierAddress = await publicClient.readContract({
    address: poolAddress,
    abi: DUST_POOL_V2_ABI,
    functionName: 'complianceVerifier',
  }) as string

  if (verifierAddress === ZERO_ADDRESS) return

  const realNotes = notes.filter(n => n.leafIndex >= 0)
  if (realNotes.length === 0) return

  for (let i = 0; i < realNotes.length; i++) {
    const note = realNotes[i]

    // Skip if locally marked as verified or inherited (avoid redundant RPC + proof gen)
    if (note.complianceStatus === 'verified' || note.complianceStatus === 'inherited') continue

    const nullifier = await computeNullifier(nullifierKey, note.commitment, note.leafIndex)

    if (nullifier === 0n) continue

    const nullifierHex = toBytes32Hex(nullifier) as `0x${string}`

    // Fallback: check on-chain even if local status is missing
    const isVerified = await publicClient.readContract({
      address: poolAddress,
      abi: DUST_POOL_V2_ABI,
      functionName: 'complianceVerified',
      args: [nullifierHex],
    }) as boolean

    if (isVerified) continue

    onStatus?.(`Proving compliance ${i + 1}/${realNotes.length}...`)
    const result = await proveCompliance(note.commitment, note.leafIndex, nullifierKey, chainId, onStatus)

    if (onVerified) {
      const commitmentHex = '0x' + note.commitment.toString(16)
      await onVerified(commitmentHex, result.txHash)
    }
  }
}
