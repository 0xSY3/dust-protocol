import { ethers } from 'ethers'
import { NextResponse } from 'next/server'
import { getServerProvider, getCachedBlockNumber } from '@/lib/server-provider'
import { getChainConfig, getSupportedChains, isChainSupported } from '@/config/chains'

export const maxDuration = 30

const CACHE_TTL_MS = 60 * 60 * 1000

interface ChainMetrics {
  name: string
  announcements: number
  deposits: number
  withdrawals: number
  uniqueAddresses: number
  tvlWei: string
}

interface CacheEntry {
  data: Record<string, ChainMetrics>
  timestamp: number
}

// Promise-based cache prevents stampede (multiple concurrent requests triggering parallel fetches)
const cache = new Map<string, CacheEntry>()
const inflightCache = new Map<string, Promise<Record<string, ChainMetrics>>>()

// Incremental scanning: track last scanned block per chain to avoid full re-scans
const lastScannedBlock = new Map<number, number>()
const MAX_BLOCK_RANGE = 50_000

// Rate limiting: 10 requests per minute per IP
const RATE_WINDOW_MS = 60_000
const RATE_MAX_REQUESTS = 10
const rateLimitMap = new Map<string, number[]>()

const ANNOUNCER_EVENT = 'event Announcement(uint256 indexed schemeId, address indexed stealthAddress, address indexed caller, bytes ephemeralPubKey, bytes metadata)'
const DEPOSIT_EVENT = 'event DepositQueued(bytes32 indexed commitment, uint256 queueIndex, uint256 amount, address asset, uint256 timestamp)'
const WITHDRAWAL_EVENT = 'event Withdrawal(bytes32 indexed nullifier, address indexed recipient, uint256 amount, address asset)'
const TOTAL_DEPOSITED_ABI = [{
  name: 'totalDeposited',
  type: 'function',
  stateMutability: 'view',
  inputs: [{ name: 'token', type: 'address' }],
  outputs: [{ type: 'uint256' }],
}] as const

const ETH_ADDRESS = '0x0000000000000000000000000000000000000000'
const LOG_BATCH_SIZE = 10_000

interface LogCounts {
  count: number
  addresses: Set<string>
}

// Count logs inline without accumulating full event arrays (memory optimization)
async function countLogs(
  contract: ethers.Contract,
  filter: ethers.EventFilter,
  from: number,
  to: number,
  extractAddresses?: (ev: ethers.Event) => string[],
): Promise<LogCounts> {
  const result: LogCounts = { count: 0, addresses: new Set() }
  for (let start = from; start <= to; start += LOG_BATCH_SIZE) {
    const end = Math.min(start + LOG_BATCH_SIZE - 1, to)
    const batch = await contract.queryFilter(filter, start, end)
    result.count += batch.length
    if (extractAddresses) {
      for (const ev of batch) {
        for (const addr of extractAddresses(ev)) {
          result.addresses.add(addr)
        }
      }
    }
  }
  return result
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const timestamps = rateLimitMap.get(ip) ?? []
  const recent = timestamps.filter(t => now - t < RATE_WINDOW_MS)
  if (recent.length >= RATE_MAX_REQUESTS) {
    rateLimitMap.set(ip, recent)
    return false
  }
  recent.push(now)
  rateLimitMap.set(ip, recent)
  return true
}

async function fetchChainMetrics(chainId: number): Promise<ChainMetrics> {
  const config = getChainConfig(chainId)
  const provider = getServerProvider(chainId)
  const latestBlock = await getCachedBlockNumber(chainId)

  // Incremental scanning: only scan from last known block, capped at MAX_BLOCK_RANGE
  const lastScanned = lastScannedBlock.get(chainId) ?? config.deploymentBlock
  const fromBlock = Math.max(lastScanned, latestBlock - MAX_BLOCK_RANGE)

  const announcerAddr = config.contracts.announcer
  const dustPoolV2Addr = config.contracts.dustPoolV2

  let announcements = 0
  const addressSet = new Set<string>()

  if (announcerAddr) {
    const announcerIface = new ethers.utils.Interface([ANNOUNCER_EVENT])
    const announcer = new ethers.Contract(announcerAddr, announcerIface, provider)
    const filter = announcer.filters.Announcement(1, null, null)
    const result = await countLogs(announcer, filter, fromBlock, latestBlock, (ev) => {
      const addrs: string[] = []
      if (ev.args?.caller) addrs.push(ev.args.caller.toLowerCase())
      if (ev.args?.stealthAddress) addrs.push(ev.args.stealthAddress.toLowerCase())
      return addrs
    })
    announcements = result.count
    for (const addr of result.addresses) addressSet.add(addr)
  }

  let deposits = 0
  let withdrawals = 0
  let tvlWei = ethers.BigNumber.from(0)

  if (dustPoolV2Addr) {
    const poolIface = new ethers.utils.Interface([DEPOSIT_EVENT, WITHDRAWAL_EVENT])
    const pool = new ethers.Contract(dustPoolV2Addr, poolIface, provider)
    const poolFromBlock = Math.max(config.dustPoolDeploymentBlock ?? config.deploymentBlock, fromBlock)

    const [depositResult, withdrawalResult] = await Promise.all([
      countLogs(pool, pool.filters.DepositQueued(), poolFromBlock, latestBlock),
      countLogs(pool, pool.filters.Withdrawal(), poolFromBlock, latestBlock, (ev) => {
        const addrs: string[] = []
        if (ev.args?.recipient) addrs.push(ev.args.recipient.toLowerCase())
        return addrs
      }),
    ])
    deposits = depositResult.count
    withdrawals = withdrawalResult.count

    for (const addr of withdrawalResult.addresses) addressSet.add(addr)

    const tvlContract = new ethers.Contract(dustPoolV2Addr, TOTAL_DEPOSITED_ABI as unknown as ethers.ContractInterface, provider)
    try {
      tvlWei = await tvlContract.totalDeposited(ETH_ADDRESS)
    } catch (e) {
      console.error('[metrics] totalDeposited failed:', e)
    }
  }

  lastScannedBlock.set(chainId, latestBlock)

  return {
    name: config.name,
    announcements,
    deposits,
    withdrawals,
    uniqueAddresses: addressSet.size,
    tvlWei: tvlWei.toString(),
  }
}

async function fetchAndCacheMetrics(cacheKey: string, fetcher: () => Promise<Record<string, ChainMetrics>>): Promise<Record<string, ChainMetrics>> {
  // Return fresh cache if available
  const cached = cache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data
  }

  // Stampede prevention: reuse in-flight promise if one exists
  const inflight = inflightCache.get(cacheKey)
  if (inflight) return inflight

  const promise = fetcher().then((data) => {
    cache.set(cacheKey, { data, timestamp: Date.now() })
    inflightCache.delete(cacheKey)
    return data
  }).catch((err) => {
    inflightCache.delete(cacheKey)
    throw err
  })

  inflightCache.set(cacheKey, promise)
  return promise
}

export async function GET(req: Request) {
  try {
    // Rate limiting by IP
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
    if (!checkRateLimit(ip)) {
      return NextResponse.json({ error: 'Too many requests, please try again later' }, { status: 429 })
    }

    const { searchParams } = new URL(req.url)
    const chainIdParam = searchParams.get('chainId')

    // Single-chain mode
    if (chainIdParam) {
      const chainId = parseInt(chainIdParam, 10)
      if (!Number.isFinite(chainId) || !isChainSupported(chainId)) {
        return NextResponse.json(
          { error: 'Invalid or unsupported chainId' },
          { status: 400 },
        )
      }

      const cacheKey = String(chainId)
      const data = await fetchAndCacheMetrics(cacheKey, async () => {
        const metrics = await fetchChainMetrics(chainId)
        return { [chainId]: metrics }
      })

      const entry = cache.get(cacheKey)
      return NextResponse.json({ chains: data, updatedAt: new Date(entry?.timestamp ?? Date.now()).toISOString() })
    }

    // All-chains mode
    const allCacheKey = 'all'
    const data = await fetchAndCacheMetrics(allCacheKey, async () => {
      const chains = getSupportedChains().filter(c => c.contracts.announcer || c.contracts.dustPoolV2)

      const results = await Promise.allSettled(
        chains.map(async (c) => {
          const metrics = await fetchChainMetrics(c.id)
          return { chainId: c.id, metrics }
        }),
      )

      const metricsData: Record<string, ChainMetrics> = {}
      for (const result of results) {
        if (result.status === 'fulfilled') {
          metricsData[result.value.chainId] = result.value.metrics
        }
      }
      return metricsData
    })

    const entry = cache.get(allCacheKey)
    return NextResponse.json({ chains: data, updatedAt: new Date(entry?.timestamp ?? Date.now()).toISOString() })
  } catch (e) {
    console.error('[metrics] Error:', e instanceof Error ? e.message : e)
    return NextResponse.json(
      { error: 'Failed to fetch metrics' },
      { status: 500 },
    )
  }
}
