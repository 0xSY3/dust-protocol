# ETHGlobal Mumbai 2026 — Dust Protocol (Continuity Track) Build Plan

> Planning artifact kept in-repo per ETHGlobal rules on AI/spec-driven development.
> Built with AI assistance (Claude Code); see README "AI Usage" for file-level disclosure.

## Goal
Private stablecoin payments with no leaks: close Dust's remaining leaks (RPC reads, unshipped
C1 circuit fix) and ship two new payment flows (private USDT invoices on Whitechain, private
swap-and-pay through Uniswap v4).

## Baseline (pre-hackathon)
- Upstream: `tokamak-network/dust-protocol`, branch `main`, commit `18fadef` (2026-02-26).
- Everything after `18fadef` on branch `ethglobal-mumbai` was built during the event
  (2026-11-06/07 IST).

## Partner prize picks (max 3)
| Pick | Track(s) | Deliverable |
|---|---|---|
| Ethereum Foundation | Best Use of Anon-RPC (+ CROPS Upgrade, Continuity) | All browser RPC reads through Anon-RPC by default; CROPS README; no trackers |
| Whitechain | Continuity: Bring Your Product (+ Operate) | Dust deployed + verified on Whitechain Sepolia (1874), private USDT invoices |
| Uniswap Foundation | Build with Uniswap (Continuity) | Atomic private swap-and-pay: pool notes -> v4 swap -> stealth address |

## Phases
- [x] P0 Setup: branch, new repo `0xSY3/dust-mumbai` (tokamak remote push-disabled), deps, baseline tests
- [ ] P1 Hygiene: ~~LICENSE~~, ~~remove `@vercel/analytics`~~, fix `.gitmodules`, README Continuity/CROPS/AI sections
- [ ] P2 C1 fix shipped: recompile V2 circuits, FFLONK zkeys + verifiers, tests, Sepolia redeploy, zkeys to R2
- [ ] P3 Anon-RPC: transport factory for viem + ethers reads, settings toggle, "% anonymized" counter
- [ ] P4 Whitechain: ~~core Foundry project~~, ~~invoice metadata + reconciliation~~, ~~merchant /invoices +
  invoice checkout~~, ~~dust-pay.js embed + example~~, ~~WHITECHAIN_FEEDBACK.md draft~~; remaining: deploy +
  verify on 1874, chain config, real `0xcedf…` USDT payment, README links
- [ ] P5 Uniswap: `DustSwapAdapterV2` swap-to-stealth path, tests, Sepolia deploy, UI, FEEDBACK.md
- [ ] P6 E2E run, docs, push, videos (user), submission (user)

## Pre-implementation checklist (rigorous-coding)
- Assumptions: Sepolia + Whitechain RPCs reachable; deployer `0x8d56…7496` owns existing Dust
  contracts and is funded; Anon-RPC networks (tor-js / nym / nox) can reach the target RPC URLs.
- Edge cases: anonymity network bootstrap failure or `unsupported-chain`; RPC rate limits on
  `eth_getLogs`; USDT 6 decimals; FFLONK domain size growing after C1 constraint added.
- Correctness: forge + vitest + tsc green; circuit vkey == deployed verifier vkey; at least one
  real USDT stealth payment on Whitechain with explorer link; swap-to-stealth emits ERC-5564
  announcement the recipient scanner detects.
- Failure modes: anonymized transport unavailable -> fail closed (explicit user opt-out to direct
  RPC, never silent fallback); deploy partially fails -> config only updated after all verified.

## Decisions
- Anon-RPC fails closed by default (CROPS "P" must be structural, not cosmetic).
- Relayer remains trusted for exits/roots in this iteration; disclosed in README CROPS "C"/"S".
- New FFLONK setup uses PSE Perpetual Powers of Tau (`ppot_0080_20.ptau`); Hermez mirrors 403.

- Invoice ids ride in ERC-5564 announcement metadata (`'I'` + 16 random bytes after the amount), so
  merchants reconcile with their viewing key alone; status counts only on-chain-verified Transfer
  amounts, and only the first announcement per stealth address (replay protection).
- Whitechain payments target the prize-mandated USDT `0xcedf…55a7`, not the docs' `USDT.e`.

## Errors encountered
- `npm ci` EACCES in `~/.npm/_cacache` (root-owned cache) -> use isolated `--cache` dir.
- Hermez ptau URLs return 403 -> PSE ppot mirror.
- `forge install` in a dir without foundry.toml installs into the git root -> create foundry.toml first.
- zsh: a loop variable named `path` clobbers `PATH`; `timeout` is not installed on macOS.
