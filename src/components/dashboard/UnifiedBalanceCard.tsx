"use client";

import { Box, Text, VStack, HStack, Spinner } from "@chakra-ui/react";
import { colors, radius, shadows } from "@/lib/design/tokens";
import { getChainConfig } from "@/config/chains";
import { useAuth } from "@/contexts/AuthContext";
import { RefreshIcon, ChainIcon } from "@/components/stealth/icons";

interface UnifiedBalanceCardProps {
  total: number;
  stealthTotal: number;
  claimTotal: number;
  unclaimedCount: number;
  isScanning: boolean;
  isLoading: boolean;
  onRefresh: () => void;
}

export function UnifiedBalanceCard({
  total,
  stealthTotal,
  claimTotal,
  unclaimedCount,
  isScanning,
  isLoading,
  onRefresh,
}: UnifiedBalanceCardProps) {
  const { activeChainId } = useAuth();
  const chainConfig = getChainConfig(activeChainId);
  const symbol = chainConfig.nativeCurrency.symbol;
  const loading = isScanning || isLoading;
  const hasBalance = total > 0;
  const stealthPct = hasBalance ? (stealthTotal / total) * 100 : 0;
  const claimPct = hasBalance ? (claimTotal / total) * 100 : 0;

  return (
    <Box
      p="3px"
      borderRadius="20px"
      bg="linear-gradient(135deg, #2B5AE2 0%, #4A75F0 50%, #2B5AE2 100%)"
      boxShadow={shadows.card}
    >
      <Box p="20px" bgColor={colors.bg.card} borderRadius="17px">
        <VStack gap="16px" align="stretch">
          {/* Header */}
          <HStack justify="space-between" align="center">
            <Text fontSize="14px" fontWeight={700} color={colors.text.primary}>
              Total Balance
            </Text>
            <Box
              as="button"
              p="6px"
              borderRadius={radius.full}
              cursor="pointer"
              _hover={{ bgColor: colors.bg.input }}
              onClick={onRefresh}
              transition="all 0.15s ease"
            >
              {loading
                ? <Spinner size="xs" color={colors.accent.indigo} />
                : <RefreshIcon size={14} color={colors.text.muted} />
              }
            </Box>
          </HStack>

          {/* Big balance */}
          <HStack align="baseline" gap="6px">
            <Text
              fontSize="32px"
              fontWeight={800}
              color={colors.text.primary}
              lineHeight="1"
              letterSpacing="-0.03em"
            >
              {total.toFixed(4)}
            </Text>
            <Text fontSize="14px" fontWeight={500} color={colors.text.muted}>{symbol}</Text>
          </HStack>

          {/* Breakdown bar + labels */}
          {hasBalance && (
            <VStack gap="6px" align="stretch">
              {/* Segmented bar */}
              <Box
                h="6px"
                borderRadius={radius.full}
                bg={colors.bg.input}
                overflow="hidden"
                display="flex"
              >
                {stealthPct > 0 && (
                  <Box
                    h="100%"
                    w={`${stealthPct}%`}
                    bg={colors.accent.indigo}
                    transition="width 0.3s ease"
                  />
                )}
                {claimPct > 0 && (
                  <Box
                    h="100%"
                    w={`${claimPct}%`}
                    bg={colors.accent.indigoBright}
                    transition="width 0.3s ease"
                  />
                )}
              </Box>

              {/* Legend */}
              <HStack gap="12px">
                {stealthTotal > 0 && (
                  <HStack gap="5px">
                    <Box w="6px" h="6px" borderRadius={radius.full} bg={colors.accent.indigo} />
                    <Text fontSize="11px" color={colors.text.muted}>
                      {stealthTotal.toFixed(4)} unclaimed
                    </Text>
                  </HStack>
                )}
                {claimTotal > 0 && (
                  <HStack gap="5px">
                    <Box w="6px" h="6px" borderRadius={radius.full} bg={colors.accent.indigoBright} />
                    <Text fontSize="11px" color={colors.text.muted}>
                      {claimTotal.toFixed(4)} in wallets
                    </Text>
                  </HStack>
                )}
              </HStack>
            </VStack>
          )}

          {/* Token row */}
          <Box borderTop={`1px solid ${colors.border.default}`} pt="12px">
            <HStack justify="space-between" align="center">
              <HStack gap="10px">
                <Box
                  w="36px" h="36px"
                  borderRadius={radius.full}
                  bg="linear-gradient(135deg, rgba(42, 114, 229, 0.08) 0%, rgba(42, 114, 229, 0.15) 100%)"
                  border="1.5px solid rgba(42, 114, 229, 0.2)"
                  display="flex" alignItems="center" justifyContent="center"
                >
                  <ChainIcon size={22} chainId={activeChainId} />
                </Box>
                <VStack align="flex-start" gap="1px">
                  <Text fontSize="13px" fontWeight={700} color={colors.text.primary}>{symbol}</Text>
                  <Text fontSize="11px" color={colors.text.muted}>{chainConfig.name}</Text>
                </VStack>
              </HStack>
              <VStack align="flex-end" gap="1px">
                <Text fontSize="14px" fontWeight={700} color={colors.text.primary}>
                  {total.toFixed(4)}
                </Text>
                <Text fontSize="11px" color={colors.text.muted}>
                  {unclaimedCount > 0
                    ? `${unclaimedCount} unclaimed payment${unclaimedCount !== 1 ? "s" : ""}`
                    : "All funds claimed"
                  }
                </Text>
              </VStack>
            </HStack>
          </Box>
        </VStack>
      </Box>
    </Box>
  );
}
