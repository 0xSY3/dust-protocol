'use client'

/**
 * Hook for executing private swaps via DustSwap
 *
 * Orchestrates the full flow:
 * 1. Select deposit note
 * 2. Sync Merkle tree
 * 3. Generate ZK proof
 * 4. Encode proof as Uniswap V4 hook data
 * 5. Execute swap through PoolHelper (single signature!)
 * 6. Mark note as spent
 */

import { useState, useCallback } from 'react'
import { useAccount, usePublicClient, useWalletClient, useChainId } from 'wagmi'
import { type Address, type Hash, encodeAbiParameters, parseAbiParameters } from 'viem'
import {
  getDustSwapPoolKey,
  DUST_SWAP_POOL_ABI,
  POOL_HELPER_ABI,
  getSwapDirection,
  type PoolKey,
} from '@/lib/swap/contracts'
import { getSwapContracts } from '@/lib/swap/constants'
import { type SwapParams as ZKSwapParams } from '@/lib/swap/zk'
import { useSwapZKProof } from './useSwapZKProof'
import { useSwapMerkleTree } from './useSwapMerkleTree'
import { useSwapNotes } from './useSwapNotes'

export type SwapState =
  | 'idle'
  | 'selecting-note'
  | 'syncing-tree'
  | 'generating-proof'
  | 'submitting'
  | 'confirming'
  | 'success'
  | 'error'

interface SwapParams {
  fromToken: Address
  toToken: Address
  minAmountOut: bigint
  recipient: Address // Stealth address
  depositNoteId: number
  poolKey?: PoolKey
}

interface SwapResult {
  hash: Hash
  stealthAddress: Address
  nullifierHash: bigint
  gasUsed: bigint
}

/**
 * Format ZK proof for contract (Groth16 → Solidity)
 */
function formatProofForContract(proof: any, publicSignals: string[]) {
  return {
    pA: [BigInt(proof.pi_a[0]), BigInt(proof.pi_a[1])] as [bigint, bigint],
    pB: [
      [BigInt(proof.pi_b[0][1]), BigInt(proof.pi_b[0][0])],
      [BigInt(proof.pi_b[1][1]), BigInt(proof.pi_b[1][0])],
    ] as [[bigint, bigint], [bigint, bigint]],
    pC: [BigInt(proof.pi_c[0]), BigInt(proof.pi_c[1])] as [bigint, bigint],
    pubSignals: publicSignals.map((s) => BigInt(s)) as [
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
    ],
  }
}

/**
 * Encode proof as Uniswap V4 hook data
 */
function encodeHookData(
  contractProof: ReturnType<typeof formatProofForContract>
): `0x${string}` {
  return encodeAbiParameters(
    parseAbiParameters('uint256[2], uint256[2][2], uint256[2], uint256[8]'),
    [contractProof.pA, contractProof.pB, contractProof.pC, contractProof.pubSignals]
  )
}

/**
 * Convert bigint to bytes32 hex
 */
function toBytes32(n: bigint): `0x${string}` {
  return `0x${n.toString(16).padStart(64, '0')}`
}

interface UseDustSwapOptions {
  chainId?: number
  /** Pass Merkle tree functions to avoid duplicate tree instances */
  merkleTree?: {
    getProof: (leafIndex: number) => Promise<any>
    syncTree: () => Promise<void>
    getRoot: () => Promise<bigint | null>
    isSyncing: boolean
  }
}

export function useDustSwap(options?: UseDustSwapOptions) {
  const { address, isConnected, chainId: accountChainId } = useAccount()
  const publicClient = usePublicClient()
  const { data: walletClient } = useWalletClient()

  // Use provided chainId or fall back to account chainId
  const chainId = options?.chainId ?? accountChainId

  const { generateProof } = useSwapZKProof()

  // Use provided Merkle tree or create new instance (backwards compat)
  const internalTree = useSwapMerkleTree(chainId)
  const merkleTree = options?.merkleTree ?? internalTree
  const { getProof: getMerkleProof, syncTree, getRoot, isSyncing } = merkleTree

  const { notes, spendNote } = useSwapNotes()

  const [state, setState] = useState<SwapState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<Hash | null>(null)

  const contracts = getSwapContracts(chainId)

  const reset = useCallback(() => {
    setState('idle')
    setError(null)
    setTxHash(null)
  }, [])

  /**
   * Execute a private swap using ZK proof
   */
  const executeSwap = useCallback(
    async (params: SwapParams): Promise<SwapResult | null> => {
      if (!address || !walletClient || !publicClient) {
        setError('Wallet not connected')
        return null
      }

      try {
        reset()

        // Step 1: Get deposit note
        setState('selecting-note')
        const depositNote = notes.find((n) => n.id === params.depositNoteId)

        if (!depositNote) throw new Error('Deposit note not found')
        if (depositNote.spent) throw new Error('Deposit note already spent')
        if (depositNote.leafIndex === undefined) throw new Error('Deposit note has no leaf index')

        // Step 2: Sync Merkle tree
        setState('syncing-tree')
        await syncTree()

        // Step 3: Get Merkle proof
        const merkleProof = await getMerkleProof(depositNote.leafIndex)
        if (!merkleProof) throw new Error('Failed to generate Merkle proof')

        // Step 4: Generate ZK proof (skip addKnownRoot - hook validates during swap)
        setState('generating-proof')

        const zkSwapParams: ZKSwapParams = {
          recipient: params.recipient,
          relayer: address,
          relayerFee: 0,
          swapAmountOut: params.minAmountOut,
        }

        const proofResult = await generateProof(depositNote, merkleProof, zkSwapParams)

        if (!proofResult) throw new Error('Failed to generate ZK proof')

        // Step 5: Format proof and encode as hook data
        const contractProof = formatProofForContract(
          proofResult.proof,
          proofResult.publicSignals
        )
        const hookData = encodeHookData(contractProof)

        // Step 6: Execute swap through PoolHelper (SINGLE SIGNATURE)
        setState('submitting')

        const poolKey = params.poolKey || getDustSwapPoolKey(chainId)

        const { zeroForOne, sqrtPriceLimitX96 } = getSwapDirection(
          params.fromToken,
          params.toToken,
          poolKey
        )

        // PoolSwapTest deployed on Sepolia (Feb 16 2026)
        const poolHelperAddress = '0x3b3D4d4Ed9c89FcB0ffA1Dc139C8A5ca50033470' as Address

        const hash = await walletClient.writeContract({
          address: poolHelperAddress,
          abi: POOL_HELPER_ABI,
          functionName: 'swap',
          args: [
            poolKey,
            zeroForOne,
            -BigInt(depositNote.amount), // exact input (negative = exact in)
            sqrtPriceLimitX96,
            hookData,
          ],
        })

        // Step 7: Wait for confirmation
        setState('confirming')

        const receipt = await publicClient.waitForTransactionReceipt({
          hash,
          timeout: 120_000, // 120s for Sepolia testnet
        })

        if (receipt.status === 'reverted') {
          throw new Error('Transaction reverted')
        }

        // Step 8: Mark note as spent
        if (depositNote.id) {
          await spendNote(depositNote.id)
        }

        setState('success')
        setTxHash(hash)

        return {
          hash,
          stealthAddress: params.recipient,
          nullifierHash: depositNote.nullifierHash,
          gasUsed: receipt.gasUsed,
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Swap failed'
        setError(message)
        setState('error')
        return null
      }
    },
    [
      address,
      walletClient,
      publicClient,
      chainId,
      contracts,
      notes,
      syncTree,
      getMerkleProof,
      generateProof,
      spendNote,
      reset,
    ]
  )

  /**
   * Get available (unspent) deposit notes for swapping
   */
  const getAvailableNotes = useCallback(() => {
    return notes.filter((n) => !n.spent && n.leafIndex !== undefined)
  }, [notes])

  /**
   * Estimate gas for a private swap (~850k gas)
   */
  const estimateGas = useCallback(async (): Promise<bigint> => {
    return BigInt(850000)
  }, [])

  return {
    state,
    error,
    txHash,
    isConnected,
    address,

    executeSwap,
    getAvailableNotes,
    estimateGas,
    reset,

    isLoading: [
      'selecting-note',
      'syncing-tree',
      'generating-proof',
      'submitting',
      'confirming',
    ].includes(state),
    isGeneratingProof: state === 'generating-proof',
    isSyncingTree: state === 'syncing-tree' || isSyncing,
    isSuccess: state === 'success',
    isError: state === 'error',
  }
}
