'use client'

/**
 * Hook for depositing to DustSwap privacy pools
 *
 * Handles ETH and ERC20 deposits including approval flow,
 * commitment generation, and note persistence.
 */

import { useState, useCallback } from 'react'
import { useAccount, usePublicClient, useWalletClient, useChainId } from 'wagmi'
import { type Address, type Hash, parseEventLogs, publicActions } from 'viem'
import { TX_RECEIPT_TIMEOUT, MAX_DEPOSITS, SUPPORTED_TOKENS } from '@/lib/swap/constants'
import {
  DUST_SWAP_POOL_ABI,
  getERC20Config,
  isNativeToken,
} from '@/lib/swap/contracts'
import { getSwapContracts } from '@/lib/swap/constants'
import { createDepositNote, formatCommitmentForContract, type DepositNote } from '@/lib/swap/zk'
import { useSwapNotes } from './useSwapNotes'

export type DepositState =
  | 'idle'
  | 'generating'
  | 'approving'
  | 'depositing'
  | 'confirming'
  | 'success'
  | 'error'

interface DepositResult {
  note: DepositNote
  txHash: Hash
  leafIndex: number
}

export function useDustSwapPool(chainIdParam?: number) {
  const { address, isConnected, chainId: accountChainId } = useAccount()
  const publicClient = usePublicClient()
  const { data: walletClient } = useWalletClient()
  const { saveNote } = useSwapNotes()

  // Use provided chainId, fall back to account chainId
  const chainId = chainIdParam ?? accountChainId

  const [state, setState] = useState<DepositState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [currentNote, setCurrentNote] = useState<DepositNote | null>(null)

  const contracts = getSwapContracts(chainId)

  /**
   * Get the pool address for a given token
   */
  const getPoolAddress = useCallback(
    (tokenAddress: Address): Address | null => {
      if (isNativeToken(tokenAddress)) {
        return contracts.dustSwapPoolETH as Address | null
      }
      return contracts.dustSwapPoolUSDC as Address | null
    },
    [contracts]
  )

  /**
   * Check ERC20 allowance for the pool
   */
  const checkAllowance = useCallback(
    async (tokenAddress: Address, poolAddress: Address): Promise<bigint> => {
      if (!publicClient || !address) return BigInt(0)

      try {
        const allowance = await publicClient.readContract({
          ...getERC20Config(tokenAddress),
          functionName: 'allowance',
          args: [address, poolAddress],
        })

        if (allowance === undefined || allowance === null) return BigInt(0)
        return BigInt(allowance.toString())
      } catch (err) {
        console.error('[DustSwap] Failed to check allowance:', err)
        return BigInt(0)
      }
    },
    [publicClient, address]
  )

  /**
   * Approve token spending for the pool
   * Uses max approval (type(uint256).max) so subsequent deposits don't need re-approval
   */
  const approveToken = useCallback(
    async (tokenAddress: Address, poolAddress: Address, _amount: bigint): Promise<Hash | null> => {
      if (!walletClient || !address) throw new Error('Wallet not connected')

      try {
        // Approve max amount so subsequent deposits don't need approval
        const MAX_UINT256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')
        const hash = await walletClient.writeContract({
          ...getERC20Config(tokenAddress),
          functionName: 'approve',
          args: [poolAddress, MAX_UINT256],
        })
        return hash
      } catch (err: any) {
        if (err.message?.includes('user rejected') || err.message?.includes('User rejected')) {
          throw new Error('Approval was rejected by user')
        }
        throw new Error('Token approval failed: ' + (err.message || 'Unknown error'))
      }
    },
    [walletClient, address]
  )

  /**
   * Deposit to DustSwapPool (ETH or ERC20)
   */
  const deposit = useCallback(
    async (
      tokenAddress: Address,
      tokenSymbol: string,
      amount: bigint
    ): Promise<DepositResult | null> => {
      if (!address || !walletClient || !publicClient) {
        setError('Wallet not connected')
        return null
      }

      const poolAddress = getPoolAddress(tokenAddress)
      if (!poolAddress) {
        setError('Pool not available for this token')
        return null
      }

      const isETH = isNativeToken(tokenAddress)

      console.log('[useDustSwapPool] Starting deposit:', {
        tokenAddress,
        tokenSymbol,
        amount: amount.toString(),
        poolAddress,
        isETH,
      })

      try {
        setState('generating')
        setError(null)

        // 1. Check token balance for ERC20
        if (!isETH) {
          console.log('[useDustSwapPool] Checking USDC balance...')
          const balance = await publicClient.readContract({
            ...getERC20Config(tokenAddress),
            functionName: 'balanceOf',
            args: [address],
          })

          console.log('[useDustSwapPool] USDC balance:', balance.toString(), 'Required:', amount.toString())

          if (balance < amount) {
            const decimals = SUPPORTED_TOKENS[tokenSymbol]?.decimals ?? 18
            throw new Error(`Insufficient ${tokenSymbol} balance. You have ${Number(balance) / Math.pow(10, decimals)} ${tokenSymbol}`)
          }
        }

        // 2. Generate deposit note
        const note = await createDepositNote(amount)
        setCurrentNote(note)
        const commitment = formatCommitmentForContract(note.commitment)

        // 3. For ERC20, handle approval
        if (!isETH) {
          console.log('[useDustSwapPool] Checking USDC allowance...')
          const existingAllowance = await checkAllowance(tokenAddress, poolAddress)
          console.log('[useDustSwapPool] Existing allowance:', existingAllowance.toString(), 'Required:', amount.toString())

          if (existingAllowance < amount) {
            console.log('[useDustSwapPool] Insufficient allowance, requesting approval...')
            setState('approving')

            const approveTxHash = await approveToken(tokenAddress, poolAddress, amount)
            if (!approveTxHash) throw new Error('Approval transaction was not submitted')

            // Poll receipt via wallet's transport (MetaMask's RPC) to avoid
            // RPC mismatch with publicClient's fallback RPCs
            const walletPublicApproval = walletClient.extend(publicActions)
            const approvalReceipt = await walletPublicApproval.waitForTransactionReceipt({
              hash: approveTxHash,
              timeout: TX_RECEIPT_TIMEOUT,
            })

            if (approvalReceipt.status === 'reverted') {
              throw new Error('Approval transaction reverted')
            }

            // Nonce is guaranteed to be synced after receipt confirmation
          }
        }

        // 3. Execute deposit
        setState('depositing')
        console.log('[useDustSwapPool] Executing deposit transaction...')

        let hash: Hash

        try {
          if (isETH) {
            console.log('[useDustSwapPool] Depositing ETH...')
            hash = await walletClient.writeContract({
              address: poolAddress,
              abi: DUST_SWAP_POOL_ABI,
              functionName: 'deposit',
              args: [commitment as `0x${string}`],
              value: amount,
            })
          } else {
            console.log('[useDustSwapPool] Depositing USDC with params:', {
              poolAddress,
              commitment,
              amount: amount.toString(),
            })
            hash = await walletClient.writeContract({
              address: poolAddress,
              abi: DUST_SWAP_POOL_ABI,
              functionName: 'deposit',
              args: [commitment as `0x${string}`, amount],
            })
            console.log('[useDustSwapPool] USDC deposit tx hash:', hash)
          }
        } catch (depositErr: any) {
          if (
            depositErr.message?.includes('insufficient allowance') ||
            depositErr.message?.includes('ERC20: transfer amount exceeds allowance')
          ) {
            throw new Error('Token approval failed. Please try again.')
          }
          if (depositErr.message?.includes('user rejected')) {
            throw new Error('Transaction was rejected')
          }
          throw depositErr
        }

        // 4. Wait for confirmation
        // Poll receipt via wallet's transport to match the RPC that submitted the tx
        setState('confirming')
        const walletPublicDeposit = walletClient.extend(publicActions)
        const receipt = await walletPublicDeposit.waitForTransactionReceipt({
          hash,
          timeout: TX_RECEIPT_TIMEOUT,
        })

        if (receipt.status === 'reverted') {
          throw new Error('Deposit transaction failed. The contract rejected the deposit.')
        }

        // 5. Parse leaf index from logs
        let leafIndex = 0

        try {
          const logs = parseEventLogs({
            abi: DUST_SWAP_POOL_ABI,
            logs: receipt.logs,
            eventName: 'Deposit',
          })

          const depositLog = logs[0] as unknown as { args: { leafIndex: bigint } } | undefined
          if (depositLog?.args?.leafIndex !== undefined) {
            leafIndex = Number(depositLog.args.leafIndex)
          }
        } catch {
          // Fallback: parse raw log data
          for (const log of receipt.logs) {
            if (log.data && log.data.length >= 66) {
              const dataWithoutPrefix = log.data.slice(2)
              const leafIndexHex = dataWithoutPrefix.slice(0, 64)
              const parsedLeafIndex = parseInt(leafIndexHex, 16)
              if (!isNaN(parsedLeafIndex) && parsedLeafIndex < MAX_DEPOSITS) {
                leafIndex = parsedLeafIndex
                break
              }
            }
          }
        }

        // Fallback: use deposit count
        if (leafIndex === 0) {
          try {
            const depositCount = await publicClient.readContract({
              address: poolAddress,
              abi: DUST_SWAP_POOL_ABI,
              functionName: 'getDepositCount',
              args: [],
            })
            leafIndex = Number(depositCount) - 1
          } catch {}
        }

        // 6. Save note
        note.leafIndex = leafIndex
        await saveNote(note, tokenAddress, tokenSymbol, hash)

        setState('success')

        return { note, txHash: hash, leafIndex }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Deposit failed'
        setError(message)
        setState('error')
        return null
      }
    },
    [
      address,
      walletClient,
      publicClient,
      getPoolAddress,
      checkAllowance,
      approveToken,
      saveNote,
    ]
  )

  /**
   * Get deposit count for a pool
   */
  const getDepositCount = useCallback(
    async (tokenAddress?: Address): Promise<number> => {
      if (!publicClient) return 0

      const poolAddress = getPoolAddress(
        tokenAddress ?? ('0x0000000000000000000000000000000000000000' as Address)
      )
      if (!poolAddress) return 0

      try {
        const count = await publicClient.readContract({
          address: poolAddress,
          abi: DUST_SWAP_POOL_ABI,
          functionName: 'getDepositCount',
          args: [],
        })
        return Number(count)
      } catch {
        return 0
      }
    },
    [publicClient, getPoolAddress]
  )

  /**
   * Get the current Merkle root from the pool contract
   */
  const getMerkleRoot = useCallback(
    async (tokenAddress?: Address): Promise<bigint | null> => {
      if (!publicClient) return null

      const poolAddress = getPoolAddress(
        tokenAddress ?? ('0x0000000000000000000000000000000000000000' as Address)
      )
      if (!poolAddress) return null

      try {
        const root = await publicClient.readContract({
          address: poolAddress,
          abi: DUST_SWAP_POOL_ABI,
          functionName: 'getLastRoot',
          args: [],
        })

        if (typeof root === 'string') return BigInt(root)
        return root as bigint
      } catch {
        return null
      }
    },
    [publicClient, getPoolAddress]
  )

  /**
   * Check if a nullifier has been spent
   */
  const isNullifierSpent = useCallback(
    async (nullifierHash: bigint, tokenAddress?: Address): Promise<boolean> => {
      if (!publicClient) return false

      const poolAddress = getPoolAddress(
        tokenAddress ?? ('0x0000000000000000000000000000000000000000' as Address)
      )
      if (!poolAddress) return false

      try {
        const nullifierHashHex = `0x${nullifierHash.toString(16).padStart(64, '0')}` as `0x${string}`

        const spent = await publicClient.readContract({
          address: poolAddress,
          abi: DUST_SWAP_POOL_ABI,
          functionName: 'isSpent',
          args: [nullifierHashHex],
        })

        return spent as boolean
      } catch {
        return false
      }
    },
    [publicClient, getPoolAddress]
  )

  const reset = useCallback(() => {
    setState('idle')
    setError(null)
    setCurrentNote(null)
  }, [])

  return {
    state,
    error,
    currentNote,
    isConnected,
    address,

    deposit,
    getDepositCount,
    getMerkleRoot,
    isNullifierSpent,
    reset,

    isLoading:
      state === 'generating' ||
      state === 'approving' ||
      state === 'depositing' ||
      state === 'confirming',
    isSuccess: state === 'success',
    isError: state === 'error',
  }
}
