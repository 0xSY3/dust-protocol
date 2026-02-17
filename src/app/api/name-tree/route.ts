// GET /api/name-tree
// Returns the full Merkle tree for privacy-mode clients.
// Gateway doesn't know which name the client cares about.

import { NextResponse } from 'next/server';
import { getNameMerkleTree } from '@/lib/naming/merkleTree';

export const maxDuration = 30;

export async function GET() {
  const treeData = getNameMerkleTree().exportTree();

  return NextResponse.json({
    root: treeData.root,
    depth: 20,
    leafCount: treeData.leafCount,
    entries: treeData.entries,
  }, {
    headers: {
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
