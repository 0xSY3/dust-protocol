# Whitechain feedback

What it was like to bring Dust (private stealth payments, ERC-5564/6538 + ERC-4337) to
Whitechain Sepolia (chain 1874) during ETHGlobal Mumbai 2026.

## What worked

- **Plain OP Stack, no surprises.** Our Foundry scripts, ethers v5 server code and viem/wagmi
  frontend needed nothing chain-specific beyond a `defineChain`.
- **Useful preinstalls.** We found ERC-4337 EntryPoint v0.6 and v0.7, the CREATE2 deployer,
  Multicall3 and Permit2 already at their canonical addresses, so Dust's stealth smart accounts
  only needed our own factory and paymaster.
- **Blockscout API.** We scripted against the public REST v2 API, for token search, ABI lookup
  and holder data. The docs spell out that Foundry's `--verifier-url` needs the `/api/` suffix.
- **`llms-full.txt`.** We grepped one file instead of crawling the docs site, and it answered most of our questions.
- **The official test USDT is TetherTokenV2.** It supports EIP-2612 `permit` and EIP-3009
  `transferWithAuthorization`, which opens a path to gasless, relayer-submitted payments.

## Where we got stuck

- **Two "official" USDTs.** The prize page requires USDT `0xcedfB561…55a7`. The docs token list
  shows USDT as `0xaa7962d0…8f46` (bridged USDT.e). A Blockscout search for "USDT" also returns
  10+ look-alike tokens deployed by other teams. Only the prize page told us which one counts.
- **No way to get test USDT.** The faucet only drips WBT (0.5 per 24h), and
  the docs do not say how to obtain `0xcedf…` USDT. Its owner is a bridge-style contract, and we
  found no self-serve way to get some.
- **Unclear EIP-7702 status.** Block headers carry Prague fields (`requestsHash`), but the docs never
  mention EIP-7702. Dust supports 7702 stealth sub-accounts on Ethereum Sepolia, but we shipped
  ERC-4337 accounts on Whitechain rather than guess.

## What the docs were missing

1. One canonical testnet token table that matches the prize requirements, with proxy and
   implementation addresses and how to get each token.
2. A list of preinstalled contracts (EntryPoint, Permit2, Multicall3, CREATE2) and their addresses.
3. A hardfork and EIP support matrix, mainly EIP-7702 and blob transactions.
