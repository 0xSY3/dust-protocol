import { NextResponse } from 'next/server'
import { getRelayerTreeProof, getTreeLeafCount } from '@/lib/dustpool/v2/relayer-tree'
import { getDustPoolV2Address } from '@/lib/dustpool/v2/contracts'
import { DEFAULT_CHAIN_ID } from '@/config/chains'

export const maxDuration = 60

const NO_STORE = { 'Cache-Control': 'no-store' } as const

export async function GET(
  req: Request,
  { params }: { params: { leafIndex: string } },
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

    const leafIndex = parseInt(params.leafIndex, 10)
    if (!Number.isFinite(leafIndex) || leafIndex < 0) {
      return NextResponse.json(
        { error: 'Invalid leaf index' },
        { status: 400, headers: NO_STORE },
      )
    }

    const leafCount = await getTreeLeafCount(chainId)
    if (leafIndex >= leafCount) {
      return NextResponse.json(
        { error: `Leaf index ${leafIndex} out of range (tree has ${leafCount} leaves)` },
        { status: 404, headers: NO_STORE },
      )
    }

    const proof = await getRelayerTreeProof(chainId, leafIndex)

    return NextResponse.json(
      {
        pathElements: proof.pathElements.map((e) => '0x' + e.toString(16)),
        pathIndices: proof.pathIndices,
      },
      { headers: NO_STORE },
    )
  } catch (e) {
    console.error('[V2/tree/proof] Error:', e)
    return NextResponse.json(
      { error: 'Failed to generate Merkle proof' },
      { status: 503, headers: NO_STORE },
    )
  }
}
