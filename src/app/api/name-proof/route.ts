// GET /api/name-proof?name={name}
// Returns a Merkle inclusion proof for a specific .dust name.

import { NextResponse } from 'next/server';
import { getNameMerkleTree } from '@/lib/naming/merkleTree';

export const maxDuration = 30;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const rawName = searchParams.get('name');

  if (!rawName) {
    return NextResponse.json({ error: 'Missing name parameter' }, { status: 400 });
  }

  const name = rawName.toLowerCase().replace(/\.dust$/, '').trim();
  if (!name || name.length > 32) {
    return NextResponse.json({ error: 'Invalid name' }, { status: 400 });
  }

  const tree = getNameMerkleTree();
  const result = tree.getProof(name);
  if (!result) {
    return NextResponse.json({ error: 'Name not found' }, { status: 404 });
  }

  return NextResponse.json({
    name,
    nameHash: result.nameHash,
    metaAddress: result.metaAddress,
    version: result.version,
    proof: result.proof,
    root: result.root,
    leafIndex: result.leafIndex,
  }, {
    headers: {
      'Cache-Control': 'private, no-store',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
