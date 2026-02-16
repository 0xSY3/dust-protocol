#!/bin/bash
# Compile PrivateSwap circuit and generate proving/verification keys

set -e

CIRCUIT_NAME="PrivateSwap"
CIRCUIT_FILE="${CIRCUIT_NAME}.circom"
BUILD_DIR="build"
OUTPUT_DIR="../../../public/circuits"

echo "🔨 Compiling PrivateSwap circuit..."

# Create build directory
mkdir -p "$BUILD_DIR"
mkdir -p "$OUTPUT_DIR"

# Step 1: Compile circuit to R1CS and WASM
echo "📝 Step 1: Compiling circom to R1CS and WASM..."
circom "$CIRCUIT_FILE" --r1cs --wasm --sym --c -o "$BUILD_DIR"

# Step 2: Generate powers of tau ceremony (if not exists)
PTAU_FILE="$BUILD_DIR/pot20_final.ptau"
if [ ! -f "$PTAU_FILE" ]; then
    echo "🎲 Step 2: Generating powers of tau (this takes ~10 minutes)..."
    snarkjs powersoftau new bn128 20 "$BUILD_DIR/pot20_0000.ptau" -v
    snarkjs powersoftau contribute "$BUILD_DIR/pot20_0000.ptau" "$BUILD_DIR/pot20_0001.ptau" \
        --name="First contribution" -v -e="random entropy"
    snarkjs powersoftau prepare phase2 "$BUILD_DIR/pot20_0001.ptau" "$PTAU_FILE" -v
    rm "$BUILD_DIR/pot20_0000.ptau" "$BUILD_DIR/pot20_0001.ptau"
else
    echo "✅ Using existing powers of tau: $PTAU_FILE"
fi

# Step 3: Generate zkey (proving key)
echo "🔑 Step 3: Generating zkey (proving key)..."
snarkjs groth16 setup "$BUILD_DIR/${CIRCUIT_NAME}.r1cs" "$PTAU_FILE" "$BUILD_DIR/${CIRCUIT_NAME}_0000.zkey"

# Contribute to phase 2 ceremony
echo "🎲 Contributing to phase 2..."
snarkjs zkey contribute "$BUILD_DIR/${CIRCUIT_NAME}_0000.zkey" \
    "$BUILD_DIR/${CIRCUIT_NAME}_final.zkey" \
    --name="Phase 2 contribution" -v -e="more random entropy"

# Step 4: Export verification key
echo "📤 Step 4: Exporting verification key..."
snarkjs zkey export verificationkey "$BUILD_DIR/${CIRCUIT_NAME}_final.zkey" \
    "$BUILD_DIR/verification_key.json"

# Step 5: Generate Solidity verifier
echo "📜 Step 5: Generating Solidity verifier..."
snarkjs zkey export solidityverifier "$BUILD_DIR/${CIRCUIT_NAME}_final.zkey" \
    "../src/DustSwapVerifierProduction.sol"

# Step 6: Copy artifacts to public/circuits (for browser proof generation)
echo "📦 Step 6: Copying artifacts to public/circuits..."
cp "$BUILD_DIR/${CIRCUIT_NAME}_js/${CIRCUIT_NAME}.wasm" "$OUTPUT_DIR/privateSwap.wasm"
cp "$BUILD_DIR/${CIRCUIT_NAME}_final.zkey" "$OUTPUT_DIR/privateSwap_final.zkey"
cp "$BUILD_DIR/verification_key.json" "$OUTPUT_DIR/verification_key.json"

# Step 7: Verify circuit info
echo "📊 Circuit Info:"
snarkjs info -r "$BUILD_DIR/${CIRCUIT_NAME}.r1cs"

echo "✅ Compilation complete!"
echo ""
echo "Outputs:"
echo "  - WASM: $OUTPUT_DIR/privateSwap.wasm"
echo "  - zkey: $OUTPUT_DIR/privateSwap_final.zkey"
echo "  - vkey: $OUTPUT_DIR/verification_key.json"
echo "  - Verifier: ../src/DustSwapVerifierProduction.sol"
echo ""
echo "⚠️  IMPORTANT: Redeploy DustSwapVerifierProduction.sol to update on-chain verifier!"
