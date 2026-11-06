#!/usr/bin/env bash
#
# DustPoolV2 FFLONK build pipeline:
#   circom compile → snarkjs fflonk setup → verification key → Solidity verifier → browser artifacts
#
#   transaction  DustV2Transaction (2-in-2-out, 9 public signals)  → src/FFLONKVerifier.sol,      public/circuits/v2/
#   split        DustV2Split       (2-in-8-out, 15 public signals) → src/FFLONKSplitVerifier.sol, public/circuits/v2-split/
#
# Usage:
#   bash contracts/dustpool/scripts/build-v2-circuits.sh [all|transaction|split]   (default: all)
#
# Prerequisites:
#   - circom 2.2.x on PATH, or CIRCOM=/path/to/circom
#   - `npm ci` in the repo root (snarkjs) and in contracts/dustpool (circomlib)
#
# Outputs:
#   build/v2/<Circuit>/                            r1cs, sym, wasm, zkey, verification key, verifier (gitignored)
#   public/circuits/<dir>/<Circuit>.wasm           witness generator served to the browser
#   public/circuits/<dir>/verification_key.json    used by the browser for local proof verification
#   public/circuits/<dir>/<Circuit>.zkey           proving key for local serving (gitignored; production fetches it from R2)
#   src/FFLONK*Verifier.sol                        on-chain verifier
#
# FFLONK has no circuit-specific ceremony: the same r1cs + ptau always yields the same zkey and verifier.
# Every circuit is fully built and checked under build/v2/ before anything is copied into src/ or public/.

set -euo pipefail

DUSTPOOL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$DUSTPOOL_DIR/../.." && pwd)"
BUILD_DIR="$DUSTPOOL_DIR/build/v2"

CIRCOM="${CIRCOM:-circom}"
# The browser prover bundles the root snarkjs; the zkey and verifier must come from the same version.
SNARKJS="${SNARKJS:-$REPO_ROOT/node_modules/.bin/snarkjs}"

# PSE Perpetual Powers of Tau, contribution #80, truncated to 2^20 and prepared for phase 2
# (fflonk setup rejects a ptau without the Lagrange sections). FFLONK setup reads 9·n + 18 G1 powers;
# this file holds 2^21 − 1, enough for domains up to n = 2^17. The Hermez ptau mirrors return 403.
# The hash is pinned because a different ptau silently produces a different verifier.
PTAU_URL="https://pse-trusted-setup-ppot.s3.eu-central-1.amazonaws.com/pot28_0080/ppot_0080_20.ptau"
PTAU_SHA256="560412532a1205145d5f21585274fb2cef61273496ddc7186aec855aab01a8cd"
PTAU="${PTAU:-$DUSTPOOL_DIR/build/ppot_0080_20.ptau}"

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

sha256_of() {
  if command -v sha256sum > /dev/null; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

# Args: <verification_key.json> <dot path, e.g. C0.0>
vk_field() {
  node -e '
    const vk = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))
    console.log(process.argv[2].split(".").reduce((value, key) => value[key], vk))
  ' "$1" "$2"
}

check_prerequisites() {
  command -v "$CIRCOM" > /dev/null || fail "circom not found (set CIRCOM=/path/to/circom)"
  [[ -x "$SNARKJS" ]] || fail "snarkjs not found at $SNARKJS (run npm ci in $REPO_ROOT)"
  # The circuits include "../../node_modules/circomlib/...", which resolves relative to circuits/v2/
  # into contracts/dustpool/node_modules. The repo root does not install circomlib.
  [[ -f "$DUSTPOOL_DIR/node_modules/circomlib/circuits/poseidon.circom" ]] \
    || fail "circomlib missing (run npm ci in $DUSTPOOL_DIR)"

  echo "circom:  $("$CIRCOM" --version)"
  echo "snarkjs: $(node -p "require('$REPO_ROOT/node_modules/snarkjs/package.json').version")"
}

ensure_ptau() {
  if [[ ! -f "$PTAU" ]]; then
    echo "Downloading $PTAU_URL (1.2 GB)"
    curl -fL --retry 3 -o "$PTAU.partial" "$PTAU_URL"
    mv "$PTAU.partial" "$PTAU"
  fi
  local actual
  actual="$(sha256_of "$PTAU")"
  [[ "$actual" == "$PTAU_SHA256" ]] || fail "ptau sha256 mismatch: expected $PTAU_SHA256, got $actual ($PTAU)"
  echo "ptau:    $PTAU (sha256 verified)"
}

# Args: <circuit name> <verifier contract name> <expected public signal count>
build_circuit() {
  local circuit="$1" contract_name="$2" expected_n_public="$3"
  local out="$BUILD_DIR/$circuit"

  echo ""
  echo "=== $circuit: compile ==="
  rm -rf "$out"
  mkdir -p "$out"
  "$CIRCOM" "$DUSTPOOL_DIR/circuits/v2/$circuit.circom" --r1cs --wasm --sym -o "$out"

  echo ""
  echo "=== $circuit: fflonk setup ==="
  "$SNARKJS" fflonk setup "$out/$circuit.r1cs" "$PTAU" "$out/$circuit.zkey"

  echo ""
  echo "=== $circuit: export verification key + Solidity verifier ==="
  "$SNARKJS" zkey export verificationkey "$out/$circuit.zkey" "$out/verification_key.json"
  "$SNARKJS" zkey export solidityverifier "$out/$circuit.zkey" "$out/FflonkVerifier.generated.sol"
  # snarkjs names every FFLONK verifier FflonkVerifier; DeployV2.s.sol deploys the split verifier
  # alongside it, so it needs a distinct contract name.
  # The template's precompile calls forward sub(gas(), 2000). ERC-7562 OP-012 (enforced by the
  # EIP-8141 alt mempool tracer) bans a GAS opcode that is not immediately followed by a CALL, which
  # would make the verifier unusable from a frame transaction's VERIFY frame (DustPoolV2Frame).
  # Forwarding gas() keeps GAS adjacent to STATICCALL; EIP-150 already leaves the caller 1/64.
  sed -e "s/^contract FflonkVerifier {/contract $contract_name {/" \
      -e "s/staticcall(sub(gas(), 2000), /staticcall(gas(), /" \
    "$out/FflonkVerifier.generated.sol" > "$out/$contract_name.sol"
  grep -q "sub(gas()" "$out/$contract_name.sol" && fail "$circuit: verifier still forwards sub(gas(), ...)"

  check_artifacts "$circuit" "$contract_name" "$expected_n_public"
}

# Args: <circuit name> <verifier contract name> <expected public signal count>
check_artifacts() {
  local circuit="$1" contract_name="$2" expected_n_public="$3"
  local out="$BUILD_DIR/$circuit"
  local vk="$out/verification_key.json" sol="$out/$contract_name.sol"

  local protocol n_public power c0x
  protocol="$(vk_field "$vk" protocol)"
  n_public="$(vk_field "$vk" nPublic)"
  power="$(vk_field "$vk" power)"
  c0x="$(vk_field "$vk" C0.0)"

  [[ "$protocol" == "fflonk" ]] || fail "$circuit: protocol is $protocol, expected fflonk"
  [[ "$n_public" == "$expected_n_public" ]] \
    || fail "$circuit: nPublic is $n_public, expected $expected_n_public (public signal count changed)"
  grep -q "^contract $contract_name {" "$sol" || fail "$circuit: contract rename to $contract_name failed"
  grep -q "uint256\[$expected_n_public\] calldata pubSignals" "$sol" \
    || fail "$circuit: verifier does not take uint256[$expected_n_public] pubSignals"
  grep -q "uint256 constant C0x  = $c0x;" "$sol" || fail "$circuit: C0x differs between verification key and verifier"
  grep -q "uint32 constant n     = $((2 ** power));" "$sol" || fail "$circuit: domain size differs from vk power $power"

  echo "  nPublic: $n_public | domain: 2^$power | C0x: $c0x"
}

# Args: <circuit name> <verifier contract name> <public dir> <verifier source path>
install_circuit() {
  local circuit="$1" contract_name="$2" public_dir="$3" verifier_sol="$4"
  local out="$BUILD_DIR/$circuit"

  mkdir -p "$REPO_ROOT/$public_dir"
  cp "$out/${circuit}_js/$circuit.wasm" "$REPO_ROOT/$public_dir/$circuit.wasm"
  cp "$out/verification_key.json" "$REPO_ROOT/$public_dir/verification_key.json"
  cp "$out/$circuit.zkey" "$REPO_ROOT/$public_dir/$circuit.zkey"
  cp "$out/$contract_name.sol" "$DUSTPOOL_DIR/$verifier_sol"

  echo "  $public_dir/$circuit.wasm"
  echo "  $public_dir/verification_key.json"
  echo "  $public_dir/$circuit.zkey (gitignored)"
  echo "  contracts/dustpool/$verifier_sol"
}

main() {
  local target="${1:-all}"
  local build_tx=false build_split=false
  case "$target" in
    all) build_tx=true; build_split=true ;;
    transaction) build_tx=true ;;
    split) build_split=true ;;
    *) fail "unknown target '$target' (expected all, transaction or split)" ;;
  esac

  check_prerequisites
  ensure_ptau

  if $build_tx; then build_circuit DustV2Transaction FflonkVerifier 9; fi
  if $build_split; then build_circuit DustV2Split FflonkSplitVerifier 15; fi

  echo ""
  echo "=== Installing artifacts ==="
  if $build_tx; then
    install_circuit DustV2Transaction FflonkVerifier public/circuits/v2 src/FFLONKVerifier.sol
  fi
  if $build_split; then
    install_circuit DustV2Split FflonkSplitVerifier public/circuits/v2-split src/FFLONKSplitVerifier.sol
  fi

  echo ""
  echo "Done. Upload the zkeys to R2 (and bump the ?v= cache key in src/lib/dustpool/v2) before the app uses the new verifiers."
}

main "$@"
