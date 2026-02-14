"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Box, Text, VStack, HStack } from "@chakra-ui/react";
import { useAuth } from "@/contexts/AuthContext";
import { useStealthScanner, useUnifiedBalance, useDustPool } from "@/hooks/stealth";
import { colors, radius, glass, buttonVariants, transitions } from "@/lib/design/tokens";
import { getChainConfig } from "@/config/chains";
import { UnifiedBalanceCard } from "@/components/dashboard/UnifiedBalanceCard";
import { AddressBreakdownCard } from "@/components/dashboard/AddressBreakdownCard";
import { PersonalLinkCard } from "@/components/dashboard/PersonalLinkCard";
import { RecentActivityCard } from "@/components/dashboard/RecentActivityCard";
import { SendModal } from "@/components/send/SendModal";
import { ReceiveModal } from "@/components/dashboard/ReceiveModal";
import { ConsolidateModal } from "@/components/dashboard/ConsolidateModal";
import { SendIcon, ArrowDownLeftIcon, ShieldIcon } from "@/components/stealth/icons";

export default function DashboardPage() {
  const { stealthKeys, metaAddress, ownedNames, claimAddresses, refreshClaimBalances, claimAddressesInitialized, activeChainId } = useAuth();
  const chainConfig = getChainConfig(activeChainId);
  const [claimToPool, setClaimToPool] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('dust_claim_to_pool') === 'true';
  });
  const { payments, scan, scanInBackground, stopBackgroundScan, isScanning, depositToPool } = useStealthScanner(stealthKeys, { claimToPool, chainId: activeChainId });
  const [showSendModal, setShowSendModal] = useState(false);
  const [showReceiveModal, setShowReceiveModal] = useState(false);
  const [showConsolidateModal, setShowConsolidateModal] = useState(false);

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

  // Count payments actually eligible for pool deposit (create2/account with meaningful original amount)
  const poolEligibleCount = payments.filter(p => {
    if (p.claimed || p.keyMismatch) return false;
    if (p.walletType !== 'create2' && p.walletType !== 'account') return false;
    const bal = parseFloat(p.balance || '0');
    const orig = parseFloat(p.originalAmount || '0');
    return bal > 0.0001 || orig > 0.001;
  }).length;

  return (
    <Box p={{ base: "16px 14px", md: "28px 24px" }} maxW="640px" mx="auto">
      <VStack gap="18px" align="stretch">
        {/* Page heading */}
        <Text fontSize="22px" fontWeight={800} color={colors.text.primary} textAlign="center" letterSpacing="-0.02em">
          Dashboard
        </Text>

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

        {/* Privacy Pool section */}
        <Box
          p="16px"
          bg={glass.card.bg}
          borderRadius={radius.lg}
          border={`1.5px solid ${claimToPool || hasPoolBalance ? colors.accent.indigo : colors.border.default}`}
          backdropFilter={glass.card.backdropFilter}
        >
          <VStack gap="12px" align="stretch">
            {/* Toggle */}
            <HStack justifyContent="space-between" alignItems="center">
              <HStack gap="10px">
                <Box color={colors.accent.indigo} opacity={0.7}>
                  <ShieldIcon size={18} />
                </Box>
                <Box>
                  <Text fontSize="13px" fontWeight={700} color={colors.text.primary}>
                    Privacy Pool
                  </Text>
                  <Text fontSize="11px" color={colors.text.muted}>
                    {claimToPool ? "New payments held for manual pool deposit" : "Off — payments claimed directly"}
                  </Text>
                </Box>
              </HStack>
              <Box
                as="button"
                w="44px"
                h="24px"
                borderRadius={radius.full}
                bg={claimToPool ? colors.accent.indigo : colors.bg.elevated}
                position="relative"
                cursor="pointer"
                transition="all 0.2s ease"
                onClick={() => {
                  const next = !claimToPool;
                  setClaimToPool(next);
                  localStorage.setItem('dust_claim_to_pool', String(next));
                }}
              >
                <Box
                  w="18px"
                  h="18px"
                  borderRadius="50%"
                  bg="#fff"
                  position="absolute"
                  top="3px"
                  left={claimToPool ? "23px" : "3px"}
                  transition="all 0.2s ease"
                  boxShadow="0 1px 3px rgba(0,0,0,0.2)"
                />
              </Box>
            </HStack>

            {/* Pool balance (when deposits exist) */}
            {hasPoolBalance && (
              <>
                <Box h="1px" bg={colors.border.default} />
                <HStack justifyContent="space-between" alignItems="center">
                  <Box>
                    <Text fontSize="20px" fontWeight={800} color={colors.text.primary}>
                      {parseFloat(dustPool.poolBalance).toFixed(4)} {chainConfig.nativeCurrency.symbol}
                    </Text>
                    <Text fontSize="11px" color={colors.text.muted}>
                      {dustPool.deposits.filter(d => !d.withdrawn).length} deposits ready to withdraw
                    </Text>
                  </Box>
                  <Box
                    as="button"
                    px="14px"
                    py="8px"
                    bg={buttonVariants.primary.bg}
                    boxShadow={buttonVariants.primary.boxShadow}
                    borderRadius={radius.sm}
                    cursor="pointer"
                    _hover={{ boxShadow: buttonVariants.primary.hover.boxShadow, transform: buttonVariants.primary.hover.transform }}
                    transition={transitions.fast}
                    onClick={() => setShowConsolidateModal(true)}
                  >
                    <Text fontSize="12px" fontWeight={700} color="#fff">Withdraw</Text>
                  </Box>
                </HStack>
              </>
            )}

            {/* Deposit to Pool button (when toggle ON + unclaimed payments exist) */}
            {/* Deposit / Recovery section */}
            {(depositingToPool || (claimToPool && poolEligibleCount > 0)) && (
              <>
                <Box h="1px" bg={colors.border.default} />
                {depositingToPool ? (
                  <Box textAlign="center" py="8px">
                    <Text fontSize="13px" fontWeight={600} color={colors.accent.indigo}>
                      {poolDepositProgress.message || 'Depositing...'}
                    </Text>
                    {poolDepositProgress.total > 0 && poolDepositProgress.done < poolDepositProgress.total && (
                      <Box mt="6px" h="4px" bg={colors.bg.elevated} borderRadius="2px" overflow="hidden">
                        <Box
                          h="100%"
                          bg={colors.accent.indigo}
                          borderRadius="2px"
                          w={`${Math.max(5, ((poolDepositProgress.done) / poolDepositProgress.total) * 100)}%`}
                          transition="width 0.5s ease"
                        />
                      </Box>
                    )}
                  </Box>
                ) : (
                  <Box
                    as="button"
                    w="100%"
                    py="10px"
                    bg="rgba(43,90,226,0.08)"
                    border={`1.5px solid ${colors.accent.indigo}`}
                    borderRadius={radius.sm}
                    cursor="pointer"
                    _hover={{ bg: "rgba(43,90,226,0.15)" }}
                    transition={transitions.fast}
                    onClick={async () => {
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
                      } finally {
                        setDepositingToPool(false);
                        depositingRef.current = false;
                        scanInBackground();
                      }
                    }}
                  >
                    <Text fontSize="13px" fontWeight={700} color={colors.accent.indigo} textAlign="center">
                      Deposit {poolEligibleCount} payment{poolEligibleCount !== 1 ? 's' : ''} to Pool
                    </Text>
                  </Box>
                )}
              </>
            )}
            {/* Info when toggle ON but no eligible payments */}
            {claimToPool && poolEligibleCount === 0 && !hasPoolBalance && !depositingToPool && (
              <>
                <Box h="1px" bg={colors.border.default} />
                <Text fontSize="11px" color={colors.text.muted} textAlign="center" py="4px">
                  No eligible payments — EOA types can&apos;t use pool. New payments will appear here for deposit.
                </Text>
              </>
            )}
          </VStack>
        </Box>

        {/* Address breakdown */}
        <AddressBreakdownCard
          claimAddresses={unified.claimAddresses}
          unclaimedPayments={unified.unclaimedPayments}
        />

        {/* Quick actions */}
        <HStack gap="10px">
          <Box
            as="button"
            flex={1}
            p="12px"
            bg={buttonVariants.primary.bg}
            boxShadow={buttonVariants.primary.boxShadow}
            borderRadius={radius.lg}
            cursor="pointer"
            _hover={{ boxShadow: buttonVariants.primary.hover.boxShadow, transform: buttonVariants.primary.hover.transform }}
            _active={{ transform: buttonVariants.primary.active.transform }}
            transition={transitions.fast}
            onClick={() => setShowSendModal(true)}
            display="flex" alignItems="center" justifyContent="center" gap="8px"
          >
            <SendIcon size={17} color="#fff" />
            <Text fontSize="14px" fontWeight={700} color="#fff">Send</Text>
          </Box>
          <Box
            as="button"
            flex={1}
            p="12px"
            bg={buttonVariants.secondary.bg}
            borderRadius={radius.lg}
            border={buttonVariants.secondary.border}
            cursor="pointer"
            _hover={{ bg: buttonVariants.secondary.hover.bg, borderColor: buttonVariants.secondary.hover.borderColor }}
            transition={transitions.fast}
            onClick={() => setShowReceiveModal(true)}
            display="flex" alignItems="center" justifyContent="center" gap="8px"
          >
            <ArrowDownLeftIcon size={17} color={colors.accent.indigo} />
            <Text fontSize="14px" fontWeight={700} color={colors.text.primary}>Receive</Text>
          </Box>
        </HStack>

        {/* Personal link */}
        <PersonalLinkCard ownedNames={ownedNames} metaAddress={metaAddress} />

        {/* Activity section heading */}
        <RecentActivityCard payments={payments} />

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
      </VStack>
    </Box>
  );
}
