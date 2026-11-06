import { useState, useCallback, useRef } from 'react';
import { useAccount } from 'wagmi';
import { ethers } from 'ethers';
import {
  generateStealthAddress, parseStealthMetaAddress, lookupStealthMetaAddress,
  CANONICAL_ADDRESSES, SCHEME_ID, type GeneratedStealthAddress,
} from '@/lib/stealth';
import type { OutgoingPayment } from '@/lib/design/types';
import { getChainConfig, DEFAULT_CHAIN_ID } from '@/config/chains';
import { getChainProvider } from '@/lib/providers';
import { encodeTokenMetadata } from '@/lib/stealth/metadata';
import {
  prepareStealthPayment, transferAuthorizationDomain, TRANSFER_WITH_AUTHORIZATION_TYPES,
  type StealthPaymentRequest, type TransferAuthorization,
} from '@/lib/stealth/authorization';
import type { TokenConfig } from '@/config/tokens';

export interface TokenSendOptions {
  /** Random 16-byte invoice id embedded in the announcement so the merchant can reconcile it */
  invoiceId?: string;
}

import { storageKey, migrateKey } from '@/lib/storageKey';

function outgoingKey(senderAddress: string, chainId: number): string {
  return storageKey('sends', senderAddress, chainId);
}

function saveOutgoingPayment(senderAddress: string, chainId: number, payment: OutgoingPayment) {
  if (typeof window === 'undefined') return;
  const key = outgoingKey(senderAddress, chainId);
  const existing: OutgoingPayment[] = JSON.parse(localStorage.getItem(key) || '[]');
  existing.unshift(payment);
  // Keep last 100
  localStorage.setItem(key, JSON.stringify(existing.slice(0, 100)));
}

export function loadOutgoingPayments(senderAddress: string, chainId?: number): OutgoingPayment[] {
  if (typeof window === 'undefined') return [];
  const cid = chainId ?? DEFAULT_CHAIN_ID;
  migrateKey(`dust_outgoing_payments_${cid}_${senderAddress.toLowerCase()}`, outgoingKey(senderAddress, cid));
  const key = outgoingKey(senderAddress, cid);
  try {
    return JSON.parse(localStorage.getItem(key) || '[]');
  } catch {
    return [];
  }
}

const ANNOUNCER_ABI = [
  'function announce(uint256 schemeId, address stealthAddress, bytes calldata ephemeralPubKey, bytes calldata metadata) external',
];

function getProvider() {
  if (typeof window === 'undefined' || !window.ethereum) return null;
  return new ethers.providers.Web3Provider(window.ethereum as ethers.providers.ExternalProvider);
}

// Request account authorization before creating provider — prevents "unknown account #0" error
// when window.ethereum exists but no accounts are authorized (MetaMask locked, Privy mismatch)
async function getProviderWithAccounts(): Promise<ethers.providers.Web3Provider | null> {
  if (typeof window === 'undefined' || !window.ethereum) return null;
  await window.ethereum.request({ method: 'eth_requestAccounts' });
  return new ethers.providers.Web3Provider(window.ethereum as ethers.providers.ExternalProvider);
}

/** Switch MetaMask to the target chain, adding it if needed */
async function ensureChain(chainId: number): Promise<void> {
  if (typeof window === 'undefined' || !window.ethereum) return;
  const config = getChainConfig(chainId);
  const chainIdHex = '0x' + chainId.toString(16);
  try {
    await window.ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: chainIdHex }],
    });
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: number }).code === 4902) {
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: chainIdHex,
          chainName: config.name,
          nativeCurrency: config.nativeCurrency,
          rpcUrls: [config.rpcUrl],
          blockExplorerUrls: [config.blockExplorerUrl],
        }],
      });
    } else {
      throw err;
    }
  }
}

// Estimate gas cost for ETH transfer only (21k gas)
async function estimateEthTransferGasCost(provider: ethers.providers.Provider): Promise<ethers.BigNumber> {
  const feeData = await provider.getFeeData();
  const block = await provider.getBlock('latest');

  const baseFee = block.baseFeePerGas || feeData.gasPrice || ethers.utils.parseUnits('1', 'gwei');
  const priorityFee = feeData.maxPriorityFeePerGas || ethers.utils.parseUnits('1.5', 'gwei');

  // maxFeePerGas = max(2x baseFee, 1.2x (baseFee + priorityFee))
  const twoXBaseFee = baseFee.mul(2);
  const basePlusPriority = baseFee.add(priorityFee).mul(12).div(10);
  const maxFeePerGas = twoXBaseFee.gt(basePlusPriority) ? twoXBaseFee : basePlusPriority;

  // Gas for ETH transfer only + 5% buffer for RPC timing differences
  const gasLimit = ethers.BigNumber.from(21000);
  const baseCost = gasLimit.mul(maxFeePerGas);
  const buffer = baseCost.mul(5).div(100);
  return baseCost.add(buffer);
}

// Sponsor the announcement via deployer API (sender doesn't pay gas for this)
async function sponsorAnnounce(
  stealthAddress: string,
  ephemeralPubKey: string,
  metadata: string,
  chainId?: number,
): Promise<string> {
  const res = await fetch('/api/sponsor-announce', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stealthAddress, ephemeralPubKey, metadata, chainId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Sponsored announcement failed');
  return data.txHash;
}

/** The sponsor rejected the payment before submitting it, so the signed authorization was never used. */
class PaymentRejectedError extends Error {}

async function sponsorStealthPayment(request: StealthPaymentRequest): Promise<string> {
  const res = await fetch('/api/sponsor-stealth-payment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  const data: { txHash?: string; error?: string } = await res.json();
  if (res.ok && data.txHash) return data.txHash;
  const message = data.error || `Gasless payment failed (HTTP ${res.status})`;
  // 4xx: rejected during validation or simulation; 502: the relayed transaction reverted
  if (res.status < 500 || res.status === 502) throw new PaymentRejectedError(message);
  throw new Error(message);
}

const AUTHORIZATION_STATE_ABI = ['function authorizationState(address authorizer, bytes32 nonce) view returns (bool)'];
const ANNOUNCEMENT_ABI = [
  'event Announcement(uint256 indexed schemeId, address indexed stealthAddress, address indexed caller, bytes ephemeralPubKey, bytes metadata)',
];
const SETTLEMENT_POLLS = 5;
const SETTLEMENT_POLL_INTERVAL_MS = 2_000;
// ~80 minutes of 1s blocks: comfortably covers the authorization's 1h validity window
const SETTLEMENT_LOOKBACK_BLOCKS = 5_000;

/**
 * A relayed payment can land even when its HTTP response is lost (timeout, dropped connection).
 * Reads the outcome from chain state so a retry never pays the same invoice twice.
 * Returns the payment tx hash, or null when the authorization was not used.
 */
async function findRelayedPayment(chainId: number, token: string, authorization: TransferAuthorization): Promise<string | null> {
  const provider = getChainProvider(chainId);
  const tokenContract = new ethers.Contract(token, AUTHORIZATION_STATE_ABI, provider);
  for (let attempt = 0; attempt < SETTLEMENT_POLLS; attempt++) {
    if (await tokenContract.authorizationState(authorization.from, authorization.nonce)) {
      const announcer = new ethers.Contract(getChainConfig(chainId).contracts.announcer, ANNOUNCEMENT_ABI, provider);
      const latest = await provider.getBlockNumber();
      const logs = await announcer.queryFilter(
        announcer.filters.Announcement(SCHEME_ID.SECP256K1, authorization.to),
        Math.max(0, latest - SETTLEMENT_LOOKBACK_BLOCKS),
        latest,
      );
      const settled = logs[logs.length - 1];
      if (!settled) {
        throw new Error(`Your payment to ${authorization.to} went through, but its transaction could not be located. Check your wallet history before paying again.`);
      }
      return settled.transactionHash;
    }
    await new Promise(resolve => setTimeout(resolve, SETTLEMENT_POLL_INTERVAL_MS));
  }
  return null;
}

// Calculate maximum sendable amount (balance - gas for ETH transfer only; announcement is sponsored)
async function calculateMaxSendable(
  provider: ethers.providers.Provider,
  address: string
): Promise<{ maxAmount: ethers.BigNumber; gasCost: ethers.BigNumber; balance: ethers.BigNumber }> {
  const balance = await provider.getBalance(address);
  // Only need gas for ETH transfer — announcement is sponsored by deployer
  const gasCost = await estimateEthTransferGasCost(provider);
  const maxAmount = balance.sub(gasCost);
  return { maxAmount: maxAmount.gt(0) ? maxAmount : ethers.BigNumber.from(0), gasCost, balance };
}

// Validate amount against balance and gas
function validateSendAmount(
  amount: string,
  balance: ethers.BigNumber,
  gasCost: ethers.BigNumber,
  symbol = 'ETH',
): { valid: boolean; error?: string } {
  if (!amount || amount.trim() === '') {
    return { valid: false, error: 'Amount is required' };
  }

  const numAmount = parseFloat(amount);
  if (isNaN(numAmount) || numAmount <= 0) {
    return { valid: false, error: 'Invalid amount' };
  }

  // Check decimals
  const parts = amount.split('.');
  if (parts[1] && parts[1].length > 18) {
    return { valid: false, error: 'Too many decimal places (max 18)' };
  }

  try {
    const amountWei = ethers.utils.parseEther(amount);
    const totalNeeded = amountWei.add(gasCost);

    if (balance.lt(totalNeeded)) {
      const maxSendable = balance.sub(gasCost);
      if (maxSendable.lte(0)) {
        return { valid: false, error: `Insufficient balance for gas (~${ethers.utils.formatEther(gasCost)} ${symbol} needed)` };
      }
      return {
        valid: false,
        error: `Insufficient balance. Max sendable: ${parseFloat(ethers.utils.formatEther(maxSendable)).toFixed(6)} ${symbol}`
      };
    }

    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid amount format' };
  }
}


export function useStealthSend(chainId?: number) {
  const activeChainId = chainId ?? DEFAULT_CHAIN_ID;
  const { isConnected } = useAccount();
  const [lastGeneratedAddress, setLastGeneratedAddress] = useState<GeneratedStealthAddress | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sendingRef = useRef(false);

  const generateAddressFor = useCallback((metaAddress: string): GeneratedStealthAddress | null => {
    setError(null);
    try {
      const parsed = parseStealthMetaAddress(metaAddress);
      const generated = generateStealthAddress(parsed, activeChainId);
      setLastGeneratedAddress(generated);
      return generated;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate address');
      return null;
    }
  }, [activeChainId]);

  const generateAddressForAddress = useCallback(async (recipientAddress: string): Promise<GeneratedStealthAddress | null> => {
    setError(null);
    setIsLoading(true);
    try {
      const provider = getChainProvider(activeChainId);
      const metaBytes = await lookupStealthMetaAddress(provider, recipientAddress);
      if (!metaBytes) throw new Error('Recipient has no registered stealth address');

      const uri = `st:thanos:0x${metaBytes.replace(/^0x/, '')}`;
      const parsed = parseStealthMetaAddress(uri);
      const generated = generateStealthAddress(parsed, activeChainId);
      setLastGeneratedAddress(generated);
      return generated;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate address');
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [activeChainId]);

  // Get maximum sendable amount (exposed for UI "Max" button)
  const getMaxSendable = useCallback(async (): Promise<string | null> => {
    if (!isConnected) return null;
    try {
      const provider = getProvider();
      if (!provider) return null;

      // listAccounts doesn't throw when no accounts are authorized (returns [])
      const accounts = await provider.listAccounts();
      if (accounts.length === 0) return null;
      const address = accounts[0];

      const rpcProvider = getChainProvider(activeChainId);
      const { maxAmount } = await calculateMaxSendable(rpcProvider, address);

      if (maxAmount.lte(0)) return '0';
      return ethers.utils.formatEther(maxAmount);
    } catch {
      return null;
    }
  }, [activeChainId, isConnected]);

  const sendEthToStealth = useCallback(async (metaAddress: string, amount: string, linkSlug?: string): Promise<string | null> => {
    if (!isConnected) { setError('Wallet not connected'); return null; }
    if (sendingRef.current) return null;
    sendingRef.current = true;
    setError(null);
    setIsLoading(true);

    const config = getChainConfig(activeChainId);

    try {
      await ensureChain(activeChainId);
      const provider = await getProviderWithAccounts();
      if (!provider) throw new Error('No wallet provider — please install or unlock a browser wallet');
      const signer = provider.getSigner();
      const signerAddress = await signer.getAddress();

      // Use direct RPC for reliable balance/gas data
      const rpcProvider = getChainProvider(activeChainId);

      // Validate balance and gas BEFORE generating address
      const { balance, gasCost } = await calculateMaxSendable(rpcProvider, signerAddress);
      const validation = validateSendAmount(amount, balance, gasCost, config.nativeCurrency.symbol);
      if (!validation.valid) {
        throw new Error(validation.error);
      }

      // Generate stealth address
      const generated = generateAddressFor(metaAddress);
      if (!generated) throw new Error('Failed to generate stealth address');

      // Send ETH with explicit gas parameters
      const feeData = await rpcProvider.getFeeData();
      const block = await rpcProvider.getBlock('latest');
      const baseFee = block.baseFeePerGas || feeData.gasPrice || ethers.utils.parseUnits('1', 'gwei');
      const priorityFee = feeData.maxPriorityFeePerGas || ethers.utils.parseUnits('1', 'gwei');
      const twoXBaseFee = baseFee.mul(2);
      const basePlusPriority = baseFee.add(priorityFee).mul(12).div(10);
      const maxFeePerGas = twoXBaseFee.gt(basePlusPriority) ? twoXBaseFee : basePlusPriority;

      const tx = await signer.sendTransaction({
        to: generated.stealthAddress,
        value: ethers.utils.parseEther(amount),
        gasLimit: 21000,
        maxFeePerGas,
        maxPriorityFeePerGas: priorityFee,
        type: 2,
      });
      const receipt = await tx.wait();
      const sendTxHash = receipt.transactionHash;

      // Announce via sponsored API (deployer pays gas, not sender) — fire-and-forget
      // The ETH is already on-chain; announce is background infrastructure for recipient scanning
      const ephPubKey = '0x' + generated.ephemeralPublicKey.replace(/^0x/, '');
      let metadata = '0x' + generated.viewTag;
      if (linkSlug) {
        const slugBytes = new TextEncoder().encode(linkSlug);
        const slugHex = Array.from(slugBytes).map(b => b.toString(16).padStart(2, '0')).join('');
        metadata += slugHex;
      }
      sponsorAnnounce(generated.stealthAddress, ephPubKey, metadata, activeChainId)
        .catch(err => console.warn('Sponsored announcement failed (non-fatal):', err));

      // Persist outgoing payment for Activities
      saveOutgoingPayment(signerAddress, activeChainId, {
        txHash: sendTxHash,
        to: linkSlug || metaAddress.slice(0, 20),
        amount,
        timestamp: Date.now(),
        stealthAddress: generated.stealthAddress,
      });

      return sendTxHash;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to send';
      setError(msg);
      return null;
    } finally {
      setIsLoading(false);
      sendingRef.current = false;
    }
  }, [isConnected, activeChainId, generateAddressFor]);

  const sendTokenToStealth = useCallback(async (metaAddress: string, tokenAddress: string, amount: string, options?: TokenSendOptions): Promise<string | null> => {
    if (!isConnected) { setError('Wallet not connected'); return null; }
    if (sendingRef.current) return null;
    sendingRef.current = true;
    setError(null);
    setIsLoading(true);

    const config = getChainConfig(activeChainId);

    try {
      await ensureChain(activeChainId);
      const provider = await getProviderWithAccounts();
      if (!provider) throw new Error('No wallet provider — please install or unlock a browser wallet');
      const signer = provider.getSigner();
      const signerAddress = await signer.getAddress();

      const rpcProvider = getChainProvider(activeChainId);
      const ethBalance = await rpcProvider.getBalance(signerAddress);
      const gasCost = await estimateEthTransferGasCost(rpcProvider);

      if (ethBalance.lt(gasCost)) {
        throw new Error(`Insufficient balance for gas. Need ~${ethers.utils.formatEther(gasCost)} ${config.nativeCurrency.symbol}`);
      }

      const erc20 = new ethers.Contract(tokenAddress, [
        'function transfer(address to, uint256 amount) returns (bool)',
        'function decimals() view returns (uint8)',
        'function balanceOf(address) view returns (uint256)',
      ], signer);

      // Check token balance
      const decimals = await erc20.decimals();
      const amountWei = ethers.utils.parseUnits(amount, decimals);
      const tokenBalance = await erc20.balanceOf(signerAddress);

      if (tokenBalance.lt(amountWei)) {
        throw new Error(`Insufficient token balance. Have ${ethers.utils.formatUnits(tokenBalance, decimals)}, need ${amount}`);
      }

      const generated = generateAddressFor(metaAddress);
      if (!generated) throw new Error('Failed to generate stealth address');

      const tx = await erc20.transfer(generated.stealthAddress, amountWei);
      const receipt = await tx.wait();
      const sendTxHash = receipt.transactionHash;

      // Announce via sponsored API (deployer pays gas)
      // H1: token info travels in the metadata (see lib/stealth/metadata.ts for the layout)
      const ephPubKey2 = '0x' + generated.ephemeralPublicKey.replace(/^0x/, '');
      const tokenMetadata = encodeTokenMetadata({
        viewTag: generated.viewTag,
        chainId: activeChainId,
        tokenAddress,
        amount: amountWei,
        invoiceId: options?.invoiceId,
      });
      const announce = () => sponsorAnnounce(generated.stealthAddress, ephPubKey2, tokenMetadata, activeChainId);

      // Persist outgoing payment for Activities
      saveOutgoingPayment(signerAddress, activeChainId, {
        txHash: sendTxHash,
        to: metaAddress.slice(0, 20),
        amount,
        timestamp: Date.now(),
        stealthAddress: generated.stealthAddress,
      });

      if (!options?.invoiceId) {
        announce().catch(err => console.warn('Sponsored announcement failed (non-fatal):', err));
        return sendTxHash;
      }

      // The merchant reconciles invoices from the announcement alone, so an invoice payment
      // is not complete until it is announced: await it (one retry) instead of fire-and-forget.
      try {
        await announce();
      } catch (firstError) {
        console.warn('Invoice announcement failed, retrying:', firstError);
        try {
          await announce();
        } catch (retryError) {
          const reason = retryError instanceof Error ? retryError.message : String(retryError);
          throw new Error(`Payment ${sendTxHash} settled but the invoice announcement failed: ${reason}`);
        }
      }
      return sendTxHash;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send token');
      return null;
    } finally {
      setIsLoading(false);
      sendingRef.current = false;
    }
  }, [isConnected, activeChainId, generateAddressFor]);

  // Gasless: the payer signs an EIP-3009 authorization and the sponsor relays it through
  // StealthPaymentRouter, so the transfer and its announcement land in one transaction.
  const sendTokenWithAuthorization = useCallback(async (metaAddress: string, token: TokenConfig, amount: string, options?: TokenSendOptions): Promise<string | null> => {
    if (!isConnected) { setError('Wallet not connected'); return null; }
    const domain = token.authorization;
    if (!domain) { setError(`${token.symbol} does not support gasless payments`); return null; }
    if (sendingRef.current) return null;
    sendingRef.current = true;
    setError(null);
    setIsLoading(true);

    try {
      await ensureChain(activeChainId);
      const provider = await getProviderWithAccounts();
      if (!provider) throw new Error('No wallet provider — please install or unlock a browser wallet');
      const signer = provider.getSigner();
      const signerAddress = await signer.getAddress();

      const amountUnits = ethers.utils.parseUnits(amount, token.decimals);
      const erc20 = new ethers.Contract(token.address, ['function balanceOf(address) view returns (uint256)'], getChainProvider(activeChainId));
      const tokenBalance: ethers.BigNumber = await erc20.balanceOf(signerAddress);
      if (tokenBalance.lt(amountUnits)) {
        throw new Error(`Insufficient ${token.symbol} balance. Have ${ethers.utils.formatUnits(tokenBalance, token.decimals)}, need ${amount}`);
      }

      const generated = generateAddressFor(metaAddress);
      if (!generated) throw new Error('Failed to generate stealth address');

      const unsigned = prepareStealthPayment({
        chainId: activeChainId,
        token: token.address,
        payer: signerAddress,
        stealthAddress: generated.stealthAddress,
        ephemeralPublicKey: generated.ephemeralPublicKey,
        viewTag: generated.viewTag,
        amount: amountUnits,
        invoiceId: options?.invoiceId,
        nowSeconds: Math.floor(Date.now() / 1000),
      });
      const signature = await signer._signTypedData(
        transferAuthorizationDomain(domain, activeChainId, token.address),
        TRANSFER_WITH_AUTHORIZATION_TYPES,
        unsigned.authorization,
      );

      let txHash: string;
      try {
        txHash = await sponsorStealthPayment({ ...unsigned, authorization: { ...unsigned.authorization, signature } });
      } catch (submitError) {
        if (submitError instanceof PaymentRejectedError) throw submitError;
        console.warn('Gasless payment outcome unknown, checking chain state:', submitError);
        const settled = await findRelayedPayment(activeChainId, token.address, unsigned.authorization);
        if (!settled) throw submitError;
        txHash = settled;
      }

      saveOutgoingPayment(signerAddress, activeChainId, {
        txHash,
        to: metaAddress.slice(0, 20),
        amount,
        timestamp: Date.now(),
        stealthAddress: generated.stealthAddress,
      });
      return txHash;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send token');
      return null;
    } finally {
      setIsLoading(false);
      sendingRef.current = false;
    }
  }, [isConnected, activeChainId, generateAddressFor]);

  const announcePayment = useCallback(async (stealthAddress: string, ephemeralPublicKey: string, viewTag: string): Promise<string | null> => {
    if (!isConnected) { setError('Wallet not connected'); return null; }
    setError(null);
    setIsLoading(true);

    try {
      const config = getChainConfig(activeChainId);
      const provider = await getProviderWithAccounts();
      if (!provider) throw new Error('No wallet provider — please install or unlock a browser wallet');
      const signer = provider.getSigner();

      const announcer = new ethers.Contract(config.contracts.announcer, ANNOUNCER_ABI, signer);
      const tx = await announcer.announce(SCHEME_ID.SECP256K1, stealthAddress, '0x' + ephemeralPublicKey.replace(/^0x/, ''), '0x' + viewTag);
      const receipt = await tx.wait();
      return receipt.transactionHash;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to announce');
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [isConnected, activeChainId]);

  return {
    generateAddressFor,
    generateAddressForAddress,
    sendEthToStealth,
    sendTokenToStealth,
    sendTokenWithAuthorization,
    announcePayment,
    getMaxSendable,
    lastGeneratedAddress,
    isLoading,
    error
  };
}
