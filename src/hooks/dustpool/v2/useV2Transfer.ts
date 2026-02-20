import { useState, useCallback, useRef, type RefObject } from 'react'
import { useAccount, useChainId } from 'wagmi'
import { zeroAddress, type Address } from 'viem'
import { computeAssetId } from '@/lib/dustpool/v2/commitment'
import { buildTransferInputs } from '@/lib/dustpool/v2/proof-inputs'
import {
  openV2Database, getUnspentNotes, markNoteSpent,
  saveNoteV2, bigintToHex, hexToBigint, storedToNoteCommitment,
} from '@/lib/dustpool/v2/storage'
import type { StoredNoteV2 } from '@/lib/dustpool/v2/storage'
import { createRelayerClient } from '@/lib/dustpool/v2/relayer-client'
import { generateV2Proof, verifyV2ProofLocally } from '@/lib/dustpool/v2/proof'
import type { V2Keys } from '@/lib/dustpool/v2/types'

export function useV2Transfer(keysRef: RefObject<V2Keys | null>, chainIdOverride?: number) {
  const { address, isConnected } = useAccount()
  const wagmiChainId = useChainId()
  const chainId = chainIdOverride ?? wagmiChainId

  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const transferringRef = useRef(false)

  const transfer = useCallback(async (
    amount: bigint,
    recipientPubKey: bigint,
    asset: Address = zeroAddress
  ) => {
    if (!isConnected || !address) { setError('Wallet not connected'); return }
    const keys = keysRef.current
    if (!keys) { setError('Keys not available — verify PIN first'); return }
    if (transferringRef.current) return
    if (amount <= 0n) { setError('Amount must be positive'); return }

    transferringRef.current = true
    setIsPending(true)
    setError(null)

    try {
      const db = await openV2Database()
      const assetId = await computeAssetId(chainId, asset)
      const assetHex = bigintToHex(assetId)

      const storedNotes = await getUnspentNotes(db, address, chainId)

      // Best-fit selection: smallest note >= amount, with confirmed leafIndex
      const eligible = storedNotes
        .filter(n => n.asset === assetHex && hexToBigint(n.amount) >= amount && n.leafIndex >= 0)
        .sort((a, b) => {
          const diff = hexToBigint(a.amount) - hexToBigint(b.amount)
          if (diff < 0n) return -1
          if (diff > 0n) return 1
          return 0
        })

      if (eligible.length === 0) {
        throw new Error('No note with sufficient balance for this transfer')
      }

      const inputStored = eligible[0]
      const inputNote = storedToNoteCommitment(inputStored)

      const relayer = createRelayerClient()
      const merkleProof = await relayer.getMerkleProof(inputNote.leafIndex)

      const proofInputs = await buildTransferInputs(
        inputNote, recipientPubKey, amount, keys, merkleProof
      )

      const { proof, publicSignals, proofCalldata } = await generateV2Proof(proofInputs)

      const isValid = await verifyV2ProofLocally(proof, publicSignals)
      if (!isValid) {
        throw new Error('Generated proof failed local verification')
      }

      const result = await relayer.submitTransfer(proofCalldata, publicSignals, chainId)
      if (!result.success) {
        throw new Error('Relayer rejected the transfer')
      }

      // Only mark spent + save change AFTER successful submission
      await markNoteSpent(db, inputStored.id)

      // Save change note if input had more than transferred amount
      // In buildTransferInputs: output 0 = recipient, output 1 = change
      if (inputNote.note.amount < amount) {
        throw new Error('Input note amount less than transfer — stale data')
      }
      const changeAmount = inputNote.note.amount - amount
      if (changeAmount > 0n) {
        const changeCommitmentHex = bigintToHex(proofInputs.outputCommitment1)
        const changeStored: StoredNoteV2 = {
          id: changeCommitmentHex,
          walletAddress: address.toLowerCase(),
          chainId,
          commitment: changeCommitmentHex,
          owner: bigintToHex(proofInputs.outOwner[1]),
          amount: bigintToHex(proofInputs.outAmount[1]),
          asset: bigintToHex(proofInputs.outAsset[1]),
          blinding: bigintToHex(proofInputs.outBlinding[1]),
          leafIndex: -1, // Pending relayer confirmation
          spent: false,
          createdAt: Date.now(),
        }
        await saveNoteV2(db, address, changeStored)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Transfer failed'
      setError(msg)
    } finally {
      setIsPending(false)
      transferringRef.current = false
    }
  }, [isConnected, address, chainId])

  return { transfer, isPending, error }
}
