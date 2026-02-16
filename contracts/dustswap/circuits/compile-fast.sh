#!/bin/bash
# Fast compilation using pre-generated powers of tau

set -e

CIRCUIT_NAME="PrivateSwap"
CIRCUIT_FILE="${CIRCUIT_NAME}.circom"
BUILD_DIR="build"
OUTPUT_DIR="../../../public/circuits"

echo "🔨 Compiling PrivateSwap circuit with pre-generated ceremony..."

# Step 1: Compile circuit to R1CS and WASM
echo "📝 Step 1: Compiling circom to R1CS and WASM..."
circom "$CIRCUIT_FILE" --r1cs --wasm --sym -o "$BUILD_DIR"

# Step 2: Generate zkey (using pre-downloaded ceremony)
echo "🔑 Step 2: Generating zkey (proving key)..."
snarkjs groth16 setup "$BUILD_DIR/${CIRCUIT_NAME}.r1cs" "$BUILD_DIR/pot20_final.ptau" "$BUILD_DIR/${CIRCUIT_NAME}_0000.zkey"

# Contribute to phase 2 ceremony
echo "🎲 Step 3: Contributing to phase 2..."
snarkjs zkey contribute "$BUILD_DIR/${CIRCUIT_NAME}_0000.zkey" \
    "$BUILD_DIR/${CIRCUIT_NAME}_final.zkey" \
    --name="Phase 2 contribution" -v -e="random entropy"

# Step 4: Export verification key
echo "📤 Step 4: Exporting verification key..."
snarkjs zkey export verificationkey "$BUILD_DIR/${CIRCUIT_NAME}_final.zkey" \
    "$BUILD_DIR/verification_key.json"

# Step 5: Generate Solidity verifier
echo "📜 Step 5: Generating Solidity verifier..."
snarkjs zkey export solidityverifier "$BUILD_DIR/${CIRCUIT_NAME}_final.zkey" \
    "../src/DustSwapVerifierProduction.sol"

# Step 6: Copy artifacts to public/circuits
echo "📦 Step 6: Copying artifacts to public/circuits..."
mkdir -p "$OUTPUT_DIR"
cp "$BUILD_DIR/${CIRCUIT_NAME}_js/${CIRCUIT_NAME}.wasm" "$OUTPUT_DIR/privateSwap.wasm"
cp "$BUILD_DIR/${CIRCUIT_NAME}_final.zkey" "$OUTPUT_DIR/privateSwap_final.zkey"
cp "$BUILD_DIR/verification_key.json" "$OUTPUT_DIR/verification_key.json"

# Step 7: Circuit info
echo "📊 Circuit Info:"
snarkjs info -r "$BUILD_DIR/${CIRCUIT_NAME}.r1cs"

echo ""
echo "✅ Compilation complete!"
echo ""
echo "Outputs:"
echo "  - WASM: $OUTPUT_DIR/privateSwap.wasm"
echo "  - zkey: $OUTPUT_DIR/privateSwap_final.zkey"
echo "  - vkey: $OUTPUT_DIR/verification_key.json"
echo "  - Verifier: ../src/DustSwapVerifierProduction.sol"
