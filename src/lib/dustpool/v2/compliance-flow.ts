// End-to-end compliance proof flow: fetch witness → compute nullifier →
// build circuit inputs → generate proof → local verify → submit to relayer.

import { computeNullifier } from './nullifier'
import { createRelayerClient, type ComplianceWitness } from './relayer-client'
import {
  generateComplianceProof,
  verifyComplianceProofLocally,
  type ComplianceProofInputs,
} from './compliance-proof'

export interface ComplianceResult {
  txHash: string
  verified: boolean
  nullifier: bigint
}

/**
 * Generate and submit a compliance proof for a note commitment.
 *
 * Steps:
 * 1. Fetch SMT non-membership witness from relayer
 * 2. Compute nullifier = Poseidon(nullifierKey, commitment, leafIndex)
 * 3. Build circuit inputs from witness + nullifier preimage
 * 4. Generate FFLONK proof (main thread — ~6.8k constraints)
 * 5. Verify proof locally as sanity check
 * 6. Submit proof + exclusion root + nullifier to relayer for on-chain verification
 */
export async function proveCompliance(
  commitment: bigint,
  leafIndex: number,
  nullifierKey: bigint,
  chainId: number,
  onStatus?: (status: string) => void
): Promise<ComplianceResult> {
  const relayer = createRelayerClient()

  onStatus?.('fetching-witness')
  const witness: ComplianceWitness = await relayer.getComplianceWitness(commitment, chainId)

  const nullifier = await computeNullifier(nullifierKey, commitment, leafIndex)

  onStatus?.('generating-proof')
  const inputs: ComplianceProofInputs = {
    exclusionRoot: witness.exclusionRoot,
    nullifier,
    commitment,
    nullifierKey,
    leafIndex: BigInt(leafIndex),
    smtSiblings: witness.smtSiblings,
    smtOldKey: witness.smtOldKey,
    smtOldValue: witness.smtOldValue,
    smtIsOld0: witness.smtIsOld0,
  }

  const { proof, publicSignals, proofCalldata } = await generateComplianceProof(inputs)

  const isValid = await verifyComplianceProofLocally(proof, publicSignals)
  if (!isValid) {
    throw new Error('Compliance proof failed local verification')
  }

  onStatus?.('submitting')
  const result = await relayer.submitComplianceProof(
    proofCalldata,
    witness.exclusionRoot,
    nullifier,
    chainId
  )

  return {
    txHash: result.txHash,
    verified: result.verified,
    nullifier,
  }
}
