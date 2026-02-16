/**
 * Test: Compare TypeScript Merkle tree roots against on-chain roots.
 *
 * Inserts the 3 actual deposit commitments from DustSwapPoolETH on Sepolia
 * and checks the computed root after each insertion against the contract's
 * root history.
 *
 * Run: node --experimental-vm-modules test/merkle-compare.mjs
 * (from contracts/dustswap/ OR from repo root with full path)
 */

import { buildPoseidon } from 'circomlibjs';

// ─── On-chain data (Ethereum Sepolia) ───────────────────────────────────────
const CONTRACT_COMMITMENTS = [
  '0x13a696f5c9aba113f9c84ea281c092858b815a24425b8aa9f62bc48f2ae489bd', // leafIndex 0
  '0x219a0f08c02e0ef4459b706b3613bff10e603e0f37b73e4aa1c4dcab654c8ad9', // leafIndex 1
  '0x181f3bd8bda2030e6a3dd8f2b060f09df9d2cce5d8205e39afed9f14d50f014c', // leafIndex 2
];

// Contract root history (roots[0..3]):
const CONTRACT_ROOTS = [
  '0x2134e76ac5d21aab186c2be1dd8f84ee880a1e46eaf712f9d371b6df22191f3e', // roots[0] initial empty root
  '0x0406c2b21790567203771b48be7ddadfd85418bf53bed53980832c8dd3ecd0c1', // roots[1] after deposit 0
  '0x1e194f5050db7a2b59524df84f0c6d14b7e7ddf4aca1c468aaa086c0bef46d91', // roots[2] after deposit 1
  '0x2c3a1156e8903ed2242925d155f52e387718a68e9394fd06eef66db2d79f5451', // roots[3] after deposit 2 (= getLastRoot)
];

// Contract zero hashes for verification
const CONTRACT_ZERO_HASHES = [
  '0x0000000000000000000000000000000000000000000000000000000000000000', // zeroHashes[0]
  '0x2098f5fb9e239eab3ceac3f27b81e481dc3124d55ffed523a839ee8446b64864', // zeroHashes[1]
  '0x1069673dcdb12263df301a6ff584a7ec261a44cb9dc68df067a4774460b1f1e1', // zeroHashes[2]
];

// ─── Poseidon setup ─────────────────────────────────────────────────────────
let poseidon;
let F;

async function initPoseidon() {
  poseidon = await buildPoseidon();
  F = poseidon.F;
}

function poseidon2(a, b) {
  const hash = poseidon([a, b]);
  return F.toObject(hash);
}

function toHex(val) {
  return '0x' + val.toString(16).padStart(64, '0');
}

// ─── Minimal Merkle tree (mirrors TypeScript MerkleTree class) ──────────────
const TREE_DEPTH = 20;

class MerkleTree {
  constructor(zeros) {
    this.depth = TREE_DEPTH;
    this.zeros = zeros;
    this.filledSubtrees = new Array(TREE_DEPTH).fill(0n);
    this.roots = [zeros[TREE_DEPTH]]; // initial root
    this.currentRootIndex = 0;
    this.nextIndex = 0;
  }

  insert(leaf) {
    const index = this.nextIndex;
    let currentHash = leaf;
    let tempIndex = index;

    for (let i = 0; i < this.depth; i++) {
      if (tempIndex % 2 === 0) {
        this.filledSubtrees[i] = currentHash;
        currentHash = poseidon2(currentHash, this.zeros[i]);
      } else {
        currentHash = poseidon2(this.filledSubtrees[i], currentHash);
      }
      tempIndex >>= 1;
    }

    this.roots.push(currentHash);
    if (this.roots.length > 100) {
      this.roots.shift();
    } else {
      this.currentRootIndex++;
    }

    this.nextIndex++;
    return index;
  }

  get root() {
    return this.roots[this.roots.length - 1];
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  await initPoseidon();

  // 1. Compute zero hashes (matching Solidity constructor)
  const zeros = [0n];
  for (let i = 1; i <= TREE_DEPTH; i++) {
    zeros.push(poseidon2(zeros[i - 1], zeros[i - 1]));
  }

  console.log('=== Zero Hash Verification ===');
  for (let i = 0; i < CONTRACT_ZERO_HASHES.length; i++) {
    const tsHex = toHex(zeros[i]);
    const match = tsHex === CONTRACT_ZERO_HASHES[i];
    console.log(`  zeroHashes[${i}]: ${match ? 'MATCH ✓' : 'MISMATCH ✗'}`);
    if (!match) {
      console.log(`    contract: ${CONTRACT_ZERO_HASHES[i]}`);
      console.log(`    ts:       ${tsHex}`);
    }
  }

  // 2. Verify initial empty root
  const tree = new MerkleTree(zeros);
  const initialRootHex = toHex(tree.root);
  const initialMatch = initialRootHex === CONTRACT_ROOTS[0];
  console.log(`\n=== Initial Empty Root ===`);
  console.log(`  Contract: ${CONTRACT_ROOTS[0]}`);
  console.log(`  TS:       ${initialRootHex}`);
  console.log(`  Match:    ${initialMatch ? 'YES ✓' : 'NO ✗'}`);

  // 3. Insert commitments one by one, compare root at each step
  console.log(`\n=== Insertion Comparison ===`);
  let allMatch = initialMatch;

  for (let i = 0; i < CONTRACT_COMMITMENTS.length; i++) {
    const commitment = BigInt(CONTRACT_COMMITMENTS[i]);
    tree.insert(commitment);

    const tsRootHex = toHex(tree.root);
    const contractRoot = CONTRACT_ROOTS[i + 1]; // roots[i+1] because roots[0] is initial
    const match = tsRootHex === contractRoot;
    allMatch = allMatch && match;

    console.log(`\n  After deposit ${i} (leafIndex=${i}):`);
    console.log(`    Commitment: ${CONTRACT_COMMITMENTS[i]}`);
    console.log(`    Contract root: ${contractRoot}`);
    console.log(`    TS root:       ${tsRootHex}`);
    console.log(`    Match:         ${match ? 'YES ✓' : 'NO ✗'}`);

    if (!match) {
      console.log(`    >>> DIVERGENCE DETECTED at insertion ${i} <<<`);
    }
  }

  // 4. Summary
  console.log(`\n=== SUMMARY ===`);
  if (allMatch) {
    console.log('  All roots match! TypeScript Merkle tree is consistent with on-chain contract.');
  } else {
    console.log('  ROOT MISMATCH DETECTED — the TypeScript tree diverges from the contract.');
  }

  process.exit(allMatch ? 0 : 1);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(2);
});
