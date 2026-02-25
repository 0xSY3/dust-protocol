import { ethers } from 'ethers'
import { NextResponse } from 'next/server'
import { getServerProvider } from '@/lib/server-provider'
import { DEFAULT_CHAIN_ID } from '@/config/chains'
import { getDustPoolV2Address } from '@/lib/dustpool/v2/contracts'
import { getTreeSnapshot } from '@/lib/dustpool/v2/relayer-tree'
import { toBytes32Hex } from '@/lib/dustpool/poseidon'
import { runDepositScreenerCycle } from '@/lib/dustpool/v2/deposit-screener'

export const maxDuration = 30

const NO_STORE = { 'Cache-Control': 'no-store' } as const

// Minimal ABI for health-check reads (currentRootIndex, roots, depositQueueTail)
const HEALTH_ABI = [
  {
    name: 'currentRootIndex',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'roots',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ type: 'uint256' }],
    outputs: [{ type: 'bytes32' }],
  },
  {
    name: 'depositQueueTail',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
] as const

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const chainId = parseInt(searchParams.get('chainId') || '') || DEFAULT_CHAIN_ID

    const address = getDustPoolV2Address(chainId)
    if (!address) {
      return NextResponse.json(
        { error: 'DustPoolV2 not deployed on this chain' },
        { status: 404, headers: NO_STORE },
      )
    }

    const provider = getServerProvider(chainId)
    const contract = new ethers.Contract(address, HEALTH_ABI as unknown as ethers.ContractInterface, provider)

    // Fetch tree snapshot and on-chain state in parallel
    const [snapshot, latestBlock, currentRootIndex, depositQueueTail] = await Promise.all([
      getTreeSnapshot(chainId),
      provider.getBlockNumber(),
      contract.currentRootIndex().then((v: ethers.BigNumber) => v.toNumber()),
      contract.depositQueueTail().then((v: ethers.BigNumber) => v.toNumber()),
    ])

    const onChainRootHex: string = await contract.roots(currentRootIndex)

    const treeRootHex = toBytes32Hex(snapshot.root)
    const rootMatch = treeRootHex.toLowerCase() === onChainRootHex.toLowerCase()
    const syncGap = latestBlock - snapshot.lastSyncedBlock

    const ok = rootMatch && syncGap <= 100

    // Run deposit screener cycle (non-blocking — errors logged, not propagated)
    let screener: { lastBlock: number; flaggedCount: number; newFlagged: number; eventsProcessed: number } | null = null
    try {
      screener = await runDepositScreenerCycle(chainId)
    } catch (e) {
      console.error('[V2/health] Screener cycle error:', e instanceof Error ? e.message : e)
    }

    const body = {
      ok,
      chainId,
      tree: {
        leafCount: snapshot.leafCount,
        root: treeRootHex,
        lastSyncedBlock: snapshot.lastSyncedBlock,
      },
      onChain: {
        currentRoot: onChainRootHex,
        depositQueueTail,
      },
      rootMatch,
      latestBlock,
      syncGap,
      ...(screener && { screener }),
    }

    return NextResponse.json(body, {
      status: ok ? 200 : 503,
      headers: NO_STORE,
    })
  } catch (e) {
    console.error('[V2/health] Error:', e instanceof Error ? e.message : e)
    return NextResponse.json(
      { ok: false, error: 'Health check failed' },
      { status: 503, headers: NO_STORE },
    )
  }
}
