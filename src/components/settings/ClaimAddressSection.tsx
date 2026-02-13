"use client";

import { Box, Text, VStack, HStack } from "@chakra-ui/react";
import { colors, radius, shadows } from "@/lib/design/tokens";
import { getChainConfig } from "@/config/chains";
import { useAuth } from "@/contexts/AuthContext";
import type { ClaimAddress } from "@/lib/design/types";
import { WalletIcon } from "@/components/stealth/icons";

interface ClaimAddressSectionProps {
  claimAddresses: ClaimAddress[];
  claimAddressesInitialized: boolean;
}

export function ClaimAddressSection({ claimAddresses, claimAddressesInitialized }: ClaimAddressSectionProps) {
  const { activeChainId } = useAuth();
  const symbol = getChainConfig(activeChainId).nativeCurrency.symbol;
  if (!claimAddressesInitialized) return null;

  return (
    <Box p="24px" bgColor={colors.bg.card} borderRadius={radius.lg} border={`2px solid ${colors.border.default}`}>
      <VStack gap="16px" align="stretch">
        <HStack gap="10px">
          <Box w="32px" h="32px" borderRadius={radius.full} bgColor={colors.bg.input}
            display="flex" alignItems="center" justifyContent="center">
            <WalletIcon size={16} color={colors.text.muted} />
          </Box>
          <Text fontSize="15px" color={colors.text.primary} fontWeight={600}>Claim Addresses</Text>
        </HStack>

        <VStack gap="0" align="stretch">
          {claimAddresses.map((addr, idx) => (
            <HStack key={addr.address} p="14px 0" justify="space-between"
              borderBottom={idx < claimAddresses.length - 1 ? `1px solid ${colors.border.default}` : "none"}>
              <VStack align="flex-start" gap="2px">
                <Text fontSize="14px" fontWeight={500} color={colors.text.primary}>{addr.label || `Wallet ${idx + 1}`}</Text>
                <Text fontSize="11px" color={colors.text.muted} fontFamily="'JetBrains Mono', monospace">
                  {addr.address.slice(0, 14)}...{addr.address.slice(-10)}
                </Text>
              </VStack>
              <Text fontSize="14px" fontWeight={500} color={colors.accent.indigo} fontFamily="'JetBrains Mono', monospace">
                {parseFloat(addr.balance || "0").toFixed(4)} {symbol}
              </Text>
            </HStack>
          ))}
        </VStack>
      </VStack>
    </Box>
  );
}
