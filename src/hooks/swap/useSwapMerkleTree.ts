'use client'

/**
 * Hook for syncing and managing the DustSwap Merkle tree
 *
 * Syncs deposit events from on-chain, builds a local Poseidon tree,
 * persists state in IndexedDB, and auto-syncs every 30 seconds.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { usePublicClient, useChainId } from 'wagmi'
import { MerkleTree, type MerkleProof } from '@/lib/swap/zk'
import { DUST_SWAP_POOL_ABI } from '@/lib/swap/contracts'
import { getSwapContracts, getSwapDeploymentBlock, RPC_LOG_BATCH_SIZE, MERKLE_SYNC_TIMEOUT } from '@/lib/swap/constants'
import {
  saveMerkleTreeState,
  loadMerkleTreeState,
  deleteMerkleTreeState,
  type StoredMerkleTree,
} from '@/lib/swap/storage/merkle-tree'

export type SyncState = 'idle' | 'syncing' | 'synced' | 'error'

type MerkleTreeInstance = InstanceType<typeof MerkleTree>

export function useSwapMerkleTree(chainIdParam?: number) {
  const publicClient = usePublicClient()
  const accountChainId = useChainId()

  // Use provided chainId or fall back to account chainId
  const chainId = chainIdParam ?? accountChainId

  const [tree, setTree] = useState<MerkleTreeInstance | null>(null)
  const [state, setState] = useState<SyncState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [lastSyncedBlock, setLastSyncedBlock] = useState<number>(0)
  const [leafCount, setLeafCount] = useState<number>(0)

  // Concurrency lock to prevent overlapping syncs
  const syncingLockRef = useRef(false)
  // Abort controller for canceling in-flight requests
  const abortControllerRef = useRef<AbortController | null>(null)
  // Exponential backoff tracking
  const retryCountRef = useRef(0)
  const nextRetryTimeRef = useRef(0)

  // Pool address for the current chain
  const contracts = getSwapContracts(chainId)
  const poolAddress = contracts.dustSwapPoolETH
  const treeId = `${chainId}-${poolAddress}`

  /**
   * Load tree from IndexedDB or create a fresh one
   */
  const loadTree = useCallback(async (): Promise<MerkleTreeInstance | null> => {
    try {
      const stored = await loadMerkleTreeState(treeId)

      if (!stored) {
        const newTree = new MerkleTree()
        await newTree.initialize()
        return newTree
      }

      const restoredTree = new MerkleTree()
      await restoredTree.importState({
        height: stored.height,
        leaves: stored.leaves,
      })

      setLastSyncedBlock(stored.lastSyncedBlock)
      setLeafCount(stored.leaves.length)

      return restoredTree
    } catch (err) {
      console.error('[DustSwap] Failed to load tree:', err)
      return null
    }
  }, [treeId])

  /**
   * Persist tree state to IndexedDB
   */
  const saveTree = useCallback(
    async (merkleTree: MerkleTreeInstance, lastBlock: number): Promise<void> => {
      try {
        const treeState = merkleTree.exportState()
        const root = merkleTree.getRoot()

        const stored: StoredMerkleTree = {
          id: treeId,
          height: treeState.height,
          leaves: treeState.leaves,
          lastSyncedBlock: lastBlock,
          lastUpdated: Date.now(),
          root: root.toString(),
        }

        await saveMerkleTreeState(stored)
        setLastSyncedBlock(lastBlock)
        setLeafCount(treeState.leaves.length)
      } catch (err) {
        console.error('[DustSwap] Failed to save tree:', err)
      }
    },
    [treeId]
  )

  /**
   * Fetch Deposit events from the DustSwapPool contract
   * Batches large block ranges to avoid RPC limits (max 50k blocks per request)
   * Returns array of {commitment, leafIndex} objects for proper deduplication
   */
  const fetchDeposits = useCallback(
    async (fromBlock: bigint, toBlock: bigint): Promise<Array<{ commitment: bigint, leafIndex: number }>> => {
      if (!publicClient || !poolAddress) return []

      const BATCH_SIZE = RPC_LOG_BATCH_SIZE
      const allLogs: any[] = []

      try {
        let currentFrom = fromBlock

        // Batch requests to stay within RPC limits
        while (currentFrom <= toBlock) {
          const currentTo = currentFrom + BATCH_SIZE - 1n > toBlock
            ? toBlock
            : currentFrom + BATCH_SIZE - 1n

          const logs = await publicClient.getLogs({
            address: poolAddress as `0x${string}`,
            event: {
              type: 'event',
              name: 'Deposit',
              inputs: [
                { type: 'bytes32', name: 'commitment', indexed: true },
                { type: 'uint32', name: 'leafIndex', indexed: false },
                { type: 'uint256', name: 'amount', indexed: false },
                { type: 'uint256', name: 'timestamp', indexed: false },
              ],
            },
            fromBlock: currentFrom,
            toBlock: currentTo,
          })

          allLogs.push(...logs)
          currentFrom = currentTo + 1n
        }

        // Sort by leafIndex to ensure correct insertion order
        const sortedLogs = [...allLogs].sort((a: any, b: any) => {
          return Number(a.args.leafIndex) - Number(b.args.leafIndex)
        })

        return sortedLogs.map((log: any) => ({
          commitment: BigInt(log.args.commitment),
          leafIndex: Number(log.args.leafIndex)
        }))
      } catch (err) {
        console.error('[DustSwap] Failed to fetch deposits:', err)
        // Throw error instead of returning [] to prevent silently skipping deposits
        throw err
      }
    },
    [publicClient, poolAddress]
  )

  /**
   * Sync tree with on-chain state
   * Fixed: Concurrency lock + AbortController + exponential backoff + explicit params to avoid stale closures
   */
  const syncTree = useCallback(async (existingTree?: MerkleTreeInstance, fromBlockOverride?: number): Promise<void> => {
    // Concurrency lock - prevent overlapping syncs
    if (syncingLockRef.current) {
      console.log('[DustSwap] Sync already in progress, skipping')
      return
    }

    // Exponential backoff - don't retry if we're in backoff period
    const now = Date.now()
    if (now < nextRetryTimeRef.current) {
      const waitSeconds = Math.ceil((nextRetryTimeRef.current - now) / 1000)
      console.log(`[DustSwap] In backoff period, waiting ${waitSeconds}s before retry`)
      return
    }

    if (!publicClient) {
      setError('Public client not available')
      return
    }

    syncingLockRef.current = true
    setState('syncing')
    setError(null)

    // Create AbortController for canceling in-flight requests
    const abortController = new AbortController()
    abortControllerRef.current = abortController

    // Timeout with abort signal
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        abortController.abort()
        reject(new Error('Sync timeout - RPC not responding'))
      }, MERKLE_SYNC_TIMEOUT)
    })

    try {
      await Promise.race([
        (async () => {
          // Use explicit params to avoid stale closure (fixes double-insertion bug)
          let merkleTree = existingTree || tree || (await loadTree())

          if (!merkleTree) {
            merkleTree = new MerkleTree()
            await merkleTree.initialize()
          }

          const currentBlock = await publicClient.getBlockNumber()
          const deploymentBlock = getSwapDeploymentBlock(chainId)

          // Use explicit fromBlockOverride to avoid stale closure
          const effectiveLastBlock = fromBlockOverride ?? lastSyncedBlock
          const fromBlock =
            effectiveLastBlock > 0
              ? BigInt(effectiveLastBlock + 1)
              : BigInt(deploymentBlock ?? 0)

          const newDeposits = await fetchDeposits(fromBlock, currentBlock)

          console.log(`[DustSwap] Fetched ${newDeposits.length} new deposits (blocks ${fromBlock} to ${currentBlock})`)

          // Deduplication guard: skip deposits already in tree by comparing leafIndex
          const expectedNextIndex = merkleTree.getLeafCount()
          const depositsToInsert = newDeposits.filter(d => d.leafIndex >= expectedNextIndex)

          if (depositsToInsert.length !== newDeposits.length) {
            console.log(`[DustSwap] Skipping ${newDeposits.length - depositsToInsert.length} duplicate deposits (tree has ${expectedNextIndex} leaves, fetched deposits ${newDeposits[0]?.leafIndex ?? 0} to ${newDeposits[newDeposits.length - 1]?.leafIndex ?? 0})`)
          }

          for (const deposit of depositsToInsert) {
            await merkleTree.insert(deposit.commitment)
          }

          console.log(`[DustSwap] Tree now has ${merkleTree.getLeafCount()} leaves`)

          // Verify root matches on-chain (read at same block height to avoid race condition)
          if (poolAddress) {
            try {
              const onChainRoot = (await publicClient.readContract({
                address: poolAddress as `0x${string}`,
                abi: DUST_SWAP_POOL_ABI,
                functionName: 'getLastRoot',
                args: [],
                blockNumber: currentBlock, // Read at same block as deposits to avoid race condition
              })) as `0x${string}`

              const computedRoot = merkleTree.getRoot()
              const onChainRootBigInt = BigInt(onChainRoot)

              if (computedRoot !== onChainRootBigInt) {
                console.error('[DustSwap] Merkle root mismatch! Clearing local state to resync.', {
                  computed: `0x${computedRoot.toString(16).padStart(64, '0')}`,
                  onChain: onChainRoot,
                })

                // Critical error state - nuke local storage to force full resync
                await deleteMerkleTreeState(treeId)
                setTree(null)
                setLastSyncedBlock(0)
                setLeafCount(0)
                setState('idle') // Will trigger restart next tick
                syncingLockRef.current = false
                return
              }
            } catch (verifyErr) {
              console.warn('[DustSwap] Could not verify root against on-chain:', verifyErr)
            }
          }

          await saveTree(merkleTree, Number(currentBlock))

          setTree(merkleTree)
          setState('synced')

          // Reset retry count on success
          retryCountRef.current = 0
          nextRetryTimeRef.current = 0
        })(),
        timeoutPromise,
      ])
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sync failed'
      setError(message)
      setState('error')
      console.error('[DustSwap] Tree sync failed:', err)

      // Exponential backoff: 5s, 10s, 20s, 40s, 60s (max)
      retryCountRef.current += 1
      const backoffSeconds = Math.min(5 * Math.pow(2, retryCountRef.current - 1), 60)
      nextRetryTimeRef.current = Date.now() + backoffSeconds * 1000
      console.log(`[DustSwap] Retry ${retryCountRef.current}, backing off ${backoffSeconds}s`)
    } finally {
      // Release lock and cleanup
      syncingLockRef.current = false
      abortControllerRef.current = null
    }
  }, [publicClient, tree, lastSyncedBlock, chainId, poolAddress, loadTree, fetchDeposits, saveTree])

  /**
   * Get Merkle proof for a given leaf index
   */
  const getProof = useCallback(
    async (leafIndex: number): Promise<MerkleProof | null> => {
      if (!tree) {
        setError('Tree not initialized')
        return null
      }

      try {
        return await tree.getProof(leafIndex)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to generate proof'
        setError(message)
        return null
      }
    },
    [tree]
  )

  /**
   * Get current root
   */
  const getRoot = useCallback(async (): Promise<bigint | null> => {
    if (!tree) return null
    try {
      return tree.getRoot()
    } catch {
      return null
    }
  }, [tree])

  /**
   * Check if tree needs syncing
   */
  const needsSync = useCallback(async (): Promise<boolean> => {
    if (!publicClient) return false
    try {
      const currentBlock = await publicClient.getBlockNumber()
      return Number(currentBlock) > lastSyncedBlock
    } catch {
      return false
    }
  }, [publicClient, lastSyncedBlock])

  /**
   * Force refresh (clear cache and resync)
   * Fixed: Create new tree directly to avoid stale closure
   */
  const forceRefresh = useCallback(async (): Promise<void> => {
    setState('syncing')
    setError(null)

    try {
      // Create brand new tree (bypass stale state)
      const newTree = new MerkleTree()
      await newTree.initialize()

      setLastSyncedBlock(0)
      setTree(newTree)

      // Fetch all deposits from deployment
      if (!publicClient) return

      const currentBlock = await publicClient.getBlockNumber()
      const deploymentBlock = getSwapDeploymentBlock(chainId)
      const fromBlock = BigInt(deploymentBlock ?? 0)

      const deposits = await fetchDeposits(fromBlock, currentBlock)

      console.log(`[DustSwap] Force refresh: fetched ${deposits.length} deposits from deployment`)

      for (const deposit of deposits) {
        await newTree.insert(deposit.commitment)
      }

      console.log(`[DustSwap] Force refresh: tree now has ${newTree.getLeafCount()} leaves`)

      await saveTree(newTree, Number(currentBlock))
      setTree(newTree)
      setState('synced')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Refresh failed'
      setError(message)
      setState('error')
      console.error('[DustSwap] Force refresh failed:', err)
    }
  }, [publicClient, chainId, fetchDeposits, saveTree])

  // Auto-load tree on mount and trigger initial sync
  // FIX: Use ref for syncTree to avoid infinite re-render loop
  const syncTreeRef = useRef<(tree?: MerkleTreeInstance, fromBlock?: number) => Promise<void>>()
  syncTreeRef.current = syncTree

  useEffect(() => {
    let mounted = true
    let loadedLastBlock = 0
    loadTree().then((loadedTree) => {
      if (loadedTree && mounted) {
        // Get the lastSyncedBlock from loaded tree state BEFORE calling syncTree
        loadMerkleTreeState(treeId).then((stored) => {
          if (!mounted) return
          loadedLastBlock = stored?.lastSyncedBlock ?? 0

          setTree(loadedTree)
          setLastSyncedBlock(loadedLastBlock)
          setState('synced')

          // Pass loaded tree and lastSyncedBlock explicitly to avoid stale closure (fixes double-insertion bug)
          syncTreeRef.current?.(loadedTree, loadedLastBlock)
        })
      }
    })
    return () => { mounted = false }
  }, [loadTree, treeId]) // ✅ syncTree removed from deps, treeId added for loadMerkleTreeState

  // Auto-sync every 30 seconds (balanced: fast enough for updates, stable UI)
  // Fixed: Use ref for state check to avoid resetting interval
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    const interval = setInterval(() => {
      // Skip if already syncing (concurrency lock handles this too, but check early)
      if (stateRef.current !== 'syncing') {
        syncTree()
      }
    }, MERKLE_SYNC_TIMEOUT) // balance between speed and stability

    return () => clearInterval(interval)
  }, [syncTree]) // ✅ Removed state from deps - prevents interval reset

  return {
    tree,
    state,
    error,
    lastSyncedBlock,
    leafCount,
    syncTree,
    getProof,
    getRoot,
    needsSync,
    forceRefresh,
    isSyncing: state === 'syncing',
    isSynced: state === 'synced',
    isError: state === 'error',
  }
}
