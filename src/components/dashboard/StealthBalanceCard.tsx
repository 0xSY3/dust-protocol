"use client";

import { useEffect, useRef } from "react";
import { Box, Text, VStack, HStack, Spinner } from "@chakra-ui/react";
import { colors, radius, shadows } from "@/lib/design/tokens";
import { getChainConfig } from "@/config/chains";
import { useAuth } from "@/contexts/AuthContext";
import type { StealthPayment } from "@/lib/design/types";
import { RefreshIcon, InfoIcon, ChainIcon } from "@/components/stealth/icons";

interface StealthBalanceCardProps {
  payments: StealthPayment[];
  isScanning: boolean;
  scan: () => void;
}

export function StealthBalanceCard({ payments, isScanning, scan }: StealthBalanceCardProps) {
  const { activeChainId } = useAuth();
  const chainConfig = getChainConfig(activeChainId);
  const symbol = chainConfig.nativeCurrency.symbol;
  const hasMounted = useRef(false);
  useEffect(() => {
    if (!hasMounted.current) { hasMounted.current = true; scan(); }
  }, [scan]);

  const validPayments = payments.filter(p => !p.keyMismatch);
  const totalBalance = validPayments.reduce((sum, p) => sum + parseFloat(p.originalAmount || p.balance || "0"), 0);

  return (
    <Box
      p="3px"
      borderRadius={radius.lg}
      bg="linear-gradient(135deg, #2B5AE2 0%, #4A75F0 50%, #2B5AE2 100%)"
      boxShadow={shadows.card}
    >
      <Box
        p="28px"
        bgColor={colors.bg.card}
        borderRadius="17px"
      >
        <VStack gap="24px" align="stretch">
          {/* Header */}
          <HStack justify="space-between" align="center">
            <HStack gap="8px" align="center">
              <Text fontSize="17px" fontWeight={700} color={colors.text.primary}>Your Stealth Balances</Text>
              <InfoIcon size={16} color={colors.text.muted} />
            </HStack>
            <Box
              as="button"
              p="8px"
              borderRadius={radius.full}
              cursor="pointer"
              _hover={{ bgColor: colors.bg.input }}
              onClick={() => scan()}
              transition="all 0.15s ease"
            >
              {isScanning
                ? <Spinner size="sm" color={colors.accent.indigo} />
                : <RefreshIcon size={18} color={colors.text.muted} />
              }
            </Box>
          </HStack>

          {/* Big balance */}
          <Box>
            <HStack align="baseline" gap="8px">
              <Text fontSize="42px" fontWeight={800} color={colors.text.primary} lineHeight="1" letterSpacing="-0.03em">
                {totalBalance.toFixed(4)}
              </Text>
              <Text fontSize="18px" fontWeight={500} color={colors.text.muted}>{symbol}</Text>
            </HStack>
          </Box>

          {/* Token summary */}
          {validPayments.length > 0 && (
            <Box borderTop={`1px solid ${colors.border.default}`} pt="16px">
              <HStack justify="space-between" align="center">
                <HStack gap="14px">
                  <Box
                    w="44px" h="44px"
                    borderRadius={radius.full}
                    bg="linear-gradient(135deg, rgba(42, 114, 229, 0.08) 0%, rgba(42, 114, 229, 0.15) 100%)"
                    border="1.5px solid rgba(42, 114, 229, 0.2)"
                    display="flex" alignItems="center" justifyContent="center"
                  >
                    <ChainIcon size={28} chainId={activeChainId} />
                  </Box>
                  <VStack align="flex-start" gap="2px">
                    <Text fontSize="16px" fontWeight={700} color={colors.text.primary}>{symbol}</Text>
                    <Text fontSize="13px" color={colors.text.muted}>{chainConfig.name}</Text>
                  </VStack>
                </HStack>
                <VStack align="flex-end" gap="2px">
                  <Text fontSize="17px" fontWeight={700} color={colors.text.primary}>
                    {totalBalance.toFixed(4)}
                  </Text>
                  <Text fontSize="12px" color={colors.text.muted}>
                    {validPayments.length} payment{validPayments.length !== 1 ? "s" : ""}
                  </Text>
                </VStack>
              </HStack>
            </Box>
          )}

          {/* Footer */}
          <Box
            p="12px 16px"
            bgColor="rgba(43, 90, 226, 0.04)"
            borderRadius={radius.sm}
            textAlign="center"
          >
            <Text fontSize="14px" color={colors.accent.indigo} fontWeight={600}>
              {validPayments.length === 0
                ? "No payments yet"
                : "Payments received privately through Dust"
              }
            </Text>
          </Box>
        </VStack>
      </Box>
    </Box>
  );
}
