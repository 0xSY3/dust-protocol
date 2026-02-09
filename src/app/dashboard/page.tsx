"use client";

import { useState, useEffect, useCallback } from "react";
import { Box, Text, VStack, HStack } from "@chakra-ui/react";
import { useAuth } from "@/contexts/AuthContext";
import { useStealthScanner, useRailgun } from "@/hooks/stealth";
import { colors, radius } from "@/lib/design/tokens";
import { StealthBalanceCard } from "@/components/dashboard/StealthBalanceCard";
import { ShieldedBalanceCard } from "@/components/dashboard/ShieldedBalanceCard";
import { PersonalLinkCard } from "@/components/dashboard/PersonalLinkCard";
import { RecentActivityCard } from "@/components/dashboard/RecentActivityCard";
import { SendModal } from "@/components/send/SendModal";
import { SendIcon, ArrowDownLeftIcon } from "@/components/stealth/icons";
import { signMessage } from "@/lib/providers";

export default function DashboardPage() {
  const { stealthKeys, metaAddress, ownedNames } = useAuth();
  const { payments, scan, scanInBackground, stopBackgroundScan, isScanning } = useStealthScanner(stealthKeys);
  const railgun = useRailgun();
  const [showSendModal, setShowSendModal] = useState(false);

  const handleInitRailgun = useCallback(async () => {
    const sig = await signMessage("Activate Dust Privacy Pool");
    await railgun.init(sig);
  }, [railgun.init]);

  // Auto-refresh: scan every 30s while dashboard is mounted
  useEffect(() => {
    if (stealthKeys) {
      scanInBackground();
      return () => stopBackgroundScan();
    }
  }, [stealthKeys, scanInBackground, stopBackgroundScan]);

  return (
    <Box p={{ base: "20px 16px", md: "40px" }} maxW="780px" mx="auto">
      <VStack gap="28px" align="stretch">
        {/* Page heading */}
        <Text fontSize="28px" fontWeight={800} color={colors.text.primary} textAlign="center" letterSpacing="-0.02em">
          Dashboard
        </Text>

        {/* Balance card */}
        <StealthBalanceCard payments={payments} isScanning={isScanning} scan={scan} />

        {/* Privacy Pool */}
        <ShieldedBalanceCard
          isInitialized={railgun.isInitialized}
          isInitializing={railgun.isInitializing}
          initError={railgun.initError}
          shieldedBalance={railgun.shieldedBalance}
          isShielding={railgun.isShielding}
          shieldError={railgun.shieldError}
          isUnshielding={railgun.isUnshielding}
          unshieldError={railgun.unshieldError}
          unshieldProgress={railgun.unshieldProgress}
          payments={payments}
          onInit={handleInitRailgun}
          onShieldPayments={railgun.shieldPayments}
          onUnshield={railgun.unshield}
        />

        {/* Quick actions */}
        <HStack gap="12px">
          <Box
            as="button"
            flex={1}
            p="16px"
            bgColor={colors.accent.indigo}
            borderRadius={radius.lg}
            cursor="pointer"
            _hover={{ opacity: 0.9 }}
            transition="all 0.15s ease"
            onClick={() => setShowSendModal(true)}
            display="flex" alignItems="center" justifyContent="center" gap="10px"
          >
            <SendIcon size={20} color="#fff" />
            <Text fontSize="16px" fontWeight={700} color="#fff">Send</Text>
          </Box>
          <Box
            as="button"
            flex={1}
            p="16px"
            bgColor={colors.bg.card}
            borderRadius={radius.lg}
            border={`2px solid ${colors.border.default}`}
            cursor="pointer"
            _hover={{ borderColor: colors.accent.indigo }}
            transition="all 0.15s ease"
            onClick={() => scan()}
            display="flex" alignItems="center" justifyContent="center" gap="10px"
          >
            <ArrowDownLeftIcon size={20} color={colors.accent.indigo} />
            <Text fontSize="16px" fontWeight={700} color={colors.text.primary}>Receive</Text>
          </Box>
        </HStack>

        {/* Personal link */}
        <PersonalLinkCard ownedNames={ownedNames} metaAddress={metaAddress} />

        {/* Activity section heading */}
        <RecentActivityCard payments={payments} />

        {/* Send Modal */}
        <SendModal isOpen={showSendModal} onClose={() => { setShowSendModal(false); scan(); }} />
      </VStack>
    </Box>
  );
}
