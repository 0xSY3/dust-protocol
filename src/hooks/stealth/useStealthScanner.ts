import { useState, useCallback, useEffect, useRef } from 'react';
import { useAccount } from 'wagmi';
import { ethers } from 'ethers';
import {
  scanAnnouncements, setLastScannedBlock as saveLastScannedBlock,
  getLastScannedBlock, getAnnouncementCount, getAddressFromPrivateKey,
  signWalletDrain, signWalletExecute, signUserOp,
  type StealthKeyPair, type ScanResult,
  DUST_POOL_ABI, STEALTH_ACCOUNT_FACTORY_ABI,
} from '@/lib/stealth';
import {
  generateDeposit,
  saveDeposits,
  loadDeposits,
  type StoredDeposit,
} from '@/lib/dustpool';
import { getChainConfig, DEFAULT_CHAIN_ID } from '@/config/chains';
import { getChainProvider, getChainBatchProvider } from '@/lib/providers';

interface StealthPayment extends ScanResult {
  balance?: string;
  originalAmount?: string;
  claimed?: boolean;
  keyMismatch?: boolean;
  autoClaiming?: boolean;
}

// localStorage keys
const PAYMENTS_STORAGE_KEY = 'stealth_payments_';

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

// StealthAccount.drain(address to) selector
const DRAIN_SELECTOR = '0xece53132';

// Auto-claim an ERC-4337 account payment via bundle API
async function autoClaimAccount(
  payment: ScanResult,
  recipient: string,
  chainId: number,
): Promise<{ txHash: string } | null> {
  try {
    const config = getChainConfig(chainId);
    const ownerEOA = getAddressFromPrivateKey(payment.stealthPrivateKey);
    const accountAddress = payment.announcement.stealthAddress;

    // Check if account is already deployed
    const provider = getChainProvider(chainId);
    const code = await provider.getCode(accountAddress);
    const isDeployed = code !== '0x';

    // Build initCode if not deployed
    let initCode = '0x';
    if (!isDeployed) {
      const iface = new ethers.utils.Interface(STEALTH_ACCOUNT_FACTORY_ABI);
      const createData = iface.encodeFunctionData('createAccount', [ownerEOA, 0]);
      initCode = ethers.utils.hexConcat([config.contracts.accountFactory, createData]);
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
        chainId,
      }),
    });
    const prepData = await prepRes.json();
    if (!prepRes.ok) {
      if (process.env.NODE_ENV === 'development') console.warn('[AutoClaim/Account] Prep failed:', prepData.error);
      return null;
    }

    // Step 2: Sign userOpHash locally (private key never leaves browser)
    const { userOp, userOpHash } = prepData;
    userOp.signature = await signUserOp(userOpHash, payment.stealthPrivateKey);

    // Step 3: Submit signed UserOp
    const submitRes = await fetch('/api/bundle/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userOp, chainId }),
    });
    const submitData = await submitRes.json();
    if (!submitRes.ok) {
      if (process.env.NODE_ENV === 'development') console.warn('[AutoClaim/Account] Submit failed:', submitData.error);
      return null;
    }

    if (process.env.NODE_ENV === 'development') console.log('[AutoClaim/Account] Success:', submitData.txHash);
    return submitData;
  } catch (e) {
    if (process.env.NODE_ENV === 'development') console.warn('[AutoClaim/Account] Error:', e);
    return null;
  }
}

// Auto-claim a single payment via sponsor-claim API (legacy CREATE2 + EOA)
async function autoClaimLegacy(
  payment: ScanResult,
  recipient: string,
  chainId: number,
): Promise<{ txHash: string; amount: string; gasFunded: string } | null> {
  try {
    let body: Record<string, string | number>;

    if (payment.walletType === 'create2') {
      const ownerEOA = getAddressFromPrivateKey(payment.stealthPrivateKey);
      const signature = await signWalletDrain(
        payment.stealthPrivateKey,
        payment.announcement.stealthAddress,
        recipient,
        chainId,
      );
      body = {
        stealthAddress: payment.announcement.stealthAddress,
        owner: ownerEOA,
        recipient,
        signature,
        chainId,
      };
    } else {
      body = {
        stealthAddress: payment.announcement.stealthAddress,
        stealthPrivateKey: payment.stealthPrivateKey,
        recipient,
        chainId,
      };
    }

    const res = await fetch('/api/sponsor-claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      if (process.env.NODE_ENV === 'development') console.warn('[AutoClaim] Failed:', data.error);
      return null;
    }
    if (process.env.NODE_ENV === 'development') console.log('[AutoClaim] Success, type:', payment.walletType);
    return data;
  } catch (e) {
    if (process.env.NODE_ENV === 'development') console.warn('[AutoClaim] Error:', e);
    return null;
  }
}

// Route claim by wallet type
async function autoClaimPayment(
  payment: ScanResult,
  recipient: string,
  chainId: number,
): Promise<{ txHash: string } | null> {
  if (payment.walletType === 'account') {
    return autoClaimAccount(payment, recipient, chainId);
  }
  return autoClaimLegacy(payment, recipient, chainId);
}

// Stealth wallet deposits DIRECTLY into DustPool (privacy-preserving).
// Each deposit comes from the unique stealth address, not the sponsor wallet.
// ERC-4337: UserOp with execute(DustPool, balance, deposit(commitment))
// CREATE2: wallet.execute(DustPool, balance, deposit(commitment), sig) via API
async function claimToPoolDeposit(
  payment: ScanResult,
  userAddress: string,
  chainId: number,
): Promise<{ txHash: string; leafIndex: number; depositData: StoredDeposit } | null> {
  try {
    const config = getChainConfig(chainId);
    const dustPoolAddress = config.contracts.dustPool;
    if (!dustPoolAddress) {
      if (process.env.NODE_ENV === 'development') console.warn('[PoolDeposit] DustPool not available on chain', chainId);
      return null;
    }

    const wt = payment.walletType;
    if (wt !== 'create2' && wt !== 'account') {
      if (process.env.NODE_ENV === 'development') console.warn('[PoolDeposit] Unsupported wallet type:', wt);
      return null;
    }

    const provider = getChainProvider(chainId);
    const balance = await provider.getBalance(payment.announcement.stealthAddress);
    if (balance.isZero()) {
      if (process.env.NODE_ENV === 'development') console.log('[PoolDeposit] Zero balance, skipping');
      return null;
    }

    // Generate deposit preimage using exact balance
    const deposit = await generateDeposit(balance.toBigInt());

    // Encode DustPool.deposit(commitment) calldata
    const poolIface = new ethers.utils.Interface(DUST_POOL_ABI);
    const depositCalldata = poolIface.encodeFunctionData('deposit', [deposit.commitmentHex]);

    let txHash: string;
    let leafIndex: number;

    if (wt === 'account') {
      // ERC-4337: Build UserOp with execute(DustPool, balance, depositCalldata)
      if (process.env.NODE_ENV === 'development') console.log('[PoolDeposit] ERC-4337 direct pool deposit...');

      const ownerEOA = getAddressFromPrivateKey(payment.stealthPrivateKey);
      const accountAddress = payment.announcement.stealthAddress;

      const code = await provider.getCode(accountAddress);
      const isDeployed = code !== '0x';

      let initCode = '0x';
      if (!isDeployed) {
        const iface = new ethers.utils.Interface(STEALTH_ACCOUNT_FACTORY_ABI);
        const createData = iface.encodeFunctionData('createAccount', [ownerEOA, 0]);
        initCode = ethers.utils.hexConcat([config.contracts.accountFactory, createData]);
      }

      const EXECUTE_SELECTOR = '0xb61d27f6';
      const callData = ethers.utils.hexConcat([
        EXECUTE_SELECTOR,
        ethers.utils.defaultAbiCoder.encode(
          ['address', 'uint256', 'bytes'],
          [dustPoolAddress, balance, depositCalldata]
        ),
      ]);

      const prepRes = await fetch('/api/bundle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sender: accountAddress, initCode, callData, chainId }),
      });
      const prepData = await prepRes.json();
      if (!prepRes.ok) {
        if (process.env.NODE_ENV === 'development') console.warn('[PoolDeposit] Bundle prep failed:', prepData.error);
        return null;
      }

      const { userOp, userOpHash } = prepData;
      userOp.signature = await signUserOp(userOpHash, payment.stealthPrivateKey);

      const submitRes = await fetch('/api/bundle/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userOp, chainId }),
      });
      const submitData = await submitRes.json();
      if (!submitRes.ok) {
        if (process.env.NODE_ENV === 'development') console.warn('[PoolDeposit] Bundle submit failed:', submitData.error);
        return null;
      }

      txHash = submitData.txHash;

      const receipt = await provider.getTransactionReceipt(txHash);
      const poolContract = new ethers.Contract(dustPoolAddress, DUST_POOL_ABI, provider);
      const depositEvent = receipt.logs.find((log: ethers.providers.Log) => {
        try { return poolContract.interface.parseLog(log).name === 'Deposit'; }
        catch { return false; }
      });
      leafIndex = depositEvent
        ? poolContract.interface.parseLog(depositEvent).args.leafIndex.toNumber()
        : 0;

    } else {
      // CREATE2: sign execute(DustPool, balance, depositCalldata) → API relays
      if (process.env.NODE_ENV === 'development') console.log('[PoolDeposit] CREATE2 direct pool deposit...');

      const ownerEOA = getAddressFromPrivateKey(payment.stealthPrivateKey);
      const signature = await signWalletExecute(
        payment.stealthPrivateKey,
        payment.announcement.stealthAddress,
        dustPoolAddress,
        balance,
        depositCalldata,
        chainId,
      );

      const res = await fetch('/api/pool-deposit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stealthAddress: payment.announcement.stealthAddress,
          owner: ownerEOA,
          signature,
          commitment: deposit.commitmentHex,
          walletType: 'create2',
          chainId,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        if (process.env.NODE_ENV === 'development') console.warn('[PoolDeposit] Failed:', data.error);
        return null;
      }
      txHash = data.txHash;
      leafIndex = data.leafIndex;
    }

    const storedDeposit: StoredDeposit = {
      nullifier: deposit.nullifier.toString(),
      secret: deposit.secret.toString(),
      amount: deposit.amount.toString(),
      commitment: deposit.commitmentHex,
      nullifierHash: '0x' + deposit.nullifierHash.toString(16).padStart(64, '0'),
      leafIndex,
      txHash,
      timestamp: Date.now(),
      withdrawn: false,
    };

    const existing = loadDeposits(userAddress);
    existing.push(storedDeposit);
    saveDeposits(userAddress, existing);

    if (process.env.NODE_ENV === 'development') console.log('[PoolDeposit] Success, leafIndex:', leafIndex);

    return { txHash, leafIndex, depositData: storedDeposit };
  } catch (e) {
    if (process.env.NODE_ENV === 'development') console.warn('[PoolDeposit] Error:', e);
    return null;
  }
}

interface UseStealthScannerOptions {
  autoClaimRecipient?: string;
  claimToPool?: boolean;
  chainId?: number;
}

export function useStealthScanner(stealthKeys: StealthKeyPair | null, options?: UseStealthScannerOptions) {
  const chainId = options?.chainId ?? DEFAULT_CHAIN_ID;
  const { address, isConnected } = useAccount();
  const [payments, setPayments] = useState<StealthPayment[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const scanIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const autoClaimingRef = useRef<Set<string>>(new Set());
  const autoClaimCooldownRef = useRef<Map<string, number>>(new Map());
  // Private keys stored in ref (NOT in React state) to avoid DevTools exposure
  const privateKeysRef = useRef<Map<string, string>>(new Map());

  const autoClaimRecipientRef = useRef(options?.autoClaimRecipient);
  autoClaimRecipientRef.current = options?.autoClaimRecipient;

  const claimToPoolRef = useRef(options?.claimToPool ?? false);
  claimToPoolRef.current = options?.claimToPool ?? false;

  // Helper: strip private key from payment before putting in state
  function stripKey(p: StealthPayment): StealthPayment {
    const { stealthPrivateKey: _key, ...rest } = p;
    return { ...rest, stealthPrivateKey: '' } as StealthPayment;
  }

  // Helper: get private key for a payment (from ref, fallback to storage)
  function getKeyForPayment(txHash: string): string {
    return privateKeysRef.current.get(txHash) || '';
  }

  // Load persisted payments on mount / address change
  useEffect(() => {
    if (address) {
      const stored = loadPaymentsFromStorage(address);
      if (stored.length > 0) {
        // Extract keys to ref, strip from state
        stored.forEach(p => {
          if (p.stealthPrivateKey) {
            privateKeysRef.current.set(p.announcement.txHash, p.stealthPrivateKey);
          }
        });
        setPayments(stored.map(stripKey));
      }
    }
  }, [address]);

  // Persist payments whenever they change — re-inject keys for storage only
  useEffect(() => {
    if (address && payments.length > 0) {
      const withKeys = payments.map(p => ({
        ...p,
        stealthPrivateKey: getKeyForPayment(p.announcement.txHash),
      }));
      savePaymentsToStorage(address, withKeys);
    }
  }, [address, payments]);

  // Auto-claim: when new unclaimed payments appear and we have a recipient or pool mode
  const tryAutoClaim = useCallback(async (newPayments: StealthPayment[]) => {
    const recipient = autoClaimRecipientRef.current;
    const poolMode = claimToPoolRef.current;
    // Need either a claim recipient for direct claim, or pool mode enabled
    if (!recipient && !poolMode) return;

    const now = Date.now();
    const claimable = newPayments.filter(p => {
      const txHash = p.announcement.txHash;
      if (p.claimed || p.keyMismatch || parseFloat(p.balance || '0') <= 0) return false;
      if (autoClaimingRef.current.has(txHash)) return false;
      // Pool-eligible payments are NOT auto-claimed — user deposits manually via dashboard button
      if (poolMode && (p.walletType === 'create2' || p.walletType === 'account')) return false;
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

      // Inject private key from ref for claiming
      const key = getKeyForPayment(txHash);
      if (!key) {
        autoClaimingRef.current.delete(txHash);
        setPayments(prev => prev.map(p =>
          p.announcement.txHash === txHash ? { ...p, autoClaiming: false, keyMismatch: true } : p
        ));
        continue;
      }
      const paymentWithKey = { ...payment, stealthPrivateKey: key };

      // Verify key is valid (for CREATE2, key derives the owner not the wallet address)
      try {
        getAddressFromPrivateKey(key);
      } catch {
        autoClaimingRef.current.delete(txHash);
        setPayments(prev => prev.map(p =>
          p.announcement.txHash === txHash ? { ...p, autoClaiming: false, keyMismatch: true } : p
        ));
        continue;
      }

      let claimResult: { txHash: string } | null;

      if (recipient) {
        // Direct claim to recipient
        claimResult = await autoClaimPayment(paymentWithKey, recipient, chainId);
      } else {
        // No recipient — skip
        autoClaimingRef.current.delete(txHash);
        setPayments(prev => prev.map(p =>
          p.announcement.txHash === txHash ? { ...p, autoClaiming: false } : p
        ));
        continue;
      }

      if (claimResult) {
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
  }, [address]);

  const isBgScanningRef = useRef(false);

  const scan = useCallback(async (fromBlock?: number, silent = false) => {
    if (!stealthKeys || !isConnected) {
      if (!silent) setError('No stealth keys or wallet not connected');
      return;
    }

    const config = getChainConfig(chainId);
    // Use direct RPC provider for event scanning — more reliable than MetaMask
    const provider = getChainProvider(chainId);
    // Use batch provider for balance queries — batches 2N calls into fewer HTTP requests
    const batchProvider = getChainBatchProvider(chainId);

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
        // Key includes chainId so scans are per-chain
        startBlock = getLastScannedBlock(`${chainId}:${address}`) ?? config.deploymentBlock;
      } else {
        // Full scan (manual trigger): always from deployment
        startBlock = config.deploymentBlock;
      }

      const latestBlock = await provider.getBlockNumber();

      // Skip if we're already up to date (background scan optimization)
      if (silent && startBlock >= latestBlock) return;

      if (process.env.NODE_ENV === 'development') console.log(`[Scanner] from=${startBlock}, latest=${latestBlock}`);

      if (!silent) {
        const total = await getAnnouncementCount(provider, startBlock, latestBlock, config.contracts.announcer);
        setProgress({ current: 0, total });
      }

      const results = await scanAnnouncements(provider, stealthKeys, startBlock, latestBlock, config.contracts.announcer, chainId);

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

      // Store keys in ref, strip from state
      enriched.forEach(p => {
        if (p.stealthPrivateKey) {
          privateKeysRef.current.set(p.announcement.txHash, p.stealthPrivateKey);
        }
      });

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
            existingMap.set(p.announcement.txHash, stripKey(p));
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
        saveLastScannedBlock(`${chainId}:${address}`, latestBlock);
      }

      if (!silent) {
        setProgress({ current: results.length, total: results.length });
      }
    } catch (e) {
      if (process.env.NODE_ENV === 'development') console.error('[Scanner] Scan error:', e);
      if (!silent) setError(e instanceof Error ? e.message : 'Scan failed');
    } finally {
      if (!silent) setIsScanning(false);
    }
  }, [stealthKeys, isConnected, address, chainId, tryAutoClaim]);

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
      // Inject key from ref
      const key = getKeyForPayment(payment.announcement.txHash);
      if (!key) {
        throw new Error('Private key not found for this payment');
      }
      const paymentWithKey = { ...payment, stealthPrivateKey: key };

      const result = await autoClaimPayment(paymentWithKey, recipient, chainId);
      if (!result) {
        throw new Error('Claim failed');
      }

      setPayments(prev => prev.map(p =>
        p.announcement.txHash === payment.announcement.txHash ? { ...p, claimed: true, balance: '0' } : p
      ));

      return result.txHash;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Claim failed';
      setError(msg);
      return null;
    }
  }, [chainId]);

  // Directly deposit unclaimed payments to pool with progress reporting
  // Handles both normal deposits (drain + pool) and recovery (already drained, just pool deposit)
  const depositToPool = useCallback(async (
    onProgress: (done: number, total: number, message: string) => void
  ): Promise<{ deposited: number; skipped: number; failed: number }> => {
    if (!address) return { deposited: 0, skipped: 0, failed: 0 };

    // Include payments with balance > 0 (normal) OR near-zero balance with original amount (recovery)
    const candidates = payments.filter(p => {
      if (p.claimed || p.keyMismatch) return false;
      const bal = parseFloat(p.balance || '0');
      const orig = parseFloat(p.originalAmount || '0');
      return bal > 0.0001 || orig > 0.001;
    });

    const total = candidates.length;
    let deposited = 0;
    let skipped = 0;
    let failed = 0;

    if (total === 0) {
      onProgress(0, 0, 'No payments found for pool deposit');
      return { deposited: 0, skipped: 0, failed: 0 };
    }

    onProgress(0, total, `Preparing ${total} payments for pool deposit...`);

    for (let i = 0; i < candidates.length; i++) {
      const payment = candidates[i];
      const key = getKeyForPayment(payment.announcement.txHash);

      if (!key) {
        skipped++;
        onProgress(deposited, total, `Skipped ${i + 1}/${total} (no key)`);
        continue;
      }

      if (payment.walletType !== 'create2' && payment.walletType !== 'account') {
        skipped++;
        onProgress(deposited, total, `Skipped ${i + 1}/${total} (${payment.walletType} type)`);
        continue;
      }

      const currentBal = parseFloat(payment.balance || '0');
      const originalAmt = parseFloat(payment.originalAmount || '0');
      // Recovery: balance is near-zero but original was significant (drained but pool deposit failed)
      const isRecovery = currentBal < originalAmt * 0.1 && originalAmt > 0.001;

      if (isRecovery) {
        // Recovery: balance is near-zero but original was significant
        // These were previously drained to sponsor — skip (already lost privacy)
        skipped++;
        onProgress(deposited, total, `Skipped ${i + 1}/${total} (already drained)`);
        continue;
      }

      // Normal path: drain stealth wallet then deposit to pool
      const paymentWithKey = { ...payment, stealthPrivateKey: key };
      const amt = currentBal.toFixed(4);
      const symbol = getChainConfig(chainId).nativeCurrency.symbol;
      onProgress(deposited, total, `Depositing ${i + 1}/${total} (${amt} ${symbol})...`);

      const result = await claimToPoolDeposit(paymentWithKey, address, chainId);

      if (result) {
        deposited++;
        setPayments(prev => prev.map(p =>
          p.announcement.txHash === payment.announcement.txHash
            ? { ...p, claimed: true, balance: '0' }
            : p
        ));
        onProgress(deposited, total, `Deposited ${deposited}/${total}`);
      } else {
        failed++;
        onProgress(deposited, total, `Failed ${i + 1}/${total}, continuing...`);
      }
    }

    const msg = deposited > 0
      ? `Done! ${deposited} deposited${failed > 0 ? `, ${failed} failed` : ''}${skipped > 0 ? `, ${skipped} skipped` : ''}`
      : `No deposits completed (${failed} failed, ${skipped} skipped)`;
    onProgress(deposited, total, msg);

    return { deposited, skipped, failed };
  }, [address, payments, chainId]);

  return { payments, scan, scanInBackground, stopBackgroundScan, claimPayment, depositToPool, isScanning, progress, error };
}
