import { NextResponse } from 'next/server'
import { getDepositLeafIndex } from '@/lib/dustpool/v2/relayer-tree'
import { getDustPoolV2Address } from '@/lib/dustpool/v2/contracts'
import { DEFAULT_CHAIN_ID } from '@/config/chains'

export const maxDuration = 60

const NO_STORE = { 'Cache-Control': 'no-store' } as const

export async function GET(
  req: Request,
  { params }: { params: { commitment: string } },
) {
  try {
    const { searchParams } = new URL(req.url)
    const chainId = parseInt(searchParams.get('chainId') || '') || DEFAULT_CHAIN_ID

    if (!getDustPoolV2Address(chainId)) {
      return NextResponse.json(
        { error: 'DustPoolV2 not deployed on this chain' },
        { status: 404, headers: NO_STORE },
      )
    }

    const { commitment } = params
    if (!commitment || !/^0x[0-9a-fA-F]{64}$/.test(commitment)) {
      return NextResponse.json(
        { error: 'Invalid commitment format (expected 0x-prefixed bytes32)' },
        { status: 400, headers: NO_STORE },
      )
    }

    const leafIndex = await getDepositLeafIndex(chainId, commitment)

    if (leafIndex !== null) {
      return NextResponse.json(
        { confirmed: true, leafIndex },
        { headers: NO_STORE },
      )
    }

    return NextResponse.json(
      { confirmed: false, leafIndex: -1 },
      { headers: NO_STORE },
    )
  } catch (e) {
    console.error('[V2/deposit/status] Error:', e)
    return NextResponse.json(
      { error: 'Failed to check deposit status' },
      { status: 503, headers: NO_STORE },
    )
  }
}
