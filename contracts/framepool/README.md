# DustPoolV2Frame: private withdrawals with no relayer

DustPoolV2 is Dust Protocol's UTXO privacy pool: notes are Poseidon commitments in a Merkle tree, and spending
one takes an FFLONK proof. Withdrawing to a fresh address has always needed a relayer, because a fresh address
holds no ETH for gas. The relayer sees every withdrawal, can censor it, and charges for it.

DustPoolV2Frame removes the relayer. With an [EIP-8141](https://eips.ethereum.org/EIPS/eip-8141) frame
transaction the pool itself is the transaction's sender and its gas payer. The withdrawer proves, anyone
broadcasts, and nobody signs. The proof's cost puts the transaction past the canonical mempool's validation
budget, so it travels through the [ERC-8421](https://github.com/forshtat/ERCs) alternative mempool, where the
pool is a staked entity.

## Live on the ERC-8421 devnet (chain 1337)

| | |
|---|---|
| Canonical mempool (`eth_sendRawTransaction`) | rejected: `Frame transaction prefix gas budget (frames + sig cost) exceeds MAX_VERIFY_GAS` |
| Alternative mempool (`eth_sendFrameTransaction`) | accepted, with every ERC-7562 rule check passing (`skandha_explorer_getTransaction`) |
| Withdrawals from the first pool, deployed before the soundness fixes below | [block 8466](https://explorer.altmempool.wtf/tx/0x3acbedbe8bf28486f773c51919d2ea51d3dc6beba1d176512fc14a386f8ba765), [block 8486](https://explorer.altmempool.wtf/tx/0x97fbab4df935814a7700793659e4b77260e32a490870923080cf66f68e5f2801) |
| Current pool, with every fix below | `0x89a49Afd081030DeCDB8CDe1E0A3D99c755bB5FC`, staked 0.012 ETH |
| Proof-bound deposit of 0.2 ETH (`depositWithProof`) | `0x75ec053d5bb52d61ad07abfa5f4eeb3508f09db369c59e07552a0d2178d551fa` |
| Root posted for it (`updateRoot`) | `0xb3d58d3c02eb4f06be498f65a721b6f5a2b364c8948ea7760f6b1e603f1239af` |

The explorer lists frame transactions only; query the others with `eth_getTransactionReceipt` on the gateway.

Since 22:19 UTC on 6 November the gateway has admitted nothing from any sender: each transaction fails at the
last step, the mempool write, with `IO error: No space left on device` (`skandha_explorer_listAdmissions`, from
admission 608). The current pool's withdrawal passes all 15 rule checks before that step, from `gas-limit` to
`entrypoint-access`, and goes in once the operator frees disk space.

## The transaction

```
sender      the pool
nonce keys  the spend's nonzero nullifiers, increasing, at sequence 0     (EIP-8250)
signatures  none

frame 0  VERIFY  -> pool.validateFrameWithdrawal()   called by ENTRY_POINT, static
                    checks the transaction and the proof, then APPROVE(EXECUTION_AND_PAYMENT)
frame 1  SENDER  -> pool.executeFrameWithdrawal(w)   called as the pool
                    marks the nullifiers spent, queues the change notes, pays amount - feeCap to the recipient
```

APPROVE debits the transaction's maximum cost from the pool and refunds what goes unused. The withdrawer pays
for gas by giving up `feeCap` from the withdrawn amount.

## What the VERIFY frame checks

| Check | Why |
|---|---|
| Exactly two frames. Frame 1 is SENDER to the pool, carries no value, and holds 1,028 bytes of `executeFrameWithdrawal` calldata | Approving EXECUTION lets every SENDER frame act as the pool, so nothing else may ride along |
| Frame 1's execution and state gas limits are at least `settlementExecutionGas` and `settlementStateGas` | The pool pays for frame 1 even if it runs out of gas. An underfunded settlement would spend the pool's ETH and leave the note unspent |
| The nonce keys are exactly the nonzero nullifiers, in increasing order, at sequence 0 (checked through `NONCE_KEYS_HASH`) | The mempool holds one transaction per (sender, key), so spends that share a note collide on admission. Once a key is consumed, no transaction can pay for the proof again |
| `MAX_COST <= feeCap` | The pool never pays more gas than the withdrawer gave up |
| A net outflow of ETH, `amount > feeCap`, and `totalDeposited >= amount` | The frame path only withdraws ETH |
| Compliance flags, read only | The VERIFY frame is static. Settlement consumes the flags |
| The FFLONK proof, whose recipient signal is `uint160(keccak256(TAG, chainId, pool, recipient, feeCap))` | Recipient and fee are bound into the proof without changing the circuit. No relayer, builder or copier can redirect the payout or raise the fee |

Settlement can't fail for a reason VERIFY didn't rule out. The recipient gets the 2,300-gas stipend, and a
payout it won't accept becomes a claim (`claimDeferredWithdrawal`) instead of a revert.

## Why it needs the alternative mempool

- **Gas budget.** The canonical mempool caps the validation prefix at `MAX_VERIFY_GAS = 100,000`. FFLONK
  verification alone costs more, and the VERIFY frame measures 261,710 gas on the devnet. The alternative
  mempool gives a staked entity a larger budget. The pool stakes itself: `addStake` calls the
  NaiveStakingRegistry from the pool, because the registry stakes `msg.sender`. The stake is 0.012 ETH with a
  one-day unstake delay, and it is the owner's ETH, never deposits.
- **OP-012.** snarkjs's verifier template calls precompiles with `staticcall(sub(gas(), 2000), ...)`. ERC-7562
  allows `GAS` only when a call follows it directly. `scripts/build-v2-circuits.sh` rewrites it to
  `staticcall(gas(), ...)`, and the build fails if the pattern survives.
- **Storage and opcodes.** VERIFY reads only the pool's own storage: roots, nullifiers and accounting. It uses no
  environment opcodes. Solvency comes from the pool's `totalDeposited` bookkeeping, not
  `address(this).balance`, which is SELFBALANCE.

## Gas on the devnet

| | |
|---|---|
| VERIFY frame | 261,710 gas (sent with a 320,000 limit, the measurement plus 20%) |
| Settlement frame | 90,618 gas reported by `ethrex_simulateFrameTransaction`, under 300,000 execution and 1,000,000 state gas floors |
| Maximum cost at 2 gwei | 0.0033 ETH, under a 0.01 ETH fee cap |
| Proving (FFLONK, 2^15 transaction circuit, Node, laptop) | about 14 s |
| Proof-bound deposit | 945,653 gas, the FFLONK verification included |
| Deploying each contract | 25-33M gas, mostly EIP-8037 state gas for the code |

## Trade-offs and limits

- **Fee surplus.** The withdrawer gives up `feeCap`. The pool pays the actual gas, which is at most
  `MAX_COST <= feeCap`, and the difference stays in the pool unassigned. Set `feeCap` close to `MAX_COST`; the
  script prints both.
- **One shared sender.** Every withdrawal has the same sender. Concurrency is per (sender, nonce key), so spends
  of different notes don't wait on each other, but the pool's ERC-7562 reputation is shared. Keying on every
  nullifier makes conflicting spends fail at admission, not at inclusion, where they would count against the
  pool.
- **Trusted roots.** The Merkle root is still posted by DustPoolV2's relayer role. The frame path removes the
  relayer from withdrawals, not from root updates.
- **ETH only.** Token withdrawals still go through the relayer path.
- **Stipend.** Recipients that need more than 2,300 gas to accept ETH claim their payout in a second
  transaction.

## Soundness bugs found and fixed along the way

Removing the relayer removes the party that used to filter bad requests, so the pool now enforces everything
itself. Each fix has a regression test, with real proofs wherever a proof is involved.

1. **Duplicate nullifier.** `withdraw` accepted `nullifier0 == nullifier1`, so one note filled both input slots
   and was counted twice. It now reverts with `DuplicateNullifier`.
2. **Unbacked inflow.** A proof with a positive `publicAmount` creates value. Through `withdraw`, where no ETH
   comes in, it queued notes backed by nothing. It now reverts with `UnbackedPublicAmount`.
3. **Unbound nullifier key.** In the transaction and split circuits, `nullifierKey` was a free private input:
   one note gave a fresh nullifier for every key chosen, so it could be spent again and again. This is the bug
   class behind the [Hinkal drain](https://blocksec.com/blog/web3-security-hinkal-double-spend). The circuits
   now require `nullifierKey = Poseidon(spendingKey, "dust.v2.nk")`.
4. **Unbacked deposit.** `deposit(commitment)` queued any commitment for whatever ETH came with it, and the
   relayer puts every queued commitment in the tree, so 1 wei bought a note worth the whole pool. A deposit now
   fixes the note's value. `depositWithProof(proof, commitment)` and `depositERC20WithProof` verify a
   transaction-circuit proof whose public amount, asset and chain are the deposit's own and whose one real
   output is `commitment`. `depositNote(ownerPubKey, blinding)` and `depositERC20Note` build the commitment on
   chain (PoseidonT6) from the amount received, for callers that cannot prove, such as the swap adapter.
5. **Unbound asset.** `withdraw` handed the caller's `publicAsset` to the proof but paid out `tokenAddress`
   without comparing them, so notes of a token anyone can mint could withdraw ETH. Both withdraw paths now revert
   with `AssetMismatch` unless `publicAsset == Poseidon(chainId, tokenAddress)`. The frame path always used
   ETH's asset id.

## Run it

```sh
cd contracts/framepool
npm ci && forge build && forge test

# A devnet key with ETH: curl the gateway's skandha_explorer_faucet with your address (1 ETH an hour)
export DEVNET_PRIVATE_KEY=0x...
node scripts/devnet.mjs deploy
node scripts/devnet.mjs deposit 0.2
node scripts/devnet.mjs withdraw <fresh address> 0.05 --show-canonical-rejection
node scripts/devnet.mjs status
```

`withdraw` needs no key. It proves, measures the transaction with `ethrex_simulateFrameTransaction`, prints the
canonical mempool's verdict, sends the transaction to the alternative mempool, and waits for the receipt. Note
secrets stay in the gitignored `.devnet-state.json`.

## Files

| | |
|---|---|
| `src/DustPoolV2Frame.sol` | The pool: DustPoolV2 plus the two frame entry points, staking and settlement gas floors |
| `scripts/frame-withdrawal.mjs` | Notes, the tree, the deposit and withdrawal circuit inputs, the proof and the frame calldata |
| `scripts/devnet.mjs` | Deploy, deposit, root, withdraw and status against the devnet |
| `scripts/frame-fixture.mjs` | Writes the real proof the Foundry tests use |
| `test/DustPoolV2Frame.t.sol` | The pool against a real proof, with the frame opcodes mocked at HegotaSupport's helper addresses |

This is a separate Foundry project because `@forshtat/hegota-support` pins solc 0.8.28. DustPoolV2 is imported
from `contracts/dustpool`, not copied.
