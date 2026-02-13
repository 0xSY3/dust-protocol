import { useState, useEffect, useRef, useCallback } from 'react';
import { ethers } from 'ethers';
import { getChainProvider } from '@/lib/providers';

const POLL_INTERVAL_MS = 3000;

interface BalancePollerResult {
  balance: string;
  hasDeposit: boolean;
  depositAmount: string;
  isPolling: boolean;
}

export function useBalancePoller(address: string | null, chainId?: number): BalancePollerResult {
  const [balance, setBalance] = useState('0');
  const [hasDeposit, setHasDeposit] = useState(false);
  const [depositAmount, setDepositAmount] = useState('0');
  const [isPolling, setIsPolling] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stoppedRef = useRef(false);

  const stopPolling = useCallback(() => {
    stoppedRef.current = true;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setIsPolling(false);
  }, []);

  useEffect(() => {
    if (!address || !ethers.utils.isAddress(address)) return;

    stoppedRef.current = false;
    setIsPolling(true);
    setHasDeposit(false);
    setBalance('0');
    setDepositAmount('0');

    const provider = getChainProvider(chainId);

    const poll = async () => {
      if (stoppedRef.current) return;
      try {
        const bal = await provider.getBalance(address);
        if (stoppedRef.current) return; // unmounted during await
        const formatted = ethers.utils.formatEther(bal);
        setBalance(formatted);

        if (bal.gt(0)) {
          setHasDeposit(true);
          setDepositAmount(formatted);
          stopPolling();
        }
      } catch (err) {
        if (!stoppedRef.current) {
          console.warn('[useBalancePoller] RPC error:', err);
        }
      }
    };

    // Initial poll immediately
    poll();
    timerRef.current = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      stopPolling();
    };
  }, [address, chainId, stopPolling]);

  return { balance, hasDeposit, depositAmount, isPolling };
}
