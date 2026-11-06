// End-to-end run of the gasless invoice checkout on Whitechain Sepolia (1874), against the real chain
// and the app's own relay route:
//   payer   holds USDT and no WBT, signs one EIP-3009 authorization (as InvoiceCheckout does)
//   relay   POST /api/sponsor-stealth-payment -> StealthPaymentRouter: transfer + ERC-5564 announce, one tx
//   merchant a fresh Dust identity finds the payment from the announcement alone (as the scanner does),
//           derives the stealth account it controls, and matches the invoice id and amount
//
// Usage (dev server running):
//   PAYER_PRIVATE_KEY=0x… [APP_URL=http://localhost:3000] [AMOUNT=1.25] \
//     npx tsx --tsconfig tsconfig.json scripts/whitechain-invoice-e2e.ts
// Fund the payer with USDT first: contracts/core/script/BuyTestUsdt.s.sol (USDT_RECIPIENT=<payer>).

import { ethers } from 'ethers';
import { getChainConfig } from '@/config/chains';
import { getTokenBySymbol } from '@/config/tokens';
import { generateStealthKeyPair, formatStealthMetaAddress, parseStealthMetaAddress } from '@/lib/stealth/keys';
import {
  generateStealthAddress, computeViewTag, computeStealthPrivateKey, getAddressFromPrivateKey, computeStealthAccountAddress,
} from '@/lib/stealth/address';
import { prepareStealthPayment, transferAuthorizationDomain, TRANSFER_WITH_AUTHORIZATION_TYPES } from '@/lib/stealth/authorization';
import { decodeTokenMetadata } from '@/lib/stealth/metadata';
import { generateInvoiceId } from '@/lib/invoices/invoice';

const CHAIN_ID = 1874;
const SCHEME_ID_SECP256K1 = 1;
const ANNOUNCER_ABI = [
  'event Announcement(uint256 indexed schemeId, address indexed stealthAddress, address indexed caller, bytes ephemeralPubKey, bytes metadata)',
];
const ERC20_ABI = ['function balanceOf(address) view returns (uint256)'];

function check(condition: boolean, label: string): void {
  if (!condition) throw new Error(`FAILED: ${label}`);
  console.log(`  ok  ${label}`);
}

async function main(): Promise<void> {
  const payerKey = process.env.PAYER_PRIVATE_KEY;
  if (!payerKey) throw new Error('PAYER_PRIVATE_KEY is required');
  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';

  const config = getChainConfig(CHAIN_ID);
  const usdt = getTokenBySymbol(CHAIN_ID, 'USDT');
  if (!usdt?.authorization || !config.contracts.stealthPaymentRouter) {
    throw new Error('Whitechain USDT or StealthPaymentRouter is not configured');
  }
  const provider = new ethers.providers.StaticJsonRpcProvider(config.rpcUrl, CHAIN_ID);
  const payer = new ethers.Wallet(payerKey, provider);
  const token = new ethers.Contract(usdt.address, ERC20_ABI, provider);
  const amount = ethers.utils.parseUnits(process.env.AMOUNT ?? '1.25', usdt.decimals);

  const merchantKeys = generateStealthKeyPair();
  const merchantMetaAddress = formatStealthMetaAddress(merchantKeys, 'eth');
  const invoiceId = generateInvoiceId();
  const payerGasBefore = await provider.getBalance(payer.address);
  const payerUsdtBefore: ethers.BigNumber = await token.balanceOf(payer.address);
  console.log(`payer ${payer.address}: ${ethers.utils.formatUnits(payerUsdtBefore, usdt.decimals)} USDT, ${ethers.utils.formatEther(payerGasBefore)} WBT`);
  if (payerUsdtBefore.lt(amount)) throw new Error('Payer needs more USDT; run BuyTestUsdt.s.sol first');

  // Payer: one signature, no transaction
  const generated = generateStealthAddress(parseStealthMetaAddress(merchantMetaAddress), CHAIN_ID);
  const unsigned = prepareStealthPayment({
    chainId: CHAIN_ID,
    token: usdt.address,
    payer: payer.address,
    stealthAddress: generated.stealthAddress,
    ephemeralPublicKey: generated.ephemeralPublicKey,
    viewTag: generated.viewTag,
    amount,
    invoiceId,
    nowSeconds: Math.floor(Date.now() / 1000),
  });
  const signature = await payer._signTypedData(
    transferAuthorizationDomain(usdt.authorization, CHAIN_ID, usdt.address),
    TRANSFER_WITH_AUTHORIZATION_TYPES,
    unsigned.authorization,
  );

  const res = await fetch(`${appUrl}/api/sponsor-stealth-payment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...unsigned, authorization: { ...unsigned.authorization, signature } }),
  });
  const relayed: { txHash?: string; error?: string } = await res.json();
  if (!res.ok || !relayed.txHash) throw new Error(`Relay rejected the payment (${res.status}): ${relayed.error}`);
  const receipt = await provider.getTransactionReceipt(relayed.txHash);
  console.log(`\npayment tx ${config.blockExplorerUrl}/tx/${relayed.txHash}`);
  check(receipt.status === 1, 'payment transaction succeeded');

  // Merchant: find the payment from the announcement alone
  const announcer = new ethers.Contract(config.contracts.announcer, ANNOUNCER_ABI, provider);
  const announcements = await announcer.queryFilter(
    announcer.filters.Announcement(SCHEME_ID_SECP256K1, generated.stealthAddress),
    receipt.blockNumber,
    receipt.blockNumber,
  );
  check(announcements.length === 1, 'exactly one announcement for the stealth address');
  const announcement = announcements[0];
  check(announcement.transactionHash === relayed.txHash, 'transfer and announcement landed in the same transaction');
  check(announcement.args?.caller === config.contracts.stealthPaymentRouter, 'announced by StealthPaymentRouter');

  const ephemeralPubKey: string = announcement.args?.ephemeralPubKey;
  const metadata: string = announcement.args?.metadata;
  check(computeViewTag(merchantKeys.viewingPrivateKey, ephemeralPubKey) === metadata.slice(2, 4), 'view tag matches the merchant viewing key');
  const stealthOwner = getAddressFromPrivateKey(
    '0x' + computeStealthPrivateKey(merchantKeys.spendingPrivateKey, merchantKeys.viewingPrivateKey, ephemeralPubKey),
  );
  check(computeStealthAccountAddress(stealthOwner, CHAIN_ID) === generated.stealthAddress, 'merchant controls the stealth account');

  const decoded = decodeTokenMetadata(metadata);
  check(decoded?.invoiceId === invoiceId.toLowerCase(), `announcement carries invoice ${invoiceId}`);
  check(decoded?.tokenAddress === usdt.address.toLowerCase() && decoded.chainId === CHAIN_ID, 'announcement names Whitechain USDT');
  check(decoded?.amountHex !== null && ethers.BigNumber.from('0x' + decoded?.amountHex).eq(amount), 'announced amount equals the invoice amount');
  const received: ethers.BigNumber = await token.balanceOf(generated.stealthAddress);
  check(received.eq(amount), `stealth account holds ${ethers.utils.formatUnits(received, usdt.decimals)} USDT`);
  check((await provider.getBalance(payer.address)).eq(payerGasBefore), 'payer spent no WBT on gas');

  console.log(`\nstealth account ${config.blockExplorerUrl}/address/${generated.stealthAddress}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
