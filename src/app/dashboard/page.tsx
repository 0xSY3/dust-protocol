"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useStealthScanner, useUnifiedBalance, useDustPool } from "@/hooks/stealth";
import { getChainConfig } from "@/config/chains";
import { UnifiedBalanceCard } from "@/components/dashboard/UnifiedBalanceCard";
import { AddressBreakdownCard } from "@/components/dashboard/AddressBreakdownCard";
import { PersonalLinkCard } from "@/components/dashboard/PersonalLinkCard";
import { RecentActivityCard } from "@/components/dashboard/RecentActivityCard";
import { PrivacyPoolCard } from "@/components/dashboard/PrivacyPoolCard";
import { V2PoolCard } from "@/components/dustpool/V2PoolCard";
import { SendModal } from "@/components/send/SendModal";
import { ReceiveModal } from "@/components/dashboard/ReceiveModal";
import { ConsolidateModal } from "@/components/dashboard/ConsolidateModal";
import { SendIcon, ArrowDownLeftIcon } from "@/components/stealth/icons";
import { loadOutgoingPayments } from '@/hooks/stealth/useStealthSend';
import { storageKey } from '@/lib/storageKey';
import { RestoringBanner } from '@/components/RestoringBanner';
import type { OutgoingPayment } from '@/lib/design/types';

function claimToPoolKey(address: string, chainId: number): string {
  return storageKey('claim2pool', address, chainId);
}

export default function DashboardPage() {
  const { stealthKeys, metaAddress, ownedNames, claimAddresses, refreshClaimBalances, claimAddressesInitialized, activeChainId, address } = useAuth();
  const chainConfig = getChainConfig(activeChainId);
  const [claimToPool, setClaimToPool] = useState(() => {
    if (typeof window === 'undefined' || !address) return false;
    return localStorage.getItem(claimToPoolKey(address, activeChainId)) === 'true';
  });
  const { payments, scan, scanInBackground, stopBackgroundScan, isScanning, depositToPool } = useStealthScanner(stealthKeys, { claimToPool, chainId: activeChainId });
  const [showSendModal, setShowSendModal] = useState(false);
  const [showReceiveModal, setShowReceiveModal] = useState(false);
  const [showConsolidateModal, setShowConsolidateModal] = useState(false);

  // Load outgoing payments
  const [outgoingPayments, setOutgoingPayments] = useState<OutgoingPayment[]>([]);
  useEffect(() => {
    if (address) {
      setOutgoingPayments(loadOutgoingPayments(address, activeChainId));
    }
  }, [address, activeChainId, showSendModal]); // Reload when send modal closes

  const dustPool = useDustPool(activeChainId);
  const [depositingToPool, setDepositingToPool] = useState(false);
  const [poolDepositProgress, setPoolDepositProgress] = useState({ done: 0, total: 0, message: '' });
  const depositingRef = useRef(false);

  const tokName = ownedNames.length > 0 ? `${ownedNames[0].name}.tok` : null;
  const payPath = ownedNames.length > 0 ? `/pay/${ownedNames[0].name}` : "";

  const unified = useUnifiedBalance({
    payments,
    claimAddresses,
    refreshClaimBalances,
    claimAddressesInitialized,
  });

  const handleRefresh = useCallback(() => {
    scan();
    refreshClaimBalances();
    dustPool.loadPoolDeposits();
  }, [scan, refreshClaimBalances, dustPool.loadPoolDeposits]);

  // Re-sync claimToPool preference when address or chain changes
  useEffect(() => {
    if (typeof window === 'undefined' || !address) return;
    setClaimToPool(localStorage.getItem(claimToPoolKey(address, activeChainId)) === 'true');
  }, [address, activeChainId]);

  // Auto-refresh: scan every 30s while dashboard is mounted
  useEffect(() => {
    if (stealthKeys) {
      scanInBackground();
      return () => stopBackgroundScan();
    }
  }, [stealthKeys, scanInBackground, stopBackgroundScan]);

  // When pool toggle turns ON, trigger a scan to pick up existing unclaimed payments
  useEffect(() => {
    if (claimToPool && stealthKeys) {
      scan();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claimToPool]);

  const hasPoolBalance = parseFloat(dustPool.poolBalance) > 0;

  // Count payments actually eligible for pool deposit (must have current balance)
  const poolEligibleCount = payments.filter(p => {
    if (p.claimed || p.keyMismatch) return false;
    if (p.walletType !== 'create2' && p.walletType !== 'account' && p.walletType !== 'eip7702') return false;
    const bal = parseFloat(p.balance || '0');
    return bal > 0.0001;
  }).length;

  const handlePoolToggle = () => {
    const next = !claimToPool;
    setClaimToPool(next);
    if (address) localStorage.setItem(claimToPoolKey(address, activeChainId), String(next));
  };

  const handleDepositAll = async () => {
    if (depositingRef.current) return;
    depositingRef.current = true;
    setDepositingToPool(true);
    setPoolDepositProgress({ done: 0, total: poolEligibleCount, message: 'Starting pool deposits...' });

    try {
      stopBackgroundScan();
      const result = await depositToPool((done, total, message) => {
        setPoolDepositProgress({ done, total, message });
      });
      dustPool.loadPoolDeposits();
      if (result.deposited > 0) {
        scan();
      }
      // Keep result message visible for a few seconds
      await new Promise(r => setTimeout(r, 3000));
    } catch (err) {
      console.error('[PoolDeposit] Unexpected error:', err);
      setPoolDepositProgress({ done: 0, total: 0, message: 'Deposit failed — check console' });
      await new Promise(r => setTimeout(r, 5000));
    } finally {
      setDepositingToPool(false);
      depositingRef.current = false;
      scanInBackground();
    }
  };

  return (
    <div className="px-3.5 py-7 md:px-6 md:py-7 max-w-[640px] mx-auto">
      <div className="flex flex-col gap-4">
        {/* Terminal header */}
        <div className="text-center mb-2">
          <h1 className="text-2xl md:text-3xl font-bold tracking-widest text-white font-mono mb-1">
            STEALTH_WALLET
          </h1>
          <p className="text-xs text-[rgba(255,255,255,0.4)] font-mono tracking-wide">
            Privacy-first asset management
          </p>
        </div>

        {/* Restoring banner — shown on new device / cleared cache while re-scanning */}
        <RestoringBanner isScanning={isScanning && payments.length === 0} />

        {/* Unified balance card */}
        <UnifiedBalanceCard
          total={unified.total}
          stealthTotal={unified.stealthTotal}
          claimTotal={unified.claimTotal}
          unclaimedCount={unified.unclaimedCount}
          isScanning={isScanning}
          isLoading={unified.isLoading}
          onRefresh={handleRefresh}
        />

        {/* Quick actions */}
        <div className="flex gap-2.5">
          <button
            onClick={() => setShowSendModal(true)}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-sm bg-[#00FF41] hover:bg-[rgba(0,255,65,0.85)] active:scale-[0.98] transition-all font-mono font-bold text-sm text-black"
          >
            <SendIcon size={17} color="#000" />
            Send
          </button>
          <button
            onClick={() => setShowReceiveModal(true)}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-sm border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.03)] hover:border-[rgba(255,255,255,0.2)] hover:bg-[rgba(255,255,255,0.05)] active:scale-[0.98] transition-all font-mono font-bold text-sm text-white"
          >
            <ArrowDownLeftIcon size={17} color="rgba(255,255,255,0.7)" />
            Receive
          </button>
        </div>

        {/* V2 Privacy Pool card */}
        <V2PoolCard chainId={activeChainId} />

        {/* V1 Privacy Pool card (Legacy) */}
        <PrivacyPoolCard
          claimToPool={claimToPool}
          onToggle={handlePoolToggle}
          poolBalance={dustPool.poolBalance}
          depositCount={dustPool.deposits.filter(d => !d.withdrawn).length}
          poolEligibleCount={poolEligibleCount}
          isDepositing={depositingToPool}
          depositProgress={poolDepositProgress}
          onWithdraw={() => setShowConsolidateModal(true)}
          onDepositAll={handleDepositAll}
          symbol={chainConfig.nativeCurrency.symbol}
        />

        {/* Address breakdown */}
        <AddressBreakdownCard
          claimAddresses={unified.claimAddresses}
          unclaimedPayments={unified.unclaimedPayments}
        />

        {/* Personal link */}
        <PersonalLinkCard ownedNames={ownedNames} metaAddress={metaAddress} />

        {/* Recent activity */}
        <RecentActivityCard payments={payments} outgoingPayments={outgoingPayments} />

        {/* Modals */}
        <SendModal isOpen={showSendModal} onClose={() => { setShowSendModal(false); scan(); }} />
        <ReceiveModal isOpen={showReceiveModal} onClose={() => setShowReceiveModal(false)} tokName={tokName} payPath={payPath} />
        <ConsolidateModal
          isOpen={showConsolidateModal}
          onClose={() => setShowConsolidateModal(false)}
          deposits={dustPool.deposits}
          poolBalance={dustPool.poolBalance}
          progress={dustPool.progress}
          onConsolidate={dustPool.consolidate}
          onReset={dustPool.resetProgress}
          isConsolidating={dustPool.isConsolidating}
        />
      </div>
    </div>
  );
}
