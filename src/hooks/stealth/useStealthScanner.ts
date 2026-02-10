import { useState, useCallback, useEffect, useRef } from 'react';
import { useAccount } from 'wagmi';
import { ethers } from 'ethers';
import {
  scanAnnouncements, setLastScannedBlock as saveLastScannedBlock,
  getLastScannedBlock, getAnnouncementCount, getAddressFromPrivateKey,
  signWalletDrain, signUserOp,
  type StealthKeyPair, type ScanResult,
  DEPLOYMENT_BLOCK,
  STEALTH_ACCOUNT_FACTORY, STEALTH_ACCOUNT_FACTORY_ABI,
} from '@/lib/stealth';

interface StealthPayment extends ScanResult {
  balance?: string;
  originalAmount?: string;
  claimed?: boolean;
  keyMismatch?: boolean;
  autoClaiming?: boolean;
}

// Thanos Sepolia RPC for reliable fee estimation
const THANOS_RPC = 'https://rpc.thanos-sepolia.tokamak.network';

// localStorage keys
const PAYMENTS_STORAGE_KEY = 'stealth_payments_';

function getProvider() {
  if (typeof window === 'undefined' || !window.ethereum) return null;
  return new ethers.providers.Web3Provider(window.ethereum as ethers.providers.ExternalProvider);
}

// Direct RPC provider for accurate fee data (bypasses MetaMask network issues)
function getThanosProvider() {
  return new ethers.providers.JsonRpcProvider(THANOS_RPC);
}

// Batch provider for parallel balance queries — batches multiple JSON-RPC calls into single HTTP request
function getThanosBatchProvider() {
  return new ethers.providers.JsonRpcBatchProvider(THANOS_RPC);
}

function loadPaymentsFromStorage(address: string): StealthPayment[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(PAYMENTS_STORAGE_KEY + address.toLowerCase());
    if (!raw) return [];
    // Strip transient UI state (autoClaiming) on load
    return JSON.parse(raw).map((p: StealthPayment) => ({ ...p, autoClaiming: false }));
  } catch {
    return [];
  }
}

function savePaymentsToStorage(address: string, payments: StealthPayment[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(PAYMENTS_STORAGE_KEY + address.toLowerCase(), JSON.stringify(payments));
  } catch { /* quota exceeded etc */ }
}

const THANOS_CHAIN_ID = 111551119090;

// StealthAccount.drain(address to) selector
const DRAIN_SELECTOR = '0xece53132';

// Auto-claim an ERC-4337 account payment via bundle API
async function autoClaimAccount(
  payment: ScanResult,
  recipient: string,
): Promise<{ txHash: string } | null> {
  try {
    const ownerEOA = getAddressFromPrivateKey(payment.stealthPrivateKey);
    const accountAddress = payment.announcement.stealthAddress;

    // Check if account is already deployed
    const provider = getThanosProvider();
    const code = await provider.getCode(accountAddress);
    const isDeployed = code !== '0x';

    // Build initCode if not deployed
    let initCode = '0x';
    if (!isDeployed) {
      const iface = new ethers.utils.Interface(STEALTH_ACCOUNT_FACTORY_ABI);
      const createData = iface.encodeFunctionData('createAccount', [ownerEOA, 0]);
      initCode = ethers.utils.hexConcat([STEALTH_ACCOUNT_FACTORY, createData]);
    }

    // Build callData: drain(recipient)
    const callData = ethers.utils.hexConcat([
      DRAIN_SELECTOR,
      ethers.utils.defaultAbiCoder.encode(['address'], [recipient]),
    ]);

    // Step 1: Get completed UserOp from server
    const prepRes = await fetch('/api/bundle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: accountAddress,
        initCode,
        callData,
      }),
    });
    const prepData = await prepRes.json();
    if (!prepRes.ok) {
      console.warn('[AutoClaim/Account] Prep failed:', prepData.error);
      return null;
    }

    // Step 2: Sign userOpHash locally (private key never leaves browser)
    const { userOp, userOpHash } = prepData;
    userOp.signature = await signUserOp(userOpHash, payment.stealthPrivateKey);

    // Step 3: Submit signed UserOp
    const submitRes = await fetch('/api/bundle/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userOp }),
    });
    const submitData = await submitRes.json();
    if (!submitRes.ok) {
      console.warn('[AutoClaim/Account] Submit failed:', submitData.error);
      return null;
    }

    console.log('[AutoClaim/Account] Success:', accountAddress, '→', recipient, 'tx:', submitData.txHash);
    return submitData;
  } catch (e) {
    console.warn('[AutoClaim/Account] Error for', payment.announcement.stealthAddress, ':', e);
    return null;
  }
}

// Auto-claim a single payment via sponsor-claim API (legacy CREATE2 + EOA)
async function autoClaimLegacy(
  payment: ScanResult,
  recipient: string,
): Promise<{ txHash: string; amount: string; gasFunded: string } | null> {
  try {
    let body: Record<string, string>;

    if (payment.walletType === 'create2') {
      const ownerEOA = getAddressFromPrivateKey(payment.stealthPrivateKey);
      const signature = await signWalletDrain(
        payment.stealthPrivateKey,
        payment.announcement.stealthAddress,
        recipient,
        THANOS_CHAIN_ID,
      );
      body = {
        stealthAddress: payment.announcement.stealthAddress,
        owner: ownerEOA,
        recipient,
        signature,
      };
    } else {
      body = {
        stealthAddress: payment.announcement.stealthAddress,
        stealthPrivateKey: payment.stealthPrivateKey,
        recipient,
      };
    }

    const res = await fetch('/api/sponsor-claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      console.warn('[AutoClaim] Failed for', payment.announcement.stealthAddress, ':', data.error);
      return null;
    }
    console.log('[AutoClaim] Success:', payment.announcement.stealthAddress, '→', recipient, 'amount:', data.amount, 'TON', 'type:', payment.walletType);
    return data;
  } catch (e) {
    console.warn('[AutoClaim] Error for', payment.announcement.stealthAddress, ':', e);
    return null;
  }
}

// Route claim by wallet type
async function autoClaimPayment(
  payment: ScanResult,
  recipient: string,
): Promise<{ txHash: string } | null> {
  if (payment.walletType === 'account') {
    return autoClaimAccount(payment, recipient);
  }
  return autoClaimLegacy(payment, recipient);
}

interface UseStealthScannerOptions {
  autoClaimRecipient?: string;
}

export function useStealthScanner(stealthKeys: StealthKeyPair | null, options?: UseStealthScannerOptions) {
  const { address, isConnected } = useAccount();
  const [payments, setPayments] = useState<StealthPayment[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const scanIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const autoClaimingRef = useRef<Set<string>>(new Set());
  const autoClaimCooldownRef = useRef<Map<string, number>>(new Map());

  const autoClaimRecipientRef = useRef(options?.autoClaimRecipient);
  autoClaimRecipientRef.current = options?.autoClaimRecipient;

  // Load persisted payments on mount / address change
  useEffect(() => {
    if (address) {
      const stored = loadPaymentsFromStorage(address);
      if (stored.length > 0) {
        setPayments(stored);
      }
    }
  }, [address]);

  // Persist payments whenever they change
  useEffect(() => {
    if (address && payments.length > 0) {
      savePaymentsToStorage(address, payments);
    }
  }, [address, payments]);

  // Auto-claim: when new unclaimed payments appear and we have a recipient
  const tryAutoClaim = useCallback(async (newPayments: StealthPayment[]) => {
    const recipient = autoClaimRecipientRef.current;
    if (!recipient) return;

    const now = Date.now();
    const claimable = newPayments.filter(p => {
      const txHash = p.announcement.txHash;
      if (p.claimed || p.keyMismatch || parseFloat(p.balance || '0') <= 0) return false;
      if (autoClaimingRef.current.has(txHash)) return false;
      // 30-second cooldown after a failed attempt
      const lastAttempt = autoClaimCooldownRef.current.get(txHash);
      if (lastAttempt && now - lastAttempt < 3000) return false;
      return true;
    });

    if (claimable.length === 0) return;

    for (const payment of claimable) {
      const txHash = payment.announcement.txHash;
      autoClaimingRef.current.add(txHash);

      // Mark as auto-claiming in UI
      setPayments(prev => prev.map(p =>
        p.announcement.txHash === txHash ? { ...p, autoClaiming: true } : p
      ));

      // Verify key is valid (for CREATE2, key derives the owner not the wallet address)
      try {
        getAddressFromPrivateKey(payment.stealthPrivateKey);
      } catch {
        console.warn('[AutoClaim] Invalid key, skipping:', txHash);
        autoClaimingRef.current.delete(txHash);
        setPayments(prev => prev.map(p =>
          p.announcement.txHash === txHash ? { ...p, autoClaiming: false, keyMismatch: true } : p
        ));
        continue;
      }

      const result = await autoClaimPayment(payment, recipient);

      if (result) {
        setPayments(prev => prev.map(p =>
          p.announcement.txHash === txHash ? { ...p, claimed: true, balance: '0', autoClaiming: false } : p
        ));
        autoClaimCooldownRef.current.delete(txHash);
      } else {
        setPayments(prev => prev.map(p =>
          p.announcement.txHash === txHash ? { ...p, autoClaiming: false } : p
        ));
        autoClaimCooldownRef.current.set(txHash, Date.now());
      }
      autoClaimingRef.current.delete(txHash);
    }
  }, []);

  const isBgScanningRef = useRef(false);

  const scan = useCallback(async (fromBlock?: number, silent = false) => {
    if (!stealthKeys || !isConnected) {
      if (!silent) setError('No stealth keys or wallet not connected');
      return;
    }

    // Use direct RPC provider for event scanning — more reliable than MetaMask
    const provider = getThanosProvider();
    // Use batch provider for balance queries — batches 2N calls into fewer HTTP requests
    const batchProvider = getThanosBatchProvider();

    if (!silent) {
      setError(null);
      setIsScanning(true);
      setProgress({ current: 0, total: 0 });
    }

    try {
      // Incremental scanning: use lastScannedBlock for silent/background scans
      let startBlock: number;
      if (fromBlock !== undefined) {
        startBlock = fromBlock;
      } else if (silent && address) {
        // Background scan: only scan new blocks since last scan
        startBlock = getLastScannedBlock(address) ?? DEPLOYMENT_BLOCK;
      } else {
        // Full scan (manual trigger): always from deployment
        startBlock = DEPLOYMENT_BLOCK;
      }

      const latestBlock = await provider.getBlockNumber();

      // Skip if we're already up to date (background scan optimization)
      if (silent && startBlock >= latestBlock) return;

      console.log(`[useStealthScanner] scan() silent=${silent}, from=${startBlock}, latest=${latestBlock}`);

      if (!silent) {
        const total = await getAnnouncementCount(provider, startBlock, latestBlock);
        setProgress({ current: 0, total });
      }

      const results = await scanAnnouncements(provider, stealthKeys, startBlock, latestBlock);

      // Batch all balance queries via JsonRpcBatchProvider
      const enriched: StealthPayment[] = await Promise.all(
        results.map(async (r) => {
          try {
            const [bal, historicalBal] = await Promise.all([
              batchProvider.getBalance(r.announcement.stealthAddress),
              batchProvider.getBalance(r.announcement.stealthAddress, r.announcement.blockNumber),
            ]);
            const balance = ethers.utils.formatEther(bal);
            const originalAmount = ethers.utils.formatEther(historicalBal);
            return {
              ...r,
              balance,
              originalAmount,
              claimed: parseFloat(balance) === 0,
              keyMismatch: r.privateKeyVerified === false,
            };
          } catch {
            return {
              ...r,
              balance: '0',
              claimed: false,
              keyMismatch: r.privateKeyVerified === false,
            };
          }
        })
      );

      setPayments((prev) => {
        const existingMap = new Map(prev.map(p => [p.announcement.txHash, p]));

        enriched.forEach(p => {
          if (existingMap.has(p.announcement.txHash)) {
            const existing = existingMap.get(p.announcement.txHash)!;
            existingMap.set(p.announcement.txHash, {
              ...existing,
              balance: p.balance,
              originalAmount: existing.originalAmount || p.originalAmount,
              claimed: existing.claimed || p.claimed,
            });
          } else {
            existingMap.set(p.announcement.txHash, p);
          }
        });

        return Array.from(existingMap.values());
      });

      // Auto-claim any unclaimed payments
      const allUnclaimed = enriched.filter(p =>
        !p.claimed && !p.keyMismatch && parseFloat(p.balance || '0') > 0
      );
      if (allUnclaimed.length > 0) {
        tryAutoClaim(allUnclaimed);
      }

      if (address) {
        saveLastScannedBlock(address, latestBlock);
      }

      if (!silent) {
        setProgress({ current: results.length, total: results.length });
      }
    } catch (e) {
      console.error('[useStealthScanner] Scan error:', e);
      if (!silent) setError(e instanceof Error ? e.message : 'Scan failed');
    } finally {
      if (!silent) setIsScanning(false);
    }
  }, [stealthKeys, isConnected, address, tryAutoClaim]);

  const scanRef = useRef(scan);
  scanRef.current = scan;

  const scanInBackground = useCallback(() => {
    if (scanIntervalRef.current) return;
    // First scan is visible (full scan), subsequent ones are silent (incremental)
    scanRef.current();
    scanIntervalRef.current = setInterval(() => {
      if (!isBgScanningRef.current) {
        isBgScanningRef.current = true;
        scanRef.current(undefined, true).finally(() => { isBgScanningRef.current = false; });
      }
    }, 3000);
  }, []);

  const stopBackgroundScan = useCallback(() => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
  }, []);

  useEffect(() => () => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
  }, []);

  // Keep claimPayment for manual fallback
  const claimPayment = useCallback(async (payment: StealthPayment, recipient: string): Promise<string | null> => {
    setError(null);

    try {
      console.log('[Claim] Requesting sponsored withdrawal, type:', payment.walletType || 'eoa');

      const result = await autoClaimPayment(payment, recipient);
      if (!result) {
        throw new Error('Claim failed');
      }

      console.log('[Claim] Sponsored withdrawal complete:', result.txHash);

      setPayments(prev => prev.map(p =>
        p.announcement.txHash === payment.announcement.txHash ? { ...p, claimed: true, balance: '0' } : p
      ));

      return result.txHash;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Claim failed';
      setError(msg);
      return null;
    }
  }, []);

  return { payments, scan, scanInBackground, stopBackgroundScan, claimPayment, isScanning, progress, error };
}
