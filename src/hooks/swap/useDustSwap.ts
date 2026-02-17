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
import { type Address, type Hash, encodeAbiParameters, parseAbiParameters, decodeErrorResult, encodeFunctionData, publicActions } from 'viem'
import {
  getDustSwapPoolKey,
  DUST_SWAP_POOL_ABI,
  POOL_HELPER_ABI,
  SWAP_ERROR_ABI,
  getSwapDirection,
  type PoolKey,
} from '@/lib/swap/contracts'
import { getSwapContracts, SWAP_GAS_LIMIT, TX_RECEIPT_TIMEOUT, SUPPORTED_TOKENS } from '@/lib/swap/constants'
import { getChainConfig } from '@/config/chains'
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
    // Circuit has 8 public signals: [root, nullifierHash, recipient, relayer, fee, swapAmountOut, reserved1, reserved2]
    pubSignals: publicSignals.map((s) => BigInt(s)) as [
      bigint, bigint, bigint, bigint,
      bigint, bigint, bigint, bigint,
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

/**
 * Human-readable messages for known hook errors
 */
const HOOK_ERROR_MESSAGES: Record<string, string> = {
  InvalidMerkleRoot: 'Merkle root not recognized by pool. The pool may need re-syncing.',
  InvalidProof: 'ZK proof verification failed on-chain.',
  NullifierAlreadyUsed: 'This deposit note has already been used.',
  InvalidRecipient: 'Invalid recipient address.',
  InvalidRelayerFee: 'Relayer fee exceeds maximum allowed.',
  UnauthorizedRelayer: 'Relayer is not authorized.',
  SwapAmountTooLow: 'Output amount too low (excessive slippage).',
  InvalidMinimumOutput: 'Minimum output amount is zero.',
  SwapNotInitialized: 'Swap pool not initialized.',
  NotPoolManager: 'Hook called by wrong address (deployment misconfiguration).',
  Unauthorized: 'Caller not authorized for this operation.',
  HookNotImplemented: 'Hook callback not implemented.',
}

/**
 * Decode swap simulation errors, unwrapping Uniswap V4 WrappedError(0x90bfb865)
 *
 * Viem wraps contract reverts in ContractFunctionExecutionError → cause chain.
 * We walk the cause chain to find the raw revert data, decode WrappedError,
 * then decode the inner hook error.
 */
function decodeSwapError(simErr: unknown): Error {
  const simMsg = simErr instanceof Error ? simErr.message : String(simErr)
  console.error('[DustSwap] decodeSwapError called with:', simMsg)
  if (simErr instanceof Error && (simErr as any).data) console.error('[DustSwap] Error data property:', (simErr as any).data)


  // Walk the error cause chain to find the raw revert data
  let rawData: `0x${string}` | null = null
  let current: any = simErr

  while (current) {
    // viem's ContractFunctionRevertedError stores revert data in .data
    if (current.data && typeof current.data === 'string' && current.data.startsWith('0x') && current.data.length > 10) {
      rawData = current.data as `0x${string}`
      break
    }
    // Some viem versions use .cause.data or nested .error
    current = current.cause || current.error || null
  }

  // Fallback: extract long hex sequences from the message (the full ABI-encoded revert)
  if (!rawData) {
    // Match hex strings that are at least 10 chars (4-byte selector + some data)
    const hexMatches = simMsg.match(/0x[0-9a-fA-F]{8,}/g)
    if (hexMatches) {
      // Use the longest hex string (most likely the full revert data)
      rawData = hexMatches.sort((a, b) => b.length - a.length)[0] as `0x${string}`
    }
  }

  if (rawData && rawData.length >= 10) {
    console.log('[DustSwap] Raw revert data found:', rawData.slice(0, 66) + '...')

    try {
      // Try decoding as WrappedError first
      console.log('[DustSwap] Decoding with ABI length:', SWAP_ERROR_ABI.length)
      console.log('[DustSwap] ABI error names:', SWAP_ERROR_ABI.map((e: any) => e.name).join(', '))
      const decoded = decodeErrorResult({
        abi: SWAP_ERROR_ABI,
        data: rawData,
      })

      if (decoded.errorName === 'WrappedError') {
        const [target, selector, reason] = decoded.args as [string, string, string, string]
        console.log('[DustSwap] WrappedError decoded:', { target, selector, reason })

        let innerError: string | null = null

        // Decode the inner reason against hook error ABI
        if (reason && reason !== '0x' && reason.length >= 10) {
          try {
            const innerDecoded = decodeErrorResult({
              abi: SWAP_ERROR_ABI,
              data: reason as `0x${string}`,
            })
            innerError = HOOK_ERROR_MESSAGES[innerDecoded.errorName]
              || `Hook error: ${innerDecoded.errorName}`
          } catch {
            // Failed to decode reason - fall through to selector check
          }
        }

        if (innerError) {
          return new Error(`Swap failed: ${innerError}`)
        }

        // Handle specific unknown selectors
        if (selector === '0x575e24b4') {
          return new Error('Swap failed: Proof Verification Failed (Verifier Rejected)')
        }

        return new Error(`Swap failed: Hook reverted (selector: ${selector})`)
      }

      // Not WrappedError — check if it's a direct hook error
      const message = HOOK_ERROR_MESSAGES[decoded.errorName]
      if (message) {
        return new Error(`Swap failed: ${message}`)
      }
      return new Error(`Swap failed: ${decoded.errorName}`)
    } catch {
      // Raw data didn't decode as any known error — log for debugging
      console.log('[DustSwap] Could not decode revert data:', rawData.slice(0, 66))
    }
  }

  // Fallback: string matching for error names in the message
  for (const [errorName, message] of Object.entries(HOOK_ERROR_MESSAGES)) {
    if (simMsg.includes(errorName)) {
      return new Error(`Swap failed: ${message}`)
    }
  }

  return new Error(`Swap simulation failed: ${simMsg.slice(0, 300)}`)
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

        // Step 5.5: Pre-swap diagnostics — verify on-chain state before submitting
        // This catches InvalidMerkleRoot / NullifierAlreadyUsed / InvalidProof early
        // with clear messages instead of opaque WrappedError reverts
        {
          const poolKey = params.poolKey || getDustSwapPoolKey(chainId)
          const { zeroForOne } = getSwapDirection(params.fromToken, params.toToken, poolKey)

          // Select the correct pool (same logic as DustSwapHook.sol line 147)
          const poolAddress = zeroForOne
            ? contracts.dustSwapPoolETH as Address
            : contracts.dustSwapPoolUSDC as Address

          if (!poolAddress) throw new Error('DustSwapPool not configured for this chain')

          const rootHex = `0x${contractProof.pubSignals[0].toString(16).padStart(64, '0')}` as `0x${string}`
          const nullifierHex = `0x${contractProof.pubSignals[1].toString(16).padStart(64, '0')}` as `0x${string}`

          console.log('[DustSwap] Pre-swap diagnostics:', {
            pool: zeroForOne ? 'ETH' : 'USDC',
            poolAddress,
            merkleRoot: rootHex,
            nullifierHash: nullifierHex,
            recipient: `0x${contractProof.pubSignals[2].toString(16)}`,
            relayer: `0x${contractProof.pubSignals[3].toString(16)}`,
            relayerFee: contractProof.pubSignals[4].toString(),
            swapAmountOut: contractProof.pubSignals[5].toString(),
            depositAmount: depositNote.amount.toString(),
          })

          // Check 1: Is the Merkle root known on-chain?
          const isRootKnown = await publicClient.readContract({
            address: poolAddress,
            abi: DUST_SWAP_POOL_ABI,
            functionName: 'isKnownRoot',
            args: [rootHex],
          })

          if (!isRootKnown) {
            // Also check what root the chain currently has
            const onChainRoot = await publicClient.readContract({
              address: poolAddress,
              abi: DUST_SWAP_POOL_ABI,
              functionName: 'getLastRoot',
            })
            const depositCount = await publicClient.readContract({
              address: poolAddress,
              abi: DUST_SWAP_POOL_ABI,
              functionName: 'getDepositCount',
            })
            console.error('[DustSwap] ROOT MISMATCH:', {
              clientRoot: rootHex,
              onChainRoot,
              depositCount,
            })
            throw new Error(
              `Merkle root not recognized by pool. Client root: ${rootHex.slice(0, 18)}... ` +
              `On-chain root: ${(onChainRoot as string).slice(0, 18)}... ` +
              `(${depositCount} deposits). Try re-syncing the Merkle tree.`
            )
          }
          console.log('[DustSwap] ✅ Merkle root is known on-chain')

          // Check 2: Is the nullifier already spent?
          const isNullifierSpent = await publicClient.readContract({
            address: poolAddress,
            abi: DUST_SWAP_POOL_ABI,
            functionName: 'isSpent',
            args: [nullifierHex],
          })

          if (isNullifierSpent) {
            throw new Error('This deposit note has already been used (nullifier is spent on-chain)')
          }
          console.log('[DustSwap] ✅ Nullifier not yet spent')

          // Check 3: Verify proof locally before submitting
          try {
            const { verifyProofLocally } = await import('@/lib/swap/zk/proof')
            const isProofValid = await verifyProofLocally(proofResult.proof, proofResult.publicSignals)
            if (!isProofValid) {
              console.error('[DustSwap] LOCAL PROOF VERIFICATION FAILED')
              throw new Error(
                'ZK proof failed local verification. The proof may be invalid or the circuit/keys may be mismatched. ' +
                'Check that /circuits/verification_key.json matches the deployed verifier.'
              )
            }
            console.log('[DustSwap] ✅ Proof verified locally')
          } catch (verifyErr) {
            if (verifyErr instanceof Error && verifyErr.message.includes('ZK proof failed')) {
              throw verifyErr
            }
            // If local verification fails to load, warn but continue
            console.warn('[DustSwap] Could not verify proof locally (non-fatal):', verifyErr)
          }
        }

        // Step 6: Execute swap through PoolHelper (SINGLE SIGNATURE)
        setState('submitting')

        const poolKey = params.poolKey || getDustSwapPoolKey(chainId)

        const { zeroForOne, sqrtPriceLimitX96 } = getSwapDirection(
          params.fromToken,
          params.toToken,
          poolKey
        )

        // PoolSwapTest deployed on Sepolia - use address from config
        const poolHelperAddress = contracts.uniswapV4SwapRouter as Address
        if (!poolHelperAddress) throw new Error('Swap Router not configured for this chain')

        const swapArgs = {
          address: poolHelperAddress,
          abi: [...POOL_HELPER_ABI, ...SWAP_ERROR_ABI],
          functionName: 'swap' as const,
          args: [
            poolKey,
            {
              zeroForOne,
              amountSpecified: -BigInt(depositNote.amount),
              sqrtPriceLimitX96,
            },
            {
              takeClaims: false,
              settleUsingBurn: false,
            },
            hookData,
          ] as const,
          // For ETH→token swaps (zeroForOne, since currency0 = native ETH),
          // we must send ETH value with the payable swap call
          ...(zeroForOne ? { value: BigInt(depositNote.amount) } : {}),
          // Cap gas to prevent MetaMask from using block gas limit on simulation failure
          gas: SWAP_GAS_LIMIT,
        }

        // Pre-flight simulation: use raw call to capture revert data
        // simulateContract fails to decode 0x90bfb865 (WrappedError) properly
        try {
          const callData = encodeFunctionData({
            abi: swapArgs.abi,
            functionName: swapArgs.functionName,
            args: swapArgs.args
          })

          await publicClient.call({
            account: address,
            to: swapArgs.address,
            data: callData,
            value: zeroForOne ? BigInt(depositNote.amount) : 0n,
            gas: swapArgs.gas
          })
        } catch (simErr) {
          throw decodeSwapError(simErr)
        }

        const hash = await walletClient.writeContract(swapArgs)

        // Step 7: Wait for confirmation
        // Use walletClient's transport (MetaMask's RPC) to poll for receipt.
        // This avoids the RPC mismatch where publicClient polls different RPCs
        // (dRPC/1RPC/Tenderly) that may not have seen the tx submitted via MetaMask (Infura).
        setState('confirming')
        setTxHash(hash)

        const walletPublic = walletClient.extend(publicActions)
        const receipt = await walletPublic.waitForTransactionReceipt({
          hash,
          timeout: TX_RECEIPT_TIMEOUT,
        })

        if (receipt.status === 'reverted') {
          throw new Error('Transaction reverted')
        }

        // Step 8: Mark note as spent
        if (depositNote.id) {
          await spendNote(depositNote.id)
        }

        setState('success')

        return {
          hash,
          stealthAddress: params.recipient,
          nullifierHash: depositNote.nullifierHash,
          gasUsed: receipt.gasUsed,
        }
      } catch (err) {
        // Detect receipt timeout — tx was submitted but confirmation timed out.
        // Don't mark note as spent since we don't know the tx outcome.
        const isReceiptTimeout =
          err instanceof Error &&
          (err.name === 'TransactionReceiptNotFoundError' ||
           err.message.includes('could not be found'))

        if (isReceiptTimeout && txHash) {
          const explorerUrl = getChainConfig(chainId)?.blockExplorerUrl
          const txLink = explorerUrl ? `${explorerUrl}/tx/${txHash}` : txHash
          setError(`Transaction submitted but confirmation timed out. Check status: ${txLink}`)
          setState('error')
          return null
        }

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
   * Estimate gas for a private swap (~500k gas with Groth16 verification)
   */
  const estimateGas = useCallback(async (): Promise<bigint> => {
    return SWAP_GAS_LIMIT
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
