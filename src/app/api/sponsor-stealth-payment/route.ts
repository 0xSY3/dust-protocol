import { ethers } from 'ethers';
import { NextResponse } from 'next/server';
import { getChainConfig, isChainSupported } from '@/config/chains';
import { getTokenByAddress } from '@/config/tokens';
import { getServerSponsor, parseChainId } from '@/lib/server-provider';
import { parseStealthPaymentRequest, recoverAuthorizationSigner } from '@/lib/stealth/authorization';

export const maxDuration = 60;

const SPONSOR_KEY = process.env.RELAYER_PRIVATE_KEY;

const ROUTER_ABI = [
  'function payWithAuthorization(address token, address stealthAddress, (address from, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, bytes signature) auth, bytes ephemeralPubKey, bytes metadata)',
];

// The sponsor pays gas for every relayed payment, so throttle repeat submissions per payer
const payerCooldowns = new Map<string, number>();
const COOLDOWN_MS = 5_000;
// Below this, relaying costs the sponsor more than the payment is worth
const MINIMUM_PAYMENT = '0.01';

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

// ethers v5 rejects wait() when the transaction reverts and attaches the receipt to the error
async function waitForReceipt(tx: ethers.ContractTransaction): Promise<ethers.providers.TransactionReceipt> {
  try {
    return await tx.wait();
  } catch (waitError) {
    if (typeof waitError === 'object' && waitError !== null && 'receipt' in waitError && waitError.receipt) {
      return waitError.receipt as ethers.providers.TransactionReceipt;
    }
    throw waitError;
  }
}

export async function POST(req: Request) {
  try {
    if (!SPONSOR_KEY) return NextResponse.json({ error: 'Sponsor not configured' }, { status: 500 });

    const body: unknown = await req.json();
    const chainId = parseChainId(typeof body === 'object' && body !== null ? body as Record<string, unknown> : {});
    if (!isChainSupported(chainId)) return badRequest(`Unsupported chain ${chainId}`);
    const config = getChainConfig(chainId);
    const routerAddress = config.contracts.stealthPaymentRouter;
    if (!routerAddress) return badRequest(`Gasless payments are not available on ${config.name}`);

    const parsed = parseStealthPaymentRequest(body, chainId, Math.floor(Date.now() / 1000));
    if (!parsed.ok) return badRequest(parsed.error);
    const { token: tokenAddress, stealthAddress, authorization: auth, ephemeralPubKey, metadata } = parsed.request;

    const token = getTokenByAddress(chainId, tokenAddress);
    if (!token?.authorization) return badRequest('Token does not support gasless payments');
    if (BigInt(auth.value) < ethers.utils.parseUnits(MINIMUM_PAYMENT, token.decimals).toBigInt()) {
      return badRequest(`Minimum gasless payment is ${MINIMUM_PAYMENT} ${token.symbol}`);
    }

    const payerKey = auth.from.toLowerCase();
    const last = payerCooldowns.get(payerKey);
    if (last && Date.now() - last < COOLDOWN_MS) {
      return NextResponse.json({ error: 'Please wait a few seconds before paying again' }, { status: 429 });
    }
    payerCooldowns.set(payerKey, Date.now());

    const args = [
      token.address,
      stealthAddress,
      [auth.from, auth.value, auth.validAfter, auth.validBefore, auth.nonce, auth.signature],
      ephemeralPubKey,
      metadata,
    ] as const;
    const router = new ethers.Contract(routerAddress, ROUTER_ABI, getServerSponsor(chainId));

    // Simulate first so a bad signature or an unfunded payer never costs the sponsor gas
    try {
      await router.callStatic.payWithAuthorization(...args);
    } catch (simulationError) {
      console.warn('[SponsorStealthPayment] Simulation reverted:', simulationError);
      let signer: string | null = null;
      try {
        signer = recoverAuthorizationSigner(token.authorization, chainId, token.address, auth, auth.signature);
      } catch (recoverError) {
        console.warn('[SponsorStealthPayment] Signature is not a recoverable ECDSA signature:', recoverError);
      }
      return badRequest(signer?.toLowerCase() === payerKey
        ? `Payment would fail on-chain (check your ${token.symbol} balance)`
        : 'Signature does not match the paying wallet');
    }

    const tx: ethers.ContractTransaction = await router.payWithAuthorization(...args);
    const receipt = await waitForReceipt(tx);
    if (receipt.status !== 1) {
      return NextResponse.json({ error: 'Payment transaction reverted', txHash: receipt.transactionHash }, { status: 502 });
    }
    return NextResponse.json({ success: true, txHash: receipt.transactionHash }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[SponsorStealthPayment] Error:', e);
    return NextResponse.json({ error: 'Gasless payment failed' }, { status: 500 });
  }
}
