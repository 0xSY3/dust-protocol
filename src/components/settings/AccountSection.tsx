"use client";

import { Box, Text, VStack, HStack } from "@chakra-ui/react";
import { colors, radius, shadows } from "@/lib/design/tokens";
import type { OwnedName } from "@/lib/design/types";
import { UserIcon, CheckCircleIcon } from "@/components/stealth/icons";
import { getChainConfig, DEFAULT_CHAIN_ID } from "@/config/chains";

interface AccountSectionProps {
  address: string | undefined;
  ownedNames: OwnedName[];
  isRegistered: boolean;
}

export function AccountSection({ address, ownedNames, isRegistered }: AccountSectionProps) {
  return (
    <Box p="24px" bgColor={colors.bg.card} borderRadius={radius.lg} border={`2px solid ${colors.border.default}`}>
      <VStack gap="16px" align="stretch">
        <HStack gap="10px">
          <Box w="32px" h="32px" borderRadius={radius.full} bgColor={colors.bg.input}
            display="flex" alignItems="center" justifyContent="center">
            <UserIcon size={16} color={colors.text.muted} />
          </Box>
          <Text fontSize="15px" color={colors.text.primary} fontWeight={600}>Account</Text>
        </HStack>

        <VStack gap="0" align="stretch">
          {ownedNames.length > 0 && (
            <HStack justify="space-between" p="14px 0" borderBottom={`1px solid ${colors.border.default}`}>
              <Text fontSize="13px" color={colors.text.muted}>Username</Text>
              <Text fontSize="14px" fontWeight={600} color={colors.accent.indigo}>{ownedNames[0].fullName}</Text>
            </HStack>
          )}
          {address && (
            <HStack justify="space-between" p="14px 0" borderBottom={`1px solid ${colors.border.default}`}>
              <Text fontSize="13px" color={colors.text.muted}>Wallet</Text>
              <Text fontSize="12px" color={colors.text.tertiary} fontFamily="'JetBrains Mono', monospace">
                {address.slice(0, 10)}...{address.slice(-8)}
              </Text>
            </HStack>
          )}
          <HStack justify="space-between" p="14px 0" borderBottom={`1px solid ${colors.border.default}`}>
            <Text fontSize="13px" color={colors.text.muted}>Network</Text>
            <Text fontSize="13px" color={colors.text.secondary}>{getChainConfig(DEFAULT_CHAIN_ID).name}</Text>
          </HStack>
          <HStack justify="space-between" p="14px 0">
            <Text fontSize="13px" color={colors.text.muted}>On-chain</Text>
            <HStack gap="6px">
              {isRegistered && <CheckCircleIcon size={14} color={colors.accent.indigo} />}
              <Text fontSize="13px" color={isRegistered ? colors.accent.indigo : colors.text.muted}>
                {isRegistered ? "Registered" : "Not registered"}
              </Text>
            </HStack>
          </HStack>
        </VStack>
      </VStack>
    </Box>
  );
}
