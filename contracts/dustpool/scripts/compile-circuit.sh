#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# DustPoolWithdraw Circuit — Full Build Pipeline
# ============================================================
#
# Reproduces the entire chain from .circom source to on-chain verifier:
#
#   DustPoolWithdraw.circom
#     → circom compiler
#       → DustPoolWithdraw.r1cs   (constraint system)
#       → DustPoolWithdraw.wasm   (witness generator)
#       → DustPoolWithdraw.sym    (symbol table)
#     → Powers of Tau ceremony (pot15_final.ptau, publicly downloadable)
#     → snarkjs groth16 setup
#       → DustPoolWithdraw_0000.zkey  (phase 1)
#     → snarkjs zkey contribute
#       → DustPoolWithdraw_final.zkey (phase 2)
#     → snarkjs zkey export verificationkey
#       → verification_key.json
#     → snarkjs zkey export solidityverifier
#       → Groth16Verifier.sol
#
# Prerequisites:
#   npm install          (circomlib + snarkjs)
#   circom installed     (https://docs.circom.io/getting-started/installation/)
#
# Usage:
#   cd contracts/dustpool
#   bash scripts/compile-circuit.sh
#
# To verify existing artifacts match the circuit:
#   bash scripts/compile-circuit.sh --verify-only
#
# ============================================================

cd "$(dirname "$0")/.."
mkdir -p build

VERIFY_ONLY=false
if [[ "${1:-}" == "--verify-only" ]]; then
  VERIFY_ONLY=true
fi

# ----------------------------------------------------------
# Step 1: Compile the circom circuit
# ----------------------------------------------------------
echo "=== Step 1: Compiling DustPoolWithdraw.circom ==="
echo ""
echo "  Circuit: contracts/dustpool/circuits/DustPoolWithdraw.circom"
echo "  Proves:  'I know (nullifier, secret) for a commitment in the Merkle tree'"
echo "  Public:  root, nullifierHash, recipient, amount"
echo "  Private: nullifier, secret, depositAmount, pathElements[20], pathIndices[20]"
echo ""

if [[ "$VERIFY_ONLY" == true ]]; then
  echo "  [verify-only] Skipping compilation, checking existing artifacts..."
  if [[ -f build/DustPoolWithdraw.r1cs ]]; then
    echo "  ✓ build/DustPoolWithdraw.r1cs exists ($(du -h build/DustPoolWithdraw.r1cs | cut -f1))"
  else
    echo "  ✗ build/DustPoolWithdraw.r1cs NOT FOUND — run without --verify-only"
    exit 1
  fi
else
  circom circuits/DustPoolWithdraw.circom \
    --r1cs --wasm --sym \
    -o build/

  echo "  ✓ R1CS:   build/DustPoolWithdraw.r1cs ($(du -h build/DustPoolWithdraw.r1cs | cut -f1))"
  echo "  ✓ WASM:   build/DustPoolWithdraw_js/DustPoolWithdraw.wasm ($(du -h build/DustPoolWithdraw_js/DustPoolWithdraw.wasm | cut -f1))"
  echo "  ✓ SYM:    build/DustPoolWithdraw.sym ($(du -h build/DustPoolWithdraw.sym | cut -f1))"
fi

# ----------------------------------------------------------
# Step 2: Download Powers of Tau (publicly available ceremony)
# ----------------------------------------------------------
echo ""
echo "=== Step 2: Powers of Tau ceremony file ==="

PTAU_URL="https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_15.ptau"
PTAU_FILE="build/pot15_final.ptau"

if [[ -f "$PTAU_FILE" ]]; then
  echo "  ✓ $PTAU_FILE already exists ($(du -h "$PTAU_FILE" | cut -f1))"
else
  if [[ "$VERIFY_ONLY" == true ]]; then
    echo "  ✗ $PTAU_FILE NOT FOUND — run without --verify-only"
    exit 1
  fi
  echo "  Downloading from Hermez ceremony (2^15 = 32,768 constraints capacity)..."
  wget -q -O "$PTAU_FILE" "$PTAU_URL"
  echo "  ✓ Downloaded $PTAU_FILE ($(du -h "$PTAU_FILE" | cut -f1))"
fi

# ----------------------------------------------------------
# Step 3: Groth16 trusted setup (Phase 1 + Phase 2)
# ----------------------------------------------------------
echo ""
echo "=== Step 3: Groth16 trusted setup ==="

if [[ "$VERIFY_ONLY" == true ]]; then
  if [[ -f build/DustPoolWithdraw_final.zkey ]]; then
    echo "  ✓ build/DustPoolWithdraw_final.zkey exists ($(du -h build/DustPoolWithdraw_final.zkey | cut -f1))"
  else
    echo "  ✗ build/DustPoolWithdraw_final.zkey NOT FOUND"
    exit 1
  fi
else
  echo "  Phase 1: groth16 setup (r1cs + ptau → initial zkey)..."
  npx snarkjs groth16 setup \
    build/DustPoolWithdraw.r1cs \
    "$PTAU_FILE" \
    build/DustPoolWithdraw_0000.zkey

  echo "  Phase 2: zkey contribution (adds randomness)..."
  npx snarkjs zkey contribute \
    build/DustPoolWithdraw_0000.zkey \
    build/DustPoolWithdraw_final.zkey \
    --name="DustPool contribution" \
    -e="random entropy for dustpool"

  echo "  ✓ build/DustPoolWithdraw_final.zkey ($(du -h build/DustPoolWithdraw_final.zkey | cut -f1))"
fi

# ----------------------------------------------------------
# Step 4: Export verification key (JSON)
# ----------------------------------------------------------
echo ""
echo "=== Step 4: Export verification key ==="

if [[ "$VERIFY_ONLY" == false ]]; then
  npx snarkjs zkey export verificationkey \
    build/DustPoolWithdraw_final.zkey \
    build/verification_key.json
fi

echo "  ✓ build/verification_key.json"

# Copy to circuits/ for git tracking
cp build/verification_key.json circuits/verification_key.json
echo "  ✓ circuits/verification_key.json (committed to git)"

# ----------------------------------------------------------
# Step 5: Export Solidity verifier
# ----------------------------------------------------------
echo ""
echo "=== Step 5: Export Groth16Verifier.sol ==="

if [[ "$VERIFY_ONLY" == false ]]; then
  npx snarkjs zkey export solidityverifier \
    build/DustPoolWithdraw_final.zkey \
    src/Groth16Verifier.sol
fi

echo "  ✓ src/Groth16Verifier.sol"

# ----------------------------------------------------------
# Step 6: Verify constants match
# ----------------------------------------------------------
echo ""
echo "=== Step 6: Verifying circuit ↔ verifier consistency ==="

# Extract alphax from verification_key.json and Groth16Verifier.sol
VK_ALPHA=$(python3 -c "import json; vk=json.load(open('build/verification_key.json')); print(vk['vk_alpha_1'][0])")
SOL_ALPHA=$(grep 'alphax' src/Groth16Verifier.sol | grep -o '[0-9]\{10,\}')

if [[ "$VK_ALPHA" == "$SOL_ALPHA" ]]; then
  echo "  ✓ vk_alpha_1[0] matches Groth16Verifier.sol alphax"
  echo "    $VK_ALPHA"
else
  echo "  ✗ MISMATCH — verification_key.json and Groth16Verifier.sol are from different setups!"
  echo "    verification_key.json: $VK_ALPHA"
  echo "    Groth16Verifier.sol:   $SOL_ALPHA"
  exit 1
fi

# Check nPublic = 4 (root, nullifierHash, recipient, amount)
N_PUBLIC=$(python3 -c "import json; print(json.load(open('build/verification_key.json'))['nPublic'])")
if [[ "$N_PUBLIC" == "4" ]]; then
  echo "  ✓ nPublic = 4 (root, nullifierHash, recipient, amount)"
else
  echo "  ✗ nPublic = $N_PUBLIC (expected 4)"
  exit 1
fi

echo "  ✓ protocol: groth16, curve: bn128"

# ----------------------------------------------------------
# Step 7: Copy browser assets to public/zk/
# ----------------------------------------------------------
echo ""
echo "=== Step 7: Copy browser proving assets ==="

mkdir -p ../../public/zk
cp build/DustPoolWithdraw_js/DustPoolWithdraw.wasm ../../public/zk/
cp build/DustPoolWithdraw_final.zkey ../../public/zk/

echo "  ✓ public/zk/DustPoolWithdraw.wasm ($(du -h ../../public/zk/DustPoolWithdraw.wasm | cut -f1))"
echo "  ✓ public/zk/DustPoolWithdraw_final.zkey ($(du -h ../../public/zk/DustPoolWithdraw_final.zkey | cut -f1))"

echo ""
echo "=== Done ==="
echo ""
echo "Artifacts:"
echo "  Circuit source:     circuits/DustPoolWithdraw.circom"
echo "  Verification key:   circuits/verification_key.json (git tracked)"
echo "  Solidity verifier:  src/Groth16Verifier.sol (git tracked)"
echo "  Browser WASM:       public/zk/DustPoolWithdraw.wasm (git tracked)"
echo "  Browser zkey:       public/zk/DustPoolWithdraw_final.zkey (git tracked)"
echo "  Build intermediates: build/ (gitignored)"
