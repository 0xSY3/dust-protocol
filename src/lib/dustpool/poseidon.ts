// Browser-side Poseidon wrapper matching on-chain PoseidonT3
// Lazy-loads circomlibjs to keep bundle size small

let poseidonFn: ((inputs: bigint[]) => Uint8Array) | null = null;
let poseidonFieldFn: ((inputs: bigint[]) => bigint) | null = null;

async function ensurePoseidon() {
  if (poseidonFn && poseidonFieldFn) return;
  const { buildPoseidon } = await import('circomlibjs');
  const poseidon = await buildPoseidon();
  poseidonFn = poseidon;
  poseidonFieldFn = (inputs: bigint[]) => {
    const hash = poseidon(inputs);
    return poseidon.F.toObject(hash);
  };
}

/// Poseidon hash of 2 inputs (matches PoseidonT3 on-chain)
export async function poseidon2(a: bigint, b: bigint): Promise<bigint> {
  await ensurePoseidon();
  return poseidonFieldFn!([a, b]);
}

/// Compute commitment = Poseidon(Poseidon(nullifier, secret), amount)
export async function computeCommitment(
  nullifier: bigint,
  secret: bigint,
  amount: bigint,
): Promise<bigint> {
  const inner = await poseidon2(nullifier, secret);
  return poseidon2(inner, amount);
}

/// Compute nullifierHash = Poseidon(nullifier, nullifier)
export async function computeNullifierHash(nullifier: bigint): Promise<bigint> {
  return poseidon2(nullifier, nullifier);
}

/// Convert bigint to bytes32 hex string (0x-prefixed, 64 chars)
export function toBytes32Hex(val: bigint): string {
  return '0x' + val.toString(16).padStart(64, '0');
}

/// Convert bytes32 hex string to bigint
export function fromBytes32Hex(hex: string): bigint {
  return BigInt(hex);
}
