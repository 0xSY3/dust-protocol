"use client";

import { Box, Text, VStack, HStack, Spinner } from "@chakra-ui/react";
import { colors, radius, glass, shadows, transitions, typography } from "@/lib/design/tokens";

interface PoolStatsProps {
  currentPrice: number | null;
  ethReserve: number;
  usdcReserve: number;
  totalValueLocked: number;
  isLoading: boolean;
  poolTick?: number;
}

function formatNumber(num: number, decimals: number = 2): string {
  if (num >= 1e9) return `${(num / 1e9).toFixed(decimals)}B`;
  if (num >= 1e6) return `${(num / 1e6).toFixed(decimals)}M`;
  if (num >= 1e3) return `${(num / 1e3).toFixed(decimals)}K`;
  if (num < 0.01 && num > 0) return num.toFixed(6);
  return num.toFixed(decimals);
}

function StatBox({
  icon,
  label,
  value,
  sublabel,
  iconColor,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sublabel: string;
  iconColor: string;
}) {
  return (
    <Box
      p="12px"
      borderRadius={radius.sm}
      bg="rgba(255,255,255,0.02)"
      border={`1px solid ${colors.border.light}`}
    >
      <HStack gap="6px" mb="4px">
        <Box color={iconColor}>{icon}</Box>
        <Text fontSize="11px" color={colors.text.muted} fontWeight={500}>
          {label}
        </Text>
      </HStack>
      <Text
        fontSize="13px"
        fontFamily={typography.fontFamily.mono}
        color={colors.text.primary}
        fontWeight={500}
      >
        {value}
      </Text>
      <Text fontSize="10px" color={colors.text.muted} mt="2px">
        {sublabel}
      </Text>
    </Box>
  );
}

// Inline SVG icons to avoid external dependencies
const CoinsIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="8" cy="8" r="6" />
    <path d="M18.09 10.37A6 6 0 1 1 10.34 18" />
    <path d="M7 6h1v4" />
    <path d="m16.71 13.88.7.71-2.82 2.82" />
  </svg>
);

const BarChartIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="20" x2="12" y2="10" /><line x1="18" y1="20" x2="18" y2="4" /><line x1="6" y1="20" x2="6" y2="16" />
  </svg>
);

const TrendingUpIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" />
  </svg>
);

const ActivityIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
);

const DropletsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05z" />
    <path d="M12.56 14.69c1.46 0 2.64-1.22 2.64-2.7 0-.78-.38-1.51-1.13-2.13C13.32 9.23 12.77 8.6 12.56 7.94c-.19.67-.75 1.3-1.51 1.92-.75.62-1.13 1.35-1.13 2.13 0 1.48 1.18 2.7 2.64 2.7z" />
  </svg>
);

export function PoolStats({
  currentPrice,
  ethReserve,
  usdcReserve,
  totalValueLocked,
  isLoading,
  poolTick,
}: PoolStatsProps) {
  const ethValue = ethReserve * (currentPrice ?? 0);
  const totalValue = totalValueLocked > 0 ? totalValueLocked : ethValue + usdcReserve;
  const ethPercent = totalValue > 0 ? (ethValue / totalValue) * 100 : 50;
  const usdcPercent = totalValue > 0 ? (usdcReserve / totalValue) * 100 : 50;

  if (isLoading) {
    return (
      <Box
        w="420px"
        p="3px"
        borderRadius={radius.lg}
        bg={`linear-gradient(135deg, ${colors.accent.indigoDark} 0%, ${colors.accent.indigo} 50%, ${colors.accent.indigoDark} 100%)`}
        boxShadow={shadows.card}
      >
        <Box
          bg={colors.bg.cardSolid}
          borderRadius="17px"
          p="24px"
          display="flex"
          alignItems="center"
          justifyContent="center"
          h="280px"
        >
          <Spinner size="sm" color={colors.accent.indigo} />
        </Box>
      </Box>
    );
  }

  return (
    <Box
      w="420px"
      p="3px"
      borderRadius={radius.lg}
      bg={`linear-gradient(135deg, ${colors.accent.indigoDark} 0%, ${colors.accent.indigo} 50%, ${colors.accent.indigoDark} 100%)`}
      boxShadow={shadows.card}
      flexShrink={0}
    >
      <Box
        bg={colors.bg.cardSolid}
        borderRadius="17px"
        p="20px"
      >
        <VStack gap="16px" align="stretch">
          {/* Header */}
          <Box textAlign="center" pb="12px" borderBottom={`1px solid ${colors.border.light}`}>
            <Text fontSize="16px" fontWeight={700} color={colors.text.primary} fontFamily={typography.fontFamily.heading}>
              Pool Statistics
            </Text>
            <Text fontSize="11px" color={colors.text.muted} mt="4px">
              Real-time metrics for the ETH/USDC liquidity pool
            </Text>
          </Box>

          {/* Current Pool Ratio */}
          <Box
            p="12px"
            borderRadius={radius.sm}
            bg={`linear-gradient(135deg, rgba(74,117,240,0.08) 0%, rgba(99,60,255,0.08) 100%)`}
            border={`1px solid rgba(74,117,240,0.15)`}
          >
            <Text fontSize="11px" color={colors.text.muted} mb="4px">
              Current Pool Ratio
            </Text>
            <Text fontSize="18px" fontFamily={typography.fontFamily.mono} color={colors.text.primary}>
              1 ETH ={" "}
              <Box as="span" color={colors.accent.indigo}>
                ${currentPrice?.toFixed(2) ?? "\u2014"}
              </Box>{" "}
              USDC
            </Text>
          </Box>

          {/* Stats Grid */}
          <Box display="grid" gridTemplateColumns="1fr 1fr" gap="10px">
            <StatBox
              icon={<CoinsIcon />}
              iconColor={colors.accent.cyan}
              label="TVL"
              value={`$${formatNumber(totalValue)}`}
              sublabel="Real pool reserves"
            />
            <StatBox
              icon={<BarChartIcon />}
              iconColor={colors.accent.cyan}
              label="24h Volume"
              value="\u2014"
              sublabel="Requires indexer"
            />
            <StatBox
              icon={<TrendingUpIcon />}
              iconColor={colors.accent.green}
              label="ETH Price"
              value={`$${currentPrice?.toFixed(2) ?? "\u2014"}`}
              sublabel="USDC per ETH"
            />
            <StatBox
              icon={<ActivityIcon />}
              iconColor={colors.accent.red}
              label="APR"
              value="\u2014"
              sublabel="Based on fees"
            />
          </Box>

          {/* Pool Composition */}
          <VStack gap="8px" align="stretch">
            <Text fontSize="11px" color={colors.text.muted} fontWeight={600}>
              Pool Composition
            </Text>

            {/* ETH */}
            <Box
              p="12px"
              borderRadius={radius.sm}
              bg="rgba(255,255,255,0.02)"
              border={`1px solid ${colors.border.light}`}
            >
              <HStack justify="space-between" mb="8px">
                <HStack gap="8px">
                  <Box
                    w="28px"
                    h="28px"
                    borderRadius="50%"
                    bg={colors.bg.cardSolid}
                    display="flex"
                    alignItems="center"
                    justifyContent="center"
                  >
                    <Text fontSize="11px" fontWeight={700} color={colors.text.primary}>
                      E
                    </Text>
                  </Box>
                  <Text fontSize="13px" fontWeight={600} color={colors.text.primary}>
                    ETH
                  </Text>
                </HStack>
                <VStack gap="0" align="flex-end">
                  <Text fontSize="13px" fontFamily={typography.fontFamily.mono} color={colors.text.primary}>
                    {formatNumber(ethReserve, 4)}
                  </Text>
                  <Text fontSize="10px" color={colors.text.muted}>
                    {"\u2248"} ${formatNumber(ethValue)}
                  </Text>
                </VStack>
              </HStack>
              <Box h="6px" bg={colors.bg.page} borderRadius={radius.full} overflow="hidden">
                <Box
                  h="100%"
                  borderRadius={radius.full}
                  transition={transitions.smooth}
                  w={`${ethPercent}%`}
                  bg={colors.accent.indigo}
                />
              </Box>
              <Text fontSize="10px" color={colors.text.muted} mt="4px">
                {ethPercent.toFixed(1)}% of pool
              </Text>
            </Box>

            {/* USDC */}
            <Box
              p="12px"
              borderRadius={radius.sm}
              bg="rgba(255,255,255,0.02)"
              border={`1px solid ${colors.border.light}`}
            >
              <HStack justify="space-between" mb="8px">
                <HStack gap="8px">
                  <Box
                    w="28px"
                    h="28px"
                    borderRadius="50%"
                    bg={colors.bg.cardSolid}
                    display="flex"
                    alignItems="center"
                    justifyContent="center"
                  >
                    <Text fontSize="11px" fontWeight={700} color={colors.text.primary}>
                      $
                    </Text>
                  </Box>
                  <Text fontSize="13px" fontWeight={600} color={colors.text.primary}>
                    USDC
                  </Text>
                </HStack>
                <VStack gap="0" align="flex-end">
                  <Text fontSize="13px" fontFamily={typography.fontFamily.mono} color={colors.text.primary}>
                    {formatNumber(usdcReserve, 2)}
                  </Text>
                  <Text fontSize="10px" color={colors.text.muted}>
                    {"\u2248"} ${formatNumber(usdcReserve)}
                  </Text>
                </VStack>
              </HStack>
              <Box h="6px" bg={colors.bg.page} borderRadius={radius.full} overflow="hidden">
                <Box
                  h="100%"
                  borderRadius={radius.full}
                  transition={transitions.smooth}
                  w={`${usdcPercent}%`}
                  bg={colors.accent.green}
                />
              </Box>
              <Text fontSize="10px" color={colors.text.muted} mt="4px">
                {usdcPercent.toFixed(1)}% of pool
              </Text>
            </Box>
          </VStack>

          {/* Total Liquidity */}
          <Box
            p="12px"
            borderRadius={radius.sm}
            bg={`linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)`}
            border={`1px solid ${colors.border.default}`}
          >
            <HStack justify="space-between">
              <HStack gap="8px">
                <Box color={colors.accent.cyan}>
                  <DropletsIcon />
                </Box>
                <VStack gap="0" align="flex-start">
                  <Text fontSize="11px" color={colors.text.muted}>
                    Total Value Locked
                  </Text>
                  <Text fontSize="13px" fontFamily={typography.fontFamily.mono} color={colors.accent.indigo} fontWeight={600}>
                    ${formatNumber(totalValue)}
                  </Text>
                </VStack>
              </HStack>
              {poolTick !== undefined && (
                <VStack gap="0" align="flex-end">
                  <Text fontSize="11px" color={colors.text.muted}>
                    Pool Tick
                  </Text>
                  <Text fontSize="13px" fontFamily={typography.fontFamily.mono} color={colors.text.primary}>
                    {poolTick}
                  </Text>
                </VStack>
              )}
            </HStack>
          </Box>
        </VStack>
      </Box>
    </Box>
  );
}
