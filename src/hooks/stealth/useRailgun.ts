import { useState, useCallback, useRef } from 'react';
import { useAccount } from 'wagmi';
import { ethers } from 'ethers';
import { signWalletDrain, getAddressFromPrivateKey } from '@/lib/stealth';
import type { StealthPayment } from '@/lib/design/types';

const THANOS_CHAIN_ID = 111551119090;
const SPONSOR_ADDRESS = '0x8d56E94a02F06320BDc68FAfE23DEc9Ad7463496';

interface RailgunState {
  isInitialized: boolean;
  isInitializing: boolean;
  initError: string | null;
  walletID: string | null;
  railgunAddress: string | null;
  shieldedBalance: string;
  isShielding: boolean;
  shieldError: string | null;
  shieldPayments: (payments: StealthPayment[]) => Promise<string | null>;
  isUnshielding: boolean;
  unshieldError: string | null;
  unshieldProgress: number;
  unshield: (toAddress: string, amountWei: bigint) => Promise<string | null>;
  init: (walletSignature: string) => Promise<void>;
}

function getProvider() {
  if (typeof window === 'undefined' || !window.ethereum) return null;
  return new ethers.providers.Web3Provider(window.ethereum as ethers.providers.ExternalProvider);
}

export function useRailgun(): RailgunState {
  const { address } = useAccount();
  const [isInitialized, setIsInitialized] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [walletID, setWalletID] = useState<string | null>(null);
  const [railgunAddress, setRailgunAddress] = useState<string | null>(null);
  const [shieldedBalance, setShieldedBalance] = useState('0');
  const [isShielding, setIsShielding] = useState(false);
  const [shieldError, setShieldError] = useState<string | null>(null);
  const [isUnshielding, setIsUnshielding] = useState(false);
  const [unshieldError, setUnshieldError] = useState<string | null>(null);
  const [unshieldProgress, setUnshieldProgress] = useState(0);
  const shieldPrivateKeyRef = useRef<string | null>(null);

  const fetchBalance = useCallback(async (wID: string) => {
    try {
      const railgun = await import('@/lib/railgun');
      const { NETWORK_CONFIG, NetworkName } = await import('@railgun-community/shared-models');
      const wtonAddress = NETWORK_CONFIG[NetworkName.ThanosSepolia].baseToken.wrappedAddress;
      const bal = await railgun.getShieldedTokenBalance(wID, wtonAddress);
      const formatted = ethers.utils.formatEther(bal.toString());
      console.log('[Railgun] Shielded balance:', formatted, 'TON');
      setShieldedBalance(formatted);
    } catch (err) {
      console.warn('[Railgun] Balance fetch error:', err);
    }
  }, []);

  const init = useCallback(async (walletSignature: string) => {
    if (!address || isInitializing) return;
    setIsInitializing(true);
    setInitError(null);
    try {
      const railgun = await import('@/lib/railgun');
      await railgun.initRailgun();

      const walletSDK = await import('@railgun-community/wallet');
      walletSDK.setOnBalanceUpdateCallback((event: Record<string, unknown>) => {
        console.log('[Railgun] Balance update event:', event?.railgunWalletID, 'erc20s:', (event?.erc20Amounts as unknown[])?.length ?? 0);
      });

      const wallet = await railgun.createOrLoadRailgunWallet(address, walletSignature);
      setWalletID(wallet.walletID);
      setRailgunAddress(wallet.railgunAddress);

      const provider = getProvider();
      if (provider) {
        shieldPrivateKeyRef.current = await railgun.getShieldPrivateKey(provider.getSigner());
      }

      setIsInitialized(true);

      // Scan merkle tree in background (don't block init)
      console.log('[Railgun] Starting background merkle tree scan...');
      railgun.refreshShieldedBalances(wallet.walletID).then(() => {
        console.log('[Railgun] Background scan complete');
        fetchBalance(wallet.walletID);
      }).catch((err: unknown) => {
        console.warn('[Railgun] Background scan error:', err);
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Railgun init error:', err);
      setInitError(msg);
    } finally {
      setIsInitializing(false);
    }
  }, [address, isInitializing, fetchBalance]);

  // Shield stealth payments via sponsor: claim → sponsor → Railgun pool
  const shieldPayments = useCallback(async (payments: StealthPayment[]): Promise<string | null> => {
    if (!address || !railgunAddress || !shieldPrivateKeyRef.current) {
      setShieldError('Railgun not initialized');
      return null;
    }
    if (payments.length === 0) {
      setShieldError('No payments to shield');
      return null;
    }
    setIsShielding(true);
    setShieldError(null);

    try {
      const railgun = await import('@/lib/railgun');
      let lastTxHash: string | null = null;

      for (const payment of payments) {
        if (payment.claimed || payment.keyMismatch) continue;

        const balanceWei = ethers.utils.parseEther(payment.originalAmount || payment.balance || '0');
        if (balanceWei.isZero()) continue;

        // Step 1: Compute shield calldata via Railgun SDK
        const { transaction } = await railgun.populateShieldTx(
          railgunAddress,
          shieldPrivateKeyRef.current,
          BigInt(balanceWei.toString()),
        );

        console.log('[Shield] SDK transaction.to:', transaction.to);
        console.log('[Shield] SDK transaction.data selector:', transaction.data?.slice(0, 10));
        console.log('[Shield] SDK transaction.data length:', transaction.data?.length);
        console.log('[Shield] SDK transaction.value:', (transaction as Record<string, unknown>).value?.toString());

        // Step 2: Build claim + shield request for sponsor
        let body: Record<string, string>;

        if (payment.walletType === 'create2') {
          const ownerEOA = getAddressFromPrivateKey(payment.stealthPrivateKey);
          // Sign drain to SPONSOR address (not user's wallet)
          const signature = await signWalletDrain(
            payment.stealthPrivateKey,
            payment.announcement.stealthAddress,
            SPONSOR_ADDRESS,
            THANOS_CHAIN_ID,
          );
          body = {
            stealthAddress: payment.announcement.stealthAddress,
            owner: ownerEOA,
            signature,
            shieldTo: transaction.to!,
            shieldData: transaction.data!,
            shieldValue: balanceWei.toString(),
          };
        } else {
          // Legacy EOA
          body = {
            stealthAddress: payment.announcement.stealthAddress,
            stealthPrivateKey: payment.stealthPrivateKey,
            shieldTo: transaction.to!,
            shieldData: transaction.data!,
            shieldValue: balanceWei.toString(),
          };
        }

        // Step 3: Send to sponsor
        const res = await fetch('/api/sponsor-shield', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        let data;
        try {
          data = await res.json();
        } catch {
          throw new Error(`Shield request failed (${res.status})`);
        }
        if (!res.ok) throw new Error(data.error || 'Shield failed');

        console.log('[Shield] Payment shielded:', data.shieldTxHash);
        lastTxHash = data.shieldTxHash;
      }

      if (walletID) {
        console.log('[Railgun] Shield done, rescanning merkle tree...');
        await railgun.refreshShieldedBalances(walletID);
        await fetchBalance(walletID);
      }
      return lastTxHash;
    } catch (err: unknown) {
      setShieldError(err instanceof Error ? err.message : 'Shield failed');
      return null;
    } finally {
      setIsShielding(false);
    }
  }, [address, railgunAddress, walletID, fetchBalance]);

  const unshield = useCallback(async (toAddress: string, amountWei: bigint): Promise<string | null> => {
    if (!address || !walletID) {
      setUnshieldError('Railgun not initialized');
      return null;
    }
    setIsUnshielding(true);
    setUnshieldError(null);
    setUnshieldProgress(0);
    try {
      const provider = getProvider();
      if (!provider) throw new Error('No wallet provider');
      const railgun = await import('@/lib/railgun');
      const encryptionKey = railgun.getEncryptionKey(address);

      const result = await railgun.unshieldBaseToken(
        toAddress,
        walletID,
        encryptionKey,
        amountWei,
        provider.getSigner(),
        (progress) => setUnshieldProgress(progress),
      );

      await railgun.refreshShieldedBalances(walletID);
      await fetchBalance(walletID);
      return result.txHash;
    } catch (err: unknown) {
      setUnshieldError(err instanceof Error ? err.message : 'Unshield failed');
      return null;
    } finally {
      setIsUnshielding(false);
      setUnshieldProgress(0);
    }
  }, [address, walletID, fetchBalance]);

  return {
    isInitialized,
    isInitializing,
    initError,
    walletID,
    railgunAddress,
    shieldedBalance,
    isShielding,
    shieldError,
    shieldPayments,
    isUnshielding,
    unshieldError,
    unshieldProgress,
    unshield,
    init,
  };
}
