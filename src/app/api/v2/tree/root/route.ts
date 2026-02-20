import { NextResponse } from 'next/server'
import { getRelayerTreeRoot } from '@/lib/dustpool/v2/relayer-tree'
import { getDustPoolV2Address } from '@/lib/dustpool/v2/contracts'
import { DEFAULT_CHAIN_ID } from '@/config/chains'

export const maxDuration = 60

const NO_STORE = { 'Cache-Control': 'no-store' } as const

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const chainId = parseInt(searchParams.get('chainId') || '') || DEFAULT_CHAIN_ID

    if (!getDustPoolV2Address(chainId)) {
      return NextResponse.json(
        { error: 'DustPoolV2 not deployed on this chain' },
        { status: 404, headers: NO_STORE },
      )
    }

    const root = await getRelayerTreeRoot(chainId)

    return NextResponse.json(
      { root: '0x' + root.toString(16) },
      { headers: NO_STORE },
    )
  } catch (e) {
    console.error('[V2/tree/root] Error:', e)
    return NextResponse.json(
      { error: 'Failed to fetch tree root' },
      { status: 503, headers: NO_STORE },
    )
  }
}
