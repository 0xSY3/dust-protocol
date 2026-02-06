# Stealth Addresses

Private payments on Thanos. Send TON to anyone without revealing their identity on-chain.

## Quick Start

```bash
# Run tests
npm test -- --run src/lib/stealth/__tests__/

# Start app
npm run dev
# Go to http://localhost:3000/stealth
```

## What's Deployed

Thanos Sepolia:
- Announcer: `0x75BD499f7CA8E361b7930e2881b2B3c99Aa1eea1`
- Registry: `0x5779192B220876221Bc2871511FB764941314e04`
- Names (.tok): `0xACe425FC23d7594b829935EC4862f654541Bf0d3`

## How It Works

1. Recipient generates stealth keys (one-time setup)
2. Sender generates a fresh address for each payment
3. Sender sends TON + announces on-chain
4. Recipient scans announcements, derives private key, claims

The recipient's real address never appears on-chain.

## Code Structure

```
src/lib/stealth/     - crypto & blockchain logic
src/hooks/stealth/   - React state management
src/components/stealth/  - UI
contracts/           - Solidity contracts
```

## Key Files

- `keys.ts` - key generation from wallet signature
- `address.ts` - stealth address math
- `scanner.ts` - find your payments
- `useStealthScanner.ts` - scan & claim hook
- `PrivateWallet.tsx` - the UI

## Tests

67 tests, 65 pass (2 flaky due to network).

```bash
npm test -- --run src/lib/stealth/__tests__/e2e-full-flow.test.ts
```

This runs real transactions on Thanos Sepolia.

## Known Issues

- Claim needs ~0.00004 TON for gas
- Name registry requires Thanos Sepolia network in wallet

## TODO

- [ ] Relayer for sender privacy
- [ ] ERC-20 token support
